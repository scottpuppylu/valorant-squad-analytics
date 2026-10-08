import { readFileSync, writeFileSync } from 'node:fs';
import { createDatabase } from '../server/db/runtime.js';
import { paritySummaryUtc, parityDifferences, type ParitySummary } from '../server/db/parity.js';

/**
 * Deterministic parity tool (read-only). Usage:
 *   DATABASE_URL=... node dist-server/scripts/database-parity.js summary  > summary.json
 *   node dist-server/scripts/database-parity.js compare source.json target.json   (exit 1 on ANY difference)
 * The summary contains counts and digests only — no row values, identifiers or secrets.
 */
const [mode, a, b] = process.argv.slice(2);
if (mode === 'compare') {
  if (!a || !b) throw new Error('compare needs two summary files.');
  const differences = parityDifferences(JSON.parse(readFileSync(a, 'utf8')) as ParitySummary, JSON.parse(readFileSync(b, 'utf8')) as ParitySummary);
  process.stdout.write(`${JSON.stringify({ event: 'database_parity', identical: differences.length === 0, differences })}\n`);
  process.exitCode = differences.length === 0 ? 0 : 1;
} else if (mode === 'summary') {
  const database = createDatabase({ max: 1 });
  if (!database) throw new Error('DATABASE_URL is required.');
  try {
    const summary = await paritySummaryUtc(database);
    if (a) writeFileSync(a, `${JSON.stringify(summary, null, 2)}\n`); else process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally { await database.close(); }
} else {
  throw new Error('Usage: database-parity summary [out.json] | compare source.json target.json');
}
