import { Link, Outlet, useLocation } from 'react-router-dom';
import { useDataset } from '../hooks/useDataset';
import { EmptyState, LoadingPanel } from './EmptyState';

export function DatasetRuntimeBoundary() {
  const { status, refresh, dataset } = useDataset();
  const { pathname } = useLocation();
  if (status === 'loading') return <LoadingPanel />;
  if (status === 'empty') {
    if (pathname === '/synergy' && dataset.players.length > 0) return <Outlet />;
    return <EmptyState page title="目前尚無可分析的真實對戰" description="公開真實戰績已讀取，目前沒有符合資格的可用對戰。加入調查或查看資料說明，了解如何開始。" actions={<><Link className="button-primary" to="/connect">加入調查</Link><Link className="button-secondary" to="/about">查看資料說明</Link><button className="text-link" type="button" onClick={() => void refresh()}>重新整理資料</button></>} />;
  }
  if (status === 'error') return <div role="alert"><EmptyState page title="暫時無法讀取戰績" description="請稍後重新整理資料。本站不會以虛構示範資料取代真實戰績。" actions={<button className="button-primary" type="button" onClick={() => void refresh()}>重新整理資料</button>} /></div>;
  return <>{status === 'stale' ? <div className="runtime-notice" role="status">保留上次成功載入的資料。<button type="button" className="text-link" onClick={() => void refresh()}>重新整理資料</button></div> : null}<Outlet /></>;
}
