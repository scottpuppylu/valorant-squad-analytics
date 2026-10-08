import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renameWithRetry } from './renameWithRetry.js';
import {
  STATIC_SNAPSHOT_SCHEMA_VERSION, STATIC_SNAPSHOT_VERSION, isStaticManifest, isStaticSnapshotIndex, staticVersionPath, type StaticManifest,
} from '../../src/dataSources/static/contract.js';

/**
 * TASK-INFRA-STATIC-DATA-PUBLISH-01 publication boundary. The exporter only produces a finalized local
 * version directory; a publisher distributes it. GitHub (a dedicated data repository, see
 * docs/STATIC_DATA_PUBLISH.md), a NAS, a local web root or another static host are all just publishers.
 *
 * Contract of every publisher (atomic visibility):
 *   1. upload/copy the whole immutable version directory;
 *   2. verify it at the destination (integrity.json SHA-256 of every file);
 *   3. ONLY THEN replace manifest.json (the single mutable file);
 *   4. optionally prune versions that are neither current nor within the rollback window.
 * A failure before step 3 leaves the previous manifest — and therefore the previous snapshot — active.
 */
export interface SnapshotPublisher {
  publish(versionDirectory: string, options?: { generatedAt?: Date; keepVersions?: number }): Promise<PublishResult>;
}

export interface PublishResult { snapshotId: string; previousSnapshotId?: string; copied: boolean; pruned: string[] }

interface IntegrityFile { snapshotId: string; files: { path: string; bytes: number; sha256: string }[] }

const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

export class PublishError extends Error {
  constructor(message: string) { super(message); this.name = 'PublishError'; }
}

/** Verifies every file listed in integrity.json (and that nothing unlisted is present except integrity.json). */
export async function verifyVersionDirectory(directory: string): Promise<IntegrityFile> {
  const integrity = JSON.parse(await readFile(join(directory, 'integrity.json'), 'utf8')) as IntegrityFile;
  if (!integrity || typeof integrity.snapshotId !== 'string' || !Array.isArray(integrity.files) || integrity.files.length === 0) throw new PublishError('integrity.json is invalid.');
  const listed = new Set(integrity.files.map((file) => file.path));
  for (const file of integrity.files) {
    if (!/^[a-z]+(\/[a-z0-9-]+)*\.json$/u.test(file.path)) throw new PublishError(`unexpected path ${file.path}.`);
    const bytes = await readFile(join(directory, file.path)).catch(() => undefined);
    if (!bytes) throw new PublishError(`missing ${file.path}.`);
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new PublishError(`integrity mismatch for ${file.path}.`);
  }
  const present: string[] = [];
  const walk = async (dir: string, prefix: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), path); else present.push(path);
    }
  };
  await walk(directory, '');
  const extra = present.filter((path) => path !== 'integrity.json' && !listed.has(path));
  if (extra.length > 0) throw new PublishError(`unlisted file ${extra[0]}.`);
  const index = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8')) as unknown;
  if (!isStaticSnapshotIndex(index) || index.snapshotId !== integrity.snapshotId) throw new PublishError('index.json does not match integrity.json.');
  return integrity;
}

/** Publishes to a local directory that a static web server (Caddy, a NAS share, …) serves as-is. */
export class LocalFilesystemPublisher implements SnapshotPublisher {
  constructor(private readonly targetRoot: string) {}

  private async currentManifest(): Promise<StaticManifest | undefined> {
    const text = await readFile(join(this.targetRoot, 'manifest.json'), 'utf8').catch(() => undefined);
    if (!text) return undefined;
    const manifest = JSON.parse(text) as unknown;
    return isStaticManifest(manifest) ? manifest : undefined;
  }

  async publish(versionDirectory: string, options: { generatedAt?: Date; keepVersions?: number } = {}): Promise<PublishResult> {
    const source = await verifyVersionDirectory(versionDirectory);
    const index = JSON.parse(await readFile(join(versionDirectory, 'index.json'), 'utf8')) as { dataVersion: string };
    const snapshotId = source.snapshotId;
    const destination = join(this.targetRoot, staticVersionPath(snapshotId));
    const previous = await this.currentManifest();
    await mkdir(join(this.targetRoot, 'versions'), { recursive: true });

    // 1–2. Copy into a temporary sibling, verify, then rename into place (an existing version is immutable).
    let copied = false;
    if (await stat(destination).then(() => true, () => false)) {
      await verifyVersionDirectory(destination);
    } else {
      const partial = `${destination.replace(/[\\/]$/u, '')}.partial`;
      await rm(partial, { recursive: true, force: true });
      try {
        await cp(versionDirectory, partial, { recursive: true, errorOnExist: true, force: false });
        await verifyVersionDirectory(partial);
        await renameWithRetry(partial, destination.replace(/[\\/]$/u, ''));
      } catch (error) {
        await rm(partial, { recursive: true, force: true });
        throw error;
      }
      copied = true;
    }

    // 3. The manifest is replaced LAST and atomically (write temp + rename).
    const manifest: StaticManifest = {
      schemaVersion: STATIC_SNAPSHOT_SCHEMA_VERSION, snapshotVersion: STATIC_SNAPSHOT_VERSION, snapshotId,
      dataVersion: index.dataVersion, generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    };
    if (!isStaticManifest(manifest)) throw new PublishError('manifest is invalid.');
    const temporary = join(this.targetRoot, 'manifest.json.tmp');
    await writeFile(temporary, `${JSON.stringify(manifest)}\n`);
    await renameWithRetry(temporary, join(this.targetRoot, 'manifest.json'));

    // 4. Retention: current + previous rollback window; never the active version.
    const pruned: string[] = [];
    const keep = options.keepVersions;
    if (keep !== undefined) {
      if (!Number.isSafeInteger(keep) || keep < 1) throw new PublishError('keepVersions must be a positive integer.');
      const versions = await Promise.all((await readdir(join(this.targetRoot, 'versions'), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^s-[0-9a-f]{20}$/u.test(entry.name))
        .map(async (entry) => ({ id: entry.name, mtime: (await stat(join(this.targetRoot, 'versions', entry.name))).mtimeMs })));
      const ordered = versions.filter((version) => version.id !== snapshotId).sort((a, b) => b.mtime - a.mtime || (a.id < b.id ? 1 : -1));
      for (const version of ordered.slice(Math.max(0, keep - 1))) {
        await rm(join(this.targetRoot, 'versions', version.id), { recursive: true, force: true });
        pruned.push(version.id);
      }
    }
    return { snapshotId, ...(previous ? { previousSnapshotId: previous.snapshotId } : {}), copied, pruned };
  }
}
