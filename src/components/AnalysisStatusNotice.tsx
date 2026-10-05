import type { ScopedAnalysis } from '../hooks/useScopedAnalysis';

/** DATA-03B.2B: never silently swaps scope; loading/stale/error are always visible. */
export function AnalysisStatusNotice({ analysis }: { analysis: ScopedAnalysis }) {
  if (analysis.status === 'loading') return <p className="sample-warning" role="status">正在以伺服器完整已追蹤歷史計算此資料範圍…</p>;
  if (analysis.status === 'stale') return <p className="sample-warning" role="status">正在更新；目前顯示同一資料範圍上一次的伺服器結果。</p>;
  if (analysis.status === 'error') return <p className="sample-warning" role="alert">伺服器分析暫時無法取得。為避免改用其他資料範圍，此處不顯示替代結果；請稍後重新整理。</p>;
  return null;
}
