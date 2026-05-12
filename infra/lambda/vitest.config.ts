import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // The annotate-stream module synchronously imports three frequency JSON
    // dictionaries (~6 MB total). Phase 4 (theory generation) added ~80 more
    // co-located tests, further inflating per-worker import cost. When the
    // full monorepo suite runs all workspaces in parallel via turbo, the
    // `await import('./admin')` inside admin.test.ts's `beforeEach` stretches
    // past 30 s on the first two tests in a worker. 60 s gives comfortable
    // headroom without masking real hangs.
    hookTimeout: 60_000,
  },
});
