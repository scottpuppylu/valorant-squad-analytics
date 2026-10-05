# Adaptive Improvement Index — design only

**TASK-PROGRESS-01. Status: NOT IMPLEMENTED (design only).** Depends on DATA-03B.2A
(`adaptive-window-v1`, registry entry `improvementIndex`, `implementation: 'design_only'`).
No formula, score, weight or UI value exists. Do not display a number until this task is
explicitly authorized, versioned, documented in SCORING.md and tested.

The existing 近期狀態 / 近期進步最多 (recent form) is **not** this index. It keeps its unchanged
formula (Overall delta, ±2 thresholds) and only uses adaptive `recentForm` windows.

## Purpose

Describe whether a player's performance is changing, with transparent windows and separate
confidence. It is not Riot rank, MMR or Elo.

## Windows

- **Current window**: `adaptive-window-v1`, Competitive by default. Rounds, active days and
  time span decide the window; match count alone never does.
- **Baseline window**: strictly older and non-overlapping, with a comparable or larger
  effective sample (the design registry asks for ≥100 % of current rounds). It may extend
  further back for low-frequency players, within `maxLookbackDays`. Act crossing must be
  explicit and recorded.
- Every displayed value must expose both windows: 場 / 回合 / 小時 / 天, Act boundary
  handling, confidence, and reasons.

## Evidence components (candidates, to be versioned)

1. **Performance delta**: unchanged community-score dimensions or Overall, current − baseline,
   possibly shrunk toward zero by sample size (as duo-synergy-v1 does).
2. **Rank movement (optional)**: only from real `rank_observations` tied to time/Act
   (TASK-DATA-RANK-01). Missing rank evidence must renormalize the remaining weights or reduce
   confidence. It must never become zero or neutral data.
3. **Trend stability (optional)**: dispersion across the current window.

## Must keep separate

- **Performance improvement** vs **rank movement** vs **confidence** vs **activity volume**.
- Match count, rounds and playtime select and qualify the sample. They must not reward
  grinding: more games may raise confidence, never the improvement value itself.

## Missing evidence

- Current or baseline unavailable → no numeric index (資料不足), with reasons.
- Partial windows → partial status, never a fabricated value.
- No Act evidence → the Act boundary is not enforced and this is stated
  (`season_evidence_unavailable`). No guessing.

## Versioning

New `improvement-index-v1` (formula) plus `improvement-benchmarks-v1` (calibration). Any change
to window policy bumps `feature-scope-policy-v1` / `adaptive-window-v1`, not the score engine.
