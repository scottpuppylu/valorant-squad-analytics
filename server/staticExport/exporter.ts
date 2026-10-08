import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SqlExecutor } from '../db/types.js';
import { buildStaticCatalog, type StaticCatalogTier } from './catalog.js';
import { renameWithRetry } from './renameWithRetry.js';
import type { StaticExportSources, StaticFactSources } from './sources.js';
import {
  FACT_MATCHES_PER_CHUNK, FACT_SKELETONS_PER_CHUNK, FACT_WEAPON_FACTS_PER_CHUNK, PUBLIC_FACT_SCHEMA_VERSION, assertWeaponIdsAreContentIds, decodeSkeleton, decodeWeaponFacts, encodeSkeleton, encodeWeaponFacts,
  type FactsMeta, type MatchChunk, type SkeletonChunk,
} from '../../src/dataSources/static/publicFacts.js';
import { assertAllowlisted, assertNoForbiddenKeys, assertNoInternalValues, assertNoSensitiveContent, collectTokens, PublicExportViolation } from './privacy.js';
import type { PublicArtifactKind } from './publicAllowlist.js';
import {
  STATIC_CATALOG_VERSION, STATIC_HISTORY_PAGE_SIZE, STATIC_SNAPSHOT_SCHEMA_VERSION, STATIC_SNAPSHOT_VERSION,
  isStaticSnapshotIndex, staticAnalysisKey, staticHistoryFile, staticHistoryToken, staticWeaponKey, type StaticSnapshotIndex,
} from '../../src/dataSources/static/contract.js';
import { isDatasetAnalyticsContextResponse, isDatasetHistoryResponse, isDatasetResponse } from '../../src/dataSources/server/datasetContract.js';
import { isDatasetAnalysisResponse } from '../../src/dataSources/server/analysisResult.js';
import { isWeaponAnalyticsResponse } from '../../src/dataSources/server/weaponContract.js';
import type { DatasetAnalyticsContextResponse, DatasetHistoryResponse, DatasetReadyResponse } from '../../src/dataSources/server/contracts.js';
import type { MatchRecord } from '../../src/types/valorant.js';

/**
 * TASK-INFRA-STATIC-DATA-PUBLISH-01 static snapshot EXPORTER (host-agnostic; no GitHub / network code).
 *
 *   export(): PostgreSQL (one READ ONLY snapshot) → public payloads → privacy gate → staging dir
 *             → index.json + integrity.json → atomic rename to <outputRoot>/versions/<snapshotId>/
 *
 * It never writes manifest.json (that is the publisher's LAST step) and never touches an existing version.
 * Output is deterministic: the same durable data yields byte-identical files and the same snapshotId.
 */
export const STATIC_EXPORT_VERSION = 'static-export-v1' as const;

export interface StaticExportBudgets {
  /** Hard per-file limit (fail closed). */
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  /** Advisory size target used for reporting only. */
  targetFileBytes: number;
}

export const defaultStaticExportBudgets: StaticExportBudgets = {
  maxFileBytes: 5 * 1024 * 1024, maxTotalBytes: 768 * 1024 * 1024, maxFiles: 20_000, targetFileBytes: 1024 * 1024,
};

export interface StaticExportOptions {
  sources: StaticExportSources;
  /** The database the sources read (cross-checked by gate layer 4). */
  database: SqlExecutor;
  outputRoot: string;
  tier?: StaticCatalogTier;
  budgets?: StaticExportBudgets;
  /** Configured secret values that must never appear (env secrets, test fixtures). */
  secretValues?: readonly string[];
  /** Identifier-free stage events (stage name, counts, elapsed ms) for monitoring long exports. */
  onProgress?: (event: { stage: string; ms: number; count?: number }) => void;
}

export interface StaticExportFileMeta { path: string; bytes: number; sha256: string }

export interface StaticExportResult {
  snapshotId: string;
  dataVersion: string;
  directory: string;
  /** False when an identical snapshot already existed (content-addressed, deterministic). */
  created: boolean;
  files: StaticExportFileMeta[];
  totalBytes: number;
  largestFile: StaticExportFileMeta;
  overTargetFiles: number;
  counts: { analysis: number; weapons: number; historyPages: number };
}

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export class StaticExportError extends Error {
  constructor(message: string) { super(message); this.name = 'StaticExportError'; }
}

type Validator = (value: unknown) => boolean;
const contracts: Record<Exclude<PublicArtifactKind, 'index' | 'factsMeta' | 'factsSkeletons' | 'factsMatches' | 'factsWeapons'>, Validator> = {
  dataset: (value) => isDatasetResponse(value),
  analytics: (value) => isDatasetAnalyticsContextResponse(value),
  history: (value) => isDatasetHistoryResponse(value),
  analysis: (value) => isDatasetAnalysisResponse(value),
  weapons: (value) => isWeaponAnalyticsResponse(value),
};

function oldestMatch(matches: MatchRecord[]): MatchRecord | undefined {
  // Same rule as useTrackedHistory: server order is (started_at DESC, public_id DESC).
  return matches.reduce<MatchRecord | undefined>((current, match) => (
    !current || match.playedAt < current.playedAt || (match.playedAt === current.playedAt && match.id < current.id) ? match : current), undefined);
}

const publicId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const byTime = (a: MatchRecord, b: MatchRecord) => (a.playedAt < b.playedAt ? -1 : a.playedAt > b.playedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const lossless = <T>(value: T, roundTrip: T, what: string) => {
  if (JSON.stringify(value) !== JSON.stringify(roundTrip)) throw new StaticExportError(`${what} does not round-trip through the public fact encoding.`);
};

/** public-facts-v1: skeletons, full match chunks (+ evidence flags) and per-member weapon facts, then meta. */
async function writeFacts(sources: StaticFactSources, write: (path: string, kind: PublicArtifactKind, value: unknown) => Promise<void>, progress: (stage: string, count?: number) => void) {
  const { phase1, phase2, weapons } = sources;
  for (const key of phase2.flags.keys()) if (!publicId.test(key)) throw new StaticExportError('evidence flags must be keyed by public match ids.');
  const skeletons = [...phase1.skeletons].sort(byTime);
  const skeletonFiles: string[] = [];
  for (let i = 0; i < skeletons.length || i === 0; i += FACT_SKELETONS_PER_CHUNK) {
    const slice = skeletons.slice(i, i + FACT_SKELETONS_PER_CHUNK);
    const chunk: SkeletonChunk = { skeletons: slice.map(encodeSkeleton) };
    chunk.skeletons.forEach((tuple, index) => lossless(slice[index], decodeSkeleton(tuple), 'a skeleton'));
    const file = `facts/skeletons-${String(skeletonFiles.length + 1).padStart(4, '0')}.json`;
    await write(file, 'factsSkeletons', chunk);
    skeletonFiles.push(file);
    if (skeletons.length === 0) break;
  }
  const full = [...phase2.full.values()].sort(byTime);
  const matchChunks: FactsMeta['matchChunks'] = [];
  for (let i = 0; i < full.length; i += FACT_MATCHES_PER_CHUNK) {
    const slice = full.slice(i, i + FACT_MATCHES_PER_CHUNK);
    const flags = slice.map((match): [0 | 1, 0 | 1] => {
      const flag = phase2.flags.get(match.id);
      if (!flag) throw new StaticExportError('a full record has no evidence flags.');
      return [flag.round ? 1 : 0, flag.headshot ? 1 : 0];
    });
    const file = `facts/matches-${String(matchChunks.length + 1).padStart(4, '0')}.json`;
    await write(file, 'factsMatches', { matches: slice, flags } satisfies MatchChunk);
    matchChunks.push({ file, first: [slice[0]!.playedAt, slice[0]!.id], last: [slice.at(-1)!.playedAt, slice.at(-1)!.id], count: slice.length });
  }
  const evidenceOnly: FactsMeta['evidenceOnly'] = [...phase2.flags].filter(([id]) => !phase2.full.has(id)).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, flag]) => [id, flag.round ? 1 : 0, flag.headshot ? 1 : 0]);
  const weaponFiles: [string, string][] = [];
  // weaponId is a static Riot content id: it may never equal a public member / account / match identity.
  const identities = new Set([...phase2.players.flatMap((player) => [player.id, ...(player.accounts ?? []).map((account) => account.id)]), ...phase1.skeletons.map((match) => match.id)]
    .map((id) => id.toLowerCase()));
  for (const [memberId, facts] of weapons.facts) {
    for (let i = 0; i < facts.length; i += FACT_WEAPON_FACTS_PER_CHUNK) {
      const slice = facts.slice(i, i + FACT_WEAPON_FACTS_PER_CHUNK);
      const chunk = encodeWeaponFacts(memberId, slice);
      lossless(slice, decodeWeaponFacts(chunk), 'a weapon fact');
      try { assertWeaponIdsAreContentIds(chunk, identities); } catch (error) { throw new StaticExportError((error as Error).message); }
      const file = `facts/weapons-${String(weaponFiles.length + 1).padStart(4, '0')}.json`;
      await write(file, 'factsWeapons', chunk);
      weaponFiles.push([memberId, file]);
    }
  }
  const meta: FactsMeta = {
    factSchemaVersion: PUBLIC_FACT_SCHEMA_VERSION, trackedMatchCount: phase1.trackedMatchCount,
    populationEvidence: { // union(skeleton Acts, evidence Acts) is idempotent: re-deriving from seasonKeys yields the same population.
      acts: phase1.population.seasonKeys, seasonStatus: phase1.population.seasonStatus, rankStatus: phase1.population.rankStatus },
    players: phase2.players, skeletonPlayers: phase1.skeletonPlayers, skeletonFiles, matchChunks, evidenceOnly,
    weapons: { memberIds: weapons.memberIds, observedActs: weapons.observedActs, files: weaponFiles },
  };
  await write('facts/meta.json', 'factsMeta', meta);
  progress('facts_written', skeletonFiles.length + matchChunks.length + weaponFiles.length + 1);
}

export async function exportStaticSnapshot(options: StaticExportOptions): Promise<StaticExportResult> {
  const tier = options.tier ?? 'core';
  const budgets = options.budgets ?? defaultStaticExportBudgets;
  const secrets = options.secretValues ?? [];
  const staging = join(options.outputRoot, `.staging-${randomBytes(6).toString('hex')}`);
  const exportStarted = Date.now();
  const progress = (stage: string, count?: number) => options.onProgress?.({ stage, ms: Date.now() - exportStarted, ...(count !== undefined ? { count } : {}) });
  const files: StaticExportFileMeta[] = [];
  const tokens = { uuids: new Set<string>(), hex64: new Set<string>() };
  let totalBytes = 0;

  const write = async (path: string, kind: PublicArtifactKind, value: unknown) => {
    if (kind in contracts && !contracts[kind as keyof typeof contracts](value)) throw new StaticExportError(`${path} does not satisfy the public ${kind} contract.`);
    assertAllowlisted(kind, path, value);
    assertNoForbiddenKeys(kind, path, value);
    const text = `${JSON.stringify(value)}\n`;
    assertNoSensitiveContent(path, text, secrets);
    collectTokens(text, tokens);
    const bytes = Buffer.byteLength(text);
    if (bytes > budgets.maxFileBytes) throw new StaticExportError(`${path} is ${bytes} bytes (limit ${budgets.maxFileBytes}).`);
    totalBytes += bytes;
    if (totalBytes > budgets.maxTotalBytes) throw new StaticExportError(`snapshot exceeds ${budgets.maxTotalBytes} bytes.`);
    if (files.length + 1 > budgets.maxFiles) throw new StaticExportError(`snapshot exceeds ${budgets.maxFiles} files.`);
    await mkdir(dirname(join(staging, path)), { recursive: true });
    await writeFile(join(staging, path), text, { flag: 'wx' });
    files.push({ path, bytes, sha256: sha256(text) });
  };

  try {
    await mkdir(staging, { recursive: true });
    const dataset = await options.sources.dataset() as DatasetReadyResponse;
    if (!isDatasetResponse(dataset)) throw new StaticExportError('The dataset read is not a ready public dataset (is the read mode enabled and the database migrated?).');
    await write('dataset.json', 'dataset', dataset);
    const analytics = await options.sources.analyticsContext() as DatasetAnalyticsContextResponse;
    await write('analytics.json', 'analytics', analytics);

    // History: bounded pages starting strictly older than the bootstrap snapshot (what the Matches page asks).
    const before = oldestMatch(dataset.dataset.matches)?.id ?? null;
    const maxPages = Math.ceil(analytics.population.trackedMatchCount / STATIC_HISTORY_PAGE_SIZE) + 2;
    let page = 1;
    let cursor: string | undefined;
    for (;;) {
      if (page > maxPages) throw new StaticExportError('history pagination exceeded its deterministic bound.');
      const response = await options.sources.history({ limit: STATIC_HISTORY_PAGE_SIZE, ...(cursor ? { cursor } : before ? { before } : {}) }) as DatasetHistoryResponse;
      if (!isDatasetHistoryResponse(response)) throw new StaticExportError(`history page ${page} does not satisfy the public history contract.`);
      const next = response.page.hasMore ? response.page.nextCursor ?? undefined : undefined;
      const published: DatasetHistoryResponse = { ...response, page: { ...response.page, nextCursor: next ? staticHistoryToken(page + 1) : null } };
      await write(staticHistoryFile(page), 'history', published);
      if (!next) break;
      cursor = next;
      page += 1;
    }

    // TASK-INFRA-STATIC-QUERY-PARITY-01 public facts: the exact inputs of the shared analysis core and weapon query.
    progress('history_written', page);
    const factSources = await options.sources.facts();
    progress('facts_loaded', factSources.phase2.full.size);
    await writeFacts(factSources, write, progress);

    const catalog = buildStaticCatalog({
      players: dataset.dataset.players.map((player) => player.id),
      maps: analytics.facets?.maps.map((item) => item.map) ?? [],
      agents: analytics.facets?.agents ?? [],
      gameModes: analytics.facets?.gameModes ?? [],
      acts: analytics.evidence.season.acts.map((act) => act.key),
    }, tier);
    const analysis: Record<string, string> = {};
    for (const [i, query] of catalog.analysis.entries()) {
      const file = `analysis/a${String(i + 1).padStart(5, '0')}.json`;
      await write(file, 'analysis', await options.sources.analysis(query));
      analysis[staticAnalysisKey(query)] = file;
    }
    const weapons: Record<string, string> = {};
    for (const [i, query] of catalog.weapons.entries()) {
      const file = `weapons/w${String(i + 1).padStart(5, '0')}.json`;
      await write(file, 'weapons', await options.sources.weapons(query));
      weapons[staticWeaponKey(query)] = file;
    }

    progress('catalog_written', catalog.analysis.length + catalog.weapons.length);
    await assertNoInternalValues(options.database, tokens);
    progress('privacy_gate_passed', tokens.uuids.size + tokens.hex64.size);

    // Content-addressed id over every data file plus the catalog (index without its own id).
    const indexBody = {
      schemaVersion: STATIC_SNAPSHOT_SCHEMA_VERSION, snapshotVersion: STATIC_SNAPSHOT_VERSION, catalogVersion: STATIC_CATALOG_VERSION,
      dataVersion: dataset.snapshot.version, tier, files: { dataset: 'dataset.json', analytics: 'analytics.json' },
      history: { pageSize: STATIC_HISTORY_PAGE_SIZE, pages: page, before }, facts: 'facts/meta.json', analysis, weapons,
    } as const;
    const digest = sha256([...files].sort((a, b) => (a.path < b.path ? -1 : 1)).map((file) => `${file.path}\t${file.sha256}`).join('\n')
      + `\n${JSON.stringify(indexBody)}`);
    const snapshotId = `s-${digest.slice(0, 20)}`;
    const index: StaticSnapshotIndex = { schemaVersion: indexBody.schemaVersion, snapshotVersion: indexBody.snapshotVersion, catalogVersion: indexBody.catalogVersion,
      snapshotId, dataVersion: indexBody.dataVersion, tier, files: indexBody.files, history: indexBody.history, facts: indexBody.facts, analysis, weapons };
    if (!isStaticSnapshotIndex(index)) throw new StaticExportError('index.json does not satisfy the static index contract.');
    await write('index.json', 'index', index);
    const integrity = { snapshotId, gateVersion: 'public-export-gate-v1', exportVersion: STATIC_EXPORT_VERSION,
      files: [...files].sort((a, b) => (a.path < b.path ? -1 : 1)) };
    await writeFile(join(staging, 'integrity.json'), `${JSON.stringify(integrity)}\n`, { flag: 'wx' });

    const directory = join(options.outputRoot, 'versions', snapshotId);
    await mkdir(join(options.outputRoot, 'versions'), { recursive: true });
    let created = true;
    if (await stat(directory).then(() => true, () => false)) {
      // Immutable + content-addressed: an existing version must be byte-identical, never overwritten.
      const existing = await readFile(join(directory, 'integrity.json'), 'utf8').catch(() => '');
      if (existing !== `${JSON.stringify(integrity)}\n`) throw new StaticExportError(`version ${snapshotId} already exists with different content.`);
      await rm(staging, { recursive: true, force: true });
      created = false;
    } else {
      await renameWithRetry(staging, directory);
    }
    const largestFile = files.reduce((a, b) => (b.bytes > a.bytes ? b : a));
    return {
      snapshotId, dataVersion: index.dataVersion, directory, created, files, totalBytes, largestFile,
      overTargetFiles: files.filter((file) => file.bytes > budgets.targetFileBytes).length,
      counts: { analysis: catalog.analysis.length, weapons: catalog.weapons.length, historyPages: page },
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (error instanceof PublicExportViolation || error instanceof StaticExportError) throw error;
    throw new StaticExportError(`export failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}
