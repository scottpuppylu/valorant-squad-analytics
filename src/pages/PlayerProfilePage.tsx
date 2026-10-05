import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';
import { dimensions } from '../scoring/versions';
import { scoreMetricIds } from '../i18n/zhTW';
import { ScoreExplanation } from '../components/ScoreExplanation';
import { lazy, Suspense, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { calculateRecentForm, recentFormFromWindow, groupByAgent, groupByMap, mapExtremes, mostUsedAgent } from '../analytics/analysis';
import { selectPerformances } from '../analytics/filters';
import { aggregateSelection } from '../analytics/rankings';
import { AnalysisFilterBar } from '../components/AnalysisFilterBar';
import { EmojiAvatarPicker } from '../components/EmojiAvatarPicker';
import { MetricInfo } from '../components/MetricInfo';
import { RecentPerformance } from '../components/RecentPerformance';
import { ScoreBadge } from '../components/ScoreBadge';
import { SectionHeading } from '../components/SectionHeading';
import { useDataset } from '../hooks/useDataset';
import { useAnalysisFilters } from '../hooks/useAnalysisFilters';
import { ScopeExplanation } from '../components/ScopeExplanation';
import { AnalysisStatusNotice } from '../components/AnalysisStatusNotice';
import { useScopedAnalysis } from '../hooks/useScopedAnalysis';
import { describeWindow, scopeReasonLabels } from '../analytics/presentation';
import { zhTW } from '../i18n/zhTW';
import { formatAcs, formatAdr, formatPercent, formatRatio, formatScore } from '../utils/format';

const ScoreRadar = lazy(() => import('../components/ScoreRadar').then((module) => ({ default: module.ScoreRadar })));

const scoreRows = dimensions.map((key) => ({key,metricId:scoreMetricIds[key],label:zhTW.scores[key]}));
const rawGroups: Array<[string, string[]]> = [['交戰',['acs','adr','kd','kpr','hs-percent']],['團隊／回合',['kast','apr']],['開局',['fk-fd']]];

const formCopy = {
  up: ['↑', '近期上升'],
  flat: ['→', '近期持平'],
  down: ['↓', '近期下降'],
  insufficient: ['—', '樣本不足'],
} as const;

export function PlayerProfilePage() {
  const { analytics: { activeDataset, availableAgents, availableGameModes, availableMaps, performanceEntries, population } } = useDataset();
  const { playerId } = useParams();
  const { filters, update, reset } = useAnalysisFilters('current');
  const player = activeDataset.players.find((candidate) => candidate.id === playerId);
  const profileFilters = useMemo(() => ({ ...filters, playerId: player?.id ?? '__missing__' }), [filters, player]);
  const analysis = useScopedAnalysis(profileFilters, { form: true });
  const selection = analysis.selection;
  // Recent form selects its own adaptive current/baseline windows from the context without a horizon.
  const formEntries = useMemo(() => selectPerformances(performanceEntries, { ...filters, period: 'all', playerId: player?.id ?? '__missing__' }, { population }).byPlayer.get(player?.id ?? '') ?? [], [filters, performanceEntries, player, population]);
  const analytics = useMemo(() => aggregateSelection(selection)[0], [selection]);
  const entries = selection.byPlayer.get(player?.id ?? '') ?? [];

  if (!player) {
    return <EmptyState page title="這個玩家連結不存在" description="請回到戰力排名選擇目前資料集中的玩家。" actions={<Link className="button-primary" to="/leaderboard">返回戰力排名</Link>} />;
  }

  const maps = groupByMap(entries);
  const agents = groupByAgent(entries);
  const extremes = mapExtremes(player, entries);
  const primaryAgent = mostUsedAgent(entries);
  const serverForm = analysis.formWindows?.get(player.id);
  const form = serverForm ? recentFormFromWindow(player, serverForm) : calculateRecentForm(player, formEntries, population);
  const statCards: Array<[string, string, string]> = analytics ? [
    ['acs', 'ACS', formatAcs(analytics.stats.acs)],
    ['adr', 'ADR', formatAdr(analytics.stats.adr)],
    ['kd', 'K/D', formatRatio(analytics.stats.kd)],
    ['kast', 'KAST', (analytics.stats.kast === undefined ? '—' : formatPercent(analytics.stats.kast))],
    ['kpr', 'KPR', formatRatio(analytics.stats.kpr)],
    ['apr', 'APR', formatRatio(analytics.stats.apr)],
    ['hs-percent', 'HS%', analytics.stats.headshotPercentage === undefined ? '—' : formatPercent(analytics.stats.headshotPercentage)],
    ['fk-fd', 'FK / FD', analytics.stats.fkFd === undefined ? '—' : formatRatio(analytics.stats.fkFd)],
  ] : [];

  return <div className="space-y-10">
    <Link to="/leaderboard" className="text-link">← {zhTW.common.backToLeaderboard}</Link>
    <section className="profile-hero surface-card" style={{ '--player-accent': player.accent } as React.CSSProperties}>
      <div className="relative z-10"><div className="flex flex-wrap items-center gap-3"><span className="role-chip">{zhTW.roles[player.role]}</span>{player.agents.map((agent) => <span className="agent-chip" key={agent}>{agent}</span>)}</div><h1 className="mt-6 font-display text-5xl font-semibold tracking-tight text-white sm:text-7xl">{player.handle}</h1><p className="mt-3 text-lg text-slate-300">{player.tagline}</p></div>
      <div className="relative z-10">{analytics ? <><ScoreBadge value={analytics.scores.overall} label={zhTW.scores.overall} /><p className="mt-3 text-sm text-slate-300">樣本信心 {formatPercent(analytics.scores.confidence / 100)} · {analytics.stats.matches} 場</p></> : <span className="metric-label">目前條件無資料</span>}</div>
    </section>

    <EmojiAvatarPicker key={player.id} player={player} />
    <AnalysisFilterBar filters={filters} onChange={update} onReset={reset} players={activeDataset.players} maps={availableMaps} agents={availableAgents} gameModes={availableGameModes} includePlayer={false} seasonKeys={population.seasonKeys} />
    <AnalysisStatusNotice analysis={analysis} />
    <ScopeExplanation scope={selection.scope} players={activeDataset.players} source={analysis.source} trackedMatchCount={analysis.trackedMatchCount} />

    {!analytics ? <EmptyState title="目前條件下沒有出賽資料" description="請調整日期、地圖或特務條件。" actions={<button className="button-secondary" onClick={reset} type="button">重設條件</button>} /> : <>


      <section className="profile-context-grid">
        <article className="surface-card context-card"><p className="metric-label">近期狀態</p><strong className={`form-indicator form-indicator--${form.status}`}>{formCopy[form.status][0]} {formCopy[form.status][1]}</strong><p>{form.delta === undefined ? `現況 ${form.recentMatches} 場／基準 ${form.baselineMatches} 場` : `${form.delta > 0 ? '+' : ''}${formatScore(form.delta)} 分 · 現況 ${form.recentMatches} 場對基準 ${form.baselineMatches} 場`}</p>{form.window ? <details className="mt-2 text-xs text-slate-400"><summary className="cursor-pointer">為什麼是這個區間？</summary><p>現況：{describeWindow(form.window.current)}</p>{form.window.baseline ? <p>基準：{describeWindow(form.window.baseline)}</p> : null}<p>區間信心：{formatPercent(form.window.confidence.overall, 0)} · 僅競技模式 · adaptive-window-v1</p><p>選擇原因：{form.window.reasons.map((reason) => scopeReasonLabels[reason]).join('、')}</p></details> : null}</article>
        <article className="surface-card context-card"><p className="metric-label">地圖輪廓</p><strong>{extremes.strongest ?? '樣本不足'}{extremes.weakest ? ` ／ ${extremes.weakest}` : ''}</strong><p>最強／較弱地圖；每張至少 2 次出賽才判定。</p></article>
        <article className="surface-card context-card"><p className="metric-label">最常使用特務</p><strong>{primaryAgent ?? '無資料'}</strong><p>{agents[0] ? `${agents[0].appearances} 次出賽，占目前條件 ${formatPercent(agents[0].appearances / analytics.stats.matches)}` : '目前條件無特務樣本'}</p></article>
      </section>

      <section className="grid gap-6 xl:grid-cols-2"><article className="surface-card p-5 sm:p-7"><SectionHeading eyebrow="表現輪廓" title="分類雷達圖" description="角色感知分類分數，各項皆限制在 0 到 100。" /><Suspense fallback={<div className="grid h-[320px] place-items-center text-sm text-slate-500">{zhTW.common.loadingChart}</div>}><ScoreRadar analytics={analytics} /></Suspense></article><article className="surface-card p-5 sm:p-7"><SectionHeading eyebrow="分數明細" title="八種貢獻方式" description={`樣本信心：${formatScore(analytics.scores.confidence)}%，來自 ${analytics.stats.matches} 場對戰。`} /><div className="score-grid">{scoreRows.map(({ key, metricId, label }) => <div key={key} className="score-summary"><div className="score-summary-header"><MetricInfo metricId={metricId} label={label} /><strong className="font-mono text-white">{analytics.scores[key].value === undefined ? '資料不足' : formatScore(analytics.scores[key].value)}</strong><StatusBadge status={analytics.scores[key].status} coverage={analytics.scores[key].coverage.ratio} /></div><small>{analytics.scores[key].sample.matches} 場 · {analytics.scores[key].sample.rounds} 回合</small><div className="score-track"><span style={{ width: (analytics.scores[key].value ?? 0) + '%', backgroundColor: player.accent }} /></div><ScoreExplanation score={analytics.scores[key]} /></div>)}</div><ScoreExplanation score={analytics.scores.overall} /></article></section>

      <section><SectionHeading title="原始數據" /><div className="grid gap-4 lg:grid-cols-3">{rawGroups.map(([title, ids]) => <article className="surface-card p-5" key={title as string}><h3 className="mb-4 text-white">{title}</h3><dl className="grid grid-cols-2 gap-4">{statCards.filter(([id]) => ids.includes(id)).map(([id,label,value]) => <div key={id}><dt className="metric-label"><MetricInfo metricId={id} label={label} /></dt><dd className="stat-value">{value}</dd></div>)}{title === '開局' ? <><div><dt className="metric-label">FK</dt><dd className="stat-value">{analytics.stats.firstKills ?? '—'}</dd></div><div><dt className="metric-label">FD</dt><dd className="stat-value">{analytics.stats.firstDeaths ?? '—'}</dd></div></> : null}</dl></article>)}</div></section>

      <section><SectionHeading eyebrow="地圖切分" title="地圖表現" description="只呈現目前篩選條件內的出賽，並保留場次與回合樣本。" /><div className="surface-card overflow-hidden"><div className="table-scroll" tabIndex={0} role="region" aria-label="玩家情境統計，可水平捲動"><table className="analysis-summary-table"><thead><tr><th scope="col">地圖</th><th scope="col">出賽</th><th scope="col">回合</th><th scope="col">勝率</th><th scope="col">ACS</th><th scope="col">ADR</th><th scope="col">K/D</th><th scope="col">KAST</th></tr></thead><tbody>{maps.map((map) => <tr key={map.id}><td>{map.label}</td><td>{map.appearances}</td><td>{map.rounds}</td><td>{formatPercent(map.winRate)}</td><td>{formatAcs(map.acs)}</td><td>{formatAdr(map.adr)}</td><td>{formatRatio(map.kd)}</td><td>{(map.kast === undefined ? '—' : formatPercent(map.kast))}</td></tr>)}</tbody></table></div></div></section>

      <section><SectionHeading eyebrow="特務切分" title="特務表現" description="依玩家在每場實際使用的特務分組，不以個人常用清單推測。" /><div className="surface-card overflow-hidden"><div className="table-scroll" tabIndex={0} role="region" aria-label="玩家情境統計，可水平捲動"><table className="analysis-summary-table"><thead><tr><th scope="col">特務</th><th scope="col">出賽</th><th scope="col">回合</th><th scope="col">勝率</th><th scope="col">ACS</th><th scope="col">ADR</th><th scope="col">K/D</th><th scope="col">KAST</th></tr></thead><tbody>{agents.map((agent) => <tr key={agent.id}><td>{agent.label}</td><td>{agent.appearances}</td><td>{agent.rounds}</td><td>{formatPercent(agent.winRate)}</td><td>{formatAcs(agent.acs)}</td><td>{formatAdr(agent.adr)}</td><td>{formatRatio(agent.kd)}</td><td>{(agent.kast === undefined ? '—' : formatPercent(agent.kast))}</td></tr>)}</tbody></table></div></div></section>

      <section><SectionHeading eyebrow="最新樣本" title="近期表現" description="目前篩選結果中最近六次出賽。" /><div className="surface-card p-4 sm:p-6"><RecentPerformance analytics={analytics} /></div></section>
    </>}
  </div>;
}
