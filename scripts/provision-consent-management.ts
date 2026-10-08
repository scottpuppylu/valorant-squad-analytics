import { unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  consentCredentialVersion,
  consentManagementCredentialHmac,
  createConsentManagementCredential,
} from '../server/consentManagementCredential.js';
import { createDatabase } from '../server/db/runtime.js';

const publicPlayerId = process.env.CONSENT_PROVISION_PLAYER_ID;
const outputPath = process.env.CONSENT_PROVISION_OUTPUT_PATH;
const hmacKey = process.env.IDENTIFIER_HMAC_KEY;
if (!process.env.DATABASE_URL || !hmacKey || !publicPlayerId || !outputPath) {
  throw new Error('Operator provisioning requires database, HMAC, explicit player ID, and output path settings.');
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(publicPlayerId)) {
  throw new Error('CONSENT_PROVISION_PLAYER_ID must be a public application UUID.');
}
if (!isAbsolute(outputPath)) throw new Error('CONSENT_PROVISION_OUTPUT_PATH must be an absolute path outside the repository.');
const resolvedOutput = resolve(outputPath);
const repositoryRoot = resolve('.');
const relativeOutput = relative(repositoryRoot, resolvedOutput);
if (relativeOutput === '' || (!relativeOutput.startsWith('..') && !isAbsolute(relativeOutput))) {
  throw new Error('Credential output must be outside the repository.');
}

const database = createDatabase();
if (!database) throw new Error('Database is unavailable.');
const credential = createConsentManagementCredential();
const issuedAt = new Date().toISOString();
try {
  try {
    await database.transaction(async (transaction) => {
      const updated = await transaction.query(
        `UPDATE consents c SET management_credential_hmac=$2,
           management_credential_version=$3, management_credential_issued_at=$4
         FROM players p
         WHERE c.player_id=p.id AND p.public_id=$1 AND p.anonymized_at IS NULL
           AND c.status='active' AND c.management_credential_hmac IS NULL`,
        [publicPlayerId, consentManagementCredentialHmac(credential, hmacKey), consentCredentialVersion, issuedAt],
      );
      if (updated.rowCount !== 1) throw new Error('Exactly one active legacy consent without a credential was required.');
      await writeFile(resolvedOutput, credential, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    });
  } catch (error) {
    await unlink(resolvedOutput).catch(() => undefined);
    throw error;
  }
  process.stdout.write('Consent management credential provisioned to the explicit external output path.\n');
} finally {
  await database.close();
}
