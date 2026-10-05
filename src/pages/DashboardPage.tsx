import { lazy, Suspense, useMemo, useState } from 'react';
import { defaultAnalysisFilters } from '../analytics/filters';
import { aggregateSelection } from '../analytics/rankings';
import { compareScoreResults } from '../scoring/calculateScores';
import { AnalysisStatusNotice } from '../components/AnalysisStatusNotice';
import { useScopedAnalysis } from '../hooks/useScopedAnalysis';
import { Link } from 'react-router-dom';
import { CategoryLeaders } from '../components/CategoryLeaders';
import { MetricInfo } from '../components/MetricInfo';
import { PlayerCard } from '../components/PlayerCard';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { RecentPerformance } from '../components/RecentPerformance';
import { ScoreBadge } from '../components/ScoreBadge';
import { SectionHeading } from '../components/SectionHeading';
import { useDataset } from '../hooks/useDataset';
import { EmptyState } from '../components/EmptyState';
import { ScopeExplanation } from '../components/ScopeExplanation';
import { zhTW } from '../i18n/zhTW';
import { formatPercent, formatRatio, formatScore } from '../utils/format';
import { MemberNickname } from '../components/MemberNickname';

const ScoreRadar = lazy(() => import('../components/ScoreRadar').then((module) => ({ default: module.ScoreRadar })));

export function DashboardPage() {
  const { analytics: { activeDataset } } = useDataset();
  // Community ranking population = feature currentStrength, resolved by the server over all durable
  // history (DATA-03B.2B) or locally for Demo; adaptive-window-v1, Competitive only.
  const currentFilters = useMemo(() => ({ ...defaultAnalysisFilters, period: 'current' as const }), []);
  // form: true shares the prefetched default request with the Leaderboard.
  const analysis = useScopedAnalysis(currentFilters, { form: true });
  const currentStrength = useMemo(() => ({ selection: analysis.selection, analytics: aggregateSelection(analysis.selection)
    .sort((a, b) => compareScoreResults(a.scores.overall, b.scores.overall) || a.player.handle.localeCompare(b.player.handle)) }), [analysis.selection]);
  const playerAnalytics = currentStrength.analytics;
  const [selectedPlayerId, setSelectedPlayerId] = useState(playerAnalytics[0]?.player.id ?? '');
  const selected = playerAnalytics.find(({ player }) => player.id === selectedPlayerId) ?? playerAnalytics[0];
  const leader = playerAnalytics[0];
  const teamWinRate = activeDataset.matches.filter((match) => match.won).length / activeDataset.matches.length;
  const withoutWindow = [...(currentStrength.selection.scope?.players.values() ?? [])].filter((item) => item.status === 'unavailable')
    .map((item) => activeDataset.players.find((player) => player.id === item.playerId)?.handle).filter(Boolean);

  if (analysis.status === 'loading' || analysis.status === 'error') {
    return <div className="space-y-6"><AnalysisStatusNotice analysis={analysis} /></div>;
  }
  if (!leader || !selected) {
    return <div className="space-y-6">
      <EmptyState page title="目前實力資料不足" description="沒有玩家達到「目前實力」的最低樣本（近期 5 場競技、100 回合、2 個活躍日）。不會改用其他範圍補值；可在戰力排名切換「全部已追蹤」。" actions={<Link className="button-primary" to="/leaderboard?period=all">查看全部已追蹤</Link>} />
      <ScopeExplanation scope={currentStrength.selection.scope} players={activeDataset.players} />
    </div>;
  }

  return (
    <div className="space-y-14">
      <section className="hero-grid">
        <div className="max-w-3xl">
          <span className="data-pill mb-5 inline-flex"><span /> {activeDataset.matches.length} 場{activeDataset.mode === 'REAL' ? '真實' : '虛構'}對戰 · {activeDataset.players.length} 位玩家</span>
          <h1 className="font-display text-4xl font-semibold leading-[1.04] tracking-[-0.035em] text-white sm:text-4xl lg:text-5xl">
            小隊表現總覽
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
            {activeDataset.mode === 'REAL' ? '觀察目前可用的真實對戰與八維表現。' : '用固定虛構對戰探索八維表現，分數與公式皆可查閱。'}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link className="button-primary" to="/leaderboard">查看戰力排名</Link>
            <Link className="button-secondary" to="/dictionary">了解評分方式</Link>
            <Link className="button-secondary" to="/connect">{activeDataset.mode === 'REAL' ? '管理連接' : '加入調查'}</Link>
          </div>
        </div>
        <article className="hero-leader surface-card">
          <div className="relative z-10 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <PlayerAvatar player={leader.player} />
              <div>
              <p className="metric-label">{leader.scores.overall.value === undefined ? '綜合資料不足' : '目前綜合領先'}</p>
              <h2 className="mt-3 text-3xl font-semibold text-white">{leader.player.handle}</h2>
              <MemberNickname player={leader.player} className="block text-sm text-slate-400" />
              <p className="mt-1 text-sm text-slate-400">{zhTW.roles[leader.player.role]} · {leader.player.tagline}</p>
              </div>
            </div>
            <ScoreBadge value={leader.scores.overall} label={zhTW.scores.overall} />
          </div>
          <div className="relative z-10 mt-5 grid grid-cols-3 gap-3 border-t border-white/10 pt-5">
            <div><p className="metric-label"><MetricInfo metricId="kd" /></p><p className="stat-value">{formatRatio(leader.stats.kd)}</p></div>
            <div><p className="metric-label"><MetricInfo metricId="kast" /></p><p className="stat-value">{(leader.stats.kast === undefined ? '—' : formatPercent(leader.stats.kast))}</p></div>
            <div><p className="metric-label"><MetricInfo metricId="win-rate" label="小隊勝率" /></p><p className="stat-value">{formatPercent(teamWinRate)}</p></div>
          </div>
        </article>
      </section>

      <section>
        <SectionHeading
          eyebrow="綜合排名"
          title="小隊快照"
          description="依「目前實力」範圍（近期競技、自適應觀察區間）排序；樣本信心獨立呈現，永遠不會提高表現分數。"
          action={<Link className="text-link" to="/leaderboard">完整排名 →</Link>}
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {playerAnalytics.map((analytics, index) => <PlayerCard key={analytics.player.id} analytics={analytics} rank={index + 1} />)}
        </div>
        {withoutWindow.length ? <p className="sample-warning mt-4">目前實力樣本不足而另列：{withoutWindow.join('、')}</p> : null}
        <div className="mt-4"><ScopeExplanation scope={currentStrength.selection.scope} players={activeDataset.players} source={analysis.source} trackedMatchCount={analysis.trackedMatchCount} /></div>
      </section>

      <section><SectionHeading title="各維度領先" /><CategoryLeaders analytics={playerAnalytics} /></section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
        <article className="surface-card p-5 sm:p-7">
          <SectionHeading
            eyebrow="玩家視角"
            title="表現輪廓"
            description="選擇玩家，查看八個不同表現面向如何組合。"
            action={
              <label className="select-label">
                <span className="sr-only">選擇玩家</span>
                <select value={selectedPlayerId} onChange={(event) => setSelectedPlayerId(event.target.value)}>
                  {playerAnalytics.map(({ player }) => <option key={player.id} value={player.id}>{player.handle}</option>)}
                </select>
              </label>
            }
          />
          <div className="grid items-center gap-3 md:grid-cols-[1fr_220px]">
            <Suspense fallback={<div className="grid h-[320px] place-items-center text-sm text-slate-500">{zhTW.common.loadingChart}</div>}>
              <ScoreRadar analytics={selected} />
            </Suspense>
            <div className="space-y-4">
              <div>
                <p className="metric-label">特點摘要</p>
                <div className="mt-2 flex items-center gap-3">
                  <PlayerAvatar player={selected.player} />
                  <h3 className="text-2xl font-semibold text-white">{selected.player.tagline}</h3>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-400">{selected.player.playstyle}</p>
              </div>
              <div className="rounded-xl border border-emerald-300/10 bg-emerald-300/[0.04] p-4">
                <p className="metric-label">樣本信心</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-300">{formatScore(selected.scores.confidence)}%</p>
                <p className="mt-1 text-xs text-slate-500">依 {selected.stats.matches} 場樣本計算；與表現分數分開。</p>
              </div>
              <Link className="text-link" to={'/players/' + selected.player.id}>開啟完整分析 →</Link>
            </div>
          </div>
        </article>

        <article className="surface-card p-5 sm:p-7">
          <SectionHeading eyebrow="近期表現" title={selected.player.handle + ' · 最近六場'} description={activeDataset.mode === 'REAL' ? '目前持久化資料集最近可用的有界戰績；不是即時或完整生涯資料。' : '最新虛構對戰資料；不含即時或官方玩家資料。'} />
          <RecentPerformance analytics={selected} />
        </article>
      </section>


    </div>
  );
}
