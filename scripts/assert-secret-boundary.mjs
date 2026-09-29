import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const forbidden = 'HENRIK_API_KEY';
const textExtensions = new Set(['.js', '.css', '.html', '.map', '.ts', '.tsx']);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return files.flat();
}

async function assertAbsent(directory) {
  const files = (await walk(directory)).filter((file) => textExtensions.has(extname(file)));
  for (const file of files) {
    if ((await readFile(file, 'utf8')).includes(forbidden)) {
      throw new Error(`Server-only environment variable name found in browser artifact: ${file}`);
    }
  }
}

async function assertServerDoesNotLog() {
  const files = (await walk('server')).filter((file) => ['.ts', '.js'].includes(extname(file)));
  for (const file of files) {
    if (/\bconsole\s*\./u.test(await readFile(file, 'utf8'))) {
      throw new Error(`Server provider path must not log request or secret material: ${file}`);
    }
  }
}

await assertAbsent('src');
if (process.argv.includes('--dist')) await assertAbsent('dist');
await assertServerDoesNotLog();
console.log('Secret boundary check passed.');
