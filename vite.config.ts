import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.VERCEL === '1' ? '/' : '/valorant-squad-analytics/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // Disposable PGlite databases apply every migration; under full parallel load this exceeds 5s.
    testTimeout: 30_000,
  },
});
