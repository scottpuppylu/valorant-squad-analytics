import { afterEach, describe, expect, it } from 'vitest';
import { checkAgentCatalog } from '../server/dataset/agentCatalogCheck';
import { calculatePlayerScores } from '../src/scoring/calculateScores';
import { aggregatePlayerStats } from '../src/utils/aggregateStats';
import {
  AGENT_CATALOG_VERSION, AGENT_DEFINITIONS, AGENT_ROLES_CATALOG_V0, agentRoles, primaryRoleForAgents, resolveAgent, validateAgentCatalog,
} from '../src/utils/agentRoles';
import type { MatchRecord, Player } from '../src/types/valorant';
import { benchDatabase, seedBenchAccounts, seedBenchMatches, type BenchDatabase } from './support/analysisBenchFixture';

/** TASK-DATA-AGENT-CATALOG-01 — agent-catalog-v1 and the AGENT_CATALOG_COMPLETE guard (no network). */
const MIKS = '7c8a4701-4de6-9355-b254-e09bc2a34b72';
const UNRESOLVED = '773f0c78-4486-752b-68ef-4585d7f4b848';
const JETT = 'add6443a-41bd-e414-f6ad-e58d267f4e95';

describe('agent-catalog-v1 lookup', () => {
  it('Miks: stable id and display name both resolve to Controller (Riot official source)', () => {
    const byId = resolveAgent({ id: MIKS });
    expect(byId).toMatchObject({ status: 'known', matchedBy: 'id', definition: { displayName: 'Miks', role: 'Controller', source: 'riot-official' } });
    expect(resolveAgent({ name: 'Miks' })).toMatchObject({ status: 'known', matchedBy: 'name', definition: { canonicalId: MIKS, role: 'Controller' } });
    expect(agentRoles.Miks).toBe('Controller');
  });
  it('known agents resolve by id and by name to the same definition', () => {
    for (const agent of AGENT_DEFINITIONS) {
      expect(resolveAgent({ id: agent.canonicalId })).toMatchObject({ status: 'known', definition: agent });
      expect(resolveAgent({ name: agent.displayName })).toMatchObject({ status: 'known', definition: agent });
    }
    expect(new Set(AGENT_DEFINITIONS.map((agent) => agent.canonicalId)).size).toBe(AGENT_DEFINITIONS.length);
    expect(AGENT_DEFINITIONS).toHaveLength(29);
  });
  it('the stable id wins over a stale, localized or placeholder display name', () => {
    expect(resolveAgent({ id: JETT, name: 'Unknown' })).toMatchObject({ status: 'known', definition: { displayName: 'Jett' } });
    expect(resolveAgent({ id: JETT.toUpperCase(), name: '捷風' })).toMatchObject({ status: 'known', definition: { displayName: 'Jett' } });
  });
  it('the unresolved identity is UNKNOWN: no name, no role, never a fallback', () => {
    expect(resolveAgent({ id: UNRESOLVED, name: 'Unknown' })).toEqual({ status: 'unknown', reason: 'unknown_id', agentId: UNRESOLVED, agentName: 'Unknown' });
    expect(AGENT_DEFINITIONS.some((agent) => agent.canonicalId === UNRESOLVED)).toBe(false);
    expect(agentRoles.Unknown).toBeUndefined();
  });
  it('an unknown id never gains a role through a colliding display name; unknown names and missing identity stay unknown', () => {
    expect(resolveAgent({ id: '00000000-0000-0000-0000-00000000beef', name: 'Jett' })).toMatchObject({ status: 'unknown', reason: 'unknown_id' });
    expect(resolveAgent({ name: 'Brand New Agent' })).toEqual({ status: 'unknown', reason: 'unknown_name', agentName: 'Brand New Agent' });
    expect(resolveAgent({})).toEqual({ status: 'unknown', reason: 'missing_identity' });
    expect(resolveAgent({ id: '  ', name: '' })).toEqual({ status: 'unknown', reason: 'missing_identity' });
  });
  it('no known role never silently becomes Controller (or any role)', () => {
    expect(primaryRoleForAgents(['Unknown', 'Brand New Agent'])).toBeUndefined();
    expect(primaryRoleForAgents([])).toBeUndefined();
    expect(primaryRoleForAgents(['Miks', 'Unknown'])).toBe('Controller');
    expect(primaryRoleForAgents(['Jett', 'Omen', 'Reyna'])).toBe('Duelist');
  });
  it('the frozen v0 map (shared-match-evidence-v1 only) is the pre-Miks catalog and never changes', () => {
    expect(Object.keys(AGENT_ROLES_CATALOG_V0)).toHaveLength(28);
    expect(AGENT_ROLES_CATALOG_V0.Miks).toBeUndefined();
    for (const [name, role] of Object.entries(AGENT_ROLES_CATALOG_V0)) expect(agentRoles[name]).toBe(role);
  });
});

describe('unknown agents fail closed in role-dependent scoring', () => {
  const match = (agent: string, id: number): MatchRecord => ({ id: `m${id}`, playedAt: new Date(Date.UTC(2026, 5, 1 + id)).toISOString(), map: 'Ascent', gameMode: 'Competitive',
    opponent: 'x', scoreFor: 13, scoreAgainst: 9, won: true, durationMinutes: 40,
    performances: [{ playerId: 'p1', agent, kills: 18, deaths: 14, assists: 5, acs: 230, adr: 150 }] });
  const score = (agents: string[], roles?: Record<string, never>) => {
    const matches = agents.map(match);
    const player = { id: 'p1', handle: 'p1', displayName: 'p1', agents, ...(primaryRoleForAgents(agents) ? { role: primaryRoleForAgents(agents) } : {}) } as unknown as Player;
    return calculatePlayerScores(player, aggregatePlayerStats(player, matches), matches, undefined, roles ? { roles } : {});
  };
  it('an only-unknown-agent member gets no role-dependent value and no invented role', () => {
    const scores = score(['Unknown', 'Unknown', 'Unknown']);
    expect(scores.firepower.value).toBeUndefined();
    expect(scores.firepower.trace.selectedRole).toBeUndefined();
    expect(scores.firepower.trace.components.every((c) => c.selectedRole === undefined && c.omissionReason === 'Unknown selected agent role')).toBe(true);
    expect(scores.roleValue.value).toBeUndefined();
  });
  it('Miks rounds count once Miks is in the catalog; the frozen v0 map still treats them as unknown', () => {
    expect(score(['Miks', 'Miks', 'Miks']).firepower.value).toBeDefined();
    expect(score(['Miks', 'Miks', 'Miks'], AGENT_ROLES_CATALOG_V0 as Record<string, never>).firepower.value).toBeUndefined();
  });
});

describe('AGENT_CATALOG_COMPLETE guard', () => {
  const rows = [
    { agentId: JETT, agentName: 'Jett', rows: 95 }, { agentId: MIKS, agentName: 'Miks', rows: 109 },
    { agentId: UNRESOLVED, agentName: 'Unknown', rows: 29 }, { agentId: null, agentName: null, rows: 2 },
  ];
  it('reports known / unknown / missing rows and surfaces the unresolved stable id', () => {
    const result = validateAgentCatalog(rows);
    expect(result).toMatchObject({ version: AGENT_CATALOG_VERSION, complete: false, totalRows: 235, knownRows: 204, unknownRows: 29, missingRows: 2, nameMismatchRows: 0 });
    expect(result.unknownIdentities[0]).toEqual({ agentId: UNRESOLVED, agentName: 'Unknown', reason: 'unknown_id', rows: 29 });
    expect(result.coveragePercent).toBeCloseTo(100 * 204 / 235);
  });
  it('flags a known id stored with a drifted name (name-keyed analytics would otherwise miss it)', () => {
    const result = validateAgentCatalog([{ agentId: JETT, agentName: 'Unknown', rows: 3 }]);
    expect(result).toMatchObject({ complete: false, nameMismatchRows: 3, unknownIdentities: [{ agentId: JETT, agentName: 'Unknown', reason: 'name_mismatch', rows: 3 }] });
  });
  it('is complete only when everything resolves; deterministic and input-order independent', () => {
    expect(validateAgentCatalog(rows.slice(0, 2)).complete).toBe(true);
    expect(validateAgentCatalog([...rows].reverse())).toEqual(validateAgentCatalog(rows));
    expect(validateAgentCatalog(rows.flatMap((row) => Array.from({ length: row.rows }, () => ({ agentId: row.agentId, agentName: row.agentName })))))
      .toEqual(validateAgentCatalog(rows));
    expect(validateAgentCatalog([])).toMatchObject({ complete: true, totalRows: 0, coveragePercent: 100 });
  });
});

describe('durable-store guard (PGlite = real PostgreSQL)', () => {
  const open: BenchDatabase[] = [];
  afterEach(async () => { while (open.length) await open.pop()!.close(); });
  it('detects a future unknown agent identity among linked participants only', async () => {
    const db = await benchDatabase(); open.push(db);
    await seedBenchAccounts(db, { matches: 12 });
    await seedBenchMatches(db, { matches: 12, seed: 3 });
    const before = await checkAgentCatalog(db);
    expect(before.complete).toBe(true);
    await db.query(`UPDATE match_participants SET agent_id=$1, agent_name='Unknown'
      WHERE id=(SELECT id FROM match_participants WHERE player_id IS NOT NULL ORDER BY id LIMIT 1)`, [UNRESOLVED]);
    await db.query(`UPDATE match_participants SET agent_id='feedface-0000-0000-0000-000000000000', agent_name='Brand New Agent'
      WHERE id=(SELECT id FROM match_participants WHERE player_id IS NULL ORDER BY id LIMIT 1)`);
    const after = await checkAgentCatalog(db);
    expect(after).toMatchObject({ complete: false, unknownRows: 1, unknownIdentities: [{ agentId: UNRESOLVED, agentName: 'Unknown', reason: 'unknown_id', rows: 1 }] });
    expect(after.totalRows).toBe(before.totalRows);
  }, 120_000);
});
