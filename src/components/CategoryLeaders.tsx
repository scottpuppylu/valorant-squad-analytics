import { MemberNickname } from './MemberNickname';
import { dimensions } from '../scoring/versions';
import { scoreMetricIds } from '../i18n/zhTW';
import type { PlayerAnalytics } from '../types/valorant';
import { zhTW } from '../i18n/zhTW';
import { MetricInfo } from './MetricInfo';
import { PlayerAvatar } from './PlayerAvatar';
import { formatScore } from '../utils/format';

const categories = dimensions.map((key) => ({key,metricId:scoreMetricIds[key],label:zhTW.scores[key],hint:'可用證據中的最高分'}));

interface CategoryLeadersProps {
  analytics: PlayerAnalytics[];
}

export function CategoryLeaders({ analytics }: CategoryLeadersProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {categories.map(({ key, metricId, label, hint }) => {
        const leader = analytics.filter((item) => item.scores[key].value !== undefined).sort((a,b) => b.scores[key].value!-a.scores[key].value!)[0];
        if (!leader) return <article className="surface-card p-4" key={key}><p>{label}</p><p className="mt-3 text-slate-400">資料不足</p></article>;
        return (
          <article className="surface-card p-4" key={key}>
            <p className="metric-label"><MetricInfo metricId={metricId} label={label} /></p>
            <div className="mt-4 flex items-end justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <PlayerAvatar player={leader.player} />
                <div>
                  <p className="text-base font-semibold text-white">{leader.player.handle}</p>
                  <MemberNickname player={leader.player} className="block text-xs text-slate-400" />
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
