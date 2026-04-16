# Language Drill

A serverless, AI-powered language learning app focused on **active production practice** for intermediate+ learners. Pre-generated exercises + Claude evaluation of free-form answers, mapped to CEFR levels.

See [`CLAUDE.md`](./CLAUDE.md) for the full project guide and [`docs/progress-tracking.md`](./docs/progress-tracking.md) for the progress-tracking design.

---

## Prerequisites

- Node.js 22+
- pnpm 9+
- A `.env` file at the repo root with at least:
  - `DATABASE_URL` (Neon Postgres connection string)
  - `ANTHROPIC_API_KEY` (for answer evaluation)
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` (used by the web app — not required by the local API)

An `.env.example` is provided as a starting point.

---

## First-time setup

```bash
pnpm install
pnpm db:migrate            # create tables in your Neon database
pnpm db:seed:exercises     # populate the exercise pool (36 exercises across 4 languages × 3 types)
```

---

## Running locally

| Command | What it does |
|---|---|
| `pnpm dev` | Both API (port 3001) + web (port 3000) with colored output |
| `pnpm dev:api` | Local Lambda API only, loads `.env` automatically |
| `pnpm dev:web` | Next.js only, points `NEXT_PUBLIC_API_URL` at `localhost:3001` |
| `pnpm db:migrate` | Run Drizzle migrations |
| `pnpm db:studio` | Browse the DB in Drizzle Studio |
| `pnpm db:seed:exercises` | Seed the exercise pool |

### Notes

- **Local auth is bypassed.** The API dev server (`infra/lambda/src/dev.ts`) skips the Clerk JWT check and treats every request as `dev_user_001`. This user is auto-created on startup so foreign-key constraints on `user_exercise_history` / `usage_events` are satisfied. Override the user with `DEV_USER_ID=user_xyz`.
- **Web points at local API automatically.** `pnpm dev:web` sets `NEXT_PUBLIC_API_URL=http://localhost:3001`, overriding any value in `apps/web/.env`.
- **Submit actually calls Claude.** Ensure `ANTHROPIC_API_KEY` is set in `.env` — otherwise you'll get a 502 on answer submission. Retrieval (browsing exercises) works without it.

---

## Tests, lint, typecheck

```bash
pnpm test         # runs all package test suites via Turborepo
pnpm typecheck
pnpm lint
```

---

## Monorepo layout

```
apps/web               — Next.js (App Router) frontend
apps/mobile            — Expo / React Native (later)
packages/shared        — Cross-package types and enums
packages/db            — Drizzle schema, migrations, seed scripts
packages/ai            — Claude client, prompt templates, evaluation engine
packages/api-client    — Zod schemas + React Query hooks shared by web/mobile
infra/lambda           — Hono API (AWS Lambda) + local dev server
infra/                 — AWS CDK stack
```
