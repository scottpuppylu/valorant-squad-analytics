import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { last } from '../src/utils/last';

/** TASK-RELEASE-PRODUCTION-BUILD-HARDENING-01 — `.at(-1)` replacement and the single-run Vercel build architecture. */
describe('last()', () => {
  it('matches Array.prototype.at(-1) for empty, single and multiple items', () => {
    const cases: unknown[][] = [[], [7], [1, 2, 3], ['a', undefined], [null], [{ k: 1 }, { k: 2 }]];
    for (const items of cases) expect(last(items)).toBe(items.at(-1));
    expect(last([])).toBeUndefined();
    expect(last([42])).toBe(42);
    expect(last(['x', 'y', 'z'])).toBe('z');
  });
  it('returns the same reference and never mutates the input (readonly arrays accepted)', () => {
    const tail = { id: 'tail' };
    const items: readonly { id: string }[] = Object.freeze([{ id: 'head' }, tail]);
    expect(last(items)).toBe(tail);
    expect(items).toHaveLength(2);
  });
  it('agrees with at(-1) on generated arrays of every length 0..50', () => {
    for (let n = 0; n <= 50; n += 1) {
      const items = Array.from({ length: n }, (_, i) => (i * 7919) % 101);
      expect(last(items)).toBe(items.at(-1));
    }
  });
});

describe('Vercel build architecture', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { buildCommand?: string };

  it('defines no script name that @vercel/node re-runs for every function entrypoint', () => {
    // @vercel/node runs package.json `vercel-build` / `now-build` once PER api function; with 12 functions the
    // database steps ran 13 times per deployment. The build chain must use a non-magic name.
    expect(pkg.scripts['vercel-build']).toBeUndefined();
    expect(pkg.scripts['now-build']).toBeUndefined();
  });
  it('runs migrate, then fact hydration, then the build — once, from the project build command', () => {
    expect(vercel.buildCommand).toBe('npm run build:vercel');
    expect(pkg.scripts['build:vercel']).toBe('npm run db:migrate:vercel && npm run db:hydrate-facts:vercel && npm run build');
    expect(pkg.scripts['db:migrate:vercel']).toBe('tsx scripts/migrate-vercel.ts');
    expect(pkg.scripts['db:hydrate-facts:vercel']).toBe('tsx scripts/hydrate-analysis-facts-vercel.ts');
  });
  it('the database steps stay gated on Vercel Production', () => {
    for (const file of ['scripts/migrate-vercel.ts', 'scripts/hydrate-analysis-facts-vercel.ts']) {
      expect(readFileSync(file, 'utf8'), file).toContain("process.env.VERCEL_ENV !== 'production'");
    }
  });
});
