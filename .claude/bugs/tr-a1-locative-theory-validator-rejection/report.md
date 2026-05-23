# Bug Report

## Bug Summary

Theory generation for `tr-a1-locative` (Locative case -DA, A1 Turkish) has been attempted twice — 2026-05-12 and 2026-05-22 — and both runs **technically succeeded** (Claude returned a draft, no transient error, no Lambda timeout) but the validator **rejected** the draft each time. No row was inserted into the theory content table, and the cell continues to look "needs generation" to the scheduler, so each daily sweep re-spends tokens reproducing the same outcome.

Today's spend on this single cell so far: **$0.085**. Today's pass is the second confirmed re-attempt; if left alone, the daily theory scheduler will keep re-running it indefinitely.

This is **not** a transient retry problem — both generation and validation completed cleanly. It is a content/prompt issue: either the generator can't produce a draft that passes the validator's current rules for this grammar point, or the validator is over-rejecting. Either way, throwing more tokens at it via the existing pipeline will not change the outcome. The right next move is the diagnostic workflow in [`docs/runbooks/prompt-update-and-revalidate.md`](../../../docs/runbooks/prompt-update-and-revalidate.md).

## Bug Details

### Expected Behavior

A first successful `tr-a1-locative` theory generation run inserts exactly one row into the theory content table (theory cells are cardinality 1 — see `packages/db/src/schema/theory.ts:97-103`), the audit row is written with `status='succeeded'` and `approved=true`, and subsequent scheduled sweeps skip this cell because the cell is filled.

### Actual Behavior

- Both runs (2026-05-12 and 2026-05-22) wrote `theory_generation_jobs` audit rows with `status='succeeded'` (generation + validation each completed without throwing), but the verdict booleans landed on `approved=false`, `rejected=true`.
- Zero rows were inserted into the theory content table.
- The cell remains unfilled, so the daily scheduler re-enqueues it, paying for a fresh generate + validate round-trip each day.
- Cumulative spend on this single cell today is **$0.085** (summed `cost_usd_estimate` across the day's `theory_generation_jobs` rows where `cell_key = 'tr-a1-locative'`).

### Steps to Reproduce

1. Ensure the `tr-a1-locative` cell is unfilled (no row in the theory content table for this cell key).
2. Trigger theory generation for the cell — either wait for the daily scheduled sweep, or invoke the CLI path with `trigger='cli'` (see `infra/lambda/src/theory-generation/handler.ts`).
3. The handler invokes Claude for generation, then Claude for validation; both complete cleanly.
4. Inspect `theory_generation_jobs` rows where `cell_key = 'tr-a1-locative'`, ordered by `started_at DESC`:
   - `status = 'succeeded'`
   - `approved = false`, `rejected = true`
   - `error_message` carries the validator's rejection reason (to be captured during analysis).
5. Inspect the theory content table — no row exists for `tr-a1-locative`.
6. Observe that the next scheduled sweep re-enqueues the same cell and reproduces the same outcome.

### Environment

- **Version**: `main`, recent. Theory prompts are at `theory-generate@2026-05-12` and `theory-validate@2026-05-12` (see `packages/ai/src/theory-prompts.ts:50` and `packages/ai/src/theory-validation-prompts.ts:74`). The Langfuse `production` label may point at a different revision — verify before assuming the in-repo fallback is what's live.
- **Platform**: AWS Lambda theory-generation pipeline (`infra/lambda/src/theory-generation/handler.ts`), production environment.
- **Cell**: `cell_key = 'tr-a1-locative'`. Grammar point definition at `packages/db/src/curriculum/tr.ts:65-79` — kind `grammar`, CEFR A1, Turkish, name "Locative case -DA".
- **Configuration**: Claude `claude-sonnet-4-6` via `@anthropic-ai/sdk`, theory prompts fetched from Langfuse with 5-minute cache (in-repo `THEORY_SYSTEM_PROMPT_TEMPLATE` / `THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE` are fallbacks only — see runbook §2A).

## Impact Assessment

### Severity

- [ ] Critical
- [ ] High
- [x] Medium
- [ ] Low

The pipeline is healthy; one cell is stuck. Impact is bounded but corrosive: a permanently unfilled foundational A1 Turkish grammar cell blocks any UX surface that surfaces theory pages for early Turkish learners, and the daily re-attempt burns tokens indefinitely. The pattern (deterministic rejection → daily retry → daily spend) is also a template for what could happen on other stuck cells, so the fix should generalize.

### Affected Users

All Turkish learners at A1 — the locative is one of the earliest case suffixes taught and any theory-surfacing UX (theory page, exercise context tooltip) will be missing it.

### Affected Features

- **Theory content for `tr-a1-locative`** — absent from the pool until this is resolved.
- **Daily theory scheduler spend** — burns ~$0.085/day on this single cell (today's measured number); cumulative cost grows linearly until the cell either succeeds or gets blacklisted. Multiply by the number of similarly stuck cells (unknown — see Investigation Hints).
- **Downstream Turkish A1 grammar coverage** — any cell whose UX relies on the existence of an `tr-a1-locative` theory page (e.g. exercises that link to the underlying rule explanation) degrades.

## Additional Context

### Why this is content, not transient

A transient failure looks like: 5xx from Anthropic, JSON parse error, schema mismatch, Lambda timeout. None of those happened — the audit row has `status='succeeded'` on both runs, which in this pipeline means the validator returned a structured verdict that simply landed on `rejected=true`. Two independent runs ten days apart producing the same verdict is the signature of either (a) the generator reliably emits a draft shape the validator will reject, or (b) the validator's rules for this grammar point are mis-tuned. Both are content/prompt fixes, not infrastructure fixes.

### Hypotheses worth ruling out during analysis

1. **Generator-side**: the locative explanation requires a four-way consonant + vowel harmony interaction (`-da/-de/-ta/-te`) plus a softening rule after voiceless stems. The generator may be producing examples that violate one of the validator's rubric items (e.g. an example that conflates harmony cases, or `examplesPositive` that don't cover the voiceless-stem softening rule the curriculum entry calls out at `packages/db/src/curriculum/tr.ts:69`).
2. **Validator-side**: the validator may be applying a generic rubric dimension (e.g. "examples must be unambiguous") in a way that's too strict for grammar points whose entire teaching value is *contrasting* shapes. If the validator's rejection reason cites ambiguity or contrast between the four `-DA` allomorphs, that's the smoking gun.
3. **Prompt mismatch between Langfuse and repo**: both prompts have repo-side version `@2026-05-12` — same date the first failure was observed. Worth checking whether the Langfuse `production`-labelled body was actually edited that day and whether the validator's strictness changed alongside the generator.

### Investigation hints for `/bug-analyze`

- Pull the two `theory_generation_jobs` rows for `cell_key = 'tr-a1-locative'`: capture `error_message`, `cost_usd_estimate`, `input_tokens_used`, `output_tokens_used`, and `started_at` for both runs.
- Pull the matching Langfuse traces for both runs — both generation and validation — and read the validator's per-dimension verdict and free-text rationale. **This is the key signal**: the verdict tells you whether the fix is generator-side, validator-side, or both.
- Diff the live Langfuse prompt bodies (`theory-generate-system-prompt`, `theory-validate-system-prompt`, label `production`) against the in-repo fallback templates. If they've diverged, that's the actual prompt the pipeline ran with.
- Count how many other cells are in the same state (`approved=false, rejected=true`, no content row, repeated daily retries). If this is a pattern, the fix should be a generalizable rubric/prompt change plus a `--blacklist` or backoff mechanism for repeatedly-rejected cells; if `tr-a1-locative` is unique, a targeted prompt edit may be enough.
- Once the diagnosis is in hand, follow [`docs/runbooks/prompt-update-and-revalidate.md`](../../../docs/runbooks/prompt-update-and-revalidate.md) §2A (prompt-only path) if the fix is wording-only, or §2B (schema-change path) if a new validator dimension is needed.

### Cost note

$0.085/day on one cell is small in absolute terms but is a daily annuity for as long as the cell stays stuck. The right framing for prioritization is not "is $0.085 worth fixing today" but "is this cell going to remain a permanent line item, and how many others look like it." Both questions get answered during `/bug-analyze`.

### Error Messages

Concrete `error_message` text and Langfuse trace excerpts have not yet been pulled — capturing them is the first action in `/bug-analyze`. The user has confirmed Langfuse access is available for that phase.

### Related

- [`docs/runbooks/prompt-update-and-revalidate.md`](../../../docs/runbooks/prompt-update-and-revalidate.md) — the runbook the user explicitly recommended; designed for exactly this generator-or-validator-misalignment shape.
- `packages/db/src/curriculum/tr.ts:65-79` — the curriculum definition the generator is working from.
- `packages/ai/src/theory-prompts.ts`, `packages/ai/src/theory-validation-prompts.ts` — in-repo fallback prompts; the live versions in Langfuse are the source of truth (see runbook §2A.1).
- `infra/lambda/src/theory-generation/handler.ts` — orchestration; the place the verdict gets persisted to `theory_generation_jobs`.
- `packages/db/src/schema/theory.ts:104-137` — `theory_generation_jobs` schema.
