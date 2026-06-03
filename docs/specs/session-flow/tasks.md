# Implementation Plan

## Task Overview

Bottom-up build: shared constant → DB schema → migration → API client schemas/hooks → Lambda routes → web helpers → web reducer/components → page rewrite. Each layer is testable in isolation before the layer above depends on it; the page rewrite (task 27) is the integration point — running it before the reducer + summary component exist would break the build.

Tasks are sized for 15–30 minute execution. The page-test rewrite (task 28) is the largest single task and may stretch to 45 min because it replaces a 250+ line file; if needed it can be split into "session creation + per-item flow" and "summary + error paths."

## Steering Document Compliance

- All new modules are TypeScript and follow the file layout in `tech.md` §4 — `apps/web`, `packages/api-client`, `packages/db`, `packages/shared`, `infra/lambda`.
- Server-side new code uses Hono + Zod + Drizzle exactly as the existing `routes/exercises.ts`.
- Drizzle migrations stay forward-only (`0003_*.sql` is additive — `CREATE TABLE` + `ALTER TABLE ... ADD COLUMN`).
- Web client new code uses TanStack Query mutations + reducers, matching the pattern in `useExercise.ts` and the existing `_components/types.ts` discriminated unions.
- All new web styles use existing Tailwind v4 tokens from `apps/web/app/globals.css` — no new tokens introduced.
- No new permissions, env vars, or secrets are required.

## Atomic Task Requirements

**Each task must meet these criteria:**

- **File Scope:** 1–3 related files maximum
- **Time Boxing:** 15–30 minutes
- **Single Purpose:** One testable outcome per task
- **Specific Files:** Exact paths to create/modify
- **Agent-Friendly:** Clear input/output with minimal context switching

## Task Format Guidelines

- Checkbox format: `- [ ] N. Task description`
- Reference requirements with `_Requirements: X.Y_`
- Reference existing code to leverage with `_Leverage: path/to/file.ts_`
- Reference design doc sections only when the design contains a code snippet not in the task body

## Tasks

### Shared constant

- [x] 1. Add `CORRECT_THRESHOLD` constant to shared package
  - Files: `packages/shared/src/index.ts` (modify)
  - Add `export const CORRECT_THRESHOLD = 0.7;` near the other exported constants
  - Add a one-line comment: "Score >= this counts as correct in session summaries; matches the 'solid' tier in apps/web/lib/drill/verdict-tier.ts"
  - Purpose: Single source of truth for "correct" threshold used by both server-side correct-count and UI verdict tiers
  - _Requirements: 5.6_

- [x] 2. Replace inline `0.7` with `CORRECT_THRESHOLD` in verdict-tier
  - Files: `apps/web/lib/drill/verdict-tier.ts` (modify)
  - Import `CORRECT_THRESHOLD` from `@language-drill/shared`
  - Replace every `>= 0.7` literal in `clozeVerdict`, `translationVerdict`, and any other functions with `>= CORRECT_THRESHOLD`
  - Run `pnpm --filter @language-drill/web test apps/web/lib/drill/verdict-tier.test.ts` to confirm existing verdict tests still pass
  - Purpose: Ensure UI tier boundary tracks the same constant as server-side correct counting (Req 5.6)
  - _Leverage: packages/shared/src/index.ts (CORRECT_THRESHOLD added in task 1)_
  - _Requirements: 5.6_

### Database schema

- [x] 3. Create `practice_sessions` Drizzle table schema
  - Files: `packages/db/src/schema/sessions.ts` (new)
  - Define `practiceSessions` table per design (id uuid pk; user_id text FK → users.id NOT NULL; language text NOT NULL; difficulty text NOT NULL; exercise_count smallint NOT NULL; correct_count smallint NOT NULL DEFAULT 0; exercise_ids jsonb `$type<string[]>()` NOT NULL; started_at timestamptz NOT NULL DEFAULT now(); completed_at timestamptz nullable)
  - Add index `practice_sessions_user_id_started_at_idx` on `(userId, startedAt)`
  - Import only `users` from `./users` to avoid circular import
  - Purpose: Server-side session manifest persistence (Req 5.1)
  - _Leverage: packages/db/src/schema/users.ts, packages/db/src/schema/progress.ts (table-definition style)_
  - _Requirements: 5.1_

- [x] 4. Add `session_id` column + index to `userExerciseHistory`
  - Files: `packages/db/src/schema/progress.ts` (modify)
  - Import `practiceSessions` from `./sessions`
  - Add nullable `sessionId: uuid('session_id').references(() => practiceSessions.id, { onDelete: 'set null' })` to the `userExerciseHistory` table definition
  - Add a new index `user_exercise_history_session_id_idx` on `(sessionId)` in the third-arg callback alongside the existing index
  - Purpose: Tag history rows with the session they belong to so completion can count correct items by sessionId (Req 5.2, 5.5)
  - _Leverage: packages/db/src/schema/progress.ts (existing third-arg callback pattern)_
  - _Requirements: 5.2, 5.5_

- [x] 5. Export new table from schema index
  - Files: `packages/db/src/schema/index.ts` (modify)
  - Add `export { practiceSessions } from './sessions';`
  - Update the index-comment block at the top of the file to include the new index `(practice_sessions: userId, startedAt)` and `(user_exercise_history: sessionId)`
  - Purpose: Make the new table available via `@language-drill/db` (Req 5.1)
  - _Leverage: packages/db/src/schema/index.ts (existing comment-block style)_
  - _Requirements: 5.1, 5.2_

- [x] 6. Generate and verify Drizzle migration 0003
  - Files: `packages/db/migrations/0003_*.sql` (new — auto-generated)
  - Run `pnpm db:generate` from the repo root (or the equivalent Drizzle Kit command per `package.json`)
  - Open the generated SQL and verify it contains: `CREATE TABLE IF NOT EXISTS "practice_sessions"` with all columns and FK on `user_id`; `ALTER TABLE "user_exercise_history" ADD COLUMN "session_id" uuid`; `ADD CONSTRAINT ... FOREIGN KEY ("session_id") REFERENCES "practice_sessions"("id") ON DELETE set null`; both new indexes via `CREATE INDEX IF NOT EXISTS`
  - If `ON DELETE set null` is missing because Drizzle Kit defaults differ, hand-edit the constraint block to add `ON DELETE SET NULL ON UPDATE NO ACTION`
  - Run `pnpm db:migrate` against a local Neon branch to confirm the migration applies cleanly; revert via a fresh branch if needed
  - Purpose: Schema-as-code → SQL deployable migration (Req 5.1, 5.2)
  - _Leverage: packages/db/migrations/0002_sweet_bucky.sql (existing format)_
  - _Requirements: 5.1, 5.2_

### API client (schemas)

- [x] 7. Create CreateSessionRequest + CreateSessionResponse zod schemas with tests
  - Files: `packages/api-client/src/schemas/session.ts` (new); `packages/api-client/src/schemas/session.test.ts` (new)
  - Define `CreateSessionRequestSchema = z.object({ language: z.nativeEnum(Language), difficulty: z.nativeEnum(CefrLevel), exerciseCount: z.number().int().min(1).max(20) })`
  - Define `CreateSessionResponseSchema = z.object({ id: z.string().uuid(), exercises: z.array(ExerciseResponseSchema) })`
  - Export inferred types `CreateSessionRequest`, `CreateSessionResponse`
  - Tests: happy-path parse for both; reject `exerciseCount = 0`, `exerciseCount = 21`, non-uuid `id`, non-nativeEnum `language`
  - Purpose: Wire types for `POST /sessions` (Req 1.1, 1.4, NFR Performance)
  - _Leverage: packages/api-client/src/schemas/exercise.ts (ExerciseResponseSchema; happy/sad test pattern)_
  - _Requirements: 1.1, 1.4_

- [x] 8. Create CompleteSessionResponse zod schema with tests
  - Files: `packages/api-client/src/schemas/session.ts` (modify); `packages/api-client/src/schemas/session.test.ts` (modify)
  - Define `CompleteSessionResponseSchema = z.object({ id: z.string().uuid(), exerciseCount: z.number().int(), correctCount: z.number().int(), attemptedCount: z.number().int(), skippedCount: z.number().int(), durationSeconds: z.number().int() })`
  - Export inferred type `CompleteSessionResponse`
  - Tests: happy-path parse; reject negative counts; reject non-integer `durationSeconds`
  - Purpose: Wire type for `POST /sessions/:id/complete` summary payload (Req 4.1, 5.6)
  - _Leverage: packages/api-client/src/schemas/exercise.ts (test pattern)_
  - _Requirements: 4.1, 5.6_

### API client (hooks)

- [x] 9. Create `useCreateSession` mutation hook with tests
  - Files: `packages/api-client/src/hooks/useSession.ts` (new); `packages/api-client/src/hooks/useSession.test.ts` (new)
  - Implement `useCreateSession({ fetchFn })` returning a `useMutation` that POSTs to `/sessions` with `CreateSessionRequest` body and parses response with `CreateSessionResponseSchema`
  - Tests with a mocked `AuthenticatedFetch`: assert URL `/sessions`, method `POST`, body JSON-stringified, response parsed into typed object; assert error mode rejects on non-2xx
  - Purpose: Client-side session creation (Req 1.1, 7.4)
  - _Leverage: packages/api-client/src/hooks/useExercise.ts (mutation pattern); packages/api-client/src/hooks/useExercise.test.ts (test scaffolding)_
  - _Requirements: 1.1, 7.4_

- [x] 10. Create `useCompleteSession` mutation hook with tests
  - Files: `packages/api-client/src/hooks/useSession.ts` (modify); `packages/api-client/src/hooks/useSession.test.ts` (modify)
  - Implement `useCompleteSession({ fetchFn })` returning a `useMutation` that takes `{ sessionId: string }` and POSTs to `/sessions/:sessionId/complete`, parsing response with `CompleteSessionResponseSchema`
  - Tests: assert URL templating, method, parsed response; reject on non-2xx
  - Purpose: Client-side session completion (Req 3.3, 4.1, 7.4)
  - _Leverage: packages/api-client/src/hooks/useExercise.ts; sibling test in task 9_
  - _Requirements: 3.3, 4.1, 7.4_

- [x] 11. Extend `useSubmitAnswer` to thread optional `sessionId`
  - Files: `packages/api-client/src/hooks/useExercise.ts` (modify); `packages/api-client/src/hooks/useExercise.test.ts` (modify)
  - Add optional `sessionId?: string` to `SubmitAnswerParams`; if present, include it in the request body
  - Existing callers must continue to work unchanged when `sessionId` is omitted
  - Tests: existing tests continue passing; new test: submitting with `sessionId` includes it in the body; submitting without `sessionId` does not
  - Purpose: Carry session context through to server submit endpoint (Req 5.4, 5.5, 7.3)
  - _Leverage: packages/api-client/src/hooks/useExercise.ts (existing mutation), packages/api-client/src/hooks/useExercise.test.ts_
  - _Requirements: 5.4, 5.5, 7.3_

- [x] 12. Export new session schemas and hooks from api-client index
  - Files: `packages/api-client/src/index.ts` (modify)
  - Add `export * from './schemas/session';` and `export * from './hooks/useSession';`
  - Run `pnpm --filter @language-drill/api-client typecheck` to confirm no type collisions with existing exports
  - Purpose: Make new pieces importable via `@language-drill/api-client` (Req 7.4)
  - _Leverage: packages/api-client/src/index.ts (existing barrel re-exports)_
  - _Requirements: 7.4_

### Lambda API (sessions route)

- [x] 13. Create POST /sessions route handler (happy path)
  - Files: `infra/lambda/src/routes/sessions.ts` (new); `infra/lambda/src/routes/sessions.test.ts` (new)
  - Mount a Hono router scoped to `/sessions/*` with `authMiddleware` applied
  - Implement `POST /sessions`: parse body with Zod schema mirroring `CreateSessionRequest`; SELECT N exercise rows with `language` + `difficulty` filter ORDER BY `random()` LIMIT N; insert one `practice_sessions` row with `exercise_ids` populated from those rows; return `{ id, exercises: [...] }` matching `CreateSessionResponse`
  - Test: happy path — mocked authed user, seeded exercise rows; assert response shape, single insert into practice_sessions with correct exercise_ids
  - Purpose: Server-side session creation (Req 1.1, 1.4, 5.3, NFR Performance)
  - _Leverage: infra/lambda/src/routes/exercises.ts (route file structure, auth middleware mount, db usage); infra/lambda/src/routes/exercises.test.ts (test harness)_
  - _Requirements: 1.1, 1.4, 5.3_

- [x] 14. Add insufficient-pool 422 path to POST /sessions
  - Files: `infra/lambda/src/routes/sessions.ts` (modify); `infra/lambda/src/routes/sessions.test.ts` (modify)
  - After fetching candidate exercise rows, if `rows.length < exerciseCount` return HTTP 422 `{ error, code: 'INSUFFICIENT_EXERCISES', details: { available: rows.length, requested: exerciseCount } }` and DO NOT insert into `practice_sessions`
  - Test: seed pool with fewer rows than `exerciseCount`; assert 422 + code; assert no insert into `practice_sessions`
  - Purpose: Surface pool-underrun condition cleanly (Req 1.6)
  - _Leverage: infra/lambda/src/routes/sessions.ts (handler from task 13)_
  - _Requirements: 1.6_

- [x] 15. Implement POST /sessions/:id/complete route handler with atomic guard
  - Files: `infra/lambda/src/routes/sessions.ts` (modify); `infra/lambda/src/routes/sessions.test.ts` (modify)
  - Compute `correctCount = count(DISTINCT exercise_id) WHERE score >= CORRECT_THRESHOLD` and `attemptedCount = count(DISTINCT exercise_id)` from `userExerciseHistory` for `session_id = :id` in a single query (use `count` + `filter`)
  - Atomic UPDATE on `practice_sessions` SET `completed_at = now()`, `correct_count = $correctCount` WHERE `id = :id` AND `user_id = $userId` AND `completed_at IS NULL` RETURNING `id, started_at`
  - If UPDATE returns 0 rows, return HTTP 400 `{ error, code: 'INVALID_SESSION' }`
  - Compute `durationSeconds = floor((now - started_at) / 1000)` and `skippedCount = exerciseCount - attemptedCount`
  - Return `CompleteSessionResponse`
  - Tests: happy path; idempotency — second complete on same session returns 400
  - Purpose: Server-side session finalization, race-safe (Req 5.6, 5.7, NFR Security/Reliability)
  - _Leverage: infra/lambda/src/routes/sessions.ts (router from task 13); packages/shared/src/index.ts (CORRECT_THRESHOLD)_
  - _Requirements: 5.6, 5.7_

- [x] 16. Add ownership and not-found tests for /sessions/:id/complete
  - Files: `infra/lambda/src/routes/sessions.test.ts` (modify)
  - Test: complete with sessionId owned by a different user → 400 INVALID_SESSION (atomic UPDATE matches 0 rows because `user_id` predicate fails)
  - Test: complete with completely unknown sessionId → 400 INVALID_SESSION
  - Purpose: Verify the cross-user safety of the atomic guard (Req 5.7, NFR Security)
  - _Leverage: infra/lambda/src/routes/sessions.ts (handler from task 15)_
  - _Requirements: 5.7_

- [x] 17. Register sessions router in Lambda app
  - Files: `infra/lambda/src/index.ts` (modify)
  - Import the sessions router and add `app.route('/', sessions);` next to the existing `app.route('/', exercises);`
  - Run `pnpm --filter @language-drill/lambda test` to confirm existing route tests still pass
  - Purpose: Mount /sessions routes onto the Lambda monolith (Req 1.1, 3.3)
  - _Leverage: infra/lambda/src/index.ts (existing route mounts)_
  - _Requirements: 1.1, 3.3_

### Lambda API (extend submit handler)

- [x] 18. Add optional `sessionId` to SubmitAnswerSchema
  - Files: `infra/lambda/src/routes/exercises.ts` (modify)
  - Add `sessionId: z.string().uuid().optional()` to `SubmitAnswerSchema`
  - No behavioral change yet; this task only widens the schema so the body parses
  - Run `pnpm --filter @language-drill/lambda test infra/lambda/src/routes/exercises.test.ts` to confirm no test regressions
  - Purpose: Allow submit body to carry a sessionId without rejecting it (Req 5.4)
  - _Leverage: infra/lambda/src/routes/exercises.ts (existing SubmitAnswerSchema)_
  - _Requirements: 5.4_

- [x] 19. Add session validation to submit handler with tests
  - Files: `infra/lambda/src/routes/exercises.ts` (modify); `infra/lambda/src/routes/exercises.test.ts` (modify)
  - When `sessionId` is present in the parsed body, fetch the `practice_sessions` row by id BEFORE the rate-limit check or Claude call; if any of the following are false return HTTP 400 `INVALID_SESSION` with no further side effects: row exists, `user_id` matches `c.get('userId')`, `completed_at IS NULL`, `:id` (the path-param exerciseId) is in `exercise_ids`
  - Update the `userExerciseHistory.insert` call to pass `sessionId` when validation passed
  - Tests: submit with valid sessionId writes through and inserted row has session_id set; submit without sessionId still works (regression); submit with foreign sessionId → 400; submit with completed sessionId → 400; submit with sessionId whose manifest does not include `:id` → 400
  - Purpose: Carry the session linkage server-side (Req 5.4, 5.5)
  - _Leverage: infra/lambda/src/routes/exercises.ts (existing submit handler), packages/db/src/schema/sessions.ts_
  - _Requirements: 5.4, 5.5_

### Web — helpers

- [x] 20. Add `DEFAULT_EXERCISE_COUNT` to session-config helper
  - Files: `apps/web/lib/drill/session-config.ts` (new)
  - Export `export const DEFAULT_EXERCISE_COUNT = 5;` with a one-line comment citing `prototypes/web/hifi/dashboard.jsx` (5 timeline items)
  - Purpose: Single source of truth for session length (Req NFR Usability)
  - _Requirements: NFR Usability_

- [x] 21. Add `sessionComplete` branch to `coach-messages.ts`
  - Files: `apps/web/lib/drill/coach-messages.ts` (modify); `apps/web/lib/drill/__tests__/coach-messages.test.ts` if it exists, else colocate (modify or new)
  - Add a new discriminator `kind: 'sessionComplete'` with a `accuracy: number | null` field; return a single short congratulatory line scaled by accuracy (e.g., null → "Nice work — let's see what landed."; ≥ 0.9 → "Strong session — that one stuck."; ≥ 0.7 → "Solid session."; < 0.7 → "That one was tough — good signal.")
  - Existing `kind: 'idle' | 'evaluated'` branches must remain unchanged
  - Tests: each accuracy bucket returns the expected line; null accuracy handled
  - Purpose: Single-line coach copy for the summary view (Req 4.4)
  - _Leverage: apps/web/lib/drill/coach-messages.ts (existing discriminated-union pattern)_
  - _Requirements: 4.4_

- [x] 22. Extract `SubmissionErrorCard` to its own module with session-aware props and tests
  - Files: `apps/web/app/(dashboard)/drill/_components/submission-error-card.tsx` (new); `apps/web/app/(dashboard)/drill/_components/__tests__/submission-error-card.test.tsx` (new)
  - Move the existing inline `SubmissionErrorCard` from `drill/page.tsx` (currently lines ~87–103) into a new module
  - Add optional props `onSkip?: () => void` and `onEndSession?: () => void`
  - Behavior: rate-limit (`/429/` or `/rate limit/i`) → render existing copy + "end session early" button when `onEndSession` provided; non-rate-limit → render existing copy + "skip item" button when `onSkip` provided; "try again" calls `onRetry` (always)
  - Tests: rate-limit message + only "try again" when no extra callbacks; rate-limit + "end session early" when `onEndSession` provided; 5xx + "skip item" when `onSkip` provided; both buttons call their respective callbacks
  - Note: do NOT yet remove the inline copy from `page.tsx`; that happens in task 27 to keep this task atomic
  - Purpose: Reusable, session-aware error card (Req 6.1, 6.2)
  - _Leverage: apps/web/app/(dashboard)/drill/page.tsx:87-103 (source of truth for the existing component); apps/web/components/ui/Card.tsx and Button.tsx_
  - _Requirements: 6.1, 6.2_

### Web — session reducer

- [x] 23. Create session-reducer types + initial state + create/in-session transitions with tests
  - Files: `apps/web/app/(dashboard)/drill/_components/session-reducer.ts` (new); `apps/web/app/(dashboard)/drill/_components/__tests__/session-reducer.test.ts` (new)
  - Export `SessionState` discriminated union (idle / creating / createError / inSession / completing / summary), `SessionAction` union, `initialSessionState`, and `sessionReducer`
  - Implement transitions: `CREATE_REQUESTED`, `CREATE_SUCCEEDED`, `CREATE_FAILED`, `ITEM_SUBMITTING`, `ITEM_EVALUATED`, `ITEM_ERROR`
  - In `inSession`, fold per-item submission state into a single `perItemSubmission` slot (current item only); track `skippedCount: number`
  - Tests: each transition from valid sources; invalid transitions are no-ops (e.g., `CREATE_SUCCEEDED` while in `summary` does not mutate state)
  - Purpose: Pure, testable state machine for session creation + per-item submission (Req 1.1, 3.1, 6.4)
  - _Leverage: apps/web/app/(dashboard)/drill/_components/types.ts (SubmissionState, SubmissionMeta)_
  - _Requirements: 1.1, 3.1, 6.4_

- [x] 24. Add navigation + completion + reset transitions to session-reducer with tests
  - Files: `apps/web/app/(dashboard)/drill/_components/session-reducer.ts` (modify); `apps/web/app/(dashboard)/drill/_components/__tests__/session-reducer.test.ts` (modify)
  - Implement `ITEM_NEXT` (guard: `index < count - 1` AND `perItemSubmission.kind === 'evaluated'`; advances `index` by 1, resets `perItemSubmission` to `idle`)
  - Implement `ITEM_SKIP` (guard: `perItemSubmission.kind === 'error'`; advances `index` by 1, resets `perItemSubmission` to `idle`, increments `skippedCount`)
  - Implement `COMPLETE_REQUESTED`, `COMPLETE_SUCCEEDED`, `COMPLETE_FAILED` (`COMPLETE_FAILED` returns to `inSession` with prior per-item state preserved)
  - Implement `RESET` → `idle` (used for both "another session" and selector change)
  - Tests: `ITEM_NEXT` from idle/submitting/error states is a no-op; `ITEM_NEXT` at last index does NOT advance; `ITEM_SKIP` from non-error state is a no-op; full sequence: create → submit → evaluate → next → ... → last → complete → summary → reset → idle
  - Purpose: Complete the state-machine API (Req 3.2, 3.3, 4.2, 4.3, 6.2, 6.3)
  - _Leverage: apps/web/app/(dashboard)/drill/_components/session-reducer.ts (from task 23)_
  - _Requirements: 3.2, 3.3, 4.2, 4.3, 6.2, 6.3_

- [x] 25. Add selectors to session-reducer with tests
  - Files: `apps/web/app/(dashboard)/drill/_components/session-reducer.ts` (modify); `apps/web/app/(dashboard)/drill/_components/__tests__/session-reducer.test.ts` (modify)
  - Implement `selectCurrentItem(state): ExerciseResponse | null` (returns `items[index]` when `inSession`, else null)
  - Implement `selectProgressFraction(state): number` per Req 2: 0 in `idle | creating | createError`; `(index + (perItemSubmission.kind === 'evaluated' ? 1 : 0)) / exerciseCount` in `inSession`; 1 in `summary | completing` — but clamped to `[0, 1]`
  - Implement `selectIsLastItem(state): boolean` (true when `inSession` and `index === exerciseCount - 1`)
  - Tests: every selector for every state branch (covering empty manifest is impossible — schema enforces ≥ 1)
  - Purpose: Centralize derived state so the page stays a thin orchestrator (Req 2.1–2.4, 3.3)
  - _Leverage: apps/web/app/(dashboard)/drill/_components/session-reducer.ts_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.3_

### Web — summary component

- [x] 26. Create `SessionSummary` component with tests
  - Files: `apps/web/app/(dashboard)/drill/_components/session-summary.tsx` (new); `apps/web/app/(dashboard)/drill/_components/__tests__/session-summary.test.tsx` (new)
  - Props: `{ summary: CompleteSessionResponse; onAnother: () => void; onDone: () => void }`
  - Render: a `Card` with the formatted duration `mm:ss` (helper inline or in `lib/drill/format-duration.ts`); the line `{correctCount} of {exerciseCount}` with skipped count appended only when `> 0`; accuracy as `correctCount / attemptedCount` formatted as `XX%` (or `—` when `attemptedCount === 0`); a single coach line via `coachMessage({ kind: 'sessionComplete', accuracy })`; two `Button`s: "another session" (primary) → `onAnother`, "done" (default) → `onDone`
  - Tests: all-correct, mixed, all-wrong, with skipped > 0, attemptedCount === 0; clicking each button fires its callback; no streak/XP text rendered
  - Purpose: Phase E summary screen (Req 4.1, 4.2, 4.3, 4.4, 4.5)
  - _Leverage: apps/web/components/ui/Card.tsx and Button.tsx; apps/web/lib/drill/coach-messages.ts (sessionComplete branch from task 21)_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

### Web — page rewrite

The page rewrite is split across 27a / 27b to stay within the 15–30 min atomic budget. The two parts compile together cleanly: 27a leaves the page in a working "single-session, no completion" state behind a temporary fallthrough that renders the verdict on the last item without completing; 27b removes that fallthrough and wires completion + summary + error-aware buttons. Run the page test rewrites (28a / 28b) at the end of each part rather than trying to land both at once.

- [x] 27a. Rewrite `drill/page.tsx` — creation, navigation, submit (no completion yet)
  - Files: `apps/web/app/(dashboard)/drill/page.tsx` (rewrite)
  - Replace inline `SubmissionErrorCard` usage with the imported one from task 22 (default error mode only — no `onSkip` or `onEndSession` yet)
  - Replace `useState<SubmissionState>` with `useReducer(sessionReducer, initialSessionState)`
  - On profiles ready (and active language/difficulty resolved), if state is `idle`, dispatch `CREATE_REQUESTED` and call `useCreateSession.mutate({ language, difficulty, exerciseCount: DEFAULT_EXERCISE_COUNT })`; on success/failure dispatch `CREATE_SUCCEEDED` / `CREATE_FAILED`
  - On selector change (language or difficulty) dispatch `RESET` so the effect re-fires
  - On submit: dispatch `ITEM_SUBMITTING`; call `useSubmitAnswer.mutate({ exerciseId: currentItem.id, answer, sessionId: state.session.id })`; on success dispatch `ITEM_EVALUATED`; on error dispatch `ITEM_ERROR`
  - On "next": if `selectIsLastItem` is FALSE dispatch `ITEM_NEXT` (also reset theory panel state); on the last item, leave the verdict visible (completion wired in 27b)
  - Pass `progressFraction={selectProgressFraction(state)}` to `DrillLayout`; pass `currentItem` to `<ExercisePane />`
  - Render the 422 INSUFFICIENT_EXERCISES path (state `createError` with that error message) using the existing card markup from the prior `page.tsx`
  - Render zero-profiles placeholder unchanged
  - Purpose: Land the orchestration + reducer + creation + per-item flow in one reviewable chunk (Req 1.1–1.6, 2.1–2.4, 3.1–3.2, 7.1–7.2)
  - _Leverage: apps/web/app/(dashboard)/drill/_components/{drill-layout,coach-rail,exercise-pane,submission-error-card,session-reducer}.{ts,tsx}; packages/api-client useCreateSession/useSubmitAnswer; apps/web/lib/drill/session-config.ts_
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 7.1, 7.2_

- [x] 27b. Wire completion, summary screen, and session-aware error buttons in `drill/page.tsx`
  - Files: `apps/web/app/(dashboard)/drill/page.tsx` (modify)
  - On "next" when `selectIsLastItem` is TRUE: dispatch `COMPLETE_REQUESTED` and call `useCompleteSession.mutate({ sessionId })`; on success dispatch `COMPLETE_SUCCEEDED`; on error dispatch `COMPLETE_FAILED`
  - Change the next-button label to "see results" on the last item (reads `selectIsLastItem(state)`)
  - On `state.kind === 'summary'`: render `<SessionSummary summary={state.summary} onAnother={() => dispatch({ type: 'RESET' })} onDone={() => router.push('/')} />` instead of the exercise pane
  - On `state.kind === 'completing'`: render the existing `LoadingSkeleton` (or a small spinner) and disable the next button
  - Pass `onSkip` to `SubmissionErrorCard` for non-rate-limit errors → dispatches `ITEM_SKIP`
  - Pass `onEndSession` to `SubmissionErrorCard` for rate-limit errors → dispatches `COMPLETE_REQUESTED` + calls `useCompleteSession`
  - When `selectProgressFraction` is `1` (summary or completing), ensure the layout still renders the bar at full
  - Purpose: Complete the flow end-to-end (Req 3.3, 3.4, 3.5, 4.1–4.3, 6.1–6.4)
  - _Leverage: apps/web/app/(dashboard)/drill/page.tsx (from task 27a); apps/web/app/(dashboard)/drill/_components/session-summary.tsx; packages/api-client useCompleteSession; apps/web/lib/drill/coach-messages.ts (sessionComplete)_
  - _Requirements: 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 6.1, 6.2, 6.3, 6.4_

- [x] 28a. Rewrite `drill/page.test.tsx` — creation + per-item flow (paired with 27a)
  - Files: `apps/web/app/(dashboard)/drill/page.test.tsx` (rewrite)
  - Mocks: `useLanguageProfiles` returns one profile (ES B1); `useCreateSession` returns a manifest of 5 exercises; `useSubmitAnswer` resolves with a mocked `EvaluationResult`
  - Tests:
    - Mount with one profile → `useCreateSession.mutate` called once; exercise pane shows manifest item 0; progress bar at 0
    - Submit item 0 → verdict shown; progress bar reflects evaluated state
    - Click "next" → exercise pane shows manifest item 1; progress reflects 1/5
    - Selector changes language → existing session discarded (`RESET` dispatched), `useCreateSession.mutate` called again with the new language
    - Submit returns generic 5xx → error card renders with "try again" only (no "skip item" yet — that lands in 28b)
    - Zero profiles → renders the no-profiles placeholder unchanged; `useCreateSession.mutate` NOT called
    - 422 INSUFFICIENT_EXERCISES from `useCreateSession` → renders the existing "no exercises available" card
  - Purpose: Lock down the creation + navigation + submit flow before completion is wired (Req 1.*, 2.*, 3.1, 3.2, 7.1)
  - _Leverage: apps/web/app/(dashboard)/drill/page.test.tsx (existing QueryClient + Clerk mock scaffolding)_
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 2.1, 2.2, 2.4, 3.1, 3.2_

- [x] 28b. Extend `drill/page.test.tsx` — completion, summary, session-aware errors (paired with 27b)
  - Files: `apps/web/app/(dashboard)/drill/page.test.tsx` (modify)
  - Mocks (in addition to 28a): `useCompleteSession` resolves with a mocked summary `{ exerciseCount: 5, correctCount: 4, attemptedCount: 5, skippedCount: 0, durationSeconds: 240, ... }`
  - Tests:
    - Submit + "next" through items 0–3, submit item 4 → next-button label reads "see results"
    - Click "see results" → `useCompleteSession.mutate` called with the session id; summary rendered with "4 of 5 · 80%"
    - Click "another session" on summary → reducer resets to `idle` → `useCreateSession.mutate` called again
    - Click "done" on summary → `router.push('/')` invoked
    - Submit returns 429 → rate-limit error card with "end session early" → click → `useCompleteSession.mutate` called; summary rendered
    - Submit returns 502 → error card with "try again" + "skip item" → "skip item" advances index; subsequent summary shows `skippedCount: 1`
  - Purpose: Page-level integration coverage of completion and error paths (Req 3.3, 4.*, 6.*)
  - _Leverage: apps/web/app/(dashboard)/drill/page.test.tsx (from task 28a)_
  - _Requirements: 3.3, 4.1, 4.2, 4.3, 6.1, 6.2, 6.3_

### Pre-merge verification

- [x] 29. Run pre-push checks from repo root
  - Files: none
  - Run `pnpm lint && pnpm typecheck && pnpm test` per `CLAUDE.md` Pre-Push Checks; resolve any failures
  - Purpose: Ensure the spec ships green
  - _Requirements: All_
