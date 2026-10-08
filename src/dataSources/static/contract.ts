import type { AnalysisQuery } from '../server/analysisResult.js';

/** Structural twin of analytics/weapons/local WeaponQuery (kept here so server code can import this module). */
export interface StaticWeaponQuery { player: string; scope: 'all' | 'current' | 'act'; act?: string; map: string; agent: string; mode: string }

/**
 * TASK-INFRA-STATIC-DATA-PUBLISH-01 static public read model (`static-snapshot-v1`).
 *
 * PostgreSQL stays the source of truth. A snapshot is a DERIVED, immutable, versioned set of the exact public
 * API payloads (same server services), addressed by canonical request keys:
 *
 *   <root>/manifest.json                     the ONLY mutable file; points at one snapshot; written LAST
 *   <root>/versions/<snapshotId>/index.json  catalog: request key → file (fetched once per snapshot)
 *   <root>/versions/<snapshotId>/…           dataset.json, analytics.json, history/, analysis/, weapons/
 *
 * The browser reads the manifest (revalidated), then only files of THAT snapshot; it never mixes versions,
 * never writes, and never calls a provider API.
 */
export const STATIC_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const STATIC_SNAPSHOT_VERSION = 'static-snapshot-v1' as const;
export const STATIC_CATALOG_VERSION = 'static-catalog-v1' as const;
/** Same page size as the Matches page (useTrackedHistory.historyPageSize). */
export const STATIC_HISTORY_PAGE_SIZE = 50 as const;

const snapshotIdPattern = /^s-[0-9a-f]{20}$/u;
const filePattern = /^(analysis|weapons)\/[aw]\d{5}\.json$/u;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export interface StaticManifest {
  schemaVersion: typeof STATIC_SNAPSHOT_SCHEMA_VERSION;
  snapshotVersion: typeof STATIC_SNAPSHOT_VERSION;
  snapshotId: string;
  /** The dataset projection version of the snapshot (changes only when durable data changes). */
  dataVersion: string;
  /** Publication time of this manifest; NOT part of the deterministic snapshot content. */
  generatedAt: string;
}

export interface StaticSnapshotIndex {
  schemaVersion: typeof STATIC_SNAPSHOT_SCHEMA_VERSION;
  snapshotVersion: typeof STATIC_SNAPSHOT_VERSION;
  catalogVersion: typeof STATIC_CATALOG_VERSION;
  snapshotId: string;
  dataVersion: string;
  /** Precomputed catalog tier (see server/staticExport/catalog.ts). */
  tier: 'facts' | 'common' | 'core' | 'extended';
  /** public-facts-v1 directory (TASK-INFRA-STATIC-QUERY-PARITY-01): any request outside the catalog runs on these. */
  facts?: 'facts/meta.json';
  files: { dataset: 'dataset.json'; analytics: 'analytics.json' };
  history: { pageSize: typeof STATIC_HISTORY_PAGE_SIZE; pages: number; before: string | null };
  /** Canonical analysis request key → file. A key that is absent was NOT precomputed. */
  analysis: Record<string, string>;
  weapons: Record<string, string>;
}

/** Exactly the query string ValorantBackendClient sends for `view=analysis` (shared, so keys cannot drift). */
export function analysisSearchParams(query: AnalysisQuery): URLSearchParams {
  const params = new URLSearchParams({ view: 'analysis', feature: query.feature });
  for (const key of ['act', 'from', 'to', 'map', 'agent', 'role', 'mode', 'player'] as const) {
    const value = query[key];
    if (value && value !== 'all') params.set(key, value);
  }
  if (query.recent) params.set('recent', String(query.recent));
  if (query.form) params.set('form', '1');
  return params;
}

/** Exactly the query string ValorantBackendClient sends for weapon analytics. */
export function weaponSearchParams(query: StaticWeaponQuery): URLSearchParams {
  const params = new URLSearchParams({ view: 'analysis', feature: 'weaponAnalytics', scope: query.scope, mode: query.mode });
  if (query.player !== 'all') params.set('player', query.player);
  if (query.act) params.set('act', query.act);
  if (query.map !== 'all') params.set('map', query.map);
  if (query.agent !== 'all') params.set('agent', query.agent);
  return params;
}

const sortedKey = (params: URLSearchParams) => [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');

/**
 * Canonical static key of an analysis request. `form` is dropped: scope features are exported WITH the
 * recent-form windows, a strict superset (same summary/scope/coverage, extra windows); synergy and
 * improvementIndex never take `form`.
 */
export function staticAnalysisKey(query: AnalysisQuery): string {
  const params = analysisSearchParams(query);
  params.delete('form');
  return sortedKey(params);
}

export function staticWeaponKey(query: StaticWeaponQuery): string {
  return sortedKey(weaponSearchParams(query));
}

/** Opaque static history page token (replaces the server's HMAC-signed position cursor). */
export const staticHistoryToken = (page: number) => `page:${String(page).padStart(4, '0')}`;
export function parseStaticHistoryToken(token: string): number | undefined {
  const match = /^page:(\d{4})$/u.exec(token);
  return match ? Number(match[1]) : undefined;
}
export const staticHistoryFile = (page: number) => `history/page-${String(page).padStart(4, '0')}.json`;

export const staticVersionPath = (snapshotId: string) => `versions/${snapshotId}/`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const fileMap = (value: unknown) => isRecord(value) && Object.entries(value).every(([key, file]) => key.length > 0 && key.length <= 400 && typeof file === 'string' && filePattern.test(file));

export function isStaticManifest(value: unknown): value is StaticManifest {
  if (!isRecord(value)) return false;
  return value.schemaVersion === STATIC_SNAPSHOT_SCHEMA_VERSION && value.snapshotVersion === STATIC_SNAPSHOT_VERSION
    && typeof value.snapshotId === 'string' && snapshotIdPattern.test(value.snapshotId)
    && typeof value.dataVersion === 'string' && value.dataVersion.length > 0 && value.dataVersion.length <= 128
    && typeof value.generatedAt === 'string' && isoPattern.test(value.generatedAt)
    && Object.keys(value).length === 5;
}

export function isStaticSnapshotIndex(value: unknown): value is StaticSnapshotIndex {
  if (!isRecord(value)) return false;
  const history = value.history;
  return value.schemaVersion === STATIC_SNAPSHOT_SCHEMA_VERSION && value.snapshotVersion === STATIC_SNAPSHOT_VERSION
    && value.catalogVersion === STATIC_CATALOG_VERSION && ['facts', 'common', 'core', 'extended'].includes(value.tier as string)
    && (value.facts === undefined || value.facts === 'facts/meta.json') && (value.tier === 'core' || value.tier === 'extended' || value.facts === 'facts/meta.json')
    && typeof value.snapshotId === 'string' && snapshotIdPattern.test(value.snapshotId)
    && typeof value.dataVersion === 'string' && value.dataVersion.length > 0
    && isRecord(value.files) && value.files.dataset === 'dataset.json' && value.files.analytics === 'analytics.json'
    && isRecord(history) && history.pageSize === STATIC_HISTORY_PAGE_SIZE && Number.isSafeInteger(history.pages) && (history.pages as number) >= 0
    && (history.before === null || typeof history.before === 'string')
    && fileMap(value.analysis) && fileMap(value.weapons);
}
