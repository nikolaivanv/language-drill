# Finding: self-revealing targets (numbers, ordinals, concrete vocab) can't survive the spoilage veto — and collapse onto one exemplar

**Date:** 2026-07-07 (ES `2026-07-07` curriculum initial-fill run; TR confirmed same day)
**Status:** FIX IMPLEMENTED (branch worktree-self-revealing-elicitation) — eval:gen + prod re-fill pending
**Surfaced by:** ES A1–B2 run analysis — `es:a1:cloze:es-a1-numbers-ordinals` approved 1/20 (5%); user then flagged TR A1 "far too many üçüncü", confirmed in prod

## Problem

Two distinct failure modes hit the same family of grammar points — those whose
target is **semantically self-revealing** (cardinal/ordinal numbers, concrete
vocab):

### 1. Structural spoilage (ES: near-total rejection)

To elicit *tercero*, the sentence context must somehow convey "third" — which
the validator's `contextSpoilsAnswer` veto then reads as giving the answer
away. The exercise is unwritable under the current contract:

- `es:a1:cloze:es-a1-numbers-ordinals`: 20 produced → **1 approved**, 18
  rejected, 14 of them `context-spoils-answer`. Approved pool after the run: **1**
  (below the <3 low-yield threshold → suppressed until the next
  `CURRICULUM_VERSION` bump).
- Same mechanic drives the A1 `vocab_recall` collapse (5 cells, 27.6% approval,
  37 `context-spoils-answer` rejections — elicitation context names/glosses the
  target word). Pools left at 2–4 approved per cell.
- `context-spoils-answer` was the **top rejection reason of the whole ES run**:
  363 of 659 rejections (281 cloze / 43 translation / 37 vocab_recall).

This is a *different* mechanism from the existing tech-debt entry "Generator
leaks the target form into the `context` field" (form-named TR points, model
echoes the suffix into `context`). There the leak is a compliance bug fixable
by stripping a field; here the semantic hint is **intrinsic to the task** —
no phrasing avoids it, so generation burns budget until retries exhaust.

### 2. Identity-space collapse (TR: bad diversity that DID get approved)

Where drafts *do* survive, the generator converges on one exemplar — the same
failure class as the conjugation okul/uçak collapse (see
`vocab_lemma`/conjugationSeedKind history):

- `tr-a1-numbers-ordinals` **translation**, 20 approved: **18 contain
  "üçüncü"** (7 of them "üçüncü kat(ta)" — third floor). Only 2 sentences use
  any other ordinal.
- `tr-a1-numbers-ordinals` **cloze**, 20 approved: only 4 distinct answers —
  üçüncü ×8, beşinci ×7, dördüncü ×3, birinci ×2. No *ikinci*, nothing above
  *beşinci*.
- ES shows the same smell where translation survived: repeated "trescientas
  mujeres / three hundred women" frames in `es-a1-numbers-ordinals`
  translations. The sentence-text `_dedupKey` doesn't catch template-level
  repetition.

## Planned fix (agreed direction)

Rework the cloze/vocab **elicitation guidance for inherently self-revealing
targets**, changing the generate and validate prompts **together** (PR #444
lesson: a generation-only structural fix is silently nullified if the validator
still rejects the new shape — mirror in `validation-prompts.ts`, bump both
`GENERATION_PROMPT_VERSION` and `VALIDATION_PROMPT_VERSION`):

1. **Digit-form prompts**: allow the sentence/citation hint to present the
   target in digit/symbol form and demand the written form — e.g. ES
   "3.º → *tercero*", TR "3. → *üçüncü*". The learner still produces the
   morphology (gender/apocope in ES: *tercer/tercero/tercera*; harmony in TR:
   *-IncI*), which is what the grammar point actually tests.
2. **Gloss-based elicitation** for vocab_recall: an L1 gloss or definition as
   the prompt, with the validator explicitly told that a digit/gloss prompt for
   these cells is the *intended elicitation*, **not** `contextSpoilsAnswer`.
3. **Identity-space floor** for number/ordinal cells: rotate/spread target
   values (coverage axis or seed-value rotation à la conjugation seed words) so
   the pool isn't 90% "üçüncü kat". Consider whether the Pool Coverage
   Controller (`coverageSpec`) is the right home.
4. Re-fill affected cells after the prompt change. The three ES cells below the
   low-yield threshold (`es-a1-numbers-ordinals` cloze, `es-a1-fw-a-day`,
   `es-a1-vocab-family-people`) are **suppressed** and won't re-run on a
   prompt-version bump alone — needs a `CURRICULUM_VERSION` bump or manual
   trigger. TR `tr-a1-numbers-ordinals` needs demote/regenerate of the
   collapsed approved rows, not just new generation (pool is at target, so the
   scheduler won't touch it).
5. Verify with `pnpm eval:gen` on the failing cells (baseline vs candidate
   prompt) before pushing to Langfuse — don't wait for the nightly scheduler.

## Affected cells (prod, 2026-07-07)

| Cell | Approval | Pool after run | Failure mode |
|---|---|---|---|
| es:a1:cloze:es-a1-numbers-ordinals | 5% | 1 (suppressed) | spoilage |
| es:a1:vocab_recall:* (5 cells) | 27.6% | 2–4 each | spoilage |
| es:a2:cloze:es-a2-temporal-clauses | 13% | 4 | spoilage (+known context-leak class) |
| tr:a1:cloze:tr-a1-numbers-ordinals | — | 20 (at target) | identity collapse |
| tr:a1:translation:tr-a1-numbers-ordinals | — | 20 (at target) | identity collapse (18/20 üçüncü) |
