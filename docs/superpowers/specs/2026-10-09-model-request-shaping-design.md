# Model request shaping — design

**Date:** 2026-10-09
**Status:** approved design, pre-plan
**Scope:** `packages/ai` request construction for the surfaces we intend to
A/B on newer models, plus the eval tooling those A/Bs need. No production
model changes.

## Problem

Every Claude call site in `packages/ai` builds its own request. Four of them
carry inline copies of a per-model guard (omit `temperature`, send
`thinking: {type: "disabled"}`), and the copies have drifted:

- `evaluate.ts`, `validate.ts`, `free-writing-dedup.ts`, `qa-sample.ts`, with
  slightly different regexes;
- all four send `thinking: disabled` to Opus 5.x, which rejects it (observed
  2026-10-09: `"thinking.type.disabled" is not supported for this model`).

The newest models change more than that (per the claude-api skill's model
reference, cached 2026-09-25):

| Change | Opus 5.5 | Sonnet 5.5 |
|---|---|---|
| Forced `tool_choice` (`tool` / `any`) | 400 | 400 |
| `thinking: disabled` | 400 (always on; control via effort, default `medium`) | 400 (use `between_tools`, valid only at effort ≤ `high`) |
| Non-default `temperature` | 400 | 400 |
| Tokenizer | Opus 4.7+ tokenizer (~1–1.35× Sonnet 4.6 tokens) | same as Sonnet 5 |
| `stop_reason: "refusal"` | yes | yes |

Every A/B-candidate surface forces its tool, so none of them can run on a 5.5
model today. Haiku 4.5 is still the latest Haiku; nothing on Haiku moves.

Cost estimates are also single-price: `cost-model.ts` prices everything at
Sonnet 4.6 ($3 / $15), and its comment wrongly says Sonnet 5 lists at the same
price (current list price is $2 / $10). Cross-model cost comparisons would be
wrong.

## Goal

Any migrated surface can run on Opus 5.5 / Sonnet 5.5 (or stay on its current
model) by changing a model string, so per-surface A/Bs measure the model and
nothing else. For the models in use today, every migrated surface's request is
byte-identical to what it sends now.

## Section 1 — capability table and request shaper (`packages/ai/src/model-request.ts`)

### `MODEL_CAPABILITIES`

One row per family, matched in order against the model id. An unknown model
throws instead of guessing.

| Family (match) | Forced tool choice | Thinking "off" | Sampling params | Effort | Price in / out per MTok |
|---|---|---|---|---|---|
| Haiku 4.5 (`haiku-4-5`) | yes | omit `thinking` | yes | no | $1 / $5 |
| Sonnet 4.6 (`sonnet-4-6`) | yes | omit `thinking` | yes | yes | $3 / $15 |
| Opus 4.6 (`opus-4-6`) | yes | omit `thinking` | yes | yes | $5 / $25 |
| Opus 4.7 / 4.8 (`opus-4-7`, `opus-4-8`) | yes | omit `thinking` (omitting means no thinking on 4.7/4.8; today's Opus 4.8 surfaces send no `thinking` field) | no | yes | $5 / $25 |
| Sonnet 5 (`sonnet-5`, not `sonnet-5-5`) | yes | `{type: "disabled"}` | no | yes | $2 / $10 |
| Opus 5 (`opus-5`, not `opus-5-5`) | yes | `{type: "disabled"}` (effort ≤ `high`) | no | yes | $5 / $25 |
| Sonnet 5.5 (`sonnet-5-5`) | **no** | `{type: "between_tools"}` (effort ≤ `high`) | no | yes | $2 / $10 |
| Opus 5.5 (`opus-5-5`) | **no** | impossible → omit `thinking`, effort `low` | no | yes, default `medium` | $4 / $20 |

Fable models are out of scope (no surface uses them). Cache write is 1.25×
input and cache read 0.1× input for every row.

### `shapeToolRequest(model, intent)`

```ts
type ToolIntent = {
  tool: Anthropic.Tool;                 // the surface's tool, unchanged schema
  thinking: "off" | "adaptive";
  temperature?: number;                 // the surface's current value, if any
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
};
type ShapedToolRequest = {
  tools: Anthropic.Tool[];
  tool_choice: { type: "tool"; name: string } | { type: "auto" };
  thinking?: { type: "disabled" } | { type: "between_tools" } | { type: "adaptive" };
  temperature?: number;
  output_config?: { effort: string };
  systemSuffix?: string;                // only for families without forced tool choice
  mode: string;                         // one-line description for eval reports
};
```

- **Forced tool choice supported:** `tool_choice: {type: "tool", name}`, the
  tool unchanged.
- **Not supported (5.5):** `tool_choice: {type: "auto"}`, the tool with
  `strict: true` and its schema passed through `strictToolSchema`, and
  `systemSuffix = "Respond only by calling the <name> tool."`. Call sites
  append the suffix as its own system block **after** their cached block, so
  the cached prefix is unchanged.
- **Thinking "off":** per the table. Opus 5.5 omits `thinking` and sets effort
  `low` (unless the caller passed an effort). Sonnet 5.5 with `between_tools`
  requires effort ≤ `high`; a caller effort of `xhigh`/`max` with thinking "off"
  throws.
- **Effort:** on families that support it, sent only when the caller passes
  one, except Opus 5.5 with thinking "off" (see above). Never sent to Haiku.
- **Temperature:** sent only where sampling params are accepted.
- **Byte-identical rule:** for every model in use today, the shaped fields
  equal what the call site sends now.

## Section 2 — schema sanitizer, response extractor, migrations

### `strictToolSchema(schema)`

A pure deep transform, used only for families without forced tool choice:

- adds `additionalProperties: false` to every object schema;
- removes keywords strict mode rejects: `minimum`, `maximum`,
  `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minLength`,
  `maxLength`, `minItems`, `maxItems`, `uniqueItems`, `pattern`;
- keeps `enum`, `const`, `anyOf`, `allOf`, `required` and type unions.

Each surface's existing client-side parser stays the real gate. A test per
affected schema confirms the parser still rejects what a stripped keyword used
to forbid.

### `extractToolUse(response, toolName)`

Returns the matching `tool_use` block's input, or throws:

- `stop_reason: "refusal"` → `ContentRejectedError` (the existing class,
  generalized beyond the evaluate path; the evaluate route's mapping is
  unchanged);
- no matching `tool_use` block → new `NoToolCallError` with `stop_reason`.

Each surface keeps its current failure behaviour: generation reports a
malformed draft, validation a `validator-parse-failure`, evaluation a 502, and
so on. No new retries; the A/Bs measure the auto-mode skip rate first.

### Overrides

Every migrated surface accepts an optional `{ model?, effort? }` override
defaulting to its current model constant:

- `evaluate.ts` and `validate.ts` already have `modelOverride`; add `effort`;
- `GenerationSpec` gains `modelOverride?` / `effort?` (covers every pool type,
  including dictation and free writing);
- free-writing evaluation, the dedup judge, theory generation / validation and
  `qa-sample` gain the pair in their options.

Production code never passes an override.

### Migrated surfaces (8)

| File | Current model | Current thinking / temperature intent |
|---|---|---|
| `generate.ts` (`generateOneDraft`) | `GENERATION_MODEL` (Sonnet 4.6) | as today |
| `validate.ts` (`validateDraft`) | `VALIDATION_MODEL` (Sonnet 4.6) | as today |
| `evaluate.ts` | `claude-sonnet-5` | off, as today |
| `free-writing-evaluate.ts` | Sonnet 4.6 | as today |
| `free-writing-dedup.ts` | `FREE_WRITING_DEDUP_MODEL` (Opus 4.8) | off, temperature 0 where accepted |
| `theory-generate.ts` | `THEORY_GENERATION_MODEL` (Opus 4.8) | as today |
| `theory-validate.ts` | `THEORY_VALIDATION_MODEL` (Sonnet 4.6) | as today |
| `qa-sample.ts` | `QA_CRAFTER_MODEL` (Opus 4.8) | as today |

"As today" is recorded exactly in the byte-identical fixtures (below), not
paraphrased here. All four inline guards are deleted. The other call sites
(Haiku annotation, word hints, dictation grading, offline audits, proposers,
backfills, the reading generator, writing helpers, span annotation) are
untouched.

### Byte-identical guarantee

Before any code moves, a test captures each migrated surface's current request
(minus `messages` content) for its default model: `model`, `tools`,
`tool_choice`, `thinking`, `temperature`, `output_config`, `max_tokens` and the
system block structure. After migration, the same test builds the request
through the shaper and asserts deep equality with that fixture.

## Section 3 — pricing, eval flags, verification, rollout

### Model-aware pricing

- The capability table carries a price per family.
- `estimateCostUsdFor(model, usage)` prices actual token counts at that model's
  rates, so tokenizer differences are reflected automatically.
- The A/B scripts report each arm's cost at its actual model.
- `estimateCostUsd(usage)` (Sonnet 4.6 rates) stays as the production
  `generation_jobs.cost_usd_estimate` source; its stale comment is corrected.

### Eval flags

- `eval:gen`: `--candidate-model` and `--candidate-effort` change only the
  candidate arm's generator; both arms validate with the default validator.
- `eval-validator-run`: `--model`, `--effort`.
- `pnpm eval` and `eval:fw-dedup-judge`: add `--effort` next to their existing
  `--model`.
- Each run prints and records the shaper's `mode` string (e.g.
  `sonnet-5-5: tool_choice=auto+strict, thinking=between_tools, effort=low`).

### `pnpm verify:model-requests`

A CLI (`packages/ai/scripts/verify-model-requests.ts`, ~$0.10 per run) making
one small real call per family in use or under evaluation: Haiku 4.5,
Sonnet 4.6, Sonnet 5, Sonnet 5.5, Opus 4.8, Opus 5.5. Each call goes through
`shapeToolRequest` + `extractToolUse` with a tiny tool whose schema includes the
stripped keywords. It prints pass/fail per family with the `mode` string and
exits non-zero on any failure.

### Tests

- Capability lookup per family, the `sonnet-5` vs `sonnet-5-5` and `opus-5` vs
  `opus-5-5` distinctions, and an unknown model throwing.
- `shapeToolRequest` per family × thinking intent × effort, including the
  `between_tools` + `xhigh` throw.
- `strictToolSchema` on the real tool schemas from `generate.ts` and
  `validate.ts`, plus the parser-still-rejects tests.
- `extractToolUse`: tool use, refusal, no tool call, wrong tool name.
- Byte-identical fixtures per migrated surface.
- Flag parsing for the four eval CLIs.
- `estimateCostUsdFor` per family.

### Rollout

1. Merge. No production model changes.
2. Run `verify:model-requests` before and after merge.
3. One A/B per surface, each its own decision with an effort sweep and a cost
   quote first, in this order: validator, generator, answer evaluator, dedup
   judge, free-writing grading, theory.

## Out of scope

- The call sites not in the migrated list.
- Retries for auto-mode tool skips (measured first).
- Switching any production model.
- Fable models.
- Fixing `observability.ts`: feature attribution reads `tools[0].name`, which
  the shaper leaves intact.
