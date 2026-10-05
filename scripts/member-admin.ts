// TASK-IDENTITY-01 maintainer-only member administration. Run locally by the server operator:
//   npm run member:admin -- list
//   npm run member:admin -- check
//   npm run member:admin -- rename-member --member <memberPublicId> --name "<community name>" --confirm
//   npm run member:admin -- link-account --account <accountPublicId> --member <memberPublicId> --confirm
//   npm run member:admin -- set-primary --account <accountPublicId> --confirm
// Requires server-side DATABASE_URL. Never deployed as an API, never bundled into the browser, and
// never prints internal ids, PUUIDs, HMACs, credentials or secrets.
import { createNeonDatabase } from '../server/db/neon.js';
import { MemberAdminError, MemberAdminService } from '../server/identity/memberAdminService.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const [command, ...rest] = process.argv.slice(2);
const option = (name: string) => {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 ? rest[index + 1] : undefined;
};
const publicId = (name: string) => {
  const value = option(name);
  if (!value || !uuid.test(value)) throw new Error(`--${name} <public uuid> is required.`);
  return value;
};
const requireConfirm = () => {
  if (!rest.includes('--confirm')) throw new Error('This changes durable identity data; re-run with --confirm.');
};
const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

const database = createNeonDatabase();
if (!database) throw new Error('DATABASE_URL is required (server operator only).');
const admin = new MemberAdminService(database);
try {
  switch (command) {
    case 'list': print(await admin.list()); break;
    case 'check': print(await admin.invariants()); break;
    case 'rename-member': {
      const member = publicId('member');
      const name = option('name');
      if (name === undefined) throw new Error('--name is required.');
      requireConfirm();
      print(await admin.renameMember(member, name));
      break;
    }
    case 'link-account': {
      const account = publicId('account');
      const member = publicId('member');
      requireConfirm();
      print(await admin.linkAccount(account, member));
      break;
    }
    case 'set-primary': {
      const account = publicId('account');
      requireConfirm();
      print(await admin.setPrimary(account));
      break;
    }
    default:
      throw new Error('Commands: list | check | rename-member | link-account | set-primary');
  }
} catch (error) {
  if (error instanceof MemberAdminError) {
    print({ ok: false, code: error.code, message: error.message });
    process.exitCode = 1;
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : 'Member admin failed.'}\n`);
    process.exitCode = 1;
  }
} finally {
  await database.close();
}
