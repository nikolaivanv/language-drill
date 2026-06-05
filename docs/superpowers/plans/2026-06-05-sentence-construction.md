# Sentence Construction (Exercise #4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Sentence Construction as the fourth exercise type — the learner is given a prompt (keywords, a situation, or an explicit grammar target) and writes a full sentence that satisfies it.

**Architecture:** A new `ExerciseType.SENTENCE_CONSTRUCTION` value with one `SentenceConstructionContent` shape discriminated by `promptMode`. All type-specific logic rides the existing tool schemas and per-type *user* prompts — **no cached `*_SYSTEM_PROMPT` is edited, so no `*_PROMPT_VERSION` bump and no Langfuse sync is required**. The exercise reuses the generation → validation → evaluation pipeline unchanged in shape (no `EvaluationResult` change, no DB migration). Generation produces a mix of the three modes (cycled by ordinal); the validator confirms 2–3 stored model answers satisfy the prompt; generation is opt-in per grammar point via a new `sentenceConstructionSuitable` curriculum flag.

**Tech Stack:** TypeScript, pnpm workspaces + Turborepo, Vitest, Anthropic SDK (tool use), Drizzle/Neon, Next.js (App Router), Zod (api-client).

**Spec:** `docs/superpowers/specs/2026-06-05-sentence-construction-design.md`

---

## Conventions for every task

- Run commands from the worktree root: `/Users/seal/dev/language-drill/.claude/worktrees/sentence-construction`.
- **Build before single-package tests** when you changed `packages/shared` or `packages/db` source: `pnpm build` (turbo). Vitest in a single package resolves `@language-drill/shared` / `@language-drill/db` against their built `dist/`, so a source edit there is invisible to dependents until rebuilt.
- TDD: write the failing test, watch it fail, implement, watch it pass, commit.
- Commit messages: imperative, prefixed `feat:` / `test:` / `refactor:`. End each with the repo's co-author trailer.
- The TypeScript `never`-exhaustive switches and `Record<ExerciseType, …>` maps are **compile-breakers**: once Task 1 lands the enum value, `pnpm typecheck` fails until every map/switch is updated. Tasks 2–14 clear them. Expect red typecheck between Task 1 and Task 14 — that's the compiler doing our TODO list.

---

## File map

**Create:**
- `apps/web/app/(dashboard)/drill/_components/sentence-construction-exercise.tsx` — the learner-facing component
- `apps/web/app/(dashboard)/drill/_components/__tests__/sentence-construction-exercise.test.tsx`
- `packages/db/scripts/__fixtures__/claude-generation/sentence_construction.json` — mock-client generation fixture
- `packages/db/scripts/__fixtures__/claude-validation/sentence_construction.json` — mock-client validation fixture (path mirrors the existing fixtures' location — confirm in Task 14)

**Modify (core):**
- `packages/shared/src/index.ts` — enum value, `SentenceConstructionContent`, union, type guard
- `packages/shared/src/index.test.ts` — type-guard tests
- `packages/shared/src/curriculum-types.ts` — `sentenceConstructionSuitable?` flag
- `packages/ai/src/generate.ts` — tool-name map, tool schema, parser, `parseToolInput` case
- `packages/ai/src/generation-prompts.ts` — `canonicalSurface` case, mode-cycling in `buildGenerationUserPrompt`
- `packages/ai/src/prompts.ts` — eval user-prompt builder + switch case
- `packages/ai/src/validation-prompts.ts` — validation user-prompt builder + switch case
- `packages/db/src/generation/cells.ts` — route `SENTENCE_CONSTRUCTION` when flagged
- `packages/db/src/curriculum/index.ts` — invariant for the flag
- `packages/db/src/curriculum/{es,de,tr}.ts` — flag the curated v1 set

**Modify (cross-cutting compile-breakers & validators):**
- `packages/db/src/lib/cell-key.ts` — regex alternation
- `infra/lambda/src/generation/job-message.ts` — `VALID_EXERCISE_TYPES`
- `packages/db/scripts/generate-exercises-resolve-cells.ts` — `GRAMMAR_KIND_TYPES`
- `infra/lambda/src/generation/cell-targets.ts` — `CELL_TARGET_DEFAULTS`
- `infra/lambda/src/lib/today-plan.ts` — `ESTIMATED_MINUTES_BY_TYPE`, `ITEM_COUNT_BY_TYPE`
- `apps/web/app/(dashboard)/_lib/timeline-labels.ts` — `TYPE_LABELS`
- `apps/web/lib/drill/coach-messages.ts` — two switches
- `packages/db/scripts/generate-exercises-mock-client.ts` — three maps
- `apps/web/app/(dashboard)/drill/_components/exercise-pane.tsx` — dispatch branch
- `apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx` — debrief body
- plus the matching `*.test.ts(x)` files noted per task

**No change needed (verified):** `packages/api-client/src/schemas/{debrief,today}.ts` (`z.nativeEnum(ExerciseType)` self-updates), `packages/db/scripts/generate-exercises-parse-args.ts` (`Object.values(ExerciseType)`), `packages/db/src/generation/run-one-cell.ts` (pass-through), `packages/ai/src/validate.ts` (guard is `draft.contentJson.type in TOOL_NAME_BY_TYPE`, clears once Task 2 lands).

---

## Task 1: Shared content type + enum + type guard

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/index.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/index.test.ts`:

```ts
import {
  ExerciseType,
  isSentenceConstructionContent,
  isClozeContent,
  type SentenceConstructionContent,
} from "./index";

describe("isSentenceConstructionContent", () => {
  const base: SentenceConstructionContent = {
    type: ExerciseType.SENTENCE_CONSTRUCTION,
    instructions: "Write one sentence in Spanish.",
    promptMode: "grammar_target",
    prompt: "Write a sentence using the present subjunctive to express a wish.",
    targetStructure: "present subjunctive",
    modelAnswers: ["Espero que tengas un buen día.", "Ojalá llueva mañana."],
  };

  it("returns true for sentence-construction content", () => {
    expect(isSentenceConstructionContent(base)).toBe(true);
  });

  it("returns false for another content type", () => {
    expect(
      isSentenceConstructionContent({
        type: ExerciseType.CLOZE,
        instructions: "x",
        sentence: "a ___ b",
        correctAnswer: "c",
      }),
    ).toBe(false);
  });

  it("does not classify sentence-construction as cloze", () => {
    expect(isClozeContent(base)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/shared test -- index.test.ts`
Expected: FAIL — `isSentenceConstructionContent` / `SentenceConstructionContent` not exported.

- [ ] **Step 3: Implement the enum value, content shape, union, and guard**

In `packages/shared/src/index.ts`, add the enum member:

```ts
export enum ExerciseType {
  CLOZE = "cloze",
  TRANSLATION = "translation",
  VOCAB_RECALL = "vocab_recall",
  SENTENCE_CONSTRUCTION = "sentence_construction",
}
```

Add the content type after `VocabRecallContent` (before the `ExerciseContent` union):

```ts
export type SentenceConstructionContent = {
  type: ExerciseType.SENTENCE_CONSTRUCTION;
  instructions: string;
  /** Which framing the prompt uses. Drives generation variety, not pooling. */
  promptMode: "keywords" | "situation" | "grammar_target";
  /** The rendered task shown to the learner. */
  prompt: string;
  /** Required & non-empty iff promptMode === "keywords": the words to use. */
  keywords?: string[];
  /** Human label of the target structure; present for grammar_target mode. */
  targetStructure?: string;
  /** Optional register constraint. */
  register?: "informal" | "neutral" | "formal";
  /** 2–3 valid example sentences. Used by the validator and the "show an example" hint. */
  modelAnswers: string[];
  topicHint?: string;
};
```

Extend the union:

```ts
export type ExerciseContent =
  | ClozeContent
  | TranslationContent
  | VocabRecallContent
  | SentenceConstructionContent;
```

Add the guard after `isVocabRecallContent`:

```ts
export function isSentenceConstructionContent(
  content: ExerciseContent,
): content is SentenceConstructionContent {
  return content.type === ExerciseType.SENTENCE_CONSTRUCTION;
}
```

- [ ] **Step 4: Build shared, then run the test to verify it passes**

Run: `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/shared test -- index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/index.test.ts
git commit -m "feat(shared): add SentenceConstructionContent type + ExerciseType.SENTENCE_CONSTRUCTION"
```

---

## Task 2: Generation tool schema + tool-name map

**Files:**
- Modify: `packages/ai/src/generate.ts`
- Test: `packages/ai/src/generate.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/ai/src/generate.test.ts`:

```ts
import {
  TOOL_NAME_BY_TYPE,
  GENERATION_TOOL_BY_TYPE,
  SENTENCE_CONSTRUCTION_GENERATION_TOOL,
} from "./generate";
import { ExerciseType } from "@language-drill/shared";

describe("sentence-construction generation tool", () => {
  it("registers the tool name", () => {
    expect(TOOL_NAME_BY_TYPE[ExerciseType.SENTENCE_CONSTRUCTION]).toBe(
      "submit_sentence_construction_exercise",
    );
  });

  it("maps the type to its tool, named consistently", () => {
    const tool = GENERATION_TOOL_BY_TYPE[ExerciseType.SENTENCE_CONSTRUCTION];
    expect(tool).toBe(SENTENCE_CONSTRUCTION_GENERATION_TOOL);
    expect(tool.name).toBe(TOOL_NAME_BY_TYPE[ExerciseType.SENTENCE_CONSTRUCTION]);
  });

  it("requires the core fields and declares promptMode/modelAnswers", () => {
    const schema = SENTENCE_CONSTRUCTION_GENERATION_TOOL.input_schema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.required).toEqual(
      expect.arrayContaining(["instructions", "promptMode", "prompt", "modelAnswers"]),
    );
    expect(schema.properties).toHaveProperty("keywords");
    expect(schema.properties).toHaveProperty("register");
    expect(schema.properties).toHaveProperty("targetStructure");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- generate.test.ts -t "sentence-construction generation tool"`
Expected: FAIL — `SENTENCE_CONSTRUCTION_GENERATION_TOOL` not exported; map key missing.

- [ ] **Step 3: Implement the tool-name entry, schema, and map entry**

In `packages/ai/src/generate.ts`, extend `TOOL_NAME_BY_TYPE`:

```ts
export const TOOL_NAME_BY_TYPE: Readonly<Record<ExerciseType, string>> =
  Object.freeze({
    cloze: "submit_cloze_exercise",
    translation: "submit_translation_exercise",
    vocab_recall: "submit_vocab_recall_exercise",
    sentence_construction: "submit_sentence_construction_exercise",
  });
```

Add the tool after `VOCAB_RECALL_GENERATION_TOOL`:

```ts
export const SENTENCE_CONSTRUCTION_GENERATION_TOOL: Anthropic.Tool = {
  name: TOOL_NAME_BY_TYPE.sentence_construction,
  description:
    "Submit a single sentence-construction exercise: a prompt that asks the learner to write one full sentence exercising the configured grammar point, plus 2–3 model answers.",
  input_schema: {
    type: "object" as const,
    properties: {
      instructions: {
        type: "string",
        description:
          "Short imperative telling the learner to write one sentence in the target language (e.g. 'Write one sentence in Spanish.').",
      },
      promptMode: {
        type: "string",
        enum: ["keywords", "situation", "grammar_target"],
        description:
          "The framing of this prompt. 'keywords': the learner must use a given set of words. 'situation': a real-life communicative goal (apologise, ask, describe). 'grammar_target': an explicit instruction to use the target structure. Set this to the mode named in the user message.",
      },
      prompt: {
        type: "string",
        description:
          "The task statement shown to the learner. For keywords mode, name the words to use. For situation mode, describe the scenario and goal. For grammar_target mode, state the structure to use. The prompt MUST be solvable only by exercising the configured grammar point.",
      },
      keywords: {
        type: "array",
        items: { type: "string" },
        description:
          "REQUIRED and non-empty when promptMode is 'keywords' (3–4 everyday words the learner must use). Omit for other modes.",
      },
      targetStructure: {
        type: "string",
        description:
          "Human-readable label of the grammar structure the learner must use (e.g. 'present subjunctive'). REQUIRED for grammar_target mode; optional otherwise.",
      },
      register: {
        type: "string",
        enum: ["informal", "neutral", "formal"],
        description:
          "Optional register constraint the learner's sentence must respect.",
      },
      modelAnswers: {
        type: "array",
        items: { type: "string" },
        description:
          "2 or 3 distinct, natural example sentences that satisfy the prompt AND exercise the target grammar point at the target CEFR level. These demonstrate that the prompt is solvable and seed the learner's 'show an example' hint.",
      },
      topicHint: {
        type: "string",
        description: "Optional topic theme (e.g. 'travel', 'work', 'family').",
      },
    },
    required: ["instructions", "promptMode", "prompt", "modelAnswers"],
  },
};
```

Extend `GENERATION_TOOL_BY_TYPE`:

```ts
export const GENERATION_TOOL_BY_TYPE: Readonly<
  Record<ExerciseType, Anthropic.Tool>
> = Object.freeze({
  cloze: CLOZE_GENERATION_TOOL,
  translation: TRANSLATION_GENERATION_TOOL,
  vocab_recall: VOCAB_RECALL_GENERATION_TOOL,
  sentence_construction: SENTENCE_CONSTRUCTION_GENERATION_TOOL,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- generate.test.ts -t "sentence-construction generation tool"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/generate.ts packages/ai/src/generate.test.ts
git commit -m "feat(ai): add sentence-construction generation tool schema"
```

---

## Task 3: Generation draft parser + parseToolInput case

**Files:**
- Modify: `packages/ai/src/generate.ts`
- Test: `packages/ai/src/generate.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/ai/src/generate.test.ts` (the file already constructs a `GenerationSpec`; reuse its helper or inline a minimal `spec` with `exerciseType: ExerciseType.SENTENCE_CONSTRUCTION`):

```ts
import { parseGeneratedSentenceConstructionDraft } from "./generate";

describe("parseGeneratedSentenceConstructionDraft", () => {
  const spec = makeSpec({ exerciseType: ExerciseType.SENTENCE_CONSTRUCTION }); // existing test helper

  it("parses a valid grammar_target draft", () => {
    const out = parseGeneratedSentenceConstructionDraft(
      {
        instructions: "Write one sentence in Spanish.",
        promptMode: "grammar_target",
        prompt: "Write a sentence using the present subjunctive to express a wish.",
        targetStructure: "present subjunctive",
        modelAnswers: ["Espero que vengas.", "Ojalá llueva."],
      },
      spec,
    );
    expect(out.type).toBe(ExerciseType.SENTENCE_CONSTRUCTION);
    expect(out.promptMode).toBe("grammar_target");
    expect(out.modelAnswers).toHaveLength(2);
  });

  it("parses keywords mode with a non-empty keyword list", () => {
    const out = parseGeneratedSentenceConstructionDraft(
      {
        instructions: "Write one sentence.",
        promptMode: "keywords",
        prompt: "Use these words: ayer, biblioteca, libro.",
        keywords: ["ayer", "biblioteca", "libro"],
        modelAnswers: ["Ayer olvidé un libro en la biblioteca.", "Ayer fui a la biblioteca por un libro."],
      },
      spec,
    );
    expect(out.keywords).toEqual(["ayer", "biblioteca", "libro"]);
  });

  it("rejects keywords mode with no keywords", () => {
    expect(() =>
      parseGeneratedSentenceConstructionDraft(
        { instructions: "x", promptMode: "keywords", prompt: "p", modelAnswers: ["a", "b"] },
        spec,
      ),
    ).toThrow(/keywords/);
  });

  it("rejects an unknown promptMode", () => {
    expect(() =>
      parseGeneratedSentenceConstructionDraft(
        { instructions: "x", promptMode: "freeform", prompt: "p", modelAnswers: ["a", "b"] },
        spec,
      ),
    ).toThrow(/promptMode/);
  });

  it("rejects fewer than 2 or more than 3 model answers", () => {
    expect(() =>
      parseGeneratedSentenceConstructionDraft(
        { instructions: "x", promptMode: "situation", prompt: "p", modelAnswers: ["only one"] },
        spec,
      ),
    ).toThrow(/modelAnswers/);
  });
});
```

> If `generate.test.ts` has no `makeSpec` helper, build the spec inline the same way the existing cloze parser tests do — grep the file for `parseGeneratedClozeDraft(` to copy the exact spec-construction pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- generate.test.ts -t "parseGeneratedSentenceConstructionDraft"`
Expected: FAIL — function not exported.

- [ ] **Step 3: Implement the parser + add the dispatch case**

Add after `parseGeneratedVocabRecallDraft` in `packages/ai/src/generate.ts` (reuses the existing `isObject`, `requireString`, `optionalString`, `requireStringArray`, `optionalStringArray` helpers in this file). Also import `SentenceConstructionContent` in the existing `@language-drill/shared` import block:

```ts
const PROMPT_MODES: ReadonlySet<string> = new Set([
  "keywords",
  "situation",
  "grammar_target",
]);
const REGISTERS: ReadonlySet<string> = new Set(["informal", "neutral", "formal"]);

export function parseGeneratedSentenceConstructionDraft(
  input: unknown,
  _spec: GenerationSpec,
): SentenceConstructionContent {
  const ctx = "sentence_construction draft";
  if (!isObject(input)) {
    throw new Error(`${ctx}: must be an object, got ${typeof input}`);
  }

  const instructions = requireString(input, "instructions", ctx);
  const promptMode = requireString(input, "promptMode", ctx);
  const prompt = requireString(input, "prompt", ctx);
  const keywords = optionalStringArray(input, "keywords", ctx);
  const targetStructure = optionalString(input, "targetStructure", ctx);
  const register = optionalString(input, "register", ctx);
  const modelAnswers = requireStringArray(input, "modelAnswers", ctx);
  const topicHint = optionalString(input, "topicHint", ctx);

  if (!PROMPT_MODES.has(promptMode)) {
    throw new Error(
      `${ctx}: invalid promptMode: must be one of keywords|situation|grammar_target, got ${JSON.stringify(promptMode)}`,
    );
  }
  if (prompt.trim().length === 0) {
    throw new Error(`${ctx}: invalid prompt: must contain non-whitespace characters`);
  }
  if (promptMode === "keywords" && (!keywords || keywords.length === 0)) {
    throw new Error(
      `${ctx}: invalid keywords: promptMode 'keywords' requires a non-empty keywords array`,
    );
  }
  if (modelAnswers.length < 2 || modelAnswers.length > 3) {
    throw new Error(
      `${ctx}: invalid modelAnswers: expected 2–3 entries, got ${modelAnswers.length}`,
    );
  }
  for (let i = 0; i < modelAnswers.length; i++) {
    if (modelAnswers[i].trim().length === 0) {
      throw new Error(
        `${ctx}: invalid modelAnswers[${i}]: must contain non-whitespace characters`,
      );
    }
  }
  if (register !== undefined && !REGISTERS.has(register)) {
    throw new Error(
      `${ctx}: invalid register: must be one of informal|neutral|formal, got ${JSON.stringify(register)}`,
    );
  }

  return {
    type: ExerciseType.SENTENCE_CONSTRUCTION,
    instructions,
    promptMode: promptMode as SentenceConstructionContent["promptMode"],
    prompt,
    ...(keywords !== undefined && keywords.length > 0 ? { keywords } : {}),
    ...(targetStructure !== undefined ? { targetStructure } : {}),
    ...(register !== undefined
      ? { register: register as SentenceConstructionContent["register"] }
      : {}),
    modelAnswers,
    ...(topicHint !== undefined ? { topicHint } : {}),
  };
}
```

Add the case in `parseToolInput`:

```ts
    case ExerciseType.SENTENCE_CONSTRUCTION:
      return parseGeneratedSentenceConstructionDraft(input, spec);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- generate.test.ts -t "parseGeneratedSentenceConstructionDraft"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/generate.ts packages/ai/src/generate.test.ts
git commit -m "feat(ai): parse sentence-construction generation drafts"
```

---

## Task 4: canonicalSurface + ordinal mode-cycling in the generation user prompt

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts`
- Test: `packages/ai/src/generation-prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/ai/src/generation-prompts.test.ts`:

```ts
import {
  canonicalSurface,
  buildGenerationUserPrompt,
  sentenceConstructionModeForOrdinal,
} from "./generation-prompts";
import { ExerciseType } from "@language-drill/shared";

describe("canonicalSurface — sentence_construction", () => {
  it("keys on the normalised prompt text", () => {
    expect(
      canonicalSurface({
        type: ExerciseType.SENTENCE_CONSTRUCTION,
        instructions: "x",
        promptMode: "grammar_target",
        prompt: "  Usá  el  Subjuntivo.  ",
        modelAnswers: ["a", "b"],
      }),
    ).toBe("usa el subjuntivo.");
  });
});

describe("sentenceConstructionModeForOrdinal", () => {
  it("cycles keywords → situation → grammar_target by ordinal", () => {
    expect(sentenceConstructionModeForOrdinal(0)).toBe("keywords");
    expect(sentenceConstructionModeForOrdinal(1)).toBe("situation");
    expect(sentenceConstructionModeForOrdinal(2)).toBe("grammar_target");
    expect(sentenceConstructionModeForOrdinal(3)).toBe("keywords");
  });
});

describe("buildGenerationUserPrompt — sentence_construction", () => {
  const inputs = {
    language: "ES",
    cefrLevel: "B1",
    exerciseType: ExerciseType.SENTENCE_CONSTRUCTION,
    grammarPoint: {
      key: "es-b1-present-subjunctive",
      kind: "grammar",
      name: "Present subjunctive",
      description: "d",
      cefrLevel: "B1",
      language: "es",
      examplesPositive: ["a", "b"],
      examplesNegative: ["*c"],
      commonErrors: ["e"],
    },
  } as const;

  it("names the ordinal's mode in the message", () => {
    const msg = buildGenerationUserPrompt(inputs as never, 0, null);
    expect(msg).toContain("prompt mode: keywords");
  });

  it("does not add a mode line for other types", () => {
    const cloze = { ...inputs, exerciseType: ExerciseType.CLOZE };
    const msg = buildGenerationUserPrompt(cloze as never, 0, null);
    expect(msg).not.toContain("prompt mode:");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts.test.ts -t "sentence_construction"`
Expected: FAIL — `sentenceConstructionModeForOrdinal` not exported; `canonicalSurface` throws on the new type; user prompt lacks the mode line.

- [ ] **Step 3: Implement the mode helper, the canonicalSurface case, and the user-prompt addition**

In `packages/ai/src/generation-prompts.ts`, add the helper near the top (after the inputs section):

```ts
const SENTENCE_CONSTRUCTION_MODES = [
  "keywords",
  "situation",
  "grammar_target",
] as const;

/** Deterministic mode rotation so a batch covers all three framings. */
export function sentenceConstructionModeForOrdinal(
  ordinal: number,
): (typeof SENTENCE_CONSTRUCTION_MODES)[number] {
  return SENTENCE_CONSTRUCTION_MODES[ordinal % SENTENCE_CONSTRUCTION_MODES.length];
}
```

Add the `canonicalSurface` case (before the `default`):

```ts
    case ExerciseType.SENTENCE_CONSTRUCTION:
      return normaliseSurface(content.prompt);
```

In `buildGenerationUserPrompt`, after `const domain = topicDomain ?? "mixed";`, add a mode block and append it to the returned string:

```ts
  const modeBlock =
    inputs.exerciseType === ExerciseType.SENTENCE_CONSTRUCTION
      ? `Use prompt mode: ${sentenceConstructionModeForOrdinal(ordinal)}.\n\n`
      : "";
```

and include `${modeBlock}` in the template literal immediately before `${seedBlock}Use the ${toolName} tool.`:

```ts
  return `Produce exercise #${ordinal + 1}.

Topic domain: ${domain}

${modeBlock}${seedBlock}Use the ${toolName} tool.`;
```

> Note the test asserts the substring `prompt mode: keywords` — the rendered line is `Use prompt mode: keywords.`, which contains it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts.test.ts -t "sentence_construction"`
Expected: PASS. Also run the whole file to confirm no snapshot/byte-parity regressions for existing types: `pnpm --filter @language-drill/ai test -- generation-prompts.test.ts`
Expected: PASS (existing-type prompts unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/generation-prompts.ts packages/ai/src/generation-prompts.test.ts
git commit -m "feat(ai): sentence-construction dedup surface + ordinal mode rotation"
```

---

## Task 5: Evaluation user prompt

**Files:**
- Modify: `packages/ai/src/prompts.ts`
- Test: `packages/ai/src/evaluate.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/ai/src/evaluate.test.ts` (the file already imports `buildUserPrompt`; mirror the existing cloze/translation `buildUserPrompt` tests):

```ts
import { ExerciseType, type SentenceConstructionContent, Language, CefrLevel } from "@language-drill/shared";
import { buildUserPrompt } from "./prompts";

describe("buildUserPrompt — sentence construction", () => {
  const content: SentenceConstructionContent = {
    type: ExerciseType.SENTENCE_CONSTRUCTION,
    instructions: "Write one sentence in Spanish.",
    promptMode: "keywords",
    prompt: "Use these words: ayer, biblioteca, libro.",
    keywords: ["ayer", "biblioteca", "libro"],
    register: "neutral",
    modelAnswers: ["Ayer olvidé un libro en la biblioteca.", "Ayer dejé el libro en la biblioteca."],
  };

  it("includes the prompt, mode, keywords, register and the user's answer", () => {
    const msg = buildUserPrompt(content, "Ayer fui a la biblioteca y cogí un libro.", Language.ES, CefrLevel.B1);
    expect(msg).toContain("Sentence Construction");
    expect(msg).toContain("Use these words: ayer, biblioteca, libro.");
    expect(msg).toContain("ayer, biblioteca, libro");
    expect(msg).toContain("keywords");
    expect(msg).toContain("Ayer fui a la biblioteca");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- evaluate.test.ts -t "sentence construction"`
Expected: FAIL — switch throws / output missing.

- [ ] **Step 3: Implement the builder and switch case**

In `packages/ai/src/prompts.ts`, import `SentenceConstructionContent` in the `@language-drill/shared` import block, add the builder after `buildVocabRecallUserPrompt`:

```ts
function buildSentenceConstructionUserPrompt(
  content: SentenceConstructionContent,
  userAnswer: string,
  language: Language,
  difficulty: CefrLevel,
): string {
  const keywordsLine =
    content.promptMode === "keywords" && content.keywords && content.keywords.length > 0
      ? `**Keywords (all must be used):** ${content.keywords.join(", ")}`
      : "";
  const structureLine = content.targetStructure
    ? `**Target structure:** ${content.targetStructure}`
    : "";
  const registerLine = content.register ? `**Required register:** ${content.register}` : "";
  return `## Exercise Type: Sentence Construction
**Language:** ${language}
**Target CEFR Level:** ${difficulty}
**Prompt mode:** ${content.promptMode}

**Instructions:** ${content.instructions}
**Prompt:** ${content.prompt}
${keywordsLine}
${structureLine}
${registerLine}
**Example valid answers (for your reference — many other answers are also valid; do NOT require a match):** ${content.modelAnswers.join(" | ")}

**User's Answer:** ${userAnswer}

Evaluate the user's sentence. Judge grammatical accuracy and naturalness; fold into **Task Achievement** whether the prompt was satisfied — for keywords mode every keyword is used, for situation mode the communicative goal is met, for grammar_target mode the target structure is used. Reward complexity beyond the minimum. Flag errors outside the target structure too (do not ignore a wrong article because the target was the subjunctive).`;
}
```

Add the switch case in `buildUserPrompt`:

```ts
    case ExerciseType.SENTENCE_CONSTRUCTION:
      return buildSentenceConstructionUserPrompt(exercise, userAnswer, language, difficulty);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- evaluate.test.ts -t "sentence construction"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/prompts.ts packages/ai/src/evaluate.test.ts
git commit -m "feat(ai): evaluation user prompt for sentence construction"
```

---

## Task 6: Validation user prompt

**Files:**
- Modify: `packages/ai/src/validation-prompts.ts`
- Test: `packages/ai/src/validation-prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/ai/src/validation-prompts.test.ts` (mirror the existing per-type `buildValidationUserPrompt` tests — grep for `buildValidationUserPrompt(` to copy the `draft`/`spec` construction):

```ts
it("builds a sentence-construction validation prompt naming the model answers", () => {
  const draft = {
    id: "x",
    contentJson: {
      type: ExerciseType.SENTENCE_CONSTRUCTION,
      instructions: "Write one sentence in Spanish.",
      promptMode: "grammar_target",
      prompt: "Write a sentence using the present subjunctive to express a wish.",
      targetStructure: "present subjunctive",
      modelAnswers: ["Espero que vengas.", "Ojalá llueva."],
    },
    metadata: {} as never,
  };
  const spec = makeSpec({ exerciseType: ExerciseType.SENTENCE_CONSTRUCTION }); // existing helper
  const msg = buildValidationUserPrompt(draft as never, spec);
  expect(msg).toContain("Validate this Sentence Construction exercise");
  expect(msg).toContain("present subjunctive");
  expect(msg).toContain("Espero que vengas.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- validation-prompts.test.ts -t "sentence-construction"`
Expected: FAIL — switch throws / output missing.

- [ ] **Step 3: Implement the builder and switch case**

In `packages/ai/src/validation-prompts.ts`, import `type SentenceConstructionContent` from `@language-drill/shared`, add the builder after `buildVocabRecallValidationUserPrompt`:

```ts
function buildSentenceConstructionValidationUserPrompt(
  content: SentenceConstructionContent,
  spec: GenerationSpec,
): string {
  const keywordsLine =
    content.keywords && content.keywords.length > 0
      ? `**Keywords:** ${content.keywords.join(", ")}`
      : "";
  const structureLine = content.targetStructure
    ? `**Target structure:** ${content.targetStructure}`
    : "";
  const registerLine = content.register ? `**Register:** ${content.register}` : "";
  return `## Validate this Sentence Construction exercise

**Spec:** language=${spec.language}, cefrLevel=${spec.cefrLevel}, grammar point=${spec.grammarPoint.key}
**Prompt mode:** ${content.promptMode}
**Instructions:** ${content.instructions}
**Prompt:** ${content.prompt}
${keywordsLine}
${structureLine}
${registerLine}
**Model answers:** ${content.modelAnswers.join(" | ")}

Score the dimensions in the system prompt. Treat the exercise as well-formed only if the prompt is unambiguous and solvable at the target level, AND every model answer genuinely satisfies the prompt (keywords used / goal met / target structure used) at the target CEFR level. If a model answer does not exercise the grammar point, set grammarPointMatch=false. Submit via the tool.`;
}
```

Add the switch case in `buildValidationUserPrompt`:

```ts
    case ExerciseType.SENTENCE_CONSTRUCTION:
      return buildSentenceConstructionValidationUserPrompt(content, spec);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- validation-prompts.test.ts -t "sentence-construction"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/validation-prompts.ts packages/ai/src/validation-prompts.test.ts
git commit -m "feat(ai): validation user prompt for sentence construction"
```

---

## Task 7: Curriculum flag + cell routing + invariant

**Files:**
- Modify: `packages/shared/src/curriculum-types.ts`, `packages/db/src/generation/cells.ts`, `packages/db/src/curriculum/index.ts`
- Test: `packages/db/src/generation/cells.test.ts`, `packages/db/src/curriculum/curriculum.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/db/src/generation/cells.test.ts` (after the `clozeUnsuitable flag` describe):

```ts
describe("enumerateCurriculumCells — sentenceConstructionSuitable flag", () => {
  it("adds a sentence_construction cell for a flagged grammar point", () => {
    const point = makeGrammarPoint({
      key: "tr-a2-synthetic-sc",
      kind: "grammar",
      sentenceConstructionSuitable: true,
    });
    const cells = enumerateCurriculumCells([point]);
    expect(cells.map((c) => c.exerciseType)).toEqual([
      ExerciseType.CLOZE,
      ExerciseType.TRANSLATION,
      ExerciseType.SENTENCE_CONSTRUCTION,
    ]);
  });

  it("omits the sentence_construction cell when not flagged", () => {
    const point = makeGrammarPoint({ key: "tr-a2-synthetic-nosc", kind: "grammar" });
    const cells = enumerateCurriculumCells([point]);
    expect(cells.some((c) => c.exerciseType === ExerciseType.SENTENCE_CONSTRUCTION)).toBe(false);
  });

  it("combines with clozeUnsuitable: translation + sentence_construction only", () => {
    const point = makeGrammarPoint({
      key: "tr-a2-synthetic-both",
      kind: "grammar",
      clozeUnsuitable: true,
      sentenceConstructionSuitable: true,
    });
    const cells = enumerateCurriculumCells([point]);
    expect(cells.map((c) => c.exerciseType)).toEqual([
      ExerciseType.TRANSLATION,
      ExerciseType.SENTENCE_CONSTRUCTION,
    ]);
  });
});
```

Add to `packages/db/src/curriculum/curriculum.test.ts` (mirror the `clozeUnsuitable` invariant test at line ~116):

```ts
describe("curriculum sentenceConstructionSuitable flag", () => {
  it("throws when a vocab umbrella is flagged sentenceConstructionSuitable", () => {
    expect(() =>
      assertCurriculumInvariants([
        {
          key: "tr-a2-synthetic-vocab-sc",
          kind: "vocab",
          name: "Synthetic vocab",
          description: "Synthetic vocab entry for sentenceConstructionSuitable invariant testing.",
          cefrLevel: "A2",
          language: "tr",
          examplesPositive: ["a", "b"],
          examplesNegative: ["*c"],
          commonErrors: ["e"],
          sentenceConstructionSuitable: true,
        },
      ]),
    ).toThrow(/sentenceConstructionSuitable but not kind 'grammar'/);
  });
});
```

> Match the exact import/assert helper the existing `clozeUnsuitable` invariant test uses (grep `curriculum.test.ts` for the `clozeUnsuitable invariant` describe and copy its harness — it may call `assertCurriculumInvariants`, `validateCurriculum`, or load via the index module).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- cells.test.ts curriculum.test.ts`
Expected: FAIL — flag unknown to the type; routing + invariant absent.

- [ ] **Step 3: Implement the flag, routing, and invariant**

In `packages/shared/src/curriculum-types.ts`, add the field to `GrammarPoint` (after `clozeUnsuitable?`):

```ts
  /**
   * Optional opt-in that ADDS a `sentence_construction` cell for this grammar
   * point in `enumerateCurriculumCells`. Absent/`false` ⇒ no sentence-
   * construction cell (today's behaviour). Set this for points where free
   * production of the structure is pedagogically apt. Only valid on
   * `kind: 'grammar'` entries (enforced by the curriculum invariant).
   */
  sentenceConstructionSuitable?: boolean;
```

In `packages/db/src/generation/cells.ts`, replace `compatibleTypes` so the flag appends the type (keep the existing cloze/translation logic):

```ts
function compatibleTypes(entry: GrammarPoint): ReadonlyArray<ExerciseType> {
  if (entry.kind === 'vocab') return VOCAB_KIND_TYPES;
  const base = entry.clozeUnsuitable
    ? GRAMMAR_CLOZE_UNSUITABLE_TYPES
    : GRAMMAR_KIND_TYPES;
  return entry.sentenceConstructionSuitable
    ? [...base, ExerciseType.SENTENCE_CONSTRUCTION]
    : base;
}
```

In `packages/db/src/curriculum/index.ts`, add an invariant next to 9b:

```ts
    // 9c. sentenceConstructionSuitable is only meaningful on grammar points.
    if (entry.sentenceConstructionSuitable && entry.kind !== 'grammar') {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' is sentenceConstructionSuitable but not kind 'grammar'`,
      );
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- cells.test.ts curriculum.test.ts`
Expected: PASS.

> The existing `cells.test.ts` "produces 2 cells per grammar entry … minus one per clozeUnsuitable" count test (line 42) still passes because no real curriculum entry is flagged yet — Task 8 flags entries and updates that count expectation.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/curriculum-types.ts packages/db/src/generation/cells.ts packages/db/src/curriculum/index.ts packages/db/src/generation/cells.test.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "feat(db): route sentence_construction cells via opt-in curriculum flag"
```

---

## Task 8: Flag the curated v1 grammar points

**Files:**
- Modify: `packages/db/src/curriculum/es.ts`, `packages/db/src/curriculum/de.ts`, `packages/db/src/curriculum/tr.ts`
- Test: `packages/db/src/generation/cells.test.ts`

- [ ] **Step 1: Update the cell-count test to expect the flagged cells**

The "produces 2 cells per grammar entry … minus one per clozeUnsuitable point" test (cells.test.ts:42) must also add one cell per flagged point. Update its expectation:

```ts
  it('produces 2 cells per grammar entry (cloze + translation) and 1 per vocab entry (vocab_recall), minus one per clozeUnsuitable point, plus one per sentenceConstructionSuitable point', () => {
    const grammarCount = ALL_CURRICULA.filter((g) => g.kind === 'grammar').length;
    const vocabCount = ALL_CURRICULA.filter((g) => g.kind === 'vocab').length;
    const flaggedCount = ALL_CURRICULA.filter((g) => g.clozeUnsuitable === true).length;
    const scCount = ALL_CURRICULA.filter((g) => g.sentenceConstructionSuitable === true).length;
    expect(cells).toHaveLength(grammarCount * 2 + vocabCount - flaggedCount + scCount);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- cells.test.ts -t "produces 2 cells per grammar entry"`
Expected: FAIL — `scCount` is 0 but the test now references the new flag; actually it passes at 0 until entries are flagged. To make it a true red→green, flag the entries first in Step 3 then run. (If it passes at 0, proceed — the assertion is still correct.)

- [ ] **Step 3: Flag the curated set (4 grammar points per language, A2–B2)**

Add `sentenceConstructionSuitable: true` to these existing grammar-point entries (verified `kind: 'grammar'` keys). For each, locate the entry by its `key` and add the field alongside the other properties:

- `packages/db/src/curriculum/es.ts`: `es-a2-preterite-regular`, `es-b1-present-subjunctive`, `es-b1-conditional`, `es-b2-past-subjunctive`
- `packages/db/src/curriculum/de.ts`: `de-a2-perfekt-with-haben`, `de-b1-modal-verbs-past`, `de-b1-subordinate-conjunctions`, `de-b2-konjunktiv-ii`
- `packages/db/src/curriculum/tr.ts`: `tr-a2-aorist`, `tr-a2-mis-evidential`, `tr-b1-conditionals-sa`, `tr-b1-keske-optative`

Example edit (es.ts, the `es-b1-present-subjunctive` entry):

```ts
  {
    key: 'es-b1-present-subjunctive',
    // …existing fields…
    sentenceConstructionSuitable: true,
  },
```

> Before editing, confirm each key exists and is `kind: 'grammar'`: `grep -n "key: 'es-b1-present-subjunctive'" packages/db/src/curriculum/es.ts`. If a key was renamed, pick the nearest equivalent grammar point at the same level (free-production-suited structure, not a `-vocab` umbrella).

- [ ] **Step 4: Build and run the test to verify it passes**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- cells.test.ts`
Expected: PASS — total now includes 12 sentence_construction cells (4 per language × 3 languages).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/curriculum/es.ts packages/db/src/curriculum/de.ts packages/db/src/curriculum/tr.ts packages/db/src/generation/cells.test.ts
git commit -m "feat(db): flag curated v1 grammar points for sentence construction"
```

---

## Task 9: Runtime validators — cell-key regex, job-message set, resolve-cells array

**Files:**
- Modify: `packages/db/src/lib/cell-key.ts`, `infra/lambda/src/generation/job-message.ts`, `packages/db/scripts/generate-exercises-resolve-cells.ts`
- Test: `packages/db/src/lib/cell-key.test.ts`

- [ ] **Step 1: Write the failing test**

Add a valid sentence_construction key to `packages/db/src/lib/cell-key.test.ts` (extend the existing `valid` cases array — grep for the existing `'es:b1:cloze:` example):

```ts
it("accepts a sentence_construction cell key", () => {
  expect(() =>
    assertValidCellKey("es:b1:sentence_construction:es-b1-present-subjunctive"),
  ).not.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- cell-key.test.ts`
Expected: FAIL — regex rejects `sentence_construction`.

- [ ] **Step 3: Update the three validators**

`packages/db/src/lib/cell-key.ts` — add to the type alternation:

```ts
const CELL_KEY_REGEX =
  /^(es|de|tr):(a1|a2|b1|b2):(cloze|translation|vocab_recall|sentence_construction):[a-z0-9-]+$/;
```

`infra/lambda/src/generation/job-message.ts` — add to the set:

```ts
const VALID_EXERCISE_TYPES: ReadonlySet<string> = new Set([
  ExerciseType.CLOZE,
  ExerciseType.TRANSLATION,
  ExerciseType.VOCAB_RECALL,
  ExerciseType.SENTENCE_CONSTRUCTION,
]);
```

`packages/db/scripts/generate-exercises-resolve-cells.ts` — add to `GRAMMAR_KIND_TYPES`:

```ts
const GRAMMAR_KIND_TYPES: ReadonlyArray<ExerciseType> = [
  ExerciseType.CLOZE,
  ExerciseType.TRANSLATION,
  ExerciseType.SENTENCE_CONSTRUCTION,
];
```

> Note: this CLI array gates which `--type` values are accepted for a grammar point. It is intentionally broader than `cells.ts` routing (which is flag-gated) — the CLI lets you target a specific cell explicitly. Confirm `generate-exercises-resolve-cells.ts` does NOT separately re-enumerate cells in a way that double-adds the type; it uses `isCompatible(kind, type)` for validation only (per the integration map).

- [ ] **Step 4: Build and run the test to verify it passes**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- cell-key.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/lib/cell-key.ts infra/lambda/src/generation/job-message.ts packages/db/scripts/generate-exercises-resolve-cells.ts packages/db/src/lib/cell-key.test.ts
git commit -m "feat: accept sentence_construction in cell-key, job-message, resolve-cells"
```

---

## Task 10: Scheduler cell targets

**Files:**
- Modify: `infra/lambda/src/generation/cell-targets.ts`
- Test: `infra/lambda/src/generation/cell-targets.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `infra/lambda/src/generation/cell-targets.test.ts` (mirror the existing per-type resolve test; reuse the file's `makeCell`/`resolveCellTarget` helpers):

```ts
it("uses the constrained A1/A2 defaults for sentence_construction", () => {
  expect(resolveCellTarget(makeCell(ExerciseType.SENTENCE_CONSTRUCTION, "A2"))).toBe(30);
  expect(resolveCellTarget(makeCell(ExerciseType.SENTENCE_CONSTRUCTION, "B1"))).toBe(TARGET_PER_CELL);
});
```

> If the test helpers/constant names differ, grep `cell-targets.test.ts` for the cloze equivalent and copy its exact call shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/infra test -- cell-targets.test.ts` (use the infra package's test script name — grep `infra/package.json` if `--filter @language-drill/infra` is wrong; the lambda tests may run under a different filter).
Expected: FAIL — `Record<ExerciseType, …>` map is missing the key (also a typecheck error).

- [ ] **Step 3: Add the map entry**

In `infra/lambda/src/generation/cell-targets.ts`:

```ts
export const CELL_TARGET_DEFAULTS: Record<
  ExerciseType,
  Partial<Record<CurriculumCefrLevel, number>>
> = {
  [ExerciseType.CLOZE]: { A1: 20, A2: 30 },
  [ExerciseType.TRANSLATION]: { A1: 20, A2: 30 },
  [ExerciseType.VOCAB_RECALL]: { A1: 60, A2: 60, B1: 75, B2: 75 },
  // Free production: same constrained A1/A2 ceiling as cloze/translation; B1/B2
  // fall through to the global TARGET_PER_CELL default.
  [ExerciseType.SENTENCE_CONSTRUCTION]: { A1: 20, A2: 30 },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run the same command as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/generation/cell-targets.ts infra/lambda/src/generation/cell-targets.test.ts
git commit -m "feat(infra): cell-target defaults for sentence_construction"
```

---

## Task 11: Today-plan estimates

**Files:**
- Modify: `infra/lambda/src/lib/today-plan.ts`
- Test: `infra/lambda/src/lib/today-plan.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `infra/lambda/src/lib/today-plan.test.ts`:

```ts
it("exposes minute/count estimates for sentence_construction", () => {
  expect(ESTIMATED_MINUTES_BY_TYPE[ExerciseType.SENTENCE_CONSTRUCTION]).toBe(3);
  expect(ITEM_COUNT_BY_TYPE[ExerciseType.SENTENCE_CONSTRUCTION]).toBe(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run the lambda test command (as in Task 10): `… test -- today-plan.test.ts`
Expected: FAIL — map keys missing (typecheck error too).

- [ ] **Step 3: Add the map entries**

In `infra/lambda/src/lib/today-plan.ts`:

```ts
export const ESTIMATED_MINUTES_BY_TYPE: Record<ExerciseType, number> = {
  [ExerciseType.CLOZE]: 2,
  [ExerciseType.TRANSLATION]: 4,
  [ExerciseType.VOCAB_RECALL]: 2,
  [ExerciseType.SENTENCE_CONSTRUCTION]: 3,
};

export const ITEM_COUNT_BY_TYPE: Record<ExerciseType, number> = {
  [ExerciseType.CLOZE]: 4,
  [ExerciseType.TRANSLATION]: 1,
  [ExerciseType.VOCAB_RECALL]: 6,
  [ExerciseType.SENTENCE_CONSTRUCTION]: 3,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run the same command as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/today-plan.ts infra/lambda/src/lib/today-plan.test.ts
git commit -m "feat(infra): today-plan estimates for sentence_construction"
```

---

## Task 12: Timeline label

**Files:**
- Modify: `apps/web/app/(dashboard)/_lib/timeline-labels.ts`
- Test: `apps/web/app/(dashboard)/_components/__tests__/today-timeline.test.tsx` (or the dedicated timeline-labels test if one exists)

- [ ] **Step 1: Write the failing test**

Add a focused unit test for the label (create `apps/web/app/(dashboard)/_lib/__tests__/timeline-labels.test.ts` only if no test imports `typeLabel`; otherwise extend the existing one):

```ts
import { ExerciseType } from "@language-drill/shared";
import { typeLabel } from "../timeline-labels";

it("labels sentence_construction", () => {
  expect(typeLabel(ExerciseType.SENTENCE_CONSTRUCTION)).toBe("sentence construction");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- timeline-labels`
Expected: FAIL — map missing key (typecheck error in the `Record<ExerciseType, string>`).

- [ ] **Step 3: Add the label**

In `apps/web/app/(dashboard)/_lib/timeline-labels.ts`:

```ts
const TYPE_LABELS: Record<ExerciseType, string> = {
  [ExerciseType.CLOZE]: 'cloze',
  [ExerciseType.TRANSLATION]: 'translation',
  [ExerciseType.VOCAB_RECALL]: 'vocabulary recall',
  [ExerciseType.SENTENCE_CONSTRUCTION]: 'sentence construction',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run the same command as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/_lib/timeline-labels.ts" apps/web/app/\(dashboard\)/_lib/__tests__/timeline-labels.test.ts
git commit -m "feat(web): timeline label for sentence construction"
```

---

## Task 13: Coach messages

**Files:**
- Modify: `apps/web/lib/drill/coach-messages.ts`
- Test: `apps/web/lib/drill/__tests__/coach-messages.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/web/lib/drill/__tests__/coach-messages.test.ts` (mirror existing per-type cases — grep for `ExerciseType.CLOZE` in the file to copy the exact exported function names, e.g. `coachMessage`):

```ts
it("returns an idle message for sentence_construction", () => {
  const msg = coachMessage({ type: ExerciseType.SENTENCE_CONSTRUCTION, submission: { kind: "idle" } } as never);
  expect(typeof msg).toBe("string");
  expect(msg.length).toBeGreaterThan(0);
});

it("returns an evaluated message for sentence_construction at each tier", () => {
  for (const score of [0.95, 0.75, 0.5, 0.2]) {
    const msg = coachMessage({
      type: ExerciseType.SENTENCE_CONSTRUCTION,
      submission: { kind: "evaluated", result: { score } },
    } as never);
    expect(msg.length).toBeGreaterThan(0);
  }
});
```

> Match the real call signature: grep `coach-messages.test.ts` for an existing cloze assertion and copy how it invokes the exported function (`idleMessage`/`evaluatedMessage` are internal; the public entry may be `coachMessage`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- coach-messages`
Expected: FAIL — `never` exhaustiveness throws / typecheck error in both switches.

- [ ] **Step 3: Add the cases to both switches**

In `apps/web/lib/drill/coach-messages.ts`, add to `idleMessage`:

```ts
    case ExerciseType.SENTENCE_CONSTRUCTION:
      return "build a full sentence · use the prompt";
```

and to `evaluatedMessage` (match the existing tier structure in that switch — `praise`/`light`/`encourage`/`reset`):

```ts
    case ExerciseType.SENTENCE_CONSTRUCTION:
      switch (tier) {
        case "praise":
          return "natural and on target · nice construction";
        case "light":
          return "solid · one small tweak and it's clean";
        case "encourage":
          return "the idea's there · tighten the structure";
        case "reset":
          return "tricky structure · let's build it back up";
      }
      break;
```

> If the existing switch returns directly without `break` (e.g. each tier `return`s), follow that exact shape — copy the cloze case's control flow rather than introducing a `break` that lint may flag.

- [ ] **Step 4: Run test to verify it passes**

Run the same command as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/drill/coach-messages.ts apps/web/lib/drill/__tests__/coach-messages.test.ts
git commit -m "feat(web): coach messages for sentence construction"
```

---

## Task 14: Mock Claude client maps + fixtures

**Files:**
- Modify: `packages/db/scripts/generate-exercises-mock-client.ts`
- Create: `packages/db/scripts/__fixtures__/claude-generation/sentence_construction.json`, `packages/db/scripts/__fixtures__/claude-validation/sentence_construction.json`
- Test: `packages/db/scripts/generate-exercises.test.ts` (covered end-to-end in Task 18; here just unblock the maps)

- [ ] **Step 1: Confirm the fixture directory layout**

Run: `ls packages/db/scripts/__fixtures__/**/ 2>/dev/null; grep -n "FIXTURE_FILENAME_BY_TYPE\|readFileSync\|__fixtures__" packages/db/scripts/generate-exercises-mock-client.ts | head`
Expected: shows the existing `cloze.json` / `translation.json` / `vocab_recall.json` fixture paths for generation and validation. Mirror that exact directory layout for the new files.

- [ ] **Step 2: Add the three map entries (these are compile-breakers)**

In `packages/db/scripts/generate-exercises-mock-client.ts`:

```ts
const FIXTURE_FILENAME_BY_TYPE: Readonly<Record<ExerciseType, string>> =
  Object.freeze({
    [ExerciseType.CLOZE]: 'cloze.json',
    [ExerciseType.TRANSLATION]: 'translation.json',
    [ExerciseType.VOCAB_RECALL]: 'vocab_recall.json',
    [ExerciseType.SENTENCE_CONSTRUCTION]: 'sentence_construction.json',
  });

const VALIDATION_HEADER_BY_TYPE: Readonly<Record<ExerciseType, string>> =
  Object.freeze({
    [ExerciseType.CLOZE]: '## Validate this Cloze exercise',
    [ExerciseType.TRANSLATION]: '## Validate this Translation exercise',
    [ExerciseType.VOCAB_RECALL]: '## Validate this Vocabulary Recall exercise',
    [ExerciseType.SENTENCE_CONSTRUCTION]: '## Validate this Sentence Construction exercise',
  });

const counters: Record<ExerciseType, number> = {
  [ExerciseType.CLOZE]: 0,
  [ExerciseType.TRANSLATION]: 0,
  [ExerciseType.VOCAB_RECALL]: 0,
  [ExerciseType.SENTENCE_CONSTRUCTION]: 0,
};
```

> The `VALIDATION_HEADER_BY_TYPE` string MUST exactly equal the header produced in Task 6 (`## Validate this Sentence Construction exercise`) — the mock matches on it.

- [ ] **Step 3: Create the generation fixture**

`packages/db/scripts/__fixtures__/claude-generation/sentence_construction.json` — the **tool input** object the mock returns (matches the tool schema from Task 2; the mock client typically wraps this — match the wrapping of the sibling `cloze.json`):

```json
{
  "instructions": "Write one sentence in Spanish.",
  "promptMode": "grammar_target",
  "prompt": "Write a sentence using the present subjunctive to express a wish for a friend.",
  "targetStructure": "present subjunctive",
  "register": "neutral",
  "modelAnswers": [
    "Espero que tengas un buen viaje.",
    "Ojalá apruebes el examen."
  ]
}
```

And the validation fixture `packages/db/scripts/__fixtures__/claude-validation/sentence_construction.json` (a `ValidationResult` — match the shape used by `cloze.json` in that directory):

```json
{
  "qualityScore": 0.9,
  "ambiguous": false,
  "contextSpoilsAnswer": false,
  "levelMatch": true,
  "grammarPointMatch": true,
  "culturalIssues": [],
  "flaggedReasons": []
}
```

> Copy the exact field set from the sibling validation fixture — if it omits `contextSpoilsAnswer` or names fields differently, match it.

- [ ] **Step 4: Build and typecheck to confirm the maps compile**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db typecheck`
Expected: PASS (maps complete).

- [ ] **Step 5: Commit**

```bash
git add packages/db/scripts/generate-exercises-mock-client.ts packages/db/scripts/__fixtures__/claude-generation/sentence_construction.json packages/db/scripts/__fixtures__/claude-validation/sentence_construction.json
git commit -m "feat(db): mock-client maps + fixtures for sentence construction"
```

---

## Task 15: Web component — SentenceConstructionExercise

**Files:**
- Create: `apps/web/app/(dashboard)/drill/_components/sentence-construction-exercise.tsx`
- Test: `apps/web/app/(dashboard)/drill/_components/__tests__/sentence-construction-exercise.test.tsx`

- [ ] **Step 1: Write the failing test**

Create the test (mirror `__tests__/translation-exercise.test.tsx` — grep it for the exact render/submit harness and `submission` shapes):

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { ExerciseType, type SentenceConstructionContent } from "@language-drill/shared";
import { SentenceConstructionExercise } from "../sentence-construction-exercise";

const content: SentenceConstructionContent = {
  type: ExerciseType.SENTENCE_CONSTRUCTION,
  instructions: "Write one sentence in Spanish.",
  promptMode: "keywords",
  prompt: "Use these words: ayer, biblioteca, libro.",
  keywords: ["ayer", "biblioteca", "libro"],
  modelAnswers: ["Ayer olvidé un libro en la biblioteca.", "Ayer fui a la biblioteca por un libro."],
};

function renderEx(submission = { kind: "idle" } as const, onSubmit = vi.fn()) {
  // Wrap in DrillActionProvider if the sibling tests do — copy their wrapper.
  return render(
    <SentenceConstructionExercise
      content={content}
      language="ES"
      submission={submission}
      onSubmit={onSubmit}
      onNext={vi.fn()}
    />,
  );
}

it("renders the prompt and keyword chips", () => {
  renderEx();
  expect(screen.getByText(/Use these words/)).toBeInTheDocument();
  expect(screen.getByText("ayer")).toBeInTheDocument();
});

it("submits the typed sentence", () => {
  const onSubmit = vi.fn();
  renderEx({ kind: "idle" }, onSubmit);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Ayer dejé un libro en la biblioteca." },
  });
  fireEvent.click(screen.getByRole("button", { name: /submit/i }));
  expect(onSubmit).toHaveBeenCalledWith("Ayer dejé un libro en la biblioteca.", expect.any(Object));
});

it("reveals a model answer on 'show an example'", () => {
  renderEx();
  fireEvent.click(screen.getByRole("button", { name: /show an example/i }));
  expect(screen.getByText(content.modelAnswers[0])).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- sentence-construction-exercise`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement the component**

Create `apps/web/app/(dashboard)/drill/_components/sentence-construction-exercise.tsx`, modeled on `translation-exercise.tsx` (reuse `Button`, `Card`, `Textarea`, `AccentPicker`, `FeedbackShell`, `useDrillAction`, `translationVerdict` — a pure score→tier mapping, not translation-specific — and the `SubmissionMeta`/`SubmissionState` types):

```tsx
'use client';

import * as React from 'react';
import type {
  EvaluationError,
  LearningLanguage,
  SentenceConstructionContent,
} from '@language-drill/shared';
import { AccentPicker, Button, Card, Textarea } from '../../../../components/ui';
import { translationVerdict } from '../../../../lib/drill/verdict-tier';
import { useDrillAction } from './drill-action-context';
import { FeedbackShell } from './feedback-shell';
import type { SubmissionMeta, SubmissionState } from './types';

export type { SubmissionMeta, SubmissionState } from './types';

export interface SentenceConstructionExerciseProps {
  content: SentenceConstructionContent;
  language: LearningLanguage;
  submission: SubmissionState;
  onSubmit: (answer: string, meta: SubmissionMeta) => void;
  onNext: () => void;
  nextLabel?: string;
}

function isAccentLanguage(lang: string): lang is 'ES' | 'DE' | 'TR' {
  return lang === 'ES' || lang === 'DE' || lang === 'TR';
}

const SEVERITY_COLOR: Record<EvaluationError['severity'], string> = {
  minor: 'text-ok',
  major: 'text-accent-2',
};

export function SentenceConstructionExercise({
  content,
  language,
  submission,
  onSubmit,
  onNext,
  nextLabel,
}: SentenceConstructionExerciseProps) {
  const [answer, setAnswer] = React.useState('');
  const [exampleShown, setExampleShown] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const isLocked = submission.kind !== 'idle';
  const showAccentPicker = isAccentLanguage(language);
  const canSubmit = answer.trim().length > 0;

  function handleSubmit() {
    if (!canSubmit || isLocked) return;
    // hintCount: count the example reveal as one hint for honest progress weighting.
    onSubmit(answer, { hintCount: exampleShown ? 1 : 0 });
  }

  const { active, setPrimaryAction } = useDrillAction();
  React.useEffect(() => {
    if (!active || submission.kind === 'evaluated') return;
    setPrimaryAction({
      label: 'submit',
      onClick: handleSubmit,
      disabled: !canSubmit || isLocked,
      loading: submission.kind === 'submitting',
    });
  }, [active, setPrimaryAction, submission.kind, canSubmit, isLocked, answer, exampleShown]);

  return (
    <div className="flex flex-col gap-s-4">
      <p className="t-micro text-ink-mute">sentence construction · {language}</p>

      <p className="t-display-s">{content.prompt}</p>

      {content.promptMode === 'keywords' && content.keywords && content.keywords.length > 0 && (
        <div className="flex flex-wrap gap-s-2">
          {content.keywords.map((kw) => (
            <span key={kw} className="t-small rounded-full bg-paper-2 px-s-3 py-s-1">
              {kw}
            </span>
          ))}
        </div>
      )}

      {(content.targetStructure || content.register) && (
        <p className="t-small text-ink-mute">
          {content.targetStructure ? `structure: ${content.targetStructure}` : ''}
          {content.targetStructure && content.register ? ' · ' : ''}
          {content.register ? `register: ${content.register}` : ''}
        </p>
      )}

      <div className="flex flex-col gap-s-3">
        <Textarea
          ref={textareaRef}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          readOnly={isLocked}
          disabled={isLocked}
          className={isLocked ? 'opacity-60' : undefined}
        />
        {showAccentPicker && (
          <AccentPicker language={language} targetRef={textareaRef} disabled={isLocked} />
        )}
      </div>

      {exampleShown && (
        <p className="t-small text-ink-mute">e.g. {content.modelAnswers[0]}</p>
      )}

      <div className="flex gap-s-3">
        {!exampleShown && (
          <Button variant="ghost" onClick={() => setExampleShown(true)} disabled={isLocked}>
            show an example
          </Button>
        )}
        {!active && (
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit || isLocked}
            loading={submission.kind === 'submitting'}
          >
            submit
          </Button>
        )}
      </div>

      {submission.kind === 'evaluated' &&
        (() => {
          const verdict = translationVerdict(submission.result.score);
          const errors = submission.result.errors ?? [];
          return (
            <FeedbackShell
              tier={verdict.tier}
              label={verdict.label}
              scoreChipText={`${Math.round(submission.result.score * 100)}%`}
              hintLevel={exampleShown ? 1 : 0}
              onNext={onNext}
              nextLabel={nextLabel}
            >
              <div className="flex flex-col gap-s-4">
                {errors.length > 0 && (
                  <ul className="flex flex-col gap-s-3">
                    {errors.map((err, idx) => {
                      if (
                        !err ||
                        typeof err.text !== 'string' ||
                        typeof err.correction !== 'string' ||
                        (err.severity !== 'minor' && err.severity !== 'major')
                      ) {
                        return null;
                      }
                      return (
                        <li key={idx} className="flex flex-col gap-s-1">
                          <div className="flex flex-wrap items-baseline gap-s-2">
                            <span className="line-through text-ink-mute">{err.text}</span>
                            <span aria-hidden="true" className="text-ink-mute">&rarr;</span>
                            <span className={SEVERITY_COLOR[err.severity]}>{err.correction}</span>
                          </div>
                          {err.explanation && (
                            <p className="t-small text-ink-mute">{err.explanation}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <Card padding="md" className="bg-paper-2">
                  <p className="t-micro text-ink-mute">example answers</p>
                  <ul className="mt-s-1 flex flex-col gap-s-1">
                    {content.modelAnswers.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </Card>
              </div>
            </FeedbackShell>
          );
        })()}
    </div>
  );
}
```

> Verify the exact import paths/props by diffing against `translation-exercise.tsx` (e.g. `drill-action-context` vs `useDrillAction` source path, the `Textarea`/`AccentPicker` barrel). If `translationVerdict` is not a clean score→tier function in `verdict-tier.ts`, use whichever exported score-based verdict the cloze component uses instead.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- sentence-construction-exercise`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/_components/sentence-construction-exercise.tsx" "apps/web/app/(dashboard)/drill/_components/__tests__/sentence-construction-exercise.test.tsx"
git commit -m "feat(web): SentenceConstructionExercise component"
```

---

## Task 16: Wire the component into the exercise pane

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/_components/exercise-pane.tsx`
- Test: covered by the component test + the full web suite (Task 19)

- [ ] **Step 1: Add the dispatch branch**

In `exercise-pane.tsx`, extend the import and add a branch before the final fallback:

```tsx
import {
  isClozeContent,
  isTranslationContent,
  isVocabRecallContent,
  isSentenceConstructionContent,
  type ExerciseContent,
  type LearningLanguage,
} from '@language-drill/shared';
import { SentenceConstructionExercise } from './sentence-construction-exercise';
```

```tsx
  if (isSentenceConstructionContent(content)) {
    return (
      <SentenceConstructionExercise
        key={exercise.id}
        content={content}
        language={language}
        submission={submission}
        onSubmit={onSubmit}
        onNext={onNext}
        nextLabel={nextLabel}
      />
    );
  }
```

- [ ] **Step 2: Typecheck + run the drill component tests**

Run: `pnpm --filter @language-drill/web test -- exercise-pane sentence-construction-exercise`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/_components/exercise-pane.tsx"
git commit -m "feat(web): dispatch sentence-construction in ExercisePane"
```

---

## Task 17: Debrief review-item card

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx`
- Test: `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/review-item-card.test.tsx`

- [ ] **Step 1: Read the sibling bodies, then write the failing test**

Read `review-item-card.tsx` fully to copy the `TranslationBody` props shape and the `item` type. Add a test mirroring the existing translation body test:

```tsx
it("renders a sentence-construction review item with the prompt and answer", () => {
  render(
    <ReviewItemCard
      item={{
        // copy the exact shape the sibling tests use (status, userAnswer, result…)
        status: "answered",
        exercise: {
          contentJson: {
            type: ExerciseType.SENTENCE_CONSTRUCTION,
            instructions: "Write one sentence in Spanish.",
            promptMode: "grammar_target",
            prompt: "Write a sentence using the present subjunctive.",
            targetStructure: "present subjunctive",
            modelAnswers: ["Espero que vengas.", "Ojalá llueva."],
          },
        },
        userAnswer: "Espero que viene.",
        result: { score: 0.6, errors: [] },
      } as never}
    />,
  );
  expect(screen.getByText(/present subjunctive/)).toBeInTheDocument();
  expect(screen.getByText("Espero que viene.")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- review-item-card`
Expected: FAIL — no body renders the new type (silent `null`).

- [ ] **Step 3: Add the body component + dispatch branch**

In `review-item-card.tsx`, add a `SentenceConstructionBody` modeled on the existing `TranslationBody` (same props: `{ item, content }`), rendering the prompt, the learner's answer, and the model answers. Then extend the conditional chain:

```tsx
) : isVocabRecallContent(content) ? (
  <VocabBody item={item} content={content} />
) : isSentenceConstructionContent(content) ? (
  <SentenceConstructionBody item={item} content={content} />
) : null}
```

Add the import of `isSentenceConstructionContent` and `type SentenceConstructionContent` to the existing `@language-drill/shared` import. The `SentenceConstructionBody` body (match the surrounding markup conventions of `TranslationBody`):

```tsx
function SentenceConstructionBody({
  item,
  content,
}: {
  item: ReviewItem; // use the exact item type the sibling bodies use
  content: SentenceConstructionContent;
}) {
  return (
    <div className="flex flex-col gap-s-2">
      <p className="t-small text-ink-mute">{content.prompt}</p>
      <p>{item.userAnswer}</p>
      <p className="t-micro text-ink-mute">
        e.g. {content.modelAnswers.join(' · ')}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- review-item-card`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx" "apps/web/app/(dashboard)/drill/debrief/_components/__tests__/review-item-card.test.tsx"
git commit -m "feat(web): debrief body for sentence construction"
```

---

## Task 18: End-to-end CLI generation smoke (mock client)

**Files:**
- Test: `packages/db/scripts/generate-exercises.test.ts`

- [ ] **Step 1: Write the failing test**

Add an integration case mirroring the existing mock-client generation test (grep `generate-exercises.test.ts` for `MOCK_CLAUDE` / how it invokes a cell run):

```ts
it("generates + validates a sentence_construction cell end-to-end (mock client)", async () => {
  // Reuse the file's existing harness to run one cell with MOCK_CLAUDE,
  // exerciseType: ExerciseType.SENTENCE_CONSTRUCTION, language es, level B1,
  // grammarPoint es-b1-present-subjunctive, count 2.
  const result = await runCellWithMock({
    language: "es",
    cefrLevel: "B1",
    exerciseType: ExerciseType.SENTENCE_CONSTRUCTION,
    grammarPointKey: "es-b1-present-subjunctive",
    count: 2,
  });
  expect(result.approvedCount).toBeGreaterThanOrEqual(1);
  expect(result.drafts.every((d) => d.contentJson.type === ExerciseType.SENTENCE_CONSTRUCTION)).toBe(true);
});
```

> Match the real harness exactly — the existing test already runs cloze/translation/vocab through the mock; copy its setup and just swap the type/grammar point. If the harness reads fixtures by type, Task 14's fixtures feed it.

- [ ] **Step 2: Run test to verify it fails (or surfaces a gap)**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- generate-exercises.test.ts -t "sentence_construction"`
Expected: FAIL first (harness/fixture wiring), then iterate until green.

- [ ] **Step 3: Make it pass**

Resolve whatever the harness needs (usually: the fixtures from Task 14 in the right place, and the `es-b1-present-subjunctive` point now carrying `sentenceConstructionSuitable`). No new product code should be required — if it is, the gap belongs in an earlier task; fix it there.

- [ ] **Step 4: Verify**

Run the same command as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/scripts/generate-exercises.test.ts
git commit -m "test(db): end-to-end sentence_construction generation via mock client"
```

---

## Task 19: Full-suite gate + cleanup

**Files:** none new — this is the pre-push gate from `CLAUDE.md`.

- [ ] **Step 1: Build everything**

Run: `pnpm build`
Expected: all packages build.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors. If any `Record<ExerciseType, …>` / `never` site still fails, it's an integration site the plan missed — add the entry (same pattern as Tasks 10–14) and note it.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: zero errors. Fix any unused-import or control-flow lint from the new switch cases.

- [ ] **Step 4: Full test suite (serial to avoid the known infra parallel flake)**

Run: `pnpm turbo run test --concurrency=1`
Expected: all green. Report `X passed, Y failed`; investigate any failure before proceeding.

- [ ] **Step 5: Commit any cleanup**

```bash
git add -A
git commit -m "chore: lint/typecheck cleanup for sentence construction"
```

---

## Self-review notes (already reconciled into the tasks above)

- **Spec coverage:** content shape (T1), generation tool+parser (T2–T3), mode variety + dedup (T4), eval prompt (T5), validation w/ model-answer check (T6), opt-in routing + flag + curated set (T7–T8), web component + dispatch + "show an example" (T15–T16), tests throughout. The spec's "no system-prompt edit → no version bump/Langfuse sync" is honored (confirmed: all per-type logic is in tool schemas + user prompts).
- **Blast-radius beyond the spec checklist:** the spec under-counted the cross-cutting `Record<ExerciseType,…>` compile-breakers (cell-targets, today-plan, timeline-labels, mock-client) and the runtime validators (cell-key regex, job-message set, resolve-cells) and the debrief body. Tasks 9–14 and 17 cover them. These don't change the design — they're the compiler's checklist.
- **Type consistency:** `promptMode` ∈ keywords|situation|grammar_target and `register` ∈ informal|neutral|formal are used identically in the content shape (T1), tool schema (T2), parser (T3), eval prompt (T5), validation prompt (T6), and component (T15). `modelAnswers` length 2–3 enforced once in the parser (T3) and asserted in tests. The mock validation header string (T14) is pinned equal to the validation builder header (T6).
- **Deferred (per spec, not gaps):** progressive-hint scoring weights, Error Correction (#5), broader curriculum flagging, per-mode pool tracking, Langfuse prompt registration of a sentence-construction-specific system prompt (intentionally avoided).
