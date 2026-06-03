# Language Drill — Architecture & Tech Stack

## 1. Product Context

A serverless, AI-powered language learning app targeting active practice over passive consumption. Primary user is the author; designed to be portfolio-worthy and shareable. Scales to public use without re-architecting.

**Core constraints driving architecture:**
- Serverless-first: near-zero idle cost, scales automatically
- API-first: web now, mobile later — frontend and backend are strictly separated
- Multi-modal: text, audio, video content and input
- AI-heavy: content generation, answer evaluation, explanations
- Cost-controlled: pre-generate reusable content, enforce usage limits

---

## 2. Recommended Tech Stack

### Frontend — Web
| Concern | Choice | Rationale |
|---|---|---|
| Framework | **Next.js (TypeScript)** | App Router, RSC for fast loads, strong ecosystem, Vercel-native |
| Styling | **Tailwind CSS + shadcn/ui** | Fast to build, consistent design system, no runtime overhead |
| State / data | **TanStack Query** | Server state, caching, optimistic updates |
| Forms | **React Hook Form + Zod** | Typed forms with validation shared across web and API |
| Audio/video | **Web Audio API + MediaRecorder** | Native speaking/listening exercises without heavy deps |
| Hosting | **Vercel** | Zero-config deploys, preview URLs per PR, edge network |

### Mobile (later)
| Concern | Choice | Rationale |
|---|---|---|
| Framework | **Expo (React Native, TypeScript)** | Shares component logic and types with web; Expo Go for fast iteration |
| API client | Same TanStack Query setup | Code shared via a `packages/api-client` monorepo package |

### Backend API
| Concern | Choice | Rationale |
|---|---|---|
| Runtime | **AWS Lambda (TypeScript / Node.js)** | Familiar cloud, true serverless, pay-per-invocation |
| API layer | **API Gateway v2 (HTTP API)** | Low latency, cheap, JWT authorizer built-in |
| Framework | **Hono** | Lightweight, edge-native, typed routes, minimal cold-start overhead; tRPC is an alternative if you want end-to-end type safety without a schema layer |
| Validation | **Zod** | Shared schema definitions with frontend |
| IaC | **AWS CDK (TypeScript)** | Same language as the rest of the stack; no context switching |

> **Why not Next.js API routes?** They work but tie your backend to Vercel. A standalone Lambda API is reachable by the mobile app from day one and is easier to rate-limit and meter at the infrastructure level.

### Database
| Concern | Choice | Rationale |
|---|---|---|
| Primary DB | **Neon (serverless PostgreSQL)** | True serverless Postgres — scales to zero, branching per PR, familiar SQL, generous free tier |
| ORM | **Drizzle ORM** | TypeScript-first, lightweight, excellent Neon integration, schema-as-code |
| Caching | **Upstash Redis** | Serverless Redis — session cache, rate limit counters, leaderboard data; pay-per-request |

> **Why not DynamoDB?** Progress tracking, spaced repetition state, and content relations are inherently relational. PostgreSQL is a better fit. Neon's branching per PR is a killer feature for this workflow.

### Authentication
| Concern | Choice | Rationale |
|---|---|---|
| Auth provider | **Clerk** | Passwordless (magic link, OTP) + Google OAuth out of the box; React components, JWT tokens, invite/waitlist support, usage-based pricing (free at low volume) |

Clerk issues JWTs that API Gateway can verify directly — no custom auth Lambda needed.

### Storage
| Concern | Choice | Rationale |
|---|---|---|
| Audio / video | **AWS S3 + CloudFront** | Pre-signed URLs for upload, CDN for playback, cheap at scale |
| Pre-generated content | S3 + DB references | JSON/audio blobs in S3, metadata + relationships in Postgres |

### AI / GenAI
| Concern | Choice | Rationale |
|---|---|---|
| LLM | **Anthropic Claude API (claude-sonnet-4-6)** | Best-in-class instruction following, structured output, multilingual quality |
| TTS | **AWS Polly (Neural voices)** | Native speakers voices per language, low cost, synchronous and async modes |
| STT / pronunciation | **AWS Transcribe** | Streaming transcription for speaking exercises; confidence scores for basic accent assessment |
| Prompt caching | **Anthropic prompt caching** | Cache system prompts (language profiles, exercise templates) — reduces cost by ~80% on repeated calls |

### Background Jobs
| Concern | Choice | Rationale |
|---|---|---|
| Scheduler | **AWS EventBridge Scheduler** | Cron-triggered Lambdas — content pre-generation, spaced repetition reminders |
| Async tasks | **AWS SQS + Lambda** | Offload TTS generation, video processing, batch content generation |

---

## 3. Infrastructure Diagram

```
┌─────────────────────────────────────────────────────┐
│                     Users                           │
└───────────┬─────────────────────────┬───────────────┘
            │ Web                     │ Mobile (later)
      ┌─────▼──────┐           ┌──────▼──────┐
      │  Vercel    │           │  Expo / RN  │
      │  Next.js   │           │  (App Store)│
      └─────┬──────┘           └──────┬──────┘
            │                         │
            └──────────┬──────────────┘
                       │ HTTPS / JWT (Clerk)
              ┌────────▼────────┐
              │  API Gateway v2 │
              │  (AWS)          │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │  Lambda         │
              │  (Hono API)     │
              └───┬──────┬──────┘
                  │      │
       ┌──────────▼─┐  ┌─▼───────────────┐
       │  Neon      │  │  Upstash Redis  │
       │  Postgres  │  │  (cache/limits) │
       └────────────┘  └─────────────────┘
                  │
       ┌──────────▼──────────────────────┐
       │  AWS Services                   │
       │  S3 (content) + CloudFront      │
       │  Polly (TTS) + Transcribe (STT) │
       │  SQS (async jobs)               │
       │  EventBridge (cron)             │
       └─────────────────────────────────┘
                  │
       ┌──────────▼──────────────────────┐
       │  Anthropic Claude API           │
       │  (content gen, evaluation)      │
       └─────────────────────────────────┘
```

---

## 4. Monorepo Structure

```
language-drill/
├── apps/
│   ├── web/                  # Next.js app
│   └── mobile/               # Expo app (later)
├── packages/
│   ├── api-client/           # TanStack Query hooks + Zod types (shared)
│   ├── db/                   # Drizzle schema + migrations
│   ├── ai/                   # Prompt templates, Claude client wrapper
│   └── shared/               # Common types, utils, constants
├── infra/                    # AWS CDK stack
├── .github/
│   └── workflows/
├── package.json              # pnpm workspaces
└── turbo.json                # Turborepo
```

**Monorepo tooling: pnpm + Turborepo**
- pnpm workspaces for dependency management
- Turborepo for incremental builds and task pipelines

---

## 5. CI/CD

```
Push / PR ──► GitHub Actions
                │
                ├── lint + typecheck (all packages, parallel)
                ├── unit tests
                ├── Neon branch create (ephemeral DB per PR)
                ├── drizzle migrate (on PR branch)
                ├── integration tests (against PR DB)
                │
                ├── [PR] Vercel preview deploy (web)
                │         └── preview URL in PR comment
                │
                └── [main merge]
                      ├── CDK diff + deploy (Lambda, infra)
                      ├── Vercel production deploy (web)
                      └── Neon branch delete (PR cleanup)
```

**Key practices:**
- All infra changes go through CDK — no console click-ops
- DB migrations are forward-only; reviewed in PR
- Secrets in GitHub Actions Secrets → injected as Lambda env vars via CDK
- Dependabot for dependency updates

---

## 6. Data Model (High-Level)

```
users                          — Clerk user ID, profile, interests, profession
user_language_profiles         — (user, language, proficiency_level, assessed_at)
skills                         — taxonomy: grammar/vocabulary/listening/speaking/writing/culture
  skill_topics                 — e.g. "subjunctive mood", "food vocabulary"
exercises                      — pre-generated content (type, language, difficulty, topic, content_json, audio_s3_key)
exercise_tags                  — many-to-many: exercise ↔ skill_topic
user_exercise_history          — (user, exercise, score, response, evaluated_at)
spaced_repetition_cards        — (user, item, due_at, interval, ease_factor) — SM-2
playlists                      — curated sequences (system or user-created)
playlist_items                 — ordered exercises in a playlist
invitations                    — invite codes, used_by, expires_at
usage_events                   — AI feature calls, for metering and rate limiting
```

---

## 7. Content & AI Strategy

### Pre-generated content (the default)
- A background Lambda runs on a schedule to generate exercise batches per (language, skill, difficulty) combination using Claude
- Audio narration generated via AWS Polly and stored in S3
- Content is tagged, indexed, and served to any user — not regenerated per session
- Reduces Claude API cost dramatically; most users see the same pool of exercises

### Real-time AI (on-demand, metered)
| Use case | Model | Notes |
|---|---|---|
| Answer evaluation | Claude (sonnet) | Check grammar, meaning, pronunciation phonetics |
| Explanation generation | Claude (sonnet) | "Why was my answer wrong?" |
| Custom exercise creation | Claude (sonnet) | User selects topic/context; rate limited |
| Level assessment | Claude (sonnet) | Initial proficiency quiz evaluation |
| Chat-style conversation practice | Claude (sonnet) | Expensive — gate behind higher tier |

### Prompt caching
All AI calls cache the system prompt (language profile + exercise format spec). Anthropic charges ~10% of normal price for cache hits. Given a user completes multiple exercises per session, this yields ~80% cost reduction on the prompt token side.

---

## 8. Exercise Types & Rendering

| Type | Input mode | Implementation |
|---|---|---|
| Cloze (fill the blank) | Typed text | Simple input + Claude evaluation |
| Translation | Typed text | Claude semantic evaluation (not exact match) |
| Listening comprehension | Multiple choice or typed | Pre-recorded audio + question |
| Speaking (pronunciation) | Microphone | MediaRecorder → Transcribe → Claude eval |
| Sentence construction | Drag-and-drop or typed | Structured evaluation |
| Error correction | Typed | Given a wrong sentence, fix it |
| Free writing | Typed text | Claude grades grammar + meaning |
| Vocabulary — active recall | Typed (no options) | Spaced repetition card, no word list shown |
| Culture awareness | Multiple choice or short answer | — |

---

## 9. Proficiency & Progress Tracking

- **No Duolingo-style XP/streaks.** Progress is skill-based.
- Each `skill_topic` has an estimated mastery score per user, derived from exercise history (weighted recency, difficulty).
- Spaced repetition (SM-2 algorithm) drives vocabulary and grammar recall scheduling.
- "Growth zones" are skill topics where the user is in the 40–70% mastery range — prioritized in "let the app decide" mode.
- Level assessment: initial quiz + ongoing bayesian adjustment from exercise performance.

---

## 10. Access Control & Monetization

### Early stage
- **Invite codes**: `invitations` table; code required at signup (Clerk metadata)
- **Usage limits**: `usage_events` table + Upstash Redis counters; checked in API middleware
  - e.g. 20 AI-evaluated exercises/day on free tier
- **Bot protection**: Clerk handles signup abuse; Upstash Redis for API rate limiting (token bucket per user)

### Later
- **Stripe** for subscription billing; Clerk + Stripe customer ID linkage
- Tiers: Free (limited AI), Pro (unlimited), potentially a one-time "buy exercises" model

---

## 11. Multi-modal Audio / Video

- **Listening exercises**: audio files stored in S3, served via CloudFront signed URLs
- **Speaking exercises**: browser captures audio (MediaRecorder API), uploads to S3 via pre-signed URL, Lambda triggers Transcribe, result evaluated by Claude
- **Video**: S3 + CloudFront; consider AWS MediaConvert for adaptive bitrate if needed at scale
- **TTS languages**: AWS Polly supports EN, ES, DE, TR (neural voices available for all four)

---

## 12. Security Checklist

- All API routes require Clerk JWT (API Gateway JWT Authorizer)
- S3 objects are private; access via pre-signed URLs only
- Claude API key stored in AWS Secrets Manager, injected at Lambda startup
- Input sanitized with Zod before any DB write or AI call
- Rate limiting on all AI-facing endpoints (Upstash Redis)
- No user content included in shared pre-generated exercise pool (only system-generated content is shared)
- CORS restricted to known origins

---

## 13. Decisions to Revisit

| Decision | Trigger to revisit |
|---|---|
| Hono vs tRPC | If type-safe client calls become painful to maintain |
| Neon vs Aurora Serverless v2 | If Neon pricing becomes a concern at scale |
| AWS Polly vs ElevenLabs | If voice quality becomes important for retention |
| Monolith Lambda vs per-route functions | If cold starts become a problem |
| Self-hosted Remix/Next API routes | If API Gateway costs spike unexpectedly |

---

## 14. Phase Plan

### Phase 0 — Foundation
- [ ] Monorepo scaffold (pnpm + Turborepo)
- [ ] CDK stack skeleton (Lambda, API Gateway, S3, SQS)
- [ ] Neon database + Drizzle schema v1
- [ ] Clerk auth integration (web)
- [ ] CI/CD pipeline (GitHub Actions + Vercel + Neon branching)
- [ ] Invite-only access gate

### Phase 1 — Core exercises (web)
- [ ] Exercise renderer (cloze, translation, vocabulary recall)
- [ ] Claude evaluation pipeline
- [ ] Pre-generation Lambda + exercise pool
- [ ] Spaced repetition engine (SM-2)
- [ ] Basic progress dashboard (per skill, per language)

### Phase 2 — Audio
- [ ] Listening exercises (Polly TTS + S3)
- [ ] Speaking exercises (MediaRecorder → Transcribe → Claude)
- [ ] Pronunciation scoring (basic)

### Phase 3 — Personalization & modes
- [ ] User interest/profession profile
- [ ] "App decides" playlist mode
- [ ] Level assessment flow
- [ ] Custom practice mode

### Phase 4 — Monetization & mobile
- [ ] Stripe integration + usage tiers
- [ ] Expo mobile app (shared API client)
- [ ] Push notifications for spaced repetition reminders
