import { useMemo } from 'react';
import { rankAnalytics } from '../analytics/rankings';
import type { MapTopDimension } from '../analytics/summary';
import { AnalysisFilterBar } from '../components/AnalysisFilterBar';
import { PlayerRankingTable } from '../components/PlayerRankingTable';
import { SectionHeading } from '../components/SectionHeading';
import { ScoreProfileTable } from '../components/ScoreProfileTable';
import { useDataset } from '../hooks/useDataset';
import { useAnalysisFilters } from '../hooks/useAnalysisFilters';
import { ScopeExplanation } from '../components/ScopeExplanation';
import { AnalysisStatusNotice } from '../components/AnalysisStatusNotice';
import { useScopedAnalysis } from '../hooks/useScopedAnalysis';
import { zhTW } from '../i18n/zhTW';
import { formatAcs, formatAdr, formatPercent, formatRatio } from '../utils/format';

/** 最高分類 label; the value itself is computed by selection-summary-v1 (server or local). */
function topCategoryLabel(value: MapTopDimension | undefined): string {
  if (value === undefined || value === 'none') return '無資料';
  if (value === 'insufficient') return '資料不足';
  return zhTW.scores[value];
}

export function MapsPage() {
  const { analytics: { activeDataset, availableAgents, availableGameModes, availableMaps, population } } = useDataset();
  const { filters, update, reset } = useAnalysisFilters();
  const baseFilters = useMemo(() => ({ ...filters, map: 'all' as const }), [filters]);
  const baseAnalysis = useScopedAnalysis(baseFilters, { lifetimeFeature: 'mapStats' });
  const baseSelection = baseAnalysis.selection;
  // Aggregates of the full tracked population (server-analysis-v2) or the local Demo selection.
  const summaries = baseAnalysis.summary.groups.maps;
  const selectedMap = (filters.map === 'all' ? (summaries[0]?.id ?? availableMaps[0]) : filters.map) as typeof filters.map;
  const selectedFilters = useMemo(() => ({ ...filters, map: selectedMap }), [filters, selectedMap]);
  const selectedAnalysis = useScopedAnalysis(selectedFilters, { lifetimeFeature: 'mapStats' });
  const selectedSummary_ = selectedAnalysis.summary;
  const rows = useMemo(() => rankAnalytics(selectedSummary_.analytics, filters, 'overall'), [filters, selectedSummary_]);
  const agents = selectedSummary_.groups.agents;
  const selectedSummary = summaries.find((summary) => summary.id === selectedMap);

  return <div className="space-y-9"><header className="page-heading"><div><p className="metric-label">地圖切分</p><h1>地圖分析</h1><p>比較各地圖的出賽樣本與表現；場次差異不代表地圖造成結果。</p></div></header>
    <AnalysisFilterBar filters={filters} onChange={update} onReset={reset} players={activeDataset.players} maps={availableMaps} agents={availableAgents} gameModes={availableGameModes} seasonKeys={population.seasonKeys} />
    <AnalysisStatusNotice analysis={baseAnalysis} />
    <ScopeExplanation scope={baseSelection.scope} players={activeDataset.players} source={baseAnalysis.source} trackedMatchCount={baseAnalysis.trackedMatchCount} />
    <section><SectionHeading title="地圖總覽" description="每張卡片保留場次與回合分母；最高分類是該地圖玩家平均最高的目前分數面向。" /><div className="summary-grid">{summaries.map((summary) => { return <button type="button" className={`surface-card summary-card ${summary.id === selectedMap ? 'summary-card--active' : ''}`} key={summary.id} onClick={() => update({ map: summary.id as typeof filters.map })}><strong>{summary.label}</strong><span>{summary.matches} 場 · {summary.rounds} 玩家回合</span><dl><div><dt>勝率</dt><dd>{formatPercent(summary.winRate)}</dd></div><div><dt>ACS</dt><dd>{formatAcs(summary.acs)}</dd></div><div><dt>KAST</dt><dd>{(summary.kast === undefined ? '—' : formatPercent(summary.kast))}</dd></div><div><dt>最高分類</dt><dd>{topCategoryLabel(baseAnalysis.summary.mapTopDimension[summary.id])}</dd></div></dl></button>; })}</div></section>
    <section><SectionHeading title={`${selectedMap ?? '地圖'}玩家排名`} description={selectedSummary ? `${selectedSummary.matches} 場對戰、${selectedSummary.rounds} 玩家回合；勝 ${selectedSummary.wins} 次出賽、負 ${selectedSummary.appearances - selectedSummary.wins} 次出賽。` : '無符合條件的地圖資料。'} /><PlayerRankingTable rows={rows} metric="overall" /></section>
    <section><SectionHeading title="分數與原始指標輪廓" description="所有分類分數都由版本化產品計分介面重算，沒有在地圖頁複製公式。" /><ScoreProfileTable rows={rows} /></section>
    <section><SectionHeading title="特務使用" description="只計算此地圖與目前其他篩選條件下，玩家實際使用的特務。" /><div className="surface-card overflow-hidden"><div className="table-scroll" tabIndex={0} role="region" aria-label="地圖特務摘要，可水平捲動"><table className="analysis-summary-table"><thead><tr><th scope="col">特務</th><th scope="col">出賽</th><th scope="col">玩家</th><th scope="col">ACS</th><th scope="col">ADR</th><th scope="col">K/D</th><th scope="col">KAST</th><th scope="col">勝率</th></tr></thead><tbody>{agents.map((agent) => <tr key={agent.id}><td>{agent.label}</td><td>{agent.appearances}</td><td>{agent.players}</td><td>{formatAcs(agent.acs)}</td><td>{formatAdr(agent.adr)}</td><td>{formatRatio(agent.kd)}</td><td>{(agent.kast === undefined ? '—' : formatPercent(agent.kast))}</td><td>{formatPercent(agent.winRate)}</td></tr>)}</tbody></table></div></div></section>
    {selectedSummary_.entryCount > 0 && selectedSummary_.entryCount < 5 ? <p className="sample-warning">目前地圖樣本偏少，請避免把單次結果解讀為穩定能力。</p> : null}
  </div>;
}
