# Free Writing — Start my paragraph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third free-writing "getting-unstuck" helper — **Start my paragraph** — that returns one target-language opening sentence and inserts it into the composer with one click. No scoring penalty, no evaluator/history changes.

**Architecture:** A near-clone of the shipped Brainstorm / Vocab-boost helpers. One new metered, ephemeral AI endpoint (`POST /exercises/:id/start-my-paragraph`) reusing the existing `runWritingHelper` gate and `writing_helper` daily-cap bucket. The opener is generated via Claude tool-use, returned as `{ opener: string }`, and prepended to the textarea client-side. A `useMutation` hook (not a query — the result is a side-effecting insert, fresh each click) drives it. Once inserted, the opener is just part of the learner's answer and is graded normally.

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo). `packages/ai` (Anthropic SDK tool-use + Langfuse-backed prompts), `infra/lambda` (Hono), `packages/api-client` (TanStack Query + Zod), `apps/web` (Next.js App Router + React). Tests: Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-15-free-writing-start-my-paragraph-design.md`

**Conventions to honor:**
- TDD: write the failing test first, watch it fail, implement, watch it pass, commit.
- A new `*_SYSTEM_PROMPT` requires a matching `*_PROMPT_VERSION` (CLAUDE.md "Prompt Editing") **and** a `PROMPTS` manifest entry (CLAUDE.md / memory "new prompt needs manifest entry").
- Run package tests with `pnpm --filter <pkg> test <path>`. Before pushing, the full gate is `pnpm lint && pnpm typecheck && pnpm turbo run test --concurrency=1` from the repo root (concurrency 1 avoids the known infra parallel-flake).
- All paths below are relative to the repo root (the worktree `.claude/worktrees/feat-start-my-paragraph`).

**Pre-existing breakage this plan fixes:** `packages/ai/scripts/bootstrap-prompts.test.ts` currently asserts `toHaveLength(12)` while the manifest already holds **14** entries (the dictation PRs didn't bump it) — so that one test is red on `main` today. Task 3 sets it to the correct **15**.

---

## File Structure

**Modified — `packages/ai`:**
- `src/writing-helper-prompts.ts` — add `START_MY_PARAGRAPH_SYSTEM_PROMPT`, `START_MY_PARAGRAPH_PROMPT_VERSION`, `buildStartMyParagraphUserPrompt`.
- `src/writing-helper.ts` — add `START_MY_PARAGRAPH_TOOL`/`_NAME`, `parseStartMyParagraph`, `generateStartMyParagraph`, `StartMyParagraphResult`.
- `src/writing-helper.test.ts` — add parse + generate tests.
- `src/index.ts` — re-export the new symbols.
- `src/observability.ts` — add the `LlmFeature` union member + `TOOL_NAME_TO_FEATURE` entry.
- `src/observability.test.ts` — assert the new map entry.
- `scripts/bootstrap-prompts.ts` — add the manifest entry + import.
- `scripts/bootstrap-prompts.test.ts` — bump count (→15) + add the surface.

**Modified — `infra/lambda`:**
- `src/routes/exercises.ts` — import the generator + version, extend `WritingHelperFeature`, add the route.
- `src/routes/exercises.writing-helper.test.ts` — mock the generator + version, add a route describe block.

**Modified — `packages/api-client`:**
- `src/schemas/writing-helper.ts` — add `StartMyParagraphSchema` + type.
- `src/schemas/writing-helper.test.ts` — add schema parse tests.
- `src/hooks/useStartMyParagraph.ts` — **new file**, a `useMutation` hook.
- `src/index.ts` — re-export schema + hook.

**Modified — `apps/web`:**
- `app/(dashboard)/drill/free-writing/_components/fw-unstuck.tsx` — enable the button, add the mutation + insert/regenerate/remove logic + status chip, reword the hint.
- `app/(dashboard)/drill/free-writing/_components/fw-unstuck.test.tsx` — rewrite for the new behavior.
- `app/(dashboard)/drill/free-writing/_components/fw-composer.tsx` — pass `value`/`onChange` into `<FwUnstuck>`.
- `app/(dashboard)/drill/free-writing/_components/fw-composer.test.tsx` — add `useStartMyParagraph` to the mock.

**Modified — root:**
- `CLAUDE.md` — add the version-constant table row.

---

## Task 1: AI prompt + generator (`packages/ai`)

**Files:**
- Modify: `packages/ai/src/writing-helper-prompts.ts`
- Modify: `packages/ai/src/writing-helper.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `packages/ai/src/writing-helper.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/ai/src/writing-helper.test.ts`. Also extend the import block at the top of the file to add the three new symbols.

Change the existing import (lines 2–9) to also import the start-my-paragraph symbols:

```ts
import {
  generateBrainstorm,
  parseBrainstorm,
  BRAINSTORM_TOOL_NAME,
  generateVocabBoost,
  parseVocabBoost,
  VOCAB_BOOST_TOOL_NAME,
  generateStartMyParagraph,
  parseStartMyParagraph,
  START_MY_PARAGRAPH_TOOL_NAME,
} from "./writing-helper.js";
```

Append these describe blocks to the end of the file:

```ts
describe("parseStartMyParagraph", () => {
  it("returns the opener string when present", () => {
    expect(parseStartMyParagraph({ opener: "Hoy en día el teletrabajo es un tema de debate." })).toEqual({
      opener: "Hoy en día el teletrabajo es un tema de debate.",
    });
  });

  it("returns an empty opener for malformed input", () => {
    expect(parseStartMyParagraph(null).opener).toBe("");
    expect(parseStartMyParagraph({ opener: 42 }).opener).toBe("");
    expect(parseStartMyParagraph({}).opener).toBe("");
  });
});

describe("generateStartMyParagraph", () => {
  it("forces the opener tool and returns the parsed result", async () => {
    const client = clientReturning(START_MY_PARAGRAPH_TOOL_NAME, {
      opener: "Hoy en día el teletrabajo se ha vuelto un tema de debate constante.",
    });
    const result = await generateStartMyParagraph(client, {
      content,
      language: Language.ES,
      difficulty: CefrLevel.B1,
    });
    expect(result.opener).toBe(
      "Hoy en día el teletrabajo se ha vuelto un tema de debate constante.",
    );

    const callArgs = (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } })
      .messages.create.mock.calls[0][0];
    expect(callArgs.tool_choice).toEqual({ type: "tool", name: START_MY_PARAGRAPH_TOOL_NAME });
    expect(callArgs.temperature).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/ai test src/writing-helper.test.ts`
Expected: FAIL — `generateStartMyParagraph`/`parseStartMyParagraph`/`START_MY_PARAGRAPH_TOOL_NAME` are not exported.

- [ ] **Step 3: Add the prompt constants + builder**

In `packages/ai/src/writing-helper-prompts.ts`, add the version constant after the existing two (after line 12):

```ts
export const START_MY_PARAGRAPH_PROMPT_VERSION = "free-writing-start-my-paragraph@2026-06-15";
```

Add the system prompt after `VOCAB_BOOST_SYSTEM_PROMPT` (after line 22):

```ts
export const START_MY_PARAGRAPH_SYSTEM_PROMPT = `You are a writing coach inside a language-learning app. The learner is about to write a short text for the prompt below and is stuck on the blank page.

Return ONE opening sentence IN THE TARGET LANGUAGE, at the learner's CEFR level and register, that gets them moving. The sentence orients the topic but MUST NOT take a side, state a thesis or opinion, or address any of the required elements — those are the learner's own job. It is a runway, not a head start on the task. Keep it natural and idiomatic. Submit via the tool.`;
```

Add the user-prompt builder at the end of the file (reuses the existing private `contextBlock`):

```ts
export function buildStartMyParagraphUserPrompt(
  content: FreeWritingContent,
  language: Language,
  difficulty: CefrLevel,
): string {
  return `## Opening-sentence request

${contextBlock(content, language, difficulty)}

Write ONE target-language opening sentence that orients this prompt without taking a side or naming any required element. Submit via the tool.`;
}
```

- [ ] **Step 4: Add the tool, parser, and generator**

In `packages/ai/src/writing-helper.ts`, extend the prompt import (lines 11–18) to add the three new symbols:

```ts
import {
  BRAINSTORM_SYSTEM_PROMPT,
  BRAINSTORM_PROMPT_VERSION,
  buildBrainstormUserPrompt,
  VOCAB_BOOST_SYSTEM_PROMPT,
  VOCAB_BOOST_PROMPT_VERSION,
  buildVocabBoostUserPrompt,
  START_MY_PARAGRAPH_SYSTEM_PROMPT,
  START_MY_PARAGRAPH_PROMPT_VERSION,
  buildStartMyParagraphUserPrompt,
} from "./writing-helper-prompts.js";
```

Append to the end of the file (after `generateVocabBoost`):

```ts
// ── Start my paragraph ───────────────────────────────────────────────────────
export const START_MY_PARAGRAPH_TOOL_NAME = "submit_opener";
export const START_MY_PARAGRAPH_TOOL: Anthropic.Tool = {
  name: START_MY_PARAGRAPH_TOOL_NAME,
  description: "Submit one target-language opening sentence the learner can build on.",
  input_schema: {
    type: "object" as const,
    properties: {
      opener: { type: "string", description: "One target-language opening sentence." },
    },
    required: ["opener"],
  },
};

export type StartMyParagraphResult = { opener: string };

export function parseStartMyParagraph(input: unknown): StartMyParagraphResult {
  if (typeof input !== "object" || input === null) return { opener: "" };
  const o = (input as Record<string, unknown>).opener;
  return { opener: typeof o === "string" ? o : "" };
}

export async function generateStartMyParagraph(
  client: Anthropic,
  input: WritingHelperInput,
): Promise<StartMyParagraphResult> {
  return runHelperTool(client, {
    promptName: "free-writing-start-my-paragraph-system-prompt",
    fallbackPrompt: START_MY_PARAGRAPH_SYSTEM_PROMPT,
    version: START_MY_PARAGRAPH_PROMPT_VERSION,
    userPrompt: buildStartMyParagraphUserPrompt(input.content, input.language, input.difficulty),
    tool: START_MY_PARAGRAPH_TOOL,
    toolName: START_MY_PARAGRAPH_TOOL_NAME,
    parse: parseStartMyParagraph,
  });
}
```

- [ ] **Step 5: Re-export from the barrel**

In `packages/ai/src/index.ts`, add to the `./writing-helper.js` export block (lines 67–81):

```ts
  generateStartMyParagraph,
  parseStartMyParagraph,
  START_MY_PARAGRAPH_TOOL,
  START_MY_PARAGRAPH_TOOL_NAME,
  type StartMyParagraphResult,
```

And add to the `./writing-helper-prompts.js` export block (lines 82–89):

```ts
  START_MY_PARAGRAPH_SYSTEM_PROMPT,
  START_MY_PARAGRAPH_PROMPT_VERSION,
  buildStartMyParagraphUserPrompt,
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test src/writing-helper.test.ts`
Expected: PASS (all parse + generate tests, including the new ones).

- [ ] **Step 7: Commit**

```bash
git add packages/ai/src/writing-helper-prompts.ts packages/ai/src/writing-helper.ts packages/ai/src/index.ts packages/ai/src/writing-helper.test.ts
git commit -m "feat(free-writing): start-my-paragraph opener generator (packages/ai)"
```

---

## Task 2: Observability feature tag (`packages/ai`)

**Files:**
- Modify: `packages/ai/src/observability.ts:32-42` (LlmFeature union), `:163-176` (TOOL_NAME_TO_FEATURE)
- Test: `packages/ai/src/observability.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the end of `packages/ai/src/observability.test.ts` (the file already imports `TOOL_NAME_TO_FEATURE`):

```ts
describe("TOOL_NAME_TO_FEATURE — start my paragraph", () => {
  it("maps submit_opener to the start-my-paragraph feature", () => {
    expect(TOOL_NAME_TO_FEATURE.get("submit_opener")).toBe("free-writing-start-my-paragraph");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai test src/observability.test.ts`
Expected: FAIL — `TOOL_NAME_TO_FEATURE.get("submit_opener")` returns `undefined`.

- [ ] **Step 3: Add the union member**

In `packages/ai/src/observability.ts`, add to the `LlmFeature` union (after line 36, `"free-writing-vocab-boost"`):

```ts
  | "free-writing-start-my-paragraph"
```

- [ ] **Step 4: Add the tool→feature map entry**

In the `TOOL_NAME_TO_FEATURE` map (after line 167, the `submit_vocab_boost` entry):

```ts
  ["submit_opener", "free-writing-start-my-paragraph"],
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test src/observability.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/observability.ts packages/ai/src/observability.test.ts
git commit -m "feat(free-writing): tag start-my-paragraph LlmFeature + tool map"
```

---

## Task 3: Prompt manifest registration (`packages/ai`) + CLAUDE.md

**Files:**
- Modify: `packages/ai/scripts/bootstrap-prompts.ts` (imports + manifest)
- Modify: `packages/ai/scripts/bootstrap-prompts.test.ts:119-145`
- Modify: `CLAUDE.md` (version table)

- [ ] **Step 1: Update the failing manifest tests**

In `packages/ai/scripts/bootstrap-prompts.test.ts`, update the count assertion (line 121) and its title (line 119). The correct post-change count is **15** (the manifest currently holds 14 — note this test is already red at 12 on `main`):

```ts
  it("contains exactly fifteen entries — one per registered Langfuse prompt", () => {
    // Bumps here are intentional: adding/removing a prompt should be a
    // PR-level conversation, not silently slip past the test gate.
    expect(PROMPTS).toHaveLength(15);
  });
```

In the "registers every surface" test, add the new surface to the expected `Set` (inside the `new Set([...])`, after `"free-writing-vocab-boost",`):

```ts
        "free-writing-start-my-paragraph",
```

- [ ] **Step 2: Run the tests to verify the expected failures**

Run: `pnpm --filter @language-drill/ai test scripts/bootstrap-prompts.test.ts`
Expected: FAIL — count is 14 (not 15) and the surfaces set is missing `free-writing-start-my-paragraph`.

- [ ] **Step 3: Import the prompt constants into the manifest script**

In `packages/ai/scripts/bootstrap-prompts.ts`, add to the `@language-drill/ai` source import block (near lines 43–56, alphabetically with the other writing-helper constants):

```ts
  START_MY_PARAGRAPH_SYSTEM_PROMPT,
  START_MY_PARAGRAPH_PROMPT_VERSION,
```

(These are exported from `src/index.ts` per Task 1, Step 5; this script imports from the package source the same way it imports `BRAINSTORM_SYSTEM_PROMPT`.)

- [ ] **Step 4: Add the manifest entry**

In the `PROMPTS` array, add after the `free-writing-vocab-boost-system-prompt` entry (after line 120):

```ts
  {
    name: "free-writing-start-my-paragraph-system-prompt",
    text: START_MY_PARAGRAPH_SYSTEM_PROMPT,
    version: START_MY_PARAGRAPH_PROMPT_VERSION,
    surface: "free-writing-start-my-paragraph",
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test scripts/bootstrap-prompts.test.ts`
Expected: PASS — 20 tests pass (the previously-red count test is now green at 15).

- [ ] **Step 6: Add the CLAUDE.md version-table row**

In `CLAUDE.md`, in the "Prompt Editing" version-constant table, add a row after the `VOCAB_BOOST_PROMPT_VERSION` row:

```markdown
| `writing-helper-prompts.ts` | `START_MY_PARAGRAPH_PROMPT_VERSION` |
```

- [ ] **Step 7: Commit**

```bash
git add packages/ai/scripts/bootstrap-prompts.ts packages/ai/scripts/bootstrap-prompts.test.ts CLAUDE.md
git commit -m "feat(free-writing): register start-my-paragraph prompt in manifest"
```

---

## Task 4: Lambda endpoint (`infra/lambda`)

**Files:**
- Modify: `infra/lambda/src/routes/exercises.ts` (imports `:18-36`, union `:468`, routes `:578-584`)
- Test: `infra/lambda/src/routes/exercises.writing-helper.test.ts`

- [ ] **Step 1: Write the failing test**

In `infra/lambda/src/routes/exercises.writing-helper.test.ts`, extend the `@language-drill/ai` mock (lines 52–71) to add the generator mock and version. Add a declaration next to the other generator mocks (after line 51):

```ts
const mockGenerateStartMyParagraph = vi.fn();
```

Add inside the `vi.mock('@language-drill/ai', () => ({ ... }))` object (alongside the other `generate*` + `*_PROMPT_VERSION` keys):

```ts
  generateStartMyParagraph: (...a: unknown[]) => mockGenerateStartMyParagraph(...a),
  START_MY_PARAGRAPH_PROMPT_VERSION: 'free-writing-start-my-paragraph@2026-06-15',
```

Append a new describe block at the end of the file (mirrors the vocab-boost block; the `beforeEach` re-imports the route module so the new route is registered):

```ts
describe('POST /exercises/:id/start-my-paragraph', () => {
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

  it('success → 200, returns the opener, meters one writing_helper event', async () => {
    mockGenerateStartMyParagraph.mockResolvedValue({ opener: 'Hoy en día el teletrabajo es un tema de debate.' });
    const res = await post(app, '/exercises/fw-1/start-my-paragraph');
    expect(res.status).toBe(200);
    expect((await res.json()) as AnyJson).toEqual({ opener: 'Hoy en día el teletrabajo es un tema de debate.' });
    expect(mockGenerateStartMyParagraph).toHaveBeenCalledTimes(1);
    const writingHelperEvents = insertValuesCalls.filter((r) => r.eventType === 'writing_helper');
    expect(writingHelperEvents).toHaveLength(1);
  });

  it('non-free-writing exercise → 400 BAD_EXERCISE_TYPE, no AI, no meter', async () => {
    exerciseRow = { ...FW_ROW, type: 'cloze', contentJson: { type: 'cloze' } };
    const res = await post(app, '/exercises/fw-1/start-my-paragraph');
    expect(res.status).toBe(400);
    expect(((await res.json()) as AnyJson).code).toBe('BAD_EXERCISE_TYPE');
    expect(mockGenerateStartMyParagraph).not.toHaveBeenCalled();
  });

  it('missing exercise → 404, no AI', async () => {
    exerciseRow = undefined;
    const res = await post(app, '/exercises/none/start-my-paragraph');
    expect(res.status).toBe(404);
    expect(mockGenerateStartMyParagraph).not.toHaveBeenCalled();
  });

  it('global brake → 503 GLOBAL_CAPACITY, no AI, no meter', async () => {
    capacityVerdict = 'killed';
    const res = await post(app, '/exercises/fw-1/start-my-paragraph');
    expect(res.status).toBe(503);
    expect(((await res.json()) as AnyJson).code).toBe('GLOBAL_CAPACITY');
    expect(mockGenerateStartMyParagraph).not.toHaveBeenCalled();
  });

  it('daily cap reached → 429 RATE_LIMIT_EXCEEDED, no AI', async () => {
    usageCount = 50; // free writing_helper limit
    const res = await post(app, '/exercises/fw-1/start-my-paragraph');
    expect(res.status).toBe(429);
    expect(((await res.json()) as AnyJson).code).toBe('RATE_LIMIT_EXCEEDED');
    expect(mockGenerateStartMyParagraph).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test src/routes/exercises.writing-helper.test.ts`
Expected: FAIL — `POST /exercises/fw-1/start-my-paragraph` returns 404 (route not registered) on the success test.

- [ ] **Step 3: Import the generator + version in the route module**

In `infra/lambda/src/routes/exercises.ts`, add to the `@language-drill/ai` import block (after line 32, `VOCAB_BOOST_PROMPT_VERSION`):

```ts
  generateStartMyParagraph,
  START_MY_PARAGRAPH_PROMPT_VERSION,
```

- [ ] **Step 4: Extend the feature union**

Change the `WritingHelperFeature` type (line 468) to include the third feature:

```ts
type WritingHelperFeature = 'free-writing-brainstorm' | 'free-writing-vocab-boost' | 'free-writing-start-my-paragraph';
```

- [ ] **Step 5: Add the route**

In `infra/lambda/src/routes/exercises.ts`, add after the `vocab-boost` route (after line 584, before `export default exercises;`):

```ts
exercises.post('/exercises/:id/start-my-paragraph', (c) =>
  runWritingHelper(c, c.req.param('id'), {
    feature: 'free-writing-start-my-paragraph',
    promptVersion: START_MY_PARAGRAPH_PROMPT_VERSION,
    generate: generateStartMyParagraph,
  }),
);
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test src/routes/exercises.writing-helper.test.ts`
Expected: PASS (brainstorm + vocab-boost + start-my-paragraph describe blocks all green).

- [ ] **Step 7: Commit**

```bash
git add infra/lambda/src/routes/exercises.ts infra/lambda/src/routes/exercises.writing-helper.test.ts
git commit -m "feat(free-writing): POST /exercises/:id/start-my-paragraph endpoint"
```

---

## Task 5: api-client schema + hook (`packages/api-client`)

**Files:**
- Modify: `packages/api-client/src/schemas/writing-helper.ts`
- Test: `packages/api-client/src/schemas/writing-helper.test.ts`
- Create: `packages/api-client/src/hooks/useStartMyParagraph.ts`
- Modify: `packages/api-client/src/index.ts:131-137`

- [ ] **Step 1: Write the failing schema test**

Append to `packages/api-client/src/schemas/writing-helper.test.ts`. First extend the import (line 2):

```ts
import { BrainstormSchema, VocabBoostSchema, StartMyParagraphSchema } from './writing-helper';
```

Add inside the `describe('writing-helper schemas', ...)` block:

```ts
  it('parses a valid start-my-paragraph payload', () => {
    const parsed = StartMyParagraphSchema.parse({ opener: 'Hoy en día...' });
    expect(parsed.opener).toBe('Hoy en día...');
  });

  it('rejects a start-my-paragraph payload missing opener', () => {
    expect(() => StartMyParagraphSchema.parse({})).toThrow();
  });

  it('rejects a non-string opener', () => {
    expect(() => StartMyParagraphSchema.parse({ opener: 42 })).toThrow();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/api-client test src/schemas/writing-helper.test.ts`
Expected: FAIL — `StartMyParagraphSchema` is not exported.

- [ ] **Step 3: Add the schema**

Append to `packages/api-client/src/schemas/writing-helper.ts`:

```ts
// Start-my-paragraph response from POST /exercises/:id/start-my-paragraph
export const StartMyParagraphSchema = z.object({
  opener: z.string(),
});
export type StartMyParagraphResponse = z.infer<typeof StartMyParagraphSchema>;
```

- [ ] **Step 4: Run the schema test to verify it passes**

Run: `pnpm --filter @language-drill/api-client test src/schemas/writing-helper.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the mutation hook**

Create `packages/api-client/src/hooks/useStartMyParagraph.ts`:

```ts
import { useMutation } from '@tanstack/react-query';
import { StartMyParagraphSchema, type StartMyParagraphResponse } from '../schemas/writing-helper';
import type { AuthenticatedFetch } from '../fetchClient';

export type UseStartMyParagraphOptions = {
  exerciseId: string;
  fetchFn: AuthenticatedFetch;
};

// A mutation, not a query: the opener is a side-effecting insert into the
// composer, and each click/regenerate must produce a fresh sentence — there is
// nothing to cache. Every call re-bills the shared `writing_helper` bucket.
export function useStartMyParagraph({ exerciseId, fetchFn }: UseStartMyParagraphOptions) {
  return useMutation<StartMyParagraphResponse, Error>({
    mutationFn: async () => {
      const response = await fetchFn(`/exercises/${exerciseId}/start-my-paragraph`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const json: unknown = await response.json();
      return StartMyParagraphSchema.parse(json);
    },
  });
}
```

- [ ] **Step 6: Re-export from the barrel**

In `packages/api-client/src/index.ts`, extend the schema export (lines 131–135) to add:

```ts
  StartMyParagraphSchema,
  type StartMyParagraphResponse,
```

And add a hook export after the `useVocabBoost` line (after line 137):

```ts
export { useStartMyParagraph, type UseStartMyParagraphOptions } from './hooks/useStartMyParagraph';
```

- [ ] **Step 7: Run the package tests to verify everything passes**

Run: `pnpm --filter @language-drill/api-client test`
Expected: PASS (schema tests green; package typechecks the new hook via the test run / build).

- [ ] **Step 8: Commit**

```bash
git add packages/api-client/src/schemas/writing-helper.ts packages/api-client/src/schemas/writing-helper.test.ts packages/api-client/src/hooks/useStartMyParagraph.ts packages/api-client/src/index.ts
git commit -m "feat(free-writing): useStartMyParagraph mutation hook + schema"
```

---

## Task 6: Composer UI (`apps/web`)

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-unstuck.tsx` (full rewrite)
- Test: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-unstuck.test.tsx` (full rewrite)
- Modify: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-composer.tsx:168`
- Modify: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-composer.test.tsx:6-9`

- [ ] **Step 1: Rewrite the test file (failing tests first)**

Replace the entire contents of `apps/web/app/(dashboard)/drill/free-writing/_components/fw-unstuck.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockUseBrainstorm = vi.fn();
const mockUseVocabBoost = vi.fn();
const mockUseStartMyParagraph = vi.fn();
vi.mock('@language-drill/api-client', () => ({
  useBrainstorm: (...a: unknown[]) => mockUseBrainstorm(...a),
  useVocabBoost: (...a: unknown[]) => mockUseVocabBoost(...a),
  useStartMyParagraph: (...a: unknown[]) => mockUseStartMyParagraph(...a),
}));

import { FwUnstuck } from './fw-unstuck';

const idle = { data: undefined, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() };

function startIdle(over: Record<string, unknown> = {}) {
  return { mutateAsync: vi.fn().mockResolvedValue({ opener: 'Opener.' }), isPending: false, isError: false, reset: vi.fn(), ...over };
}

const fetchFn = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockUseBrainstorm.mockReturnValue(idle);
  mockUseVocabBoost.mockReturnValue(idle);
  mockUseStartMyParagraph.mockReturnValue(startIdle());
});

// Stateful harness: the composer owns value/onChange in production, so we mimic
// it here to observe inserts/regenerates/removes.
function Harness({ initial = 'my draft' }: { initial?: string }) {
  const [v, setV] = React.useState(initial);
  return (
    <>
      <div data-testid="val">{v}</div>
      <FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} value={v} onChange={setV} />
    </>
  );
}

describe('FwUnstuck', () => {
  it('renders all three helper buttons enabled', () => {
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} value="" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /brainstorm/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /vocabulary boost/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /start my paragraph/i })).toBeEnabled();
  });

  it('reworded hint copy replaces the old penalty wording', () => {
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} value="" onChange={() => {}} />);
    expect(screen.getByText(/ideas and words are yours to shape/i)).toBeInTheDocument();
    expect(screen.queryByText(/counts less toward your score/i)).not.toBeInTheDocument();
  });

  it('clicking start my paragraph prepends the opener', async () => {
    mockUseStartMyParagraph.mockReturnValue(startIdle({ mutateAsync: vi.fn().mockResolvedValue({ opener: 'AAA' }) }));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /start my paragraph/i }));
    await waitFor(() => expect(screen.getByTestId('val').textContent).toBe('AAA\n\nmy draft'));
    expect(screen.getByText(/opener added/i)).toBeInTheDocument();
  });

  it('regenerate replaces the opener rather than appending', async () => {
    const mutateAsync = vi.fn().mockResolvedValueOnce({ opener: 'AAA' }).mockResolvedValueOnce({ opener: 'BBB' });
    mockUseStartMyParagraph.mockReturnValue(startIdle({ mutateAsync }));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /start my paragraph/i }));
    await waitFor(() => expect(screen.getByTestId('val').textContent).toBe('AAA\n\nmy draft'));
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    await waitFor(() => expect(screen.getByTestId('val').textContent).toBe('BBB\n\nmy draft'));
    expect(screen.getByTestId('val').textContent).not.toMatch(/AAA/);
  });

  it('remove strips the opener and clears the chip', async () => {
    mockUseStartMyParagraph.mockReturnValue(startIdle({ mutateAsync: vi.fn().mockResolvedValue({ opener: 'AAA' }) }));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /start my paragraph/i }));
    await waitFor(() => expect(screen.getByText(/opener added/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    await waitFor(() => expect(screen.getByTestId('val').textContent).toBe('my draft'));
    expect(screen.queryByText(/opener added/i)).not.toBeInTheDocument();
  });

  it('an empty opener result shows the error state and inserts nothing', async () => {
    mockUseStartMyParagraph.mockReturnValue(startIdle({ mutateAsync: vi.fn().mockResolvedValue({ opener: '' }) }));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /start my paragraph/i }));
    await waitFor(() => expect(screen.getByText(/couldn’t add an opener/i)).toBeInTheDocument());
    expect(screen.getByTestId('val').textContent).toBe('my draft');
  });

  it('shows a thinking state and disables the button while pending', () => {
    mockUseStartMyParagraph.mockReturnValue(startIdle({ isPending: true }));
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} value="" onChange={() => {}} />);
    expect(screen.getByText(/thinking/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start my paragraph/i })).toBeDisabled();
  });

  it('shows an error state with a retry that re-runs the mutation', () => {
    const mutateAsync = vi.fn().mockResolvedValue({ opener: 'AAA' });
    mockUseStartMyParagraph.mockReturnValue(startIdle({ isError: true, mutateAsync }));
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} value="" onChange={() => {}} />);
    expect(screen.getByText(/couldn’t add an opener/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(mutateAsync).toHaveBeenCalled();
  });

  // The brainstorm/vocab panel still works alongside the new chip.
  it('opening brainstorm still renders groups', () => {
    mockUseBrainstorm.mockReturnValue({ ...idle, data: { groups: [{ label: 'For', points: ['flexibility'] }] } });
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} value="" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /brainstorm/i }));
    expect(screen.getByText('For')).toBeInTheDocument();
    expect(screen.getByText('flexibility')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web test fw-unstuck.test.tsx`
Expected: FAIL — the current `FwUnstuck` has no `value`/`onChange` props, the start button is disabled, and there is no opener chip.

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `apps/web/app/(dashboard)/drill/free-writing/_components/fw-unstuck.tsx` with:

```tsx
'use client';

import React from 'react';
import {
  useBrainstorm,
  useVocabBoost,
  useStartMyParagraph,
  type AuthenticatedFetch,
  type BrainstormResponse,
  type VocabBoostResponse,
} from '@language-drill/api-client';
import { FwIcon } from './fw-atoms';

type Kind = 'brainstorm' | 'vocab';

export interface FwUnstuckProps {
  exerciseId: string;
  fetchFn: AuthenticatedFetch;
  value: string;
  onChange: (next: string) => void;
}

function BrainstormView({ groups }: { groups: BrainstormResponse['groups'] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      {groups.map((g, gi) => (
        <div key={`${g.label}-${gi}`}>
          <div className="rv-h" style={{ marginBottom: 6 }}>{g.label}</div>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {g.points.map((p, pi) => (
              <li key={`${gi}-${pi}`} style={{ fontSize: 13, display: 'flex', gap: 7, alignItems: 'baseline' }}>
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
      {items.map((it, i) => (
        <div key={`${it.term}-${i}`} className="fw-vocab-row">
          <span className="w">{it.term}</span>
          <span className="g">{it.gloss}</span>
        </div>
      ))}
    </div>
  );
}

export function FwUnstuck({ exerciseId, fetchFn, value, onChange }: FwUnstuckProps) {
  const [openKind, setOpenKind] = React.useState<Kind | null>(null);

  const brainstorm = useBrainstorm({ exerciseId, fetchFn, enabled: openKind === 'brainstorm' });
  const vocab = useVocabBoost({ exerciseId, fetchFn, enabled: openKind === 'vocab' });
  const active = openKind === 'brainstorm' ? brainstorm : openKind === 'vocab' ? vocab : null;

  const toggle = (k: Kind) => setOpenKind((cur) => (cur === k ? null : k));

  // Start my paragraph — one-click insert of a target-language opener.
  const startPara = useStartMyParagraph({ exerciseId, fetchFn });
  const [insertedOpener, setInsertedOpener] = React.useState<string | null>(null);
  const [addFailed, setAddFailed] = React.useState(false);

  // Strip the currently-inserted opener prefix from `text`, if it is still there.
  const stripOpener = (text: string): string => {
    if (!insertedOpener) return text;
    const withBreak = `${insertedOpener}\n\n`;
    if (text.startsWith(withBreak)) return text.slice(withBreak.length);
    if (text.startsWith(insertedOpener)) return text.slice(insertedOpener.length);
    return text;
  };

  // Fetch an opener and prepend it. On regenerate, the prior opener is stripped
  // first so we replace rather than stack. An empty result is treated as an error.
  const handleStart = async () => {
    setAddFailed(false);
    const body = stripOpener(value);
    try {
      const res = await startPara.mutateAsync();
      if (res.opener) {
        onChange(`${res.opener}\n\n${body}`);
        setInsertedOpener(res.opener);
      } else {
        setAddFailed(true);
      }
    } catch {
      // react-query exposes the rejection via startPara.isError; nothing to insert.
    }
  };

  const handleRemove = () => {
    onChange(stripOpener(value));
    setInsertedOpener(null);
    setAddFailed(false);
    startPara.reset();
  };

  const showOpenerError = startPara.isError || addFailed;
  const showChip = startPara.isPending || showOpenerError || insertedOpener !== null;

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
        <button
          className="fw-helpbtn"
          onClick={handleStart}
          disabled={startPara.isPending}
        >
          <span className="ico"><FwIcon kind="write" size={14} /></span>
          start my paragraph
        </button>
        <span className="t-small" style={{ fontSize: 11, marginLeft: 'auto', color: 'var(--color-ink-mute)' }}>
          helpers give you a nudge — the ideas and words are yours to shape.
        </span>
      </div>

      {showChip && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 12px',
            border: '1px solid var(--color-rule)',
            borderRadius: 'var(--radius-r-md)',
            background: 'var(--color-paper-2)',
          }}
        >
          {startPara.isPending ? (
            <span className="t-small">thinking…</span>
          ) : showOpenerError ? (
            <span className="t-small" style={{ color: 'var(--color-accent-2)' }}>
              couldn’t add an opener —{' '}
              <button className="btn ghost sm" onClick={handleStart}>try again</button>
            </span>
          ) : (
            <span className="t-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              opener added
              <button className="btn ghost sm" onClick={handleStart}>regenerate</button>
              <button className="btn ghost sm" onClick={handleRemove}>remove</button>
            </span>
          )}
        </div>
      )}

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
            {active.isFetching ? (
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

Note: the brainstorm/vocab "regenerate" button (inside `.fw-helppanel`) and the opener "regenerate" button (inside the chip) are separate DOM nodes and never both visible for the same helper, so the test's role-name queries are unambiguous within each test's flow.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test fw-unstuck.test.tsx`
Expected: PASS (all FwUnstuck tests).

- [ ] **Step 5: Wire the composer to pass value/onChange**

In `apps/web/app/(dashboard)/drill/free-writing/_components/fw-composer.tsx`, change line 168:

```tsx
          {!examMode && <FwUnstuck exerciseId={exerciseId} fetchFn={fetchFn} value={value} onChange={onChange} />}
```

- [ ] **Step 6: Update the composer test mock**

In `apps/web/app/(dashboard)/drill/free-writing/_components/fw-composer.test.tsx`, extend the `@language-drill/api-client` mock (lines 6–9) to add the new hook so `FwUnstuck` can call it:

```tsx
vi.mock('@language-drill/api-client', () => ({
  useBrainstorm: () => ({ data: undefined, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() }),
  useVocabBoost: () => ({ data: undefined, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() }),
  useStartMyParagraph: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, reset: vi.fn() }),
}));
```

- [ ] **Step 7: Run the composer test to verify it still passes**

Run: `pnpm --filter @language-drill/web test fw-composer.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/free-writing/_components/fw-unstuck.tsx" "apps/web/app/(dashboard)/drill/free-writing/_components/fw-unstuck.test.tsx" "apps/web/app/(dashboard)/drill/free-writing/_components/fw-composer.tsx" "apps/web/app/(dashboard)/drill/free-writing/_components/fw-composer.test.tsx"
git commit -m "feat(free-writing): start-my-paragraph one-click insert UI"
```

---

## Task 7: Full-suite verification

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: zero errors.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors. (This is the real gate for the type-only `LlmFeature` union change in Task 2 and the `WritingHelperFeature` union in Task 4.)

- [ ] **Step 3: Full test suite (serialized to avoid the infra parallel-flake)**

Run: `pnpm turbo run test --concurrency=1`
Expected: all packages pass, including `packages/ai` (manifest now 15), `infra/lambda`, `packages/api-client`, and `apps/web`.

- [ ] **Step 4: Final commit (only if any lint/type fixes were needed)**

```bash
git add -A
git commit -m "chore(free-writing): lint/type cleanup for start-my-paragraph"
```

---

## Post-merge (operational — not part of the coding tasks)

The runtime fetches the prompt body from Langfuse and falls back to the in-repo
`START_MY_PARAGRAPH_SYSTEM_PROMPT` until the new prompt is registered. After
merge, register it in each environment (the prompt is **new**, so the create-only
`bootstrap-prompts` is the right tool here — not `push-prompts`):

```bash
PK=$(aws --region eu-central-1 secretsmanager get-secret-value \
  --secret-id language-drill/LANGFUSE_PUBLIC_KEY --query SecretString --output text)
SK=$(aws --region eu-central-1 secretsmanager get-secret-value \
  --secret-id language-drill/LANGFUSE_SECRET_KEY --query SecretString --output text)
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai bootstrap-prompts          # prod
# repeat with the language-drill-dev/ secrets for dev
```

Until then the in-repo fallback serves a correct opener, so the feature works on
deploy; registration just moves the body under Langfuse control. No revalidation
runbook applies (this prompt doesn't touch the exercise pool).
```
