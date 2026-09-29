import { Legend, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { PlayerAnalytics } from '../types/valorant';
import { zhTW } from '../i18n/zhTW';

const dimensions = ['firepower', 'entry', 'teamplay', 'clutch', 'consistency'] as const;

export function ComparisonRadar({ analytics }: { analytics: PlayerAnalytics[] }) {
  const data = dimensions.map((dimension) => ({ dimension: zhTW.scores[dimension], ...Object.fromEntries(analytics.map((item) => [item.player.id, item.scores[dimension]])) }));
  const summary = analytics.map((item) => `${item.player.handle}：${dimensions.map((key) => `${zhTW.scores[key]} ${item.scores[key].toFixed(1)}`).join('、')}`).join('；');
  return <div className="h-[360px] w-full" role="img" aria-label={`玩家比較雷達圖。${summary}`}>
    <ResponsiveContainer width="100%" height="100%"><RadarChart data={data} outerRadius="65%"><PolarGrid stroke="rgba(148,163,184,.16)" /><PolarAngleAxis dataKey="dimension" tick={{ fill: '#94a3b8', fontSize: 11 }} />
      {analytics.map((item) => <Radar key={item.player.id} name={item.player.handle} dataKey={item.player.id} stroke={item.player.accent} fill={item.player.accent} fillOpacity={0.06} strokeWidth={2} />)}
      <Tooltip formatter={(value) => Number(value).toFixed(1)} contentStyle={{ background: '#0d1422', border: '1px solid rgba(148,163,184,.18)', borderRadius: 12 }} /><Legend />
    </RadarChart></ResponsiveContainer>
  </div>;
}
