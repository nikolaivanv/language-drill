# Requirements Document

## Introduction

Phase F redesigns the existing cloze, translation, and vocabulary recall exercise UIs at `/drill` to match the high-fidelity prototypes in `docs/design-archive/design_handoff_language_drill/prototypes/web/hifi/`. The current implementation (`apps/web/app/(dashboard)/drill/page.tsx`, ~560 lines) renders all three exercise types in a single column with raw Tailwind utilities, no coach persona, no progressive scaffolding, and uniform feedback. This phase replaces it with:

- A **two-pane layout** — 280px coach rail + main exercise area — with a 3px progress bar.
- A **coach persona** (avatar + contextual messages) embedded in the rail.
- **Type-it as the default input mode** for all three exercise types, with an explicitly-scaffolded multiple-choice toggle for cloze (clearly labelled as reducing the progress signal).
- **Progressive hints** for vocab recall (first letter → syllable count → example sentence) and an on-demand hint for translation.
- **Glossed source text** for translation (hoverable English vocabulary tooltips).
- **Verdict-tier feedback strips** (sage / yellow / terracotta) replacing the current generic ring badges, with diff-style corrections for translation and confusion notes for vocab.
- **Accent picker** integrated below text inputs for ES/DE/TR.

No backend or schema changes — same `GET /exercises`, `POST /exercises/:id/submit` endpoints; same `ExerciseContent` discriminated union and `EvaluationResult` shape from `packages/shared`. Coach messages and verdict tiers are derived client-side from the existing evaluation score and error fields. Hint usage is tracked in client state only for v1 (a future phase will plumb it into the progress signal server-side).

## Alignment with Product Vision

This phase is the most-visible expression of three differentiators in `product.md`:

- **Active production over passive recognition** — the type-it-first input affordance, with MC visibly demoted to scaffolding, makes the production-first thesis legible inside the UI itself rather than only in the data model.
- **Honest skill-based progress** — the verdict-tier strips ("spot on", "meaning is right · small issues", "gist is there · grammar drifted") communicate where the answer landed without resorting to XP, points, or streaks. Errors are surfaced with `EvaluationError.correction` + `explanation`, reinforcing the "AI tutor between italki sessions" pitch.
- **Polyglot-aware** — accent picker, gloss tooltips, and per-language coach messaging all parameterize on the active `LearningLanguage`, so the same UI degrades gracefully across ES, DE, and TR.

It also enforces the **no-gamification rule** from `CLAUDE.md`: no streaks, no XP, no completion counts surface anywhere in the redesigned exercise UI. The coach persona adds personality (per the `web-implementation-plan.md` adjustment table) without crossing into gamification.

## Requirements

### Requirement 1 — Split-pane drill layout

**User Story:** As a learner mid-session, I want a calm two-pane layout that keeps the exercise prompt and the coach's voice in my visual field at the same time, so that I'm reminded that mistakes get coached, not punished.

#### Acceptance Criteria

1. WHEN the user navigates to `/drill` and an exercise has loaded THEN the page SHALL render a 280px-wide left rail with `--color-paper-2` background and a `border-right` of `--color-rule`, plus a main content area filling the remaining width.
2. WHEN the page renders the main area THEN it SHALL display a 3px-tall progress bar pinned to the top of the main area in `--color-accent` for the filled portion and `--color-rule` for the unfilled portion.
3. WHEN the viewport is narrower than 900px THEN the layout SHALL collapse to a single column with the coach rail moved above the exercise area, preserving the coach card and progress bar but hiding the vocabulary/skill tracker.
4. IF the user has not yet selected a language or difficulty THEN the page SHALL render the existing language/difficulty selectors inside the main area without the coach rail visible.
5. WHEN the exercise data is still loading THEN the layout SHALL render the rail and main area frames immediately and show a `LoadingSkeleton` block in the main area only.
6. WHEN any state of the page is rendered (loading, ready, evaluated, error) THEN the page SHALL NOT display any streak count, XP value, day count, lesson-completion percentage, or "session N of M" counter — anywhere in the layout, including the coach rail, the progress bar, and the verdict shell.

### Requirement 2 — Coach rail with persona

**User Story:** As a learner, I want a steady coach figure who reacts to what I just did, so that I get the social signal of "someone's paying attention" without being nagged about streaks.

#### Acceptance Criteria

1. WHEN the coach rail renders THEN it SHALL display, top-to-bottom: a 48px black-background avatar circle with a Fraunces 'c' inside, a "coach" label in `.t-micro`, a "guiding this session" sub-label, and a coach message card.
2. WHEN no answer has been submitted yet for the current exercise THEN the coach message SHALL be a deterministic per-exercise-type prompt (e.g., cloze → "fill the blank · type it out", translation → "translate the meaning, not every word", vocab → "say it from memory").
3. WHEN an evaluation has been received THEN the coach message SHALL update to a verdict-tier-specific message derived client-side from `EvaluationResult.score` (≥0.95 → praise, 0.70–0.94 → light correction, 0.40–0.69 → encouragement + pointer, <0.40 → reframe + reset).
4. WHEN the coach message changes THEN it SHALL animate via a 150ms fade-in (no layout shift, no bounce, no emoji).
5. IF the layout is collapsed (viewport < 900px) THEN the rail SHALL render only the avatar row + coach card; the vocabulary tracker SHALL be hidden.
6. WHEN the rail is rendered THEN it SHALL NOT display any streak count, XP value, day count, or lesson-progress percentage.

### Requirement 3 — Cloze exercise: type-it default, MC as scaffolding

**User Story:** As an intermediate learner, I want to produce the missing word from memory by default, but have the option to fall back to multiple choice when I'm completely stuck, so that I get production practice when I can and recognition when I must.

#### Acceptance Criteria

1. WHEN a cloze exercise renders THEN the input mode SHALL default to "type it" — a single-line `Input` field plus an `AccentPicker` matched to the active `LearningLanguage`.
2. WHEN a cloze exercise renders AND `contentJson.options` is non-empty AND length ≥ 2 THEN a "Show options" toggle SHALL be visible labelled with the helper text "reduces progress signal".
3. WHEN the user activates the toggle THEN the type-it input SHALL hide and the options SHALL render as `Choice` pills in a flex-wrap row; selecting a pill SHALL stage that pill's value as the answer.
4. WHEN the user has activated the MC toggle for the current exercise THEN client state SHALL record `usedMc = true`; this flag is NOT sent to the API in v1 but is exposed on the verdict UI as a "scaffolded" sub-label.
5. WHEN the cloze sentence is displayed THEN the blank SHALL render as a `?` character inside a `border-bottom` span of width `--spacing-s-7`, inline with the rest of the sentence in `.t-display-s` (Fraunces).
6. IF `contentJson.context` is present THEN it SHALL render in `.t-small` muted text above the sentence.
7. WHEN the user submits an empty answer THEN the submit button SHALL remain disabled (no client-side error message); the existing 502/429 server error handling SHALL be preserved.

### Requirement 4 — Translation exercise: gloss + diff feedback

**User Story:** As a learner translating a sentence, I want to hover over unfamiliar English words to see a gloss, and after I submit I want to see exactly where my version diverged from the reference, so that I learn from the diff rather than just seeing a score.

#### Acceptance Criteria

1. WHEN a translation exercise renders THEN it SHALL display the following elements in vertical order: an "EN → {LANG}" eyebrow in `.t-micro`, the source text in `.t-display-s`, the user textarea, the `AccentPicker`, and the submit button.
2. WHEN the source text contains tokens that appear in the static gloss list at `apps/web/lib/translation/gloss-en.ts` (a v1 file shipped as part of this phase, keyed by lowercased lemma → `{ pos, gloss }`) THEN those tokens SHALL render with `border-bottom: 1px dotted var(--color-ink-mute)` and a CSS-only tooltip on hover/focus in a dark `var(--color-ink)` background with `var(--color-paper)` text. Tokens not in the list SHALL render as plain text.
3. WHEN the user clicks "show me a hint" THEN a per-exercise hint counter (client state, resetting whenever a new exercise loads) SHALL increment from 0 → 1 → 2 → 3 and the page SHALL reveal: at counter 1 the first glossed vocabulary entry from the source (lemma + gloss); at counter 2 the first ~half of `contentJson.referenceTranslation` (split on the nearest whitespace boundary to `Math.ceil(length/2)`); at counter 3 the full `contentJson.referenceTranslation`. WHEN the counter is ≥ 3 the hint button SHALL be hidden. IF no glossed token exists in the source THEN counter 1 SHALL skip to the half-reference reveal and the hint counter still increments.
4. WHEN an evaluation has been received THEN the verdict strip SHALL render one of four tiers: "spot on" (score ≥ 0.95), "meaning is right · small issues" (0.70–0.94), "gist is there · grammar drifted" (0.40–0.69), "not quite" (< 0.40), with the matching `--color-ok-soft` / `--color-hilite-soft` / `--color-accent-soft` background.
5. WHEN the verdict is displayed AND `EvaluationResult.errors` is non-empty THEN each error SHALL render as a row with `text` strikethrough in `--color-ink-mute`, an arrow `→`, and `correction` in `--color-ok` / `--color-accent` (sage if `severity === 'minor'`, terracotta if `'major'`); the `explanation` SHALL render below in `.t-small`.
6. WHEN the verdict is displayed THEN the reference translation from `contentJson.referenceTranslation` SHALL be visible in a "the version we coded" sub-card.

### Requirement 5 — Vocab recall: progressive hints + confusion notes

**User Story:** As a learner trying to retrieve a word from memory, I want hints that escalate from a tiny nudge to a full example, and after I miss I want to see what I might have confused the word with, so that I build durable recall.

#### Acceptance Criteria

1. WHEN a vocab recall exercise renders THEN it SHALL display, top-to-bottom: the definition (from `contentJson.prompt`) in a Card with `.t-display-s`, a single-line `Input` field auto-focused on mount, the `AccentPicker`, three sequential hint buttons, and the submit button.
2. WHEN the user clicks the level-1 hint button THEN it SHALL reveal the first letter of `contentJson.expectedWord` and disable. WHEN the user clicks the level-2 hint button THEN it SHALL reveal the character count of `expectedWord` as `{N} letters` (a deterministic, locale-agnostic substitute for syllable counting in v1; true syllabification deferred). WHEN the user clicks the level-3 hint button THEN it SHALL reveal `contentJson.exampleSentence` with case-insensitive whole-word occurrences of `expectedWord` masked as `___`. Each button SHALL disable after click and reveal in document order (L1 → L2 → L3).
3. WHEN any hint level is active THEN client state SHALL record `hintLevel: 0|1|2|3`; this value is NOT sent to the API in v1 but the verdict strip SHALL render a `hint level {N}` chip alongside the score when N > 0, in `--color-paper-3` background and `.t-micro` text.
4. WHEN the user submits AND `EvaluationResult.score === 1.0` THEN the verdict SHALL display "exact" in sage. WHEN `0.7 ≤ score < 1.0` AND `EvaluationResult.errors` contains an entry with `type: 'grammar'` THEN the verdict SHALL display "right word · wrong inflection" in yellow. WHEN `0.6 ≤ score < 1.0` AND no `'grammar'`-type error is present AND any error has `type: 'spelling'` THEN the verdict SHALL display "spelling slipped" in yellow. WHEN `0.6 ≤ score < 1.0` AND none of the above match THEN the verdict SHALL display "close" in yellow (fallback band). WHEN `score < 0.6` THEN the verdict SHALL display "wrong" in terracotta.
5. WHEN the verdict is displayed THEN the panel SHALL include the target word (from `contentJson.expectedWord`) in `.t-display-m`, the example sentence in `.t-body-l`, and a "common confusions" list parsed from `EvaluationResult.feedback` using the regex `/([\p{L}]+)(?:\s*\/\s*|\s+(?:vs\.?|or)\s+)([\p{L}]+)/gu` (slash separator allows optional whitespace; `vs`/`or` require whitespace on both sides to avoid matching substrings like "lover"). IF the regex yields zero matches THEN the confusions section SHALL be omitted entirely (no empty heading).
6. WHEN the page renders the rail for a vocab exercise THEN the vocabulary tracker SHALL be hidden silently in v1 — no placeholder, no zero state. (Rationale: no `GET /history` endpoint exists in `infra/lambda/src/routes/`; surfacing a count would require a new endpoint, which is out of scope for this UI-only phase. The slot remains in the layout so a future phase can drop in a count without re-laying-out the rail.)

### Requirement 6 — Verdict-tier feedback shared shell

**User Story:** As a learner, I want consistent, calm feedback containers across all three exercise types so that I don't have to re-read the layout each time, just the content.

#### Acceptance Criteria

1. WHEN any of the three exercise types receives an evaluation THEN the feedback shell SHALL render: a verdict header with tier name in `.t-display-s` plus tier-colored `Chip` for the score, a per-type body (errors / diff / confusions), and a footer with a single "next" `Button` (variant `accent`).
2. WHEN the verdict is rendered THEN it SHALL use ONE of the three soft-palette backgrounds: `--color-ok-soft` (sage), `--color-hilite-soft` (yellow), or `--color-accent-soft` (terracotta); no other background colors SHALL be used for verdict containers.
3. WHEN the user clicks "next" THEN the page SHALL clear the local answer + evaluation state and trigger the existing query invalidation in `useSubmitAnswer`'s `onSuccess` so that a fresh exercise is fetched.
4. IF the submission failed (network error, 502, 429 rate limit) THEN the existing inline error UI from `drill/page.tsx` SHALL be preserved with the new design tokens applied (no functional change, only restyling).
5. WHEN the user submits an answer THEN the input area SHALL remain visible (read-only, with the user's answer dimmed via `opacity: 0.6`) ABOVE the verdict strip — replacing the current behavior where the input disappears entirely after submission.
6. WHEN the cloze verdict is displayed AND `usedMc === true` for the current exercise THEN a `scaffolded` chip SHALL render alongside the score chip in `--color-paper-3` background and `.t-micro` text, with `aria-label="answered using multiple-choice scaffolding"`.

### Requirement 7 — Accent picker integration

**User Story:** As a learner typing in ES, DE, or TR, I want to insert accented characters via clickable chips below the input, so that I can practice without configuring my keyboard.

#### Acceptance Criteria

1. WHEN any of the three exercise types renders a text input AND the active `LearningLanguage` is `ES`, `DE`, or `TR` THEN an `AccentPicker` SHALL be visible directly below the input, bound to the input's ref via the existing `targetRef` prop.
2. WHEN the user clicks an accent chip THEN the character SHALL be inserted at the input's current selection position and React's `onChange` SHALL fire (via the native value setter that the existing `AccentPicker` already uses).
3. WHEN the active language is anything else (currently no other learning languages exist, but the type allows extension) THEN the accent picker SHALL be hidden — no empty bar.
4. WHEN the input is disabled (during evaluation, after submission) THEN the accent picker SHALL also be disabled (chips non-interactive, opacity reduced to 0.5).

### Requirement 8 — Test coverage parity with current page

**User Story:** As a developer maintaining the drill page, I want the redesigned components to have at least the same test surface as the current 555-line `page.test.tsx`, so that the redesign doesn't regress functionality I depended on.

#### Acceptance Criteria

1. WHEN the redesign is complete THEN the new test suite SHALL contain at least the following assertion counts, mirroring the current `apps/web/app/(dashboard)/drill/page.test.tsx`: ≥ 5 rendering tests (page title, language/difficulty selectors, loading skeleton, no-exercises state, generic error state); ≥ 4 per-exercise-type rendering tests (cloze, translation, vocab — one each, plus one for type/language/difficulty badges); ≥ 4 answer-submission tests (textarea+button render, disabled-when-empty, mutation called with correct payload, loading state); ≥ 2 error-handling tests (429 rate limit, generic error); ≥ 4 evaluation-display tests (score badge, breakdown, error list, "next" clears state); ≥ 3 score-styling tests (≥ 70%, 40–69%, < 40% color tiers).
2. WHEN new components are introduced (`CoachRail`, `ProgressBar`, `ClozeExercise`, `TranslationExercise`, `VocabExercise`, `FeedbackShell`, `GlossedText`, `HintRow`) THEN each SHALL have its own component-level test file with at least: a render-with-default-props assertion, a render-with-each-variant-prop assertion, and one user-interaction assertion.
3. WHEN any of the three exercise components renders for each `LearningLanguage` (`ES`, `DE`, `TR`) THEN at least one test per component SHALL parameterize across all three languages and assert the `AccentPicker` chips for that language are present.
4. WHEN the test suite runs THEN `pnpm --filter @language-drill/web test` SHALL pass with zero failures.
5. WHEN `pnpm typecheck` runs from the repo root THEN it SHALL pass with zero errors across all packages.
6. WHEN `pnpm lint` runs from the repo root THEN it SHALL pass with zero errors.

## Non-Functional Requirements

### Performance
- The split layout SHALL render its frame in the same first paint as the rest of the dashboard shell — no waterfalled fetches for layout-only data.
- Coach messages and verdict tiers SHALL be derived client-side from existing data (`EvaluationResult.score`, `errors`, `contentJson`); no extra round-trips to the API.
- Hover gloss tooltips SHALL render via CSS-only transitions (no JS hover listeners, no portal).

### Security
- No new user content is sent to the API — submission body remains `{ answer: string }`.
- No new endpoints are added; existing Clerk-JWT auth and rate-limiting flow is unchanged.
- Hint usage and MC toggle state are local React state only — no localStorage, no analytics events in v1.

### Reliability
- IF `EvaluationResult.errors` is malformed (missing fields) THEN the diff renderer SHALL skip the malformed row rather than crashing the verdict shell.
- IF `contentJson.options` is `undefined` for a cloze THEN the MC toggle SHALL be hidden (already covered in Req 3.2).
- IF `contentJson.exampleSentence` is empty for a vocab exercise THEN the level-3 hint button SHALL be hidden, NOT disabled-with-empty-content.

### Usability
- All interactive elements SHALL have accessible names (`aria-label` for icon-only buttons, `aria-describedby` linking inputs to helper text).
- The hint buttons SHALL be keyboard-reachable in document order (level 1 → 2 → 3) and SHALL announce their state via `aria-pressed`.
- Color SHALL not be the sole indicator of verdict tier — every tier SHALL also include a text label in `.t-display-s`.
- Focus SHALL move to the input field automatically when a new exercise loads (replacing the current behavior where focus is left on the previous "next" button).
