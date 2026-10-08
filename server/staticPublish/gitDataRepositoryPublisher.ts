import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { renameWithRetry } from '../staticExport/renameWithRetry.js';
import { verifyVersionDirectory, PublishError, type PublishResult, type SnapshotPublisher } from '../staticExport/publisher.js';
import {
  STATIC_SNAPSHOT_SCHEMA_VERSION, STATIC_SNAPSHOT_VERSION, isStaticManifest, isStaticSnapshotIndex, staticVersionPath, type StaticManifest,
} from '../../src/dataSources/static/contract.js';

/**
 * TASK-INFRA-STATIC-PUBLICATION-CHANNEL-01 publisher for a SEPARATE public Git data repository (GitHub Pages
 * serves its branch). Pure transport: it reads a finalized local version directory (exporter output) and
 * never touches PostgreSQL, analytics or the source repository.
 *
 * Atomic visibility, same contract as LocalFilesystemPublisher:
 *   1. verify the local version (integrity.json SHA-256)          4. verify every remote blob (SHA-256)
 *   2. sync the disposable work clone to the remote branch head   5. commit + push manifest.json LAST
 *   3. commit + push the immutable version directory              6. optional retention commit (after 5)
 * Every push is a plain fast-forward from the head verified in step 2: if another publisher moved the branch,
 * the push is rejected (lease semantics without force). A failure before step 5 leaves the previous manifest —
 * and therefore the previous snapshot — active; nothing active is ever deleted before the new manifest is pushed.
 */
export const DATA_REPOSITORY_README = `# valorant-squad-analytics-data

Derived **public** static read-model distribution for
[valorant-squad-analytics](https://github.com/scottpuppylu/valorant-squad-analytics).

- **Generated automatically** by the project's publisher. Do not edit by hand.
- **Not the source of truth.** PostgreSQL is authoritative; everything here can be rebuilt from it at any time.
- Contains only privacy-gated public data: no secrets, credentials, internal identifiers, PUUIDs or HMACs.
- \`manifest.json\` points at exactly one immutable \`versions/<snapshot-id>/\` directory and is always written last.
- Only the current snapshot plus a few rollback snapshots are retained; this repository's history may be rewritten or
  compacted as part of retention.
`;

export type GitRunner = (args: string[], cwd: string) => Promise<string>;
const execFileAsync = promisify(execFile);
export const runGit: GitRunner = async (args, cwd) => (await execFileAsync('git', args, { cwd, maxBuffer: 256 * 1024 * 1024, windowsHide: true })).stdout;

export type PublisherFault = 'before-version-push' | 'after-version-push' | 'before-manifest-push';

export interface GitDataRepositoryOptions {
  /** Disposable local clone of the data repository (created on first use). */
  workDir: string;
  /** Remote URL (GitHub HTTPS URL, or a local bare repository in tests). */
  remoteUrl: string;
  branch: string;
  /** Directory for structured, secret-free publication audit records. */
  auditDir: string;
  /** Git config applied to the work clone only (e.g. a credential helper that defers to the existing gh session). */
  cloneConfig?: Record<string, string | string[]>;
  git?: GitRunner;
  /** Test-only fault injection. */
  fault?: PublisherFault;
  clock?: () => Date;
}

export interface PublicationAuditRecord {
  event: 'static_publication'; result: 'PASS' | 'FAIL'; operation: 'publish' | 'activate';
  remote: string; branch: string; snapshotId: string; schemaVersion: number; factSchemaVersion: string | null;
  files: number; rawBytes: number; integrityRoot: string; privacyGate: string;
  manifestPrevious: string | null; manifestNew: string | null; versionCommit: string | null; manifestCommit: string | null; retentionCommit: string | null;
  pruned: string[]; startedAt: string; endedAt: string; error?: string;
}

const PUBLISHER_IDENTITY = ['-c', 'user.name=valorant-squad-analytics-publisher', '-c', 'user.email=publisher@valorant-squad-analytics.invalid'];
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

export class GitDataRepositoryPublisher implements SnapshotPublisher {
  private readonly git: GitRunner;
  private readonly clock: () => Date;

  constructor(private readonly options: GitDataRepositoryOptions) {
    this.git = options.git ?? runGit;
    this.clock = options.clock ?? (() => new Date());
  }

  private run(args: string[]) { return this.git(args, this.options.workDir); }

  /** Step 2: a clean work tree exactly at the remote branch head; returns that head (the lease). */
  private async sync(): Promise<string | null> {
    const { workDir, remoteUrl, branch } = this.options;
    if (!(await stat(join(workDir, '.git')).then(() => true, () => false))) {
      await mkdir(workDir, { recursive: true });
      await this.git(['init', '-q', '-b', branch], workDir);
      await this.run(['remote', 'add', 'origin', remoteUrl]);
    }
    await this.run(['config', 'core.autocrlf', 'false']);
    for (const [key, value] of Object.entries(this.options.cloneConfig ?? {})) {
      if (typeof value === 'string') { await this.run(['config', key, value]); continue; }
      // Multi-valued (e.g. credential.helper: ['' to reset inherited helpers, then the gh-session helper]).
      await this.run(['config', '--unset-all', key]).catch(() => '');
      for (const item of value) await this.run(['config', '--add', key, item]);
    }
    const heads = (await this.run(['ls-remote', '--heads', 'origin', branch])).trim();
    if (!heads) return null; // empty remote: the first publication creates the branch
    await this.run(['fetch', '-q', 'origin', branch]);
    await this.run(['checkout', '-q', '-B', branch, `origin/${branch}`]);
    await this.run(['reset', '-q', '--hard', `origin/${branch}`]);
    await this.run(['clean', '-qfdx']);
    return (await this.run(['rev-parse', 'HEAD'])).trim();
  }

  private async commitAndPush(message: string, paths: string[], lease: string | null): Promise<string> {
    await this.run(['add', '-A', '--', ...paths]);
    await this.run([...PUBLISHER_IDENTITY, 'commit', '-q', '--allow-empty', '-m', message]);
    const head = (await this.run(['rev-parse', 'HEAD'])).trim();
    const parent = (await this.run(['rev-list', '--parents', '-n', '1', 'HEAD'])).trim().split(' ')[1] ?? null;
    if (parent !== lease) throw new PublishError('the work clone moved away from the verified remote head.');
    // Plain fast-forward push: rejected if the remote branch is no longer at the verified head.
    await this.run(['push', '-q', 'origin', `HEAD:refs/heads/${this.options.branch}`]);
    const remote = (await this.run(['ls-remote', '--heads', 'origin', this.options.branch])).trim().split(/\s+/u)[0];
    if (remote !== head) throw new PublishError('the remote branch does not point at the pushed commit.');
    return head;
  }

  /** Step 4: every file of the version, read back from the remote commit, matches integrity.json. */
  private async verifyRemote(commit: string, snapshotId: string, files: { path: string; sha256: string; bytes: number }[]) {
    await this.run(['fetch', '-q', 'origin', this.options.branch]);
    const remoteHead = (await this.run(['rev-parse', `origin/${this.options.branch}`])).trim();
    if (remoteHead !== commit) throw new PublishError('remote head changed during verification.');
    const prefix = staticVersionPath(snapshotId);
    const listed = (await this.run(['ls-tree', '-r', '--name-only', commit, '--', prefix])).split('\n').filter(Boolean);
    const expected = new Set([...files.map((file) => `${prefix}${file.path}`), `${prefix}integrity.json`]);
    if (listed.length !== expected.size || listed.some((path) => !expected.has(path))) throw new PublishError('remote version tree does not match integrity.json.');
    for (const file of files) {
      const blob = Buffer.from(await this.git(['show', `${commit}:${prefix}${file.path}`], this.options.workDir), 'utf8');
      if (blob.length !== file.bytes || sha256(blob) !== file.sha256) throw new PublishError(`remote integrity mismatch for ${file.path}.`);
    }
  }

  private async manifestAt(ref: string): Promise<StaticManifest | null> {
    const text = await this.run(['show', `${ref}:manifest.json`]).catch(() => '');
    if (!text) return null;
    const value = JSON.parse(text) as unknown;
    return isStaticManifest(value) ? value : null;
  }

  private async writeManifest(manifest: StaticManifest) {
    if (!isStaticManifest(manifest)) throw new PublishError('manifest is invalid.');
    const temporary = join(this.options.workDir, 'manifest.json.tmp');
    await writeFile(temporary, `${JSON.stringify(manifest)}\n`);
    await renameWithRetry(temporary, join(this.options.workDir, 'manifest.json'));
  }

  /** Previously ACTIVE snapshots, newest first (from the manifest history), for rollback retention. */
  private async activeHistory(): Promise<string[]> {
    const log = await this.run(['log', '--format=%H', '--', 'manifest.json']).catch(() => '');
    const ids: string[] = [];
    for (const commit of log.split('\n').filter(Boolean)) {
      const manifest = await this.manifestAt(commit);
      if (manifest && !ids.includes(manifest.snapshotId)) ids.push(manifest.snapshotId);
    }
    return ids;
  }

  private async audit(record: PublicationAuditRecord) {
    await mkdir(this.options.auditDir, { recursive: true });
    const name = `${record.startedAt.replace(/[:.]/gu, '-')}-${record.operation}-${record.snapshotId}.json`;
    await writeFile(join(this.options.auditDir, name), `${JSON.stringify(record, null, 2)}\n`);
  }

  async publish(versionDirectory: string, options: { generatedAt?: Date; keepVersions?: number } = {}): Promise<PublishResult> {
    const startedAt = this.clock().toISOString();
    const integrity = await verifyVersionDirectory(versionDirectory);
    const index = JSON.parse(await readFile(join(versionDirectory, 'index.json'), 'utf8')) as unknown;
    if (!isStaticSnapshotIndex(index)) throw new PublishError('index.json is invalid.');
    const snapshotId = integrity.snapshotId;
    const factMeta = index.facts ? JSON.parse(await readFile(join(versionDirectory, index.facts), 'utf8')) as { factSchemaVersion?: string } : undefined;
    const record: PublicationAuditRecord = {
      event: 'static_publication', result: 'FAIL', operation: 'publish', remote: this.options.remoteUrl.replace(/\/\/[^@/]+@/u, '//'), branch: this.options.branch,
      snapshotId, schemaVersion: index.schemaVersion, factSchemaVersion: factMeta?.factSchemaVersion ?? null,
      files: integrity.files.length, rawBytes: integrity.files.reduce((sum, file) => sum + file.bytes, 0),
      integrityRoot: sha256(integrity.files.map((file) => `${file.path}\t${file.sha256}`).join('\n')),
      privacyGate: (JSON.parse(await readFile(join(versionDirectory, 'integrity.json'), 'utf8')) as { gateVersion?: string }).gateVersion ?? 'unknown',
      manifestPrevious: null, manifestNew: null, versionCommit: null, manifestCommit: null, retentionCommit: null, pruned: [], startedAt, endedAt: startedAt,
    };
    try {
      let lease = await this.sync();
      const previous = lease ? await this.manifestAt('HEAD') : null;
      record.manifestPrevious = previous?.snapshotId ?? null;
      const target = join(this.options.workDir, staticVersionPath(snapshotId));
      const present = await stat(target).then(() => true, () => false);
      if (!present) {
        if (!lease) await this.ensureRepositoryFiles();
        await cp(versionDirectory, target, { recursive: true, errorOnExist: true, force: false });
        await verifyVersionDirectory(target);
        if (this.options.fault === 'before-version-push') throw new PublishError('injected fault before the version push.');
        lease = record.versionCommit = await this.commitAndPush(`data: add immutable version ${snapshotId}`, ['.'], lease);
      } else {
        await verifyVersionDirectory(target);
      }
      if (this.options.fault === 'after-version-push') throw new PublishError('injected fault after the version push.');
      await this.verifyRemote(lease!, snapshotId, integrity.files);
      if (this.options.fault === 'before-manifest-push') throw new PublishError('injected fault before the manifest push.');
      // 5. manifest LAST.
      await this.writeManifest({ schemaVersion: STATIC_SNAPSHOT_SCHEMA_VERSION, snapshotVersion: STATIC_SNAPSHOT_VERSION, snapshotId,
        dataVersion: index.dataVersion, generatedAt: (options.generatedAt ?? this.clock()).toISOString() });
      lease = record.manifestCommit = await this.commitAndPush(`data: manifest -> ${snapshotId}`, ['manifest.json'], lease);
      record.manifestNew = snapshotId;
      // 6. retention, only after the new manifest is confirmed on the remote.
      if (options.keepVersions !== undefined) {
        const pruned = await this.prune(snapshotId, options.keepVersions);
        if (pruned.length > 0) { record.retentionCommit = await this.commitAndPush(`data: retain current + rollback versions (pruned ${pruned.length})`, ['versions'], lease); record.pruned = pruned; }
      }
      record.result = 'PASS';
      return { snapshotId, ...(previous ? { previousSnapshotId: previous.snapshotId } : {}), copied: !present, pruned: record.pruned };
    } catch (error) {
      record.error = error instanceof Error ? error.message.replace(/https?:\/\/[^\s@]+@/gu, 'https://') : 'publication failed';
      throw error instanceof PublishError ? error : new PublishError(record.error);
    } finally {
      record.endedAt = this.clock().toISOString();
      await this.audit(record);
    }
  }

  /** Rollback / roll-forward: point the manifest at a version already present (and verified) on the remote. */
  async activate(snapshotId: string, options: { generatedAt?: Date } = {}): Promise<PublishResult> {
    const startedAt = this.clock().toISOString();
    const record: PublicationAuditRecord = {
      event: 'static_publication', result: 'FAIL', operation: 'activate', remote: this.options.remoteUrl.replace(/\/\/[^@/]+@/u, '//'), branch: this.options.branch,
      snapshotId, schemaVersion: STATIC_SNAPSHOT_SCHEMA_VERSION, factSchemaVersion: null, files: 0, rawBytes: 0, integrityRoot: '', privacyGate: 'n/a (already published)',
      manifestPrevious: null, manifestNew: null, versionCommit: null, manifestCommit: null, retentionCommit: null, pruned: [], startedAt, endedAt: startedAt,
    };
    try {
      const lease = await this.sync();
      if (!lease) throw new PublishError('the data repository is empty.');
      const previous = await this.manifestAt('HEAD');
      record.manifestPrevious = previous?.snapshotId ?? null;
      const directory = join(this.options.workDir, staticVersionPath(snapshotId));
      const integrity = await verifyVersionDirectory(directory);
      await this.verifyRemote(lease, snapshotId, integrity.files);
      const index = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8')) as { dataVersion: string };
      record.files = integrity.files.length;
      record.rawBytes = integrity.files.reduce((sum, file) => sum + file.bytes, 0);
      record.integrityRoot = sha256(integrity.files.map((file) => `${file.path}\t${file.sha256}`).join('\n'));
      await this.writeManifest({ schemaVersion: STATIC_SNAPSHOT_SCHEMA_VERSION, snapshotVersion: STATIC_SNAPSHOT_VERSION, snapshotId,
        dataVersion: index.dataVersion, generatedAt: (options.generatedAt ?? this.clock()).toISOString() });
      record.manifestCommit = await this.commitAndPush(`data: manifest -> ${snapshotId} (activate)`, ['manifest.json'], lease);
      record.manifestNew = snapshotId;
      record.result = 'PASS';
      return { snapshotId, ...(previous ? { previousSnapshotId: previous.snapshotId } : {}), copied: false, pruned: [] };
    } catch (error) {
      record.error = error instanceof Error ? error.message : 'activation failed';
      throw error instanceof PublishError ? error : new PublishError(record.error);
    } finally {
      record.endedAt = this.clock().toISOString();
      await this.audit(record);
    }
  }

  /**
   * Removes an UNPUBLISHED version directory (never active, e.g. an interrupted upload). Refuses the active
   * snapshot and every snapshot that was ever active (those are only removed by retention).
   */
  async removeInactiveVersion(snapshotId: string): Promise<string> {
    const lease = await this.sync();
    if (!lease) throw new PublishError('the data repository is empty.');
    if ((await this.activeHistory()).includes(snapshotId)) throw new PublishError('refusing to remove a snapshot that was active.');
    await rm(join(this.options.workDir, staticVersionPath(snapshotId)), { recursive: true, force: true });
    return this.commitAndPush(`data: remove never-activated version ${snapshotId}`, ['versions'], lease);
  }

  /** Keep the active snapshot plus the most recently active ones (up to `keep` total); drop everything else. */
  private async prune(activeId: string, keep: number): Promise<string[]> {
    if (!Number.isSafeInteger(keep) || keep < 1) throw new PublishError('keepVersions must be a positive integer.');
    const retained = new Set([activeId, ...(await this.activeHistory()).filter((id) => id !== activeId).slice(0, keep - 1)]);
    const root = join(this.options.workDir, 'versions');
    const pruned: string[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || retained.has(entry.name)) continue;
      await rm(join(root, entry.name), { recursive: true, force: true });
      pruned.push(entry.name);
    }
    return pruned.sort();
  }

  /** First publication: repository-level files (no Jekyll processing, byte-exact JSON). */
  private async ensureRepositoryFiles() {
    await writeFile(join(this.options.workDir, '.nojekyll'), '');
    await writeFile(join(this.options.workDir, '.gitattributes'), '* -text\n');
    await writeFile(join(this.options.workDir, 'README.md'), DATA_REPOSITORY_README);
  }
}

/** The GitHub Pages instance of the transport (a public data repository served from its branch root). */
export class GitHubDataRepositoryPublisher extends GitDataRepositoryPublisher {}
