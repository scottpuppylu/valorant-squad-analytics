import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { CategoryLeaders } from '../components/CategoryLeaders';
import { MetricInfo } from '../components/MetricInfo';
import { PlayerCard } from '../components/PlayerCard';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { RecentPerformance } from '../components/RecentPerformance';
import { ScoreBadge } from '../components/ScoreBadge';
import { SectionHeading } from '../components/SectionHeading';
import { activeDataset, playerAnalytics } from '../data/analytics';
import { zhTW } from '../i18n/zhTW';
import { formatPercent } from '../utils/format';

const ScoreRadar = lazy(() => import('../components/ScoreRadar').then((module) => ({ default: module.ScoreRadar })));

export function DashboardPage() {
  const [selectedPlayerId, setSelectedPlayerId] = useState(playerAnalytics[0]!.player.id);
  const selected = playerAnalytics.find(({ player }) => player.id === selectedPlayerId) ?? playerAnalytics[0]!;
  const leader = playerAnalytics[0]!;
  const teamWinRate = activeDataset.matches.filter((match) => match.won).length / activeDataset.matches.length;

  return (
    <div className="space-y-14">
      <section className="hero-grid">
        <div className="max-w-3xl">
          <span className="data-pill mb-5 inline-flex"><span /> {activeDataset.matches.length} 場{activeDataset.mode === 'REAL' ? '真實' : '虛構'}對戰 · {activeDataset.players.length} 位玩家</span>
          <h1 className="font-display text-4xl font-semibold leading-[1.04] tracking-[-0.035em] text-white sm:text-6xl lg:text-7xl">
            看見完整回合，<br /><span className="text-gradient">不只看擊殺資訊。</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-slate-400 sm:text-lg">
            {activeDataset.mode === 'REAL' ? '目前顯示這個瀏覽器已匯入的真實戰績；Demo 資料不會混入排名。' : '為虛構朋友小隊打造的透明、角色感知社群表現指標。每個分數都能回溯到示範對戰資料與公開公式。'}
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
              <p className="metric-label">目前綜合領先</p>
              <h2 className="mt-3 text-3xl font-semibold text-white">{leader.player.handle}</h2>
              <p className="mt-1 text-sm text-slate-400">{zhTW.roles[leader.player.role]} · {leader.player.tagline}</p>
              </div>
            </div>
            <ScoreBadge value={leader.scores.overall} label={zhTW.scores.overall} />
          </div>
          <div className="relative z-10 mt-9 grid grid-cols-3 gap-3 border-t border-white/10 pt-5">
            <div><p className="metric-label"><MetricInfo metricId="kd" /></p><p className="stat-value">{leader.stats.kd.toFixed(2)}</p></div>
            <div><p className="metric-label"><MetricInfo metricId="kast" /></p><p className="stat-value">{formatPercent(leader.stats.kast)}</p></div>
            <div><p className="metric-label"><MetricInfo metricId="win-rate" label="小隊勝率" /></p><p className="stat-value">{formatPercent(teamWinRate)}</p></div>
          </div>
        </article>
      </section>

      <section>
        <SectionHeading eyebrow="分類領先者" title="不同職責，也有不同影響方式" description="角色感知區間讓支援、控場、突破與守點貢獻可比較，同時不假裝它們完全相同。" />
        <CategoryLeaders analytics={playerAnalytics} />
      </section>

      <section>
        <SectionHeading
          eyebrow="綜合排名"
          title="小隊快照"
          description="綜合表現混合五個初始類別；樣本信心獨立呈現，永遠不會提高表現分數。"
          action={<Link className="text-link" to="/leaderboard">完整排名 →</Link>}
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {playerAnalytics.map((analytics, index) => <PlayerCard key={analytics.player.id} analytics={analytics} rank={index + 1} />)}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
        <article className="surface-card p-5 sm:p-7">
          <SectionHeading
            eyebrow="玩家視角"
            title="表現輪廓"
            description="選擇玩家，查看五個不同表現面向如何組合。"
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
                <p className="mt-2 text-2xl font-semibold text-emerald-300">{selected.scores.confidence.toFixed(0)}%</p>
                <p className="mt-1 text-xs text-slate-500">依 {selected.stats.matches} 場樣本計算；與表現分數分開。</p>
              </div>
              <Link className="text-link" to={'/players/' + selected.player.id}>開啟完整分析 →</Link>
            </div>
          </div>
        </article>

        <article className="surface-card p-5 sm:p-7">
          <SectionHeading eyebrow="近期表現" title={selected.player.handle + ' · 最近六場'} description={activeDataset.mode === 'REAL' ? '目前瀏覽器最近匯入的正規化戰績；不是即時資料。' : '最新虛構對戰資料；不含即時或官方玩家資料。'} />
          <RecentPerformance analytics={selected} />
        </article>
      </section>

      {activeDataset.mode === 'DEMO' ? <section className="surface-card callout-grid p-6 sm:p-8">
        <div>
          <p className="metric-label">為什麼重要</p>
          <h2 className="mt-3 max-w-xl text-2xl font-semibold text-white sm:text-3xl">K/D 是證據，不是全部結論。</h2>
        </div>
        <p className="max-w-2xl text-sm leading-7 text-slate-400">
          NovaHex 帶領原始火力，Quartz 擅長完成艱難殘局，EchoVale 以助攻與 KAST 提升團隊貢獻，AnchorMint 則靠低波動建立穩定度。初始模型保留這些不同故事，而不是只剩單一擊殺數字。
        </p>
      </section> : null}
    </div>
  );
}
