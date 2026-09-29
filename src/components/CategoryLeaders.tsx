import type { PlayerAnalytics, ScoreCategory } from '../types/valorant';

const categories: Array<{ key: Exclude<ScoreCategory, 'overall'>; label: string; hint: string }> = [
  { key: 'firepower', label: 'Firepower', hint: 'ACS, ADR, KPR and K/D' },
  { key: 'entry', label: 'Entry', hint: 'Opening impact, role-aware' },
  { key: 'teamplay', label: 'Teamplay', hint: 'KAST, assists and wins' },
  { key: 'clutch', label: 'Clutch', hint: 'Conversion, not volume alone' },
  { key: 'consistency', label: 'Consistency', hint: 'Match-to-match stability' },
];

interface CategoryLeadersProps {
  analytics: PlayerAnalytics[];
}

export function CategoryLeaders({ analytics }: CategoryLeadersProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {categories.map(({ key, label, hint }) => {
        const leader = [...analytics].sort((a, b) => b.scores[key] - a.scores[key])[0]!;
        return (
          <article className="surface-card p-4" key={key}>
            <p className="metric-label">{label}</p>
            <div className="mt-4 flex items-end justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-white">{leader.player.handle}</p>
                <p className="mt-1 text-xs text-slate-500">{hint}</p>
              </div>
              <strong className="font-mono text-2xl text-emerald-300">{leader.scores[key].toFixed(1)}</strong>
            </div>
          </article>
        );
      })}
    </div>
  );
}
