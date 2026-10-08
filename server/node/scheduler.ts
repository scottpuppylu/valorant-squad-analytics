/**
 * TASK-INFRA-DATABASE-PORTABILITY-01 VPS scheduler: replaces Vercel Cron with the SAME two daily jobs and the
 * SAME authenticated endpoints (`/api/valorant/cron/{recent,history}`, Bearer CRON_SECRET). It only fires the
 * existing bounded job handlers (leases, budgets, backoff unchanged); it never calls a provider itself.
 * Schedules are UTC, identical to vercel.json: recent 18:05, history 18:35.
 */
export interface ScheduleEntry { job: 'recent' | 'history'; hourUtc: number; minuteUtc: number }
export const SCHEDULE: ScheduleEntry[] = [
  { job: 'recent', hourUtc: 18, minuteUtc: 5 },
  { job: 'history', hourUtc: 18, minuteUtc: 35 },
];

/** Next run strictly after `now` (deterministic, testable). */
export function nextRun(entry: ScheduleEntry, now: Date): Date {
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), entry.hourUtc, entry.minuteUtc, 0, 0));
  if (candidate.getTime() <= now.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 1);
  return candidate;
}

export async function fire(entry: ScheduleEntry, baseUrl: string, secret: string, fetchImpl: typeof fetch = fetch): Promise<{ job: string; status: number }> {
  const response = await fetchImpl(`${baseUrl}/api/valorant/cron/${entry.job}`, {
    headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(70_000),
  });
  return { job: entry.job, status: response.status };
}

async function main() {
  const baseUrl = process.env.SCHEDULER_TARGET_URL ?? 'http://app:3000';
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET is required for the scheduler.');
  const loop = (entry: ScheduleEntry) => {
    const delay = nextRun(entry, new Date()).getTime() - Date.now();
    setTimeout(async () => {
      try {
        const result = await fire(entry, baseUrl, secret);
        process.stdout.write(`${JSON.stringify({ event: 'scheduled_job', ...result })}\n`);
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ event: 'scheduled_job_failed', job: entry.job, errorKind: error instanceof Error ? error.name : 'unknown' })}\n`);
      }
      loop(entry);
    }, delay);
  };
  for (const entry of SCHEDULE) loop(entry);
  process.stdout.write(`${JSON.stringify({ event: 'scheduler_started', jobs: SCHEDULE.map((e) => e.job) })}\n`);
}

if (process.argv[1]?.endsWith('scheduler.js') || process.argv[1]?.endsWith('scheduler.ts')) void main();
