import { dimensions } from '../scoring/versions';
import type { RankedPlayer } from '../analytics/types';
import { zhTW } from '../i18n/zhTW';
import { formatAcs, formatAdr, formatPercent, formatRatio, formatScore } from '../utils/format';
import { PlayerAvatar } from './PlayerAvatar';

export function ScoreProfileTable({ rows }: { rows: RankedPlayer[] }) {
  if (!rows.length) return null;
  return <div className="surface-card overflow-hidden"><div className="table-scroll" tabIndex={0} role="region" aria-label="八維分數表，可水平捲動"><table className="comparison-table score-profile-table"><thead><tr><th scope="col">玩家</th><th scope="col">{zhTW.scores.overall}</th>{dimensions.map((key) => <th scope="col" key={key}>{zhTW.scores[key]}</th>)}<th scope="col">ACS</th><th scope="col">ADR</th><th scope="col">K/D</th><th scope="col">KAST</th><th scope="col">場次</th><th scope="col">回合</th></tr></thead><tbody>{rows.map(({ analytics }) => <tr key={analytics.player.id}><td><span className="flex items-center gap-2"><PlayerAvatar player={analytics.player} /><strong>{analytics.player.handle}</strong></span></td><td>{formatScore(analytics.scores.overall)}</td>{dimensions.map((key) => <td key={key}>{formatScore(analytics.scores[key])}</td>)}<td>{formatAcs(analytics.stats.acs)}</td><td>{formatAdr(analytics.stats.adr)}</td><td>{formatRatio(analytics.stats.kd)}</td><td>{(analytics.stats.kast === undefined ? '—' : formatPercent(analytics.stats.kast))}</td><td>{analytics.stats.matches}</td><td>{analytics.stats.rounds}</td></tr>)}</tbody></table></div></div>;
}
