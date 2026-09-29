import type { RankedPlayer } from '../analytics/types';
import { zhTW } from '../i18n/zhTW';
import { formatAcs, formatAdr, formatPercent, formatRatio, formatScore } from '../utils/format';
import { PlayerAvatar } from './PlayerAvatar';

export function ScoreProfileTable({ rows }: { rows: RankedPlayer[] }) {
  if (!rows.length) return null;
  return <div className="surface-card overflow-hidden"><div className="overflow-x-auto"><table className="comparison-table score-profile-table"><thead><tr><th>玩家</th><th>{zhTW.scores.overall}</th><th>{zhTW.scores.firepower}</th><th>{zhTW.scores.entry}</th><th>{zhTW.scores.teamplay}</th><th>{zhTW.scores.clutch}</th><th>{zhTW.scores.consistency}</th><th>ACS</th><th>ADR</th><th>K/D</th><th>KAST</th><th>場次</th><th>回合</th></tr></thead><tbody>{rows.map(({ analytics }) => <tr key={analytics.player.id}><td><span className="flex items-center gap-2"><PlayerAvatar player={analytics.player} /><strong>{analytics.player.handle}</strong></span></td><td>{formatScore(analytics.scores.overall)}</td><td>{formatScore(analytics.scores.firepower)}</td><td>{formatScore(analytics.scores.entry)}</td><td>{formatScore(analytics.scores.teamplay)}</td><td>{formatScore(analytics.scores.clutch)}</td><td>{formatScore(analytics.scores.consistency)}</td><td>{formatAcs(analytics.stats.acs)}</td><td>{formatAdr(analytics.stats.adr)}</td><td>{formatRatio(analytics.stats.kd)}</td><td>{formatPercent(analytics.stats.kast)}</td><td>{analytics.stats.matches}</td><td>{analytics.stats.rounds}</td></tr>)}</tbody></table></div></div>;
}
