# Free Writing Unstuck Helpers (Brainstorm + Vocab Boost) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two metered, non-streaming AI "getting-unstuck" helpers to the free-writing drill — Brainstorm (English idea bullets) and Vocabulary boost (target-language words + English glosses) — wired into the composer behind a cached, regenerable panel.

**Architecture:** Two Hono routes (`POST /exercises/:id/brainstorm`, `POST /exercises/:id/vocab-boost`) mirror the `/exercises/:id/submit` metered-AI gate, share one `runWritingHelper` helper, call Claude via tool-use, and record one `writing_helper` usage event. The AI layer mirrors the `free-writing-evaluate` / `free-writing-prompts` split. The web layer adds an `FwUnstuck` component that lazy-fetches via React Query (cached per exercise, `staleTime: Infinity`; "regenerate" re-bills).

**Tech Stack:** TypeScript, Hono (Lambda), Anthropic SDK (tool-use), Drizzle, Zod, TanStack Query, Next.js, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-15-free-writing-unstuck-helpers-design.md`.

**Decisions baked in:** one shared `writing_helper` bucket (50/day free, 500 boosted); brainstorm bullets in English; cache-per-exercise with explicit regenerate. Start-my-paragraph + scaffolded scoring are a SEPARATE later spec.

---

## Conventions for every task

- Worktree root: `/Users/seal/dev/language-drill/.claude/worktrees/feat-free-writing-unstuck`. Run all commands from there.
- TDD: write the test, run it, watch it FAIL for the right reason, implement, run it, watch it PASS, commit.
- After editing `packages/*` source, single-package vitest may resolve a stale `dist`. If a web/lambda test fails to import a freshly added `@language-drill/*` symbol, run `pnpm turbo run build --filter=<changed package>` first (known dist-resolution quirk).
- Per-package test command: `pnpm --filter <pkg> exec vitest run <pattern>`. Packages: `@language-drill/ai`, `@language-drill/lambda` (this is `infra/lambda`), `@language-drill/api-client`, `@language-drill/web`.

---

## File Structure

**Create:**
- `packages/ai/src/writing-helper-prompts.ts` — system prompts, version constants, user-prompt builders, tool schemas.
- `packages/ai/src/writing-helper.ts` — `generateBrainstorm` / `generateVocabBoost`, parsers, shared `runHelperTool`, timeout/retry constants.
- `packages/ai/src/writing-helper.test.ts` — generator + parser unit tests.
- `packages/api-client/src/schemas/writing-helper.ts` — `BrainstormSchema` / `VocabBoostSchema`.
- `packages/api-client/src/schemas/writing-helper.test.ts` — schema-parse tests.
- `packages/api-client/src/hooks/useBrainstorm.ts`, `packages/api-client/src/hooks/useVocabBoost.ts`.
- `apps/web/app/(dashboard)/drill/free-writing/_components/fw-unstuck.tsx` — the helper panel.
- `apps/web/app/(dashboard)/drill/free-writing/_components/fw-unstuck.test.tsx`.

**Modify:**
- `packages/ai/src/observability.ts` — extend `LlmFeature` union (+2).
- `packages/ai/src/index.ts` — re-export the new AI symbols.
- `packages/ai/scripts/bootstrap-prompts.ts` — add 2 manifest entries.
- `packages/ai/scripts/bootstrap-prompts.test.ts` — count 10 → 12.
- `infra/lambda/src/usage/limits.ts` — add `writing_helper` bucket.
- `infra/lambda/src/usage/limits.test.ts` — assert the new bucket.
- `infra/lambda/src/routes/exercises.ts` — `runWritingHelper` + two routes + imports.
- `infra/lambda/src/routes/exercises.test.ts` — route tests (or a new sibling test file — see Task 5).
- `packages/api-client/src/index.ts` — re-export new schemas + hooks.
- `apps/web/app/(dashboard)/drill/free-writing/_components/fw-composer.tsx` — render `FwUnstuck`, add 2 props.
- `apps/web/app/(dashboard)/drill/free-writing/_components/fw-composer.test.tsx` — mock hooks, new props, update the "disabled" assertion.
- `apps/web/app/(dashboard)/drill/free-writing/page.tsx` — pass `exerciseId` + `fetchFn` to `FwComposer`.
- `apps/web/app/(dashboard)/drill/free-writing/free-writing.css` — `.fw-helppanel` / `.fw-vocab-row` / `.fw-helpbtn.active`.
- `CLAUDE.md` — add the 2 version constants to the prompt-version table.

---

## Task 1: AI — Brainstorm prompt + generator

**Files:**
- Create: `packages/ai/src/writing-helper-prompts.ts`
- Create: `packages/ai/src/writing-helper.ts`
- Create: `packages/ai/src/writing-helper.test.ts`

- [ ] **Step 1: Write the failing test** (`packages/ai/src/writing-helper.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
import {
  generateBrainstorm,
  parseBrainstorm,
  BRAINSTORM_TOOL_NAME,
} from "./writing-helper.js";
import { ExerciseType, type FreeWritingContent, Language, CefrLevel } from "@language-drill/shared";

const content: FreeWritingContent = {
  type: ExerciseType.FREE_WRITING,
  instructions: "i",
  title: "El teletrabajo",
  task: "Argumenta a favor o en contra.",
  domain: "opinión",
  register: "formal",
  minWords: 150,
  maxWords: 200,
  suggestedMinutes: 20,
  requiredElements: [{ id: "c", label: "Usa dos condicionales" }],
};

function clientReturning(toolName: string, input: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: toolName, input }],
      }),
    },
  } as never;
}

describe("parseBrainstorm", () => {
  it("keeps well-formed groups and drops malformed ones", () => {
    const out = parseBrainstorm({
      groups: [
        { label: "For", points: ["flexibility", "no commute"] },
        { label: "Against", points: ["isolation", 5] }, // 5 dropped
        { label: 42, points: ["x"] }, // whole group dropped (bad label)
        "nope", // dropped
      ],
    });
    expect(out.groups).toEqual([
      { label: "For", points: ["flexibility", "no commute"] },
      { label: "Against", points: ["isolation"] },
    ]);
  });

  it("returns empty groups for non-object input", () => {
    expect(parseBrainstorm(null).groups).toEqual([]);
  });
});

describe("generateBrainstorm", () => {
  it("forces the brainstorm tool and returns the parsed result", async () => {
    const client = clientReturning(BRAINSTORM_TOOL_NAME, {
      groups: [{ label: "Angle", points: ["idea one", "idea two"] }],
    });
    const result = await generateBrainstorm(client, {
      content,
      language: Language.ES,
      difficulty: CefrLevel.B1,
    });
    expect(result.groups).toEqual([{ label: "Angle", points: ["idea one", "idea two"] }]);

    const callArgs = (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } })
      .messages.create.mock.calls[0][0];
    expect(callArgs.tool_choice).toEqual({ type: "tool", name: BRAINSTORM_TOOL_NAME });
    expect(callArgs.temperature).toBe(0);
  });

  it("throws if Claude returns no tool_use block", async () => {
    const client = {
      messages: { create: vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [] }) },
    } as never;
    await expect(
      generateBrainstorm(client, { content, language: Language.ES, difficulty: CefrLevel.B1 }),
    ).rejects.toThrow(/tool use block/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai exec vitest run writing-helper`
Expected: FAIL — `Cannot find module './writing-helper.js'`.

- [ ] **Step 3: Create the prompts file** (`packages/ai/src/writing-helper-prompts.ts`)

```ts
/**
 * packages/ai — Free Writing "getting-unstuck" helper prompts (Brainstorm +
 * Vocabulary boost). Both are cheap, pre-writing helpers grounded in the
 * exercise prompt. Brainstorm returns ENGLISH idea bullets (ideas, not
 * phrasing); Vocab boost returns TARGET-LANGUAGE words with English glosses.
 */

import { type FreeWritingContent, type CefrLevel, type Language } from "@language-drill/shared";

// Bump in the same commit as any semantic edit below (CLAUDE.md "Prompt Editing").
export const BRAINSTORM_PROMPT_VERSION = "free-writing-brainstorm@2026-06-15";
export const VOCAB_BOOST_PROMPT_VERSION = "free-writing-vocab-boost@2026-06-15";

export const BRAINSTORM_SYSTEM_PROMPT = `You are a brainstorming coach inside a language-learning writing app. The learner is about to write a short text for the prompt below and may be stuck for ideas.

Return 2–3 angle groups. Each group has a short English label (2–4 words) and 2–4 bullet points. The bullets are IDEAS — angles, examples, points to consider — NOT sentences to copy. Write every label and bullet in English (the app's UI language): you spark WHAT the learner could say, never HOW to phrase it in the target language. Never produce target-language sentences or phrasings.

Keep bullets short (a few words to one line). Ground them in the specific prompt, register, and any required elements. Submit via the tool.`;

export const VOCAB_BOOST_SYSTEM_PROMPT = `You are a vocabulary coach inside a language-learning writing app. The learner is about to write a short text for the prompt below and wants useful words.

Return 8–10 words or short phrases IN THE TARGET LANGUAGE that would help write about this prompt at the learner's CEFR level and register. For each, give \`term\` (the target-language word/phrase, with article/gender where idiomatic) and \`gloss\` (a short English meaning, at most 6 words). Prefer mid-frequency, topic-relevant, level-appropriate items over generic words the learner already knows. Submit via the tool.`;

function contextBlock(content: FreeWritingContent, language: Language, difficulty: CefrLevel): string {
  const required = content.requiredElements.length
    ? content.requiredElements.map((r) => `- ${r.label}${r.detail ? ` (${r.detail})` : ""}`).join("\n")
    : "- (none)";
  return `**Target language:** ${language}
**Target CEFR level:** ${difficulty}
**Register:** ${content.register}
**Length band:** ${content.minWords}–${content.maxWords} words

**Prompt title:** ${content.title}
**Task:** ${content.task}

**Required elements:**
${required}`;
}

export function buildBrainstormUserPrompt(
  content: FreeWritingContent,
  language: Language,
  difficulty: CefrLevel,
): string {
  return `## Brainstorm request

${contextBlock(content, language, difficulty)}

Brainstorm 2–3 angle groups of English idea bullets for this prompt. Submit via the tool.`;
}

export function buildVocabBoostUserPrompt(
  content: FreeWritingContent,
  language: Language,
  difficulty: CefrLevel,
): string {
  return `## Vocabulary request

${contextBlock(content, language, difficulty)}

Suggest 8–10 target-language words or phrases with short English glosses for this prompt. Submit via the tool.`;
}
```

- [ ] **Step 4: Create the generator file** (`packages/ai/src/writing-helper.ts`)

```ts
/**
 * packages/ai — Free Writing helper generators (Brainstorm + Vocab boost).
 * Both force a tool call and return a small structured result. Parsers are
 * forgiving: malformed entries are dropped, not fatal. Mirrors
 * free-writing-evaluate.ts but with a smaller token budget.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { FreeWritingContent, CefrLevel, Language } from "@language-drill/shared";
import { getPromptOrFallback } from "./prompts-registry.js";
import {
  BRAINSTORM_SYSTEM_PROMPT,
  BRAINSTORM_PROMPT_VERSION,
  buildBrainstormUserPrompt,
  VOCAB_BOOST_SYSTEM_PROMPT,
  VOCAB_BOOST_PROMPT_VERSION,
  buildVocabBoostUserPrompt,
} from "./writing-helper-prompts.js";

const MODEL = "claude-sonnet-4-6" as const;
const MAX_TOKENS = 1024;
export const WRITING_HELPER_REQUEST_TIMEOUT_MS = 20_000;
export const WRITING_HELPER_MAX_RETRIES = 1;

export type WritingHelperInput = {
  content: FreeWritingContent;
  language: Language;
  difficulty: CefrLevel;
};

// ── Shared tool runner ───────────────────────────────────────────────────────
async function runHelperTool<T>(
  client: Anthropic,
  opts: {
    promptName: string;
    fallbackPrompt: string;
    version: string;
    userPrompt: string;
    tool: Anthropic.Tool;
    toolName: string;
    parse: (input: unknown) => T;
  },
): Promise<T> {
  const resolved = await getPromptOrFallback(opts.promptName, opts.fallbackPrompt, opts.version);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text" as const, text: resolved.text, cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user" as const, content: opts.userPrompt }],
    tools: [opts.tool],
    tool_choice: { type: "tool" as const, name: opts.toolName },
    temperature: 0,
  });
  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!block) {
    throw new Error(`Claude did not return a tool use block. Stop reason: ${response.stop_reason}.`);
  }
  if (block.name !== opts.toolName) {
    throw new Error(`Unexpected tool name: expected "${opts.toolName}", got "${block.name}"`);
  }
  return opts.parse(block.input);
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

// ── Brainstorm ───────────────────────────────────────────────────────────────
export const BRAINSTORM_TOOL_NAME = "submit_brainstorm";
export const BRAINSTORM_TOOL: Anthropic.Tool = {
  name: BRAINSTORM_TOOL_NAME,
  description: "Submit 2–3 brainstorm angle groups of short English idea bullets.",
  input_schema: {
    type: "object" as const,
    properties: {
      groups: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Short English label (2–4 words)." },
            points: { type: "array", items: { type: "string" }, description: "2–4 English idea bullets." },
          },
          required: ["label", "points"],
        },
      },
    },
    required: ["groups"],
  },
};

export type BrainstormResult = { groups: { label: string; points: string[] }[] };

export function parseBrainstorm(input: unknown): BrainstormResult {
  if (typeof input !== "object" || input === null) return { groups: [] };
  const raw = (input as Record<string, unknown>).groups;
  if (!Array.isArray(raw)) return { groups: [] };
  const groups: { label: string; points: string[] }[] = [];
  for (const g of raw) {
    if (typeof g !== "object" || g === null) continue;
    const o = g as Record<string, unknown>;
    if (typeof o.label !== "string") continue;
    groups.push({ label: o.label, points: strArray(o.points) });
  }
  return { groups };
}

export async function generateBrainstorm(
  client: Anthropic,
  input: WritingHelperInput,
): Promise<BrainstormResult> {
  return runHelperTool(client, {
    promptName: "free-writing-brainstorm-system-prompt",
    fallbackPrompt: BRAINSTORM_SYSTEM_PROMPT,
    version: BRAINSTORM_PROMPT_VERSION,
    userPrompt: buildBrainstormUserPrompt(input.content, input.language, input.difficulty),
    tool: BRAINSTORM_TOOL,
    toolName: BRAINSTORM_TOOL_NAME,
    parse: parseBrainstorm,
  });
}

// ── Vocab boost ──────────────────────────────────────────────────────────────
export const VOCAB_BOOST_TOOL_NAME = "submit_vocab_boost";
export const VOCAB_BOOST_TOOL: Anthropic.Tool = {
  name: VOCAB_BOOST_TOOL_NAME,
  description: "Submit 8–10 target-language words/phrases, each with a short English gloss.",
  input_schema: {
    type: "object" as const,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            term: { type: "string", description: "Target-language word or phrase." },
            gloss: { type: "string", description: "Short English meaning (<= 6 words)." },
          },
          required: ["term", "gloss"],
        },
      },
    },
    required: ["items"],
  },
};

export type VocabBoostResult = { items: { term: string; gloss: string }[] };

export function parseVocabBoost(input: unknown): VocabBoostResult {
  if (typeof input !== "object" || input === null) return { items: [] };
  const raw = (input as Record<string, unknown>).items;
  if (!Array.isArray(raw)) return { items: [] };
  const items: { term: string; gloss: string }[] = [];
  for (const it of raw) {
    if (typeof it !== "object" || it === null) continue;
    const o = it as Record<string, unknown>;
    if (typeof o.term !== "string" || typeof o.gloss !== "string") continue;
    items.push({ term: o.term, gloss: o.gloss });
  }
  return { items };
}

export async function generateVocabBoost(
  client: Anthropic,
  input: WritingHelperInput,
): Promise<VocabBoostResult> {
  return runHelperTool(client, {
    promptName: "free-writing-vocab-boost-system-prompt",
    fallbackPrompt: VOCAB_BOOST_SYSTEM_PROMPT,
    version: VOCAB_BOOST_PROMPT_VERSION,
    userPrompt: buildVocabBoostUserPrompt(input.content, input.language, input.difficulty),
    tool: VOCAB_BOOST_TOOL,
    toolName: VOCAB_BOOST_TOOL_NAME,
    parse: parseVocabBoost,
  });
}
```

- [ ] **Step 4b: Add the vocab-boost test** (append to `writing-helper.test.ts`)

```ts
import {
  generateVocabBoost,
  parseVocabBoost,
  VOCAB_BOOST_TOOL_NAME,
} from "./writing-helper.js";

describe("parseVocabBoost", () => {
  it("keeps well-formed items and drops malformed ones", () => {
    const out = parseVocabBoost({
      items: [
        { term: "el teletrabajo", gloss: "remote work" },
        { term: "x", gloss: 9 }, // dropped
        { nope: true }, // dropped
      ],
    });
    expect(out.items).toEqual([{ term: "el teletrabajo", gloss: "remote work" }]);
  });
});

describe("generateVocabBoost", () => {
  it("forces the vocab tool and returns the parsed result", async () => {
    const client = clientReturning(VOCAB_BOOST_TOOL_NAME, {
      items: [{ term: "la flexibilidad", gloss: "flexibility" }],
    });
    const result = await generateVocabBoost(client, {
      content,
      language: Language.ES,
      difficulty: CefrLevel.B1,
    });
    expect(result.items).toEqual([{ term: "la flexibilidad", gloss: "flexibility" }]);
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai exec vitest run writing-helper`
Expected: PASS (all brainstorm + vocab tests).

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/writing-helper-prompts.ts packages/ai/src/writing-helper.ts packages/ai/src/writing-helper.test.ts
git commit -m "feat(ai): brainstorm + vocab-boost helper generators"
```

---

## Task 2: AI — re-export symbols, extend LlmFeature, register prompts

**Files:**
- Modify: `packages/ai/src/index.ts`
- Modify: `packages/ai/src/observability.ts:32-40` (the `LlmFeature` union)
- Modify: `packages/ai/scripts/bootstrap-prompts.ts`
- Modify: `packages/ai/scripts/bootstrap-prompts.test.ts:121`
- Modify: `CLAUDE.md` (prompt-version table)

- [ ] **Step 1: Update the manifest-count test first** (`bootstrap-prompts.test.ts`)

Change line 121:

```ts
    expect(PROMPTS).toHaveLength(12);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/ai exec vitest run bootstrap-prompts`
Expected: FAIL — `expected length 10 to be 12`.

- [ ] **Step 3: Extend `LlmFeature`** (`observability.ts`, the union at ~line 32)

```ts
export type LlmFeature =
  | "evaluate"
  | "free-writing-eval"
  | "free-writing-brainstorm"
  | "free-writing-vocab-boost"
  | "annotate"
  | "annotate-span"
  | "generate"
  | "validate"
  | "generate-theory"
  | "validate-theory";
```

- [ ] **Step 4: Re-export the new AI symbols** (`packages/ai/src/index.ts`, alongside the free-writing re-exports)

```ts
export {
  generateBrainstorm,
  generateVocabBoost,
  parseBrainstorm,
  parseVocabBoost,
  BRAINSTORM_TOOL,
  BRAINSTORM_TOOL_NAME,
  VOCAB_BOOST_TOOL,
  VOCAB_BOOST_TOOL_NAME,
  WRITING_HELPER_REQUEST_TIMEOUT_MS,
  WRITING_HELPER_MAX_RETRIES,
  type WritingHelperInput,
  type BrainstormResult,
  type VocabBoostResult,
} from "./writing-helper.js";
export {
  BRAINSTORM_SYSTEM_PROMPT,
  BRAINSTORM_PROMPT_VERSION,
  VOCAB_BOOST_SYSTEM_PROMPT,
  VOCAB_BOOST_PROMPT_VERSION,
  buildBrainstormUserPrompt,
  buildVocabBoostUserPrompt,
} from "./writing-helper-prompts.js";
```

- [ ] **Step 5: Add the two manifest imports + entries** (`bootstrap-prompts.ts`)

Add to the import block from `../src/index.js`:

```ts
  BRAINSTORM_SYSTEM_PROMPT,
  BRAINSTORM_PROMPT_VERSION,
  VOCAB_BOOST_SYSTEM_PROMPT,
  VOCAB_BOOST_PROMPT_VERSION,
```

Add two entries to the `PROMPTS` array (after the `free-writing-eval-system-prompt` entry):

```ts
  {
    name: "free-writing-brainstorm-system-prompt",
    text: BRAINSTORM_SYSTEM_PROMPT,
    version: BRAINSTORM_PROMPT_VERSION,
    surface: "free-writing-brainstorm",
  },
  {
    name: "free-writing-vocab-boost-system-prompt",
    text: VOCAB_BOOST_SYSTEM_PROMPT,
    version: VOCAB_BOOST_PROMPT_VERSION,
    surface: "free-writing-vocab-boost",
  },
```

- [ ] **Step 6: Run the AI suite to verify green**

Run: `pnpm --filter @language-drill/ai exec vitest run bootstrap-prompts writing-helper`
Expected: PASS (manifest now length 12; names unique; surfaces present).

- [ ] **Step 7: Update the CLAUDE.md prompt-version table**

Add two rows under `free-writing-prompts.ts`:

```markdown
| `writing-helper-prompts.ts` | `BRAINSTORM_PROMPT_VERSION` |
| `writing-helper-prompts.ts` | `VOCAB_BOOST_PROMPT_VERSION` |
```

- [ ] **Step 8: Typecheck the package and commit**

Run: `pnpm --filter @language-drill/ai typecheck`
Expected: PASS.

```bash
git add packages/ai/src/index.ts packages/ai/src/observability.ts packages/ai/scripts/bootstrap-prompts.ts packages/ai/scripts/bootstrap-prompts.test.ts CLAUDE.md
git commit -m "feat(ai): register writing-helper prompts + LlmFeature tags"
```

---

## Task 3: Lambda — `writing_helper` usage bucket

**Files:**
- Modify: `infra/lambda/src/usage/limits.ts`
- Modify: `infra/lambda/src/usage/limits.test.ts`

- [ ] **Step 1: Write the failing test** (append to `limits.test.ts`)

```ts
describe('writing_helper bucket', () => {
  it('has a free base limit of 50', () => {
    expect(BASE_DAILY_LIMITS.writing_helper).toBe(50);
  });

  it('boosts to 10x for boosted plans', () => {
    expect(limitFor('writing_helper', 'free')).toBe(50);
    expect(limitFor('writing_helper', 'boosted')).toBe(500);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/lambda exec vitest run usage/limits`
Expected: FAIL — `writing_helper` missing from `BASE_DAILY_LIMITS` (type error / undefined).

- [ ] **Step 3: Add the bucket** (`limits.ts`)

In the `MeteredEventType` union add `| 'writing_helper'`; in `BASE_DAILY_LIMITS` add:

```ts
  writing_helper: 50,
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @language-drill/lambda exec vitest run usage/limits`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/usage/limits.ts infra/lambda/src/usage/limits.test.ts
git commit -m "feat(lambda): add writing_helper usage bucket"
```

---

## Task 4: Lambda — brainstorm + vocab-boost routes

**Files:**
- Modify: `infra/lambda/src/routes/exercises.ts`
- Create: `infra/lambda/src/routes/exercises.writing-helper.test.ts` (a focused sibling test file — keeps the tailored db mock simple, same convention as `read.generate.test.ts` sitting beside `read.test.ts`).

- [ ] **Step 1: Write the failing test** (`exercises.writing-helper.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// The route issues, in order, on the success path:
//   db.select().from(exercises).where().limit()        (exercise lookup)
//   db.select({count}).from(usageEvents).where()       (24h usage count)
//   db.insert(usageEvents).values()                    (meter)
// Distinguish the two selects by call order via mockLimit / mockWhere.

let exerciseRow: Record<string, unknown> | undefined;
let usageCount = 0;

const mockLimit = vi.fn(() => Promise.resolve(exerciseRow ? [exerciseRow] : []));
const mockWhere = vi.fn(() => {
  const p = Promise.resolve([{ count: usageCount }]) as Promise<unknown> & { limit: typeof mockLimit };
  p.limit = mockLimit;
  return p;
});
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn((..._a: unknown[]) => ({ from: mockFrom }));

const insertValuesCalls: Array<Record<string, unknown>> = [];
const mockOnConflictDoNothing = vi.fn(() => Promise.resolve());
const mockValues = vi.fn((row: Record<string, unknown>) => {
  insertValuesCalls.push(row);
  const p = Promise.resolve() as Promise<void> & { onConflictDoNothing: typeof mockOnConflictDoNothing };
  p.onConflictDoNothing = mockOnConflictDoNothing;
  return p;
});
const mockInsert = vi.fn(() => ({ values: mockValues }));

vi.mock('../db', () => ({
  db: {
    select: (...a: unknown[]) => mockSelect(...a),
    insert: () => mockInsert(),
  },
}));

vi.mock('@language-drill/db', () => ({
  users: { id: 'id' },
  exercises: { id: 'id', language: 'language', difficulty: 'difficulty', type: 'type', status: 'status', grammarPointKey: 'grammar_point_key' },
  usageEvents: { userId: 'user_id', eventType: 'event_type', createdAt: 'created_at', metadata: 'metadata' },
  practiceSessions: {},
  userExerciseHistory: {},
  userGrammarMastery: {},
  getGrammarPoint: vi.fn(() => undefined),
  updateMastery: vi.fn(),
}));

const mockGenerateBrainstorm = vi.fn();
const mockGenerateVocabBoost = vi.fn();
vi.mock('@language-drill/ai', () => ({
  createObservedClaudeClient: vi.fn(() => ({})),
  evaluateAnswer: vi.fn(),
  gradeDictationAnswer: vi.fn(),
  evaluateFreeWriting: vi.fn(),
  generateBrainstorm: (...a: unknown[]) => mockGenerateBrainstorm(...a),
  generateVocabBoost: (...a: unknown[]) => mockGenerateVocabBoost(...a),
  withLlmTrace: (_meta: unknown, fn: () => unknown) => fn(),
  EVALUATION_SYSTEM_PROMPT_VERSION: 'v',
  DICTATION_EVAL_PROMPT_VERSION: 'v',
  FREE_WRITING_EVAL_PROMPT_VERSION: 'v',
  BRAINSTORM_PROMPT_VERSION: 'free-writing-brainstorm@2026-06-15',
  VOCAB_BOOST_PROMPT_VERSION: 'free-writing-vocab-boost@2026-06-15',
  EVAL_REQUEST_TIMEOUT_MS: 1000,
  EVAL_MAX_RETRIES: 1,
  FREE_WRITING_EVAL_REQUEST_TIMEOUT_MS: 1000,
  FREE_WRITING_EVAL_MAX_RETRIES: 1,
  WRITING_HELPER_REQUEST_TIMEOUT_MS: 1000,
  WRITING_HELPER_MAX_RETRIES: 1,
}));

vi.mock('../usage/plan', () => ({
  getEffectivePlan: vi.fn(() => Promise.resolve('free')),
  isAdmin: vi.fn(() => false),
}));

let capacityVerdict: 'ok' | 'killed' | 'capped' = 'ok';
const mockCheckGlobalCapacity = vi.fn(() => Promise.resolve(capacityVerdict));
vi.mock('../usage/global-capacity', () => ({
  checkGlobalCapacity: () => mockCheckGlobalCapacity(),
}));

// approvedStatusFilter / freshFirstOrderBy are pure SQL builders; stub them.
vi.mock('../lib/exercise-filters', () => ({
  approvedStatusFilter: () => undefined,
  freshFirstOrderBy: () => undefined,
}));

const authEnv = { event: { requestContext: { authorizer: { jwt: { claims: { sub: 'user_123' } } } } } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

const FW_ROW = {
  id: 'fw-1',
  language: 'ES',
  difficulty: 'B1',
  type: 'free_writing',
  contentJson: {
    type: 'free_writing',
    instructions: 'i', title: 'T', task: 'task', domain: 'd',
    register: 'formal', minWords: 150, maxWords: 200, requiredElements: [],
  },
};

function post(app: Hono, path: string) {
  return app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, authEnv);
}

describe('POST /exercises/:id/brainstorm', () => {
  let app: Hono;
  beforeEach(async () => {
    vi.clearAllMocks();
    exerciseRow = FW_ROW;
    usageCount = 0;
    capacityVerdict = 'ok';
    insertValuesCalls.length = 0;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    vi.resetModules();
    const mod = await import('./exercises');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('success → 200, returns groups, meters one writing_helper event', async () => {
    mockGenerateBrainstorm.mockResolvedValue({ groups: [{ label: 'Angle', points: ['idea'] }] });
    const res = await post(app, '/exercises/fw-1/brainstorm');
    expect(res.status).toBe(200);
    expect((await res.json()) as AnyJson).toEqual({ groups: [{ label: 'Angle', points: ['idea'] }] });
    expect(mockGenerateBrainstorm).toHaveBeenCalledTimes(1);
    const ev = insertValuesCalls.find((r) => r.eventType === 'writing_helper');
    expect(ev).toMatchObject({ userId: 'user_123', eventType: 'writing_helper' });
  });

  it('non-free-writing exercise → 400 BAD_EXERCISE_TYPE, no AI, no meter', async () => {
    exerciseRow = { ...FW_ROW, type: 'cloze', contentJson: { type: 'cloze' } };
    const res = await post(app, '/exercises/fw-1/brainstorm');
    expect(res.status).toBe(400);
    expect(((await res.json()) as AnyJson).code).toBe('BAD_EXERCISE_TYPE');
    expect(mockGenerateBrainstorm).not.toHaveBeenCalled();
    expect(insertValuesCalls.find((r) => r.eventType === 'writing_helper')).toBeUndefined();
  });

  it('missing exercise → 404, no AI', async () => {
    exerciseRow = undefined;
    const res = await post(app, '/exercises/none/brainstorm');
    expect(res.status).toBe(404);
    expect(mockGenerateBrainstorm).not.toHaveBeenCalled();
  });

  it('global brake → 503 GLOBAL_CAPACITY, no AI, no meter', async () => {
    capacityVerdict = 'killed';
    const res = await post(app, '/exercises/fw-1/brainstorm');
    expect(res.status).toBe(503);
    expect(((await res.json()) as AnyJson).code).toBe('GLOBAL_CAPACITY');
    expect(mockGenerateBrainstorm).not.toHaveBeenCalled();
    expect(insertValuesCalls.find((r) => r.eventType === 'writing_helper')).toBeUndefined();
  });

  it('daily cap reached → 429 RATE_LIMIT_EXCEEDED, no AI', async () => {
    usageCount = 50; // free writing_helper limit
    const res = await post(app, '/exercises/fw-1/brainstorm');
    expect(res.status).toBe(429);
    expect(((await res.json()) as AnyJson).code).toBe('RATE_LIMIT_EXCEEDED');
    expect(mockGenerateBrainstorm).not.toHaveBeenCalled();
  });
});

describe('POST /exercises/:id/vocab-boost', () => {
  let app: Hono;
  beforeEach(async () => {
    vi.clearAllMocks();
    exerciseRow = FW_ROW;
    usageCount = 0;
    capacityVerdict = 'ok';
    insertValuesCalls.length = 0;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    vi.resetModules();
    const mod = await import('./exercises');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('success → 200, returns items, meters one writing_helper event', async () => {
    mockGenerateVocabBoost.mockResolvedValue({ items: [{ term: 'la flexibilidad', gloss: 'flexibility' }] });
    const res = await post(app, '/exercises/fw-1/vocab-boost');
    expect(res.status).toBe(200);
    expect((await res.json()) as AnyJson).toEqual({ items: [{ term: 'la flexibilidad', gloss: 'flexibility' }] });
    const ev = insertValuesCalls.find((r) => r.eventType === 'writing_helper');
    expect(ev).toMatchObject({ eventType: 'writing_helper' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/lambda exec vitest run exercises.writing-helper`
Expected: FAIL — routes return 404 (not yet defined) → first assertion `200` fails.

- [ ] **Step 3: Add imports to `exercises.ts`**

Extend the `@language-drill/ai` import block with:

```ts
  generateBrainstorm,
  generateVocabBoost,
  BRAINSTORM_PROMPT_VERSION,
  VOCAB_BOOST_PROMPT_VERSION,
  WRITING_HELPER_REQUEST_TIMEOUT_MS,
  WRITING_HELPER_MAX_RETRIES,
```

Add a Hono `Context` type import at the top (for the helper signature):

```ts
import type { Context } from 'hono';
```

`isFreeWritingContent`, `Language`, `CefrLevel`, `ExerciseType` are already imported from `@language-drill/shared`.

- [ ] **Step 4: Add the shared gate helper + two routes** (`exercises.ts`, after the `POST /exercises/:id/submit` handler)

```ts
// ---------------------------------------------------------------------------
// Getting-unstuck helpers — POST /exercises/:id/brainstorm | /vocab-boost
// ---------------------------------------------------------------------------
// Both share one metered gate: load the approved free-writing exercise, run the
// global brake, enforce the shared `writing_helper` daily cap, call Claude, then
// meter exactly one `writing_helper` event. No DB persistence of the result.
type WritingHelperFeature = 'free-writing-brainstorm' | 'free-writing-vocab-boost';

async function runWritingHelper(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  opts: {
    feature: WritingHelperFeature;
    promptVersion: string;
    generate: (
      client: ReturnType<typeof createObservedClaudeClient>,
      input: { content: FreeWritingContent; language: Language; difficulty: CefrLevel },
    ) => Promise<unknown>;
  },
) {
  const id = c.req.param('id');

  const rows = await db
    .select()
    .from(exercisesTable)
    .where(and(eq(exercisesTable.id, id), approvedStatusFilter(exercisesTable)))
    .limit(1);
  if (rows.length === 0) {
    return c.json({ error: 'Exercise not found', code: 'EXERCISE_NOT_FOUND' }, 404);
  }
  const exercise = rows[0];
  const content = exercise.contentJson as ExerciseContent;
  if (!isFreeWritingContent(content)) {
    return c.json(
      { error: 'Helpers are only available for free-writing exercises', code: 'BAD_EXERCISE_TYPE' },
      400,
    );
  }
  const userId = c.get('userId');

  const plan = await getEffectivePlan(userId);
  const capacity = await checkGlobalCapacity({ plan, admin: isAdmin(userId) });
  if (capacity !== 'ok') {
    return c.json({ error: 'AI temporarily at capacity', code: 'GLOBAL_CAPACITY' }, 503);
  }

  // Check-then-insert daily cap — same accepted boundary-overshoot race as the
  // submit route; the cap is a cost guardrail, not a billing-grade meter.
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [{ count: todayCount }] = await db
    .select({ count: count() })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        eq(usageEvents.eventType, 'writing_helper'),
        gte(usageEvents.createdAt, oneDayAgo),
      ),
    );
  if (Number(todayCount) >= limitFor('writing_helper', plan)) {
    return c.json({ error: 'Daily writing-helper limit exceeded', code: 'RATE_LIMIT_EXCEEDED' }, 429);
  }

  if (!ANTHROPIC_API_KEY) {
    return c.json({ error: 'Writing helpers temporarily unavailable', code: 'AI_UNAVAILABLE' }, 502);
  }

  const requestId =
    (c.env?.event as { requestContext?: { requestId?: string } } | undefined)
      ?.requestContext?.requestId ?? 'local';
  const client = createObservedClaudeClient(ANTHROPIC_API_KEY, {
    timeout: WRITING_HELPER_REQUEST_TIMEOUT_MS,
    maxRetries: WRITING_HELPER_MAX_RETRIES,
  });

  let result: unknown;
  try {
    result = await withLlmTrace(
      {
        env: (process.env.LANGFUSE_ENV ?? 'dev') as 'prod' | 'dev',
        requestId,
        userId,
        exerciseId: id,
        language: exercise.language as Language,
        cefrLevel: exercise.difficulty as CefrLevel,
        exerciseType: exercise.type as ExerciseType,
        feature: opts.feature,
        promptVersion: opts.promptVersion,
      },
      () =>
        opts.generate(client, {
          content,
          language: exercise.language as Language,
          difficulty: exercise.difficulty as CefrLevel,
        }),
    );
  } catch (err) {
    console.error(`[${opts.feature}] generation failed:`, err);
    return c.json({ error: 'Writing helpers temporarily unavailable', code: 'AI_UNAVAILABLE' }, 502);
  }

  await db.insert(usageEvents).values({
    userId,
    eventType: 'writing_helper',
    metadata: { exerciseId: id, language: exercise.language, difficulty: exercise.difficulty, kind: opts.feature },
  });

  return c.json(result as Record<string, unknown>);
}

exercises.post('/exercises/:id/brainstorm', (c) =>
  runWritingHelper(c, {
    feature: 'free-writing-brainstorm',
    promptVersion: BRAINSTORM_PROMPT_VERSION,
    generate: generateBrainstorm,
  }),
);

exercises.post('/exercises/:id/vocab-boost', (c) =>
  runWritingHelper(c, {
    feature: 'free-writing-vocab-boost',
    promptVersion: VOCAB_BOOST_PROMPT_VERSION,
    generate: generateVocabBoost,
  }),
);
```

- [ ] **Step 5: Run the route tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda exec vitest run exercises.writing-helper`
Expected: PASS (all brainstorm + vocab scenarios).

- [ ] **Step 6: Run the existing exercises tests to confirm no regression**

Run: `pnpm --filter @language-drill/lambda exec vitest run routes/exercises`
Expected: PASS (existing submit tests unaffected).

- [ ] **Step 7: Commit**

```bash
git add infra/lambda/src/routes/exercises.ts infra/lambda/src/routes/exercises.writing-helper.test.ts
git commit -m "feat(lambda): brainstorm + vocab-boost metered routes"
```

---

## Task 5: api-client — schemas + hooks

**Files:**
- Create: `packages/api-client/src/schemas/writing-helper.ts`
- Create: `packages/api-client/src/schemas/writing-helper.test.ts`
- Create: `packages/api-client/src/hooks/useBrainstorm.ts`
- Create: `packages/api-client/src/hooks/useVocabBoost.ts`
- Modify: `packages/api-client/src/index.ts`

- [ ] **Step 1: Write the failing schema test** (`schemas/writing-helper.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { BrainstormSchema, VocabBoostSchema } from './writing-helper';

describe('writing-helper schemas', () => {
  it('parses a valid brainstorm payload', () => {
    const parsed = BrainstormSchema.parse({ groups: [{ label: 'For', points: ['a', 'b'] }] });
    expect(parsed.groups[0].label).toBe('For');
  });

  it('rejects a brainstorm payload missing groups', () => {
    expect(() => BrainstormSchema.parse({})).toThrow();
  });

  it('parses a valid vocab payload', () => {
    const parsed = VocabBoostSchema.parse({ items: [{ term: 't', gloss: 'g' }] });
    expect(parsed.items[0].term).toBe('t');
  });

  it('rejects a vocab item missing gloss', () => {
    expect(() => VocabBoostSchema.parse({ items: [{ term: 't' }] })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/api-client exec vitest run writing-helper`
Expected: FAIL — `Cannot find module './writing-helper'`.

- [ ] **Step 3: Create the schemas** (`schemas/writing-helper.ts`)

```ts
import { z } from 'zod';

export const BrainstormSchema = z.object({
  groups: z.array(z.object({ label: z.string(), points: z.array(z.string()) })),
});
export type BrainstormResponse = z.infer<typeof BrainstormSchema>;

export const VocabBoostSchema = z.object({
  items: z.array(z.object({ term: z.string(), gloss: z.string() })),
});
export type VocabBoostResponse = z.infer<typeof VocabBoostSchema>;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @language-drill/api-client exec vitest run writing-helper`
Expected: PASS.

- [ ] **Step 5: Create the hooks**

`hooks/useBrainstorm.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { BrainstormSchema, type BrainstormResponse } from '../schemas/writing-helper';
import type { AuthenticatedFetch } from '../fetchClient';

export type UseBrainstormOptions = {
  exerciseId: string;
  fetchFn: AuthenticatedFetch;
  enabled: boolean;
};

export function useBrainstorm({ exerciseId, fetchFn, enabled }: UseBrainstormOptions) {
  return useQuery<BrainstormResponse, Error>({
    queryKey: ['writing-helper', 'brainstorm', exerciseId],
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      const response = await fetchFn(`/exercises/${exerciseId}/brainstorm`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const json: unknown = await response.json();
      return BrainstormSchema.parse(json);
    },
  });
}
```

`hooks/useVocabBoost.ts` (identical shape, vocab endpoint + schema):

```ts
import { useQuery } from '@tanstack/react-query';
import { VocabBoostSchema, type VocabBoostResponse } from '../schemas/writing-helper';
import type { AuthenticatedFetch } from '../fetchClient';

export type UseVocabBoostOptions = {
  exerciseId: string;
  fetchFn: AuthenticatedFetch;
  enabled: boolean;
};

export function useVocabBoost({ exerciseId, fetchFn, enabled }: UseVocabBoostOptions) {
  return useQuery<VocabBoostResponse, Error>({
    queryKey: ['writing-helper', 'vocab', exerciseId],
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      const response = await fetchFn(`/exercises/${exerciseId}/vocab-boost`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const json: unknown = await response.json();
      return VocabBoostSchema.parse(json);
    },
  });
}
```

- [ ] **Step 6: Re-export from `index.ts`**

```ts
export {
  BrainstormSchema,
  type BrainstormResponse,
  VocabBoostSchema,
  type VocabBoostResponse,
} from './schemas/writing-helper';
export { useBrainstorm, type UseBrainstormOptions } from './hooks/useBrainstorm';
export { useVocabBoost, type UseVocabBoostOptions } from './hooks/useVocabBoost';
```

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter @language-drill/api-client typecheck && pnpm --filter @language-drill/api-client exec vitest run writing-helper`
Expected: PASS.

```bash
git add packages/api-client/src/schemas/writing-helper.ts packages/api-client/src/schemas/writing-helper.test.ts packages/api-client/src/hooks/useBrainstorm.ts packages/api-client/src/hooks/useVocabBoost.ts packages/api-client/src/index.ts
git commit -m "feat(api-client): brainstorm + vocab-boost hooks and schemas"
```

---

## Task 6: Web — CSS for the helper panel

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/free-writing/free-writing.css`

This task has no test (CSS only); it is verified visually in Task 8's manual smoke. Port the prototype's classes, remapped to the app token namespace.

- [ ] **Step 1: Append the panel classes** (after the existing `.fw-helpbtn` rules)

```css
.fw-helpbtn.active {
  border-color: var(--color-accent);
  color: var(--color-accent-2);
  background: var(--color-accent-soft);
}

.fw-helppanel {
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-r-md);
  background: var(--color-paper-2);
  overflow: hidden;
}
.fw-helppanel .head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-rule);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink-soft);
}
.fw-vocab-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px dashed var(--color-rule);
}
.fw-vocab-row .w { font-weight: 600; font-size: 14px; color: var(--color-ink); }
.fw-vocab-row .g { font-size: 12px; color: var(--color-ink-mute); }
```

- [ ] **Step 2: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/free-writing/free-writing.css"
git commit -m "style(free-writing): helper panel + vocab row classes"
```

---

## Task 7: Web — `FwUnstuck` component + composer/page wiring

**Files:**
- Create: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-unstuck.tsx`
- Create: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-unstuck.test.tsx`
- Modify: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-composer.tsx`
- Modify: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-composer.test.tsx`
- Modify: `apps/web/app/(dashboard)/drill/free-writing/page.tsx`

- [ ] **Step 1: Write the failing `FwUnstuck` test** (`fw-unstuck.test.tsx`)

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockUseBrainstorm = vi.fn();
const mockUseVocabBoost = vi.fn();
vi.mock('@language-drill/api-client', () => ({
  useBrainstorm: (...a: unknown[]) => mockUseBrainstorm(...a),
  useVocabBoost: (...a: unknown[]) => mockUseVocabBoost(...a),
}));

import { FwUnstuck } from './fw-unstuck';

const idle = { data: undefined, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mockUseBrainstorm.mockReturnValue(idle);
  mockUseVocabBoost.mockReturnValue(idle);
});

const fetchFn = vi.fn();

describe('FwUnstuck', () => {
  it('renders brainstorm + vocab buttons enabled, start-my-paragraph disabled', () => {
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} />);
    expect(screen.getByRole('button', { name: /brainstorm/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /vocabulary boost/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /start my paragraph/i })).toBeDisabled();
  });

  it('opening brainstorm enables the hook and renders groups', () => {
    mockUseBrainstorm.mockReturnValue({
      ...idle,
      data: { groups: [{ label: 'For', points: ['flexibility'] }] },
    });
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /brainstorm/i }));
    expect(screen.getByText('For')).toBeInTheDocument();
    expect(screen.getByText('flexibility')).toBeInTheDocument();
    // hook called with enabled true for brainstorm
    expect(mockUseBrainstorm).toHaveBeenLastCalledWith(
      expect.objectContaining({ exerciseId: 'fw-1', enabled: true }),
    );
  });

  it('shows a loading state while fetching', () => {
    mockUseBrainstorm.mockReturnValue({ ...idle, isLoading: true });
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /brainstorm/i }));
    expect(screen.getByText(/thinking/i)).toBeInTheDocument();
  });

  it('shows an error state with a retry that calls refetch', () => {
    const refetch = vi.fn();
    mockUseBrainstorm.mockReturnValue({ ...idle, isError: true, refetch });
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /brainstorm/i }));
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('regenerate calls refetch on the active helper', () => {
    const refetch = vi.fn();
    mockUseVocabBoost.mockReturnValue({
      ...idle,
      data: { items: [{ term: 'la flexibilidad', gloss: 'flexibility' }] },
      refetch,
    });
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /vocabulary boost/i }));
    expect(screen.getByText('la flexibilidad')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(refetch).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/web exec vitest run fw-unstuck`
Expected: FAIL — `Cannot find module './fw-unstuck'`. (If it instead fails to resolve `@language-drill/api-client`, run `pnpm turbo run build --filter=@language-drill/api-client` first per the dist-resolution note.)

- [ ] **Step 3: Create `fw-unstuck.tsx`**

```tsx
'use client';

import React from 'react';
import {
  useBrainstorm,
  useVocabBoost,
  type AuthenticatedFetch,
  type BrainstormResponse,
  type VocabBoostResponse,
} from '@language-drill/api-client';
import { FwIcon } from './fw-atoms';

type Kind = 'brainstorm' | 'vocab';

export interface FwUnstuckProps {
  exerciseId: string;
  fetchFn: AuthenticatedFetch;
}

function BrainstormView({ groups }: { groups: BrainstormResponse['groups'] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      {groups.map((g) => (
        <div key={g.label}>
          <div className="rv-h" style={{ marginBottom: 6 }}>{g.label}</div>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {g.points.map((p) => (
              <li key={p} style={{ fontSize: 13, display: 'flex', gap: 7, alignItems: 'baseline' }}>
                <span style={{ color: 'var(--color-accent)', flexShrink: 0 }}>•</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function VocabView({ items }: { items: VocabBoostResponse['items'] }) {
  return (
    <div>
      {items.map((it) => (
        <div key={it.term} className="fw-vocab-row">
          <span className="w">{it.term}</span>
          <span className="g">{it.gloss}</span>
        </div>
      ))}
    </div>
  );
}

export function FwUnstuck({ exerciseId, fetchFn }: FwUnstuckProps) {
  const [openKind, setOpenKind] = React.useState<Kind | null>(null);

  const brainstorm = useBrainstorm({ exerciseId, fetchFn, enabled: openKind === 'brainstorm' });
  const vocab = useVocabBoost({ exerciseId, fetchFn, enabled: openKind === 'vocab' });
  const active = openKind === 'brainstorm' ? brainstorm : openKind === 'vocab' ? vocab : null;

  const toggle = (k: Kind) => setOpenKind((cur) => (cur === k ? null : k));

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="t-micro" style={{ marginRight: 2 }}>stuck?</span>
        <button
          className={`fw-helpbtn${openKind === 'brainstorm' ? ' active' : ''}`}
          onClick={() => toggle('brainstorm')}
        >
          <span className="ico"><FwIcon kind="list" size={14} /></span>
          brainstorm
        </button>
        <button
          className={`fw-helpbtn${openKind === 'vocab' ? ' active' : ''}`}
          onClick={() => toggle('vocab')}
        >
          <span className="ico"><FwIcon kind="book" size={14} /></span>
          vocabulary boost
        </button>
        <button className="fw-helpbtn" disabled>
          <span className="ico"><FwIcon kind="write" size={14} /></span>
          start my paragraph
          <span className="t-micro" style={{ marginLeft: 4, opacity: 0.5 }}>soon</span>
        </button>
        <span className="t-small" style={{ fontSize: 11, marginLeft: 'auto', color: 'var(--color-ink-mute)' }}>
          helpers give ideas, not sentences — a provided opener counts less toward your score.
        </span>
      </div>

      {openKind && active && (
        <div className="fw-helppanel" style={{ marginTop: 12 }}>
          <div className="head">
            <span>
              {openKind === 'brainstorm' ? 'ideas to get you started' : 'useful words for this prompt'}
            </span>
            <span style={{ display: 'inline-flex', gap: 8, marginLeft: 'auto' }}>
              <button
                className="btn ghost sm"
                onClick={() => active.refetch()}
                disabled={active.isFetching}
              >
                regenerate
              </button>
              <button className="btn ghost sm" onClick={() => setOpenKind(null)}>close</button>
            </span>
          </div>
          <div style={{ padding: '14px 16px' }}>
            {active.isLoading || active.isFetching ? (
              <div className="t-small">thinking…</div>
            ) : active.isError ? (
              <div className="t-small" style={{ color: 'var(--color-accent-2)' }}>
                couldn’t load —{' '}
                <button className="btn ghost sm" onClick={() => active.refetch()}>try again</button>
              </div>
            ) : openKind === 'brainstorm' && brainstorm.data ? (
              <BrainstormView groups={brainstorm.data.groups} />
            ) : openKind === 'vocab' && vocab.data ? (
              <VocabView items={vocab.data.items} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the `FwUnstuck` test to verify it passes**

Run: `pnpm --filter @language-drill/web exec vitest run fw-unstuck`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Wire `FwUnstuck` into the composer** (`fw-composer.tsx`)

Add to imports:

```tsx
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { FwUnstuck } from './fw-unstuck';
```

Extend `FwComposerProps`:

```tsx
export interface FwComposerProps {
  content: FreeWritingContent;
  value: string;
  onChange: (next: string) => void;
  examMode: boolean;
  submitting: boolean;
  onGrade: () => void;
  exerciseId: string;
  fetchFn: AuthenticatedFetch;
}
```

Update the destructure:

```tsx
export function FwComposer({ content, value, onChange, examMode, submitting, onGrade, exerciseId, fetchFn }: FwComposerProps) {
```

Replace the entire disabled helper-buttons block (the `{/* Getting-unstuck helper buttons ... */}` `<div>` … through its closing `</div>`, current lines 163–187) with:

```tsx
          {/* Getting-unstuck helpers — hidden in exam mode */}
          {!examMode && <FwUnstuck exerciseId={exerciseId} fetchFn={fetchFn} />}
```

- [ ] **Step 6: Pass the new props from the page** (`page.tsx`, the `composer` case)

```tsx
    case 'composer':
      return (
        <FwComposer
          content={content}
          value={text}
          onChange={setText}
          examMode={examMode}
          submitting={submit.isPending}
          onGrade={onGrade}
          exerciseId={exercise.id}
          fetchFn={fetchFn}
        />
      );
```

- [ ] **Step 7: Update the composer test** (`fw-composer.test.tsx`)

Add a hook mock at the top (so `FwComposer` → `FwUnstuck` renders without a real QueryClient), pass the new props in every `render`, and replace the "renders helper buttons disabled" test:

```tsx
// at top, after imports
vi.mock('@language-drill/api-client', () => ({
  useBrainstorm: () => ({ data: undefined, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() }),
  useVocabBoost: () => ({ data: undefined, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() }),
}));

const fetchFn = vi.fn();
```

Every existing `render(<FwComposer ... />)` gains `exerciseId="fw-1" fetchFn={fetchFn}`. Replace the third test with:

```tsx
  it('shows brainstorm + vocab helpers (not exam mode), start-my-paragraph disabled', () => {
    render(<FwComposer content={content} value="" onChange={() => {}} examMode={false} submitting={false} onGrade={() => {}} exerciseId="fw-1" fetchFn={fetchFn} />);
    expect(screen.getByRole('button', { name: /brainstorm/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /start my paragraph/i })).toBeDisabled();
  });

  it('hides the helper area in exam mode', () => {
    render(<FwComposer content={content} value="" onChange={() => {}} examMode={true} submitting={false} onGrade={() => {}} exerciseId="fw-1" fetchFn={fetchFn} />);
    expect(screen.queryByRole('button', { name: /brainstorm/i })).not.toBeInTheDocument();
  });
```

- [ ] **Step 8: Run the web free-writing suite**

Run: `pnpm --filter @language-drill/web exec vitest run free-writing`
Expected: PASS (composer, unstuck, page, and the existing surfaces).

- [ ] **Step 9: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/free-writing/_components/fw-unstuck.tsx" "apps/web/app/(dashboard)/drill/free-writing/_components/fw-unstuck.test.tsx" "apps/web/app/(dashboard)/drill/free-writing/_components/fw-composer.tsx" "apps/web/app/(dashboard)/drill/free-writing/_components/fw-composer.test.tsx" "apps/web/app/(dashboard)/drill/free-writing/page.tsx"
git commit -m "feat(web): wire brainstorm + vocab-boost helpers into the composer"
```

---

## Task 8: Full verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: zero errors. (Watch for unused-var lint like the quick-wins PR; fix inline if any.)

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors across all packages.

- [ ] **Step 3: Full test suite (serialized to avoid the known infra parallel flake)**

Run: `pnpm turbo run test --concurrency=1`
Expected: all tasks pass.

- [ ] **Step 4: Manual smoke (optional but recommended)**

With `ANTHROPIC_API_KEY` set in `.env`, run `pnpm dev`, open `http://localhost:3000`, go to the free-writing drill → begin writing. Click **brainstorm** → English idea groups render; toggle to **vocabulary boost** → target-language terms with glosses; **regenerate** produces a fresh set; toggling the panel closed/open does NOT re-call (network tab shows one POST per regenerate). Enable exam mode on the brief → the helper area is gone.

- [ ] **Step 5: Push + open PR** (only after the user confirms)

```bash
git push -u origin feat-free-writing-unstuck
gh pr create --base main --title "feat(free-writing): brainstorm + vocab-boost unstuck helpers" --body "<summary>"
```

---

## Post-merge runtime step (NOT a code task — do after merge)

The two new prompts are **create-only** registered by `bootstrap-prompts`, but the runtime serves them from Langfuse once present. After merge, register them in each environment (they're new, so `bootstrap-prompts` — not `push-prompts` — is correct):

```bash
# Pull env creds from Secrets Manager (see CLAUDE.md "Prompt Editing"), then:
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai bootstrap-prompts
```

Until registered, both helpers serve the in-repo fallback prompt (tagged `fallback:<version>`), which is correct behavior — no outage.

---

## Self-Review notes (addressed)

- **Spec coverage:** two endpoints (Task 4) ✓; shared bucket (Task 3) ✓; AI prompts/generators + manifest (Tasks 1–2) ✓; schemas + cached hooks with regenerate (Task 5) ✓; composer panel + exam-mode hide + CSS (Tasks 6–7) ✓; start-my-paragraph stays disabled ✓; tests at every layer ✓; manifest-count + CLAUDE.md table ✓.
- **Type consistency:** `BrainstormResult`/`VocabBoostResult` (ai) vs `BrainstormResponse`/`VocabBoostResponse` (api-client) are deliberately distinct names for the two layers; the route returns the ai shape and the Zod schema validates the same JSON shape. `writing_helper` event type is identical across limits, route, and tests. `free-writing-brainstorm` / `free-writing-vocab-boost` feature strings match between `LlmFeature`, the route, and the manifest surfaces.
- **No placeholders:** every code/test step is complete and runnable.
