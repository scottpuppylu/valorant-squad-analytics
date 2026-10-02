import type { ScoreResult } from '../scoring/types';
import { formatScore } from '../utils/format';

interface ScoreBadgeProps {
  value: number | ScoreResult;
  label?: string;
  compact?: boolean;
}

export function ScoreBadge({ value, label, compact = false }: ScoreBadgeProps) {
  const numeric=typeof value === 'number' ? value : value.value;
  const hue = numeric === undefined ? 0 : Math.round(12 + (numeric / 100) * 138);
  return (
    <div
      className={compact ? 'score-badge score-badge--compact' : 'score-badge'}
      style={{ '--score-hue': hue } as React.CSSProperties}
      aria-label={(label ?? '分數') + ' ' + formatScore(value)}
    >
      <strong>{formatScore(numeric)}</strong>
      {typeof value === 'object' && value.status !== 'available' ? <span>{value.value === undefined ? '資料不足' : '部分 '+Math.round(value.coverage.ratio*100)+'%'}</span> : null}
      {label ? <span>{label}</span> : null}
    </div>
  );
}
