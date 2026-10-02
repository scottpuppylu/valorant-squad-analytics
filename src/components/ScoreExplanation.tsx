import type { ScoreResult } from '../scoring/types';
import { formatScore, formatPercent, formatRatio } from '../utils/format';

export function ScoreExplanation({score}: {score: ScoreResult}) {
  return <details className="mt-3 text-xs leading-6 text-slate-400"><summary className="cursor-pointer">評分依據</summary>
    <p>{score.status === 'available' ? '完整證據' : score.status === 'partial' ? '部分證據' : '資料不足'} · 權重覆蓋 {formatPercent(score.coverage.ratio)} · {score.sample.matches} 場／{score.sample.rounds} 回合 · 信心 {formatScore(score.confidence)}%</p>
    <p>規則 {score.ruleVersion} · 基準 {score.benchmarkVersion}；產品校準範圍，非官方百分位。</p>
    {score.trace.selectedRole ? <p>主要樣本角色：{score.trace.selectedRole}；混合角色先分組正規化再按回合加權。</p> : null}
    {score.trace.components.map((component,index) => <p key={index}>{component.metric}：原值 {formatRatio(component.rawValue)} → {formatScore(component.normalizedValue)} · 設定 {formatPercent(component.configuredWeight)}／實用 {formatPercent(component.usedWeight)} · 證據 {formatPercent(component.observedCoverage)} · 分母 {component.denominator} · {component.benchmark.direction === 'higher' ? '越高越好' : '越低越好'} [{component.benchmark.poor}, {component.benchmark.strong}] {component.omissionReason ?? ''}</p>)}
    {score.trace.dimensions?.map((item) => <p key={item.dimension}>{item.dimension}：{formatScore(item.value)} · 設定 {formatPercent(item.configuredWeight)}／實用 {formatPercent(item.usedWeight)} · 證據 {formatPercent(item.coverage)}</p>)}
    {score.trace.prior ? <p>殘局：{score.trace.prior.wins} 勝／{score.trace.prior.attempts} 次；先驗平均 20%、強度 5；收縮後 {formatPercent(score.trace.prior.shrunkConversion)}</p> : null}
    {score.trace.omissionReason ? <p>未達評分門檻；單一維度至少 70% 權重，綜合至少六維且 75% 權重。</p> : null}
  </details>;
}
