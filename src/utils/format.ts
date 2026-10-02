import type { ScoreResult } from '../scoring/types';
const unavailable = '—';

function formatFixed(value: number | undefined, decimals: number): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(decimals) : unavailable;
}

export function formatScore(value: number | ScoreResult | undefined): string {
  if (typeof value === 'object') return value.value === undefined ? '資料不足' : `${formatFixed(value.value, 1)}${value.status === 'partial' ? ` · 部分證據 ${formatPercent(value.coverage.ratio, 0)}` : ''}`;
  return formatFixed(value, 1);
}

export function formatAcs(value: number): string {
  return formatFixed(value, 1);
}

export function formatAdr(value: number): string {
  return formatFixed(value, 1);
}

export function formatRatio(value: number | undefined): string {
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
