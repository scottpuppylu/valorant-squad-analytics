import type { SqlDatabase } from '../db/types.js';
import { PublicApiError } from '../errors.js';
import { activePlayers } from './postgresDatasetReadRepository.js';
import type { ServerAnalysisService } from './analysisService.js';
import { datasetSchemaVersion } from './types.js';
import { normalizeSeasonKey } from '../../src/analytics/scope/season.js';
import { normalizeGameMode } from '../../src/utils/gameMode.js';
import {
  buildWeaponAnalytics, type EvidenceState, type KillAggRow, type RoundAggRow, type WeaponAggregates, type WeaponDimension,
  type WeaponRoundAggRow, type WeaponScopeMode,
} from '../../src/analytics/weapons/engine.js';

/**
 * TASK-WEAPON-01 server feature `view=analysis&feature=weaponAnalytics` (same Vercel function).
 * ALL TRACKED / ACT: aggregate SQL over ALL eligible durable evidence — no newest-300 snapshot, no
 * 2000-match phase-2 cap, response size ∝ members × weapons × breakdown values. CURRENT: the server's
 * own currentStrength adaptive selection (feature-scope-policy-v2, unchanged), then the same SQL
 * restricted to those member/match pairs. Visibility = the shared `activePlayers` projection.
 */
export interface WeaponRequest { player: string; scope: WeaponScopeMode; act?: string; map: string; agent: string; mode: string }

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const bad = (message: string) => new PublicApiError(400, 'BAD_REQUEST', message);
const single = (value: string | string[] | undefined) => { if (Array.isArray(value)) throw bad('查詢參數格式不正確。'); return value; };
const contextValue = (value: string | undefined, fallback: string) => {
  if (value === undefined || value === '') return fallback;
  if (value.length > 64 || /[<>]/u.test(value) || [...value].some((char) => char.charCodeAt(0) < 32)) throw bad('分析條件格式不正確。');
  return value;
};

/** Semantic context only: no match counts, round thresholds or SQL limits are accepted from clients. */
export function parseWeaponRequest(query: Record<string, string | string[] | undefined> | undefined): WeaponRequest {
  for (const key of ['recent', 'from', 'to', 'role', 'form', 'limit', 'size']) if (single(query?.[key]) !== undefined) throw bad('武器分析不接受此參數。');
  const scope = (single(query?.scope) ?? 'all') as WeaponScopeMode;
  if (!['all', 'current', 'act'].includes(scope)) throw bad('武器分析範圍不正確。');
  const act = single(query?.act);
  if (scope === 'act' ? !act || normalizeSeasonKey(act) !== act : act !== undefined) throw bad('Act 參數不正確。');
  const player = single(query?.player) ?? 'all';
  if (player !== 'all' && !uuidPattern.test(player)) throw bad('玩家參數不正確。');
  return { player, scope, ...(act ? { act } : {}), map: contextValue(single(query?.map), 'all'), agent: contextValue(single(query?.agent), 'all'), mode: contextValue(single(query?.mode), 'Competitive') };
}

/** Raw weapon group key — must mirror rawWeaponGroup() in the shared engine. */
const weaponKey = (id: string, name: string) => `CASE
    WHEN btrim(${id}) ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' THEN 'id:' || lower(btrim(${id}))
    WHEN ${name} IS NOT NULL AND char_length(regexp_replace(btrim(normalize(${name}, NFC)), '[[:space:]]+', ' ', 'g')) BETWEEN 1 AND 64
      THEN 'name:' || lower(regexp_replace(btrim(normalize(${name}, NFC)), '[[:space:]]+', ' ', 'g'))
    ELSE NULL END`;

/**
 * Eligible member participations. Collisions (two visible accounts of one member in a match) withhold
 * the whole match, exactly like the dataset projection. $1 queue keys | NULL, $2 map | NULL,
 * $3 agent | NULL, $4 raw season values | NULL, $5 member|match pairs (CURRENT) | NULL.
 */
const participations = `
  WITH active_players AS (${activePlayers}),
  vis AS (
    SELECT mp.id AS participant_id, mp.source_match_id, mp.team_key, mp.agent_name,
           ap.public_id::text AS account_id, ap.member_public_id::text AS member_id
    FROM match_participants mp JOIN active_players ap ON ap.id = mp.player_id
  ),
  collided AS (SELECT source_match_id FROM vis GROUP BY source_match_id, member_id HAVING count(*) > 1),
  p AS (
    SELECT v.participant_id, v.source_match_id, v.team_key, v.account_id, v.member_id,
           coalesce(sm.map_name, 'Unknown') AS map_name, coalesce(v.agent_name, 'Unknown') AS agent,
           coalesce(sm.season_short, 'unknown') AS season, sm.started_at
    FROM vis v JOIN source_matches sm ON sm.id = v.source_match_id
    WHERE sm.started_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM collided c WHERE c.source_match_id = v.source_match_id)
      AND ($1::text[] IS NULL OR (coalesce(sm.queue_id, '') || '|' || coalesce(sm.queue_name, '')) = ANY($1::text[]))
      AND ($2::text IS NULL OR sm.map_name = $2::text)
      AND ($3::text IS NULL OR v.agent_name = $3::text)
      AND ($4::text[] IS NULL OR sm.season_short = ANY($4::text[]))
      AND ($5::text[] IS NULL OR (v.member_id || '|' || sm.public_id::text) = ANY($5::text[]))
  )`;

const dimensionColumns = (extra: string) => `
  CASE WHEN GROUPING(map_name) = 0 THEN 'map' WHEN GROUPING(agent) = 0 THEN 'agent' WHEN GROUPING(season) = 0 THEN 'act'
       WHEN GROUPING(account_id) = 0 THEN 'account' ELSE 'total' END AS dim,
  CASE WHEN GROUPING(map_name) = 0 THEN map_name WHEN GROUPING(agent) = 0 THEN agent WHEN GROUPING(season) = 0 THEN season
       WHEN GROUPING(account_id) = 0 THEN account_id ELSE '' END AS dim_value${extra}`;
const groupingSets = (key: string) => `GROUPING SETS ((member_id${key}), (member_id${key}, map_name), (member_id${key}, agent), (member_id${key}, season), (member_id${key}, account_id))`;

const roundRows = `${participations},
  rr AS (
    SELECT p.member_id, p.account_id, p.source_match_id, p.map_name, p.agent, p.season, p.started_at,
           (r.winning_team IS NOT NULL AND r.winning_team = p.team_key) AS won,
           (r.winning_team IS NOT NULL AND r.winning_team <> p.team_key) AS lost,
           rp.weapon_evidence_status, rp.loadout_evidence_status, rp.loadout_value, rp.stats_evidence_status, rp.score,
           rp.weapon_name, ${weaponKey('rp.weapon_id', 'rp.weapon_name')} AS wkey
    FROM p
    JOIN rounds r ON r.source_match_id = p.source_match_id
    JOIN round_participants rp ON rp.round_id = r.id AND rp.match_participant_id = p.participant_id AND rp.present IS TRUE
  )`;

/**
 * One statement for both round domains so the eligible round rows (rr) are built once (a CTE referenced
 * twice is materialized): `kind='coverage'` rows are per member/dimension denominators, `kind='usage'`
 * rows are per member/dimension/observed weapon.
 */
export const weaponRoundSql = `${roundRows}
  SELECT 'coverage' AS kind, member_id, ${dimensionColumns(', NULL::text AS wkey, NULL::text AS weapon_name')},
         count(*)::int AS played_rounds,
         count(*) FILTER (WHERE weapon_evidence_status = 'observed' AND wkey IS NOT NULL)::int AS weapon_observed_rounds,
         count(*) FILTER (WHERE loadout_evidence_status = 'observed' AND loadout_value IS NOT NULL)::int AS loadout_observed_rounds,
         count(DISTINCT source_match_id)::int AS matches, min(started_at) AS first_at, max(started_at) AS last_at,
         NULL::int AS rounds, NULL::int AS wins, NULL::int AS losses, NULL::bigint AS score_sum, NULL::int AS score_rounds,
         NULL::bigint AS loadout_sum, NULL::int AS loadout_rounds
  FROM rr GROUP BY ${groupingSets('')}
  UNION ALL
  SELECT 'usage' AS kind, member_id, ${dimensionColumns(', wkey, min(weapon_name COLLATE "C") AS weapon_name')},
         NULL::int, NULL::int, NULL::int,
         count(DISTINCT source_match_id)::int AS matches, NULL::timestamptz, NULL::timestamptz,
         count(*)::int AS rounds, count(*) FILTER (WHERE won)::int AS wins, count(*) FILTER (WHERE lost)::int AS losses,
         coalesce(sum(score) FILTER (WHERE stats_evidence_status = 'observed' AND score IS NOT NULL), 0)::bigint AS score_sum,
         count(*) FILTER (WHERE stats_evidence_status = 'observed' AND score IS NOT NULL)::int AS score_rounds,
         coalesce(sum(loadout_value) FILTER (WHERE loadout_evidence_status = 'observed' AND loadout_value IS NOT NULL), 0)::bigint AS loadout_sum,
         count(*) FILTER (WHERE loadout_evidence_status = 'observed' AND loadout_value IS NOT NULL)::int AS loadout_rounds
  FROM rr WHERE weapon_evidence_status = 'observed' AND wkey IS NOT NULL
  GROUP BY ${groupingSets(', wkey')}`;

/** Kill weapon: only the killer's own events; never the victim's weapon, never the round snapshot. */
export const weaponKillSql = `${participations},
  kk AS (
    SELECT p.member_id, p.account_id, p.source_match_id, p.map_name, p.agent, p.season,
           ke.weapon_name, ${weaponKey('ke.weapon_id', 'ke.weapon_name')} AS wkey
    FROM p JOIN kill_events ke ON ke.source_match_id = p.source_match_id AND ke.killer_participant_id = p.participant_id
  )
  SELECT member_id, ${dimensionColumns(', wkey, min(weapon_name COLLATE "C") FILTER (WHERE wkey IS NOT NULL) AS weapon_name')},
         count(*)::int AS kills, count(DISTINCT source_match_id)::int AS matches
  FROM kk GROUP BY ${groupingSets(', wkey')}`;

type Dim = { member_id: string; dim: WeaponDimension; dim_value: string };
const num = (value: unknown) => Number(value ?? 0);
const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : undefined);
const fromKey = (wkey: string | null) => (wkey?.startsWith('id:') ? wkey.slice(3) : null);

export class WeaponAnalyticsService {
  constructor(private readonly database: SqlDatabase, private readonly analysis: Pick<ServerAnalysisService, 'analyze'>) {}

  async analyze(request: WeaponRequest) {
    const started = performance.now();
    let sqlQueryCount = 0;
    const query = <Row extends Record<string, unknown>>(sql: string, params: unknown[] = []) => { sqlQueryCount += 1; return this.database.query<Row>(sql, params); };
    const reasons: string[] = [];
    const [values, visible, current] = await Promise.all([
      query<{ queue_id: string | null; queue_name: string | null; season_short: string | null }>('SELECT DISTINCT queue_id, queue_name, season_short FROM source_matches'),
      query<{ member_id: string }>(`SELECT DISTINCT member_public_id::text AS member_id FROM (${activePlayers}) a ORDER BY 1`),
      request.scope === 'current'
        ? this.analysis.analyze({ feature: 'currentStrength', map: request.map, agent: request.agent, mode: request.mode, role: 'all', player: 'all', form: false })
        : Promise.resolve(undefined),
    ]);
    const queueKeys = request.mode === 'all' ? null : [...new Set(values.rows.filter((row) => normalizeGameMode(row.queue_id, row.queue_name) === request.mode)
      .map((row) => `${row.queue_id ?? ''}|${row.queue_name ?? ''}`))];
    const seasons = request.scope === 'act' ? [...new Set(values.rows.map((row) => row.season_short).filter((raw): raw is string => normalizeSeasonKey(raw) === request.act))] : null;
    if (seasons && seasons.length === 0) reasons.push('act_not_observed');
    let pairs: string[] | null = null;
    let scopeStatus: EvidenceState | undefined;
    if (current) {
      const selection = current.selection;
      pairs = Object.entries(selection).flatMap(([memberId, matchIds]) => matchIds.map((matchId) => `${memberId}|${matchId}`));
      const scope = current.payload.scope;
      if (scope) { scopeStatus = scope.status; reasons.push(...scope.reasons); }
      reasons.push('current_strength_adaptive_window');
    }
    const params = [queueKeys, request.map === 'all' ? null : request.map, request.agent === 'all' ? null : request.agent, seasons, pairs];
    const [roundResult, kills] = await Promise.all([
      query<Dim & { kind: 'coverage' | 'usage'; wkey: string | null; weapon_name: string | null; played_rounds: number; weapon_observed_rounds: number; loadout_observed_rounds: number;
        matches: number; first_at: unknown; last_at: unknown; rounds: number; wins: number; losses: number; score_sum: unknown; score_rounds: number; loadout_sum: unknown; loadout_rounds: number }>(weaponRoundSql, params),
      query<Dim & { wkey: string | null; weapon_name: string | null; kills: number; matches: number }>(weaponKillSql, params),
    ]);
    const coverage = { rows: roundResult.rows.filter((row) => row.kind === 'coverage') };
    const usage = { rows: roundResult.rows.filter((row) => row.kind === 'usage') };
    const aggregates: WeaponAggregates = {
      rounds: coverage.rows.map((row): RoundAggRow => ({ memberId: row.member_id, dim: row.dim, dimValue: row.dim_value, playedRounds: num(row.played_rounds),
        weaponObservedRounds: num(row.weapon_observed_rounds), loadoutObservedRounds: num(row.loadout_observed_rounds), matches: num(row.matches),
        ...(iso(row.first_at) ? { firstAt: iso(row.first_at) } : {}), ...(iso(row.last_at) ? { lastAt: iso(row.last_at) } : {}) })),
      weaponRounds: usage.rows.map((row): WeaponRoundAggRow => ({ memberId: row.member_id, dim: row.dim, dimValue: row.dim_value, weaponId: fromKey(row.wkey), weaponName: row.weapon_name,
        rounds: num(row.rounds), matches: num(row.matches), wins: num(row.wins), losses: num(row.losses), scoreSum: num(row.score_sum), scoreRounds: num(row.score_rounds),
        loadoutSum: num(row.loadout_sum), loadoutRounds: num(row.loadout_rounds) })),
      kills: kills.rows.map((row): KillAggRow => ({ memberId: row.member_id, dim: row.dim, dimValue: row.dim_value, weaponId: fromKey(row.wkey), weaponName: row.wkey ? row.weapon_name : null,
        kills: num(row.kills), matches: num(row.matches) })),
    };
    const memberIds = visible.rows.map((row) => row.member_id);
    const memberVisible = request.player === 'all' || memberIds.includes(request.player);
    if (!memberVisible) reasons.push('member_not_visible');
    const anyRounds = aggregates.rounds.some((row) => row.dim === 'total' && row.playedRounds > 0);
    const status: EvidenceState = !memberVisible || !anyRounds ? 'unavailable' : scopeStatus === 'partial' ? 'partial' : 'available';
    const result = buildWeaponAnalytics(aggregates, {
      memberIds, ...(request.player !== 'all' && memberVisible ? { memberId: request.player } : {}),
      scope: { mode: request.scope, status, reasons: [...new Set(reasons)].sort(), ...(request.act ? { act: request.act } : {}), context: { map: request.map, agent: request.agent, mode: request.mode } },
    });
    const payload = { ok: true as const, schemaVersion: datasetSchemaVersion, view: 'analysis' as const, feature: 'weaponAnalytics' as const, ...result };
    return { payload, metrics: { sqlQueryCount, totalMs: Math.round(performance.now() - started), currentAnalysis: Boolean(current) } };
  }
}
