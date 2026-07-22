# QA Exercise Sampler (`pnpm qa:sample`) — Design

**Date:** 2026-07-22
**Status:** Approved (brainstorming) — ready for implementation planning
**Author:** nikolaivanv (+ Claude)

## Problem

The generation pipeline has static quality gates — the generation validator
(`validation-prompts.ts`, `routeValidationResult`) and `pnpm eval:gen` — but
**none of them close the loop through the answer-evaluation API**. Every current
check inspects an exercise *statically* ("is this well-formed, is the reference
answer right?"). Nothing exercises the real production evaluator
(`evaluateAnswer`) against the pooled content a user actually sees.

That gap hides a class of defect otherwise only found via user complaints:
**(exercise → evaluator) contract mismatches** — the exercise asks for X but the
evaluator rejects a correct X (false negative), accepts a wrong answer (false
positive), or rejects a legitimate alternative (`acceptableAnswers` gap). This is
the same "generate↔validate contract split" failure mode already seen in the
generation pipeline, relocated to the answer-evaluation boundary, and it is the
direct live measure of whether recent `acceptableAnswers` work (PR #600) actually
covers real alternatives.

## Goal

An **author-run CLI** (`pnpm qa:sample`) that spot-checks the approved exercise
pool: for a random sample of exercises, a strong QA LLM crafts three
intent-labeled answers, each is run through the **real production evaluator**, and
the tool flags exercises where the evaluator's verdict *contradicts* the QA LLM's
stated intent — plus a secondary learner-persona ambiguity note. Output is a
`./qa-runs/<name>.json` report. A **spotlight, not a gate.**

Built as a pure core + thin CLI wrapper so a nightly Lambda canary can wrap the
same core later with no rewrite, if the signal proves out.

## Non-goals (v1)

- Free-writing & dictation exercises (separate evaluators — `free-writing-evaluate.ts`,
  `dictation-eval.ts`; the crafted 3-answer probe fits open-ended production poorly).
- Automated gating / CI enforcement. The report is a triage spotlight; humans confirm.
- Auto-writing findings to the `exercise_flags` table or a Langfuse dataset/queue.
  v1 is a report file only. (Both are deferrable follow-ons.)
- Listening / reading exercise types.

## Scope: covered exercise types

Exactly the types routed through `evaluateAnswer` (one evaluator, one code path):
**cloze, translation, vocab-recall, sentence-construction, conjugation,
contextual-paraphrase.**

Sentence-construction is a deliberately high-value inclusion: its evaluator is
known to over-flag ambiguity (see the `sc-validator-overflags-ambiguous` memory),
so a probe where the crafted *correct* / *alternative* answers are failed measures
that over-flagging directly.

## Architecture

### Module boundaries

```
packages/ai/src/qa-sample.ts            — pure core (no @language-drill/db import, no process.exit)
  · craftProbeAnswers(client, input)    → { correct, wrong, alt, intents, confidence, ambiguityNote }
  · classifyVerdicts(perAnswer{score,intent}, confidence) → QaFlag[]   (pure; unit-tested)

packages/ai/scripts/qa-sample-run.ts    — CLI: parse args, read pool from db,
                                           resolve grounding, drive core, write report

infra/lambda/src/lib/evaluation-guidance.ts (new)  — resolveEvaluationGuidance(),
                                           EXTRACTED from routes/exercises.ts;
                                           the submit route AND the QA CLI both import it
```

- `qa-sample.ts` lives in `packages/ai/src/` and therefore **must not import
  `@language-drill/db`** (the `ai-db-build-cycle` rule — passes locally, fails CI
  TS2307). Curriculum grounding is passed *into* the core by the CLI, the same
  pattern `run-one-cell.ts` uses.
- `craftProbeAnswers` and `classifyVerdicts` are the testable units: one does the
  LLM I/O against an injected client, the other is a pure function.
- The CLI (`scripts/`) owns all real I/O: DB reads (it may import `@language-drill/db`,
  as the other eval scripts already do), the Anthropic client, and the file write.

### Why extract `resolveEvaluationGuidance`

`resolveEvaluationGuidance` currently lives **inline** in
`infra/lambda/src/routes/exercises.ts` (~line 110). It maps an exercise row
(`grammarPointKey`, `language`, `difficulty`) → `{ grammarGuidance,
attributionKeys }` via `getGrammarPoint` + `grammarPointsAtOrBelow`, and both the
submit and explain paths feed it to `evaluateAnswer`.

If the QA CLI hand-copies this logic and the route later changes, QA would
silently test a **different** evaluator input than production — invalidating the
entire signal. Extracting it to a shared helper that both the route and the CLI
import removes that drift risk. This is a targeted, behavior-preserving refactor
in service of the goal (not unrelated cleanup).

## Data flow

1. **SAMPLE** — CLI reads *approved* exercises from the DB (dev branch via `.env`
   by default; prod by overriding `DATABASE_URL` inline, as the other eval scripts
   do), filtered by `--language` / `--cefr` / optional `--type` / `--grammar-point`,
   grouped by `grammarPointKey`, taking a random `--per-point` (default 2) per
   group, capped by `--limit`. The exact sampled exercise IDs are logged so a run
   is auditable, and `--seed` makes sampling reproducible.
2. **GROUND** — For each exercise, call the shared `resolveEvaluationGuidance(row)`
   → `{ grammarGuidance, attributionKeys }`, byte-identical to what the submit
   route feeds the evaluator.
3. **CRAFT** — QA LLM (Opus 4.8) sees exactly the rendered user-facing prompt
   (**no reference answer shown**) and returns three answers with intents:
   - `correct` (+ self-reported `confidence` 0..1)
   - `wrong` (a plausible learner error)
   - `alt` (a legitimate alternative to `correct`; **null** when the type has a
     single canonical answer, e.g. some cloze)
   - `ambiguityNote` (learner-persona: "would a B1/B2 learner at this level know
     what is being asked?")
4. **EVALUATE** — Each non-null answer → `evaluateAnswer(client, { exercise,
   userAnswer, language, difficulty, grammarGuidance, attributionKeys })`, the real
   production path on the production model. 2–3 evaluator calls per exercise.
5. **CLASSIFY** — Pure `classifyVerdicts()` maps each answer's (score, intent) +
   `confidence(correct)` → flags via the score bands (see rules below).
6. **REPORT** — Aggregate → `./qa-runs/<name>.json`.

Concurrency-limited (`--concurrency`, default 4) and cost-capped (`--max-cost-usd`),
mirroring `eval:gen`.

## Probe & classification rules

### Deriving pass/fail from the evaluator

`EvaluationResult` has **no boolean** — the production submit path stores the
continuous `result.score` (scale 0–1) directly and feeds it to mastery; the
binary correct/partial/incorrect `outcome` exists only on the separate SM-2
*review* path (`SCORE_BY_OUTCOME`), which the main evaluator does not use. So the
QA classifier must define its own pass/fail derivation. This is the one genuinely
arbitrary knob in the design, so it is banded with a **dead zone** to keep noise
low, and the two thresholds are documented constants (tunable later):

- **PASS** — `score >= PASS_THRESHOLD` (default **0.8**, reusing the existing
  `FLUENCY_MASTERY_THRESHOLD` "counts as mastered/correct" line).
- **FAIL** — `score <= FAIL_THRESHOLD` (default **0.4**, clearly wrong).
- **Dead zone** `(0.4, 0.8)` — partial credit; **no flag**. A borderline score is
  a defensible judgment call, not a clear contract violation, so we don't flag it.

Only *clear* contradictions cross a band and get flagged. The evaluator's
`errors[]` (major/minor) and `feedback` are carried into the report verbatim for
triage but do not drive classification (keeps the signal one type-agnostic number).

### Classification

`classifyVerdicts` is pure: it takes, per answer, the numeric `score` and the
QA LLM's intent + `confidence(correct)`, applies the bands above, and emits flags.

| Answer    | Intent      | Score band | → Flag                                            |
|-----------|-------------|------------|---------------------------------------------------|
| `correct` | should pass | **FAIL** (`<= 0.4`) | `false_negative` (evaluator rejects a correct answer) |
| `wrong`   | should fail | **PASS** (`>= 0.8`) | `false_positive` (evaluator accepts a wrong answer)   |
| `alt`     | should pass | **FAIL** (`<= 0.4`) | `acceptable_answers_gap`                          |

(Answers landing in the dead zone produce no flag for that row.)

Secondary, **non-defect** (reported in its own section, never counted in defect
totals): `ambiguity_flag` — learner-persona bool + one-line reason.

### Guardrails against false flags (QA LLM wrong, not the evaluator)

- **Confidence gate:** if the QA LLM self-reports `confidence(correct) < 0.7`, do
  **not** raise `false_negative` / `acceptable_answers_gap` from that exercise (the
  ground truth is shaky). Instead record a `low_confidence_solve`, treated as an
  ambiguity signal — this is the "derive confusion from solver struggle" fallback.
- **Every flag is a candidate, never a gate.** Sampling + no-gate means a false
  flag costs triage time only; it never blocks generation. The human confirms.

## CLI surface

```
pnpm qa:sample --language tr --cefr A1 [--per-point 2] [--grammar-point <key>]
               [--type cloze,translation] [--limit N] [--concurrency 4]
               [--max-cost-usd 5] [--model claude-opus-4-8] [--out <name>]
               [--seed <int>] [--dry-run]
```

- **Pool:** approved exercises only (what users actually see).
- **Model:** QA answer-crafter defaults to **Opus 4.8** — a strong solver makes the
  `correct` / `alt` ground truth trustworthy and keeps the false-flag rate low. The
  evaluator stays on its production model, unchanged (we are testing *it*).
  `--model` overrides only the crafter.
- **Cost:** hard `--max-cost-usd` cap — stop sampling when projected spend would
  exceed it; the report records actual spend. Cost per exercise = 1 Opus craft +
  ≤3 production-model evaluator calls.
- **`--dry-run`:** sample + render prompts + print a cost estimate **without**
  calling Claude, for cheap wiring checks.

## Report schema (`./qa-runs/<name>.json`)

```jsonc
{
  "meta": { "language", "cefr", "perPoint", "sampledCount", "seed", "model", "costUsd", "startedAt" },
  "summary": {
    "sampled": 40, "flagged": 6,
    "byReason": { "false_negative": 2, "false_positive": 1, "acceptable_answers_gap": 3 },
    "byType":   { "cloze": 3, "sentence_construction": 3 },
    "ambiguityNotes": 5, "lowConfidenceSolves": 2
  },
  "flags": [
    { "exerciseId", "grammarPointKey", "type", "language", "cefr", "reason",
      "answers":  { "correct", "wrong", "alt" },
      "intents", "confidence",
      "verdicts": { /* per answer: score (0-1), band (pass|fail|deadzone), errors[], feedback */ },
      "promptSeen": "…the exact user-facing render…" }
  ],
  "ambiguity": [ { "exerciseId", "note" } ],            // secondary section
  "errors":    [ { "exerciseId", "stage", "message" } ] // craft/eval failures, non-fatal
}
```

`startedAt` is stamped by the CLI from wall-clock time (not inside any workflow
sandbox that forbids `Date.now()`).

## Testing

- **`classifyVerdicts`** — pure, exhaustive unit tests over every (answer, intent,
  verdict) combination, including the confidence-gate downgrade and the null-`alt`
  skip. This is the correctness core.
- **`craftProbeAnswers`** — tested against a mocked Anthropic client (fixture
  responses); asserts we parse intents/confidence correctly and that the crafted
  prompt **never leaks the reference answer**.
- **Extracted `resolveEvaluationGuidance`** — a characterization test pinning that
  the extracted helper returns output identical to the pre-extraction inline
  version, so the refactor is provably behavior-preserving; the route keeps its
  existing coverage.
- **CLI script** — light; exercised via `--dry-run` (sample + render + estimate,
  no Claude calls).

## Follow-ons (post-v1, if signal proves out)

- Promote the pure core into a nightly EventBridge-scheduled Lambda canary.
- Route confirmed flags into the existing `exercise_flags` table (needs a `source`
  column + nullable `submissionId`) so they surface in the admin flag-review UI,
  or into a Langfuse annotation queue.
- Extend to free-writing / dictation with per-type probe shapes.
```
