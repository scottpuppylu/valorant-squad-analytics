import { Link, Outlet } from 'react-router-dom';
import { useDataset } from '../hooks/useDataset';

export function DatasetRuntimeBoundary() {
  const { status, message, refresh } = useDataset();
  if (status === 'loading') {
    return <section className="surface-card p-8" role="status"><p className="metric-label">資料載入中</p><h1 className="mt-3 text-2xl font-semibold text-white">正在準備分析資料</h1><p className="mt-3 text-slate-400">請稍候，頁面不會以 Demo 假裝真實資料讀取成功。</p></section>;
  }
  if (status === 'empty') {
    return <section className="surface-card p-8"><p className="metric-label">持久化資料集</p><h1 className="mt-3 text-2xl font-semibold text-white">目前沒有可顯示的同意玩家戰績</h1><p className="mt-3 text-slate-400">資料庫讀取成功，但找不到同時具備有效同意、有效小隊成員資格與可用對戰證據的資料。</p><div className="mt-6 flex flex-wrap gap-3"><Link className="button-primary" to="/connect">前往加入調查</Link><button className="button-secondary" type="button" onClick={() => void refresh()}>重新整理</button></div></section>;
  }
  if (status === 'error') {
    return <section className="surface-card p-8" role="alert"><p className="metric-label">資料服務錯誤</p><h1 className="mt-3 text-2xl font-semibold text-white">無法讀取持久化戰績</h1><p className="mt-3 text-slate-400">{message}</p><button className="button-primary mt-6" type="button" onClick={() => void refresh()}>再試一次</button></section>;
  }
  return <>{status === 'stale' ? <div className="sample-warning mb-6" role="status">{message} <button type="button" className="text-link" onClick={() => void refresh()}>重新整理</button></div> : null}<Outlet /></>;
}
