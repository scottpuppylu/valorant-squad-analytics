import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitDataRepositoryPublisher, runGit, type GitRunner, type PublicationAuditRecord } from '../server/staticPublish/gitDataRepositoryPublisher';
import { PublishError } from '../server/staticExport/publisher';
import { renameWithRetry } from '../server/staticExport/renameWithRetry';
import { StaticSnapshotClient } from '../src/dataSources/static/StaticSnapshotClient';
import type { DatasetReadyResponse } from '../src/dataSources/server/contracts';
import { uuid, type BenchDatabase } from './support/analysisBenchFixture';
import { STATIC_TEST_ORIGIN, exportFrom, fileFetch, seededStaticDatabase } from './support/staticSnapshotFixture';

/**
 * TASK-INFRA-STATIC-PUBLICATION-CHANNEL-01 Git data-repository publisher against a LOCAL bare repository
 * (the same transport the GitHub data repository uses; no network, synthetic data only).
 */
let db: BenchDatabase;
let work: string;
let bare: string;
const snapshots: Record<'A' | 'B' | 'C' | 'D', string> = { A: '', B: '', C: '', D: '' };
const memberOne = uuid(2, 1);

const remote = (args: string[]) => runGit(['--git-dir', bare, ...args], work);
const remoteManifest = async () => JSON.parse(await remote(['show', 'main:manifest.json'])) as { snapshotId: string };
const remoteVersions = async () => (await remote(['ls-tree', '--name-only', 'main', 'versions/'])).split('\n').filter(Boolean).map((path) => path.replace('versions/', ''));
const subjects = async () => (await remote(['log', '--format=%s', 'main'])).split('\n').filter(Boolean);
/** What a static host serves: a fresh checkout of the remote branch, read through the browser client. */
async function browserName(): Promise<string | undefined> {
  const site = await mkdtemp(join(tmpdir(), 'data-site-'));
  await runGit(['clone', '-q', '--branch', 'main', bare, site], work);
  const client = new StaticSnapshotClient({ baseUrl: STATIC_TEST_ORIGIN, fetch: fileFetch(site) });
  const response = await client.load() as DatasetReadyResponse;
  await rm(site, { recursive: true, force: true });
  return response.dataset.players.find((player) => player.id === memberOne)?.displayName;
}
const publisher = (overrides: Partial<ConstructorParameters<typeof GitDataRepositoryPublisher>[0]> = {}) => new GitDataRepositoryPublisher({
  workDir: join(work, 'clone'), remoteUrl: bare, branch: 'main', auditDir: join(work, 'audit'), ...overrides,
});

beforeAll(async () => {
  db = await seededStaticDatabase(160, 9, { weapons: true });
  work = await mkdtemp(join(tmpdir(), 'static-publication-'));
  bare = join(work, 'remote.git');
  await runGit(['init', '-q', '--bare', '-b', 'main', bare], work);
  const rename = (name: string) => db.query("UPDATE members SET display_name = $1 WHERE public_id = $2", [name, memberOne]);
  for (const [key, name] of [['A', 'BenchPlayer1'], ['B', 'Remote B 名稱'], ['C', 'Never visible C'], ['D', 'Snapshot D']] as const) {
    await rename(name);
    snapshots[key] = (await exportFrom(db, join(work, 'export'), { tier: 'common' })).snapshotId;
  }
}, 600_000);
afterAll(async () => { await db.close(); await rm(work, { recursive: true, force: true }); });
const version = (key: keyof typeof snapshots) => join(work, 'export', 'versions', snapshots[key]);

describe('atomic finalize rename (Windows transient locks)', () => {
  const failing = (codes: string[]) => {
    let calls = 0;
    return { calls: () => calls, rename: (async () => { const code = codes[calls]; calls += 1; if (code) throw Object.assign(new Error(code), { code }); }) as never };
  };
  it('retries a transient EPERM / EACCES / EBUSY and then succeeds', async () => {
    const fake = failing(['EPERM', 'EBUSY', 'EACCES']);
    expect(await renameWithRetry('a', 'b', { rename: fake.rename, delayMs: 1 })).toBe(4);
  });
  it('never retries other errors and fails after the bounded budget', async () => {
    await expect(renameWithRetry('a', 'b', { rename: failing(['ENOENT']).rename, delayMs: 1 })).rejects.toThrow('ENOENT');
    const fake = failing(Array(20).fill('EPERM'));
    await expect(renameWithRetry('a', 'b', { rename: fake.rename, delayMs: 1, attempts: 3 })).rejects.toThrow('EPERM');
    expect(fake.calls()).toBe(3);
  });
});

describe('Git data-repository publisher (local bare remote)', () => {
  it('publishes A: immutable version commit FIRST, verified remotely, manifest commit LAST', async () => {
    const result = await publisher().publish(version('A'));
    expect(result).toMatchObject({ snapshotId: snapshots.A, copied: true });
    expect(await subjects()).toEqual([`data: manifest -> ${snapshots.A}`, `data: add immutable version ${snapshots.A}`]);
    // The version commit alone (manifest-less) never references anything: manifest only exists from the 2nd commit.
    await expect(remote(['show', 'main~1:manifest.json'])).rejects.toThrow();
    expect((await remote(['ls-tree', '--name-only', 'main'])).split('\n').filter(Boolean).sort()).toEqual(['.gitattributes', '.nojekyll', 'README.md', 'manifest.json', 'versions']);
    expect(await remote(['show', 'main:README.md'])).toMatch(/not the source of truth/iu);
    expect(await browserName()).toBe('BenchPlayer1');
  }, 300_000);

  it('switches A → B; the browser reads only B after the manifest commit', async () => {
    const result = await publisher().publish(version('B'));
    expect(result).toMatchObject({ snapshotId: snapshots.B, previousSnapshotId: snapshots.A });
    expect((await remoteManifest()).snapshotId).toBe(snapshots.B);
    expect(await browserName()).toBe('Remote B 名稱');
  }, 300_000);

  it('an interrupted publication (after the version push / before the manifest push) never becomes visible', async () => {
    for (const fault of ['before-version-push', 'after-version-push', 'before-manifest-push'] as const) {
      await expect(publisher({ fault }).publish(version('C'))).rejects.toBeInstanceOf(PublishError);
      expect((await remoteManifest()).snapshotId, fault).toBe(snapshots.B);
      expect(await browserName(), fault).toBe('Remote B 名稱');
    }
    expect(await remoteVersions()).toContain(snapshots.C); // uploaded, never activated
    // Cleanup of the never-activated version leaves the manifest untouched; an ever-active version is refused.
    await publisher().removeInactiveVersion(snapshots.C);
    expect(await remoteVersions()).not.toContain(snapshots.C);
    await expect(publisher().removeInactiveVersion(snapshots.A)).rejects.toThrow(/was active/u);
    expect((await remoteManifest()).snapshotId).toBe(snapshots.B);
  }, 300_000);

  it('a concurrent remote change between verification and push is rejected (lease), never overwritten', async () => {
    const other = join(work, 'other');
    await runGit(['clone', '-q', '--branch', 'main', bare, other], work);
    let raced = false;
    const racing: GitRunner = async (args, cwd) => {
      if (!raced && args[0] === 'push') {
        raced = true;
        await runGit(['-c', 'user.name=x', '-c', 'user.email=x@x.invalid', 'commit', '-q', '--allow-empty', '-m', 'concurrent publisher'], other);
        await runGit(['push', '-q', 'origin', 'HEAD:refs/heads/main'], other);
      }
      return runGit(args, cwd);
    };
    await expect(publisher({ git: racing }).publish(version('D'))).rejects.toBeInstanceOf(PublishError);
    expect((await subjects())[0]).toBe('concurrent publisher');
    expect((await remoteManifest()).snapshotId).toBe(snapshots.B);
  }, 300_000);

  it('rolls back to A and forward to B by moving only the manifest', async () => {
    await publisher().activate(snapshots.A);
    expect(await browserName()).toBe('BenchPlayer1');
    await publisher().activate(snapshots.B);
    expect(await browserName()).toBe('Remote B 名稱');
    await expect(publisher().activate('s-00000000000000000000')).rejects.toBeInstanceOf(PublishError);
  }, 300_000);

  it('retention keeps the active snapshot plus the most recently active ones, only after the new manifest is pushed', async () => {
    const result = await publisher().publish(version('D'), { keepVersions: 2 });
    expect((await remoteManifest()).snapshotId).toBe(snapshots.D);
    expect((await remoteVersions()).sort()).toEqual([snapshots.B, snapshots.D].sort());
    expect(result.pruned).toEqual([snapshots.A]);
    expect((await subjects()).slice(0, 3)).toEqual([`data: retain current + rollback versions (pruned 1)`, `data: manifest -> ${snapshots.D}`, `data: add immutable version ${snapshots.D}`]);
  }, 300_000);

  it('writes a structured, secret-free audit record for every operation', async () => {
    const records = await Promise.all((await readdir(join(work, 'audit'))).map(async (file) => JSON.parse(await readFile(join(work, 'audit', file), 'utf8')) as PublicationAuditRecord));
    const passed = records.filter((record) => record.result === 'PASS' && record.operation === 'publish');
    expect(passed.length).toBeGreaterThanOrEqual(3);
    for (const record of passed) {
      expect(record).toMatchObject({ event: 'static_publication', branch: 'main', schemaVersion: 1, factSchemaVersion: 'public-facts-v1', privacyGate: 'public-export-gate-v1' });
      expect(record.integrityRoot).toMatch(/^[0-9a-f]{64}$/u);
      expect(record.manifestCommit).toMatch(/^[0-9a-f]{40}$/u);
      expect(record.files).toBeGreaterThan(10);
    }
    expect(records.some((record) => record.result === 'FAIL' && /injected fault/u.test(record.error ?? ''))).toBe(true);
    expect(JSON.stringify(records)).not.toMatch(/token|password|ghp_|github_pat_/iu);
  });
});
