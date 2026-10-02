import type { DatasetRuntimeSource, DatasetRuntimeStatus } from '../contexts/DatasetContext';

export function SourceBadge({ source, status, refreshing = false }: { source: DatasetRuntimeSource; status: DatasetRuntimeStatus; refreshing?: boolean }) {
  return <span className="source-badge" role="status" aria-label="資料來源"><span aria-hidden="true" />{status === 'loading' ? '載入中' : source === 'REAL_SERVER' ? '公開真實戰績' : '虛構示範資料'}{status === 'stale' ? refreshing ? ' · 正在重新整理' : ' · 上次成功資料' : ''}</span>;
}
