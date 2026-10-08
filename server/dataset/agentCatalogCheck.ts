import type { SqlExecutor } from '../db/types.js';
import { validateAgentCatalog, type AgentCatalogValidation } from '../../src/utils/agentRoles.js';

/**
 * TASK-DATA-AGENT-CATALOG-01 — AGENT_CATALOG_COMPLETE over the durable store: every stored (agent_id, agent_name) of
 * LINKED participants (the analytics population) is checked against agent-catalog-v1. Read-only, one statement,
 * deterministic; agent ids are public static content ids (no player identifier is read or returned).
 */
export async function checkAgentCatalog(executor: SqlExecutor): Promise<AgentCatalogValidation> {
  const rows = (await executor.query<{ agent_id: string | null; agent_name: string | null; n: string }>(
    `SELECT mp.agent_id, mp.agent_name, count(*)::text AS n FROM match_participants mp
     WHERE mp.player_id IS NOT NULL GROUP BY mp.agent_id, mp.agent_name ORDER BY mp.agent_id NULLS FIRST, mp.agent_name NULLS FIRST`)).rows;
  return validateAgentCatalog(rows.map((row) => ({ agentId: row.agent_id, agentName: row.agent_name, rows: Number(row.n) })));
}
