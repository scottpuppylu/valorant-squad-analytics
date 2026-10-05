import type { PerformanceEntry } from '../types.js';
import { resolveAdaptiveWindow, type RankEvidence } from '../scope/adaptiveWindow.js';
import { policyFor } from '../scope/policies.js';
import type { AdaptiveWindowResult, ScopePopulation } from '../scope/types.js';

export type ActPolicy = 'same_act' | 'previous_act_fallback' | 'act_unknown';

export interface ProgressWindows {
  window: AdaptiveWindowResult;
  actPolicy: ActPolicy;
}

/**
 * improvement-index-v1 window resolution (adaptive-window-v1 underneath, same rules for every player).
 * 1. Current window: the player's recent Competitive regime, never crossing an Act boundary.
 * 2. Baseline: strictly older, non-overlapping, comparable; SAME Act first.
 * 3. Only if the same-Act baseline is insufficient: retry allowing the previous observed Act as an
 *    explicit fallback (seasonCrossed=true, lower comparability). Never silent.
 */
export function resolveProgressWindows(entries: PerformanceEntry[], population: ScopePopulation, rank?: RankEvidence): ProgressWindows {
  const policy = policyFor('improvementIndex');
  const options = { population, ...(rank ? { rank } : {}) };
  const sameAct = resolveAdaptiveWindow(entries, policy, options);
  const actKnown = sameAct.current.seasons.length > 0;
  if (sameAct.status !== 'unavailable' || !actKnown || !sameAct.reasons.includes('insufficient_baseline')) {
    return { window: sameAct, actPolicy: actKnown ? 'same_act' : 'act_unknown' };
  }
  const fallback = resolveAdaptiveWindow(entries, { ...policy, baseline: { ...policy.baseline!, crossSeason: true } }, options);
  if (fallback.status !== 'unavailable' && fallback.boundaries.seasonCrossed) {
    // Crossing only into unknown-season matches is not a known previous Act: label it honestly.
    const currentAct = sameAct.current.seasons[0];
    const otherAct = (fallback.baseline?.seasons ?? []).some((key) => key !== currentAct);
    return { window: fallback, actPolicy: otherAct ? 'previous_act_fallback' : 'act_unknown' };
  }
  return { window: sameAct, actPolicy: 'same_act' };
}
