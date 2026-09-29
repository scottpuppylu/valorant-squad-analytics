import type { PlayerAnalytics, ScoreCategory } from '../types/valorant';
import { zhTW } from '../i18n/zhTW';
import { MetricInfo } from './MetricInfo';
import { PlayerAvatar } from './PlayerAvatar';
import { formatScore } from '../utils/format';

const categories: Array<{ key: Exclude<ScoreCategory, 'overall'>; metricId: string; label: string; hint: string }> = [
  { key: 'firepower', metricId: 'firepower', label: zhTW.scores.firepower, hint: 'ACS、ADR、KPR 與 K/D' },
  { key: 'entry', metricId: 'entry', label: zhTW.scores.entry, hint: '角色調整後的開局影響' },
  { key: 'teamplay', metricId: 'teamplay', label: zhTW.scores.teamplay, hint: 'KAST、助攻與共同勝率' },
  { key: 'clutch', metricId: 'clutch-score', label: zhTW.scores.clutch, hint: '轉換率與殘局勝場' },
  { key: 'consistency', metricId: 'consistency', label: zhTW.scores.consistency, hint: '場與場之間的穩定性' },
];

interface CategoryLeadersProps {
  analytics: PlayerAnalytics[];
}

export function CategoryLeaders({ analytics }: CategoryLeadersProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {categories.map(({ key, metricId, label, hint }) => {
        const leader = [...analytics].sort((a, b) => b.scores[key] - a.scores[key])[0]!;
        return (
          <article className="surface-card p-4" key={key}>
            <p className="metric-label"><MetricInfo metricId={metricId} label={label} /></p>
            <div className="mt-4 flex items-end justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <PlayerAvatar player={leader.player} />
                <div>
                  <p className="text-base font-semibold text-white">{leader.player.handle}</p>
                  <p className="mt-1 text-xs text-slate-500">{hint}</p>
                </div>
              </div>
              <strong className="font-mono text-2xl text-emerald-300">{formatScore(leader.scores[key])}</strong>
            </div>
          </article>
        );
      })}
    </div>
  );
}
