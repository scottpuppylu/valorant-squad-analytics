import type { SqlDatabase, SqlExecutor } from '../db/types.js';
import { PublicApiError } from '../errors.js';
import { createPerformanceEntries, defaultAnalysisFilters, selectPerformances } from '../../src/analytics/filters.js';
import type { AnalysisFilters } from '../../src/analytics/types.js';
import { resolveAdaptiveWindow } from '../../src/analytics/scope/adaptiveWindow.js';
import { policyFor } from '../../src/analytics/scope/policies.js';
import { matchesInPairContext, populationFromMatches } from '../../src/analytics/scope/resolveScope.js';
import { resolveProgressWindows } from '../../src/analytics/progress/windows.js';
import { normalizeSeasonKey } from '../../src/analytics/scope/season.js';
import type { AdaptiveWindowResult, ScopePopulation, ScopeSummary } from '../../src/analytics/scope/types.js';
import { ADAPTIVE_WINDOW_VERSION, ANALYSIS_SCOPE_VERSION, FEATURE_SCOPE_POLICY_VERSION } from '../../src/analytics/scope/versions.js';
import type { MatchRecord, Player } from '../../src/types/valorant.js';
import { normalizeGameMode } from '../../src/utils/gameMode.js';
import { buildAnalyticsContext, PostgresAnalyticsContextRepository } from './analyticsContext.js';
import type { DatasetProjectionService } from './datasetProjectionService.js';
import { activePlayers, detailQueries, playersQuery, selectedMatches } from './postgresDatasetReadRepository.js';
import type { DatasetPlayerRow, DatasetPerformanceRow, DatasetRoundParticipantRow, DatasetRoundRow, DatasetEventRow } from './types.js';
import { datasetSchemaVersion } from './types.js';

/**
 * TASK-DATA-03B.2B — server-side context-aware analytics consumption (`server-analysis-v1`).
 *
 * Phase 1: one lightweight statement over ALL eligible durable history (no rounds/events topology
 * beyond counts) builds skeleton entries with the projection's exact basic-evidence gate.
 * The UNCHANGED browser scope engine (selectPerformances / adaptive-window-v1) resolves the population.
 * Phase 2: full projection only for the selected matches; the same resolver re-runs with full entries
 * so window confidence uses real evidence. Statements inside each phase run in parallel (production
 * Neon round trips are ~240 ms, so a single-connection transaction cost ~3 s). Consistency: phase 2
 * reads exactly the phase-1 match-id set (no loop/expansion), matches are deduplicated by public id,
 * and only entries whose evidence phase 2 actually loaded are ever scored.
 * The browser then runs the unchanged community-score-v2 / duo-synergy-v1 code on the result.
 */
export const SERVER_ANALYSIS_VERSION = 'server-analysis-v1' as const;
/** Hard bound on phase-2 matches for LIFETIME/ACT/PAIR populations; exceeding it is disclosed. */
export const SERVER_POPULATION_LIMIT = 2000;

export const analysisFeatures = ['currentStrength', 'lifetimeTotals', 'mapStats', 'agentStats', 'actOverview', 'fixedRecent', 'synergy', 'improvementIndex'] as const;
export type AnalysisFeature = (typeof analysisFeatures)[number];

export interface AnalysisRequest {
  feature: AnalysisFeature;
  recent?: 10 | 30;
  act?: string;
  from?: string;
  to?: string;
  map: string;
  agent: string;
  role: string;
  mode: string;
  player: string;
  form: boolean;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const roles = new Set(['all', 'Duelist', 'Initiator', 'Controller', 'Sentinel']);
const bad = (message: string) => new PublicApiError(400, 'BAD_REQUEST', message);

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) throw bad('查詢參數格式不正確。');
  return value;
}

function context(value: string | undefined): string {
  if (value === undefined || value === '') return 'all';
  if (value.length > 64 || /[<>]/u.test(value) || [...value].some((char) => char.charCodeAt(0) < 32)) throw bad('分析條件格式不正確。');
  return value;
}

/** The client declares a FEATURE and context only; the registry decides the population. */
export function parseAnalysisRequest(query: Record<string, string | string[] | undefined> | undefined): AnalysisRequest {
  const feature = single(query?.feature);
  if (!feature || !(analysisFeatures as readonly string[]).includes(feature)) throw bad('不支援的分析功能。');
  const typed = feature as AnalysisFeature;
  const recentRaw = single(query?.recent);
  const act = single(query?.act);
  const from = single(query?.from);
  const to = single(query?.to);
  const player = single(query?.player) ?? 'all';
  const role = single(query?.role) ?? 'all';
  const form = single(query?.form);
  if (recentRaw !== undefined && (typed !== 'fixedRecent' || (recentRaw !== '10' && recentRaw !== '30'))) throw bad('最近場數只適用於最近 N 場。');
  if (typed === 'fixedRecent' && recentRaw === undefined) throw bad('最近 N 場需要指定場數。');
  if (act !== undefined && (!['actOverview', 'synergy'].includes(typed) || normalizeSeasonKey(act) !== act)) throw bad('Act 參數不正確。');
  if (typed === 'actOverview' && !act) throw bad('指定 Act 需要 Act 參數。');
  for (const date of [from, to]) {
    if (date === undefined) continue;
    if (!['lifetimeTotals', 'mapStats', 'agentStats', 'synergy'].includes(typed) || !datePattern.test(date) || Number.isNaN(Date.parse(date))) throw bad('日期參數不正確。');
  }
  if (player !== 'all' && !uuidPattern.test(player)) throw bad('玩家參數不正確。');
  if (!roles.has(role)) throw bad('角色參數不正確。');
  if (form !== undefined && (form !== '1' || typed === 'synergy' || typed === 'improvementIndex')) throw bad('近期狀態參數不正確。');
  // improvement-index-v1 is per player under its own Competitive policy: only `player` context is allowed.
  if (typed === 'improvementIndex' && ['map', 'agent', 'mode'].some((key) => context(single(query?.[key])) !== 'all' || role !== 'all')) throw bad('進步指數只接受玩家條件。');
  return {
    feature: typed,
    ...(recentRaw ? { recent: Number(recentRaw) as 10 | 30 } : {}),
    ...(act ? { act } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}),
    map: context(single(query?.map)), agent: context(single(query?.agent)), mode: context(single(query?.mode)),
    role, player, form: form === '1',
  };
}

/** The same AnalysisFilters a browser page builds for this feature/context. */
export function filtersFor(request: AnalysisRequest): AnalysisFilters {
  const period: AnalysisFilters['period'] = request.feature === 'currentStrength' ? 'current'
    : request.feature === 'actOverview' ? 'act'
      : request.feature === 'fixedRecent' ? (request.recent === 10 ? 'recent10' : 'recent30')
        : request.from || request.to ? 'custom' : 'all';
  return {
    ...defaultAnalysisFilters, period,
    ...(request.act ? { act: request.act } : {}), ...(request.from ? { dateFrom: request.from } : {}), ...(request.to ? { dateTo: request.to } : {}),
    playerId: request.player, map: request.map, agent: request.agent, role: request.role as AnalysisFilters['role'], gameMode: request.mode,
  };
}

interface ObservationRow extends Record<string, unknown> {
  internal_match_id: string;
  public_match_id: string;
  started_at: string | Date;
  map_name: string | null;
  queue_id: string | null;
  queue_name: string | null;
  game_length_ms: number | null;
  season_short: string | null;
  internal_player_id: string;
  player_public_id: string;
  agent_name: string | null;
  team_won: boolean | null;
  rounds_won: number | null;
  rounds_lost: number | null;
  usable: boolean;
}

/**
 * Phase 1 (one statement). Mirrors DatasetProjectionService gates: a performance is usable when stats
 * are observed, the agent and K/D/A/score/damage exist, the match has rounds, and the participant is
 * present in every durable round. Match-level score/outcome come from the lowest-public-id visible
 * participant's team, exactly like the projection's first performance row.
 */
export const analysisObservationsSql = `
  WITH active_players AS (${activePlayers})
  SELECT v.match_id AS internal_match_id, v.public_id::text AS public_match_id, v.started_at, v.map_name, v.queue_id, v.queue_name,
         v.game_length_ms, v.season_short, v.player_id AS internal_player_id, v.player_public_id::text AS player_public_id, v.agent_name,
         mt.won AS team_won, mt.rounds_won, mt.rounds_lost,
         (v.core_ok AND rc.rounds > 0 AND pr.present = rc.rounds) AS usable
  FROM (
    SELECT sm.id AS match_id, sm.public_id, sm.started_at, sm.map_name, sm.queue_id, sm.queue_name, sm.game_length_ms, sm.season_short,
           mp.id AS participant_id, mp.player_id, ap.public_id AS player_public_id, mp.agent_name,
           -- Projection's "first performance row": the lowest public id visible participant of the match.
           first_value(mp.team_key) OVER (PARTITION BY sm.id ORDER BY ap.public_id) AS first_team_key,
           (mp.stats_evidence_status='observed' AND mp.agent_name IS NOT NULL AND mp.kills IS NOT NULL AND mp.deaths IS NOT NULL
             AND mp.assists IS NOT NULL AND mp.score IS NOT NULL AND mp.damage_dealt IS NOT NULL) AS core_ok
    FROM source_matches sm
    JOIN match_participants mp ON mp.source_match_id=sm.id
    JOIN active_players ap ON ap.id=mp.player_id
    WHERE sm.started_at IS NOT NULL
  ) v
  -- Keyed per-row lookups on existing unique indexes (no CTE-to-CTE joins; see SERVER_ANALYSIS.md).
  CROSS JOIN LATERAL (SELECT count(*)::int AS rounds FROM rounds r WHERE r.source_match_id=v.match_id) rc
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS present FROM rounds r
    JOIN round_participants rp ON rp.round_id=r.id AND rp.match_participant_id=v.participant_id
    WHERE r.source_match_id=v.match_id AND rp.present IS TRUE
  ) pr
  LEFT JOIN match_teams mt ON mt.source_match_id=v.match_id AND mt.team_key=v.first_team_key`;

const finiteNumber = (value: unknown) => (typeof value === 'number' ? value : Number(value));

function skeletonMatches(rows: ObservationRow[]): { matches: MatchRecord[]; internalByPublic: Map<string, string> } {
  const grouped = new Map<string, ObservationRow[]>();
  for (const row of rows) grouped.set(row.public_match_id, [...(grouped.get(row.public_match_id) ?? []), row]);
  const matches: MatchRecord[] = [];
  const internalByPublic = new Map<string, string>();
  for (const [publicId, matchRows] of grouped) {
    const usable = matchRows.filter((row) => row.usable);
    if (usable.length === 0) continue;
    const first = matchRows[0]!;
    internalByPublic.set(publicId, first.internal_match_id);
    const playedAt = new Date(first.started_at).toISOString();
    const seasonKey = normalizeSeasonKey(first.season_short);
    matches.push({
      id: publicId, playedAt, map: first.map_name ?? 'Unknown', gameMode: normalizeGameMode(first.queue_id, first.queue_name), opponent: '對手隊伍',
      scoreFor: first.rounds_won === null ? 0 : finiteNumber(first.rounds_won), scoreAgainst: first.rounds_lost === null ? 0 : finiteNumber(first.rounds_lost),
      won: first.team_won === true, durationMinutes: Math.max(1, Math.round((first.game_length_ms ?? 0) / 60_000)),
      ...(seasonKey ? { seasonKey } : {}),
      // Skeleton performances: identity/agent only. They choose windows; they are never scored or returned.
      performances: usable.map((row) => ({ playerId: row.player_public_id, agent: row.agent_name!, kills: 0, deaths: 0, assists: 0, acs: 0, adr: 0 })),
    });
  }
  // Same order as the projection/snapshot so every downstream iteration order matches the browser.
  matches.sort((a, b) => b.playedAt.localeCompare(a.playedAt) || a.id.localeCompare(b.id));
  return { matches, internalByPublic };
}

export interface SerializedWindow extends Omit<AdaptiveWindowResult, 'currentEntries' | 'baselineEntries'> {
  currentMatchIds: string[];
  baselineMatchIds: string[];
}

export function serializeWindow(window: AdaptiveWindowResult): SerializedWindow {
  const { currentEntries, baselineEntries, ...rest } = window;
  return { ...rest, currentMatchIds: currentEntries.map((entry) => entry.match.id), baselineMatchIds: baselineEntries.map((entry) => entry.match.id) };
}

export function serializeScope(summary: ScopeSummary) {
  const { players, ...rest } = summary;
  return { ...rest, players: [...players.values()].map(({ window, ...player }) => ({ ...player, ...(window ? { window: serializeWindow(window) } : {}) })) };
}

export class ServerAnalysisService {
  constructor(private readonly database: SqlDatabase, private readonly projection: DatasetProjectionService) {}

  async analyze(request: AnalysisRequest) {
    const started = performance.now();
    {
      let sqlQueryCount = 0;
      const query = (<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []) => { sqlQueryCount += 1; return this.database.query<Row>(sql, params); }) as SqlExecutor['query'];

      // ---- Phase 1: lightweight observations over all eligible durable history.
      const phase1Started = performance.now();
      const [observationResult, playerResult, contextRows] = await Promise.all([
        query<ObservationRow>(analysisObservationsSql),
        query<DatasetPlayerRow>(playersQuery),
        new PostgresAnalyticsContextRepository({ query }).readContextRows(),
      ]);
      const observations = observationResult.rows;
      const playerRows = playerResult.rows;
      const context = buildAnalyticsContext(contextRows);
      const phase1Ms = performance.now() - phase1Started;

      const resolveStarted = performance.now();
      const { matches: skeletons, internalByPublic } = skeletonMatches(observations);
      const agentsByInternal = new Map<string, Set<string>>();
      for (const row of observations) {
        if (!row.agent_name) continue;
        agentsByInternal.set(row.internal_player_id, (agentsByInternal.get(row.internal_player_id) ?? new Set()).add(row.agent_name));
      }
      const skeletonPlayers: Player[] = playerRows.map((row) => ({
        id: row.public_id, handle: `${row.display_name}#${row.display_tag}`, displayName: row.display_name, role: 'Duelist',
        agents: [], accent: '', tagline: '', playstyle: '', defaultEmoji: '🤖',
      }));
      const population: ScopePopulation = {
        ...populationFromMatches(skeletons, true),
        seasonKeys: [...new Set([...populationFromMatches(skeletons, true).seasonKeys, ...context.evidence.season.acts.map((act) => act.key)])].sort(),
        seasonStatus: context.evidence.season.status,
        rankStatus: context.evidence.rank.status,
      };
      const filters = filtersFor(request);
      const lifetimeFeature = request.feature === 'mapStats' || request.feature === 'agentStats' ? request.feature : 'lifetimeTotals';
      const dataset = (matches: MatchRecord[], players: Player[]) => ({ players, matches, sourceId: 'durable-neon-v4', isDemo: false as const, mode: 'REAL' as const });

      let selectedIds = new Set<string>();
      let limited = false;
      const limit = (ids: string[]) => {
        if (ids.length <= SERVER_POPULATION_LIMIT) return ids;
        limited = true;
        const order = new Map(skeletons.map((match) => [match.id, match.playedAt]));
        return [...ids].sort((a, b) => (order.get(b) ?? '').localeCompare(order.get(a) ?? '') || b.localeCompare(a)).slice(0, SERVER_POPULATION_LIMIT);
      };
      if (request.feature === 'improvementIndex') {
        // Bounded by policy: only each player's current + baseline windows reach phase 2.
        const contextual = selectPerformances(createPerformanceEntries(dataset(skeletons, skeletonPlayers)), filters, { population });
        for (const entries of contextual.byPlayer.values()) {
          const { window } = resolveProgressWindows(entries, population);
          for (const entry of [...window.currentEntries, ...window.baselineEntries]) selectedIds.add(entry.match.id);
        }
      } else if (request.feature === 'synergy') {
        selectedIds = new Set(limit(matchesInPairContext(skeletons, { map: request.map, gameMode: request.mode, ...(request.act ? { act: request.act } : {}), ...(request.from ? { from: request.from } : {}), ...(request.to ? { to: request.to } : {}) }).map((match) => match.id)));
      } else {
        const skeletonEntries = createPerformanceEntries(dataset(skeletons, skeletonPlayers));
        const first = selectPerformances(skeletonEntries, filters, { population, lifetimeFeature });
        const ids = [...new Set(first.entries.map((entry) => entry.match.id))];
        // Every adaptive window (even an unavailable one) needs real evidence for its confidence.
        for (const player of first.scope?.players.values() ?? []) for (const entry of player.window?.currentEntries ?? []) ids.push(entry.match.id);
        if (request.form) {
          const contextual = selectPerformances(skeletonEntries, { ...filters, period: 'all' }, { population });
          for (const entries of contextual.byPlayer.values()) {
            const window = resolveAdaptiveWindow(entries, policyFor('recentForm'), { population });
            for (const entry of [...window.currentEntries, ...window.baselineEntries]) ids.push(entry.match.id);
          }
        }
        selectedIds = new Set(limit([...new Set(ids)]));
      }
      const resolveMs = performance.now() - resolveStarted;

      // ---- Phase 2: full evidence only for the selected matches (bounded by the policy / limit).
      const phase2Started = performance.now();
      const internalIds = [...selectedIds].flatMap((id) => internalByPublic.get(id) ?? []);
      const [performances, rounds, roundParticipants, events] = internalIds.length
        ? await Promise.all(detailQueries(query, selectedMatches, [internalIds]))
        : [{ rows: [] as DatasetPerformanceRow[] }, { rows: [] as DatasetRoundRow[] }, { rows: [] as DatasetRoundParticipantRow[] }, { rows: [] as DatasetEventRow[] }];
      const projected = this.projection.project({ players: playerRows, performances: performances.rows, rounds: rounds.rows, roundParticipants: roundParticipants.rows, events: events.rows }, agentsByInternal);
      const phase2Ms = performance.now() - phase2Started;

      // ---- Re-resolve with full entries swapped in (identical selection; real evidence for confidence).
      const full = new Map(projected.dataset.matches.map((match) => [match.id, match]));
      const merged = skeletons.map((match) => full.get(match.id) ?? match);
      const players = projected.dataset.players;
      let scope;
      let forms;
      const selection: Record<string, string[]> = {};
      let progress;
      if (request.feature === 'improvementIndex') {
        const contextual = selectPerformances(createPerformanceEntries(dataset(merged, players)), filters, { population });
        progress = [...contextual.byPlayer].map(([playerId, entries]) => {
          const resolved = resolveProgressWindows(entries, population);
          // Only entries whose evidence phase 2 loaded may be scored (never a skeleton).
          const loaded = [...resolved.window.currentEntries, ...resolved.window.baselineEntries].every((entry) => full.has(entry.match.id));
          if (resolved.window.currentEntries.length) selection[playerId] = resolved.window.currentEntries.map((entry) => entry.match.id).filter((id) => full.has(id));
          return { playerId, actPolicy: resolved.actPolicy, window: serializeWindow(resolved.window), complete: loaded };
        }).filter((item) => item.complete).map((item) => ({ playerId: item.playerId, actPolicy: item.actPolicy, window: item.window }));
      } else if (request.feature !== 'synergy') {
        const entries = createPerformanceEntries(dataset(merged, players));
        const final = selectPerformances(entries, filters, { population, lifetimeFeature });
        for (const [playerId, playerEntries] of final.byPlayer) {
          const kept = playerEntries.filter((entry) => full.has(entry.match.id));
          if (kept.length) selection[playerId] = kept.map((entry) => entry.match.id);
        }
        if (limited) { final.scope!.status = 'partial'; final.scope!.reasons = [...new Set([...final.scope!.reasons, 'server_population_limit' as const])].sort(); }
        scope = serializeScope(final.scope!);
        if (request.form) {
          const contextual = selectPerformances(entries, { ...filters, period: 'all' }, { population });
          forms = [...contextual.byPlayer].map(([playerId, playerEntries]) => ({ playerId, window: serializeWindow(resolveAdaptiveWindow(playerEntries, policyFor('recentForm'), { population })) }));
        }
      }
      const matches = [...selectedIds].flatMap((id) => full.get(id) ?? []).sort((a, b) => b.playedAt.localeCompare(a.playedAt) || a.id.localeCompare(b.id));
      const payload = {
        ok: true as const,
        schemaVersion: datasetSchemaVersion,
        view: 'analysis' as const,
        analysisVersion: SERVER_ANALYSIS_VERSION,
        scopeRuleVersion: ANALYSIS_SCOPE_VERSION,
        featurePolicyVersion: FEATURE_SCOPE_POLICY_VERSION,
        adaptiveWindowVersion: ADAPTIVE_WINDOW_VERSION,
        scoreVersion: 'community-score-v2' as const,
        ...(request.feature === 'synergy' ? { synergyVersion: 'duo-synergy-v1' as const } : {}),
        feature: request.feature,
        status: limited ? 'partial' as const : 'available' as const,
        reasons: limited ? ['server_population_limit' as const] : [],
        coverage: {
          trackedMatchCount: context.population.trackedMatchCount,
          populationComplete: true as const,
          serverHistoryUsed: true as const,
          transportSnapshotUsed: false as const,
          populationLimit: SERVER_POPULATION_LIMIT,
          lifetimeComplete: false as const,
        },
        population: { ...(population.anchor ? { anchor: population.anchor } : {}), ...(population.floor ? { floor: population.floor } : {}),
          seasonKeys: population.seasonKeys, seasonStatus: population.seasonStatus, rankStatus: population.rankStatus },
        ...(scope ? { scope } : {}),
        selection,
        ...(forms ? { forms } : {}),
        ...(progress ? { progress, improvementVersion: 'improvement-index-v1' as const } : {}),
        evidence: projected.availability,
        dataset: dataset(matches, players),
      };
      const metrics = {
        sqlQueryCount, phase1Ms: round(phase1Ms), resolveMs: round(resolveMs), phase2Ms: round(phase2Ms), totalMs: round(performance.now() - started),
        observationRows: observations.length, eligibleMatches: skeletons.length, selectedMatches: matches.length, serializedBytes: Buffer.byteLength(JSON.stringify(payload)),
      };
      return { payload, metrics };
    }
  }
}

const round = (value: number) => Math.round(value * 100) / 100;
