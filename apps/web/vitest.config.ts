import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Keep Vitest out of the Playwright suite. `e2e/**/*.spec.ts` is run by
    // `pnpm test:e2e`; Vitest tries to load Playwright's `test()` and fails.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
