# TR A2/B1 Reverse-Audit Gap Fills (Design)

**Date:** 2026-07-10
**Status:** Approved pending user review
**Predecessor:** TR B2 cycle (`2026-07-07-tr-b2-curriculum-design.md`, PR #532) —
its Göksel & Kerslake reverse-coverage audit surfaced these A2/B1 gaps and
deferred them (a B1/B2 cycle adds only at B1/B2). This PR is that follow-up.
**Source:** Göksel & Kerslake, _Turkish: A Comprehensive Grammar_
(`/Users/seal/dev/language-tools/Turkish/turkish-grammar-book/turkish-grammar-md`).
Author-time grounding; § anchors recorded as code comments.

## Problem

The B2 cycle's all-chapters G&K sweep found grammar the book treats as core
A1–B2 Turkish but that was **absent from the live curriculum** — verified against
`tr.ts`, not a stale tree. Each leaves ordinary sentences unformable (not a
stylistic nicety). This PR closes the seven confirmed, level-appropriate gaps.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Scope | The 7 confirmed INCLUDE candidates from the B2-cycle audit, placed at their **natural level** (5 A2 + 2 B1). Additive; no rescopes of existing points. |
| Grain | Grouped by function, matching the A2/B1 grain. `dA` + `bile` cluster as one "focus clitics" point; `-lI` + `-sIz` as one with/without pair. |
| Migration | **No key renames → no DB migration.** Additive only. |
| Placement | Spatial postpositions → **A2** (they compose genitive-possessive + case, consolidated at A2). Past copula, clitics, -lI/-sIz, tane → A2. Suppletive ol-, olarak → B1. |

## Points (7)

| # | Key | Covers | Level | G&K §§ | Cat | Flags |
|---|-----|--------|-------|--------|-----|-------|
| 1 | `tr-a2-spatial-postpositions` | ön/arka/üst/alt/iç/yan/ara/karşı + poss + case (evin önünde, yanıma, altından) | A2 | §17.3.1(.1)(.3) | syntax | cloze |
| 2 | `tr-a2-past-copula` | past/evidential copula on nominals: -(y)DI (hastaydım), vardı/yoktu, -(y)mIş | A2 | §8.3.2, §8.4, §21.3.4.1 | tenses | person coverageSpec |
| 3 | `tr-a2-clitics-da-bile` | additive dA "too/also" + scalar bile "even" (2nd-position focus clitics) | A2 | §11.1.1.1–.2, §28.3.2 | syntax | clozeUnsuitable |
| 4 | `tr-a2-with-without-li-siz` | derivational -lI "with" / -sIz "without" (4-way harmony) | A2 | §7.2.2.2 | morphology | clozeUnsuitable |
| 5 | `tr-a2-enumerator-tane` | general counter tane (üç tane elma; noun stays singular) | A2 | §15.8 | syntax | cloze |
| 6 | `tr-b1-copula-ol` | suppletive ol- across the TAM slots the -(y)- copula lacks (olacağım, olmalıyım); be vs become | B1 | §12.1.1.3, §13.3, §21.3.4.1 | syntax | clozeUnsuitable, sentenceConstructionSuitable |
| 7 | `tr-b1-olarak` | olarak "as / in the capacity of" + adverbialiser of derived adjectives | B1 | §16.1.9 | syntax | cloze |

### Dedup notes (binding)

- **Spatial postpositions** are the two-noun genitive-possessive relational system
  (relational noun carries the case), distinct from A1 bare locative `-DA` and A1
  temporal postpositions önce/sonra.
- **Past copula** (#2) is the past of *non-verbal* predicates (hastaydım),
  distinct from A1 present copular suffixes, A1 verbal `-DI` (gittim), and A1
  var/yok (whose past var**dı**/yok**tu** it also formalises).
- **`dA`** clitic (separate word, 2-way, never devoiced) is explicitly contrasted
  with the locative suffix `-DA` (attached, 4-way, devoiced) — the top learner
  confusion. `bile` folds in as the scalar focus twin.
- **Suppletive ol-** (#6) covers exactly the TAM slots the `-(y)-` copula lacks;
  `-mAlI` here attaches to ol- (olmalıyım), not the noun. `olarak` (#7) is the
  lexicalised ol- + `-ArAk`, split out as a role/capacity marker.

## Flags rationale

- `tr-a2-past-copula`: person `coverageSpec` (rotates person across cloze/
  translation). **Not** `conjugationSuitable` — the conjugation drill would need
  predicate-nominal seeding, and the predicate-nominal set is a closed test locked
  to `tr-a1-personal-suffixes`; keeping it out avoids reopening that invariant.
- `clozeUnsuitable` on `clitics-da-bile` (placement clitic; near-synonym de/da vs
  locative under-constrains a blank), `with-without-li-siz` (the -lI/-sIz choice is
  meaning-driven → a bare blank accepts either), and `copula-ol` (free TAM on ol-
  under-constrains a single blank). Others keep cloze (forced by context).
- `sentenceConstructionSuitable` on `copula-ol` (single construction, apt for free
  production of "I will be a X").

## Mechanics

- `tr.ts`: 5 A2 points after `tr-a2-reported-speech`; 2 B1 points after
  `tr-b1-participles-dik-acak`. `CURRICULUM_VERSION_TR` → `2026-07-10` (changelog).
- `theory-categories.ts` (+ test mirror): 7 new `KEY_TO_CATEGORY` entries.
- `curriculum.test.ts`: TR counts — A2 ≥ 27, B1 `toBe(13)`; closed-set
  clozeUnsuitable list 19 → 22.
- `PER_LANGUAGE_GRAMMAR_MIN.TR` left as loose floors (A2 14 / B1 10 still
  satisfied at 27 / 13, matching the existing convention).

## Relationship to PR #532 (TR B2)

Independent PRs off `main`; both touch `tr.ts`, `theory-categories.*`, and
`curriculum.test.ts` (the TR count / clozeUnsuitable / version lines). Whichever
merges second needs a small rebase on those shared lines — no logical conflict
(disjoint points, additive counts).

## Verification

`pnpm build` → `typecheck` / `lint` / `test` (`turbo --concurrency=1`), all green.

## Out of scope

- The B2 cycle itself (PR #532).
- Any rescope of existing A1–B1 points; C1/C2; DE.
