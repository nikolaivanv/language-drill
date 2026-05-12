# Bug Report

## Bug Summary

`parseGeneratedVocabRecallDraft` rejects any `vocab_recall` exercise whose `expectedWord` contains whitespace, throwing `vocab_recall draft: invalid expectedWord: must be a single token (no whitespace), got "<value>"`. Multi-word lexemes are common headwords in the active curriculum (e.g. Spanish `medio ambiente`, `cambio climático`, `efecto invernadero`), so a portion of every `vocab_recall` cell terminally fails generation while the rest of the batch succeeds.

## Bug Details

### Expected Behavior

`vocab_recall` exercises whose headword is a multi-word lexeme — explicitly listed in the curriculum's `examplesPositive` and already present in shipped seeds — should be accepted and inserted into the pool.

### Actual Behavior

The runtime draft parser rejects any `expectedWord` containing whitespace. The owning cell hits the `cell terminal-failed` path, writes a `failed` audit row, and produces no exercises for that draft ordinal. Cells that hit the failure on a single draft are lost entirely (the `runOneCell` flow aborts the cell on first malformed draft).

### Steps to Reproduce

1. Enqueue a `vocab_recall` generation job for `es-b1-environment-vocab` (or any vocab umbrella whose topical surface contains multi-word lexemes), e.g. by waiting for the daily scheduler at 04:00 UTC or by manually triggering via the CLI / DLQ redrive.
2. Observe the Lambda log:
   ```
   {"level":"warn","jobId":"...","status":"failed",
    "errorMessage":"Draft ordinal=8 malformed: vocab_recall draft:
     invalid expectedWord: must be a single token (no whitespace),
     got \"medio ambiente\"",
    "message":"cell terminal-failed"}
   ```
3. The `generation_jobs` row for that `jobId` is `status: 'failed'`; zero exercises land in the pool for that cell.

Reproduced live on **2026-05-12** during the post-timeout-bump DLQ redrive (PR #71): job `b6adbc77-11f1-52b7-b0cc-2b5b523b9fc6` for cell `es:b1:vocab_recall:es-b1-environment-vocab`.

### Environment

- **Version**: branch `main` post-`d3f3c48` (PR #71 merged — generation Lambda timeout bumped to 900 s).
- **Platform**: AWS Lambda (production), SQS, Drizzle on Neon.
- **Configuration**: Claude `claude-sonnet-4-6` via `@anthropic-ai/sdk`, tool-use schema enforces `expectedWord: string` with description "Must be a single token (no whitespace)".

## Impact Assessment

### Severity

- [ ] Critical - System unusable
- [ ] High - Major functionality broken
- [x] Medium - Feature impaired but workaround exists
- [ ] Low - Minor issue or cosmetic

Generation pipeline is otherwise healthy; only `vocab_recall` cells whose topical surface includes multi-word lexemes are blocked. Seeded multi-word exercises (e.g. `seed-exercises.ts:289: expectedWord: 'medio ambiente'`) already serve traffic, so the user-facing UI handles multi-token answers — the validator is the only blocker.

### Affected Users

All users whose active language is **Spanish** at B1+ (and any future language whose vocab curriculum names multi-word lexemes). Symptom is a thinner-than-target pool for those umbrellas; the user does not see an error directly.

### Affected Features

- Pool generation for `vocab_recall` × {`es-b1-environment-vocab`, `es-b2-abstract-noun-vocab`, and likely others}.
- Downstream: lower coverage → faster depletion → those cells stay below `MIN_PER_CELL = 25` indefinitely → scheduler keeps re-enqueuing them every day and they keep failing.

## Additional Context

### Error Messages

From CloudWatch (`/aws/lambda/LanguageDrillStack-GenerationLambdaWrapHandler1113-K7Fc0r82oQr4`), 11:30:18 UTC:

```
{
  "level": "warn",
  "jobId": "b6adbc77-11f1-52b7-b0cc-2b5b523b9fc6",
  "status": "failed",
  "errorMessage": "Draft ordinal=8 malformed: vocab_recall draft: invalid expectedWord: must be a single token (no whitespace), got \"medio ambiente\"",
  "message": "cell terminal-failed"
}
```

Throw site `packages/ai/src/generate.ts:447`:

```ts
if (expectedWord.trim().split(/\s+/).length !== 1) {
  throw new Error(
    `${ctx}: invalid expectedWord: must be a single token (no whitespace), got ${JSON.stringify(expectedWord)}`,
  );
}
```

The throw is caught in the `runOneCell` retry path and surfaced as a terminal `cell terminal-failed` audit row.

### Curriculum / seed contradiction

The same multi-word forms the validator rejects are:

- **Listed as positive curriculum examples** — `packages/db/src/curriculum/es.ts:392`:
  ```ts
  examplesPositive: ['el medio ambiente', 'la contaminación'],
  ```
- **Already shipped in seed exercises** — `packages/db/scripts/seed-exercises.ts:289`:
  ```ts
  expectedWord: 'medio ambiente',
  ```
  The seed path bypasses `parseGeneratedVocabRecallDraft`, so the seeded row reaches production unimpeded; only newly-AI-generated content trips the validator.

### Tool-schema instruction

Claude's tool schema description (generate.ts:179-183) does instruct "Must be a single token (no whitespace)", but the curriculum's topical surface (environment, climate, social issues) is dominated by multi-word lexemes. Tightening the prompt further would mean excluding genuine vocabulary; the constraint, not the prompt, is the misfit.

### Related Issues

- PR #71 (`d3f3c48`) — bumped generation Lambda timeout to 900 s and surfaced this bug. Pre-fix, the cell would silently DLQ on Lambda timeout; post-fix, the validator throw now correctly writes a `failed` audit row, which is how this report was triggered.
- Scheduler will re-enqueue this cell on every daily run (it stays under `MIN_PER_CELL`); each run will hard-fail in the same way until the validator is relaxed.

## Initial Analysis

### Suspected Root Cause

`parseGeneratedVocabRecallDraft` enforces a single-token constraint on `expectedWord` that the rest of the system (curriculum design, shipped seeds, UI grading) does not require. The constraint reflects an early simplification that has not aged well as the vocab curriculum grew to cover abstract / topical lexemes.

### Fix Options (rough order of preference)

1. **Relax the validator (recommended)** — allow whitespace in `expectedWord`. Normalize on insert and compare (`trim`, collapse internal whitespace, casefold) so user answers like `"Medio  ambiente "` still match. Verify the existing evaluator (`packages/ai/src/evaluate.ts`) and any web grading helper handle multi-token answers cleanly. Lowest blast radius.
2. **Tighten the prompt** — instruct Claude to skip multi-word headwords. Defeats the umbrella's intent for ES B1 / B2 environment + abstract-noun lists; would also require shrinking those umbrellas in curriculum.ts. Not recommended.
3. **Split the field** — add `expectedKey: string` (single token, deterministic id) + `expectedDisplay: string` (multi-word allowed). Most invasive; requires schema migration and consumer updates across UI + evaluator. Probably overkill for the current need.

### Affected Components

- `packages/ai/src/generate.ts` — `parseGeneratedVocabRecallDraft`: throw site (line 447) + tool schema description (line 182).
- `packages/ai/src/generate.test.ts` — needs a "multi-word expectedWord accepted" case.
- `packages/ai/src/evaluate.ts` — confirm answer comparison normalizes whitespace before matching.
- `packages/shared/src/index.ts` — `VocabRecallContent.expectedWord` typing already allows whitespace; no shape change needed.
- `packages/db/scripts/seed-exercises.ts` — already ships multi-word seeds; no change needed but worth using as a regression fixture.
- `apps/web` answer input / grading flow — verify it does not splat on whitespace.

### Open Questions for `/bug-analyze`

- How many of today's 34 DLQ-redriven jobs fail on this same validator (vs. fitting in 900 s but hitting some other terminal failure)? Need to wait for the drain to complete and tally the `cell terminal-failed` log lines.
- Are DE / TR umbrellas affected? DE uses compound nouns (typically single tokens — `Umwelt`, `Wohnung`), TR is agglutinating. ES is likely the only language with significant exposure, but worth checking the failed jobs from this batch.
- Does the prompt also need a positive nudge to *include* multi-word lexemes once the validator is relaxed, or will Claude naturally produce them given the curriculum examples?
