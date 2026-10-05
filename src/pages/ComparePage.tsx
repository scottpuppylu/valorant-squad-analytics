import { CompareTables } from '../components/CompareTables';
import { EmptyState } from '../components/EmptyState';
import { lazy, Suspense, useMemo } from 'react';
import { comparePlayers, groupByAgent, groupByMap } from '../analytics/analysis';
import { aggregateSelection } from '../analytics/rankings';
import { AnalysisFilterBar } from '../components/AnalysisFilterBar';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { SectionHeading } from '../components/SectionHeading';
import { useDataset } from '../hooks/useDataset';
import { useAnalysisFilters } from '../hooks/useAnalysisFilters';
import { ScopeExplanation } from '../components/ScopeExplanation';
import { AnalysisStatusNotice } from '../components/AnalysisStatusNotice';
import { useScopedAnalysis } from '../hooks/useScopedAnalysis';
import { zhTW } from '../i18n/zhTW';
import type { PlayerAnalytics } from '../types/valorant';

const ComparisonRadar = lazy(() => import('../components/ComparisonRadar').then((module) => ({ default: module.ComparisonRadar })));
import { dimensions } from '../scoring/versions';

function relativeAreas(analytics: PlayerAnalytics) {
  const values = dimensions.map((key) => ({ key, value: analytics.scores[key].value })).filter((item): item is {key: typeof dimensions[number];value:number} => item.value !== undefined);
  const mean = values.reduce((sum, item) => sum + item.value, 0) / values.length;
  return {
    strengths: values.filter((item) => item.value >= mean + 3).sort((a, b) => b.value - a.value).slice(0, 3),
    weaker: values.filter((item) => item.value <= mean - 3).sort((a, b) => a.value - b.value).slice(0, 3),
  };
}

export function ComparePage() {
  const { analytics: { activeDataset, availableAgents, availableGameModes, availableMaps, population } } = useDataset();
  const { filters, update, reset, params, setParams } = useAnalysisFilters('current');
  const requested = (params.get('players')?.split(',').filter(Boolean) ?? activeDataset.players.slice(0, 2).map((player) => player.id)).slice(0, 4);
  const selectedIds = [...new Set(requested)].filter((id) => activeDataset.players.some((player) => player.id === id));
  const compareFilters = useMemo(() => ({ ...filters, playerId: 'all' }), [filters]);
  const analysis = useScopedAnalysis(compareFilters);
  const selection = analysis.selection;
  const analytics = useMemo(() => {
    try { return comparePlayers(aggregateSelection(selection), selectedIds); } catch { return []; }
  }, [selectedIds, selection]);

  function togglePlayer(playerId: string) {
    const nextIds = selectedIds.includes(playerId) ? selectedIds.filter((id) => id !== playerId) : [...selectedIds, playerId].slice(0, 4);
    const next = new URLSearchParams(params);
    next.set('players', nextIds.join(','));
    setParams(next, { replace: true });
  }

  return <div className="space-y-9">
    <header className="page-heading"><div><p className="metric-label">並排分析</p><h1>玩家比較</h1><p>選擇 2 到 4 位玩家，在相同條件與證據感知計分模型下比較。</p></div></header>
    <section className="surface-card player-selector" aria-label="選擇比較玩家"><p>選擇玩家（{selectedIds.length}/4）</p><div>{activeDataset.players.map((player) => <label key={player.id}><input type="checkbox" checked={selectedIds.includes(player.id)} disabled={!selectedIds.includes(player.id) && selectedIds.length >= 4} onChange={() => togglePlayer(player.id)} /><PlayerAvatar player={player} /><span>{player.handle}</span></label>)}</div></section>
    <AnalysisFilterBar filters={filters} onChange={update} onReset={reset} players={activeDataset.players} maps={availableMaps} agents={availableAgents} gameModes={availableGameModes} includePlayer={false} seasonKeys={population.seasonKeys} />
    <AnalysisStatusNotice analysis={analysis} />
    <ScopeExplanation scope={selection.scope} players={activeDataset.players} source={analysis.source} trackedMatchCount={analysis.trackedMatchCount} />
    {selectedIds.length < 2 ? <EmptyState title="請至少選擇 2 位玩家" description="勾選上方玩家，在相同條件下並排比較；最多可選 4 位。" /> : analytics.length < 2 ? <EmptyState title="選取條件下沒有足夠的玩家資料" description="請放寬篩選，或選擇有出賽樣本的玩家。" actions={<button type="button" className="button-secondary" onClick={reset}>重設條件</button>} /> : <>
      <section className="surface-card p-4 sm:p-6"><SectionHeading title="分類分數雷達圖" description="同一篩選人口下的證據感知分數；文字摘要已包含在圖表標籤中。" /><Suspense fallback={<div className="empty-panel">圖表載入中…</div>}><ComparisonRadar analytics={analytics} /></Suspense></section>
      <CompareTables analytics={analytics} />
      <section className="comparison-insights">{analytics.map((item) => { const areas = relativeAreas(item); const entries = selection.byPlayer.get(item.player.id) ?? []; const maps = groupByMap(entries); const agents = groupByAgent(entries); return <article className="surface-card p-5" key={item.player.id}><div className="flex items-center gap-3"><PlayerAvatar player={item.player} /><div><h2>{item.player.handle}</h2><p>{zhTW.roles[item.player.role]} · {item.stats.matches} 場／{item.stats.rounds} 回合</p></div></div><dl><div><dt>相對強項</dt><dd>{areas.strengths.length ? areas.strengths.map(({ key }) => zhTW.scores[key]).join('、') : '各面向接近自身平均'}</dd></div><div><dt>相對較弱</dt><dd>{areas.weaker.length ? areas.weaker.map(({ key }) => zhTW.scores[key]).join('、') : '沒有超過 3 分的明顯落差'}</dd></div><div><dt>地圖摘要</dt><dd>{maps.slice(0, 3).map((map) => `${map.label} ${map.appearances} 場`).join('、') || '無資料'}</dd></div><div><dt>特務摘要</dt><dd>{agents.slice(0, 3).map((agent) => `${agent.label} ${agent.appearances} 場`).join('、') || '無資料'}</dd></div></dl></article>; })}</section>
      <p className="sample-warning">相對強弱只顯示與玩家自身可用維度平均相差至少 3 分的項目；小差異不作解讀。</p>
    </>}
  </div>;
}
