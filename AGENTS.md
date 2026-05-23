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
- **Frontend requires Clerk auth** — the local API bypasses auth, but the web app at `localhost:3000` requires a valid Clerk sign-in. To interact with the frontend UI, sign in via the Clerk dev instance. For API-only testing, use `curl` against `localhost:3001` directly.
- **`pnpm build` must run before scripts that import workspace packages** (e.g. `pnpm db:seed:exercises`) because they resolve `dist/index.js`. The `pnpm test` and `pnpm typecheck` tasks handle this automatically via Turborepo's `dependsOn`.
- **`.env` at repo root** is used by `dotenv-cli` for all `pnpm dev:*` and `pnpm db:*` commands. Required keys: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. Optional: `LANGFUSE_*`, `UPSTASH_*`.

### Lint / typecheck / test

Standard commands documented in `CLAUDE.md` under "Pre-Push Checks":

```bash
pnpm lint        # ESLint across all packages
pnpm typecheck   # tsc --noEmit across all packages
pnpm test        # Vitest across all packages
```

All three must pass before pushing. Tests run against the real Neon dev database.
