import { lazy, Suspense } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RecentPerformance } from '../components/RecentPerformance';
import { ScoreBadge } from '../components/ScoreBadge';
import { SectionHeading } from '../components/SectionHeading';
import { getPlayerAnalytics, playerAnalytics } from '../data/analytics';
import { formatPercent } from '../utils/format';

const ScoreRadar = lazy(() => import('../components/ScoreRadar').then((module) => ({ default: module.ScoreRadar })));

const scoreRows = [
  { key: 'firepower', label: 'Firepower' },
  { key: 'entry', label: 'Entry' },
  { key: 'teamplay', label: 'Teamplay' },
  { key: 'clutch', label: 'Clutch' },
  { key: 'consistency', label: 'Consistency' },
] as const;

export function PlayerProfilePage() {
  const { playerId } = useParams();
  const analytics = getPlayerAnalytics(playerId ?? '') ?? playerAnalytics[0]!;
  const { player, stats, scores } = analytics;

  return (
    <div className="space-y-10">
      <Link to="/leaderboard" className="text-link">← Back to leaderboard</Link>
      <section className="profile-hero surface-card" style={{ '--player-accent': player.accent } as React.CSSProperties}>
        <div className="relative z-10">
          <div className="flex flex-wrap items-center gap-3">
            <span className="role-chip">{player.role}</span>
            {player.agents.map((agent) => <span className="agent-chip" key={agent}>{agent}</span>)}
          </div>
          <h1 className="mt-6 font-display text-5xl font-semibold tracking-tight text-white sm:text-7xl">{player.handle}</h1>
          <p className="mt-3 text-lg text-slate-300">{player.tagline}</p>
          <p className="mt-4 max-w-xl text-sm leading-7 text-slate-400">{player.playstyle}</p>
        </div>
        <div className="relative z-10"><ScoreBadge value={scores.overall} label="Overall" /></div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['ACS', stats.acs.toFixed(1)],
          ['ADR', stats.adr.toFixed(1)],
          ['K/D', stats.kd.toFixed(2)],
          ['KAST', formatPercent(stats.kast)],
          ['KPR', stats.kpr.toFixed(2)],
          ['APR', stats.apr.toFixed(2)],
          ['HS%', stats.headshotPercentage === undefined ? '—' : formatPercent(stats.headshotPercentage)],
          ['FK / FD', stats.fkFd?.toFixed(2) ?? '—'],
        ].map(([label, value]) => (
          <article className="surface-card p-4" key={label}><p className="metric-label">{label}</p><p className="mt-2 font-mono text-2xl text-white">{value}</p></article>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <article className="surface-card p-5 sm:p-7">
          <SectionHeading eyebrow="Performance shape" title="Category profile" description="Role-aware category scores, each bounded from 0 to 100." />
          <Suspense fallback={<div className="grid h-[320px] place-items-center text-sm text-slate-500">Loading chart…</div>}>
            <ScoreRadar analytics={analytics} />
          </Suspense>
        </article>
        <article className="surface-card p-5 sm:p-7">
          <SectionHeading eyebrow="Score detail" title="Five ways to contribute" description={'Sample confidence: ' + scores.confidence.toFixed(0) + '% from ' + stats.matches + ' matches.'} />
          <div className="space-y-5">
            {scoreRows.map(({ key, label }) => (
              <div key={key}>
                <div className="mb-2 flex items-center justify-between text-sm"><span>{label}</span><strong className="font-mono text-white">{scores[key].toFixed(1)}</strong></div>
                <div className="score-track"><span style={{ width: scores[key] + '%', backgroundColor: player.accent }} /></div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section>
        <SectionHeading eyebrow="Latest sample" title="Recent performance" description="Six latest fictional appearances in the deterministic demo dataset." />
        <div className="surface-card p-4 sm:p-6"><RecentPerformance analytics={analytics} /></div>
      </section>
    </div>
  );
}
