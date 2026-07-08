# Finding: self-revealing targets (numbers, ordinals, concrete vocab) can't survive the spoilage veto — and collapse onto one exemplar

**Date:** 2026-07-07 (ES `2026-07-07` curriculum initial-fill run; TR confirmed same day)
**Status:** FIX IMPLEMENTED + EVAL PASSED (branch worktree-self-revealing-elicitation) — prod re-fill pending (post-merge ops checklist in the plan)
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

## Eval results (pre-merge, 2026-07-07)

`pnpm eval:gen` run `self-revealing-postfix` (summary JSON:
`packages/ai/eval-runs/self-revealing-postfix.json`): 5 cells (the table
above minus the already-covered vocab cells, plus ES/TR translation) × 8
drafts × 2 identical `repo` arms — both arms run the NEW pipeline; the run
measures the fixed pipeline's absolute quality on the previously failing
cells, against the prod baseline recorded above.

| Metric | Prod baseline (2026-07-07 run) | Post-fix eval |
|---|---|---|
| approval rate on these cells | 5–30% | **98.75%** (79/80 auto-approved) |
| `context-spoils-answer` rejections | dominant reason (14/20 on ES numbers cloze alone) | **1 in 80 drafts** |
| flagged | heavy (e.g. 18/30 on temporal-clauses) | 0 |
| parser failures | — | 0 |

Cost: $1.15. Acceptance criteria from the plan (context-spoils ≈ 0,
approval ≥ 50%/cell) met with wide margin. Caveat (noted in the plan): the
eval harness does not thread per-draft `seedWords`, so the run exercised the
generic digit-form directive; the pinned-value rotation is covered by unit
tests and gets verified in prod after the first post-merge nightly run.

## Addendum (2026-07-08): second variant — `base-word-cue` for derived forms

The same disease hit `es:b2:cloze:es-b2-appreciative-suffixes` in the
2026-07-08 run: **4/41 approved (10%)**, 23 `context-spoils-answer` rejects,
13 low-quality. A derived form (sillita, casucha, notición) cannot be
elicited without identifying its base word; with no sanctioned channel the
model improvised three cue styles — answer in the cue `(portazo)`, both
options `(portazo / puerta)`, or a base cue for a LEXICALIZED form
(`(puerta)` → portazo, which has a stem change) — two of which auto-fail
and the third of which the validator correctly rejects. Unseeded, the batch
also collapsed onto the curriculum example (portazo in 14/41 drafts).

Fix mirrors the digit-form machinery exactly (same flag, second variant):
`selfRevealingElicitation: 'base-word-cue'` + a curated
`elicitationSeedValues` pool of B&B ch. 43 **attested, transparent**
derivations only (no portazo/bolsillo/cajón lexicalized class). The
sanctioned elicitation is the parenthetical BASE word (`(silla)` →
sillita); the tested skill — choosing the suffix from the context's nuance
and forming it with the right allomorph/gender — is not revealed by the
base word. `seedKindFor` needed no change (it gates on flag truthiness).

Eval (`base-word-cue-verify`, 2 cells × 8 drafts × 2 identical repo arms):
**31/32 approved (96.9%)**, 1 context-spoils-answer, 0 flagged, $0.48.
Same caveat as above: the harness doesn't thread per-draft seedWords, so
the run exercised the generic directive; pinned rotation is unit-tested.
