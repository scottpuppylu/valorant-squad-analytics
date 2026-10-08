import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POOL_OPTIONS } from '../server/db/postgres';

/**
 * TASK-INFRA-DATABASE-PORTABILITY-01 deterministic architecture guards (CI fails on regression):
 * PostgreSQL is the persistence contract; no proprietary database SDK in runtime code; Production locality
 * (PostgreSQL never published); bounded pools; no secrets in deployment assets.
 */
function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : files(path, pattern);
    return pattern.test(name) ? [path] : [];
  });
}
const runtimeSources = ['server', 'api', 'scripts', 'shared', 'src'].flatMap((dir) => files(dir, /\.(ts|tsx|mjs|js)$/u));
const read = (path: string) => readFileSync(path, 'utf8');

describe('PostgreSQL portability guards', () => {
  it('no runtime source imports a proprietary database provider SDK or the removed Neon factory', () => {
    const offenders = runtimeSources.filter((path) => /@neondatabase\/|createNeonDatabase|NeonDatabase|@vercel\/postgres|@supabase\/|@planetscale\//u.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it('package.json depends on standard pg and on no database provider SDK', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.dependencies.pg).toBeDefined();
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(all).filter((name) => /neondatabase|@vercel\/postgres|@supabase|planetscale/u.test(name))).toEqual([]);
    // PGlite is test/local only.
    expect(pkg.dependencies['@electric-sql/pglite']).toBeUndefined();
  });

  it('every runtime database handle comes from the standard factory (server/db/runtime.ts)', () => {
    const runtimes = ['server/dataset/runtime.ts', 'server/deletion/runtime.ts', 'server/persistence/runtime.ts', 'server/sync/runtime.ts', 'server/sync/scheduledRuntime.ts'];
    for (const path of runtimes) expect(read(path)).toMatch(/getSharedDatabase\(\)/u);
    const direct = runtimeSources.filter((path) => path !== join('server', 'db', 'postgres.ts') && /from ['"]pg['"]|new pg\.Pool|new Pool\(/u.test(read(path)));
    expect(direct).toEqual([]);
    expect(runtimeSources.filter((path) => /from ['"]@electric-sql\/pglite['"]/u.test(read(path)) && !path.startsWith('tests'))).toEqual([]);
  });

  it('the Production pool is small and bounded', () => {
    expect(DEFAULT_POOL_OPTIONS.max).toBeLessThanOrEqual(10);
    expect(DEFAULT_POOL_OPTIONS.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(DEFAULT_POOL_OPTIONS.idleTimeoutMillis).toBeGreaterThan(0);
    expect(DEFAULT_POOL_OPTIONS.statementTimeoutMillis).toBeLessThanOrEqual(60_000);
  });
});

describe('static data publication guards (TASK-INFRA-STATIC-DATA-PUBLISH-01)', () => {
  const browserSources = files('src', /\.(ts|tsx)$/u);
  const exportSources = files(join('server', 'staticExport'), /\.ts$/u);

  it('the browser never calls a provider API (page views are decoupled from provider rate limits)', () => {
    expect(browserSources.filter((path) => /henrikdev\.xyz|https?:\/\/[^'"`\s]*(riotgames\.com|\.pvp\.net)/iu.test(read(path)))).toEqual([]);
    // Only the two data clients fetch: same-origin `/api` (ValorantBackendClient) and the static snapshot client.
    expect(browserSources.filter((path) => /\bfetch\(/u.test(read(path))).sort()).toEqual([
      join('src', 'dataSources', 'server', 'ValorantBackendClient.ts'), join('src', 'dataSources', 'static', 'StaticSnapshotClient.ts'),
      join('src', 'dataSources', 'static', 'staticQueryWorker.ts')]);
    const staticClient = files(join('src', 'dataSources', 'static'), /\.ts$/u).map(read).join('\n');
    expect(staticClient).not.toMatch(/['"`]\/api\/|github|method:\s*['"]POST|refreshRecent\s*\(/iu);
  });

  it('the exporter has no GitHub / network / Git coupling (publication is a separate, replaceable publisher)', () => {
    for (const path of exportSources) expect(read(path), path).not.toMatch(/octokit|api\.github|from ['"]node:(https?|child_process|net\/http)['"]|\bfetch\(|git (push|commit)/iu);
  });

  it('PostgreSQL stays the source of truth: the exporter reads one READ ONLY snapshot and no runtime reads public JSON back', () => {
    expect(read(join('server', 'staticExport', 'sources.ts'))).toMatch(/SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY/u);
    for (const path of exportSources) expect(read(path), path).not.toMatch(/from ['"]\.\.\/(sync|persistence|deletion|provider)\//u);
    const runtime = [...files('api', /\.ts$/u), ...files('server', /\.ts$/u)
      .filter((path) => !path.startsWith(join('server', 'staticExport')) && !path.startsWith(join('server', 'staticPublish')))];
    expect(runtime.filter((path) => /manifest\.json|public-data|staticExport/u.test(read(path)))).toEqual([]);
  });

  it('the publisher is pure transport: no database, dataset, analytics or exporter logic and no credential', () => {
    const publish = files(join('server', 'staticPublish'), /\.ts$/u);
    expect(publish.length).toBeGreaterThan(0);
    for (const path of publish) {
      expect(read(path), path).not.toMatch(/from ['"]\.\.\/(db|dataset|sync|persistence)\/|from ['"]\.\.\/staticExport\/(exporter|sources|privacy|catalog)|analysisCore|ghp_|github_pat_|GITHUB_TOKEN/u);
    }
  });

  it('exported snapshots and published data never enter the source repository', () => {
    expect(read('.gitignore')).toMatch(/^public-data\/$/mu);
    expect(read('.gitignore')).toMatch(/^static-snapshots\/$/mu);
  });
});

describe('VPS deployment locality and secret guards', () => {
  const compose = read('infra/compose.yaml');
  const service = (name: string) => {
    const start = compose.indexOf(`\n  ${name}:\n`);
    expect(start).toBeGreaterThan(-1);
    const rest = compose.slice(start + 1);
    const next = rest.slice(3).search(/\n {2}[a-z][a-z0-9-]*:\n|\n[a-z]/u);
    return next === -1 ? rest : rest.slice(0, next + 3);
  };

  it('only the Caddy edge publishes ports; PostgreSQL and the API never do', () => {
    for (const name of ['postgres', 'app', 'migrate', 'scheduler']) expect(service(name)).not.toMatch(/^\s+ports:/mu);
    expect(service('web')).toMatch(/"80:80"/u);
    expect(service('web')).toMatch(/"443:443"/u);
    expect(compose).not.toMatch(/5432:5432|0\.0\.0\.0:5432/u);
  });

  it('PostgreSQL is attached only to the internal network, which has no Internet route', () => {
    expect(service('postgres')).toMatch(/networks: \[app-internal\]/u);
    expect(compose).toMatch(/app-internal:\n {4}internal: true/u);
    expect(service('postgres')).toMatch(/postgres-data:\/var\/lib\/postgresql\/data/u);
  });

  it('deployment assets contain placeholders only — no real secret or credentialed URL', () => {
    const assets = ['infra/compose.yaml', 'infra/Caddyfile', 'infra/env.example', 'infra/postgres.env.example', 'Dockerfile', 'infra/backup/backup-postgres.sh', 'infra/restore/restore-postgres.sh'];
    for (const path of assets) {
      const text = read(path);
      for (const match of text.matchAll(/postgres(?:ql)?:\/\/([^:@\s]+):([^@\s]+)@/gu)) expect(match[2]).toBe('CHANGE_ME');
      for (const match of text.matchAll(/^(POSTGRES_PASSWORD|HENRIK_API_KEY|IDENTIFIER_HMAC_KEY|CRON_SECRET)=(.*)$/gmu)) expect(match[2]).toMatch(/^CHANGE_ME/u);
    }
    expect(read('Dockerfile')).not.toMatch(/COPY[^\n]*\.env|ARG [A-Z_]*(KEY|SECRET|PASSWORD)/u);
    expect(read('.dockerignore')).toMatch(/^\.env$/mu);
    expect(read('.gitignore')).toMatch(/^infra\/env\/$/mu);
  });

  it('the database container never receives application secrets; every service using the app image can build it', () => {
    expect(service('postgres')).toMatch(/env_file: \.\/env\/postgres\.env/u);
    expect(service('postgres')).not.toMatch(/production\.env/u);
    expect(read('infra/postgres.env.example')).not.toMatch(/HENRIK_API_KEY|IDENTIFIER_HMAC_KEY|CRON_SECRET|DATABASE_URL=/u);
    for (const name of ['migrate', 'app', 'scheduler']) expect(service(name)).toMatch(/build: \{ context: \.\., dockerfile: Dockerfile, target: app \}/u);
  });

  // Regression (TASK-INFRA-LOCAL-RUNTIME-BOOTSTRAP-01): the scheduler reuses the app image, whose HEALTHCHECK
  // probes :3000/healthz, which only the API serves; on a real Docker runtime it stayed unhealthy forever.
  it('only the API keeps the image HTTP healthcheck; the non-HTTP scheduler disables it', () => {
    expect(read('Dockerfile')).toMatch(/HEALTHCHECK[^\n]*\n[^\n]*127\.0\.0\.1:3000\/healthz/u);
    expect(service('scheduler')).toMatch(/healthcheck: \{ disable: true \}/u);
    expect(service('app')).not.toMatch(/healthcheck: \{ disable: true \}/u);
  });

  it('the production image runs as a non-root user on compiled JavaScript with production dependencies only', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toMatch(/npm ci --omit=dev/u);
    expect(dockerfile).toMatch(/^USER node$/mu);
    expect(dockerfile).toMatch(/CMD \["node", "dist-server\/server\/node\/main\.js"\]/u);
    expect(dockerfile).not.toMatch(/npm run dev|tsx /u);
  });

  it('backups are never accepted without a restore procedure that verifies the checksum and refuses non-empty targets', () => {
    const backup = read('infra/backup/backup-postgres.sh');
    const restore = read('infra/restore/restore-postgres.sh');
    expect(backup).toMatch(/pg_dump[^\n]*-Fc/u);
    expect(backup).toMatch(/sha256sum/u);
    expect(restore).toMatch(/sha256sum -c/u);
    expect(restore).toMatch(/not empty — refusing/u);
    expect(restore).toMatch(/--single-transaction --exit-on-error/u);
  });
});
