import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // The annotate-stream module synchronously imports three frequency JSON
    // dictionaries (~6 MB total). When the full monorepo test suite runs all
    // workspaces in parallel via turbo, that import phase can stretch worker
    // startup past vitest's default 10 s `beforeEach` budget for unrelated
    // files like admin.test.ts. 30 s gives comfortable headroom without
    // masking real hangs.
    hookTimeout: 30_000,
  },
});
