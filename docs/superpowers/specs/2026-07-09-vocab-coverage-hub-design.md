# Vocab Coverage Hub — Design

**Date:** 2026-07-09
**Status:** Design (awaiting review)
**Scope of this spec:** Spec 1 of a multi-spec feature — the **ES A1 pilot** vertical slice.

---

## Problem

The app tests vocabulary via the `vocab_recall` exercise type, but the vocabulary
it tests is **emergent, never surfaced, and never curated**:

- `vocab_recall` exercises have an explicit target word (`expectedWord`,
  `packages/shared/src/index.ts:133`), but the generator *proposes* those words
  itself, constrained only by a CEFR frequency band + the topic umbrella + a
  "don't repeat these" avoid-list (`packages/db/src/generation/run-one-cell.ts`,
  `packages/ai/src/generation-prompts.ts:352`). There is no canonical list of
  words we intend to teach.
- Frequency/importance data exists (`vocab_lemma.rank`, ~88k rows across ES/DE/TR)
  but is not user-facing and carries **no topic and no CEFR column** (CEFR is
  derived from rank bands at query time via `cefrRankWindow`).
- Topic/subject exists only as curriculum "vocab umbrellas" (`kind:'vocab'`
  grammar points, e.g. `es-a1-vocab-food-drink`), which are **excluded from the
  Theory hub** (`generate-theory-resolve-cells.ts:59-61`) and carry only ~2
  example words each — not a list.

Net: there is **no user-facing vocabulary surface at all** — not topic-level, not
word-level. A learner cannot see what topics exist, which words each covers, or
their relative importance.

## Goal

A **coverage + drill-launcher** surface: browse vocabulary by topic (and level),
see which words a topic covers ranked by frequency/importance, see your own
per-word mastery state, and launch a drill for a topic. This reinforces the
product's mastery-tracking differentiator rather than becoming the passive
"vocabulary list" the product positions against.

### Non-goals (this spec)

- **No word-level mastery table.** Coverage is *derived* from existing history
  (see below), not a new Bayesian per-word score. Activating the dormant
  `spaced_repetition_cards` table is out of scope.
- **No single-word drill.** Drill launch is topic-level only (reuses the existing
  flow verbatim). Per-word drill would need a new session filter param — deferred.
- **No generation-seeding alignment.** Making `vocab_recall` *prefer* curated
  target words is Spec 2. The pilot honestly shows the gap where a target word
  has no exercise yet.
- **ES A1 only.** DE / TR and higher levels fan out in later specs.

## Positioning guardrails

The product bans streaks, XP, and completion counts, and forces production over
recognition. Therefore:

- **No "X / Y done" counter.** Coverage renders as a **word-level mastery map**
  (green / yellow / grey grid) — the sanctioned "grammar mastery map" pattern
  applied at word granularity — not a progress bar with a number.
- **Meanings hidden by default.** Each word shows its display form + frequency +
  example sentence; the gloss/translation is revealed on tap. Keeps the page a
  launcher/coverage surface, not a memorize-list.

---

## Decomposition (full feature)

Each piece is its own spec → plan → build cycle. Dependency order:

1. **`vocab_target` data model + authoring pipeline** — produces the curated,
   reviewed word lists. *(this spec, ES A1)*
2. **Vocab browse hub UI + coverage read model** — surfaces them. *(this spec,
   ES A1)*
3. **Generation-seeding alignment** — seed `vocab_recall` generation from the
   curated targets so coverage converges. *(Spec 2)*
4. **Fan-out** — DE, TR, higher CEFR levels. *(Spec 3+)*

Spec 1 bundles pieces 1 and 2 into one thin vertical slice so the pilot is
end-to-end demonstrable.

---

## Spec 1 — ES A1 pilot

### Component A — `vocab_target` table

New table (`packages/db/src/schema/vocab.ts`, new migration). Mirrors the
`theory_topics` review pattern (mutable per-row `status`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `language` | text | `ES` (TS `LearningLanguage`) |
| `umbrella_key` | text | grammar-point key, e.g. `es-a1-vocab-food-drink` |
| `cefr_level` | text | `A1` (denormalized from the umbrella for query filtering) |
| `lemma` | text | dictionary form; join key to `vocab_lemma` |
| `display_form` | text | form shown to the learner (may include article, e.g. `la manzana`) |
| `gloss` | text | short EN meaning; hidden-by-default in UI |
| `example_sentence` | text | one natural sentence using the word |
| `freq_rank` | integer nullable | copied from `vocab_lemma.rank` at author time; null if unmatched |
| `tier` | text | importance tier derived from freq band (`core` / `common` / `extended`) |
| `status` | text | `approved` / `flagged` (review workflow) |
| `source` | text | provenance: `llm` / `edited` |

- Unique index on `(language, umbrella_key, lemma)` — one row per word per topic.
- Index on `(language, umbrella_key, status)` for the browse read.
- The `lemma` join to `vocab_lemma` supplies `freq_rank`; unmatched lemmas keep
  `freq_rank = null` and sort last (flag for review).

### Component B — authoring CLI

`pnpm --filter @language-drill/db generate:vocab-targets` (mirrors
`generate:theory` + `review-flagged-theory`):

1. For each ES A1 `kind:'vocab'` umbrella, load the umbrella's
   `name`/`description`/`examplesPositive` and the ES A1 frequency band from
   `vocab_lemma` (`loadFrequencyBand`, `packages/db/src/generation/vocab-band.ts`)
   as a seed/anchor.
2. Ask Claude (new prompt in `packages/ai/src/`, registered in the bootstrap
   manifest per the "new prompt needs manifest entry" rule, with a
   `*_PROMPT_VERSION` constant) to propose N words for the topic: `display_form`,
   `lemma`, `gloss`, `example_sentence`. Deduped against existing rows for the
   umbrella.
3. Validate (structural + a validation prompt, mirroring the generate↔validate
   contract split): word is on-topic, gloss present, example uses the word, lemma
   is a plausible dictionary form.
4. Join each `lemma` to `vocab_lemma` for `freq_rank`; assign `tier` from the
   rank band.
5. Insert rows as `status='flagged'` for human review. A `review-flagged-vocab`
   companion (or reuse the flagged-review pattern) promotes to `approved`.

Idempotent: dedupes on `(language, umbrella_key, lemma)`.

### Component C — coverage read model

`GET /vocab/topics?language=ES&cefr=A1` and
`GET /vocab/topics/:umbrellaKey` (new routes,
`infra/lambda/src/routes/vocab.ts`).

Per target word, compute a 3-state coverage from existing data — **no new
mastery table**:

- **`not-yet`** — no approved `exercises` row exists whose
  `content_json->>'expectedWord'` matches the target (by lemma/display form) for
  this umbrella. (The honest "gap" state.)
- **`untested`** — an exercise exists but the user has no
  `user_exercise_history` row for it.
- **`practiced`** — the user has ≥1 history row; sub-shade by best/recent score
  (green vs yellow).

The join: `vocab_target` → `exercises` (on `language` + `grammarPointKey =
umbrella_key` + `expectedWord`) → `user_exercise_history` (on `exerciseId`,
`userId`). Topic-level mastery still comes from `user_grammar_mastery` for the
umbrella and can headline the topic card.

> SQL note: qualify columns in any correlated subquery (see the
> "drizzle projection subquery unqualified" hazard) and add a `toSQL` guard test.

### Component D — browse hub UI

New route (recommend `/vocab`; alternatively a tab within `/theory`) under
`apps/web/app/(dashboard)/`, styled after the Theory hub
(`theory/page.tsx` grouping/search/controls, reused where possible):

- **Topic list:** ES A1 umbrellas as cards (name, word count, topic-level mastery
  tint).
- **Topic detail:** word grid, each cell = `display_form` + `freq_rank` badge,
  colored by the 3-state coverage. Tap a word → reveal `gloss` +
  `example_sentence` (hidden by default).
- **Drill this topic:** button reusing the existing flow verbatim —
  `href=/drill?start=quick&grammarPoint=<umbrella_key>&exerciseType=vocab_recall`
  → `POST /sessions` filters the pool by `grammarPointKey`
  (`sessions.ts:183`). Show/hide it via the existing `usePointDrillInfo`
  inventory pre-check so it never dead-ends. **Zero new drill plumbing.**

### Data flow

```
authoring CLI ──► vocab_target (flagged) ──review──► vocab_target (approved)
                                                          │
browse UI ──GET /vocab/topics──► coverage read model ─────┤
                                     │  join                │
              user_exercise_history ─┴─ exercises ──────────┘
                                                          │
"Drill this topic" ──► /drill?grammarPoint=<key>&exerciseType=vocab_recall
                                     └─► POST /sessions (existing, unchanged)
```

### Error handling

- Unknown `umbrellaKey` / non-vocab key → 404 (mirror
  `GET /progress/points/:key`).
- Empty topic (no approved targets yet) → topic card hidden or shown as
  "coming soon"; never a broken grid.
- `freq_rank = null` (unmatched lemma) → word sorts last, no rank badge.

### Testing

- **db:** migration applies; `vocab_target` unique/index constraints; authoring
  CLI idempotency (re-run inserts nothing new); validation rejects off-topic /
  gloss-less proposals. (Rebuild `db/dist` before single-package vitest — stale
  dist hazard.)
- **ai:** new prompt has a version constant + manifest entry; validation prompt
  mirrors the generation shape (generate↔validate contract).
- **lambda:** coverage read model 3-state logic against a mock db; a `toSQL`
  guard for the correlated subquery; 404 on unknown key.
- **web:** topic list + detail render; gloss hidden until tap; "Drill this topic"
  href correct; grep all tests for any reused Theory-hub labels before renaming
  (label/route change hazard).
- Full `pnpm turbo run test --concurrency=1` is the real gate (package typecheck
  excludes tests).

---

## Risks & open items

- **Coverage honesty.** Until Spec 2 (generation seeding), many curated targets
  will sit in `not-yet` because the generator never proposed them. This is
  intentional and visible, but the grid may look sparse at first. Acceptable for
  a pilot; motivates Spec 2.
- **Lemma matching.** `expectedWord` (surface form) vs `vocab_target.lemma`
  (dictionary form) may not match exactly (inflection, articles). The coverage
  join needs a normalization step; start conservative (exact + lemma-normalized)
  and log misses.
- **`vocab_lemma` topiclessness.** Frequency comes from `vocab_lemma`, but topic
  assignment is the LLM's job at authoring time — quality gated entirely by
  review. Small ES A1 surface keeps review tractable.
- **Route placement** (`/vocab` vs `/theory` tab) is a UI decision to confirm
  during planning; leaning standalone `/vocab` for clarity.

---

## Decisions locked (from brainstorming)

- Purpose: **coverage + drill launcher** (not reference, not memorize-list).
- Source: **curated target lists** (not emergent pool, not import).
- Authoring: **LLM-proposed + human-reviewed**.
- Pilot: **ES A1 only**.
- Storage: **new `vocab_target` DB table** (not curriculum `.ts`).
- Coverage: **derived 3-state** from history (no new mastery table).
- Glosses: **hidden by default**, revealed on tap.
- Drill: **topic-level only** (reuses existing flow).
