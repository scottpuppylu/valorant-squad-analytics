import { actPolicyLabels, describeWindow, progressDirectionLabels, scopeReasonLabels, scopeStatusLabels } from '../analytics/presentation';
import type { ImprovementResult } from '../analytics/progress/improvementIndex';
import { seasonLabel } from '../analytics/scope/season';
import { zhTW } from '../i18n/zhTW';
import type { ScopedAnalysisStatus } from '../hooks/useScopedAnalysis';
import { formatPercent, formatScore, formatSigned } from '../utils/format';

/** improvement-index-v1 (signed −100..+100). Separate from Overall; never reorders the ranking. */
export function ProgressIndexCard({ status, result }: { status: ScopedAnalysisStatus; result?: ImprovementResult }) {
  if (status === 'loading') return <article className="surface-card context-card" aria-label="進步指數"><p className="metric-label">進步指數</p><p role="status">正在以伺服器完整已追蹤歷史計算現況與基準區間…</p></article>;
  if (status === 'error') return <article className="surface-card context-card" aria-label="進步指數"><p className="metric-label">進步指數</p><p role="alert">進步指數暫時無法取得；不會改用最近 N 場、快照或全部已追蹤代替。</p></article>;
  if (!result) return <article className="surface-card context-card" aria-label="進步指數"><p className="metric-label">進步指數</p><strong>資料不足</strong><p>沒有可比較的競技對戰。</p></article>;
  const numeric = result.value !== undefined;
  const reasons = result.reasons.filter((reason) => reason !== 'rank_evidence_unavailable').map((reason) => scopeReasonLabels[reason]).join('、');
  return <article className="surface-card context-card" aria-label="進步指數" data-progress-status={result.status} data-progress-direction={result.direction ?? 'none'}>
    <p className="metric-label">進步指數 <span className="text-slate-500">（不是實力分數，也不是 Riot 牌位）</span></p>
    <strong className={`form-indicator form-indicator--${result.direction === 'improving' ? 'up' : result.direction === 'declining' ? 'down' : result.direction === 'stable' ? 'flat' : 'insufficient'}`}>
      {numeric ? `${formatSigned(result.value!)} · ${progressDirectionLabels[result.direction!]}` : '資料不足'}
    </strong>
    <p>{scopeStatusLabels[result.status]} · 信心 {formatPercent(result.confidence.overall, 0)} · {actPolicyLabels[result.actPolicy]}</p>
    <details className="mt-2 text-xs text-slate-400">
      <summary className="cursor-pointer">為什麼是這個結果？</summary>
      <p>現況：{describeWindow(result.current)}{result.current.seasons.length ? ` · ${result.current.seasons.map(seasonLabel).join('、')}` : ''}</p>
      <p>基準：{result.baseline ? `${describeWindow(result.baseline)}${result.baseline.seasons.length ? ` · ${result.baseline.seasons.map(seasonLabel).join('、')}` : ''}` : '不足'}</p>
      {result.performance.rawDelta !== undefined ? <p>表現變化：{formatSigned(result.performance.rawDelta, 1)}（{result.performance.dimensions.map((d) => zhTW.scores[d.dimension]).join('、')}，權重覆蓋 {formatPercent(result.performance.coverage, 0)}）→ 收斂後 {formatSigned(result.performance.demonstratedDelta ?? 0, 1)}</p> : null}
      <p>樣本收斂係數 {formatScore(result.performance.shrink * 100)}% · 趨勢穩定度 {result.performance.trendStability.factor === undefined ? '無法評估' : formatPercent(result.performance.trendStability.factor, 0)}</p>
      <p>排位資料：{result.rank.status === 'available' ? `${formatSigned(result.rank.delta!, 1)} 階` : '尚未取得（不計分、不視為 0）'}</p>
      <p>信心：樣本 {formatPercent(result.confidence.sample, 0)}／時間 {formatPercent(result.confidence.temporal, 0)}／證據 {formatPercent(result.confidence.evidence, 0)}／可比性 {formatPercent(result.confidence.comparability, 0)}</p>
      {reasons ? <p>原因：{reasons}</p> : null}
      <p>場數、回合與時數只決定區間與信心，不會因為多打而提高指數。{result.version} · {result.benchmarkVersion}</p>
    </details>
  </article>;
}
