import { demoMatches } from '../../data/demoMatches';
import { players } from '../../data/players';
import type { MatchRecord } from '../../types/valorant';
import type { AnalyticsDataSource, NormalizedAnalyticsDataset } from '../types';

/**
 * TASK-IDENTITY-01 Demo: fictional members own fictional accounts. A multi-account member's matches
 * alternate deterministically between its accounts (never two in one match), so the Profile account
 * list and member-level aggregation are visibly exercised without any API.
 */
function withDemoAccounts(matches: MatchRecord[]): MatchRecord[] {
  const accounts = new Map(players.map((player) => [player.id, player.accounts ?? []]));
  return matches.map((match, index) => ({
    ...match,
    performances: match.performances.map((performance) => {
      const owned = accounts.get(performance.playerId) ?? [];
      // Like the server, accountId is attached only for multi-account members.
      return owned.length > 1 ? { ...performance, accountId: owned[index % owned.length]!.id } : performance;
    }),
  }));
}

const demoMatchesWithAccounts = withDemoAccounts(demoMatches);

export class DemoDataSource implements AnalyticsDataSource {
  readonly id = 'fictional-demo-v1';

  snapshot(): NormalizedAnalyticsDataset {
    return { players, matches: demoMatchesWithAccounts, sourceId: this.id, isDemo: true, mode: 'DEMO' };
  }

  async load(): Promise<NormalizedAnalyticsDataset> {
    return this.snapshot();
  }
}

export const demoDataSource = new DemoDataSource();
