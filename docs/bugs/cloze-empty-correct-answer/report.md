# Bug Report

## Bug Summary

One malformed draft anywhere in a 50-draft generation aborts the **entire** cell. Observed on 2026-05-12 when Claude emitted `correctAnswer: ""` on ordinal 13 of a `cloze` cell; `parseGeneratedClozeDraft` correctly rejected the empty string, but the throw bubbled up through `generateBatch` to `runOneCell`'s outer try/catch and terminal-failed the cell. The 13 valid drafts already generated for ordinals 0–12 were discarded; ordinals 14–49 never got a chance to generate. All ~13 Anthropic generation calls' worth of spend was wasted.

This bug is **separate from but shares the failure mode of** `.claude/bugs/vocab-recall-multi-word-rejected/`: a per-draft validation error becomes a whole-cell catastrophic failure. The underlying defect is loss-intolerance in the orchestrator; the cloze + vocab_recall validator quirks are just two symptoms.

## Bug Details

### Expected Behavior

A single malformed draft should be **logged, skipped, and counted** while the cell continues to produce the remaining drafts. With `MIN_PER_CELL = 25` and a `count = 50` generation, even losing 5–10 drafts to malformed output still satisfies the under-target check.

### Actual Behavior

The first malformed draft throws inside `generateBatch`'s for loop (`packages/ai/src/generate.ts:583-589`). The throw propagates to `runOneCell:385` (the `await generateBatch(client, spec)` site) and is caught by the outer `try/catch` at `runOneCell:382-456`, which calls `failClosed` — writing `status: 'failed'` to `generation_jobs`, zero rows to `exercises`, and emitting `cell terminal-failed` to CloudWatch.

### Steps to Reproduce

1. Enqueue a `cloze` (or any type) generation job that probabilistically yields a malformed draft — observed naturally on `cloze` cells during the post-PR-#76 DLQ redrive (2026-05-12).
2. Observe a Lambda log line of the shape:
   ```
   {"level":"warn","jobId":"58f8f79c-...","status":"failed",
    "errorMessage":"Draft ordinal=13 malformed: cloze draft:
     invalid correctAnswer: must be a non-empty string, got \"\"",
    "message":"cell terminal-failed"}
   ```
3. Inspect `generation_jobs.id = '58f8f79c-ef60-5422-8267-aa9e4eccdbbf'`: `status = 'failed'`, `approved_count = 0`. Inspect `exercises` for that cell: zero rows added.

Reproduced live on 2026-05-12 at 12:39:06 UTC. JobId `58f8f79c-ef60-5422-8267-aa9e4eccdbbf` — corresponds to the `58f8f79c` SQS message I peeked from the earlier DLQ sample.

### Environment

- **Version**: branch `main` post-`4b377ac` (PR #76 merged — SQS `MaximumConcurrency` cap added).
- **Platform**: AWS Lambda, generation pipeline.
- **Configuration**: Claude `claude-sonnet-4-6` via `@anthropic-ai/sdk`, tool-use schema enforces `correctAnswer: string` (no `minLength` declared) plus runtime check `correctAnswer.trim().length === 0` at `generate.ts:353-357`.

## Impact Assessment

### Severity

- [ ] Critical
- [ ] High
- [x] Medium
- [ ] Low

The pipeline doesn't crash; individual cells fail intermittently. But the loss is amplified — every malformed draft destroys ~25× the work that's actually wrong (one bad draft vs. the whole 50-draft attempt).

### Affected Users

All users — any language / level / type. The `cloze` type is the largest fraction of the curriculum (every grammar point × cloze), so it's the most exposed surface.

### Affected Features

- Generation pipeline reliability. Cells whose draft batch contains *any* malformed output fail entirely.
- Scheduler thrash: a cell that hits this failure stays below `MIN_PER_CELL = 25` and the daily scheduler re-enqueues it. The same probabilistic Claude misfire can recur indefinitely.
- Anthropic spend efficiency: average ~13 draft-generation calls (ordinals 0–12 in this observation) are paid for and discarded per failed cell. Generation calls are ~3 s each at ~$0.01 typical — small per cell, but consistent waste.

## Additional Context

### Architecture note (relevant to the fix)

`generateBatch` is misleadingly named: despite the singular "batch", it runs a **sequential per-ordinal for loop** of `client.messages.create` calls (`packages/ai/src/generate.ts:541-602`), not one batched API call. Each iteration generates exactly one draft. So a 50-draft cell pays for 50 sequential generation API calls plus 50 sequential validation calls in `validateAndInsertWithRetry` — 100 total round-trips, all serial. (Worth correcting the `tech-debt.md` "Per-draft validation loop" entry, which described this as one batched call.)

The relevance to this bug: each ordinal's generation is independent. There is no reason ordinal 13's failure should taint ordinals 14–49. The for loop's `throw` is the only thing coupling them.

### Error Messages

From CloudWatch `/aws/lambda/LanguageDrillStack-GenerationLambdaWrapHandler1113-...`, 2026-05-12T12:39:06 UTC:

```
{
  "level": "warn",
  "jobId": "58f8f79c-ef60-5422-8267-aa9e4eccdbbf",
  "status": "failed",
  "errorMessage": "Draft ordinal=13 malformed: cloze draft: invalid correctAnswer: must be a non-empty string, got \"\"",
  "message": "cell terminal-failed"
}
```

Validator throw at `packages/ai/src/generate.ts:353-357`:

```ts
if (correctAnswer.trim().length === 0) {
  throw new Error(
    `${ctx}: invalid correctAnswer: must contain non-whitespace characters`,
  );
}
```

Wrap site at `packages/ai/src/generate.ts:583-589` (turns the validator throw into the "Draft ordinal=N malformed: …" message):

```ts
let content: ExerciseContent;
try {
  content = parseToolInput(toolUseBlock.input, spec);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  throw new Error(`Draft ordinal=${ordinal} malformed: ${message}`);
}
```

The wrap converts the validator's `Error` into a contextualized one, then re-throws — escaping the for loop, then escaping `generateBatch`.

### Related Issues

- `.claude/bugs/vocab-recall-multi-word-rejected/` — same architectural failure mode, different validator constraint. Fixing one's symptom (relaxing a validator) does not fix the other; fixing the loss-intolerance root cause fixes both.
- `docs/tech-debt.md` "Per-draft validation loop" entry — needs amending; the serial pattern applies to generation too, not just validation, and parallelization should cover both halves.

## Initial Analysis

### Suspected Root Cause

`generateBatch`'s for loop uses a hard `throw` to surface per-ordinal failures, rather than an accumulator that records the failure and continues. There is no architectural reason to do so — each ordinal is independent. The throw was probably written to surface bugs loudly during development; in production, "loud" became "catastrophic."

The validator (`correctAnswer.trim().length === 0`) is doing its job correctly; the schema legitimately requires a non-empty correct answer. The defect is that the orchestrator treats a single bad output as a fatal signal.

### Fix Options (rough order of preference)

1. **Per-draft loss tolerance in `generateBatch` (recommended).** Catch the parse / wrap throw inside the for loop, log it with `{ ordinal, errorMessage }`, increment a `malformedDraftCount` field in the returned shape, and continue. `runOneCell` decides whether the cell is salvageable based on `drafts.length` vs. some floor (e.g. `count / 2`). Fixes both this bug and the `vocab_recall` bug simultaneously. Smallest blast radius once you accept that `generateBatch`'s return type grows a field.
2. **Per-draft retry on malformed.** Re-roll the malformed ordinal with the existing `runRetryGeneration` helper (`run-one-cell.ts:143-157`) before giving up on the slot. Higher cost; would mask intermittent Claude misfires that should be observed and counted.
3. **Tighten the tool schema** (e.g. add `minLength: 1` to `correctAnswer`). Belt-and-suspenders, but doesn't help — Anthropic tool-use does not strictly enforce schemas; this is *why* runtime validators exist. The defect is in fail-closed orchestration, not validator strictness.

### Affected Components

- `packages/ai/src/generate.ts` — `generateBatch` for loop (line 541-602); the wrap site at line 583-589 is where the catch needs to widen.
- `packages/ai/src/generate.ts` — `parseGeneratedClozeDraft`, `parseGeneratedTranslationDraft`, `parseGeneratedVocabRecallDraft`: leave the validators alone; they're correct.
- `packages/db/src/generation/run-one-cell.ts` — must decide what to do with a `malformedDraftCount > 0` batch. Simplest: log it, continue. More conservative: fail the cell if too few drafts survived.
- `packages/db/src/generation/run-one-cell.test.ts` — add a test case: malformed ordinal in the middle of a batch produces an `inserted` count of `count - 1` and a non-failed audit row.
- `packages/ai/src/generate.test.ts` — add a test: `generateBatch` with one malformed Claude response returns 49 drafts + a malformed counter, rather than throwing.

### Open Questions for `/bug-analyze`

- What's the right floor for "too few drafts survived"? Suggested heuristic: if `drafts.length < count / 2`, fail the cell; otherwise log + continue. But for `MIN_PER_CELL = 25`, any cell with ≥ 25 drafts is useful — so maybe the floor is 25, not `count / 2`.
- Should `malformedDraftCount` get its own column on `generation_jobs` for operational visibility, or only show up in the structured log?
- Should `vocab_recall`'s multi-word validator still be relaxed independently? My read: yes — the loss-tolerance fix prevents *catastrophic* failure but the umbrella's content (multi-word lexemes) genuinely should be accepted by `vocab_recall`. Two fixes, but the loss-tolerance one is upstream and should land first.
