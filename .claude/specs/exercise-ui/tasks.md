# Implementation Plan

## Task Overview

Bottom-up build: pure helpers → shared shell components → per-type renderers → page-level orchestrator wiring. Each helper is testable in isolation before any component depends on it; each component test is written alongside the component. The page rewrite (task 17) is the integration point — running it before the per-type renderers exist would break the build.

Tasks are sized for 15–30 min execution. The page test rewrite (task 18) is the largest single task and may stretch to 45 min because it replaces a 555-line file; if needed it can be split between rendering/submission tests and evaluation/error tests.

## Steering Document Compliance

- All new components are TSX with `'use client'` per Next.js App Router conventions (`tech.md`).
- Route-private code lives under `apps/web/app/(dashboard)/drill/_components/`; pure helpers under `apps/web/lib/drill/` and `apps/web/lib/translation/` (`structure.md`).
- All styling uses existing Tailwind v4 tokens from `apps/web/app/globals.css` (`tech.md`).
- No new server-state hooks added; UI-only phase per `docs/web-implementation-plan.md` Phase F.
- Existing UI primitives (`Button`, `Card`, `Chip`, `Choice`, `Input`, `Textarea`, `AccentPicker`, `Bar`) are reused, not reinvented.

## Atomic Task Requirements
**Each task must meet these criteria for optimal agent execution:**
- **File Scope**: Touches 1–3 related files maximum
- **Time Boxing**: Completable in 15–30 minutes
- **Single Purpose**: One testable outcome per task
- **Specific Files**: Must specify exact files to create/modify
- **Agent-Friendly**: Clear input/output with minimal context switching

## Task Format Guidelines
- Use checkbox format: `- [ ] Task number. Task description`
- Reference requirements using: `_Requirements: X.Y_`
- Reference existing code to leverage using: `_Leverage: path/to/file.ts_`

## Tasks

- [x] 1. Add `coach-fade-in` keyframe to globals.css
  - File: `apps/web/app/globals.css` (modify)
  - Add a CSS keyframe `@keyframes coach-fade-in` that animates `opacity: 0 → 1` over 150ms with no transform
  - Add a utility class `.coach-fade-in` that applies `animation: coach-fade-in 150ms ease-out`
  - Purpose: Provide the fade-in animation referenced by `CoachRail` when its message changes (Req 2 AC #4)
  - _Leverage: existing `@theme` block and tokens in `apps/web/app/globals.css`_
  - _Requirements: 2.4_

- [x] 2. Create verdict-tier helpers in `lib/drill/verdict-tier.ts`
  - File: `apps/web/lib/drill/verdict-tier.ts` (new)
  - Export `VerdictTier = 'sage' | 'yellow' | 'terracotta'` and `VerdictResult = { tier: VerdictTier; label: string }`
  - Export `clozeVerdict(score: number): VerdictResult`, `translationVerdict(score: number): VerdictResult`, `vocabVerdict(score: number, errors: EvaluationError[]): VerdictResult`
  - Implement the score bands and labels exactly per design.md §`lib/drill/verdict-tier.ts` (vocab uses explicit top-to-bottom precedence)
  - Purpose: Single source of truth for verdict mapping consumed by all three exercise components
  - _Leverage: `EvaluationError` from `@language-drill/shared`_
  - _Requirements: 4.4, 5.4_

- [x] 3. Add unit tests for verdict-tier helpers
  - File: `apps/web/lib/drill/__tests__/verdict-tier.test.ts` (new)
  - Table-driven tests covering edge values (0.0, 0.4, 0.6, 0.7, 0.95, 1.0) for each of the three helpers
  - Vocab tests cover all 5 precedence rules including grammar+spelling combo (grammar wins)
  - Purpose: Lock the score-band semantics so downstream changes can't drift
  - _Leverage: `vitest` (already configured in `apps/web/vitest.config.ts`)_
  - _Requirements: 4.4, 5.4, 8.5_

- [x] 4. Create coach-message helpers in `lib/drill/coach-messages.ts`
  - File: `apps/web/lib/drill/coach-messages.ts` (new)
  - Export `CoachContext = { kind: 'idle'; type: ExerciseType } | { kind: 'evaluated'; type: ExerciseType; score: number }`
  - Export `coachMessage(ctx: CoachContext): string` returning hard-coded strings: 3 idle (one per type) + 12 evaluated (3 types × 4 score tiers, with tier boundaries `>= 0.95`, `0.7..0.95`, `0.4..0.7`, `< 0.4`)
  - Idle copies per Req 2 AC #2; evaluated copies should be calm, no emoji, no exclamation marks
  - Purpose: Centralize coach copy so tests can lock string presence without hard-coding tests against components
  - _Leverage: `ExerciseType` from `@language-drill/shared`_
  - _Requirements: 2.2, 2.3_

- [x] 5. Add unit tests for coach-message helpers
  - File: `apps/web/lib/drill/__tests__/coach-messages.test.ts` (new)
  - Assert all 15 strings exist, are non-empty, and contain no emoji (regex against common emoji ranges)
  - Assert no duplicates within a single exercise type's evaluated set
  - One assertion per (type, tier) pair using a table
  - Purpose: Lock the coach copy contract
  - _Leverage: `vitest`_
  - _Requirements: 2.2, 2.3, 2.6_

- [x] 6. Create cloze-blank helper in `lib/drill/cloze-blank.ts`
  - File: `apps/web/lib/drill/cloze-blank.ts` (new)
  - Export `splitClozeSentence(sentence: string): { before: string; after: string; hasBlank: boolean }`
  - Splits on the first occurrence of `___` or `____` (3 or 4+ underscores); returns `{ before: full, after: '', hasBlank: false }` when none found
  - Purpose: Replace the current inline split logic with a tested pure function
  - _Requirements: 3.5_

- [x] 7. Add unit tests for cloze-blank helper
  - File: `apps/web/lib/drill/__tests__/cloze-blank.test.ts` (new)
  - Cases: no blank, blank at start, blank at end, blank in middle, multiple blanks (only first split), 4+ underscores
  - Purpose: Lock parsing rules
  - _Leverage: `vitest`_
  - _Requirements: 3.5_

- [x] 8. Create syllabify helper in `lib/drill/syllabify.ts`
  - File: `apps/web/lib/drill/syllabify.ts` (new)
  - Export `letterCountLabel(word: string): string` returning ``${word.length} letters``
  - Purpose: Provide the L2 hint label for vocab; deliberately letter count, not syllables (Req 5 AC #2)
  - _Requirements: 5.2_

- [x] 9. Add unit test for syllabify helper
  - File: `apps/web/lib/drill/__tests__/syllabify.test.ts` (new)
  - Tests: empty string returns `0 letters`, `aprovechar` returns `10 letters`, single char returns `1 letters`
  - Purpose: Trivial but locks the format
  - _Leverage: `vitest`_
  - _Requirements: 5.2_

- [x] 10. Create parse-confusions helper in `lib/drill/parse-confusions.ts`
  - File: `apps/web/lib/drill/parse-confusions.ts` (new)
  - Export `parseConfusions(feedback: string): Array<{ a: string; b: string }>`
  - Use regex `/([\p{L}]+)\s+(?:vs\.?|\/|or)\s+([\p{L}]+)/gu`, dedupe pairs (case-insensitive), cap at 3 results
  - Purpose: Extract structured confusion pairs from free-form Claude feedback for vocab verdict UI (Req 5 AC #5)
  - _Requirements: 5.5_

- [x] 11. Add unit tests for parse-confusions helper
  - File: `apps/web/lib/drill/__tests__/parse-confusions.test.ts` (new)
  - Cases: `"casi vs apenas"`, `"casi/apenas"`, `"casi or apenas"`, dedupe across separators, 3-result cap, no-match returns `[]`, mixed-case dedupe
  - Purpose: Lock the parsing contract before it's wired into UI
  - _Leverage: `vitest`_
  - _Requirements: 5.5_

- [x] 12. Create the static gloss list in `lib/translation/gloss-en.ts`
  - File: `apps/web/lib/translation/gloss-en.ts` (new)
  - Export `GlossEntry = { pos: 'noun' | 'verb' | 'adj' | 'adv' | 'phrase'; gloss: string }`
  - Export `ENGLISH_GLOSS: Record<string, GlossEntry>` with at least 60 entries — focus on intermediate verbs/idioms ("afford", "barely", "outgrow", "nevertheless", "withhold", "withstand", "endure", "thrive", "settle", etc.)
  - All keys are lowercased lemmas; all glosses ≤ 60 chars
  - Export `lookupGloss(token: string): GlossEntry | undefined` that lowercases + strips trailing punctuation before lookup
  - Purpose: The data source for `GlossedText` tooltips and the translation L1 hint
  - _Requirements: 4.2, 4.3_

- [x] 13. Add unit tests for the gloss list
  - File: `apps/web/lib/translation/__tests__/gloss-en.test.ts` (new)
  - Assert ≥ 60 entries, all glosses non-empty and ≤ 60 chars, all keys lowercase
  - Test `lookupGloss('Afford')`, `lookupGloss('afford,')`, `lookupGloss('afford.')` all return the same entry
  - Test unknown word returns `undefined`
  - Purpose: Lock list size + lookup tolerance
  - _Leverage: `vitest`_
  - _Requirements: 4.2_

- [x] 14. Create `DrillLayout` component
  - File: `apps/web/app/(dashboard)/drill/_components/drill-layout.tsx` (new)
  - Props: `{ rail: ReactNode, main: ReactNode, progressFraction?: number, isLoading?: boolean }`
  - Layout: CSS Grid `grid-template-columns: 280px 1fr` at ≥ 900px (use Tailwind `md:grid-cols-[280px_1fr]` or arbitrary value), single column below
  - Renders the 3px progress bar at the top of the main slot using the `Bar` primitive (or a thin wrapper if `Bar` lacks a 3px variant — use a `<div className="h-[3px] bg-rule">` with an inner accent-filled `<div>` sized by `progressFraction`)
  - When `isLoading`, the main slot renders a `LoadingSkeleton` block (extract the existing skeleton from current `drill/page.tsx` into a sibling file `loading-skeleton.tsx` if not already extracted)
  - Coach rail background: `bg-paper-2`, `border-r border-rule`, padding `p-s-6`
  - Purpose: The two-pane shell shared by every state of the page
  - _Leverage: `apps/web/components/ui/bar.tsx`, existing globals.css tokens_
  - _Requirements: 1.1, 1.2, 1.3, 1.5_

- [x] 15. Add tests for `DrillLayout`
  - File: `apps/web/app/(dashboard)/drill/_components/__tests__/drill-layout.test.tsx` (new)
  - Render with both slots: assert both children appear
  - Render with `progressFraction=0/0.5/1`: assert filled width via inline style or class
  - Render with `isLoading`: assert `LoadingSkeleton` appears in the main slot, rail still renders
  - Purpose: Verify layout invariants
  - _Leverage: `@testing-library/react`, existing test setup_
  - _Requirements: 1.1, 1.2, 1.5_

- [x] 16. Create `CoachRail` component
  - File: `apps/web/app/(dashboard)/drill/_components/coach-rail.tsx` (new)
  - Props: `{ message: string, exerciseType: ExerciseType, vocabActiveCount?: number }`
  - Renders: 48px black avatar circle with Fraunces 'c', `.t-micro` "coach" label, "guiding this session" sub-label, message in a `Card` with `key={message}` and `className="coach-fade-in"`
  - Vocabulary tracker block: hidden in v1 (Req 5 AC #6 resolution); leave a clear comment marking the future slot
  - Purpose: The persona block in the rail
  - _Leverage: `apps/web/components/ui/card.tsx`, `coach-fade-in` keyframe from task 1, `lib/drill/coach-messages.ts`_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 17. Add tests for `CoachRail`
  - File: `apps/web/app/(dashboard)/drill/_components/__tests__/coach-rail.test.tsx` (new)
  - Render with `message="hello"` — assert text appears, avatar appears, no streak/XP/day text appears
  - Render with each `exerciseType` value — assert the rail still renders (no per-type branching expected here, but smoke-test)
  - Re-render with a changed message — assert the new text appears
  - Purpose: Lock the rail's render surface
  - _Leverage: `@testing-library/react`_
  - _Requirements: 2.1, 2.4, 2.6_

- [x] 18. Create `FeedbackShell` component
  - File: `apps/web/app/(dashboard)/drill/_components/feedback-shell.tsx` (new)
  - Props: `{ tier: VerdictTier, label: string, scoreChipText: string, scaffolded?: boolean, hintLevel?: 0|1|2|3, children: ReactNode, onNext: () => void }`
  - Renders: tier-colored container (sage/yellow/terracotta soft background), header (`label` in `.t-display-s` + score `Chip` + optional `scaffolded` chip + optional `hint level N` chip), `children` body slot, footer with single "next" `Button variant="accent"`
  - Background mapping: `sage → bg-[var(--color-ok-soft)]`, `yellow → bg-[var(--color-hilite-soft)]`, `terracotta → bg-[var(--color-accent-soft)]`
  - Purpose: Shared verdict shell across all three exercise types
  - _Leverage: `apps/web/components/ui/chip.tsx`, `apps/web/components/ui/button.tsx`, `apps/web/components/ui/card.tsx`, `lib/drill/verdict-tier.ts`_
  - _Requirements: 6.1, 6.2, 6.6_

- [x] 19. Add tests for `FeedbackShell`
  - File: `apps/web/app/(dashboard)/drill/_components/__tests__/feedback-shell.test.tsx` (new)
  - Render each tier — assert background class mapping
  - Render with `scaffolded=true` vs `false` — assert chip presence
  - Render with `hintLevel=2` vs `0` — assert "hint level 2" chip presence/absence
  - Click "next" — assert `onNext` called once
  - Purpose: Lock the verdict shell contract
  - _Leverage: `@testing-library/react`, `userEvent`_
  - _Requirements: 6.1, 6.2, 6.6, 5.3, 8.2_

- [x] 20. Create `GlossedText` component
  - File: `apps/web/app/(dashboard)/drill/_components/glossed-text.tsx` (new)
  - Props: `{ text: string }`
  - Splits text on whitespace; for each token, calls `lookupGloss`. Wraps glossed tokens in `<span class="gloss" tabindex={0}>{token}<span class="gloss-tooltip">{entry.gloss}</span></span>`; non-glossed tokens render as plain text
  - Add `.gloss` and `.gloss-tooltip` styles to `globals.css` in this same task: dotted underline for `.gloss`, absolutely-positioned dark tooltip via `:hover` and `:focus-within` (CSS-only, no JS hover handlers)
  - Purpose: Hoverable gloss tooltips for translation source text
  - _Leverage: `lib/translation/gloss-en.ts`, `apps/web/app/globals.css`_
  - _Requirements: 4.2_

- [x] 21. Add tests for `GlossedText`
  - File: `apps/web/app/(dashboard)/drill/_components/__tests__/glossed-text.test.tsx` (new)
  - Render text with mix of glossed + plain tokens — assert glossed tokens have `.gloss` class
  - Assert tooltip text appears in DOM (not display:none-mounted) so it's accessible to screen readers
  - Render text with no glossed tokens — assert no `.gloss` element
  - Purpose: Lock the gloss markup contract
  - _Leverage: `@testing-library/react`_
  - _Requirements: 4.2_

- [x] 22. Create `HintRow` component
  - File: `apps/web/app/(dashboard)/drill/_components/hint-row.tsx` (new)
  - Props: `{ expectedWord: string, exampleSentence?: string, level: 0|1|2|3, onAdvance: () => void }`
  - Renders 3 inline `Button` elements (variant `ghost`): "first letter" / "letter count" / "example sentence"
  - L1 button enabled when `level === 0`; L2 enabled when `level === 1`; L3 enabled when `level === 2`; previously-clicked buttons display the revealed value below them
  - L3 button is hidden entirely when `exampleSentence` is empty/undefined (NFR — Reliability)
  - Each button has `aria-pressed={level >= N}`
  - Purpose: Progressive vocab hint UI
  - _Leverage: `apps/web/components/ui/button.tsx`, `lib/drill/syllabify.ts`_
  - _Requirements: 5.2, 5.3_

- [x] 23. Add tests for `HintRow`
  - File: `apps/web/app/(dashboard)/drill/_components/__tests__/hint-row.test.tsx` (new)
  - Render at `level=0`: assert all three buttons present, only L1 enabled
  - Click L1: assert `onAdvance` called once
  - Render at `level=1`: assert first letter shown, L2 enabled, L1 disabled
  - Render with `exampleSentence=''`: assert L3 button absent
  - Render at `level=3`: assert example sentence shown with `expectedWord` masked as `___`
  - Purpose: Lock progressive disclosure
  - _Leverage: `@testing-library/react`, `userEvent`_
  - _Requirements: 5.2, 5.3_

- [x] 24. Create `ClozeExercise` component
  - File: `apps/web/app/(dashboard)/drill/_components/cloze-exercise.tsx` (new)
  - Props per design.md: `{ content: ClozeContent, language: LearningLanguage, submission, onSubmit, onNext }`
  - Local state: `mode: 'type' | 'mc'` (default `'type'`), `answer: string`, `usedMc: boolean` (sticky once true)
  - Render: optional `content.context` in `.t-small`, sentence with blank rendered as `?` span (uses `splitClozeSentence`), then either an `Input` + `AccentPicker` (type mode) or `Choice` pills row (mc mode), then a "Show options" toggle (only when `content.options?.length >= 2`) labelled "reduces progress signal", then submit button
  - When `submission.kind === 'evaluated'`, render `FeedbackShell` below with verdict from `clozeVerdict`, `scaffolded={usedMc}` chip, body containing the user's answer + `EvaluationResult.feedback`
  - Input remains visible (read-only, opacity-60) post-submission
  - Auto-focus the input on mount
  - Purpose: The cloze renderer
  - _Leverage: `apps/web/components/ui/{input,accent-picker,choice,button}.tsx`, `lib/drill/{verdict-tier,cloze-blank}.ts`, `FeedbackShell` from task 18_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 6.5, 7.1, 7.4_

- [x] 25. Add tests for `ClozeExercise`
  - File: `apps/web/app/(dashboard)/drill/_components/__tests__/cloze-exercise.test.tsx` (new)
  - Render idle with options present — assert toggle visible with "reduces progress signal" helper text
  - Render idle without options — assert toggle absent
  - Toggle to MC mode and click a pill — assert input hidden, answer staged
  - Submit empty — assert button disabled
  - Submit with answer — assert `onSubmit` called with `(answer, { usedMc: false })`
  - Render evaluated with `usedMc=true` — assert `scaffolded` chip in `FeedbackShell`
  - Render evaluated — assert input is `readOnly` with reduced opacity (Req 6.5) AND the accent picker chips are disabled (Req 7.4)
  - Render with non-learning language (simulate via prop) — assert `AccentPicker` not present (Req 7.3)
  - Parameterized across `ES`/`DE`/`TR` — assert correct accent picker chips
  - Purpose: Cover Req 3 + Req 6.5 + Req 7 for cloze
  - _Leverage: `@testing-library/react`, `userEvent`_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.7, 6.5, 7.1, 7.3, 7.4, 8.2, 8.3_

- [x] 26. Create `TranslationExercise` component
  - File: `apps/web/app/(dashboard)/drill/_components/translation-exercise.tsx` (new)
  - Props per design.md: `{ content: TranslationContent, language: LearningLanguage, submission, onSubmit, onNext }`
  - Local state: `answer: string`, `hintCount: 0|1|2|3`
  - Render: `EN → {language}` eyebrow in `.t-micro`, source text via `GlossedText`, `Textarea`, `AccentPicker`, "show me a hint" `Button` (hidden when `hintCount === 3`), submit button
  - Hint reveal pipeline per design.md: counter 1 → first glossed entry, counter 2 → half reference, counter 3 → full reference
  - When `submission.kind === 'evaluated'`, render `FeedbackShell` with verdict from `translationVerdict`, body containing diff rows (strikethrough error → correction in tier color) + reference translation card
  - Input read-only post-submission, auto-focus on mount
  - Purpose: Translation renderer with gloss + diff
  - _Leverage: `apps/web/components/ui/{textarea,accent-picker,button,card}.tsx`, `lib/drill/verdict-tier.ts`, `GlossedText` from task 20, `FeedbackShell`, `lib/translation/gloss-en.ts`_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 6.5, 7.1, 7.4_

- [x] 27. Add tests for `TranslationExercise`
  - File: `apps/web/app/(dashboard)/drill/_components/__tests__/translation-exercise.test.tsx` (new)
  - Render idle — assert eyebrow text matches `EN → {language}`, source text rendered
  - Click hint button 3 times — assert reveals progress L1 → L2 → L3 and button hides
  - Render evaluated with `severity: 'minor'` error — assert correction in sage; with `'major'` — assert correction in terracotta
  - Render evaluated — assert reference translation visible
  - Render evaluated with one malformed errors row (missing `correction`) — assert verdict still renders, malformed row silently skipped (NFR Reliability)
  - Render evaluated, then assert textarea is `readOnly` with reduced opacity AND accent picker chips disabled (Req 6.5 + Req 7.4)
  - Parameterized across `ES`/`DE`/`TR` — accent picker chips
  - Purpose: Cover Req 4 + Req 6.5 + Req 7 + reliability NFR for translation
  - _Leverage: `@testing-library/react`, `userEvent`_
  - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 6.5, 7.1, 7.4, 8.2, 8.3_

- [x] 28. Create `VocabExercise` component
  - File: `apps/web/app/(dashboard)/drill/_components/vocab-exercise.tsx` (new)
  - Props per design.md: `{ content: VocabRecallContent, language: LearningLanguage, submission, onSubmit, onNext }`
  - Local state: `answer: string`, `hintLevel: 0|1|2|3`
  - Render: definition `Card` with `content.prompt` in `.t-display-s`, `Input` (auto-focused), `AccentPicker`, `HintRow`, submit button
  - When `submission.kind === 'evaluated'`, render `FeedbackShell` with verdict from `vocabVerdict(score, errors)`, `hintLevel` prop, body containing target word + example sentence + confusions list (via `parseConfusions(feedback)`, omit if empty)
  - Input read-only post-submission
  - Purpose: Vocab renderer with progressive hints + confusions
  - _Leverage: `apps/web/components/ui/{input,accent-picker,card,button}.tsx`, `lib/drill/{verdict-tier,parse-confusions}.ts`, `HintRow` from task 22, `FeedbackShell`_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.5, 7.1, 7.4_

- [x] 29. Add tests for `VocabExercise`
  - File: `apps/web/app/(dashboard)/drill/_components/__tests__/vocab-exercise.test.tsx` (new)
  - Render idle — assert definition text, input auto-focused
  - Click L1 hint — assert first letter revealed, `hintLevel` advances
  - Render evaluated with `score=1.0` — assert "exact" verdict (sage)
  - Render evaluated with `score=0.85` and grammar error — assert "right word · wrong inflection" verdict
  - Render evaluated with confusions in feedback — assert confusion pairs shown
  - Render evaluated with no parseable confusions — assert no confusions heading
  - Parameterized across `ES`/`DE`/`TR` — accent picker chips
  - Purpose: Cover Req 5 + Req 7 for vocab
  - _Leverage: `@testing-library/react`, `userEvent`_
  - _Requirements: 5.1, 5.2, 5.4, 5.5, 7.1, 8.2, 8.3_

- [x] 30. Create `ExercisePane` dispatcher
  - File: `apps/web/app/(dashboard)/drill/_components/exercise-pane.tsx` (new)
  - Props per design.md: `{ exercise: ExerciseResponse, language: LearningLanguage, submission, onSubmit, onNext }`
  - Uses `isClozeContent` / `isTranslationContent` / `isVocabRecallContent` type guards to dispatch
  - Renders the chosen child with `key={exercise.id}` so all transient state resets cleanly between exercises
  - Falls through to a single `<p>unknown exercise type</p>` line for forward compatibility (deferred types like listening/speaking)
  - Purpose: Single dispatch point feeding the three renderers
  - _Leverage: type guards from `@language-drill/shared`, the three renderers from tasks 24/26/28_
  - _Requirements: 1.4, 6.3_

- [x] 31. Rewrite `drill/page.tsx` orchestrator
  - File: `apps/web/app/(dashboard)/drill/page.tsx` (modify — full rewrite)
  - Keep existing imports/usage of `useExercise`, `useSubmitAnswer`, `useLanguageProfiles`, `useActiveLanguage`, `useAuthenticatedFetch`
  - Replace inline exercise rendering with `<DrillLayout rail={<CoachRail …/>} main={<ExercisePane …/>} progressFraction={0} isLoading={isLoading} />`
  - Implement the `SubmissionState` discriminated union (idle / submitting / evaluated / error)
  - `onSubmit(answer, meta)` calls the mutation, transitions state; `onNext()` resets to idle (existing query invalidation already happens in `useSubmitAnswer`'s `onSuccess`)
  - Pre-language-selection: render selectors only, no rail (per Req 1 AC #4)
  - **Restyle the existing 429/502 inline error UI** with the new tokens (sage/yellow/terracotta soft backgrounds, `.t-body` typography) — preserve verbatim error messages from the current implementation (Req 6.4)
  - Drop the inlined `ClozeExercise` / `TranslationExercise` / `VocabRecallExercise` / `ExercisePrompt` / `EvaluationDisplay` / `AnswerInput` from current file — those move to `_components/`
  - Target: ≤ 200 lines
  - Purpose: Wire the new components into the live page
  - _Leverage: existing hook calls in current `page.tsx`, all components from tasks 14/16/30_
  - _Requirements: 1.4, 6.3, 6.4_

- [x] 32. Rewrite `drill/page.test.tsx` integration tests
  - File: `apps/web/app/(dashboard)/drill/page.test.tsx` (modify — full rewrite)
  - Replace the 555-line per-exercise-type assertions with integration tests that mock `useExercise` + `useSubmitAnswer` and assert: page renders rail + main, language/difficulty selectors work, submission flow round-trips, 429 error UI shows, 502 error UI shows, "next" clears state, `FeedbackShell` receives correct tier prop for each score band (one assertion per of three bands)
  - Per-type rendering details are now covered by the per-component tests (24/26/28); this file no longer asserts those
  - **Add a no-gamification sweep**: across the four page states (loading, idle, evaluated, error), assert no occurrence of the strings `streak`, `XP`, `day`, `lesson`, or `session N of M` patterns anywhere in the rendered tree (Req 1.6)
  - Hit the assertion-count targets in Req 8 AC #1 across the new test split (page + per-component)
  - Purpose: Integration coverage for the page-level orchestrator
  - _Leverage: existing mocks setup in current `page.test.tsx`, the three renderer test files for reference_
  - _Requirements: 1.6, 8.1, 8.4, 8.5, 8.6_

- [x] 33. Run full pre-push suite and resolve issues
  - File: none (verification step)
  - Run `pnpm lint`, `pnpm typecheck`, `pnpm test` from repo root
  - Fix any failures introduced by the redesign
  - Purpose: Satisfy Req 8 AC #4–6 (zero failures across lint/typecheck/test)
  - _Requirements: 8.4, 8.5, 8.6_
  - **Result**: All three pass. `pnpm lint` (6/6), `pnpm typecheck` (11/11), `pnpm test` (657: 656 passed, 1 skipped). The pre-existing `next lint` / ESLint v9 incompatibility was resolved by switching `apps/web/package.json` `lint` script from `next lint` to `eslint .` (the repo already has a working ESLint v9 flat config at the root via the dependency-audit rollout). Three small lint fixes landed alongside: dropped an unused `EvaluationResult` import in `cloze-exercise.test.tsx`, dropped two unused destructured props in `coach-rail.tsx` (`exerciseType`, `vocabActiveCount` — kept on the `CoachRailProps` interface for the future tracker slot per design.md), added `**/next-env.d.ts` to the root flat-config ignores. The `docs/tech-debt.md` entry should be marked resolved.
