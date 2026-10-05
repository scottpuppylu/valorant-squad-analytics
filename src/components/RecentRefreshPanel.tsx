import { useEffect, useState } from 'react';
import { recentRefreshLabels as L } from '../analytics/presentation';
import type { RecentRefreshOutcome } from '../dataSources/server/contracts';
import { useDataset } from '../hooks/useDataset';
import { formatMinutesAgo, formatMinutesUntil } from '../utils/format';

type PanelState = { playerId: string; checking: boolean; outcome?: RecentRefreshOutcome };

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

/**
 * TASK-DATA-FASTSYNC-01 Profile freshness. Renders only for PUBLIC REAL (Demo/Pages: nothing, no API).
 * Stored data is already on screen; this never blocks it and never shows unconfirmed matches.
 */
export function RecentRefreshPanel({ playerId }: { playerId: string }) {
  const { refreshRecent } = useDataset();
  const [state, setState] = useState<PanelState>({ playerId, checking: true });

  useEffect(() => {
    if (!refreshRecent) return undefined;
    let active = true;
    void refreshRecent(playerId, 'auto').then((outcome) => { if (active) setState({ playerId, checking: false, outcome }); });
    return () => { active = false; };
  }, [playerId, refreshRecent]);

  if (!refreshRecent) return null;
  const current = state.playerId === playerId ? state : { playerId, checking: true };
  const manual = () => {
    setState({ playerId, checking: true, outcome: current.outcome });
    void refreshRecent(playerId, 'manual').then((outcome) => setState({ playerId, checking: false, outcome }));
  };
  return <section aria-label="戰績更新" className="surface-card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
    <div aria-live="polite">
      <p className="text-slate-300">{current.checking ? L.checking : current.outcome ? describe(current.outcome) : L.checking}</p>
      {current.outcome?.lastSuccessAt ? <p className="text-xs text-slate-400">最近同步：{formatMinutesAgo(current.outcome.lastSuccessAt)}（近期戰績，非完整生涯）</p> : null}
    </div>
    <button className="button-secondary" disabled={current.checking} onClick={manual} type="button">更新戰績</button>
  </section>;
}
