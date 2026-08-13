# Blind-solver arm: measure whether hiding the answer finds what effort cannot

**Date:** 2026-08-13
**Status:** approved, pending implementation
**Surface:** `packages/ai/scripts/eval-validator-run.ts` (+ a small pure module)
**Related:** `docs/findings/2026-08-12-validator-alternative-enumeration-experiment.md`

---

## Problem

Four configurations of the cloze validator were measured against 82 hand-labelled,
independently-audited cases (53 `ambiguous` / 29 `clean`):

| Arm | Model | Prompt | Recall | False-flag |
|---|---|---|---|---|
| `baseline` | sonnet-4-6 | prior | 60.4% (32/53) | 13.8% (4/29) |
| `prompt-only` | sonnet-4-6 | new | 60.4% (32/53) | 10.3% (3/29) |
| `model-only` | sonnet-5 | prior | 62.3% (33/53) | 10.3% (3/29) |
| `both` | sonnet-5 | new | 56.6% (30/53) | 6.9% (2/29) |

**Recall did not move.** 30-33 of 53 across every configuration. Adding a forced
enumeration step to the prompt did nothing; upgrading the model did nothing. What
did move was the flag *rate* — every intervention cut false-flags — which is a
threshold shift, not a discrimination improvement.

A miss rate invariant to both instruction and capability is not an effort problem.
The hypothesis this spec tests: **it is an access problem.** The validator is shown
`correctAnswer` and `acceptableAnswers` while judging, so more instruction and more
capability are both spent rationalising toward a visible answer rather than
searching away from it. Every arm so far has varied how hard the reviewer thinks;
none has varied what it can see.

This is the same insight PR #612 applied to the *evaluator* ("the learner didn't see
this — don't invent context to defend the reference"). It has never been applied to
the validator.

## Goal

Measure whether a reviewer that **cannot see the stored answer** discriminates
ambiguous from clean better than the four sighted configurations, on the same 82
cases and the same two metrics.

## Non-goals

- Wiring anything into `validateDraft` or the generation pipeline. This is a fifth
  measurement arm, nothing more.
- Replacing the validator. The blind solver answers only the ambiguity question
  (see Limits).
- Tuning a threshold. The chosen signal is a set-membership test precisely so there
  is no free parameter to fit on the cases we are measuring against.

## Design

### The signal

`qa-sample`'s crafter already emits what is needed. Given only a learner view it
returns `{correct, correctConfidence, wrong, alt, ambiguous, ambiguityNote}`, where
`alt` is "a DIFFERENT but equally-correct answer (a distinct construction or true
synonym), if one legitimately exists; otherwise null".

The arm's verdict is a pure function:

```
ambiguous  ⟺  probe.alt !== null
               && !listed(probe.alt, [correctAnswer, ...acceptableAnswers])
```

`listed()` is the existing case- and whitespace-insensitive comparison used by
`applyCandidateFillerConsistency` — reuse it, do not write a second one.

This is the most direct translation of the fixture's own definition of `ambiguous`
("a second filler is fully correct on what the learner sees and is absent from
`correctAnswer` + `acceptableAnswers`"), which keeps recall and false-flag directly
comparable to the other four arms.

`correctConfidence` and the crafter's own `ambiguous` flag are recorded in the
per-case output but **do not** drive the verdict. They are free observations that
cost nothing and may inform a later design; making them decide anything now would
introduce a threshold to tune.

### Two decisions that would silently invalidate the comparison

**1. The solver must not see `options`.** `renderLearnerView` currently appends
`Options: …` for cloze. But `showOptions` defaults to `false` behind a toggle
(`cloze-exercise.tsx:54`), and the fixture was labelled under exactly that rule —
its `_visibilityRule` states `instructions`, `context`, `sentence`, `glossEn` are
visible and `options` are not. A solver shown options answers a different question
than the one the labels encode.

Add a cloze-only option to omit them rather than editing `renderLearnerView`'s
behavior for its existing `qa:sample` caller.

**2. The solver runs on `claude-sonnet-5`, not the crafter's Opus default.**
`QA_CRAFTER_MODEL` is `claude-opus-4-8`. Matching the `both` arm's model isolates
the variable under test — blind versus sighted — instead of confounding it with a
capability change. A win on Opus would not tell us which change produced it.

### Placement

A fifth entry in the harness's `ARMS`, distinguished by kind rather than by
overrides, because it does not call `validateDraft` at all:

```ts
{ name: "blind-solver", kind: "solver", modelOverride: "claude-sonnet-5" }
```

The existing four keep `kind: "validator"`. The executor branches on `kind`; every
other arm's behavior is byte-identical to today.

### Metrics

`computeArmMetrics` is unchanged — the solver arm produces the same
`{ambiguous: boolean}` shape per case, so recall and false-flag are computed
identically.

`selfInconsistentRate` is structurally undefined for this arm (it has no
`flaggedReasons`). Report it as `null`, not `0` — a zero would read as "measured and
found none" when the correct statement is "not applicable".

## Limits

The blind solver emits **only** an ambiguity verdict. It produces no `qualityScore`,
`levelMatch`, `grammarPointMatch`, `contextSpoilsAnswer`, or `culturalIssues`. So
even a decisive win makes it a candidate **pre-pass or additional signal**, never a
drop-in validator replacement. Any future production design keeps the LLM validator
for the other six dimensions.

## Success criterion (pre-registered)

**Recall meaningfully above 60.4% (32/53) without false-flag rising above ~13.8%
(4/29).**

At the corrected fixture's resolution one ambiguous case is 1.9pp and one clean case
3.4pp, so "meaningfully" means a gap of several cases, not one. Concretely: **40+ of
53 would be the first real signal in this investigation.**

A null result here is also informative, and should be reported as such rather than
buried: if a blind reviewer *also* lands at ~32/53, the misses are not about access
either, and the next hypothesis has to be that the fixture's harder cases require
knowledge the model does not have — a different problem entirely.

## Cost

82 additional calls, ~$2.50 at Sonnet 5 rates; a full five-arm run ~$11.50.

The harness currently writes its summary only at completion — two long runs were
killed and lost their spend entirely. **Add per-arm checkpointing before running
five arms**, or run the solver arm alone against a recorded baseline.

## Testing

- `blindSolverVerdict(probe, content)` is pure: table-driven tests for alt-null,
  alt-listed-in-`correctAnswer`, alt-listed-in-`acceptableAnswers`, alt-unlisted,
  and case/whitespace-insensitive matching. No mocking needed.
- The learner view for a cloze case **omits options and includes instructions** —
  assert on the rendered string directly.
- The solver arm calls `craftProbeAnswers` with `model: "claude-sonnet-5"` — assert
  against the captured request, not a reconstructed one.
- The four existing arms are unchanged — assert their `ARMS` entries still carry
  `kind: "validator"` and their existing model/prompt pinning.
- `--dry-run` lists five arms and makes zero calls.

## Sequencing dependency

`#639` landed on `main` after this branch diverged. It modified
`packages/ai/src/validation-prompts.ts` and bumped `VALIDATION_PROMPT_VERSION` to
`validate@2026-08-12`, and it changed the validator's user prompt to render
`glossEn`. **The four validator arms' "prior" template therefore no longer
represents `main`.** Their comparison remains internally valid — all four used one
lineage — but the baseline is no longer the thing production would be replacing.

So: rebase this branch on `main` and re-run the four validator arms before treating
any five-arm comparison as current. The blind-solver arm itself is insulated (it
uses the `qa-sample` prompt, which `#639` did not touch), so it can be built and
unit-tested before the rebase — only the cross-arm comparison has to wait.
