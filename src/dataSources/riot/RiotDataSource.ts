import type { AnalyticsDataSource, NormalizedAnalyticsDataset } from '../types';

/**
 * Future server-backed adapter boundary. No credentials or network requests belong
 * in the static GitHub Pages bundle.
 */
export class RiotDataSource implements AnalyticsDataSource {
  readonly id = 'riot-official-future';

  snapshot(): NormalizedAnalyticsDataset {
    throw new Error('Riot 官方資料來源尚未啟用；需要 Production API 與 RSO 核准。');
  }

  async load(): Promise<NormalizedAnalyticsDataset> {
    return this.snapshot();
  }
}
