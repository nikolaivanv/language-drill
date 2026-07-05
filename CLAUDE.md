# Language Drill — Project Guide

## What This Is

A serverless, AI-powered language learning app focused on **active production practice** for intermediate+ learners. The primary user is the author (learning EN/ES/TR/DE at varying levels); designed to be portfolio-quality and shareable.

Full docs: `docs/architecture.md`, `docs/progress-tracking.md`. Deeper context: `docs/product.md` (positioning, competitive landscape, scope), `docs/tech.md` (full tech-stack rationale).

---

## Positioning

Target: **intermediate plateau** — learners past A2 who've exhausted Duolingo but can't yet speak fluently. Tagline: _"What you do between italki sessions."_

Differentiators (only powerful together):

- Forces **written and spoken production**, not multiple-choice recognition
- **Skill-based mastery tracking** (not XP/streaks/lessons) mapped to CEFR and real exams
- Designed from the start for **polyglots** — multiple languages at different levels
- Combines proven methods (spaced repetition, Cloze, Pimsleur-style audio) with AI evaluation

Out of scope: accent reduction, gamification, social features, delta learning (learn Italian via Spanish).

---

## Tech Stack

| Layer                 | Choice                                                         |
| --------------------- | -------------------------------------------------------------- |
| Web frontend          | Next.js (App Router) + TypeScript, hosted on Vercel            |
| Mobile (later)        | Expo / React Native                                            |
| Backend API           | AWS Lambda + API Gateway v2, Hono framework                    |
| IaC                   | AWS CDK (TypeScript)                                           |
| Database              | Neon (serverless Postgres) + Drizzle ORM                       |
| Cache / rate limiting | Upstash Redis                                                  |
| Auth                  | Clerk (passwordless + Google OAuth, invite codes)              |
| Storage               | S3 + CloudFront                                                |
| LLM                   | Anthropic Claude API (`claude-sonnet-4-6`) with prompt caching |
| TTS                   | AWS Polly (neural voices — EN/ES/DE/TR all supported)          |
| STT                   | AWS Transcribe (speaking exercises)                            |
| Background jobs       | EventBridge Scheduler + SQS + Lambda                           |
| Frontend monitoring   | Sentry (`@sentry/nextjs`) — frontend only; Lambda errors remain in CloudWatch |
| Monorepo              | pnpm workspaces + Turborepo                                    |

**Why a separate Lambda API (not Next.js API routes):** the mobile app needs the same backend from day one; Lambda is easier to rate-limit and meter independently of Vercel.

**Why Neon over DynamoDB:** progress tracking and spaced repetition state are relational. Neon also provides per-PR database branches for the CI pipeline.

---

## Monorepo Layout

```
apps/web          — Next.js
apps/mobile       — Expo (later)
packages/api-client — TanStack Query hooks + Zod types (shared web/mobile)
packages/db       — Drizzle schema + migrations
packages/ai       — Claude client wrapper + prompt templates
packages/shared   — Common types, constants
infra/lambda      — Hono API (AWS Lambda) + local dev server
infra/            — AWS CDK stack
```

---

## Git Worktrees

**Always create worktrees under `.claude/worktrees/<branch-slug>/`.** This is the
single canonical location.

- **Never create a worktree in the repo root** (e.g. `./feat-foo`). Root worktrees
  clutter `ls`, get mistaken for source dirs, and pollute `git status`.
- **Never write to `.claire/worktrees/`** — that path is debris from a misfiring
  agent base-path; it is not a real worktree location.
- `.claude/worktrees/` is gitignored, so worktree contents never get accidentally
  staged into the main repo.

Removing a worktree (`git worktree remove .claude/worktrees/<slug>`) deletes only
the working directory — the branch ref survives. Push branches before cleanup so
nothing is recoverable only from the worktree.

---

## Running Locally

Both servers are started from the repo root. They read `DATABASE_URL`, `ANTHROPIC_API_KEY`, and Clerk keys from `.env` (see `.env.example`).

| Command | What it does |
| --- | --- |
| `pnpm dev` | API (port 3001) + streaming-annotate Lambda (port 3002) + web (port 3000), colored output |
| `pnpm dev:api` | Local Lambda API only, loads `.env` automatically |
| `pnpm dev:stream` | Streaming-annotate Lambda only (port 3002), loads `.env` automatically |
| `pnpm dev:web` | Next.js only, points `NEXT_PUBLIC_API_URL` at `localhost:3001` and `NEXT_PUBLIC_ANNOTATE_STREAM_URL` at `localhost:3002` |
| `pnpm db:migrate` | Run Drizzle migrations |
| `pnpm db:studio` | Browse the DB in Drizzle Studio |
| `pnpm db:seed:exercises` | Seed the exercise pool (36 idempotent exercises) |
| `pnpm revalidate:cloze` | One-off CLI to re-score every stored cloze through the current validator and demote failures. Dry-run by default; pass `--apply` to write. Supports `--language`, `--cefr`, `--limit`, `--concurrency`, `--max-cost-usd`. |
| `pnpm bootstrap-prompts` | Idempotently register the nine system prompts in Langfuse from the in-repo fallback strings. Supports `--dry-run` and `--check` (drift detection vs. live `production` label). **Create-only** — does not update prompts that already exist. |
| `pnpm push-prompts` | Push a new `production`-labeled version of every prompt that has **drifted** from the in-repo source (the update `bootstrap-prompts` can't do). Detects drift the same way `--check` does, logs each prompt's prior version as the revert target, then writes; in-sync prompts are skipped. Selects the env via `LANGFUSE_*` keys — run once per environment. Supports `--dry-run`. |
| `pnpm eval:export` | Sample evaluation traces from Langfuse over a date window and write them as items into a Langfuse dataset (joined back to `user_exercise_history` for the user answer + exercise). |
| `pnpm eval` | Run a candidate prompt against a Langfuse dataset, link each per-item trace to the dataset run, and write a quality/cost/latency summary to `./eval-runs/<runName>.json`. `--model <id>` runs the arm on a different Anthropic model than the production evaluator constant, enabling model A/Bs (cost column stays Sonnet-priced — indicative only for non-Sonnet arms). |
| `pnpm eval:seed` | Write hand-curated failure cases from a fixture (`scripts/fixtures/eval-hard-morphology.json` by default, or `--file <path>`) into a Langfuse dataset for `pnpm eval`. Each item's `expectedOutput` is the observed **bad** baseline, so the eval diff shows verdict movement against the recorded failure. Idempotent — dedupes on `metadata.seedKey`. |
| `pnpm eval:gen` | The **generation-quality** gate (distinct from `pnpm eval`, which only covers the answer-evaluation prompt). Compares two generation-prompt sources (`--baseline` / `--candidate`, each `repo` \| `file:<path>` \| `langfuse:<name>@<label>`) over a cell dataset (`--dataset-file`): generates N drafts per cell per arm, validates each, routes via `routeValidationResult`, and writes approval-rate / rejection-reason / flag-tag deltas to `./eval-runs/<runName>.json`. Supports `--drafts-per-cell` (default 5), `--limit`, `--max-cost-usd`, `--allow-prod`. |
| `pnpm eval:gen:export` | Build a failure-prone cell dataset for `eval:gen` by sampling the lowest-approval cells from `generation_jobs` (read-only). Supports `--sample`, `--out`, `--language`, `--cefr`, `--allow-prod`. |
| `pnpm propose:coverage-spec` | LLM-assisted coverage-spec authoring (Pool Coverage Controller, Phase 2). Reads a grammar point (`--grammar-point <key>`), asks Claude to propose the 1–2 coverage axes + absolute per-value floors a diverse pool should vary along, validates the proposal, and prints a paste-ready `coverageSpec` snippet for human review + commit into the curriculum. `--with-pool-stats` grounds the proposal in the current approved distribution (read-only). In-repo prompt (not Langfuse). |

First-time setup:

```bash
pnpm install
pnpm db:migrate
pnpm db:seed:exercises
pnpm dev
```

Local dev conventions:

- **Auth is bypassed in the local API.** `infra/lambda/src/dev.ts` injects `userId = dev_user_001` (override via `DEV_USER_ID`). The auth middleware skips JWT extraction when a `userId` is already set — production is unaffected. The dev server auto-upserts the user row on startup.
- **Web → local API wiring.** `pnpm dev:web` sets `NEXT_PUBLIC_API_URL=http://localhost:3001` and `NEXT_PUBLIC_ANNOTATE_STREAM_URL=http://localhost:3002` inline, overriding anything in `apps/web/.env`.
- **Streaming-annotate auth bypass.** `infra/lambda/src/annotate-stream/dev.ts` honors `DEV_USER_ID` exactly like the Hono dev server — Clerk JWT verification short-circuits to the env value when it is set.
- **Answer submission calls Claude for real.** Ensure `ANTHROPIC_API_KEY` is set — otherwise `POST /exercises/:id/submit` returns 502. Exercise retrieval works without it.

---

## Package Management

- Always use the latest stable version of packages unless there's a specific
  reason to pin (document the reason in a comment if so)
- Before installing a package, verify it is actively maintained and not deprecated
- Prefer packages with recent releases (within the last 6 months) and active
  GitHub activity
- If a package is deprecated, use the recommended replacement instead
- Avoid packages with known security vulnerabilities

---

## Prompt Editing

When editing any `*_SYSTEM_PROMPT` constant in `packages/ai/src/`, bump the
matching `*_PROMPT_VERSION` constant to today's date (`<surface>@YYYY-MM-DD`)
in the same commit. Langfuse dashboards cohort traces by `promptVersion`, so
failing to bump means old and new traces collapse into one population and
A/B-style comparisons become impossible. The version constants live alongside
each prompt and are re-exported from `packages/ai/src/index.ts`:

| Prompt file | Version constant |
|---|---|
| `prompts.ts` | `EVALUATION_SYSTEM_PROMPT_VERSION` |
| `annotate.ts` | `ANNOTATE_SYSTEM_PROMPT_VERSION` |
| `generation-prompts.ts` | `GENERATION_PROMPT_VERSION` |
| `validation-prompts.ts` | `VALIDATION_PROMPT_VERSION` |
| `theory-prompts.ts` | `THEORY_GENERATION_PROMPT_VERSION` |
| `theory-validation-prompts.ts` | `THEORY_VALIDATION_PROMPT_VERSION` |
| `read-span.ts` | `READ_SPAN_PROMPT_VERSION` |
| `free-writing-prompts.ts` | `FREE_WRITING_EVAL_PROMPT_VERSION` |
| `free-writing-generation-prompts.ts` | `FREE_WRITING_GENERATION_PROMPT_VERSION` |
| `free-writing-validation-prompts.ts` | `FREE_WRITING_GENERATION_VALIDATION_PROMPT_VERSION` |
| `writing-helper-prompts.ts` | `BRAINSTORM_PROMPT_VERSION` |
| `writing-helper-prompts.ts` | `VOCAB_BOOST_PROMPT_VERSION` |
| `writing-helper-prompts.ts` | `START_MY_PARAGRAPH_PROMPT_VERSION` |

Langfuse is now the live source for these prompts; the in-repo
`*_SYSTEM_PROMPT` constant is the fallback. Bumping
`*_SYSTEM_PROMPT_VERSION` is still required (drives the fallback cohort tag
and signals reviewers that the local fallback also changed).

Editing the in-repo constant alone is **not enough** — the runtime fetches
the body from Langfuse, so a merged prompt edit keeps serving the old body
until you mirror it. `bootstrap-prompts` won't help here (it's create-only).
After merging a prompt change, sync each environment's Langfuse project from
the in-repo source:

```bash
# Pull the target env's Langfuse creds from Secrets Manager (region is
# eu-central-1; prefix `language-drill/` for prod, `language-drill-dev/` for dev).
PK=$(aws --region eu-central-1 secretsmanager get-secret-value \
  --secret-id language-drill/LANGFUSE_PUBLIC_KEY --query SecretString --output text)
SK=$(aws --region eu-central-1 secretsmanager get-secret-value \
  --secret-id language-drill/LANGFUSE_SECRET_KEY --query SecretString --output text)

# Preview, then apply. Inline creds bypass `.env`; only drifted prompts push.
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai push-prompts --dry-run
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai push-prompts

# Confirm in sync (exit 0 = no drift). Repeat the whole block for dev.
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai bootstrap-prompts --check
```

The runtime picks up the new body within ~5 min (Lambda module-scope cache
TTL). To revert, re-point the `production` label at the prior version
(logged by `push-prompts`) in the Langfuse dashboard.

For a generation/validation bug that needs a prompt update **and** a
re-pass over the existing exercise pool, follow
[`docs/runbooks/prompt-update-and-revalidate.md`](docs/runbooks/prompt-update-and-revalidate.md).

---

## Pre-Push Checks

Before pushing to GitHub, **always** run the full suite from the repo root and confirm zero failures:

```bash
pnpm lint        # ESLint across all packages (including `next lint` for web)
pnpm typecheck   # tsc --noEmit across all packages
pnpm test        # Vitest across all packages
```

Do not push if any of these fail. Fix issues locally first.

---

## Testing

- After completing each spec task, write and run tests before marking
  the task complete
- Tests must pass before moving to the next task
- Add tests to the existing test file for that module, don't create
  orphaned test files
- After running tests, report: X passed, Y failed, and any failures
  with proposed fixes
- Do not proceed to the next task if tests are failing

### End-to-end (Playwright)

The E2E suite lives in `apps/web/e2e/` and runs via
`pnpm --filter @language-drill/web test:e2e`. Default project is
`authenticated` (tests start already signed in via the shared
storageState produced by `auth.setup.ts`); only smoke tests that
exercise the Clerk-hosted sign-in surface should use the
`unauthenticated` project. Full guide: `docs/testing.md`.

### Verifying UI/animation changes in a browser

Use `pnpm --filter @language-drill/web shoot --route <path>` to render an
authenticated screen with seeded content and capture a screenshot (or
`--animate` for a frame sequence) to `apps/web/e2e/.shots/`. The dashboard
landing is `/home` (`/` is the public marketing page, which redirects to `/home`
when signed in). This reuses the `auth.setup.ts` storageState, so it does **not**
hit the Clerk dev-browser handshake loop that blocks `localhost:3000` in the
connected Chrome. Connected Chrome is for the deployed Vercel preview, not
localhost. Full guide: `docs/testing.md` → "Verifying UI changes in a browser".

---

## Progress Tracking Model

The core differentiator. Full design: `docs/progress-tracking.md`.

**Spine: CEFR (A1–C2).** All progress maps here; exam readiness (IELTS, DELE, Goethe, YDS) is derived automatically.

**3-layer skill taxonomy:**

1. **Macro-skills** — Listening, Reading, Writing, Speaking (maps to exam sub-scores)
2. **Enabling competencies** — vocabulary breadth/depth, grammar accuracy/range, discourse, pragmatics, phonology
3. **Grammar points** — individual rules per language, each tagged to a CEFR level, individually tracked

**Measurement principles:**

- Claude evaluates free-form answers and returns structured JSON scores per dimension
- Mastery score `[0,1]` + confidence value per competency; updated via simplified Bayesian rule
- Harder exercises produce stronger signals; recency-weighted; decays over time (Ebbinghaus)
- CEFR estimate is a probability distribution, not a hard level; shown with confidence interval
- **Evidence-based, not time-based** — lesson count is irrelevant

**Key UI elements:** skill radar chart, grammar mastery map (grid of grammar points, green/yellow/red), vocabulary frequency coverage, exam readiness panel (opt-in).

**What we never show:** streaks, XP, lesson completion counts.

---

## Content Strategy

- **Pre-generated pool (default):** background Lambda batches exercises per `(language, skill, difficulty)` using Claude, TTS via Polly → stored in S3 + Postgres. Reused across all users. Dramatically reduces AI cost.
- **Real-time AI (metered):** answer evaluation, explanations, custom exercise creation, level assessment. Rate-limited per user via Upstash Redis counters.
- **Prompt caching:** system prompts (language profile + exercise format) are cached with Anthropic — ~80% cost reduction on prompt tokens within a session.

---

## Access Control & Monetization

Invite codes are a **usage perk, not a gate**: anyone can sign up free, and an
invite code (or admin status) unlocks a 10× daily limit. This is the stand-in
for paid subscriptions until billing is possible; a future Stripe `'pro'` tier
maps to the same boosted limits.

- **Tiers** — stored on `users.plan` (`'free'` / `'boosted'`). Effective plan is
  resolved at request time as `isAdmin(userId) || users.plan === 'boosted'`, so
  admins (listed in the `ADMIN_USER_IDS` env var) are always boosted without a DB
  write. Redeeming a code (`POST /invites/redeem`) sets `plan = 'boosted'`.
- **Per-bucket daily limits** (single source of truth: `infra/lambda/src/usage/limits.ts`).
  Each AI feature meters a **separate** bucket; boosted = 10× each:

  | Bucket (`usage_events.event_type`) | Endpoint | Free | Boosted |
  |---|---|---|---|
  | `ai_evaluation` | `POST /exercises/:id/submit` | 50/day | 500/day |
  | `read_annotation` (skim) | `POST /read/annotate` | 50/day | 500/day |
  | `read_span_annotation` (deep) | `POST /read/annotate-span` | 150/day | 1500/day |

- **Global AI cost brakes** (`infra/lambda/src/usage/global-capacity.ts`, env-driven,
  checked before the per-user cap; both default off):
  - `AI_KILL_SWITCH=on` — hard-stops AI for all non-admins (emergency brake; you keep working).
  - `AI_GLOBAL_DAILY_CAP=<int>` — soft cap: once total AI events in the trailing 24h
    reach it, **free** users get `503 GLOBAL_CAPACITY` while boosted/admin keep going.
  Wired into the API + annotate-stream Lambdas via CDK (`aiKillSwitch` / `aiGlobalDailyCap` stack props).
- **Admin** — generate / list / revoke codes via `POST|GET /admin/invites` (+ `/:id/revoke`),
  gated by `ADMIN_USER_IDS`; the web admin page is at `/admin/invites`. Codes are
  canonical uppercase 8-char alphanumeric. `GET /me` returns the caller's plan,
  limits, and today's usage.
- **Later:** Stripe subscriptions add a paid `'pro'` tier (same boosted limits) for
  users without an invite.
- Bot protection: Clerk at signup; per-user daily caps on the AI endpoints.

> Note: the gate-era `infra/lambda/src/middleware/invite.ts` (`403 NO_INVITE`) is
> dead code — it was never mounted. The Clerk webhook no longer auto-claims invites.

---

## CI/CD

```
PR  → lint + typecheck + tests
    → Neon branch created (ephemeral DB)
    → Drizzle migrate on branch
    → Vercel preview deploy

Merge → Drizzle migrate (production Neon)
      → CDK deploy (Lambda + API Gateway + S3 + SQS) — waits for migrate
      → Vercel production deploy — waits for CDK
      → Neon branch deleted (cleanup workflow)
```

All infra via CDK — no console click-ops. Migrations are forward-only.

### Environment matrix

Production and dev share the same code via a single `LanguageDrillStack` class instantiated twice in `infra/bin/app.ts`; data, auth, and runtime resources are isolated per env.

| Service | Production | Dev |
|---|---|---|
| API domain | `api.langdrill.app` | `api-dev.langdrill.app` |
| CDK stack name | `LanguageDrillStack` | `LanguageDrillStack-dev` |
| Neon branch | `production` | `dev` |
| Clerk instance | prod (`pk_live_*`, `sk_live_*`) | dev (`pk_test_*`, `sk_test_*`) |
| AWS Secrets Manager prefix | `language-drill/` | `language-drill-dev/` |
| Vercel env scope | Production | Preview |

### Production domain: `langdrill.app`

| Service | Domain | DNS |
|---|---|---|
| Frontend (Vercel) | `langdrill.app`, `www.langdrill.app` | CNAME → `cname.vercel-dns.com` |
| API (Lambda + API Gateway) | `api.langdrill.app` | CNAME → API Gateway custom domain |
| Auth (Clerk) | `clerk.langdrill.app`, `accounts.langdrill.app` | CNAMEs from Clerk dashboard |

DNS is managed in **Cloudflare** (registrar + DNS). All records are **DNS-only** (grey cloud) — Vercel, AWS, and Clerk handle their own TLS.

### API Gateway auth architecture

- JWT authorizer (Clerk) is applied **per-route** on API methods (GET/POST/PUT/PATCH/DELETE)
- OPTIONS routes have **no authorizer** (CORS preflight doesn't carry tokens)
- `/webhooks/clerk` has **no authorizer** (uses SVIX signature verification instead)
- CORS is handled in **Hono middleware** (not API Gateway) to support wildcard matching for `*.vercel.app` preview deploys
- The `POST /read/annotate` endpoint is served by a **separate** Lambda Function URL with `InvokeMode: RESPONSE_STREAM` (not API Gateway) because the response is SSE. JWT verification happens inside that Lambda via `@clerk/backend`. The Function URL is exposed by CDK as the `AnnotateStreamUrl` CloudFormation output and synced into Vercel as `NEXT_PUBLIC_ANNOTATE_STREAM_URL` by `.github/workflows/deploy.yml`.

### Required secrets

**AWS Secrets Manager** (8 secrets — runtime values for Lambda):

| Secret name | Source |
|---|---|
| `language-drill/DATABASE_URL` | Neon connection string |
| `language-drill/CLERK_SECRET_KEY` | Clerk dashboard → API Keys |
| `language-drill/CLERK_WEBHOOK_SECRET` | Clerk dashboard → Webhooks |
| `language-drill/ANTHROPIC_API_KEY` | Anthropic console |
| `language-drill/UPSTASH_REDIS_REST_URL` | Upstash console → REST API tab |
| `language-drill/UPSTASH_REDIS_REST_TOKEN` | Upstash console → REST API tab |
| `language-drill/LANGFUSE_PUBLIC_KEY` | Langfuse console → Project Settings → API Keys |
| `language-drill/LANGFUSE_SECRET_KEY` | Langfuse console → Project Settings → API Keys |
| `language-drill/RESEND_API_KEY` | Resend console → API Keys |

**GitHub Actions secrets** (10 secrets — deploy-time credentials):

| Secret | Purpose |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user for CDK deploy |
| `AWS_SECRET_ACCESS_KEY` | IAM user for CDK deploy |
| `AWS_REGION` | e.g. `eu-central-1` |
| `CLERK_ISSUER_URL` | Clerk production instance URL (e.g. `https://clerk.langdrill.app`) |
| `CLERK_AUDIENCE` | Leave empty — defaults to `language-drill` |
| `API_DOMAIN_NAME` | `api.langdrill.app` (optional — omit to skip custom domain) |
| `VERCEL_TOKEN` | From vercel.com/account/tokens |
| `VERCEL_ORG_ID` | From Vercel dashboard |
| `VERCEL_PROJECT_ID` | From Vercel dashboard |
| `DATABASE_URL` | Production Neon connection string — used by `deploy.yml` to apply Drizzle migrations before CDK + Vercel deploy |

**Vercel environment variables:**

| Variable | Production | Preview |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_...` (prod Clerk) | `pk_test_...` (dev Clerk) |
| `CLERK_SECRET_KEY` | `sk_live_...` (prod Clerk) | `sk_test_...` (dev Clerk) |
| `NEXT_PUBLIC_API_URL` | `https://api.langdrill.app` | `https://api.langdrill.app` |
| `NEXT_PUBLIC_ANNOTATE_STREAM_URL` | auto-synced from `LanguageDrillStack` CFN output | auto-synced from `LanguageDrillStack-dev` CFN output |
| `NEXT_PUBLIC_SENTRY_DSN` | prod Sentry project DSN | dev Sentry project DSN |
| `SENTRY_AUTH_TOKEN` | server-only; from Sentry → Settings → Auth Tokens (scopes: `project:releases`, `project:write`) | same token |
| `SENTRY_ORG` | Sentry org slug | same |
| `SENTRY_PROJECT` | Sentry project slug | same |
| `NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE` | prod Langfuse traces-URL template with `{cellKey}` placeholder (admin deep-link; unset → link hidden) | dev Langfuse traces-URL template with `{cellKey}` placeholder |

### Observability boundaries

Sentry covers browser, React render, and Next.js server-side / edge errors in `apps/web`. **Lambda API errors stay in CloudWatch**; **LLM call traces stay in Langfuse**; **email send failures stay in CloudWatch** (send and dispatcher Lambdas). The tools do not overlap — when triaging an incident, pick the inbox that matches the runtime where the error originated. See `docs/runbooks/email-dns-setup.md` for email setup and troubleshooting.

> **Where the API Lambda actually logs.** The Hono API handler (`LambdaConstruct`) writes to an **explicit** CloudWatch log group, **not** the default `/aws/lambda/<function-name>` one. Look in `LanguageDrillStack-LambdaLogGroup*` (prod) / `LanguageDrillStack-dev-LambdaLogGroup*` (dev), e.g. via `aws logs tail "$(aws logs describe-log-groups --query "logGroups[?contains(logGroupName,'LanguageDrillStack-LambdaLogGroup')].logGroupName" --output text)" --since 30m`. The legacy `/aws/lambda/LanguageDrillStack-LambdaHandler*` group is **orphaned** — it stopped receiving events when the explicit group was introduced, so an empty/stale view there does **not** mean logging is broken (it misled a prod incident triage once). Caught handler throws return a 500 via Hono but leave the Lambda `Errors` metric at 0 — confirm an incident from API-Gateway `5xx` + Lambda `Invocations` metrics, then read the explicit log group.

### Clerk JWT setup

The Clerk production instance must have a **JWT template** named `api` with these claims:

```json
{
  "aud": "language-drill",
  "sub": "{{user.id}}"
}
```

The frontend requests tokens via `getToken({ template: 'api' })`. API Gateway validates the JWT against Clerk's JWKS endpoint.

A **webhook** must be configured in Clerk pointing to `https://api.langdrill.app/webhooks/clerk` (subscribe to `user.created` **and** `user.deleted`). `user.created` creates the user row on signup; `user.deleted` deletes it (FK cascades sweep all dependent rows — right-to-erasure).

---

## Phase Plan

- **Phase 0** (current): monorepo scaffold, CDK skeleton, Neon schema v1, Clerk auth, CI/CD, invite gate
- **Phase 1**: core exercises (cloze, translation, vocab recall), Claude eval pipeline, pre-generation Lambda, SM-2 spaced repetition, progress dashboard
- **Phase 2**: audio — listening exercises (Polly), speaking (MediaRecorder → Transcribe → Claude)
- **Phase 3**: personalization (interests/profession), "app decides" playlist mode, level assessment
- **Phase 4**: Stripe + usage tiers, Expo mobile app, push notifications

---

## Key Decisions Already Made — Don't Revisit Without Good Reason

- Separate Lambda backend (not Next.js API routes)
- Neon over DynamoDB or Aurora
- Clerk over Auth.js / Cognito
- CEFR as the single progress spine (not custom scoring)
- Pre-generate content pool rather than generate-on-demand per user
- No streaks, XP, or gamification
