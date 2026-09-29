export function formatScore(value: number): string {
  return value.toFixed(1);
}

export function formatPercent(value: number, decimals = 0): string {
  return (value * 100).toFixed(decimals) + '%';
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}
