import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { activeDataset } from '../data/analytics';
import { removeBrowserRealDataset, saveBrowserRealDataset } from '../dataSources/real/BrowserRealDatasetRepository';
import {
  loadBrowserConsentCredential,
  saveBrowserConsentCredential,
  type StoredConsentCredential,
} from '../dataSources/real/BrowserConsentCredentialRepository';
import {
  acceptBrowserRevocation,
  checkBrowserDeletionStatus,
  continueBrowserDeletion,
  type DeletionSessionUpdate,
} from '../dataSources/real/BrowserDeletionSessionService';
import { BackendApiError, valorantBackendClient } from '../dataSources/server/ValorantBackendClient';
import type { Affinity, ConnectionRequest, ImportSize, PublicAccount, PublicDeletionProgress, PublicSyncProgress } from '../dataSources/server/contracts';

type ProviderState = 'checking' | 'configured' | 'unconfigured' | 'unavailable';
type FlowState = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'ACCOUNT_NOT_FOUND' | 'RATE_LIMITED' | 'PROVIDER_ERROR' | 'NO_MATCHES' | 'IMPORTING' | 'IMPORT_COMPLETE' | 'SYNCING' | 'REVOCING' | 'DELETION_WORKING' | 'REVOKED';

const affinities: Array<{ value: Affinity; label: string }> = [
  { value: 'ap', label: '亞太（ap）' }, { value: 'kr', label: '韓國（kr）' }, { value: 'eu', label: '歐洲（eu）' },
  { value: 'na', label: '北美（na）' }, { value: 'latam', label: '拉丁美洲（latam）' }, { value: 'br', label: '巴西（br）' },
];

function stateForError(error: BackendApiError): FlowState {
  if (error.code === 'ACCOUNT_NOT_FOUND') return 'ACCOUNT_NOT_FOUND';
  if (error.code === 'NO_MATCHES') return 'NO_MATCHES';
  if (error.code === 'RATE_LIMITED') return 'RATE_LIMITED';
  return 'PROVIDER_ERROR';
}

export function ConnectPage() {
  const [provider, setProvider] = useState<ProviderState>('checking');
  const [flow, setFlow] = useState<FlowState>('IDLE');
  const [form, setForm] = useState<ConnectionRequest>({ gameName: '', tag: '', affinity: 'ap', consent: false });
  const [account, setAccount] = useState<PublicAccount | null>(null);
  const [limit, setLimit] = useState<ImportSize>(10);
  const [message, setMessage] = useState('');
  const [syncProgress, setSyncProgress] = useState<PublicSyncProgress | null>(null);
  const [storedCredential, setStoredCredential] = useState<StoredConsentCredential | null>(() => loadBrowserConsentCredential());
  const [deletionProgress, setDeletionProgress] = useState<PublicDeletionProgress | null>(null);
  const [revokeConfirmation, setRevokeConfirmation] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const requestActive = useRef(false);
  const deletionSessionActive = storedCredential?.revocationAccepted === true;

  useEffect(() => {
    let active = true;
    valorantBackendClient.providerStatus()
      .then((result) => { if (active) setProvider(result.provider.usable ? 'configured' : 'unconfigured'); })
      .catch(() => { if (active) setProvider('unavailable'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!deletionSessionActive || activeDataset.mode !== 'REAL') return;
    removeBrowserRealDataset();
    window.location.hash = '#/connect';
    window.location.reload();
  }, [deletionSessionActive]);

  async function resolveAccount(event: FormEvent) {
    event.preventDefault();
    if (requestActive.current || !form.consent || storedCredential?.revocationAccepted) return;
    requestActive.current = true;
    setFlow('CONNECTING');
    setMessage('');
    try {
      const result = await valorantBackendClient.resolveAccount(form);
      setAccount(result.account);
      if (result.account.playerId && result.managementCredential) {
        saveBrowserConsentCredential(result.account.playerId, result.managementCredential);
        setStoredCredential(loadBrowserConsentCredential());
      }
      setFlow('CONNECTED');
    } catch (error) {
      const safe = error instanceof BackendApiError ? error : new BackendApiError('PROVIDER_ERROR', '連接失敗，請稍後再試。');
      setFlow(stateForError(safe));
      setMessage(safe.message);
    } finally {
      requestActive.current = false;
    }
  }

  async function importMatches() {
    if (requestActive.current || !account?.playerId || !form.consent || storedCredential?.revocationAccepted) return;
    requestActive.current = true;
    setFlow('IMPORTING');
    setMessage('');
    try {
      const verifiedConnection: ConnectionRequest = {
        gameName: account.gameName,
        tag: account.tag,
        affinity: account.affinity,
        consent: form.consent,
      };
      const result = await valorantBackendClient.importMatches(verifiedConnection, account.playerId, limit);
      saveBrowserRealDataset(result.dataset, result.importedAt);
      setFlow('IMPORT_COMPLETE');
      setMessage(`已安全匯入 ${result.importedMatches} 場戰績。`);
    } catch (error) {
      const safe = error instanceof BackendApiError ? error : new BackendApiError('PROVIDER_ERROR', '匯入失敗，請稍後再試。');
      setFlow(stateForError(safe));
      setMessage(safe.message);
    } finally {
      requestActive.current = false;
    }
  }

  async function syncAvailableHistory() {
    if (requestActive.current || !account?.playerId || storedCredential?.revocationAccepted) return;
    requestActive.current = true;
    setFlow('SYNCING');
    setMessage('');
    try {
      const result = syncProgress && syncProgress.status !== 'complete'
        ? await valorantBackendClient.continueSync(syncProgress.runId)
        : await valorantBackendClient.startSync(account.playerId, syncProgress?.status === 'complete' ? 'incremental' : 'backfill');
      setSyncProgress(result.sync);
      setFlow('CONNECTED');
      setMessage(result.sync.status === 'complete'
        ? `同步完成：已處理 ${result.sync.progress.matchesSeen} 場目前資料來源可取得的紀錄。`
        : `已完成 ${result.sync.progress.pages} 個安全區塊；可繼續從已保存的進度同步。`);
    } catch (error) {
      const safe = error instanceof BackendApiError ? error : new BackendApiError('PROVIDER_ERROR', '歷史同步失敗，已保存先前進度。');
      setFlow(stateForError(safe));
      setMessage(safe.message);
    } finally {
      requestActive.current = false;
    }
  }

  function openImportedDataset() {
    window.location.hash = '#/';
    window.location.reload();
  }

  function removeImportedDataset() {
    removeBrowserRealDataset();
    window.location.hash = '#/connect';
    window.location.reload();
  }

  function applyDeletionUpdate(update: DeletionSessionUpdate) {
    setDeletionProgress(update.deletion);
    setStoredCredential(update.session);
    setRevoked(true);
    setAccount(null);
    setForm((current) => ({ ...current, consent: false }));
    setRevokeConfirmation(false);
    setFlow('REVOKED');
    setMessage(update.deletion.status === 'complete'
      ? '伺服器資料已完成刪除或匿名化；本機真實資料、刪除工作狀態與管理憑證已清除。'
      : '撤回已接受並停止同步；本機真實資料已清除，刪除專用憑證會保留到伺服器工作完成。');
  }

  async function revokeConsent() {
    if (requestActive.current || !storedCredential) return;
    requestActive.current = true;
    setFlow('REVOCING');
    setMessage('');
    const sensitiveCredential = storedCredential.managementCredential;
    let accepted = false;
    try {
      const result = await valorantBackendClient.revokeConsent(storedCredential.playerId, sensitiveCredential);
      accepted = true;
      applyDeletionUpdate(acceptBrowserRevocation(storedCredential.playerId, sensitiveCredential, result.deletion));
      window.location.hash = '#/connect';
      window.location.reload();
    } catch (error) {
      const safe = error instanceof BackendApiError ? error : new BackendApiError('PROVIDER_ERROR', '撤回同意失敗，尚未清除本機資料。');
      if (accepted) {
        removeBrowserRealDataset();
        setRevoked(true);
        setFlow('REVOKED');
        setMessage('伺服器已接受撤回並停止同步，但瀏覽器無法保存刪除工作狀態。請保持此頁面並聯絡管理員。');
      } else {
        setFlow('PROVIDER_ERROR');
        setMessage(safe.message);
      }
    } finally {
      requestActive.current = false;
    }
  }

  async function recoverDeletion(action: 'status' | 'continue') {
    if (requestActive.current || !storedCredential?.revocationAccepted) return;
    requestActive.current = true;
    setFlow('DELETION_WORKING');
    setMessage('');
    try {
      const update = action === 'status'
        ? await checkBrowserDeletionStatus()
        : await continueBrowserDeletion();
      if (!update) {
        setStoredCredential(loadBrowserConsentCredential());
        setFlow('PROVIDER_ERROR');
        setMessage('找不到可續跑的本機刪除工作狀態。');
        return;
      }
      applyDeletionUpdate(update);
    } catch (error) {
      const safe = error instanceof BackendApiError ? error : new BackendApiError('PROVIDER_ERROR', '暫時無法更新資料刪除進度，憑證仍安全保留。');
      setFlow('PROVIDER_ERROR');
      setMessage(safe.message);
    } finally {
      requestActive.current = false;
    }
  }

  const busy = flow === 'CONNECTING' || flow === 'IMPORTING' || flow === 'SYNCING' || flow === 'REVOCING' || flow === 'DELETION_WORKING';
  const providerLabel = provider === 'checking' ? '檢查中' : provider === 'configured' ? '可使用' : provider === 'unconfigured' ? '尚未設定' : '此部署未提供';

  return (
    <div className="connect-layout">
      <header className="page-heading">
        <div><p className="metric-label">玩家資料連接</p><h1>加入哥布林大調查</h1><p>只需 Riot ID、Tag 與你的明確同意。資料服務憑證由網站管理員一次設定。</p></div>
        <span className="provider-status" data-status={provider === 'configured' ? 'ready' : 'unavailable'}>API 連線：{providerLabel}</span>
      </header>

      {activeDataset.mode === 'REAL' && !revoked && !deletionSessionActive ? (
        <section className="surface-card connect-panel">
          <p className="metric-label">目前資料來源</p>
          <h2>真實戰績已啟用</h2>
          <p>目前瀏覽器保存 {activeDataset.players.length} 位玩家、{activeDataset.matches.length} 場已正規化戰績；Demo 與真實資料不會混合。</p>
          <div className="connect-actions"><button className="button-primary" type="button" onClick={openImportedDataset}>查看真實戰績</button><button className="button-secondary" type="button" onClick={removeImportedDataset}>移除本機戰績並返回 Demo</button></div>
        </section>
      ) : null}

      {deletionSessionActive ? (
        <section className="surface-card connect-panel deletion-progress-panel" aria-live="polite">
          <p className="metric-label">同意已撤回</p>
          <h2>資料刪除處理中</h2>
          <p>本機真實戰績已清除。這個瀏覽器只保留刪除工作識別碼與刪除專用憑證，不會用於重新連接或同步戰績。</p>
          <dl className="deletion-progress-grid">
            <div><dt>目前狀態</dt><dd>{deletionProgress?.status ?? '等待查詢'}</dd></div>
            <div><dt>目前階段</dt><dd>{deletionProgress?.stage ?? '已保存，可安全續跑'}</dd></div>
            <div><dt>執行次數</dt><dd>{deletionProgress?.progress.attempts ?? '—'}</dd></div>
          </dl>
          <div className="connect-actions">
            <button className="button-secondary" type="button" disabled={busy} onClick={() => void recoverDeletion('status')}>
              {flow === 'DELETION_WORKING' ? '查詢中…' : '檢查刪除狀態'}
            </button>
            <button className="button-primary" type="button" disabled={busy} onClick={() => void recoverDeletion('continue')}>
              {flow === 'DELETION_WORKING' ? '處理中…' : '繼續刪除'}
            </button>
          </div>
          <p className="connect-notice">只有伺服器回報 complete 後，本機才會銷毀刪除專用憑證並重新開放連接流程。</p>
        </section>
      ) : (
      <div className="connect-grid">
        <form className="surface-card connect-panel" onSubmit={resolveAccount}>
          <div><p className="metric-label">第一步</p><h2>確認玩家帳號</h2><p>台灣玩家通常使用亞太（ap）；若帳號所屬不同，可自行修正。</p></div>
          <label>Riot ID<input autoComplete="off" maxLength={32} required value={form.gameName} onChange={(event) => setForm((current) => ({ ...current, gameName: event.target.value }))} placeholder="Game Name" /></label>
          <label>Tag<input autoComplete="off" maxLength={10} required value={form.tag} onChange={(event) => setForm((current) => ({ ...current, tag: event.target.value }))} placeholder="Tag" /></label>
          <label>Region / affinity<select value={form.affinity} onChange={(event) => setForm((current) => ({ ...current, affinity: event.target.value as Affinity }))}>{affinities.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="consent-row"><input type="checkbox" checked={form.consent} onChange={(event) => setForm((current) => ({ ...current, consent: event.target.checked }))} /><span>我同意哥布林大調查讀取我的 VALORANT 公開戰績，用於朋友群的統計、排名與分析。 <Link to="/privacy">查看隱私說明</Link></span></label>
          <button className="button-primary" type="submit" disabled={!form.consent || busy || provider !== 'configured'}>{flow === 'CONNECTING' ? '連接中…' : '連接戰績'}</button>
          {provider !== 'configured' && provider !== 'checking' ? <p className="connect-notice">此部署目前無法連接真實資料；Demo 分析仍可正常使用。</p> : null}
        </form>

        <aside className="surface-card connect-panel security-panel">
          <p className="metric-label">安全提醒</p><h2>不需要 Riot 登入資料</h2><p>哥布林大調查不需要、也不會要求：</p>
          <ul><li>Riot 密碼</li><li>驗證碼或 MFA</li><li>Cookie</li><li>Riot 登入憑證或 session token</li><li>HenrikDev API key</li></ul>
          <p>本站只會把 Riot ID、Tag、區域與本次同意送往自己的同源後端。</p>
        </aside>
      </div>
      )}

      {account ? (
        <section className="surface-card connect-panel">
          <p className="metric-label">帳號已確認</p><h2>{account.gameName}#{account.tag}</h2><p>區域：{account.affinity}{account.accountLevel === undefined ? '' : ` · 帳號等級 ${account.accountLevel}`}</p>
          <label>匯入最近戰績<select value={limit} disabled={busy} onChange={(event) => setLimit(Number(event.target.value) as ImportSize)}><option value={1}>1 場（最小資料）</option><option value={10}>10 場</option><option value={20}>20 場</option><option value={30}>30 場</option></select></label>
          <button className="button-primary" type="button" disabled={busy || !form.consent || !account.playerId} onClick={importMatches}>{flow === 'IMPORTING' ? '匯入中…' : '匯入最近戰績'}</button>
          {account.playerId ? (
            <div className="connect-history-sync">
              <p className="metric-label">持久化歷史同步</p>
              <p>每次只處理一個安全區塊，進度會保存；範圍僅代表目前資料供應商可取得的歷史紀錄，不代表完整生涯。</p>
              <button className="button-secondary" type="button" disabled={busy} onClick={syncAvailableHistory}>
                {flow === 'SYNCING' ? '同步中…' : syncProgress?.status === 'paused' ? '繼續同步下一區塊' : syncProgress?.status === 'complete' ? '檢查新增或修正紀錄' : '開始歷史同步'}
              </button>
              {syncProgress ? <p>區塊 {syncProgress.progress.pages} · 已處理 {syncProgress.progress.matchesSeen} 場 · 重疊更新 {syncProgress.progress.overlapsUpdated} 場</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {storedCredential && !storedCredential.revocationAccepted ? (
        <section className="surface-card connect-panel consent-management-panel">
          <p className="metric-label">同意管理</p>
          <h2>取消參與哥布林大調查</h2>
          <p>這個瀏覽器保存了一次性核發的管理權限。玩家公開識別碼本身不能授權刪除。</p>
          {revokeConfirmation ? (
            <div className="revocation-warning" role="alert">
              <strong>取消後將停止同步，並刪除或匿名化伺服器上的個人戰績資料。此操作無法復原。</strong>
              <p>請再次確認。共享比賽只會保留其他仍同意玩家所需的匿名事件結構。</p>
              <div className="connect-actions">
                <button className="button-danger" type="button" disabled={busy} onClick={revokeConsent}>{flow === 'REVOCING' ? '撤回處理中…' : '確認撤回並刪除資料'}</button>
                <button className="button-secondary" type="button" disabled={busy} onClick={() => setRevokeConfirmation(false)}>保留參與</button>
              </div>
            </div>
          ) : (
            <button className="button-secondary" type="button" disabled={busy} onClick={() => setRevokeConfirmation(true)}>取消參與哥布林大調查</button>
          )}
        </section>
      ) : account?.playerId ? (
        <section className="surface-card connect-panel">
          <p className="metric-label">同意管理</p><h2>需要管理員協助</h2>
          <p>這筆連接沒有在本瀏覽器中找到管理憑證。舊版同意不會自動補發；請聯絡管理員使用受控流程處理。</p>
        </section>
      ) : null}

      {message ? <div className="surface-card connect-message" role="status" data-state={flow}>{message}{flow === 'IMPORT_COMPLETE' ? <button type="button" className="text-link" onClick={openImportedDataset}>開啟真實資料分析 →</button> : null}</div> : null}
    </div>
  );
}
