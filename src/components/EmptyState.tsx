import type { ReactNode } from 'react';

export function EmptyState({ title, description, actions, page = false }: { title: string; description: string; actions?: ReactNode; page?: boolean }) {
  const Heading = page ? 'h1' : 'h2';
  return <section className="surface-card empty-state"><Heading>{title}</Heading><p>{description}</p>{actions ? <div className="connect-actions">{actions}</div> : null}</section>;
}

export function LoadingPanel({ title = '正在準備分析資料' }: { title?: string }) {
  return <section className="surface-card loading-panel" role="status" aria-live="polite"><h1>{title}</h1><p>請稍候，正在載入內容。</p><div className="loading-skeleton" aria-hidden="true" /><div className="loading-skeleton" aria-hidden="true" /></section>;
}
