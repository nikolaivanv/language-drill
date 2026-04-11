# Language Drill — Project Guide

## What This Is

A serverless, AI-powered language learning app focused on **active production practice** for intermediate+ learners. The primary user is the author (learning EN/ES/TR/DE at varying levels); designed to be portfolio-quality and shareable.

Full docs: `docs/architecture.md`, `docs/progress-tracking.md`.

---

## Positioning

Target: **intermediate plateau** — learners past A2 who've exhausted Duolingo but can't yet speak fluently. Tagline: *"What you do between italki sessions."*

Differentiators (only powerful together):
- Forces **written and spoken production**, not multiple-choice recognition
- **Skill-based mastery tracking** (not XP/streaks/lessons) mapped to CEFR and real exams
- Designed from the start for **polyglots** — multiple languages at different levels
- Combines proven methods (spaced repetition, Cloze, Pimsleur-style audio) with AI evaluation

Out of scope: accent reduction, gamification, social features, delta learning (learn Italian via Spanish).

---

## Tech Stack

| Layer | Choice |
|---|---|
| Web frontend | Next.js (App Router) + TypeScript, hosted on Vercel |
| Mobile (later) | Expo / React Native |
| Backend API | AWS Lambda + API Gateway v2, Hono framework |
| IaC | AWS CDK (TypeScript) |
| Database | Neon (serverless Postgres) + Drizzle ORM |
| Cache / rate limiting | Upstash Redis |
| Auth | Clerk (passwordless + Google OAuth, invite codes) |
| Storage | S3 + CloudFront |
| LLM | Anthropic Claude API (`claude-sonnet-4-6`) with prompt caching |
| TTS | AWS Polly (neural voices — EN/ES/DE/TR all supported) |
| STT | AWS Transcribe (speaking exercises) |
| Background jobs | EventBridge Scheduler + SQS + Lambda |
| Monorepo | pnpm workspaces + Turborepo |

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
infra/            — AWS CDK stack
```

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

Merge → CDK deploy (Lambda + infra)
      → Vercel production deploy
      → Neon branch deleted
```

All infra via CDK — no console click-ops. Migrations are forward-only.

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
