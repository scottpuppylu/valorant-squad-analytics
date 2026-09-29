import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SectionHeading } from '../components/SectionHeading';
import { playerAnalytics } from '../data/analytics';
import type { PlayerAnalytics } from '../types/valorant';
import { formatPercent } from '../utils/format';

type SortKey = 'overall' | 'firepower' | 'entry' | 'teamplay' | 'clutch' | 'consistency' | 'acs' | 'adr' | 'kd' | 'kast';

const sortOptions: Array<{ key: SortKey; label: string }> = [
  { key: 'overall', label: 'Overall' },
  { key: 'firepower', label: 'Firepower' },
  { key: 'entry', label: 'Entry' },
  { key: 'teamplay', label: 'Teamplay' },
  { key: 'clutch', label: 'Clutch' },
  { key: 'consistency', label: 'Consistency' },
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
          <p className="metric-label">Squad table</p>
          <h1>Leaderboard</h1>
          <p>Sort raw statistics and transparent category scores side by side.</p>
        </div>
        <label className="select-label">
          <span>Sort by</span>
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
            {sortOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
        </label>
      </div>

      <section className="mt-9">
        <SectionHeading title={'Ranked by ' + sortOptions.find((option) => option.key === sortKey)!.label} description="Category scores use role-aware ranges. Raw columns remain unadjusted for direct inspection." />
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>Rank</th><th>Player</th><th>Overall</th><th>Firepower</th><th>Entry</th><th>Teamplay</th><th>Clutch</th><th>Consistency</th><th>ACS</th><th>ADR</th><th>K/D</th><th>KAST</th>
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
                          <span className="player-dot" style={{ backgroundColor: player.accent }} />
                          <span><strong className="block text-slate-100">{player.handle}</strong><small>{player.role}</small></span>
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
            Confidence is not a multiplier. All eight players currently have {playerAnalytics[0]!.stats.matches} recorded demo matches.
          </div>
        </div>
      </section>
    </div>
  );
}
