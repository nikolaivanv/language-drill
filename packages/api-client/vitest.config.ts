import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // jsdom is required by `renderHook` from `@testing-library/react`,
    // which the `usePreferences.test.ts` suite uses to drive the hooks
    // through a real React + TanStack Query render cycle. The pure-Zod
    // test files in this package do not depend on the DOM but tolerate
    // it just fine.
    environment: 'jsdom',
    globals: true,
    // Restrict discovery to source — `tsc --build` writes compiled
    // `*.test.js` into `dist/`, and without this exclude vitest would
    // pick up stale snapshots of deleted test files.
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
