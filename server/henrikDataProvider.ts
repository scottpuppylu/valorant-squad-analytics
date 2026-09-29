import type { AccountResolutionResult, ConnectionInput, MatchImportInput, MatchImportResult, ProviderStatus, ValorantDataProvider } from './contracts.js';
import { PublicApiError } from './errors.js';
import { normalizeHenrikMatches } from './normalizeHenrik.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface ProviderOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  retries?: number;
  delay?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
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

export class HenrikDataProvider implements ValorantDataProvider {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(private readonly apiKey: string | undefined, options: ProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.retries = options.retries ?? 1;
    this.wait = options.delay ?? delay;
    this.now = options.now ?? (() => new Date());
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
    const payload = await this.request(`/valorant/v2/account/${encodeURIComponent(input.gameName)}/${encodeURIComponent(input.tag)}`);
    if (!isRecord(payload) || !isRecord(payload.data)) {
      throw new PublicApiError(502, 'MALFORMED_PROVIDER_RESPONSE', '資料服務回應缺少可用的帳號資料。');
    }
    const data = payload.data;
    if (typeof data.name !== 'string' || typeof data.tag !== 'string') {
      throw new PublicApiError(502, 'MALFORMED_PROVIDER_RESPONSE', '資料服務回應缺少可用的帳號資料。');
    }
    return {
      account: {
        gameName: data.name,
        tag: data.tag,
        affinity: input.affinity,
        accountLevel: typeof data.account_level === 'number' ? data.account_level : undefined,
      },
    };
  }

  async importMatches(input: MatchImportInput): Promise<MatchImportResult> {
    const payload = await this.request(
      `/valorant/v4/matches/${encodeURIComponent(input.affinity)}/pc/${encodeURIComponent(input.gameName)}/${encodeURIComponent(input.tag)}`,
      { size: String(input.limit) },
    );
    const dataset = normalizeHenrikMatches(payload, input);
    return { dataset, importedMatches: dataset.matches.length, importedAt: this.now().toISOString() };
  }
}

export function createHenrikDataProvider(): HenrikDataProvider {
  return new HenrikDataProvider(process.env.HENRIK_API_KEY);
}
