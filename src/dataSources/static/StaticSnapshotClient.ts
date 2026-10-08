import type { DatasetApiClient } from '../server/DatasetApiClient';
import type { AnalysisQuery, DatasetAnalysisResponse } from '../server/analysisResult';
import type { DatasetAnalyticsContextResponse, DatasetHistoryQuery, DatasetHistoryResponse, DatasetResponse } from '../server/contracts';
import type { WeaponQuery } from '../../analytics/weapons/local';
import type { WeaponAnalyticsResponse } from '../server/weaponContract';
import {
  isStaticManifest, isStaticSnapshotIndex, parseStaticHistoryToken, staticAnalysisKey, staticHistoryFile, staticVersionPath, staticWeaponKey,
  type StaticSnapshotIndex,
} from './contract';
import { StaticQueryEngine } from './StaticQueryEngine';
import type { FactsRequest, WorkerRequest, WorkerResponse } from './staticQueryWorkerProtocol';

/** The request is valid but outside the precomputed static catalog (e.g. a multi-filter combination). */
export class StaticSnapshotNotPrecomputedError extends Error {
  constructor() {
    super('此靜態資料快照未預先計算這個篩選組合。');
    this.name = 'StaticSnapshotNotPrecomputedError';
  }
}

interface PinnedSnapshot { snapshotId: string; base: string; index: StaticSnapshotIndex; engine?: StaticQueryEngine }

export interface StaticSnapshotClientOptions {
  /** Directory URL that contains manifest.json (absolute, or relative to the page). */
  baseUrl: string;
  fetch?: typeof fetch;
  /** Optional Web Worker for facts queries (browser); without it the engine runs on the calling thread. */
  workerFactory?: () => Worker;
}

/**
 * TASK-INFRA-STATIC-DATA-PUBLISH-01 read-only DatasetApiClient over a published static snapshot.
 *
 * - `load()` revalidates manifest.json (`cache: 'no-cache'`) and PINS one snapshot; every other request of
 *   this client reads only that snapshot's immutable files until the next `load()` (never mixes versions).
 * - Requests issued in the same tick as `load()` (the provider's prefetch) wait one microtask so they bind to
 *   the snapshot that `load()` pins, not the previous one.
 * - Requests outside the precomputed catalog run the shared analysis core on the snapshot's public facts
 *   (StaticQueryEngine, TASK-INFRA-STATIC-QUERY-PARITY-01); only a snapshot WITHOUT facts reports “not precomputed”.
 * - It never writes, never calls `/api`, and never calls a provider (no `refreshRecent`).
 */
export class StaticSnapshotClient implements DatasetApiClient {
  private pin: Promise<PinnedSnapshot> | undefined;
  private readonly root: string;
  private readonly fetcher: typeof fetch;
  private readonly workerFactory: (() => Worker) | undefined;
  private worker: Worker | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(options: StaticSnapshotClientOptions) {
    this.root = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`;
    this.fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.workerFactory = options.workerFactory;
  }

  /** Facts query in the worker (if configured) or on this thread with the pinned snapshot's engine. */
  private facts(pinned: PinnedSnapshot, request: FactsRequest): Promise<unknown> {
    if (!this.workerFactory || !pinned.index.facts) {
      return request.kind === 'analysis' ? pinned.engine!.analysis(request.query) : pinned.engine!.weapons(request.query);
    }
    if (!this.worker) {
      this.worker = this.workerFactory();
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const waiting = this.pending.get(event.data.id);
        if (!waiting) return;
        this.pending.delete(event.data.id);
        if (event.data.ok) waiting.resolve(event.data.value); else waiting.reject(new Error(event.data.message));
      };
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ ...request, id, base: pinned.base, metaPath: pinned.index.facts } as WorkerRequest);
    });
  }

  private async json(url: string, init?: RequestInit): Promise<unknown> {
    const response = await this.fetcher(url, init);
    if (!response.ok) throw new Error(`Static snapshot file unavailable (${response.status}).`);
    return response.json() as Promise<unknown>;
  }

  private async resolvePin(): Promise<PinnedSnapshot> {
    // The manifest is the only mutable file: always revalidate it. Versioned files are immutable.
    const manifest = await this.json(`${this.root}manifest.json`, { cache: 'no-cache' });
    if (!isStaticManifest(manifest)) throw new Error('Unsupported static manifest.');
    const base = `${this.root}${staticVersionPath(manifest.snapshotId)}`;
    const index = await this.json(`${base}index.json`);
    if (!isStaticSnapshotIndex(index) || index.snapshotId !== manifest.snapshotId || index.dataVersion !== manifest.dataVersion) {
      throw new Error('Static snapshot index does not match the manifest.');
    }
    // TASK-INFRA-STATIC-QUERY-PARITY-01: one engine per pinned snapshot, so its fact cache never crosses versions.
    const engine = index.facts ? new StaticQueryEngine((path) => this.json(`${base}${path}`), index.facts) : undefined;
    return { snapshotId: manifest.snapshotId, base, index, ...(engine ? { engine } : {}) };
  }

  private async pinned(): Promise<PinnedSnapshot> {
    await Promise.resolve();
    this.pin ??= this.resolvePin();
    return this.pin;
  }

  async load(signal?: AbortSignal): Promise<DatasetResponse> {
    const next = this.resolvePin();
    this.pin = next;
    next.catch(() => { if (this.pin === next) this.pin = undefined; });
    const pinned = await next;
    return this.json(`${pinned.base}${pinned.index.files.dataset}`, { signal }) as Promise<DatasetResponse>;
  }

  async loadAnalyticsContext(signal?: AbortSignal): Promise<DatasetAnalyticsContextResponse> {
    const pinned = await this.pinned();
    return this.json(`${pinned.base}${pinned.index.files.analytics}`, { signal }) as Promise<DatasetAnalyticsContextResponse>;
  }

  async loadHistory(query: DatasetHistoryQuery, signal?: AbortSignal): Promise<DatasetHistoryResponse> {
    const pinned = await this.pinned();
    // Page 1 starts strictly older than the snapshot's oldest match (the only `before` the page sends).
    const page = query.cursor ? parseStaticHistoryToken(query.cursor) : 1;
    if (page === undefined || page < 1 || page > Math.max(1, pinned.index.history.pages)) throw new Error('Unknown static history page.');
    return this.json(`${pinned.base}${staticHistoryFile(page)}`, { signal }) as Promise<DatasetHistoryResponse>;
  }

  async loadAnalysis(query: AnalysisQuery, signal?: AbortSignal): Promise<DatasetAnalysisResponse> {
    const pinned = await this.pinned();
    const file = pinned.index.analysis[staticAnalysisKey(query)];
    if (!file && pinned.engine) return this.facts(pinned, { kind: 'analysis', query }) as Promise<DatasetAnalysisResponse>;
    if (!file) throw new StaticSnapshotNotPrecomputedError();
    return this.json(`${pinned.base}${file}`, { signal }) as Promise<DatasetAnalysisResponse>;
  }

  async loadWeaponAnalytics(query: WeaponQuery, signal?: AbortSignal): Promise<WeaponAnalyticsResponse> {
    const pinned = await this.pinned();
    const file = pinned.index.weapons[staticWeaponKey(query)];
    if (!file && pinned.engine) return this.facts(pinned, { kind: 'weapons', query }) as Promise<WeaponAnalyticsResponse>;
    if (!file) throw new StaticSnapshotNotPrecomputedError();
    return this.json(`${pinned.base}${file}`, { signal }) as Promise<WeaponAnalyticsResponse>;
  }
}
