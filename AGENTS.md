# AGENTS.md

See `CLAUDE.md` for full project guide, tech stack, and conventions.

## Cursor Cloud specific instructions

### Services overview

| Service | Command | Port | Notes |
|---|---|---|---|
| Hono API | `pnpm dev:api` | 3001 | Auth bypassed locally (uses `DEV_USER_ID` env or default) |
| Streaming annotate | `pnpm dev:stream` | 3002 | SSE for reading annotation; see caveat below |
| Next.js web | `pnpm dev:web` | 3000 | Clerk auth enforced on frontend routes |
| All three | `pnpm dev` | — | Uses `concurrently` |

### Known caveats

- **Streaming annotate server (`pnpm dev:stream`)** fails to start with `ReferenceError: awslambda is not defined`. This is a pre-existing ESM import-hoisting issue in `infra/lambda/src/annotate-stream/dev.ts` — the `globalThis.awslambda` stub runs after the handler import is hoisted. The API and web servers work correctly without it; only the "Read & Annotate" feature is affected.
- **Frontend requires Clerk auth** — the local API bypasses auth, but the web app at `localhost:3000` requires a valid Clerk sign-in. The injected Clerk keys are a **test** instance (`pk_test_`/`sk_test_`), so you can sign up/in through the UI with no real inbox: use any `<anything>+clerk_test@example.com` email and the fixed verification code `424242` (Clerk test-mode bypass). The local API ignores the signed-in Clerk identity and always serves the seeded `DEV_USER_ID` data, so any test sign-in lands on a working, pre-seeded dashboard. For API-only testing, use `curl` against `localhost:3001` directly.
- **`pnpm build` must run before anything that resolves workspace `dist/`** — this includes scripts like `pnpm db:seed:exercises` **and** the dev servers (`pnpm dev:api` imports `@language-drill/db`, which resolves to `packages/db/dist/index.js`). The update script runs `pnpm build`, so a fresh VM is ready; only re-run `pnpm build` if you change a `packages/*` source file. `pnpm test`/`pnpm typecheck` build automatically via Turborepo's `dependsOn`.
- **No `.env` file is needed in Cloud.** Secrets are injected as real environment variables, and the `dotenv -e .env` wrapper used by every `pnpm dev:*` / `pnpm db:*` command falls back to `process.env` when `.env` is absent (it does not error). Injected keys include `DATABASE_URL`, `ANTHROPIC_API_KEY`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET`, `LANGFUSE_*`, `UPSTASH_*`, `ADMIN_USER_IDS`. `db:migrate`/`db:seed:exercises` run against the real Neon dev DB and are idempotent.
- **E2E (Playwright)** additionally needs `E2E_CLERK_USER_EMAIL` (must contain `+clerk_test`) and `E2E_CLERK_USER_PASSWORD`, plus a one-time `pnpm --filter @language-drill/web test:e2e:install` for browsers — neither is provided by default, so the Vitest suites above are the standing automated checks.

### Lint / typecheck / test

Standard commands documented in `CLAUDE.md` under "Pre-Push Checks":

```bash
pnpm lint        # ESLint across all packages
pnpm typecheck   # tsc --noEmit across all packages
pnpm test        # Vitest across all packages
```

All three must pass before pushing. Tests run against the real Neon dev database.
