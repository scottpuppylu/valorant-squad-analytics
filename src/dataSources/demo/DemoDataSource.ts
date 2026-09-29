import { demoMatches } from '../../data/demoMatches';
import { players } from '../../data/players';
import type { AnalyticsDataSource, NormalizedAnalyticsDataset } from '../types';

export class DemoDataSource implements AnalyticsDataSource {
  readonly id = 'fictional-demo-v1';

  snapshot(): NormalizedAnalyticsDataset {
    return { players, matches: demoMatches, sourceId: this.id, isDemo: true, mode: 'DEMO' };
  }

  async load(): Promise<NormalizedAnalyticsDataset> {
    return this.snapshot();
  }
}

export const demoDataSource = new DemoDataSource();
