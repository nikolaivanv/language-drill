# Codebase Tour — a Roadmap for Understanding Language Drill

A guided map of how the code is organized, how the pieces talk to each other, and a
suggested order to read it in. Companion docs: `docs/architecture.md` (system
design), `docs/progress-tracking.md` (the mastery model), `CLAUDE.md` (operational
reference).

---

## 1. The 30-second mental model

There are **three runtimes** sharing **one Postgres database** (Neon) and **one AI
library** (`packages/ai`):

```
┌─────────────────┐   Clerk JWT    ┌──────────────────────────────┐
│  Next.js web    │ ─────────────► │  Main API Lambda (Hono)      │
│  (Vercel)       │                │  behind API Gateway          │──┐
│  apps/web       │   SSE stream   ├──────────────────────────────┤  │
│                 │ ─────────────► │  Annotate-stream Lambda      │  │
└─────────────────┘  Function URL  │  (own JWT check, streams)    │  │
                                   └──────────────────────────────┘  │
                                                                     ▼
┌──────────────────────────────────────────────┐            ┌─────────────┐
│  Background generation (no user in the loop) │            │  Neon       │
│  EventBridge cron → scheduler Lambda → SQS   │ ─────────► │  Postgres   │
│  → generation Lambda (Claude generates +     │            │  (Drizzle)  │
│    validates exercises into the pool)        │            └─────────────┘
└──────────────────────────────────────────────┘
        all three runtimes call Claude via packages/ai
        (prompts live in Langfuse; repo holds fallbacks)
```

Key insight that explains most of the layout: **expensive AI work is pre-generated
offline into a shared pool** (the generation pipeline), while **per-user AI work**
(evaluating your answer, annotating your reading) happens at request time and is
**metered per user per day** (`usage_events` table + plan limits).

---

## 2. Monorepo map

```
apps/web              Next.js App Router UI (the only user-facing app today)
packages/api-client   TanStack Query hooks + Zod response schemas (shared with future mobile)
packages/shared       Pure constants/types/utils used by both client and server
packages/db           Drizzle schema + migrations — the single source of truth for data shape
packages/ai           Everything that talks to Claude: prompts, callers, validators, Langfuse
infra/lambda          The backend: Hono API + streaming Lambda + generation workers
infra/lib, infra/bin  AWS CDK — the infrastructure as code
```

Dependency direction (nothing points backward):

```
apps/web ──► packages/api-client ──► packages/shared
infra/lambda ──► packages/ai, packages/db, packages/shared
```

`apps/web` never imports `db` or `ai` directly — it only speaks HTTP through
`api-client`. That boundary is what makes the future Expo app cheap to add.

---

## 3. The three core data flows (trace these to understand 80% of the app)

### Flow A — a drill session (the heart of the product)

1. **UI**: `apps/web/app/(dashboard)/drill/page.tsx` starts a session via
   `useSession.ts` hook → `POST /sessions`.
2. **Routing**: `infra/lambda/src/index.ts` is the Hono app — CORS, auth middleware,
   then mounts every file in `routes/`. `routes/sessions.ts` builds a session from
   the pre-generated pool (`exercises` table) + due spaced-repetition items.
3. **Answering**: the UI submits to `POST /exercises/:id/submit`
   (`routes/exercises.ts`). This is the most instructive single file in the backend:
   it checks the global AI brake (`usage/global-capacity.ts`), the per-user daily
   limit (`usage/limits.ts` + `usage_events` count), then calls
   `packages/ai/src/evaluate.ts`.
4. **Evaluation**: `evaluate.ts` builds the prompt (`prompts.ts`), forces Claude into
   structured tool output, and strictly validates the JSON (`parseEvaluationResult`)
   — scores per CEFR dimension, error list, feedback.
5. **Progress**: the result is written to `user_exercise_history` and folded into
   mastery state (`lib/progress-aggregation.ts`, schema in
   `packages/db/src/schema/progress.ts`). The debrief screen
   (`drill/debrief/`) reads it back via `GET /sessions/:id/debrief`.

### Flow B — reading with live annotation (the streaming path)

This is the one architectural exception: it bypasses API Gateway entirely.

1. **UI**: `apps/web/app/(dashboard)/read/page.tsx` (the largest client component;
   its state machine lives in `read/_state/`) calls
   `packages/api-client/src/hooks/useReadAnnotateStream.ts`, which uses
   `sse-client.ts` to POST to a **Lambda Function URL** (`NEXT_PUBLIC_ANNOTATE_STREAM_URL`).
2. **Backend**: `infra/lambda/src/annotate-stream/handler.ts` — a separate Lambda in
   `RESPONSE_STREAM` mode (API Gateway can't stream SSE). It verifies the Clerk JWT
   itself (`annotate-stream/jwt.ts`), then runs `pipeline.ts`: stream Claude's
   annotation of the text token-by-token, emitting typed SSE frames (`sse.ts`).
3. **Vocabulary**: words the user flags get saved (`routes/read.ts`, tables in
   `packages/db/src/schema/read.ts`) and enter the FSRS review queue — which is what
   the **review** feature (`routes/review.ts` + `lib/review/`) drills later.

### Flow C — background exercise generation (no user involved)

1. **Trigger**: EventBridge cron (~04:00 UTC) fires the scheduler Lambda
   (`infra/lambda/src/generation/scheduler.ts`). `scheduler-decision.ts` +
   `cell-targets.ts` decide which *cells* — a cell is a
   `(language, CEFR level, grammar point, exercise type)` combination — are below
   their target pool size.
2. **Queue**: one SQS message per cell (`job-message.ts`), consumed by
   `generation/handler.ts` (reserved concurrency 3, DLQ + alarm).
3. **Generate → validate → route**: for each draft, `packages/ai/src/generate.ts`
   creates the exercise, `validate.ts` runs a *second* Claude pass that scores it,
   and the routing logic approves it into the pool, flags it, or rejects it.
   Results land in `exercises` + `generation_jobs` tables.
4. The **theory** pipeline (`theory-generation/`, `packages/ai/src/theory-*.ts`) is
   the same shape for grammar-theory pages instead of exercises. Reading texts have
   a third variant (`reading-generate.ts`).

When you understand A + B + C, everything else is supporting machinery.

---

## 4. Area-by-area guide

### `apps/web` — the frontend

- `app/(dashboard)/` is the authenticated app; the route group shares
  `layout.tsx` (nav, providers). Features map 1:1 to folders: `home` (today plan),
  `drill` (sessions), `read`, `review` (FSRS vocab), `theory`, `progress`
  (radar/heatmap charts), `settings`, `admin` (invite + generation dashboards,
  server-gated in `admin/layout.tsx`).
- Convention: `_components/`, `_lib/`, `_state/` folders are feature-private;
  `page.tsx` files are mostly `'use client'` orchestrators.
- Auth: `middleware.ts` (Clerk) protects everything except landing, sign-in/up,
  invite, webhooks. Tokens are minted with `getToken({ template: 'api' })`.
- E2E tests live in `apps/web/e2e/` (Playwright; see `docs/testing.md`).

### `packages/api-client` — the HTTP contract

- `fetchClient.ts` — `createAuthenticatedFetch` injects the Bearer token; **every**
  request goes through it.
- `hooks/` — one TanStack Query hook per endpoint (`useSession`, `useTodayPlan`,
  `useProgress`, …). Each hook Zod-parses the response, so the UI never sees an
  unvalidated shape. Reading the hooks directory is the fastest way to learn the
  API surface.
- `sse-client.ts` — the streaming counterpart used by the two annotate hooks.

### `packages/db` — the data model

- `src/schema/*.ts`, one file per domain: `users` (+ preferences, plan),
  `exercises` (the pool + tags), `sessions`, `progress` (history + mastery),
  `read` (entries, vocabulary, FSRS review state — the most recent and most
  polished schema), `theory`, `generation` (job audit trail), `access`
  (invitations, usage_events), `skills`, `playlists`.
- `migrations/` — generated by Drizzle, forward-only, applied by CI.
- Gotcha: other packages consume the **built** output — after editing schema, run
  `pnpm build` or single-package test runs will use stale `db/dist`.

### `packages/ai` — the Claude layer

Each AI "surface" is a pair: a **prompt file** and a **caller file** with a strict
JSON parser. Seven surfaces:

| Surface | Caller | Prompts | Used by |
|---|---|---|---|
| Answer evaluation | `evaluate.ts` | `prompts.ts` | submit endpoint (Flow A) |
| Reading annotation | `annotate.ts`, `read-span.ts` | same files | streaming Lambda (Flow B) |
| Exercise generation | `generate.ts` | `generation-prompts.ts` | generation worker (Flow C) |
| Exercise validation | `validate.ts` | `validation-prompts.ts` | generation worker |
| Theory generation/validation | `theory-*.ts` | `theory-*-prompts.ts` | theory worker |
| Reading-text generation | `reading-generate.ts` | `reading-generation-prompts.ts` | read feature |

Cross-cutting pieces:

- `prompts-registry.ts` — prompts are fetched **live from Langfuse** at runtime
  (label `production`), with the in-repo constants as fallback. This is why editing
  a prompt constant alone changes nothing in prod — see "Prompt Editing" in
  CLAUDE.md.
- `observability.ts` — wraps the Anthropic client so every call becomes a Langfuse
  trace, tagged with the `*_PROMPT_VERSION` constant (cohorting for A/B analysis).
- `cost-model.ts` — token→USD pricing used by eval tooling and job logs.
- `turkish-harmony.ts`, `frequency/` — deterministic linguistic helpers used by
  validation (not everything is an LLM call).

### `infra/lambda` — the backend

- `index.ts` — the Hono app: CORS → auth → routes. `dev.ts` is the local dev server
  (injects `userId = dev_user_001`, bypassing Clerk).
- `middleware/auth.ts` — pulls the user id from the API-Gateway-verified JWT.
  `middleware/admin.ts` — checks `ADMIN_USER_IDS`. (`middleware/invite.ts` is dead
  code.)
- `routes/` — one file per resource; handlers validate input with Zod, query via
  Drizzle, and always scope by `userId`.
- `usage/` — the monetization-ish layer: `limits.ts` (per-bucket daily caps,
  free vs boosted), `plan.ts` (effective plan resolution), `global-capacity.ts`
  (kill switch + global daily cap).
- `lib/` — domain logic extracted from routes: `review/` (FSRS queue building,
  grading, scheduling — the most algorithm-dense corner of the backend),
  `today-plan.ts`, `progress-aggregation.ts`, `exercise-filters.ts`.
- `annotate-stream/`, `generation/`, `theory-generation/` — the three non-Hono
  Lambda entry points (Flows B and C).

### `infra/lib` + `infra/bin` — the CDK stack

- `bin/app.ts` instantiates `LanguageDrillStack` **twice** (prod + dev) — same
  code, different domains/secrets/Neon branches (see the environment matrix in
  CLAUDE.md).
- `lib/constructs/` is one construct per concern and reads like a deployment
  diagram: `lambda.ts` (main API) + `api-gateway.ts` (routes + per-route Clerk JWT
  authorizer), `annotate-stream-lambda.ts` (Function URL, streaming),
  `generation-*` / `theory-*` / `scheduler-*` (the cron→SQS→worker pipelines, with
  DLQs and alarms), `storage.ts`, `queue.ts`.

### CI/CD — `.github/workflows`

- `ci.yml` (PRs): lint + typecheck + test, ephemeral Neon branch, Vercel preview.
- `deploy.yml` (merge to main): prod migrate → CDK deploy → Vercel prod, then the
  same sequence for dev.

---

## 5. Cross-cutting concepts to internalize

- **Auth has two enforcement points.** API Gateway's JWT authorizer rejects
  unauthenticated calls before Lambda runs; the streaming Lambda (no gateway)
  verifies JWTs in-handler. Locally, both are bypassed via `DEV_USER_ID`.
- **Plans and metering.** `users.plan` (`free`/`boosted`) × per-bucket daily limits
  (`usage/limits.ts`), counted from `usage_events`. Invite codes just flip the plan.
  Admins (env var list) are always boosted. This is the pre-Stripe monetization
  stand-in.
- **Generate → validate → route.** All AI-generated content passes a second,
  independent Claude validation call before users see it. Approval rates per cell
  are tracked in `generation_jobs` and drive the eval tooling
  (`pnpm eval:gen`).
- **Prompts are data, not code.** Langfuse serves the live prompt body; the repo
  constant is a fallback plus a version tag. The sync workflow
  (`bootstrap-prompts` / `push-prompts`) is in CLAUDE.md.
- **Observability is split by runtime**: Sentry = frontend, CloudWatch = Lambda,
  Langfuse = LLM calls. Pick the inbox matching where the error lives.
- **Testing**: Vitest co-located `*.test.ts` everywhere (including CDK construct
  tests asserting synthesized CloudFormation); Playwright E2E in `apps/web/e2e`.

---

## 6. Suggested reading order

**Session 1 — skeleton and one full loop (≈2h)**
1. `CLAUDE.md` top half + this file.
2. `infra/lambda/src/index.ts` — how the API is assembled.
3. `routes/exercises.ts` end to end (Flow A) — it touches auth, metering, AI, and
   progress in one file.
4. `packages/ai/src/evaluate.ts` + `prompts.ts` — the evaluation surface.
5. Run it: `pnpm dev`, do a drill in the browser, watch both terminals.

**Session 2 — data model and frontend (≈2h)**
6. `packages/db/src/schema/` — read `users`, `exercises`, `progress`, then `read`
   (the newest conventions).
7. `packages/api-client/src/hooks/` — skim all hooks; this *is* the API reference.
8. One feature vertical: `apps/web/app/(dashboard)/drill/` from `page.tsx` down.

**Session 3 — the async machinery (≈2h)**
9. Flow C: `generation/scheduler.ts` → `generation/handler.ts` →
   `packages/ai/src/generate.ts` / `validate.ts`.
10. Flow B: `annotate-stream/handler.ts` + `useReadAnnotateStream.ts`.
11. `infra/lib/stack.ts` + skim `constructs/` to map code → AWS resources.

**Later, as needed:** `lib/review/` (FSRS algorithms), `progress-aggregation.ts`
(the Bayesian mastery update), the eval tooling under `packages/ai`
(`eval`, `eval:gen`), `docs/runbooks/`.

---

## 7. Quick orientation cheats

- *"Where is endpoint X?"* → `infra/lambda/src/routes/` — file names match URL
  prefixes; route mounting is in `index.ts:73-83`.
- *"Where does the app call endpoint X?"* → grep the path in
  `packages/api-client/src/hooks/`.
- *"What does this table look like?"* → `packages/db/src/schema/`, one domain per
  file; relations are explicit `references()`.
- *"What exactly does Claude get told?"* → the `*_SYSTEM_PROMPT` constant in
  `packages/ai/src/*prompts*.ts` is the fallback; the live body is in Langfuse
  (label `production`).
- *"Why did this AI call behave that way in prod?"* → Langfuse trace, filtered by
  `promptVersion`.
- *"What AWS resource backs this?"* → `infra/lib/constructs/`, names match
  function.
