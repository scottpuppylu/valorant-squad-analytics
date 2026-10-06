import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { PublicApiError } from '../server/errors';
import { DurableEvidenceService } from '../server/persistence/durableEvidenceService';
import { HistoricalSyncService } from '../server/sync/historicalSyncService';
import { PostgresSyncStore } from '../server/sync/postgresSyncStore';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';
import { BulkController, type BulkAccount, type BulkClock, type BulkTransport, type PersistedBulkState, type PublicSyncLike, type SyncCallResult } from '../scripts/bulk/controller';
import { accountsFromDataset, parseArgs, parseState, selectAccounts } from '../scripts/bulk/cli';

// ---------- deterministic virtual time ----------
class FakeClock implements BulkClock {
  t = Date.parse('2026-10-06T00:00:00Z');
  private timers: { at: number; resolve: () => void }[] = [];
  now() { return this.t; }
  wait(ms: number) {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    const timer = { at: this.t + ms, resolve };
    this.timers.push(timer);
    return { promise, cancel: () => { this.timers = this.timers.filter((x) => x !== timer); resolve(); } };
  }
  async drive<T>(work: Promise<T>, onTick?: () => void): Promise<T> {
    let done = false;
    let idle = 0;
    let value!: T;
    work.then((v) => { done = true; value = v; }, () => { done = true; });
    for (;;) {
      await new Promise((r) => setImmediate(r));
      if (done) return value;
      onTick?.();
      if (!this.timers.length) {
        // Real async work (e.g. PGlite) may still be pending; give it real time before declaring a deadlock.
        idle += 1;
        if (idle > 2000) throw new Error('deadlock: controller is waiting with no timer');
        await new Promise((r) => setTimeout(r, 2));
        continue;
      }
      idle = 0;
      const at = Math.min(...this.timers.map((x) => x.at));
      this.t = Math.max(this.t, at);
      const due = this.timers.filter((x) => x.at <= this.t);
      this.timers = this.timers.filter((x) => x.at > this.t);
      for (const timer of due) timer.resolve();
    }
  }
}

const uuid = (n: number, prefix = 'a') => `${prefix.repeat(8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const account = (n: number, member = n): BulkAccount => ({ accountId: uuid(n), memberId: uuid(member, 'b'), memberName: `成員${member}`, riotId: `Fictional${n}#TW`, isPrimary: n === member });

// ---------- simulated server: the same start/continue/status semantics as HistoricalSyncService ----------
interface SimRun { runId: string; status: PublicSyncLike['status']; pages: number; seen: number; persisted: number; providerRequests: number; totalMs: number; nextAttemptAt?: string }
interface SimAccount { cursor: number; total: number; phase: 'live_v4' | 'stored_index'; run?: SimRun; inject: string[]; revoked: boolean }

class SimServer implements BulkTransport {
  readonly accounts = new Map<string, SimAccount>();
  readonly providerAt: number[] = [];
  readonly calls: { route: string; accountId: string; at: number }[] = [];
  private active = new Map<string, number>();
  maxGlobal = 0;
  maxPerAccount = 0;
  runCounter = 0;
  constructor(private readonly clock: FakeClock, readonly latencyMs = 10_600) {}

  add(id: string, total: number, phase: 'live_v4' | 'stored_index' = 'live_v4') { this.accounts.set(id, { cursor: 0, total, phase, inject: [], revoked: false }); }
  private byRun(runId: string) { return [...this.accounts.entries()].find(([, a]) => a.run?.runId === runId); }
  private view(a: SimAccount): PublicSyncLike {
    const r = a.run!;
    return { runId: r.runId, kind: 'deep_backfill', status: r.status,
      history: { historyPhase: r.status === 'complete' ? 'complete' : a.phase, sourceExhausted: r.status === 'complete', lifetimeComplete: false, ...(a.phase === 'stored_index' ? { storedTotal: a.total } : {}) },
      progress: { pages: r.pages, matchesSeen: r.seen, matchesPersisted: r.persisted, overlapsUpdated: 0, retries: 0 },
      coverage: { from: '2026-01-01T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z', completeForProviderWindow: false },
      ...(r.nextAttemptAt ? { nextAttemptAt: r.nextAttemptAt } : {}),
      performance: { providerFetchMs: r.pages * 900, normalizationMs: 0, databaseMs: r.pages * 9000, totalMs: r.totalMs, sqlQueryCount: 0, providerRequests: r.providerRequests } };
  }
  private async enter<T>(id: string, work: () => Promise<T>): Promise<T> {
    const n = (this.active.get(id) ?? 0) + 1;
    this.active.set(id, n);
    this.maxPerAccount = Math.max(this.maxPerAccount, n);
    this.maxGlobal = Math.max(this.maxGlobal, [...this.active.values()].reduce((s, v) => s + v, 0));
    try { return await work(); } finally { this.active.set(id, this.active.get(id)! - 1); }
  }
  private async chunk(a: SimAccount): Promise<SyncCallResult> {
    const injected = a.inject.shift();
    if (injected) {
      const providerSpent = ['PROVIDER_TIMEOUT', 'PROVIDER_ERROR', 'MALFORMED_PROVIDER_RESPONSE', 'RATE_LIMITED'].includes(injected);
      if (providerSpent) this.providerAt.push(this.clock.now());
      await this.clock.wait(500).promise;
      return { ok: false, httpStatus: 500, code: injected };
    }
    const r = a.run!;
    if (r.nextAttemptAt && Date.parse(r.nextAttemptAt) > this.clock.now()) return { ok: false, httpStatus: 429, code: 'SYNC_BACKOFF' };
    const requests = a.phase === 'live_v4' ? 1 : 2;
    for (let i = 0; i < requests; i += 1) this.providerAt.push(this.clock.now());
    await this.clock.wait(this.latencyMs).promise;
    const step = Math.min(a.phase === 'live_v4' ? 3 : 1, a.total - a.cursor);
    a.cursor += step;
    Object.assign(r, { pages: r.pages + 1, seen: r.seen + step, persisted: r.persisted + step, providerRequests: r.providerRequests + requests, totalMs: r.totalMs + this.latencyMs });
    r.status = a.cursor >= a.total ? 'complete' : 'paused';
    return { ok: true, sync: this.view(a) };
  }
  start(id: string): Promise<SyncCallResult> {
    this.calls.push({ route: 'start', accountId: id, at: this.clock.now() });
    return this.enter(id, async () => {
      const a = this.accounts.get(id);
      if (!a) return { ok: false, httpStatus: 404, code: 'SYNC_NOT_FOUND' };
      if (a.revoked) return { ok: false, httpStatus: 409, code: 'CONSENT_REVOKED' };
      if (a.run?.status === 'complete') return { ok: true, sync: this.view(a) };
      if (!a.run) { this.runCounter += 1; a.run = { runId: uuid(this.runCounter, 'c'), status: 'running', pages: 0, seen: 0, persisted: 0, providerRequests: 0, totalMs: 0 }; }
      return this.chunk(a);
    });
  }
  continue(runId: string): Promise<SyncCallResult> {
    const found = this.byRun(runId);
    this.calls.push({ route: 'continue', accountId: found?.[0] ?? '?', at: this.clock.now() });
    if (!found) return Promise.resolve({ ok: false, httpStatus: 404, code: 'SYNC_NOT_FOUND' });
    const [id, a] = found;
    return this.enter(id, async () => {
      if (a.revoked) return { ok: false, httpStatus: 409, code: 'CONSENT_REVOKED' };
      if (a.run!.status === 'complete') return { ok: true, sync: this.view(a) };
      return this.chunk(a);
    });
  }
  async status(runId: string): Promise<SyncCallResult> {
    const found = this.byRun(runId);
    this.calls.push({ route: 'status', accountId: found?.[0] ?? '?', at: this.clock.now() });
    if (!found) return { ok: false, httpStatus: 404, code: 'SYNC_NOT_FOUND' };
    return { ok: true, sync: this.view(found[1]) };
  }
}

function maxInWindow(times: number[], windowMs = 60_000): number {
  let max = 0;
  for (const t of times) max = Math.max(max, times.filter((x) => x > t - windowMs && x <= t).length);
  return max;
}

function setup(n: number, total = 30, lanes = 1, budget = 1000, extra: Record<string, unknown> = {}, restored?: PersistedBulkState) {
  const clock = new FakeClock();
  const server = new SimServer(clock);
  const accounts = Array.from({ length: n }, (_, i) => account(i + 1));
  for (const a of accounts) server.add(a.accountId, total);
  const events: string[] = [];
  const controller = new BulkController(accounts, server, clock, { lanes, maxProviderRequests: budget, ...extra }, restored, (e) => { if (e.type === 'launch') events.push(`${e.route}:${e.accountId}`); });
  return { clock, server, accounts, controller, events };
}

// ---------- CLI parsing / contract gate ----------
describe('bulk-history-v1 CLI contract', () => {
  const base = ['--base-url', 'https://example.test'];
  it('defaults to read-only plan mode and requires explicit selection plus a finite budget to execute', () => {
    expect(parseArgs([...base, '--all'])).toMatchObject({ execute: false, lanes: 2, providerRpm: 8 });
    expect(() => parseArgs([...base, '--execute', '--max-provider-requests', '4'])).toThrow(/requires --all/);
    expect(() => parseArgs([...base, '--all', '--execute'])).toThrow(/max-provider-requests/);
    expect(() => parseArgs([...base, '--all', '--execute', '--max-minutes', '5'])).toThrow(/max-provider-requests/);
    expect(parseArgs([...base, '--all', '--execute', '--max-provider-requests', '4'])).toMatchObject({ execute: true, maxProviderRequests: 4 });
  });
  it('rejects unsafe or unknown options', () => {
    expect(() => parseArgs([...base, '--forever'])).toThrow(/no unbounded/);
    expect(() => parseArgs([...base, '--lanes', '3'])).toThrow(/1 or 2/);
    expect(() => parseArgs([...base, '--provider-rpm', '9'])).toThrow(/cannot exceed 8/);
    expect(() => parseArgs([...base, '--account', 'not-a-uuid'])).toThrow(/public UUID/);
    expect(() => parseArgs(['--base-url', 'http://evil.example', '--all'])).toThrow(/https/);
    expect(() => parseArgs(['--all'])).toThrow(/base-url/);
    expect(() => parseArgs([...base, '--max-provider-requests', '-1'])).toThrow(/positive/);
  });
  const dataset = (patch: Record<string, unknown> = {}, datasetPatch: Record<string, unknown> = {}) => ({ ok: true, schemaVersion: 6, state: 'ready', snapshot: { identityVersion: 'member-identity-v2' },
    dataset: { mode: 'REAL', isDemo: false, players: [
      { id: uuid(1, 'b'), handle: 'h1', displayName: '小麻花', accounts: [{ id: uuid(1), gameName: 'Main', tag: 'TW', isPrimary: true }, { id: uuid(2), gameName: 'Alt', tag: 'TW', isPrimary: false, label: '練習' }] },
      { id: uuid(2, 'b'), handle: 'jack', accounts: [{ id: uuid(3), gameName: 'Jack', tag: 'TW', isPrimary: true }] }], ...datasetPatch }, ...patch });
  it('fails closed unless the REAL schema 6 member-identity-v2 dataset is served', () => {
    const ok = accountsFromDataset(dataset());
    expect(ok.accounts.map((a) => [a.memberName, a.riotId, a.label])).toEqual([['小麻花', 'Main#TW', undefined], ['小麻花', 'Alt#TW', '練習'], ['jack', 'Jack#TW', undefined]]);
    expect(() => accountsFromDataset(dataset({}, { mode: 'DEMO', isDemo: true }))).toThrow(/Demo is rejected/);
    expect(() => accountsFromDataset(dataset({ schemaVersion: 5 }))).toThrow(/schema 6/);
    expect(() => accountsFromDataset(dataset({ snapshot: { identityVersion: 'member-identity-v1' } }))).toThrow(/member-identity-v2/);
    expect(() => accountsFromDataset(dataset({ state: 'unavailable' }))).toThrow();
    expect(() => accountsFromDataset(dataset({}, { players: [] }))).toThrow();
    expect(() => accountsFromDataset({ ok: false })).toThrow();
  });
  it('selects every account of a multi-account member and validates selectors', () => {
    const { accounts } = accountsFromDataset(dataset());
    expect(selectAccounts(accounts, { all: false, members: [uuid(1, 'b')], accounts: [] }).map((a) => a.accountId)).toEqual([uuid(1), uuid(2)]);
    expect(selectAccounts(accounts, { all: false, members: [], accounts: [uuid(3)] })).toHaveLength(1);
    expect(selectAccounts(accounts, { all: true, members: [], accounts: [] })).toHaveLength(3);
    expect(() => selectAccounts(accounts, { all: false, members: [uuid(9, 'b')], accounts: [] })).toThrow(/Unknown public member/);
  });
  it('treats local state as an untrusted optimization (corrupt → rebuilt, extra fields dropped)', () => {
    expect(parseState('{not json', 'https://x.test').warning).toMatch(/corrupt/);
    expect(parseState(JSON.stringify({ version: 'bulk-history-v1', baseUrl: 'https://other.test', accounts: {} }), 'https://x.test').state).toBeUndefined();
    const parsed = parseState(JSON.stringify({ version: 'bulk-history-v1', baseUrl: 'https://x.test', savedAt: 'now', accounts: {
      [uuid(1)]: { runId: uuid(1, 'c'), state: 'ready', puuid: 'secret-puuid', matchId: 'raw' }, 'not-a-uuid': { runId: uuid(2, 'c') }, [uuid(2)]: { runId: 'bad' } } }), 'https://x.test');
    expect(parsed.state?.accounts).toEqual({ [uuid(1)]: { runId: uuid(1, 'c'), state: 'ready' }, [uuid(2)]: {} });
  });
});

// ---------- scheduler ----------
describe('bulk-history-v1 scheduler', () => {
  it('never runs two requests for one account; two lanes run two accounts concurrently', async () => {
    const { clock, server, controller } = setup(3, 30, 2);
    const summary = await clock.drive(controller.run());
    expect(server.maxPerAccount).toBe(1);
    expect(server.maxGlobal).toBe(2);
    expect(summary.stopReason).toBe('all_accounts_terminal');
    expect(summary.matchesSeen).toBe(90);
  });
  it('one lane is strictly serial', async () => {
    const { clock, server, controller } = setup(3, 9, 1);
    await clock.drive(controller.run());
    expect(server.maxGlobal).toBe(1);
  });
  it('round-robins fairly across accounts', async () => {
    const { clock, controller, events } = setup(3, 9, 1);
    await clock.drive(controller.run());
    expect(events.slice(0, 6).map((e) => e.split(':')[1])).toEqual([uuid(1), uuid(2), uuid(3), uuid(1), uuid(2), uuid(3)]);
  });
  it('keeps provider requests ≤ 8 in every rolling minute, even with two lanes', async () => {
    const { clock, server, controller } = setup(4, 60, 2);
    await clock.drive(controller.run());
    expect(maxInWindow(server.providerAt)).toBeLessThanOrEqual(8);
    expect(server.providerAt.length).toBe(4 * 20);
  });
  it('respects a lower provider rpm', async () => {
    const { clock, server, controller } = setup(2, 30, 2, 1000, { providerRpm: 4 });
    await clock.drive(controller.run());
    expect(maxInWindow(server.providerAt)).toBeLessThanOrEqual(4);
  });
  it('reserves 2 for unknown/stored phases, returns unused reservation and never exceeds the session budget', async () => {
    const clock = new FakeClock();
    const server = new SimServer(clock);
    const a = account(1); const b = account(2);
    server.add(a.accountId, 300, 'live_v4'); server.add(b.accountId, 300, 'stored_index');
    const reservations: number[] = [];
    const controller = new BulkController([a, b], server, clock, { lanes: 2, maxProviderRequests: 12 }, undefined, (e) => { if (e.type === 'launch') reservations.push(e.cost!); });
    const summary = await clock.drive(controller.run());
    expect(server.providerAt.length).toBeLessThanOrEqual(12);
    expect(summary.providerRequests).toBe(server.providerAt.length);
    expect(summary.stopReason).toBe('max_provider_requests');
    expect(reservations.slice(0, 2)).toEqual([2, 2]);
    expect(reservations).toContain(1);
    expect(summary.unmeasuredProviderRequests).toBe(0);
  });
  it('stops instead of hanging when the remaining budget is below the next reservation', async () => {
    const { clock, server, controller } = setup(1, 30, 1, 1);
    const summary = await clock.drive(controller.run());
    expect(server.calls).toHaveLength(0);
    expect(summary.stopReason).toBe('max_provider_requests');
  });
  it('enforces --max-minutes and --max-http-requests', async () => {
    const minutes = setup(2, 3000, 1, 10_000, { maxMinutes: 3 });
    const m = await minutes.clock.drive(minutes.controller.run());
    expect(m.stopReason).toBe('max_minutes');
    expect(m.elapsedMs).toBeLessThan(3 * 60_000 + 20_000);
    const http = setup(2, 3000, 1, 10_000, { maxHttpRequests: 5 });
    const h = await http.clock.drive(http.controller.run());
    expect(h.stopReason).toBe('max_http_requests');
    expect(http.server.calls).toHaveLength(5);
  });
  it('LOCK_BUSY marks the account busy, rotates to others and retries later without charging', async () => {
    const { clock, server, controller, accounts } = setup(2, 6, 1);
    server.accounts.get(accounts[0]!.accountId)!.inject.push('LOCK_BUSY');
    const summary = await clock.drive(controller.run());
    expect(server.calls[1]!.accountId).toBe(accounts[1]!.accountId);
    expect(summary.errors.LOCK_BUSY).toBe(1);
    expect(summary.counts.complete).toBe(2);
    expect(summary.providerRequests).toBe(server.providerAt.length);
  });
  it('RATE_LIMITED applies a global cooldown; --stop-on-rate-limit stops the session', async () => {
    const cool = setup(2, 30, 2);
    cool.server.accounts.get(cool.accounts[0]!.accountId)!.inject.push('RATE_LIMITED');
    await cool.clock.drive(cool.controller.run());
    const limited = cool.server.calls.find((c) => c.accountId === cool.accounts[0]!.accountId)!.at;
    const nextProvider = cool.server.calls.filter((c) => c.at > limited + 500 && c.route !== 'status');
    expect(nextProvider[0]!.at - limited).toBeGreaterThanOrEqual(120_000 - 11_000);
    const stop = setup(2, 30, 1, 1000, { stopOnRateLimit: true });
    stop.server.accounts.get(stop.accounts[0]!.accountId)!.inject.push('RATE_LIMITED');
    const s = await stop.clock.drive(stop.controller.run());
    expect(s.stopReason).toBe('rate_limited');
    expect(stop.server.calls).toHaveLength(1);
  });
  it('one PROVIDER_TIMEOUT backs off that account; repeated provider errors stop the session', async () => {
    const once = setup(2, 6, 1);
    once.server.accounts.get(once.accounts[0]!.accountId)!.inject.push('PROVIDER_TIMEOUT');
    const o = await once.clock.drive(once.controller.run());
    expect(o.stopReason).toBe('all_accounts_terminal');
    const twice = setup(2, 30, 1);
    twice.server.accounts.get(twice.accounts[0]!.accountId)!.inject.push('PROVIDER_TIMEOUT');
    twice.server.accounts.get(twice.accounts[1]!.accountId)!.inject.push('PROVIDER_ERROR');
    const t = await twice.clock.drive(twice.controller.run());
    expect(t.stopReason).toBe('repeated_provider_errors');
    expect(twice.server.calls).toHaveLength(2);
  });
  it('DATABASE_ERROR stops the entire session immediately', async () => {
    const { clock, server, controller, accounts } = setup(3, 30, 1);
    server.accounts.get(accounts[1]!.accountId)!.inject.push('DATABASE_ERROR');
    const summary = await clock.drive(controller.run());
    expect(summary.stopReason).toBe('database_error');
    expect(server.calls).toHaveLength(2);
  });
  it('network/unexpected failures stop the session (fail closed)', async () => {
    const { clock, server, controller, accounts } = setup(2, 30, 1);
    server.accounts.get(accounts[0]!.accountId)!.inject.push('UNEXPECTED_RESPONSE');
    const summary = await clock.drive(controller.run());
    expect(summary.stopReason).toBe('unexpected_response');
  });
  it('MALFORMED fails one account only; CONSENT_REVOKED removes one account', async () => {
    const { clock, server, controller, accounts } = setup(3, 6, 1);
    server.accounts.get(accounts[0]!.accountId)!.inject.push('MALFORMED_PROVIDER_RESPONSE');
    server.accounts.get(accounts[1]!.accountId)!.revoked = true;
    const summary = await clock.drive(controller.run());
    expect(summary.counts).toMatchObject({ failed: 1, revoked: 1, complete: 1 });
    expect(server.calls.filter((c) => c.accountId === accounts[1]!.accountId)).toHaveLength(1);
  });
  it('respects server nextAttemptAt: SYNC_BACKOFF → cost-0 status read → wait → continue', async () => {
    const { clock, server, controller, accounts } = setup(1, 9, 1);
    let first = true;
    const original = server.continue.bind(server);
    server.continue = async (runId) => {
      if (first) { first = false; server.accounts.get(accounts[0]!.accountId)!.run!.nextAttemptAt = new Date(clock.now() + 300_000).toISOString(); }
      return original(runId);
    };
    const summary = await clock.drive(controller.run());
    const routes = server.calls.map((c) => c.route);
    expect(routes.slice(0, 3)).toEqual(['start', 'continue', 'status']);
    const resumed = server.calls.find((c, i) => i > 2 && c.route === 'continue')!;
    expect(resumed.at).toBeGreaterThanOrEqual(server.calls[1]!.at + 300_000);
    expect(summary.errors.SYNC_BACKOFF).toBe(1);
    expect(summary.counts.complete).toBe(1);
  });
  it('completed accounts are removed; sourceExhausted is truthful and lifetime is never complete', async () => {
    const { clock, server, controller } = setup(2, 6, 1);
    const summary = await clock.drive(controller.run());
    expect(summary.counts.complete).toBe(2);
    expect(summary.sourceExhausted).toBe(2);
    expect(summary.lifetimeComplete).toBe(false);
    const after = server.calls.length;
    expect(after).toBe(4);
  });
  it('restart recovery: a saved run id is re-verified by a free status read, then measured precisely', async () => {
    const clock = new FakeClock();
    const server = new SimServer(clock);
    const a = account(1);
    server.add(a.accountId, 30);
    const first = new BulkController([a], server, clock, { maxProviderRequests: 3 });
    await clock.drive(first.run());
    const saved = first.snapshot('https://x.test');
    const before = server.accounts.get(a.accountId)!.cursor;
    const second = new BulkController([a], server, clock, { maxProviderRequests: 3 }, saved);
    const summary = await clock.drive(second.run());
    expect(server.calls.slice(3).map((c) => c.route)).toEqual(['status', 'continue', 'continue', 'continue']);
    expect(summary.unmeasuredProviderRequests).toBe(0);
    expect(summary.matchesSeen).toBe(server.accounts.get(a.accountId)!.cursor - before);
    // A restored run id that the server no longer knows is dropped and the account is started again.
    const ghost = new BulkController([account(2)], server, clock, { maxProviderRequests: 2 },
      { version: 'bulk-history-v1', baseUrl: 'https://x.test', savedAt: '', accounts: { [uuid(2)]: { runId: uuid(99, 'c') } } });
    server.add(uuid(2), 3);
    const g = await clock.drive(ghost.run());
    expect(g.counts.complete).toBe(1);
  });
  it('a start that resumes an existing run is conservatively charged at its reservation', async () => {
    const clock = new FakeClock();
    const server = new SimServer(clock);
    const a = account(1);
    server.add(a.accountId, 300);
    await clock.drive(new BulkController([a], server, clock, { maxProviderRequests: 2 }).run());
    const fresh = new BulkController([a], server, clock, { maxProviderRequests: 4 });
    const summary = await clock.drive(fresh.run());
    expect(summary.unmeasuredProviderRequests).toBe(2);
    expect(summary.providerRequests).toBeGreaterThanOrEqual(server.providerAt.length - 1);
  });
  it('SIGINT-style stop: no new launches, in-flight work finishes, state is saved with public ids only', async () => {
    const { clock, server, controller } = setup(3, 300, 2);
    let stopped = false;
    const summary = await clock.drive(controller.run(), () => { if (!stopped && server.calls.length >= 3) { stopped = true; controller.stop('interrupted'); } });
    expect(summary.stopReason).toBe('interrupted');
    const callsAtStop = server.calls.length;
    expect(callsAtStop).toBeLessThanOrEqual(4);
    const state = JSON.stringify(controller.snapshot('https://x.test'));
    expect(state).not.toMatch(/puuid|hmac|match_id|DATABASE|HENRIK|CRON|secret|token/iu);
  });
});

// ---------- scale ----------
describe('bulk-history-v1 scale simulation', () => {
  it('15 accounts × 500 matches: deterministic, fair, budgeted, small state', async () => {
    const run = async () => {
      const { clock, server, controller, events } = setup(15, 500, 2, 100_000);
      const cpu = performance.now();
      const summary = await clock.drive(controller.run());
      return { summary, server, events, cpuMs: performance.now() - cpu, state: JSON.stringify(controller.snapshot('https://valorant.test')) };
    };
    const a = await run();
    const b = await run();
    expect(a.summary.matchesSeen).toBe(7500);
    expect(a.summary.counts.complete).toBe(15);
    expect(a.server.maxPerAccount).toBe(1);
    expect(maxInWindow(a.server.providerAt)).toBeLessThanOrEqual(8);
    expect(a.events).toEqual(b.events);
    // Fairness: no account gets more than one extra turn before every other account has had one.
    const firstRound = a.events.slice(0, 15).map((e) => e.split(':')[1]);
    expect(new Set(firstRound).size).toBe(15);
    expect(a.cpuMs).toBeLessThan(20_000);
    expect(a.state.length).toBeLessThan(10_000);
    const virtualMinutes = a.summary.elapsedMs / 60_000;
    expect(a.summary.providerRequests / virtualMinutes).toBeLessThanOrEqual(8.01);
  }, 60_000);
});

// ---------- boundaries ----------
describe('bulk-history-v1 boundaries', () => {
  const read = (p: string) => readFileSync(p, 'utf8');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  it('is never imported by src/, api/, server/ or shared/', () => {
    for (const dir of ['src', 'api', 'server', 'shared']) for (const file of walk(dir)) expect(read(file)).not.toMatch(/scripts\/bulk|bulk-history/u);
  });
  it('contains no secret, provider SDK, database or direct provider call', () => {
    for (const file of ['scripts/bulk-history.ts', 'scripts/bulk/controller.ts', 'scripts/bulk/cli.ts']) {
      const source = read(file);
      expect(source).not.toMatch(/HENRIK_API_KEY|DATABASE_URL|CRON_SECRET|IDENTIFIER_HMAC_KEY|HenrikDataProvider|fetchHistoryPage|fetchStoredIndexPage|fetchMatchDetail|neon|pglite|from ['"]pg['"]|server\/|api\.henrikdev/iu);
      expect(source).not.toMatch(/\/api\/(admin|bulk|history)/u);
    }
  });
  it('the local state directory is gitignored', () => {
    expect(read('.gitignore')).toMatch(/^\.local\/$/mu);
  });
});

// ---------- end-to-end CLI against a local fake origin ----------
async function runCli(args: string[], dataset: unknown, cwd: string): Promise<{ code: number | null; out: string; posts: string[] }> {
  const posts: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && req.url === '/api/valorant/dataset') { res.end(JSON.stringify(dataset)); return; }
      if (req.method === 'POST') {
        posts.push(`${req.url} ${body}`);
        res.end(JSON.stringify({ ok: true, sync: { runId: uuid(1, 'c'), kind: 'deep_backfill', status: 'complete',
          history: { historyPhase: 'complete', sourceExhausted: true, lifetimeComplete: false },
          progress: { pages: 1, matchesSeen: 3, matchesPersisted: 3, overlapsUpdated: 0, retries: 0 }, coverage: { completeForProviderWindow: false },
          performance: { providerFetchMs: 1, normalizationMs: 0, databaseMs: 1, totalMs: 2, sqlQueryCount: 1, providerRequests: 1 } } }));
        return;
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const child = spawn(process.execPath, [join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'), join(process.cwd(), 'scripts/bulk-history.ts'), '--base-url', `http://127.0.0.1:${port}`, '--state', join(cwd, 'state.json'), ...args], { cwd });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  const code = await new Promise<number | null>((r) => child.on('close', r));
  server.close();
  return { code, out, posts };
}

describe('bulk-history-v1 CLI end-to-end (local fake origin)', () => {
  const real = { ok: true, schemaVersion: 6, state: 'ready', snapshot: { identityVersion: 'member-identity-v2' },
    dataset: { mode: 'REAL', isDemo: false, players: [{ id: uuid(1, 'b'), handle: 'x', displayName: '小麻花', accounts: [{ id: uuid(1), gameName: 'Fictional', tag: 'TW', isPrimary: true }] }] } };
  it('plan mode sends 0 POST requests', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bulk-'));
    const result = await runCli(['--all'], real, dir);
    expect(result.code).toBe(0);
    expect(result.posts).toEqual([]);
    expect(result.out).toMatch(/PLAN ONLY: 0 POST requests/u);
    expect(result.out).toMatch(/小麻花 \/ Fictional#TW/u);
  }, 60_000);
  it('a Demo dataset fails closed before any POST, even with --execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bulk-'));
    const result = await runCli(['--all', '--execute', '--max-provider-requests', '2'], { ...real, dataset: { ...real.dataset, mode: 'DEMO', isDemo: true } }, dir);
    expect(result.code).toBe(3);
    expect(result.posts).toEqual([]);
  }, 60_000);
  it('execute uses only the public start route with an account id and writes a privacy-clean state file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bulk-'));
    writeFileSync(join(dir, 'state.json'), '{corrupt');
    const result = await runCli(['--account', uuid(1), '--execute', '--max-provider-requests', '2', '--json'], real, dir);
    expect(result.code).toBe(0);
    expect(result.posts).toEqual([`/api/valorant/sync/start {"accountId":"${uuid(1)}","kind":"deep_backfill"}`]);
    expect(result.out).toMatch(/corrupt and is ignored/u);
    const state = readFileSync(join(dir, 'state.json'), 'utf8');
    expect(JSON.parse(state)).toMatchObject({ version: 'bulk-history-v1', accounts: { [uuid(1)]: { runId: uuid(1, 'c'), state: 'complete' } } });
    expect(state).not.toMatch(/puuid|hmac|match|secret|token|Fictional/iu);
  }, 60_000);
});

// ---------- real engine (PGlite): the controller drives the existing deep_backfill service ----------
class PGliteDatabase implements SqlDatabase {
  constructor(private readonly database: PGlite) {}
  async query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
    const value = await this.database.query<Row>(sql, params);
    return { rows: value.rows, rowCount: value.affectedRows ?? value.rows.length };
  }
  async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    await this.database.exec('BEGIN');
    try { const value = await work(this); await this.database.exec('COMMIT'); return value; } catch (error) { await this.database.exec('ROLLBACK'); throw error; }
  }
  async close(): Promise<void> { await this.database.close(); }
}

function sharedMatch(index: number) {
  const player = (puuid: string, name: string) => ({ puuid, name, tag: 'TW', team_id: 'Blue', agent: { id: 'agent-id', name: 'Sova' },
    stats: { kills: 0, deaths: 0, assists: 0, score: 0, headshots: 0, bodyshots: 0, legshots: 0, damage: { dealt: 0, received: 0 } } });
  return {
    metadata: { match_id: `fictional-shared-match-${index}`, started_at: new Date(Date.UTC(2026, 8, 30 - index, 12)).toISOString(), game_length_in_ms: 120_000,
      map: { id: 'map-id', name: 'Ascent' }, queue: { id: 'competitive', name: 'Competitive' } },
    players: [player('fictional-bulk-one', 'BulkOne'), player('fictional-bulk-two', 'BulkTwo')],
    teams: [{ team_id: 'Blue', won: true, rounds: { won: 1, lost: 0 } }],
    rounds: [{ id: 1, winning_team: 'Blue', result: 'Eliminated', plant: null,
      stats: ['fictional-bulk-one', 'fictional-bulk-two'].map((puuid) => ({ player: { puuid }, stats: { kills: 0, score: 0 }, economy: { loadout_value: 0, remaining: 800 } })) }],
    kills: [],
  };
}

describe('bulk-history-v1 over the real deep_backfill engine', () => {
  it('two accounts sharing matches: server dedupe keeps one source match per match, cursors stay per account', async () => {
    const database = new PGliteDatabase(new PGlite());
    try {
      await applyMigrations(database, await loadMigrations('migrations'));
      const hmacKey = 'test-bulk-hmac-key-with-at-least-32-bytes';
      const durable = new DurableEvidenceService(database, hmacKey);
      const store = new PostgresSyncStore(database);
      const ids: string[] = [];
      for (const [gameName, puuid] of [['BulkOne', 'fictional-bulk-one'], ['BulkTwo', 'fictional-bulk-two']] as const) {
        const connected = await durable.persistConnection({ gameName, tag: 'TW', affinity: 'ap', consent: true, privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION }, puuid, '2026-09-30T00:00:00.000Z');
        ids.push(connected.publicPlayerId!);
      }
      let providerCalls = 0;
      const pages = new Map([[0, [0, 1, 2]], [3, [3, 4, 5]]]);
      const provider = {
        fetchHistoryPage: async (_input: unknown, start: number) => { providerCalls += 1; return { status: 200, data: (pages.get(start) ?? []).map(sharedMatch) }; },
        fetchStoredIndexPage: async () => { providerCalls += 1; return { data: [] }; },
        fetchMatchDetail: async () => { throw new Error('not used'); },
      };
      const clock = new FakeClock();
      const service = new HistoricalSyncService(store, durable, provider as never, hmacKey, { now: () => new Date(clock.now()) });
      const wrap = async (work: () => Promise<unknown>): Promise<SyncCallResult> => {
        try { return { ok: true, sync: await work() as PublicSyncLike }; } catch (error) {
          if (error instanceof PublicApiError) return { ok: false, httpStatus: error.status, code: error.code };
          throw error;
        }
      };
      const transport: BulkTransport = {
        start: (id) => wrap(() => service.start(id, 'deep_backfill')),
        continue: (runId) => wrap(() => service.continue(runId)),
        status: (runId) => wrap(() => service.status(runId)),
      };
      const accounts = ids.map((id, i) => ({ ...account(i + 1), accountId: id }));
      const controller = new BulkController(accounts, transport, clock, { lanes: 2, maxProviderRequests: 30, maxMinutes: 30 });
      const summary = await clock.drive(controller.run());
      expect(['all_accounts_terminal', 'max_minutes', 'max_provider_requests']).toContain(summary.stopReason);
      expect(summary.providerRequests).toBeGreaterThanOrEqual(providerCalls);
      const count = async (sql: string) => Number((await database.query<{ n: string }>(sql)).rows[0]!.n);
      expect(await count('SELECT count(*)::text AS n FROM source_matches')).toBe(6);
      expect(await count('SELECT count(DISTINCT provider_match_lookup_hmac)::text AS n FROM source_matches')).toBe(6);
      expect(await count("SELECT count(*)::text AS n FROM sync_cursors WHERE sync_kind = 'deep_backfill'")).toBe(2);
      expect(await count('SELECT count(*)::text AS n FROM sync_cursors WHERE lease_token IS NOT NULL')).toBe(0);
      expect(await count('SELECT count(*)::text AS n FROM match_participants WHERE player_id IS NOT NULL')).toBe(12);
      expect(summary.matchesSeen).toBe(12);
    } finally { await database.close(); }
  }, 60_000);
});
