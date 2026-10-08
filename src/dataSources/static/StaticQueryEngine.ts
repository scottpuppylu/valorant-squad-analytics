import { analysisPopulation, availabilityOf, finalizeAnalysis, resolveAnalysisMatchIds, type AnalysisRequest } from '../../analytics/analysisCore.js';
import { aggregateWeaponFacts, filterWeaponFacts, finishWeaponAnalytics, weaponRequestReasons, type PublicWeaponFact } from '../../analytics/weapons/weaponQuery.js';
import type { ScopePopulation } from '../../analytics/scope/types.js';
import type { MatchRecord } from '../../types/valorant.js';
import type { AnalysisQuery, DatasetAnalysisResponse } from '../server/analysisResult.js';
import type { WeaponAnalyticsResponse } from '../server/weaponContract.js';
import type { StaticWeaponQuery } from './contract.js';
import { chunkFor, decodeSkeleton, decodeWeaponFacts, PUBLIC_FACT_SCHEMA_VERSION, type FactsMeta, type MatchChunk, type SkeletonChunk, type WeaponChunk } from './publicFacts.js';

/**
 * TASK-INFRA-STATIC-QUERY-PARITY-01 browser query engine over one pinned snapshot's public facts.
 *
 * It contains NO analytics: requests run through the shared server core (`resolveAnalysisMatchIds` →
 * `finalizeAnalysis`) and the shared weapon query (`filterWeaponFacts` → `aggregateWeaponFacts` →
 * `finishWeaponAnalytics`). The engine only decodes public facts and loads them lazily:
 *  - phase 1 needs every skeleton (small, loaded once per snapshot);
 *  - phase 2 loads ONLY the match chunks that hold selected matches (cached per snapshot);
 *  - weapons load ONLY the requested member's chunk (all members only for `player=all`).
 * No eval, no code generation, no network except the snapshot's own static files.
 */
export type StaticFileLoader = (path: string) => Promise<unknown>;

/** Same AnalysisRequest the server parser builds from this query's URL (`analysisSearchParams`). */
export function analysisRequestOf(query: AnalysisQuery): AnalysisRequest {
  const value = (raw: string | undefined) => (raw && raw !== 'all' ? raw : 'all');
  return {
    feature: query.feature,
    ...(query.recent ? { recent: query.recent } : {}),
    ...(query.act ? { act: query.act } : {}), ...(query.from ? { from: query.from } : {}), ...(query.to ? { to: query.to } : {}),
    map: value(query.map), agent: value(query.agent), mode: value(query.mode), role: value(query.role), player: value(query.player), form: query.form === true,
  };
}

export class StaticQueryEngine {
  private metaPromise: Promise<FactsMeta> | undefined;
  private phase1Promise: Promise<{ meta: FactsMeta; skeletons: MatchRecord[]; byId: Map<string, MatchRecord>; population: ScopePopulation }> | undefined;
  private readonly matchChunks = new Map<string, Promise<MatchChunk>>();
  private readonly weaponChunks = new Map<string, Promise<PublicWeaponFact[]>>();
  /** Fact files loaded so far (diagnostics; identifier-free). */
  readonly loaded = { files: 0 };

  constructor(private readonly load: StaticFileLoader, private readonly metaPath: string) {}

  private file<T>(path: string): Promise<T> {
    return this.load(path).then((value) => { this.loaded.files += 1; return value as T; });
  }

  meta(): Promise<FactsMeta> {
    this.metaPromise ??= this.file<FactsMeta>(this.metaPath).then((meta) => {
      if (meta.factSchemaVersion !== PUBLIC_FACT_SCHEMA_VERSION) throw new Error('Unsupported public fact schema.');
      return meta;
    });
    return this.metaPromise;
  }

  private phase1() {
    this.phase1Promise ??= (async () => {
      const meta = await this.meta();
      const chunks = await Promise.all(meta.skeletonFiles.map((path) => this.file<SkeletonChunk>(path)));
      // Server phase-1 order: playedAt desc, id asc.
      const skeletons = chunks.flatMap((chunk) => chunk.skeletons.map(decodeSkeleton))
        .sort((a, b) => b.playedAt.localeCompare(a.playedAt) || a.id.localeCompare(b.id));
      return { meta, skeletons, byId: new Map(skeletons.map((match) => [match.id, match])), population: analysisPopulation(skeletons, meta.populationEvidence) };
    })();
    return this.phase1Promise;
  }

  private matchChunk(path: string): Promise<MatchChunk> {
    let pending = this.matchChunks.get(path);
    if (!pending) { pending = this.file<MatchChunk>(path); this.matchChunks.set(path, pending); pending.catch(() => this.matchChunks.delete(path)); }
    return pending;
  }

  /** Phase 2 from facts: full records + evidence flags of exactly the selected matches. */
  private async loadFull(ids: Set<string>) {
    const { meta, byId } = await this.phase1();
    const paths = new Set<string>();
    for (const id of ids) {
      const skeleton = byId.get(id);
      const chunk = skeleton ? chunkFor(meta.matchChunks, skeleton.playedAt, id) : undefined;
      if (chunk) paths.add(chunk.file);
    }
    const full = new Map<string, MatchRecord>();
    const flags: { round: boolean; headshot: boolean }[] = [];
    for (const chunk of await Promise.all([...paths].sort().map((path) => this.matchChunk(path)))) {
      chunk.matches.forEach((match, index) => {
        if (!ids.has(match.id)) return;
        full.set(match.id, match);
        const [round, headshot] = chunk.flags[index]!;
        flags.push({ round: round === 1, headshot: headshot === 1 });
      });
    }
    for (const [id, round, headshot] of meta.evidenceOnly) if (ids.has(id)) flags.push({ round: round === 1, headshot: headshot === 1 });
    return { full, flags };
  }

  async analysisRequest(request: AnalysisRequest) {
    const { meta, skeletons, population } = await this.phase1();
    const selectedIds = resolveAnalysisMatchIds(request, skeletons, meta.skeletonPlayers, population);
    const { full, flags } = await this.loadFull(selectedIds);
    return finalizeAnalysis({ request, skeletons, full, selectedIds, players: meta.players, population, trackedMatchCount: meta.trackedMatchCount, availability: availabilityOf(flags) });
  }

  async analysis(query: AnalysisQuery): Promise<DatasetAnalysisResponse> {
    return (await this.analysisRequest(analysisRequestOf(query))).payload as unknown as DatasetAnalysisResponse;
  }

  private async weaponFacts(meta: FactsMeta, memberId: string): Promise<PublicWeaponFact[]> {
    const paths = meta.weapons.files.filter(([member]) => member === memberId).map(([, path]) => path);
    return (await Promise.all(paths.map((path) => {
      let pending = this.weaponChunks.get(path);
      if (!pending) { pending = this.file<WeaponChunk>(path).then(decodeWeaponFacts); this.weaponChunks.set(path, pending); pending.catch(() => this.weaponChunks.delete(path)); }
      return pending;
    }))).flat();
  }

  async weapons(query: StaticWeaponQuery): Promise<WeaponAnalyticsResponse> {
    const meta = await this.meta();
    const request = { player: query.player, scope: query.scope, ...(query.act ? { act: query.act } : {}), map: query.map, agent: query.agent, mode: query.mode };
    let pairs: Set<string> | undefined;
    let current: { scopeStatus?: 'available' | 'partial' | 'unavailable'; scopeReasons: string[] } | undefined;
    if (request.scope === 'current') {
      const { payload, selection } = await this.analysisRequest({ feature: 'currentStrength', map: request.map, agent: request.agent, mode: request.mode, role: 'all', player: 'all', form: false });
      pairs = new Set(Object.entries(selection).flatMap(([memberId, matchIds]) => matchIds.map((matchId) => `${memberId}|${matchId}`)));
      current = { ...(payload.scope ? { scopeStatus: payload.scope.status } : {}), scopeReasons: payload.scope?.reasons ?? [] };
    }
    // The result summarizes EVERY visible member (comparison table); `player` only selects the detail.
    const facts = (await Promise.all(meta.weapons.memberIds.map((memberId) => this.weaponFacts(meta, memberId)))).flat();
    const aggregates = aggregateWeaponFacts(filterWeaponFacts(facts, request, pairs));
    const reasons = weaponRequestReasons(request, request.scope === 'act' && request.act ? meta.weapons.observedActs.includes(request.act) : false, current);
    return finishWeaponAnalytics(aggregates, request, { memberIds: meta.weapons.memberIds, reasons, ...(current?.scopeStatus ? { scopeStatus: current.scopeStatus } : {}) }) as unknown as WeaponAnalyticsResponse;
  }
}
