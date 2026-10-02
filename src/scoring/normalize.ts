import { clamp } from '../utils/number';
import type { Benchmark } from './types';
export function normalizeRange(value: number, poor: number, strong: number): number | undefined {
  if (![value,poor,strong].every(Number.isFinite) || poor === strong) return undefined;
  return clamp(100 * (value - poor) / (strong - poor));
}
export function normalizeBenchmark(value: number | undefined, benchmark: Benchmark): number | undefined {
  return value === undefined ? undefined : normalizeRange(value, benchmark.poor, benchmark.strong);
}
