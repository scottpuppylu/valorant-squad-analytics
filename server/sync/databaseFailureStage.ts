/**
 * TASK-DATA-BULK-01C `database-failure-stage-v1`: sanitized server-log telemetry for sync failures that
 * are reported publicly as DATABASE_ERROR. The public API response is unchanged.
 *
 * Logged fields are LABELS ONLY: stage, sync kind, deep history phase, a coarse error kind and, for
 * PostgreSQL errors, the 5-character SQLSTATE class code. Never: account/player/run/match ids, names,
 * cursor values, page numbers, SQL text or parameters, raw error messages or stack traces.
 */
import { ConsentingParticipantAbsentError } from '../persistence/errors.js';

export const DATABASE_FAILURE_STAGE_VERSION = 'database-failure-stage-v1' as const;

export type DatabaseFailureStage =
  | 'persist_sync_page'
  | 'season_fill'
  | 'cursor_success_commit'
  | 'pagination_pause_commit'
  | 'failure_commit';

export type DatabaseFailureKind = 'consenting_participant_absent' | 'lease_lost' | 'postgres' | 'connection' | 'code_or_data_shape' | 'other';


const sqlStatePattern = /^[0-9A-Z]{5}$/u;
const connectionCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN']);

export function classifyDatabaseFailure(error: unknown): { errorKind: DatabaseFailureKind; sqlState?: string } {
  if (error instanceof ConsentingParticipantAbsentError) return { errorKind: 'consenting_participant_absent' };
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined;
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('Sync lease was lost')) return { errorKind: 'lease_lost' };
  if (code && connectionCodes.has(code)) return { errorKind: 'connection' };
  if (code && sqlStatePattern.test(code)) return { errorKind: code.startsWith('08') || code.startsWith('57') ? 'connection' : 'postgres', sqlState: code };
  if (/connection|terminated|socket|websocket|timeout/iu.test(message)) return { errorKind: 'connection' };
  if (error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError) return { errorKind: 'code_or_data_shape' };
  return { errorKind: 'other' };
}

export function logDatabaseFailure(stage: DatabaseFailureStage, syncKind: string, historyPhase: string | undefined, error: unknown): void {
  const { errorKind, sqlState } = classifyDatabaseFailure(error);
  process.stdout.write(`${JSON.stringify({
    event: 'sync_database_failure', failureStageVersion: DATABASE_FAILURE_STAGE_VERSION,
    stage, syncKind, ...(historyPhase ? { historyPhase } : {}), errorKind, ...(sqlState ? { sqlState } : {}),
  })}\n`);
}
