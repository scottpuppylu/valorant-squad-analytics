import { Component, type ReactNode } from 'react';
import { EmptyState } from './EmptyState';

export class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <EmptyState page title="頁面暫時無法載入" description="請重新整理頁面；目前資料不會以示範內容取代。" actions={<button type="button" className="button-primary" onClick={() => window.location.reload()}>重新整理頁面</button>} /> : this.props.children;
  }
}
