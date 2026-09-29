import { Link } from 'react-router-dom';
import type { RankedPlayer, RankingMetric } from '../analytics/types';
import { formatRankingValue } from '../analytics/presentation';
import { rankingMetricLabels } from '../analytics/rankings';
import { zhTW } from '../i18n/zhTW';
import { formatAcs, formatAdr, formatPercent, formatRatio } from '../utils/format';
import { PlayerAvatar } from './PlayerAvatar';

export function PlayerRankingTable({ rows, metric }: { rows: RankedPlayer[]; metric: RankingMetric }) {
  if (rows.length === 0) return <div className="empty-panel surface-card">無符合條件的資料</div>;
  return (
    <div className="surface-card overflow-hidden"><div className="overflow-x-auto">
      <table className="leaderboard-table analysis-table">
        <thead><tr><th>名次</th><th>玩家</th><th>{rankingMetricLabels[metric]}</th><th>場次</th><th>回合</th><th>ACS</th><th>ADR</th><th>K/D</th><th>KAST</th></tr></thead>
        <tbody>{rows.map(({ analytics, value }, index) => <tr key={analytics.player.id}>
          <td><span className="table-rank">{String(index + 1).padStart(2, '0')}</span></td>
          <td><Link className="flex min-w-[170px] items-center gap-3" to={`/players/${analytics.player.id}`}><PlayerAvatar player={analytics.player} /><span><strong className="block text-slate-100">{analytics.player.handle}</strong><small>{zhTW.roles[analytics.player.role]}</small></span></Link></td>
          <td className="is-sorted">{formatRankingValue(metric, value)}</td><td>{analytics.stats.matches}</td><td>{analytics.stats.rounds}</td><td>{formatAcs(analytics.stats.acs)}</td><td>{formatAdr(analytics.stats.adr)}</td><td>{formatRatio(analytics.stats.kd)}</td><td>{formatPercent(analytics.stats.kast)}</td>
        </tr>)}</tbody>
      </table>
    </div></div>
  );
}
