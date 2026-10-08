import { resolve } from 'node:path';
import { LocalFilesystemPublisher } from '../server/staticExport/publisher.js';

/**
 * `npm run data:publish:local -- --version <exported versions/<id> dir> --target <static web root> [--keep N]`
 *
 * LOCAL filesystem publication only (TASK-INFRA-STATIC-DATA-PUBLISH-01): copy + verify the immutable version,
 * then replace manifest.json last. No network, no credentials, no Git. A remote publisher (e.g. a dedicated
 * GitHub data repository) is a separate, not-yet-authorized implementation of the same SnapshotPublisher.
 */
function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const version = argument('--version');
const target = argument('--target');
const keep = argument('--keep');
if (!version || !target) throw new Error('Usage: data:publish:local -- --version <dir> --target <dir> [--keep N]');
const result = await new LocalFilesystemPublisher(resolve(target)).publish(resolve(version), keep ? { keepVersions: Number(keep) } : {});
process.stdout.write(`${JSON.stringify({ event: 'static_publish_local', result: 'PASS', ...result })}\n`);
