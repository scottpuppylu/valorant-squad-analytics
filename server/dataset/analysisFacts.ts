import type { SqlExecutor } from '../db/types.js';
import { DURABLE_NORMALIZATION_VERSION } from '../evidence/types.js';
import { CANONICAL_EVENT_METRIC_RULE_VERSION, EventMetricEngine, type EventMetricRuleVersion } from '../metrics/eventMetricEngine.js';
import { factsAreVisibilityIndependent, reconstructMatchFacts, type ParticipantFact } from './matchAssembly.js';
import { eventSelect, performanceSelect, roundParticipantSelect, roundSelect } from './postgresDatasetReadRepository.js';
import type { DatasetEventRow, DatasetPerformanceRow, DatasetRoundParticipantRow, DatasetRoundRow } from './types.js';

/**
 * TASK-DATA-03B.2D `analysis-match-facts-v1`: materialized per-participant analysis facts.
 *
 * Grain: one LINKED match participant (Riot ACCOUNT x source match). A fact is the exact output of the
 * shared reconstruction (`reconstructMatchFacts`) for that participant: event metrics of the writing engine, round
 * coverage and direct trade edges. No score, provider identifier, HMAC or name is stored.
 *
 * Freshness: a fact is used only while `engine_key` equals the running engine and `source_observed_at`
 * equals `source_matches.last_observed_at` (every durable match write refreshes that timestamp and the
 * facts in the same transaction). Anything else is treated as absent and reconstructed from raw evidence.
 */
export const ANALYSIS_FACTS_VERSION = 'analysis-match-facts-v1' as const;
/** Internal engine label of the full-tracked analysis read path (not part of the public contract). */
export const FULL_TRACKED_AGGREGATE_VERSION = 'full-tracked-aggregate-v1' as const;
/**
 * Any change to the fact contract, event-metrics rules or durable normalization invalidates every fact. The key names
 * the engine that WROTE the fact (a v1 fact is never read as a v2 fact, and vice versa). The fact SHAPE is the same
 * for every rule version, so ANALYSIS_FACTS_VERSION does not change: the rule version inside the key is the version.
 */
export const analysisFactsEngineKey = (ruleVersion: EventMetricRuleVersion) => `${ANALYSIS_FACTS_VERSION}:${ruleVersion}:${DURABLE_NORMALIZATION_VERSION}`;
/** The key a fact must carry to be fresh for the running (canonical) engine. */
export const ANALYSIS_FACTS_ENGINE_KEY = analysisFactsEngineKey(CANONICAL_EVENT_METRIC_RULE_VERSION);

/** SQL predicate: fact row `f` is fresh for source match `sm`. Server-owned constant only. */
export const freshFactPredicate = (f: string, sm: string) =>
  `${f}.engine_key='${ANALYSIS_FACTS_ENGINE_KEY}' AND ${f}.source_observed_at=${sm}.last_observed_at`;

/** All LINKED participants (player_id set) of the given internal match ids: the write-time fact population. */
const linkedCte = `
  WITH active_players AS (SELECT p.id, p.public_id FROM players p),
  eligible_matches AS (SELECT sm.id, sm.started_at FROM source_matches sm WHERE sm.id = ANY($1::uuid[]))`;
const jsonRows = (select: string) => `(SELECT coalesce(json_agg(d), '[]'::json) FROM (${select}) d)`;

/**
 * One statement: the same four detail SELECTs the projection uses (byte-identical column lists), over
 * linked participants, plus each match's freshness timestamp. JSON keeps it to one round trip.
 */
export const factSourceSql = `${linkedCte}
  SELECT ${jsonRows(performanceSelect)} AS performances,
         ${jsonRows(roundSelect)} AS rounds,
         ${jsonRows(roundParticipantSelect)} AS round_participants,
         ${jsonRows(eventSelect)} AS events,
         (SELECT coalesce(json_agg(json_build_object('id', sm.id, 'observed_at', sm.last_observed_at)), '[]'::json)
            FROM source_matches sm WHERE sm.id = ANY($1::uuid[])) AS observed`;

interface FactSourceRow extends Record<string, unknown> {
  performances: DatasetPerformanceRow[] | string;
  rounds: DatasetRoundRow[] | string;
  round_participants: DatasetRoundParticipantRow[] | string;
  events: DatasetEventRow[] | string;
  observed: { id: string; observed_at: string }[] | string;
}

const parsed = <T>(value: T[] | string): T[] => (typeof value === 'string' ? JSON.parse(value) as T[] : value);

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) grouped.set(key(value), [...(grouped.get(key(value)) ?? []), value]);
  return grouped;
}

export interface FactRefreshSummary { matches: number; facts: number; withheldMatches: number }

/**
 * Recompute and replace the facts of the given internal match ids. Inside a durable write transaction it
 * makes facts and evidence commit together; used outside one (deploy-time hydration) the freshness guard
 * in the write statement drops any fact whose match changed after it was read.
 */
export async function refreshAnalysisFacts(executor: SqlExecutor, matchIds: string[], engine = new EventMetricEngine()): Promise<FactRefreshSummary> {
  if (matchIds.length === 0) return { matches: 0, facts: 0, withheldMatches: 0 };
  const source = (await executor.query<FactSourceRow>(factSourceSql, [matchIds])).rows[0]!;
  const performances = groupBy(parsed(source.performances), (row) => row.internal_match_id);
  const rounds = groupBy(parsed(source.rounds), (row) => row.internal_match_id);
  const roundMatch = new Map(parsed(source.rounds).map((row) => [row.internal_round_id, row.internal_match_id]));
  const presences = groupBy(parsed(source.round_participants), (row) => roundMatch.get(row.internal_round_id) ?? '');
  const events = groupBy(parsed(source.events), (row) => row.internal_match_id);
  const observed = new Map(parsed(source.observed).map((row) => [row.id, row.observed_at]));
  const rows: unknown[][] = [];
  let withheldMatches = 0;
  for (const matchId of matchIds) {
    const topology = { performances: performances.get(matchId) ?? [], rounds: rounds.get(matchId) ?? [],
      roundParticipants: presences.get(matchId) ?? [], events: events.get(matchId) ?? [] };
    const observedAt = observed.get(matchId);
    if (!observedAt || topology.performances.length === 0) continue;
    // Facts are only stored when they equal the read-time reconstruction for EVERY visibility subset.
    if (!factsAreVisibilityIndependent(topology)) { withheldMatches += 1; continue; }
    const { facts } = reconstructMatchFacts(engine, topology);
    for (const [participantId, fact] of facts) {
      rows.push([participantId, matchId, analysisFactsEngineKey(engine.ruleVersion), observedAt, fact.observedRounds, fact.presentEveryRound,
        JSON.stringify(fact.metrics), JSON.stringify(fact.tradeEdges)]);
    }
  }
  // One statement: remove every old fact of these matches that is not being rewritten, then upsert the new
  // ones. The guard joins require the match to be unchanged and the participant to still be linked.
  await executor.query(
    `WITH incoming AS (
       SELECT * FROM json_to_recordset($2::json) AS x(match_participant_id uuid, source_match_id uuid, engine_key text,
         source_observed_at timestamptz, observed_rounds integer, present_every_round boolean, metrics text, trade_edges text)
     ), removed AS (
       DELETE FROM analysis_participant_facts f WHERE f.source_match_id = ANY($1::uuid[])
         AND NOT EXISTS (SELECT 1 FROM incoming i WHERE i.match_participant_id=f.match_participant_id)
     )
     INSERT INTO analysis_participant_facts (match_participant_id, source_match_id, engine_key, source_observed_at,
       observed_rounds, present_every_round, metrics, trade_edges)
     SELECT i.match_participant_id, i.source_match_id, i.engine_key, i.source_observed_at, i.observed_rounds,
            i.present_every_round, i.metrics::json, i.trade_edges::json
     FROM incoming i
     JOIN source_matches sm ON sm.id=i.source_match_id AND sm.last_observed_at=i.source_observed_at
     JOIN match_participants mp ON mp.id=i.match_participant_id AND mp.source_match_id=i.source_match_id AND mp.player_id IS NOT NULL
     ON CONFLICT (match_participant_id) DO UPDATE SET source_match_id=EXCLUDED.source_match_id, engine_key=EXCLUDED.engine_key,
       source_observed_at=EXCLUDED.source_observed_at, observed_rounds=EXCLUDED.observed_rounds,
       present_every_round=EXCLUDED.present_every_round, metrics=EXCLUDED.metrics, trade_edges=EXCLUDED.trade_edges, computed_at=now()
     WHERE analysis_participant_facts.source_observed_at <= EXCLUDED.source_observed_at`,
    [matchIds, JSON.stringify(rows.map(([match_participant_id, source_match_id, engine_key, source_observed_at, observed_rounds, present_every_round, metrics, trade_edges]) => ({
      match_participant_id, source_match_id, engine_key, source_observed_at, observed_rounds, present_every_round, metrics, trade_edges,
    })))],
  );
  return { matches: matchIds.length, facts: rows.length, withheldMatches };
}

/**
 * Analysis read (one statement, any population size): the projection's visible performance rows for the
 * selected matches with each participant's fact when fresh. `$1` = internal match ids.
 */
export function factReadSql(cte: string): string {
  const columns = `
               mt.won AS team_won, mt.rounds_won, mt.rounds_lost`;
  const from = `
        FROM eligible_matches em`;
  const order = `
        ORDER BY sm.started_at DESC NULLS LAST, sm.id, ap.public_id`;
  for (const part of [columns, from, order]) if (!performanceSelect.includes(part)) throw new Error('performanceSelect shape changed');
  return `${cte}${performanceSelect
    .replace(columns, `${columns},
               (f.match_participant_id IS NOT NULL) AS fact_fresh, f.observed_rounds AS fact_observed_rounds,
               f.present_every_round AS fact_present_every_round, f.metrics AS fact_metrics, f.trade_edges AS fact_trade_edges`)
    .replace(order, `
        LEFT JOIN analysis_participant_facts f ON f.match_participant_id=mp.id AND ${freshFactPredicate('f', 'sm')}${order}`)}`;
}

export interface FactReadRow extends DatasetPerformanceRow {
  fact_fresh: boolean;
  fact_observed_rounds: number | null;
  fact_present_every_round: boolean | null;
  fact_metrics: ParticipantFact['metrics'] | string | null;
  fact_trade_edges: ParticipantFact['tradeEdges'] | string | null;
}

/** The stored fact of one read row (undefined when absent or stale). */
export function factOf(row: FactReadRow): ParticipantFact | undefined {
  if (row.fact_fresh !== true || row.fact_metrics === null || row.fact_trade_edges === null
    || typeof row.fact_observed_rounds !== 'number' || typeof row.fact_present_every_round !== 'boolean') return undefined;
  return {
    observedRounds: row.fact_observed_rounds,
    presentEveryRound: row.fact_present_every_round,
    metrics: typeof row.fact_metrics === 'string' ? JSON.parse(row.fact_metrics) as ParticipantFact['metrics'] : row.fact_metrics,
    tradeEdges: typeof row.fact_trade_edges === 'string' ? JSON.parse(row.fact_trade_edges) as ParticipantFact['tradeEdges'] : row.fact_trade_edges,
  };
}
