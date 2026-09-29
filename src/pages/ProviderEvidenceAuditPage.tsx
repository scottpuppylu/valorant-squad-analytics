import { useState } from 'react';
import { activeDataset } from '../data/analytics';
import { BackendApiError, valorantBackendClient } from '../dataSources/server/ValorantBackendClient';

function consentingIdentity(): { gameName: string; tag: string } | null {
  if (activeDataset.mode !== 'REAL' || activeDataset.players.length !== 1) return null;
  const handle = activeDataset.players[0]!.handle;
  const separator = handle.lastIndexOf('#');
  return separator > 0 ? { gameName: handle.slice(0, separator), tag: handle.slice(separator + 1) } : null;
}

export function ProviderEvidenceAuditPage() {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState('');
  const identity = consentingIdentity();

  async function runAudit() {
    if (!identity || !consent || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await valorantBackendClient.auditEvidence({ ...identity, affinity: 'ap', consent: true });
      setResult(response.audit);
    } catch (caught) {
      setError(caught instanceof BackendApiError ? caught.message : '稽核失敗。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="connect-layout">
      <header className="page-heading"><div><p className="metric-label">受控證據工具</p><h1>Provider 欄位稽核</h1><p>只輸出欄位路徑、型別、缺失率與觀察數，不顯示任何帳號或事件識別值。</p></div></header>
      <section className="surface-card connect-panel">
        <p>{identity ? '已找到目前瀏覽器的 REAL dataset。' : '目前瀏覽器沒有可用的 REAL dataset。'}</p>
        <label className="consent-row"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>我同意使用目前已連接帳號執行一次三場、去識別化的 provider 證據稽核。</span></label>
        <button className="button-primary" type="button" disabled={!identity || !consent || busy} onClick={runAudit}>{busy ? '稽核中…' : '執行受控稽核'}</button>
        {error ? <p role="alert">{error}</p> : null}
      </section>
      {result ? <pre data-audit-result>{JSON.stringify(result, null, 2)}</pre> : null}
    </main>
  );
}
