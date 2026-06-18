# Resume an In-Progress Today-Session

**Date:** 2026-06-18
**Surfaces:** `infra/lambda` (sessions routes), `packages/api-client`, `apps/web` (today timeline + drill page)

## Problem

The "today" plan and a drill **session** are meant to be the same thing: a
5-exercise session, one timeline row per exercise, tracked `done`/`queued` via
`hydrateFromSession` (`infra/lambda/src/lib/today-plan.ts`). The first non-done
row is computed as `next-up` and is the only row given a "start" button
(`today-timeline.tsx`), implying "start" should **continue** the session.

It doesn't. Two hardcoded spots break resume:

- `today-timeline.tsx`: every next-up link is a static `/drill?start=quick`,
  carrying no session id or resume intent.
- `drill/page.tsx`: `?start=quick` always fires `POST /sessions`
  (`exerciseCount: 5`), creating a brand-new session of freshly-drawn pool
  exercises. There is no resume path.

So completing exercise 1, returning to "today", and clicking "start" on the
next row discards the in-progress session and starts a fresh one (new dots 1–5).
It also lets a user pile up multiple "today" sessions in one day.

## Goal

Clicking "start" on the next-up today row resumes the existing **incomplete**
today-session at its first unattempted exercise, instead of creating a new
session.

**In scope:** resume only.
**Out of scope (noted, not fixed):** the pre-start advisory-plan vs
actual-session mismatch (Path B composes a structured mix, but `POST /sessions`
draws a random 5); deduping multiple-sessions-per-day rows already created by the
old behavior.

## Design

### Backend — `infra/lambda/src/routes/sessions.ts`

1. **Resume handle on the today response.** In `GET /sessions/today` Path A, add
   `resumeSessionId: string | null` to the JSON body — the session id when
   `session.completedAt === null`, else `null`. Path B and the completed case
   return `null` (they keep `?start=quick`). Resumed session = the existing
   "most recent row started today" selection (already `orderBy desc(startedAt)
   limit 1`).

2. **New `GET /sessions/:id`.** Owner-only (404 when missing or not the caller's
   session). Returns the same exercise shape as `POST /sessions` plus attempt
   state:

   ```
   {
     id: string,
     exercises: [{ id, type, language, difficulty, grammarPointKey, contentJson }],
     attemptedExerciseIds: string[],
     completedAt: string | null,
   }
   ```

   Exercises are returned in stored `exerciseIds` order, audio presigned via
   `presignAudioUrl` / `withAudioUrl`. `attemptedExerciseIds` comes from the same
   `user_exercise_history` left-join Path A uses, filtered by `sessionId`. Like
   Path A, this read does **not** filter on `review_status` (a slot that was in
   the manifest stays in the manifest).

### api-client — `packages/api-client`

3. Add `resumeSessionId: z.string().nullable()` to the today response schema. Add
   a Zod schema + `useSession({ id })` query hook for `GET /sessions/:id`
   (returning the shape above; `exercises` reuses the existing `ExerciseResponse`
   shape so the reducer's `items` type is unchanged).

### Web — `apps/web`

4. **Timeline link** (`app/(dashboard)/_components/today-timeline.tsx`):

   ```ts
   const drillHref = data.resumeSessionId
     ? `/drill?resume=${data.resumeSessionId}`
     : `/drill?start=quick`;
   ```

   The next-up `TimelineItem` shows **"continue →"** when resuming (thread a
   small label/flag prop). `AllDoneCard` unchanged.

5. **Drill page resume path** (`app/(dashboard)/drill/page.tsx`). Parse
   `?resume=<id>` into a `resumeId` state. A new effect, parallel to the
   create-session effect: when `resumeId` is set and `state.kind === 'idle'`,
   fetch the session via `useSession`; on success dispatch `RESUME_SUCCEEDED`.
   Resume bypasses the difficulty selector and the difficulty-change RESET path
   (the session's exercises are fixed). If every exercise is already attempted
   (transient "all done, not finalized"), `router.push('/drill/debrief/<id>')`
   instead of entering an empty session.

6. **Reducer `RESUME_SUCCEEDED`** (`drill/_components/session-reducer.ts`). New
   action carrying `{ id, exercises, attemptedExerciseIds }`. Builds:

   ```ts
   { kind: 'inSession', session: { id }, items: exercises,
     index: firstUnattemptedIndex, perItemSubmission: { kind: 'idle' },
     skippedCount: 0 }
   ```

   `firstUnattemptedIndex` = first position in `exercises` whose id is not in
   `attemptedExerciseIds`. Progress/dots derive from `index`
   (`selectProgressFraction`), so earlier items render as done with no per-item
   flags. Only valid from `idle`/`creating` (mirror `CREATE_SUCCEEDED`'s guard).

## Decisions

- **Button label:** "continue →" when resuming.
- **First-unattempted rule:** resume returns the user to the first exercise with
  no recorded attempt. A *skipped* item (advanced past on a submit error, no
  history row) is therefore re-presented on resume — simple and arguably correct.
- **Completed session:** `resumeSessionId` is `null`, so "start"/`AllDoneCard`
  starts a fresh session (unchanged behavior).

## Edge cases

- Exercise deleted between create and resume: dropped silently like Path A;
  `firstUnattemptedIndex` computed over surviving items.
- All-attempted-but-not-complete: drill page redirects to debrief.
- Difficulty change while resuming: no re-draw (resume owns the session).

## Testing (TDD)

- **Lambda:** `GET /sessions/:id` returns ordered exercises + `attemptedExerciseIds`,
  owner-only (404 for other users), reports `completedAt`. `GET /sessions/today`
  includes `resumeSessionId` when incomplete, `null` when complete or absent.
- **api-client:** schema parses the new response; hook wiring.
- **web:** timeline emits `?resume=<id>` when `resumeSessionId` is present and
  `?start=quick` otherwise, with the "continue" label; reducer `RESUME_SUCCEEDED`
  lands on the first unattempted index and marks earlier dots done; drill page
  resume effect fetches and resumes, and redirects to debrief when all attempted.
