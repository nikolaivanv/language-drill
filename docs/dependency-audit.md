# Dependency Audit

**Status: rolled out 2026-04-30** — PRs #21, #22, #23, #24, #25 merged. All recommended bumps in this audit are now on `main`. Re-run `pnpm outdated -r` to start a fresh audit baseline.

_Generated 2026-04-29 against `pnpm outdated -r`._

This document captures the state of the workspace's third-party dependencies, recommends what to update, and flags what to leave alone. Re-run `pnpm outdated -r` from the repo root to refresh the data.

---

## TL;DR

- **15 minor/patch bumps** are free wins — bundle into one PR.
- **`@anthropic-ai/sdk`, `drizzle-orm`, `@neondatabase/serverless`, `vitest`** are the gaps that actually matter — schedule them.
- **`eslint` 8 is EOL** — plan a flat-config migration.
- **`next` 16, `zod` 4, `typescript` 6** are strategic decisions, not routine bumps — defer until you have a reason.
- **`@types/node`** stays pinned to 22 (Lambda LTS) — the repo-root pnpm override already enforces this.

---

## Safe patch/minor bumps

Bundle into one PR. Low risk, no expected behavior changes.

| Package | Current | Latest | Workspaces affected |
|---|---|---|---|
| `prettier` | 3.8.2 | 3.8.3 | root |
| `tailwindcss` | 4.2.2 | 4.2.4 | `apps/web` |
| `@tailwindcss/postcss` | 4.2.2 | 4.2.4 | `apps/web` |
| `hono` | 4.12.12 | 4.12.15 | `infra/lambda` |
| `@clerk/nextjs` | 7.0.12 | 7.2.8 | `apps/web` |
| `@tanstack/react-query` | 5.99.0 | 5.100.6 | `apps/web`, `packages/api-client` |
| `aws-cdk` | 2.1118.0 | 2.1120.0 | `infra` |
| `aws-cdk-lib` | 2.248.0 | 2.251.0 | `infra` |
| `svix` | 1.90.0 | 1.92.2 | `infra/lambda` |
| `jsdom` | 29.0.2 | 29.1.0 | `apps/web`, `packages/api-client` |
| `esbuild` | 0.25.12 | 0.28.0 | `infra` |

---

## Recommended major upgrades

These have real upgrade work but the gap is wide enough that staying behind costs more than upgrading.

### `@anthropic-ai/sdk` 0.36.3 → 0.91.1

- Used in `packages/ai`.
- We're tens of releases behind on the SDK that wraps every Claude call. Newer versions ship better ergonomics for tool use, structured prompt caching, and streaming — all things this app uses.
- **Action:** bump, then re-verify exercise generation and answer evaluation against `claude-sonnet-4-6` with prompt caching enabled.

### `drizzle-orm` 0.30.10 → 0.45.2 + `drizzle-kit` 0.21.4 → 0.31.10

- Used in `packages/db` and `infra/lambda`.
- 15 minor versions of feature and perf work — relational query helpers, better Postgres types, faster `drizzle-kit generate`.
- **Action:** bump both together, run `pnpm db:generate`, eyeball the migration journal, run the migration on a Neon branch before merging.

### `@neondatabase/serverless` 0.9.5 → 1.1.0

- Used in `packages/db`.
- 1.x is the stable API. Worth doing alongside the Drizzle bump.

### `vitest` 1.6.1 → 4.1.5 + `@vitejs/plugin-react` 4.7.0 → 6.0.1

- Used everywhere tests run.
- Three majors behind. v2 changed workspace config, v3 tightened types, v4 changed the runner.
- **Action:** bump together, expect ~30 min of test config fiddling. Run `pnpm test` per workspace to surface breakage.

### `@typescript-eslint/*` 7 → 8 + `eslint` 8 → 10

- Used at root.
- ESLint 8 is end-of-life. Going to 9/10 requires migrating to flat config (`eslint.config.js`) — `apps/web` also uses `next lint`, which has its own flat-config story per the Next 15/16 docs.
- **Action:** schedule its own PR. Use `@eslint/migrate-config` to seed the new config, then prune.

---

## Strategic — defer until there's a reason

### `next` 15.5.15 → 16.2.4

- Next 16 stabilizes Cache Components / Partial Prerendering and changes a few cache APIs.
- Read the upgrade guide; the repo has a `vercel:next-upgrade` skill that automates the codemods.
- **Defer** unless we want PPR for the dashboard.

### `zod` 3.25.76 → 4.3.6

- v4 changes `.parse` error formatting and renames a few methods.
- Touches `packages/api-client` Zod schemas and Hono validators in `infra/lambda`.
- Codemod exists, but plan it as its own PR with a careful diff review.

### `typescript` 5.9.3 → 6.0.3

- TS 6 just released. 5.9 is fine; let the ecosystem catch up first.

### `@hono/node-server` 1.19.14 → 2.0.0

- Local-dev-only dependency (`infra/lambda/src/dev.ts`).
- Low risk, low reward — no urgency.

---

## Do not upgrade

### `@types/node` 22 → 25

Stay on **22** — current LTS and the runtime AWS Lambda uses. The repo root `package.json` already enforces this:

```json
"pnpm": {
  "overrides": {
    "@types/node": "^22.0.0"
  }
}
```

---

## Suggested PR sequence

1. **PR 1 — patch bundle.** All entries from "Safe patch/minor bumps" above. Run `pnpm lint && pnpm typecheck && pnpm test`. ~15 min.
2. **PR 2 — Drizzle + Neon driver.** Bump `drizzle-orm`, `drizzle-kit`, `@neondatabase/serverless`. Verify migrations on a Neon branch.
3. **PR 3 — Anthropic SDK.** Bump `@anthropic-ai/sdk`. Test exercise generation and answer evaluation end-to-end.
4. **PR 4 — Vitest stack.** Bump `vitest` and `@vitejs/plugin-react`. Fix test configs.
5. **PR 5 — ESLint 9/10 flat config.** Bump `eslint`, `@typescript-eslint/*`, migrate config files.
6. **Park** Next 16, Zod 4, TypeScript 6 as named follow-up tickets.
