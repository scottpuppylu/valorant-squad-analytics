import { useMemo } from 'react';
import { calculateRecentForm, computeBadgesFromSummary, recentFormFromWindow } from '../analytics/analysis';
import { selectPerformances } from '../analytics/filters';
import { activeFilterSummary } from '../analytics/presentation';
import { insufficientFromAnalytics, lowerIsBetterMetrics, rankAnalytics, rankingMetricLabels } from '../analytics/rankings';
import type { RankingMetric, SortDirection } from '../analytics/types';
import { AnalysisFilterBar } from '../components/AnalysisFilterBar';
import { BadgeGrid } from '../components/BadgeGrid';
import { PlayerRankingTable } from '../components/PlayerRankingTable';
import { SectionHeading } from '../components/SectionHeading';
import { useDataset } from '../hooks/useDataset';
import { useAnalysisFilters } from '../hooks/useAnalysisFilters';
import { ScopeExplanation } from '../components/ScopeExplanation';
import { AnalysisStatusNotice } from '../components/AnalysisStatusNotice';
import { useScopedAnalysis } from '../hooks/useScopedAnalysis';

const metrics = Object.keys(rankingMetricLabels) as RankingMetric[];

export function LeaderboardPage() {
  const { analytics: { activeDataset, availableAgents, availableGameModes, availableMaps, performanceEntries, population } } = useDataset();
  const { filters, update, reset, params, setParams } = useAnalysisFilters('current');
  const requestedMetric = params.get('metric') as RankingMetric | null;
  const metric = requestedMetric && metrics.includes(requestedMetric) ? requestedMetric : 'overall';
  const requestedDirection = params.get('direction');
  const defaultDirection: SortDirection = lowerIsBetterMetrics.has(metric) ? 'asc' : 'desc';
  const direction: SortDirection = requestedDirection === 'asc' || requestedDirection === 'desc' ? requestedDirection : defaultDirection;
  // DATA-03B.2B: the server resolves this feature's population over all durable history.
  const analysis = useScopedAnalysis(filters, { form: true });
  const selection = analysis.selection;
  const summary = analysis.summary;
  // Recent forms: server windows (bounded by recentForm policy) or, for Demo/tests, the local context.
  const forms = useMemo(() => {
    if (analysis.formWindows) {
      return summary.analytics.flatMap(({ player }) => {
        const window = analysis.formWindows!.get(player.id);
        return window ? [{ playerId: player.id, form: recentFormFromWindow(player, window) }] : [];
      });
    }
    const formSelection = selectPerformances(performanceEntries, { ...filters, period: 'all' }, { population });
    return [...formSelection.byPlayer.values()].flatMap((entries) => (entries[0] ? [{ playerId: entries[0].player.id, form: calculateRecentForm(entries[0].player, entries, population) }] : []));
  }, [analysis.formWindows, filters, performanceEntries, population, summary]);
  const rows = useMemo(() => rankAnalytics(summary.analytics, filters, metric, direction), [direction, filters, metric, summary]);
  const insufficient = useMemo(() => [...new Set([...insufficientFromAnalytics(summary.analytics, filters),
    ...[...(selection.scope?.players.values() ?? [])].filter((item) => item.status === 'unavailable').map((item) => item.playerId)])], [filters, selection, summary]);
  const badges = useMemo(() => computeBadgesFromSummary(summary, Math.max(filters.minMatches, 5), Math.max(filters.minRounds, 100), forms), [filters.minMatches, filters.minRounds, forms, summary]);

  function setQuery(key: string, value: string, removeWhen?: string) {
    const next = new URLSearchParams(params);
    if (value === removeWhen) next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  }

  return <div className="space-y-9">
    <header className="page-heading"><div><p className="metric-label">交叉排名</p><h1>戰力排名</h1><p>用同一批符合條件的玩家出賽資料比較版本化產品分數與原始指標。</p></div><span className="data-pill inline-flex"><span /> {rows.length} 位符合門檻</span></header>
    <div className="ranking-controls surface-card">
      <label><span>排名指標</span><select aria-label="排名指標" value={metric} onChange={(event) => { const nextMetric = event.target.value as RankingMetric; const next = new URLSearchParams(params); next.set('metric', nextMetric); next.delete('direction'); setParams(next, { replace: true }); }}>{metrics.map((key) => <option value={key} key={key}>{rankingMetricLabels[key]}</option>)}</select></label>
      <label><span>排序方向</span><select aria-label="排序方向" value={direction} onChange={(event) => setQuery('direction', event.target.value, defaultDirection)}><option value="desc">由高到低</option><option value="asc">由低到高</option></select></label>
    </div>
    <AnalysisFilterBar filters={filters} onChange={update} onReset={reset} players={activeDataset.players} maps={availableMaps} agents={availableAgents} gameModes={availableGameModes} seasonKeys={population.seasonKeys} />
    <AnalysisStatusNotice analysis={analysis} />
    <ScopeExplanation scope={selection.scope} players={activeDataset.players} source={analysis.source} trackedMatchCount={analysis.trackedMatchCount} />
    <section><SectionHeading title={`依「${rankingMetricLabels[metric]}」${direction === 'desc' ? '由高到低' : '由低到高'}`} description={`目前條件：${activeFilterSummary(filters).join(' · ') || '全部資料'}。分類分數仍是版本化產品模型。`} />
      <PlayerRankingTable rows={rows} metric={metric} />
      {summary.entryCount === 0 && analysis.status !== 'loading' && analysis.status !== 'error' ? <p className="sample-warning">無符合條件的資料。</p> : null}
      {insufficient.length > 0 ? <p className="sample-warning">樣本不足或不在此資料範圍而未列入排名：{insufficient.map((id) => activeDataset.players.find((player) => player.id === id)?.handle ?? id).join('、')}</p> : null}
    </section>
    <section><SectionHeading eyebrow="依目前選取資料計算" title="玩家徽章" description="徽章使用相同篩選人口與明示門檻；差距 0.1 以內並列，不代表官方榮譽。" /><BadgeGrid badges={badges} players={activeDataset.players} /></section>
  </div>;
}
