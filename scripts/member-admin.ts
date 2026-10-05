// TASK-IDENTITY-01 maintainer-only member administration. Run locally by the server operator:
//   npm run member:admin -- list
//   npm run member:admin -- check
//   npm run member:admin -- rename-member --member <memberPublicId> --name "<community name>" --confirm
//   npm run member:admin -- link-account --account <accountPublicId> --member <memberPublicId> --confirm
//   npm run member:admin -- set-primary --account <accountPublicId> --confirm
//   npm run member:admin -- set-nickname --member <memberPublicId> --nickname "<nickname>" --confirm
//   npm run member:admin -- clear-nickname --member <memberPublicId> --confirm
//   npm run member:admin -- plan-names --mapping ops/community-names-2026-10-06.json        (read-only)
//   npm run member:admin -- apply-names --mapping ops/community-names-2026-10-06.json --confirm
// Requires server-side DATABASE_URL. Never deployed as an API, never bundled into the browser, and
// never prints internal ids, PUUIDs, HMACs, credentials or secrets.
import { readFileSync } from 'node:fs';
import { createNeonDatabase } from '../server/db/neon.js';
import { MemberAdminError, MemberAdminService, type CommunityNameMapping } from '../server/identity/memberAdminService.js';

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
const mappingFile = (): CommunityNameMapping[] => {
  const path = option('mapping');
  if (!path) throw new Error('--mapping <json file> is required.');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item?.gameName === 'string' && typeof item?.communityName === 'string')) {
    throw new Error('Mapping must be a JSON array of { gameName, communityName }.');
  }
  return parsed as CommunityNameMapping[];
};

type Action = (admin: MemberAdminService) => Promise<unknown>;

/** Parses and validates every argument (including --confirm) BEFORE any database connection. */
function parseAction(): Action {
  switch (command) {
    case 'list': return (admin) => admin.list();
    case 'check': return (admin) => admin.invariants();
    case 'rename-member': {
      const member = publicId('member');
      const name = option('name');
      if (name === undefined) throw new Error('--name is required.');
      requireConfirm();
      return (admin) => admin.renameMember(member, name);
    }
    case 'set-nickname': {
      const member = publicId('member');
      const nickname = option('nickname');
      if (nickname === undefined) throw new Error('--nickname is required (use clear-nickname to remove it).');
      requireConfirm();
      return (admin) => admin.setNickname(member, nickname);
    }
    case 'clear-nickname': {
      const member = publicId('member');
      requireConfirm();
      return (admin) => admin.clearNickname(member);
    }
    case 'plan-names': {
      // Read-only: exact game-name resolution of an approved mapping file; writes nothing.
      const mapping = mappingFile();
      return (admin) => admin.planCommunityNames(mapping);
    }
    case 'apply-names': {
      const mapping = mappingFile();
      requireConfirm();
      return (admin) => admin.applyCommunityNames(mapping);
    }
    case 'link-account': {
      const account = publicId('account');
      const member = publicId('member');
      requireConfirm();
      return (admin) => admin.linkAccount(account, member);
    }
    case 'set-primary': {
      const account = publicId('account');
      requireConfirm();
      return (admin) => admin.setPrimary(account);
    }
    default:
      throw new Error('Commands: list | check | rename-member | set-nickname | clear-nickname | plan-names | apply-names | link-account | set-primary');
  }
}

let action: Action;
try {
  action = parseAction();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Invalid arguments.'}\n`);
  process.exit(2);
}
const database = createNeonDatabase();
if (!database) {
  process.stderr.write('DATABASE_URL is required (server operator only).\n');
  process.exit(2);
}
try {
  print(await action(new MemberAdminService(database)));
} catch (error) {
  if (error instanceof MemberAdminError) {
    print({ ok: false, code: error.code, message: error.message });
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : 'Member admin failed.'}\n`);
  }
  process.exitCode = 1;
} finally {
  await database.close();
}
