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

> **⚠️ Superseded twice.** The run below used a 31-case fixture an independent
> audit later found unsound, and predates both the `content.instructions`
> discovery and the `#639` prompt change. **The numbers that stand are in
> "Five-arm run on the re-anchored instrument" at the end of this document** —
> where recall finally moved and the shipping decision was made. The two earlier
> runs are kept because their traps sections are what produced every subsequent
> correction, and because the contrast between them is itself the finding: the
> same intervention read null twice and positive once, purely because the
> instrument was wrong the first two times.

## Results (superseded — see the re-run)

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

---

# Re-run on the corrected instrument (2026-08-13)

**These are the numbers that stand.** Raw data:
`docs/findings/2026-08-12-validator-alternative-enumeration-run-corrected.json`.

Two things changed between the runs, both of which the first run's traps section
caused:

1. **`content.instructions` is now rendered for cloze** (commits `489953f0`,
   `187c71a1`). It never was before, while the validator was shown it — so the
   validator judged determinacy using text the learner could not see. Fixing that
   changed the ground truth for every case whose disambiguating cue lived in that
   field.
2. **The fixture was widened 31 → 82 and then corrected** against an independent
   audit and the new visibility rule. 33 cases edited, 13 relabelled (all
   `clean` → `ambiguous`), 0 dropped. Buckets: **53 `ambiguous` / 29 `clean`**.

Resolution improved ~2.6× on both axes: one ambiguous case is now 1.9pp (was 5pp),
one clean case 3.4pp (was 9.1pp).

## Results

328 calls, 0 errors, $9.16.

| Arm | Model | Prompt | Recall (n=53) | False-flag (n=29) | Self-inconsistent |
|---|---|---|---|---|---|
| `baseline` | sonnet-4-6 | prior | **60.4%** (32/53) | **13.8%** (4/29) | 1/82 |
| `prompt-only` | sonnet-4-6 | new | 60.4% (32/53) | 10.3% (3/29) | 5/82 |
| `model-only` | sonnet-5 | prior | 62.3% (33/53) | 10.3% (3/29) | 4/82 |
| `both` | sonnet-5 | new | **56.6%** (30/53) | **6.9%** (2/29) | 4/82 |

**The criterion fails again.** `both` recall 56.6% < baseline 60.4% (30/53 vs
32/53). No recall gain to weigh against the false-flag improvement.

## What the sharper instrument added

**A consistent mechanism, where the first run had only scattered 1-case deltas.**
Every intervention arm reduces false-flags (4→3, 4→3, 4→2) and none meaningfully
improves recall (32, 32, 33, 30). That is a **threshold shift, not a discrimination
improvement**: the enumeration prompt and the stronger model both make the validator
more conservative, and it gives up true positives at the same rate it saves false
positives.

The pre-registered criterion does not capture this. On a balanced measure
(recall − false-flag) every intervention edges baseline out — 50.1, 52.0, 49.7
against 46.6. So the honest verdict is **"no discrimination gain"**, not "made it
worse". The criterion asks specifically for a recall gain because recall is the
failure this project exists to fix; by that standard, nothing here earns a merge.

**Baseline got worse once the instrument got honest.** Recall fell from 70% on the
unsound fixture to **60.4%**. The validator misses **2 in 5 known-ambiguous items in
every configuration tested**. That is the headline finding, and neither prompt text
nor a stronger model moves it.

**False-flag is lower than the old fixture implied** (13.8% vs 18.2%), because the
poisoned `clean` cases moved to the bucket they belonged in. The validator
over-flags less than feared and under-detects more than feared.

**Self-inconsistency rose from 1/82 to 4-5/82** on the new-prompt arms — expected,
since `candidateFillers` is only populated there. At 5-6% it is a usable signal
rather than the near-total misfire the pre-`correctAnswer`-fix version would have
produced.

## Where this points

A ~40% miss rate that is invariant to both prompt and model is the signature of a
problem that is not about effort or capability. It is about **access**: the reviewer
can see the stored answer while judging it, so more instruction and more capability
both get spent rationalising toward that answer rather than searching away from it.

That is the one variable neither arm changed, and the one a **blind-solver pre-pass**
removes: show a fresh call only the rendered learner view, ask it to fill the blank,
and compare. `qa-sample`'s `renderLearnerView` + `craftProbeAnswers` already
implement most of it — and as of this branch that learner view is finally accurate
for cloze.

---

# Five-arm run on the re-anchored instrument (2026-08-13) — the result that shipped

**These supersede everything above.** Raw data:
`packages/ai/eval-runs/validator-blind.json`.

Three things changed since the previous run, all of which had to be fixed before
the numbers meant anything:

1. **The blind-solver arm was added** — it judges from the learner view alone and
   never sees `correctAnswer`.
2. **`main` was merged.** `#639` had changed the validator prompt to render
   `glossEn`, so the branch's "prior" template was a lineage production no longer
   used. The baseline fixture was re-anchored on `main`, moving the prompt SHAs
   `343acb0d → 22f5bfb9` (prior) and `9b65c3e8 → ec4f15ed` (current).
3. **A confound was removed.** `craftProbeAnswers` had no thinking guard, so the
   blind arm would have run with *adaptive thinking* while every sighted arm ran
   with thinking explicitly disabled — an effort difference on the exact axis this
   investigation claims is inert, plus a truncation path that would have silently
   dropped cases from the solver arm only.

## Results

82 cases (53 `ambiguous` / 29 `clean`), 410 calls, 0 errors, $10.09. All five arms
scored `n = 82`.

| Arm | Model | Prompt | Recall (n=53) | False-flag (n=29) | Cost |
|---|---|---|---|---|---|
| `baseline` | sonnet-4-6 | prior | 60.4% (32/53) | 17.2% (5/29) | $2.14 |
| `prompt-only` | sonnet-4-6 | new | 60.4% (32/53) | **6.9%** (2/29) | $2.12 |
| `model-only` | sonnet-5 | prior | 58.5% (31/53) | 13.8% (4/29) | $2.60 |
| `both` | sonnet-5 | new | **73.6%** (39/53) | 20.7% (6/29) | $2.65 |
| `blind-solver` | sonnet-5 | blind | 71.7% (38/53) | **41.4%** (12/29) | $0.59 |

## The criterion, honestly

Pre-registered: *recall meaningfully above 60.4% **without** false-flag rising
above ~13.8%*. `both` clears the recall bar decisively (+7 cases, +13.2pp) and
misses the false-flag bar by **one case** (5/29 → 6/29).

**By the letter, it fails.** That is recorded as-is rather than reinterpreted —
the point of pre-registering is to prevent exactly the post-hoc rewrite that a
near-miss invites. But the criterion was written to catch recall *bought with*
over-flagging (the #606 pattern). What happened is +7 recall for +1 false-flag: a
7:1 trade, not that pattern.

## The finding: the effect is superadditive

Neither change moves recall alone — `prompt-only` 32/53 and `model-only` 31/53,
against baseline's 32/53. **Together they reach 39/53.**

This also explains the two earlier null results. The previous run measured `both`
against the *pre-`#639`* prompt lineage and got 30/53. `candidateFillers` appears
to need the gloss-consistency rule underneath it to pay off — the enumeration step
is only useful once the validator can also see the gloss it is enumerating against.

Two null results were therefore not "the intervention does nothing" but "the
intervention does nothing *on that base*". That is only visible because the
instrument was re-anchored; on the old lineage the interaction was invisible.

## The blind solver: hypothesis directionally confirmed, not shippable

Recall 38/53 against baseline's 32 — **blindness genuinely finds ambiguity that
sighted review misses**, which is what the access hypothesis predicted, and it
does so at **$0.59, 4.5× cheaper** than any sighted arm.

But it flags **12 of 29 known-clean items**. Its discrimination (recall −
false-flag = 30.3) is the *worst* of all five arms, below baseline's 43.2. A
solver asked "is there another valid answer?" without knowing the intended one
will manufacture plausible alternatives for well-formed items — the failure mode
is structural, not a tuning problem.

So it is not a gate. Its plausible role is a cheap **pre-filter** feeding a sighted
second pass: at 4.5× cheaper with 72% recall, it could cut the population a
sighted validator has to examine, provided the second pass carries the precision.

## What shipped, and what did not

**Shipped: the prompt, on `claude-sonnet-4-6`.** `prompt-only` has the best
discrimination of any arm (53.5) — it cut false-flags from 5 to 2 while holding
recall exactly.

**Held back: the sonnet-5 upgrade**, and with it the +7-case recall gain, which
exists only in combination. The model is the costlier half to unwind — reverting
`VALIDATION_MODEL` needs a deploy, whereas the prompt reverts by re-pointing a
Langfuse label. Worth revisiting once the interaction is confirmed on a second run.

**Caveats.** One run, n=53 and n=29. A 7-case shift is the largest movement
observed across three runs but is not a confidence interval. `baseline` was stable
across the last two runs (60.4% recall both times; false-flag 4 → 5 cases), which
is mild evidence the fixture measures consistently.

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
