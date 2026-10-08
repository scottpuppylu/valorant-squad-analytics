/**
 * TASK-DATA-POSITION-NORMALIZATION-01 — `position-evidence-v1`: deterministic spatial / side evidence from the Henrik v4
 * match document (observed contract, 838 staged documents, docs/POSITION_EVIDENCE.md):
 *
 *   kills[].location                 { x, y }                                    KILL_EVENT_LOCATION
 *   kills[].player_locations[]       { player: { puuid, … }, location: { x, y }, view_radians }   PLAYER_SNAPSHOT_LOCATION + VIEW_DIRECTION
 *   rounds[].plant                   { site, location: { x, y }, player, round_time_in_ms, player_locations }   PLANT_SITE + PLANT_EVENT_LOCATION
 *   rounds[].defuse                  { location: { x, y }, player, round_time_in_ms, player_locations }         DEFUSE_EVENT_LOCATION
 *   rounds[].winning_team_role       'Attacker' | 'Defender' (null / 'None' / 'FreeForAll' elsewhere)          ROUND_SIDE
 *
 * Coordinates are preserved losslessly in the provider's raw, undocumented coordinate system (no transform, no bounds).
 * Snapshots exist only at discrete events: they are never interpolated into paths.
 *
 * Kept separate from `durable-evidence-v2` on purpose: no metric input changes, so the analysis facts engine key and
 * every score stay identical; this version only labels the spatial columns a match was written with.
 */
export const POSITION_EVIDENCE_VERSION = 'position-evidence-v1' as const;

export type SideSource = 'winning_team_role' | 'plant' | 'defuse';
export interface RoundSide {
  /** Provider's explicit role of the round winner, when given. */
  winningTeamRole?: 'Attacker' | 'Defender';
  /** Team key that attacked this round; undefined when no explicit evidence exists or the evidence conflicts. */
  attackingTeamKey?: string;
  sideSource?: SideSource;
  conflict: boolean;
}

/**
 * Attacking team from EXPLICIT per-round evidence only (never from the winner alone, never from half / overtime rules):
 *   winning_team_role Attacker → winner attacks; Defender → the other team attacks;
 *   plant.player.team → planter's team attacks; defuse.player.team → defuser's team defends.
 * Requires exactly two team keys. All available sources must agree; any disagreement leaves the side unknown.
 */
export function deriveRoundSide(input: { teamKeys: readonly string[]; winningTeam?: string; winningTeamRole?: unknown; planterTeam?: string; defuserTeam?: string }): RoundSide {
  const role = input.winningTeamRole === 'Attacker' || input.winningTeamRole === 'Defender' ? input.winningTeamRole : undefined;
  const teams = [...new Set(input.teamKeys)].sort();
  if (teams.length !== 2) return { ...(role ? { winningTeamRole: role } : {}), conflict: false };
  const other = (team: string) => (team === teams[0] ? teams[1]! : teams[0]!);
  const candidates: { team: string; source: SideSource }[] = [];
  if (role && input.winningTeam && teams.includes(input.winningTeam)) candidates.push({ team: role === 'Attacker' ? input.winningTeam : other(input.winningTeam), source: 'winning_team_role' });
  if (input.planterTeam && teams.includes(input.planterTeam)) candidates.push({ team: input.planterTeam, source: 'plant' });
  if (input.defuserTeam && teams.includes(input.defuserTeam)) candidates.push({ team: other(input.defuserTeam), source: 'defuse' });
  const base: Pick<RoundSide, 'winningTeamRole'> = role ? { winningTeamRole: role } : {};
  if (!candidates.length) return { ...base, conflict: false };
  if (candidates.some((c) => c.team !== candidates[0]!.team)) return { ...base, conflict: true };
  return { ...base, attackingTeamKey: candidates[0]!.team, sideSource: candidates[0]!.source, conflict: false };
}

/** Provider site label as given (trimmed); empty or non-string → undefined. Never inferred from coordinates. */
export function plantSiteLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
