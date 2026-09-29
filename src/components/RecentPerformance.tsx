import type { PlayerAnalytics } from '../types/valorant';
import { formatAcs, formatDate } from '../utils/format';

interface RecentPerformanceProps {
  analytics: PlayerAnalytics;
}

export function RecentPerformance({ analytics }: RecentPerformanceProps) {
  return (
    <div className="space-y-2">
      {analytics.recent.map((item) => (
        <article className="match-row" key={item.matchId}>
          <div className="flex items-center gap-3">
            <span className={item.won ? 'result-pill result-pill--win' : 'result-pill result-pill--loss'}>
              {item.won ? '勝' : '敗'}
            </span>
            <div>
              <p className="text-sm font-medium text-slate-100">{item.map} · {item.agent}</p>
              <p className="text-xs text-slate-500">{formatDate(item.playedAt)} 對 {item.opponent}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 text-right font-mono text-xs sm:text-sm">
            <div><span className="block text-slate-500">K-D-A</span>{item.performance.kills}-{item.performance.deaths}-{item.performance.assists}</div>
            <div><span className="block text-slate-500">ACS</span>{formatAcs(item.performance.acs)}</div>
            <div><span className="block text-slate-500">比分</span>{item.scoreFor}-{item.scoreAgainst}</div>
          </div>
        </article>
      ))}
    </div>
  );
}
