import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { StaticQueryEngine } from '../src/dataSources/static/StaticQueryEngine.js';
import type { StaticSnapshotIndex } from '../src/dataSources/static/contract.js';
import { decodeSkeleton, type FactsMeta, type SkeletonChunk } from '../src/dataSources/static/publicFacts.js';
import type { DatasetAnalyticsContextResponse } from '../src/dataSources/server/contracts.js';
import { analysisParityCases, weaponParityCases } from '../tests/support/queryParityCases.js';

/**
 * `npm run data:bench -- --version <versions/<id>> [--level ci|full]` (TASK-INFRA-STATIC-QUERY-PARITY-01).
 * LOCAL measurement only: runs the browser StaticQueryEngine (same V8 engine as Chrome) over an exported
 * snapshot's public facts for the generated parity query set; reports cold/warm latency percentiles and the
 * fact bytes loaded. No network, no database.
 */
function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
const directory = resolve(argument('--version') ?? '');
const level = argument('--level') === 'full' ? 'full' : 'ci';
const index = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8')) as StaticSnapshotIndex;
if (!index.facts) throw new Error('This snapshot has no public facts.');
let bytes = 0;
const loader = async (path: string) => { const text = await readFile(join(directory, path), 'utf8'); bytes += Buffer.byteLength(text); return JSON.parse(text) as unknown; };
const meta = JSON.parse(await readFile(join(directory, 'facts', 'meta.json'), 'utf8')) as FactsMeta;
const analytics = JSON.parse(await readFile(join(directory, 'analytics.json'), 'utf8')) as DatasetAnalyticsContextResponse;
const skeletons = (await Promise.all(meta.skeletonFiles.map(async (file) => JSON.parse(await readFile(join(directory, file), 'utf8')) as SkeletonChunk)))
  .flatMap((chunk) => chunk.skeletons.map(decodeSkeleton)).sort((a, b) => a.playedAt.localeCompare(b.playedAt));
const facts = {
  players: meta.players.map((player) => player.id), maps: analytics.facets!.maps.map((item) => item.map).sort(), agents: [...analytics.facets!.agents].sort(),
  modes: [...analytics.facets!.gameModes].sort(), acts: analytics.evidence.season.acts.map((act) => act.key).sort(),
  earliest: skeletons[0]!.playedAt, latest: skeletons.at(-1)!.playedAt, oneDay: skeletons[Math.floor(skeletons.length / 3)]!.playedAt, middle: skeletons[Math.floor(skeletons.length / 2)]!.playedAt,
};
const percentile = (values: number[], p: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0; };
const round = (value: number) => Math.round(value * 10) / 10;

const engine = new StaticQueryEngine(loader, index.facts);
// Cold: the first query loads meta + skeletons + its chunks.
let started = performance.now();
await engine.analysis({ feature: 'currentStrength', form: true });
const cold = performance.now() - started;
const coldBytes = bytes;
const timings: { query: string; ms: number }[] = [];
for (const query of analysisParityCases(facts, level)) {
  started = performance.now();
  await engine.analysis(query);
  timings.push({ query: JSON.stringify(query), ms: performance.now() - started });
}
const weaponTimings: number[] = [];
for (const query of weaponParityCases(facts, level)) {
  started = performance.now();
  await engine.weapons(query);
  weaponTimings.push(performance.now() - started);
}
const ms = timings.map((timing) => timing.ms);
const worst = timings.reduce((a, b) => (b.ms > a.ms ? b : a));
process.stdout.write(`${JSON.stringify({
  event: 'static_query_bench', level, skeletons: skeletons.length, analysisQueries: ms.length, weaponQueries: weaponTimings.length,
  coldFirstQueryMs: round(cold), coldBytesLoaded: coldBytes,
  analysis: { p50: round(percentile(ms, 50)), p95: round(percentile(ms, 95)), max: round(worst.ms), worst: worst.query },
  weapons: { p50: round(percentile(weaponTimings, 50)), p95: round(percentile(weaponTimings, 95)), max: round(Math.max(...weaponTimings)) },
  peakFactBytesLoaded: bytes, heapUsedMb: round(process.memoryUsage().heapUsed / 1048576),
})}\n`);
