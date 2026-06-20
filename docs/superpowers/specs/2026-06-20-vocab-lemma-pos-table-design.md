# PoS-enriched vocab lemma table — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorm), pending implementation plan

## Problem & motivation

Verb seeding for conjugation/inflection drills is stuck on Spanish. The current
"is this lemma a verb?" test (`verbBand` in `packages/ai/src/frequency/index.ts`)
is a morphology heuristic — Spanish infinitive suffix (`ar`/`er`/`ir`) plus
"has ≥4 distinct surface forms." It cannot work for Turkish or German, and a
code comment already flags that it "collapses to a `pos === 'verb'` filter once
the vocab file gains a `pos` field."

The frequency dictionaries (`packages/ai/src/frequency/{es,de,tr}.json`, ~42k
entries each, schema `surface → { lemma, rank, cefr? }`) carry no part-of-speech
data; `cefr` is defined but never populated (rank stands in for level).

This design adds a real PoS-bearing lemma store so verb (and, later, any
word-class) seeding becomes **language-agnostic**, and so the vocab layer has a
clean home for future enrichment without re-architecting.

## Goals

- A Postgres `vocab_lemma` table: per-language lemma, frequency rank, and all
  attested parts of speech.
- PoS sourced reproducibly from Wiktextract, with an LLM gap-fill pass for the
  residual unmatched lemmas.
- Seed selection refactored so verb/word-class filtering reads the DB instead of
  the Spanish-only morphology heuristic — verb seeding works for ES, DE, and TR.
- A schema shaped so topic tags, register, and embeddings can each be added later
  as an additive migration with no code rework.

## Non-goals (deferred — no consumer yet; YAGNI)

- **Topic / subject tags** — nothing currently selects vocab by semantic field;
  topicality is handled today by a prompt directive, not word-level data.
- **Register tags** (formal / informal / slang / dialect) — narrow value, noisy
  to annotate accurately (especially TR), no consumer.
- **Embeddings / pgvector semantic retrieval** — the stated "A2 vocab on sport"
  use case is a categorical `WHERE topic = … AND rank BETWEEN …` query, not an
  embedding problem. Adding a vector pipeline, model choice, and recurring cost
  is premature.

"Future-proofing" here means an **extensible schema**, not speculative data. Each
deferred item is a later nullable-column migration.

## Out of scope (separate follow-up spec)

TR/DE inflection-generation **validation** — the quality gate for TR and DE
conjugation output. The cells themselves already exist: TR has 12 live
conjugation cells (`conjugationSuitable: true` in `packages/db/src/curriculum/tr.ts`
→ `CONJUGATION` cells in `packages/db/src/generation/cells.ts`); DE has 0; ES has
3. Those 12 TR cells generate today but are unseeded (the old `verbBand` heuristic
was ES-only). This spec makes verb seeding language-agnostic, so once TR
`vocab_lemma` is populated the 12 existing cells become verb-seedable automatically.
The deferred follow-up is not "turn on TR conjugation cells" but rather "validate
TR/DE inflection-generation quality."

## Data model

```
vocab_lemma
  language  text        -- ES | DE | TR
  lemma     text
  rank      int         -- min corpus rank across the lemma's surfaces (sense-blind; see caveat)
  pos_all   text[]      -- all attested UD upos tags, e.g. {VERB,NOUN}
  source    text        -- 'wiktextract' | 'llm'  (provenance / quality audit)
  PK (language, lemma)
  INDEX (language, rank) -- the band query; pos_all membership filtered in memory
```

### Why `pos_all` (a set) and no scalar `pos`

A single citation form is often several word classes: `essen` (DE) is VERB *and*
NOUN; `bajo` (ES) is ADJ + ADP + NOUN. Consumers only ever ask set-membership
questions — verb seeding is `'VERB' = ANY(pos_all)`, and the deferred word-class
targeting (`wordClass` coverage at seed time) is the same shape. So the array is
the correct and sufficient model.

There is **no principled "dominant" PoS** to store as a scalar: `rank` comes from
a surface-frequency, sense-collapsed corpus — it counts every occurrence of the
string regardless of which word class it was. We have no frequency basis to call
one PoS dominant, so storing a scalar would fabricate a signal. A scalar can be
derived later (e.g. from Wiktextract sense ordering) only if a consumer needs it.

### Indexing

At ~15–25k distinct lemmas per language, the band query filters `language` +
`rank` range on the `(language, rank)` btree and checks `pos_all` membership in
memory. No GIN index or composite-with-array index is warranted at this scale.

## Components & data flow

1. **Build script** — `packages/ai/scripts/build-vocab-lemma.ts` (sibling to
   `build-frequency.ts`). Joins the frequency corpus (lemma, rank) with a
   Wiktextract dump (lemma → PoS) by lemma. Lemmas with no Wiktextract match
   (expected <10%, higher for TR) are routed to an LLM gap-fill pass tagged
   `source = 'llm'`. Following the existing frequency-JSON pattern (those files
   are checked into `packages/ai/src/frequency/`), the build emits a **compact
   seed artifact that is committed to the repo**; the large Wiktextract dump and
   raw corpus TSVs are read from a local/env-configured path and are **not**
   committed. Re-running the build is idempotent.
2. **Seed command** — `pnpm db:seed:vocab` upserts rows into `vocab_lemma`
   (per-environment, idempotent, modeled on `db:seed:exercises`).
3. **Drizzle migration** — adds the `vocab_lemma` table.
4. **Seed-picker refactor** — `packages/db/src/generation/seed-picker.ts`. The
   `verbBand` morphology heuristic is **deleted**. Band selection becomes a DB
   query: `WHERE language = ? AND rank BETWEEN ? AND ?` (plus
   `'VERB' = ANY(pos_all)` for conjugation), ordered `rank, lemma` to preserve
   the existing deterministic hash-probe seed selection. `frequencyBand` and
   `verbBand` are removed from `packages/ai`; the bundle keeps only the surface
   `lookup` / `isStopword` used by annotation and reading-level checks.

### Bundle is untouched

The bundled frequency JSON stays `surface → { lemma, rank }` for zero-latency
annotation and reading-level lookups. The `vocab_lemma` table serves generation /
seeding only. No bundle size change.

## The irreducible caveat: rank attribution

For a multi-PoS lemma, `rank` is the **combined** surface frequency, not per-PoS.
This does **not** hurt verb seeding — a frequent verb is a frequent verb, and the
conjugation prompt already states "the verb to conjugate is X," so PoS intent
rides in the prompt, not the data. It **would** bias the deferred "pick an A2
noun" use case: a word common as a verb but rare as a noun could land in too-easy
a band. Fixing that needs sense-disambiguated frequency, which the corpus does not
provide. Documented and revisited only when a vocab-by-PoS consumer exists.

We also **trust the corpus's surface→lemma map**: if the corpus maps surface
`habla` → lemma `hablar`, the noun `habla` exists as its own row only if the
corpus emitted it separately. We inherit that lemmatization rather than
re-deriving it.

Band ordering tie-breaks on (rank, lemma) using the DB's default collation;
seed selection is deterministic within a single database (the scheduler's
requirement), though equal-rank tie-break order may differ across databases with
different collations — acceptable; revisit with an explicit COLLATE only if
cross-environment seed reproducibility is ever needed.

## Risks

- **Turkish Wiktextract coverage** is the weak spot — agglutinative lemmatization
  and dictionary gaps mean the LLM gap-fill share will likely be larger for TR
  than ES/DE. The `source` column lets us measure the gap-fill rate per language;
  if TR match quality is poor, revisit before trusting verb seeding there.

  **OPERATOR NOTE:** Seeding `vocab_lemma` for TR immediately activates
  verb-seeding on the 12 existing live TR conjugation cells. TR is the weak spot
  for Wiktextract coverage, so before seeding TR, check the build's per-language
  matched/unmatched summary and the `source` distribution (gap-fill rate), and
  spot-check early TR conjugation generations.

## Testing

- Build-script join logic: corpus × Wiktextract match, lemma dedup, gap-fill
  routing, `source` tagging.
- Seed-picker determinism and the verb filter, now over a small seeded
  `vocab_lemma` fixture in the test DB. This **replaces** the current
  in-memory-band tests — a real refactor, not just additions.
- Migration applies cleanly; `pnpm db:seed:vocab` is idempotent.

## Enabled next (not this spec)

With PoS in the DB, verb seeding is language-agnostic. TR already has 12 live
conjugation cells (DE has 0, ES has 3); once TR `vocab_lemma` is seeded those
cells gain verb seeds automatically. The follow-up work is TR/DE
inflection-generation **validation** (quality), not turning the cells on.

---

## Addendum: raise the grammar-point description cap (200 → 300)

Independent of the vocab table, but bundled into the same implementation plan.

**Evidence.** The `GrammarPoint.description` cap is 200 chars (enforced at
`packages/db/src/curriculum/index.ts:193`). Measured across the live curricula:

| Lang | # points | max desc | # ≥180 chars |
|------|----------|----------|--------------|
| ES   | 37       | 165      | 0            |
| DE   | 23       | 168      | 0            |
| TR   | 83       | 200 (at cap) | 36       |

Turkish is jammed against the ceiling — several descriptions are at exactly
200/199/198, and 36 of 83 are within 20 chars of the cap. The description is
injected verbatim into generation prompts, so a too-tight cap directly truncates
the guidance TR generation gets. ES/DE have ample headroom and are unaffected.

**Change.** Raise the cap to **300** (50% headroom; ~100 extra prompt chars is a
negligible token cost). Three sites:

- `packages/db/src/curriculum/index.ts:193` — invariant check + error message.
- `packages/shared/src/curriculum-types.ts:56` — `≤ 200 chars` doc comment.
- `packages/db/src/curriculum/curriculum.test.ts:90` — over-long-description test
  threshold.

No existing description needs editing — this only relaxes the ceiling. Existing
TR descriptions may later be expanded to use the new room, but that is content
work, not part of this change.
