import { useEffect, useMemo, useState } from 'react';
import type { WeaponAnalyticsResult } from '../analytics/weapons/engine';
import { localWeaponAnalytics, type WeaponQuery } from '../analytics/weapons/local';
import { isWeaponAnalyticsResponse } from '../dataSources/server/weaponContract';
import { useDataset } from './useDataset';

export type WeaponAnalyticsStatus = 'local' | 'loading' | 'ready' | 'error' | 'unavailable';

/**
 * TASK-WEAPON-01: REAL = server aggregate over all eligible durable history (re-keyed by snapshot
 * version, so new durable matches refetch); Demo = local fictional facts. A failed REAL request is an
 * explicit error — never a fallback to a snapshot, another scope or Demo data.
 */
export function useWeaponAnalytics(query: WeaponQuery): { status: WeaponAnalyticsStatus; result?: WeaponAnalyticsResult } {
  const { dataset, analytics: { performanceEntries, population }, loadWeaponAnalytics, snapshot } = useDataset();
  const key = JSON.stringify([query, snapshot?.version ?? null]);
  // Fictional local facts exist ONLY for Demo; REAL data never gets locally fabricated weapon evidence.
  const local = useMemo(() => (loadWeaponAnalytics || !dataset.isDemo ? undefined : localWeaponAnalytics(dataset, performanceEntries, population, query)),
    // `query` is fully described by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataset, key, loadWeaponAnalytics, performanceEntries, population]);
  const [settled, setSettled] = useState<{ key: string; result?: WeaponAnalyticsResult; failed?: boolean } | undefined>();
  useEffect(() => {
    if (!loadWeaponAnalytics) return undefined;
    let active = true;
    loadWeaponAnalytics(query).then((response) => {
      if (!active) return;
      if (!isWeaponAnalyticsResponse(response)) throw new Error('Unsupported weapon analytics response.');
      setSettled({ key, result: response });
    }).catch(() => { if (active) setSettled({ key, failed: true }); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loadWeaponAnalytics]);
  if (local) return { status: 'local', result: local };
  if (!loadWeaponAnalytics) return { status: 'unavailable' };
  if (settled?.key === key) return settled.result ? { status: 'ready', result: settled.result } : { status: 'error' };
  return { status: 'loading' };
}
