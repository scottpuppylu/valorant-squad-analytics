import { lazy, Suspense, useMemo } from 'react';
import { comparePlayers, groupByAgent, groupByMap } from '../analytics/analysis';
import { selectPerformances } from '../analytics/filters';
import { aggregateSelection } from '../analytics/rankings';
import { AnalysisFilterBar } from '../components/AnalysisFilterBar';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { SectionHeading } from '../components/SectionHeading';
import { useDataset } from '../hooks/useDataset';
import { useAnalysisFilters } from '../hooks/useAnalysisFilters';
import { zhTW } from '../i18n/zhTW';
import type { PlayerAnalytics, ScoreCategory } from '../types/valorant';
import { formatAcs, formatAdr, formatPercent, formatRatio, formatScore } from '../utils/format';

const ComparisonRadar = lazy(() => import('../components/ComparisonRadar').then((module) => ({ default: module.ComparisonRadar })));
const dimensions: Exclude<ScoreCategory, 'overall'>[] = ['firepower', 'entry', 'teamplay', 'clutch', 'consistency'];

function relativeAreas(analytics: PlayerAnalytics) {
  const values = dimensions.map((key) => ({ key, value: analytics.scores[key] }));
  const mean = values.reduce((sum, item) => sum + item.value, 0) / values.length;
  return {
    strengths: values.filter((item) => item.value >= mean + 3).sort((a, b) => b.value - a.value).slice(0, 3),
    weaker: values.filter((item) => item.value <= mean - 3).sort((a, b) => a.value - b.value).slice(0, 3),
  };
}

export function ComparePage() {
  const { analytics: { activeDataset, availableAgents, availableGameModes, availableMaps, performanceEntries } } = useDataset();
  const { filters, update, reset, params, setParams } = useAnalysisFilters();
  const requested = (params.get('players')?.split(',').filter(Boolean) ?? activeDataset.players.slice(0, 2).map((player) => player.id)).slice(0, 4);
  const selectedIds = [...new Set(requested)].filter((id) => activeDataset.players.some((player) => player.id === id));
  const selection = useMemo(() => selectPerformances(performanceEntries, { ...filters, playerId: 'all' }), [filters, performanceEntries]);
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
    <header className="page-heading"><div><p className="metric-label">並排分析</p><h1>玩家比較</h1><p>選擇 2 到 4 位玩家，在相同條件與目前原型計分模型下比較。</p></div></header>
    <section className="surface-card player-selector" aria-label="選擇比較玩家"><p>選擇玩家（{selectedIds.length}/4）</p><div>{activeDataset.players.map((player) => <label key={player.id}><input type="checkbox" checked={selectedIds.includes(player.id)} disabled={!selectedIds.includes(player.id) && selectedIds.length >= 4} onChange={() => togglePlayer(player.id)} /><PlayerAvatar player={player} /><span>{player.handle}</span></label>)}</div></section>
    <AnalysisFilterBar filters={filters} onChange={update} onReset={reset} players={activeDataset.players} maps={availableMaps} agents={availableAgents} gameModes={availableGameModes} includePlayer={false} />
    {selectedIds.length < 2 ? <div className="empty-panel surface-card">請至少選擇 2 位玩家。</div> : analytics.length < 2 ? <div className="empty-panel surface-card">選取條件下沒有足夠的玩家資料。</div> : <>
      <section className="surface-card p-4 sm:p-6"><SectionHeading title="分類分數雷達圖" description="同一篩選人口下的目前原型分數；文字摘要已包含在圖表標籤中。" /><Suspense fallback={<div className="empty-panel">圖表載入中…</div>}><ComparisonRadar analytics={analytics} /></Suspense></section>
      <section><SectionHeading title="分數與原始數據" description="樣本數會與結果一起顯示，避免忽略條件差異。" /><div className="surface-card overflow-hidden"><div className="overflow-x-auto"><table className="comparison-table"><thead><tr><th>玩家</th><th>場次</th><th>回合</th><th>綜合</th><th>火力</th><th>開戰</th><th>團隊</th><th>殘局</th><th>穩定</th><th>ACS</th><th>ADR</th><th>K/D</th><th>KPR</th><th>APR</th><th>KAST</th><th>HS%</th><th>FK</th><th>FD</th><th>FK/FD</th></tr></thead><tbody>{analytics.map((item) => <tr key={item.player.id}><td><span className="flex items-center gap-2"><PlayerAvatar player={item.player} /><strong>{item.player.handle}</strong></span></td><td>{item.stats.matches}</td><td>{item.stats.rounds}</td><td>{formatScore(item.scores.overall)}</td><td>{formatScore(item.scores.firepower)}</td><td>{formatScore(item.scores.entry)}</td><td>{formatScore(item.scores.teamplay)}</td><td>{formatScore(item.scores.clutch)}</td><td>{formatScore(item.scores.consistency)}</td><td>{formatAcs(item.stats.acs)}</td><td>{formatAdr(item.stats.adr)}</td><td>{formatRatio(item.stats.kd)}</td><td>{formatRatio(item.stats.kpr)}</td><td>{formatRatio(item.stats.apr)}</td><td>{formatPercent(item.stats.kast)}</td><td>{item.stats.headshotPercentage === undefined ? '—' : formatPercent(item.stats.headshotPercentage)}</td><td>{item.stats.firstKills ?? '—'}</td><td>{item.stats.firstDeaths ?? '—'}</td><td>{item.stats.fkFd === undefined ? '—' : formatRatio(item.stats.fkFd)}</td></tr>)}</tbody></table></div></div></section>
      <section className="comparison-insights">{analytics.map((item) => { const areas = relativeAreas(item); const entries = selection.byPlayer.get(item.player.id) ?? []; const maps = groupByMap(entries); const agents = groupByAgent(entries); return <article className="surface-card p-5" key={item.player.id}><div className="flex items-center gap-3"><PlayerAvatar player={item.player} /><div><h2>{item.player.handle}</h2><p>{zhTW.roles[item.player.role]} · {item.stats.matches} 場／{item.stats.rounds} 回合</p></div></div><dl><div><dt>相對強項</dt><dd>{areas.strengths.length ? areas.strengths.map(({ key }) => zhTW.scores[key]).join('、') : '各面向接近自身平均'}</dd></div><div><dt>相對較弱</dt><dd>{areas.weaker.length ? areas.weaker.map(({ key }) => zhTW.scores[key]).join('、') : '沒有超過 3 分的明顯落差'}</dd></div><div><dt>地圖摘要</dt><dd>{maps.slice(0, 3).map((map) => `${map.label} ${map.appearances} 場`).join('、') || '無資料'}</dd></div><div><dt>特務摘要</dt><dd>{agents.slice(0, 3).map((agent) => `${agent.label} ${agent.appearances} 場`).join('、') || '無資料'}</dd></div></dl></article>; })}</section>
      <p className="sample-warning">相對強弱只顯示與玩家自身五維平均相差至少 3 分的項目；小差異不作解讀。</p>
    </>}
  </div>;
}
