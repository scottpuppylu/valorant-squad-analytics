import type { PlayerAnalytics } from '../types/valorant';
import { dimensions } from '../scoring/versions';
import { zhTW } from '../i18n/zhTW';
import { formatAcs, formatAdr, formatPercent, formatRatio, formatScore } from '../utils/format';
import { StatusBadge } from './StatusBadge';

export function CompareTables({ analytics }: { analytics: PlayerAnalytics[] }) {
  const scores = ['overall', ...dimensions] as const;
  const raw: Array<[string, (item: PlayerAnalytics) => string | number]> = [
    ['場次', (p) => p.stats.matches], ['回合', (p) => p.stats.rounds],
    ['KPR', (p) => formatRatio(p.stats.kpr)], ['APR', (p) => formatRatio(p.stats.apr)],
    ['HS%', (p) => p.stats.headshotPercentage === undefined ? '—' : formatPercent(p.stats.headshotPercentage)],
    ['FK', (p) => p.stats.firstKills ?? '—'], ['FD', (p) => p.stats.firstDeaths ?? '—'],
    ['FK/FD', (p) => formatRatio(p.stats.fkFd)],
  ];
  const header = <thead><tr><th scope="col">指標</th>{analytics.map((p) => <th scope="col" key={p.player.id}>{p.player.handle}<small className="block text-slate-400">{p.stats.matches} 場／{p.stats.rounds} 回合</small></th>)}</tr></thead>;
  return <section className="space-y-4"><h2 className="text-xl text-white">八維表現與主要數據</h2>
    <div className="surface-card table-scroll" role="region" tabIndex={0} aria-label="玩家比較，可水平捲動"><table className="comparison-table comparison-focus-table">{header}<tbody>
      {scores.map((key) => <tr key={key}><th scope="row">{zhTW.scores[key]}</th>{analytics.map((p) => <td key={p.player.id}><strong>{p.scores[key].value === undefined ? '資料不足' : formatScore(p.scores[key].value)}</strong><div><StatusBadge status={p.scores[key].status} coverage={p.scores[key].coverage.ratio} /></div></td>)}</tr>)}
      <tr><th scope="row">樣本信心</th>{analytics.map((p) => <td key={p.player.id}>{formatPercent(p.scores.confidence / 100)}</td>)}</tr>
      {(['ACS','ADR','K/D','KAST'] as const).map((metric) => <tr key={metric}><th scope="row">{metric}</th>{analytics.map((p) => <td key={p.player.id}>{metric === 'ACS' ? formatAcs(p.stats.acs) : metric === 'ADR' ? formatAdr(p.stats.adr) : metric === 'K/D' ? formatRatio(p.stats.kd) : (p.stats.kast === undefined ? '—' : formatPercent(p.stats.kast))}</td>)}</tr>)}
    </tbody></table></div>
    <details className="surface-card pair-matrix"><summary>查看完整原始數據與樣本</summary><div className="table-scroll" tabIndex={0} role="region" aria-label="比較原始數據，可水平捲動"><table className="comparison-table comparison-focus-table">{header}<tbody>{raw.map(([label,value]) => <tr key={label}><th scope="row">{label}</th>{analytics.map((p) => <td key={p.player.id}>{value(p)}</td>)}</tr>)}</tbody></table></div></details>
  </section>;
}
