import { useMemo } from 'react';
import { rankAnalytics } from '../analytics/rankings';
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
import type { PlayerRole } from '../types/valorant';
import { formatAcs, formatAdr, formatPercent, formatRatio } from '../utils/format';

export function AgentsPage() {
  const { analytics: { activeDataset, availableAgents, availableGameModes, availableMaps, population } } = useDataset();
  const { filters, update, reset, params, setParams } = useAnalysisFilters();
  const view = params.get('view') === 'role' ? 'role' : 'agent';
  const baseFilters = useMemo(() => ({ ...filters, agent: 'all' as const, role: 'all' as const }), [filters]);
  const baseAnalysis = useScopedAnalysis(baseFilters, { lifetimeFeature: 'agentStats' });
  const baseSelection = baseAnalysis.selection;
  const summaries = view === 'agent' ? baseAnalysis.summary.groups.agents : baseAnalysis.summary.groups.roles;
  const selectedId = view === 'agent' ? (filters.agent === 'all' ? summaries[0]?.id : filters.agent) : (filters.role === 'all' ? summaries[0]?.id : filters.role);
  const selectedFilters = useMemo(() => ({ ...filters, agent: view === 'agent' ? selectedId as typeof filters.agent : 'all' as const, role: view === 'role' ? selectedId as PlayerRole : 'all' as const }), [filters, selectedId, view]);
  const selectedAnalysis = useScopedAnalysis(selectedFilters, { lifetimeFeature: 'agentStats' });
  const selectedSummary = selectedAnalysis.summary;
  const rows = useMemo(() => rankAnalytics(selectedSummary.analytics, filters, 'overall'), [filters, selectedSummary]);

  function changeView(nextView: string) {
    const next = new URLSearchParams(params);
    if (nextView === 'role') next.set('view', 'role'); else next.delete('view');
    next.delete('agent'); next.delete('role');
    setParams(next, { replace: true });
  }

  function selectSummary(id: string) {
    update(view === 'agent' ? { agent: id as typeof filters.agent } : { role: id as PlayerRole });
  }

  return <div className="space-y-9"><header className="page-heading"><div><p className="metric-label">使用情境</p><h1>特務／角色分析</h1><p>依每場實際選角比較樣本與表現，不代表特務或角色造成結果。</p></div><label className="select-label"><span>檢視方式</span><select aria-label="檢視方式" value={view} onChange={(event) => changeView(event.target.value)}><option value="agent">特務</option><option value="role">角色</option></select></label></header>
    <AnalysisFilterBar filters={filters} onChange={update} onReset={reset} players={activeDataset.players} maps={availableMaps} agents={availableAgents} gameModes={availableGameModes} seasonKeys={population.seasonKeys} />
    <AnalysisStatusNotice analysis={baseAnalysis} />
    <ScopeExplanation scope={baseSelection.scope} players={activeDataset.players} source={baseAnalysis.source} trackedMatchCount={baseAnalysis.trackedMatchCount} />
    <section><SectionHeading title={view === 'agent' ? '特務總覽' : '角色總覽'} description={view === 'agent' ? '每筆出賽只歸到玩家當場實際使用的特務。' : '目前分數使用產品校準角色基準，不是 Riot 官方角色標準。'} /><div className="summary-grid">{summaries.map((summary) => <button type="button" className={`surface-card summary-card ${summary.id === selectedId ? 'summary-card--active' : ''}`} key={summary.id} onClick={() => selectSummary(summary.id)}><strong>{view === 'role' ? zhTW.roles[summary.id as PlayerRole] : summary.label}</strong><span>{summary.appearances} 次出賽 · {summary.players} 位玩家</span><dl><div><dt>ACS</dt><dd>{formatAcs(summary.acs)}</dd></div><div><dt>ADR</dt><dd>{formatAdr(summary.adr)}</dd></div><div><dt>K/D</dt><dd>{formatRatio(summary.kd)}</dd></div><div><dt>勝率</dt><dd>{formatPercent(summary.winRate)}</dd></div></dl></button>)}</div></section>
    <section><SectionHeading title={`${selectedId ? (view === 'role' ? zhTW.roles[selectedId as PlayerRole] : selectedId) : ''}玩家排名`} description="只顯示目前條件下有實際出賽且符合樣本門檻的玩家。" /><PlayerRankingTable rows={rows} metric="overall" /></section>
    <section><SectionHeading title="分數與原始指標輪廓" description={view === 'role' ? '以版本化產品角色基準重算各分類；不是 Riot 官方角色標準。' : '僅使用玩家實際選用此特務的出賽樣本。'} /><ScoreProfileTable rows={rows} /></section>
  </div>;
}
