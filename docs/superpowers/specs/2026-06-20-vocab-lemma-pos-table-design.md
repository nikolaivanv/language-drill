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

Turning on the actual TR/DE conjugation/inflection *cells* — curriculum
`conjugationSuitable` flags and validating inflection generation for those
languages. This spec removes the data blocker (language-agnostic verb seeding);
lighting up specific cells is its own change.

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

## Risks

- **Turkish Wiktextract coverage** is the weak spot — agglutinative lemmatization
  and dictionary gaps mean the LLM gap-fill share will likely be larger for TR
  than ES/DE. The `source` column lets us measure the gap-fill rate per language;
  if TR match quality is poor, revisit before trusting verb seeding there.

## Testing

- Build-script join logic: corpus × Wiktextract match, lemma dedup, gap-fill
  routing, `source` tagging.
- Seed-picker determinism and the verb filter, now over a small seeded
  `vocab_lemma` fixture in the test DB. This **replaces** the current
  in-memory-band tests — a real refactor, not just additions.
- Migration applies cleanly; `pnpm db:seed:vocab` is idempotent.

## Enabled next (not this spec)

With PoS in the DB, verb seeding is language-agnostic, which unblocks turning on
TR/DE conjugation/inflection cells (curriculum flags + inflection-generation
validation) in a follow-up.
