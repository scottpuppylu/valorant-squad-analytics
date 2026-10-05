import { MemberNickname } from './MemberNickname';
import { Link } from 'react-router-dom';
import type { PlayerAnalytics } from '../types/valorant';
import { zhTW } from '../i18n/zhTW';
import { formatPercent, formatRatio, formatScore } from '../utils/format';
import { MetricInfo } from './MetricInfo';
import { PlayerAvatar } from './PlayerAvatar';
import { ScoreBadge } from './ScoreBadge';

interface PlayerCardProps {
  analytics: PlayerAnalytics;
  rank: number;
}

export function PlayerCard({ analytics, rank }: PlayerCardProps) {
  const { player, stats, scores } = analytics;
  return (
    <Link
      to={'/players/' + player.id}
      className="surface-card group block overflow-hidden p-5 transition hover:-translate-y-1 hover:border-emerald-300/30"
      aria-label={'查看 ' + player.handle + ' 玩家分析'}
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rank-number">{scores.overall.value === undefined ? '—' : String(rank).padStart(2, '0')}</span>
          <PlayerAvatar player={player} />
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-white">{player.handle}</h3>
            <MemberNickname player={player} className="block truncate text-xs text-slate-400" />
            <p className="truncate text-xs text-slate-400">{zhTW.roles[player.role]} · {player.tagline}</p>
          </div>
        </div>
        <ScoreBadge value={scores.overall} compact />
      </div>
      <div className="grid grid-cols-3 gap-2 border-t border-white/5 pt-4 text-center">
        <div>
          <p className="metric-label"><MetricInfo metricId="kd" linked={false} /></p>
          <p className="mt-1 font-mono text-sm text-slate-100">{formatRatio(stats.kd)}</p>
        </div>
        <div>
          <p className="metric-label"><MetricInfo metricId="kast" linked={false} /></p>
          <p className="mt-1 font-mono text-sm text-slate-100">{(stats.kast === undefined ? '—' : formatPercent(stats.kast))}</p>
        </div>
        <div>
          <p className="metric-label"><MetricInfo metricId="confidence" label={zhTW.scores.confidence} linked={false} /></p>
          <p className="mt-1 font-mono text-sm text-slate-100">{formatScore(scores.confidence)}%</p>
        </div>
      </div>
    </Link>
  );
}
