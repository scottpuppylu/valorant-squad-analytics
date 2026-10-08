import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PublicExportViolation, assertNoForbiddenKeys, assertNoSensitiveContent, keyWords } from '../server/staticExport/privacy';
import { StaticExportError, type StaticExportResult } from '../server/staticExport/exporter';
import { LocalFilesystemPublisher, PublishError } from '../server/staticExport/publisher';
import { buildStaticCatalog } from '../server/staticExport/catalog';
import { isLocalDatabaseHost } from '../server/staticExport/locality';
import { postgresExportSources, withConsistentReadSnapshot } from '../server/staticExport/sources';
import { StaticSnapshotClient, StaticSnapshotNotPrecomputedError } from '../src/dataSources/static/StaticSnapshotClient';
import { createStaticQueryHandler, type WorkerRequest, type WorkerResponse } from '../src/dataSources/static/staticQueryWorkerProtocol';
import { isStaticManifest, isStaticSnapshotIndex, staticAnalysisKey, staticWeaponKey, type StaticSnapshotIndex } from '../src/dataSources/static/contract';
import { analysisQueryFor } from '../src/dataSources/server/analysisResult';
import { createDatasetClient, dataDeliveryConfig } from '../src/dataSources/runtimeClient';
import { defaultAnalysisFilters } from '../src/analytics/filters';
import { isDatasetHistoryResponse, isDatasetResponse } from '../src/dataSources/server/datasetContract';
import type { DatasetHistoryResponse, DatasetReadyResponse } from '../src/dataSources/server/contracts';
import { uuid, type BenchDatabase } from './support/analysisBenchFixture';
import { STATIC_TEST_ORIGIN, exportFrom, fileFetch, seededStaticDatabase } from './support/staticSnapshotFixture';

/**
 * TASK-INFRA-STATIC-DATA-PUBLISH-01: static public read model (synthetic data only, PGlite = real PostgreSQL).
 */
let db: BenchDatabase;
let work: string;
let exported: StaticExportResult;
const read = async (path: string) => readFile(path, 'utf8');
const json = async <T>(path: string) => JSON.parse(await read(path)) as T;
async function allText(dir: string): Promise<string> {
  const out: string[] = [];
  const walk = async (d: string) => { for (const e of await readdir(d, { withFileTypes: true })) { if (e.isDirectory()) await walk(join(d, e.name)); else out.push(await read(join(d, e.name))); } };
  await walk(dir);
  return out.join('\n');
}

beforeAll(async () => {
  db = await seededStaticDatabase(360);
  work = await mkdtemp(join(tmpdir(), 'static-snapshot-'));
  exported = await exportFrom(db, join(work, 'export'));
}, 300_000);
afterAll(async () => { await db.close(); await rm(work, { recursive: true, force: true }); });

describe('static snapshot export (public schema, determinism, atomic finalize)', () => {
  it('finalizes one immutable, content-addressed version directory whose every file satisfies its public contract', async () => {
    expect(exported.created).toBe(true);
    expect(exported.directory).toBe(join(work, 'export', 'versions', exported.snapshotId));
    const index = await json<StaticSnapshotIndex>(join(exported.directory, 'index.json'));
    expect(isStaticSnapshotIndex(index)).toBe(true);
    expect(index.snapshotId).toBe(exported.snapshotId);
    expect(Object.keys(index.analysis)).toHaveLength(exported.counts.analysis);
    expect(Object.keys(index.weapons)).toHaveLength(exported.counts.weapons);
    expect(isDatasetResponse(await json(join(exported.directory, 'dataset.json')))).toBe(true);
    // The exporter never writes the manifest (that is the publisher's LAST step) and leaves no staging dir.
    expect((await readdir(join(work, 'export'))).sort()).toEqual(['versions']);
    expect(exported.largestFile.bytes).toBeLessThan(1024 * 1024);
  });

  it('is deterministic: the same durable data yields byte-identical files and the same snapshot id', async () => {
    const again = await exportFrom(db, join(work, 'export-again'));
    expect(again.snapshotId).toBe(exported.snapshotId);
    expect(await read(join(again.directory, 'integrity.json'))).toBe(await read(join(exported.directory, 'integrity.json')));
    // Re-exporting into the same root reuses the immutable version instead of overwriting it.
    const same = await exportFrom(db, join(work, 'export'));
    expect(same).toMatchObject({ snapshotId: exported.snapshotId, created: false });
  }, 300_000);

  it('uses only public member ids; no internal row id or stored HMAC appears anywhere in the snapshot', async () => {
    const text = await allText(exported.directory);
    const dataset = await json<DatasetReadyResponse>(join(exported.directory, 'dataset.json'));
    expect(dataset.dataset.players.length).toBe(6);
    for (const player of dataset.dataset.players) expect(player.id).toMatch(/^00000002-/u); // members.public_id (uuid kind 2)
    for (let i = 1; i <= 7; i += 1) expect(text).not.toContain(uuid(1, i)); // players.id / members.id (internal)
    const hmacs = (await db.query<{ v: string }>('SELECT participant_lookup_hmac AS v FROM match_participants UNION SELECT provider_match_lookup_hmac FROM source_matches')).rows;
    expect(hmacs.length).toBeGreaterThan(0);
    for (const { v } of hmacs.slice(0, 200)) expect(text).not.toContain(v);
    expect(text).not.toMatch(/puuid|lookup_?hmac|password|DATABASE_URL|HENRIK_API_KEY/iu);
  });

  it('exports bounded history pages whose static page tokens chain to the end', async () => {
    const index = await json<StaticSnapshotIndex>(join(exported.directory, 'index.json'));
    const dataset = await json<DatasetReadyResponse>(join(exported.directory, 'dataset.json'));
    let seen = 0;
    for (let page = 1; page <= index.history.pages; page += 1) {
      const response = await json<DatasetHistoryResponse>(join(exported.directory, 'history', `page-${String(page).padStart(4, '0')}.json`));
      expect(isDatasetHistoryResponse(response)).toBe(true);
      expect(response.dataset.matches.length).toBeLessThanOrEqual(50);
      expect(response.page.nextCursor).toBe(page < index.history.pages ? `page:${String(page + 1).padStart(4, '0')}` : null);
      seen += response.dataset.matches.length;
    }
    expect(index.history.before).toBe(dataset.dataset.matches.reduce((a, b) => (b.playedAt < a.playedAt || (b.playedAt === a.playedAt && b.id < a.id) ? b : a)).id);
    const ids = new Set(dataset.dataset.matches.map((match) => match.id));
    expect(ids.size + seen).toBeLessThanOrEqual(360);
    expect(seen).toBeGreaterThan(0);
  });

  it('a failing export finalizes nothing and leaves no staging directory (old versions stay untouched)', async () => {
    const root = join(work, 'export-fail');
    await expect(exportFrom(db, root, { wrap: (sources) => ({ ...sources, weapons: async () => ({ broken: true }) }) })).rejects.toBeInstanceOf(StaticExportError);
    expect(await readdir(root)).toEqual([]);
  }, 300_000);

  it('serializes the services\' parallel statements on the single snapshot connection (pg forbids concurrent client queries)', async () => {
    let active = 0; let maxActive = 0; const order: string[] = [];
    const executor = { query: async (sql: string) => { active += 1; maxActive = Math.max(maxActive, active); await new Promise((r) => setTimeout(r, 2)); order.push(sql); active -= 1; return { rows: [], rowCount: 0 }; } };
    const fake = { query: executor.query, transaction: <T>(work: (e: typeof executor) => Promise<T>) => work(executor), close: async () => undefined };
    await withConsistentReadSnapshot(fake as never, (snapshot) => Promise.all(['a', 'b', 'c'].map((sql) => snapshot.query(sql))));
    expect(maxActive).toBe(1);
    expect(order).toEqual(['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY', 'a', 'b', 'c']);
  });

  it('runs in one READ ONLY snapshot: the exporter can never write PostgreSQL', async () => {
    await expect(withConsistentReadSnapshot(db, (snapshot) => snapshot.query("UPDATE members SET display_name = 'x'"))).rejects.toThrow(/read-only/iu);
  });
});

describe('public export privacy gate', () => {
  const inject = (mutate: (dataset: DatasetReadyResponse) => void) => (sources: ReturnType<typeof postgresExportSources>) => ({
    ...sources, dataset: async () => { const value = structuredClone(await sources.dataset()) as DatasetReadyResponse; mutate(value); return value; },
  });
  const rejectsWith = async (rule: string, mutate: (dataset: DatasetReadyResponse) => void, secretValues: string[] = []) => {
    const root = join(work, `gate-${rule}-${Math.random().toString(16).slice(2)}`);
    const failure = await exportFrom(db, root, { wrap: inject(mutate), secretValues }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PublicExportViolation);
    expect((failure as PublicExportViolation).rule).toBe(rule);
    expect(await readdir(root)).toEqual([]);
  };

  it('rejects a deliberately injected sensitive FIELD (not allowlisted)', async () => {
    await rejectsWith('allowlist', (d) => { (d.dataset.players[0] as unknown as Record<string, unknown>).puuid = 'synthetic-puuid'; });
    await rejectsWith('allowlist', (d) => { (d.dataset.matches[0] as unknown as Record<string, unknown>).providerMatchId = 'x'; });
  }, 300_000);

  it('rejects injected sensitive VALUES in allowlisted fields: secrets, credentialed URLs, provider keys, opaque tokens', async () => {
    await rejectsWith('secret-value', (d) => { d.dataset.matches[0]!.opponent = 'leak-synthetic-secret-123'; }, ['synthetic-secret-123']);
    await rejectsWith('credentialed-url', (d) => { d.dataset.matches[0]!.opponent = 'postgresql://user:pass@db.example/x'; });
    await rejectsWith('provider-key', (d) => { d.dataset.matches[0]!.opponent = 'HDEV-0123abcd-4567'; });
    await rejectsWith('opaque-token', (d) => { d.dataset.matches[0]!.opponent = 'A'.repeat(78); });
  }, 300_000);

  it('rejects any internal database value (row id or stored HMAC) found in the output', async () => {
    await rejectsWith('internal-value', (d) => { d.dataset.matches[0]!.opponent = uuid(1, 1); });
    const hmac = (await db.query<{ v: string }>('SELECT participant_lookup_hmac AS v FROM match_participants LIMIT 1')).rows[0]!.v;
    await rejectsWith('internal-value', (d) => { d.dataset.matches[0]!.opponent = hmac; });
  }, 300_000);

  it('weaponId stays a static weapon content id: one carrying a member / account / match identity fails the export', async () => {
    const root = join(work, 'gate-weapon-id');
    const failure = await exportFrom(db, root, { wrap: (sources) => ({ ...sources, facts: async () => {
      const facts = await sources.facts();
      const [memberId, list] = facts.weapons.facts[0]!;
      const forged = list.slice(0, 1).map((fact) => ({ ...fact, rounds: [{ won: true, weaponStatus: 'observed' as const, weaponId: memberId, weaponName: 'Vandal', loadoutStatus: 'missing' as const, loadoutValue: null, statsStatus: 'missing' as const, score: null }] }));
      return { ...facts, weapons: { ...facts.weapons, facts: [[memberId, forged], ...facts.weapons.facts.slice(1)] } };
    } }) }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StaticExportError);
    expect((failure as Error).message).toMatch(/weaponId must be a static weapon content id/u);
    expect(await readdir(root)).toEqual([]);
  }, 300_000);

  it('forbidden-name semantics are word-based with one explicit, value-checked exception', () => {
    for (const key of ['riotPuuid', 'lookupHmac', 'api_key', 'apiKey', 'databaseUrl', 'DATABASE_URL', 'leaseToken', 'syncCursor', 'password', 'managementCredential', 'consentStatus', 'providerId', 'internalId', 'lockedBy']) {
      expect(() => assertNoForbiddenKeys('dataset', 'x', { nested: [{ [key]: 1 }] }), key).toThrow(PublicExportViolation);
    }
    for (const key of ['blockedRounds', 'lookout', 'tokensSpent'.replace('tokens', 'chips'), 'clutchAttempts', 'unlockedAgents', 'tagline']) {
      expect(() => assertNoForbiddenKeys('dataset', 'x', { [key]: 1 }), key).not.toThrow();
    }
    expect(keyWords('damagePer1000SpentStatus')).toEqual(['damage', 'per1000', 'spent', 'status']);
    expect(() => assertNoForbiddenKeys('history', 'h', { page: { nextCursor: 'page:0002' } })).not.toThrow();
    expect(() => assertNoForbiddenKeys('history', 'h', { page: { nextCursor: 'eyJzaWduZWQiOiJjdXJzb3IifQ' } })).toThrow(PublicExportViolation);
    expect(() => assertNoForbiddenKeys('dataset', 'd', { page: { nextCursor: 'page:0002' } })).toThrow(PublicExportViolation);
    expect(() => assertNoSensitiveContent('x', '{"a":"Bearer abcdefghijkl"}', [])).toThrow(PublicExportViolation);
  });
});

describe('static catalog and client contract', () => {
  it('precomputes every default page request and per-member profile request (keys match the browser exactly)', async () => {
    const index = await json<StaticSnapshotIndex>(join(exported.directory, 'index.json'));
    const dataset = await json<DatasetReadyResponse>(join(exported.directory, 'dataset.json'));
    const has = (query: Parameters<typeof staticAnalysisKey>[0]) => expect(index.analysis[staticAnalysisKey(query)], JSON.stringify(query)).toBeDefined();
    const current = { ...defaultAnalysisFilters, period: 'current' as const };
    has(analysisQueryFor(current, 'lifetimeTotals', true)!); // Dashboard / Leaderboard
    has(analysisQueryFor(current, 'lifetimeTotals', false)!); // Compare (form-less → same file)
    has(analysisQueryFor(defaultAnalysisFilters, 'mapStats', false)!); // Maps base
    has(analysisQueryFor(defaultAnalysisFilters, 'agentStats', false)!); // Agents base
    has({ feature: 'synergy' });
    for (const period of ['current', 'all', 'recent10', 'recent30'] as const) has(analysisQueryFor({ ...defaultAnalysisFilters, period }, 'lifetimeTotals', true)!);
    for (const player of dataset.dataset.players) {
      has(analysisQueryFor({ ...current, playerId: player.id }, 'lifetimeTotals', true)!); // Profile
      has({ feature: 'improvementIndex', player: player.id });
      expect(index.weapons[staticWeaponKey({ player: player.id, scope: 'all', map: 'all', agent: 'all', mode: 'Competitive' })]).toBeDefined();
    }
    const acts = (await json<{ evidence: { season: { acts: { key: string }[] } } }>(join(exported.directory, 'analytics.json'))).evidence.season.acts;
    expect(acts.length).toBeGreaterThan(0);
    for (const { key } of acts) { has({ feature: 'actOverview', act: key }); has({ feature: 'synergy', act: key }); }
  });

  it('the form-less answer is the form answer minus recent-form windows (form-superset transform is exact)', async () => {
    const [withForm, withoutForm] = await withConsistentReadSnapshot(db, async (snapshot) => {
      const sources = postgresExportSources(snapshot);
      return [await sources.analysis({ feature: 'lifetimeTotals', form: true }), await sources.analysis({ feature: 'lifetimeTotals' })] as Record<string, unknown>[];
    });
    for (const key of ['summary', 'scope', 'coverage', 'population', 'status', 'reasons', 'evidence']) expect(withForm![key], key).toEqual(withoutForm![key]);
    expect(withoutForm!.forms).toBeUndefined();
    expect(Array.isArray(withForm!.forms)).toBe(true);
  }, 300_000);

  it('extended tier adds every single-filter slice; core stays a strict subset', () => {
    const facts = { players: ['p1', 'p2'], maps: ['Bind', 'Ascent'], agents: ['Sova'], gameModes: ['Competitive'], acts: ['e11a4'] };
    const core = buildStaticCatalog(facts, 'core');
    const extended = buildStaticCatalog(facts, 'extended');
    const coreKeys = new Set(core.analysis.map(staticAnalysisKey));
    const extendedKeys = new Set(extended.analysis.map(staticAnalysisKey));
    for (const key of coreKeys) expect(extendedKeys.has(key)).toBe(true);
    expect(extendedKeys.has(staticAnalysisKey({ feature: 'currentStrength', map: 'Bind' }))).toBe(true);
    expect(coreKeys.has(staticAnalysisKey({ feature: 'currentStrength', map: 'Bind' }))).toBe(false);
    expect(buildStaticCatalog({ ...facts, maps: ['Ascent', 'Bind'] }, 'core')).toEqual(core); // order-independent
  });

  it('static delivery is opt-in, public build configuration (no URL hardcoded, no secret)', () => {
    expect(dataDeliveryConfig({})).toEqual({ mode: 'api' });
    expect(dataDeliveryConfig({ VITE_DATA_MODE: 'api', BASE_URL: '/' })).toEqual({ mode: 'api' });
    expect(dataDeliveryConfig({ VITE_DATA_MODE: 'static', BASE_URL: '/valorant-squad-analytics/' })).toEqual({ mode: 'static', staticBase: '/valorant-squad-analytics/public-data/' });
    expect(dataDeliveryConfig({ VITE_DATA_MODE: 'static', BASE_URL: '/', VITE_STATIC_DATA_BASE: 'https://data.example.test/snapshots/' }).staticBase).toBe('https://data.example.test/snapshots/');
    expect(createDatasetClient({ mode: 'static', staticBase: STATIC_TEST_ORIGIN })).toBeInstanceOf(StaticSnapshotClient);
    expect(createDatasetClient({ mode: 'api' })).not.toBeInstanceOf(StaticSnapshotClient);
  });

  it('the exporter reads only a LOCAL database host', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', '10.1.2.3', '172.20.0.5', '192.168.1.10', 'postgres', 'fd00::1']) expect(isLocalDatabaseHost(host), host).toBe(true);
    for (const host of ['ep-cool-name-123.ap-southeast-1.aws.neon.tech', 'db.example.com', '8.8.8.8', '172.32.0.1', '2001:db8::1']) expect(isLocalDatabaseHost(host), host).toBe(false);
  });
});

describe('publication, atomic visibility and snapshot switch', () => {
  let root: string;
  let snapshotA: StaticExportResult;
  let snapshotB: StaticExportResult;
  const memberOne = uuid(2, 1);

  beforeAll(async () => {
    root = join(work, 'site');
    snapshotA = exported;
    // A known visible change: member 1's community name (presentation only) → a new data version.
    await db.query("UPDATE members SET display_name = 'SnapshotB 名稱', display_name_source = 'community' WHERE public_id = $1", [memberOne]);
    snapshotB = await exportFrom(db, join(work, 'export'));
  }, 300_000);

  const client = (log: string[] = []) => new StaticSnapshotClient({ baseUrl: STATIC_TEST_ORIGIN, fetch: fileFetch(root, log) });
  const memberName = async (c: StaticSnapshotClient) => {
    const response = await c.load() as DatasetReadyResponse;
    return response.dataset.players.find((player) => player.id === memberOne)?.displayName;
  };

  it('publishes A, then B; the manifest is written last and the browser follows it on refresh', async () => {
    expect(snapshotB.snapshotId).not.toBe(snapshotA.snapshotId);
    const publisher = new LocalFilesystemPublisher(root);
    await publisher.publish(snapshotA.directory, { generatedAt: new Date('2026-10-07T00:00:00Z') });
    expect(isStaticManifest(await json(join(root, 'manifest.json')))).toBe(true);
    const browser = client();
    expect(await memberName(browser)).toBe('BenchPlayer1');
    const result = await publisher.publish(snapshotB.directory, { generatedAt: new Date('2026-10-07T01:00:00Z') });
    expect(result).toMatchObject({ snapshotId: snapshotB.snapshotId, previousSnapshotId: snapshotA.snapshotId, copied: true });
    expect(await memberName(browser)).toBe('SnapshotB 名稱'); // refresh = load() re-reads the manifest
  });

  it('an incomplete publication never becomes visible: the manifest still points at the last complete version', async () => {
    const publisher = new LocalFilesystemPublisher(root);
    // Simulate a crash mid-upload of a new version: files present under versions/, manifest untouched.
    await db.query("UPDATE members SET display_name = 'Never visible' WHERE public_id = $1", [memberOne]);
    const snapshotC = await exportFrom(db, join(work, 'export'));
    const partial = join(root, 'versions', snapshotC.snapshotId);
    await cp(snapshotC.directory, partial, { recursive: true });
    await rm(join(partial, 'dataset.json'));
    expect(await memberName(client())).toBe('SnapshotB 名稱');
    // A corrupted source is refused before the manifest is touched (and leaves no .partial copy).
    const corrupt = join(work, 'corrupt');
    await cp(snapshotC.directory, corrupt, { recursive: true });
    await writeFile(join(corrupt, 'analytics.json'), '{"tampered":true}\n');
    await rm(partial, { recursive: true, force: true });
    await expect(publisher.publish(corrupt)).rejects.toBeInstanceOf(PublishError);
    expect((await json<{ snapshotId: string }>(join(root, 'manifest.json'))).snapshotId).toBe(snapshotB.snapshotId);
    expect((await readdir(join(root, 'versions'))).filter((name) => name.endsWith('.partial'))).toEqual([]);
    expect(await memberName(client())).toBe('SnapshotB 名稱');
  }, 300_000);

  it('a client pinned to one snapshot never mixes versions; requests issued with load() bind to the new pin', async () => {
    const log: string[] = [];
    const browser = client(log);
    // The provider prefetches analysis in the same tick as load() (DatasetProvider order).
    const pending = browser.loadAnalysis({ feature: 'currentStrength', form: true });
    await browser.load();
    await pending;
    const versions = new Set(log.filter((url) => url.includes('/versions/')).map((url) => /versions\/(s-[0-9a-f]{20})\//u.exec(url)![1]));
    expect([...versions]).toEqual([snapshotB.snapshotId]);
    expect(log.filter((url) => url.endsWith('manifest.json'))).toHaveLength(1);
    expect(log.every((url) => url.startsWith(STATIC_TEST_ORIGIN) && !url.includes('/api/'))).toBe(true);
  });

  it('a request outside the catalog is answered from the snapshot\'s public facts with the server\'s exact payload', async () => {
    // The manifest points at B: bring the database back to B's state (the C test renamed member one).
    await db.query("UPDATE members SET display_name = 'SnapshotB 名稱' WHERE public_id = $1", [memberOne]);
    const log: string[] = [];
    const browser = client(log);
    await browser.load();
    const query = { feature: 'currentStrength' as const, map: 'Bind', agent: 'Sova', form: true };
    const weapon = { player: memberOne, scope: 'all' as const, map: 'Bind', agent: 'Sova', mode: 'Competitive' };
    const [analysis, weapons] = [await browser.loadAnalysis(query), await browser.loadWeaponAnalytics(weapon)];
    const [expected, expectedWeapons] = await withConsistentReadSnapshot(db, async (snapshot) => {
      const sources = postgresExportSources(snapshot);
      return [await sources.analysis(query), await sources.weapons(weapon)];
    });
    expect(JSON.stringify(analysis)).toBe(JSON.stringify(expected));
    expect(JSON.stringify(weapons)).toBe(JSON.stringify(expectedWeapons));
    expect(log.some((url) => url.includes('/facts/'))).toBe(true);
    expect(log.some((url) => url.includes('/analysis/'))).toBe(false);
  });

  it('facts queries through the Web Worker protocol return exactly the in-thread result', async () => {
    const handler = createStaticQueryHandler(async (url) => (await fileFetch(root)(url)).json());
    const posted: WorkerRequest[] = [];
    const fakeWorker = {
      onmessage: null as ((event: MessageEvent<WorkerResponse>) => void) | null,
      postMessage(request: WorkerRequest) { posted.push(request); void handler(request).then((response) => this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>)); },
    };
    const viaWorker = new StaticSnapshotClient({ baseUrl: STATIC_TEST_ORIGIN, fetch: fileFetch(root), workerFactory: () => fakeWorker as unknown as Worker });
    const inThread = client();
    await viaWorker.load(); await inThread.load();
    const query = { feature: 'lifetimeTotals' as const, map: 'Bind', role: 'Duelist', from: '2026-01-01', to: '2026-12-31' };
    expect(JSON.stringify(await viaWorker.loadAnalysis(query))).toBe(JSON.stringify(await inThread.loadAnalysis(query)));
    const weapon = { player: memberOne, scope: 'current' as const, map: 'all', agent: 'Sova', mode: 'Competitive' };
    expect(JSON.stringify(await viaWorker.loadWeaponAnalytics(weapon))).toBe(JSON.stringify(await inThread.loadWeaponAnalytics(weapon)));
    expect(posted.map((request) => request.kind)).toEqual(['analysis', 'weapons']);
    expect(posted.every((request) => request.base.startsWith(STATIC_TEST_ORIGIN) && request.metaPath === 'facts/meta.json')).toBe(true);
  });

  it('only a snapshot WITHOUT public facts reports "not precomputed" (never another scope)', async () => {
    const indexPath = join(root, 'versions', snapshotB.snapshotId, 'index.json');
    const original = await read(indexPath);
    const legacy: Partial<StaticSnapshotIndex> = JSON.parse(original) as StaticSnapshotIndex;
    delete legacy.facts;
    try {
      await writeFile(indexPath, JSON.stringify({ ...legacy, tier: 'core' }));
      const legacyClient = client();
      await legacyClient.load();
      await expect(legacyClient.loadAnalysis({ feature: 'currentStrength', map: 'Bind', agent: 'Sova' })).rejects.toBeInstanceOf(StaticSnapshotNotPrecomputedError);
    } finally {
      await writeFile(indexPath, original);
    }
  });

  it('retention keeps the active version plus the rollback window and prunes older ones', async () => {
    const publisher = new LocalFilesystemPublisher(root);
    const result = await publisher.publish(snapshotA.directory, { keepVersions: 1 });
    expect(result.snapshotId).toBe(snapshotA.snapshotId);
    expect(result.pruned).toContain(snapshotB.snapshotId);
    expect(await readdir(join(root, 'versions'))).toEqual([snapshotA.snapshotId]);
    expect(await memberName(client())).toBe('BenchPlayer1'); // rollback = re-point the manifest
  });
});
