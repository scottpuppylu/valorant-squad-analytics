import type { PlayerRole } from '../types/valorant';
import { clamp, round } from '../utils/number';
import { roleBenchmarks, type ScoredMetric } from './benchmarks';

export function normalizeRange(value: number, minimum: number, target: number): number {
  if (!Number.isFinite(value) || target <= minimum) {
    return 0;
  }

  return round(clamp(((value - minimum) / (target - minimum)) * 100), 1);
}

export function normalizeForRole(metric: ScoredMetric, value: number, role: PlayerRole): number {
  const [minimum, target] = roleBenchmarks[role][metric];
  return normalizeRange(value, minimum, target);
}

export function weightedAvailableScore(items: Array<{ score: number | undefined; weight: number }>, fallback = 50): number {
  const available = items.filter((item): item is { score: number; weight: number } => item.score !== undefined && Number.isFinite(item.score));
  const availableWeight = available.reduce((total, item) => total + item.weight, 0);
  if (availableWeight === 0) {
    return fallback;
  }

  return round(available.reduce((total, item) => total + item.score * item.weight, 0) / availableWeight, 1);
}
