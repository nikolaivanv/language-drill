# Admin Panel — What to Surface (Proposal)

**Status:** proposal · **Author:** design discussion, 2026-06-16

## Why now

We have a real content pool (exercises, theory, reading texts) and real user
data (progress, history, usage). The tooling to manage them hasn't kept up:

- **Content moderation is CLI-only.** Approving/rejecting flagged content runs
  through `pnpm review:flagged` / `review:flagged:theory` — a terminal REPL.
  There is no way to inspect or demote already-**approved** content, which is
  important because auto-approved content goes live **unreviewed**.
- **User data has no admin surface at all.** Inspecting a user's progress,
  history, plan, or usage means hand-writing SQL against the prod Neon branch.
- **Ops/cost visibility is partial.** `/admin/generation` shows spend, job
  counts, and approval rates, but there's no job-level log, no per-failure
  drill-down, and no view of live AI capacity / kill-switch state.

This doc catalogs the surfaces an admin panel should expose, then ranks them
into a three-tier roadmap. It is a design proposal, not an implementation plan.

### What exists today

| Page | Endpoint(s) | Shows |
|---|---|---|
| `/admin/generation` | `GET /admin/generation-stats`, `GET /admin/pool-status` | LLM spend (week/month), job status counts (7d), approval rates per (lang, level, type), pool coverage table |
| `/admin/theory` | `GET /admin/theory/coverage` | Theory approval coverage grid (3 langs × 4 CEFR levels) |
| `/admin/invites` | `POST/GET /admin/invites`, `POST /admin/invites/:id/revoke` | Generate / list / revoke invite codes |

All `/admin/*` API routes are gated by `adminMiddleware`
(`infra/lambda/src/middleware/admin.ts`) against the `ADMIN_USER_IDS` env var.
Frontend pages are gated separately by the `(dashboard)/admin/layout.tsx` check
on `sessionClaims.publicMetadata.admin`.

---

## Cross-cutting foundations

These are not features so much as the scaffolding everything else hangs on.
They belong in Tier 1 because the later surfaces compound their cost if they're
deferred.

### Consolidate admin authorization

Today two independent checks must both be true for full admin access, and
nothing keeps them in sync:

- **Backend:** `ADMIN_USER_IDS` env var (comma-separated Clerk user IDs),
  read in `infra/lambda/src/middleware/admin.ts` and `usage/plan.ts`.
- **Frontend:** `publicMetadata.admin === true`, set **manually** in the Clerk
  dashboard per user (`apps/web/app/(dashboard)/admin/layout.tsx`).

A user can pass one check and fail the other. Recommend a single source of
truth — either drive `publicMetadata.admin` from `ADMIN_USER_IDS` via the Clerk
webhook / a sync script, or expose a `GET /admin/me` the frontend trusts for
gating. Pick one before building more admin pages against the current split.

### Admin audit log

No audit table exists today. Every **mutating** admin action below
(approve/reject/demote content, change a user's plan, toggle the kill switch,
trigger generation) should append to a new `admin_audit_log` table:

```
admin_audit_log
  id           uuid pk
  adminUserId  text        -- Clerk id of the acting admin
  action       text        -- 'content.approve' | 'content.demote' | 'user.plan_change' | ...
  targetType   text        -- 'exercise' | 'theory_topic' | 'user' | 'capacity' | ...
  targetId     text
  metadata     jsonb       -- before/after, reason, filters applied
  createdAt    timestamp
```

This is cheap to add now and expensive to backfill later. It also makes the
panel safe to share with non-author admins down the line.

### Unified `/admin` shell

The three existing pages are disjoint. Introduce a single `/admin` shell with
left-nav sections (Moderation · Pool · Ops · Users · Invites) so new surfaces
slot in instead of sprawling into more top-level routes.

---

## Surfaces by goal

Each surface notes the backing tables/endpoints and whether it is **read-only**
or **mutating** (mutating ⇒ must write to `admin_audit_log`).

### 1. Moderate content

| Surface | What it shows / does | Backing data | Mode |
|---|---|---|---|
| **Flagged review queue** | The UI version of `review:flagged`. List `exercises` / `theory_topics` with `review_status = 'flagged'`, filterable by language/level/type/grammar point. Drill into `contentJson`, `flaggedReasons`, `qualityScore`. **Approve** → `manual-approved`, **Reject** → `rejected`. | `exercises`, `theory_topics` (`review_status`, `flagged_reasons`, `quality_score`) | Mutating |
| **Content browser & search** | Browse/search the **approved** pool by grammar point or text. Inspect any item's `contentJson`, `coverageTags`, `qualityScore`, `generationSource`, `modelId`. **Demote** (→ flagged) or **delete** a bad approved item — the only post-hoc check on auto-approved content. | `exercises`, `theory_topics` | Mutating |
| **Reading-text moderation** | `generated_reading_texts` is a **cross-user shared cache** — one bad passage is served to everyone who hits the same cache key. Surface entries (by language/CEFR/hit count), inspect text, evict. | `generated_reading_texts` (`cache_key`, `hit_count`, `text`) | Mutating |

Reason codes are a bounded enum (`packages/shared/src/generation-reasons.ts`)
with display labels in `REASON_LABELS` — the queue can render them directly.

### 2. Pool & curriculum health

| Surface | What it shows / does | Backing data | Mode |
|---|---|---|---|
| **Pool health drill-down** | Extends today's pool-coverage table: click a cell to see its exercises, **per-axis diversity vs. floors** (person / polarity / wordClass / sentenceType), depletion rate, target vs. actual, and a **rejection-reason breakdown** (`rejectionReasonCounts`) to spot systematic generation failures. | `exercises.coverageTags`, `generation_jobs.coverageOutcome` / `rejectionReasonCounts`, `GET /admin/pool-status` | Read-only |
| **On-demand generation trigger** | Refill an underfilled cell from the UI. The job model already reserves `trigger = 'admin'`; no endpoint exists yet. | new `POST /admin/generate` → SQS, `generation_jobs` | Mutating |
| **Curriculum / grammar-point reference** | Grammar points per language/level, CEFR mapping, which have coverage specs, suitability flags (e.g. `sentenceConstructionSuitable`). Mostly read-only reference. | curriculum source, `skill_topics` | Read-only |

### 3. Ops & cost

| Surface | What it shows / does | Backing data | Mode |
|---|---|---|---|
| **Generation job log** | List `generation_jobs` + `theory_generation_jobs`: status, trigger, requested/produced/approved/flagged/rejected counts, cost, `curriculumVersion`. Drill into **failed** jobs (`errorMessage`). Filter by cell/status/date. | `generation_jobs`, `theory_generation_jobs` | Read-only |
| **Cost dashboard** | Spend by week/month, broken down by language/type/model. Extends today's headline numbers. | `generation_jobs` (`costUsdEstimate`, token counts) | Read-only |
| **Usage & capacity** | Trailing-24h AI events vs. `AI_GLOBAL_DAILY_CAP`, kill-switch state, per-bucket usage (`ai_evaluation`, `read_annotation`, …), top consumers. Optionally **toggle** the kill switch / cap (see Open Decisions). | `usage_events`, `usage/limits.ts`, `usage/global-capacity.ts` | Read-only (+ optional mutating) |

### 4. Inspect user data

| Surface | What it shows / does | Backing data | Mode |
|---|---|---|---|
| **User search & detail** | Find users by email/id; show profile, per-language proficiency, preferences/goals, plan, invite redeemed, today's usage. | `users`, `user_language_profiles`, `user_preferences`, `invitations`, `usage_events` | Read-only |
| **Progress drill-down** | Per-language grammar mastery map (`user_grammar_mastery`), CEFR estimate, exercise history with Claude evaluations, practice sessions, fluency attempts, spaced-repetition state, saved vocabulary + review state. | `user_grammar_mastery`, `user_exercise_history`, `practice_sessions`, `fluency_attempts`, `spaced_repetition_cards`, `user_vocabulary`, `vocabulary_review_*` | Read-only |
| **Support actions** | Change a user's plan (`free` ⇄ `boosted`). Everything else stays read-only. | `users.plan` | Mutating |

**Privacy note:** `user_exercise_history.responseJson` and `read_entries`
contain the user's own answers and pasted text. Keep these surfaces read-only,
gate them tightly, and log access if the panel is ever shared. Right-to-erasure
is already handled by the `user.deleted` webhook cascade.

---

## Prioritized roadmap

### Tier 1 — MVP

The highest-leverage cut: makes moderation a UI activity and opens up user data,
which is the stated goal. Includes the foundations so later tiers don't pay
interest.

1. Unified `/admin` shell + **consolidated auth**.
2. **Flagged review queue** (exercises + theory) — retire the CLI REPL.
3. **Content browser** with demote/delete of approved content.
4. **User search + detail + progress drill-down** (read-only).
5. **Generation job log** (failures + cost drill-down).

### Tier 2 — Next

6. **On-demand cell generation** trigger.
7. **Pool health drill-down** + diversity vs. floors + rejection-reason analytics.
8. **Usage & capacity** dashboard (+ kill-switch / cap toggle, pending the
   config-store decision).
9. **Plan management** (change user plan).
10. **`admin_audit_log`** wired into every mutating action above.

### Tier 3 — Later

11. **Curriculum / grammar-point management** UI.
12. **Reading-text cache moderation**.
13. **Langfuse / eval links** — deep-link from a flagged item or cell to its
    traces and `eval:gen` runs rather than rebuilding that analysis in-app.
14. **UI-triggered revalidation** (the `revalidate:cloze` pass from a cell view).

---

## Open decisions

- **Kill switch / global cap are env-driven via CDK** (`AI_KILL_SWITCH`,
  `AI_GLOBAL_DAILY_CAP`) and only re-read on deploy. Toggling them from the UI
  requires a **runtime config store** (Redis flag or a DB `app_config` row) that
  the Lambdas read on each request. Until that exists, the Usage & capacity
  surface should be **read-only** and the toggle deferred. Decision needed:
  build the config store, or keep capacity controls deploy-only.
- **Audit-log retention** — append-only forever, or periodic prune? Defaults to
  forever (volume is low: admin actions, not user events).
- **Content deletion vs. demotion** — hard `DELETE` of an approved exercise vs.
  setting `review_status = 'rejected'`. Soft-reject is reversible and keeps the
  dedup index honest; prefer it unless a row is truly malformed.
