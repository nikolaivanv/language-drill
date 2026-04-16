# Implementation Plan — Exercise Retrieval & Evaluation

## Task Overview

This plan implements the core exercise practice loop across four layers: shared types, AI evaluation client, Lambda API routes, API client hooks, exercise seeding, and the web practice UI. Tasks are ordered by dependency — types first, then backend, then frontend.

## Steering Document Compliance

- All Lambda routes follow the Hono pattern established in `infra/lambda/src/routes/health.ts`
- All database queries use Drizzle ORM via the shared `db` instance in `infra/lambda/src/db.ts`
- All API client hooks follow the `useHealth` pattern with Zod schema validation
- The AI package uses `@anthropic-ai/sdk` (already a dependency in `packages/ai`)
- New files follow the monorepo layout: `packages/shared`, `packages/ai`, `packages/api-client`, `infra/lambda`, `apps/web`

## Tasks

- [x] 1. Add exercise and evaluation types to `packages/shared`
  - File: `packages/shared/src/index.ts`
  - Add `ExerciseType` enum (`CLOZE`, `TRANSLATION`, `VOCAB_RECALL`)
  - Add `ClozeContent`, `TranslationContent`, `VocabRecallContent` types
  - Add `ExerciseContent` discriminated union type
  - Add `EvaluationError` and `EvaluationResult` types
  - Add `Exercise` type (id, type, language, difficulty, content)
  - Write tests for type guards (`isClozeContent`, `isTranslationContent`, `isVocabRecallContent`)
  - Purpose: Establish shared type contracts used by all other tasks
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.2_

- [x] 2. Implement Claude evaluation client in `packages/ai`
  - Files: `packages/ai/src/index.ts`, `packages/ai/src/prompts.ts`, `packages/ai/src/evaluate.ts`
  - Replace the existing stub in `index.ts` with a real `createClaudeClient()` using `@anthropic-ai/sdk`
  - Create `prompts.ts` with system prompt template (evaluation rubric, CEFR descriptors, language-specific notes) and per-exercise-type user prompt builders
  - Create `evaluate.ts` with `evaluateAnswer()` function that: constructs the prompt, calls Claude with tool use for structured output, parses and returns `EvaluationResult`
  - System prompt must use `cache_control: { type: "ephemeral" }` for prompt caching
  - Add `@language-drill/shared` as a dependency in `packages/ai/package.json`
  - Write unit tests: prompt construction per exercise type, result parsing from valid/malformed Claude responses (mock the SDK)
  - Purpose: Core AI evaluation engine used by the submission route
  - _Leverage: `packages/ai/src/index.ts` (existing stub), `@anthropic-ai/sdk` (already installed)_
  - _Requirements: 3.1, 3.2_

- [x] 3. Add Zod validation schemas for exercise route inputs in Lambda
  - File: `infra/lambda/src/routes/exercises.ts` (new file, schemas at top)
  - Create Zod schemas for: `GET /exercises` query params (`language`, `difficulty`, optional `type`), `POST /exercises/:id/submit` body (`answer` string)
  - Validate `language` against `Language` enum values, `difficulty` against `CefrLevel` enum values, `type` against `ExerciseType` enum values
  - Purpose: Server-side input validation for exercise endpoints
  - _Leverage: `@language-drill/shared` enums_
  - _Requirements: 1.1, 1.2, 5 (error handling scenario 7)_

- [x] 4. Implement `GET /exercises` route handler
  - File: `infra/lambda/src/routes/exercises.ts` (continue from task 3)
  - Add `GET /exercises` route behind `authMiddleware`
  - Query `exercises` table with Drizzle: filter by `language` and `difficulty`, optionally by `type`, `ORDER BY random() LIMIT 1`
  - Return parsed exercise with `id`, `type`, `language`, `difficulty`, and `contentJson`
  - Return 404 with `NO_EXERCISES` code if no matches
  - Write tests: successful retrieval, filtering by type, no exercises found, unauthenticated request
  - Purpose: Exercise retrieval endpoint
  - _Leverage: `infra/lambda/src/db.ts`, `infra/lambda/src/middleware/auth.ts`, `packages/db/src/schema/exercises.ts`_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 5. Implement `GET /exercises/:id` route handler
  - File: `infra/lambda/src/routes/exercises.ts` (continue from task 4)
  - Add `GET /exercises/:id` route behind `authMiddleware`
  - Query `exercises` table by UUID primary key
  - Return 404 with `EXERCISE_NOT_FOUND` code if not found
  - Write tests: successful retrieval, not found
  - Purpose: Single exercise retrieval for submission flow
  - _Leverage: same as task 4_
  - _Requirements: 1.4, 1.5_

- [x] 6. Implement `POST /exercises/:id/submit` route handler
  - File: `infra/lambda/src/routes/exercises.ts` (continue from task 5)
  - Add `POST /exercises/:id/submit` route behind `authMiddleware`
  - Validate request body with Zod schema from task 3
  - Fetch exercise by ID (404 if not found)
  - Check daily usage count: `SELECT COUNT(*) FROM usage_events WHERE userId AND eventType='ai_evaluation' AND createdAt > NOW() - 1 day` — return 429 if over threshold (default 50)
  - Call `evaluateAnswer()` from `packages/ai`
  - On success: insert into `userExerciseHistory` (set `evaluatedAt: new Date()` explicitly) and `usageEvents`, return evaluation result
  - On Claude failure: return 502, do NOT write to history
  - Add `@language-drill/ai` as a dependency in `infra/lambda/package.json`
  - Write tests: successful submission, exercise not found, Claude failure (mock), rate limit exceeded
  - Purpose: Answer submission and AI evaluation endpoint
  - _Leverage: `infra/lambda/src/db.ts`, `packages/ai`, `packages/db/src/schema/progress.ts`, `packages/db/src/schema/access.ts`_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 7. Register exercise routes in Lambda app entry point
  - File: `infra/lambda/src/index.ts`
  - Import the exercises route module and mount with `app.route('/', exercises)`
  - Purpose: Wire up new routes so they are accessible via API Gateway
  - _Leverage: `infra/lambda/src/index.ts` (existing pattern with health and webhooks)_
  - _Requirements: 1.1, 3.1_

- [x] 8. Create exercise seed script
  - File: `packages/db/src/seed-exercises.ts`
  - Create at least 3 exercises per type (cloze, translation, vocab_recall) per language (EN, ES, DE, TR) = 36 minimum exercises
  - Each exercise has valid `contentJson` matching its type schema
  - Use `INSERT ... ON CONFLICT DO NOTHING` on a composite of (type, language, difficulty, content hash) for idempotency
  - Add `seed:exercises` script to `packages/db/package.json`
  - Purpose: Populate exercise pool for development and testing
  - _Leverage: `packages/db/scripts/seed-invites.ts` (existing seed pattern)_
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 9. Create authenticated fetch wrapper in `packages/api-client`
  - File: `packages/api-client/src/fetchClient.ts`
  - Create `createAuthenticatedFetch(getToken: () => Promise<string | null>)` that returns a fetch wrapper attaching `Authorization: Bearer <token>` and `Content-Type: application/json` headers
  - Export from `packages/api-client/src/index.ts`
  - Purpose: Shared auth-aware fetch for all authenticated API hooks
  - _Leverage: `packages/api-client/src/hooks/useHealth.ts` (fetch pattern)_
  - _Requirements: 6.1, 6.2_

- [x] 10. Add Zod schemas for exercise and evaluation API responses
  - File: `packages/api-client/src/schemas/exercise.ts`
  - Create `ExerciseResponseSchema` (id, type, language, difficulty, content)
  - Create `EvaluationResultSchema` (score, grammarAccuracy, vocabularyRange, taskAchievement, feedback, errors array, estimatedCefrEvidence)
  - Create `ApiErrorSchema` for error responses
  - Export from `packages/api-client/src/index.ts`
  - Purpose: Runtime validation of API responses before reaching components
  - _Leverage: `packages/api-client/src/schemas/health.ts` (Zod schema pattern)_
  - _Requirements: 6.3_

- [x] 11. Create `useExercise` and `useSubmitAnswer` React Query hooks
  - File: `packages/api-client/src/hooks/useExercise.ts`
  - `useExercise({ language, difficulty, type? })` — fetches a random exercise using authenticated fetch, validates with Zod
  - `useSubmitAnswer()` — mutation that posts answer to `/exercises/:id/submit`, validates response with Zod, invalidates exercise query on success
  - Export from `packages/api-client/src/index.ts`
  - Write tests for Zod validation (valid and invalid responses)
  - Purpose: Typed data-fetching layer for the practice UI
  - _Leverage: `packages/api-client/src/hooks/useHealth.ts` (hook pattern), `packages/api-client/src/fetchClient.ts` (task 9)_
  - _Requirements: 6.1, 6.2, 6.3_

- [x] 12. Create practice page layout and exercise display
  - File: `apps/web/app/(dashboard)/practice/page.tsx`
  - Create the practice page as a client component (`"use client"`)
  - Add language and difficulty selectors (dropdowns using `Language` and `CefrLevel` enums)
  - Fetch exercise using `useExercise` hook based on selected filters
  - Render exercise prompt: instructions, and type-specific content (cloze sentence with blank, translation source text, vocab recall prompt with hints)
  - Show loading skeleton while fetching
  - Show "No exercises available" when 404
  - Purpose: Exercise display portion of the practice UI
  - _Leverage: `@language-drill/api-client` (useExercise), `@language-drill/shared` (enums, types)_
  - _Requirements: 5.1, 5.2, 5.6_

- [x] 13. Add answer submission and evaluation display to practice page
  - File: `apps/web/app/(dashboard)/practice/page.tsx` (continue from task 12)
  - Add text input / textarea for user answer
  - Add submit button that calls `useSubmitAnswer` mutation
  - Show loading spinner during evaluation (disable submit button)
  - On success: display score (visual indicator), feedback text, error list with corrections highlighted
  - Add "Next exercise" button that refetches via `useExercise`
  - Handle API errors with user-friendly messages
  - Purpose: Answer submission and evaluation feedback portion of the practice UI
  - _Leverage: `@language-drill/api-client` (useSubmitAnswer), `@language-drill/shared` (EvaluationResult type)_
  - _Requirements: 5.3, 5.4, 5.5, 5.6_

- [x] 14. Add navigation link to practice page from dashboard
  - File: `apps/web/app/(dashboard)/page.tsx`
  - Add a "Start Practice" link/button that navigates to `/practice`
  - Purpose: Entry point to the practice flow from the main dashboard
  - _Leverage: existing dashboard page_
  - _Requirements: 5.1_
