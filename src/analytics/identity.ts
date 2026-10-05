import type { MatchRecord, Player, PublicAccount } from '../types/valorant';

/**
 * TASK-IDENTITY-01 (member-identity-v1) presentation helpers. Analytics are always MEMBER-level
 * (all eligible accounts merged at evidence grain before scoping/scoring); these helpers only
 * describe the accounts behind a member.
 */
export const MEMBER_IDENTITY_VERSION = 'member-identity-v1' as const;

/** Primary first, then stable public id order. Single-account members get no 主帳/小帳 label. */
export function memberAccounts(player: Player): Array<PublicAccount & { roleLabel?: string }> {
  const accounts = [...(player.accounts ?? [])].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.id.localeCompare(b.id));
  if (accounts.length <= 1) return accounts;
  return accounts.map((account) => ({ ...account, roleLabel: account.label ?? (account.isPrimary ? '主帳' : '小帳') }));
}

/** Matches per account in a dataset (only multi-account members carry accountId). */
export function accountMatchCounts(matches: MatchRecord[], memberId: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of matches) {
    for (const performance of match.performances) {
      if (performance.playerId === memberId && performance.accountId) counts.set(performance.accountId, (counts.get(performance.accountId) ?? 0) + 1);
    }
  }
  return counts;
}
