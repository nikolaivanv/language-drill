# Model Request Shaping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the eight A/B-candidate Claude call sites in `packages/ai` run on Opus 5.5 / Sonnet 5.5 (or stay on their current models) by changing a model string, with today's requests byte-identical, plus the eval flags and model-aware costs the per-surface A/Bs need.

**Architecture:**
- A new `packages/ai/src/model-request.ts` holds:
  - a per-family capability table;
  - `shapeToolRequest` (turns "force this tool, thinking off, temperature T" into a request the model accepts);
  - `strictToolSchema` (sanitizes a schema for strict mode);
  - `extractToolUse` (returns tool input or throws typed refusal / no-tool-call errors).
- Each migrated call site keeps calling `client.messages.create` itself and spreads in the shaped fields; its four inline per-model guards are deleted.
- Request-shape snapshots taken **before** any code moves prove the migration changes nothing for today's models.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk` ^0.91.1, Vitest (snapshots), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-09-model-request-shaping-design.md`

## Global Constraints

- **Worktree:** all work happens in `/Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping` (branch `feat/model-request-shaping`).
  - Every Read/Edit/Write path is absolute with that prefix; never touch `/Users/seal/dev/language-drill/packages/...` (the main checkout).
  - Every Bash command starts with `cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping && …`.
  - Before every commit, run `[ "$(git branch --show-current)" = feat/model-request-shaping ]`.
- **First-time setup:** `pnpm install && pnpm build` before any vitest. Rebuild `@language-drill/ai` before running `@language-drill/db` or lambda tests.
- **Gate per package** (the full root `pnpm test` gets OOM-killed): `pnpm --filter @language-drill/<pkg> lint`, `typecheck`, `test`. Script tests run with `cd packages/ai && pnpm exec vitest run scripts/<file>`. Run db and lambda tests with `env -u DATABASE_URL`; before lambda tests, run `rm -rf infra/lambda/dist`.
- **No real Claude calls from subagents.** Only the controller runs `verify:model-requests`.
- **Byte-identical rule:** for every migrated surface's current default model, the request's `model`, `max_tokens`, `system` structure, `tools` (name, schema, absence of `strict`), `tool_choice`, `temperature`, `thinking` and `output_config` must match the Task 1 snapshots exactly. Never update a Task 1 snapshot (`-u`) after Task 1; a snapshot mismatch means the migration is wrong.
- **Capability table** (exact):

  | Family | Match | Forced tool | Thinking "off" | Sampling | Effort | $ in / out per MTok |
  |---|---|---|---|---|---|---|
  | `haiku-4-5` | `/haiku-4-5/` | yes | omit | yes | no | 1 / 5 |
  | `sonnet-4-6` | `/sonnet-4-6/` | yes | omit | yes | yes | 3 / 15 |
  | `opus-4-6` | `/opus-4-6/` | yes | omit | yes | yes | 5 / 25 |
  | `opus-4-7-8` | `/opus-4-[78]/` | yes | omit | no | yes | 5 / 25 |
  | `sonnet-5-5` | `/sonnet-5-5/` | **no** | `between_tools` | no | yes | 2 / 10 |
  | `sonnet-5` | `/sonnet-5(?!-5)/` | yes | `disabled` | no | yes | 2 / 10 |
  | `opus-5-5` | `/opus-5-5/` | **no** | omit + effort `low` | no | yes | 4 / 20 |
  | `opus-5` | `/opus-5(?!-5)/` | yes | `disabled` | no | yes | 5 / 25 |

  Cache write is 1.25× input and cache read 0.1× input for every family. An unknown model throws `Error("No model capabilities for <model>")`.
- **Thinking "off" constraints:** `between_tools` (Sonnet 5.5) and `disabled` (Opus 5) are invalid with effort `xhigh`/`max`; throw. Opus 5.5 "off" sets effort `low` unless the caller gave one.
- **Strict schemas** (families without forced tool choice only):
  - add `additionalProperties: false` to every object;
  - remove `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minLength`, `maxLength`, `minItems`, `maxItems`, `uniqueItems`, `pattern`;
  - keep everything else.
- **`systemSuffix`** text is exactly `Respond only by calling the <tool name> tool.`. It is appended as a separate, uncached system block after the existing cached block.
- **Production model constants stay unchanged.** No production code passes an override.
- **Correction to the spec, recorded here:** Opus 4.7/4.8 "thinking off" is **omit**, not `disabled`. Today's Opus 4.8 surfaces send no `thinking` field, and omitting means no thinking on 4.7/4.8. The spec was corrected in the plan commit.
- **SDK types:** `@anthropic-ai/sdk` ^0.91.1 may not type `thinking: {type: "between_tools"}` or the tool `strict` field. Cast at the boundary inside `model-request.ts` only (`as unknown as …`), never at call sites.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Never push.**

## Review Focus

1. **A 5.5 model replies with text and no tool call** under `tool_choice: auto`. Expected: `NoToolCallError` (a reported failure), never a silent empty result or a crash in a parser. Pinned in Task 2 (`extractToolUse`) and in each migration task's "no tool call" test.
2. **A strict schema loses a constraint a parser relied on** (e.g. `minItems` on `requiredElements`). Expected: the surface's parser still rejects the out-of-range input. Pinned in Task 3 (generation and validation parsers).
3. **`sonnet-5` vs `sonnet-5-5` (and `opus-5` vs `opus-5-5`) mis-matching**, which would send `disabled` thinking to a 5.5 model. Expected: each id maps to its own family. Pinned in Task 2's lookup tests.
4. **An override model that supports no effort** (Haiku) combined with an effort flag. Expected: a clear throw naming the model, not a 400 from the API. Pinned in Task 2.
5. **The evaluator's adaptive-thinking path** (`thinkingOverride: "adaptive"`). Expected: still `thinking: {type: "adaptive"}` + effort `low` + `ADAPTIVE_MAX_TOKENS`, byte-identical. Pinned by a Task 1 snapshot variant.

---

### Task 1: Snapshot today's request shapes (before any code moves)

**Files:**
- Create: `packages/ai/src/test-utils/request-shape.ts`
- Modify (add one test each, using that file's existing fixtures and mock client):
  - `packages/ai/src/generate.test.ts`
  - `packages/ai/src/validate.test.ts` (two variants)
  - `packages/ai/src/evaluate.test.ts` (two variants)
  - `packages/ai/src/free-writing-evaluate.test.ts`
  - `packages/ai/src/free-writing-dedup.test.ts`
  - `packages/ai/src/theory-generate.test.ts`
  - `packages/ai/src/theory-validate.test.ts`
  - `packages/ai/src/qa-sample.test.ts`

**Interfaces:**
- Produces: `requestShape(request: unknown): RequestShape`, the comparison projection used by every later task's snapshot check. Snapshot files under `packages/ai/src/__snapshots__/` are committed here and never regenerated.

- [ ] **Step 1: Write the helper**

Create `packages/ai/src/test-utils/request-shape.ts`:

```ts
/**
 * Projection of a Messages API request used to prove that request shaping
 * changes nothing for today's models. Prompt TEXT is excluded (it varies by
 * fixture); structure, model, sampling, thinking, tools and schemas are kept.
 */
export type RequestShape = {
  model: unknown;
  max_tokens: unknown;
  system: Array<{ type: unknown; cache_control: unknown }> | unknown;
  tools: Array<{ name: unknown; strict: unknown; input_schema: unknown }>;
  tool_choice: unknown;
  temperature: unknown;
  thinking: unknown;
  output_config: unknown;
};

export function requestShape(request: unknown): RequestShape {
  const r = request as Record<string, unknown>;
  const tools = (r.tools as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    model: r.model,
    max_tokens: r.max_tokens,
    system: Array.isArray(r.system)
      ? (r.system as Array<Record<string, unknown>>).map((b) => ({
          type: b.type,
          cache_control: b.cache_control ?? null,
        }))
      : typeof r.system,
    tools: tools.map((t) => ({
      name: t.name,
      strict: t.strict ?? null,
      input_schema: t.input_schema,
    })),
    tool_choice: r.tool_choice ?? null,
    temperature: r.temperature ?? null,
    thinking: r.thinking ?? null,
    output_config: r.output_config ?? null,
  };
}
```

- [ ] **Step 2: Add the snapshot tests**

In each listed test file, add one `it` inside the describe block that already exercises the call. Copy the setup of the first passing test in that block that calls the function successfully: the same input fixture and the same mocked `create` resolving to a valid tool-use response. Then capture the request and snapshot its shape. Pattern (shown for `validate.test.ts`; use each file's own function, fixtures and mock variable name):

```ts
import { requestShape } from "./test-utils/request-shape";

it("request shape for the default model is unchanged (model-request shaping guard)", async () => {
  // …same setup as the first passing validateDraft test in this block…
  await validateDraft(mockClient, makeDraft(clozeContent), baseSpec);
  expect(requestShape(mockCreate.mock.calls[0][0])).toMatchSnapshot();
});
```

Variants:
- **`validate.test.ts`:** a second test with `{ modelOverride: "claude-sonnet-5" }` (pins the Sonnet-5 guard: no temperature, `thinking: disabled`).
- **`evaluate.test.ts`:** one test with the default model and one with `thinkingOverride: "adaptive"` (pins `thinking: adaptive` + `output_config: {effort: "low"}` + `ADAPTIVE_MAX_TOKENS`).
- **`generate.test.ts`:** call `generateOneDraft(mockClient, spec, 0)` with the file's cloze spec fixture.
- **`theory-generate.test.ts`:** call `generateTheoryTopic` with the file's existing spec fixture and a mocked successful response.

- [ ] **Step 3: Generate and inspect the snapshots**

Run: `cd packages/ai && pnpm exec vitest run src/generate.test.ts src/validate.test.ts src/evaluate.test.ts src/free-writing-evaluate.test.ts src/free-writing-dedup.test.ts src/theory-generate.test.ts src/theory-validate.test.ts src/qa-sample.test.ts`

Expected: PASS, writing new snapshot entries. Open `packages/ai/src/__snapshots__/*.snap` and check the 10 new entries:

| Snapshot | `model` | `tool_choice` | `temperature` | `thinking` |
|---|---|---|---|---|
| generate | `claude-sonnet-4-6` | `{type: "tool", …}` | 0.7 | null |
| validate default | `claude-sonnet-4-6` | `{type: "tool", …}` | 0 | null |
| validate `sonnet-5` | `claude-sonnet-5` | `{type: "tool", …}` | null | `{type: "disabled"}` |
| evaluate default | `claude-sonnet-5` | `{type: "tool", …}` | null | `{type: "disabled"}` |
| evaluate adaptive | `claude-sonnet-5` | `{type: "tool", …}` | null | `{type: "adaptive"}`, plus `output_config: {effort: "low"}` |
| free-writing evaluate | `claude-sonnet-4-6` | `{type: "tool", …}` | 0 | null |
| dedup | `claude-opus-4-8` | `{type: "tool", …}` | null | null |
| theory-generate | `claude-opus-4-8` | `{type: "tool", …}` | null | null |
| theory-validate | `claude-sonnet-4-6` | `{type: "tool", …}` | 0 | null |
| qa-sample | `claude-opus-4-8` | `{type: "tool", …}` | null | null |

Every entry has exactly one system block with `cache_control: {type: "ephemeral"}`. If any value differs from this table, report it in the task report; the snapshot (today's real behaviour) is authoritative, not the table.

- [ ] **Step 4: Commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping && [ "$(git branch --show-current)" = feat/model-request-shaping ] && \
git add packages/ai/src/test-utils/request-shape.ts packages/ai/src/*.test.ts packages/ai/src/__snapshots__ && \
git commit -m "Snapshot today's Claude request shapes before request shaping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `model-request.ts` (capabilities, shaper, strict schema, extractor) and model-aware pricing

**Files:**
- Create: `packages/ai/src/model-request.ts`
- Create: `packages/ai/src/model-request.test.ts`
- Modify: `packages/ai/src/content-rejected-error.ts` (doc comment only: no longer evaluate-only)
- Modify: `packages/ai/src/cost-model.ts` (add `estimateCostUsdFor`; fix the stale pricing comment)
- Modify: `packages/ai/src/cost-model.test.ts`
- Modify: `packages/ai/src/index.ts` (exports)

**Interfaces (produced, all exported from `@language-drill/ai`):**
- `type Effort = "low" | "medium" | "high" | "xhigh" | "max"`
- `type ModelCapabilities = { family: string; forcedToolChoice: boolean; thinkingOff: "omit" | "disabled" | "between_tools" | "low-effort"; samplingParams: boolean; effort: boolean; pricing: { inputUsdPerToken: number; cacheWriteUsdPerToken: number; cacheReadUsdPerToken: number; outputUsdPerToken: number } }`
- `capabilityFor(model: string): ModelCapabilities` (throws on an unknown model)
- `type ToolIntent = { tool: Anthropic.Tool; thinking: "off" | "adaptive"; temperature?: number; effort?: Effort }`
- `type ShapedToolRequest = { tools: Anthropic.Tool[]; tool_choice: Anthropic.ToolChoice; thinking?: Anthropic.ThinkingConfigParam; temperature?: number; output_config?: { effort: Effort }; systemSuffix?: string; mode: string }`
- `shapeToolRequest(model: string, intent: ToolIntent): ShapedToolRequest`
- `strictToolSchema(schema: unknown): unknown`
- `class NoToolCallError extends Error { readonly stopReason: string | null }`
- `extractToolUse(response: { content: ReadonlyArray<{ type: string; name?: string; input?: unknown }>; stop_reason?: string | null }, toolName: string, opts?: { label?: string; refusalMessage?: string }): unknown`
- `estimateCostUsdFor(model: string, usage: ClaudeUsageBreakdown): number` (rounded to 4 decimals, like `estimateCostUsdAt`)

- [ ] **Step 1: Write the failing tests**

Create `packages/ai/src/model-request.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

import { ContentRejectedError } from "./content-rejected-error";
import {
  NoToolCallError,
  capabilityFor,
  extractToolUse,
  shapeToolRequest,
  strictToolSchema,
} from "./model-request";

const TOOL: Anthropic.Tool = {
  name: "submit_thing",
  description: "Submit.",
  input_schema: {
    type: "object",
    properties: {
      score: { type: "number", minimum: 0, maximum: 1 },
      items: { type: "array", minItems: 2, maxItems: 4, items: { type: "string", minLength: 1 } },
      nested: { type: "object", properties: { code: { type: "string", pattern: "^[a-z]+$" } } },
      kind: { type: "string", enum: ["a", "b"] },
      maybe: { type: ["integer", "null"] },
    },
    required: ["score", "items"],
  },
};

describe("capabilityFor", () => {
  it.each([
    ["claude-haiku-4-5-20251001", "haiku-4-5"],
    ["claude-sonnet-4-6", "sonnet-4-6"],
    ["claude-opus-4-6", "opus-4-6"],
    ["claude-opus-4-7", "opus-4-7-8"],
    ["claude-opus-4-8", "opus-4-7-8"],
    ["claude-sonnet-5", "sonnet-5"],
    ["claude-sonnet-5-5", "sonnet-5-5"],
    ["claude-opus-5", "opus-5"],
    ["claude-opus-5-5", "opus-5-5"],
  ])("%s → %s", (model, family) => {
    expect(capabilityFor(model).family).toBe(family);
  });

  it("throws on an unknown model", () => {
    expect(() => capabilityFor("claude-mystery-9")).toThrow(/No model capabilities for claude-mystery-9/);
  });
});

describe("shapeToolRequest", () => {
  it("Sonnet 4.6, thinking off, temperature 0.7: forced tool, temperature, no thinking", () => {
    const s = shapeToolRequest("claude-sonnet-4-6", { tool: TOOL, thinking: "off", temperature: 0.7 });
    expect(s.tool_choice).toEqual({ type: "tool", name: "submit_thing" });
    expect(s.tools).toEqual([TOOL]);
    expect(s.temperature).toBe(0.7);
    expect(s.thinking).toBeUndefined();
    expect(s.output_config).toBeUndefined();
    expect(s.systemSuffix).toBeUndefined();
  });

  it("Opus 4.8, thinking off, temperature 0: forced tool, NO temperature, NO thinking", () => {
    const s = shapeToolRequest("claude-opus-4-8", { tool: TOOL, thinking: "off", temperature: 0 });
    expect(s.tool_choice).toEqual({ type: "tool", name: "submit_thing" });
    expect(s.temperature).toBeUndefined();
    expect(s.thinking).toBeUndefined();
  });

  it("Sonnet 5, thinking off: forced tool, disabled thinking, no temperature", () => {
    const s = shapeToolRequest("claude-sonnet-5", { tool: TOOL, thinking: "off", temperature: 0 });
    expect(s.tool_choice).toEqual({ type: "tool", name: "submit_thing" });
    expect(s.thinking).toEqual({ type: "disabled" });
    expect(s.temperature).toBeUndefined();
  });

  it("Sonnet 5, adaptive with effort low: adaptive thinking + effort", () => {
    const s = shapeToolRequest("claude-sonnet-5", { tool: TOOL, thinking: "adaptive", effort: "low" });
    expect(s.thinking).toEqual({ type: "adaptive" });
    expect(s.output_config).toEqual({ effort: "low" });
  });

  it("Sonnet 5.5, thinking off: auto + strict tool + suffix + between_tools", () => {
    const s = shapeToolRequest("claude-sonnet-5-5", { tool: TOOL, thinking: "off", temperature: 0 });
    expect(s.tool_choice).toEqual({ type: "auto" });
    expect((s.tools[0] as unknown as { strict: boolean }).strict).toBe(true);
    expect(s.tools[0].input_schema).toEqual(strictToolSchema(TOOL.input_schema));
    expect(s.systemSuffix).toBe("Respond only by calling the submit_thing tool.");
    expect(s.thinking).toEqual({ type: "between_tools" });
    expect(s.temperature).toBeUndefined();
    expect(s.mode).toBe("sonnet-5-5: tool_choice=auto+strict, thinking=between_tools, effort=default");
  });

  it("Sonnet 5.5 thinking off rejects effort xhigh/max", () => {
    expect(() => shapeToolRequest("claude-sonnet-5-5", { tool: TOOL, thinking: "off", effort: "xhigh" })).toThrow(/between_tools/);
  });

  it("Opus 5.5, thinking off: no thinking field, effort low by default, auto + strict", () => {
    const s = shapeToolRequest("claude-opus-5-5", { tool: TOOL, thinking: "off" });
    expect(s.thinking).toBeUndefined();
    expect(s.output_config).toEqual({ effort: "low" });
    expect(s.tool_choice).toEqual({ type: "auto" });
  });

  it("Opus 5.5, thinking off with an explicit effort keeps the caller's effort", () => {
    const s = shapeToolRequest("claude-opus-5-5", { tool: TOOL, thinking: "off", effort: "medium" });
    expect(s.output_config).toEqual({ effort: "medium" });
  });

  it("Opus 5 thinking off rejects effort max", () => {
    expect(() => shapeToolRequest("claude-opus-5", { tool: TOOL, thinking: "off", effort: "max" })).toThrow(/disabled/);
  });

  it("an effort on a model without effort support throws naming the model", () => {
    expect(() => shapeToolRequest("claude-haiku-4-5-20251001", { tool: TOOL, thinking: "off", effort: "low" })).toThrow(/claude-haiku-4-5-20251001/);
  });
});

describe("strictToolSchema", () => {
  it("adds additionalProperties:false to every object and strips unsupported keywords", () => {
    expect(strictToolSchema(TOOL.input_schema)).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: "number" },
        items: { type: "array", items: { type: "string" } },
        nested: { type: "object", additionalProperties: false, properties: { code: { type: "string" } } },
        kind: { type: "string", enum: ["a", "b"] },
        maybe: { type: ["integer", "null"] },
      },
      required: ["score", "items"],
    });
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(TOOL.input_schema);
    strictToolSchema(TOOL.input_schema);
    expect(JSON.stringify(TOOL.input_schema)).toBe(before);
  });
});

describe("extractToolUse", () => {
  const ok = { stop_reason: "tool_use", content: [{ type: "text" }, { type: "tool_use", name: "submit_thing", input: { a: 1 } }] };

  it("returns the matching tool input", () => {
    expect(extractToolUse(ok, "submit_thing")).toEqual({ a: 1 });
  });

  it("throws ContentRejectedError on refusal, with the given message", () => {
    let e: unknown;
    try {
      extractToolUse({ stop_reason: "refusal", content: [] }, "submit_thing", { refusalMessage: "Claude refused to evaluate this answer." });
    } catch (err) {
      e = err;
    }
    expect(e).toBeInstanceOf(ContentRejectedError);
    expect((e as Error).message).toBe("Claude refused to evaluate this answer.");
  });

  it("throws NoToolCallError when no tool_use block is present", () => {
    let e: unknown;
    try {
      extractToolUse({ stop_reason: "end_turn", content: [{ type: "text" }] }, "submit_thing", { label: "Validator" });
    } catch (err) {
      e = err;
    }
    expect(e).toBeInstanceOf(NoToolCallError);
    expect((e as NoToolCallError).stopReason).toBe("end_turn");
    expect((e as Error).message).toMatch(/^Validator did not return a tool use block\. Stop reason: end_turn\./);
  });

  it("throws NoToolCallError on the wrong tool name", () => {
    expect(() =>
      extractToolUse({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "other", input: {} }] }, "submit_thing"),
    ).toThrow(/Unexpected tool name: expected "submit_thing", got "other"/);
  });
});
```

In `packages/ai/src/cost-model.test.ts` add:

```ts
describe("estimateCostUsdFor", () => {
  const usage = { inputTokens: 1_000_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 1_000_000 };
  it.each([
    ["claude-sonnet-4-6", 18],
    ["claude-sonnet-5", 12],
    ["claude-sonnet-5-5", 12],
    ["claude-opus-4-8", 30],
    ["claude-opus-5-5", 24],
    ["claude-haiku-4-5-20251001", 6],
  ])("%s → $%d for 1M in + 1M out", (model, dollars) => {
    expect(estimateCostUsdFor(model, usage)).toBe(dollars);
  });

  it("prices cache writes at 1.25x and cache reads at 0.1x input", () => {
    expect(
      estimateCostUsdFor("claude-sonnet-5-5", {
        inputTokens: 0,
        cacheCreationInputTokens: 1_000_000,
        cacheReadInputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBe(2.5 + 0.2);
  });
});
```

(Add `estimateCostUsdFor` to that file's import from `./cost-model`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping/packages/ai && pnpm exec vitest run src/model-request.test.ts src/cost-model.test.ts`
Expected: FAIL (module not found / `estimateCostUsdFor` not exported).

- [ ] **Step 3: Implement**

Create `packages/ai/src/model-request.ts`:

```ts
/**
 * Request shaping per model family. Every A/B-candidate call site forces a
 * tool; the newest models reject forced tool choice, `thinking: disabled`
 * and sampling params in different combinations. This module turns what a
 * call site MEANS ("force this tool, thinking off, temperature T") into a
 * request the target model accepts, so switching a surface's model is a
 * one-string change. For today's models the shaped fields are exactly what
 * each call site sent before (pinned by the request-shape snapshots).
 */
import type Anthropic from "@anthropic-ai/sdk";

import { ContentRejectedError } from "./content-rejected-error.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

type Pricing = {
  inputUsdPerToken: number;
  cacheWriteUsdPerToken: number;
  cacheReadUsdPerToken: number;
  outputUsdPerToken: number;
};

export type ModelCapabilities = {
  family: string;
  forcedToolChoice: boolean;
  /** How "thinking off" is expressed for this family. */
  thinkingOff: "omit" | "disabled" | "between_tools" | "low-effort";
  samplingParams: boolean;
  effort: boolean;
  pricing: Pricing;
};

const price = (inPerMTok: number, outPerMTok: number): Pricing => ({
  inputUsdPerToken: inPerMTok / 1_000_000,
  cacheWriteUsdPerToken: (inPerMTok * 1.25) / 1_000_000,
  cacheReadUsdPerToken: (inPerMTok * 0.1) / 1_000_000,
  outputUsdPerToken: outPerMTok / 1_000_000,
});

// Order matters: 5.5 rows before their 5 siblings.
const FAMILIES: ReadonlyArray<{ match: RegExp; caps: ModelCapabilities }> = [
  { match: /haiku-4-5/, caps: { family: "haiku-4-5", forcedToolChoice: true, thinkingOff: "omit", samplingParams: true, effort: false, pricing: price(1, 5) } },
  { match: /sonnet-4-6/, caps: { family: "sonnet-4-6", forcedToolChoice: true, thinkingOff: "omit", samplingParams: true, effort: true, pricing: price(3, 15) } },
  { match: /opus-4-6/, caps: { family: "opus-4-6", forcedToolChoice: true, thinkingOff: "omit", samplingParams: true, effort: true, pricing: price(5, 25) } },
  { match: /opus-4-[78]/, caps: { family: "opus-4-7-8", forcedToolChoice: true, thinkingOff: "omit", samplingParams: false, effort: true, pricing: price(5, 25) } },
  { match: /sonnet-5-5/, caps: { family: "sonnet-5-5", forcedToolChoice: false, thinkingOff: "between_tools", samplingParams: false, effort: true, pricing: price(2, 10) } },
  { match: /sonnet-5(?!-5)/, caps: { family: "sonnet-5", forcedToolChoice: true, thinkingOff: "disabled", samplingParams: false, effort: true, pricing: price(2, 10) } },
  { match: /opus-5-5/, caps: { family: "opus-5-5", forcedToolChoice: false, thinkingOff: "low-effort", samplingParams: false, effort: true, pricing: price(4, 20) } },
  { match: /opus-5(?!-5)/, caps: { family: "opus-5", forcedToolChoice: true, thinkingOff: "disabled", samplingParams: false, effort: true, pricing: price(5, 25) } },
];

export function capabilityFor(model: string): ModelCapabilities {
  const row = FAMILIES.find((f) => f.match.test(model));
  if (!row) throw new Error(`No model capabilities for ${model}`);
  return row.caps;
}

export type ToolIntent = {
  tool: Anthropic.Tool;
  thinking: "off" | "adaptive";
  temperature?: number;
  effort?: Effort;
};

export type ShapedToolRequest = {
  tools: Anthropic.Tool[];
  tool_choice: Anthropic.ToolChoice;
  thinking?: Anthropic.ThinkingConfigParam;
  temperature?: number;
  output_config?: { effort: Effort };
  /** Present only for families without forced tool choice; append as its own uncached system block. */
  systemSuffix?: string;
  /** One-line description for eval reports. */
  mode: string;
};

const STRICT_UNSUPPORTED = new Set([
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "minItems", "maxItems", "uniqueItems", "pattern",
]);

/** Pure: a copy of `schema` that strict tool use accepts. Parsers stay the real gate. */
export function strictToolSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictToolSchema);
  if (typeof schema !== "object" || schema === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (STRICT_UNSUPPORTED.has(k)) continue;
    if (k === "properties" && typeof v === "object" && v !== null) {
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, strictToolSchema(pv)]));
    } else if (k === "enum" || k === "required" || k === "type") {
      out[k] = v;
    } else {
      out[k] = strictToolSchema(v);
    }
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

export function shapeToolRequest(model: string, intent: ToolIntent): ShapedToolRequest {
  const caps = capabilityFor(model);
  let effort = intent.effort;
  let thinking: ShapedToolRequest["thinking"];
  let thinkingLabel = "none";

  if (intent.thinking === "adaptive") {
    thinking = { type: "adaptive" } as unknown as Anthropic.ThinkingConfigParam;
    thinkingLabel = "adaptive";
  } else {
    switch (caps.thinkingOff) {
      case "omit":
        break;
      case "disabled":
        if (effort === "xhigh" || effort === "max") {
          throw new Error(`${model}: thinking disabled is invalid with effort ${effort}`);
        }
        thinking = { type: "disabled" } as Anthropic.ThinkingConfigParam;
        thinkingLabel = "disabled";
        break;
      case "between_tools":
        if (effort === "xhigh" || effort === "max") {
          throw new Error(`${model}: thinking between_tools is invalid with effort ${effort}`);
        }
        thinking = { type: "between_tools" } as unknown as Anthropic.ThinkingConfigParam;
        thinkingLabel = "between_tools";
        break;
      case "low-effort":
        effort = effort ?? "low";
        thinkingLabel = "always-on";
        break;
    }
  }

  if (effort !== undefined && !caps.effort) {
    throw new Error(`${model} does not support effort`);
  }

  const shaped: ShapedToolRequest = caps.forcedToolChoice
    ? { tools: [intent.tool], tool_choice: { type: "tool", name: intent.tool.name }, mode: "" }
    : {
        tools: [
          {
            ...intent.tool,
            input_schema: strictToolSchema(intent.tool.input_schema) as Anthropic.Tool["input_schema"],
            strict: true,
          } as unknown as Anthropic.Tool,
        ],
        tool_choice: { type: "auto" },
        systemSuffix: `Respond only by calling the ${intent.tool.name} tool.`,
        mode: "",
      };
  if (thinking !== undefined) shaped.thinking = thinking;
  if (effort !== undefined) shaped.output_config = { effort };
  if (intent.temperature !== undefined && caps.samplingParams) shaped.temperature = intent.temperature;
  shaped.mode = `${caps.family}: tool_choice=${caps.forcedToolChoice ? "forced" : "auto+strict"}, thinking=${thinkingLabel}, effort=${effort ?? "default"}`;
  return shaped;
}

export class NoToolCallError extends Error {
  constructor(message: string, readonly stopReason: string | null) {
    super(message);
    this.name = "NoToolCallError";
  }
}

/** Returns the named tool's input, or throws ContentRejectedError (refusal) / NoToolCallError. */
export function extractToolUse(
  response: { content: ReadonlyArray<{ type: string; name?: string; input?: unknown }>; stop_reason?: string | null },
  toolName: string,
  opts: { label?: string; refusalMessage?: string } = {},
): unknown {
  const label = opts.label ?? "Claude";
  const stopReason = response.stop_reason ?? null;
  if (stopReason === "refusal") {
    throw new ContentRejectedError(opts.refusalMessage ?? `${label} refused the request.`, "refusal");
  }
  const block = response.content.find((b) => b.type === "tool_use");
  if (!block) {
    throw new NoToolCallError(
      `${label} did not return a tool use block. Stop reason: ${stopReason}. Content types: ${response.content.map((b) => b.type).join(", ")}`,
      stopReason,
    );
  }
  if (block.name !== toolName) {
    throw new NoToolCallError(`Unexpected tool name: expected "${toolName}", got "${block.name}"`, stopReason);
  }
  return block.input;
}
```

The `as unknown as` casts are the only SDK-typing escape hatches allowed, and they live here. If `Anthropic.ThinkingConfigParam` or `Anthropic.ToolChoice` do not exist under those names in ^0.91.1, use the names the SDK exports (`grep -n "export type ThinkingConfig\|export type ToolChoice" node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts`). Keep the public field types structurally the same.

In `cost-model.ts`:
- Replace the stale comment above `SONNET_4_5_PRICING` with: "Sonnet 4.6 list pricing ($3 / $15 per MTok), used by the production `generation_jobs.cost_usd_estimate` (the generator and validator run on Sonnet 4.6). For other models use `estimateCostUsdFor(model, usage)`, which reads `capabilityFor(model).pricing` (Sonnet 5 / 5.5 list at $2 / $10)."
- Add:

```ts
import { capabilityFor } from "./model-request.js";

/** USD cost of `usage` at `model`'s list price (see model-request.ts), rounded to 4 decimals. */
export function estimateCostUsdFor(model: string, usage: ClaudeUsageBreakdown): number {
  return estimateCostUsdAt(capabilityFor(model).pricing, usage);
}
```

In `content-rejected-error.ts`, update the doc comment to say the error is thrown by `extractToolUse` for any surface on `stop_reason: "refusal"`.

In `index.ts`, add:

```ts
export {
  capabilityFor,
  extractToolUse,
  NoToolCallError,
  shapeToolRequest,
  strictToolSchema,
  type Effort,
  type ModelCapabilities,
  type ShapedToolRequest,
  type ToolIntent,
} from "./model-request.js";
```

and add `estimateCostUsdFor` to the existing cost-model export block.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping/packages/ai && pnpm exec vitest run src/model-request.test.ts src/cost-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping && pnpm --filter @language-drill/ai lint && pnpm --filter @language-drill/ai typecheck && pnpm --filter @language-drill/ai test && \
[ "$(git branch --show-current)" = feat/model-request-shaping ] && \
git add packages/ai/src/model-request.ts packages/ai/src/model-request.test.ts packages/ai/src/cost-model.ts packages/ai/src/cost-model.test.ts packages/ai/src/content-rejected-error.ts packages/ai/src/index.ts && \
git commit -m "Add per-model request shaping and model-aware pricing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Migrate generation and validation (`generate.ts`, `validate.ts`)

**Files:**
- Modify: `packages/ai/src/generate.ts` (`GenerationSpec`; `generateOneDraft` request at ~1540 and response handling at ~1564; `metadata.modelId` at ~1604)
- Modify: `packages/ai/src/validate.ts` (`ValidateDraftOptions` at ~278; request at ~634–668; response handling after it)
- Test: `packages/ai/src/generate.test.ts`, `packages/ai/src/validate.test.ts`

**Interfaces:**
- Consumes: `shapeToolRequest`, `extractToolUse`, `NoToolCallError`, `Effort` (Task 2).
- Produces:
  - `GenerationSpec.modelOverride?: string` and `GenerationSpec.effort?: Effort` (generator only; validation ignores them);
  - `ValidateDraftOptions.effort?: Effort` next to the existing `modelOverride`.

- [ ] **Step 1: Write the failing tests**

In `generate.test.ts`, inside the `generateOneDraft` describe, using the same fixtures as the Task 1 snapshot test:

```ts
it("modelOverride claude-sonnet-5-5 shapes an auto + strict request with the suffix block", async () => {
  // …same setup as the request-shape snapshot test…
  await generateOneDraft(mockClient, { ...spec, modelOverride: "claude-sonnet-5-5" }, 0);
  const req = mockCreate.mock.calls[0][0];
  expect(req.model).toBe("claude-sonnet-5-5");
  expect(req.tool_choice).toEqual({ type: "auto" });
  expect(req.tools[0].strict).toBe(true);
  expect(req.temperature).toBeUndefined();
  expect(req.thinking).toEqual({ type: "between_tools" });
  expect(req.system).toHaveLength(2);
  expect(req.system[0].cache_control).toEqual({ type: "ephemeral" });
  expect(req.system[1]).toEqual({ type: "text", text: `Respond only by calling the ${req.tools[0].name} tool.` });
});

it("a reply with no tool call under auto mode is a malformed draft, not a crash", async () => {
  mockCreate.mockResolvedValueOnce({
    stop_reason: "end_turn",
    content: [{ type: "text", text: "Here is an exercise…" }],
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  });
  const r = await generateOneDraft(mockClient, { ...spec, modelOverride: "claude-sonnet-5-5" }, 0);
  expect(r.kind).toBe("malformed");
});

it("metadata.modelId follows the override", async () => {
  // …same setup as the snapshot test, successful response…
  const r = await generateOneDraft(mockClient, { ...spec, modelOverride: "claude-opus-5-5" }, 0);
  expect(r.kind).toBe("ok"); // use the success discriminant this file already asserts on
  if (r.kind === "ok") expect(r.draft.metadata.modelId).toBe("claude-opus-5-5");
});
```

If `GenerateOneDraftResult`'s success discriminant isn't `"ok"`, use the one existing tests assert on.

In `validate.test.ts`:

```ts
it("modelOverride claude-opus-5-5 with effort medium shapes auto + strict, effort medium, no thinking field", async () => {
  // …same setup as the default request-shape snapshot test…
  await validateDraft(mockClient, makeDraft(clozeContent), baseSpec, undefined, { modelOverride: "claude-opus-5-5", effort: "medium" });
  const req = mockCreate.mock.calls[0][0];
  expect(req.tool_choice).toEqual({ type: "auto" });
  expect(req.output_config).toEqual({ effort: "medium" });
  expect(req.thinking).toBeUndefined();
  expect(req.temperature).toBeUndefined();
});

it("a refusal surfaces as ContentRejectedError", async () => {
  mockCreate.mockResolvedValueOnce({ stop_reason: "refusal", content: [], usage: { input_tokens: 1, output_tokens: 1 } });
  await expect(validateDraft(mockClient, makeDraft(clozeContent), baseSpec)).rejects.toBeInstanceOf(ContentRejectedError);
});
```

(Import `ContentRejectedError` from `./content-rejected-error`.)

**Strict-schema parser checks** (Review Focus 2). In each file, for every keyword `strictToolSchema` strips from that file's tool schemas, add a parser test showing the parser still rejects input violating it. Find the keywords with `grep -nE "minimum|maximum|minItems|maxItems|minLength|maxLength|pattern" packages/ai/src/generate.ts packages/ai/src/validate.ts`. For example, if `requiredElements` has `minItems: 2`, assert that `parseGeneratedFreeWritingDraft` (or whichever parser owns it) throws on a one-element array. If a stripped keyword has **no** parser enforcement, don't add enforcement; record it as a concern in the task report.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping/packages/ai && pnpm exec vitest run src/generate.test.ts src/validate.test.ts`
Expected: FAIL on the new tests; the Task 1 snapshots still pass.

- [ ] **Step 3: Implement**

`generate.ts`:
- Add to `GenerationSpec`:

```ts
  /** Eval-only: generator model override (default GENERATION_MODEL). Production never sets it. */
  modelOverride?: string;
  /** Eval-only: effort for the generator (families with effort only). */
  effort?: Effort;
```

- In `generateOneDraft`, replace the request object with:

```ts
  const model = spec.modelOverride ?? GENERATION_MODEL;
  const shaped = shapeToolRequest(model, {
    tool,
    thinking: "off",
    temperature: GENERATION_TEMPERATURE,
    effort: spec.effort,
  });
  const response = await client.messages.create(
    {
      model,
      max_tokens: GENERATION_MAX_TOKENS,
      system: [
        { type: "text" as const, text: systemText, cache_control: { type: "ephemeral" as const } },
        ...(shaped.systemSuffix ? [{ type: "text" as const, text: shaped.systemSuffix }] : []),
      ],
      messages: [{ role: "user" as const, content: userText }],
      tools: shaped.tools,
      tool_choice: shaped.tool_choice,
      ...(shaped.thinking ? { thinking: shaped.thinking } : {}),
      ...(shaped.temperature !== undefined ? { temperature: shaped.temperature } : {}),
      ...(shaped.output_config ? { output_config: shaped.output_config } : {}),
    } as Anthropic.MessageCreateParamsNonStreaming,
    { signal },
  );
```

- Inside the existing `try`, replace the tool-block lookup and name check with:

```ts
    const input = extractToolUse(response, tool.name, { label: "Generator" });
    content = isDictation
      ? parseGeneratedDictationDraft(input, spec, ordinal)
      : isFreeWriting
        ? parseGeneratedFreeWritingDraft(input, spec)
        : parseToolInput(input, spec);
```

  The surrounding `catch` already turns any throw into `kind: "malformed"`; keep it as is.
- Set `metadata.modelId: model` instead of `GENERATION_MODEL`.

`validate.ts`:
- Add `effort?: Effort;` to `ValidateDraftOptions`, documented "Eval-only".
- Delete the `rejectsSamplingParams` / `omittedThinkingMeansAdaptive` regexes and the two `if` lines. Build the request with the same shaping pattern as above, using `tool: buildValidationTool(draft.contentJson.type)`, `thinking: "off"`, `temperature: VALIDATION_TEMPERATURE`, `effort: options?.effort`, `model: effectiveModel` and `max_tokens: VALIDATION_MAX_TOKENS`.
- Replace the missing/wrong tool checks with `const input = extractToolUse(response, VALIDATION_TOOL_NAME, { label: "Validator" });`, then `parseValidationResult(input)` and the existing cloze consistency step, unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping/packages/ai && pnpm exec vitest run src/generate.test.ts src/validate.test.ts`
Expected: PASS, **including the unchanged Task 1 snapshots**. Existing tests asserting the old missing-tool error text may need their regex updated to the new message (`Generator/Validator did not return a tool use block. Stop reason: …`). Update only the expected text, never the behaviour asserted.

- [ ] **Step 5: Gate and commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping && pnpm --filter @language-drill/ai lint && pnpm --filter @language-drill/ai typecheck && pnpm --filter @language-drill/ai test && \
pnpm --filter @language-drill/ai build >/dev/null && (cd packages/db && env -u DATABASE_URL pnpm exec vitest run src/generation/) && \
[ "$(git branch --show-current)" = feat/model-request-shaping ] && \
git add packages/ai/src/generate.ts packages/ai/src/generate.test.ts packages/ai/src/validate.ts packages/ai/src/validate.test.ts && \
git commit -m "Shape generation and validation requests per model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Migrate answer evaluation and free-writing evaluation (`evaluate.ts`, `free-writing-evaluate.ts`)

**Files:**
- Modify: `packages/ai/src/evaluate.ts` (`EvaluateAnswerInput` ~126–190; request ~399–446; response ~448–481)
- Modify: `packages/ai/src/free-writing-evaluate.ts` (`EvaluateFreeWritingInput` ~153–168; request ~328; response after it)
- Test: `packages/ai/src/evaluate.test.ts`, `packages/ai/src/free-writing-evaluate.test.ts`

**Interfaces:**
- Consumes: Task 2 exports.
- Produces:
  - `EvaluateAnswerInput.effortOverride?: Effort`;
  - `EvaluateFreeWritingInput.modelOverride?: string` and `EvaluateFreeWritingInput.effortOverride?: Effort`.

- [ ] **Step 1: Write the failing tests**

In `evaluate.test.ts`:

```ts
it("modelOverride claude-sonnet-5-5 shapes auto + strict with between_tools", async () => {
  // …same setup as the default request-shape snapshot test…
  await evaluateAnswer(mockClient, { ...input, modelOverride: "claude-sonnet-5-5" });
  const req = mockCreate.mock.calls[0][0];
  expect(req.tool_choice).toEqual({ type: "auto" });
  expect(req.thinking).toEqual({ type: "between_tools" });
  expect(req.system[1].text).toBe(`Respond only by calling the ${req.tools[0].name} tool.`);
});

it("effortOverride is sent as output_config", async () => {
  await evaluateAnswer(mockClient, { ...input, effortOverride: "medium" });
  expect(mockCreate.mock.calls[0][0].output_config).toEqual({ effort: "medium" });
});
```

In `free-writing-evaluate.test.ts`:

```ts
it("modelOverride claude-opus-5-5 shapes auto + strict, no temperature, effort low", async () => {
  // …same setup as the request-shape snapshot test…
  await evaluateFreeWriting(client, { ...input, modelOverride: "claude-opus-5-5" });
  const req = create.mock.calls[0][0];
  expect(req.model).toBe("claude-opus-5-5");
  expect(req.tool_choice).toEqual({ type: "auto" });
  expect(req.temperature).toBeUndefined();
  expect(req.output_config).toEqual({ effort: "low" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping/packages/ai && pnpm exec vitest run src/evaluate.test.ts src/free-writing-evaluate.test.ts`
Expected: FAIL on the new tests only.

- [ ] **Step 3: Implement**

`evaluate.ts`:
- Add `effortOverride?: Effort` (eval-only doc) to `EvaluateAnswerInput`.
- Delete both regexes and the guard `if`s. Shape with `model = modelOverride ?? MODEL`, `tool: buildEvaluationTool(attributionKeys)`, `thinking: thinkingOverride === "adaptive" ? "adaptive" : "off"`, `temperature: 0`, and `effort: effortOverride ?? (thinkingOverride === "adaptive" ? "low" : undefined)`. Keep `max_tokens: thinkingOverride === "adaptive" ? ADAPTIVE_MAX_TOKENS : MAX_TOKENS`. Use the same two-block system pattern as Task 3.
- Replace the refusal check plus tool lookup with:
  `const input = extractToolUse(response, EVALUATION_TOOL_NAME, { refusalMessage: "Claude refused to evaluate this answer." });`
  then `return parseEvaluationResult(input, validKeys);`.

`free-writing-evaluate.ts`: the same pattern.
- `model = input.modelOverride ?? MODEL`; `thinking: "off"`; `temperature: 0`; `effort: input.effortOverride`.
- Refusal message: `"Claude refused to evaluate this free-writing submission."`.

The lambda's `instanceof ContentRejectedError` checks (`infra/lambda/src/routes/exercises.ts:766, 928`) keep working because the class is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping/packages/ai && pnpm exec vitest run src/evaluate.test.ts src/free-writing-evaluate.test.ts`
Expected: PASS, including the unchanged Task 1 snapshots (both evaluate variants).

- [ ] **Step 5: Gate and commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping && pnpm --filter @language-drill/ai lint && pnpm --filter @language-drill/ai typecheck && pnpm --filter @language-drill/ai test && \
pnpm --filter @language-drill/ai build >/dev/null && rm -rf infra/lambda/dist && (cd infra/lambda && env -u DATABASE_URL pnpm exec vitest run src/routes/exercises) && \
[ "$(git branch --show-current)" = feat/model-request-shaping ] && \
git add packages/ai/src/evaluate.ts packages/ai/src/evaluate.test.ts packages/ai/src/free-writing-evaluate.ts packages/ai/src/free-writing-evaluate.test.ts && \
git commit -m "Shape answer and free-writing evaluation requests per model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Migrate the dedup judge, theory generation/validation and qa-sample

**Files:**
- Modify: `packages/ai/src/free-writing-dedup.ts` (options; request ~83–104; response)
- Modify: `packages/ai/src/theory-generate.ts` (`opts`; request ~441; response; `metadata.modelId` ~496)
- Modify: `packages/ai/src/theory-validate.ts` (signature ~302; request ~310; response)
- Modify: `packages/ai/src/qa-sample.ts` (params; request ~242–264; response)
- Test: each file's existing test file

**Interfaces:**
- Consumes: Task 2 exports.
- Produces:
  - `judgeFreeWritingDuplicate` options gain `effort?: Effort`;
  - `generateTheoryTopic` opts gain `model?: string; effort?: Effort`;
  - `validateTheoryDraft(client, draft, spec, options?: { model?: string; effort?: Effort })`;
  - `craftProbeAnswers` params gain `effort?: Effort`.

- [ ] **Step 1: Write the failing tests**

For each file, one override test against its mocked `create`, using the same fixtures as that file's Task 1 snapshot test:

```ts
// free-writing-dedup.test.ts
it("model claude-opus-5-5 shapes auto + strict, effort low, no temperature", async () => {
  const create = vi.fn().mockResolvedValue(toolReply({ duplicateOf: null, reason: "distinct" }));
  const client = { messages: { create } } as unknown as Anthropic;
  await judgeFreeWritingDuplicate(client, { candidate, existing: oneExisting, cefrLevel: "B1" }, { model: "claude-opus-5-5" });
  const req = create.mock.calls[0][0];
  expect(req.tool_choice).toEqual({ type: "auto" });
  expect(req.output_config).toEqual({ effort: "low" });
  expect(req.temperature).toBeUndefined();
});

// theory-generate.test.ts
it("opts.model claude-sonnet-5-5 shapes auto + strict and metadata.modelId follows it", async () => {
  // …same fixture/mock as the snapshot test…
  const r = await generateTheoryTopic(client, spec, { model: "claude-sonnet-5-5" });
  expect(create.mock.calls[0][0].tool_choice).toEqual({ type: "auto" });
  expect(r.draft.metadata.modelId).toBe("claude-sonnet-5-5"); // use the result shape this file's tests already read
});

// theory-validate.test.ts
it("options.model claude-opus-5-5 shapes auto + strict", async () => {
  // …same fixture as the snapshot test…
  await validateTheoryDraft(mockClient, draft, spec, { model: "claude-opus-5-5" });
  expect(mockCreate.mock.calls[0][0].tool_choice).toEqual({ type: "auto" });
});

// qa-sample.test.ts
it("model claude-sonnet-5-5 shapes auto + strict with between_tools", async () => {
  // …same fixture as the snapshot test…
  await craftProbeAnswers(client, { ...params, model: "claude-sonnet-5-5" });
  const req = create.mock.calls[0][0];
  expect(req.tool_choice).toEqual({ type: "auto" });
  expect(req.thinking).toEqual({ type: "between_tools" });
});
```

Add one more test in each file: a mocked `{ stop_reason: "refusal", content: [] }` reply is reported as that file's existing failure. Each file reports it differently:

- **dedup judge:** throws; it is retried once, then thrown.
- **theory-generate:** becomes a `TheoryDraftMalformedError` path and is retried.
- **theory-validate:** throws.
- **qa-sample:** throws.

Assert whatever behaviour that function already uses for a missing tool block.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping/packages/ai && pnpm exec vitest run src/free-writing-dedup.test.ts src/theory-generate.test.ts src/theory-validate.test.ts src/qa-sample.test.ts`
Expected: FAIL on the new tests only.

- [ ] **Step 3: Implement**

The same shaping pattern as Task 3 in each file. Per-file intents:

| File | model | thinking | temperature | effort | `extractToolUse` label |
|---|---|---|---|---|---|
| `free-writing-dedup.ts` | `options.model ?? FREE_WRITING_DEDUP_MODEL` | `"off"` | `0` | `options.effort` | `"Dedup judge"` |
| `theory-generate.ts` | `opts.model ?? THEORY_GENERATION_MODEL` | `"off"` | omit | `opts.effort` | `"Theory generator"` |
| `theory-validate.ts` | `options?.model ?? THEORY_VALIDATION_MODEL` | `"off"` | `THEORY_VALIDATION_TEMPERATURE` | `options?.effort` | `"Validator"` |
| `qa-sample.ts` | `params.model ?? QA_CRAFTER_MODEL` | `"off"` | omit | `params.effort` | `"qa-craft"` |

- **dedup judge:** delete its two regexes and guard lines. Keep the retry-once loop and usage summing; `extractToolUse` replaces the `block` lookup inside the `try`.
- **theory-generate:**
  - delete the "No temperature … no thinking" comment and replace it with a pointer to `model-request.ts`;
  - inside the existing `try`, wrap `extractToolUse`'s throw as `new TheoryDraftMalformedError(\`Theory draft malformed: ${(e as Error).message}\`, usage)`, so the retry loop behaves as before;
  - set `metadata.modelId` to the effective model.
- **qa-sample:** delete its regex and guard line.

Then confirm no guard is left:

Run: `grep -rnE "rejectsSamplingParams|omittedThinkingMeansAdaptive" packages/ai/src --include=*.ts`
Expected: no output.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping/packages/ai && pnpm exec vitest run src/free-writing-dedup.test.ts src/theory-generate.test.ts src/theory-validate.test.ts src/qa-sample.test.ts`
Expected: PASS, including the unchanged Task 1 snapshots.

- [ ] **Step 5: Gate and commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping && pnpm --filter @language-drill/ai lint && pnpm --filter @language-drill/ai typecheck && pnpm --filter @language-drill/ai test && (cd packages/ai && pnpm exec vitest run scripts/) && \
pnpm --filter @language-drill/ai build >/dev/null && (cd packages/db && env -u DATABASE_URL pnpm exec vitest run src/theory-generation/ src/generation/) && \
[ "$(git branch --show-current)" = feat/model-request-shaping ] && \
git add packages/ai/src/free-writing-dedup.ts packages/ai/src/free-writing-dedup.test.ts packages/ai/src/theory-generate.ts packages/ai/src/theory-generate.test.ts packages/ai/src/theory-validate.ts packages/ai/src/theory-validate.test.ts packages/ai/src/qa-sample.ts packages/ai/src/qa-sample.test.ts && \
git commit -m "Shape dedup, theory and qa-sample requests per model; drop inline guards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Eval flags and model-aware costs

**Files:**
- Modify: `packages/ai/scripts/eval-run.ts` (+ `eval-run.test.ts`)
- Modify: `packages/ai/scripts/eval-gen-run.ts` (+ `eval-gen-run.test.ts`)
- Modify: `packages/ai/scripts/eval-validator-run.ts` (+ its test file)
- Modify: `packages/ai/scripts/fw-dedup-judge-eval.ts` (+ `fw-dedup-judge-eval.test.ts`)

**Interfaces:**
- Consumes: `estimateCostUsdFor`, `shapeToolRequest(...).mode`, `Effort`, and the overrides from Tasks 3–5.
- Produces:
  - `eval-run`: `EvalRunArgs.effort?: Effort` (`--effort`).
  - `eval-gen-run`:
    - `EvalGenArgs.candidateModel?: string` and `EvalGenArgs.candidateEffort?: Effort` (`--candidate-model`, `--candidate-effort`);
    - `GenCellArmExecutorParams.generatorModel?: string` and `GenCellArmExecutorParams.generatorEffort?: Effort`;
    - `ArmResult.costUsd?: number`.
  - `eval-validator-run`: `EvalValidatorArgs.model?: string` and `EvalValidatorArgs.effort?: Effort` (`--model`, `--effort`).
  - `fw-dedup-judge-eval`: `--effort`.

- [ ] **Step 1: Write the failing tests**

- **`eval-run.test.ts`:** `parseEvalArgs([... "--effort", "medium"])` yields `effort: "medium"`; `--effort bogus` throws `/effort/`.
- **`eval-gen-run.test.ts`:**
  - `parseEvalGenArgs([...required, "--candidate-model", "claude-sonnet-5-5", "--candidate-effort", "low"])` yields both fields;
  - in `runGenEval` with a stub executor and `args.candidateModel` set, the **candidate** call receives `generatorModel: "claude-sonnet-5-5"` and the **baseline** call receives `generatorModel: undefined`;
  - `computeArmStats([{ outcomes: [], usage: ZERO_USAGE, costUsd: 1.25 }]).costUsd === 1.25`;
  - an `ArmResult` without `costUsd` still falls back to `estimateCostUsd(usage)`.
- **`eval-validator-run`:** `--model claude-opus-5-5 --effort low` parse into `model` and `effort`. Pure-function test: the arms with no explicit `modelOverride` (`model-only`, `both`) resolve to `claude-opus-5-5` when `args.model` is set, and arms with an explicit `modelOverride` keep it. Implement this as an exported `resolveArmModel(arm, args)`.
- **`fw-dedup-judge-eval`:** an exported pure `judgeOptions(values)` returns `{ model, effort }` from the parsed values (omitting undefined keys), and `{}` when neither is set.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping/packages/ai && pnpm exec vitest run scripts/eval-run.test.ts scripts/eval-gen-run.test.ts scripts/eval-validator-run.test.ts scripts/fw-dedup-judge-eval.test.ts`
Expected: FAIL on the new tests only.

- [ ] **Step 3: Implement**

Common to all four CLIs:
- An effort flag accepts exactly `low | medium | high | xhigh | max`; anything else throws `Error("--effort must be one of low|medium|high|xhigh|max")`.
- At startup each CLI prints the `mode` string from `shapeToolRequest(<model in use>, { tool: <surface tool>, thinking: <surface intent>, effort })` and records it in the report JSON as `requestMode`.

**`eval-run.ts`:** thread `effortOverride: effort` into `evaluateAnswer`. Cost becomes `estimateCostUsdFor(model ?? "claude-sonnet-5", usage)` (the evaluator's current model). Update the stale `--model` doc comment about Sonnet-only pricing.

**`eval-gen-run.ts`:**
- `GenCellArmExecutorParams` gains `generatorModel?` and `generatorEffort?`. `makeRealArmExecutor` puts them on the `GenerationSpec` as `modelOverride` / `effort`. `validateDraft` stays called **without** options, so the validator is the production default in both arms.
- In `runGenEval`, the candidate `executor({...})` call passes `generatorModel: args.candidateModel` and `generatorEffort: args.candidateEffort`. The baseline call passes neither.
- `makeRealArmExecutor` tracks generator usage (`batch.tokenUsage`) and validation usage separately and sets
  `costUsd = estimateCostUsdFor(generatorModel ?? GENERATION_MODEL, genUsage) + estimateCostUsdFor(VALIDATION_MODEL, valUsage)`.
  It keeps returning the folded `usage` as today.
- `ArmResult.costUsd?: number`. `computeArmStats` sums `r.costUsd ?? estimateCostUsd(r.usage)`. The `--max-cost-usd` cap check uses the same sum.
- Add both flags to `printGenUsage`.

**`eval-validator-run.ts`:**
- Add `--model` and `--effort`.
- Export `resolveArmModel(arm, args): string | undefined`, returning `arm.modelOverride ?? args.model`.
- Validator arms pass `{ modelOverride: resolveArmModel(arm, args), effort: args.effort, systemPromptOverride }` to `validateDraft`. The solver arm passes `effort: args.effort` to `craftProbeAnswers`.
- Per-arm cost: `estimateCostUsdFor(resolveArmModel(arm, args) ?? VALIDATION_MODEL, armUsage)`.

**`fw-dedup-judge-eval.ts`:**
- Add `--effort`.
- Export `judgeOptions(values): { model?: string; effort?: Effort }` and pass it to `judgeFreeWritingDuplicate`.
- Cost: `estimateCostUsdFor(values.model ?? FREE_WRITING_DEDUP_MODEL, usage)` for both the cap and the report.
- Delete the stale comment ("default VALIDATION_MODEL … ~5x").

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping/packages/ai && pnpm exec vitest run scripts/`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping && pnpm --filter @language-drill/ai lint && pnpm --filter @language-drill/ai typecheck && (cd packages/ai && pnpm exec vitest run scripts/) && \
[ "$(git branch --show-current)" = feat/model-request-shaping ] && \
git add packages/ai/scripts/eval-run.ts packages/ai/scripts/eval-run.test.ts packages/ai/scripts/eval-gen-run.ts packages/ai/scripts/eval-gen-run.test.ts packages/ai/scripts/eval-validator-run.ts packages/ai/scripts/eval-validator-run.test.ts packages/ai/scripts/fw-dedup-judge-eval.ts packages/ai/scripts/fw-dedup-judge-eval.test.ts && \
git commit -m "Add model and effort flags and model-aware costs to the eval CLIs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `verify:model-requests`, docs, full gate

**Files:**
- Create: `packages/ai/scripts/verify-model-requests.ts`
- Create: `packages/ai/scripts/verify-model-requests.test.ts`
- Modify: `packages/ai/package.json` (`"verify:model-requests": "tsx scripts/verify-model-requests.ts"`)
- Modify: `package.json` (root: `"verify:model-requests": "dotenv -e .env -- pnpm --filter @language-drill/ai verify:model-requests"`)
- Modify: `CLAUDE.md`
  - "Running Locally" table: rows for `verify:model-requests` and the new eval flags;
  - a short "Switching a surface's model" note under "Prompt Editing".

**Interfaces:**
- Consumes: `shapeToolRequest`, `extractToolUse`, `createClaudeClient`, `estimateCostUsdFor`.
- Produces: `VERIFY_MODELS: readonly string[]` and `VERIFY_TOOL: Anthropic.Tool` (exported for the test).

- [ ] **Step 1: Write the failing test**

Create `packages/ai/scripts/verify-model-requests.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { capabilityFor, shapeToolRequest } from "../src/index.js";
import { VERIFY_MODELS, VERIFY_TOOL } from "./verify-model-requests";

describe("verify-model-requests", () => {
  it("covers every family in use or under evaluation", () => {
    expect(VERIFY_MODELS.map((m) => capabilityFor(m).family).sort()).toEqual(
      ["haiku-4-5", "opus-4-7-8", "opus-5-5", "sonnet-4-6", "sonnet-5", "sonnet-5-5"].sort(),
    );
  });

  it("uses a tool schema containing keywords strict mode strips", () => {
    expect(JSON.stringify(VERIFY_TOOL.input_schema)).toMatch(/minItems|maxLength|minimum/);
  });

  it("every model shapes without throwing", () => {
    for (const m of VERIFY_MODELS) expect(() => shapeToolRequest(m, { tool: VERIFY_TOOL, thinking: "off", temperature: 0 })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping/packages/ai && pnpm exec vitest run scripts/verify-model-requests.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `packages/ai/scripts/verify-model-requests.ts`:

```ts
/**
 * verify:model-requests — one small real call per model family through
 * shapeToolRequest + extractToolUse. Catches request-shape 400s (forced tool
 * choice, thinking modes, sampling params, strict schemas) before an A/B or a
 * model switch spends real money. ~$0.10 per run.
 *
 *   pnpm verify:model-requests
 */
import { fileURLToPath } from "node:url";

import type Anthropic from "@anthropic-ai/sdk";

import {
  ZERO_USAGE,
  createClaudeClient,
  estimateCostUsdFor,
  extractToolUse,
  shapeToolRequest,
} from "../src/index.js";

export const VERIFY_MODELS = [
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "claude-sonnet-5-5",
  "claude-opus-4-8",
  "claude-opus-5-5",
] as const;

export const VERIFY_TOOL: Anthropic.Tool = {
  name: "submit_check",
  description: "Submit the check result.",
  input_schema: {
    type: "object",
    properties: {
      word: { type: "string", maxLength: 40 },
      letters: { type: "array", items: { type: "string" }, minItems: 1 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["word", "letters", "confidence"],
  },
};

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  const client = createClaudeClient(apiKey);
  let failures = 0;
  let cost = 0;
  for (const model of VERIFY_MODELS) {
    const shaped = shapeToolRequest(model, { tool: VERIFY_TOOL, thinking: "off", temperature: 0 });
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 400,
        system: [
          { type: "text", text: "You check words.", cache_control: { type: "ephemeral" } },
          ...(shaped.systemSuffix ? [{ type: "text" as const, text: shaped.systemSuffix }] : []),
        ],
        messages: [{ role: "user", content: 'Spell the word "cat" as letters, with your confidence.' }],
        tools: shaped.tools,
        tool_choice: shaped.tool_choice,
        ...(shaped.thinking ? { thinking: shaped.thinking } : {}),
        ...(shaped.temperature !== undefined ? { temperature: shaped.temperature } : {}),
        ...(shaped.output_config ? { output_config: shaped.output_config } : {}),
      } as Anthropic.MessageCreateParamsNonStreaming);
      const input = extractToolUse(response, VERIFY_TOOL.name) as { letters?: unknown };
      const u = response.usage;
      cost += estimateCostUsdFor(model, {
        ...ZERO_USAGE,
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
      });
      const ok = Array.isArray(input.letters);
      if (!ok) failures++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${shaped.mode}`);
    } catch (e) {
      failures++;
      console.log(`FAIL  ${shaped.mode}  ${(e as Error).message.slice(0, 200)}`);
    }
  }
  console.log(`\n${VERIFY_MODELS.length - failures}/${VERIFY_MODELS.length} passed, ~$${cost.toFixed(4)}`);
  if (failures > 0) process.exit(1);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((e) => {
    console.error("[verify-model-requests] failed:", e);
    process.exit(1);
  });
}
```

Add the two `package.json` script entries.

In `CLAUDE.md`'s "Running Locally" table, add after the `pnpm eval:fw-dedup` row:

```
| `pnpm verify:model-requests` | One small real call per model family (Haiku 4.5, Sonnet 4.6 / 5 / 5.5, Opus 4.8 / 5.5) through `shapeToolRequest` + `extractToolUse` (`packages/ai/src/model-request.ts`); prints PASS/FAIL with each family's request mode and exits 1 on any failure. Run before any model A/B or model switch. ~$0.10. |
```

Then append to the `pnpm eval`, `pnpm eval:gen` and `pnpm eval:fw-dedup-judge` rows, and add an `eval:validator` row (run via `pnpm --filter @language-drill/ai eval:validator`):

- `pnpm eval`: `--effort <low|medium|high|xhigh|max>`; cost is priced at the evaluated model.
- `pnpm eval:gen`: `--candidate-model <id>` / `--candidate-effort <level>` change only the candidate arm's **generator** (both arms validate with the production validator); costs are priced per model.
- `eval:validator`: `--model <id>` replaces the production validator model in the `model-only` / `both` arms; `--effort <level>`.
- `pnpm eval:fw-dedup-judge`: `--effort <level>`; cost is priced at the judge model.

Under "Prompt Editing", add a short paragraph: "**Switching a surface's model.** The eight A/B surfaces (generation, validation, answer and free-writing evaluation, dedup judge, theory generation/validation, qa-sample) build their tool, thinking and sampling fields through `shapeToolRequest` (`packages/ai/src/model-request.ts`). A model switch is a one-constant change, but run `pnpm verify:model-requests` and that surface's A/B first. Opus 5.5 / Sonnet 5.5 use `tool_choice: auto` + strict tools + a one-line instruction, so a reply without a tool call is possible; it surfaces as `NoToolCallError`."

- [ ] **Step 4: Run the test and the full gate**

Run:

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping && (cd packages/ai && pnpm exec vitest run scripts/verify-model-requests.test.ts) && \
pnpm --filter @language-drill/shared test && \
pnpm --filter @language-drill/ai lint && pnpm --filter @language-drill/ai typecheck && pnpm --filter @language-drill/ai test && (cd packages/ai && pnpm exec vitest run scripts/) && \
pnpm --filter @language-drill/ai build >/dev/null && pnpm --filter @language-drill/db lint && pnpm --filter @language-drill/db typecheck && (cd packages/db && env -u DATABASE_URL pnpm exec vitest run) && \
pnpm --filter @language-drill/db build >/dev/null && rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda typecheck && (cd infra/lambda && env -u DATABASE_URL pnpm exec vitest run)
```

Expected: all PASS. Don't run `main()`; the controller runs the real calls.

- [ ] **Step 5: Commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/model-request-shaping && [ "$(git branch --show-current)" = feat/model-request-shaping ] && \
git add packages/ai/scripts/verify-model-requests.ts packages/ai/scripts/verify-model-requests.test.ts packages/ai/package.json package.json CLAUDE.md && \
git commit -m "Add verify:model-requests and document model switching

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8 (controller only): real-call verification

Costs ~$0.10.

- [ ] **Step 1:** Run `pnpm verify:model-requests` from the worktree. Expected: 6/6 PASS, each line showing its family's mode. Any FAIL means a capability-table row is wrong. Fix the row through a fix round on Task 2 (with a test) and re-run.
- [ ] **Step 2:** Record the output on the PR. Repeat after merge, from `main`.
