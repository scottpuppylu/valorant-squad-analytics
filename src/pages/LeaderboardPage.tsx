import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SectionHeading } from '../components/SectionHeading';
import { MetricInfo } from '../components/MetricInfo';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { playerAnalytics } from '../data/analytics';
import { zhTW } from '../i18n/zhTW';
import type { PlayerAnalytics } from '../types/valorant';
import { formatPercent } from '../utils/format';

type SortKey = 'overall' | 'firepower' | 'entry' | 'teamplay' | 'clutch' | 'consistency' | 'acs' | 'adr' | 'kd' | 'kast';

const sortOptions: Array<{ key: SortKey; label: string }> = [
  { key: 'overall', label: zhTW.scores.overall },
  { key: 'firepower', label: zhTW.scores.firepower },
  { key: 'entry', label: zhTW.scores.entry },
  { key: 'teamplay', label: zhTW.scores.teamplay },
  { key: 'clutch', label: zhTW.scores.clutch },
  { key: 'consistency', label: zhTW.scores.consistency },
  { key: 'acs', label: 'ACS' },
  { key: 'adr', label: 'ADR' },
  { key: 'kd', label: 'K/D' },
  { key: 'kast', label: 'KAST' },
];

function sortValue(analytics: PlayerAnalytics, key: SortKey): number {
  if (key in analytics.scores) {
    return analytics.scores[key as keyof typeof analytics.scores];
  }
  return analytics.stats[key as keyof Pick<typeof analytics.stats, 'acs' | 'adr' | 'kd' | 'kast'>];
}

export function LeaderboardPage() {
  const [sortKey, setSortKey] = useState<SortKey>('overall');
  const ranked = [...playerAnalytics].sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey));

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="metric-label">小隊數據表</p>
          <h1>戰力排名</h1>
          <p>並排查看與排序原始統計及透明分類分數。</p>
        </div>
        <label className="select-label">
          <span>排序依據</span>
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
            {sortOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
        </label>
      </div>

      <section className="mt-9">
        <SectionHeading title={'依「' + sortOptions.find((option) => option.key === sortKey)!.label + '」排序'} description="分類分數使用角色感知區間；原始欄位保持未調整，方便直接檢視。" />
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>名次</th><th>玩家</th><th><MetricInfo metricId="overall" label={zhTW.scores.overall} /></th><th><MetricInfo metricId="firepower" label={zhTW.scores.firepower} /></th><th><MetricInfo metricId="entry" label={zhTW.scores.entry} /></th><th><MetricInfo metricId="teamplay" label={zhTW.scores.teamplay} /></th><th><MetricInfo metricId="clutch-score" label={zhTW.scores.clutch} /></th><th><MetricInfo metricId="consistency" label={zhTW.scores.consistency} /></th><th><MetricInfo metricId="acs" /></th><th><MetricInfo metricId="adr" /></th><th><MetricInfo metricId="kd" /></th><th><MetricInfo metricId="kast" /></th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((analytics, index) => {
                  const { player, scores, stats } = analytics;
                  return (
                    <tr key={player.id}>
                      <td><span className="table-rank">{String(index + 1).padStart(2, '0')}</span></td>
                      <td>
                        <Link className="flex min-w-[170px] items-center gap-3" to={'/players/' + player.id}>
                          <PlayerAvatar player={player} />
                          <span><strong className="block text-slate-100">{player.handle}</strong><small>{zhTW.roles[player.role]}</small></span>
                        </Link>
                      </td>
                      <td className={sortKey === 'overall' ? 'is-sorted' : ''}>{scores.overall.toFixed(1)}</td>
                      <td className={sortKey === 'firepower' ? 'is-sorted' : ''}>{scores.firepower.toFixed(1)}</td>
                      <td className={sortKey === 'entry' ? 'is-sorted' : ''}>{scores.entry.toFixed(1)}</td>
                      <td className={sortKey === 'teamplay' ? 'is-sorted' : ''}>{scores.teamplay.toFixed(1)}</td>
                      <td className={sortKey === 'clutch' ? 'is-sorted' : ''}>{scores.clutch.toFixed(1)}</td>
                      <td className={sortKey === 'consistency' ? 'is-sorted' : ''}>{scores.consistency.toFixed(1)}</td>
                      <td className={sortKey === 'acs' ? 'is-sorted' : ''}>{stats.acs.toFixed(1)}</td>
                      <td className={sortKey === 'adr' ? 'is-sorted' : ''}>{stats.adr.toFixed(1)}</td>
                      <td className={sortKey === 'kd' ? 'is-sorted' : ''}>{stats.kd.toFixed(2)}</td>
                      <td className={sortKey === 'kast' ? 'is-sorted' : ''}>{formatPercent(stats.kast)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-white/5 px-5 py-4 text-xs text-slate-500">
            樣本信心不是乘數。目前八位玩家各有 {playerAnalytics[0]!.stats.matches} 場虛構示範對戰。
          </div>
        </div>
      </section>
    </div>
  );
}
