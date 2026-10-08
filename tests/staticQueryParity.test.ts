import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgresExportSources, withConsistentReadSnapshot } from '../server/staticExport/sources';
import { StaticQueryEngine, analysisRequestOf } from '../src/dataSources/static/StaticQueryEngine';
import { analysisSearchParams, weaponSearchParams, type StaticSnapshotIndex } from '../src/dataSources/static/contract';
import { parseAnalysisRequest } from '../server/dataset/analysisService';
import { decodeSkeleton, type FactsMeta, type SkeletonChunk } from '../src/dataSources/static/publicFacts';
import type { DatasetAnalyticsContextResponse } from '../src/dataSources/server/contracts';
import type { BenchDatabase } from './support/analysisBenchFixture';
import { exportFrom, seededStaticDatabase } from './support/staticSnapshotFixture';
import { analysisParityCases, weaponParityCases, type ParityFacts } from './support/queryParityCases';

/**
 * TASK-INFRA-STATIC-QUERY-PARITY-01 QUERY PARITY ORACLE (synthetic data, PGlite = real PostgreSQL).
 * SERVER_RESULT = the live route's services over the database; STATIC_RESULT = the browser engine over the
 * exported public facts. Required: byte-identical JSON for every case (no tolerance, no normalization).
 * STATIC_PARITY_LEVEL=full runs the larger generated set (evidence run); the default is the CI set.
 */
const level = process.env.STATIC_PARITY_LEVEL === 'full' ? 'full' : 'ci';
let db: BenchDatabase;
let work: string;
let engine: StaticQueryEngine;
let facts: ParityFacts;
const firstDifference = (a: unknown, b: unknown, path = ''): string | undefined => {
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    if (JSON.stringify(Object.keys(a)) !== JSON.stringify(Object.keys(b))) return `${path} keys ${JSON.stringify(Object.keys(a)).slice(0, 200)} vs ${JSON.stringify(Object.keys(b)).slice(0, 200)}`;
    for (const key of keys) { const found = firstDifference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`); if (found) return found; }
  }
  return `${path}: ${JSON.stringify(a)?.slice(0, 160)} vs ${JSON.stringify(b)?.slice(0, 160)}`;
};
const numericLeaves = (value: unknown): number => (typeof value === 'number' ? 1 : value && typeof value === 'object' ? Object.values(value).reduce<number>((sum, child) => sum + numericLeaves(child), 0) : 0);

beforeAll(async () => {
  db = await seededStaticDatabase(360, 9, { weapons: true });
  work = await mkdtemp(join(tmpdir(), 'static-parity-'));
  const exported = await exportFrom(db, join(work, 'export'), { tier: 'facts' });
  const index = JSON.parse(await readFile(join(exported.directory, 'index.json'), 'utf8')) as StaticSnapshotIndex;
  expect(Object.keys(index.analysis)).toEqual([]);
  expect(Object.keys(index.weapons)).toEqual([]);
  engine = new StaticQueryEngine(async (path) => JSON.parse(await readFile(join(exported.directory, path), 'utf8')), index.facts!);
  const meta = JSON.parse(await readFile(join(exported.directory, 'facts', 'meta.json'), 'utf8')) as FactsMeta;
  const analytics = JSON.parse(await readFile(join(exported.directory, 'analytics.json'), 'utf8')) as DatasetAnalyticsContextResponse;
  const skeletons = (await Promise.all(meta.skeletonFiles.map(async (file) => JSON.parse(await readFile(join(exported.directory, file), 'utf8')) as SkeletonChunk)))
    .flatMap((chunk) => chunk.skeletons.map(decodeSkeleton)).sort((a, b) => a.playedAt.localeCompare(b.playedAt));
  facts = {
    players: meta.players.map((player) => player.id), maps: analytics.facets!.maps.map((item) => item.map).sort(), agents: [...analytics.facets!.agents].sort(),
    modes: [...analytics.facets!.gameModes].sort(), acts: analytics.evidence.season.acts.map((act) => act.key).sort(),
    earliest: skeletons[0]!.playedAt, latest: skeletons.at(-1)!.playedAt, oneDay: skeletons[Math.floor(skeletons.length / 3)]!.playedAt, middle: skeletons[Math.floor(skeletons.length / 2)]!.playedAt,
  };
}, 600_000);
afterAll(async () => { await db.close(); await rm(work, { recursive: true, force: true }); });

describe(`static query parity vs the live server services (${level})`, () => {
  it('the browser request mapping equals the route parser for every generated query', () => {
    for (const query of analysisParityCases(facts, level)) {
      expect(analysisRequestOf(query), JSON.stringify(query)).toEqual(parseAnalysisRequest(Object.fromEntries(analysisSearchParams(query))));
    }
  });

  it('every analysis query (single, all-pairs, 3-way, custom dates, recent N, Act, form, Synergy, progress) is byte-identical', async () => {
    const cases = analysisParityCases(facts, level);
    const failures: string[] = [];
    let numbers = 0;
    const features = new Map<string, number>();
    await withConsistentReadSnapshot(db, async (snapshot) => {
      const server = postgresExportSources(snapshot);
      for (const query of cases) {
        const [expected, actual] = [await server.analysis(query), await engine.analysis(query)];
        const difference = firstDifference(expected, actual);
        if (difference) failures.push(`${JSON.stringify(query)} → ${difference}`);
        else numbers += numericLeaves(expected);
        features.set(query.feature, (features.get(query.feature) ?? 0) + 1);
      }
    });
    await writeFile(join(tmpdir(), `static-parity-${level}-analysis.json`), JSON.stringify({ level, total: cases.length, pass: cases.length - failures.length, fail: failures.length, numbers, features: Object.fromEntries(features), failures: failures.slice(0, 20) }, null, 2));
    expect(failures.slice(0, 5)).toEqual([]);
    expect(cases.length).toBeGreaterThan(level === 'full' ? 600 : 150);
    expect(numbers).toBeGreaterThan(1000);
  }, 1_800_000);

  it('every weapon query (member × scope × map × agent × mode, incl. CURRENT and an unobserved Act) is byte-identical', async () => {
    const cases = weaponParityCases(facts, level);
    const failures: string[] = [];
    let numbers = 0;
    await withConsistentReadSnapshot(db, async (snapshot) => {
      const server = postgresExportSources(snapshot);
      for (const query of cases) {
        const [expected, actual] = [await server.weapons(query), await engine.weapons(query)];
        const difference = firstDifference(expected, actual);
        if (difference) failures.push(`${weaponSearchParams(query).toString()} → ${difference}`);
        else numbers += numericLeaves(expected);
      }
    });
    await writeFile(join(tmpdir(), `static-parity-${level}-weapons.json`), JSON.stringify({ level, total: cases.length, pass: cases.length - failures.length, fail: failures.length, numbers, failures: failures.slice(0, 20) }, null, 2));
    expect(failures.slice(0, 5)).toEqual([]);
    // The synthetic weapon evidence must be non-trivial (otherwise parity would be vacuous).
    expect(numbers).toBeGreaterThan(5000);
  }, 1_800_000);
});
