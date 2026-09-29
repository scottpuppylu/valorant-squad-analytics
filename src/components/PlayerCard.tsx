import { Link } from 'react-router-dom';
import type { PlayerAnalytics } from '../types/valorant';
import { formatPercent } from '../utils/format';
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
      aria-label={'View ' + player.handle + ' profile'}
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rank-number">{String(rank).padStart(2, '0')}</span>
          <span className="player-avatar" style={{ '--player-accent': player.accent } as React.CSSProperties}>
            {player.handle.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-white">{player.handle}</h3>
            <p className="truncate text-xs text-slate-400">{player.role} · {player.tagline}</p>
          </div>
        </div>
        <ScoreBadge value={scores.overall} compact />
      </div>
      <div className="grid grid-cols-3 gap-2 border-t border-white/5 pt-4 text-center">
        <div>
          <p className="metric-label">K/D</p>
          <p className="mt-1 font-mono text-sm text-slate-100">{stats.kd.toFixed(2)}</p>
        </div>
        <div>
          <p className="metric-label">KAST</p>
          <p className="mt-1 font-mono text-sm text-slate-100">{formatPercent(stats.kast)}</p>
        </div>
        <div>
          <p className="metric-label">Confidence</p>
          <p className="mt-1 font-mono text-sm text-slate-100">{scores.confidence.toFixed(0)}%</p>
        </div>
      </div>
    </Link>
  );
}
