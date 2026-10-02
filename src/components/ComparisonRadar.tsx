import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { PlayerAnalytics } from '../types/valorant';
import { zhTW } from '../i18n/zhTW';
import { GapRadarShape } from './GapRadarShape';
import { formatScore } from '../utils/format';

import { dimensions } from '../scoring/versions';

export function ComparisonRadar({ analytics }: { analytics: PlayerAnalytics[] }) {
  const data = dimensions.map((dimension) => ({ dimension: zhTW.scores[dimension], ...Object.fromEntries(analytics.map((item) => [item.player.id, item.scores[dimension].value ?? null])) }));
  const summary = analytics.map((item) => `${item.player.handle}：${dimensions.map((key) => `${zhTW.scores[key]} ${formatScore(item.scores[key])}`).join('、')}`).join('；');
  return <div className="radar-panel radar-panel--comparison" role="img" aria-label={`玩家比較雷達圖。${summary}`}>
    <div className="radar-canvas"><ResponsiveContainer width="100%" height="100%"><RadarChart data={data} outerRadius="65%"><PolarRadiusAxis domain={[0,100]} tick={false} axisLine={false} /><PolarGrid stroke="rgba(148,163,184,.16)" /><PolarAngleAxis dataKey="dimension" tick={{ fill: '#94a3b8', fontSize: 11 }} />
      {analytics.map((item) => <Radar shape={<GapRadarShape />} key={item.player.id} name={item.player.handle} dataKey={item.player.id} stroke={item.player.accent} fill={item.player.accent} fillOpacity={0} connectNulls={false} strokeDasharray={dimensions.some((key) => item.scores[key].status !== "available") ? "4 4" : undefined} strokeWidth={2} isAnimationActive={false} />)}
      <Tooltip formatter={(value) => formatScore(Number(value))} contentStyle={{ background: '#0d1422', border: '1px solid rgba(148,163,184,.18)', borderRadius: 12 }} />
    </RadarChart></ResponsiveContainer></div>
    <ul className="radar-legend" aria-label="比較玩家圖例">{analytics.map((item) => <li key={item.player.id} title={item.player.handle}><span aria-hidden="true" style={{background:item.player.accent}} />{item.player.handle}</li>)}</ul>
    <p className="text-xs text-slate-400">虛線為部分證據；缺值留空，不補零。</p>
  </div>;
}
