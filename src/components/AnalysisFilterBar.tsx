import type { AgentName, GameMode, MapName, Player, PlayerRole } from '../types/valorant';
import type { AnalysisFilters } from '../analytics/types';
import { activeFilterSummary, gameModeLabels, periodLabels } from '../analytics/presentation';
import { zhTW } from '../i18n/zhTW';

interface AnalysisFilterBarProps {
  filters: AnalysisFilters;
  onChange: (patch: Partial<AnalysisFilters>) => void;
  onReset: () => void;
  players: Player[];
  maps: MapName[];
  agents: AgentName[];
  gameModes: GameMode[];
  includePlayer?: boolean;
  includeSamples?: boolean;
}

export function AnalysisFilterBar({ filters, onChange, onReset, players, maps, agents, gameModes, includePlayer = true, includeSamples = true }: AnalysisFilterBarProps) {
  const active = activeFilterSummary(filters);
  const roles: PlayerRole[] = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];
  return (
    <section className="analysis-filters surface-card" aria-label="分析篩選器">
      <div className="analysis-filter-grid">
        {includePlayer ? <label><span>玩家</span><select value={filters.playerId} onChange={(event) => onChange({ playerId: event.target.value })}><option value="all">全部玩家</option>{players.map((player) => <option value={player.id} key={player.id}>{player.handle}</option>)}</select></label> : null}
        <label><span>期間</span><select value={filters.period} onChange={(event) => onChange({ period: event.target.value as AnalysisFilters['period'] })}>{Object.entries(periodLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>地圖</span><select value={filters.map} onChange={(event) => onChange({ map: event.target.value as AnalysisFilters['map'] })}><option value="all">全部地圖</option>{maps.map((map) => <option key={map}>{map}</option>)}</select></label>
        <label><span>特務</span><select value={filters.agent} onChange={(event) => onChange({ agent: event.target.value as AnalysisFilters['agent'] })}><option value="all">全部特務</option>{agents.map((agent) => <option key={agent}>{agent}</option>)}</select></label>
        <label><span>角色</span><select value={filters.role} onChange={(event) => onChange({ role: event.target.value as AnalysisFilters['role'] })}><option value="all">全部角色</option>{roles.map((role) => <option value={role} key={role}>{zhTW.roles[role]}</option>)}</select></label>
        <label><span>模式</span><select value={filters.gameMode} onChange={(event) => onChange({ gameMode: event.target.value as AnalysisFilters['gameMode'] })}><option value="all">全部模式</option>{gameModes.map((mode) => <option value={mode} key={mode}>{gameModeLabels[mode]}</option>)}</select></label>
        {includeSamples ? <label><span>最少場次</span><input type="number" min="0" value={filters.minMatches} onChange={(event) => onChange({ minMatches: Math.max(0, Number(event.target.value) || 0) })} /></label> : null}
        {includeSamples ? <label><span>最少回合</span><input type="number" min="0" value={filters.minRounds} onChange={(event) => onChange({ minRounds: Math.max(0, Number(event.target.value) || 0) })} /></label> : null}
      </div>
      {filters.period === 'custom' ? <div className="custom-date-grid"><label><span>開始日期</span><input type="date" value={filters.dateFrom ?? ''} onChange={(event) => onChange({ dateFrom: event.target.value || undefined })} /></label><label><span>結束日期</span><input type="date" value={filters.dateTo ?? ''} onChange={(event) => onChange({ dateTo: event.target.value || undefined })} /></label></div> : null}
      <div className="active-filters"><span>目前條件：</span><strong>{active.length ? active.join(' · ') : '全部資料'}</strong><button type="button" className="text-link" onClick={onReset}>清除全部</button></div>
      <p className="filter-note">「最近 N 場」是每位玩家在其他條件套用後，各自最新的 N 次符合出賽。</p>
    </section>
  );
}
