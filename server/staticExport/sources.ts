import { randomBytes } from 'node:crypto';
import type { SqlDatabase, SqlExecutor } from '../db/types.js';
import { DatasetProjectionService } from '../dataset/datasetProjectionService.js';
import { PostgresDatasetReadRepository } from '../dataset/postgresDatasetReadRepository.js';
import { ServerAnalysisService, parseAnalysisRequest } from '../dataset/analysisService.js';
import { WeaponAnalyticsService, parseWeaponRequest, readPublicWeaponFacts, readWeaponFactContext } from '../dataset/weaponAnalytics.js';
import type { AnalysisPhase1, AnalysisPhase2 } from '../dataset/analysisService.js';
import type { PublicWeaponFact } from '../../src/analytics/weapons/weaponQuery.js';
import { PostgresAnalyticsContextRepository, buildAnalyticsContext } from '../dataset/analyticsContext.js';
import { parseHistoryRequest } from '../dataset/historyCursor.js';
import type { AnalysisQuery } from '../../src/dataSources/server/analysisResult.js';
import { analysisSearchParams, weaponSearchParams } from '../../src/dataSources/static/contract.js';
import type { StaticWeaponQuery as WeaponQuery } from '../../src/dataSources/static/contract.js';

/**
 * Where a static snapshot reads its payloads from: the SAME public read services as the live
 * `/api/valorant/dataset` route (no duplicated analytics, no browser recomputation). Every request goes
 * through the route's own parsers, so a static file is byte-for-byte the API answer to that URL.
 */
export interface StaticExportSources {
  dataset(): Promise<unknown>;
  analyticsContext(): Promise<unknown>;
  /** `cursor` is the server's opaque position (never exported); `before` starts strictly older. */
  history(position: { before?: string; cursor?: string; limit: number }): Promise<unknown>;
  analysis(query: AnalysisQuery): Promise<unknown>;
  weapons(query: WeaponQuery): Promise<unknown>;
  /** TASK-INFRA-STATIC-QUERY-PARITY-01: the exact phase-1/phase-2 inputs of the shared analysis core and the weapon facts. */
  facts(): Promise<StaticFactSources>;
}

export interface StaticFactSources {
  phase1: AnalysisPhase1;
  /** Full records + per-match evidence flags of EVERY eligible match. */
  phase2: AnalysisPhase2;
  weapons: { memberIds: string[]; observedActs: string[]; facts: [string, PublicWeaponFact[]][] };
}

const asQuery = (params: URLSearchParams) => Object.fromEntries(params.entries());

/**
 * One consistent, READ ONLY view of PostgreSQL: every artifact of a snapshot sees the same data even if a
 * sync commits meanwhile, and the exporter can never write (PostgreSQL stays the source of truth; public
 * JSON is never read back into it).
 */
export async function withConsistentReadSnapshot<T>(database: SqlDatabase, work: (snapshot: SqlDatabase) => Promise<T>): Promise<T> {
  return database.transaction(async (executor: SqlExecutor) => {
    await executor.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    // One transaction = one connection: the read services issue statements in parallel (Promise.all), so
    // serialize them here (pg forbids concurrent queries on one client; order stays deterministic).
    let tail: Promise<unknown> = Promise.resolve();
    const serialized: SqlExecutor = {
      query: <Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        const run = tail.then(() => executor.query<Row>(sql, params));
        tail = run.catch(() => undefined);
        return run;
      },
    };
    const snapshot: SqlDatabase = {
      query: serialized.query,
      transaction: (inner) => inner(serialized),
      close: async () => undefined,
    };
    return work(snapshot);
  });
}

export function postgresExportSources(database: SqlDatabase): StaticExportSources {
  // History cursors are only walked inside this process and replaced by static page tokens, so an
  // ephemeral per-run key suffices (no IDENTIFIER_HMAC_KEY is needed or read).
  const cursorKey = randomBytes(32).toString('hex');
  const projection = new DatasetProjectionService(new PostgresDatasetReadRepository(database), cursorKey);
  const analysis = new ServerAnalysisService(database, projection);
  const weapons = new WeaponAnalyticsService(database, analysis);
  const context = new PostgresAnalyticsContextRepository(database);
  return {
    dataset: async () => (await projection.read()).payload,
    analyticsContext: async () => buildAnalyticsContext(await context.readContextRows()),
    history: async ({ before, cursor, limit }) => (await projection.readHistory(parseHistoryRequest(
      { limit: String(limit), ...(cursor ? { cursor } : before ? { before } : {}) }, cursorKey))).payload,
    analysis: async (query) => (await analysis.analyze(parseAnalysisRequest(asQuery(analysisSearchParams(query))))).payload,
    weapons: async (query) => (await weapons.analyze(parseWeaponRequest(asQuery(weaponSearchParams(query))))).payload,
    facts: async () => {
      const query = database.query.bind(database);
      const phase1 = await analysis.loadPhase1(query);
      // Per-match fallback flags (chunk of 1) so any selection can AND exactly the flags the server would.
      const phase2 = await analysis.loadFull(phase1, phase1.skeletons.map((match) => match.id), query, 1);
      const context = await readWeaponFactContext(database);
      const facts: [string, PublicWeaponFact[]][] = [];
      for (const memberId of context.memberIds) facts.push([memberId, await readPublicWeaponFacts(database, memberId)]);
      return { phase1, phase2, weapons: { ...context, facts } };
    },
  };
}
