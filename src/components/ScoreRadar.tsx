import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { PlayerAnalytics } from '../types/valorant';

interface ScoreRadarProps {
  analytics: PlayerAnalytics;
}

export function ScoreRadar({ analytics }: ScoreRadarProps) {
  const { player, scores } = analytics;
  const data = [
    { category: 'Firepower', score: scores.firepower },
    { category: 'Entry', score: scores.entry },
    { category: 'Teamplay', score: scores.teamplay },
    { category: 'Clutch', score: scores.clutch },
    { category: 'Consistency', score: scores.consistency },
  ];

  return (
    <div className="h-[320px] w-full" role="img" aria-label={player.handle + ' category score radar chart'}>
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
            formatter={(value) => [Number(value).toFixed(1), 'Score']}
            contentStyle={{ background: '#0d1422', border: '1px solid rgba(148,163,184,.18)', borderRadius: 12 }}
            itemStyle={{ color: '#f8fafc' }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
