import { createDatabase } from '../server/db/runtime.js';
import { seedBenchAccounts, seedBenchMatches } from '../tests/support/analysisBenchFixture.js';

/**
 * LOCAL rehearsal only: seeds the repository's deterministic realistic fixture (fictional identifiers) into a
 * DISPOSABLE PostgreSQL. Refuses to run unless the target is a loopback address — never a Production database.
 */
const url = process.env.DATABASE_URL ?? '';
const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) throw new Error('rehearsal-seed only targets a local disposable database.');
const matches = Number(process.env.REHEARSAL_MATCHES ?? 600);
if (!Number.isSafeInteger(matches) || matches < 1 || matches > 20_000) throw new Error('REHEARSAL_MATCHES must be 1..20000.');
// Optional REHEARSAL_ACCOUNTS: N independent 1:1 members (e.g. 9 to mirror the community); default 7 accounts / 6 members.
const accountsRaw = process.env.REHEARSAL_ACCOUNTS;
const accounts = accountsRaw === undefined ? 7 : Number(accountsRaw);
if (!Number.isSafeInteger(accounts) || accounts < 2 || accounts > 12) throw new Error('REHEARSAL_ACCOUNTS must be 2..12.');
const linkAccounts: [number, number][] = accountsRaw === undefined ? [[6, 1]] : [];
const database = createDatabase({ max: 2 });
if (!database) throw new Error('DATABASE_URL is required.');
try {
  await seedBenchAccounts(database, { matches, accounts, linkAccounts });
  const counts = await seedBenchMatches(database, { matches, accounts, seed: 77 });
  process.stdout.write(`${JSON.stringify({ event: 'rehearsal_seed', ...counts })}\n`);
} finally { await database.close(); }
