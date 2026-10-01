import { useMemo } from 'react';
import { computeBadges } from '../analytics/analysis';
import { selectPerformances } from '../analytics/filters';
import { activeFilterSummary } from '../analytics/presentation';
import { insufficientPlayers, lowerIsBetterMetrics, rankingMetricLabels, rankPlayers } from '../analytics/rankings';
import type { RankingMetric, SortDirection } from '../analytics/types';
import { AnalysisFilterBar } from '../components/AnalysisFilterBar';
import { BadgeGrid } from '../components/BadgeGrid';
import { PlayerRankingTable } from '../components/PlayerRankingTable';
import { SectionHeading } from '../components/SectionHeading';
import { useDataset } from '../hooks/useDataset';
import { useAnalysisFilters } from '../hooks/useAnalysisFilters';

const metrics = Object.keys(rankingMetricLabels) as RankingMetric[];

export function LeaderboardPage() {
  const { analytics: { activeDataset, availableAgents, availableGameModes, availableMaps, performanceEntries } } = useDataset();
  const { filters, update, reset, params, setParams } = useAnalysisFilters();
  const requestedMetric = params.get('metric') as RankingMetric | null;
  const metric = requestedMetric && metrics.includes(requestedMetric) ? requestedMetric : 'overall';
  const requestedDirection = params.get('direction');
  const defaultDirection: SortDirection = lowerIsBetterMetrics.has(metric) ? 'asc' : 'desc';
  const direction: SortDirection = requestedDirection === 'asc' || requestedDirection === 'desc' ? requestedDirection : defaultDirection;
  const selection = useMemo(() => selectPerformances(performanceEntries, filters), [filters, performanceEntries]);
  const rows = useMemo(() => rankPlayers(selection, filters, metric, direction), [direction, filters, metric, selection]);
  const insufficient = useMemo(() => insufficientPlayers(selection, filters), [filters, selection]);
  const badges = useMemo(() => computeBadges(selection, Math.max(filters.minMatches, 5), Math.max(filters.minRounds, 100)), [filters.minMatches, filters.minRounds, selection]);

  function setQuery(key: string, value: string, removeWhen?: string) {
    const next = new URLSearchParams(params);
    if (value === removeWhen) next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  }

  return <div className="space-y-9">
    <header className="page-heading"><div><p className="metric-label">交叉排名</p><h1>戰力排名</h1><p>用同一批符合條件的玩家出賽資料比較目前原型分數與原始指標。</p></div><span className="data-pill inline-flex"><span /> {rows.length} 位符合門檻</span></header>
    <div className="ranking-controls surface-card">
      <label><span>排名指標</span><select aria-label="排名指標" value={metric} onChange={(event) => { const nextMetric = event.target.value as RankingMetric; const next = new URLSearchParams(params); next.set('metric', nextMetric); next.delete('direction'); setParams(next, { replace: true }); }}>{metrics.map((key) => <option value={key} key={key}>{rankingMetricLabels[key]}</option>)}</select></label>
      <label><span>排序方向</span><select aria-label="排序方向" value={direction} onChange={(event) => setQuery('direction', event.target.value, defaultDirection)}><option value="desc">由高到低</option><option value="asc">由低到高</option></select></label>
    </div>
    <AnalysisFilterBar filters={filters} onChange={update} onReset={reset} players={activeDataset.players} maps={availableMaps} agents={availableAgents} gameModes={availableGameModes} />
    <section><SectionHeading title={`依「${rankingMetricLabels[metric]}」${direction === 'desc' ? '由高到低' : '由低到高'}`} description={`目前條件：${activeFilterSummary(filters).join(' · ') || '全部資料'}。分類分數仍是目前原型模型。`} />
      <PlayerRankingTable rows={rows} metric={metric} />
      {selection.entries.length === 0 ? <p className="sample-warning">無符合條件的資料。</p> : null}
      {insufficient.length > 0 ? <p className="sample-warning">樣本不足而未列入排名：{insufficient.map((id) => activeDataset.players.find((player) => player.id === id)?.handle ?? id).join('、')}</p> : null}
    </section>
    <section><SectionHeading eyebrow="依目前選取資料計算" title="玩家徽章" description="徽章使用相同篩選人口與明示門檻；差距 0.1 以內並列，不代表官方榮譽。" /><BadgeGrid badges={badges} players={activeDataset.players} /></section>
  </div>;
}
