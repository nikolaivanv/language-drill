# Evaluator attribution coverage — measured 2026-09-22

Follow-up to the item parked in PR #732, which reported that "~40% of stored
grammar errors carry a null `error_grammar_point_key`" and guessed at an
evaluator-prompt coverage gap. **That framing was wrong.** This is what the
data actually says, so the question does not get re-litigated from the same
bad premise.

## The 40% was an artifact of pooling pre-attribution history

Per-error attribution shipped in PR #400. Rows written before it are null by
construction — the schema comment still reads "Null until Phase 3 fills it".
Pooling those with current rows produced the 40% headline.

| month | grammar errors | null | % null |
|---|---|---|---|
| 2026-05 | 27 | 27 | **100.0%** ← pre-#400, null by construction |
| 2026-06 | 53 | 32 | 60.4% ← early rollout |
| 2026-07 | 65 | 7 | 10.8% |
| 2026-08 | 52 | 15 | 28.8% |
| 2026-09 | 25 | 7 | 28.0% |

Current rate is ~28%, not 40%, and a third of the "defect" is history that no
prompt change can reach.

## Hypotheses tested and rejected

**"The in-scope list is too long to scan."** Rejected. The list is
`grammarPointsAtOrBelow(language, difficulty)`: TR A1 = 28 points / 1,582
chars, ES B2 = 119 points / 7,913 chars. The **worst** null rate (TR A1,
49.6%) is on the **shortest** list; ES A1 (25 points) is 0%.

**"The host point is outside the closed attribution set, so the prompt's 'use
only keys from that list' forces a null."** Rejected outright: the host point
was in scope in **88/88** cases.

**"The prompt frames attribution as optional and never hands over the drilled
point's key, so the model must name→key match."** Both observations are true —
`buildGrammarGuidanceBlock` names the point but omits its key, and the clause
said "that error's optional **grammarPointKey**" — but fixing them changed
nothing measurable. See below.

## The paired A/B, and why nothing shipped from it

Replayed the real prod submissions that produced a null grammar attribution
through `evaluateAnswer` with `systemPromptOverride`, single-variable:

- **baseline** — current system prompt with item 6 swapped back to the old
  sentence, guidance passed *without* `key` (reproduces the old reference
  block byte-for-byte)
- **candidate** — attribution made mandatory-when-applicable + the drilled
  point's key rendered as the default candidate

40 grammar probes + 20 non-grammar controls, 2 arms, run twice:

| run | baseline | candidate |
|---|---|---|
| 1 | 85.4% (35/41) | 79.5% (35/44) |
| 2 | 70.5% (31/44) | 65.9% (29/44) |

**The same arm moved 85.4% → 70.5% between two identical runs** — a 15pp swing,
roughly 3× the between-arm gap (5.9pp, 4.6pp). The between-arm difference is
noise, and the candidate was *below* baseline in both runs. The prompt change
was reverted rather than shipped: it had no measured benefit and would have
cost a `push-prompts` run per environment plus a broken `promptVersion` cohort.

Two further findings from the same runs:

- The **live** prompt attributes ~70–85% of grammar errors on submissions
  *selected for having produced a null*. There is no large systematic gap left
  to close by prompting.
- Non-grammar controls stayed unattributed in both arms (0 attributed), so
  PR #732's inference — a null on a vocabulary/spelling error means "about no
  grammar point" — holds under both prompts.

## What the residual actually is

The Aug–Sep nulls are mostly **incidental** errors about a point *other* than
the one being drilled — `divertido → divertida` (gender agreement) under a
nominalizers exercise, `llamarle → llamarla` (leísmo) under past-narration,
`la carta → una carta` (article use) under que-vs-cuál. So "check the drilled
point's key first" is the wrong lever for this residual; if anything it biases
toward the host. The rest splits into genuinely unattributable errors (pure
word order; a rule with no curriculum point, e.g. the Turkish aorist at A1)
and typos mislabelled `type: "grammar"`.

## What did ship

1. **Conjugation errors now carry attribution.** The deterministic conjugation
   branch in `routes/exercises.ts` synthesizes its `EvaluationError` by hand
   and left `grammarPointKey` unset, so every conjugation error that reached
   `error_observations` (via the history backfill) was null-attributed: 3 of 3
   rows. A conjugation drill tests exactly one point and the error *is* that
   form, so the host key is unambiguous — no model involved, no measurement
   needed.

2. **`eval-run.ts` can now see attribution.** The harness measured score /
   grammarAccuracy / taskAchievement / errorCount / CEFR / cost / latency and
   nothing about attribution, so it was structurally blind to this defect
   class. `attributionStats` reports per-arm grammar-error attribution
   coverage and a `pp` delta, counting only `type: "grammar"` errors so a
   correctly-null lexical slip is not scored as a miss.

## If this is revisited

Run `pnpm eval` with the new `attribution` row rather than a bespoke script,
and size the run off the variance measured here: detecting a 5pp effect needs
far more than 40 items × 1 repeat. Restrict the dataset to rows written after
2026-07-01 so pre-#400 history cannot dilute the baseline.
