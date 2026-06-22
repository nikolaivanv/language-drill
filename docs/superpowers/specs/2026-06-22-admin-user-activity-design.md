# Admin User-Activity Panel — Design

**Date:** 2026-06-22
**Status:** Approved (design); pending implementation plan
**Branch/worktree:** `feat-admin-user-activity`

## Purpose

Give the admin (currently the sole author) three server-truth lenses on user
activity that client-side PostHog cannot provide:

1. **Troubleshooting** — reconstruct specific problematic drill sessions.
2. **General activity level** — who is drilling, how much.
3. **Content correctness** — which exercises users fail most, for review.

### Division of labor with PostHog

PostHog (built in parallel) owns **behavior**: page views, funnels, retention,
drop-off, feature adoption, client errors. This panel owns **server-truth
correctness**: actual answer text, Claude's evaluation, per-exercise pass
rates, session reconstruction. We deliberately do **not** rebuild
funnels/retention here, and do **not** try to derive drill-correctness from
PostHog.

## Build order (by value)

1. **#2 Session drill-down** — highest value, zero PostHog overlap.
2. **#3 Most-failed exercises** — new aggregation; bridges into existing moderation.
3. **#1 Roster** — leanest; most PostHog-redundant; jump-off into #2.

## Shared infrastructure

- New nav entry **`/admin/activity`** under the existing admin shell
  (`apps/web/app/(admin)/admin/`), gated by `ADMIN_USER_IDS`.
- Three tabs: **Sessions** (#2), **Failures** (#3), **Roster** (#1).
- New read-side routes in `infra/lambda/src/routes/admin.ts`. **No new tables.**
- Source tables: `practiceSessions`, `userExerciseHistory`, `errorObservations`,
  `exerciseFlags`, `usageEvents`, `exercises`.
- Aggregates are windowed (7d/30d) and paginated. No real-time.

## View #2 — Session drill-down

### Feed: `GET /admin/activity/sessions`

Returns only **problematic** sessions by default. A session is problematic if
any of:

- **flagged** — session has ≥1 `exerciseFlags` row (joined via
  `userExerciseHistory.sessionId`) with `status='open'`.
- **abandoned** — `completedAt IS NULL` AND `startedAt < now() - 30m`.
- **low-score** — `completedAt IS NOT NULL` AND
  `correctCount / exerciseCount < 0.5`.

**Order:** flagged → abandoned → low-score, each newest-first.

**Row shape:** truncated `userId`, `language·difficulty`, correct/total (or
"abandoned"), signal badge(s), relative time.

**Query params:**
- `?all=true` — drop the problem filter, show all recent sessions.
- `?userId=` / `?email=` — scope to one user (secondary search path). Email
  resolves via Clerk lookup; `userId` matches by substring. Exact resolution
  mechanism confirmed during implementation.
- Standard pagination (cursor or limit/offset, matching existing admin routes).

### Detail: `GET /admin/activity/sessions/:id`

Expands one session into its ordered exercises (`practiceSessions.exerciseIds`
preserves order). Per exercise:

- Prompt / content (`exercises.contentJson`).
- The user's answer + Claude score & feedback (`userExerciseHistory.responseJson`,
  `score`).
- Extracted `errorObservations` (wrongText → correction, errorType, severity).
- Any `exerciseFlags` the user raised on that attempt.
- **Langfuse deep-link** via existing `NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE`.

## View #3 — Most-failed exercises

### `GET /admin/activity/failures`

Per-exercise aggregate over a window (default 30d), using the
`(exerciseId, evaluatedAt)` index:

```
exerciseId, attempts, distinctUsers, failRate (score < 0.5), avgScore
```

**Filters:** `language` / `difficulty` / `type` / `grammarPointKey`.

**False-positive guards** (high fail-rate ≠ broken exercise):
- Default `attempts ≥ 5` threshold.
- Surface `distinctUsers` prominently (one struggling user ≠ bad content).
- Show existing `exercises.qualityScore` and open-flag count per exercise.

**Row expansion:** exercise content + a sample of wrong answers → corrections
from `errorObservations`. Rows wire into the **existing**
`POST /admin/content/exercises/:id/{demote,reject}` actions — review-to-action
on one screen.

## View #1 — Roster

### `GET /admin/activity/roster`

Sortable user table: truncated `userId`, last-active, sessions (7d/30d), drills
submitted (7d/30d), languages×levels, avg score, AI-events (7d). Joins
`practiceSessions` + `userExerciseHistory` + `usageEvents`. Each row links into
the #2 feed scoped to that user. Deliberately lean.

## Cross-cutting concerns

- **PII/access** — routes already gated by `ADMIN_USER_IDS`. No read-audit
  logging (overkill for sole admin). Moderation **actions** in #3 hit the audit
  log via the existing handlers they reuse.
- **No real-time** — windowed aggregates, paginated feeds.
- **Testing** — lambda route handlers get unit tests with a mocked db (per
  existing admin-route test patterns); web pages get component tests mocking the
  endpoints.

## Out of scope

- Funnels, retention, drop-off analysis (PostHog).
- New aggregation tables / materialized views (ad-hoc queries on existing
  indexes are sufficient at current scale).
- Read-audit logging of admin views.
