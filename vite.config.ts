import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Asset base path. GitHub Pages (Demo/rollback) serves the repository subpath; Vercel and the VPS Production
 * stack (APP_BASE_PATH=/, TASK-INFRA-DATABASE-PORTABILITY-01) serve the site root.
 */
function basePath(): string {
  const explicit = process.env.APP_BASE_PATH;
  if (explicit !== undefined) {
    if (!/^\/([A-Za-z0-9._-]+\/)*$/u.test(explicit)) throw new Error('APP_BASE_PATH must be "/" or "/segment/".');
    return explicit;
  }
  return process.env.VERCEL === '1' ? '/' : '/valorant-squad-analytics/';
}

export default defineConfig({
  base: basePath(),
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // Disposable PGlite databases apply every migration; under full parallel load this exceeds 5s.
    testTimeout: 30_000,
  },
});
