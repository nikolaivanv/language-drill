# Requirements Document

## Introduction

**Vocabulary Review (Part 2)** is the spaced-repetition practice surface that consumes
the saved deep cards produced by **Reading: Deep Annotation (Part 1)**. Where Part 1
captures a word in the exact sentence the learner met it in (`userVocabulary` + the
`card` jsonb snapshot), Part 2 turns those saved words into a recurring, production-first
review loop: every item is built from the learner's own saved sentence, scheduled by an
FSRS spaced-repetition engine, graded, and — critically — used as **evidence that moves
the learner's skill map**, not a streak counter.

This spec covers the **Phase 1 backbone**. In scope:

- An FSRS scheduling engine (`ts-fsrs`) with a new `vocabulary_review_state` table, one
  card per `(user, language, lemma)`, pooling the existing per-surface `userVocabulary`
  rows as **occurrences** (non-destructive — `userVocabulary` keeps its surface-form key).
- A per-language daily **queue builder** (due items + a capped new-item intake; languages
  are never blended).
- A **Review hub**, a one-item-at-a-time **session flow** across the locally-gradable item
  types (**cloze-in-context**, **meaning → production**, **recognition**), **local grading**
  that maps results onto an FSRS rating and updates card state, an **end-of-session summary**,
  and a **vocabulary bank / browse + word detail** surface.
- **Mastery movement**: review results emit graded **evidence** into the same progress
  aggregation the existing radar/grammar-map already read, so reviews visibly advance the
  learner's skill map and grammar points.
- Cross-feature hooks: a **"review the words from this passage"** entry from a `readEntry`,
  and a **distinct highlight** in Reading for words currently under review.

Explicitly **deferred to a Phase 2 spec** (noted here only as forward-compatibility seams):
the **"use it"** free-production item type and any other **Claude-graded / metered**
grading, **listening** (Polly) and **speaking** (Transcribe) item types, and **leech
rescue** intervention. The grading layer in this spec is built behind a single
`applyReview(card, rating)` seam so Claude-graded items can plug in later without reworking
the scheduler.

## Alignment with Product Vision

This feature is a direct expression of the two product laws in `product.md` / `CLAUDE.md`:

- **Production over recognition.** Every core item forces the learner to *produce* the
  word — type the correctly inflected form into its saved sentence, or recall the word from
  its meaning — rather than pick from choices. Recognition exists only as a warm-up for
  brand-new cards.
- **Mastery over streaks.** Progress is shown exclusively as **skill movement** (grammar
  points / competencies advancing) and **due-count burndown**. No streaks, XP, points, or
  lesson counts appear anywhere (per "What we never show").

It also reinforces three other stated pillars:

- **Polyglot-first**: queues are built per language and never blended, matching the
  multi-language-at-different-levels design.
- **CEFR as the single spine**: review evidence feeds the existing CEFR-mapped progress
  model rather than introducing a parallel scoring system.
- **Evidence-based, not time-based**: scheduling and mastery both derive from graded
  evidence, never from elapsed time or session counts.

Per `CLAUDE.md` the scheduler is **FSRS, not** the phase-plan's SM-2 (different state:
`stability` + `difficulty`, not ease factor) — a deliberate, already-agreed deviation that
this spec implements.

## Requirements

### Requirement 1 — FSRS scheduling engine & per-lemma review state

**User Story:** As a learner, I want each saved word scheduled by a proven spaced-repetition
algorithm, so that I review it exactly when I'm about to forget it and not before.

#### Acceptance Criteria

1. WHEN a saved word first enters the review system THEN the system SHALL create exactly one
   `vocabulary_review_state` row per `(user, language, lemma)` initialized to FSRS "new"
   state (`stability`, `difficulty`, `reps = 0`, `lapses = 0`, a `state` of `new`, and a
   `dueAt`).
2. WHEN the scheduler computes the next interval for a card THEN it SHALL use the `ts-fsrs`
   library's `stability` and `difficulty` model and SHALL NOT use an SM-2 ease factor.
3. WHEN a card is graded THEN the system SHALL map the grade onto an FSRS `Rating`
   (Again/Hard/Good/Easy = 1–4) and update the card's `stability`, `difficulty`, `reps`,
   `lapses`, `dueAt`, `lastReviewedAt`, and lifecycle `state`.
4. WHEN a locally-graded item is answered THEN the **default** mapping SHALL be correct →
   `Good`, incorrect → `Again`, EXCEPT where an item type defines a finer mapping (e.g. the
   hint-capped ratings in Requirement 6.3 or the "partial" outcome in Requirement 8.2).
5. WHEN a card's lapse count reaches the configured leech threshold (default: **3
   consecutive lapses**) THEN the system SHALL set its lifecycle `state` to `leech` (the
   rescue *intervention* UI is Phase 2; the state transition and surfacing are in scope
   here).
6. WHEN the grade→rating→state update is performed THEN it SHALL go through a single
   `applyReview(card, rating)` seam, so a future Claude-graded rating source can reuse the
   same scheduler without modification.
7. IF the `ts-fsrs` algorithm parameters need tuning THEN they SHALL be defined in one
   shared constant/module so they are swappable without touching call sites.

### Requirement 2 — Lemma-keyed review cards with pooled occurrences

**User Story:** As a learner, I want all the forms of a word I've saved (e.g. `evlerinden`,
`eve`, `evler`) treated as one card for the concept `ev`, so that I learn the *word* and get
tested on whichever form a session picks.

#### Acceptance Criteria

1. WHEN the review system reads saved vocabulary THEN it SHALL group `userVocabulary` rows by
   `(userId, language, lemma)` and treat each group as a single review card, WITHOUT changing
   `userVocabulary`'s existing surface-form `(userId, language, word)` unique key.
2. WHEN a card is assembled THEN it SHALL expose an **occurrences** list, each occurrence
   carrying at least `{ surface, sentence, contextualSense, whyThisForm }` derived from the
   saved row and its `card` jsonb snapshot (morphology and grammar points included when
   present).
3. WHEN an item that needs a specific surface form (cloze, listening) is generated THEN the
   system SHALL select one occurrence (e.g. at random / least-recently-used) so the concept
   is reviewed but a different form may be tested across sessions.
4. IF a lemma has no saved sentence/occurrence usable for a context-dependent item type THEN
   the system SHALL fall back to a context-independent item type rather than emit a broken
   item.
5. WHEN a new `userVocabulary` row is saved for a lemma that already has a review card THEN
   the new surface form SHALL appear as an additional occurrence on the existing card and
   SHALL NOT create a second card.
6. WHEN a `userVocabulary` row is a phrase/idiom THEN the card SHALL be flagged so item-type
   selection can exclude morphology-dependent items (open item from the design; reduced item
   set for phrases).

### Requirement 3 — Per-language daily queue builder

**User Story:** As a polyglot, I want each review session built for one language at a time
from what's actually due plus a small trickle of new words, so that context-switching
between languages doesn't sabotage my recall.

#### Acceptance Criteria

1. WHEN a learner starts a review for a language THEN the system SHALL build a queue
   containing only that language's cards and SHALL NOT include cards from any other language.
2. WHEN the queue is built THEN it SHALL include all cards whose `dueAt` is in the past plus a
   capped intake of `new` cards, where the new-intake cap is a configurable per-language daily
   limit (default 5/day).
3. WHEN the queue is built THEN the system SHALL report a breakdown of `due`, `new`, and
   `leech` counts and a projected **item-type mix** for the session.
4. WHEN the number of due cards exceeds a session-size ceiling (default: **20 items**) THEN
   the system SHALL cap the session to that configurable size and SHALL prioritize the
   most-overdue / highest-risk cards.
5. WHEN no cards are due and no new intake remains for a language THEN the queue SHALL be empty
   and the system SHALL report when the next card becomes due.
6. WHEN a focused subset is requested (e.g. new-intake only, or words from a specific
   `readEntry`) THEN the queue builder SHALL accept a filter and build the queue from only the
   matching cards.

### Requirement 4 — Review hub surface

**User Story:** As a learner, I want a home screen that tells me, per language, how much is due
and lets me start in one action, so that reviewing is frictionless.

#### Acceptance Criteria

1. WHEN the learner opens the Review hub THEN it SHALL show the active language's queue
   breakdown (due / new / leech counts), the item-type mix, an estimated session length, and a
   single primary **start review** action labeled with the item count.
2. WHEN the active language changes (via the existing language switcher) THEN the hub SHALL
   rebuild its counts for the newly-active language and SHALL NOT blend languages.
3. WHEN the queue is empty THEN the hub SHALL show an explicit "all caught up" empty state, a
   short "don't over-review" rationale, an **upcoming / next-due** preview, and secondary CTAs
   (browse bank, read something) instead of a start button.
4. WHEN focused-subset starts are available (e.g. "new intake only", "words from a saved
   passage") THEN the hub SHALL offer them as secondary actions, disabling any whose count is
   zero.
5. WHEN the hub renders THEN it SHALL NOT display any streak, XP, point, or lesson-count
   element.
6. WHEN viewed on mobile width THEN the hub SHALL present the same information adapted to the
   mobile shell (per the mobile prototype) without losing the queue breakdown or start action.

### Requirement 5 — Cloze-in-context item type

**User Story:** As a learner, I want to fill the saved word back into the exact sentence I met
it in, so that I practice the correct inflected form, not just the dictionary form.

#### Acceptance Criteria

1. WHEN a cloze item is presented THEN the system SHALL render one of the card's saved source
   sentences with the target surface form blanked, plus its translation and source
   attribution.
2. WHEN the learner submits an answer THEN the system SHALL grade it locally by comparing the
   typed string against the expected inflected surface form (after the language's
   normalization rules, e.g. case/whitespace; accents handled per language).
3. WHEN the item is for Turkish (or another morphologically rich language) THEN the item SHALL
   be able to show the morphology breakdown of the target slot as an optional hint.
4. WHEN the learner requests "reveal / I don't know" THEN the system SHALL show the answer and
   grade the item as `Again`.
5. WHEN the cloze is graded THEN the result SHALL flow through `applyReview` (Requirement 1)
   and emit evidence (Requirement 9).

### Requirement 6 — Meaning → production item type

**User Story:** As a learner, I want to be shown a word's meaning and produce the word myself,
so that I build the recall path from concept to form.

#### Acceptance Criteria

1. WHEN a meaning→production item is presented THEN the system SHALL show the card's
   `contextualSense` / definition (plus POS, CEFR, frequency) and an input for the learner to
   produce the target word.
2. WHEN the learner submits THEN the system SHALL grade locally by matching the input against
   the lemma and its accepted inflected forms (normalized per language).
3. WHEN the learner uses progressive hints (first letter, syllable count, blanked example)
   THEN the system SHALL track hint usage and SHALL cap the achievable rating accordingly (0
   hints → up to Good/Easy; 1+ hints → capped at Hard).
4. WHEN the input language requires special characters THEN the item SHALL offer an accent /
   character helper (reusing the existing accent picker).
5. WHEN graded THEN the result SHALL flow through `applyReview` and emit evidence.

### Requirement 7 — Recognition item type (warm-up only)

**User Story:** As a learner meeting a brand-new word, I want a low-stakes recognition check
first, so that I rebuild the link before being asked to produce it cold.

#### Acceptance Criteria

1. WHEN a card is `new` (or otherwise below the production-maturity threshold) THEN the system
   SHALL be able to present a recognition item (word → meaning) as a warm-up.
2. WHEN a card has reached the production-maturity threshold (configurable; default:
   **stability ≥ 7 days**) THEN the system SHALL prefer a production item type over
   recognition for that card.
3. WHEN a recognition item is graded THEN it SHALL be a cheap/local grade and flow through
   `applyReview` like the other local item types.
4. WHEN item types are selected across a session THEN the system SHALL vary them by FSRS
   maturity so the learner memorizes the word rather than a fixed card layout.

### Requirement 8 — Local grading & FSRS state update (hybrid seam)

**User Story:** As a learner, I want instant, free feedback on the typed items, so that review
stays fast and cheap.

#### Acceptance Criteria

1. WHEN a locally-gradable item (cloze, meaning, recognition) is submitted THEN the system
   SHALL grade it on the server without any LLM call and return the result with low latency.
2. WHEN grading runs THEN it SHALL produce a normalized outcome of `correct`, `partial`, or
   `incorrect` and map it to an FSRS rating, persist the updated `vocabulary_review_state`
   via `applyReview`, and record the review event. A `partial` outcome is a near-miss
   (e.g. accent-only / diacritic mismatch, or a correct answer reached only after a hint)
   and SHALL map to `Hard`; `correct` → `Good`/`Easy`, `incorrect` → `Again`.
3. WHEN a locally-graded item is processed THEN no AI-usage / metering event SHALL be recorded
   for it (local items are free).
4. WHEN the grading seam is defined THEN it SHALL expose a stable interface that a future
   Claude-graded ("use it" / production) rating source can call to produce a rating from an
   eval-score, without changing the scheduler (forward-compatibility for Phase 2).
5. IF a submission is malformed or references a card the user does not own THEN the system
   SHALL reject it with a validation error and SHALL NOT mutate scheduler state.

### Requirement 9 — Mastery movement (review advances the radar)

**User Story:** As a learner, I want correct reviews to visibly improve my grammar points and
competencies, so that review feels like it advances my real skill, not a side game.

#### Acceptance Criteria

1. WHEN a review item is graded THEN the system SHALL emit graded **evidence** into the same
   progress aggregation that the existing progress radar and grammar map read, so the radar /
   grammar points move WITHOUT introducing a separate parallel scoring system.
2. WHEN the reviewed occurrence carries grammar points (e.g. "ablative case", "preterite")
   THEN a correct result SHALL contribute positive evidence to those grammar points and an
   incorrect result SHALL contribute negative evidence.
3. WHEN evidence is emitted THEN it SHALL also feed the relevant competency (e.g. vocabulary
   depth, grammar accuracy) consistent with the existing progress model.
4. WHEN an item's result is shown THEN the feedback SHALL display which grammar point(s) /
   competency moved and the before→after direction, sourced from the emitted evidence (not a
   fabricated number).
5. WHEN the progress radar/grammar map is opened after a review THEN it SHALL reflect the
   review evidence (the radar reads the same store reviews wrote to).
6. WHEN evidence is recorded THEN it SHALL be attributable to the review (item type, card,
   occurrence) for later inspection.

### Requirement 10 — Session flow & in-session feedback UX

**User Story:** As a learner, I want a focused one-item-at-a-time flow with immediate feedback,
so that I can move through my queue without friction.

#### Acceptance Criteria

1. WHEN a session starts THEN the system SHALL present items one at a time, in order, showing a
   **burndown** of items remaining and never a score or streak.
2. WHEN the learner submits an item THEN the system SHALL show immediate inline feedback for
   that item before advancing (correct/incorrect state, the corrected form, and what moved).
3. WHEN the learner advances THEN the next item SHALL load and the input SHALL receive focus;
   the flow SHALL support keyboard advance (e.g. Enter = check/next).
4. WHEN the learner pauses or exits mid-session THEN the system SHALL persist completed reviews
   (scheduler state already updated per item) so progress is not lost.
5. WHEN the session UI renders on desktop THEN it SHALL follow the prototype's split layout
   (item + coach/scheduler rail); WHEN on mobile THEN it SHALL follow the mobile prototype with
   a sticky action bar.
6. WHEN every queued item is completed THEN the system SHALL route to the end-of-session
   summary (Requirement 11).

### Requirement 11 — End-of-session summary

**User Story:** As a learner, I want an honest end-of-session debrief of what my skills did, so
that I leave knowing what got better — not how long a streak is.

#### Acceptance Criteria

1. WHEN a session completes THEN the summary SHALL show counts of clean / partial / missed
   items, items **promoted** (graduated to a longer interval / matured) and **lapsed**, and the
   number of new cards added.
2. WHEN the summary renders THEN it SHALL list which **grammar points / competencies moved**
   with before→after values, sourced from the evidence emitted during the session.
3. WHEN the summary renders THEN it SHALL show a per-item recap (lemma, surface tested, item
   type, result) and when the next batch is due.
4. WHEN the summary renders THEN it SHALL NOT show any streak, XP, point total, or "great
   job!" gamified element; tone is calm and evidence-based.
5. WHEN the learner finishes the summary THEN it SHALL offer next actions (browse bank, done,
   see full radar) that route to the existing surfaces.

### Requirement 12 — Vocabulary bank / browse & word detail

**User Story:** As a learner with a growing multi-language collection, I want to browse, search,
and manage my saved words, so that I stay in control of what I'm reviewing.

#### Acceptance Criteria

1. WHEN the learner opens the bank THEN it SHALL list saved words for the active language, one
   row per lemma, with lemma, gloss/POS, CEFR, status, an SR-stability indicator, and next-due.
2. WHEN the learner searches or filters THEN the bank SHALL filter by free-text (lemma/gloss)
   and by status (new / learning / mature / leech / suspended / known).
3. WHEN the learner opens a word THEN the detail view SHALL re-render the saved deep-card
   snapshot, the **pooled occurrences** (surface, sentence, contextual sense, why-this-form),
   the FSRS scheduler stats (stability, difficulty, reps, lapses, next interval, due), the
   **review history**, and the grammar points the card feeds.
4. WHEN the learner acts on a word THEN the detail view SHALL support **suspend**, **mark-known**
   (eject from queue), **delete**, and **reset SR state**, each updating the
   `vocabulary_review_state` and/or `userVocabulary` accordingly.
5. WHEN a word is marked known or suspended THEN it SHALL be excluded from future queue builds
   until un-suspended (suspended) or permanently (known), and its status SHALL be reflected in
   the bank filters.
6. WHEN a leech word exists THEN the bank SHALL surface it distinctly (status filter +
   indicator); the rescue *intervention flow* is Phase 2, but leeches SHALL be browsable here.

### Requirement 13 — Cross-feature integration with Reading & Progress

**User Story:** As a learner, I want review wired into reading and progress, so that the word I
just saved and the skills I just moved are connected across the app.

#### Acceptance Criteria

1. WHEN viewing a saved `readEntry` THEN the learner SHALL be able to start a **"review the
   words from this passage"** session that builds the queue from only that entry's saved
   lemmas (Requirement 3.6).
2. WHEN a word is currently under review (has an active, non-suspended `vocabulary_review_state`
   card) THEN the Reading surface SHALL render that word with a **distinct highlight** so the
   learner can see which words are in their review rotation.
3. WHEN the review summary or hub links to progress THEN it SHALL deep-link to the existing
   progress radar / grammar map (no parallel progress UI is created).
4. WHEN Review is added to navigation THEN it SHALL be reachable as its own surface and SHALL
   surface a **due-count badge** for the active language.

### Requirement 14 — API, client, and data contracts

**User Story:** As a developer (and the future mobile app), I want the review feature exposed
through the same typed API + api-client patterns as the rest of the app, so that web and mobile
share one contract.

#### Acceptance Criteria

1. WHEN review endpoints are added THEN they SHALL be Hono routes registered in
   `infra/lambda/src` following the existing per-feature router pattern, authenticated via the
   existing Clerk JWT middleware (`c.get('userId')`).
2. WHEN the web app calls the review API THEN it SHALL do so through TanStack Query
   hooks + Zod-validated request/response schemas in `packages/api-client`, mirroring existing
   hook conventions.
3. WHEN review request/response and card/occurrence shapes are defined THEN their canonical Zod
   types SHALL live in `packages/shared` (or `packages/api-client/src/schemas`) consistent with
   existing read/exercise schemas, so server and client validate against one source.
4. WHEN the new `vocabulary_review_state` schema and any column additions are introduced THEN
   they SHALL be added to the Drizzle schema in `packages/db` with a new forward-only migration
   following the `NNNN_*.sql` convention.
5. WHEN a review mutation succeeds THEN the relevant TanStack Query caches (queue counts, bank,
   word detail) SHALL be invalidated/updated so the UI stays consistent.

## Non-Functional Requirements

### Performance
- Locally-graded items (cloze, meaning, recognition) SHALL be graded server-side without any
  LLM call, with a server-side grading latency target of **p95 < 200 ms** (excluding network).
- The daily queue build SHALL be a bounded query per `(user, language)` backed by an index on
  `vocabulary_review_state (userId, language, dueAt)`, scaling to a learner's full saved
  vocabulary without table scans.
- The session SHALL fetch its queue up-front (mirroring the drill session) to avoid per-item
  round-trips.

### Security
- All review endpoints SHALL require a valid Clerk JWT and SHALL scope every read/write to the
  authenticated `userId`; a learner SHALL never be able to read or mutate another user's cards.
- Input SHALL be validated with Zod before any DB write, consistent with the existing API.

### Reliability
- Scheduler state SHALL be persisted per graded item, so a mid-session crash or exit never
  loses already-completed reviews.
- Building a lemma card from malformed/partial saved data (missing `card` jsonb, missing
  occurrence sentence) SHALL degrade gracefully (fall back to a simpler item type) rather than
  error the session.
- FSRS state transitions SHALL be deterministic and unit-tested across the
  new/learning/mature/leech lifecycle.

### Usability
- The feature SHALL obey the two product laws on every surface: production-first items and
  zero streak/XP/point/lesson-count UI.
- Per-language separation SHALL be preserved everywhere (hub, session, bank, badges) — no
  surface SHALL blend two languages into one queue or count.
- Desktop and mobile SHALL both be supported, following the provided prototypes
  (`docs/design/vocabulary-review-prototype/`).
- Feedback copy SHALL be calm and evidence-based, naming what skill moved rather than
  rewarding activity.
