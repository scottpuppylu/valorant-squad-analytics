import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { CategoryLeaders } from '../components/CategoryLeaders';
import { PlayerCard } from '../components/PlayerCard';
import { RecentPerformance } from '../components/RecentPerformance';
import { ScoreBadge } from '../components/ScoreBadge';
import { SectionHeading } from '../components/SectionHeading';
import { playerAnalytics } from '../data/analytics';
import { demoMatches } from '../data/demoMatches';
import { formatPercent } from '../utils/format';

const ScoreRadar = lazy(() => import('../components/ScoreRadar').then((module) => ({ default: module.ScoreRadar })));

export function DashboardPage() {
  const [selectedPlayerId, setSelectedPlayerId] = useState(playerAnalytics[0]!.player.id);
  const selected = playerAnalytics.find(({ player }) => player.id === selectedPlayerId) ?? playerAnalytics[0]!;
  const leader = playerAnalytics[0]!;
  const teamWinRate = demoMatches.filter((match) => match.won).length / demoMatches.length;

  return (
    <div className="space-y-14">
      <section className="hero-grid">
        <div className="max-w-3xl">
          <span className="data-pill mb-5 inline-flex"><span /> 32 FICTIONAL MATCHES · 8 PLAYERS</span>
          <h1 className="font-display text-4xl font-semibold leading-[1.04] tracking-[-0.035em] text-white sm:text-6xl lg:text-7xl">
            See the whole round,<br /><span className="text-gradient">not just the killfeed.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-400 sm:text-lg">
            Transparent, role-aware community performance metrics for one fictional friend squad. Every score can be traced back to the demo match data and published formulas.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className="button-primary" to="/leaderboard">Explore leaderboard</Link>
            <Link className="button-secondary" to="/scoring">How scoring works</Link>
          </div>
        </div>
        <article className="hero-leader surface-card">
          <div className="relative z-10 flex items-start justify-between gap-4">
            <div>
              <p className="metric-label">Current overall leader</p>
              <h2 className="mt-3 text-3xl font-semibold text-white">{leader.player.handle}</h2>
              <p className="mt-1 text-sm text-slate-400">{leader.player.role} · {leader.player.tagline}</p>
            </div>
            <ScoreBadge value={leader.scores.overall} label="Overall" />
          </div>
          <div className="relative z-10 mt-9 grid grid-cols-3 gap-3 border-t border-white/10 pt-5">
            <div><p className="metric-label">K/D</p><p className="stat-value">{leader.stats.kd.toFixed(2)}</p></div>
            <div><p className="metric-label">KAST</p><p className="stat-value">{formatPercent(leader.stats.kast)}</p></div>
            <div><p className="metric-label">Team win</p><p className="stat-value">{formatPercent(teamWinRate)}</p></div>
          </div>
        </article>
      </section>

      <section>
        <SectionHeading eyebrow="Dimension leaders" title="Different jobs, different paths to impact" description="Role-aware ranges keep support, control, entry and anchor contributions comparable without pretending they are identical." />
        <CategoryLeaders analytics={playerAnalytics} />
      </section>

      <section>
        <SectionHeading
          eyebrow="Overall ranking"
          title="Squad snapshot"
          description="Overall blends five initial categories. Confidence is displayed separately and never boosts the performance score."
          action={<Link className="text-link" to="/leaderboard">Full leaderboard →</Link>}
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {playerAnalytics.map((analytics, index) => <PlayerCard key={analytics.player.id} analytics={analytics} rank={index + 1} />)}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
        <article className="surface-card p-5 sm:p-7">
          <SectionHeading
            eyebrow="Profile lens"
            title="Category shape"
            description="Select a player to see how five distinct performance dimensions combine."
            action={
              <label className="select-label">
                <span className="sr-only">Select player</span>
                <select value={selectedPlayerId} onChange={(event) => setSelectedPlayerId(event.target.value)}>
                  {playerAnalytics.map(({ player }) => <option key={player.id} value={player.id}>{player.handle}</option>)}
                </select>
              </label>
            }
          />
          <div className="grid items-center gap-3 md:grid-cols-[1fr_220px]">
            <Suspense fallback={<div className="grid h-[320px] place-items-center text-sm text-slate-500">Loading chart…</div>}>
              <ScoreRadar analytics={selected} />
            </Suspense>
            <div className="space-y-4">
              <div>
                <p className="metric-label">Readout</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">{selected.player.tagline}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">{selected.player.playstyle}</p>
              </div>
              <div className="rounded-xl border border-emerald-300/10 bg-emerald-300/[0.04] p-4">
                <p className="metric-label">Sample confidence</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-300">{selected.scores.confidence.toFixed(0)}%</p>
                <p className="mt-1 text-xs text-slate-500">Based on {selected.stats.matches} matches; separate from performance.</p>
              </div>
              <Link className="text-link" to={'/players/' + selected.player.id}>Open full profile →</Link>
            </div>
          </div>
        </article>

        <article className="surface-card p-5 sm:p-7">
          <SectionHeading eyebrow="Recent form" title={selected.player.handle + ' · last six'} description="Latest fictional match lines; no live or official game data." />
          <RecentPerformance analytics={selected} />
        </article>
      </section>

      <section className="surface-card callout-grid p-6 sm:p-8">
        <div>
          <p className="metric-label">Why it matters</p>
          <h2 className="mt-3 max-w-xl text-2xl font-semibold text-white sm:text-3xl">K/D is evidence. It is not the whole verdict.</h2>
        </div>
        <p className="max-w-2xl text-sm leading-7 text-slate-400">
          NovaHex leads raw firepower, Quartz converts the hardest late rounds, EchoVale raises teamplay through assists and KAST, and AnchorMint earns consistency through low variance. The initial model keeps those stories visible instead of collapsing them into one fragging stat.
        </p>
      </section>
    </div>
  );
}
