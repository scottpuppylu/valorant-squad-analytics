import type { AgentName, PlayerRole } from '../types/valorant.js';

export const agentRoles: Readonly<Record<string, PlayerRole>> = {
  Jett: 'Duelist', Raze: 'Duelist', Phoenix: 'Duelist', Reyna: 'Duelist', Yoru: 'Duelist', Neon: 'Duelist', Iso: 'Duelist', Waylay: 'Duelist',
  Sova: 'Initiator', Breach: 'Initiator', Skye: 'Initiator', 'KAY/O': 'Initiator', Fade: 'Initiator', Gekko: 'Initiator', Tejo: 'Initiator',
  Omen: 'Controller', Brimstone: 'Controller', Viper: 'Controller', Astra: 'Controller', Harbor: 'Controller', Clove: 'Controller',
  Sage: 'Sentinel', Cypher: 'Sentinel', Killjoy: 'Sentinel', Chamber: 'Sentinel', Deadlock: 'Sentinel', Vyse: 'Sentinel', Veto: 'Sentinel',
};

export function primaryRoleForAgents(agents: AgentName[], fallback: PlayerRole = 'Controller'): PlayerRole {
  const counts = new Map<PlayerRole, number>();
  for (const agent of agents) {
    const role = agentRoles[agent];
    if (role) counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? fallback;
}
