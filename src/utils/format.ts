const unavailable = '—';

function formatFixed(value: number, decimals: number): string {
  return Number.isFinite(value) ? value.toFixed(decimals) : unavailable;
}

export function formatScore(value: number): string {
  return formatFixed(value, 1);
}

export function formatAcs(value: number): string {
  return formatFixed(value, 1);
}

export function formatAdr(value: number): string {
  return formatFixed(value, 1);
}

export function formatRatio(value: number): string {
  return formatFixed(value, 2);
}

export function formatPercent(value: number, decimals = 1): string {
  const percentage = value * 100;
  return Number.isFinite(percentage) ? `${percentage.toFixed(decimals)}%` : unavailable;
}

export function formatCount(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('zh-TW') : unavailable;
}

export function formatCredits(value: number): string {
  return formatCount(value);
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}
