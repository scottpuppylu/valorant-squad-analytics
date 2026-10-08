import { isIP } from 'node:net';

/**
 * The static exporter reads only the LOCAL source of truth: loopback, a private (RFC 1918 / ULA) address, or a
 * single-label container name (e.g. `postgres` on the Compose network). Managed / public hosts are refused,
 * so an export can never read a remote Production database (e.g. Neon).
 */
export function isLocalDatabaseHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/gu, '').toLowerCase();
  if (bare === 'localhost' || bare === '::1') return true;
  if (isIP(bare) === 4) {
    const [a, b] = bare.split('.').map(Number) as [number, number];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (isIP(bare) === 6) return bare.startsWith('fc') || bare.startsWith('fd');
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(bare);
}
