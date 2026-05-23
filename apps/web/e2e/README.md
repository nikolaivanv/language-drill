# `apps/web/e2e/`

Playwright end-to-end suite for the web app. See [`docs/testing.md`](../../../docs/testing.md)
for the full guide — defaults, helpers, env vars, CI notes.

## Quick start

```bash
# One-time: download Playwright's browser binaries
pnpm --filter @language-drill/web test:e2e:install

# Run the suite (spawns next dev on :3000)
pnpm --filter @language-drill/web test:e2e
```

The `.auth/` directory holds the cached storage state and the test-user
manifest produced by `auth.setup.ts`. It is gitignored — never commit it.
