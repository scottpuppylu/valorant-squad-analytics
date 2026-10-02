import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import { dimensions } from '../scoring/versions';
import type { PlayerAnalytics } from '../types/valorant';
import { zhTW } from '../i18n/zhTW';
import { GapRadarShape } from './GapRadarShape';
import { formatScore } from '../utils/format';

interface ScoreRadarProps {
  analytics: PlayerAnalytics;
}

export function ScoreRadar({ analytics }: ScoreRadarProps) {
  const { player, scores } = analytics;
  const data = dimensions.map((key) => ({category:zhTW.scores[key],score:scores[key].value ?? null}));
  const partial=dimensions.some((key) => scores[key].status !== 'available');

  return (
    <div className="h-[380px] w-full" role="img" aria-label={player.handle + ' 的八維度雷達圖；缺值留空，虛線為部分證據。'}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="70%">
          <PolarRadiusAxis domain={[0,100]} tick={false} axisLine={false} />
          <PolarGrid stroke="rgba(148, 163, 184, 0.16)" />
          <PolarAngleAxis dataKey="category" tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <Radar shape={<GapRadarShape />}
            name={player.handle}
            dataKey="score"
            stroke={player.accent}
            fill={player.accent}
            fillOpacity={partial ? 0 : 0.18}
            strokeDasharray={partial ? "4 4" : undefined}
            connectNulls={false}
            strokeWidth={2} isAnimationActive={false}
          />
          <Tooltip
            formatter={(value) => [formatScore(Number(value)), '分數']}
            contentStyle={{ background: '#0d1422', border: '1px solid rgba(148,163,184,.18)', borderRadius: 12 }}
            itemStyle={{ color: '#f8fafc' }}
          />
        </RadarChart>
      </ResponsiveContainer>
      {partial ? <p className="text-xs text-slate-400">虛線：部分證據；缺值不補零。{dimensions.map((key) => `${zhTW.scores[key]}：${formatScore(scores[key])}`).join("、")}</p> : null}
    </div>
  );
}
