import type { SqlExecutor } from '../db/types.js';
import { PUBLIC_EXPORT_ALLOWLIST, type PublicArtifactKind } from './publicAllowlist.js';

/**
 * TASK-INFRA-STATIC-DATA-PUBLISH-01 PUBLIC EXPORT PRIVACY GATE (`public-export-gate-v1`).
 * Every artifact is public Internet data. A snapshot is finalized only when ALL layers pass:
 *  1. schema allowlist — every key path must be explicitly allowlisted per artifact kind (unknown = fail);
 *  2. forbidden-name semantics — no key may name a secret / identity / operational concept;
 *  3. content scan — no configured secret value, credentialed URL, provider key or long opaque token;
 *  4. database cross-check — no UUID / 64-hex token in the output may be an internal row id or an
 *     HMAC / credential value stored in PostgreSQL.
 */
export const PUBLIC_EXPORT_GATE_VERSION = 'public-export-gate-v1' as const;

export class PublicExportViolation extends Error {
  constructor(readonly artifact: string, readonly rule: string, readonly detail: string) {
    super(`public export gate (${rule}) rejected ${artifact}: ${detail}`);
    this.name = 'PublicExportViolation';
  }
}

interface TrieNode { children: Map<string, TrieNode> }
const trieCache = new Map<PublicArtifactKind, TrieNode>();

function trie(kind: PublicArtifactKind): TrieNode {
  const cached = trieCache.get(kind);
  if (cached) return cached;
  const root: TrieNode = { children: new Map() };
  for (const pattern of PUBLIC_EXPORT_ALLOWLIST[kind]) {
    let node = root;
    for (const segment of pattern.split('.')) {
      let next = node.children.get(segment);
      if (!next) { next = { children: new Map() }; node.children.set(segment, next); }
      node = next;
    }
  }
  trieCache.set(kind, root);
  return root;
}

/** Layer 1: every key path must be allowlisted (`[]` = array element, `*` = dynamic public key such as a map name). */
export function assertAllowlisted(kind: PublicArtifactKind, artifact: string, value: unknown) {
  const walk = (node: TrieNode, current: unknown, path: string) => {
    if (Array.isArray(current)) {
      const element = node.children.get('[]');
      if (!element) { if (current.length > 0) throw new PublicExportViolation(artifact, 'allowlist', `${path}[] is not allowlisted`); return; }
      for (const item of current) walk(element, item, `${path}[]`);
      return;
    }
    if (current !== null && typeof current === 'object') {
      for (const [key, child] of Object.entries(current)) {
        const next = node.children.get(key) ?? node.children.get('*');
        if (!next) throw new PublicExportViolation(artifact, 'allowlist', `${path ? `${path}.` : ''}${key} is not allowlisted`);
        walk(next, child, `${path ? `${path}.` : ''}${node.children.has(key) ? key : '*'}`);
      }
    }
  };
  walk(trie(kind), value, '');
}

/** Splits camelCase / snake_case / kebab-case into lower-case words. */
export function keyWords(key: string): string[] {
  return key.replace(/([a-z0-9])([A-Z])/gu, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2').split(/[^A-Za-z0-9]+/u)
    .filter(Boolean).map((word) => word.toLowerCase());
}

const forbiddenWords = new Set(['puuid', 'hmac', 'secret', 'password', 'passwd', 'token', 'cursor', 'lease', 'lock', 'credential', 'credentials',
  'locked', 'leased', 'auth', 'authorization', 'bearer', 'cookie', 'session', 'consent', 'consents', 'revocation', 'revoked', 'email', 'ip', 'fingerprint', 'internal']);
const forbiddenPhrases = [['api', 'key'], ['database', 'url'], ['connection', 'string'], ['private', 'key'], ['provider', 'id'], ['provider', 'identity'], ['lookup']];

/**
 * Explicit semantic exceptions (`kind:path` → value rule). The history page's `nextCursor` is a STATIC page
 * token (`page:0002`), never the server's signed position; the field name is required by the public contract.
 */
const semanticExceptions = new Map<string, (value: unknown) => boolean>([
  ['history:page.nextCursor', (value) => value === null || (typeof value === 'string' && /^page:\d{4}$/u.test(value))],
]);

/** Layer 2: no key may name a sensitive concept (word-based, so e.g. "block" or "lookout" do not match). */
export function assertNoForbiddenKeys(kind: PublicArtifactKind, artifact: string, value: unknown) {
  const walk = (current: unknown, path: string) => {
    if (Array.isArray(current)) { for (const item of current) walk(item, `${path}[]`); return; }
    if (current === null || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      const childPath = path ? `${path}.${key}` : key;
      const words = keyWords(key);
      const hit = words.find((word) => forbiddenWords.has(word))
        ?? forbiddenPhrases.find((phrase) => words.some((_, i) => phrase.every((part, j) => words[i + j] === part)))?.join(' ');
      if (hit) {
        const exception = semanticExceptions.get(`${kind}:${childPath.replace(/\[\]/gu, '')}`);
        if (!exception || !exception(child)) throw new PublicExportViolation(artifact, 'forbidden-field', `${childPath} names "${hit}"`);
      }
      walk(child, childPath);
    }
  };
  walk(value, '');
}

const contentPatterns: [string, RegExp][] = [
  ['credentialed-url', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/"@:]+:[^\s/"@]+@/iu],
  ['database-url', /\bpostgres(?:ql)?:\/\//iu],
  ['provider-key', /\bHDEV-[0-9a-f-]{8,}/iu],
  ['bearer', /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/u],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/u],
  // Riot PUUIDs are ~78-char URL-safe strings; no public value in this contract is a 70+ char opaque token.
  ['opaque-token', /[A-Za-z0-9_-]{70,}/u],
];

/** Layer 3: secret values and credential shapes in the serialized text. */
export function assertNoSensitiveContent(artifact: string, text: string, secretValues: readonly string[]) {
  for (const secret of secretValues) if (secret.length >= 8 && text.includes(secret)) throw new PublicExportViolation(artifact, 'secret-value', 'a configured secret value appears in the output');
  for (const [rule, pattern] of contentPatterns) if (pattern.test(text)) throw new PublicExportViolation(artifact, rule, `content matches ${rule}`);
}

const uuidToken = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;
const hex64Token = /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/giu;

/** Collects the UUID and 64-hex tokens of an artifact (for the database cross-check). */
export function collectTokens(text: string, into: { uuids: Set<string>; hex64: Set<string> }) {
  for (const match of text.matchAll(uuidToken)) into.uuids.add(match[0].toLowerCase());
  for (const match of text.matchAll(hex64Token)) into.hex64.add(match[0].toLowerCase());
}

/**
 * Layer 4: no output token may be an INTERNAL value: any table's internal `id` (uuid primary key), any uuid
 * foreign key that is not a public id, or any stored HMAC / credential / token / fingerprint column.
 * Columns are discovered from the live schema, so new sensitive columns are covered automatically.
 */
export async function assertNoInternalValues(database: SqlExecutor, tokens: { uuids: Set<string>; hex64: Set<string> }) {
  const columns = (await database.query<{ table_name: string; column_name: string; data_type: string }>(`SELECT c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
    WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
      AND ((c.data_type='uuid' AND c.column_name NOT LIKE '%public_id')
        OR c.column_name ~ '(hmac|credential|token|secret|fingerprint|puuid)')
    ORDER BY 1, 2`)).rows;
  const uuids = [...tokens.uuids];
  const hex = [...tokens.hex64];
  for (const column of columns) {
    const values = column.data_type === 'uuid' ? uuids : hex;
    if (values.length === 0) continue;
    const ident = (name: string) => { if (!/^[a-z_][a-z0-9_]*$/u.test(name)) throw new Error('Unsafe identifier.'); return `"${name}"`; };
    const cast = column.data_type === 'uuid' ? '::uuid[]' : '::text[]';
    const comparable = column.data_type === 'uuid' ? `t.${ident(column.column_name)}` : `lower(t.${ident(column.column_name)}::text)`;
    // Join against the token set (hash join, O(rows + tokens)); `= ANY(array)` is O(rows × tokens) on
    // unindexed columns and exceeded the statement timeout at 10 000 matches.
    const hit = await database.query<{ hit: boolean }>(`SELECT EXISTS (SELECT 1 FROM ${ident(column.table_name)} t
      JOIN unnest($1${cast}) AS v(token) ON ${comparable} = v.token) AS hit`, [values]);
    if (hit.rows[0]?.hit === true) throw new PublicExportViolation('snapshot', 'internal-value', `output contains a value of ${column.table_name}.${column.column_name}`);
  }
}
