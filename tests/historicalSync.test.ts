import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, loadMigrations } from '../server/db/migrations';
import type { SqlDatabase, SqlExecutor, SqlResult } from '../server/db/types';
import { PublicApiError } from '../server/errors';
import type { HistoricalMatchProvider } from '../server/henrikDataProvider';
import { DurableEvidenceService } from '../server/persistence/durableEvidenceService';
import { HistoricalSyncService } from '../server/sync/historicalSyncService';
import { PostgresSyncStore } from '../server/sync/postgresSyncStore';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';
import type { HistoricalDiscoveryProvider } from '../server/sync/historicalDiscoveryProvider';
import { ScheduledSyncService } from '../server/sync/scheduledSyncService';

const hmacKey = 'test-sync-hmac-key-with-at-least-32-bytes';
const connection = {
  gameName: 'SyncGoblin', tag: 'TW', affinity: 'ap', consent: true,
  privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION,
} as const;

class PGliteDatabase implements SqlDatabase {
  constructor(private readonly database: PGlite) {}
  async query<Row extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<Row>> {
    const value = await this.database.query<Row>(sql, params);
    return { rows: value.rows, rowCount: value.affectedRows ?? value.rows.length };
  }
  async transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    await this.database.exec('BEGIN');
    try {
      const value = await work(this);
      await this.database.exec('COMMIT');
      return value;
    } catch (error) {
      await this.database.exec('ROLLBACK');
      throw error;
    }
  }
  async close(): Promise<void> { await this.database.close(); }
}

class FixtureProvider implements HistoricalMatchProvider {
  calls = 0;
  failure?: PublicApiError;
  constructor(private readonly pages: Map<number, unknown>) {}
  async fetchHistoryPage(_input: unknown, start: number): Promise<unknown> {
    this.calls += 1;
    if (this.failure) throw this.failure;
    return this.pages.get(start) ?? { status: 200, data: [] };
  }
}

function match(index: number, id = `fictional-history-match-${index}`) {
  return {
    metadata: {
      match_id: id,
      started_at: new Date(Date.UTC(2026, 8, 30 - index, 12)).toISOString(),
      game_length_in_ms: 120_000,
      map: { id: 'map-id', name: 'Ascent' },
      queue: { id: 'competitive', name: 'Competitive' },
    },
    players: [{
      puuid: 'fictional-consenting-participant', name: String(connection.gameName), tag: connection.tag,
      team_id: 'Blue', agent: { id: 'agent-id', name: 'Sova' },
      stats: { kills: 0, deaths: 0, assists: 0, score: 0, headshots: 0, bodyshots: 0, legshots: 0, damage: { dealt: 0, received: 0 } },
    }],
    teams: [{ team_id: 'Blue', won: true, rounds: { won: 1, lost: 0 } }],
    rounds: [{
      id: 1, winning_team: 'Blue', result: 'Eliminated', plant: null,
      stats: [{ player: { puuid: 'fictional-consenting-participant' }, stats: { kills: 0, score: 0 }, economy: { loadout_value: 0, remaining: 800 } }],
    }],
    kills: [],
  };
}

const page = (...matches: ReturnType<typeof match>[]) => ({ status: 200, data: matches });

class DeepFixtureProvider extends FixtureProvider implements HistoricalDiscoveryProvider {
  storedCalls = 0;
  detailCalls = 0;
  detailFailure?: PublicApiError;
  constructor(pages: Map<number, unknown>, readonly storedPages = new Map<number, number[]>()) { super(pages); }
  async fetchStoredIndexPage(_input: unknown, number: number) {
    this.storedCalls += 1;
    const entries = this.storedPages.get(number) ?? [];
    return { data: entries.map((index) => ({ meta: { id: match(index).metadata.match_id } })) };
  }
  async fetchMatchDetail(_input: unknown, id: string) {
    this.detailCalls += 1;
    if (this.detailFailure) throw this.detailFailure;
    return { status: 200, data: match(Number(id.split('-').at(-1))) };
  }
}

async function count(database: SqlDatabase, table: string): Promise<number> {
  const result = await database.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
  return Number(result.rows[0]?.count ?? 0);
}

describe('bounded historical synchronization', () => {
  let database: PGliteDatabase;
  let durable: DurableEvidenceService;
  let store: PostgresSyncStore;
  let publicPlayerId: string;

  beforeEach(async () => {
    database = new PGliteDatabase(new PGlite());
    await applyMigrations(database, await loadMigrations('migrations'));
    durable = new DurableEvidenceService(database, hmacKey);
    store = new PostgresSyncStore(database);
    const connected = await durable.persistConnection(connection, 'fictional-consenting-participant', '2026-09-30T00:00:00.000Z');
    publicPlayerId = connected.publicPlayerId!;
  });

  afterEach(async () => { await database.close(); });

  it('deep cursor budget exhaustion makes no provider call and does not advance', async () => {
    const provider = new DeepFixtureProvider(new Map());
    let clock = 0;
    const service = new HistoricalSyncService(store, durable, provider, hmacKey, { usefulWorkBudgetMs: 25, monotonicNow: () => { clock += 30; return clock; } });
    await expect(service.start(publicPlayerId, 'deep_backfill')).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    expect(provider.calls).toBe(0);
    expect((await database.query('SELECT next_start,history_rule_version FROM sync_cursors')).rows[0]).toEqual({ next_start: 0, history_rule_version: 'deep-history-v1' });
  });

  it('scheduled due selection excludes recent, revoked, obsolete, inactive and anonymized players', async () => {
    let at = new Date('2026-10-05T00:00:00Z');
    const provider = new FixtureProvider(new Map([[0, page(match(0))]]));
    const service = new HistoricalSyncService(store, durable, provider, hmacKey, { now: () => at });
    expect(await store.duePlayers('recent', at.toISOString())).toHaveLength(1);
    await service.start(publicPlayerId, 'incremental', 'scheduled');
    expect((await database.query('SELECT trigger_kind FROM sync_runs')).rows[0]).toEqual({ trigger_kind: 'scheduled' });
    expect(await store.duePlayers('recent', at.toISOString())).toHaveLength(0);
    at = new Date(at.getTime() + 21 * 3600_000);
    expect(await store.duePlayers('recent', at.toISOString())).toHaveLength(1);
    await database.query("UPDATE consents SET privacy_version='obsolete'");
    expect(await store.duePlayers('recent', at.toISOString())).toHaveLength(0);
    await database.query('UPDATE consents SET privacy_version=$1', [PUBLIC_DATASET_PRIVACY_VERSION]);
    await database.query("UPDATE squad_memberships SET status='inactive'");
    expect(await store.duePlayers('recent', at.toISOString())).toHaveLength(0);
    await expect(service.start(publicPlayerId,'incremental','scheduled')).rejects.toMatchObject({code:'SYNC_NOT_FOUND'});
    await database.query("UPDATE squad_memberships SET status='active'");
    await database.query('UPDATE players SET anonymized_at=now()');
    expect(await store.duePlayers('recent', at.toISOString())).toHaveLength(0);
    expect(provider.calls).toBe(1);
  });

  it('two due consenting players persist serial scheduled observations idempotently', async () => {
    const other = { ...connection,gameName:'SecondSyncGoblin' };
    await durable.persistConnection(other,'fictional-second-participant','2026-09-30T00:00:00Z');
    let active=0;
    const provider = { fetchHistoryPage:vi.fn(async(input:{gameName:string})=>{
      active+=1;expect(active).toBe(1);
      const value=match(input.gameName===connection.gameName?0:1);
      if(input.gameName===other.gameName){
        value.players[0]={...value.players[0]!,name:other.gameName,puuid:'fictional-second-participant'};
        value.rounds[0]!.stats[0]!.player.puuid='fictional-second-participant';
      }
      await Promise.resolve();active-=1;return page(value);
    }) };
    const at=new Date('2026-10-05T00:00:00Z');
    const runner=new HistoricalSyncService(store,durable,provider,hmacKey,{now:()=>at});
    const scheduler=new ScheduledSyncService({duePlayers:store.duePlayers.bind(store),withScheduledLock:async(work)=>work()},runner,()=>0,()=>at,async()=>{});
    expect(await scheduler.run('recent')).toMatchObject({processed:2,partial:false});
    expect(await count(database,'source_matches')).toBe(2);
    expect((await database.query('SELECT DISTINCT trigger_kind FROM sync_runs')).rows).toEqual([{trigger_kind:'scheduled'}]);
    expect(await scheduler.run('recent')).toMatchObject({processed:0});
    expect(provider.fetchHistoryPage).toHaveBeenCalledTimes(2);
  });

  it('repeated live offset persists 5/30-minute backoff then recovers a different page', async () => {
    const pages = new Map([[0, page(match(0),match(1),match(2))], [3, page(match(0),match(1),match(2))]]);
    const provider = new DeepFixtureProvider(pages);
    let at = new Date('2026-10-05T00:00:00Z');
    const service = new HistoricalSyncService(store, durable, provider, hmacKey, { now: () => at });
    const first = await service.start(publicPlayerId, 'deep_backfill');
    const repeat = await service.continue(first.runId);
    expect(repeat.nextAttemptAt).toBe('2026-10-05T00:05:00.000Z');
    expect((await database.query('SELECT next_start FROM sync_cursors')).rows[0]?.next_start).toBe(3);
    expect(await count(database,'source_matches')).toBe(3);
    await expect(service.continue(first.runId)).rejects.toMatchObject({ code:'SYNC_BACKOFF' });
    at = new Date(repeat.nextAttemptAt!);
    const second = await service.continue(first.runId);
    expect(second.nextAttemptAt).toBe('2026-10-05T00:35:00.000Z');
    at = new Date(second.nextAttemptAt!);
    pages.set(3, page(match(3),match(4),match(5)));
    const recovered = await service.continue(first.runId);
    expect(recovered.lastErrorCategory).toBeUndefined();
    expect(recovered.nextAttemptAt).toBeUndefined();
    expect(await count(database,'source_matches')).toBe(6);
    expect((await database.query('SELECT next_start,retry_count FROM sync_cursors')).rows[0]).toEqual({next_start:6,retry_count:0});
  });

  it('third repeated live page falls back; partial sweep uses existing schema and weekly cooldown', async () => {
    const same = page(match(0),match(1),match(2));
    let at = new Date('2026-10-05T00:00:00Z');
    const provider = new DeepFixtureProvider(new Map([[0,same],[3,same]]));
    const service = new HistoricalSyncService(store,durable,provider,hmacKey,{now:()=>at});
    const first = await service.start(publicPlayerId,'deep_backfill');
    for (let n=0;n<2;n+=1) {
      const repeated = await service.continue(first.runId);
      at = new Date(repeated.nextAttemptAt!);
    }
    const fallback = await service.continue(first.runId);
    expect(fallback).toMatchObject({status:'paused',history:{historyPhase:'stored_index',liveHistoryExhausted:false,sourceExhausted:false},coverage:{incompleteReason:'live_v4_pagination_stalled'}});
    const final = await service.continue(first.runId);
    expect(final).toMatchObject({status:'complete',history:{sourceExhausted:false,lifetimeComplete:false},coverage:{incompleteReason:'partial_source_coverage'}});
    expect(await store.duePlayers('history',at.toISOString())).toHaveLength(0);
    await expect(service.start(publicPlayerId,'deep_backfill','scheduled')).rejects.toMatchObject({code:'LOCK_BUSY'});
    at = new Date(at.getTime()+7*86400_000);
    expect(await store.duePlayers('history',at.toISOString())).toHaveLength(1);
    const next = await service.start(publicPlayerId,'deep_backfill','scheduled');
    expect(next.runId).not.toBe(first.runId);
    expect(await count(database,'source_matches')).toBe(3);
    expect(await count(database,'sync_runs')).toBe(2);
  });

  it('monthly reconciliation finds older D/E while later windows cannot remove A/B/C', async () => {
    let at = new Date('2026-10-05T00:00:00Z');
    const pages = new Map([[0,page(match(0),match(1),match(2))]]);
    const provider = new DeepFixtureProvider(pages);
    const service = new HistoricalSyncService(store,durable,provider,hmacKey,{now:()=>at});
    const first = await service.start(publicPlayerId,'deep_backfill','scheduled');
    await service.continue(first.runId);
    await service.continue(first.runId);
    at = new Date(at.getTime()+29*86400_000);
    expect(await store.duePlayers('history',at.toISOString())).toHaveLength(0);
    at = new Date(at.getTime()+86400_000);
    pages.set(3,page(match(3),match(4)));
    const second = await service.start(publicPlayerId,'deep_backfill','scheduled');
    await service.continue(second.runId);
    await service.continue(second.runId);
    expect(await count(database,'source_matches')).toBe(5);
    pages.set(0,page(match(9),match(0),match(1)));
    at = new Date(at.getTime()+86400_000);
    await service.start(publicPlayerId,'incremental','scheduled');
    expect(await count(database,'source_matches')).toBe(6);
    expect((await database.query("SELECT trigger_kind,count(*)::integer AS count FROM sync_runs GROUP BY trigger_kind")).rows).toEqual([{trigger_kind:'scheduled',count:3}]);
  });

  it('existing failed P2 pagination run is resumed without a replacement audit', async () => {
    const pages=new Map([[0,page(match(0),match(1),match(2))],[3,page(match(3))]]);
    const service=new HistoricalSyncService(store,durable,new DeepFixtureProvider(pages),hmacKey);
    const first=await service.start(publicPlayerId,'deep_backfill');
    await database.query("UPDATE sync_runs SET status='failed',termination_reason='provider_repeated_page',completed_at=now()");
    const resumed=await service.start(publicPlayerId,'deep_backfill','scheduled');
    expect(resumed.runId).toBe(first.runId);
    expect(resumed.status).toBe('paused');
    expect(await count(database,'sync_runs')).toBe(1);
    expect((await database.query('SELECT trigger_kind FROM sync_runs')).rows[0]?.trigger_kind).toBe('manual');
    expect(await count(database,'source_matches')).toBe(4);
  });

  it('persistent stored repetition ends an incomplete sweep without fabricating evidence', async () => {
    let at=new Date('2026-10-05T00:00:00Z');
    const provider=new DeepFixtureProvider(new Map(),new Map([[1,[0,1,2]],[2,[0,1,2]]]));
    await durable.persistMatches({...connection,playerId:publicPlayerId,limit:3},page(match(0),match(1),match(2)));
    const service=new HistoricalSyncService(store,durable,provider,hmacKey,{now:()=>at});
    const first=await service.start(publicPlayerId,'deep_backfill');
    await service.continue(first.runId);
    for(let n=0;n<2;n+=1){const paused=await service.continue(first.runId);at=new Date(paused.nextAttemptAt!);}
    const final=await service.continue(first.runId);
    expect(final).toMatchObject({status:'complete',coverage:{incompleteReason:'partial_source_coverage'},history:{storedHistoryExhausted:false,sourceExhausted:false,lifetimeComplete:false}});
    expect(provider.detailCalls).toBe(0);
    expect(await count(database,'source_matches')).toBe(3);
  });

  it('deep full overlap advances to older unique matches without rewriting legacy backfill', async () => {
    await durable.persistMatches({ ...connection, playerId: publicPlayerId, limit: 3 }, page(match(0), match(1), match(2)));
    const provider = new DeepFixtureProvider(new Map([[0, page(match(0), match(1), match(2))], [3, page(match(3), match(4), match(5))]]));
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);
    const first = await service.start(publicPlayerId, 'deep_backfill');
    expect(first).toMatchObject({ status: 'paused', progress: { overlapsUpdated: 3 }, history: { historyPhase: 'live_v4', lifetimeComplete: false } });
    const second = await service.continue(first.runId);
    expect(second.status).toBe('paused');
    expect(await count(database, 'source_matches')).toBe(6);
    const third = await service.continue(first.runId);
    expect(third).toMatchObject({ status: 'paused', history: { historyPhase: 'stored_index', liveHistoryExhausted: true, sourceExhausted: false } });
    const final = await service.continue(first.runId);
    expect(final).toMatchObject({ status: 'complete', terminationReason: 'source_exhausted', history: { sourceExhausted: true, lifetimeComplete: false } });
  });

  it('P2 continues past matches already stored by consenting P1 and attaches both shared participants', async () => {
    const other = { ...connection, gameName: 'OtherGoblin' };
    const connected = await durable.persistConnection(other, 'fictional-other-participant');
    const shared = (index: number) => {
      const value = match(index);
      value.players.push({ ...value.players[0]!, puuid: 'fictional-other-participant', name: other.gameName });
      return value;
    };
    await durable.persistMatches({ ...connection, playerId: publicPlayerId, limit: 3 }, page(shared(0), shared(1), shared(2)));
    const older = match(3);
    older.players[0] = { ...older.players[0]!, puuid: 'fictional-other-participant', name: other.gameName };
    const provider = new DeepFixtureProvider(new Map([[0, page(shared(0), shared(1), shared(2))], [3, page(older)]]));
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);
    const first = await service.start(connected.publicPlayerId!, 'deep_backfill');
    const second = await service.continue(first.runId);
    expect(second).toMatchObject({ status: 'paused', progress: { overlapsUpdated: 3 }, history: { historyPhase: 'stored_index' } });
    expect(await count(database, 'source_matches')).toBe(4);
    const links = await database.query<{ count: string }>('SELECT count(*)::text AS count FROM match_participants WHERE player_id IS NOT NULL');
    expect(Number(links.rows[0]!.count)).toBe(7);
    expect(provider.calls).toBe(2);
  });

  it.each([
    [429, 'RATE_LIMITED'], [504, 'PROVIDER_TIMEOUT'], [502, 'PROVIDER_ERROR'],
  ] as const)('detail %i persists backoff without advancing stored cursor or making hidden retries', async (status, code) => {
    let now = new Date('2026-10-03T00:00:00Z');
    const provider = new DeepFixtureProvider(new Map(), new Map([[1, [8]]]));
    const service = new HistoricalSyncService(store, durable, provider, hmacKey, { now: () => now });
    const first = await service.start(publicPlayerId, 'deep_backfill');
    provider.detailFailure = new PublicApiError(status, code, 'synthetic detail failure');
    await expect(service.continue(first.runId)).rejects.toMatchObject({ code });
    expect(await service.status(first.runId)).toMatchObject({ status: 'paused', history: { storedPage: 1, storedItemIndex: 0, sourceExhausted: false }, performance: { providerRequests: 3 }, progress: { detailRequests: 1 } });
    await expect(service.continue(first.runId)).rejects.toMatchObject({ code: 'SYNC_BACKOFF' });
    expect(provider.detailCalls).toBe(1);
    provider.detailFailure = undefined;
    now = new Date('2026-10-03T00:01:01Z');
    const final = await service.continue(first.runId);
    expect(final).toMatchObject({ status: 'complete', history: { sourceExhausted: true, lifetimeComplete: false } });
    expect(await count(database, 'source_matches')).toBe(1);
  });

  it('stored counters distinguish a full final page from a repeated provider page', async () => {
    const provider = new DeepFixtureProvider(new Map(), new Map([[1, [0, 1, 2]]]));
    const original = provider.fetchStoredIndexPage.bind(provider);
    vi.spyOn(provider, 'fetchStoredIndexPage').mockImplementation(async (input, number) => ({
      ...await original(input, number), results: { total: 3, returned: 3, before: 0, after: 0 },
    }));
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);
    let progress = await service.start(publicPlayerId, 'deep_backfill');
    for (let index = 0; index < 3; index += 1) progress = await service.continue(progress.runId);
    expect(progress).toMatchObject({ status: 'complete', history: { storedTotal: 3, storedPage: 1, storedItemIndex: 3 } });
    expect(provider.storedCalls).toBe(3);
    expect(provider.detailCalls).toBe(3);
  });

  it('a repeated stored page is stalled, not exhausted, and never fabricates compact-index evidence', async () => {
    await durable.persistMatches({ ...connection, playerId: publicPlayerId, limit: 3 }, page(match(0), match(1), match(2)));
    const provider = new DeepFixtureProvider(new Map(), new Map([[1, [0, 1, 2]], [2, [0, 1, 2]]]));
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);
    let progress = await service.start(publicPlayerId, 'deep_backfill');
    progress = await service.continue(progress.runId);
    progress = await service.continue(progress.runId);
    expect(progress).toMatchObject({ status: 'paused', lastErrorCategory: 'PROVIDER_PAGINATION_UNSTABLE', history: { sourceExhausted: false, storedHistoryExhausted: false } });
    expect(provider.detailCalls).toBe(0);
    expect(await count(database, 'source_matches')).toBe(3);
  });

  it('deep history persists >300 synthetic matches with no configured horizon', async () => {
    const pages = new Map<number, unknown>();
    for (let start = 0; start < 303; start += 3) pages.set(start, page(match(start), match(start + 1), match(start + 2)));
    const provider = new DeepFixtureProvider(pages);
    const service = new HistoricalSyncService(store, durable, provider, hmacKey, { historyHorizon: 3 });
    let progress = await service.start(publicPlayerId, 'deep_backfill');
    while (progress.history?.historyPhase === 'live_v4') progress = await service.continue(progress.runId);
    expect(progress.progress.matchesPersisted).toBe(303);
    expect(progress.status).toBe('paused');
    expect(await count(database, 'source_matches')).toBe(303);
    expect(provider.calls).toBe(102);
    expect((await service.continue(progress.runId)).history?.sourceExhausted).toBe(true);
  }, 30_000);

  it('short live phase transitions then stored A/B/C overlaps recover older D/E detail one per invocation', async () => {
    const provider = new DeepFixtureProvider(new Map([[0, page(match(0), match(1))]]), new Map([[1, [0, 1, 2]], [2, [3, 4]]]));
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);
    let progress = await service.start(publicPlayerId, 'deep_backfill');
    expect(progress).toMatchObject({ status: 'paused', history: { historyPhase: 'stored_index' } });
    for (let attempt = 0; attempt < 5 && progress.status !== 'complete'; attempt += 1) {
      const before = provider.detailCalls;
      progress = await service.continue(progress.runId);
      expect(provider.detailCalls - before).toBeLessThanOrEqual(1);
    }
    expect(progress).toMatchObject({ status: 'complete', progress: { matchesPersisted: 5, overlapsUpdated: 2, detailRequests: 3 } });
    expect(await count(database, 'source_matches')).toBe(5);
    expect(JSON.stringify(progress)).not.toContain('fictional-history-match');
  });

  it('permanent missing detail advances without fabricated evidence', async () => {
    const provider = new DeepFixtureProvider(new Map(), new Map([[1, [5]]]));
    provider.detailFailure = new PublicApiError(404, 'ACCOUNT_NOT_FOUND', 'Unavailable');
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);
    const first = await service.start(publicPlayerId, 'deep_backfill');
    const second = await service.continue(first.runId);
    expect(second).toMatchObject({ status: 'complete', progress: { detailUnavailableCount: 1, matchesPersisted: 0 } });
    expect(await count(database, 'source_matches')).toBe(0);
  });

  it('stored crash resume keeps page/item and safely repeats a committed detail after lost cursor commit', async () => {
    const provider = new DeepFixtureProvider(new Map(), new Map([[1, [5, 6]]]));
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);
    const first = await service.start(publicPlayerId, 'deep_backfill');
    const failure = vi.spyOn(store, 'recordSuccess').mockRejectedValueOnce(new Error('crash before cursor commit'));
    await expect(service.continue(first.runId)).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
    failure.mockRestore();
    expect(await count(database, 'source_matches')).toBe(1);
    const position = await database.query<{ stored_page: number; stored_item_index: number }>("SELECT stored_page,stored_item_index FROM sync_cursors WHERE sync_kind='deep_backfill'");
    expect(position.rows[0]).toMatchObject({ stored_page: 1, stored_item_index: 0 });
    const resumed = await service.continue(first.runId);
    expect(resumed.status).toBe('complete');
    expect(await count(database, 'source_matches')).toBe(2);
    expect(provider.detailCalls).toBe(2);
  });

  it('deep repeated live page pauses retryably, never source exhaustion', async () => {
    const same = page(match(0), match(1), match(2));
    const provider = new DeepFixtureProvider(new Map([[0, same], [3, same]]));
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);
    const first = await service.start(publicPlayerId, 'deep_backfill');
    expect(await service.continue(first.runId)).toMatchObject({ status: 'paused', lastErrorCategory: 'PROVIDER_PAGINATION_UNSTABLE', history: { sourceExhausted: false } });
  });

  it('revocation between stored index and detail prevents that detail call and cancels run', async () => {
    const provider = new DeepFixtureProvider(new Map(), new Map([[1, [5]]]));
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);
    const first = await service.start(publicPlayerId, 'deep_backfill');
    const fetch = provider.fetchStoredIndexPage.bind(provider);
    provider.fetchStoredIndexPage = async (...args) => {
      const value = await fetch(...args);
      await database.query("UPDATE consents SET status='revoked',revoked_at=now() WHERE status='active'");
      return value;
    };
    await expect(service.continue(first.runId)).rejects.toMatchObject({ code: 'CONSENT_REVOKED' });
    expect(provider.detailCalls).toBe(0);
    expect((await service.status(first.runId)).status).toBe('cancelled');
  });

  it('creates a cursor, pauses after one bounded page, and resumes to short-page termination', async () => {
    const provider = new FixtureProvider(new Map([
      [0, page(match(0), match(1), match(2))],
      [3, page(match(3), match(4))],
    ]));
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);

    const first = await service.start(publicPlayerId, 'backfill');
    expect(first).toMatchObject({ status: 'paused', progress: { pages: 1, matchesSeen: 3 } });
    const second = await service.continue(first.runId);
    expect(second).toMatchObject({
      status: 'complete',
      terminationReason: 'short_page',
      progress: { pages: 2, matchesSeen: 5, matchesPersisted: 5, overlapsUpdated: 0 },
      coverage: { completeForProviderWindow: true },
    });
    expect(provider.calls).toBe(2);
    expect(await count(database, 'source_matches')).toBe(5);
    expect(JSON.stringify(second)).not.toContain('fictional-history-match');
    expect(JSON.stringify(second)).not.toContain('fictional-consenting-participant');
    const cursor = await database.query<{ next_start: number; last_successful_page: number }>(
      `SELECT next_start,last_successful_page FROM sync_cursors WHERE sync_kind='backfill'`,
    );
    expect(cursor.rows[0]).toMatchObject({ next_start: 5, last_successful_page: 1 });
  });

  it('terminates safely on an empty first page', async () => {
    const service = new HistoricalSyncService(store, durable, new FixtureProvider(new Map([[0, page()]])), hmacKey);
    const result = await service.start(publicPlayerId, 'backfill');
    expect(result).toMatchObject({ status: 'complete', terminationReason: 'empty_page', coverage: { completeForProviderWindow: true } });
    expect(await count(database, 'source_matches')).toBe(0);
  });

  it('prevents infinite pagination when the provider repeats a page', async () => {
    const repeated = page(match(0), match(1), match(2));
    const service = new HistoricalSyncService(store, durable, new FixtureProvider(new Map([[0, repeated], [3, repeated]])), hmacKey);
    const first = await service.start(publicPlayerId, 'backfill');
    const second = await service.continue(first.runId);
    expect(second).toMatchObject({
      status: 'complete', terminationReason: 'repeated_page',
      coverage: { completeForProviderWindow: false, incompleteReason: 'provider_repeated_page' },
    });
    expect(await count(database, 'source_matches')).toBe(3);
  });

  it('does not advance the cursor when database persistence fails and safely retries the same page', async () => {
    let fail = true;
    const writer = {
      persistSyncPage: (...args: Parameters<DurableEvidenceService['persistSyncPage']>) => {
        if (fail) throw new Error('forced database failure');
        return durable.persistSyncPage(...args);
      },
    };
    const provider = new FixtureProvider(new Map([[0, page(match(0), match(1))]]));
    const service = new HistoricalSyncService(store, writer, provider, hmacKey);
    await expect(service.start(publicPlayerId, 'backfill')).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
    const cursorAfterFailure = await database.query<{ next_start: number }>(`SELECT next_start FROM sync_cursors WHERE sync_kind='backfill'`);
    expect(cursorAfterFailure.rows[0]?.next_start).toBe(0);
    expect(await count(database, 'source_matches')).toBe(0);

    fail = false;
    const run = await database.query<{ public_id: string }>(`SELECT public_id FROM sync_runs ORDER BY started_at DESC LIMIT 1`);
    const retried = await service.continue(run.rows[0]!.public_id);
    expect(retried).toMatchObject({ status: 'complete', terminationReason: 'short_page', progress: { retries: 1 } });
    expect(await count(database, 'source_matches')).toBe(2);
  });

  it('keeps a previously committed chunk when the next chunk fails', async () => {
    let writes = 0;
    const writer = {
      async persistSyncPage(...args: Parameters<DurableEvidenceService['persistSyncPage']>) {
        writes += 1;
        if (writes === 2) throw new Error('forced second-page failure');
        return durable.persistSyncPage(...args);
      },
    };
    const provider = new FixtureProvider(new Map([
      [0, page(match(0), match(1), match(2))],
      [3, page(match(3), match(4), match(5))],
    ]));
    const service = new HistoricalSyncService(store, writer, provider, hmacKey);
    const first = await service.start(publicPlayerId, 'backfill');
    await expect(service.continue(first.runId)).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
    expect(await count(database, 'source_matches')).toBe(3);
    const cursor = await database.query<{ next_start: number }>(`SELECT next_start FROM sync_cursors WHERE sync_kind='backfill'`);
    expect(cursor.rows[0]?.next_start).toBe(3);
  });

  it('uses a durable lease, rejects contention, and recovers after lease expiry', async () => {
    const subject = await store.findSubject(publicPlayerId);
    expect(subject).toBeDefined();
    const first = await store.acquireCursorLease(subject!, 'backfill', '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:45.000Z');
    const contended = await store.acquireCursorLease(subject!, 'backfill', '2026-09-30T00:00:10.000Z', '2026-09-30T00:00:55.000Z');
    const recovered = await store.acquireCursorLease(subject!, 'backfill', '2026-09-30T00:00:46.000Z', '2026-09-30T00:01:31.000Z');
    expect(first).toBeDefined();
    expect(contended).toBeUndefined();
    expect(recovered).toBeDefined();
    expect(recovered?.leaseToken).not.toBe(first?.leaseToken);
  });

  it('persists rate-limit retry state and does not call the provider during backoff', async () => {
    let now = new Date('2026-09-30T00:00:00.000Z');
    const provider = new FixtureProvider(new Map());
    provider.failure = new PublicApiError(429, 'RATE_LIMITED', 'bounded fixture');
    const service = new HistoricalSyncService(store, durable, provider, hmacKey, { now: () => now });
    await expect(service.start(publicPlayerId, 'backfill')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    const run = await database.query<{ public_id: string }>(`SELECT public_id FROM sync_runs LIMIT 1`);
    await expect(service.continue(run.rows[0]!.public_id)).rejects.toMatchObject({ code: 'SYNC_BACKOFF' });
    expect(provider.calls).toBe(1);
    const retry = await database.query<{ retry_count: number; last_error_category: string; next_attempt_at: Date }>(
      `SELECT retry_count,last_error_category,next_attempt_at FROM sync_cursors WHERE sync_kind='backfill'`,
    );
    expect(retry.rows[0]).toMatchObject({ retry_count: 1, last_error_category: 'RATE_LIMITED' });
    now = new Date('2026-09-30T00:01:01.000Z');
  });

  it('classifies provider timeout without moving the cursor', async () => {
    const provider = new FixtureProvider(new Map());
    provider.failure = new PublicApiError(504, 'PROVIDER_TIMEOUT', 'bounded fixture');
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);
    await expect(service.start(publicPlayerId, 'backfill')).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    const cursor = await database.query<{ next_start: number; last_error_category: string }>(
      `SELECT next_start,last_error_category FROM sync_cursors WHERE sync_kind='backfill'`,
    );
    expect(cursor.rows[0]).toMatchObject({ next_start: 0, last_error_category: 'PROVIDER_TIMEOUT' });
  });

  it('blocks provider access without active consent and cancels a resumed run after revocation', async () => {
    const provider = new FixtureProvider(new Map([[0, page(match(0), match(1), match(2))], [3, page(match(3))]]));
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);
    const first = await service.start(publicPlayerId, 'backfill');
    await database.query(`UPDATE consents SET status='revoked', revoked_at='2026-09-30T01:00:00.000Z' WHERE status='active'`);
    await expect(service.continue(first.runId)).rejects.toMatchObject({ code: 'CONSENT_REVOKED' });
    expect(provider.calls).toBe(1);
    expect((await service.status(first.runId)).status).toBe('cancelled');
  });

  it('blocks a first sync without consent before any provider call', async () => {
    await database.query(`UPDATE consents SET status='revoked', revoked_at='2026-09-30T01:00:00.000Z' WHERE status='active'`);
    const provider = new FixtureProvider(new Map());
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);
    await expect(service.start(publicPlayerId, 'backfill')).rejects.toMatchObject({ code: 'CONSENT_REVOKED' });
    expect(provider.calls).toBe(0);
  });

  it('blocks an old-policy consent before any provider call', async () => {
    await database.query("UPDATE consents SET privacy_version='old-private-v1' WHERE status='active'");
    const provider = new FixtureProvider(new Map());
    const service = new HistoricalSyncService(store, durable, provider, hmacKey);
    await expect(service.start(publicPlayerId, 'backfill')).rejects.toMatchObject({ code: 'CONSENT_REVOKED' });
    expect(provider.calls).toBe(0);
  });

  it('performs incremental newest sync with overlap and stops at a known boundary', async () => {
    const backfill = new HistoricalSyncService(
      store,
      durable,
      new FixtureProvider(new Map([[0, page(match(1), match(2))]])),
      hmacKey,
    );
    await backfill.start(publicPlayerId, 'backfill');
    const incremental = new HistoricalSyncService(
      store,
      durable,
      new FixtureProvider(new Map([[0, page(match(0), match(1), match(2))]])),
      hmacKey,
    );
    const result = await incremental.start(publicPlayerId, 'incremental');
    expect(result).toMatchObject({
      status: 'complete', terminationReason: 'known_boundary',
      progress: { matchesSeen: 3, matchesPersisted: 3, overlapsUpdated: 2 },
    });
    expect(await count(database, 'source_matches')).toBe(3);
    await expect(incremental.start(publicPlayerId, 'backfill')).resolves.toMatchObject({ progress: { matchesSeen: 2 } });
    expect(await count(database, 'source_matches')).toBe(3);
  });

  it('keeps absent location evidence absent instead of converting it to zero', async () => {
    const service = new HistoricalSyncService(store, durable, new FixtureProvider(new Map([[0, page(match(0))]])), hmacKey);
    await service.start(publicPlayerId, 'backfill');
    expect(await count(database, 'event_player_locations')).toBe(0);
    const evidence = await database.query<{ loadout_value: number; remaining_credits: number }>(
      `SELECT loadout_value,remaining_credits FROM round_participants LIMIT 1`,
    );
    expect(evidence.rows[0]).toMatchObject({ loadout_value: 0, remaining_credits: 800 });
  });

  it.each([1, 2, 3])('keeps page size %i bounded to one provider request', async (pageSize) => {
    const matches = Array.from({ length: pageSize }, (_value, index) => match(index));
    const provider = new FixtureProvider(new Map([[0, page(...matches)]]));
    const service = new HistoricalSyncService(store, durable, provider, hmacKey, { pageSize, historyHorizon: pageSize });
    const result = await service.start(publicPlayerId, 'backfill');
    expect(provider.calls).toBe(1);
    expect(result.progress.matchesSeen).toBe(pageSize);
    expect(result.performance.providerRequests).toBe(1);
    expect(result.performance.totalMs).toBeLessThan(25_000);
  });
});
