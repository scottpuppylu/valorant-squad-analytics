import { Link, Outlet, useLocation } from 'react-router-dom';
import { useDataset } from '../hooks/useDataset';

export function DatasetRuntimeBoundary() {
  const { status, message, refresh, dataset } = useDataset();
  const { pathname } = useLocation();
  if (status === 'loading') {
    return <section className="surface-card p-8" role="status"><p className="metric-label">資料載入中</p><h1 className="mt-3 text-2xl font-semibold text-white">正在準備分析資料</h1><p className="mt-3 text-slate-400">請稍候，頁面不會以 Demo 假裝真實資料讀取成功。</p></section>;
  }
  if (status === 'empty') {
    if (pathname === '/synergy' && dataset.players.length > 0) return <Outlet />;
    return <section className="surface-card p-8"><p className="metric-label">公開真實戰績</p><h1 className="mt-3 text-2xl font-semibold text-white">目前尚無已加入的真實玩家</h1><p className="mt-3 text-slate-400">公開資料集讀取成功，但目前沒有同時具備最新版公開顯示同意、有效小隊成員資格與可用對戰證據的玩家。</p><div className="mt-6 flex flex-wrap gap-3"><Link className="button-primary" to="/connect">前往加入調查</Link><button className="button-secondary" type="button" onClick={() => void refresh()}>重新整理</button></div></section>;
  }
  if (status === 'error') {
    return <section className="surface-card p-8" role="alert"><p className="metric-label">資料服務錯誤</p><h1 className="mt-3 text-2xl font-semibold text-white">無法讀取持久化戰績</h1><p className="mt-3 text-slate-400">{message}</p><button className="button-primary mt-6" type="button" onClick={() => void refresh()}>再試一次</button></section>;
  }
  return <>{status === 'stale' ? <div className="sample-warning mb-6" role="status">{message} <button type="button" className="text-link" onClick={() => void refresh()}>重新整理</button></div> : null}<Outlet /></>;
}
