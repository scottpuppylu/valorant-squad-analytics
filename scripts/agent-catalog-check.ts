import { envValue, openStagingDatabase } from '../server/rebuildStaging/localConfig.js';
import { RebuildStagingStore } from '../server/rebuildStaging/stagingStore.js';
import { AGENT_CATALOG_VERSION, validateAgentCatalog } from '../src/utils/agentRoles.js';

/**
 * `npm run agents:check` — TASK-DATA-AGENT-CATALOG-01 completeness guard over the PRIVATE staging store (read-only,
 * 0 provider requests). Reports AGENT_CATALOG_COMPLETE for tracked member-matches (all modes and Competitive) and for
 * every participant. Output: agent ids (public content ids), agent names and counts only. Exit code 2 when incomplete
 * and `--strict` is passed, so it can gate future sync / data validation.
 */
const database = openStagingDatabase({ applicationName: 'vsa-agent-catalog-check' });
try {
  await new RebuildStagingStore(database, envValue('rebuild-hmac.env', 'REBUILD_HMAC_KEY')).initialize(); // refuses application databases
  const rows = (await database.query<{ agent_id: string | null; agent_name: string | null; tracked: boolean; competitive: boolean; n: string }>(
    `SELECT p->'agent'->>'id' AS agent_id, p->'agent'->>'name' AS agent_name,
            (p->>'puuid') IN (SELECT provider_puuid FROM rebuild_staging.accounts WHERE provider_puuid IS NOT NULL) AS tracked,
            (mp.payload->'metadata'->'queue'->>'name') = 'Competitive' AS competitive, count(*)::text AS n
     FROM rebuild_staging.match_payloads mp CROSS JOIN LATERAL jsonb_array_elements(mp.payload->'players') p
     GROUP BY 1, 2, 3, 4`)).rows;
  const view = (filter: (row: (typeof rows)[number]) => boolean) =>
    validateAgentCatalog(rows.filter(filter).map((row) => ({ agentId: row.agent_id, agentName: row.agent_name, rows: Number(row.n) })));
  const result = { version: AGENT_CATALOG_VERSION, trackedAllModes: view((row) => row.tracked), trackedCompetitive: view((row) => row.tracked && row.competitive),
    allParticipants: view(() => true) };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (process.argv.includes('--strict') && !result.trackedAllModes.complete) process.exitCode = 2;
} finally {
  await database.close();
}
