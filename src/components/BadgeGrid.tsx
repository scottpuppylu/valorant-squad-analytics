import type { BadgeAward } from '../analytics/types';
import type { Player } from '../types/valorant';

export function BadgeGrid({ badges, players }: { badges: BadgeAward[]; players: Player[] }) {
  const playerById = new Map(players.map((player) => [player.id, player]));
  return <div className="badge-grid">{badges.map((badge) => <article className="surface-card badge-card" key={badge.id}>
    <span className="badge-card__emoji" aria-hidden="true">{badge.emoji}</span><div><h3>{badge.label}</h3><p>{badge.playerIds.map((id) => playerById.get(id)?.handle ?? id).join('、')}</p><small>{badge.metricBasis} · 至少 {badge.minMatches} 場{badge.minRounds ? `／${badge.minRounds} 回合` : ''} · {badge.tieRule}</small></div>
  </article>)}</div>;
}
