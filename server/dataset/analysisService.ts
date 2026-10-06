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
import type { PerformanceEntry, SelectionResult } from '../../src/analytics/types.js';
import { summarizeSelection } from '../../src/analytics/summary.js';
import { buildSynergy, defaultSynergyFilters } from '../../src/synergy/analytics.js';
import { normalizeGameMode } from '../../src/utils/gameMode.js';
import { MODE_ELIGIBILITY_POLICY_VERSION } from '../../src/analytics/modeEligibility.js';
import { buildAnalyticsContext, PostgresAnalyticsContextRepository } from './analyticsContext.js';
import { hasMemberCollision, membersFromRows, type DatasetProjectionService } from './datasetProjectionService.js';
import { activePlayers, detailQueries, playersQuery, selectedMatches } from './postgresDatasetReadRepository.js';
import type { DatasetEvidenceAvailability, DatasetPlayerRow } from './types.js';
import { datasetSchemaVersion } from './types.js';

/**
 * TASK-DATA-03B.2B — server-side context-aware analytics consumption.
 * TASK-DATA-03B.2C (`server-analysis-v2`): NO match-count population cap. Phase 2 walks the WHOLE
 * selected population in fixed-size chunks (an implementation work unit, never a limit), and the
 * response carries aggregates (selection-summary-v1 / duo-synergy-v1 results) instead of the
 * population's match records, so payload size scales with members x maps x agents x pairs.
 * Only bounded adaptive/progress windows still ship their (policy-bounded) matches.
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
export const SERVER_ANALYSIS_VERSION = 'server-analysis-v2' as const;
/** Phase-2 work unit (matches per detail read) and parallel chunks. NOT a population limit. */
export const PHASE2_CHUNK_MATCHES = 250;
export const PHASE2_PARALLEL_CHUNKS = 2;

function mergeAvailability(a: DatasetEvidenceAvailability, b: DatasetEvidenceAvailability): DatasetEvidenceAvailability {
  // Each flag is an every(...) over matches, so AND across chunks equals the whole-population value.
  return {
    acs: 'derived', adr: 'derived',
    headshotPercentage: a.headshotPercentage === 'derived' && b.headshotPercentage === 'derived' ? 'derived' : 'partial',
    kast: a.kast === 'reconstructed' && b.kast === 'reconstructed' ? 'reconstructed' : 'partial',
    firstKills: a.firstKills === 'reconstructed' && b.firstKills === 'reconstructed' ? 'reconstructed' : 'partial',
    firstDeaths: a.firstDeaths === 'reconstructed' && b.firstDeaths === 'reconstructed' ? 'reconstructed' : 'partial',
  };
}

/** Same SelectionResult the browser rebuilt from a v1 payload (byPlayer order, entries playedAt desc). */
function selectionOf(byPlayer: Map<string, PerformanceEntry[]>): SelectionResult {
  const entries = [...byPlayer.values()].flat()
    .sort((a, b) => b.match.playedAt.localeCompare(a.match.playedAt) || a.playerId.localeCompare(b.playerId));
  return { entries, byPlayer };
}

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
  /** TASK-IDENTITY-01: the person; skeleton performances are keyed by member like the projection. */
  member_public_id: string;
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
         v.game_length_ms, v.season_short, v.player_id AS internal_player_id, v.player_public_id::text AS player_public_id, v.member_public_id::text AS member_public_id, v.agent_name,
         mt.won AS team_won, mt.rounds_won, mt.rounds_lost,
         (v.core_ok AND rc.rounds > 0 AND pr.present = rc.rounds) AS usable
  FROM (
    SELECT sm.id AS match_id, sm.public_id, sm.started_at, sm.map_name, sm.queue_id, sm.queue_name, sm.game_length_ms, sm.season_short,
           mp.id AS participant_id, mp.player_id, ap.public_id AS player_public_id, ap.member_public_id, mp.agent_name,
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
    // Same identity invariant as the projection: a member collision withholds the whole match.
    if (hasMemberCollision(matchRows.map((row) => row.member_public_id))) continue;
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
      performances: usable.map((row) => ({ playerId: row.member_public_id, agent: row.agent_name!, kills: 0, deaths: 0, assists: 0, acs: 0, adr: 0 })),
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
      const skeletonPlayers: Player[] = membersFromRows(playerRows, new Map());
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
      if (request.feature === 'improvementIndex') {
        // Bounded by policy: only each player's current + baseline windows reach phase 2.
        const contextual = selectPerformances(createPerformanceEntries(dataset(skeletons, skeletonPlayers)), filters, { population });
        for (const entries of contextual.byPlayer.values()) {
          const { window } = resolveProgressWindows(entries, population);
          for (const entry of [...window.currentEntries, ...window.baselineEntries]) selectedIds.add(entry.match.id);
        }
      } else if (request.feature === 'synergy') {
        selectedIds = new Set(matchesInPairContext(skeletons, { map: request.map, gameMode: request.mode, ...(request.act ? { act: request.act } : {}), ...(request.from ? { from: request.from } : {}), ...(request.to ? { to: request.to } : {}) }).map((match) => match.id));
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
        selectedIds = new Set(ids);
      }
      const resolveMs = performance.now() - resolveStarted;

      // ---- Phase 2: full evidence for EVERY selected match, in deterministic chunks (no cap).
      const phase2Started = performance.now();
      const internalIds = [...selectedIds].flatMap((id) => internalByPublic.get(id) ?? []).sort();
      const chunks: string[][] = [];
      for (let index = 0; index < internalIds.length; index += PHASE2_CHUNK_MATCHES) chunks.push(internalIds.slice(index, index + PHASE2_CHUNK_MATCHES));
      const full = new Map<string, MatchRecord>();
      let availability: DatasetEvidenceAvailability | undefined;
      let projectedPlayers: Player[] = [];
      let projectedOnce = false;
      let projectionMs = 0;
      const projectChunk = async (ids: string[]) => {
        const rows = ids.length
          ? await Promise.all(detailQueries(query, selectedMatches, [ids]))
          : undefined;
        // Raw rounds/events are released after each chunk; only compact match records are kept.
        const projectionStarted = performance.now();
        const projected = this.projection.project({
          players: playerRows,
          performances: rows ? rows[0].rows : [], rounds: rows ? rows[1].rows : [],
          roundParticipants: rows ? rows[2].rows : [], events: rows ? rows[3].rows : [],
        }, agentsByInternal);
        projectionMs += performance.now() - projectionStarted;
        for (const match of projected.dataset.matches) full.set(match.id, match);
        availability = availability ? mergeAvailability(availability, projected.availability) : projected.availability;
        if (!projectedOnce) { projectedPlayers = projected.dataset.players; projectedOnce = true; }
      };
      if (chunks.length === 0) await projectChunk([]);
      for (let index = 0; index < chunks.length; index += PHASE2_PARALLEL_CHUNKS) {
        await Promise.all(chunks.slice(index, index + PHASE2_PARALLEL_CHUNKS).map(projectChunk));
      }
      const phase2Ms = performance.now() - phase2Started;
      const aggregateStarted = performance.now();
      // populationComplete describes evidence reality: every selected match reached full projection.
      const populationComplete = [...selectedIds].every((id) => full.has(id));

      // ---- Re-resolve with full entries swapped in (identical selection; real evidence for confidence).
      const merged = skeletons.map((match) => full.get(match.id) ?? match);
      const players = projectedPlayers;
      let scope;
      let forms;
      let summary;
      let synergy;
      /** Matches the bounded windows reference (policy-bounded); never the whole population. */
      const windowIds = new Set<string>();
      const keepWindow = <W extends { currentMatchIds: string[]; baselineMatchIds: string[] }>(window: W): W => {
        for (const id of [...window.currentMatchIds, ...window.baselineMatchIds]) windowIds.add(id);
        return window;
      };
      /** Server-internal member -> match ids of the feature population (weapon CURRENT); never serialized. */
      const selection: Record<string, string[]> = {};
      let progress;
      if (request.feature === 'improvementIndex') {
        const contextual = selectPerformances(createPerformanceEntries(dataset(merged, players)), filters, { population });
        progress = [...contextual.byPlayer].map(([playerId, entries]) => {
          const resolved = resolveProgressWindows(entries, population);
          // Only entries whose evidence phase 2 loaded may be scored (never a skeleton).
          const loaded = [...resolved.window.currentEntries, ...resolved.window.baselineEntries].every((entry) => full.has(entry.match.id));
          return { playerId, actPolicy: resolved.actPolicy, window: serializeWindow(resolved.window), complete: loaded };
        }).filter((item) => item.complete).map((item) => ({ playerId: item.playerId, actPolicy: item.actPolicy, window: keepWindow(item.window) }));
      } else if (request.feature === 'synergy') {
        // duo-synergy-v1 unchanged, now over the full pair population server-side (results only).
        const pairMatches = [...selectedIds].flatMap((id) => full.get(id) ?? [])
          .sort((a, b) => b.playedAt.localeCompare(a.playedAt) || a.id.localeCompare(b.id));
        synergy = buildSynergy(dataset(pairMatches, players), { ...defaultSynergyFilters, map: request.map, gameMode: request.mode,
          from: request.from ?? '', to: request.to ?? '', ...(request.act ? { act: request.act } : {}) });
      } else {
        const entries = createPerformanceEntries(dataset(merged, players));
        const final = selectPerformances(entries, filters, { population, lifetimeFeature });
        const kept = new Map<string, PerformanceEntry[]>();
        for (const [playerId, playerEntries] of final.byPlayer) {
          const loaded = playerEntries.filter((entry) => full.has(entry.match.id));
          if (loaded.length) kept.set(playerId, loaded);
        }
        for (const [playerId, loaded] of kept) selection[playerId] = loaded.map((entry) => entry.match.id);
        summary = summarizeSelection(selectionOf(kept));
        scope = serializeScope(final.scope!);
        for (const player of scope.players) if (player.window) keepWindow(player.window);
        if (request.form) {
          const contextual = selectPerformances(entries, { ...filters, period: 'all' }, { population });
          forms = [...contextual.byPlayer].map(([playerId, playerEntries]) => ({ playerId, window: keepWindow(serializeWindow(resolveAdaptiveWindow(playerEntries, policyFor('recentForm'), { population }))) }));
        }
      }
      const aggregateMs = performance.now() - aggregateStarted;
      const matches = [...windowIds].flatMap((id) => full.get(id) ?? []).sort((a, b) => b.playedAt.localeCompare(a.playedAt) || a.id.localeCompare(b.id));
      const payload = {
        ok: true as const,
        schemaVersion: datasetSchemaVersion,
        view: 'analysis' as const,
        analysisVersion: SERVER_ANALYSIS_VERSION,
        scopeRuleVersion: ANALYSIS_SCOPE_VERSION,
        featurePolicyVersion: FEATURE_SCOPE_POLICY_VERSION,
        /** TASK-DATA-MODE-POLICY-01: additive; strength populations are Competitive only. */
        modeEligibilityPolicyVersion: MODE_ELIGIBILITY_POLICY_VERSION,
        adaptiveWindowVersion: ADAPTIVE_WINDOW_VERSION,
        scoreVersion: 'community-score-v2' as const,
        ...(request.feature === 'synergy' ? { synergyVersion: 'duo-synergy-v1' as const } : {}),
        feature: request.feature,
        status: populationComplete ? 'available' as const : 'partial' as const,
        reasons: populationComplete ? [] : ['population_incomplete' as const],
        coverage: {
          trackedMatchCount: context.population.trackedMatchCount,
          /** Every selected match of the feature population was processed with full evidence. */
          populationComplete,
          /** Matches the feature population aggregated (policy-bounded features stay bounded by policy). */
          populationMatches: selectedIds.size,
          serverHistoryUsed: true as const,
          transportSnapshotUsed: false as const,
          /** server-analysis-v2 has no implementation match-count limit. */
          populationLimit: null,
          lifetimeComplete: false as const,
        },
        population: { ...(population.anchor ? { anchor: population.anchor } : {}), ...(population.floor ? { floor: population.floor } : {}),
          seasonKeys: population.seasonKeys, seasonStatus: population.seasonStatus, rankStatus: population.rankStatus },
        ...(scope ? { scope } : {}),
        ...(summary ? { summary } : {}),
        ...(synergy ? { synergy } : {}),
        ...(forms ? { forms } : {}),
        ...(progress ? { progress, improvementVersion: 'improvement-index-v1' as const } : {}),
        evidence: availability!,
        /** Only matches referenced by bounded windows (forms/adaptive/progress); never the population. */
        dataset: dataset(matches, players),
      };
      const metrics = {
        sqlQueryCount, phase1Ms: round(phase1Ms), resolveMs: round(resolveMs), phase2Ms: round(phase2Ms), projectionMs: round(projectionMs), aggregateMs: round(aggregateMs), totalMs: round(performance.now() - started),
        observationRows: observations.length, eligibleMatches: skeletons.length, selectedMatches: selectedIds.size, shippedMatches: matches.length, phase2Chunks: chunks.length, serializedBytes: Buffer.byteLength(JSON.stringify(payload)),
      };
      return { payload, metrics, selection };
    }
  }
}

const round = (value: number) => Math.round(value * 100) / 100;
