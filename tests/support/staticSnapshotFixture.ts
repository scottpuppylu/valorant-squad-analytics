import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hydrateAnalysisFacts } from '../../server/dataset/analysisFactHydration';
import { exportStaticSnapshot, type StaticExportOptions } from '../../server/staticExport/exporter';
import { postgresExportSources, withConsistentReadSnapshot, type StaticExportSources } from '../../server/staticExport/sources';
import { benchDatabase, seedBenchAccounts, seedBenchMatches, type BenchDatabase } from './analysisBenchFixture';

/** Synthetic, fictional data only (TASK-INFRA-STATIC-DATA-PUBLISH-01): 7 accounts → 6 members, Acts, all queues. */
export async function seededStaticDatabase(matches = 160, seed = 9, options: { weapons?: boolean } = {}): Promise<BenchDatabase> {
  const db = await benchDatabase();
  await seedBenchAccounts(db, { matches, accounts: 7, linkAccounts: [[6, 1]] });
  await seedBenchMatches(db, { matches, accounts: 7, seed });
  if (options.weapons) await seedWeaponEvidence(db);
  await hydrateAnalysisFacts(db);
  return db;
}

/**
 * Deterministic synthetic weapon evidence (the bench fixture has none): known catalog weapons, a name-only
 * weapon, an unknown weapon, an ability, missing/unavailable rounds, partial loadout and round scores.
 */
export async function seedWeaponEvidence(db: BenchDatabase) {
  await db.query(`UPDATE round_participants rp SET
      weapon_evidence_status = CASE WHEN x.h % 10 < 8 THEN 'observed' WHEN x.h % 10 = 8 THEN 'missing' ELSE 'unavailable' END,
      weapon_id = CASE x.h % 7 WHEN 0 THEN 'w-vandal-0001' WHEN 1 THEN 'w-phantom-0002' WHEN 2 THEN 'w-operator-0003' WHEN 3 THEN 'w-sheriff-0004' WHEN 5 THEN 'w-mystery-0006' ELSE NULL END,
      weapon_name = CASE x.h % 7 WHEN 0 THEN 'Vandal' WHEN 1 THEN 'Phantom' WHEN 2 THEN 'Operator' WHEN 3 THEN 'Sheriff' WHEN 4 THEN 'Ghost' WHEN 5 THEN 'Mystery Blaster' ELSE NULL END,
      loadout_evidence_status = CASE WHEN x.h % 6 = 0 THEN 'missing' ELSE 'observed' END,
      loadout_value = CASE WHEN x.h % 6 = 0 THEN NULL ELSE 800 + (x.h % 40) * 100 END,
      score = CASE WHEN rp.stats_evidence_status = 'observed' AND x.h % 9 <> 0 THEN 50 + x.h % 300 ELSE NULL END
    FROM (SELECT id, abs(hashtext(id::text)) AS h FROM round_participants) x WHERE x.id = rp.id`);
  await db.query(`UPDATE kill_events ke SET
      weapon_id = CASE x.h % 6 WHEN 0 THEN 'w-vandal-0001' WHEN 1 THEN 'w-phantom-0002' WHEN 2 THEN 'w-operator-0003' ELSE NULL END,
      weapon_name = CASE x.h % 6 WHEN 0 THEN 'Vandal' WHEN 1 THEN 'Phantom' WHEN 2 THEN 'Operator' WHEN 3 THEN 'Ghost' WHEN 4 THEN 'Showstopper' ELSE NULL END
    FROM (SELECT id, abs(hashtext(id::text)) AS h FROM kill_events) x WHERE x.id = ke.id`);
}

export async function exportFrom(db: BenchDatabase, outputRoot: string, options: Partial<StaticExportOptions> & { wrap?: (sources: StaticExportSources) => StaticExportSources } = {}) {
  const { wrap, ...rest } = options;
  return withConsistentReadSnapshot(db, (snapshot) => exportStaticSnapshot({
    sources: (wrap ?? ((sources) => sources))(postgresExportSources(snapshot)), database: snapshot, outputRoot, ...rest,
  }));
}

export const STATIC_TEST_ORIGIN = 'http://static.test/data/';

/** A `fetch` over a local static root (what any static host serves); logs every requested URL. */
export function fileFetch(root: string, log: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    log.push(url);
    if (!url.startsWith(STATIC_TEST_ORIGIN)) return new Response('not found', { status: 404 });
    const path = decodeURIComponent(url.slice(STATIC_TEST_ORIGIN.length).split('?')[0]!);
    if (path.includes('..')) return new Response('bad', { status: 400 });
    const body = await readFile(join(root, path), 'utf8').catch(() => undefined);
    return body === undefined ? new Response('not found', { status: 404 }) : new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}
