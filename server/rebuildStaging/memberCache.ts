/**
 * Private member cache (local-rebuild-members-v1), built ONLY from the already-cached public Production dataset
 * response plus ops/community-names-2026-10-06.json, using the established EXACT game-name rule (no fuzzy
 * matching, no additional accounts). The file lives in ~/.vsa-rebuild/members.json (600) and is never committed.
 */
export const MEMBER_CACHE_VERSION = 'local-rebuild-members-v1' as const;

export interface CachedAccount { accountPublicId: string; gameName: string; tag: string; isPrimary: boolean; affinity: null; accountLabel?: string }
export interface CachedMember { memberPublicId: string; communityName: string; accounts: CachedAccount[] }
export interface MemberCache { version: typeof MEMBER_CACHE_VERSION; sourceSchemaVersion: number; sourceSnapshotVersion: string; members: CachedMember[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export class MemberCacheError extends Error { constructor(message: string) { super(message); this.name = 'MemberCacheError'; } }

export function buildMemberCache(publicDataset: unknown, communityNames: unknown, expectedAccounts = 9): MemberCache {
  if (!record(publicDataset) || publicDataset.schemaVersion !== 6 || !record(publicDataset.dataset) || publicDataset.dataset.mode !== 'REAL'
    || !Array.isArray(publicDataset.dataset.players) || !record(publicDataset.snapshot) || publicDataset.snapshot.identityVersion !== 'member-identity-v2') {
    throw new MemberCacheError('the cached public dataset is not the expected schema-6 REAL member-identity-v2 contract.');
  }
  if (!Array.isArray(communityNames)) throw new MemberCacheError('community names must be an array.');
  const approved = new Map<string, string>();
  for (const entry of communityNames) {
    if (!record(entry) || typeof entry.gameName !== 'string' || typeof entry.communityName !== 'string') throw new MemberCacheError('invalid community name entry.');
    approved.set(entry.gameName, entry.communityName);
  }
  const members: CachedMember[] = publicDataset.dataset.players.map((player) => {
    if (!record(player) || typeof player.id !== 'string' || !UUID.test(player.id) || typeof player.displayName !== 'string' || !Array.isArray(player.accounts)) {
      throw new MemberCacheError('invalid public member record.');
    }
    const accounts = player.accounts.map((account): CachedAccount => {
      if (!record(account) || typeof account.id !== 'string' || !UUID.test(account.id) || typeof account.gameName !== 'string'
        || typeof account.tag !== 'string' || typeof account.isPrimary !== 'boolean') throw new MemberCacheError('invalid public account record.');
      if (approved.get(account.gameName) !== player.displayName) throw new MemberCacheError('a public account does not map exactly to its approved community name.');
      return { accountPublicId: account.id, gameName: account.gameName, tag: account.tag, isPrimary: account.isPrimary, affinity: null,
        ...(typeof account.label === 'string' ? { accountLabel: account.label } : {}) };
    });
    return { memberPublicId: player.id, communityName: player.displayName, accounts };
  });
  const total = members.reduce((sum, member) => sum + member.accounts.length, 0);
  if (total !== expectedAccounts || new Set(members.flatMap((member) => member.accounts.map((account) => account.accountPublicId))).size !== total) {
    throw new MemberCacheError(`expected exactly ${expectedAccounts} distinct public accounts.`);
  }
  return { version: MEMBER_CACHE_VERSION, sourceSchemaVersion: 6, sourceSnapshotVersion: String(publicDataset.snapshot.version ?? ''), members };
}
