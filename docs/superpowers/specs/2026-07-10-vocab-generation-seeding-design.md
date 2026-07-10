# Vocab Generation-Seeding Alignment — Design

**Date:** 2026-07-10
**Status:** Design (awaiting review)
**Scope of this spec:** Spec 2 of the multi-spec vocab-coverage feature — closing
the coverage loop for the **ES A1 pilot**, with a language/level-agnostic
mechanism. Depends on Spec 1
([`2026-07-09-vocab-coverage-hub-design.md`](./2026-07-09-vocab-coverage-hub-design.md)),
which shipped the `vocab_target` table, the authoring pipeline, and the coverage
read model.

---

## Problem

Spec 1 curated the words we intend to teach (`vocab_target`) and surfaced a
3-state coverage grid (`not-yet` / `untested` / `practiced`). But it explicitly
deferred **generation-seeding alignment** as a non-goal:

> "Making `vocab_recall` *prefer* curated target words is Spec 2. The pilot
> honestly shows the gap where a target word has no exercise yet."

That gap is now the dominant failure mode. `vocab_recall` is the **one**
seed-eligible exercise type that is currently **unseeded**: `seedKindFor(cell)`
returns `null` for it (`run-one-cell.ts:539`), so the model proposes
`expectedWord` freely — bounded only by the umbrella description, the CEFR
frequency band, and a "don't repeat at-cap words" avoid-list. It keeps
re-covering the same handful of obvious words and never reaches the long tail of
the curated list.

**Measured on prod (2026-07-10):** 144 approved ES A1 `vocab_target` rows across
5 umbrellas, but only **~14 (≈10%)** are covered by an approved exercise —
*despite* 432 auto-approved `vocab_recall` exercises already existing (e.g.
"manzana" generated 4×, while ~25 other curated foods sit `not-yet`).

| Umbrella | Approved targets | Covered |
|---|---:|---:|
| es-a1-vocab-city-places | 30 | 4 |
| es-a1-vocab-family-people | 26 | 2 |
| es-a1-vocab-food-drink | 29 | 4 |
| es-a1-vocab-home-objects | 30 | 3 |
| es-a1-vocab-weather-clothing | 29 | 1 |

Without seeding, "coverage" is honest but permanently stuck: a curated target no
exercise happens to test stays `not-yet` forever.

A second, quieter blocker: the `vocab_recall` cell target is a flat **10** for
every level (`CELL_TARGET_DEFAULTS`, `cell-targets.ts`), but each umbrella has
~30 curated targets. Even with perfect seeding, the scheduler reaches "target"
at 10 approved exercises and skips the cell — **structurally unable** to cover
the remaining ~20 targets.

## Goal

Point the existing seed machinery at `vocab_target` rows and drive both the seed
band **and** the scheduler's `need` off *uncovered* approved targets, so coverage
water-fills toward 100% and then the cell goes quiet. Reuse the proven
`conjugationSeedWords` pattern (PR #547) rather than inventing new plumbing.

### Decisions locked (from brainstorming)

- **When all approved targets are covered → stop.** The cell's `need` hits 0 and
  it is skipped — no further spend on that umbrella until new targets are
  authored. Coverage is the explicit finish line.
- **Data-driven gating.** Seeding auto-activates for any umbrella that has
  approved `vocab_target` rows. ES A1 activates now; DE / TR / higher levels
  light up automatically as Spec 3 authors their rows — **zero** generation
  changes for fan-out.
- **~1 exercise per target.** `need` equals the count of *uncovered* approved
  targets; each gets roughly one exercise. Fastest, cheapest path to full green.

### Non-goals

- **No new prompt in Langfuse.** The seed directive lives in the per-draft user
  prompt (uncached), which ships with the code deploy, not `push-prompts`.
- **No manual pool backfill / prune.** The recomputed `need` reactivates the
  currently-capped cells on the next scheduler run; the ~14 legacy duplicates
  are harmless and left in place.
- **No word-level drill or new mastery table** (already out of scope in Spec 1).
- **Coverage-controller axes untouched.** Modeling "word" as a `CoverageAxis` is
  a dead end — axes are small fixed enums shared across cells; curated words are
  an open, per-umbrella set. The `conjugationSeedWords` seed path is the right
  precedent.

---

## Architecture

Three coordinated changes plus a guarantee. The seed band (generation) and the
`need` (scheduler) are computed from the **same** set — the umbrella's
*uncovered* approved targets — so they cannot drift out of sync.

```
scheduler (per vocab_recall cell w/ approved targets):
    need = |uncovered approved targets|         ── 0 → skip (stop-when-covered)
                     │
                     ▼  SQS job {count: need, ...}
run-one-cell → buildSeedWords (seedKind 'vocab-target'):
    band = approved targets − covered, priority order (tier, freq_rank)
                     │  per-ordinal seedWord
                     ▼
generation-prompts → STRICT seedBlock: "expectedWord MUST be exactly '{seed}'"
                     │
                     ▼
validator/outcome pool: reject if normalizeWord(expectedWord) ≠ normalizeWord(seed)
                     │  approved exercise, content_json.expectedWord = seed
                     ▼
coverage read model (Spec 1): normalizeWord(expectedWord) == target → practiced/untested
```

### Component 1 — `vocab-target` seed kind (`packages/db/src/generation/run-one-cell.ts`)

- `seedKindFor(cell)` returns `'vocab-target'` for **every** `vocab_recall`
  cell (replacing the `null` at `:539`).
- New `buildSeedWords` branch for the kind:
  1. `loadApprovedVocabTargets(db, cell.grammarPoint.key)` — `vocab_target` rows
     with `status='approved'` for the umbrella, ordered by `tier` (core →
     common → extended) then `freq_rank` (nulls last). Core, high-frequency
     words first.
  2. **If zero rows → return `undefined`** → the caller's existing unseeded path
     runs, byte-identical to today's free generation. *This is the data-driven
     gate:* no per-language `if` anywhere — presence of rows in the DB is the
     switch.
  3. `loadCoveredTargetLemmas(db, cell)` — `normalizeWord(expectedWord)` of all
     approved `vocab_recall` exercises in the cell. Captures **both** newly
     seeded exercises (`content_json.expectedWord`) *and* the legacy 432 that
     carry no `seedWord` — so we never re-cover a word an old free-gen exercise
     already tests.
  4. Band = approved targets whose `lemma` **and** `displayForm` (both
     `normalizeWord`-ed, matching the coverage read model's `pickWordStat`
     exactly) are absent from the covered set. Assign to drafts in the priority
     order from step 1 (sequential, so a partial batch covers the most important
     words first).
- **Seed with the bare `lemma`** — matches `expectedWord`'s "canonical headword,
  no article" convention (`generate.ts:230`) and the coverage join's lemma-first
  match (`vocab-coverage.ts:39`).
- Persist the chosen seed to `content_json.seedWord` (writer-only, as the other
  seeded types already do) for observability; the authoritative exclude signal
  remains `loadCoveredTargetLemmas`, so legacy exercises are still respected.

> Package boundary: this is `packages/db` (has `db` access) — **not**
> `packages/ai` (must never import `@language-drill/db`). Prompts stay in `ai`;
> the DB query + orchestration stay in `db`.

### Component 2 — strict vocab seed directive (`packages/ai/src/generation-prompts.ts`)

Today's default (`else`) seed block is **loose**:

> "Build this exercise around the word '{seed}'. If '{seed}' does not fit … choose
> a related content word of similar frequency instead."

That substitution escape hatch lets the model drift off the curated target and
defeats convergence. Add a `VOCAB_RECALL` branch to `seedBlock` (alongside the
existing `CONJUGATION` / `CONTEXTUAL_PARAPHRASE` strict branches), roughly:

> "The target word (expectedWord) MUST be exactly '{seed}'. Write a clue /
> definition that elicits it; per the anti-leak rule the clue must not contain
> '{seed}'. Do not substitute another word."

- Bump `GENERATION_PROMPT_VERSION` to `<surface>@2026-07-10` (behavior-cohorting;
  signals reviewers the fallback changed).
- **No `push-prompts`.** The change is in `buildGenerationUserPrompt` (per-draft,
  uncached) — it ships with the CDK/code deploy, not the Langfuse template. The
  cached `GENERATION_SYSTEM_PROMPT_TEMPLATE` is untouched, so the Anthropic cache
  prefix stays byte-identical.

### Component 3 — coverage-aware scheduler need (`infra/lambda/src/generation/`)

In the scheduler decision layer, for `vocab_recall` cells whose umbrella has
approved `vocab_target` rows:

- Compute, per cell, the **uncovered approved-target count**: approved targets
  whose normalized `lemma`/`displayForm` has no matching approved-exercise
  `expectedWord` (the same join the coverage read model uses, aggregated to a
  count).
- Use that as `need`, replacing the generic `need = target − approvedInPool`.
  `need = 0` → cell skipped → **stop-when-covered**.
- Umbrellas with **no** approved targets keep `CELL_TARGET_DEFAULTS.vocab_recall`
  (10) and today's `target − approvedInPool` need — free generation, unchanged.
- Preserve the existing low-yield / give-up / dedup-saturation guards; a
  converging vocab cell yields fine and is not low-yield-suppressed, so this
  need change alone re-enqueues the currently-capped cells (no
  `CURRICULUM_VERSION` bump required).

> The per-umbrella uncovered count is a new read the scheduler performs
> alongside its existing approved-pool counts. Qualify every column in the
> correlated subquery (the "drizzle projection subquery unqualified" hazard) and
> add a `toSQL` guard test.

### Component 4 — coverage-match guarantee (validator / outcome pool)

When a draft was seeded (`seedWord` present), **hard-reject** it if
`normalizeWord(expectedWord) !== normalizeWord(seedWord)`. This mirrors the
digit-form / base-word-cue pinning checks: without it, a single model drift
(emitting an inflection, a synonym, or an article variant) produces an approved
exercise that never registers against its target — leaving it `not-yet`
*forever* despite the spend. The check makes "seeded → covered on approval" an
invariant, not a hope.

`normalizeWord` is the Spec 1 function (`vocab-coverage.ts:31`): lowercase, trim,
collapse whitespace, strip a leading Spanish article on multi-token strings.
Reuse it verbatim so the reject rule and the coverage read model agree by
construction.

---

## Data flow (end to end)

```
vocab_target (approved) ──┐
                          ├─► scheduler: need = |uncovered targets|  ─0─► skip
approved vocab_recall ────┘                    │ need>0
exercises (expectedWord)                       ▼  SQS {count: need}
                          ┌────────────► buildSeedWords → per-ordinal seedWord
                          │                    ▼
                          │            strict user-prompt directive
                          │                    ▼
                          │            generate → expectedWord = seed
                          │                    ▼
                          └── coverage-match reject gate ──► approved exercise
                                                                   │
                          coverage read model (Spec 1) ◄──────────┘  → grid turns green
```

Because `need` and the seed band are the same uncovered set, one scheduler run
targets exactly the gaps; validation rejections keep those targets uncovered, so
the next run retries them — convergent.

## Error handling

- **Umbrella with no approved targets** → seeding returns `undefined`; free
  generation unchanged. No error.
- **All targets covered** → `need = 0`; cell skipped. No error, no spend.
- **Model drifts off the seed** → Component 4 rejects the draft; the target stays
  uncovered and is retried next run.
- **Lemma unmatched in `vocab_lemma` (null `freq_rank`)** → still a valid target
  (`tier='extended'`, sorts last); seeded like any other.
- **`expectedWord` variant vs `lemma`/`displayForm`** → the strict directive pins
  `expectedWord = lemma`, and the reject gate enforces it, so the coverage join
  matches by construction.

## Testing

- **db** (`packages/db`): `buildSeedWords` vocab-target branch — targets loaded &
  ordered by tier/freq; covered lemmas excluded (both `lemma` and `displayForm`
  match); empty targets → `undefined` fallback; seed persisted. Rebuild
  `db/dist` before single-package vitest (stale-dist hazard).
- **ai** (`packages/ai`): strict `seedBlock` for `vocab_recall` contains
  "exactly" and does **not** contain the "similar frequency" substitution phrase;
  `GENERATION_PROMPT_VERSION` bumped to today.
- **lambda** (`infra/lambda`): coverage-aware `need` for a vocab umbrella with
  targets (uncovered count; 0 → skip); a non-target umbrella keeps the default
  10 / generic need; `toSQL` guard on the coverage subquery. Reject gate:
  `expectedWord` mismatch → dropped; match → kept. Delete `infra/lambda/dist`
  before the full run (stale compiled test hazard).
- **Full gate:** `pnpm lint && pnpm typecheck && pnpm turbo run test --concurrency=1`
  (package `tsc` excludes `*.test.ts`, so the turbo test run is the real gate).

## Rollout & verification

1. Merge → code deploy carries the strict directive + version bump + scheduler
   change. No `push-prompts`, no `CURRICULUM_VERSION` bump.
2. The ~04:00 UTC scheduler recomputes `need` for the 5 ES A1 vocab cells
   (currently capped at 10) → `need = |uncovered|` (~20–29 each) → enqueues.
3. Converges over ~1–2 nights; verify via the coverage grid (Spec 1 UI) or a
   prod SQL check that `covered / targets` climbs toward 1.0 per umbrella. A
   manual cell trigger can force an immediate run for spot-checking.

## Risks & open items

- **Convergence speed vs. validation reject rate.** If seeded drafts are rejected
  faster than approved, some targets take several nights. Acceptable; the loop is
  self-retrying. Monitor the per-umbrella `covered/targets` ratio.
- **`normalizeWord` drift.** Component 4's reject gate and the Spec 1 coverage
  read model MUST use the identical `normalizeWord`; import the one function, do
  not re-implement. A divergence would approve exercises that don't register.
- **Legacy duplicates unpruned.** The ~14 covered targets include redundant
  duplicates (4× "manzana"). Left as-is; a future prune pass is out of scope and
  does not affect convergence (they count as covered, correctly).
