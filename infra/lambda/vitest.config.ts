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
    // past 60 s on the first two tests in a worker. The real "hang" guard
    // is the 29 s Lambda timeout in prod — vitest's hookTimeout is just
    // there to abort genuinely stuck async tests. 120 s gives comfortable
    // headroom under CI contention.
    hookTimeout: 120_000,
  },
});
