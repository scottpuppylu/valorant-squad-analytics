import {
  henrikMmrFieldPaths,
  henrikMmrHistoryFieldPaths,
  henrikStoredMatchFieldPaths,
  summarizeHenrikFields,
  summarizeHenrikV4DetailFields,
  summarizeHenrikV4Fields,
} from '../src/dataSources/thirdParty/henrikV4.js';
import type { AccountResolutionResult, ConnectionInput, MatchImportInput, MatchImportResult, ProviderAuditEndpoint, ProviderEvidenceAuditResult, ProviderStatus, ValorantDataProvider } from './contracts.js';
import { PublicApiError } from './errors.js';
import { normalizeHenrikMatches } from './normalizeHenrik.js';
import type { DurableEvidenceWriter } from './persistence/durableEvidenceService.js';
import { createDurableEvidenceWriter } from './persistence/runtime.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface ProviderOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  retries?: number;
  delay?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  durableWriter?: DurableEvidenceWriter;
}

export interface HistoricalMatchProvider {
  fetchHistoryPage(input: ConnectionInput, start: number, size: number): Promise<unknown>;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizedProviderError(status: number): PublicApiError {
  if (status === 404) return new PublicApiError(404, 'ACCOUNT_NOT_FOUND', '找不到這個 Riot ID 與 Tag。');
  if (status === 429) return new PublicApiError(429, 'RATE_LIMITED', '資料服務目前請求過多，請稍後再試。');
  return new PublicApiError(502, 'PROVIDER_ERROR', '資料服務暫時無法使用，請稍後再試。');
}

function recordsAt(payload: unknown, key: string): Array<Record<string, unknown>> {
  if (!isRecord(payload) || !Array.isArray(payload[key])) return [];
  return payload[key].filter(isRecord);
}

function matchIds(payload: unknown, source: 'history' | 'stored'): string[] {
  return recordsAt(payload, 'data').flatMap((match) => {
    const container = source === 'history' ? match.metadata : match.meta;
    if (!isRecord(container)) return [];
    const value = source === 'history' ? container.match_id : container.id;
    return typeof value === 'string' ? [value] : [];
  });
}

function overlapCount(left: string[], right: string[]): number {
  const rightSet = new Set(right);
  return new Set(left.filter((value) => rightSet.has(value))).size;
}

function endpointStatus(error: unknown): ProviderAuditEndpoint['status'] {
  return error instanceof PublicApiError && error.status === 404 ? 'not-found' : 'unavailable';
}

export class HenrikDataProvider implements ValorantDataProvider {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly durableWriter: DurableEvidenceWriter | undefined;

  constructor(private readonly apiKey: string | undefined, options: ProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.retries = options.retries ?? 1;
    this.wait = options.delay ?? delay;
    this.now = options.now ?? (() => new Date());
    this.durableWriter = options.durableWriter;
  }

  status(): ProviderStatus {
    const usable = typeof this.apiKey === 'string' && this.apiKey.trim().length > 0;
    return { usable, mode: usable ? 'configured' : 'unconfigured' };
  }

  private async request(path: string, query?: Record<string, string>): Promise<unknown> {
    if (!this.status().usable || !this.apiKey) {
      throw new PublicApiError(503, 'PROVIDER_NOT_CONFIGURED', 'API 尚未設定，請聯絡網站管理員。');
    }
    const endpoint = new URL(path, 'https://api.henrikdev.xyz');
    for (const [key, value] of Object.entries(query ?? {})) endpoint.searchParams.set(key, value);

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(endpoint, {
          method: 'GET',
          headers: { Authorization: this.apiKey, Accept: 'application/json' },
          signal: controller.signal,
        });
        if (response.status === 429 || response.status === 404) throw sanitizedProviderError(response.status);
        if (!response.ok) {
          if (response.status >= 500 && attempt < this.retries) {
            await this.wait(250 * 2 ** attempt);
            continue;
          }
          throw sanitizedProviderError(response.status);
        }
        try {
          return await response.json() as unknown;
        } catch {
          throw new PublicApiError(502, 'MALFORMED_PROVIDER_RESPONSE', '資料服務回應格式不完整。');
        }
      } catch (error) {
        if (error instanceof PublicApiError) throw error;
        if (attempt < this.retries) {
          await this.wait(250 * 2 ** attempt);
          continue;
        }
        throw new PublicApiError(504, 'PROVIDER_TIMEOUT', '資料服務回應逾時，請稍後再試。');
      } finally {
        clearTimeout(timer);
      }
    }
    throw new PublicApiError(502, 'PROVIDER_ERROR', '資料服務暫時無法使用，請稍後再試。');
  }

  async resolveAccount(input: ConnectionInput): Promise<AccountResolutionResult> {
    if (this.durableWriter) await this.durableWriter.assertConnectionAllowed(input);
    const payload = await this.request(`/valorant/v2/account/${encodeURIComponent(input.gameName)}/${encodeURIComponent(input.tag)}`);
    if (!isRecord(payload) || !isRecord(payload.data)) {
      throw new PublicApiError(502, 'MALFORMED_PROVIDER_RESPONSE', '資料服務回應缺少可用的帳號資料。');
    }
    const data = payload.data;
    if (typeof data.name !== 'string' || typeof data.tag !== 'string') {
      throw new PublicApiError(502, 'MALFORMED_PROVIDER_RESPONSE', '資料服務回應缺少可用的帳號資料。');
    }
    let publicPlayerId: string | undefined;
    let managementCredential: string | undefined;
    if (this.durableWriter) {
      if (typeof data.puuid !== 'string' || data.puuid.length === 0) {
        throw new PublicApiError(502, 'MALFORMED_PROVIDER_RESPONSE', '資料服務回應缺少可用的帳號資料。');
      }
      const durable = await this.durableWriter.persistConnection(input, data.puuid, this.now().toISOString());
      publicPlayerId = durable.publicPlayerId;
      managementCredential = durable.managementCredential;
    }
    return {
      account: {
        ...(publicPlayerId ? { playerId: publicPlayerId } : {}),
        gameName: data.name,
        tag: data.tag,
        affinity: input.affinity,
        accountLevel: typeof data.account_level === 'number' ? data.account_level : undefined,
      },
      ...(managementCredential ? { managementCredential } : {}),
    };
  }

  async importMatches(input: MatchImportInput): Promise<MatchImportResult> {
    if (this.durableWriter) await this.durableWriter.assertImportAllowed(input);
    const totalStarted = performance.now();
    const providerStarted = performance.now();
    const payload = await this.request(
      `/valorant/v4/matches/${encodeURIComponent(input.affinity)}/pc/${encodeURIComponent(input.gameName)}/${encodeURIComponent(input.tag)}`,
      { size: String(input.limit) },
    );
    const providerFetchMs = Math.round(performance.now() - providerStarted);
    const publicNormalizationStarted = performance.now();
    const dataset = normalizeHenrikMatches(payload, input);
    const publicNormalizationMs = Math.round(performance.now() - publicNormalizationStarted);
    const durableWrite = this.durableWriter
      ? await this.durableWriter.persistMatches(input, payload, this.now().toISOString())
      : undefined;
    if (durableWrite?.performance) {
      process.stdout.write(`${JSON.stringify({
        event: 'durable_import_performance',
        providerFetchMs,
        publicNormalizationMs,
        durableNormalizationMs: durableWrite.performance.normalizationMs,
        dbTransactionMs: durableWrite.performance.dbTransactionMs,
        totalRequestMs: Math.round(performance.now() - totalStarted),
        sqlQueryCount: durableWrite.performance.sqlQueryCount,
        evidenceCounts: durableWrite.performance.evidenceCounts,
      })}\n`);
    }
    return { dataset, importedMatches: dataset.matches.length, importedAt: this.now().toISOString() };
  }

  async fetchHistoryPage(input: ConnectionInput, start: number, size: number): Promise<unknown> {
    return this.request(
      `/valorant/v4/matches/${encodeURIComponent(input.affinity)}/pc/${encodeURIComponent(input.gameName)}/${encodeURIComponent(input.tag)}`,
      { size: String(size), start: String(start) },
    );
  }

  async fetchStoredIndexPage(input: ConnectionInput, page: number, size: number): Promise<unknown> {
    return this.request(`/valorant/v1/stored-matches/${encodeURIComponent(input.affinity)}/${encodeURIComponent(input.gameName)}/${encodeURIComponent(input.tag)}`, { size: String(size), page: String(page) });
  }

  async fetchMatchDetail(input: ConnectionInput, matchId: string): Promise<unknown> {
    return this.request(`/valorant/v4/match/${encodeURIComponent(input.affinity)}/${encodeURIComponent(matchId)}`);
  }

  async auditEvidence(input: MatchImportInput): Promise<ProviderEvidenceAuditResult> {
    const firstHistory = await this.request(
      `/valorant/v4/matches/${encodeURIComponent(input.affinity)}/pc/${encodeURIComponent(input.gameName)}/${encodeURIComponent(input.tag)}`,
      { size: '3', start: '0' },
    );
    const firstHistoryIds = matchIds(firstHistory, 'history');
    const firstMatchId = firstHistoryIds[0];

    const optional = async (path: string, query?: Record<string, string>) => {
      try {
        return { status: 'observed' as const, payload: await this.request(path, query) };
      } catch (error) {
        return { status: endpointStatus(error), payload: undefined };
      }
    };

    const [secondHistory, storedFirst, storedSecond, mmrCurrent, mmrHistory, matchDetail] = await Promise.all([
      optional(`/valorant/v4/matches/${encodeURIComponent(input.affinity)}/pc/${encodeURIComponent(input.gameName)}/${encodeURIComponent(input.tag)}`, { size: '3', start: '3' }),
      optional(`/valorant/v1/stored-matches/${encodeURIComponent(input.affinity)}/${encodeURIComponent(input.gameName)}/${encodeURIComponent(input.tag)}`, { size: '3', page: '1' }),
      optional(`/valorant/v1/stored-matches/${encodeURIComponent(input.affinity)}/${encodeURIComponent(input.gameName)}/${encodeURIComponent(input.tag)}`, { size: '3', page: '2' }),
      optional(`/valorant/v3/mmr/${encodeURIComponent(input.affinity)}/pc/${encodeURIComponent(input.gameName)}/${encodeURIComponent(input.tag)}`),
      optional(`/valorant/v2/mmr-history/${encodeURIComponent(input.affinity)}/pc/${encodeURIComponent(input.gameName)}/${encodeURIComponent(input.tag)}`),
      firstMatchId ? optional(`/valorant/v4/match/${encodeURIComponent(input.affinity)}/${encodeURIComponent(firstMatchId)}`) : Promise.resolve({ status: 'not-found' as const, payload: undefined }),
    ]);

    const summarize = (endpoint: typeof secondHistory, paths: readonly string[]): ProviderAuditEndpoint => (
      endpoint.payload
        ? { status: endpoint.status, summary: summarizeHenrikFields([endpoint.payload], paths) }
        : { status: endpoint.status }
    );
    const secondHistoryIds = secondHistory.payload ? matchIds(secondHistory.payload, 'history') : [];
    const storedFirstIds = storedFirst.payload ? matchIds(storedFirst.payload, 'stored') : [];
    const storedSecondIds = storedSecond.payload ? matchIds(storedSecond.payload, 'stored') : [];

    return {
      schema: { provider: 'HenrikDev', endpointVersion: 'v4', openApiVersion: '4.6.0' },
      matchHistory: { status: 'observed', summary: summarizeHenrikV4Fields(firstHistory) },
      matchDetail: matchDetail.payload
        ? { status: matchDetail.status, summary: summarizeHenrikV4DetailFields(matchDetail.payload) }
        : { status: matchDetail.status },
      storedMatches: summarize(storedFirst, henrikStoredMatchFieldPaths),
      mmrCurrent: summarize(mmrCurrent, henrikMmrFieldPaths),
      mmrHistory: summarize(mmrHistory, henrikMmrHistoryFieldPaths),
      pagination: {
        v4: { size: 3, starts: [0, 3], returned: [firstHistoryIds.length, secondHistoryIds.length], overlapCount: overlapCount(firstHistoryIds, secondHistoryIds) },
        stored: { size: 3, pages: [1, 2], returned: [storedFirstIds.length, storedSecondIds.length], overlapCount: overlapCount(storedFirstIds, storedSecondIds), pageParameterDocumentedInOpenApi: false },
      },
    };
  }
}

export function createHenrikDataProvider(): HenrikDataProvider {
  return new HenrikDataProvider(process.env.HENRIK_API_KEY, { durableWriter: createDurableEvidenceWriter() });
}
