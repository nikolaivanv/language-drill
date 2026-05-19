# Implementation Plan

## Task Overview

Bottom-up build: pure helpers → API client schema/hook → Lambda route → web components → page orchestrator → Phase E cleanup. The Phase E cleanup happens last so the existing `/drill` flow keeps working until the new debrief page can absorb the redirect.

Each layer is testable in isolation before the layer above depends on it. The page rewrite (task 18) depends on every prior web component existing. The Phase E cleanup (tasks 19–20) is the last set of changes; running it earlier would break the build because `drill/page.tsx` still references `SessionSummary` until then.

Tasks are sized for 15–30 minute execution. Task 18 (page integration tests, 8 sub-cases) is the longest single task and may stretch to ~40 min; if the test scaffolding becomes heavy, split into 18a (success-path render + tab switch + skeleton) and 18b (error paths + footer router calls).

**Paired tasks:** Task 19 makes coordinated changes to the reducer AND the drill page in a single commit. Splitting these would leave the build temporarily un-typecheck-able because `drill/page.tsx` still dispatches `COMPLETE_SUCCEEDED` (a type that ceases to exist after the reducer change). Keep 19 as a single task.

## Steering Document Compliance

- All new modules are TypeScript and follow the file layout in `tech.md` §4 — `apps/web`, `packages/api-client`, `infra/lambda`.
- Server-side new code uses Hono + Zod + Drizzle exactly as the existing `routes/sessions.ts`.
- No new migrations — Phase E's `0003_*.sql` already supplies every column and index this feature reads from.
- Web client new code uses TanStack Query (read-side `useQuery`, with `staleTime: Infinity`) and matches the file layout under `apps/web/app/(dashboard)/drill/`.
- All new web styles use existing Tailwind v4 tokens from `apps/web/app/globals.css` — no new tokens introduced (`t-display-xl` confirmed present at line 78).
- No new permissions, env vars, or secrets are required.
- No streaks / XP / day-counter copy anywhere (CLAUDE.md hard rule).

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

## Tasks

### Helpers

- [x] 1. Add `accuracy-tier` helper with tests
  - Files: `apps/web/lib/drill/accuracy-tier.ts` (new); `apps/web/lib/drill/__tests__/accuracy-tier.test.ts` (new)
  - Export `AccuracyTier = 'high' | 'mid' | 'low'`
  - Export `accuracyTier(correctCount: number, attemptedCount: number): AccuracyTier` per Req 3.2–3.4: ≥0.8 → 'high'; ≥0.5 and <0.8 → 'mid'; <0.5 (or `attemptedCount === 0`) → 'low'
  - Export `TIER_TITLE: Record<AccuracyTier, string>` with the exact lowercase strings: high → "nice work."; mid → "good attempt."; low → "back next time?"
  - Tests: boundary cases (0/0 → low; 8/10 → high; 5/10 → mid; 4/10 → low; 7/10 → mid; ratios just above/below 0.8 and 0.5; negative attemptedCount falls into low without throwing)
  - Purpose: Single source of truth for the three header tiers, reused by header / narrative / what's-next router (Req 3.2–3.4, 4.4)
  - _Requirements: 3.2, 3.3, 3.4, 4.4_

- [x] 2. Add `debrief-narrative` helper with tests
  - Files: `apps/web/lib/drill/debrief-narrative.ts` (new); `apps/web/lib/drill/__tests__/debrief-narrative.test.ts` (new)
  - Define `Narrative = { paragraphs: [string] | [string, string], whatsNextHref: '/drill' | '/progress', whatsNextLabel: string }`
  - Define `NarrativeInput = { tier: AccuracyTier, language: Language, exerciseCount: number, correctCount: number, attemptedCount: number, skippedCount: number }`
  - Implement `debriefNarrative(input): Narrative`:
    - 1–2 short lowercase templated paragraphs per tier; each must contain `LANGUAGE_NAMES[language].toLowerCase()` (e.g., "spanish") and the count of items practiced (Req 4.3)
    - what's-next routing: `tier === 'high'` → `{ href: '/progress', label: 'see what moved →' }`; else → `{ href: '/drill', label: 'another short session →' }` (Req 4.4)
  - Tests: each tier produces the expected href; paragraphs reference the language name; all-skipped (`attemptedCount === 0`) returns the low-tier template + `/drill` href; copy is lowercase
  - Purpose: Templated, no-Claude coach narrative + what's-next routing rule (Req 4.2, 4.3, 4.4)
  - _Leverage: apps/web/lib/drill/accuracy-tier.ts (from task 1); packages/shared (LANGUAGE_NAMES, Language)_
  - _Requirements: 4.2, 4.3, 4.4_

### API client

- [x] 3. Create debrief Zod schemas with tests
  - Files: `packages/api-client/src/schemas/debrief.ts` (new); `packages/api-client/src/schemas/debrief.test.ts` (new)
  - Define `DebriefItemStatusSchema = z.enum(['correct', 'incorrect', 'skipped'])` and inferred type `DebriefItemStatus`
  - Define `DebriefItemSchema` with: `exerciseId: string().uuid()`, `type: nativeEnum(ExerciseType)`, `contentJson: unknown()`, `status: DebriefItemStatusSchema`, `userAnswer: string().nullable()`, `score: number().min(0).max(1).nullable()`, `evaluation: EvaluationResultSchema.nullable()`
  - Define `DebriefResponseSchema` with: `id: string().uuid()`, `language: nativeEnum(Language)`, `difficulty: nativeEnum(CefrLevel)`, `startedAt: string().datetime()`, `completedAt: string().datetime()`, `durationSeconds: number().int().nonnegative()`, `exerciseCount/correctCount/attemptedCount/skippedCount: number().int().nonnegative()`, `items: array(DebriefItemSchema)`
  - Export inferred `DebriefItem`, `DebriefResponse`
  - Tests: happy parse for full response; reject negative counts; reject `userAnswer: undefined` (only `null` is valid for skipped); reject `status: 'foo'`; reject score out of [0,1]; happy parse for skipped item (`userAnswer: null, score: null, evaluation: null`)
  - Purpose: Wire types for `GET /sessions/:id/debrief` (Req 2.1–2.4)
  - _Leverage: packages/api-client/src/schemas/exercise.ts (EvaluationResultSchema, ExerciseResponseSchema test pattern)_
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 4. Create `useSessionDebrief` query hook with tests
  - Files: `packages/api-client/src/hooks/useDebrief.ts` (new); `packages/api-client/src/hooks/useDebrief.test.ts` (new)
  - Implement `useSessionDebrief({ sessionId, fetchFn, enabled = true })` returning a `useQuery<DebriefResponse, Error>` with `queryKey: ['session-debrief', sessionId]`, `staleTime: Infinity`
  - `queryFn`: `GET /sessions/${sessionId}/debrief`, parse with `DebriefResponseSchema`
  - Tests with mocked `AuthenticatedFetch`: assert URL templating, method GET, parsed response; assert error rejection on non-2xx; assert `staleTime: Infinity` is on the resulting query options (or test indirectly that a successful query is not refetched on remount within the same QueryClient)
  - Purpose: Client-side debrief read (Req 2.1, NFR Reliability — cacheable)
  - _Leverage: packages/api-client/src/hooks/useExercise.ts (useQuery pattern); packages/api-client/src/hooks/useSession.test.ts (test scaffolding)_
  - _Requirements: 2.1_

- [x] 5. Export debrief schemas and hook from api-client index
  - Files: `packages/api-client/src/index.ts` (modify)
  - Add `export * from './schemas/debrief';` and `export * from './hooks/useDebrief';`
  - Run `pnpm --filter @language-drill/api-client typecheck` to confirm no export collisions
  - Purpose: Make the new pieces importable via `@language-drill/api-client`
  - _Leverage: packages/api-client/src/index.ts (existing barrel re-exports)_
  - _Requirements: 2.1_

### Lambda API (debrief endpoint)

- [x] 6. Add GET /sessions/:id/debrief handler — happy path + 404 ownership
  - Files: `infra/lambda/src/routes/sessions.ts` (modify); `infra/lambda/src/routes/sessions.test.ts` (modify)
  - Add a `GET /sessions/:id/debrief` handler under the existing `sessions.use('/sessions/*', authMiddleware)` mount
  - Validate `id` with `z.string().uuid()`; on parse failure return HTTP 400 `VALIDATION_ERROR` per existing pattern in `sessions.ts:42`
  - Query 1: `select` from `practiceSessions` where `id`, `userId`, AND `completedAt IS NOT NULL`. If zero rows → HTTP 404 `{ error: 'Session not found', code: 'SESSION_NOT_FOUND' }` with `Cache-Control: no-store`
  - Query 2: items query with `DISTINCT ON (exercise_id) ... ORDER BY exercise_id, evaluated_at DESC NULLS LAST` LEFT JOINed to `exercises` filtered by `id = ANY(exerciseIds)` — see design.md §"Server query strategy" for the exact SQL
  - Build the response: reorder items by `exerciseIds` via a `Map`; set `status` to `'correct'` (history exists AND `score >= CORRECT_THRESHOLD`), `'incorrect'` (history exists AND `score < CORRECT_THRESHOLD`), `'skipped'` (no history); shape `userAnswer`/`evaluation` from `responseJson`
  - Compute `durationSeconds`, `attemptedCount = items.filter(i => i.status !== 'skipped').length`, `skippedCount = exerciseCount - attemptedCount`
  - Set `Cache-Control: private, max-age=300` on the 200 path only
  - Tests: happy path with 5 manifest items, mix of correct / incorrect / skipped → response shape matches schema; cross-user request (sessionId owned by user A, JWT for user B) → 404; unknown id → 404; not-completed session → 404
  - Purpose: Read-only debrief endpoint (Req 2.1–2.5, 2.7, 2.8, 2.9, NFR Performance, NFR Security)
  - _Leverage: infra/lambda/src/routes/sessions.ts (existing complete handler for the auth/db/atomic-update pattern); packages/db/src/schema/{sessions,progress}.ts; packages/shared (CORRECT_THRESHOLD)_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.8, 2.9_

- [x] 7. Add retry-collapse and malformed-responseJson tests for /debrief endpoint
  - Files: `infra/lambda/src/routes/sessions.test.ts` (modify)
  - Test: when `(session_id, exercise_id)` has TWO history rows with different `evaluated_at` values, the response item's `score` and `userAnswer` come from the later row (Req 2.2); the earlier row is not surfaced as a separate item
  - Test: a session with zero `user_exercise_history` rows → all items skipped, `attemptedCount === 0`, header response remains 200 (Req 2.3, Error Handling §6)
  - Test: a history row with malformed `responseJson` (e.g., `{ foo: 'bar' }`) returns the item with `userAnswer: null`, `evaluation: null`, but `status` still derived from `score` (so it counts toward `attemptedCount`); confirms alignment with Phase E `attemptedCount` semantics (Req 2.9)
  - Test: response includes `Cache-Control: private, max-age=300` on success
  - Purpose: Lock down the most-recent-row-wins and cache-header semantics; verify Phase E `attemptedCount` alignment (Req 2.2, 2.9, NFR Performance)
  - _Leverage: infra/lambda/src/routes/sessions.test.ts (existing test harness); packages/db/src/schema/progress.ts (userExerciseHistory)_
  - _Requirements: 2.2, 2.9_

### Web — components

- [x] 8. Create `DebriefHeader` component with tests
  - Files: `apps/web/app/(dashboard)/drill/debrief/_components/debrief-header.tsx` (new); `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/debrief-header.test.tsx` (new)
  - Props: `{ debrief: DebriefResponse }` (typed import from `@language-drill/api-client`)
  - Render: eyebrow `t-micro` "session done · {m:ss}"; title `t-display-xl` from `TIER_TITLE[tier]`; body `t-body-l` "you got X of Y · accuracy Z%[ · N skipped]" where Z = `Math.round((correctCount / attemptedCount) * 100)` or `—` when `attemptedCount === 0` (Req 3.1)
  - Tier computed via `accuracyTier(correctCount, attemptedCount)`
  - Inline `formatDuration(totalSeconds): string` returning `m:ss` — zero-pad seconds (`String(seconds).padStart(2, '0')`), do NOT zero-pad minutes; e.g., `0` → `0:00`, `5` → `0:05`, `60` → `1:00`, `3601` → `60:01`
  - All copy lowercase (Req 3.7)
  - Tests: each tier renders the expected title; mm:ss formatting for 0/59/60/3601; skipped suffix appears only when `skippedCount > 0`; accuracy `—` when `attemptedCount === 0`; no streak/XP text rendered (assert by absence of "streak", "xp", "day", "🔥")
  - Purpose: Editorial header (Req 3.1–3.7)
  - _Leverage: apps/web/lib/drill/accuracy-tier.ts (from task 1); apps/web/components/ui (typography classes via globals.css); packages/api-client (DebriefResponse type)_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 9. Create `DebriefTabs` component with tests
  - Files: `apps/web/app/(dashboard)/drill/debrief/_components/debrief-tabs.tsx` (new); `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/debrief-tabs.test.tsx` (new)
  - Props: `{ active: 'debrief' | 'review', onChange: (tab) => void, children: ReactNode }`
  - Mirror the keyboard handling, refs, and aria attribute pattern from `progress-tabs.tsx` exactly: `role="tablist"`, two `role="tab"` buttons (debrief / review) with `aria-selected`, `aria-controls`, `tabIndex` roving; ArrowLeft/ArrowRight cycle, Home/End jump; single `role="tabpanel"` wrapping `children` with `aria-labelledby`
  - Active-tab visual: `border-bottom: 2px solid var(--color-ink)` (matches progress-tabs)
  - Tests: clicking each tab calls `onChange` with the right id; ArrowRight from "debrief" focuses + activates "review"; ArrowLeft from "review" wraps to "debrief"; Home jumps to first; End jumps to last; aria-selected updates; review tabpanel is rendered when `active === 'review'`
  - Purpose: WAI-ARIA tablist for the two-pane debrief area (Req 7.1, 7.3)
  - _Leverage: apps/web/app/(dashboard)/progress/_components/progress-tabs.tsx (port the keyboard/ARIA mechanics)_
  - _Requirements: 7.1, 7.3_

- [x] 10. Create `DebriefTab` panel content with tests
  - Files: `apps/web/app/(dashboard)/drill/debrief/_components/debrief-tab.tsx` (new); `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/debrief-tab.test.tsx` (new)
  - Props: `{ debrief: DebriefResponse }`
  - Compute `tier = accuracyTier(...)`, `narrative = debriefNarrative({ tier, language, exerciseCount, correctCount, attemptedCount, skippedCount })`
  - Render: a `Card` with avatar (small ink dot with "c", same as the prototype's coach badge) + speech-bubble-style inner card containing the 1–2 narrative paragraphs (`t-body-l`); below the coach card, a "what's next" callout `Card` with `t-micro` "what's next" + `narrative.whatsNextLabel` rendered as a Next.js `<Link>` to `narrative.whatsNextHref`
  - Optionally include an italic line above the paragraphs from `coachMessage({ kind: 'sessionComplete', accuracy })` for design parity with the prototype (mixed-case quoted speech is acceptable here per design.md §"Code Reuse Analysis")
  - NO skill-delta section (Req 4.5)
  - Tests: high-tier renders `/progress` link; mid/low-tier renders `/drill` link; paragraphs are present (1 or 2); the language name appears at least once in the rendered text
  - Purpose: Default tab content (Req 4.1, 4.2, 4.3, 4.4, 4.5)
  - _Leverage: apps/web/lib/drill/accuracy-tier.ts; apps/web/lib/drill/debrief-narrative.ts; apps/web/lib/drill/coach-messages.ts (sessionComplete branch); apps/web/components/ui (Card)_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 11. Create `ReviewItemCard` — header chrome + cloze body with tests
  - Files: `apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx` (new); `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/review-item-card.test.tsx` (new)
  - Props: `{ index: number, item: DebriefItem }`
  - Local state: `expanded: boolean`, initial `item.status !== 'correct'` (Req 5.9)
  - Header chrome (always rendered): `t-mono` `#{index + 1}` + topic chip if any + status chip — sage "✓ correct" (Req 5.2), terracotta "✗ missed" (Req 5.3), paper-3 "skipped" (Req 5.4); clicking the header toggles `expanded`
  - Expanded body, cloze branch (`item.type === 'cloze'` AND `item.status !== 'skipped'`): two cells per Req 5.5 — "your answer" cell with `splitClozeSentence(content.sentence)` and the user's fill (or `expectedAnswer` for the correct case) substituted into the blank token (sage tint on correct; terracotta tint with strike-through on incorrect); "corrected" / "why it works" cell with the reference fill in a green-bordered token; below the two cells, render `evaluation.feedback` if present (Req 5.3)
  - Skipped branch (any type): prompt only + `t-small` caption "skipped — no submission" (Req 5.4)
  - Tests: correct items collapse by default; incorrect/skipped expand by default; clicking the header toggles expanded; expand state does NOT persist across remounts (Req 5.9); cloze incorrect renders strike-through on user fill; cloze correct shows user fill in green tint; skipped renders prompt + caption; theory trigger is NOT rendered (Req 5.8)
  - Purpose: Per-item card + cloze layout (Req 5.1, 5.2, 5.3, 5.4, 5.5, 5.8, 5.9)
  - _Leverage: apps/web/lib/drill/cloze-blank.ts (splitClozeSentence); packages/shared (isClozeContent type guard); apps/web/components/ui (Card, Chip)_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.8, 5.9_

- [x] 12. Add translation + vocab branches to `ReviewItemCard` with tests
  - Files: `apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx` (modify); `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/review-item-card.test.tsx` (modify)
  - Translation branch (`item.type === 'translation'` AND not skipped): two cells side by side — "your translation" with `item.userAnswer`; "reference" / "one accepted form" with `content.referenceTranslation`. `evaluation.feedback` below (Req 5.6)
  - Vocab branch (`item.type === 'vocab_recall'` AND not skipped): italic prompt definition above two cells — "you typed" with `item.userAnswer`; "target word" with `content.expectedWord` and the example sentence below (Req 5.7)
  - Tests: translation correct renders user text + reference; translation incorrect adds Claude feedback; vocab correct renders target word + example; vocab incorrect adds feedback; type guards (`isTranslationContent`, `isVocabRecallContent`) work as expected
  - Purpose: Translation + vocab review layouts (Req 5.6, 5.7)
  - _Leverage: apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx (from task 11); packages/shared (isTranslationContent, isVocabRecallContent type guards)_
  - _Requirements: 5.6, 5.7_

- [x] 13. Create `ReviewTab` panel content with tests
  - Files: `apps/web/app/(dashboard)/drill/debrief/_components/review-tab.tsx` (new); `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/review-tab.test.tsx` (new)
  - Props: `{ items: DebriefItem[] }`
  - Render: a vertical stack of `ReviewItemCard` — `items.map((item, index) => <ReviewItemCard key={item.exerciseId} index={index} item={item} />)`
  - Tests: renders one card per item; preserves manifest order (verify by passing items in a non-sorted order and asserting render order matches)
  - Purpose: Per-item list (Req 5.1)
  - _Leverage: apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx (from tasks 11+12)_
  - _Requirements: 5.1_

- [x] 14. Create `DebriefFooter` component with tests
  - Files: `apps/web/app/(dashboard)/drill/debrief/_components/debrief-footer.tsx` (new); `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/debrief-footer.test.tsx` (new)
  - Props: `{ tier: AccuracyTier }` (currently unused — accept it now so future copy variations are non-breaking; mark with a TS-level eslint-disable-next-line if needed, OR leave unused for now)
  - Render: a flex row of three `Button`s — primary "another session", default "see your progress →", default "done"
  - Click handlers: use `useRouter` from `next/navigation` and call `router.push('/drill')` / `'/progress'` / `'/'` respectively (Req 6.2, 6.3, 6.4)
  - Tests: each button renders with the expected label; clicking each calls `router.push` with the right path (mock `useRouter`)
  - Purpose: Action footer (Req 6.1, 6.2, 6.3, 6.4)
  - _Leverage: apps/web/components/ui (Button); next/navigation (useRouter)_
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 15. Create `DebriefNotFound` component with tests
  - Files: `apps/web/app/(dashboard)/drill/debrief/_components/debrief-not-found.tsx` (new); `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/debrief-not-found.test.tsx` (new)
  - Props: none
  - Render: centered `Card` with `t-display-l` "session not found"; `t-body` "this session may not exist or may not be yours yet — start a new one from drill."; primary `Button` "back to drill" → `router.push('/drill')`
  - Tests: title and body present; clicking the button calls `router.push('/drill')`
  - Purpose: Graceful 404 fallback (Req 1.6)
  - _Leverage: apps/web/components/ui (Card, Button); next/navigation (useRouter)_
  - _Requirements: 1.6_

- [x] 16. Create `DebriefSkeleton` component (loading placeholder)
  - Files: `apps/web/app/(dashboard)/drill/debrief/_components/debrief-skeleton.tsx` (new)
  - Props: none
  - Render: header chrome (placeholder bars) + tab strip + 3 placeholder cards using existing `--paper-3`/`--paper-2` tokens (match the existing `loading-skeleton.tsx` shimmer style)
  - No tests — this is a small visual stub
  - Purpose: Skeleton during `useQuery.isPending` (NFR Performance: 100ms-to-chrome budget)
  - _Leverage: apps/web/app/(dashboard)/drill/_components/loading-skeleton.tsx_
  - _Requirements: NFR Performance_

### Web — page

- [x] 17. Create debrief page orchestrator (happy + loading + 404 paths)
  - Files: `apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.tsx` (new)
  - Type props as `{ params: Promise<{ sessionId: string }> }`; read via `import { use } from 'react'` and `const { sessionId } = use(params)`
  - Build `fetchFn = createAuthenticatedFetch(getToken)` (same pattern as `/drill`)
  - Call `useSessionDebrief({ sessionId, fetchFn })`
  - Render branches: `isPending` → `<DebriefSkeleton />`; `isError` → `<DebriefNotFound />` (v1 collapses 404 and 5xx into the same branch — no inline retry button; the user can navigate away and back, which retries via the standard query lifecycle); success → `<DebriefHeader debrief={data} />` + `<DebriefTabs active={tab} onChange={setTab}>` containing `<DebriefTab />` or `<ReviewTab />` + `<DebriefFooter />`
  - Local state: `useState<'debrief' | 'review'>('debrief')` (Req 7.2)
  - Wrap content in a `<div className="mx-auto max-w-[920px] px-s-6">` for the editorial layout (NFR Usability)
  - Purpose: Page orchestration (Req 1.4, 1.5, 7.2, NFR Performance)
  - _Leverage: apps/web/app/(dashboard)/drill/page.tsx (createAuthenticatedFetch, useAuth pattern); packages/api-client (useSessionDebrief)_
  - _Requirements: 1.4, 1.5, 1.6, 7.2_

- [x] 18. Add page integration tests
  - Files: `apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.test.tsx` (new)
  - Mocks: `useSessionDebrief` (parameterizable per test), `useAuth` (Clerk), `useRouter` (next/navigation)
  - Tests:
    - Mount with successful query → header + tabs + footer render; default tab is "debrief"; review tab content NOT rendered
    - Switch to review tab via click → review cards render in manifest order; debrief tab content NOT rendered
    - Mount with `isPending` → `<DebriefSkeleton />` rendered; no header
    - Mount with 404 error → `<DebriefNotFound />` rendered; no tabs, no footer
    - Mount with generic 5xx error → renders `<DebriefNotFound />` (same branch as 404; v1 has no inline retry — confirmed in t17)
    - Click footer "another session" → `router.push('/drill')` invoked
    - Click footer "see your progress →" → `router.push('/progress')` invoked
    - Click footer "done" → `router.push('/')` invoked
  - Purpose: Page-level integration coverage (Req 1.4, 1.6, 6.2, 6.3, 6.4, 7.2)
  - _Leverage: apps/web/app/(dashboard)/drill/page.test.tsx (existing QueryClient + Clerk mock scaffolding for the dashboard route group)_
  - _Requirements: 1.4, 1.6, 6.2, 6.3, 6.4, 7.2_

### Phase E removal

- [x] 19. Wire `/drill` to debrief route AND simplify reducer (paired commit)
  - Files: `apps/web/app/(dashboard)/drill/page.tsx` (modify); `apps/web/app/(dashboard)/drill/page.test.tsx` (modify); `apps/web/app/(dashboard)/drill/_components/session-reducer.ts` (modify); `apps/web/app/(dashboard)/drill/_components/__tests__/session-reducer.test.ts` (modify)
  - **Why paired:** removing `COMPLETE_SUCCEEDED` from the reducer's `SessionAction` type makes the existing dispatch in `drill/page.tsx:145–146` un-typecheck-able. Both edits MUST land together to keep the build green.
  - Reducer (`session-reducer.ts`):
    - Remove the `summary` discriminant from the `SessionState` union
    - Remove the `COMPLETE_SUCCEEDED` action from `SessionAction` and its case in `sessionReducer`
    - In `selectProgressFraction`, change the `case 'completing':` to return 1 directly (no `case 'summary':` to fall through to). The exhaustive `_exhaustive: never` check at the bottom must still type-check
  - Reducer tests (`session-reducer.test.ts`):
    - Remove tests that exercised `COMPLETE_SUCCEEDED` and the `summary` state
    - Add a `// @ts-expect-error` line asserting that `{ type: 'COMPLETE_SUCCEEDED', summary: ... }` is no longer a valid `SessionAction`
  - Drill page (`drill/page.tsx`):
    - In `fireCompleteSession`: change `onSuccess: (summary) => dispatch({ type: 'COMPLETE_SUCCEEDED', summary })` to `onSuccess: () => router.push(\`/drill/debrief/${sessionId}\`)`. The `onError` branch is unchanged
    - Remove the `import { SessionSummary } ...` line and the `state.kind === 'summary'` render branch (currently lines ~354–360)
  - Drill page tests (`drill/page.test.tsx`):
    - Change the "click see results → summary rendered" assertion to "click see results → `router.push('/drill/debrief/${sessionId}')` was called once with the right session id"
    - Same change for the "end session early" rate-limit test
    - Remove tests that asserted on `SessionSummary` markup
  - Run `pnpm --filter @language-drill/web test apps/web/app/(dashboard)/drill/_components/__tests__/session-reducer.test.ts apps/web/app/(dashboard)/drill/page.test.tsx` and confirm green
  - Run `pnpm --filter @language-drill/web typecheck` and confirm green (this verifies the reducer change and the page change are mutually consistent)
  - Purpose: Wire `/drill` to debrief AND simplify reducer in one atomic build-safe step (Req 1.1, 1.2, 1.3, 8.1, 8.4)
  - _Leverage: apps/web/app/(dashboard)/drill/page.tsx (from session-flow Phase E); apps/web/app/(dashboard)/drill/_components/session-reducer.ts_
  - _Requirements: 1.1, 1.2, 1.3, 8.1, 8.4_

- [x] 20. Delete `SessionSummary` component and its test
  - Files: `apps/web/app/(dashboard)/drill/_components/session-summary.tsx` (delete); `apps/web/app/(dashboard)/drill/_components/__tests__/session-summary.test.tsx` (delete)
  - Run `pnpm --filter @language-drill/web typecheck` and `pnpm --filter @language-drill/web test` to confirm nothing else imports from these files (task 19 should have removed the only consumer)
  - Purpose: Remove the now-unreachable Phase E summary screen (Req 8.2)
  - _Requirements: 8.2_

### Pre-merge verification

- [x] 21. Run pre-push checks from repo root
  - Files: none
  - Run `pnpm lint && pnpm typecheck && pnpm test` per `CLAUDE.md` Pre-Push Checks; resolve any failures
  - Visually verify the flow in the local dev server: start a session at `/drill`, complete it, land on `/drill/debrief/[sessionId]`, switch tabs, click each footer button
  - Purpose: Ensure the spec ships green
  - _Requirements: All_
