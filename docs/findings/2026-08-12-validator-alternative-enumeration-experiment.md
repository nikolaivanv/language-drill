# Validator alternative-enumeration: a null result

**Date:** 2026-08-12
**Branch:** `feat/validator-alternative-enumeration`
**Spec:** `docs/superpowers/specs/2026-08-11-validator-alternative-enumeration-design.md`
**Raw data:** `docs/findings/2026-08-12-validator-alternative-enumeration-run.json`
(committed copy; the harness writes to the gitignored `packages/ai/eval-runs/`)
**Status:** experiment complete; the intervention it tested is **not recommended for merge**

---

## The question

Eight merged PRs (#606, #607, #611, #612, #614, #619, #625, #633) each fixed a defect
the generation validator had seen in full and approved at 0.85–0.9. The dominant
family shares one shape:

> a single stored `correctAnswer`, plus a second filler equally valid on the visible
> stem and absent from `acceptableAnswers`.

Each PR responded by adding a narrower rule to the `ambiguous` dimension. That does not
generalise — and `VALIDATION_SYSTEM_PROMPT_TEMPLATE` had 115 characters of headroom left
against its test ceiling, so the next frame-specific rule literally did not fit.

The hypothesis under test: the validator is asked a closed question ("is this
ambiguous?") and answers it without searching. Force the search — make it enumerate and
adjudicate candidate fillers *before* it emits the verdict — and it should catch more.
A second, independent lever: raise validator capability from `claude-sonnet-4-6` to
`claude-sonnet-5`.

## What was built

1. **`candidateFillers`**, a required **first** field on the cloze validation tool
   (`buildValidationTool`). The model lists 2–4 fillers and marks each `also-correct` or
   `ruled-out`, with a quoted span from the visible sentence required to justify
   `ruled-out`. Ordering is the mechanism: the search is emitted before the verdict.
   Built per exercise type so `sentence_construction` never receives it.
2. **Lenient parsing** — non-load-bearing, never throws, never vetoes a draft.
3. **A report-only self-consistency signal** — an `also-correct` filler absent from both
   `correctAnswer` and `acceptableAnswers` contradicts `ambiguous: false`; it appends a
   `flaggedReasons` note and changes nothing else.
4. **The prompt instruction** pointing dimension 2 at the new field.
5. **`VALIDATION_MODEL` → `claude-sonnet-5`**, with the request shaping Sonnet 5 requires
   (omit `temperature`, send explicit `thinking: {type: "disabled"}`, `max_tokens` 1024 → 2048).
6. **A labelled fixture + four-arm replay harness** to measure all of it.

## Method

31 hand-labelled cloze cases transcribed verbatim from the source PR bodies:
**20 `ambiguous`** (a genuine second answer, unlisted) and **11 `clean`** (well-formed;
the over-flagging control). Every label was independently audited; transcription was
verified against the PRs including diacritics.

Four arms, so prompt and model can never be confounded. Every arm renders an in-repo
template locally — Langfuse is never consulted (see Traps, below).

| Arm | Model | Prompt |
|---|---|---|
| `baseline` | sonnet-4-6 | pre-change |
| `prompt-only` | sonnet-4-6 | new |
| `model-only` | sonnet-5 | pre-change |
| `both` | sonnet-5 | new |

**Merge criterion, fixed in advance:** `both` must *strictly beat* `baseline` on recall
over the `ambiguous` bucket **without** raising the false-flag rate on `clean`. A recall
gain bought with over-flagging is a #606 repeat and does not ship.

## Results

124 calls, 0 errors, $3.27.

| Arm | Recall (ambiguous) | False-flag (clean) | Self-inconsistent | Cost |
|---|---|---|---|---|
| `baseline` | **70.0%** (14/20) | **18.2%** (2/11) | 1/31 | $0.742 |
| `prompt-only` | 65.0% (13/20) | 9.1% (1/11) | 2/31 | $0.741 |
| `model-only` | 60.0% (12/20) | 36.4% (4/11) | 2/31 | $0.886 |
| `both` | **65.0%** (13/20) | **18.2%** (2/11) | 1/31 | $0.903 |

**The criterion fails.** `both` recall 65.0% < baseline 70.0%. There is no gain to weigh
against anything.

### Attribution

- **The prompt alone** halved the false-flag rate (18.2% → 9.1%) and lost one catch. A
  trade, not a win.
- **The model alone was the worse change** — recall −10pp *and* false-flag **doubled**
  (18.2% → 36.4%). Sonnet 5 flagged twice as many known-good exercises as ambiguous.
  This is the opposite of the spec's premise that the validator is the cheap place to
  buy capability.
- **Combined**, the prompt's false-flag improvement is cancelled by the model's
  degradation.

### The power caveat — read this before citing any delta above

Every difference in the table is **one or two cases**. With n=20 ambiguous, one case is
5pp; with n=11 clean, one case is 9.1pp. `both` vs `baseline` on recall is a **single
case**. `prompt-only`'s false-flag improvement is a **single case**.

The defensible conclusion is therefore: **no arm demonstrates improvement, and the
instrument cannot resolve differences this small.** This is a null result, not a
demonstration of harm. Widening the fixture is a precondition for any finer claim.

## What the run did establish

These are config-independent, hold across all four arms, and are more actionable than
any delta above.

1. **Baseline recall is 70%.** The validator misses **6 of 20 known defects** before any
   change. The gap this work set out to close is real and substantially larger than
   either intervention moved it.
2. **False-flag on known-clean items is 18–36% in every configuration.** The validator
   wrongly marks 2–4 of 11 well-formed exercises ambiguous regardless of prompt or model.
   This is pre-existing, was neither caused nor fixed here, and is plausibly a bigger
   problem than the misses — it silently suppresses good exercises.
3. **`selfInconsistentRate` is 1–2/31.** Independent confirmation that the
   `correctAnswer` fix (below) works; pre-fix it would have fired on nearly every clean case.

## Traps this experiment hit

Recorded because each produced a plausible-looking wrong answer, and each was caught
only by running the thing rather than reading it.

**1. The design doc contained a logic error that both implementations faithfully reproduced.**
Spec Component 4 defined the predicate as "an `also-correct` filler not in
`acceptableAnswers`", while Component 1 instructed the model to enumerate `correctAnswer`
itself. `correctAnswer` is always `also-correct` and is never in `acceptableAnswers`
(that field holds *additional* answers; it is empty on all 31 fixture cases). So:

- the code signal fired on essentially every clean cloze — `selfInconsistentRate` would
  have measured "fraction of non-ambiguous verdicts", i.e. nothing;
- the prompt, read literally, said mark **every** cloze ambiguous — which blocks
  auto-approval and takes generation yield to zero. Exactly the #606 collapse the spec
  named as its top risk.

Six per-task reviews missed it because every test used a filler that was *not* the
correct answer. Fixed by making the accepted set `[correctAnswer, ...acceptableAnswers]`,
mirroring `fluency.ts`, and by rewording the prompt to "absent from BOTH".

**2. A smoke run can validate nothing while looking healthy.** The 2-case smoke run
reported `selfInconsistentRate: 0` across all arms. Both sampled cases were
`ambiguous`-labelled, so the consistency function returned at its first line and never
evaluated the predicate. One `clean` case would have exposed trap 1 immediately. Sample
the control bucket in smoke runs.

**3. The harness nearly measured the wrong prompt.** `buildValidationSystemPrompt`
resolves its body from Langfuse label `production`, which still holds the *pre-change*
prompt (the push is deliberately post-merge). The "new prompt" arms originally passed no
override, so a successful fetch would have served the old body — making them equivalent
to baseline and reporting "the prompt change does nothing". The first smoke run only
produced the right prompt because the Langfuse fetch **timed out at 250ms** and fell back
to the in-repo template. Fixed: every arm now renders an in-repo template locally and
Langfuse is never consulted.

**4. The opposite bias was present simultaneously.** The baseline arms were originally
handed the prior template **unrendered**, with literal `{{language}}` / `{{cefrLevel}}`
placeholders. That would have crippled the baseline arms and inflated the apparent
improvement. Traps 3 and 4 bias in *opposite* directions; either alone makes every
number meaningless.

**5. The control bucket could not be padded from the pool.** The `clean` bucket fell
short of its ~20 target at 11. The obvious remedy — sample approved production rows —
would have **contaminated the control**, because undetected defects in the approved pool
are the entire premise of this work; a sampled row the new validator correctly flags
would register as a false positive. A smaller honest fixture beats a padded one. The
cost is the resolution limit documented above.

## Recommendation

- **Do not merge** the prompt change or the model change on this evidence. Do not run
  `push-prompts`.
- **`VALIDATION_MODEL` is a code constant** — reverting it requires a deploy, not a
  Langfuse label re-point. That asymmetry argues for extra caution on the model change
  specifically, which is also the arm that measured worst.
- **The fixture and harness are independently valuable** and have now demonstrated they
  can catch a bad change. They should land regardless.
- **Widen the fixture** before drawing any finer conclusion. At 1-case-equals-5-to-9pp,
  the instrument cannot see the effects worth tuning for.

## Where this points next

The most informative result is not either delta — it is that both interventions were
roughly neutral while the validator's underlying failure rates are ~30% misses and
~20% false alarms on hand-labelled data.

Both interventions share a weakness: the reviewer can see `correctAnswer` while judging.
More prompt text and a stronger model do not remove the ability to rationalise toward a
visible answer. The **blind-solver pre-pass** does: show a fresh call only the rendered
stem and instructions, ask it to fill the blank, and compare. If it answers `dejaba` and
the row stores `deja`, the item is ambiguous — mechanically, with no rubric and no
enumeration to trust. This is the same information-asymmetry insight #612 applied to the
answer evaluator, and `qa:sample` already contains most of the machinery.

## Reproducing

```bash
# from the worktree root; packages/ai CLIs do not load .env themselves
cp /path/to/repo/.env .
./node_modules/.bin/dotenv -e .env -- \
  pnpm --filter @language-drill/ai eval:validator --max-cost-usd 6 --run-name full
```

~$3.27 for 124 calls (~$0.026/call). `--dry-run` prints the arm matrix and prompt SHAs
without spending anything; confirm each arm reports a repo-sourced prompt before trusting
any number.

> Note on the full test suite: root `pnpm test` fails under parallel load in this repo
> (lambda and ai both fail while passing standalone). Use
> `./node_modules/.bin/turbo test --concurrency=1` for a trustworthy gate.
