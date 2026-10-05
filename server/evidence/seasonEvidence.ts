/**
 * TASK-DATA-SEASON-01 — provider season evidence.
 *
 * Henrik OpenAPI 4.6.0 declares `metadata.season` (v4 matches) and `meta.season` (Stored Matches)
 * as required `SeasonIdShortCombo { id: string; short: string }`. Season is optional to product
 * correctness, so a malformed season NEVER rejects otherwise-valid match evidence: each field is
 * validated independently and an invalid field is simply absent (never guessed, never derived
 * from the other field). `season_id` stays server-side; only a public key normalized from
 * `season_short` (src/analytics/scope/season.ts) may reach the browser.
 */
export interface SeasonEvidence {
  seasonId?: string;
  seasonShort?: string;
}

/** Riot/Henrik season ids are UUIDs. Stored lowercase; never exposed publicly. */
const seasonIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** Safe opaque provider code (e.g. "e9a3"); public Act keys are derived later, only from recognized formats. */
const seasonShortPattern = /^[a-z0-9][a-z0-9:_-]{0,15}$/u;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function normalizeSeasonEvidence(season: unknown): SeasonEvidence {
  if (!isRecord(season)) return {};
  const id = typeof season.id === 'string' ? season.id.trim().toLowerCase() : undefined;
  const short = typeof season.short === 'string' ? season.short.trim().toLowerCase() : undefined;
  return {
    ...(id && seasonIdPattern.test(id) ? { seasonId: id } : {}),
    ...(short && seasonShortPattern.test(short) ? { seasonShort: short } : {}),
  };
}
