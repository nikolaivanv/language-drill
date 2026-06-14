# Fluency Mode — Design Spec

_Written 2026-06-13. Implements recommendation #2 from
`docs/exercise-strategy-assessment.md`: "Add a fluency mode — timed re-serving
of >0.8-mastery items; track response latency as a progress metric."_

## Motivation

The exercise catalogue targets a 60–80% difficulty band — everything is *hard*.
Nation's four-strands framework calls for a **fluency-development** strand: high-speed,
high-accuracy work on **already-known** material. For plateau learners, slow-but-accurate
production is the defining symptom, and accuracy drills alone don't fix it. Fluency mode
fills the missing fourth strand cheaply: re-serve items the learner has already mastered,
under a timer, and track **response latency** (automaticity) as a first-class metric.

## Core principle: fluency is a separate construct from mastery

Mastery (the existing radar) measures **acquisition** — a recency-weighted average of
Claude accuracy scores per skill axis, computed at query time from `user_exercise_history`.
Fluency measures **automaticity** — how *fast* the learner produces material they already
know. These are different dimensions and must not be conflated.

**Decisions locked during brainstorming:**

1. **Progress impact — separate signal (latency only).** Fluency submissions do NOT feed
   the accuracy mastery average. Re-drilling easy items must never be able to mask a
   genuine plateau — the exact failure mode the app exists to break.
2. **Eligibility — per-item history.** Re-serve specific exercises the user previously
   answered well (most-recent score ≥ 0.8), not "any item from a mastered axis." This is
   faithful to the assessment's "re-serve mastered *items*."
3. **Grading — local/deterministic only.** Grade against stored `correctAnswer` /
   `acceptableAnswers` (cloze) and `expectedWord` (vocab_recall) in-process — instant,
   free, no rate limit. This scopes fluency mode to the two locally-gradable exercise
   types. Translation and sentence_construction (which need Claude) are out of scope.
4. **Scope — full vertical slice including dashboard.** Schema, eligibility, timed drill
   UI, latency capture/storage, and a fluency surface on the progress dashboard.

## Architecture: dedicated `fluency_attempts` table

The existing mastery / radar / heatmap aggregations all read from a single table,
`user_exercise_history`. To make decision #1 (separate signal) **structural rather than
convention-based**, fluency results are written to their own table. Mastery aggregation
keeps reading only `user_exercise_history`, so it is *impossible* for a fluency drill to
move the accuracy radar — there is no filter to remember (and therefore none to forget).

The data shape genuinely differs from a standard submission anyway: no Claude
`EvaluationResult` object, but a `latencyMs` value. A purpose-built table also gives the
fluency dashboard clean queries.

Eligibility still **reads** `user_exercise_history` (to find previously-mastered items).
Fluency writes go to `fluency_attempts`. Reads from history, writes to the new table.

### New table

`packages/db/src/schema/progress.ts` — add `fluencyAttempts`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `userId` | text, FK → users | |
| `exerciseId` | uuid, FK → exercises | |
| `language` | text | denormalized for cheap stats queries |
| `grammarPointKey` | text, nullable | denormalized from the exercise |
| `correct` | boolean | deterministic grade result |
| `latencyMs` | integer | client-reported think-time, server-clamped |
| `attemptedAt` | timestamptz, default now() | |

Index: `(userId, language, attemptedAt)` for the stats query.

Migration is forward-only (Drizzle), per project convention.

## Backend (Hono / Lambda — `infra/lambda/src/`)

### Eligibility query (`lib/`, new module e.g. `fluency-eligibility.ts`)

Pure-ish query helper: given `(userId, language)`, return exercises where:

- `exercises.type IN ('cloze', 'vocab_recall')` (locally gradable), AND
- the user's **most-recent** `user_exercise_history.score` for that exercise ≥ 0.8, AND
- the exercise is currently approved (reuse `approvedStatusFilter`).

Returns a shuffled list. A shared `MIN_FLUENCY_POOL` constant (e.g. 4) defines the
threshold below which fluency mode is unavailable.

### `POST /fluency/session` (new route file `routes/fluency.ts`)

- Body: `{ language, count? }` (count defaults to a sensible session size, e.g. 8).
- Runs the eligibility query. If fewer than `MIN_FLUENCY_POOL` eligible items →
  `409 INSUFFICIENT_FLUENCY_POOL` with `{ available: <int>, required: MIN_FLUENCY_POOL }`.
- Otherwise returns up to `count` items with full `contentJson` (the client needs the
  exercise to render; grading still happens server-side on submit for trust).
- No `ai_evaluation` metering — fluency does not call Claude.

### `POST /fluency/attempts`

- Body: `{ exerciseId, answer, latencyMs }`.
- Validation: `latencyMs` positive integer or `422`. Values over a `LATENCY_CEILING_MS`
  (60_000) are **stored clamped to the ceiling** (not rejected) so a backgrounded tab
  produces a bounded outlier rather than poisoning the median.
- Fetch the exercise; if missing/unapproved → `404`, no row written.
- Grade **deterministically** by reusing the *same* normalization the existing
  cloze/vocab path uses (trim/case/diacritics) — single source of truth for "correct."
- Insert one `fluency_attempts` row (`correct`, clamped `latencyMs`, denormalized
  `language` + `grammarPointKey`).
- Response: `{ correct, correctAnswer, latencyMs }` for instant feedback.

### `GET /fluency/stats?language=`

- Aggregates `fluency_attempts` for the user/language:
  - median `latencyMs` over time (e.g. weekly buckets, last N weeks),
  - accuracy-under-time (% correct),
  - total attempt volume.
- Lives in a stats helper alongside the existing `progress-aggregation.ts` patterns
  (separate function/module — does not touch `aggregateRadar`).

## Shared types & API client

- `packages/shared/src/index.ts` — add fluency request/response types and the
  `MIN_FLUENCY_POOL` / `LATENCY_CEILING_MS` constants (single source of truth).
- `packages/api-client/src/` — Zod schemas for the three endpoints and TanStack Query
  hooks: `useFluencySession`, `useSubmitFluencyAttempt`, `useFluencyStats`.

## Web UI (`apps/web/`)

### Drill entry point
A "Fluency" mode toggle/card on the drill page. Disabled (with an explanatory
"Master a few more items first" message) when `POST /fluency/session` would return
`409` — surface the `available`/`required` counts.

### Timed drill flow
A fluency variant of the drill loop (can reuse `ClozeExercise` / `VocabExercise`
renderers):

- Visible **elapsed/countdown timer**, started on item render.
- Capture elapsed ms on submit; send `{ exerciseId, answer, latencyMs }`.
- Show instant ✓/✗ + the correct answer; auto-advance to the next item.
- No Claude feedback panel (there's no evaluation object) — feedback is the
  correctness + the correct answer + the time taken.

### Progress dashboard
A new **"Fluency" card/tab** under `apps/web/app/(dashboard)/progress/` — explicitly
NOT a 7th radar axis (fluency is not a CEFR macro-skill). Shows, per language:
median latency trend on mastered items, accuracy-under-time, and attempt volume,
sourced from `GET /fluency/stats`.

## Error handling & edge cases

- **Under-threshold pool** → `409 INSUFFICIENT_FLUENCY_POOL`, UI disables entry.
- **Latency sanity** → positive int required (`422`); `> 60s` stored clamped to ceiling.
- **Stale eligibility** → the session manifest is a snapshot; an item that was ≥0.8 at
  build time is graded normally even if the user later regresses (consistent with how
  standard sessions already pre-manifest).
- **Deleted/unapproved exercise on submit** → `404`, no attempt recorded.
- **Grading parity** → reuse existing cloze/vocab normalization; never a second
  definition of "correct."

## Testing

**Unit:**
- Eligibility query: ≥0.8 most-recent-score filter, type restriction
  (`cloze`/`vocab_recall` only), language scoping, approved-status filter.
- Deterministic grader: parity with existing cloze/vocab normalization.
- Latency validation/clamp logic.
- Stats aggregation: median latency, accuracy-under-time, volume.

**Integration (lambda routes):**
- `POST /fluency/session`: happy path; `409` when under threshold.
- `POST /fluency/attempts`: writes a row; emits **no** `ai_evaluation` usage event;
  `404` on bad exercise; `422` on bad latency; `latencyMs` clamped on huge value.
- `GET /fluency/stats`: response shape.

**Critical regression test:**
- Submitting fluency attempts does **not** change `GET /progress/radar` output —
  locks in the "separate signal" guarantee. (This is the test that protects the
  central design decision.)

**E2E (Playwright):**
- Enter fluency mode → answer a timed item → see instant feedback → fluency card
  reflects the activity.

## Out of scope (YAGNI)

- Claude-graded fluency for translation / sentence_construction.
- Backfilling `latencyMs` onto historical standard submissions.
- Adding fluency to the radar or heatmap (it has its own surface).
- SM-2 / spaced-repetition integration for fluency re-serving (eligibility is a simple
  most-recent-score gate for v1).
- Per-grammar-point fluency breakdowns (language-level stats only for v1).
