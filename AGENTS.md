# Language Drill — Agent Instructions

## Cursor Cloud specific instructions

### Quick reference

Standard dev commands are documented in `.cursorrules` / `CLAUDE.md`. Key ones:

| Task | Command |
|---|---|
| Install deps | `pnpm install` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Test | `pnpm test` |
| Dev servers | `pnpm dev` (API :3001 + stream :3002 + web :3000) |
| Migrate DB | `pnpm db:migrate` |
| Seed exercises | `pnpm db:seed:exercises` |

### Local database setup (Neon WebSocket proxy)

The codebase uses `@neondatabase/serverless` which connects via WebSocket, not plain TCP.
A local Postgres alone won't work — you need the **Neon WebSocket proxy** in front of it.

**Required infrastructure (already installed in the VM snapshot):**

1. **Docker** — runs Postgres 17 + the `local-neon-http-proxy` container.
2. **nginx** — TLS-terminates `wss://localhost/v2` and forwards to the proxy on port 4444.
   The Neon driver defaults to `wss://` (secure WebSocket), so nginx with a self-signed cert
   bridges the gap without code changes.

**Startup sequence (run before `pnpm dev`):**

```bash
# 1. Start Docker daemon (if not already running)
sudo dockerd > /tmp/dockerd.log 2>&1 &
sleep 5

# 2. Start Postgres + Neon proxy containers
docker compose -f docker-compose.dev.yml up -d

# 3. Start nginx TLS proxy (if not already running)
sudo nginx 2>/dev/null || true
```

**Environment variable:** `NODE_TLS_REJECT_UNAUTHORIZED=0` must be set in `.env` (or exported)
so the self-signed cert is accepted by Node.js. The `.env` file should have at minimum:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/langdrill
NODE_TLS_REJECT_UNAUTHORIZED=0
ADMIN_USER_IDS=dev_user_001
```

### Auth bypass

The local API server (`pnpm dev:api`) injects `userId = dev_user_001` and skips JWT verification.
The Next.js frontend (`pnpm dev:web`) still requires Clerk keys to render past the sign-in page.
Without `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, the frontend shows a Clerk sign-in modal.
API-level testing (curl, automated tests) works fully without Clerk keys.

### Streaming-annotate Lambda

`pnpm dev:stream` (port 3002) requires `ANTHROPIC_API_KEY` to start. If the key is unset,
the stream server exits on startup but the other two services (API + web) continue normally.

### Build before seed

`pnpm db:seed:exercises` (and other scripts in `packages/db/scripts/`) require built
`dist/` artifacts from `@language-drill/shared` and `@language-drill/ai`. Run `pnpm build`
at least once before running seed scripts for the first time.

### Tests

All tests run via `pnpm test` (Vitest). The test suite does NOT need a running database —
tests mock the DB layer. As of the last run: 244 test files, ~2600+ tests pass.
The `@language-drill/db` package has 4 skipped test files (integration tests that need a
live database with specific data).
