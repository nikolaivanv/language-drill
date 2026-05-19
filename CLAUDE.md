# Language Drill — Project Guide

## What This Is

A serverless, AI-powered language learning app focused on **active production practice** for intermediate+ learners. The primary user is the author (learning EN/ES/TR/DE at varying levels); designed to be portfolio-quality and shareable.

Full docs: `docs/architecture.md`, `docs/progress-tracking.md`.

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
| `pnpm bootstrap-prompts` | Idempotently register the six system prompts in Langfuse from the in-repo fallback strings. Supports `--dry-run` and `--check` (drift detection vs. live `production` label). |
| `pnpm eval:export` | Sample evaluation traces from Langfuse over a date window and write them as items into a Langfuse dataset (joined back to `user_exercise_history` for the user answer + exercise). |
| `pnpm eval` | Run a candidate prompt against a Langfuse dataset, link each per-item trace to the dataset run, and write a quality/cost/latency summary to `./eval-runs/<runName>.json`. |

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

Langfuse is now the live source for these prompts; the in-repo
`*_SYSTEM_PROMPT` constant is the fallback. Bumping
`*_SYSTEM_PROMPT_VERSION` is still required (drives the fallback cohort tag
and signals reviewers that the local fallback also changed).

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

- Early stage: invite codes (Clerk metadata) + daily AI usage caps (Upstash counters)
- Later: Stripe subscriptions; tiers: Free (limited AI evals/day) / Pro (unlimited)
- Bot protection: Clerk at signup, Upstash token bucket per user on API

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

### Observability boundaries

Sentry covers browser, React render, and Next.js server-side / edge errors in `apps/web`. **Lambda API errors stay in CloudWatch**; **LLM call traces stay in Langfuse**. The three tools do not overlap — when triaging an incident, pick the inbox that matches the runtime where the error originated.

### Clerk JWT setup

The Clerk production instance must have a **JWT template** named `api` with these claims:

```json
{
  "aud": "language-drill",
  "sub": "{{user.id}}"
}
```

The frontend requests tokens via `getToken({ template: 'api' })`. API Gateway validates the JWT against Clerk's JWKS endpoint.

A **webhook** must be configured in Clerk pointing to `https://api.langdrill.app/webhooks/clerk` (subscribe to `user.created`). This creates the user row in the database on signup.

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
