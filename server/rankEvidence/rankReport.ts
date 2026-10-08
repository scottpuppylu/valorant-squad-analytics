import type { SqlExecutor } from '../db/types.js';
import { rankCoverage, resolveRankContextAt } from '../../src/analytics/rank/rankContext.js';
import type { RankStagingStore } from './rankStagingStore.js';

/** Identifier-free rank evidence report (community names, tier labels, counts, dates only). */
export async function buildRankReport(database: SqlExecutor, rank: RankStagingStore) {
  const accounts = (await database.query<{ account_id: string; community_name: string }>(
    `SELECT account_public_id::text AS account_id, community_name FROM rebuild_staging.accounts ORDER BY community_name`)).rows;
  const all = await rank.evidence();
  const firstMatch = new Map((await database.query<{ account_id: string; started_at: string; match_ref: string }>(
    `SELECT DISTINCT ON (am.account_public_id) am.account_public_id::text AS account_id, m.started_at, m.match_ref
     FROM rebuild_staging.account_matches am JOIN rebuild_staging.matches m ON m.provider_match_id=am.provider_match_id
     WHERE m.started_at IS NOT NULL ORDER BY am.account_public_id, m.started_at`)).rows.map((row) => [row.account_id, row]));
  const members = accounts.map((account) => {
    const own = all.filter((row) => row.accountId === account.account_id);
    const latest = (kind: string) => own.filter((row) => row.kind === kind).sort((a, b) => Date.parse(b.effectiveAt) - Date.parse(a.effectiveAt))[0];
    const current = latest('current');
    const peak = latest('peak');
    const history = own.filter((row) => row.kind === 'history');
    const snapshots = own.filter((row) => row.kind === 'match_snapshot');
    const historyRefs = new Set(history.map((row) => row.matchRef).filter(Boolean));
    const coverage = rankCoverage(all, account.account_id);
    const first = firstMatch.get(account.account_id);
    // No-future-leakage probe on real data: at the account's earliest staged match, current/peak must never be used.
    const probe = first ? resolveRankContextAt(all, account.account_id, new Date(first.started_at).toISOString(), first.match_ref) : null;
    const competitiveSnapshots = snapshots.filter((row) => row.queue === 'competitive');
    return {
      communityName: account.community_name,
      currentRank: current?.normalized?.label ?? current?.providerTierName ?? null,
      currentRr: current?.rr ?? null,
      peakRank: peak?.normalized?.label ?? peak?.providerTierName ?? null,
      peakSeason: peak?.seasonShort ?? peak?.seasonId ?? null,
      seasonCount: own.filter((row) => row.kind === 'seasonal').length,
      historyObservations: history.length,
      matchSnapshots: snapshots.length,
      competitiveMatchSnapshots: competitiveSnapshots.length,
      rankedCompetitiveSnapshots: competitiveSnapshots.filter((row) => row.normalized?.ranked).length,
      snapshotsWithMatchingHistoryRow: snapshots.filter((row) => row.matchRef && historyRefs.has(row.matchRef)).length,
      rankCoverageStart: coverage.rankCoverageStart,
      rankCoverageEnd: coverage.rankCoverageEnd,
      rankHistoryCompleteness: coverage.rankHistoryCompleteness,
      earliestMatchProbe: probe ? { status: probe.status, evidenceKind: probe.evidence?.kind ?? null, laterEvidenceExists: probe.laterEvidenceExists } : null,
    };
  });
  const state = (await database.query<{ endpoint: string; last_status: string; n: string; total: string | null; returned: string | null }>(
    `SELECT endpoint, last_status, count(*) AS n, sum(provider_total)::text AS total, sum(provider_returned)::text AS returned
     FROM rank_staging.ingestion_state GROUP BY 1, 2 ORDER BY 1, 2`)).rows;
  const times = all.filter((row) => row.kind === 'history' || row.kind === 'match_snapshot').map((row) => Date.parse(row.effectiveAt)).sort((a, b) => a - b);
  const historyTimes = all.filter((row) => row.kind === 'history').map((row) => Date.parse(row.effectiveAt)).sort((a, b) => a - b);
  return {
    schemaVersion: 'rank-staging-v1',
    evidenceCounts: Object.fromEntries(['current', 'peak', 'seasonal', 'history', 'match_snapshot'].map((kind) => [kind, all.filter((row) => row.kind === kind).length])),
    providerElo: { present: all.some((row) => row.providerElo !== null), documentedName: 'elo (no description in provider docs; not Riot MMR)' },
    earliestRankObservation: times.length ? new Date(times[0]!).toISOString() : null,
    latestRankObservation: times.length ? new Date(times.at(-1)!).toISOString() : null,
    earliestStoredHistory: historyTimes.length ? new Date(historyTimes[0]!).toISOString() : null,
    latestStoredHistory: historyTimes.length ? new Date(historyTimes.at(-1)!).toISOString() : null,
    ingestionState: state.map((row) => ({ endpoint: row.endpoint, status: row.last_status, accounts: Number(row.n),
      providerTotal: row.total === null ? null : Number(row.total), providerReturned: row.returned === null ? null : Number(row.returned) })),
    members,
  };
}
