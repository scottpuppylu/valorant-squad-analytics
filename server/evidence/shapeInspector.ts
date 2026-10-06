/**
 * TASK-DATA-PERFORMANCE-SCORE-01 sanitized provider SHAPE inspector (`provider-shape-inspector-v1`).
 *
 * Discovers unknown field PATHS in provider payloads without retaining VALUES:
 *  - output = path, JSON type counts, present / absent / null counts;
 *  - array indices collapse to `[]`; object keys that are not plain identifiers (ids, names, tags,
 *    hashes, anything with spaces/#/@ or digits-first) collapse to `{key}` so dynamic keys never leak;
 *  - numeric aggregates (count/min/max) ONLY for candidate paths whose leaf name matches the
 *    candidate tokens, aggregated across every payload with no player/match association;
 *  - strings, booleans and objects are never echoed.
 * Pure function; used by the non-production provider audit mode and by tests.
 */
export const PROVIDER_SHAPE_INSPECTOR_VERSION = 'provider-shape-inspector-v1' as const;

export const performanceScoreCandidateTokens = /score|performance|combat|rating|contribution|mvp|acs/iu;

export interface ShapeObservation {
  path: string;
  /** JSON type -> occurrences ('number' | 'string' | 'boolean' | 'object' | 'array' | 'null'). */
  types: Record<string, number>;
  /** Parent objects containing this key / lacking it (for `[]`-collapsed paths, per element). */
  present: number;
  absent: number;
  nullCount: number;
  candidate: boolean;
  /** Candidate numeric leaves only: aggregate, unassociated. */
  numeric?: { count: number; min: number; max: number; integers: boolean };
}

export interface ShapeInspection {
  inspectorVersion: typeof PROVIDER_SHAPE_INSPECTOR_VERSION;
  payloads: number;
  paths: ShapeObservation[];
  candidates: ShapeObservation[];
  truncated: boolean;
}

const plainKey = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
const idLike = /^[0-9a-f]{8}-[0-9a-f]{4}-|^[0-9a-f]{24,}$/iu;

function safeKey(key: string): string {
  return plainKey.test(key) && !idLike.test(key) ? key : '{key}';
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Numeric aggregates need at least this many values so no single observation can be singled out. */
export const minimumNumericSample = 3;

export function inspectShape(payloads: unknown[], options: { candidateTokens?: RegExp; maxPaths?: number; maxDepth?: number } = {}): ShapeInspection {
  const tokens = options.candidateTokens ?? performanceScoreCandidateTokens;
  const maxPaths = options.maxPaths ?? 2000;
  const maxDepth = options.maxDepth ?? 12;
  const stats = new Map<string, { types: Record<string, number>; present: number; nullCount: number; leaf: string; numbers: number[] }>();
  /** path of an object -> number of object instances seen (for absent counts). */
  const objectInstances = new Map<string, number>();
  /** object path -> set of child keys ever seen. */
  const childKeys = new Map<string, Set<string>>();
  let truncated = false;

  const visit = (value: unknown, path: string, depth: number) => {
    if (depth > maxDepth) { truncated = true; return; }
    if (Array.isArray(value)) { for (const item of value) visit(item, `${path}[]`, depth + 1); return; }
    if (value === null || typeof value !== 'object') return;
    objectInstances.set(path, (objectInstances.get(path) ?? 0) + 1);
    const keys = childKeys.get(path) ?? new Set<string>();
    childKeys.set(path, keys);
    for (const [rawKey, child] of Object.entries(value as Record<string, unknown>)) {
      const key = safeKey(rawKey);
      const childPath = path ? `${path}.${key}` : key;
      if (!stats.has(childPath)) {
        if (stats.size >= maxPaths) { truncated = true; continue; }
        stats.set(childPath, { types: {}, present: 0, nullCount: 0, leaf: key, numbers: [] });
      }
      keys.add(key);
      const entry = stats.get(childPath)!;
      const type = typeOf(child);
      entry.types[type] = (entry.types[type] ?? 0) + 1;
      entry.present += 1;
      if (type === 'null') entry.nullCount += 1;
      if (type === 'number' && key !== '{key}' && tokens.test(key)) entry.numbers.push(child as number);
      visit(child, childPath, depth + 1);
    }
  };
  for (const payload of payloads) visit(payload, '', 0);

  const parentOf = (path: string) => { const index = path.lastIndexOf('.'); return index < 0 ? '' : path.slice(0, index); };
  const paths = [...stats].map(([path, entry]): ShapeObservation => {
    const parents = objectInstances.get(parentOf(path)) ?? entry.present;
    const candidate = entry.leaf !== '{key}' && tokens.test(entry.leaf);
    const finite = entry.numbers.filter(Number.isFinite);
    return {
      path, types: entry.types, present: entry.present, absent: Math.max(0, parents - entry.present), nullCount: entry.nullCount, candidate,
      ...(candidate && finite.length >= minimumNumericSample ? { numeric: { count: finite.length, min: Math.min(...finite), max: Math.max(...finite), integers: finite.every(Number.isInteger) } } : {}),
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
  return { inspectorVersion: PROVIDER_SHAPE_INSPECTOR_VERSION, payloads: payloads.length, paths, candidates: paths.filter((item) => item.candidate), truncated };
}
