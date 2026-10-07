# Free-Writing Semantic Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop free-writing generation from inserting a prompt a learner would answer with essentially the same essay as one already in the cell, including drafts from the same batch, and measure the effect before generation resumes.

**Architecture:**
- A new Sonnet judge (`packages/ai`) decides whether a candidate free-writing prompt duplicates one of the cell's existing prompts.
- `packages/db` calls the judge just before each free-writing INSERT. A duplicate is handled like the existing vocab per-word cap: no insert, then retry, then `dedup-given-up`. A judge failure inserts the draft as `flagged`.
- Free-writing cells run their outcome pool serially, so same-batch inserts are visible to later checks. Retries get refreshed `title — task` history.
- Two eval CLIs:
  - one checks the judge against #757's human-reviewed clusters;
  - one A/Bs the old and new pipeline offline.

**Tech Stack:** TypeScript, Anthropic SDK (forced tool use), Drizzle (Neon Postgres), Vitest, pnpm workspaces. Packages: `@language-drill/shared`, `@language-drill/ai`, `@language-drill/db`.

**Spec:** `docs/superpowers/specs/2026-10-07-free-writing-semantic-dedup-design.md`

## Global Constraints

- **Worktree:** all work happens in `/Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup` (branch `feat/fw-semantic-dedup`).
  - Every Read/Edit/Write path must be absolute with that prefix; never touch `/Users/seal/dev/language-drill/packages/...` (the main checkout).
  - Every Bash command starts `cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup && …`.
  - Before every commit, run `[ "$(git branch --show-current)" = feat/fw-semantic-dedup ]`.
- **First-time setup:** `pnpm install && pnpm build` before any vitest. Rebuild a package (`pnpm --filter @language-drill/<pkg> build`) before testing a package that imports it through `dist`.
- **Package boundary:** `packages/ai/src` must not import `@language-drill/db`. `packages/ai/scripts/*` may.
- **Gate per package** (the full root `pnpm test` gets OOM-killed): `pnpm --filter @language-drill/<pkg> lint`, `typecheck`, `test`. `packages/ai/scripts/*.test.ts` run with `cd packages/ai && pnpm exec vitest run scripts/<file>`. Run db tests with `env -u DATABASE_URL`.
- **Duplicate rule** (judge prompt, verbatim meaning): duplicates iff *a learner would write essentially the same essay*. A different title, wording, angle label, framing or number of required elements does not make a prompt distinct. At A1/A2, prompts requiring clearly different content are distinct.
- **No few-shot examples** in the judge prompt drawn from `docs/analysis/fw-round3-dedup-proposals-2026-10-07.json` (that file is the judge's ground truth).
- Judge model `VALIDATION_MODEL`. The eval's independent scorer is `QA_CRAFTER_MODEL` (`claude-opus-4-8`).
- **Versions:** `FREE_WRITING_DEDUP_PROMPT_VERSION = "free-writing-dedup@2026-10-07"`; `FREE_WRITING_GENERATION_PROMPT_VERSION = "free-writing-generate@2026-10-07"`.
- Langfuse prompt name `free-writing-dedup-system-prompt`, surface `free-writing-dedup`, added to the `PROMPTS` manifest.
- **Dedup pool:** `review_status IN ('auto-approved','manual-approved','flagged')`, ordered by `id`, capped at 60. History lines are `title — task`, with the task collapsed to one line and truncated to 200 characters (`…` appended when truncated).
- **Serialization:** free-writing cells run the outcome pool at concurrency 1; other types keep `MAX_OUTCOME_CONCURRENCY` (5).
- **Retries:** `MAX_DEDUP_RETRIES` stays 3.
- New reason code `dedup-check-unavailable`, label `"Duplicate check unavailable"`.
- **Judge bar:** precision ≥ 0.9 and recall ≥ 0.8.
- **A/B rule:**
  - **ship-ready** iff the judge passed **and** candidate duplicate rate ≤ 0.05 **and** baseline duplicate rate ≥ 0.20 **and** approval Δ ≥ −0.10;
  - **inconclusive** iff baseline duplicate rate < 0.20;
  - otherwise **inspect**.
- **Corrections to the spec, recorded here:**
  1. **Candidate-arm generation.** The candidate arm mirrors the shipped pipeline exactly: attempt 0 is generated as one batch with frozen history; outcomes are processed serially; only retries get refreshed history. The spec's "generated one at a time" described something prod doesn't do.
  2. **Baseline wording.** The baseline arm renders title-only history with the *new* heading text. The old renderer is replaced, and the within-batch convergence that dominates the defect doesn't depend on the heading wording.
  3. **Judge file layout.** The judge's prompt lives in `free-writing-dedup-prompts.ts` and its client in `free-writing-dedup.ts`, following the repo's `*-prompts.ts` pattern.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Never push.**

## Review Focus

1. **A free-writing cell with no existing prompts** (a brand-new topic, or one fully demoted). Expected: the judge isn't called; with an empty pool everything is distinct, and the draft inserts normally. Pinned in Task 1 (`judgeFreeWritingDuplicate` short-circuit test) and Task 3.
2. **A stored or drafted free-writing row missing `title`/`task`, or with a malformed `requiredElements`.** Expected: skipped from the pool, never sent to the judge as `undefined`; a malformed *candidate* is treated as `unavailable`, so it's flagged and not silently inserted. Pinned in Task 1 (`freeWritingSummary` tests) and Task 3.
3. **The judge returns an index that doesn't exist** (hallucinated `duplicateOf: 7` with 3 existing). Expected: a parse error, so the draft is flagged `dedup-check-unavailable`, never inserted as approved. Pinned in Task 1 and Task 3.
4. **Two drafts in one batch with the same question.** Expected: the second is caught because the pool is re-read per attempt and outcomes are serialized. Pinned in Task 4 (concurrency 1) and Task 3 (fresh fetch on every check).
5. **A dedup retry for free writing.** Expected: the regenerated draft's history includes rows inserted since the batch started. Pinned in Task 4 (retry spec carries refreshed `priorPoolSurfaces`).

---

### Task 1: The free-writing dedup judge (`packages/ai`)

**Files:**
- Create: `packages/ai/src/free-writing-summary.ts`
- Create: `packages/ai/src/free-writing-dedup-prompts.ts`
- Create: `packages/ai/src/free-writing-dedup.ts`
- Create: `packages/ai/src/free-writing-dedup.test.ts`
- Modify: `packages/ai/src/index.ts` (exports)
- Modify: `packages/ai/scripts/bootstrap-prompts.ts` (import + `PROMPTS` entry)
- Modify: `packages/ai/scripts/bootstrap-prompts.test.ts` (manifest assertion)
- Modify: `CLAUDE.md` (Prompt Editing table row)

**Interfaces (produced, exported from `@language-drill/ai`):**
- `type FreeWritingPromptSummary = { title: string; task: string; requiredElements: string[] }`
- `freeWritingSummary(content: unknown): FreeWritingPromptSummary | null`
- `freeWritingHistoryLine(s: FreeWritingPromptSummary): string`
- `FREE_WRITING_DEDUP_SYSTEM_PROMPT: string`, `FREE_WRITING_DEDUP_PROMPT_VERSION: string`
- `FREE_WRITING_DEDUP_TOOL_NAME = "submit_dedup_verdict"`
- `type FreeWritingDedupVerdict = { duplicateOf: number | null; reason: string }`
- `buildFreeWritingDedupUserPrompt(input: FreeWritingDedupInput): string`
- `parseFreeWritingDedupVerdict(input: unknown, existingCount: number): FreeWritingDedupVerdict` (throws on invalid)
- `type FreeWritingDedupInput = { candidate: FreeWritingPromptSummary; existing: readonly FreeWritingPromptSummary[]; cefrLevel: string }`
- `judgeFreeWritingDuplicate(client: Anthropic, input: FreeWritingDedupInput, options?: { signal?: AbortSignal; model?: string }): Promise<{ result: FreeWritingDedupVerdict; tokenUsage: ClaudeUsageBreakdown }>`

- [ ] **Step 1: Write the failing tests**

Create `packages/ai/src/free-writing-dedup.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ExerciseType } from "@language-drill/shared";

import {
  FREE_WRITING_DEDUP_PROMPT_VERSION,
  FREE_WRITING_DEDUP_SYSTEM_PROMPT,
  FREE_WRITING_DEDUP_TOOL_NAME,
  buildFreeWritingDedupUserPrompt,
  freeWritingHistoryLine,
  freeWritingSummary,
  judgeFreeWritingDuplicate,
  parseFreeWritingDedupVerdict,
} from "./index.js";

const FW = (over: Record<string, unknown> = {}) => ({
  type: ExerciseType.FREE_WRITING,
  instructions: "x",
  title: "El teletrabajo y la soledad",
  task: "Explica si trabajar desde casa\n  aísla a las personas.",
  domain: "opinión",
  register: "neutral",
  minWords: 120,
  maxWords: 180,
  requiredElements: [
    { id: "a", label: "Da tu opinión" },
    { id: "b", label: "Usa dos conectores" },
  ],
  ...over,
});

describe("freeWritingSummary", () => {
  it("extracts title, collapsed task and required-element labels", () => {
    expect(freeWritingSummary(FW())).toEqual({
      title: "El teletrabajo y la soledad",
      task: "Explica si trabajar desde casa aísla a las personas.",
      requiredElements: ["Da tu opinión", "Usa dos conectores"],
    });
  });

  it("returns null for non-free-writing or missing title/task", () => {
    expect(freeWritingSummary(null)).toBeNull();
    expect(freeWritingSummary({ type: ExerciseType.CLOZE, sentence: "x" })).toBeNull();
    expect(freeWritingSummary(FW({ title: "  " }))).toBeNull();
    expect(freeWritingSummary(FW({ task: 7 }))).toBeNull();
  });

  it("tolerates malformed requiredElements by dropping bad entries", () => {
    expect(freeWritingSummary(FW({ requiredElements: [{ label: "ok" }, { label: 3 }, "x"] }))?.requiredElements)
      .toEqual(["ok"]);
    expect(freeWritingSummary(FW({ requiredElements: "nope" }))?.requiredElements).toEqual([]);
  });
});

describe("freeWritingHistoryLine", () => {
  it("joins title and task with an em dash", () => {
    expect(freeWritingHistoryLine({ title: "T", task: "Do X.", requiredElements: [] })).toBe("T — Do X.");
  });

  it("truncates the task to 200 characters with an ellipsis", () => {
    const line = freeWritingHistoryLine({ title: "T", task: "a".repeat(250), requiredElements: [] });
    expect(line).toBe(`T — ${"a".repeat(200)}…`);
  });
});

describe("free-writing dedup prompt", () => {
  it("states the essay-level rule and the A1/A2 exception", () => {
    expect(FREE_WRITING_DEDUP_SYSTEM_PROMPT).toContain("would write essentially the same essay");
    expect(FREE_WRITING_DEDUP_SYSTEM_PROMPT).toContain("A1 and A2");
    expect(FREE_WRITING_DEDUP_SYSTEM_PROMPT).toContain(FREE_WRITING_DEDUP_TOOL_NAME);
  });

  it("has a dated version", () => {
    expect(FREE_WRITING_DEDUP_PROMPT_VERSION).toMatch(/^free-writing-dedup@\d{4}-\d{2}-\d{2}$/);
  });

  it("renders the candidate and every existing prompt with its index", () => {
    const text = buildFreeWritingDedupUserPrompt({
      cefrLevel: "B2",
      candidate: { title: "C", task: "Candidate task.", requiredElements: ["r1"] },
      existing: [
        { title: "E0", task: "First.", requiredElements: [] },
        { title: "E1", task: "Second.", requiredElements: ["x", "y"] },
      ],
    });
    expect(text).toContain("CEFR level: B2");
    expect(text).toContain("Title: C");
    expect(text).toContain("Task: Candidate task.");
    expect(text).toContain("[0] Title: E0");
    expect(text).toContain("[1] Title: E1");
    expect(text).toContain("Required elements: x; y");
  });
});

describe("parseFreeWritingDedupVerdict", () => {
  it("accepts null and in-range integers", () => {
    expect(parseFreeWritingDedupVerdict({ duplicateOf: null, reason: "new essay" }, 2)).toEqual({
      duplicateOf: null,
      reason: "new essay",
    });
    expect(parseFreeWritingDedupVerdict({ duplicateOf: 1, reason: "same" }, 2)).toEqual({
      duplicateOf: 1,
      reason: "same",
    });
  });

  it("treats a missing duplicateOf as null and a missing reason as empty", () => {
    expect(parseFreeWritingDedupVerdict({}, 2)).toEqual({ duplicateOf: null, reason: "" });
  });

  it("throws on an out-of-range or non-integer index", () => {
    expect(() => parseFreeWritingDedupVerdict({ duplicateOf: 2, reason: "" }, 2)).toThrow();
    expect(() => parseFreeWritingDedupVerdict({ duplicateOf: -1, reason: "" }, 2)).toThrow();
    expect(() => parseFreeWritingDedupVerdict({ duplicateOf: 0.5, reason: "" }, 2)).toThrow();
    expect(() => parseFreeWritingDedupVerdict({ duplicateOf: "0", reason: "" }, 2)).toThrow();
    expect(() => parseFreeWritingDedupVerdict("x", 2)).toThrow();
  });
});

describe("judgeFreeWritingDuplicate", () => {
  const candidate = { title: "C", task: "Task.", requiredElements: [] };

  it("does not call Claude when there are no existing prompts", async () => {
    const create = vi.fn();
    const client = { messages: { create } } as unknown as Anthropic;
    const out = await judgeFreeWritingDuplicate(client, { candidate, existing: [], cefrLevel: "B1" });
    expect(create).not.toHaveBeenCalled();
    expect(out.result.duplicateOf).toBeNull();
    expect(out.tokenUsage.inputTokens).toBe(0);
  });

  it("forces the verdict tool, uses the given model, and returns usage", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      content: [{ type: "tool_use", name: FREE_WRITING_DEDUP_TOOL_NAME, input: { duplicateOf: 0, reason: "same essay" } }],
    });
    const client = { messages: { create } } as unknown as Anthropic;
    const out = await judgeFreeWritingDuplicate(
      client,
      { candidate, existing: [{ title: "E", task: "T.", requiredElements: [] }], cefrLevel: "B1" },
      { model: "claude-opus-4-8" },
    );
    const req = create.mock.calls[0][0];
    expect(req.model).toBe("claude-opus-4-8");
    expect(req.tool_choice).toEqual({ type: "tool", name: FREE_WRITING_DEDUP_TOOL_NAME });
    expect(out.result).toEqual({ duplicateOf: 0, reason: "same essay" });
    expect(out.tokenUsage.inputTokens).toBe(100);
  });

  it("throws when Claude returns no tool call", async () => {
    const create = vi.fn().mockResolvedValue({ stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [] });
    const client = { messages: { create } } as unknown as Anthropic;
    await expect(
      judgeFreeWritingDuplicate(client, { candidate, existing: [{ title: "E", task: "T.", requiredElements: [] }], cefrLevel: "B1" }),
    ).rejects.toThrow();
  });
});
```

In `packages/ai/scripts/bootstrap-prompts.test.ts`, add inside the top-level `describe` that covers `PROMPTS` (find it with `grep -n "PROMPTS" packages/ai/scripts/bootstrap-prompts.test.ts`; import `PROMPTS` the same way that file already does):

```ts
  it("registers the free-writing dedup prompt", () => {
    const entry = PROMPTS.find((p) => p.name === "free-writing-dedup-system-prompt");
    expect(entry?.surface).toBe("free-writing-dedup");
    expect(entry?.version).toMatch(/^free-writing-dedup@/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup/packages/ai && pnpm exec vitest run src/free-writing-dedup.test.ts scripts/bootstrap-prompts.test.ts`
Expected: FAIL. The module isn't found, and the manifest entry is missing.

- [ ] **Step 3: Implement**

Create `packages/ai/src/free-writing-summary.ts`:

```ts
import { ExerciseType } from "@language-drill/shared";

/** The parts of a free-writing prompt that decide which essay a learner writes. */
export type FreeWritingPromptSummary = {
  title: string;
  task: string;
  requiredElements: string[];
};

const HISTORY_TASK_MAX_CHARS = 200;

function oneLine(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/gu, " ").trim();
  return s.length > 0 ? s : null;
}

/**
 * Summarize stored or drafted free-writing content. Takes `unknown` because
 * callers pass raw `content_json`; returns null when it is not a free-writing
 * prompt with a usable title and task, so malformed rows are skipped rather
 * than sent to the judge as "undefined".
 */
export function freeWritingSummary(content: unknown): FreeWritingPromptSummary | null {
  if (typeof content !== "object" || content === null) return null;
  const c = content as Record<string, unknown>;
  if (c.type !== ExerciseType.FREE_WRITING) return null;
  const title = oneLine(c.title);
  const task = oneLine(c.task);
  if (title === null || task === null) return null;
  const requiredElements = Array.isArray(c.requiredElements)
    ? c.requiredElements.flatMap((e) => {
        const label =
          typeof e === "object" && e !== null ? oneLine((e as Record<string, unknown>).label) : null;
        return label === null ? [] : [label];
      })
    : [];
  return { title, task, requiredElements };
}

/** One generation-history line: `title — task`, task truncated to 200 chars. */
export function freeWritingHistoryLine(s: FreeWritingPromptSummary): string {
  const task =
    s.task.length > HISTORY_TASK_MAX_CHARS ? `${s.task.slice(0, HISTORY_TASK_MAX_CHARS)}…` : s.task;
  return `${s.title} — ${task}`;
}
```

Create `packages/ai/src/free-writing-dedup-prompts.ts`:

```ts
import type { FreeWritingPromptSummary } from "./free-writing-summary.js";

// Bump in the same commit as any semantic edit to the prompt below.
export const FREE_WRITING_DEDUP_PROMPT_VERSION = "free-writing-dedup@2026-10-07";

export const FREE_WRITING_DEDUP_TOOL_NAME = "submit_dedup_verdict";

// No examples on purpose: the judge is measured against the #757 clusters
// (docs/analysis/fw-round3-dedup-proposals-2026-10-07.json), so examples drawn
// from that data would contaminate the check.
export const FREE_WRITING_DEDUP_SYSTEM_PROMPT = `You decide whether a candidate free-writing prompt duplicates a prompt already in the pool for the same topic.

Two prompts are DUPLICATES when a learner answering them would write essentially the same essay: the same question, the same position to argue or situation to describe, and the same content to produce. A different title, different wording, a different angle label, a different framing sentence, or a different number of required elements does NOT make a prompt distinct when the essay a learner writes would be essentially the same.

Two prompts are DISTINCT when they ask for a genuinely different essay: a different question, a different situation, a different text type (for example a letter versus an opinion piece), or a clearly different focus within the topic.

At CEFR A1 and A2, where prompts are short and concrete, two prompts that require clearly different content are DISTINCT even when they share the topic — for example describing a place versus narrating an event.

The prompts may be written in any language. Judge the meaning, not the wording.

Compare the candidate with every existing prompt. If it duplicates one or more, set duplicateOf to the index of the closest one; otherwise set it to null. Give a one-sentence reason either way.

Use the ${FREE_WRITING_DEDUP_TOOL_NAME} tool.`;

export type FreeWritingDedupInput = {
  candidate: FreeWritingPromptSummary;
  existing: readonly FreeWritingPromptSummary[];
  cefrLevel: string;
};

function renderPrompt(s: FreeWritingPromptSummary, indent: string): string {
  const req = s.requiredElements.length > 0 ? s.requiredElements.join("; ") : "(none)";
  return `Title: ${s.title}\n${indent}Task: ${s.task}\n${indent}Required elements: ${req}`;
}

export function buildFreeWritingDedupUserPrompt(input: FreeWritingDedupInput): string {
  const existing = input.existing
    .map((s, i) => `[${i}] ${renderPrompt(s, "    ")}`)
    .join("\n\n");
  return `CEFR level: ${input.cefrLevel}

Candidate prompt:
${renderPrompt(input.candidate, "")}

Existing prompts in this cell:
${existing}`;
}
```

Create `packages/ai/src/free-writing-dedup.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";

import { ZERO_USAGE, type ClaudeUsageBreakdown } from "./cost-model.js";
import {
  FREE_WRITING_DEDUP_PROMPT_VERSION,
  FREE_WRITING_DEDUP_SYSTEM_PROMPT,
  FREE_WRITING_DEDUP_TOOL_NAME,
  buildFreeWritingDedupUserPrompt,
  type FreeWritingDedupInput,
} from "./free-writing-dedup-prompts.js";
import { getPromptOrFallback } from "./prompts-registry.js";
import { VALIDATION_MODEL } from "./validate.js";

const MAX_TOKENS = 400;

export type FreeWritingDedupVerdict = { duplicateOf: number | null; reason: string };

export const FREE_WRITING_DEDUP_TOOL: Anthropic.Tool = {
  name: FREE_WRITING_DEDUP_TOOL_NAME,
  description: "Submit whether the candidate prompt duplicates an existing one.",
  input_schema: {
    type: "object" as const,
    properties: {
      duplicateOf: {
        type: ["integer", "null"],
        description: "Index of the closest duplicated existing prompt, or null if the candidate is distinct.",
      },
      reason: { type: "string", description: "One sentence explaining the verdict." },
    },
    required: ["duplicateOf", "reason"],
  },
};

/** Throws on an invalid index so the caller can treat the check as unavailable. */
export function parseFreeWritingDedupVerdict(input: unknown, existingCount: number): FreeWritingDedupVerdict {
  if (typeof input !== "object" || input === null) {
    throw new Error("dedup verdict is not an object");
  }
  const r = input as Record<string, unknown>;
  const reason = typeof r.reason === "string" ? r.reason : "";
  const d = r.duplicateOf;
  if (d === null || d === undefined) return { duplicateOf: null, reason };
  if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d >= existingCount) {
    throw new Error(`dedup verdict index out of range: ${String(d)} (existing=${existingCount})`);
  }
  return { duplicateOf: d, reason };
}

function readUsage(response: Anthropic.Message): ClaudeUsageBreakdown {
  const u = response.usage;
  return {
    inputTokens: u.input_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
  };
}

export async function judgeFreeWritingDuplicate(
  client: Anthropic,
  input: FreeWritingDedupInput,
  options: { signal?: AbortSignal; model?: string } = {},
): Promise<{ result: FreeWritingDedupVerdict; tokenUsage: ClaudeUsageBreakdown }> {
  // Nothing to duplicate: skip the call entirely.
  if (input.existing.length === 0) {
    return { result: { duplicateOf: null, reason: "no existing prompts" }, tokenUsage: ZERO_USAGE };
  }
  const resolved = await getPromptOrFallback(
    "free-writing-dedup-system-prompt",
    FREE_WRITING_DEDUP_SYSTEM_PROMPT,
    FREE_WRITING_DEDUP_PROMPT_VERSION,
  );
  const response = await client.messages.create(
    {
      model: options.model ?? VALIDATION_MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text" as const, text: resolved.text, cache_control: { type: "ephemeral" as const } }],
      messages: [{ role: "user" as const, content: buildFreeWritingDedupUserPrompt(input) }],
      tools: [FREE_WRITING_DEDUP_TOOL],
      tool_choice: { type: "tool" as const, name: FREE_WRITING_DEDUP_TOOL_NAME },
      temperature: 0,
    },
    { signal: options.signal },
  );
  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) {
    throw new Error(`dedup judge returned no tool call (stop_reason=${response.stop_reason})`);
  }
  return {
    result: parseFreeWritingDedupVerdict(block.input, input.existing.length),
    tokenUsage: readUsage(response),
  };
}
```

If `cost-model.ts` does not export `ZERO_USAGE`, or `validate.ts` imports from `free-writing-*` and creates a cycle, import `ZERO_USAGE` from wherever `index.ts` re-exports it (`grep -n "ZERO_USAGE" packages/ai/src/*.ts`). Keep the API identical.

In `packages/ai/src/index.ts` add:

```ts
export {
  freeWritingSummary,
  freeWritingHistoryLine,
  type FreeWritingPromptSummary,
} from "./free-writing-summary.js";
export {
  FREE_WRITING_DEDUP_PROMPT_VERSION,
  FREE_WRITING_DEDUP_SYSTEM_PROMPT,
  FREE_WRITING_DEDUP_TOOL_NAME,
  buildFreeWritingDedupUserPrompt,
  type FreeWritingDedupInput,
} from "./free-writing-dedup-prompts.js";
export {
  FREE_WRITING_DEDUP_TOOL,
  judgeFreeWritingDuplicate,
  parseFreeWritingDedupVerdict,
  type FreeWritingDedupVerdict,
} from "./free-writing-dedup.js";
```

In `packages/ai/scripts/bootstrap-prompts.ts`, add `FREE_WRITING_DEDUP_SYSTEM_PROMPT` and `FREE_WRITING_DEDUP_PROMPT_VERSION` to the import from `"../src/index.js"`, and add to `PROMPTS` right after the `free-writing-eval-system-prompt` entry:

```ts
  {
    // Runtime fetches this via getPromptOrFallback("free-writing-dedup-system-prompt", …)
    // in free-writing-dedup.ts — the name MUST match that registry key.
    name: "free-writing-dedup-system-prompt",
    text: FREE_WRITING_DEDUP_SYSTEM_PROMPT,
    version: FREE_WRITING_DEDUP_PROMPT_VERSION,
    surface: "free-writing-dedup",
  },
```

In `CLAUDE.md`, in the "Prompt Editing" table, add after the `free-writing-validation-prompts.ts` row:

```
| `free-writing-dedup-prompts.ts` | `FREE_WRITING_DEDUP_PROMPT_VERSION` |
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup/packages/ai && pnpm exec vitest run src/free-writing-dedup.test.ts scripts/bootstrap-prompts.test.ts`
Expected: PASS. If an existing bootstrap test asserts the total `PROMPTS.length`, bump that expected count by one.

- [ ] **Step 5: Gate and commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup && pnpm --filter @language-drill/ai lint && pnpm --filter @language-drill/ai typecheck && pnpm --filter @language-drill/ai test && (cd packages/ai && pnpm exec vitest run scripts/bootstrap-prompts.test.ts) && \
[ "$(git branch --show-current)" = feat/fw-semantic-dedup ] && \
git add packages/ai/src/free-writing-summary.ts packages/ai/src/free-writing-dedup-prompts.ts packages/ai/src/free-writing-dedup.ts packages/ai/src/free-writing-dedup.test.ts packages/ai/src/index.ts packages/ai/scripts/bootstrap-prompts.ts packages/ai/scripts/bootstrap-prompts.test.ts CLAUDE.md && \
git commit -m "Add a judge for duplicate free-writing prompts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `title — task` history in the free-writing generation prompt (`packages/ai`)

**Files:**
- Modify: `packages/ai/src/free-writing-generation-prompts.ts` (`FREE_WRITING_GENERATION_PROMPT_VERSION`, `renderPriorTitlesSection`)
- Modify: `packages/ai/src/free-writing-generation-prompts.test.ts:100-115`

**Interfaces:**
- Consumes: nothing new (`priorPoolSurfaces` strings now arrive as `title — task` lines from Task 4).
- Produces: the rendered `{{priorTitlesSection}}` text; the template variable name is unchanged.

- [ ] **Step 1: Write the failing test**

In `free-writing-generation-prompts.test.ts`, replace the existing test that asserts `toContain("do NOT reuse")` (around lines 107–114) with:

```ts
  it("renders prior prompts as a same-question avoid-list", () => {
    const vars = computeFreeWritingGenerationPromptVars({
      ...INPUTS,
      priorPoolSurfaces: [
        "El teletrabajo: ¿avance o aislamiento? — Explica si trabajar desde casa aísla a las personas.",
        "Teletrabajo y soledad — Describe cómo te sientes trabajando solo.",
      ],
    });
    expect(vars.priorTitlesSection).toContain(
      "## Prompts already in this cell — do NOT ask the same question in other words",
    );
    expect(vars.priorTitlesSection).toContain(
      "A new title or a new angle label on the same question is still the same question.",
    );
    expect(vars.priorTitlesSection).toContain("  - Teletrabajo y soledad — Describe cómo te sientes trabajando solo.");
  });

  it("bumps the free-writing generation prompt version", () => {
    expect(FREE_WRITING_GENERATION_PROMPT_VERSION).toBe("free-writing-generate@2026-10-07");
  });
```

Keep the existing `priorTitlesSection` empty-string test. Add `FREE_WRITING_GENERATION_PROMPT_VERSION` to the file's import if it isn't already imported, and check whether another test pins the old `free-writing-generate@2026-09-07` string (`grep -rn "free-writing-generate@2026-09-07" packages`); if one does, update it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup/packages/ai && pnpm exec vitest run src/free-writing-generation-prompts.test.ts`
Expected: FAIL. The old heading and version are still in place.

- [ ] **Step 3: Implement**

In `free-writing-generation-prompts.ts`:

```ts
export const FREE_WRITING_GENERATION_PROMPT_VERSION = "free-writing-generate@2026-10-07";
```

Replace the body of `renderPriorTitlesSection` (keep its name and signature):

```ts
  if (!priorTitles || priorTitles.length === 0) return "";
  const capped = priorTitles.slice(0, MAX_PRIOR_FW_TITLES_IN_PROMPT);
  const bullets = capped.map((t) => `  - ${t}`).join("\n");
  // Each line is `title — task` (freeWritingHistoryLine). Titles alone let a
  // batch reword one question 5–10× under new titles (#757), so the list names
  // the question itself.
  return `## Prompts already in this cell — do NOT ask the same question in other words\n\nA new title or a new angle label on the same question is still the same question. Write a prompt that asks for a genuinely different essay:\n\n${bullets}\n\n`;
```

Update the doc comment above `MAX_PRIOR_FW_TITLES_IN_PROMPT` and `renderPriorTitlesSection` to say the entries are `title — task` lines.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup/packages/ai && pnpm exec vitest run src/free-writing-generation-prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup && pnpm --filter @language-drill/ai lint && pnpm --filter @language-drill/ai typecheck && pnpm --filter @language-drill/ai test && \
[ "$(git branch --show-current)" = feat/fw-semantic-dedup ] && \
git add packages/ai/src/free-writing-generation-prompts.ts packages/ai/src/free-writing-generation-prompts.test.ts && \
git commit -m "Show prior free-writing prompts as title and task, not title alone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Reason code and the db-side duplicate check (`packages/shared`, `packages/db`)

**Files:**
- Modify: `packages/shared/src/generation-reasons.ts` (enum + label)
- Modify: `packages/shared/src/generation-reasons.test.ts`
- Create: `packages/db/src/generation/free-writing-dedup.ts`
- Create: `packages/db/src/generation/free-writing-dedup.test.ts`
- Modify: `packages/db/src/generation/index.ts` (exports)

**Interfaces:**
- Consumes: `freeWritingSummary`, `judgeFreeWritingDuplicate`, `ZERO_USAGE`, `ClaudeUsageBreakdown`, `FreeWritingPromptSummary` from `@language-drill/ai` (Task 1).
- Produces:
  - `GenerationReasonCode.DedupCheckUnavailable = "dedup-check-unavailable"` (shared)
  - `MAX_FW_PROMPTS_FOR_DEDUP = 60`
  - `fetchFreeWritingPromptSummaries(db: Db, cell: Cell): Promise<FreeWritingPromptSummary[]>`
  - `type FreeWritingDuplicateCheck = { status: 'distinct' | 'duplicate' | 'unavailable'; detail: string; usage: ClaudeUsageBreakdown }`
  - `checkFreeWritingDuplicate(db: Db, client: Anthropic, cell: Cell, content: unknown, signal?: AbortSignal): Promise<FreeWritingDuplicateCheck>`
  - All exported from `@language-drill/db`.

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/generation-reasons.test.ts` add:

```ts
  it("labels the dedup-check-unavailable code", () => {
    expect(GenerationReasonCode.DedupCheckUnavailable).toBe("dedup-check-unavailable");
    expect(REASON_LABELS[GenerationReasonCode.DedupCheckUnavailable]).toBe("Duplicate check unavailable");
    expect(REJECTED_BRANCH_CODES).not.toContain(GenerationReasonCode.DedupCheckUnavailable);
  });
```

(Import `REASON_LABELS` and `REJECTED_BRANCH_CODES` if the file doesn't already.)

Create `packages/db/src/generation/free-writing-dedup.test.ts`:

```ts
import type Anthropic from '@anthropic-ai/sdk';
import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@language-drill/ai', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/ai')>('@language-drill/ai');
  return { ...actual, judgeFreeWritingDuplicate: vi.fn() };
});

import { judgeFreeWritingDuplicate } from '@language-drill/ai';
import type { Db } from '../client';
import type { Cell } from './cells';
import { checkFreeWritingDuplicate, fetchFreeWritingPromptSummaries } from './free-writing-dedup';

const mockJudge = vi.mocked(judgeFreeWritingDuplicate);
const client = {} as unknown as Anthropic;

const cell: Cell = {
  language: Language.ES,
  cefrLevel: CefrLevel.B2,
  exerciseType: ExerciseType.FREE_WRITING,
  grammarPoint: { key: 'es-b2-fw-test' } as unknown as Cell['grammarPoint'],
  cellKey: 'es:b2:free_writing:es-b2-fw-test',
};

const fw = (title: string, task: string) => ({
  type: ExerciseType.FREE_WRITING,
  title,
  task,
  requiredElements: [{ id: 'a', label: 'Opina' }],
});

/** Select chain `.from().where().orderBy().limit()` resolving to `rows`; counts calls. */
function makeDb(rows: Array<{ contentJson: unknown }>, calls = { n: 0 }): Db {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => {
      calls.n++;
      return Promise.resolve(rows);
    },
  };
  return { select: () => chain } as unknown as Db;
}

const USAGE = { inputTokens: 50, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

beforeEach(() => mockJudge.mockReset());

describe('fetchFreeWritingPromptSummaries', () => {
  it('summarizes rows and skips malformed ones', async () => {
    const out = await fetchFreeWritingPromptSummaries(
      makeDb([{ contentJson: fw('A', 'Task A.') }, { contentJson: { type: 'free_writing', title: 'no task' } }, { contentJson: null }]),
      cell,
    );
    expect(out).toEqual([{ title: 'A', task: 'Task A.', requiredElements: ['Opina'] }]);
  });
});

describe('checkFreeWritingDuplicate', () => {
  it('returns distinct when the judge finds no duplicate', async () => {
    mockJudge.mockResolvedValue({ result: { duplicateOf: null, reason: 'new essay' }, tokenUsage: USAGE });
    const out = await checkFreeWritingDuplicate(makeDb([{ contentJson: fw('A', 'Task A.') }]), client, cell, fw('B', 'Task B.'));
    expect(out).toEqual({ status: 'distinct', detail: 'new essay', usage: USAGE });
    expect(mockJudge.mock.calls[0][1].cefrLevel).toBe('B2');
  });

  it('returns duplicate naming the matched title', async () => {
    mockJudge.mockResolvedValue({ result: { duplicateOf: 0, reason: 'same essay' }, tokenUsage: USAGE });
    const out = await checkFreeWritingDuplicate(makeDb([{ contentJson: fw('A', 'Task A.') }]), client, cell, fw('B', 'Task A again.'));
    expect(out.status).toBe('duplicate');
    expect(out.detail).toContain('"A"');
    expect(out.usage).toEqual(USAGE);
  });

  it('re-reads the pool on every call (sees same-batch inserts)', async () => {
    mockJudge.mockResolvedValue({ result: { duplicateOf: null, reason: '' }, tokenUsage: USAGE });
    const calls = { n: 0 };
    const db = makeDb([{ contentJson: fw('A', 'Task A.') }], calls);
    await checkFreeWritingDuplicate(db, client, cell, fw('B', 'b'));
    await checkFreeWritingDuplicate(db, client, cell, fw('C', 'c'));
    expect(calls.n).toBe(2);
  });

  it('is unavailable (never distinct) when the judge throws', async () => {
    mockJudge.mockRejectedValue(new Error('dedup verdict index out of range: 7 (existing=1)'));
    const out = await checkFreeWritingDuplicate(makeDb([{ contentJson: fw('A', 'Task A.') }]), client, cell, fw('B', 'b'));
    expect(out.status).toBe('unavailable');
    expect(out.detail).toContain('out of range');
  });

  it('is unavailable for a candidate with no title/task, without calling the judge', async () => {
    const out = await checkFreeWritingDuplicate(makeDb([]), client, cell, { type: 'free_writing', title: 'x' });
    expect(out.status).toBe('unavailable');
    expect(mockJudge).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup && pnpm --filter @language-drill/shared test 2>&1 | tail -5; pnpm --filter @language-drill/ai build >/dev/null && cd packages/db && env -u DATABASE_URL pnpm exec vitest run src/generation/free-writing-dedup.test.ts`
Expected: FAIL. The enum member and the module are missing.

- [ ] **Step 3: Implement**

In `packages/shared/src/generation-reasons.ts`, add to the enum in the flag-branch section (just before `ValidatorNote`):

```ts
  /**
   * The free-writing duplicate judge could not run (API or parse error). The
   * draft is inserted FLAGGED rather than approved, so a judge outage costs a
   * manual review, never a duplicate reaching learners. `detail` holds the error.
   */
  DedupCheckUnavailable = "dedup-check-unavailable",
```

and to `REASON_LABELS`:

```ts
  [GenerationReasonCode.DedupCheckUnavailable]: "Duplicate check unavailable",
```

Create `packages/db/src/generation/free-writing-dedup.ts`:

```ts
/**
 * Semantic dedup for free-writing generation. The dedup index keys on the
 * title, which let one essay question be reworded 5–10× in a cell under new
 * titles (#757). Before each free-writing INSERT the candidate is judged
 * against the cell's current prompts; the pool is re-read on every call so a
 * draft inserted earlier in the same batch is seen.
 */
import type Anthropic from '@anthropic-ai/sdk';
import {
  ZERO_USAGE,
  freeWritingSummary,
  judgeFreeWritingDuplicate,
  type ClaudeUsageBreakdown,
  type FreeWritingPromptSummary,
} from '@language-drill/ai';
import { and, eq, inArray } from 'drizzle-orm';

import type { Db } from '../client';
import { exercises } from '../schema/index';
import type { Cell } from './cells';

export const MAX_FW_PROMPTS_FOR_DEDUP = 60;

/** The cell's current free-writing prompts (approved, manual, flagged), summarized. */
export async function fetchFreeWritingPromptSummaries(
  db: Db,
  cell: Cell,
): Promise<FreeWritingPromptSummary[]> {
  const rows = await db
    .select({ contentJson: exercises.contentJson })
    .from(exercises)
    .where(
      and(
        eq(exercises.language, cell.language),
        eq(exercises.difficulty, cell.cefrLevel),
        eq(exercises.type, cell.exerciseType),
        eq(exercises.grammarPointKey, cell.grammarPoint.key),
        inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved', 'flagged']),
      ),
    )
    .orderBy(exercises.id)
    .limit(MAX_FW_PROMPTS_FOR_DEDUP);
  return rows.flatMap((r) => {
    const s = freeWritingSummary(r.contentJson);
    return s === null ? [] : [s];
  });
}

export type FreeWritingDuplicateCheck = {
  status: 'distinct' | 'duplicate' | 'unavailable';
  detail: string;
  usage: ClaudeUsageBreakdown;
};

/** Never throws: any failure is `unavailable`, which the caller inserts flagged. */
export async function checkFreeWritingDuplicate(
  db: Db,
  client: Anthropic,
  cell: Cell,
  content: unknown,
  signal?: AbortSignal,
): Promise<FreeWritingDuplicateCheck> {
  const candidate = freeWritingSummary(content);
  if (candidate === null) {
    return { status: 'unavailable', detail: 'draft has no usable title/task', usage: ZERO_USAGE };
  }
  try {
    const existing = await fetchFreeWritingPromptSummaries(db, cell);
    const { result, tokenUsage } = await judgeFreeWritingDuplicate(
      client,
      { candidate, existing, cefrLevel: cell.cefrLevel },
      { signal },
    );
    if (result.duplicateOf === null) {
      return { status: 'distinct', detail: result.reason, usage: tokenUsage };
    }
    return {
      status: 'duplicate',
      detail: `duplicate of "${existing[result.duplicateOf].title}": ${result.reason}`,
      usage: tokenUsage,
    };
  } catch (e) {
    return { status: 'unavailable', detail: (e as Error).message.slice(0, 200), usage: ZERO_USAGE };
  }
}
```

In `packages/db/src/generation/index.ts` add:

```ts
export {
  MAX_FW_PROMPTS_FOR_DEDUP,
  checkFreeWritingDuplicate,
  fetchFreeWritingPromptSummaries,
  type FreeWritingDuplicateCheck,
} from './free-writing-dedup';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup && pnpm --filter @language-drill/shared build >/dev/null && pnpm --filter @language-drill/shared test 2>&1 | grep "Tests "; cd packages/db && env -u DATABASE_URL pnpm exec vitest run src/generation/free-writing-dedup.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup && pnpm --filter @language-drill/shared lint && pnpm --filter @language-drill/shared typecheck && pnpm --filter @language-drill/db lint && pnpm --filter @language-drill/db typecheck && \
[ "$(git branch --show-current)" = feat/fw-semantic-dedup ] && \
git add packages/shared/src/generation-reasons.ts packages/shared/src/generation-reasons.test.ts packages/db/src/generation/free-writing-dedup.ts packages/db/src/generation/free-writing-dedup.test.ts packages/db/src/generation/index.ts && \
git commit -m "Check free-writing drafts against the cell's prompts before insert

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Wire the check into the insert path, retries and the outcome pool (`packages/db`)

**Files:**
- Modify: `packages/db/src/generation/validate-and-insert.ts` (`runRetryGeneration` callers, the insert block around `capReached`)
- Modify: `packages/db/src/generation/run-one-cell.ts` (`fetchPriorFreeWritingTitles` → `fetchPriorFreeWritingPrompts`; outcome-pool concurrency)
- Test: `packages/db/src/generation/validate-and-insert.test.ts`, `packages/db/src/generation/run-one-cell.test.ts`

**Interfaces:**
- Consumes: `checkFreeWritingDuplicate`, `fetchFreeWritingPromptSummaries` (Task 3); `freeWritingHistoryLine` (Task 1); `GenerationReasonCode.DedupCheckUnavailable` (Task 3).
- Produces: `fetchPriorFreeWritingPrompts(db: Db, cell: Cell): Promise<readonly string[]>` (exported from `run-one-cell.ts`, replacing `fetchPriorFreeWritingTitles`).

- [ ] **Step 1: Write the failing tests**

In `validate-and-insert.test.ts`, add a module mock after the existing `vi.mock('@language-drill/ai', …)`:

```ts
vi.mock('./free-writing-dedup', () => ({
  checkFreeWritingDuplicate: vi.fn(),
  fetchFreeWritingPromptSummaries: vi.fn(),
}));
```

and below the existing imports:

```ts
import { checkFreeWritingDuplicate, fetchFreeWritingPromptSummaries } from './free-writing-dedup';
const mockFwCheck = vi.mocked(checkFreeWritingDuplicate);
const mockFwSummaries = vi.mocked(fetchFreeWritingPromptSummaries);
```

Add `mockFwCheck.mockReset(); mockFwSummaries.mockReset();` to the file's top-level `beforeEach`. Then append:

```ts
// ---------------------------------------------------------------------------
// Free-writing semantic dedup: the judge pre-empts the INSERT like the vocab
// per-word cap, retries see refreshed history, a judge outage inserts flagged.
// ---------------------------------------------------------------------------

const fwCell: Cell = {
  language: Language.ES,
  cefrLevel: CefrLevel.B2,
  exerciseType: ExerciseType.FREE_WRITING,
  grammarPoint,
  cellKey: 'es:b2:free_writing:es-b1-test',
};
const fwSpec: GenerationSpec = { ...spec, cefrLevel: CefrLevel.B2, exerciseType: ExerciseType.FREE_WRITING, priorPoolSurfaces: ['Old — stale'] };

function makeFwDraft(id = 'fw-draft-0'): ExerciseDraft {
  return {
    id,
    contentJson: {
      type: ExerciseType.FREE_WRITING,
      instructions: 'Write.',
      title: 'El teletrabajo',
      task: 'Explica si el teletrabajo aísla.',
      domain: 'opinión',
      register: 'neutral',
      minWords: 120,
      maxWords: 180,
      requiredElements: [{ id: 'a', label: 'Opina' }],
    } as unknown as ExerciseDraft['contentJson'],
    metadata: makeDraft().metadata,
  };
}

const NO_USAGE = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

describe('validateAndInsertWithRetry — free-writing semantic dedup', () => {
  it('inserts a distinct free-writing draft', async () => {
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);
    mockFwCheck.mockResolvedValue({ status: 'distinct', detail: 'new', usage: NO_USAGE });
    const capture: { exercise?: Record<string, unknown> } = {};
    const outcome = await validateAndInsertWithRetry({
      db: makeInsertSucceedsDb(capture), client: mockClient, spec: fwSpec, draft: makeFwDraft(),
      ordinal: 0, cell: fwCell, args, generatedAt,
    });
    expect(outcome.terminalStatus).toBe('inserted-approved');
    expect(mockFwCheck).toHaveBeenCalledTimes(1);
    expect(mockGenerateBatch).not.toHaveBeenCalled();
  });

  it('routes a semantic duplicate through retries to dedup-given-up, with refreshed history each retry', async () => {
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);
    mockFwCheck.mockResolvedValue({ status: 'duplicate', detail: 'duplicate of "X"', usage: NO_USAGE });
    mockFwSummaries.mockResolvedValue([{ title: 'Fresh', task: 'Just inserted.', requiredElements: [] }]);
    mockGenerateBatch.mockResolvedValue({ drafts: [makeFwDraft('fw-retry')], malformedDrafts: [], tokenUsage: NO_USAGE } satisfies GenerateBatchResult);

    const outcome = await validateAndInsertWithRetry({
      db: makeInsertSucceedsDb({}), client: mockClient, spec: fwSpec, draft: makeFwDraft(),
      ordinal: 0, cell: fwCell, args, generatedAt,
    });

    expect(outcome.terminalStatus).toBe('dedup-given-up');
    expect(outcome.insertedExerciseId).toBeUndefined();
    expect(mockGenerateBatch).toHaveBeenCalledTimes(3);
    for (const call of mockGenerateBatch.mock.calls) {
      expect(call[1].priorPoolSurfaces).toEqual(['Fresh — Just inserted.']);
    }
  });

  it('inserts flagged with dedup-check-unavailable when the judge is unavailable', async () => {
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);
    mockFwCheck.mockResolvedValue({ status: 'unavailable', detail: 'timeout', usage: NO_USAGE });
    const capture: { exercise?: Record<string, unknown> } = {};
    const outcome = await validateAndInsertWithRetry({
      db: makeInsertSucceedsDb(capture), client: mockClient, spec: fwSpec, draft: makeFwDraft(),
      ordinal: 0, cell: fwCell, args, generatedAt,
    });
    expect(outcome.terminalStatus).toBe('inserted-flagged');
    expect(outcome.terminalReviewStatus).toBe('flagged');
    expect(capture.exercise?.reviewStatus).toBe('flagged');
    expect(capture.exercise?.flaggedReasons).toEqual([
      { code: GenerationReasonCode.DedupCheckUnavailable, detail: 'timeout' },
    ]);
  });

  it('never calls the judge for non-free-writing cells', async () => {
    mockValidateDraft.mockResolvedValue(PASSING_VALIDATION);
    await validateAndInsertWithRetry({
      db: makeInsertSucceedsDb({}), client: mockClient, spec, draft: makeDraft(),
      ordinal: 0, cell, args, generatedAt,
    });
    expect(mockFwCheck).not.toHaveBeenCalled();
  });
});
```

Check `makeInsertSucceedsDb` (line ~413) captures `values` the way the assertions expect (`capture.exercise` = the exercises-row values). If its shape differs, adapt only the capture lines, not the production code.

In `run-one-cell.test.ts`, inside the `'runOneCell — approvedDictationIds collection (pool-mocked)'` describe, add:

```ts
  it('runs free-writing outcomes serially and other types at full concurrency', async () => {
    const { db } = makeMockDb();
    await runOneCell({
      db, client: {} as never, cell: buildCell(ExerciseType.FREE_WRITING),
      args: { count: 3, batchSeed: 'fw-serial', topicDomain: null, maxCostUsd: 5 },
      jobId: randomUUID(), trigger: 'scheduled',
    });
    expect(vi.mocked(runOutcomePool).mock.calls[0][0].concurrency).toBe(1);

    vi.mocked(runOutcomePool).mockClear();
    await runOneCell({
      db, client: {} as never, cell: buildCell(ExerciseType.CLOZE),
      args: { count: 3, batchSeed: 'cloze-par', topicDomain: null, maxCostUsd: 5 },
      jobId: randomUUID(), trigger: 'scheduled',
    });
    expect(vi.mocked(runOutcomePool).mock.calls[0][0].concurrency).toBeGreaterThan(1);
  });
```

If the free-writing cell path needs a grammar-point field the bare `buildCell` stub lacks and throws before `runOutcomePool`, read the stack trace and give the stub only the missing field.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup && pnpm --filter @language-drill/shared build >/dev/null && pnpm --filter @language-drill/ai build >/dev/null && cd packages/db && env -u DATABASE_URL pnpm exec vitest run src/generation/validate-and-insert.test.ts src/generation/run-one-cell.test.ts`
Expected: FAIL. The judge is never called, the retry history is stale, and the concurrency is 5.

- [ ] **Step 3: Implement**

In `validate-and-insert.ts`:

1. Imports: add `freeWritingHistoryLine` and `type GenerationSpec` (if not already imported) to the `@language-drill/ai` import; add `GenerationReasonCode` to the `@language-drill/shared` import (if not already); add

```ts
import { checkFreeWritingDuplicate, fetchFreeWritingPromptSummaries } from './free-writing-dedup';
```

2. Inside `body` (before the attempt loop), add:

```ts
  const isFreeWriting = opts.cell.exerciseType === ExerciseType.FREE_WRITING;
  // A free-writing retry must see prompts inserted since the batch started
  // (including this batch's siblings), not the frozen batch-start history.
  const retrySpec = async (): Promise<GenerationSpec> =>
    isFreeWriting
      ? {
          ...opts.spec,
          priorPoolSurfaces: (await fetchFreeWritingPromptSummaries(opts.db, opts.cell)).map(
            freeWritingHistoryLine,
          ),
        }
      : opts.spec;
```

3. In **both** `runRetryGeneration(opts.client, opts.spec, attempt + 1, opts.signal)` calls, replace `opts.spec` with `await retrySpec()`.

4. Right after the `const capReached = …;` statement, add:

```ts
    // Free-writing semantic dedup (#757): pre-empts the INSERT exactly like the
    // vocab cap, so a duplicate takes the dedup-retry path. Re-reads the pool
    // per attempt; outcomes run serially for free-writing cells (run-one-cell).
    const fwCheck =
      !capReached && isFreeWriting
        ? await checkFreeWritingDuplicate(opts.db, opts.client, opts.cell, currentDraft.contentJson, opts.signal)
        : null;
    if (fwCheck) extraUsage = addUsage(extraUsage, fwCheck.usage);
    const semanticDuplicate = fwCheck?.status === 'duplicate';
    // A judge outage inserts FLAGGED (not served) rather than approving blind.
    const insertDecision =
      fwCheck?.status === 'unavailable'
        ? {
            reviewStatus: 'flagged' as const,
            flaggedReasons: [
              ...gatedDecision.flaggedReasons,
              { code: GenerationReasonCode.DedupCheckUnavailable, detail: fwCheck.detail },
            ],
          }
        : gatedDecision;
```

5. Change `const inserted = capReached ? [] : await opts.db…` to `const inserted = capReached || semanticDuplicate ? [] : await opts.db…`.

6. Inside the INSERT `.values({...})` and the `if (inserted.length > 0)` block, replace every `gatedDecision.reviewStatus` / `gatedDecision.flaggedReasons` with `insertDecision.reviewStatus` / `insertDecision.flaggedReasons` (the `reviewStatus`, `flaggedReasons`, `terminalStatus` and `terminalReviewStatus` expressions). Leave the rejected branch above untouched.

In `run-one-cell.ts`:

1. Replace `fetchPriorFreeWritingTitles` (and its doc comment) with:

```ts
/**
 * The cell's free-writing prompts as `title — task` lines for the generator's
 * avoid-list (`renderPriorTitlesSection`). Titles alone let one question be
 * reworded 5–10× under new titles (#757). Same review-status set and cap as
 * the dedup judge's pool; deterministic order keeps the system prompt
 * byte-identical across the batch.
 */
export async function fetchPriorFreeWritingPrompts(
  db: Db,
  cell: Cell,
): Promise<readonly string[]> {
  return (await fetchFreeWritingPromptSummaries(db, cell)).map(freeWritingHistoryLine);
}
```

Import `fetchFreeWritingPromptSummaries` from `./free-writing-dedup` and `freeWritingHistoryLine` from `@language-drill/ai`. Update the call site (`? await fetchPriorFreeWritingTitles(db, cell)`) to `fetchPriorFreeWritingPrompts`. `git grep -n fetchPriorFreeWritingTitles` must return nothing afterwards (docs excepted).

2. At the `runOutcomePool({ … concurrency: MAX_OUTCOME_CONCURRENCY, })` call, change it to:

```ts
      // Free-writing outcomes run serially so each duplicate check sees the
      // previous ordinal's insert; two parallel checks could both pass.
      concurrency:
        cell.exerciseType === ExerciseType.FREE_WRITING ? 1 : MAX_OUTCOME_CONCURRENCY,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup/packages/db && env -u DATABASE_URL pnpm exec vitest run src/generation/`
Expected: PASS, including every pre-existing validate-and-insert, run-one-cell and outcome-pool test.

- [ ] **Step 5: Gate and commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup && pnpm --filter @language-drill/db lint && pnpm --filter @language-drill/db typecheck && (cd packages/db && env -u DATABASE_URL pnpm exec vitest run) && pnpm --filter @language-drill/db build >/dev/null && rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda typecheck && (cd infra/lambda && env -u DATABASE_URL pnpm exec vitest run) && \
[ "$(git branch --show-current)" = feat/fw-semantic-dedup ] && \
git add packages/db/src/generation/validate-and-insert.ts packages/db/src/generation/validate-and-insert.test.ts packages/db/src/generation/run-one-cell.ts packages/db/src/generation/run-one-cell.test.ts && \
git commit -m "Reject free-writing drafts that repeat a cell's essay question

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `eval:fw-dedup-judge` — judge accuracy against #757 clusters (`packages/ai/scripts`)

**Files:**
- Create: `packages/ai/scripts/fw-dedup-judge-eval.ts`
- Create: `packages/ai/scripts/fw-dedup-judge-eval.test.ts`
- Modify: `packages/ai/package.json` (`"eval:fw-dedup-judge": "tsx scripts/fw-dedup-judge-eval.ts"`)
- Modify: `package.json` (root: `"eval:fw-dedup-judge": "dotenv -e .env -- pnpm --filter @language-drill/ai eval:fw-dedup-judge"`)

**Interfaces:**
- Consumes: `judgeFreeWritingDuplicate`, `freeWritingSummary` (Task 1).
- Produces (exported for Task 6 and tests):
  - `type ProposalCell = { language: string; level: string; cell: string; clusters: Array<{ angle: string; keep: string; demote: string[] }> }`
  - `type LabeledRow = { id: string; cluster: number; isDuplicate: boolean }`
  - `buildGroundTruth(cell: ProposalCell): LabeledRow[]`
  - `type JudgeCase = { cell: string; id: string; truth: boolean; predicted: boolean; reason: string }`
  - `type JudgeScore = { tp: number; fp: number; fn: number; tn: number; precision: number; recall: number }`
  - `scoreJudge(cases: readonly JudgeCase[]): JudgeScore`
  - `JUDGE_PRECISION_BAR = 0.9`, `JUDGE_RECALL_BAR = 0.8`, `judgePasses(s: JudgeScore): boolean`
  - The report JSON has a top-level `passed: boolean` (Task 6 reads it).

- [ ] **Step 1: Write the failing tests**

Create `packages/ai/scripts/fw-dedup-judge-eval.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildGroundTruth, judgePasses, scoreJudge, type JudgeCase } from "./fw-dedup-judge-eval";

describe("buildGroundTruth", () => {
  it("labels rows in multi-row clusters as duplicates and singletons as distinct", () => {
    expect(
      buildGroundTruth({
        language: "ES",
        level: "A1",
        cell: "es-a1-fw-x",
        clusters: [
          { angle: "a", keep: "k1", demote: ["d1", "d2"] },
          { angle: "b", keep: "k2", demote: [] },
        ],
      }),
    ).toEqual([
      { id: "k1", cluster: 0, isDuplicate: true },
      { id: "d1", cluster: 0, isDuplicate: true },
      { id: "d2", cluster: 0, isDuplicate: true },
      { id: "k2", cluster: 1, isDuplicate: false },
    ]);
  });
});

describe("scoreJudge", () => {
  const c = (truth: boolean, predicted: boolean): JudgeCase => ({ cell: "x", id: "i", truth, predicted, reason: "" });

  it("computes precision and recall", () => {
    const s = scoreJudge([c(true, true), c(true, true), c(true, false), c(false, true), c(false, false)]);
    expect(s).toEqual({ tp: 2, fp: 1, fn: 1, tn: 1, precision: 2 / 3, recall: 2 / 3 });
  });

  it("scores precision 0 when nothing is predicted positive (fails the bar)", () => {
    expect(scoreJudge([c(true, false)]).precision).toBe(0);
  });

  it("scores recall 1 when there are no true positives to find", () => {
    expect(scoreJudge([c(false, false)]).recall).toBe(1);
  });
});

describe("judgePasses", () => {
  it("requires precision >= 0.9 and recall >= 0.8", () => {
    const base = { tp: 0, fp: 0, fn: 0, tn: 0 };
    expect(judgePasses({ ...base, precision: 0.9, recall: 0.8 })).toBe(true);
    expect(judgePasses({ ...base, precision: 0.89, recall: 1 })).toBe(false);
    expect(judgePasses({ ...base, precision: 1, recall: 0.79 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup/packages/ai && pnpm exec vitest run scripts/fw-dedup-judge-eval.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `packages/ai/scripts/fw-dedup-judge-eval.ts`:

```ts
/**
 * eval:fw-dedup-judge — measures the free-writing duplicate judge against the
 * #757 round-3 human clusters (docs/analysis/fw-round3-dedup-proposals-2026-10-07.json).
 * For each row, the judge runs once against the cell's other rows (the same
 * one-against-many shape production uses). A row is a true duplicate iff
 * another row shares its cluster. Reads prod content via DATABASE_URL
 * (read-only); writes ./eval-runs/<name>.json.
 *
 *   DATABASE_URL=<prod> pnpm eval:fw-dedup-judge [--out <name>] [--limit <cells>] [--max-cost-usd 5]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { inArray } from "drizzle-orm";
import { createDb, exercises, requireEnv } from "@language-drill/db";

import {
  ZERO_USAGE,
  addUsage,
  createClaudeClient,
  estimateCostUsd,
  freeWritingSummary,
  judgeFreeWritingDuplicate,
  type ClaudeUsageBreakdown,
  type FreeWritingPromptSummary,
} from "../src/index.js";
import { EVAL_RUNS_DIR } from "./eval-run.js";

export type ProposalCell = {
  language: string;
  level: string;
  cell: string;
  clusters: Array<{ angle: string; keep: string; demote: string[] }>;
};
export type LabeledRow = { id: string; cluster: number; isDuplicate: boolean };
export type JudgeCase = { cell: string; id: string; truth: boolean; predicted: boolean; reason: string };
export type JudgeScore = { tp: number; fp: number; fn: number; tn: number; precision: number; recall: number };

export const JUDGE_PRECISION_BAR = 0.9;
export const JUDGE_RECALL_BAR = 0.8;

export function buildGroundTruth(cell: ProposalCell): LabeledRow[] {
  return cell.clusters.flatMap((c, i) => {
    const ids = [c.keep, ...c.demote];
    return ids.map((id) => ({ id, cluster: i, isDuplicate: ids.length > 1 }));
  });
}

export function scoreJudge(cases: readonly JudgeCase[]): JudgeScore {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const c of cases) {
    if (c.truth && c.predicted) tp++;
    else if (!c.truth && c.predicted) fp++;
    else if (c.truth && !c.predicted) fn++;
    else tn++;
  }
  return {
    tp, fp, fn, tn,
    precision: tp + fp === 0 ? 0 : tp / (tp + fp),
    recall: tp + fn === 0 ? 1 : tp / (tp + fn),
  };
}

export function judgePasses(s: JudgeScore): boolean {
  return s.precision >= JUDGE_PRECISION_BAR && s.recall >= JUDGE_RECALL_BAR;
}

const DEFAULT_PROPOSALS = fileURLToPath(
  new URL("../../../docs/analysis/fw-round3-dedup-proposals-2026-10-07.json", import.meta.url),
);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      proposals: { type: "string", default: DEFAULT_PROPOSALS },
      out: { type: "string", default: `fw-dedup-judge-${new Date().toISOString().slice(0, 10)}` },
      limit: { type: "string" },
      "max-cost-usd": { type: "string", default: "5" },
    },
    allowPositionals: false,
  });
  const dbUrl = requireEnv("DATABASE_URL");
  console.log(`[fw-dedup-judge] reading rows (read-only) from ${new URL(dbUrl).host}`);
  const apiKey = requireEnv("ANTHROPIC_API_KEY");
  const db = createDb(dbUrl);
  const client = createClaudeClient(apiKey);
  const maxCost = Number(values["max-cost-usd"]);

  let cells = JSON.parse(readFileSync(values.proposals!, "utf8")) as ProposalCell[];
  if (values.limit) cells = cells.slice(0, Number(values.limit));

  const allIds = cells.flatMap((c) => buildGroundTruth(c).map((r) => r.id));
  const rows = await db
    .select({ id: exercises.id, contentJson: exercises.contentJson })
    .from(exercises)
    .where(inArray(exercises.id, allIds));
  const summaryById = new Map<string, FreeWritingPromptSummary>();
  for (const r of rows) {
    const s = freeWritingSummary(r.contentJson);
    if (s) summaryById.set(r.id, s);
  }

  const cases: JudgeCase[] = [];
  const disagreements: Array<JudgeCase & { candidate: FreeWritingPromptSummary; matched: FreeWritingPromptSummary | null }> = [];
  let usage: ClaudeUsageBreakdown = ZERO_USAGE;
  let missing = 0;
  let capped = false;

  outer: for (const cell of cells) {
    const labeled = buildGroundTruth(cell).filter((r) => {
      const ok = summaryById.has(r.id);
      if (!ok) missing++;
      return ok;
    });
    for (const row of labeled) {
      if (estimateCostUsd(usage) >= maxCost) { capped = true; break outer; }
      const others = labeled.filter((o) => o.id !== row.id);
      const existing = others.map((o) => summaryById.get(o.id)!);
      // Truth is relative to the rows actually present: a duplicate whose
      // cluster-mates are all missing from the DB is not a findable duplicate.
      const truth = others.some((o) => o.cluster === row.cluster);
      const candidate = summaryById.get(row.id)!;
      const { result, tokenUsage } = await judgeFreeWritingDuplicate(client, {
        candidate, existing, cefrLevel: cell.level,
      });
      usage = addUsage(usage, tokenUsage);
      const c: JudgeCase = { cell: cell.cell, id: row.id, truth, predicted: result.duplicateOf !== null, reason: result.reason };
      cases.push(c);
      if (c.truth !== c.predicted) {
        disagreements.push({ ...c, candidate, matched: result.duplicateOf === null ? null : existing[result.duplicateOf] });
      }
    }
  }

  const score = scoreJudge(cases);
  const passed = !capped && judgePasses(score);
  const report = {
    runName: values.out, startedAt: new Date().toISOString(), cells: cells.length,
    rowsJudged: cases.length, rowsMissing: missing, costCapped: capped,
    score, bars: { precision: JUDGE_PRECISION_BAR, recall: JUDGE_RECALL_BAR }, passed,
    costUsd: estimateCostUsd(usage), cases, disagreements,
  };
  mkdirSync(EVAL_RUNS_DIR, { recursive: true });
  const outPath = path.join(EVAL_RUNS_DIR, `${values.out}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`# Free-writing dedup judge — ${values.out}`);
  console.log(`rows judged ${cases.length} (missing ${missing})${capped ? " — COST CAPPED, partial" : ""}`);
  console.log(`precision ${score.precision.toFixed(3)} (bar ${JUDGE_PRECISION_BAR})  recall ${score.recall.toFixed(3)} (bar ${JUDGE_RECALL_BAR})`);
  console.log(`tp ${score.tp} fp ${score.fp} fn ${score.fn} tn ${score.tn}  cost $${report.costUsd.toFixed(2)}`);
  console.log(`**${passed ? "PASSED" : "FAILED"}** — ${disagreements.length} disagreements in ${outPath}`);
  if (!passed) process.exit(1);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error("[fw-dedup-judge] failed:", err);
    process.exit(1);
  });
}
```

Add the two `package.json` script entries listed under **Files**.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup/packages/ai && pnpm exec vitest run scripts/fw-dedup-judge-eval.test.ts`
Expected: PASS. Don't run `main` (it calls Claude and prod).

- [ ] **Step 5: Gate and commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup && pnpm --filter @language-drill/ai lint && pnpm --filter @language-drill/ai typecheck && \
[ "$(git branch --show-current)" = feat/fw-semantic-dedup ] && \
git add packages/ai/scripts/fw-dedup-judge-eval.ts packages/ai/scripts/fw-dedup-judge-eval.test.ts packages/ai/package.json package.json && \
git commit -m "Add eval:fw-dedup-judge to measure the judge against #757 clusters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `eval:fw-dedup` — offline pipeline A/B (`packages/ai/scripts`)

**Files:**
- Create: `packages/ai/scripts/fw-dedup-eval.ts`
- Create: `packages/ai/scripts/fw-dedup-eval.test.ts`
- Create: `packages/ai/scripts/fixtures/cells-fw-dedup.json`
- Modify: `packages/ai/package.json` (`"eval:fw-dedup": "tsx scripts/fw-dedup-eval.ts"`)
- Modify: `package.json` (root: `"eval:fw-dedup": "dotenv -e .env -- pnpm --filter @language-drill/ai eval:fw-dedup"`)
- Modify: `CLAUDE.md` (Running Locally table: rows for `eval:fw-dedup-judge` and `eval:fw-dedup`)

**Interfaces:**
- Consumes:
  - from `@language-drill/ai`: `generateBatch`, `validateDraft`, `judgeFreeWritingDuplicate`, `freeWritingSummary`, `freeWritingHistoryLine`, `QA_CRAFTER_MODEL`, `addUsage`, `ZERO_USAGE`, `estimateCostUsd`, `createClaudeClient`;
  - from `@language-drill/db`: `fetchFreeWritingPromptSummaries`, `getGrammarPoint`, `routeValidationResult`, `buildCellKey`, `createDb`, `exercises`, `requireEnv`;
  - from `@language-drill/shared`: `resolveCellTargetFor`;
  - from Task 5: the report's `passed` field.
- Produces (exported, tested):
  - `type AcceptedDraft = { summary: FreeWritingPromptSummary; status: 'auto-approved' | 'flagged' }`
  - `type ArmOutcome = { requested: number; accepted: AcceptedDraft[]; validations: number; autoApproved: number; usage: ClaudeUsageBreakdown }`
  - `type ArmMetrics = { requested: number; accepted: number; duplicates: number; duplicateRate: number; underfillRate: number; approvalRate: number; costUsd: number }`
  - `normalizeTitle(t: string): string`
  - `armMetrics(outcomes: readonly ArmOutcome[], duplicateFlags: readonly boolean[][]): ArmMetrics`
  - `CANDIDATE_MAX_DUP_RATE = 0.05`, `BASELINE_MIN_DUP_RATE = 0.2`, `MAX_APPROVAL_DROP = 0.1`
  - `fwDedupVerdict(input: { judgePassed: boolean; baseline: ArmMetrics; candidate: ArmMetrics }): 'ship-ready' | 'inspect' | 'inconclusive'`

- [ ] **Step 1: Write the failing tests**

Create `packages/ai/scripts/fw-dedup-eval.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { ZERO_USAGE } from "../src/index.js";
import { armMetrics, fwDedupVerdict, normalizeTitle, type ArmMetrics, type ArmOutcome } from "./fw-dedup-eval";

const acc = (title: string, status: "auto-approved" | "flagged" = "auto-approved") => ({
  summary: { title, task: "t", requiredElements: [] },
  status,
});

describe("normalizeTitle", () => {
  it("lowercases, strips diacritics and collapses whitespace", () => {
    expect(normalizeTitle("  El  Teletrabajo:  ¿Avance? ")).toBe("el teletrabajo: ¿avance?");
    expect(normalizeTitle("Café")).toBe(normalizeTitle("cafe"));
  });
});

describe("armMetrics", () => {
  it("pools across cells", () => {
    const outcomes: ArmOutcome[] = [
      { requested: 4, accepted: [acc("a"), acc("b", "flagged")], validations: 4, autoApproved: 3, usage: ZERO_USAGE },
      { requested: 2, accepted: [acc("c")], validations: 2, autoApproved: 1, usage: ZERO_USAGE },
    ];
    const m = armMetrics(outcomes, [[true, false], [false]]);
    expect(m).toEqual({
      requested: 6, accepted: 3, duplicates: 1, duplicateRate: 1 / 3,
      underfillRate: 3 / 6, approvalRate: 4 / 6, costUsd: 0,
    });
  });

  it("is all zeros with nothing requested", () => {
    expect(armMetrics([], [])).toEqual({
      requested: 0, accepted: 0, duplicates: 0, duplicateRate: 0, underfillRate: 0, approvalRate: 0, costUsd: 0,
    });
  });
});

describe("fwDedupVerdict", () => {
  const m = (duplicateRate: number, approvalRate = 0.9): ArmMetrics => ({
    requested: 20, accepted: 20, duplicates: 0, duplicateRate, underfillRate: 0, approvalRate, costUsd: 0,
  });

  it("is ship-ready when the judge passed, baseline duplicates, candidate does not, approval holds", () => {
    expect(fwDedupVerdict({ judgePassed: true, baseline: m(0.4), candidate: m(0.05, 0.8) })).toBe("ship-ready");
  });

  it("is inconclusive when the baseline barely duplicates", () => {
    expect(fwDedupVerdict({ judgePassed: true, baseline: m(0.19), candidate: m(0) })).toBe("inconclusive");
  });

  it("is inspect when the judge failed, candidate still duplicates, or approval drops >10pp", () => {
    expect(fwDedupVerdict({ judgePassed: false, baseline: m(0.4), candidate: m(0) })).toBe("inspect");
    expect(fwDedupVerdict({ judgePassed: true, baseline: m(0.4), candidate: m(0.06) })).toBe("inspect");
    expect(fwDedupVerdict({ judgePassed: true, baseline: m(0.4, 0.9), candidate: m(0, 0.79) })).toBe("inspect");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup/packages/ai && pnpm exec vitest run scripts/fw-dedup-eval.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `packages/ai/scripts/fixtures/cells-fw-dedup.json`:

```json
[
  { "language": "ES", "cefrLevel": "B2", "grammarPointKey": "es-b2-fw-study-abroad" },
  { "language": "ES", "cefrLevel": "B2", "grammarPointKey": "es-b2-fw-social-media" },
  { "language": "ES", "cefrLevel": "B2", "grammarPointKey": "es-b2-fw-technology-relationships" },
  { "language": "ES", "cefrLevel": "B1", "grammarPointKey": "es-b1-fw-daily-routine" },
  { "language": "ES", "cefrLevel": "B1", "grammarPointKey": "es-b1-fw-free-time" },
  { "language": "ES", "cefrLevel": "B2", "grammarPointKey": "es-b2-fw-environment" },
  { "language": "TR", "cefrLevel": "A1", "grammarPointKey": "tr-a1-fw-my-family" },
  { "language": "DE", "cefrLevel": "B1", "grammarPointKey": "de-b1-fw-complaint" }
]
```

Verify every key resolves with the right level: `cd packages/ai && pnpm exec tsx -e "import {readFileSync} from 'node:fs'; import {getGrammarPoint} from '@language-drill/db'; for (const c of JSON.parse(readFileSync('scripts/fixtures/cells-fw-dedup.json','utf8'))) { const g=getGrammarPoint(c.grammarPointKey); console.log(c.grammarPointKey, c.cefrLevel, g?.cefrLevel, g?.language) }"`; every line must show the fixture level equal to the curriculum level. Fix any mismatched `cefrLevel` in the fixture to the curriculum's value.

Create `packages/ai/scripts/fw-dedup-eval.ts`:

```ts
/**
 * eval:fw-dedup — offline A/B of free-writing generation, never writes to the DB.
 *
 * Baseline: today's pipeline. One batch with title-only history (rendered with
 * the current heading), validated, accepted unless rejected or the title
 * collides.
 * Candidate: the shipped pipeline, simulated in memory. Attempt 0 is one batch
 * with frozen `title — task` history; outcomes are processed serially; each
 * draft is judged against the cell's prompts plus the drafts accepted so far;
 * a duplicate retries up to 3× with refreshed history, then gives up. A judge
 * failure accepts the draft as flagged.
 * Scoring: an independent judge (QA_CRAFTER_MODEL) checks each accepted draft
 * against the cell's existing prompts and the arm's other accepted drafts.
 *
 *   DATABASE_URL=<prod> pnpm eval:fw-dedup --judge-report <abs path to eval:fw-dedup-judge JSON> [--out <name>] [--max-cost-usd 10]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type Anthropic from "@anthropic-ai/sdk";
import { and, count, eq, inArray } from "drizzle-orm";
import {
  buildCellKey,
  createDb,
  exercises,
  fetchFreeWritingPromptSummaries,
  getGrammarPoint,
  requireEnv,
  routeValidationResult,
  type Cell,
  type Db,
} from "@language-drill/db";
import {
  ExerciseType,
  resolveCellTargetFor,
  type CurriculumCefrLevel,
  type GrammarPoint,
  type LearningLanguage,
} from "@language-drill/shared";

import {
  QA_CRAFTER_MODEL,
  ZERO_USAGE,
  addUsage,
  createClaudeClient,
  estimateCostUsd,
  freeWritingHistoryLine,
  freeWritingSummary,
  generateBatch,
  judgeFreeWritingDuplicate,
  validateDraft,
  type ClaudeUsageBreakdown,
  type ExerciseDraft,
  type FreeWritingPromptSummary,
  type GenerationSpec,
} from "../src/index.js";
import { EVAL_RUNS_DIR } from "./eval-run.js";

export type AcceptedDraft = { summary: FreeWritingPromptSummary; status: "auto-approved" | "flagged" };
export type ArmOutcome = {
  requested: number;
  accepted: AcceptedDraft[];
  validations: number;
  autoApproved: number;
  usage: ClaudeUsageBreakdown;
};
export type ArmMetrics = {
  requested: number;
  accepted: number;
  duplicates: number;
  duplicateRate: number;
  underfillRate: number;
  approvalRate: number;
  costUsd: number;
};

export const CANDIDATE_MAX_DUP_RATE = 0.05;
export const BASELINE_MIN_DUP_RATE = 0.2;
export const MAX_APPROVAL_DROP = 0.1;
const MAX_RETRIES = 3;

export function normalizeTitle(t: string): string {
  return t.toLowerCase().normalize("NFKD").replace(/\p{Diacritic}+/gu, "").replace(/\s+/gu, " ").trim();
}

export function armMetrics(outcomes: readonly ArmOutcome[], duplicateFlags: readonly boolean[][]): ArmMetrics {
  let requested = 0, accepted = 0, duplicates = 0, validations = 0, autoApproved = 0;
  let usage: ClaudeUsageBreakdown = ZERO_USAGE;
  outcomes.forEach((o, i) => {
    requested += o.requested;
    accepted += o.accepted.length;
    validations += o.validations;
    autoApproved += o.autoApproved;
    usage = addUsage(usage, o.usage);
    duplicates += (duplicateFlags[i] ?? []).filter(Boolean).length;
  });
  return {
    requested, accepted, duplicates,
    duplicateRate: accepted === 0 ? 0 : duplicates / accepted,
    underfillRate: requested === 0 ? 0 : (requested - accepted) / requested,
    approvalRate: validations === 0 ? 0 : autoApproved / validations,
    costUsd: estimateCostUsd(usage),
  };
}

export function fwDedupVerdict(input: {
  judgePassed: boolean;
  baseline: ArmMetrics;
  candidate: ArmMetrics;
}): "ship-ready" | "inspect" | "inconclusive" {
  if (input.baseline.duplicateRate < BASELINE_MIN_DUP_RATE) return "inconclusive";
  const approvalDelta = input.candidate.approvalRate - input.baseline.approvalRate;
  return input.judgePassed &&
    input.candidate.duplicateRate <= CANDIDATE_MAX_DUP_RATE &&
    approvalDelta >= -MAX_APPROVAL_DROP - 1e-9
    ? "ship-ready"
    : "inspect";
}

type EvalCell = { cell: Cell; requested: number; existing: FreeWritingPromptSummary[] };

function specFor(c: EvalCell, count: number, batchSeed: string, priorPoolSurfaces: string[]): GenerationSpec {
  return {
    language: c.cell.language as GenerationSpec["language"],
    cefrLevel: c.cell.cefrLevel,
    exerciseType: ExerciseType.FREE_WRITING,
    grammarPoint: c.cell.grammarPoint,
    topicDomain: null,
    count,
    batchSeed,
    priorPoolSurfaces,
  };
}

async function validated(client: Anthropic, draft: ExerciseDraft, spec: GenerationSpec) {
  const { result, tokenUsage } = await validateDraft(client, draft, spec);
  return { status: routeValidationResult(result).reviewStatus, usage: tokenUsage };
}

async function runBaseline(client: Anthropic, c: EvalCell): Promise<ArmOutcome> {
  const out: ArmOutcome = { requested: c.requested, accepted: [], validations: 0, autoApproved: 0, usage: ZERO_USAGE };
  if (c.requested === 0) return out;
  const spec = specFor(c, c.requested, "eval-fw-baseline", c.existing.map((s) => s.title));
  const batch = await generateBatch(client, spec);
  out.usage = addUsage(out.usage, batch.tokenUsage);
  const seen = new Set(c.existing.map((s) => normalizeTitle(s.title)));
  for (const draft of batch.drafts) {
    const v = await validated(client, draft, spec);
    out.usage = addUsage(out.usage, v.usage);
    out.validations++;
    if (v.status === "auto-approved") out.autoApproved++;
    const summary = freeWritingSummary(draft.contentJson);
    if (v.status === "rejected" || summary === null) continue;
    const key = normalizeTitle(summary.title);
    if (seen.has(key)) continue; // title collision, as the dedup index would reject
    seen.add(key);
    out.accepted.push({ summary, status: v.status === "auto-approved" ? "auto-approved" : "flagged" });
  }
  return out;
}

async function runCandidate(client: Anthropic, c: EvalCell): Promise<ArmOutcome> {
  const out: ArmOutcome = { requested: c.requested, accepted: [], validations: 0, autoApproved: 0, usage: ZERO_USAGE };
  if (c.requested === 0) return out;
  const pool = (): FreeWritingPromptSummary[] => [...c.existing, ...out.accepted.map((a) => a.summary)];
  const spec0 = specFor(c, c.requested, "eval-fw-candidate", c.existing.map(freeWritingHistoryLine));
  const batch = await generateBatch(client, spec0);
  out.usage = addUsage(out.usage, batch.tokenUsage);

  for (let slot = 0; slot < batch.drafts.length; slot++) {
    let draft: ExerciseDraft | undefined = batch.drafts[slot];
    let deduped = false;
    for (let attempt = 0; attempt <= MAX_RETRIES && draft; attempt++) {
      const v = await validated(client, draft, spec0);
      out.usage = addUsage(out.usage, v.usage);
      out.validations++;
      if (v.status === "auto-approved") out.autoApproved++;
      const summary = freeWritingSummary(draft.contentJson);
      let retry = false;
      if (v.status === "rejected" || summary === null) {
        if (!deduped) break; // a rejected first attempt ends the slot, as in prod
        retry = true;
      } else {
        let status: "auto-approved" | "flagged" = v.status === "auto-approved" ? "auto-approved" : "flagged";
        let dup = false;
        try {
          const j = await judgeFreeWritingDuplicate(client, { candidate: summary, existing: pool(), cefrLevel: c.cell.cefrLevel });
          out.usage = addUsage(out.usage, j.tokenUsage);
          dup = j.result.duplicateOf !== null;
        } catch {
          status = "flagged"; // judge unavailable → inserted flagged
        }
        if (!dup) {
          out.accepted.push({ summary, status });
          break;
        }
        deduped = true;
        retry = true;
      }
      if (!retry || attempt === MAX_RETRIES) break;
      const r = await generateBatch(
        client,
        specFor(c, 1, `eval-fw-candidate::${slot}::retry-${attempt + 1}`, pool().map(freeWritingHistoryLine)),
      );
      out.usage = addUsage(out.usage, r.tokenUsage);
      draft = r.drafts[0];
    }
  }
  return out;
}

async function scoreArm(client: Anthropic, c: EvalCell, arm: ArmOutcome): Promise<{ flags: boolean[]; usage: ClaudeUsageBreakdown; errors: number }> {
  const flags: boolean[] = [];
  let usage: ClaudeUsageBreakdown = ZERO_USAGE;
  let errors = 0;
  for (let i = 0; i < arm.accepted.length; i++) {
    const others = [...c.existing, ...arm.accepted.filter((_, j) => j !== i).map((a) => a.summary)];
    try {
      const j = await judgeFreeWritingDuplicate(
        client,
        { candidate: arm.accepted[i].summary, existing: others, cefrLevel: c.cell.cefrLevel },
        { model: QA_CRAFTER_MODEL },
      );
      usage = addUsage(usage, j.tokenUsage);
      flags.push(j.result.duplicateOf !== null);
    } catch {
      errors++;
      flags.push(false);
    }
  }
  return { flags, usage, errors };
}

async function loadCell(db: Db, d: { language: string; cefrLevel: string; grammarPointKey: string }): Promise<EvalCell> {
  const gp = getGrammarPoint(d.grammarPointKey) as GrammarPoint | undefined;
  if (!gp) throw new Error(`unknown grammarPointKey ${d.grammarPointKey}`);
  const cell: Cell = {
    language: d.language as LearningLanguage,
    cefrLevel: d.cefrLevel as CurriculumCefrLevel,
    exerciseType: ExerciseType.FREE_WRITING,
    grammarPoint: gp,
    cellKey: buildCellKey({ language: d.language, cefrLevel: d.cefrLevel, exerciseType: ExerciseType.FREE_WRITING, grammarPointKey: d.grammarPointKey }),
  };
  const [{ n }] = await db
    .select({ n: count() })
    .from(exercises)
    .where(
      and(
        eq(exercises.language, cell.language),
        eq(exercises.difficulty, cell.cefrLevel),
        eq(exercises.type, ExerciseType.FREE_WRITING),
        eq(exercises.grammarPointKey, gp.key),
        inArray(exercises.reviewStatus, ["auto-approved", "manual-approved"]),
      ),
    );
  const target = resolveCellTargetFor({ exerciseType: ExerciseType.FREE_WRITING, cefrLevel: cell.cefrLevel, grammarPoint: gp });
  return { cell, requested: Math.max(0, target - Number(n)), existing: await fetchFreeWritingPromptSummaries(db, cell) };
}

const DEFAULT_DATASET = fileURLToPath(new URL("./fixtures/cells-fw-dedup.json", import.meta.url));

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "judge-report": { type: "string" },
      dataset: { type: "string", default: DEFAULT_DATASET },
      out: { type: "string", default: `fw-dedup-${new Date().toISOString().slice(0, 10)}` },
      "max-cost-usd": { type: "string", default: "10" },
    },
    allowPositionals: false,
  });
  if (!values["judge-report"]) throw new Error("--judge-report <abs path to eval:fw-dedup-judge JSON> is required");
  const judgePassed = (JSON.parse(readFileSync(values["judge-report"], "utf8")) as { passed?: boolean }).passed === true;
  const dbUrl = requireEnv("DATABASE_URL");
  console.log(`[fw-dedup] reading the pool (read-only) from ${new URL(dbUrl).host}; judge passed=${judgePassed}`);
  const db = createDb(dbUrl);
  const client = createClaudeClient(requireEnv("ANTHROPIC_API_KEY"));
  const maxCost = Number(values["max-cost-usd"]);
  const dataset = JSON.parse(readFileSync(values.dataset!, "utf8")) as Array<{ language: string; cefrLevel: string; grammarPointKey: string }>;

  const perCell: Array<Record<string, unknown>> = [];
  const base: ArmOutcome[] = [], cand: ArmOutcome[] = [];
  const baseFlags: boolean[][] = [], candFlags: boolean[][] = [];
  let scoringUsage: ClaudeUsageBreakdown = ZERO_USAGE;
  let scoringErrors = 0;
  let capped = false;

  for (const d of dataset) {
    const spent = estimateCostUsd([...base, ...cand].reduce((u, o) => addUsage(u, o.usage), scoringUsage));
    if (spent >= maxCost) { capped = true; break; }
    const c = await loadCell(db, d);
    const b = await runBaseline(client, c);
    const k = await runCandidate(client, c);
    const bs = await scoreArm(client, c, b);
    const ks = await scoreArm(client, c, k);
    scoringUsage = addUsage(addUsage(scoringUsage, bs.usage), ks.usage);
    scoringErrors += bs.errors + ks.errors;
    base.push(b); cand.push(k); baseFlags.push(bs.flags); candFlags.push(ks.flags);
    perCell.push({
      cellKey: c.cell.cellKey, requested: c.requested, existing: c.existing,
      baseline: { accepted: b.accepted, duplicateFlags: bs.flags },
      candidate: { accepted: k.accepted, duplicateFlags: ks.flags },
    });
    console.log(`[fw-dedup] ${c.cell.cellKey}: requested ${c.requested}; baseline ${b.accepted.length} (${bs.flags.filter(Boolean).length} dup), candidate ${k.accepted.length} (${ks.flags.filter(Boolean).length} dup)`);
  }

  const baseline = armMetrics(base, baseFlags);
  const candidate = armMetrics(cand, candFlags);
  const verdict = capped ? "inspect" : fwDedupVerdict({ judgePassed, baseline, candidate });
  const report = {
    runName: values.out, startedAt: new Date().toISOString(), judgePassed, costCapped: capped,
    baseline, candidate, verdict, scoringErrors, scoringCostUsd: estimateCostUsd(scoringUsage), perCell,
  };
  mkdirSync(EVAL_RUNS_DIR, { recursive: true });
  const outPath = path.join(EVAL_RUNS_DIR, `${values.out}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`\n# Free-writing dedup A/B — ${values.out}${capped ? " (COST CAPPED, partial)" : ""}`);
  console.log("| | Baseline | Candidate |\n|---|---|---|");
  console.log(`| requested | ${baseline.requested} | ${candidate.requested} |`);
  console.log(`| accepted | ${baseline.accepted} | ${candidate.accepted} |`);
  console.log(`| duplicate rate | ${pct(baseline.duplicateRate)} | ${pct(candidate.duplicateRate)} |`);
  console.log(`| underfill | ${pct(baseline.underfillRate)} | ${pct(candidate.underfillRate)} |`);
  console.log(`| approval | ${pct(baseline.approvalRate)} | ${pct(candidate.approvalRate)} |`);
  console.log(`| cost | $${baseline.costUsd.toFixed(2)} | $${candidate.costUsd.toFixed(2)} |`);
  console.log(`\n**Verdict:** ${verdict} — ship-ready iff judge passed, candidate dup ≤ 5%, baseline dup ≥ 20%, approval Δ ≥ −10pp.`);
  console.log(`scoring $${report.scoringCostUsd.toFixed(2)}, ${scoringErrors} scoring errors; full report ${outPath}`);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error("[fw-dedup] failed:", err);
    process.exit(1);
  });
}
```

If an import name differs (for example `count` from `drizzle-orm`, or `Db`/`Cell` not re-exported from `@language-drill/db`), check it with `grep` in the package and use the existing export; don't add new exports to other packages beyond Task 3's.

Add the two `package.json` script entries listed under **Files**. In `CLAUDE.md`'s "Running Locally" table, add after the `pnpm eval:gen:export` row:

```
| `pnpm eval:fw-dedup-judge` | Measures the free-writing duplicate judge against the #757 human clusters (`docs/analysis/fw-round3-dedup-proposals-2026-10-07.json`): the judge runs once per row against the cell's other rows; row-level precision/recall against the bar (precision ≥ 0.9, recall ≥ 0.8). Reads prod content via `DATABASE_URL` (read-only; the local `.env` is the dev branch, so pass a prod URL inline). Writes `./eval-runs/<name>.json` (`passed` field). Exits 1 below the bar. ~$1–2. Supports `--limit`, `--out`, `--max-cost-usd`. |
| `pnpm eval:fw-dedup` | Offline A/B of free-writing generation (never writes): baseline = title-only history, title dedup; candidate = the shipped `title — task` history + duplicate judge + serial outcomes + refreshed-history retries. Scored by an independent `QA_CRAFTER_MODEL` judge. Requires `--judge-report <abs path>` from `eval:fw-dedup-judge`. Verdict: ship-ready iff judge passed, candidate dup ≤ 5%, baseline dup ≥ 20%, approval Δ ≥ −10pp; inconclusive if baseline dup < 20%. Paths must be absolute (pnpm `--filter` runs from `packages/ai`). ~$3–5. |
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup && pnpm --filter @language-drill/db build >/dev/null && cd packages/ai && pnpm exec vitest run scripts/fw-dedup-eval.test.ts scripts/fw-dedup-judge-eval.test.ts`
Expected: PASS. Don't run `main`.

- [ ] **Step 5: Gate and commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/fw-semantic-dedup && pnpm --filter @language-drill/ai lint && pnpm --filter @language-drill/ai typecheck && pnpm --filter @language-drill/ai test && (cd packages/ai && pnpm exec vitest run scripts/) && \
[ "$(git branch --show-current)" = feat/fw-semantic-dedup ] && \
git add packages/ai/scripts/fw-dedup-eval.ts packages/ai/scripts/fw-dedup-eval.test.ts packages/ai/scripts/fixtures/cells-fw-dedup.json packages/ai/package.json package.json CLAUDE.md && \
git commit -m "Add eval:fw-dedup, an offline A/B of free-writing dedup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7 (after merge, controller only): Langfuse bootstrap and the two eval runs

Spends about $5–7 in total and writes to Langfuse. **Confirm with the user before starting.**

- [ ] **Step 1:** From fresh `main`, run `bootstrap-prompts --dry-run`, then `bootstrap-prompts`, then `--check`, once each for prod and dev, with inline creds from Secrets Manager (CLAUDE.md "Prompt Editing" block). Expected: the dedup prompt is created in each environment, `--check` exits 0, and nothing else drifts.
- [ ] **Step 2:** `DATABASE_URL="$PRODDB" pnpm eval:fw-dedup-judge --out fw-dedup-judge-2026-10` (prod URL from Secrets Manager `language-drill/DATABASE_URL` into a shell variable, never printed). If it fails the bar, read the disagreements, fix the judge prompt (bumping its version), and re-run before step 3.
- [ ] **Step 3:** `DATABASE_URL="$PRODDB" pnpm eval:fw-dedup --judge-report "$PWD/packages/ai/eval-runs/fw-dedup-judge-2026-10.json" --out fw-dedup-2026-10`. Read the per-cell accepted drafts in the JSON, report the verdict, and copy both reports to the main checkout's `packages/ai/eval-runs/`.
