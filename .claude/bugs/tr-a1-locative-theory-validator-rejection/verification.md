# Bug Verification

## Diagnostic phase

The bug report's framing said "validator rejected the draft" but the actual `theory_generation_jobs` rows for `cell_key='tr:a1:tr-a1-locative'` (note: full key is `tr:a1:tr-a1-locative`, not just `tr-a1-locative`) revealed **three** runs, not two, with two distinct failure modes:

| started_at | trigger | status | rejected | cost USD | failure mode |
|---|---|---|---|---|---|
| 2026-05-12 23:08 | scheduled | succeeded | true | 0.0804 | validator rejected (error_message empty in DB) |
| 2026-05-18 04:00 | scheduled | failed | — | — | parser threw "Theory draft malformed: Invalid sections: must be a non-empty array, got "[\n…"" — generator returned `sections` field as a JSON-encoded string instead of an array |
| 2026-05-22 22:50 | cli | succeeded | true | 0.0854 | validator rejected (error_message empty in DB) |

The `error_message` field was empty for both rejected runs — a separate bug in `packages/db/src/theory-generation/run-one-cell.ts:301-313` where the `'rejected'` branch doesn't persist `decision.flaggedReasons` to the audit row. Theory generation also has no `withLlmTrace` instrumentation, so Langfuse held no trace data for theory runs (0 traces matching `name=generate-theory` or `tags=feature:generate-theory` in production Langfuse). The actual validator verdicts couldn't be recovered from either the DB or Langfuse — diagnosis required running a fresh probe.

### Probe results — pre-fix

Direct invocation of `generateTheoryTopic` + `validateTheoryDraft` against the live production prompt registry (1 sample):

```
decision: rejected
qualityScore: 0.65
factualErrors: 1   ← hard veto in router
  "In the conjugation table, the row for 'ütü' (iron) shows 'ütüde' …
   is incorrectly categorized as 'voiceless + front vowel' when it should be
   'voiced + front vowel' or simply 'vowel-final + front vowel'."
levelMismatch: True   ← would be a flag (not the reject trigger)
flaggedReasons: 4 entries about A1 level drift (future tense, present continuous, abstract usages)
```

Root cause: the generator produced a conjugation table that categorized **vowel-final stems** (`ütü`, `köşe`) under a "voiceless + front vowel" row — a real factual error the validator correctly caught.

## Fix

Three changes:

1. **`packages/ai/src/theory-prompts.ts`** — added an "Accuracy and level constraints" block to `THEORY_SYSTEM_PROMPT_TEMPLATE` with three rules: (a) all vocabulary and grammar must stay at or below the cell's CEFR level, (b) conjugation tables must NOT include a stem-classification column (categorization belongs in prose, not table cells that may not match the row data), (c) examples in "examples in context" must use only constructions available at the cell's CEFR level. Bumped `THEORY_GENERATION_PROMPT_VERSION` to `theory-generate@2026-05-23`.

2. **Langfuse production label** — pushed the same template body to `theory-generate-system-prompt` as version 3, labelled `production`, via `packages/db/scripts/push-theory-prompt-update.ts`. The runtime picks this up within 5 minutes (prompt cache TTL).

3. **`packages/shared/src/theory.ts`** — added defensive JSON parsing in `parseTheoryTopicJson`: if `sections` arrives as a string (Anthropic tool-use occasionally serializes nested arrays as JSON string literals), `JSON.parse` it once. Unparseable strings or strings that decode to non-arrays still throw the original error. Three new test cases in `packages/shared/src/theory.test.ts` pin the contract.

## Post-fix probe results (n=5)

```
seed=h dec=auto-approved  score=0.85  factual=0  levelMismatch=False
seed=i dec=auto-approved  score=0.85  factual=0  levelMismatch=False
seed=j dec=auto-approved  score=0.85  factual=0  levelMismatch=False
seed=k dec=auto-approved  score=0.85  factual=0  levelMismatch=False
seed=l CRASHED            (model serialized sections as string with invalid inner JSON — pre-existing
                           Anthropic-side output bug, defensive parser can only repair valid-JSON-strings)

Summary: 4 auto-approved, 0 rejected, 1 crash → 80% success rate per attempt.
```

Pre-fix: 0% chance of approval (deterministic reject). Post-fix: ~80% per-attempt approval. With the daily scheduler retrying any cell that lacks an approved row, the cell now fills within 1–2 days in expectation.

## Success criteria

- [x] A fresh `tr-a1-locative` theory generation run **can** complete with `approved=true` — demonstrated 4 times across 5 probes.
- [x] When approved, a row would be inserted into `theory_topics` — the routing decision is `auto-approved`, which is the branch in `run-one-cell.ts:374` that INSERTs.
- [x] The next scheduled sweep can succeed on the cell — same probabilistic argument.
- [N/A] Pool-revalidation: not applicable. Theory cells are 0-or-1 and the cell has no row to revalidate. The next scheduled run will pick up the new prompt automatically (5-min Langfuse cache TTL).

## Pre-push checks

```
pnpm lint        ✓ 6/6 packages
pnpm typecheck   ✓ 11/11 packages
pnpm test        134/134 shared (incl. 3 new defensive-parse tests)
                 47/47 ai theory-prompts / theory-generate / theory-validate
                 307/307 db (incl. theory-generation/routing)
                 Pre-existing unrelated failures:
                   - infra/test/stack.dev.test.ts: CDK stack synth hook timeout
                   - packages/ai/scripts/eval-export.test.ts: missing drizzle-orm transitive dep
                 Neither touches theory code or the files I changed.
```

## Out of scope — follow-ups to file separately

The investigation surfaced three orthogonal issues that should be tracked separately:

1. **`error_message` is not persisted on rejected verdicts.** `packages/db/src/theory-generation/run-one-cell.ts:301-313` UPDATEs the audit row without setting `errorMessage: decision.flaggedReasons.join('; ')`. This made the headline bug invisible until a probe was run — every future stuck cell will be equally opaque without this. One-line fix.

2. **Theory generation has no `withLlmTrace` instrumentation.** `infra/lambda/src/theory-generation/handler.ts` calls `generateTheoryTopic` and `validateTheoryDraft` directly without wrapping in `withLlmTrace`. Production Langfuse holds zero traces with `name=generate-theory` or `name=validate-theory`. The `LlmFeature` type already declares `'generate-theory' | 'validate-theory'` and `TOOL_NAME_TO_FEATURE` maps the theory tool names — the wiring is half-built. Adding `withLlmTrace` at the handler entry point is a small change that restores full visibility.

3. **No per-cell rejection backoff in the scheduler.** `infra/lambda/src/theory-generation/scheduler.ts` enqueues every curriculum cell that lacks an approved theory row. A deterministically-failing cell will be retried daily indefinitely, burning the cell's per-day token cost ($0.085 in this case) every day. A "exclude cells with N rejections in last M days" filter would cap the annuity and surface stuck cells for human review.

4. **Anthropic tool-use serializing `sections` as a string.** Empirically ~20% of theory generations even with the new prompt. Defensive parser handles the valid-inner-JSON cases; the cases with unescaped quotes inside string values can't be safely repaired. Worth tracking but the daily retry loop covers it for now.

All four are real but none gate the headline bug being closed.
