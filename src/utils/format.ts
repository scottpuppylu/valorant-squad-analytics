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

export function formatFullDate(value?: string): string {
  if (!value || Number.isNaN(Date.parse(value))) return unavailable;
  return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(value));
}

export function formatDateTime(value?: string): string {
  if (!value || Number.isNaN(Date.parse(value))) return unavailable;
  return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

/** Relative "X 分鐘前" for sync freshness; display-only. */
export function formatMinutesAgo(value: string | undefined, now: number = Date.now()): string {
  if (!value || Number.isNaN(Date.parse(value))) return unavailable;
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000));
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes} 分鐘前`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} 小時前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}

/** Minutes until an ISO time, rounded up, never negative; display-only. */
export function formatMinutesUntil(value: string | undefined, now: number = Date.now()): string | undefined {
  if (!value || Number.isNaN(Date.parse(value))) return undefined;
  return `${Math.max(1, Math.ceil((Date.parse(value) - now) / 60_000))}`;
}

/** Signed display for the Progress Index (−100..+100); rounding is display-only. */
export function formatSigned(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return unavailable;
  const rounded = value.toFixed(decimals);
  return Number(rounded) > 0 ? `+${rounded}` : Number(rounded) === 0 ? (0).toFixed(decimals) : rounded;
}
