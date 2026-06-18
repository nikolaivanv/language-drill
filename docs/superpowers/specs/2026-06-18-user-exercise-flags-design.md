# User-flagged exercises + admin review — Design

**Date:** 2026-06-18
**Status:** Approved (brainstorming)
**Branch:** `feat/user-exercise-flags`

## Problem

When a user does an exercise, the answer the evaluator accepts or the explanation
it gives can be wrong. Today the user has no way to report that, and an admin has
no surface to review such reports and pull bad content from the served pool.

We want:

1. A user can **flag** an exercise they just attempted ("answer seems wrong",
   "explanation seems wrong", etc.).
2. An admin can **review** each flag with full context — the exercise, the user's
   exact answer, and the evaluator's response — and **reject** (demote) the
   exercise if it is genuinely bad, or **dismiss** the flag if it is fine.

## Decisions (from brainstorming)

- **Flag target:** the specific attempt (the `user_exercise_history` row), so the
  admin sees the exact answer + evaluation that prompted the flag.
- **Effect at flag time:** none. A flag creates an `open` review record only; the
  exercise stays in the served pool until an admin acts. Flags are a review queue,
  not an auto-takedown.
- **User input:** a **category** (radio) + an **optional free-text note**.
- **Admin surface:** a **new `/admin/flags` page** (separate from the existing
  generation-time `/admin/moderation` queue, which is a different data shape).
- **Admin actions:** **Reject** (terminal — sets the exercise
  `reviewStatus='rejected'`, pulled from pool) and **Dismiss** (closes the flag,
  exercise unchanged).

## Existing patterns this builds on

- `packages/db/src/schema/exercises.ts` — `exercises.reviewStatus`
  (`'auto-approved' | 'manual-approved' | 'flagged' | 'rejected'`).
- `packages/db/src/schema/progress.ts` — `user_exercise_history` with
  `id`, `userId`, `exerciseId`, and `responseJson` = `{ userAnswer, evaluation }`.
- `packages/db/src/schema/audit.ts` + `infra/lambda/src/lib/admin-audit.ts`
  (`recordAdminAction`) — audit logging for mutating admin actions.
- `infra/lambda/src/routes/admin.ts` — `adminMiddleware` (`ADMIN_USER_IDS`),
  existing demote/reject endpoints (`transitionContentExercise`).
- `infra/lambda/src/routes/exercises.ts` — `POST /exercises/:id/submit` already
  mints the `user_exercise_history.id` (`submissionId`).
- `apps/web/app/(dashboard)/drill/_components/feedback-shell.tsx` — wraps all
  evaluation feedback; natural home for the flag control.
- `apps/web/components/admin/admin-nav-items.tsx` + `(admin)` route group — admin
  pages and nav.
- `packages/api-client/src/hooks/*` + `schemas/*` — TanStack Query hooks + Zod
  types (existing `flagged.ts` / `useFlaggedQueue.ts` cover the **generation-time**
  queue; the new code is named `user-flags` to avoid collision).

## Data model

New table `exercise_flags` (`packages/db/src/schema/exercise-flags.ts`, exported
from the schema barrel):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | `defaultRandom()` |
| `history_id` | uuid | → `user_exercise_history(id)`, `onDelete: cascade`. The specific attempt. **Unique** (one flag per attempt). |
| `exercise_id` | uuid | → `exercises(id)`, `onDelete: cascade`. Denormalized for admin joins/filtering. |
| `user_id` | text | → `users(id)`, `onDelete: cascade`. Who flagged. |
| `category` | text | `'wrong_answer' \| 'misleading_explanation' \| 'confusing_prompt' \| 'other'` |
| `note` | text | nullable |
| `status` | text | `'open' \| 'resolved_rejected' \| 'resolved_dismissed'`, default `'open'` |
| `resolved_by` | text | nullable — admin userId |
| `resolved_at` | timestamptz | nullable |
| `created_at` | timestamptz | default `now()`, indexed for queue ordering |

Index on `status` (+ `created_at`) for the admin queue. Forward-only Drizzle
migration generated via `drizzle-kit generate` (renumber against `main` if it
collides — see the migration-renumber note in project memory). **Verify on a
throwaway Neon branch, not local dev `.env` (which points at the shared `dev`
branch and would pollute per-PR CI forks).**

## Backend (`infra/lambda`)

### Submit endpoint change
`POST /exercises/:id/submit` returns `submissionId` (the `user_exercise_history.id`
it already mints) **alongside** the existing evaluation result — non-destructive
addition. The api-client submit schema is extended to carry an optional
`submissionId`.

### User route — `infra/lambda/src/routes/exercises.ts`
`POST /exercises/:exerciseId/flag` (user auth):
- Body: `{ submissionId: uuid, category: <enum>, note?: string (trimmed, max ~1000) }`.
- Validates the `user_exercise_history` row `submissionId` exists, belongs to the
  calling `userId`, and its `exerciseId` matches the path param → else `404`/`403`.
- Inserts the flag with `status='open'`. Duplicate (unique `history_id`) → `409`
  with a clear code (e.g. `ALREADY_FLAGGED`) so the UI can show "already flagged".
- No change to the exercise. Returns `{ id, status, createdAt }`.

### Admin routes — `infra/lambda/src/routes/admin.ts` (under `/admin/*`)
- `GET /admin/flags?status=open` — returns flags joined to exercise `contentJson`
  + history `responseJson` (`{ userAnswer, evaluation }`), with category/note/
  timestamps and current exercise `reviewStatus`. Default `status=open`,
  newest first.
- `POST /admin/flags/:id/reject` — sets exercise `reviewStatus='rejected'`, flag
  `status='resolved_rejected'`, `resolved_by`/`resolved_at`; `recordAdminAction`
  (`user_flag.reject`, targetType `exercise`, targetId = exerciseId, metadata
  `{ flagId }`). Idempotent on already-resolved flags.
- `POST /admin/flags/:id/dismiss` — flag `status='resolved_dismissed'`, exercise
  untouched; `recordAdminAction` (`user_flag.dismiss`).

Add `'user_flag.reject'` and `'user_flag.dismiss'` to the audit action union in
`infra/lambda/src/lib/admin-audit.ts`.

## api-client (`packages/api-client`)

- `schemas/user-flags.ts` — `FlagCategory` enum, `FlagExerciseRequest`,
  `FlagExerciseResponse`, `UserFlagQueueItem` (exercise + answer + evaluation +
  category/note), `ResolveUserFlagResponse`.
- `hooks/useUserFlags.ts`:
  - `useFlagExercise({ fetchFn })` — `POST /exercises/:exerciseId/flag`.
  - `useUserFlagsQueue({ fetchFn })` — `GET /admin/flags`, queryKey
    `['admin', 'user-flags']`.
  - `useResolveUserFlag({ fetchFn })` — `POST /admin/flags/:id/(reject|dismiss)`,
    invalidates the queue.
- Extend the submit-result schema (`schemas/exercise.ts`) so the submit hook
  surfaces `submissionId`.

## User UI

In `feedback-shell.tsx`, after the evaluation feedback renders, add a low-emphasis
"Flag this exercise" control. Clicking opens a compact dialog: category radios +
optional note → `useFlagExercise`. On success it confirms ("Thanks — flagged for
review") and disables/replaces the control. The flag control is only shown when a
`submissionId` is available.

`drill/page.tsx`'s `handleSubmit` captures `submissionId` from the submit response
and threads it (with `exerciseId`) into `FeedbackShell`.

## Admin UI

New `apps/web/app/(admin)/admin/flags/page.tsx` + a "User flags" entry in
`admin-nav-items.tsx`. Renders `useUserFlagsQueue` as a list of cards; each card
shows the exercise prompt/content, the user's flagged answer, the evaluator's
response, the user's category + note, and **Reject exercise** / **Dismiss**
buttons wired to `useResolveUserFlag`. Empty state when the queue is clear. Same
admin auth/layout as existing `(admin)` pages.

## Audit + testing

- **db:** schema shape + migration applies cleanly.
- **lambda (user flag):** happy path insert; ownership validation (`submissionId`
  belonging to another user → rejected); exercise-mismatch rejected; duplicate
  flag → `409 ALREADY_FLAGGED`; submit endpoint now returns `submissionId`.
- **lambda (admin):** queue join shape; `reject` sets `reviewStatus='rejected'` +
  resolves flag + writes audit; `dismiss` leaves exercise untouched + writes audit;
  admin auth enforced.
- **web:** flag dialog renders + submits + disables on success; admin flags page
  renders queue, reject/dismiss call the mutation. Grep the app for any changed
  labels/routes when touching `FeedbackShell` (shared component — other tests
  render it).

## Out of scope (YAGNI)

- Auto-demote thresholds / multi-flag aggregation.
- User-facing flag history ("my flags").
- Notifications to the user when their flag is resolved.
- Editing/regenerating a rejected exercise from the flag (existing moderation
  tooling already covers content lifecycle).
