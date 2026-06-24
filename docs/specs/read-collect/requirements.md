# Requirements Document

## Introduction

Phase J — **Read & Collect** — adds a parallel entry point to the app that bridges the user's external reading material to the drill pipeline. The user pastes a passage (≤ 2,000 chars) from anything they're reading; Claude flags words above their estimated CEFR level; the user picks which to learn; saved words are persisted to a per-user word bank tagged `source = 'reading'`.

The full design is in `docs/design-archive/design_handoff_language_drill/SCREENS.md §8` and the prototype in `docs/design-archive/design_handoff_language_drill/prototypes/web/hifi/read.jsx`. The page lives at `/read` and is reachable from the left-nav `read` item and the dashboard `ReadCollectCard` (added in Phase D, currently links to a placeholder page).

The screen has four views, switched by top-bar buttons:

- `empty` — first-launch landing with hero copy + "how it works" card
- `pasting` — title + passage textarea with char counter and validation
- `annotated` — two-column reader (text pane + sticky 280-px word bank rail) with subtle/assertive highlight intensity toggle, click-anchored word popover, save flow + toast
- `history` — list of past entries; clicking opens it in the annotated view

This spec deliberately scopes **drill weaving** (saved words appearing inside cloze / translation / vocab_recall items tagged "from your reading") **out of v1**. The exercise pre-generation pipeline is not yet built, and per-user-vocabulary→exercise generation is the right home for that work. v1 persists saved words in a `user_vocabulary` table tagged `source = 'reading'` so the data is ready when the drill weaving phase lands; no current drill code reads from that table yet.

Audio narration of pasted text and translation-of-the-passage features are also out of scope — this is a reading capture screen, not a reader.

**Phase dependencies:** Phase A (design system), Phase B (app shell + `/read` route placeholder + left-nav item), Phase D (dashboard's `ReadCollectCard`). All three are complete and merged; this spec replaces the placeholder content at `apps/web/app/(dashboard)/read/page.tsx` and reuses the existing card unchanged.

## Alignment with Product Vision

- **Active production over passive consumption** (`product.md` §2.1): Reading capture is not a passive activity in our framing — it converts the user's outside reading (already a passive input channel) into _active_ items that come back as production drills. The user does not just look up a word; they save it for production practice.
- **Honest skill-based progress** (`product.md` §2.2): No streaks, no XP, no "you saved N words this week" gamification. The CEFR calibration ("~B1+ calibration") is shown openly so the user understands why a word is flagged.
- **Polyglot / per-language scope** (`product.md` §2.3): Every read entry is keyed by `(userId, language)`. Switching the active language switches the visible history and changes the calibration band used for new annotations.
- **Phase plan** (`tech.md` §14): Sits in Phase 1 / 3 — accelerates "Layer 3 — Reading integration" from `docs/exercise-strategy.md` (originally a Phase 3+ feature) into the first user-visible release. The design lift is modest, the user value is high, and the data this screen captures is the foundation for future personal-word-bank exercises.

## Requirements

### Requirement 1 — Routing and entry

**User Story:** As a learner, I want a top-level "read" destination reachable from the left nav and the dashboard card, so that I can capture a passage without leaving the app.

#### Acceptance Criteria

1. WHEN the user clicks the left-nav "read" item, THEN the router SHALL navigate to `/read`.
2. WHEN the user clicks the dashboard `ReadCollectCard` "open reader →" button, THEN the router SHALL navigate to `/read`.
3. WHEN the user navigates to `/read` AND the user has zero `read_entries` rows for the active language, THEN the page SHALL render the `empty` view.
4. WHEN the user navigates to `/read` AND the user has ≥ 1 `read_entries` rows for the active language, THEN the page SHALL render the `annotated` view scoped to the most-recently-pasted entry.
5. WHEN the user is unauthenticated, THEN the page SHALL redirect to the existing sign-in route (the same auth gate as `/drill`); no API calls SHALL be made server-side without a JWT.
6. WHEN the user changes the active language via the left-rail `LanguageSwitcher`, THEN the `/read` page SHALL re-fetch the entry list and the most-recent entry MUST belong to the new active language; entries from the previous language SHALL NOT be visible.
7. The page route SHALL replace the existing placeholder at `apps/web/app/(dashboard)/read/page.tsx` (the current "coming soon" Card). The dashboard `ReadCollectCard` component (already present) SHALL remain unchanged — its `href="/read"` already points at this page.

### Requirement 2 — Top bar and view switching

**User Story:** As a learner on the read screen, I want a single header with three buttons that lets me switch between the current passage, history, and pasting a new text, so that I always know where I am.

#### Acceptance Criteria

1. WHEN any view is rendered, THEN a top bar SHALL render with a left side ("reading" eyebrow + "read & collect" `t-display-m` title) and a right side with three buttons in this order: "current text", "history" (with a `t-mono` count badge), "+ paste new".
2. WHEN the user clicks "current text", THEN the active view SHALL become `annotated` for the most-recent entry of the active language; if no entries exist, the view SHALL become `empty`.
3. WHEN the user clicks "history", THEN the active view SHALL become `history`.
4. WHEN the user clicks "+ paste new", THEN the active view SHALL become `pasting` with cleared title and passage fields.
5. The active button SHALL be styled with the `primary` variant; inactive buttons SHALL use the default ghost variant — matches the prototype.
6. The bottom of the top bar SHALL render a 1-px `--rule` border, matching the prototype.
7. View state SHALL be local to the page (React state) and SHALL NOT be reflected in the URL in v1; reloading the page SHALL re-resolve the default view per Requirement 1.3 / 1.4.

### Requirement 3 — Empty view

**User Story:** As a first-time read user, I want to understand what this screen does before pasting, so that I can decide whether it's useful for me.

#### Acceptance Criteria

1. WHEN the `empty` view renders, THEN it SHALL show a centered column (max-width 640px, top margin 60px) with a Caveat eyebrow ("read in the wild"), a `t-display-l` title ("paste anything you're reading."), a `t-body-l` body paragraph, and a primary CTA "paste a text →".
2. WHEN the user clicks the "paste a text →" CTA, THEN the active view SHALL become `pasting`.
3. The empty view SHALL include a "how it works" card below the CTA: dashed `--rule` border, paper-2 background, `t-micro` heading, and a 4-step ordered list. Step copy SHALL match the prototype:
   1. paste a paragraph (≤ 2,000 chars).
   2. i highlight words rarer than your current band (~&lt;CEFR&gt;+).
   3. tap a word to see meaning + an example. tap "save" to add to your bank.
   4. saved words show up in cloze, vocab recall, and translation drills, tagged "from your reading."
4. WHEN the active language has no `userLanguageProfiles` row (proficiency unknown), THEN step 2 SHALL fall back to the literal "your current band" without a CEFR token; the user-visible CEFR token (`B1`, `A2`, …) SHALL come from the profile when present.

### Requirement 4 — Pasting view

**User Story:** As a learner with a passage in mind, I want to paste it with an optional title and a clear character limit, so that I know my input is acceptable before I press annotate.

#### Acceptance Criteria

1. WHEN the `pasting` view renders, THEN it SHALL show, in this order: a `t-micro` eyebrow ("new text"), a `t-display-m` title ("paste a passage"), a single-line "title or source" input (label + `(optional)` mute), a "passage" textarea (min-height 240px, Fraunces 16px / 1.6 line-height — treated as reading text), a row containing a left-aligned char counter ("N / 2,000" with `t-mono`) and a right-aligned action pair ("cancel" ghost, "annotate →" primary), and a paper-2 tip strip below the action row.
2. WHEN the textarea is empty (`text.trim().length === 0`), THEN "annotate →" SHALL be disabled (40% opacity, no pointer events).
3. WHEN the textarea exceeds 2,000 characters, THEN the char counter SHALL flip to `--accent` color and append " · too long", and the "annotate →" button SHALL be disabled.
4. WHEN the textarea contains only whitespace, THEN "annotate →" SHALL be disabled.
5. WHEN the user clicks "cancel", THEN the active view SHALL become `annotated` if at least one entry exists for the active language, otherwise `empty`.
6. WHEN the user clicks "annotate →" AND the input is valid, THEN the page SHALL POST to the annotation endpoint (Requirement 5) with the passage, the optional title, and the active language; while waiting, the action button SHALL show a `loading` state ("annotating…" label, button disabled). Cancel SHALL also be disabled while loading.
7. The 2,000-character limit SHALL be enforced client-side (counter + disabled CTA) AND server-side (Requirement 5.5). Both sides SHALL consume `READ_TEXT_MAX_CHARS = 2000` exported from `packages/shared/src/read.ts`.
8. The pasting view input fields SHALL be uncontrolled-by-URL (state lives in React); navigating away and back SHALL reset the form. (No "draft restore" feature in v1.)
9. The tip strip below the action row SHALL be reworded from the prototype to match v1 reality: a Caveat "tip" plus `t-small` text "your text is stored only in your account — never shared with other users." The prototype's "locally first" wording is dropped because v1 calls Claude server-side; keeping the false claim in shipping UI is unacceptable. The other half of the prototype copy ("the text is stored only in your account. nothing is shared.") is preserved verbatim.

### Requirement 5 — Annotation endpoint

**User Story:** As the read page, I want a single Lambda endpoint that flags above-level words and returns structured definitions, so that the client renders one consistent annotated view.

#### Acceptance Criteria

1. WHEN the client POSTs to `POST /read/annotate` with a Clerk JWT, a body `{ text: string, language: 'ES' | 'DE' | 'TR' }`, and the user's most-recent `userLanguageProfiles.proficiencyLevel` looked up server-side from `userId + language`, THEN the server SHALL respond with `{ flagged: Record<MatchedForm, WordFlag>, calibration: { cefr: CefrLevel, top: number } }`.
2. The `WordFlag` shape SHALL be `{ lemma: string, pos: string, gloss: string, example: string, freq: number, cefr: CefrLevel }` exactly matching the prototype's `WordFlag` type. `MatchedForm` is the lowercased exact surface form found in the text.
3. WHEN the server calls Claude, THEN the system prompt SHALL be marked `cache_control: { type: 'ephemeral' }` so subsequent annotations on the same Lambda warm path benefit from prompt caching (matches the existing `evaluateAnswer` pattern).
4. WHEN the language is `EN`, THEN the server SHALL respond HTTP 400 with `{ error, code: 'UNSUPPORTED_LANGUAGE' }`. EN is source-only (mirrors `LearningLanguageEnum` in the api-client).
5. WHEN the request body's `text` length exceeds 2,000 characters or is empty after trim, THEN the server SHALL respond HTTP 400 with `{ error, code: 'VALIDATION_ERROR', details }`.
6. WHEN the user has hit the daily AI usage limit, THEN the server SHALL respond HTTP 429 with `{ error, code: 'RATE_LIMIT_EXCEEDED' }` and SHALL NOT call Claude. The limit is **shared** with the existing exercise-evaluation cap: the rate-limit query SHALL count rows where `eventType IN ('ai_evaluation', 'read_annotation')` against the same `DAILY_EVAL_LIMIT = 50` constant used in `routes/exercises.ts`. Each successful annotation SHALL insert ONE `usage_events` row with `eventType: 'read_annotation'`, regardless of how many words are flagged.
7. WHEN the Claude call fails or returns malformed structured output, THEN the server SHALL respond HTTP 502 with `{ error, code: 'AI_UNAVAILABLE' }` and SHALL NOT increment the usage counter.
8. WHEN the user's `userLanguageProfiles` row is missing for `(userId, language)`, THEN the server SHALL fall back to `CefrLevel.B1` for calibration purposes (matches the `DEFAULT_PROFICIENCY_LEVEL` in `routes/sessions.ts`).
9. The annotation endpoint SHALL NOT write a `read_entries` row — annotation is read-only with respect to entry storage. Persistence happens only on the explicit save (Requirement 8).
10. WHEN the response includes `calibration.top`, THEN it SHALL be a static integer derived from the user's CEFR level (`A1 → 750`, `A2 → 1500`, `B1 → 3000`, `B2 → 5000`, `C1 → 8000`, `C2 → 12000`). The mapping SHALL be exported as `READ_CEFR_TOP_RANK: Record<CefrLevel, number>` from `packages/shared/src/read.ts`; both client and server SHALL consume that constant.

### Requirement 6 — Annotated view

**User Story:** As a learner with a freshly-annotated passage, I want a clean two-column layout that lets me read the text and pick which flagged words to save, so that the screen does both jobs without crowding either.

#### Acceptance Criteria

1. WHEN the `annotated` view renders, THEN the layout SHALL be a CSS grid with two columns: `minmax(0, 1fr) 280px`, gap `s-6` (32px), `align-items: start`, matching the prototype.
2. The left column SHALL contain, top-to-bottom: a header row (title `t-display-m` + source `t-small` on the left; a `highlight` micro-eyebrow + a 2-option pill toggle "subtle / assertive" on the right), a calibration strip (chip "~&lt;CEFR&gt;+ calibration" + `t-small` explanation + a ghost "adjust" button), the rendered text in Fraunces 19px / 1.75 line-height, and a footer summary row (paper-2 fill, mono "N flagged · N saved · N skipped" + ghost "clear bank" + primary "save N to bank →").
3. The right column SHALL be a sticky `aside` (top: 24px, max-height `calc(100vh - 80px)`) containing a header row (`t-display-s` "word bank" + `t-mono` count), a `t-small` subtitle ("marked from this passage"), an empty-state dashed message OR a vertical list of paper-2 rows (lemma + gloss + CEFR badge + "×" remove button), and a footer note explaining that saved words appear in drills tagged "from your reading" (the chip is rendered inline).
4. WHEN the user clicks the "subtle" pill, THEN every flagged word SHALL render with the `subtle` style (dotted underline in `--accent`, 1.5px thickness, 4px underline-offset). WHEN the user clicks "assertive", THEN every flagged word SHALL render with the `assertive` style (amber wash gradient via `linear-gradient`, 1px horizontal padding). Switching toggles re-applies a CSS class — no re-render of the text DOM is required.
5. WHEN a flagged word is in the user's local bank state, THEN it SHALL render with the `saved` modifier on top of the current intensity: in subtle mode → 2px solid `--accent` underline + `--accent-2` color + 500 weight; in assertive mode → flat `--accent-soft` pill + 1px outer halo + `--accent-2` color + 500 weight.
6. WHEN a flagged word is the active popover anchor, THEN it SHALL render with the `active` modifier (filled `--ink` background, `--paper` text, 3px radius, 0 3px padding, no underline) overriding all other styles.
7. WHEN the user clicks anywhere outside a `.rd-word` or `.rd-popover`, THEN the active popover SHALL dismiss.
8. The default highlight intensity SHALL be `subtle` (matches the prototype).
9. WHEN annotation returns zero flagged words for a passage, THEN the layout SHALL hide the word-bank rail and replace the footer summary row with a sage `--ok-soft` strip "this passage is well within your level — nice." plus a ghost CTA "paste something harder?" that switches to the `pasting` view. Matches `SCREENS.md §8 — Annotation done, no flagged words` state.
10. The text SHALL be rendered using token-based string splitting on whitespace and a Unicode punctuation class equivalent to `\p{P}` (covers ES `¿¡`, DE `„ " « »`, TR `… ; ` and standard ASCII punctuation), with each non-whitespace, non-punctuation token compared (lowercased + punctuation-stripped) against the `flagged` map. Matching tokens SHALL render as `<button class="rd-word ${intensity} ${saved?}">{token}</button>` — extends the prototype renderer in `read.jsx:175–198` (which only handles the ES set).
11. The "adjust" button on the calibration strip SHALL be a no-op visual element in v1; clicking it SHALL produce no UI change. (Documented as deferred per `SCREENS.md §8 — Calibration logic`.)

### Requirement 7 — Word card popover

**User Story:** As a learner clicking a flagged word, I want a compact popover with the meaning and a save button, so that I can decide whether to add it to my bank without leaving the passage.

#### Acceptance Criteria

1. WHEN the user clicks a `.rd-word` button, THEN a popover SHALL render anchored to the click coordinates: 320px wide, `--card` background, 1px `--ink` border, `--shadow-3`, fade-in 180ms.
2. The popover's `x` SHALL be clamped horizontally to keep the card on screen (matches `read.jsx:323` — `Math.max(8, Math.min(x - W / 2, containerWidth - W))`); `y` SHALL be 6px below the bottom of the word.
3. The popover SHALL contain, top-to-bottom: a pointer triangle aligned to the word's center; a header section (lemma `Fraunces 22px` 500 + POS `t-small` italic + CEFR mono badge right-aligned, then a gloss `t-body` row below); a 1-px `--rule` divider; a body section (`t-micro` "example" + Fraunces 15px example sentence); a 1-px `--rule` divider; and a footer (paper-2 fill, mono "freq #N" + ghost "skip" + primary "+ save to bank" / accent "✓ saved · undo"). Matches `read.jsx:338–361` and `SCREENS.md §8 — Word card popover`.
4. WHEN the word is already in the local bank, THEN the right footer button SHALL show "✓ saved · undo" with the `accent` variant; clicking it SHALL remove the word from the local bank.
5. WHEN the word is not in the local bank, THEN the right footer button SHALL show "+ save to bank" with the `primary` variant; clicking it SHALL add the word to the local bank.
6. WHEN the user clicks "skip", THEN the popover SHALL dismiss without changing bank state.
7. The popover SHALL stop click event propagation so a click inside it does not trigger the outside-click dismissal in Requirement 6.7.

### Requirement 8 — Save flow

**User Story:** As a learner who has marked the words I want, I want one explicit "save N to bank" action that persists the entry server-side and tells me what happens next, so that I never lose the marks I've made.

#### Acceptance Criteria

1. WHEN the user clicks "save N to bank →" with `bank.length >= 1` AND the entry is not yet persisted, THEN the page SHALL POST to `POST /read/entries` with the body shape:
   - `language: 'ES' | 'DE' | 'TR'`
   - `title: string` — empty string if not provided; max 120 chars
   - `source: string` — empty string if not provided; max 200 chars
   - `text: string` — `1..READ_TEXT_MAX_CHARS` chars after trim
   - `flagged: Record<string, WordFlag>` — same shape as Requirement 5.2
   - `bank: string[]` — every entry MUST be a key of `flagged` (server SHALL re-validate per Requirement 9.2 semantics)
   
   The server SHALL re-validate `text.length <= READ_TEXT_MAX_CHARS`, `every(bank, b => b in flagged)`, and the `WordFlag` shape via Zod before any DB write; on failure return HTTP 400 `VALIDATION_ERROR`. While the request is in-flight, the button SHALL be disabled with a `loading` state.
2. WHEN the save succeeds, THEN the server SHALL respond HTTP 201 with `{ id, pastedAt }` and the page SHALL render a save toast: fixed bottom-center, 80px from bottom, max-width 540px, `--ink` background, `--paper` text, sage circle ✓ icon, body "**N words added** to your bank.\nyour next session will weave them in.", an outlined "see next session" button (routes to `/drill` in v1), and a "×" dismiss.
3. The save toast SHALL auto-dismiss after 4,000 ms; the user MAY also dismiss it manually with the "×" button.
4. WHEN the save fails (network error or HTTP 5xx), THEN the page SHALL keep the local bank state intact and surface a small inline error chip near the footer summary row: "couldn't save — try again". The button SHALL re-enable.
5. WHEN the save succeeds, THEN the local `bank` state SHALL persist (the user is not redirected); subsequent toggles SHALL be allowed but SHALL NOT re-fire `POST /read/entries` for the already-saved entry — instead they SHALL fire `PUT /read/entries/:id/bank` (Requirement 9).
6. WHEN the user clicks "see next session" inside the toast, THEN the router SHALL `push('/drill')`. (The "weave them in" copy is aspirational; the drill weaving lands in a later phase per Introduction. The button always navigates to `/drill` regardless.)
7. WHEN the user clicks "clear bank" in the footer summary row AND there is no saved entry yet, THEN the local `bank` array SHALL be reset to `[]` without any network call.
8. WHEN the user clicks "clear bank" AND there IS a saved entry, THEN the page SHALL fire `PUT /read/entries/:id/bank` with `bank: []`; on success the local state SHALL update; on failure the prior bank state SHALL be restored.

### Requirement 9 — Bank update endpoint (post-save edits)

**User Story:** As a learner who has saved an entry but later wants to edit my saved words, I want the toggle in the popover and the "×" in the rail to update the server, so that the bank stays in sync without re-saving the whole entry.

#### Acceptance Criteria

1. WHEN the user toggles a word in the popover OR removes a word via the rail's "×" button, THEN — IF the entry is already persisted — the page SHALL fire `PUT /read/entries/:id/bank` with the new full `bank: string[]` (replace semantics, not delta).
2. The server SHALL validate that every entry in `bank` is a key in the entry's `flaggedWords` map; unknown keys SHALL be rejected with HTTP 400 `{ error, code: 'UNKNOWN_FLAGGED_WORD' }` and no DB write.
3. The server SHALL upsert into `user_vocabulary` for each newly-added bank word: `(userId, language, word=matchedForm, lemma, source='reading', sourceReadEntryId=entry.id, exampleSentence=flag.example, cefrBand=flag.cefr, frequencyRank=flag.freq, addedAt=now)`. Words removed from the bank SHALL **NOT** delete `user_vocabulary` rows in v1 — once added to the personal bank, words remain there even if removed from the read entry; this avoids losing review history when a user un-saves a word from one source. (Documented; if this proves wrong in practice, revisit.)

   The `read_entries.bank` UPDATE and the `user_vocabulary` upserts SHALL run in a single transaction. If the bulk vocab upsert fails for any row, the transaction SHALL roll back so the bank column and the vocabulary rows can never drift. Same atomicity rule applies to `POST /read/entries` (insert entry + initial bulk upsert).
4. WHEN the user owns the entry, THEN the response SHALL be HTTP 200 `{ id, bank }`.
5. WHEN the user does NOT own the entry, THEN the server SHALL respond HTTP 404 `{ error, code: 'ENTRY_NOT_FOUND' }` (not 403 — same anti-leak pattern as `GET /sessions/:id/debrief`).
6. The endpoint SHALL be optimistic-update-friendly: the page SHALL apply the local state change before the request, and roll back on failure.

### Requirement 10 — Entry list and read endpoints

**User Story:** As a learner with several past entries, I want to see them in a clean history list scoped to the active language, so that I can revisit a passage I read last week.

#### Acceptance Criteria

1. WHEN the client GETs `GET /read/entries?language=<ES|DE|TR>`, THEN the server SHALL respond with `{ entries: ReadEntrySummary[] }` ordered by `pasted_at DESC, id DESC` (`id` as a stable tiebreak when two rows share a millisecond), capped at the **50 most recent** entries (no pagination cursor in v1; older rows are excluded from the response). Each summary SHALL contain `{ id, title, source, preview, flaggedCount, savedCount, pastedAt }` where `preview` is the first 120 characters of the text (server-truncated).
2. WHEN the client GETs `GET /read/entries/:id`, THEN — IF the user owns the entry — the server SHALL respond with the full entry: `{ id, language, title, source, text, flaggedWords, bank, pastedAt }`. Otherwise 404 `ENTRY_NOT_FOUND`.
3. WHEN the `history` view is rendered, THEN it SHALL show a `t-micro` "your reading" eyebrow + `t-display-m` "past texts" title, then a vertical stack of cards (max-width 800px) — one per entry — matching the prototype: title (Fraunces 18px 500) + source line + Fraunces-italic preview, plus right-aligned mono "N flagged" and an `ok` chip "N saved".
4. WHEN the user clicks a history card, THEN the page SHALL load that entry via `GET /read/entries/:id` AND switch to the `annotated` view scoped to it. Loading SHALL render the annotated skeleton (Requirement 11.1).
5. WHEN the entry list is empty for the active language, THEN the `history` view SHALL render an empty placeholder: `t-small` "no past texts yet — paste one to start." plus a primary CTA "+ paste new" routing to the `pasting` view.
6. The history count badge in the top-bar "history" button SHALL reflect `entries.length` (the same query result), updated when an entry is saved.

### Requirement 11 — Loading and error states

**User Story:** As a learner on slow or flaky network, I want clear loading and error states so that I never see a blank screen or get stuck.

#### Acceptance Criteria

1. WHEN the page is rendering an `annotated` view that is awaiting the annotation endpoint, THEN it SHALL render a skeleton: the title + source row in their final position, a `chip` "annotating…" near the title, and the text rendered with shimmer-tinted random `--paper-3` / `--paper-2` blocks at word positions. Matches `SCREENS.md §8 — Annotation rendering` state.
2. WHEN the annotation endpoint returns a 4xx response, THEN the page SHALL render a paper-2 inline error card in the reader pane: heading "couldn't annotate this", body containing the human-readable error from the server (`error` field), and two ghost buttons: "edit text" (back to `pasting` with the prior text preserved) and "try again" (re-fires the annotation request). The word bank rail SHALL be hidden in this state.
3. WHEN the annotation endpoint returns a 5xx response, THEN the same error card SHALL render with body "evaluation temporarily unavailable — try again in a moment."
4. WHEN the annotation endpoint returns 429 (rate-limited), THEN the error card body SHALL read "you've hit today's evaluation limit (50). it resets daily." and the "try again" button SHALL be disabled.
5. WHEN the entry list endpoint fails, THEN the `history` view SHALL render a single inline error card with a "retry" button; the top-bar "history" count badge SHALL show "—".
6. WHEN the bank-update endpoint fails, THEN the prior local state SHALL be restored and a small accent toast SHALL surface: "couldn't update — try again" (auto-dismiss 3,000 ms).
7. The save toast (Requirement 8.2) SHALL be the only fixed-position element on the page; loading skeletons and error cards SHALL flow inline with the layout.

### Requirement 12 — Persistence and data model

**User Story:** As an engineer, I want the persistence model to support both v1 (entries + bank) and the future drill-weaving phase (per-user vocabulary), so that we don't migrate twice.

#### Acceptance Criteria

1. The `read_entries` table SHALL include the columns: `id uuid pk`, `user_id text fk users.id`, `language text`, `title text`, `source text`, `text text`, `flagged_words jsonb` (`Record<MatchedForm, WordFlag>`), `bank jsonb` (`string[]`), `pasted_at timestamptz default now() not null`.
2. The `user_id` and `language` columns together SHALL have an index `(user_id, language, pasted_at DESC)` to support the entry-list endpoint without a sequential scan.
3. The `user_vocabulary` table SHALL be created with columns: `id uuid pk`, `user_id text fk users.id ON DELETE CASCADE`, `language text`, `word text` (matched form), `lemma text`, `source text` (`'reading' | 'exercise'` — only `'reading'` populated in v1), `source_read_entry_id uuid fk read_entries.id ON DELETE SET NULL`, `pos text`, `gloss text`, `example_sentence text`, `frequency_rank integer`, `cefr_band text`, `added_at timestamptz default now() not null`. A unique constraint SHALL exist on `(user_id, language, word)` so re-adding the same word from a second passage updates the row instead of duplicating it (the second source replaces the first; the `source_read_entry_id` reflects the most recent provenance).
4. The Drizzle schema SHALL live at `packages/db/src/schema/read.ts` (new module), and BOTH new tables SHALL be re-exported from `packages/db/src/schema/index.ts`.
5. The migration SHALL be a single new SQL file at `packages/db/migrations/0004_*.sql` with no destructive operations on existing tables. (Forward-only migrations per `tech.md` §5.)
6. The `read_entries.text` column SHALL accept up to 2,000 characters; column type is `text` (no length cap at the column level — the limit is enforced at the API layer per Requirement 4.7 / 5.5).
7. `user_vocabulary.user_id` SHALL declare `ON DELETE CASCADE`. `read_entries.user_id` SHALL follow the existing pattern in `practice_sessions` — no explicit `ON DELETE` clause (default `NO ACTION`), since we do not delete users in v1. If user deletion is added in a later phase, both `read_entries.user_id` and `practice_sessions.user_id` will need a coordinated migration; that is out of scope here.

### Requirement 13 — Drill integration is deferred (data ready, UI not)

**User Story:** As a stakeholder reading the implementation plan, I want a clear statement of what Phase J does and does not deliver in terms of drills, so that the next phase has a clean handoff.

#### Acceptance Criteria

1. v1 of Phase J SHALL persist saved words into `user_vocabulary` with `source = 'reading'`, indexed by `(user_id, language, word)`.
2. v1 of Phase J SHALL NOT modify the `exercises` table, the today-plan endpoint (`GET /sessions/today`), the create-session endpoint (`POST /sessions`), the submit endpoint (`POST /exercises/:id/submit`), or the drill UI components.
3. The "from your reading" chip SHALL render only inside the read screen (the rail footer copy and inside the save toast). It SHALL NOT appear inside any drill UI in v1; that ships when the drill-weaving phase lands.
4. The save toast's "see next session" button SHALL navigate to `/drill` but SHALL NOT trigger any change in how `/drill` selects exercises — the toast copy is a forward-looking promise; the implementation lands later.

### Requirement 14 — Accessibility and keyboard

**User Story:** As a keyboard-only or screen-reader user, I want the read screen to be navigable without a mouse, so that I can capture passages just like a sighted-mouse user.

#### Acceptance Criteria

1. The intensity toggle SHALL be a keyboard-navigable group: `Tab` moves focus to the toggle; `ArrowLeft` / `ArrowRight` SHALL move between "subtle" and "assertive"; `Enter` or `Space` SHALL select the focused option. WAI-ARIA `role="radiogroup"` with two `role="radio"` children.
2. Each `.rd-word` button SHALL be focusable in document order; pressing `Enter` or `Space` SHALL open the popover at the word's bounding rect (same behavior as a click).
3. WHEN a popover opens via keyboard, THEN focus SHALL move to the popover's first focusable element (the "skip" button); `Escape` SHALL dismiss the popover and return focus to the originating word.
4. The save toast SHALL have `role="status"` and `aria-live="polite"`; its content SHALL be readable by screen readers without being interrupted by other live regions.
5. The pasting view's char counter SHALL include `aria-live="polite"` so updates beyond 2,000 chars are announced.
6. The view-switcher buttons in the top bar SHALL use `aria-current="page"` on the active button.

### Requirement 15 — Localization of UI copy

**User Story:** As an app-design constraint, the read screen's UI copy SHALL match the site-wide design language so that the experience feels of a piece with the rest of the app.

#### Acceptance Criteria

1. All UI copy (eyebrows, headlines, body, button labels, toast text) SHALL be lowercase per the site convention (matches Phase F / G).
2. The Caveat-font handwritten accent SHALL appear on: the empty-view eyebrow ("read in the wild") and the pasting-view tip strip ("tip"). Body copy and button labels SHALL use Inter / Fraunces per the type scale.
3. The "from your reading" chip SHALL use the `accent` variant of `Chip` (matches the existing `ReadCollectCard`'s `new` chip style).

## Non-Functional Requirements

### Performance

- **Annotation latency budget:** end-to-end annotate (web → API Gateway → Lambda → Claude → response) SHALL target ≤ 4 seconds for a 2,000-character passage. The system prompt SHALL be cached with `cache_control: { type: 'ephemeral' }` so warm-Lambda annotations of similar passages benefit from prompt-cache savings.
- **Entry list:** `GET /read/entries` SHALL execute in ≤ 1 SQL round trip. The 50-row cap and ordering tiebreak are specified in Requirement 10.1.
- **Save:** `POST /read/entries` SHALL execute in ≤ 2 SQL round trips (insert entry; bulk upsert into `user_vocabulary` for the bank words via a single `INSERT ... ON CONFLICT` statement).
- **Bank update:** `PUT /read/entries/:id/bank` SHALL execute in ≤ 2 SQL round trips (update entry row; bulk upsert new words into `user_vocabulary`).

### Security

- All `/read/*` routes SHALL require a Clerk JWT. Unauthenticated requests SHALL return HTTP 401 (handled by the existing `authMiddleware`).
- `read_entries.text` is user-supplied content; it SHALL be validated as a string ≤ 2,000 chars and NOT executed, interpolated into SQL, or rendered as HTML. Display SHALL be done via React text nodes (no `dangerouslySetInnerHTML`).
- The annotation endpoint SHALL NOT log the user's pasted text in plaintext to CloudWatch beyond what the standard request logger already captures; specifically, error logs SHALL omit the body text. (Matches the existing pattern of not logging request bodies.)
- The Claude-returned `flaggedWords` map SHALL be validated against a strict Zod schema before being stored or returned to the client; unknown fields SHALL be stripped.

### Reliability

- A failed annotation call SHALL NOT leave any partial database row. (Already enforced — annotation does not write to the DB.)
- A failed save (network or 5xx) SHALL leave the local UI state intact (Requirement 8.4); the user can retry.
- Migration `0004_*.sql` SHALL be forward-only (no destructive DDL on existing tables).

### Usability

- The read screen SHALL match the existing dashboard / drill / progress visual language: the `Card`, `Button`, `Chip`, `Input`, `Textarea` components from `apps/web/components/ui/` SHALL be reused; no new general-purpose UI primitives SHALL be introduced.
- The screen SHALL be primarily mouse + keyboard at 1024×768 minimum; mobile-responsive behavior is OUT OF SCOPE for v1 (this is a web-only phase; the mobile prototype lands when the Expo app is built).
- All error states SHALL surface a concrete next action (retry, edit text, paste new) — never a dead end.
