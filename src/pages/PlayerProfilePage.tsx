import { lazy, Suspense } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmojiAvatarPicker } from '../components/EmojiAvatarPicker';
import { MetricInfo } from '../components/MetricInfo';
import { RecentPerformance } from '../components/RecentPerformance';
import { ScoreBadge } from '../components/ScoreBadge';
import { SectionHeading } from '../components/SectionHeading';
import { getPlayerAnalytics } from '../data/analytics';
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

export function PlayerProfilePage() {
  const { playerId } = useParams();
  const analytics = getPlayerAnalytics(playerId ?? '');

  if (!analytics) {
    return (
      <div className="empty-state-page">
        <div className="surface-card p-8 text-center">
          <p className="metric-label">找不到玩家</p>
          <h1 className="mt-4 text-3xl font-semibold text-white">這個玩家連結不存在</h1>
          <p className="mt-3 text-slate-400">請回到戰力排名選擇目前示範資料中的玩家。</p>
          <Link className="button-primary mt-7" to="/leaderboard">返回戰力排名</Link>
        </div>
      </div>
    );
  }

  const { player, stats, scores } = analytics;
  const statCards = [
    ['acs', 'ACS', stats.acs.toFixed(1)],
    ['adr', 'ADR', stats.adr.toFixed(1)],
    ['kd', 'K/D', stats.kd.toFixed(2)],
    ['kast', 'KAST', formatPercent(stats.kast)],
    ['kpr', 'KPR', stats.kpr.toFixed(2)],
    ['apr', 'APR', stats.apr.toFixed(2)],
    ['hs-percent', 'HS%', stats.headshotPercentage === undefined ? '—' : formatPercent(stats.headshotPercentage)],
    ['fk-fd', 'FK / FD', stats.fkFd?.toFixed(2) ?? '—'],
  ] as const;

  return (
    <div className="space-y-10">
      <Link to="/leaderboard" className="text-link">← {zhTW.common.backToLeaderboard}</Link>
      <section className="profile-hero surface-card" style={{ '--player-accent': player.accent } as React.CSSProperties}>
        <div className="relative z-10">
          <div className="flex flex-wrap items-center gap-3">
            <span className="role-chip">{zhTW.roles[player.role]}</span>
            {player.agents.map((agent) => <span className="agent-chip" key={agent}>{agent}</span>)}
          </div>
          <h1 className="mt-6 font-display text-5xl font-semibold tracking-tight text-white sm:text-7xl">{player.handle}</h1>
          <p className="mt-3 text-lg text-slate-300">{player.tagline}</p>
          <p className="mt-4 max-w-xl text-sm leading-7 text-slate-400">{player.playstyle}</p>
        </div>
        <div className="relative z-10"><ScoreBadge value={scores.overall} label={zhTW.scores.overall} /></div>
      </section>

      <EmojiAvatarPicker key={player.id} player={player} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map(([metricId, label, value]) => (
          <article className="surface-card p-4" key={metricId}><p className="metric-label"><MetricInfo metricId={metricId} label={label} /></p><p className="mt-2 font-mono text-2xl text-white">{value}</p></article>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <article className="surface-card p-5 sm:p-7">
          <SectionHeading eyebrow="表現輪廓" title="分類雷達圖" description="角色感知分類分數，各項皆限制在 0 到 100。" />
          <Suspense fallback={<div className="grid h-[320px] place-items-center text-sm text-slate-500">{zhTW.common.loadingChart}</div>}>
            <ScoreRadar analytics={analytics} />
          </Suspense>
        </article>
        <article className="surface-card p-5 sm:p-7">
          <SectionHeading eyebrow="分數明細" title="五種貢獻方式" description={`樣本信心：${scores.confidence.toFixed(0)}%，來自 ${stats.matches} 場對戰。`} />
          <div className="space-y-5">
            {scoreRows.map(({ key, metricId, label }) => (
              <div key={key}>
                <div className="mb-2 flex items-center justify-between text-sm"><MetricInfo metricId={metricId} label={label} /><strong className="font-mono text-white">{scores[key].toFixed(1)}</strong></div>
                <div className="score-track"><span style={{ width: scores[key] + '%', backgroundColor: player.accent }} /></div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section>
        <SectionHeading eyebrow="最新樣本" title="近期表現" description="固定虛構資料集中最近六次出賽。" />
        <div className="surface-card p-4 sm:p-6"><RecentPerformance analytics={analytics} /></div>
      </section>
    </div>
  );
}
