import { normalizeTier } from '../../src/analytics/rank/tiers.js';
import type { RankEvidence } from '../../src/analytics/rank/rankContext.js';

/**
 * TASK-DATA-RANK-01 — Henrik rank payload parsers (provider-specific; below the rank-context-v1 boundary).
 * Only DOCUMENTED fields are read (docs.henrikdev.xyz, v3 mmr / v2 stored-mmr-history / v4 match players[].tier).
 * Missing or malformed fields stay null — nothing is invented. `elo` is the provider's undocumented numeric field and
 * is carried as `providerElo` (never "Riot MMR"). Documented extras that are not part of RankEvidence go to `extra`.
 */
export const HENRIK_RANK_PARSER_VERSION = 'henrik-rank-parser-v1' as const;

export class RankPayloadError extends Error { constructor(where: string) { super(`malformed provider rank payload (${where}).`); this.name = 'RankPayloadError'; } }

type Rec = Record<string, unknown>;
const record = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);
const int = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) ? value : null);
const str = (value: unknown, max = 64) => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : null);
const iso = (value: unknown) => { const t = typeof value === 'string' ? Date.parse(value) : Number.NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null; };

export interface ParsedRankEvidence extends RankEvidence { extra: Record<string, number | string | boolean | null> }

interface Base { accountId: string; observedAt: string; ingestedAt: string; source: string }

function tierOf(value: unknown, currentSchema: boolean | undefined) {
  const tier = record(value) ? value : {};
  const providerTierId = int(tier.id);
  const providerTierName = str(tier.name);
  return { providerTierId, providerTierName, normalized: normalizeTier({ name: providerTierName, id: providerTierId, ...(currentSchema === undefined ? {} : { currentSchema }) }) };
}
function season(value: unknown) {
  const s = record(value) ? value : {};
  return { seasonId: str(s.id, 64), seasonShort: str(s.short, 16) };
}
function evidence(base: Base, fields: Partial<ParsedRankEvidence> & Pick<ParsedRankEvidence, 'kind' | 'effectiveAt'>): ParsedRankEvidence {
  return {
    accountId: base.accountId, source: base.source, ingestedAt: base.ingestedAt,
    seasonId: null, seasonShort: null, providerTierId: null, providerTierName: null, rr: null, providerElo: null,
    rrChange: null, matchRef: null, queue: null, normalized: null, extra: {}, ...fields,
  };
}
/** The modern (Ascendant-era) id table applies only when the provider says so; otherwise tiers normalize by name. */
const schemaIsCurrent = (schema: unknown) => (typeof schema === 'string' ? /ascendant/iu.test(schema) : undefined);

/** `GET /valorant/v3/mmr/{affinity}/{platform}/{name}/{tag}` → current + peak + seasonal evidence. */
export function parseMmrV3(payload: unknown, base: Omit<Base, 'source'>): ParsedRankEvidence[] {
  if (!record(payload) || !record(payload.data)) throw new RankPayloadError('v3 mmr data');
  const data = payload.data;
  const source = 'henrik:v3/mmr';
  const out: ParsedRankEvidence[] = [];
  const b: Base = { ...base, source };
  if (record(data.current)) {
    const current = data.current;
    out.push(evidence(b, {
      kind: 'current', effectiveAt: base.observedAt, ...tierOf(current.tier, undefined),
      rr: int(current.rr), providerElo: int(current.elo), rrChange: int(current.last_change),
      extra: { gamesNeededForRating: int(current.games_needed_for_rating), rankProtectionShields: int(current.rank_protection_shields),
        leaderboardRank: record(current.leaderboard_placement) ? int(current.leaderboard_placement.rank) : null },
    }));
  }
  if (record(data.peak) && record(data.peak.tier)) {
    const peak = data.peak;
    out.push(evidence(b, {
      kind: 'peak', effectiveAt: base.observedAt, ...tierOf(peak.tier, schemaIsCurrent(peak.ranking_schema)), ...season(peak.season),
      rr: int(peak.rr), extra: { rankingSchema: str(peak.ranking_schema, 32) },
    }));
  }
  if (data.seasonal !== undefined && data.seasonal !== null) {
    if (!Array.isArray(data.seasonal)) throw new RankPayloadError('v3 mmr seasonal');
    for (const row of data.seasonal) {
      if (!record(row)) throw new RankPayloadError('v3 mmr seasonal row');
      const s = season(row.season);
      if (!s.seasonId && !s.seasonShort) throw new RankPayloadError('v3 mmr seasonal season');
      out.push(evidence(b, {
        kind: 'seasonal', effectiveAt: base.observedAt, ...tierOf(row.end_tier, schemaIsCurrent(row.ranking_schema)), ...s,
        rr: int(row.end_rr),
        extra: { games: int(row.games), wins: int(row.wins), rankingSchema: str(row.ranking_schema, 32),
          actWins: Array.isArray(row.act_wins) ? row.act_wins.length : null },
      }));
    }
  }
  return out;
}

/** `GET /valorant/v2/stored-mmr-history/{affinity}/{platform}/{name}/{tag}` → per-match POST-match history rows. */
export function parseStoredMmrHistory(payload: unknown, base: Omit<Base, 'source'>, matchRefOf: (providerMatchId: string) => string):
  { rows: ParsedRankEvidence[]; total: number | null; returned: number | null; after: number | null } {
  if (!record(payload) || !Array.isArray(payload.data)) throw new RankPayloadError('stored mmr history data');
  const results = record(payload.results) ? payload.results : {};
  const b: Base = { ...base, source: 'henrik:v2/stored-mmr-history' };
  const rows = payload.data.map((row) => {
    if (!record(row)) throw new RankPayloadError('stored mmr history row');
    const effectiveAt = iso(row.date);
    if (!effectiveAt) throw new RankPayloadError('stored mmr history date');
    const matchId = str(row.match_id, 128);
    return evidence(b, {
      kind: 'history', effectiveAt, ...tierOf(row.tier, undefined), ...season(row.season),
      rr: int(row.rr), providerElo: int(row.elo), rrChange: int(row.last_change), matchRef: matchId ? matchRefOf(matchId) : null,
      queue: 'competitive',
      extra: { refundedRr: int(row.refunded_rr), wasDerankProtected: typeof row.was_derank_protected === 'boolean' ? row.was_derank_protected : null,
        mapName: record(row.map) ? str(row.map.name, 32) : null },
    });
  });
  return { rows, total: int(results.total), returned: int(results.returned), after: int(results.after) };
}

/** A v4 match document's `players[].tier` for ONE known provider account → match-time snapshot (no network). */
export function matchSnapshot(document: unknown, providerPuuid: string, base: Omit<Base, 'source' | 'observedAt'> & { matchRef: string }): ParsedRankEvidence | null {
  if (!record(document) || !record(document.metadata) || !Array.isArray(document.players)) throw new RankPayloadError('v4 match document');
  const startedAt = iso(document.metadata.started_at);
  const player = document.players.find((candidate) => record(candidate) && candidate.puuid === providerPuuid);
  if (!startedAt || !record(player) || !record(player.tier)) return null;
  const queue = record(document.metadata.queue) ? str(document.metadata.queue.id, 32) : null;
  return evidence({ ...base, observedAt: startedAt, source: 'henrik:v4/match players[].tier' }, {
    kind: 'match_snapshot', effectiveAt: startedAt, ...tierOf(player.tier, undefined), ...season(document.metadata.season),
    matchRef: base.matchRef, queue,
  });
}
