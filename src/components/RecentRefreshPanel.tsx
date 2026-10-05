import { useEffect, useState } from 'react';
import { recentRefreshLabels as L } from '../analytics/presentation';
import type { RecentRefreshOutcome } from '../dataSources/server/contracts';
import { useDataset } from '../hooks/useDataset';
import type { PublicAccount } from '../types/valorant';
import { formatMinutesAgo, formatMinutesUntil } from '../utils/format';

type RowState = { accountId: string; checking: boolean; outcome?: RecentRefreshOutcome };

function describe(outcome: RecentRefreshOutcome): string {
  const wait = formatMinutesUntil(outcome.nextEligibleAt);
  switch (outcome.status) {
    case 'refreshed':
      if (outcome.morePending) return L.morePending;
      return (outcome.newMatches ?? 0) > 0 ? `${L.refreshedNew}（新增 ${outcome.newMatches} 場）` : L.refreshedNone;
    case 'fresh': return wait ? `${L.fresh} · 約 ${wait} 分鐘後可再次更新` : L.fresh;
    case 'busy': return L.busy;
    case 'backoff': return wait ? `${L.backoff} · 約 ${wait} 分鐘後可再更新` : `${L.backoff} · ${L.retryLater}`;
    default: return L.unavailable;
  }
}

/** One ACCOUNT's freshness row. `auto` = one automatic attempt per account per tab. */
function AccountRefresh({ account, auto, showAccount }: { account: PublicAccount; auto: boolean; showAccount: boolean }) {
  const { refreshRecent } = useDataset();
  const [state, setState] = useState<RowState>({ accountId: account.id, checking: auto });

  useEffect(() => {
    if (!refreshRecent || !auto) return undefined;
    let active = true;
    void refreshRecent(account.id, 'auto').then((outcome) => { if (active) setState({ accountId: account.id, checking: false, outcome }); });
    return () => { active = false; };
  }, [account.id, auto, refreshRecent]);

  if (!refreshRecent) return null;
  const current = state.accountId === account.id ? state : { accountId: account.id, checking: auto };
  const manual = () => {
    setState({ accountId: account.id, checking: true, outcome: current.outcome });
    void refreshRecent(account.id, 'manual').then((outcome) => setState({ accountId: account.id, checking: false, outcome }));
  };
  const message = current.checking ? L.checking : current.outcome ? describe(current.outcome) : '尚未檢查（多帳號成員不會自動更新）';
  return <div className="flex flex-wrap items-center justify-between gap-3">
    <div aria-live="polite">
      {showAccount ? <p className="font-mono text-xs text-slate-400">{account.gameName}#{account.tag}</p> : null}
      <p className="text-slate-300">{message}</p>
      {current.outcome?.lastSuccessAt ? <p className="text-xs text-slate-400">最近同步：{formatMinutesAgo(current.outcome.lastSuccessAt)}（近期戰績，非完整生涯）</p> : null}
    </div>
    <button className="button-secondary" disabled={current.checking} onClick={manual} type="button">更新戰績</button>
  </div>;
}

/**
 * TASK-DATA-FASTSYNC-01 Profile freshness, made explicit for TASK-IDENTITY-01: sync is ACCOUNT-scoped.
 * One public account → the original automatic refresh-if-stale. Several accounts → NO automatic
 * provider fan-out; each account has its own manual action. Demo/Pages renders nothing (no API).
 */
export function RecentRefreshPanel({ accounts }: { accounts: PublicAccount[] }) {
  const { refreshRecent } = useDataset();
  if (!refreshRecent || accounts.length === 0) return null;
  const single = accounts.length === 1;
  return <section aria-label="戰績更新" className="surface-card space-y-3 p-4 text-sm">
    {accounts.map((account) => <AccountRefresh account={account} auto={single} key={account.id} showAccount={!single} />)}
  </section>;
}
