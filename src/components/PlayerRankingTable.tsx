import { StatusBadge } from './StatusBadge';
import { EmptyState } from './EmptyState';
import { Link } from 'react-router-dom';
import type { RankedPlayer, RankingMetric } from '../analytics/types';
import { formatRankingValue } from '../analytics/presentation';
import { rankingMetricLabels } from '../analytics/rankings';
import { zhTW } from '../i18n/zhTW';
import { formatAcs, formatAdr, formatPercent, formatRatio, formatScore } from '../utils/format';
import { PlayerAvatar } from './PlayerAvatar';

export function PlayerRankingTable({ rows, metric }: { rows: RankedPlayer[]; metric: RankingMetric }) {
  if (rows.length === 0) return <EmptyState title="無符合條件的資料" description="請調整篩選或樣本門檻，再查看排名。" />;
  return (
    <div className="surface-card overflow-hidden"><div className="table-scroll" tabIndex={0} role="region" aria-label="可水平捲動的玩家排名">
      <table className="leaderboard-table analysis-table">
        <thead><tr><th scope="col">名次</th><th scope="col">玩家</th><th scope="col">{rankingMetricLabels[metric]}</th><th scope="col">樣本信心</th><th scope="col">場次</th><th scope="col">回合</th><th scope="col">ACS</th><th scope="col">ADR</th><th scope="col">K/D</th><th scope="col">KAST</th></tr></thead>
        <tbody>{rows.map(({ analytics, value }, index) => <tr key={analytics.player.id}>
          <td><span className="table-rank">{value === undefined ? '—' : String(index + 1).padStart(2, '0')}</span></td>
          <td><Link className="flex min-w-[170px] items-center gap-3" to={`/players/${analytics.player.id}`}><PlayerAvatar player={analytics.player} /><span><strong className="block text-slate-100">{analytics.player.handle}</strong><small>{zhTW.roles[analytics.player.role]}</small></span></Link></td>
          <td className="is-sorted">{value === undefined ? '資料不足' : metric in analytics.scores ? formatScore(analytics.scores[metric as Exclude<keyof typeof analytics.scores,'confidence'>].value) : formatRankingValue(metric, value)}{metric in analytics.scores ? <div><StatusBadge status={analytics.scores[metric as Exclude<keyof typeof analytics.scores,'confidence'>].status} coverage={analytics.scores[metric as Exclude<keyof typeof analytics.scores,'confidence'>].coverage.ratio} /></div> : null}</td><td>{formatPercent(analytics.scores.confidence / 100)}</td><td>{analytics.stats.matches}</td><td>{analytics.stats.rounds}</td><td>{formatAcs(analytics.stats.acs)}</td><td>{formatAdr(analytics.stats.adr)}</td><td>{formatRatio(analytics.stats.kd)}</td><td>{formatPercent(analytics.stats.kast)}</td>
        </tr>)}</tbody>
      </table>
    </div></div>
  );
}
