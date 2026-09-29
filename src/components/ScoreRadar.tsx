import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { PlayerAnalytics } from '../types/valorant';
import { zhTW } from '../i18n/zhTW';
import { formatScore } from '../utils/format';

interface ScoreRadarProps {
  analytics: PlayerAnalytics;
}

export function ScoreRadar({ analytics }: ScoreRadarProps) {
  const { player, scores } = analytics;
  const data = [
    { category: zhTW.scores.firepower, score: scores.firepower },
    { category: zhTW.scores.entry, score: scores.entry },
    { category: zhTW.scores.teamplay, score: scores.teamplay },
    { category: zhTW.scores.clutch, score: scores.clutch },
    { category: zhTW.scores.consistency, score: scores.consistency },
  ];

  return (
    <div className="h-[320px] w-full" role="img" aria-label={player.handle + ' 的分類分數雷達圖'}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="70%">
          <PolarGrid stroke="rgba(148, 163, 184, 0.16)" />
          <PolarAngleAxis dataKey="category" tick={{ fill: '#94a3b8', fontSize: 11 }} />
          <Radar
            name={player.handle}
            dataKey="score"
            stroke={player.accent}
            fill={player.accent}
            fillOpacity={0.18}
            strokeWidth={2}
          />
          <Tooltip
            formatter={(value) => [formatScore(Number(value)), '分數']}
            contentStyle={{ background: '#0d1422', border: '1px solid rgba(148,163,184,.18)', borderRadius: 12 }}
            itemStyle={{ color: '#f8fafc' }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
