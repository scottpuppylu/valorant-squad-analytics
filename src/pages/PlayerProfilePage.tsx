import { lazy, Suspense, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { calculateRecentForm, groupByAgent, groupByMap, mapExtremes, mostUsedAgent } from '../analytics/analysis';
import { selectPerformances } from '../analytics/filters';
import { aggregateSelection } from '../analytics/rankings';
import { AnalysisFilterBar } from '../components/AnalysisFilterBar';
import { EmojiAvatarPicker } from '../components/EmojiAvatarPicker';
import { MetricInfo } from '../components/MetricInfo';
import { RecentPerformance } from '../components/RecentPerformance';
import { ScoreBadge } from '../components/ScoreBadge';
import { SectionHeading } from '../components/SectionHeading';
import { activeDataset, availableAgents, availableGameModes, availableMaps, performanceEntries } from '../data/analytics';
import { useAnalysisFilters } from '../hooks/useAnalysisFilters';
import { zhTW } from '../i18n/zhTW';
import { formatPercent } from '../utils/format';

const ScoreRadar = lazy(() => import('../components/ScoreRadar').then((module) => ({ default: module.ScoreRadar })));

const scoreRows = [
  { key: 'firepower', metricId: 'firepower', label: zhTW.scores.firepower },
  { key: 'entry', metricId: 'entry', label: zhTW.scores.entry },
  { key: 'teamplay', metricId: 'teamplay', label: zhTW.scores.teamplay },
  { key: 'clutch', metricId: 'clutch-score', label: zhTW.scores.clutch },
  { key: 'consistency', metricId: 'consistency', label: zhTW.scores.consistency },
] as const;

const formCopy = {
  up: ['↑', '近期上升'],
  flat: ['→', '近期持平'],
  down: ['↓', '近期下降'],
  insufficient: ['—', '樣本不足'],
} as const;

export function PlayerProfilePage() {
  const { playerId } = useParams();
  const { filters, update, reset } = useAnalysisFilters();
  const player = activeDataset.players.find((candidate) => candidate.id === playerId);
  const selection = useMemo(() => selectPerformances(performanceEntries, { ...filters, playerId: player?.id ?? '__missing__' }), [filters, player]);
  const analytics = useMemo(() => aggregateSelection(selection)[0], [selection]);
  const entries = selection.byPlayer.get(player?.id ?? '') ?? [];

  if (!player) {
    return <div className="empty-state-page"><div className="surface-card p-8 text-center"><p className="metric-label">找不到玩家</p><h1 className="mt-4 text-3xl font-semibold text-white">這個玩家連結不存在</h1><p className="mt-3 text-slate-400">請回到戰力排名選擇目前示範資料中的玩家。</p><Link className="button-primary mt-7" to="/leaderboard">返回戰力排名</Link></div></div>;
  }

  const maps = groupByMap(entries);
  const agents = groupByAgent(entries);
  const extremes = mapExtremes(player, entries);
  const primaryAgent = mostUsedAgent(entries);
  const form = calculateRecentForm(player, entries);
  const statCards: Array<[string, string, string]> = analytics ? [
    ['acs', 'ACS', analytics.stats.acs.toFixed(1)],
    ['adr', 'ADR', analytics.stats.adr.toFixed(1)],
    ['kd', 'K/D', analytics.stats.kd.toFixed(2)],
    ['kast', 'KAST', formatPercent(analytics.stats.kast)],
    ['kpr', 'KPR', analytics.stats.kpr.toFixed(2)],
    ['apr', 'APR', analytics.stats.apr.toFixed(2)],
    ['hs-percent', 'HS%', analytics.stats.headshotPercentage === undefined ? '—' : formatPercent(analytics.stats.headshotPercentage)],
    ['fk-fd', 'FK / FD', analytics.stats.fkFd?.toFixed(2) ?? '—'],
  ] : [];

  return <div className="space-y-10">
    <Link to="/leaderboard" className="text-link">← {zhTW.common.backToLeaderboard}</Link>
    <section className="profile-hero surface-card" style={{ '--player-accent': player.accent } as React.CSSProperties}>
      <div className="relative z-10"><div className="flex flex-wrap items-center gap-3"><span className="role-chip">{zhTW.roles[player.role]}</span>{player.agents.map((agent) => <span className="agent-chip" key={agent}>{agent}</span>)}</div><h1 className="mt-6 font-display text-5xl font-semibold tracking-tight text-white sm:text-7xl">{player.handle}</h1><p className="mt-3 text-lg text-slate-300">{player.tagline}</p><p className="mt-4 max-w-xl text-sm leading-7 text-slate-400">{player.playstyle}</p></div>
      <div className="relative z-10">{analytics ? <ScoreBadge value={analytics.scores.overall} label={zhTW.scores.overall} /> : <span className="metric-label">目前條件無資料</span>}</div>
    </section>

    <EmojiAvatarPicker key={player.id} player={player} />
    <AnalysisFilterBar filters={filters} onChange={update} onReset={reset} players={activeDataset.players} maps={availableMaps} agents={availableAgents} gameModes={availableGameModes} includePlayer={false} />

    {!analytics ? <div className="empty-panel surface-card">這位玩家在目前篩選條件下沒有出賽資料。</div> : <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{statCards.map(([metricId, label, value]) => <article className="surface-card p-4" key={metricId}><p className="metric-label"><MetricInfo metricId={metricId} label={label} /></p><p className="mt-2 font-mono text-2xl text-white">{value}</p></article>)}</section>

      <section className="profile-context-grid">
        <article className="surface-card context-card"><p className="metric-label">近期狀態</p><strong className={`form-indicator form-indicator--${form.status}`}>{formCopy[form.status][0]} {formCopy[form.status][1]}</strong><p>{form.delta === undefined ? `最近 ${form.recentMatches} 場／基準 ${form.baselineMatches} 場` : `${form.delta > 0 ? '+' : ''}${form.delta.toFixed(1)} 分 · 最近 ${form.recentMatches} 場對先前 ${form.baselineMatches} 場`}</p></article>
        <article className="surface-card context-card"><p className="metric-label">地圖輪廓</p><strong>{extremes.strongest ?? '樣本不足'}{extremes.weakest ? ` ／ ${extremes.weakest}` : ''}</strong><p>最強／較弱地圖；每張至少 2 次出賽才判定。</p></article>
        <article className="surface-card context-card"><p className="metric-label">最常使用特務</p><strong>{primaryAgent ?? '無資料'}</strong><p>{agents[0] ? `${agents[0].appearances} 次出賽，占目前條件 ${Math.round(agents[0].appearances / analytics.stats.matches * 100)}%` : '目前條件無特務樣本'}</p></article>
      </section>

      <section className="grid gap-6 xl:grid-cols-2"><article className="surface-card p-5 sm:p-7"><SectionHeading eyebrow="表現輪廓" title="分類雷達圖" description="角色感知分類分數，各項皆限制在 0 到 100。" /><Suspense fallback={<div className="grid h-[320px] place-items-center text-sm text-slate-500">{zhTW.common.loadingChart}</div>}><ScoreRadar analytics={analytics} /></Suspense></article><article className="surface-card p-5 sm:p-7"><SectionHeading eyebrow="分數明細" title="五種貢獻方式" description={`樣本信心：${analytics.scores.confidence.toFixed(0)}%，來自 ${analytics.stats.matches} 場對戰。`} /><div className="space-y-5">{scoreRows.map(({ key, metricId, label }) => <div key={key}><div className="mb-2 flex items-center justify-between text-sm"><MetricInfo metricId={metricId} label={label} /><strong className="font-mono text-white">{analytics.scores[key].toFixed(1)}</strong></div><div className="score-track"><span style={{ width: analytics.scores[key] + '%', backgroundColor: player.accent }} /></div></div>)}</div></article></section>

      <section><SectionHeading eyebrow="地圖切分" title="地圖表現" description="只呈現目前篩選條件內的出賽，並保留場次與回合樣本。" /><div className="surface-card overflow-hidden"><div className="overflow-x-auto"><table className="analysis-summary-table"><thead><tr><th>地圖</th><th>出賽</th><th>回合</th><th>勝率</th><th>ACS</th><th>ADR</th><th>K/D</th><th>KAST</th></tr></thead><tbody>{maps.map((map) => <tr key={map.id}><td>{map.label}</td><td>{map.appearances}</td><td>{map.rounds}</td><td>{formatPercent(map.winRate)}</td><td>{map.acs.toFixed(1)}</td><td>{map.adr.toFixed(1)}</td><td>{map.kd.toFixed(2)}</td><td>{formatPercent(map.kast)}</td></tr>)}</tbody></table></div></div></section>

      <section><SectionHeading eyebrow="特務切分" title="特務表現" description="依玩家在每場實際使用的特務分組，不以個人常用清單推測。" /><div className="surface-card overflow-hidden"><div className="overflow-x-auto"><table className="analysis-summary-table"><thead><tr><th>特務</th><th>出賽</th><th>回合</th><th>勝率</th><th>ACS</th><th>ADR</th><th>K/D</th><th>KAST</th></tr></thead><tbody>{agents.map((agent) => <tr key={agent.id}><td>{agent.label}</td><td>{agent.appearances}</td><td>{agent.rounds}</td><td>{formatPercent(agent.winRate)}</td><td>{agent.acs.toFixed(1)}</td><td>{agent.adr.toFixed(1)}</td><td>{agent.kd.toFixed(2)}</td><td>{formatPercent(agent.kast)}</td></tr>)}</tbody></table></div></div></section>

      <section><SectionHeading eyebrow="最新樣本" title="近期表現" description="目前篩選結果中最近六次出賽。" /><div className="surface-card p-4 sm:p-6"><RecentPerformance analytics={analytics} /></div></section>
    </>}
  </div>;
}
