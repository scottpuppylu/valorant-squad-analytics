import type { SqlExecutor } from '../db/types.js';

/**
 * Identifier-free coverage + integrity report over the private staging store. Output contains only counts,
 * dates and PUBLIC community names (never Riot IDs, provider ids or match ids). `lifetimeComplete` is always
 * false: provider-visible exhaustion never proves lifetime history.
 */
export interface MemberCoverage { communityName: string; discovered: number; competitive: number; earliest: string | null; latest: string | null }
export interface CoverageReport {
  schemaVersion: string;
  uniqueDiscovered: number;
  uniqueHydrated: number;
  unavailable: number;
  hydrationFailed: number;
  pending: number;
  discoveredLinks: number;
  duplicateDiscoveries: number;
  earliest: string | null;
  latest: string | null;
  lifetimeComplete: false;
  members: MemberCoverage[];
  competitiveByYear: Record<string, Record<string, number>>;
  cursors: { source: string; termination: string | null; exhausted: boolean; accounts: number }[];
  requests: Record<string, number>;
  outcomes: Record<string, number>;
  maxRequestsInAnyRollingMinute: number;
  integrity: Record<string, number>;
}

const COMPETITIVE = `lower(coalesce(m.mode,'')) = 'competitive'`;
const num = (value: unknown) => Number(value ?? 0);
const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

export async function buildCoverageReport(database: SqlExecutor): Promise<CoverageReport> {
  const totals = (await database.query<Record<string, unknown>>(`SELECT
      (SELECT value FROM rebuild_staging.meta WHERE key='schema_version') AS schema_version,
      (SELECT count(*) FROM rebuild_staging.matches) AS unique_discovered,
      (SELECT count(*) FROM rebuild_staging.matches WHERE hydration_status='hydrated') AS hydrated,
      (SELECT count(*) FROM rebuild_staging.matches WHERE hydration_status='unavailable') AS unavailable,
      (SELECT count(*) FROM rebuild_staging.matches WHERE hydration_status='failed') AS failed,
      (SELECT count(*) FROM rebuild_staging.matches WHERE hydration_status='pending') AS pending,
      (SELECT count(*) FROM rebuild_staging.account_matches) AS links,
      (SELECT min(started_at) FROM rebuild_staging.matches) AS earliest,
      (SELECT max(started_at) FROM rebuild_staging.matches) AS latest`)).rows[0]!;
  const members = (await database.query<Record<string, unknown>>(`
    SELECT a.community_name, count(*) AS discovered, count(*) FILTER (WHERE ${COMPETITIVE}) AS competitive,
           min(m.started_at) AS earliest, max(m.started_at) AS latest
    FROM rebuild_staging.accounts a
    LEFT JOIN rebuild_staging.account_matches am ON am.account_public_id=a.account_public_id
    LEFT JOIN rebuild_staging.matches m ON m.provider_match_id=am.provider_match_id
    GROUP BY a.community_name ORDER BY a.community_name`)).rows;
  const years = (await database.query<{ community_name: string; year: string; matches: string }>(`
    SELECT a.community_name, coalesce(extract(year FROM m.started_at AT TIME ZONE 'UTC')::int::text, 'unknown') AS year, count(*) AS matches
    FROM rebuild_staging.account_matches am
    JOIN rebuild_staging.accounts a ON a.account_public_id=am.account_public_id
    JOIN rebuild_staging.matches m ON m.provider_match_id=am.provider_match_id
    WHERE ${COMPETITIVE} GROUP BY 1, 2 ORDER BY 1, 2`)).rows;
  const competitiveByYear: CoverageReport['competitiveByYear'] = {};
  for (const row of years) (competitiveByYear[row.community_name] ??= {})[row.year] = num(row.matches);
  const cursors = (await database.query<Record<string, unknown>>(`
    SELECT source, termination, exhausted, count(*) AS accounts FROM rebuild_staging.cursors GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`)).rows;
  const requests = Object.fromEntries((await database.query<{ category: string; n: string }>(
    `SELECT category, count(*) AS n FROM rebuild_staging.provider_requests GROUP BY 1 ORDER BY 1`)).rows.map((row) => [row.category, num(row.n)]));
  const outcomes = Object.fromEntries((await database.query<{ outcome: string; n: string }>(
    `SELECT outcome, count(*) AS n FROM rebuild_staging.provider_requests GROUP BY 1 ORDER BY 1`)).rows.map((row) => [row.outcome, num(row.n)]));
  // Exact rolling-60 s maximum over the persisted request start log (request-finish rows; conservative upper view).
  const rolling = (await database.query<{ max: string | null }>(`
    SELECT max(n) AS max FROM (SELECT (SELECT count(*) FROM rebuild_staging.provider_requests b
      WHERE b.at > a.at - interval '60 seconds' AND b.at <= a.at) AS n FROM rebuild_staging.provider_requests a) t`)).rows[0];
  const integrity = (await database.query<Record<string, unknown>>(`SELECT
      (SELECT count(*) - count(DISTINCT provider_match_id) FROM rebuild_staging.matches) AS duplicate_matches,
      (SELECT count(*) - count(DISTINCT provider_match_id) FROM rebuild_staging.match_payloads) AS duplicate_payloads,
      (SELECT count(*) FROM rebuild_staging.account_matches am WHERE NOT EXISTS (SELECT 1 FROM rebuild_staging.matches m WHERE m.provider_match_id=am.provider_match_id)
         OR NOT EXISTS (SELECT 1 FROM rebuild_staging.accounts a WHERE a.account_public_id=am.account_public_id)) AS orphan_links,
      (SELECT count(*) FROM rebuild_staging.matches m WHERE NOT EXISTS (SELECT 1 FROM rebuild_staging.account_matches am WHERE am.provider_match_id=m.provider_match_id)) AS unlinked_matches,
      (SELECT count(*) FROM rebuild_staging.matches WHERE hydration_status='hydrated' AND NOT EXISTS (SELECT 1 FROM rebuild_staging.match_payloads p WHERE p.provider_match_id=matches.provider_match_id)) AS hydrated_without_payload,
      (SELECT count(*) FROM rebuild_staging.match_payloads p WHERE p.payload->'metadata'->>'match_id' IS DISTINCT FROM p.provider_match_id) AS malformed_payloads,
      (SELECT count(*) FROM rebuild_staging.matches WHERE started_at IS NULL) AS missing_timestamps,
      (SELECT count(*) FROM rebuild_staging.matches WHERE started_at > now() + interval '1 day' OR started_at < timestamptz '2020-04-01') AS implausible_timestamps,
      (SELECT count(*) FROM rebuild_staging.account_matches am JOIN rebuild_staging.accounts a ON a.account_public_id=am.account_public_id
         JOIN rebuild_staging.match_payloads p ON p.provider_match_id=am.provider_match_id
         WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.payload->'players')='array' THEN p.payload->'players' ELSE '[]'::jsonb END) pl
           WHERE pl->>'puuid' = a.provider_puuid)) AS account_identity_mismatches,
      (SELECT count(*) FROM rebuild_staging.matches WHERE hydration_status='failed') AS hydration_failures,
      (SELECT count(*) FROM rebuild_staging.accounts WHERE affinity IS NULL OR provider_puuid IS NULL) AS unresolved_accounts`)).rows[0]!;
  const linksTotal = num(totals.links);
  return {
    schemaVersion: String(totals.schema_version ?? ''),
    uniqueDiscovered: num(totals.unique_discovered), uniqueHydrated: num(totals.hydrated), unavailable: num(totals.unavailable),
    hydrationFailed: num(totals.failed), pending: num(totals.pending), discoveredLinks: linksTotal,
    duplicateDiscoveries: linksTotal - num(totals.unique_discovered),
    earliest: iso(totals.earliest), latest: iso(totals.latest), lifetimeComplete: false,
    members: members.map((row) => ({ communityName: String(row.community_name), discovered: row.earliest ? num(row.discovered) : 0,
      competitive: num(row.competitive), earliest: iso(row.earliest), latest: iso(row.latest) })),
    competitiveByYear,
    cursors: cursors.map((row) => ({ source: String(row.source), termination: (row.termination as string | null) ?? null, exhausted: row.exhausted === true, accounts: num(row.accounts) })),
    requests, outcomes, maxRequestsInAnyRollingMinute: num(rolling?.max),
    integrity: Object.fromEntries(Object.entries(integrity).map(([key, value]) => [key, num(value)])),
  };
}
