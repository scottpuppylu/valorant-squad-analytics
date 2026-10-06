// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { AvatarProvider } from '../src/contexts/AvatarProvider';
import { DatasetProvider } from '../src/contexts/DatasetProvider';
import { demoDataSource } from '../src/dataSources/demo/DemoDataSource';
import type { DatasetApiClient } from '../src/dataSources/server/DatasetApiClient';
import type { DatasetReadyResponse } from '../src/dataSources/server/contracts';
import { isWeaponAnalyticsResponse, type WeaponAnalyticsResponse } from '../src/dataSources/server/weaponContract';
import { buildAnalytics } from '../src/data/analytics';
import { aggregateWeaponFacts, buildWeaponAnalytics } from '../src/analytics/weapons/engine';
import { demoWeaponFacts, localWeaponAnalytics, type WeaponQuery } from '../src/analytics/weapons/local';
import { useDataset } from '../src/hooks/useDataset';
import { useWeaponAnalytics } from '../src/hooks/useWeaponAnalytics';
import type { NormalizedAnalyticsDataset } from '../src/dataSources/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const demo = demoDataSource.snapshot();
const NOVA_MAIN = '00000000-0000-4000-8000-00000000d001';
const NOVA_ALT = '00000000-0000-4000-8000-00000000da01';

describe('weapon-analytics-v2 Demo engine', () => {
  it('aggregates the fictional two-account member from BOTH accounts (union, not average)', () => {
    const analytics = buildAnalytics(demo);
    const query: WeaponQuery = { player: 'nova-hex', scope: 'all', map: 'all', agent: 'all', mode: 'all' };
    const member = localWeaponAnalytics(demo, analytics.performanceEntries, analytics.population, query).member!;
    expect(member.accounts.map((a) => a.accountId).sort()).toEqual([NOVA_MAIN, NOVA_ALT].sort());
    // weapon-analytics-v2: only Competitive facts contribute (same policy as the server).
    const competitiveIds = new Set(demo.matches.filter((match) => match.gameMode === 'Competitive').map((match) => match.id));
    const facts = demoWeaponFacts(demo).filter((fact) => fact.memberId === 'nova-hex' && competitiveIds.has(fact.matchId));
    const perAccount = (accountId: string) => buildWeaponAnalytics(aggregateWeaponFacts(facts.filter((fact) => fact.accountId === accountId)), { memberIds: ['nova-hex'], memberId: 'nova-hex', scope: { mode: 'all', status: 'available', reasons: [], context: { map: 'all', agent: 'all', mode: 'all' } } }).member!;
    const main = perAccount(NOVA_MAIN); const alt = perAccount(NOVA_ALT);
    const op = (m: typeof member) => m.weapons.find((w) => w.weaponKey === 'operator');
    expect(op(member)!.observedWeaponRounds).toBe((op(main)?.observedWeaponRounds ?? 0) + (op(alt)?.observedWeaponRounds ?? 0));
    expect(member.playedRounds).toBe(main.playedRounds + alt.playedRounds);
    expect(op(alt)!.observedWeaponRoundShare!).toBeGreaterThan(op(main)?.observedWeaponRoundShare ?? 0);
    expect(op(member)!.observedWeaponRoundShare).not.toBeCloseTo(((op(main)?.observedWeaponRoundShare ?? 0) + op(alt)!.observedWeaponRoundShare!) / 2, 6);
    expect(member.weapons.some((w) => w.category === 'Other' && !w.isFirearm)).toBe(true);
    expect(member.coverage.roundWeapon.status).toBe('available');
    expect(member.coverage.killWeapon.coverage).toBeLessThan(1);
    expect(JSON.stringify(member)).not.toMatch(/NaN|Infinity/u);
  });
});

describe('Weapons page and Profile weapon card', () => {
  let root: Root; let container: HTMLDivElement;
  beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); localStorage.clear(); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  const settle = async (predicate: () => boolean) => { for (let i = 0; i < 600 && !predicate(); i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
  /** HashRouter does not observe programmatic hash changes in happy-dom: re-mount on the new route. */
  const remount = async (hash: string, client: DatasetApiClient, forceDemo: boolean) => {
    await act(async () => root.unmount());
    root = createRoot(container);
    window.location.hash = hash;
    await render(client, forceDemo);
  };
  const render = async (client: DatasetApiClient, forceDemo: boolean) => {
    await act(async () => { root.render(<DatasetProvider client={client} forceDemo={forceDemo}><AvatarProvider><App /></AvatarProvider></DatasetProvider>); });
  };

  it('Demo: renders the weapon page, merged accounts, breakdowns and the explanation with zero API calls', async () => {
    const calls: string[] = [];
    window.location.hash = '#/weapons?player=nova-hex&mode=all';
    await render({ load: async () => { calls.push('load'); throw new Error('no api'); }, loadWeaponAnalytics: async () => { calls.push('weapon'); throw new Error('no api'); } }, true);
    await settle(() => container.querySelector('[aria-label="武器統計"]') !== null);
    expect(container.textContent).toContain('武器分析');
    expect(container.textContent).toContain('最常使用');
    expect(container.textContent).toContain('Operator');
    expect(container.textContent).toContain('NovaMain#DEMO');
    expect(container.textContent).toContain('NovaAlt#ALT');
    expect(container.querySelector('[aria-label="地圖分布"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="特務分布"]')).not.toBeNull();
    expect(container.textContent).toContain('數據怎麼算？');
    expect(container.textContent).toContain('不提供每把槍的 HS%');
    expect(container.textContent).not.toMatch(/NaN|Infinity|完整生涯武器/u);
    expect(calls).toEqual([]);
    await remount('#/players/nova-hex', { load: async () => { calls.push('load'); throw new Error('no api'); } }, true);
    await settle(() => container.querySelector('[aria-label="武器"]')?.textContent?.includes('最常使用') ?? false);
    expect(container.querySelector('[aria-label="武器"]')!.textContent).toContain('查看完整武器分析');
    expect(calls).toEqual([]);
  });

  function realDemo(): NormalizedAnalyticsDataset {
    const copy = structuredClone(demo);
    for (const match of copy.matches) for (const p of match.performances) p.eventEvidence = { kast: 'reconstructed', opening: 'reconstructed' };
    return { ...copy, mode: 'REAL', isDemo: false, sourceId: 'durable-neon-v4' };
  }
  const snapshot = (dataset: NormalizedAnalyticsDataset, version: string): DatasetReadyResponse => ({ ok: true, schemaVersion: 6, state: 'ready',
    snapshot: { version, generation: 'dataset-read-v4', source: 'durable-neon', projectionVersion: 'evidence-decoupled-projection-v1', identityVersion: 'member-identity-v2' },
    coverage: { completeForProviderWindow: false, boundedMatchLimit: 300, lifetimeComplete: false },
    evidence: { acs: 'derived', adr: 'derived', headshotPercentage: 'derived', kast: 'reconstructed', firstKills: 'reconstructed', firstDeaths: 'reconstructed' }, dataset });
  const serverAnswer = (query: WeaponQuery): WeaponAnalyticsResponse => {
    const analytics = buildAnalytics(demo);
    return { ok: true, schemaVersion: 6, view: 'analysis', feature: 'weaponAnalytics', ...localWeaponAnalytics(demo, analytics.performanceEntries, analytics.population, query) };
  };

  it('REAL: uses only the server weapon feature for the Profile card and the Weapons page', async () => {
    const dataset = realDemo();
    const queries: WeaponQuery[] = [];
    const client: DatasetApiClient = {
      load: async () => snapshot(dataset, 'v1'),
      loadWeaponAnalytics: async (query) => { queries.push(query); return serverAnswer(query); },
    };
    window.location.hash = '#/players/echo-vale';
    await render(client, false);
    await settle(() => container.querySelector('[aria-label="武器"]')?.textContent?.includes('最常使用') ?? false);
    expect(queries).toContainEqual({ player: 'echo-vale', scope: 'all', map: 'all', agent: 'all', mode: 'Competitive' });
    await remount('#/weapons?player=echo-vale&scope=current', client, false);
    await settle(() => queries.some((q) => q.scope === 'current'));
    await settle(() => container.querySelector('[aria-label="武器統計"]') !== null);
    expect(container.textContent).toContain('沿用「目前實力」自適應區間');
  });

  it('REAL: a snapshot reload (as after FASTSYNC) clears the weapon cache and refetches; failure is explicit', async () => {
    const dataset = realDemo();
    const queries: WeaponQuery[] = [];
    let version = 'v1';
    let fail = false;
    const client: DatasetApiClient = {
      load: async () => snapshot(dataset, version),
      loadWeaponAnalytics: async (query) => { queries.push(query); if (fail) throw new Error('down'); return serverAnswer(query); },
    };
    let refresh: (() => Promise<void>) | undefined;
    function Probe() {
      const context = useDataset();
      refresh = context.refresh;
      const { status, result } = useWeaponAnalytics({ player: 'echo-vale', scope: 'all', map: 'all', agent: 'all', mode: 'Competitive' });
      return <p data-testid="probe">{status}:{result?.member?.playedRounds ?? '-'}</p>;
    }
    await act(async () => { root.render(<DatasetProvider client={client} forceDemo={false}><Probe /></DatasetProvider>); });
    const probe = () => container.querySelector('[data-testid="probe"]')?.textContent ?? '';
    await settle(() => probe().startsWith('ready'));
    expect(queries).toHaveLength(1);
    version = 'v2';
    fail = true;
    await act(async () => { await refresh!(); });
    await settle(() => probe().startsWith('error'));
    expect(queries).toHaveLength(2);
    expect(probe()).toBe('error:-');
  });

  it('REAL without a weapon loader never fabricates local weapon data', async () => {
    window.location.hash = '#/weapons?player=echo-vale';
    await render({ load: async () => snapshot(realDemo(), 'v1') }, false);
    await settle(() => container.textContent?.includes('武器分析暫時無法取得') ?? false);
    expect(container.querySelector('[aria-label="武器統計"]')).toBeNull();
  });
});

describe('weapon contract validator', () => {
  const valid = () => { const analytics = buildAnalytics(demo); return { ok: true, schemaVersion: 6, view: 'analysis', feature: 'weaponAnalytics', ...localWeaponAnalytics(demo, analytics.performanceEntries, analytics.population, { player: 'nova-hex', scope: 'all', map: 'all', agent: 'all', mode: 'all' }) }; };
  it('accepts weapon-analytics-v1 and rejects unsupported per-weapon metrics, lifetime claims and other versions', () => {
    expect(isWeaponAnalyticsResponse(valid())).toBe(true);
    const withHs = valid(); (withHs.member!.weapons[0] as unknown as Record<string, unknown>).weaponHeadshotPercentage = 0.3;
    expect(isWeaponAnalyticsResponse(withHs)).toBe(false);
    const lifetime = valid(); (lifetime.member!.coverage as unknown as Record<string, unknown>).lifetimeComplete = true;
    expect(isWeaponAnalyticsResponse(lifetime)).toBe(false);
    expect(isWeaponAnalyticsResponse({ ...valid(), weaponAnalyticsVersion: 'weapon-analytics-v0' })).toBe(false);
    expect(isWeaponAnalyticsResponse({ ...valid(), schemaVersion: 5 })).toBe(false);
  });
});
