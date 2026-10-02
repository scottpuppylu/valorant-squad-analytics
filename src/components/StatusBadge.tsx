import type { ScoreResult } from '../scoring/types';
import { formatPercent } from '../utils/format';

export function StatusBadge({ status, coverage }: { status: ScoreResult['status']; coverage?: number }) {
  return <span className="status-badge" data-status={status}>{status === 'available' ? '完整' : status === 'partial' ? '部分證據' : '資料不足'}{status === 'partial' && coverage !== undefined ? ` · ${formatPercent(coverage, 0)}` : ''}</span>;
}
