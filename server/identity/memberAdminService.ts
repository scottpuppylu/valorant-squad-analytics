import type { SqlDatabase } from '../db/types.js';

/**
 * TASK-IDENTITY-01 maintainer-only member administration (member-identity-v1).
 * Used ONLY by scripts/member-admin.ts and tests: never imported by api/ or src/, never an HTTP
 * endpoint. Every statement is parameterized and keyed by PUBLIC ids. Output never contains
 * internal ids, PUUIDs, HMACs, credentials or secrets. Consent, provider identities, sync,
 * deletion jobs and match participants stay with the ACCOUNT; only players.member_id moves.
 */
export type MemberAdminErrorCode =
  | 'INVALID_NAME' | 'MEMBER_NOT_FOUND' | 'MEMBER_ARCHIVED' | 'ACCOUNT_NOT_FOUND' | 'ACCOUNT_ANONYMIZED'
  | 'ALREADY_LINKED' | 'ACCOUNT_COAPPEARANCE_CONFLICT';

export class MemberAdminError extends Error {
  constructor(readonly code: MemberAdminErrorCode, message: string) {
    super(message);
    this.name = 'MemberAdminError';
  }
}

export interface MemberListing {
  memberId: string;
  displayName: string;
  nameSource: 'legacy_account' | 'community';
  archived: boolean;
  accounts: { accountId: string; riotId: string; primary: boolean; deleted: boolean }[];
}

export interface IdentityInvariants {
  members: number;
  archivedMembers: number;
  accounts: number;
  liveAccounts: number;
  accountsWithoutMember: number;
  membersWithMultiplePrimaries: number;
  activeMembersWithoutLiveAccount: number;
  liveAccountsOnArchivedMember: number;
  sameMatchMemberCollisions: number;
  accountsPerMember: Record<string, number>;
}

/** 1–32 visible characters after NFC + trim; no control/format characters. */
export function validateMemberName(input: string): string {
  const name = input.normalize('NFC').trim();
  if ([...name].length < 1 || [...name].length > 32 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)) {
    throw new MemberAdminError('INVALID_NAME', '成員名稱需為 1–32 個可見字元，且不可包含控制字元。');
  }
  return name;
}

export class MemberAdminService {
  constructor(private readonly database: SqlDatabase, private readonly now = () => new Date()) {}

  async list(): Promise<MemberListing[]> {
    const result = await this.database.query<{
      member_id: string; display_name: string; name_source: 'legacy_account' | 'community'; archived: boolean;
      account_id: string | null; riot_id: string | null; is_primary_account: boolean | null; deleted: boolean | null;
    }>(`SELECT m.public_id::text AS member_id, m.display_name, m.display_name_source AS name_source,
              (m.archived_at IS NOT NULL) AS archived, p.public_id::text AS account_id,
              p.display_name || '#' || p.display_tag AS riot_id, p.is_primary_account,
              (p.anonymized_at IS NOT NULL) AS deleted
       FROM members m LEFT JOIN players p ON p.member_id=m.id
       ORDER BY m.archived_at NULLS FIRST, m.public_id, p.is_primary_account DESC, p.public_id`);
    const members = new Map<string, MemberListing>();
    for (const row of result.rows) {
      const member = members.get(row.member_id) ?? { memberId: row.member_id, displayName: row.display_name, nameSource: row.name_source, archived: row.archived, accounts: [] };
      if (row.account_id) member.accounts.push({ accountId: row.account_id, riotId: row.deleted ? '(已刪除帳號)' : row.riot_id!, primary: row.is_primary_account === true, deleted: row.deleted === true });
      members.set(row.member_id, member);
    }
    return [...members.values()];
  }

  /** Changes ONLY the member's community name (never Riot account names/tags). */
  async renameMember(memberPublicId: string, displayName: string): Promise<{ memberId: string; displayName: string; nameSource: 'community' }> {
    const name = validateMemberName(displayName);
    const result = await this.database.query(
      `UPDATE members SET display_name=$2, display_name_source='community', updated_at=$3
       WHERE public_id=$1::uuid AND archived_at IS NULL`, [memberPublicId, name, this.now().toISOString()]);
    if (result.rowCount !== 1) throw await this.memberMissing(memberPublicId);
    return { memberId: memberPublicId, displayName: name, nameSource: 'community' };
  }

  /**
   * Explicit maintainer link: move ACCOUNT X to MEMBER Y. Fails closed (no mutation) when X ever
   * appeared in the same source match as any account already linked to Y — strong evidence of
   * two different people. An emptied source member is archived, never deleted.
   */
  async linkAccount(accountPublicId: string, memberPublicId: string): Promise<{ accountId: string; memberId: string; primary: boolean; sourceMemberArchived: boolean }> {
    return this.database.transaction(async (tx) => {
      const target = (await tx.query<{ id: string; archived: boolean }>(
        'SELECT id, (archived_at IS NOT NULL) AS archived FROM members WHERE public_id=$1::uuid FOR UPDATE', [memberPublicId])).rows[0];
      if (!target) throw new MemberAdminError('MEMBER_NOT_FOUND', '找不到這個成員。');
      if (target.archived) throw new MemberAdminError('MEMBER_ARCHIVED', '成員已封存，不能連結帳號。');
      const account = (await tx.query<{ id: string; member_id: string; anonymized: boolean; primary: boolean }>(
        `SELECT id, member_id, (anonymized_at IS NOT NULL) AS anonymized, is_primary_account AS primary
         FROM players WHERE public_id=$1::uuid FOR UPDATE`, [accountPublicId])).rows[0];
      if (!account) throw new MemberAdminError('ACCOUNT_NOT_FOUND', '找不到這個帳號。');
      if (account.anonymized) throw new MemberAdminError('ACCOUNT_ANONYMIZED', '帳號已刪除，不能連結。');
      if (account.member_id === target.id) throw new MemberAdminError('ALREADY_LINKED', '帳號已屬於這個成員。');
      const conflict = await tx.query<{ conflicts: number }>(
        `SELECT count(DISTINCT a.source_match_id)::int AS conflicts
         FROM match_participants a
         JOIN match_participants b ON b.source_match_id=a.source_match_id AND b.id<>a.id
         JOIN players o ON o.id=b.player_id
         WHERE a.player_id=$1 AND o.member_id=$2 AND o.id<>$1`, [account.id, target.id]);
      if ((conflict.rows[0]?.conflicts ?? 0) > 0) {
        throw new MemberAdminError('ACCOUNT_COAPPEARANCE_CONFLICT', '此帳號曾與該成員的帳號出現在同一場對戰，判定為不同人，拒絕連結。');
      }
      const at = this.now().toISOString();
      const hasPrimary = (await tx.query<{ present: boolean }>(
        'SELECT EXISTS(SELECT 1 FROM players WHERE member_id=$1 AND is_primary_account) AS present', [target.id])).rows[0]?.present === true;
      await tx.query('UPDATE players SET is_primary_account=false WHERE id=$1', [account.id]);
      await tx.query('UPDATE players SET member_id=$2, is_primary_account=$3, updated_at=$4 WHERE id=$1', [account.id, target.id, !hasPrimary, at]);
      await tx.query('UPDATE members SET updated_at=$2 WHERE id=$1', [target.id, at]);
      const source = account.member_id;
      const remaining = await tx.query<{ id: string; primary: boolean }>(
        `SELECT id, is_primary_account AS primary FROM players WHERE member_id=$1 AND anonymized_at IS NULL
         ORDER BY created_at, public_id`, [source]);
      let sourceMemberArchived = false;
      const anyAccount = (await tx.query<{ present: boolean }>('SELECT EXISTS(SELECT 1 FROM players WHERE member_id=$1) AS present', [source])).rows[0]?.present === true;
      if (!anyAccount || remaining.rows.length === 0) {
        await tx.query('UPDATE members SET archived_at=$2, updated_at=$2 WHERE id=$1 AND archived_at IS NULL', [source, at]);
        sourceMemberArchived = true;
      } else if (account.primary && !remaining.rows.some((row) => row.primary)) {
        await tx.query('UPDATE players SET is_primary_account=true WHERE id=$1', [remaining.rows[0]!.id]);
        await tx.query('UPDATE members SET updated_at=$2 WHERE id=$1', [source, at]);
      }
      return { accountId: accountPublicId, memberId: memberPublicId, primary: !hasPrimary, sourceMemberArchived };
    });
  }

  /** Atomically makes ACCOUNT X its member's single primary (presentation/refresh metadata only). */
  async setPrimary(accountPublicId: string): Promise<{ accountId: string; primary: true }> {
    return this.database.transaction(async (tx) => {
      const account = (await tx.query<{ id: string; member_id: string; anonymized: boolean }>(
        'SELECT id, member_id, (anonymized_at IS NOT NULL) AS anonymized FROM players WHERE public_id=$1::uuid FOR UPDATE', [accountPublicId])).rows[0];
      if (!account) throw new MemberAdminError('ACCOUNT_NOT_FOUND', '找不到這個帳號。');
      if (account.anonymized) throw new MemberAdminError('ACCOUNT_ANONYMIZED', '帳號已刪除，不能設為主帳。');
      await tx.query('UPDATE players SET is_primary_account=false WHERE member_id=$1 AND is_primary_account AND id<>$2', [account.member_id, account.id]);
      await tx.query('UPDATE players SET is_primary_account=true WHERE id=$1', [account.id]);
      return { accountId: accountPublicId, primary: true as const };
    });
  }

  /** Read-only aggregate invariants (no identifiers). */
  async invariants(): Promise<IdentityInvariants> {
    const row = (await this.database.query<Record<string, number>>(`SELECT
        (SELECT count(*)::int FROM members) AS members,
        (SELECT count(*)::int FROM members WHERE archived_at IS NOT NULL) AS archived_members,
        (SELECT count(*)::int FROM players) AS accounts,
        (SELECT count(*)::int FROM players WHERE anonymized_at IS NULL) AS live_accounts,
        (SELECT count(*)::int FROM players WHERE member_id IS NULL) AS accounts_without_member,
        (SELECT count(*)::int FROM (SELECT member_id FROM players WHERE is_primary_account GROUP BY member_id HAVING count(*)>1) x) AS multiple_primaries,
        (SELECT count(*)::int FROM members m WHERE m.archived_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM players p WHERE p.member_id=m.id AND p.anonymized_at IS NULL)) AS active_without_live,
        (SELECT count(*)::int FROM players p JOIN members m ON m.id=p.member_id
           WHERE p.anonymized_at IS NULL AND m.archived_at IS NOT NULL) AS live_on_archived,
        (SELECT count(*)::int FROM (SELECT mp.source_match_id, p.member_id FROM match_participants mp
           JOIN players p ON p.id=mp.player_id GROUP BY 1,2 HAVING count(*)>1) c) AS collisions`)).rows[0]!;
    const distribution = await this.database.query<{ accounts: number; members: number }>(
      `SELECT accounts, count(*)::int AS members FROM (SELECT m.id, count(p.id)::int AS accounts FROM members m
         LEFT JOIN players p ON p.member_id=m.id AND p.anonymized_at IS NULL WHERE m.archived_at IS NULL GROUP BY m.id) d
       GROUP BY accounts ORDER BY accounts`);
    return {
      members: row.members!, archivedMembers: row.archived_members!, accounts: row.accounts!, liveAccounts: row.live_accounts!,
      accountsWithoutMember: row.accounts_without_member!, membersWithMultiplePrimaries: row.multiple_primaries!,
      activeMembersWithoutLiveAccount: row.active_without_live!, liveAccountsOnArchivedMember: row.live_on_archived!,
      sameMatchMemberCollisions: row.collisions!,
      accountsPerMember: Object.fromEntries(distribution.rows.map((item) => [String(item.accounts), item.members])),
    };
  }

  private async memberMissing(memberPublicId: string): Promise<MemberAdminError> {
    const exists = await this.database.query<{ archived: boolean }>('SELECT (archived_at IS NOT NULL) AS archived FROM members WHERE public_id=$1::uuid', [memberPublicId]);
    return exists.rows[0]?.archived ? new MemberAdminError('MEMBER_ARCHIVED', '成員已封存。') : new MemberAdminError('MEMBER_NOT_FOUND', '找不到這個成員。');
  }
}
