import { createHash } from 'node:crypto';
import { playerEmojiOptions, type PlayerEmoji } from '../../src/types/avatar.js';
import type { MatchRecord, Player, PublicAccount } from '../../src/types/valorant.js';
import { primaryRoleForAgents } from '../../src/utils/agentRoles.js';
import { PublicApiError } from '../errors.js';
import { EventMetricEngine } from '../metrics/eventMetricEngine.js';
import type {
  DatasetEvidenceAvailability,
  DatasetHistoryPageRequest,
  DatasetHistoryResult,
  DatasetPerformanceRow,
  DatasetPlayerRow,
  DatasetProjectionResult,
  DatasetProjectionRows,
  DatasetReadRepository,
} from './types.js';
import { datasetHistoryVersion, datasetIdentityVersion, datasetProjectionVersion, datasetSchemaVersion, datasetWindowSize } from './types.js';
import { assembleMatch, dateValue, hasMemberCollision, reconstructMatchFacts, type AssemblyContext, type ParticipantFact } from './matchAssembly.js';
export { hasMemberCollision } from './matchAssembly.js';
import { encodeHistoryCursor } from './historyCursor.js';

export type ProjectableRows = Pick<DatasetProjectionRows, 'players' | 'performances' | 'rounds' | 'roundParticipants' | 'events'>;

const accentPalette = ['#6ee7b7', '#67e8f9', '#c4b5fd', '#f9a8d4', '#fdba74', '#fde68a'];
const playerEmojiSet = new Set<string>(playerEmojiOptions);

function safePlayerEmoji(value: string): PlayerEmoji {
  return playerEmojiSet.has(value) ? value as PlayerEmoji : '🤖';
}

function accentFor(publicId: string): string {
  const total = [...publicId].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return accentPalette[total % accentPalette.length]!;
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    const list = grouped.get(groupKey) ?? [];
    list.push(value);
    grouped.set(groupKey, list);
  }
  return grouped;
}

/**
 * TASK-IDENTITY-01 member projection: public ACCOUNT rows → one public Player per MEMBER.
 * Agents are the union over the member's accounts; accounts are sanitized (public account id,
 * Riot name/tag, primary flag, optional label) — never internal ids, PUUIDs or HMACs.
 */
export function membersFromRows(rows: DatasetPlayerRow[], agentsByAccount: Map<string, Set<string>>): Player[] {
  const byMember = new Map<string, DatasetPlayerRow[]>();
  for (const row of rows) byMember.set(row.member_public_id, [...(byMember.get(row.member_public_id) ?? []), row]);
  return [...byMember.keys()].sort().map((memberId) => {
    const accountRows = byMember.get(memberId)!;
    const member = accountRows[0]!;
    const agents = [...new Set(accountRows.flatMap((row) => [...(agentsByAccount.get(row.internal_player_id) ?? [])]))].sort();
    const accounts: PublicAccount[] = [...accountRows]
      .sort((a, b) => Number(b.is_primary_account) - Number(a.is_primary_account) || a.public_id.localeCompare(b.public_id))
      .map((row) => ({ id: row.public_id, gameName: row.display_name, tag: row.display_tag, isPrimary: row.is_primary_account === true,
        ...(row.account_label ? { label: row.account_label } : {}) }));
    const role = primaryRoleForAgents(agents);
    return {
      id: memberId,
      handle: member.member_display_name,
      displayName: member.member_display_name,
      nameSource: member.member_name_source === 'community' ? 'community' as const : 'legacy_account' as const,
      ...(member.member_nickname ? { nickname: member.member_nickname } : {}),
      accounts,
      ...(role ? { role } : {}),
      agents,
      accent: accentFor(memberId),
      tagline: '持久化戰績成員',
      playstyle: '依目前可用的持久化對戰證據呈現；不代表完整生涯紀錄。',
      defaultEmoji: safePlayerEmoji(member.member_default_emoji),
    };
  });
}

export class DatasetProjectionService {

  private collides(context: AssemblyContext, rows: DatasetPerformanceRow[]): boolean {
    return hasMemberCollision(rows.map((row) => context.playerRowByInternalId.get(row.internal_player_id)?.member_public_id));
  }

  /** `cursorKey` is only for tests; production derives the cursor MAC from IDENTIFIER_HMAC_KEY. */
  /** `metricEngine` defaults to the canonical engine; tests pass the preserved v1 engine explicitly. */
  constructor(private readonly repository: DatasetReadRepository, private readonly cursorKey?: string,
    private readonly metricEngine: EventMetricEngine = new EventMetricEngine()) {}

  /**
   * Shared per-match projection for the snapshot, history pages and DATA-03B.2B server analysis.
   * `playerAgents` (keyed by internal player id) lets server analysis derive player roles from all
   * durable history instead of only the selected matches.
   */
  project(rows: ProjectableRows, playerAgents?: Map<string, Set<string>>) {
    const projectionStarted = performance.now();
    let metricReconstructionMs = 0;
    let eventCount = 0;
    const playerRowByInternalId = new Map(rows.players.map((row) => [row.internal_player_id, row]));
    const agentsByPlayer = new Map<string, Set<string>>();
    for (const row of rows.performances) {
      if (!row.agent_name) continue;
      const agents = agentsByPlayer.get(row.internal_player_id) ?? new Set<string>();
      agents.add(row.agent_name);
      agentsByPlayer.set(row.internal_player_id, agents);
    }
    const players: Player[] = membersFromRows(rows.players, playerAgents ?? agentsByPlayer);
    // accountId is emitted only for multi-account members (1:1 members stay byte-identical).
    const accountsPerMember = new Map<string, number>();
    for (const row of rows.players) accountsPerMember.set(row.member_public_id, (accountsPerMember.get(row.member_public_id) ?? 0) + 1);
    let identityConflicts = 0;

    const performanceByMatch = groupBy(rows.performances, (row) => row.internal_match_id);
    const roundsByMatch = groupBy(rows.rounds, (row) => row.internal_match_id);
    const roundMatch = new Map(rows.rounds.map((row) => [row.internal_round_id, row.internal_match_id]));
    const roundParticipantsByMatch = groupBy(rows.roundParticipants, (row) => roundMatch.get(row.internal_round_id) ?? '');
    const eventsByMatch = groupBy(rows.events, (row) => row.internal_match_id);
    const assembly: AssemblyContext = { playerRowByInternalId, accountsPerMember };
    let completeRoundEvidence = true;
    let completeHeadshotEvidence = true;
    const matches: MatchRecord[] = [];

    for (const [matchId, performanceRows] of performanceByMatch) {
      // TASK-DATA-03B.2D: the shared per-match projection (matchAssembly.ts), reconstruct + assemble.
      let facts = new Map<string, ParticipantFact>();
      const first = performanceRows[0];
      if (first && dateValue(first.started_at) && !this.collides(assembly, performanceRows)) {
        const metricStarted = performance.now();
        const reconstructed = reconstructMatchFacts(this.metricEngine, {
          performances: performanceRows, rounds: roundsByMatch.get(matchId) ?? [],
          roundParticipants: roundParticipantsByMatch.get(matchId) ?? [], events: eventsByMatch.get(matchId) ?? [],
        });
        metricReconstructionMs += performance.now() - metricStarted;
        eventCount += reconstructed.eventCount;
        facts = reconstructed.facts;
      }
      const result = assembleMatch(assembly, performanceRows, facts);
      if (result.kind === 'identity_conflict') { identityConflicts += 1; continue; }
      if (result.kind !== 'assembled') continue;
      if (!result.roundEvidenceComplete) completeRoundEvidence = false;
      if (!result.headshotEvidenceComplete) completeHeadshotEvidence = false;
      if (result.match) matches.push(result.match);
    }
    matches.sort((a, b) => b.playedAt.localeCompare(a.playedAt) || a.id.localeCompare(b.id));
    if (identityConflicts > 0) {
      // Aggregate only: no member, account or match identifiers.
      process.stdout.write(`${JSON.stringify({ event: 'member_identity_conflict', identityVersion: datasetIdentityVersion, matchesWithheld: identityConflicts })}
`);
    }
    const dataset = { players, matches, sourceId: 'durable-neon-v4', isDemo: false as const, mode: 'REAL' as const };
    const availability: DatasetEvidenceAvailability = {
      acs: 'derived' as const,
      adr: 'derived' as const,
      headshotPercentage: completeHeadshotEvidence ? 'derived' as const : 'partial' as const,
      kast: completeRoundEvidence ? 'reconstructed' as const : 'partial' as const,
      firstKills: completeRoundEvidence ? 'reconstructed' as const : 'partial' as const,
      firstDeaths: completeRoundEvidence ? 'reconstructed' as const : 'partial' as const,
    };
    return { dataset, availability, eventCount, projectionStarted, metricReconstructionMs };
  }

  async read(): Promise<DatasetProjectionResult> {
    const rows = await this.repository.readProjectionRows(datasetWindowSize);
    const { dataset, availability, eventCount, projectionStarted, metricReconstructionMs } = this.project(rows);
    const matches = dataset.matches;
    const coverage = {
      from: dateValue(rows.coverage?.coverage_from),
      to: dateValue(rows.coverage?.coverage_to),
      lastSyncedAt: dateValue(rows.coverage?.last_synced_at),
      completeForProviderWindow: rows.coverage?.complete_for_provider_window === true,
      boundedMatchLimit: datasetWindowSize,
      lifetimeComplete: false as const,
    };
    const version = createHash('sha256').update(JSON.stringify({ schemaVersion: datasetSchemaVersion, projectionVersion: datasetProjectionVersion, dataset, coverage, evidence: availability })).digest('base64url').slice(0, 24);
    const payload = {
      ok: true as const,
      schemaVersion: datasetSchemaVersion,
      state: matches.length === 0 ? 'empty' as const : 'ready' as const,
      snapshot: { version, generation: 'dataset-read-v4' as const, source: 'durable-neon' as const, projectionVersion: datasetProjectionVersion, identityVersion: datasetIdentityVersion },
      coverage,
      evidence: availability,
      dataset,
    };
    const projectionMs = Math.round((performance.now() - projectionStarted) * 100) / 100;
    return {
      payload,
      metrics: {
        sqlQueryCount: rows.sqlQueryCount,
        databaseMs: rows.databaseMs,
        metricReconstructionMs: Math.round(metricReconstructionMs * 100) / 100,
        projectionMs,
        serializedBytes: Buffer.byteLength(JSON.stringify(payload)),
        roundCount: rows.rounds.length,
        roundParticipantCount: rows.roundParticipants.length,
        eventCount,
      },
    };
  }

  /**
   * DATA-03B.1 bounded keyset page over ALL eligible durable history (newest -> oldest).
   * Reuses the snapshot projection per match; analytics meaning is unchanged because
   * history pages are browse-only and never merged into buildAnalytics().
   */
  async readHistory(request: DatasetHistoryPageRequest): Promise<DatasetHistoryResult> {
    const rows = await this.repository.readHistoryPage(request);
    if (!rows.startFound) throw new PublicApiError(400, 'BAD_REQUEST', '歷史分頁位置無效，請重新載入對戰紀錄。');
    const { dataset, availability, eventCount, projectionStarted, metricReconstructionMs } = this.project(rows.rows);
    const pageKeys = rows.keys.slice(0, request.pageSize);
    const hasMore = rows.keys.length > request.pageSize;
    const oldest = pageKeys.at(-1);
    const newest = pageKeys[0];
    const traversedMatchCount = pageKeys.length;
    // Present each page in exact keyset order (started_at DESC, public_id DESC). A match
    // inserted inside the range between the two phases has no rank and sorts by time.
    const rank = new Map(pageKeys.map((entry, index) => [entry.key.publicMatchId, index]));
    dataset.matches.sort((a, b) => b.playedAt.localeCompare(a.playedAt)
      || (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      || b.id.localeCompare(a.id));
    const payload = {
      ok: true as const,
      schemaVersion: datasetSchemaVersion,
      view: 'history' as const,
      historyVersion: datasetHistoryVersion,
      projectionVersion: datasetProjectionVersion,
      identityVersion: datasetIdentityVersion,
      state: dataset.matches.length === 0 ? 'empty' as const : 'ready' as const,
      page: {
        limit: request.pageSize,
        traversedMatchCount,
        withheldMatchCount: Math.max(0, traversedMatchCount - dataset.matches.length),
        ...(oldest ? { from: dateValue(oldest.startedAt) } : {}),
        ...(newest ? { to: dateValue(newest.startedAt) } : {}),
        hasMore,
        nextCursor: hasMore && oldest ? encodeHistoryCursor(oldest.key, this.cursorKey) : null,
      },
      tracked: {
        trackedMatchCount: rows.trackedMatchCount,
        ...(dateValue(rows.earliestStartedAt) ? { earliestTrackedAt: dateValue(rows.earliestStartedAt) } : {}),
        ...(dateValue(rows.latestStartedAt) ? { latestTrackedAt: dateValue(rows.latestStartedAt) } : {}),
        ...(dateValue(rows.lastSyncedAt) ? { lastSyncedAt: dateValue(rows.lastSyncedAt) } : {}),
        lifetimeComplete: false as const,
      },
      evidence: availability,
      dataset,
    };
    const projectionMs = Math.round((performance.now() - projectionStarted) * 100) / 100;
    return {
      payload,
      metrics: {
        sqlQueryCount: rows.sqlQueryCount,
        databaseMs: rows.databaseMs,
        metricReconstructionMs: Math.round(metricReconstructionMs * 100) / 100,
        projectionMs,
        serializedBytes: Buffer.byteLength(JSON.stringify(payload)),
        roundCount: rows.rows.rounds.length,
        roundParticipantCount: rows.rows.roundParticipants.length,
        eventCount,
      },
    };
  }
}
