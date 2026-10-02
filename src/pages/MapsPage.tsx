import { useMemo } from 'react';
import { groupByAgent, groupByMap } from '../analytics/analysis';
import { selectPerformances } from '../analytics/filters';
import { aggregateSelection, rankPlayers } from '../analytics/rankings';
import type { PerformanceEntry } from '../analytics/types';
import { AnalysisFilterBar } from '../components/AnalysisFilterBar';
import { PlayerRankingTable } from '../components/PlayerRankingTable';
import { SectionHeading } from '../components/SectionHeading';
import { ScoreProfileTable } from '../components/ScoreProfileTable';
import { useDataset } from '../hooks/useDataset';
import { useAnalysisFilters } from '../hooks/useAnalysisFilters';
import { zhTW } from '../i18n/zhTW';
import { dimensions as scoreDimensions } from '../scoring/versions';
import { formatAcs, formatAdr, formatPercent, formatRatio } from '../utils/format';


function topCategory(entries: PerformanceEntry[]): string {
  const selection = { entries, byPlayer: new Map<string, PerformanceEntry[]>() };
  for (const entry of entries) selection.byPlayer.set(entry.playerId, [...(selection.byPlayer.get(entry.playerId) ?? []), entry]);
  const analytics = aggregateSelection(selection);
  if (!analytics.length) return '無資料';
  const averages = scoreDimensions.flatMap((key) => {
    const values=analytics.flatMap((item) => item.scores[key].value === undefined ? [] : [item.scores[key].value!]);
    return values.length ? [{key,value:values.reduce((sum,value) => sum+value,0)/values.length}] : [];
  });
  return averages.length ? zhTW.scores[averages.sort((a,b) => b.value-a.value)[0]!.key] : '資料不足';
}

export function MapsPage() {
  const { analytics: { activeDataset, availableAgents, availableGameModes, availableMaps, performanceEntries } } = useDataset();
  const { filters, update, reset } = useAnalysisFilters();
  const baseFilters = useMemo(() => ({ ...filters, map: 'all' as const }), [filters]);
  const baseSelection = useMemo(() => selectPerformances(performanceEntries, baseFilters), [baseFilters, performanceEntries]);
  const summaries = useMemo(() => groupByMap(baseSelection.entries), [baseSelection.entries]);
  const selectedMap = (filters.map === 'all' ? (summaries[0]?.id ?? availableMaps[0]) : filters.map) as typeof filters.map;
  const selectedFilters = useMemo(() => ({ ...filters, map: selectedMap }), [filters, selectedMap]);
  const selected = useMemo(() => selectPerformances(performanceEntries, selectedFilters), [performanceEntries, selectedFilters]);
  const rows = useMemo(() => rankPlayers(selected, filters, 'overall'), [filters, selected]);
  const agents = useMemo(() => groupByAgent(selected.entries), [selected.entries]);
  const selectedSummary = summaries.find((summary) => summary.id === selectedMap);

  return <div className="space-y-9"><header className="page-heading"><div><p className="metric-label">地圖切分</p><h1>地圖分析</h1><p>同一查詢層重算每張地圖的樣本、原始統計與版本化產品分數。</p></div></header>
    <AnalysisFilterBar filters={filters} onChange={update} onReset={reset} players={activeDataset.players} maps={availableMaps} agents={availableAgents} gameModes={availableGameModes} />
    <section><SectionHeading title="地圖總覽" description="每張卡片保留場次與回合分母；最高分類是該地圖玩家平均最高的目前分數面向。" /><div className="summary-grid">{summaries.map((summary) => { const entries = baseSelection.entries.filter((entry) => entry.match.map === summary.id); return <button type="button" className={`surface-card summary-card ${summary.id === selectedMap ? 'summary-card--active' : ''}`} key={summary.id} onClick={() => update({ map: summary.id as typeof filters.map })}><strong>{summary.label}</strong><span>{summary.matches} 場 · {summary.rounds} 玩家回合</span><dl><div><dt>勝率</dt><dd>{formatPercent(summary.winRate)}</dd></div><div><dt>ACS</dt><dd>{formatAcs(summary.acs)}</dd></div><div><dt>KAST</dt><dd>{formatPercent(summary.kast)}</dd></div><div><dt>最高分類</dt><dd>{topCategory(entries)}</dd></div></dl></button>; })}</div></section>
    <section><SectionHeading title={`${selectedMap ?? '地圖'}玩家排名`} description={selectedSummary ? `${selectedSummary.matches} 場對戰、${selectedSummary.rounds} 玩家回合；勝 ${selectedSummary.wins} 次出賽、負 ${selectedSummary.appearances - selectedSummary.wins} 次出賽。` : '無符合條件的地圖資料。'} /><PlayerRankingTable rows={rows} metric="overall" /></section>
    <section><SectionHeading title="分數與原始指標輪廓" description="所有分類分數都由版本化產品計分介面重算，沒有在地圖頁複製公式。" /><ScoreProfileTable rows={rows} /></section>
    <section><SectionHeading title="特務使用" description="只計算此地圖與目前其他篩選條件下，玩家實際使用的特務。" /><div className="surface-card overflow-hidden"><div className="overflow-x-auto"><table className="analysis-summary-table"><thead><tr><th>特務</th><th>出賽</th><th>玩家</th><th>ACS</th><th>ADR</th><th>K/D</th><th>KAST</th><th>勝率</th></tr></thead><tbody>{agents.map((agent) => <tr key={agent.id}><td>{agent.label}</td><td>{agent.appearances}</td><td>{agent.players}</td><td>{formatAcs(agent.acs)}</td><td>{formatAdr(agent.adr)}</td><td>{formatRatio(agent.kd)}</td><td>{formatPercent(agent.kast)}</td><td>{formatPercent(agent.winRate)}</td></tr>)}</tbody></table></div></div></section>
    {selected.entries.length > 0 && selected.entries.length < 5 ? <p className="sample-warning">目前地圖樣本偏少，請避免把單次結果解讀為穩定能力。</p> : null}
  </div>;
}
