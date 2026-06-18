# Curriculum, Theory & Exercise Coverage — Expansion Analysis

_Snapshot date: 2026-06-18. Production Neon branch `br-green-waterfall-ancrvpr5`
(project `twilight-smoke-01114337`)._

Goal: scope what's needed to add **TR B1–B2**, **ES A1–A2**, and **DE A1–B2** to
the existing pools. Prior focus was TR A1–A2 and ES B1–B2. **TR B1–B2 is the
highest priority.**

---

## 1. Production coverage today

Every cell showing exactly `1` exercise is the 36-row idempotent seed
placeholder (`pnpm db:seed:exercises`), **not** real coverage. The real pools:

| Lang | Level | cloze | translation | sent_constr | vocab | dictation | free_writing | Theory pts |
|------|-------|-------|-------------|-------------|-------|-----------|--------------|------------|
| **TR** | A1 | 516 | 655 | — | 56 | 4 | — | 26 ✅ |
| **TR** | A2 | 318 | 437 | 105 | 97 | 10 | — | 19 ✅ |
| **ES** | B1 | 350 | 350 | 200 | 49 | 15 | 39 | 6 ✅ |
| **ES** | B2 | 339 | 349 | 73 | 75 | 15 | 50 | 5 ✅ |
| TR | B1 / B2 | seed only | | | | | | none |
| ES | A1 / A2 | seed only | | | | | | none |
| DE | A1–B2 | seed only | | | | | | none |

(Approved counts, `review_status IN ('auto-approved','manual-approved')`. TR
carries a high flag rate — ~50% on cloze/translation — but that is a pre-existing
quality issue, not a coverage gap.)

Theory pool (`theory_topics`) covers exactly the live grammar points: TR A1 (26),
TR A2 (19, incl. vocab umbrellas), ES B1 (6), ES B2 (5). No theory exists for any
expansion target.

---

## 2. Key finding: the curriculum drafts already exist (commented out)

All three targets are **audit-and-enable, not author-from-scratch**. Disabled
draft `GrammarPoint` objects are already present in the curriculum source
(`packages/db/src/curriculum/*.ts`), commented out on 2026-05-10 when focus was
narrowed. They are full objects (name, description, ±examples, commonErrors,
prereqs) but predate the book-grounded audits that TR A1/A2 and ES B1/B2 went
through, and most lack `coverageSpec` (the diversity-floor spec that drives pool
variety).

| Target | Draft grammar pts | Vocab | coverageSpec? | Location |
|--------|-------------------|-------|---------------|----------|
| **TR B1** | 3 — conditionals-sA, keşke-optative, causal-conj | 1 | ❌ none | `tr.ts:1219+` |
| **TR B2** | 4 — relative-participles, passive+nom, causative-recip, noun-clauses-DIK | 1 | ❌ none | `tr.ts:1277+` |
| **ES A1** | 4 — present-indic, ser/estar, articles, gender-agr | 0 | ✅ partial | `es.ts:54+` |
| **ES A2** | 5 — preterite reg/irreg, imperfect, gustar, reflexive | 1 | ✅ partial (6 total) | `es.ts:120+` |
| **DE A1** | 4 — present, articles-nom, noun-gender, V2 word order | 0 | ❌ none | `de.ts:32+` |
| **DE A2** | 5 — perfekt haben/sein, akk/dativ prep, separable-prefix | 1 | ❌ none | `de.ts:97+` |
| **DE B1** | 6 — rel-pronouns, dass+perfekt, modal-past, two-way-prep, passive-werden, subord-conj | 1 | ❌ none | `de.ts:183+` |
| **DE B2** | 5 — Konjunktiv-II, genitive-prep, Konjunktiv-I, extended-attr, nominalization | 1 | ❌ none | `de.ts:298+` |

---

## 3. What's needed — the 3-layer pipeline per target

### Layer 1 — Curriculum (code; the gating manual work)

1. Uncomment the drafts.
2. **Audit each point against a reference grammar/textbook.** TR A1/A2 used Yedi
   İklim — B1/B2 needs the same anchor; DE needs a Goethe / Menschen-style
   checklist; ES A1/A2 against a standard syllabus.
3. **Author missing `coverageSpec`** via
   `pnpm propose:coverage-spec --grammar-point <key> --with-pool-stats`
   — needed for all 7 TR points, all 20 DE points, and ~3 ES points.
4. Set `sentenceConstructionSuitable` / `conjugationSuitable` / `clozeUnsuitable`
   flags. Only set `sentenceConstructionSuitable` on single-construction points;
   multi-construction points get flagged `ambiguous`.
5. Raise `PER_LANGUAGE_GRAMMAR_MIN` in `curriculum/index.ts` and **bump
   `CURRICULUM_VERSION_{TR,ES,DE}`**. Mandatory: the scheduler's
   low-yield/saturation suppression only clears on a **curriculum-version** bump,
   not a prompt-version bump.
6. Pass `assertCurriculumInvariants` + `curriculum.test.ts`.

### Layer 2 — Theory pool

`pnpm generate:theory --batch-seed` per grammar point → one `theory_topics` row
each (generation + validation, auto-approve or flag). ~7 pages for TR, ~9 for ES,
~23 for DE. Verify rows land **auto-approved**, not flagged.

### Layer 3 — Exercise pool

Once Layer 1 ships to prod, the ~04:00 UTC scheduler picks up newly-enabled cells
automatically. Or force it with the on-demand admin generation trigger (commit
`3d502b0`, Tier 2 #6). Each grammar point fans out to cloze + translation +
(sentence_construction if suitable) + (conjugation if suitable); plus per-level
vocab and dictation cells. Volume is automatic — you author cells, the scheduler
fills them.

---

## 4. Recommended order

1. **TR B1–B2 first** — smallest draft (7 grammar + 2 vocab), and the TR
   expertise + Yedi İklim methodology is already proven. Main effort: author 7
   `coverageSpec`s and the B1/B2 audit. ~1 focused curriculum session, then theory
   + scheduler do the rest.
2. **ES A1–A2** — drafts are furthest along (already carry partial `coverageSpec`
   from when they were briefly live). Mostly audit + fill ~3 specs + re-enable.
3. **DE A1–B2** — largest (20 grammar + 3 vocab), zero `coverageSpec`, and DE has
   had **no production validation at all** — German generation/validation prompt
   quality is unproven. Best done level-by-level (A1→A2→B1→B2), not all at once.

---

## 5. Per-target effort summary

| Target | Grammar pts to enable | coverageSpecs to author | Theory pages | Prior prod validation | Relative effort |
|--------|-----------------------|-------------------------|--------------|-----------------------|-----------------|
| TR B1–B2 | 7 (+2 vocab) | 7 | ~7 | ✅ TR proven | **Low** |
| ES A1–A2 | 9 (+1 vocab) | ~3 | ~9 | ✅ ES proven | Low–Medium |
| DE A1–B2 | 20 (+3 vocab) | 20 | ~23 | ❌ none | **High** |
