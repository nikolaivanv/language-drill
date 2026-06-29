# `shoot` — Browser Verification Harness

**Date:** 2026-06-29
**Status:** Design approved, pending implementation plan

## Problem

When asked to implement UX/UI tweaks (styling, animation), agents repeatedly
report **"couldn't verify in a real browser."** The root cause is not Clerk per
se — it is that the agent reaches for `localhost:3000` in the connected Chrome
and hits the Clerk **dev-browser handshake loop**: Clerk's middleware rewrites
`/` to a 404 until the browser completes a handshake that an automated/freshly
opened tab can't reliably finish, compounded by `.next` churn (see the
`next-dist-churn-clerk-handshake-loop` memory). The agent then gives up and
ships unverified visual changes.

The pieces to solve this already exist but aren't wired into a "just let me look
at this screen" flow:

| Tool today | Auth | Backend | Driveable by agent | Repeatable |
|---|---|---|---|---|
| Playwright `authenticated` specs | real dev-Clerk session via `auth.setup.ts` → `storageState.json` | **mocked** (`page.route`→fulfill) | yes | yes |
| `claude-in-chrome` | the user's own Chrome session | real | visual/manual only | no (ephemeral) |
| Vercel preview → dev AWS + dev Neon | yes | real | **by hand only** | no |

The auth problem is **already solved and reusable**: `auth.setup.ts` mints a
real dev-Clerk session via Clerk testing tokens and persists it as
`storageState.json`. Those cookies mean there is **no in-browser handshake to
get stuck in** — the existing authenticated specs prove this works headless. The
specs simply then mock the backend.

## Goal

A repeatable, scriptable, **non-asserting** screenshot/video harness an agent can
point at any authenticated route to render it with non-empty content, capture
the result, and read it back — so visual and animation changes are verified, not
guessed.

Real backend data is explicitly **not** a requirement. Seeded mock content that
fills the relevant screens is sufficient (per product owner). Real data is an
opt-in fallback, not the default.

## Non-goals (YAGNI)

- No new test **assertions** — this is a capture tool, not a regression suite.
- No CI wiring — local/agent use only.
- No new auth mechanism — reuse `auth.setup.ts` + `storageState.json` verbatim.
- No attempt to "fix" local-Clerk-in-connected-Chrome. That path fights the
  handshake/`.next` fragility on every run; the storageState approach sidesteps
  it entirely.

## Design

### 1. `pnpm shoot` — the entry point

A package script in `apps/web/package.json` that runs a dedicated Playwright
project and passes flags through as env vars:

```bash
pnpm shoot --route /dashboard --theme dark --viewport mobile
pnpm shoot --route /read --animate          # records a video for transitions
pnpm shoot --route /admin/invites --full-stack
```

Flags → env: `SHOOT_ROUTE` (required), `SHOOT_THEME` (`light`|`dark`),
`SHOOT_VIEWPORT` (`desktop`|`mobile`), `SHOOT_WAIT` (selector/text to await),
`SHOOT_ANIMATE` (capture video instead of a still), `SHOOT_OUT` (output
filename), `SHOOT_FULL_STACK` (use the real local stack instead of mocks).

### 2. `apps/web/e2e/shoot.spec.ts` — a dedicated `shoot` project

- A new Playwright **project** named `shoot` in `playwright.config.ts`,
  **excluded from the default `test:e2e` run**: the spec calls `test.skip` when
  `SHOOT_ROUTE` is unset, so a bare `playwright test` never trips on it.
- `dependencies: ['setup']` so it inherits a fresh `storageState` (authenticated,
  no handshake) for free.
- Behavior: apply `seedMocks(page)` (unless `--full-stack`), navigate to
  `SHOOT_ROUTE`, apply theme (`color-scheme` / theme attribute) and viewport,
  await `SHOOT_WAIT` if given, then either screenshot to a PNG or, with
  `--animate`, record a `.webm` video (Playwright native) of the transition.
- Output → `apps/web/e2e/.shots/` (gitignored). The agent reads the artifact
  back to actually see the rendered result.

### 3. `apps/web/e2e/helpers/seed-mocks.ts` — reusable content seed

One `seedMocks(page)` helper that fulfills the **shell-baseline** endpoints with
realistic non-empty data: `profiles/languages`, `review/overview`, and the
dashboard summary calls — the same routes currently **copy-pasted** across
`fluency.spec.ts`, `read-mobile-touch.spec.ts`, and `mobile-responsive.spec.ts`.

- Initial coverage: the dashboard shell + the most-tweaked screens
  (**dashboard, review, read, fluency**). Grown as needed, not exhaustively up
  front.
- Those three existing specs are **refactored to call `seedMocks`**, removing the
  duplication.
- For a screen with bespoke endpoints, the agent adds one extra inline
  `page.route` in addition to `seedMocks` — cheap and local.

### 4. Content strategy

- **Default — `seedMocks`:** deterministic, zero servers, instant. Covers the
  common shell so most screens render with content.
- **Opt-in — `--full-stack`:** flips on the existing `E2E_FULL_STACK=1` path
  (local Lambda → dev Neon), no mocks, real data. For screens too bespoke to
  bother mocking. Fallback, not default.

### 5. Documentation

- New **"Verifying UI changes in a browser"** section in `docs/testing.md`:
  - Use `pnpm shoot` for authenticated app screens.
  - **Connected Chrome is for the deployed Vercel preview, not localhost** —
    localhost is the handshake-loop trap.
  - Use `--animate` to verify transitions (a single still can't show motion).
- A short pointer in `CLAUDE.md` so every agent finds the harness instead of
  rediscovering the handshake wall.

## Components & boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `pnpm shoot` script | parse flags → env, invoke `playwright test --project=shoot` | Playwright CLI |
| `shoot.spec.ts` | drive the page (auth via storageState, navigate, theme/viewport, capture) | `seedMocks`, `storageState`, `setup` project |
| `seed-mocks.ts` | fulfill shell-baseline endpoints with non-empty fixtures | shared Zod response types |
| docs | tell agents which tool to use and avoid the handshake trap | — |

## Risks / open considerations

- **Mock drift:** `seedMocks` fixtures can diverge from real API shapes over
  time. Mitigation: validate fixtures against the shared Zod response schemas
  (the `validatedReply` pattern already used in `fluency.spec.ts`).
- **Default-run isolation:** the `shoot` project must not run in `test:e2e`.
  Mitigation: `test.skip` on missing `SHOOT_ROUTE`, verified by running the
  default suite and confirming `shoot` reports skipped/zero tests.
- **Animation fidelity:** `.webm` video is the verification artifact for
  transitions; the agent inspects frames rather than asserting on them.
