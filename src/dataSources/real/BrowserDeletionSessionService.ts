import type { DeletionResponse, PublicDeletionProgress } from '../server/contracts';
import { valorantBackendClient } from '../server/ValorantBackendClient';
import { BrowserConsentCredentialRepository, type StoredDeletionSession } from './BrowserConsentCredentialRepository';
import { BrowserRealDatasetRepository } from './BrowserRealDatasetRepository';

export interface DeletionSessionApi {
  deletionStatus(jobId: string, managementCredential: string): Promise<DeletionResponse>;
  continueDeletion(jobId: string, managementCredential: string): Promise<DeletionResponse>;
}

export interface DeletionSessionUpdate {
  deletion: PublicDeletionProgress;
  session: StoredDeletionSession | null;
}

export class BrowserDeletionSessionService {
  constructor(
    private readonly credentials: BrowserConsentCredentialRepository,
    private readonly realDataset: Pick<BrowserRealDatasetRepository, 'remove'>,
    private readonly api: DeletionSessionApi,
  ) {}

  acceptRevocation(
    playerId: string,
    managementCredential: string,
    deletion: PublicDeletionProgress,
    acceptedAt = new Date().toISOString(),
  ): DeletionSessionUpdate {
    try {
      if (deletion.status === 'complete') {
        this.credentials.remove();
        return { deletion, session: null };
      }
      this.credentials.saveDeletionSession(playerId, managementCredential, deletion.jobId, acceptedAt);
      return { deletion, session: this.requireStoredSession() };
    } finally {
      this.realDataset.remove();
    }
  }

  async checkStatus(): Promise<DeletionSessionUpdate | null> {
    const session = this.loadSession();
    if (!session) return null;
    const response = await this.api.deletionStatus(session.deletionJobId, session.managementCredential);
    return this.applyResponse(session, response);
  }

  async continueDeletion(): Promise<DeletionSessionUpdate | null> {
    const session = this.loadSession();
    if (!session) return null;
    const response = await this.api.continueDeletion(session.deletionJobId, session.managementCredential);
    return this.applyResponse(session, response);
  }

  private loadSession(): StoredDeletionSession | null {
    const stored = this.credentials.load();
    if (!stored?.revocationAccepted) return null;
    this.realDataset.remove();
    return stored;
  }

  private requireStoredSession(): StoredDeletionSession {
    const session = this.loadSession();
    if (!session) throw new Error('無法保存資料刪除工作狀態。');
    return session;
  }

  private applyResponse(session: StoredDeletionSession, response: DeletionResponse): DeletionSessionUpdate {
    if (response.deletion.jobId !== session.deletionJobId) throw new Error('資料刪除工作識別不一致。');
    if (response.deletion.status === 'complete') {
      this.credentials.remove();
      return { deletion: response.deletion, session: null };
    }
    return { deletion: response.deletion, session };
  }
}

function browserService(): BrowserDeletionSessionService | null {
  if (typeof window === 'undefined') return null;
  try {
    return new BrowserDeletionSessionService(
      new BrowserConsentCredentialRepository(window.localStorage),
      new BrowserRealDatasetRepository(window.localStorage),
      valorantBackendClient,
    );
  } catch {
    return null;
  }
}

export function acceptBrowserRevocation(
  playerId: string,
  managementCredential: string,
  deletion: PublicDeletionProgress,
): DeletionSessionUpdate {
  const service = browserService();
  if (!service) throw new Error('目前瀏覽器無法保存資料刪除工作狀態。');
  return service.acceptRevocation(playerId, managementCredential, deletion);
}

export async function checkBrowserDeletionStatus(): Promise<DeletionSessionUpdate | null> {
  return browserService()?.checkStatus() ?? null;
}

export async function continueBrowserDeletion(): Promise<DeletionSessionUpdate | null> {
  return browserService()?.continueDeletion() ?? null;
}
