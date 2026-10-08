import { resolve } from 'node:path';
import { GitHubDataRepositoryPublisher, type PublisherFault } from '../server/staticPublish/gitDataRepositoryPublisher.js';

/**
 * `npm run data:publish:github -- --version <exported versions/<id>> [--keep N]`
 * `npm run data:publish:github -- --activate <snapshotId>`          (rollback / roll-forward: manifest only)
 * `npm run data:publish:github -- --remove-inactive <snapshotId>`   (never-activated upload cleanup)
 *
 * TASK-INFRA-STATIC-PUBLICATION-CHANNEL-01: publishes a finalized, privacy-gated version directory to the
 * SEPARATE public data repository (GitHub Pages serves its `main` branch). Authentication: the existing
 * GitHub CLI session, via a credential helper set on the disposable work clone only (no token is stored,
 * printed or committed; inherited helpers are reset for that clone). Never targets the source repository.
 */
function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const SOURCE_REPOSITORY = /github\.com[/:]scottpuppylu\/valorant-squad-analytics(\.git)?$/u;
const remoteUrl = argument('--remote') ?? 'https://github.com/scottpuppylu/valorant-squad-analytics-data.git';
if (SOURCE_REPOSITORY.test(remoteUrl)) throw new Error('Refusing to publish data into the SOURCE repository.');
const fault = argument('--fault') as PublisherFault | undefined;
const publisher = new GitHubDataRepositoryPublisher({
  workDir: resolve(argument('--work-dir') ?? '.local/data-repository'),
  remoteUrl,
  branch: argument('--branch') ?? 'main',
  auditDir: resolve(argument('--audit-dir') ?? '.local/publication-audit'),
  cloneConfig: remoteUrl.startsWith('https://github.com/') ? { 'credential.helper': ['', '!gh auth git-credential'] } : {},
  ...(fault ? { fault } : {}),
});

const version = argument('--version');
const activate = argument('--activate');
const removeInactive = argument('--remove-inactive');
const keep = argument('--keep');
let result: unknown;
if (version) result = await publisher.publish(resolve(version), keep ? { keepVersions: Number(keep) } : {});
else if (activate) result = await publisher.activate(activate);
else if (removeInactive) result = { removedCommit: await publisher.removeInactiveVersion(removeInactive) };
else throw new Error('Usage: data:publish:github -- --version <dir> [--keep N] | --activate <id> | --remove-inactive <id>');
process.stdout.write(`${JSON.stringify({ event: 'static_publish_github', result: 'PASS', ...(result as object) })}\n`);
