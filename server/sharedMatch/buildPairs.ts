import type { SqlDatabase } from '../db/types.js';
import { EventMetricEngine } from '../metrics/eventMetricEngine.js';
import { RankStagingStore } from '../rankEvidence/rankStagingStore.js';
import { resolveRankContextAt, type RankEvidence } from '../../src/analytics/rank/rankContext.js';
import { pairMatchesFor, type PairMatchEvidence } from '../../src/analytics/sharedMatch/pairEvidence.js';
import type { MatchRecord } from '../../src/types/valorant.js';
import { projectStagedMatch, SHARED_MATCH_EVIDENCE_EVENT_ENGINE, type StagingMember } from './stagingMatches.js';

/**
 * Builds the private same-match pair evidence from the private staging store (read-only; 0 provider requests):
 * staged v4 documents → canonical projection (stagingMatches.ts) → pair units with pre-match rank context.
 */
export interface StagedDataset {
  members: (StagingMember & { memberLabel: string })[];
  matches: { matchRef: string; match: MatchRecord }[];
  identityConflicts: number;
  skipped: number;
  pairs: PairMatchEvidence[];
}

export async function buildStagedPairs(database: SqlDatabase, hmacKey: string,
  engine: EventMetricEngine = new EventMetricEngine({ ruleVersion: SHARED_MATCH_EVIDENCE_EVENT_ENGINE })): Promise<StagedDataset> {
  const memberRows = (await database.query<{ account_id: string; member_id: string; community_name: string; affinity: string | null; puuid: string | null }>(
    `SELECT account_public_id::text AS account_id, member_public_id::text AS member_id, community_name, affinity, provider_puuid AS puuid
     FROM rebuild_staging.accounts ORDER BY account_public_id`)).rows;
  const members = memberRows.filter((row) => row.affinity && row.puuid).map((row) => ({
    accountPublicId: row.account_id, memberPublicId: row.member_id, communityName: row.community_name, memberLabel: row.community_name,
    affinity: row.affinity!, providerPuuid: row.puuid!,
  }));
  const rank = new RankStagingStore(database);
  const evidence: RankEvidence[] = await rank.evidence();
  // Rank evidence is account-scoped; resolve per (account of the member in that match).
  const accountOfMember = new Map<string, string[]>();
  for (const member of members) accountOfMember.set(member.memberPublicId, [...(accountOfMember.get(member.memberPublicId) ?? []), member.accountPublicId]);
  const matches: { matchRef: string; match: MatchRecord }[] = [];
  let identityConflicts = 0; let skipped = 0;
  const pairs: PairMatchEvidence[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const page = (await database.query<{ match_ref: string; payload: unknown }>(
      `SELECT m.match_ref, p.payload FROM rebuild_staging.matches m JOIN rebuild_staging.match_payloads p ON p.provider_match_id=m.provider_match_id
       ORDER BY m.started_at, m.match_ref LIMIT $1 OFFSET $2`, [pageSize, offset])).rows;
    if (page.length === 0) break;
    for (const row of page) {
      const projected = projectStagedMatch(row.payload, row.match_ref, members, hmacKey, engine);
      if (!projected) { skipped += 1; continue; }
      if (projected.identityConflict) { identityConflicts += 1; continue; }
      matches.push({ matchRef: row.match_ref, match: projected.match });
      pairs.push(...pairMatchesFor(row.match_ref, projected.match, (memberId, playedAt, matchRef) => {
        const accounts = accountOfMember.get(memberId) ?? [];
        const account = accounts.find((id) => projected.accountByMember.get(memberId) === id) ?? accounts[0];
        return account ? resolveRankContextAt(evidence, account, playedAt, matchRef) : null;
      }));
    }
  }
  return { members, matches, identityConflicts, skipped, pairs };
}
