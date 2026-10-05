import { describeWindow, scopeKindLabels, scopeReasonLabels, scopeStatusLabels } from '../analytics/presentation';
import { policyFor } from '../analytics/scope/policies';
import { seasonLabel } from '../analytics/scope/season';
import type { ScopeReason, ScopeSummary } from '../analytics/scope/types';
import type { Player } from '../types/valorant';
import { formatPercent } from '../utils/format';

const reasonList = (reasons: ScopeReason[]) => reasons.map((reason) => scopeReasonLabels[reason]).join('、');

/** Compact "what scope does this number represent" disclosure; details stay collapsed. */
export function ScopeExplanation({ scope, players }: { scope?: ScopeSummary; players: Player[] }) {
  if (!scope) return null;
  const policy = policyFor(scope.feature);
  const byId = new Map(players.map((player) => [player.id, player]));
  const rows = [...scope.players.values()].sort((a, b) => (byId.get(a.playerId)?.handle ?? a.playerId).localeCompare(byId.get(b.playerId)?.handle ?? b.playerId));
  const title = scope.kind === 'ACT' ? seasonLabel(scope.seasonKey) : policy.label;
  return <details className="surface-card scope-disclosure p-4 text-sm" data-scope-kind={scope.kind} data-scope-status={scope.status}>
    <summary className="cursor-pointer">
      <strong>資料範圍：{title}</strong>
      <span className="text-slate-400"> · {scopeKindLabels[scope.kind]} · {scope.queues === 'all' ? '所有模式' : '僅競技模式'} · {scopeStatusLabels[scope.status]}</span>
    </summary>
    <div className="mt-3 space-y-2 text-slate-300">
      <p>{policy.why}</p>
      <p className="text-slate-400">全部選取樣本：{describeWindow(scope.sample)}。版本：{scope.scopeRuleVersion} · {scope.featurePolicyVersion}{scope.kind === 'ADAPTIVE' ? ' · adaptive-window-v1' : ''}。不會改用其他範圍補值。</p>
      {scope.reasons.length ? <p className="text-slate-400">說明：{reasonList(scope.reasons)}</p> : null}
      {scope.kind === 'ADAPTIVE' && rows.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="每位玩家的觀察區間">
        <table className="analysis-summary-table"><thead><tr><th scope="col">玩家</th><th scope="col">狀態</th><th scope="col">現況區間</th><th scope="col">區間信心</th><th scope="col">選擇原因</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.playerId}>
            <td>{byId.get(row.playerId)?.handle ?? '—'}</td>
            <td>{scopeStatusLabels[row.status]}</td>
            <td>{describeWindow(row.sample)}</td>
            <td>{row.window ? `${formatPercent(row.window.confidence.overall, 0)}（樣本 ${formatPercent(row.window.confidence.sample, 0)}／時間 ${formatPercent(row.window.confidence.temporal, 0)}／進階證據 ${formatPercent(row.window.confidence.evidence, 0)}）` : '—'}</td>
            <td>{reasonList(row.reasons.filter((reason) => reason !== 'rank_evidence_unavailable' && reason !== 'season_evidence_unavailable'))}</td>
          </tr>)}</tbody></table>
      </div> : null}
      <p className="text-slate-500">區間信心與樣本量只影響選樣與可信度，不會提高或降低表現分數；這不是 Riot 官方牌位。</p>
    </div>
  </details>;
}
