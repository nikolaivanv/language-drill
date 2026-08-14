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
    // 251 jsdom files, each paying a fresh `environment` setup. The root
    // `pnpm test` runs `turbo run test --concurrency=4`, so up to four
    // workspaces spin their own vitest worker pools at once — on an 8-core box
    // that oversubscribes badly (one observed run: 284 s wall against 454 s of
    // `tests` and 777 s of `environment`). Starved that hard, even a fully
    // SYNCHRONOUS test body — `fireEvent` + a `toHaveClass` assertion, nothing
    // to await — can exceed vitest's 5 s default and fail as
    // `Test timed out in 5000ms`. The failure moves between files run to run
    // (observed on step-goals and grammar-point-combobox) and never reproduces
    // standalone, which is the tell that it is contention, not logic.
    //
    // Same diagnosis and same remedy as `infra/lambda/vitest.config.ts`
    // (testTimeout 30 s) and `infra/vitest.config.ts` (#359). 30 s is pure
    // headroom for sync tests; a genuinely stuck async test still aborts.
    testTimeout: 30_000,
  },
});
