---
name: verify
description: Runtime-verification recipe for language-drill — how to drive the local stack and capture evidence for API + web UI changes
---

# Verifying language-drill changes at runtime

## Stack

`pnpm dev` from the repo root (background it) → API :3001, streaming-annotate :3002, web :3000.
Wait for `curl -s localhost:3001/health` → `{"status":"ok"}` (~1 s). Both `/.env` and
`apps/web/.env` must exist (copy from the main checkout in a fresh worktree).

## API surface

The local API bypasses auth (`dev_user_001`) — plain `curl localhost:3001/<route>` works for
any authed endpoint. POST with `-H 'Content-Type: application/json'`. Writes go to the Neon
dev branch (fine for verification).

## Web surface — three tiers

1. **`pnpm --filter @language-drill/web shoot --route <path>`** — seeded-MOCK screenshot.
   Mocks come from `e2e/helpers/seed-mocks.ts`; an endpoint not seeded there renders as
   missing/loading. Good for pure-layout checks only.
2. **`... shoot --route <path> --full-stack --wait "<selector>"`** — real backend via the
   running dev stack (`reuseExistingServer` picks up your :3000). `--wait text=...` doubles
   as an existence assertion: it fails loudly if the element never renders. Screenshot is
   viewport-top + fullPage; content inside internal scrollers (e.g. `.theory-scroll`) below
   the fold won't show.
3. **Temp spec in the authenticated project** — for scrolling, clicking, or reading values.
   Drop `<name>.temp.spec.ts` into `apps/web/e2e/tests/authenticated/` (that project's
   testDir), then `cd apps/web && pnpm exec playwright test <name>.temp --project=authenticated`,
   delete the file after. Auth + Clerk handshake are handled by the project's storageState.

## Traps

- NEVER drive `localhost:3000` with a raw Playwright context, even with the storageState
  file — Clerk's dev-browser handshake loops forever. Always go through the Playwright
  projects above.
- A shoot without `--wait` can capture the loading state — pass a content selector.
- Failed runs leave `apps/web/test-results/<test>/` with `error-context.md` (page a11y
  snapshot), `test-failed-1.png`, and `trace.zip`; `unzip trace.zip` and grep
  `0-trace.network` for `"url":"..."` to see what the browser actually requested —
  this is how a wrong-URL bug (double language prefix) was caught.
