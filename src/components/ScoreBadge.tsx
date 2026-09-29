interface ScoreBadgeProps {
  value: number;
  label?: string;
  compact?: boolean;
}

export function ScoreBadge({ value, label, compact = false }: ScoreBadgeProps) {
  const hue = Math.round(12 + (value / 100) * 138);
  return (
    <div
      className={compact ? 'score-badge score-badge--compact' : 'score-badge'}
      style={{ '--score-hue': hue } as React.CSSProperties}
      aria-label={(label ?? '分數') + ' ' + value.toFixed(1)}
    >
      <strong>{value.toFixed(1)}</strong>
      {label ? <span>{label}</span> : null}
    </div>
  );
}
