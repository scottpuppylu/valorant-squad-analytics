import type { AgentName, GameMode, MapName, Player, PlayerRole } from '../types/valorant';
import type { AnalysisFilters } from '../analytics/types';
import { activeFilterSummary, browsePeriodLabels, gameModeLabels, periodLabels } from '../analytics/presentation';
import { isAbsoluteStrengthMode } from '../analytics/modeEligibility';
import { zhTW } from '../i18n/zhTW';
import { actOptionLabel, compareSeasonKeysDesc } from '../analytics/scope/season';

const allPeriods: AnalysisFilters['period'][] = ['current', 'all', 'act', 'recent10', 'recent30', 'custom'];

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
  /** Scope choices this page offers (browse pages omit adaptive 目前實力). */
  periods?: AnalysisFilters['period'][];
  /** Public Act keys with durable evidence; empty means 指定 Act is unavailable. */
  seasonKeys?: string[];
  /** Match History browsing: every tracked mode is selectable. Strength pages lock the mode to 排位. */
  browse?: boolean;
}

export function AnalysisFilterBar({ filters, onChange, onReset, players, maps, agents, gameModes, includePlayer = true, includeSamples = true, periods = allPeriods, seasonKeys = [], browse = false }: AnalysisFilterBarProps) {
  const active = activeFilterSummary(filters);
  const labels = browse ? browsePeriodLabels : periodLabels;
  // mode-eligibility-policy-v1: strength analytics never offer Unrated / entertainment modes.
  const modeOptions = browse ? gameModes : gameModes.filter(isAbsoluteStrengthMode);
  const ineligibleMode = !browse && filters.gameMode !== 'all' && !isAbsoluteStrengthMode(filters.gameMode);
  const roles: PlayerRole[] = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];
  return (
    <section className="analysis-filters surface-card" aria-label="分析篩選器">
      <div className="analysis-filter-grid">
        {includePlayer ? <label><span>玩家</span><select value={filters.playerId} onChange={(event) => onChange({ playerId: event.target.value })}><option value="all">全部玩家</option>{players.map((player) => <option value={player.id} key={player.id}>{player.handle}</option>)}</select></label> : null}
        <label><span>資料範圍</span><select value={filters.period} onChange={(event) => onChange({ period: event.target.value as AnalysisFilters['period'] })}>{periods.map((value) => <option value={value} key={value} disabled={value === 'act' && seasonKeys.length === 0 && filters.period !== 'act'}>{value === 'act' && seasonKeys.length === 0 ? '指定 Act（目前沒有 Act 資料）' : labels[value]}</option>)}</select></label>
        {filters.period === 'act' ? <label><span>Act</span><select value={filters.act ?? ''} onChange={(event) => onChange({ act: event.target.value || undefined })}><option value="">請選擇 Act</option>{[...seasonKeys].sort(compareSeasonKeysDesc).map((key, index) => <option value={key} key={key}>{actOptionLabel(key, index)}</option>)}</select></label> : null}
        <label><span>地圖</span><select value={filters.map} onChange={(event) => onChange({ map: event.target.value as AnalysisFilters['map'] })}><option value="all">全部地圖</option>{maps.map((map) => <option key={map}>{map}</option>)}</select></label>
        <label><span>特務</span><select value={filters.agent} onChange={(event) => onChange({ agent: event.target.value as AnalysisFilters['agent'] })}><option value="all">全部特務</option>{agents.map((agent) => <option key={agent}>{agent}</option>)}</select></label>
        <label><span>角色</span><select value={filters.role} onChange={(event) => onChange({ role: event.target.value as AnalysisFilters['role'] })}><option value="all">全部角色</option>{roles.map((role) => <option value={role} key={role}>{zhTW.roles[role]}</option>)}</select></label>
        <label><span>模式</span><select value={filters.gameMode} onChange={(event) => onChange({ gameMode: event.target.value as AnalysisFilters['gameMode'] })}><option value="all">{browse ? '全部模式' : '排位（戰力分析固定）'}</option>{modeOptions.map((mode) => <option value={mode} key={mode}>{gameModeLabels[mode] ?? mode}</option>)}{ineligibleMode ? <option value={filters.gameMode} disabled>{gameModeLabels[filters.gameMode] ?? filters.gameMode}（不適用）</option> : null}</select></label>
        {includeSamples ? <label><span>最少場次</span><input type="number" min="0" value={filters.minMatches} onChange={(event) => onChange({ minMatches: Math.max(0, Number(event.target.value) || 0) })} /></label> : null}
        {includeSamples ? <label><span>最少回合</span><input type="number" min="0" value={filters.minRounds} onChange={(event) => onChange({ minRounds: Math.max(0, Number(event.target.value) || 0) })} /></label> : null}
      </div>
      {filters.period === 'custom' ? <div className="custom-date-grid"><label><span>開始日期</span><input type="date" value={filters.dateFrom ?? ''} onChange={(event) => onChange({ dateFrom: event.target.value || undefined })} /></label><label><span>結束日期</span><input type="date" value={filters.dateTo ?? ''} onChange={(event) => onChange({ dateTo: event.target.value || undefined })} /></label></div> : null}
      <div className="active-filters"><span>目前條件：</span><strong>{active.length ? active.join(' · ') : '全部資料'}</strong><button type="button" className="text-link" onClick={onReset}>清除全部</button></div>
      {ineligibleMode ? <p className="sample-warning" role="alert">此分析僅使用排位模式；一般模式僅用於同場相對比較，娛樂模式不納入戰力分析。<button type="button" className="text-link" onClick={() => onChange({ gameMode: 'all' })}>改用排位</button></p> : null}
      {browse ? null : <p className="filter-note">戰力分析（分數、K/D、ADR、ACS、KAST、地圖、特務、武器、進步與搭檔）僅使用排位模式。</p>}
      <p className="filter-note">「目前實力」依相同規則（adaptive-window-v1）為每位玩家選出近期競技區間，依回合數、活躍天數與時間跨度決定，不只看場數。「最近 N 場」是每位玩家在其他條件套用後，各自最新的 N 次符合資格出賽{browse ? '' : '（只計排位）'}。</p>
    </section>
  );
}
