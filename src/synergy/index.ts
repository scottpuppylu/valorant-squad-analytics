import { synergyBenchmarks, synergyCoverageGate, synergyPriorStrength } from './benchmarks.js';
import type { ScoreStatus, SynergyComponentKey, SynergyIndex } from './types.js';

export interface PairSignal { a?: number; b?: number; status: ScoreStatus }
export const mutualLift = (a?: number, b?: number): number | undefined =>
  a !== undefined && b !== undefined && Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : undefined;
const clamp = (value: number) => Math.max(0, Math.min(100, value));

export function calculateSynergyIndex(shared: number, baselineA: number, baselineB: number,
  overall: PairSignal, kast: PairSignal, winRate: { delta?: number; status: ScoreStatus }): SynergyIndex {
  shared = Number.isSafeInteger(shared) && shared >= 0 ? shared : 0;
  baselineA = Number.isSafeInteger(baselineA) && baselineA >= 0 ? baselineA : 0;
  baselineB = Number.isSafeInteger(baselineB) && baselineB >= 0 ? baselineB : 0;
  const shrinkFactor = shared / (shared + synergyPriorStrength);
  const deltas = { overall: mutualLift(overall.a, overall.b), kast: mutualLift(kast.a, kast.b), winRate: winRate.delta };
  const signals = { overall, kast, winRate };
  const components = (Object.keys(synergyBenchmarks) as SynergyComponentKey[]).map((key) => {
    const benchmark = synergyBenchmarks[key];
    const raw = deltas[key];
    const valid = raw !== undefined && Number.isFinite(raw) && signals[key].status !== 'unavailable';
    const shrunkDelta = valid ? raw * shrinkFactor : undefined;
    return { key, status: valid ? signals[key].status : 'unavailable' as const,
      rawDelta: valid ? raw : undefined, shrunkDelta,
      normalized: shrunkDelta === undefined ? undefined : clamp(50 + 50 * shrunkDelta / benchmark.range),
      configuredWeight: benchmark.weight, usedWeight: 0, range: benchmark.range,
      omission: valid ? undefined : key === 'overall' ? '雙方綜合表現窗口均須可計分' : '缺少雙方有效基準或完整觀測',
    };
  });
  const coverage = components.reduce((sum, c) => sum + (c.normalized === undefined ? 0 : c.configuredWeight), 0);
  const omissions = components.flatMap((c) => c.omission ? [c.omission] : []);
  if (shared < 3) omissions.push('共同同隊樣本少於 3 場');
  if (Math.min(baselineA, baselineB) < 5) omissions.push('任一玩家其他場次基準少於 5 場');
  if (coverage < synergyCoverageGate) omissions.push('可用成分權重低於 75%');
  const scoreable = shared >= 3 && Math.min(baselineA, baselineB) >= 5
    && components[0]!.normalized !== undefined && coverage >= synergyCoverageGate;
  const status = !scoreable ? 'unavailable' : shared >= 8 && Math.min(baselineA, baselineB) >= 8
    && components.every((c) => c.status === 'available') ? 'available' : 'partial';
  for (const c of components) c.usedWeight = scoreable && c.normalized !== undefined ? c.configuredWeight / coverage : 0;
  return { status, value: scoreable ? components.reduce((sum, c) => sum + (c.normalized ?? 0) * c.usedWeight, 0) : undefined,
    confidence: clamp(100 * Math.sqrt(Math.min(shared / 15, 1) * Math.min(Math.min(baselineA, baselineB) / 20, 1)) * coverage),
    coverage, shrinkFactor, components, omissions };
}
