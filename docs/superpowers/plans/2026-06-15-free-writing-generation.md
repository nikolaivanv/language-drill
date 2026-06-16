# Free-Writing Pre-Generation + Validation Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bulk-generate free-writing *prompts* per `(language, CEFR, topic)`, validate them, and land approved/flagged rows in the shared `exercises` pool — mirroring the dictation generation pipeline. Scope: Spanish (ES) only, B1 + B2. No audio.

**Architecture:** Each `(language, CEFR, topic)` is a curated `kind: 'free-writing'` curriculum umbrella → one `free_writing` cell. A dedicated generation-prompt / validation-prompt file pair plugs into the existing `runOneCell` + generator/validator/outcome pools + `generation_jobs` + `exercises` table + shared `routeValidationResult`. The model authors `title`/`task`/`requiredElements`/`topicHint`/`domain`/`instructions`; code injects `register` (from the topic entry) and the word band + suggested minutes (from a CEFR table). Type-routing (`isFreeWriting`) in `generate.ts` and `validate.ts` mirrors the existing `isDictation` branches.

**Tech Stack:** TypeScript, pnpm workspaces + Turborepo, Drizzle ORM, Anthropic Claude (`claude-sonnet-4-6`) with prompt caching, Langfuse-registered prompts with in-repo fallback, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-15-free-writing-generation-design.md`

**Today's date (for version constants):** `2026-06-15`

---

## Background the engineer needs

- **`ExerciseType.FREE_WRITING = "free_writing"`** already exists (`packages/shared/src/index.ts:85`), as does the `FreeWritingContent` shape (`packages/shared/src/index.ts:193-209`) and `FreeWritingRequiredElement` (`:184-191`). We are adding only the *generation* side; the serve/render/eval paths are untouched.
- The dictation pipeline (commit `2f7fce1`) is the template. Read these before starting:
  - `packages/ai/src/dictation-generation-prompts.ts`
  - `packages/ai/src/dictation-validation-prompts.ts`
  - `packages/ai/src/generate.ts` (`DICTATION_GENERATION_TOOL`, `parseGeneratedDictationDraft`, `generateOneDraft`'s `isDictation` branch)
  - `packages/ai/src/validate.ts` (`isDictation` branch)
  - `packages/db/src/curriculum/es.ts` (the two `kind: 'dictation'` entries near the end)
- **`runOneCell` requires a `skill_topics` row per curriculum key** (`run-one-cell.ts:417-435`). `planSkillTopics(ALL_CURRICULA)` (`seed-exercises.ts:749`) maps over *every* curriculum entry regardless of `kind`, so adding free-writing entries automatically creates their skill-topic rows the next time `pnpm db:seed:exercises` runs. No seed-script change is required; the only operational dependency is "run the seed before generating" (already documented for dictation).
- **`canonicalSurface` throws for `FREE_WRITING`** today (`generation-prompts.ts:529-532`) — Task 4 replaces that throw.
- **`TOOL_NAME_BY_TYPE` / `GENERATION_TOOL_BY_TYPE`** are typed `Record<Exclude<ExerciseType, ExerciseType.FREE_WRITING>, …>` (`generate.ts:84-92`, `:362-370`). Task 4 widens both to the full `Record<ExerciseType, …>` and adds the `free_writing` entry. `validateDraft`'s guard (`validate.ts:361`) keys off this map, so widening it is what lets free-writing drafts through validation.
- **`CELL_KEY_REGEX`** (`packages/db/src/lib/cell-key.ts:22`) enumerates exercise types and omits `free_writing`. Task 6 adds it.
- **Local checks:** run from repo root. The worktree is `.claude/worktrees/feat-free-writing-generation` on branch `feat-free-writing-generation`. Per memory, the real test gate is `pnpm turbo run test --concurrency=1` (the parallel `pnpm test` flakes on `infra`, and a package `tsc` can pass while a `*.test.ts` references removed symbols).
- **Per-package builds:** after editing `packages/shared` or `packages/db` *source*, run `pnpm build` (turbo) before a single-package vitest run, or the consumer resolves stale `dist` (memory: vitest-workspace-dist-resolution).

---

## File Structure

**New files:**
- `packages/ai/src/free-writing-generation-prompts.ts` — generation system/user prompt builders, `FREE_WRITING_GENERATION_PROMPT_VERSION`, the CEFR→length table.
- `packages/ai/src/free-writing-generation-prompts.test.ts`
- `packages/ai/src/free-writing-validation-prompts.ts` — validation system/user prompt builders, `FREE_WRITING_GENERATION_VALIDATION_PROMPT_VERSION`.
- `packages/ai/src/free-writing-validation-prompts.test.ts`

**Modified files:**
- `packages/shared/src/curriculum-types.ts` — `kind` union + `freeWriting` field.
- `packages/ai/src/generate.ts` — tool, parser, dispatch, map widening.
- `packages/ai/src/generation-prompts.ts` — `canonicalSurface` free-writing case.
- `packages/ai/src/validate.ts` — `isFreeWriting` dispatch.
- `packages/ai/src/index.ts` — re-export new constants/builders.
- `packages/ai/scripts/bootstrap-prompts.ts` — two `PROMPTS` manifest entries.
- `packages/db/src/lib/cell-key.ts` — regex.
- `packages/db/src/generation/cells.ts` — `compatibleTypes` routing.
- `packages/db/src/curriculum/es.ts` — topic entries + `CURRICULUM_VERSION_ES` bump.
- `infra/lambda/src/generation/cell-targets.ts` — `FREE_WRITING` targets.
- `CLAUDE.md` — two rows in the Prompt-Editing version table.
- Existing test files: `generate.test.ts`, `validate.test.ts`, `cells.test.ts`, `cell-key.test.ts`, `cell-targets.test.ts` (add cases; do not create orphans).

---

## Task 1: Shared types — `free-writing` kind + `freeWriting` field

**Files:**
- Modify: `packages/shared/src/curriculum-types.ts:49` (the `kind` union) and the `GrammarPoint` body (after `coverageSpec`, ~`:104`)
- Test: `packages/db/src/curriculum/curriculum.test.ts` (invariants exercise this in Task 7; no standalone type test needed)

- [ ] **Step 1: Widen the `kind` union**

In `packages/shared/src/curriculum-types.ts`, change:

```typescript
  kind: 'grammar' | 'vocab' | 'dictation';
```
to:
```typescript
  kind: 'grammar' | 'vocab' | 'dictation' | 'free-writing';
```

- [ ] **Step 2: Add the `freeWriting` optional field**

Immediately after the `coverageSpec?: CoverageSpec;` line (before the closing `}>;`), add:

```typescript
  /**
   * Free-writing topic config (Phase 2). REQUIRED in practice on every
   * `kind: 'free-writing'` umbrella and meaningless on any other kind: it carries
   * the author-declared register the generated prompt must target. The word band
   * + suggested minutes are NOT stored here — they are derived from the cell's
   * CEFR level via `FREE_WRITING_LENGTH_BY_CEFR` in
   * `packages/ai/src/free-writing-generation-prompts.ts`. Enforced by a curriculum
   * invariant (Task 7): present iff `kind === 'free-writing'`.
   */
  freeWriting?: { register: 'informal' | 'neutral' | 'formal' };
```

- [ ] **Step 3: Extend the doc comment on the `kind` discriminator**

In the block comment above `GrammarPoint` (the bullet list of kinds, ~`:30-44`), add a bullet after the `'dictation'` one:

```typescript
 *   - `'free-writing'` — a curated `(language, level, topic)` umbrella that owns
 *     ONE free-writing generation cell. Carries no grammar-point semantics; its
 *     name/description/examples frame the topic for the generation prompt, and its
 *     `freeWriting.register` sets the target register. Paired only with
 *     `ExerciseType.FREE_WRITING` by `compatibleTypes()`. No `coverageSpec`.
```

- [ ] **Step 4: Build shared so downstream packages resolve the new type**

Run: `pnpm --filter @language-drill/shared build`
Expected: exits 0, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/curriculum-types.ts
git commit -m "feat(free-writing): add 'free-writing' curriculum kind + register field"
```

---

## Task 2: Generation prompt module

**Files:**
- Create: `packages/ai/src/free-writing-generation-prompts.ts`
- Test: `packages/ai/src/free-writing-generation-prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/free-writing-generation-prompts.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { CefrLevel, ExerciseType, Language, type GrammarPoint } from "@language-drill/shared";
import {
  FREE_WRITING_GENERATION_PROMPT_VERSION,
  FREE_WRITING_LENGTH_BY_CEFR,
  computeFreeWritingGenerationPromptVars,
  buildFreeWritingGenerationUserPrompt,
} from "./free-writing-generation-prompts.js";
import type { GenerationPromptInputs } from "./generation-prompts.js";

const TOPIC: GrammarPoint = {
  key: "es-b2-fw-remote-work",
  kind: "free-writing",
  name: "El teletrabajo: ¿avance o aislamiento?",
  description: "Opinion essay weighing the benefits and drawbacks of remote work.",
  cefrLevel: CefrLevel.B2,
  language: Language.ES,
  examplesPositive: ["Argues a clear thesis with two supporting reasons.", "Asks for a concession paragraph."],
  examplesNegative: ["*Write anything you want about work."],
  commonErrors: ["Prompt is too open to score."],
  freeWriting: { register: "formal" },
};

const INPUTS: GenerationPromptInputs = {
  language: Language.ES,
  cefrLevel: CefrLevel.B2,
  exerciseType: ExerciseType.FREE_WRITING,
  grammarPoint: TOPIC,
};

describe("free-writing generation prompt", () => {
  it("pins a dated version tag", () => {
    expect(FREE_WRITING_GENERATION_PROMPT_VERSION).toMatch(/^free-writing-generate@\d{4}-\d{2}-\d{2}$/);
  });

  it("derives the word band from the CEFR level", () => {
    expect(FREE_WRITING_LENGTH_BY_CEFR.B2).toEqual({ minWords: 150, maxWords: 200, suggestedMinutes: 25 });
  });

  it("injects topic, register and band into the prompt vars", () => {
    const vars = computeFreeWritingGenerationPromptVars(INPUTS);
    expect(vars.register).toBe("formal");
    expect(vars.minWords).toBe("150");
    expect(vars.maxWords).toBe("200");
    expect(vars.topicName).toBe(TOPIC.name);
    expect(vars.toolName).toBe("submit_free_writing_exercise");
  });

  it("throws when the cell is not a free-writing cell", () => {
    expect(() =>
      computeFreeWritingGenerationPromptVars({ ...INPUTS, exerciseType: ExerciseType.CLOZE }),
    ).toThrow(/non-free-writing/);
  });

  it("throws when the topic entry has no register", () => {
    const noReg = { ...INPUTS, grammarPoint: { ...TOPIC, freeWriting: undefined } };
    expect(() => computeFreeWritingGenerationPromptVars(noReg)).toThrow(/register/);
  });

  it("user prompt names the ordinal and asks for variety", () => {
    const p = buildFreeWritingGenerationUserPrompt(INPUTS, 2);
    expect(p).toContain("#3");
    expect(p).toContain("submit_free_writing_exercise");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- free-writing-generation-prompts`
Expected: FAIL — `Cannot find module './free-writing-generation-prompts.js'`.

- [ ] **Step 3: Write the module**

Create `packages/ai/src/free-writing-generation-prompts.ts`:

```typescript
/**
 * packages/ai — Generation prompt for free-writing prompts.
 *
 * Distinct from generation-prompts.ts (cloze/translation/vocab/SC) and
 * dictation-generation-prompts.ts. A free-writing "draft" is an open-ended
 * writing PROMPT (title + task + a short checklist of required elements) the
 * learner answers in a paragraph — there is no blank and no single answer. Each
 * (language, CEFR, topic) is its own cell, so the topic framing lives in the
 * cached system prompt (the curriculum entry's name/description/examples). The
 * model authors title/task/requiredElements/topicHint/domain/instructions; the
 * register comes from the topic entry and the word band from the CEFR table —
 * both injected by code in parseGeneratedFreeWritingDraft (see generate.ts).
 *
 * Flat-string `{{var}}` template (Langfuse-registered as
 * `free-writing-generate-system-prompt`), substituted by both `applyTemplate`
 * (fallback) and Langfuse `compile(vars)`.
 */

import {
  ExerciseType,
  type CurriculumCefrLevel,
} from "@language-drill/shared";

import { CEFR_LEVEL_DESCRIPTORS } from "./prompts.js";
import type { GenerationPromptInputs } from "./generation-prompts.js";
import { getPromptWithVarsOrFallback } from "./prompts-registry.js";

// Bump in the same commit as any semantic edit to the template below.
export const FREE_WRITING_GENERATION_PROMPT_VERSION = "free-writing-generate@2026-06-15";

/**
 * CEFR → word band + suggested minutes for a free-writing prompt. Single source
 * for both the prompt text and the band injected into the stored
 * FreeWritingContent. Only B1/B2 are in scope this milestone; an out-of-scope
 * level throws in `freeWritingLengthFor`.
 */
export const FREE_WRITING_LENGTH_BY_CEFR: Readonly<
  Partial<Record<CurriculumCefrLevel, { minWords: number; maxWords: number; suggestedMinutes: number }>>
> = Object.freeze({
  B1: { minWords: 80, maxWords: 120, suggestedMinutes: 15 },
  B2: { minWords: 150, maxWords: 200, suggestedMinutes: 25 },
});

export function freeWritingLengthFor(
  cefrLevel: string,
): { minWords: number; maxWords: number; suggestedMinutes: number } {
  const band = FREE_WRITING_LENGTH_BY_CEFR[cefrLevel as CurriculumCefrLevel];
  if (!band) {
    throw new Error(
      `free-writing: no length band configured for CEFR level ${JSON.stringify(cefrLevel)} (B1/B2 only this milestone)`,
    );
  }
  return band;
}

const CEFR_DESCRIPTOR_BULLETS = (
  Object.entries(CEFR_LEVEL_DESCRIPTORS) as [string, string][]
)
  .map(([level, descriptor]) => `- **${level}**: ${descriptor}`)
  .join("\n");

function renderBulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

export const FREE_WRITING_GENERATION_SYSTEM_PROMPT = `You are an expert author of free-writing prompts for {{language}} learners at CEFR {{cefrLevel}}. Produce ONE open-ended writing prompt the learner answers in a single paragraph of {{minWords}}–{{maxWords}} {{language}} words. The target register is {{register}}.

## Topic for this prompt

**{{topicName}}** — {{topicDescription}}

## What a good prompt for this topic looks like

{{positiveExamplesBullets}}

## Avoid

{{negativeExamplesBullets}}

## Common authoring mistakes to avoid

{{commonErrorsBullets}}

## CEFR level descriptors

{{cefrDescriptors}}

## Hard constraints

- **Self-contained, scorable task.** The \`task\` MUST tell the learner exactly what to write so a competent {{cefrLevel}} learner knows when they are done. It MUST stay on the topic above and be answerable in {{minWords}}–{{maxWords}} words at the {{register}} register. NOT a vague "write about X".
- **Required elements (2–4).** Provide a short checklist (\`requiredElements\`) of 2–4 concrete, observable things the answer must contain (e.g. "state your opinion in the first sentence", "give two reasons", "use at least one concessive connector"). Each must be realistic at {{cefrLevel}} and genuinely checkable — not impossibly many, not trivially one, not self-contradictory. Write each \`label\` in {{language}}; an optional \`detail\` may add a one-line hint.
- **Do not write the answer.** The prompt frames the task; it MUST NOT contain a model paragraph or hand the learner sentences to copy.
- **Vocabulary band.** Keep the wording of the prompt itself at or below CEFR {{cefrLevel}} everyday {{language}}.
- **Safe, neutral framing.** Avoid weapons, substances, violence, and culturally sensitive or stereotyping angles.
- **One prompt per tool call.** Do not batch multiple prompts.
- You MUST use the {{toolName}} tool. Do not return plain text.

## Output

Use the {{toolName}} tool with all required fields populated. Do not set register or word counts — those are fixed by the system.`;

export function computeFreeWritingGenerationPromptVars(
  inputs: GenerationPromptInputs,
): Record<string, string> {
  if (inputs.exerciseType !== ExerciseType.FREE_WRITING) {
    throw new Error(
      "computeFreeWritingGenerationPromptVars: non-free-writing cell routed to the free-writing prompt",
    );
  }
  const { language, cefrLevel, grammarPoint } = inputs;
  const register = grammarPoint.freeWriting?.register;
  if (!register) {
    throw new Error(
      `computeFreeWritingGenerationPromptVars: topic entry ${grammarPoint.key} has no freeWriting.register`,
    );
  }
  const band = freeWritingLengthFor(cefrLevel);
  return {
    language,
    cefrLevel,
    register,
    minWords: String(band.minWords),
    maxWords: String(band.maxWords),
    topicName: grammarPoint.name,
    topicDescription: grammarPoint.description,
    positiveExamplesBullets: renderBulletList(grammarPoint.examplesPositive),
    negativeExamplesBullets: renderBulletList(grammarPoint.examplesNegative),
    commonErrorsBullets: renderBulletList(grammarPoint.commonErrors),
    cefrDescriptors: CEFR_DESCRIPTOR_BULLETS,
    toolName: "submit_free_writing_exercise",
  };
}

export async function buildFreeWritingGenerationSystemPrompt(
  inputs: GenerationPromptInputs,
): Promise<string> {
  const vars = computeFreeWritingGenerationPromptVars(inputs);
  const { text } = await getPromptWithVarsOrFallback(
    "free-writing-generate-system-prompt",
    FREE_WRITING_GENERATION_SYSTEM_PROMPT,
    FREE_WRITING_GENERATION_PROMPT_VERSION,
    vars,
  );
  return text;
}

export function buildFreeWritingGenerationUserPrompt(
  inputs: GenerationPromptInputs,
  ordinal: number,
): string {
  return `Produce free-writing prompt #${ordinal + 1}.

Vary the angle, the exact task, and the required-elements checklist from prompt to prompt so a batch on this topic is diverse (different sub-focus, different things the learner must include). Use the submit_free_writing_exercise tool.`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- free-writing-generation-prompts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/free-writing-generation-prompts.ts packages/ai/src/free-writing-generation-prompts.test.ts
git commit -m "feat(free-writing): generation prompt builder + CEFR length table"
```

---

## Task 3: Generation tool + parser + dispatch in `generate.ts`

**Files:**
- Modify: `packages/ai/src/generate.ts` (imports, `TOOL_NAME_BY_TYPE`, `GENERATION_TOOL_BY_TYPE`, new tool, new parser, `generateOneDraft`, `parseToolInput`)
- Modify: `packages/ai/src/generation-prompts.ts:529-532` (`canonicalSurface`)
- Test: `packages/ai/src/generate.test.ts` (add a `parseGeneratedFreeWritingDraft` block)

- [ ] **Step 1: Write the failing test**

Append to `packages/ai/src/generate.test.ts` (inside the top-level `describe` or as a new `describe`):

```typescript
import { parseGeneratedFreeWritingDraft, type GenerationSpec } from "./generate.js";

describe("parseGeneratedFreeWritingDraft", () => {
  const TOPIC = {
    key: "es-b2-fw-remote-work",
    kind: "free-writing" as const,
    name: "El teletrabajo",
    description: "Opinion essay on remote work.",
    cefrLevel: CefrLevel.B2,
    language: Language.ES,
    examplesPositive: ["a", "b"],
    examplesNegative: ["*c"],
    commonErrors: ["d"],
    freeWriting: { register: "formal" as const },
  };
  const spec: GenerationSpec = {
    language: Language.ES,
    cefrLevel: CefrLevel.B2,
    exerciseType: ExerciseType.FREE_WRITING,
    grammarPoint: TOPIC,
    topicDomain: null,
    count: 1,
    batchSeed: "test",
  };
  const validInput = {
    instructions: "Escribe un párrafo.",
    title: "El teletrabajo: ¿avance o aislamiento?",
    task: "Da tu opinión sobre el teletrabajo y justifícala con dos razones.",
    domain: "opinión · argumentación",
    requiredElements: [
      { id: "thesis", label: "Expón tu opinión en la primera frase." },
      { id: "reasons", label: "Da dos razones.", detail: "una a favor, una en contra" },
    ],
    topicHint: "trabajo",
  };

  it("injects register + CEFR band and keeps model-authored fields", () => {
    const content = parseGeneratedFreeWritingDraft(validInput, spec);
    expect(content.type).toBe(ExerciseType.FREE_WRITING);
    expect(content.register).toBe("formal");
    expect(content.minWords).toBe(150);
    expect(content.maxWords).toBe(200);
    expect(content.suggestedMinutes).toBe(25);
    expect(content.title).toBe(validInput.title);
    expect(content.requiredElements).toHaveLength(2);
    expect(content.requiredElements[1].detail).toBe("una a favor, una en contra");
    expect(content.topicHint).toBe("trabajo");
  });

  it("rejects an empty requiredElements list", () => {
    expect(() =>
      parseGeneratedFreeWritingDraft({ ...validInput, requiredElements: [] }, spec),
    ).toThrow(/requiredElements/);
  });

  it("rejects a required element missing its label", () => {
    expect(() =>
      parseGeneratedFreeWritingDraft(
        { ...validInput, requiredElements: [{ id: "x" }] },
        spec,
      ),
    ).toThrow(/label/);
  });

  it("throws when the topic entry has no register", () => {
    const noReg = { ...spec, grammarPoint: { ...TOPIC, freeWriting: undefined } };
    expect(() => parseGeneratedFreeWritingDraft(validInput, noReg)).toThrow(/register/);
  });
});
```

(Ensure `CefrLevel`, `ExerciseType`, `Language` are imported at the top of `generate.test.ts` — they already are if the file tests other parsers; add any that are missing.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- generate`
Expected: FAIL — `parseGeneratedFreeWritingDraft` is not exported.

- [ ] **Step 3: Add the import in `generate.ts`**

After the dictation prompt import (`generate.ts:38-41`), add:

```typescript
import {
  buildFreeWritingGenerationSystemPrompt,
  buildFreeWritingGenerationUserPrompt,
  freeWritingLengthFor,
} from "./free-writing-generation-prompts.js";
```

Also add `type FreeWritingContent` and `type FreeWritingRequiredElement` to the existing `@language-drill/shared` import block (`generate.ts:16-29`).

- [ ] **Step 4: Widen the tool-name + tool maps and add the free-writing tool**

Replace `TOOL_NAME_BY_TYPE` (`generate.ts:84-92`) and its comment with:

```typescript
// DICTATION and FREE_WRITING are both batch-generated now. (Free-writing prompts
// are drafted + validated here; they have no audio step.)
export const TOOL_NAME_BY_TYPE: Readonly<Record<ExerciseType, string>> = Object.freeze({
  cloze: "submit_cloze_exercise",
  translation: "submit_translation_exercise",
  vocab_recall: "submit_vocab_recall_exercise",
  sentence_construction: "submit_sentence_construction_exercise",
  dictation: "submit_dictation_exercise",
  free_writing: "submit_free_writing_exercise",
});
```

After `DICTATION_GENERATION_TOOL` (ends `generate.ts:357`), add the free-writing tool:

```typescript
export const FREE_WRITING_GENERATION_TOOL: Anthropic.Tool = {
  name: "submit_free_writing_exercise",
  description:
    "Submit a single free-writing prompt: an open-ended writing task the learner answers in one paragraph. Do not set register or word counts — those are fixed by the system.",
  input_schema: {
    type: "object" as const,
    properties: {
      instructions: {
        type: "string",
        description:
          "Short imperative telling the learner what to do (e.g. 'Escribe un párrafo respondiendo a la pregunta.').",
      },
      title: {
        type: "string",
        description: "Short headline for the prompt card (e.g. 'El teletrabajo: ¿avance o aislamiento?').",
      },
      task: {
        type: "string",
        description:
          "The task statement shown to the learner: exactly what to write, on the configured topic, answerable in the configured word band.",
      },
      domain: {
        type: "string",
        description: "Topic-domain label for the card (e.g. 'opinión · argumentación').",
      },
      requiredElements: {
        type: "array",
        description: "2–4 concrete, checkable things the answer must contain.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Stable slug id (e.g. 'thesis', 'reasons')." },
            label: { type: "string", description: "What the learner must do, in the target language." },
            detail: { type: "string", description: "Optional one-line hint on how to satisfy it." },
          },
          required: ["id", "label"],
        },
      },
      topicHint: {
        type: "string",
        description: "Optional one-word topical theme (e.g. 'trabajo', 'viajes').",
      },
    },
    required: ["instructions", "title", "task", "domain", "requiredElements"],
  },
};
```

Replace `GENERATION_TOOL_BY_TYPE` (`generate.ts:362-370`) and its comment with:

```typescript
// DICTATION and FREE_WRITING are both batch-generated (see TOOL_NAME_BY_TYPE).
export const GENERATION_TOOL_BY_TYPE: Readonly<Record<ExerciseType, Anthropic.Tool>> = Object.freeze({
  cloze: CLOZE_GENERATION_TOOL,
  translation: TRANSLATION_GENERATION_TOOL,
  vocab_recall: VOCAB_RECALL_GENERATION_TOOL,
  sentence_construction: SENTENCE_CONSTRUCTION_GENERATION_TOOL,
  dictation: DICTATION_GENERATION_TOOL,
  free_writing: FREE_WRITING_GENERATION_TOOL,
});
```

- [ ] **Step 5: Add the parser**

After `parseGeneratedDictationDraft` (ends `generate.ts:838`), add:

```typescript
/** Parses the requiredElements array from a free-writing tool input. */
function parseRequiredElements(
  raw: Record<string, unknown>,
  ctx: string,
): FreeWritingRequiredElement[] {
  const v = raw["requiredElements"];
  if (!Array.isArray(v) || v.length === 0) {
    throw new Error(`${ctx}: invalid requiredElements: must be a non-empty array`);
  }
  return v.map((el, i): FreeWritingRequiredElement => {
    if (!isObject(el)) {
      throw new Error(`${ctx}: invalid requiredElements[${i}]: must be an object`);
    }
    const id = requireString(el, "id", `${ctx}.requiredElements[${i}]`);
    const label = requireString(el, "label", `${ctx}.requiredElements[${i}]`);
    const detail = optionalString(el, "detail", `${ctx}.requiredElements[${i}]`);
    return { id, label, ...(detail !== undefined ? { detail } : {}) };
  });
}

export function parseGeneratedFreeWritingDraft(
  input: unknown,
  spec: GenerationSpec,
): FreeWritingContent {
  const ctx = "free_writing draft";
  if (!isObject(input)) {
    throw new Error(`${ctx}: must be an object, got ${typeof input}`);
  }
  const register = spec.grammarPoint.freeWriting?.register;
  if (!register) {
    throw new Error(`${ctx}: topic entry ${spec.grammarPoint.key} has no freeWriting.register`);
  }
  const band = freeWritingLengthFor(spec.cefrLevel);

  const instructions = requireString(input, "instructions", ctx);
  const title = requireString(input, "title", ctx);
  const task = requireString(input, "task", ctx);
  const domain = requireString(input, "domain", ctx);
  const requiredElements = parseRequiredElements(input, ctx);
  const topicHint = optionalString(input, "topicHint", ctx);

  return {
    type: ExerciseType.FREE_WRITING,
    instructions,
    title,
    task,
    domain,
    register,
    minWords: band.minWords,
    maxWords: band.maxWords,
    suggestedMinutes: band.suggestedMinutes,
    requiredElements,
    ...(topicHint !== undefined ? { topicHint } : {}),
  };
}
```

- [ ] **Step 6: Wire dispatch in `generateOneDraft`**

In `generateOneDraft`, replace the `isDictation` block (`generate.ts:923-939`) with:

```typescript
  const isDictation = spec.exerciseType === ExerciseType.DICTATION;
  const isFreeWriting = spec.exerciseType === ExerciseType.FREE_WRITING;

  const systemText =
    spec.systemPromptOverride ??
    (isDictation
      ? await buildDictationGenerationSystemPrompt(promptInputs)
      : isFreeWriting
        ? await buildFreeWritingGenerationSystemPrompt(promptInputs)
        : await buildGenerationSystemPrompt(promptInputs, []));

  const userText = isDictation
    ? buildDictationGenerationUserPrompt(promptInputs, ordinal, spec.topicDomain)
    : isFreeWriting
      ? buildFreeWritingGenerationUserPrompt(promptInputs, ordinal)
      : buildGenerationUserPrompt(
          promptInputs,
          ordinal,
          spec.topicDomain,
          spec.seedWords?.[ordinal] ?? null,
          spec.coverageTargets,
        );
```

Then replace the parse line (`generate.ts:986-988`) with:

```typescript
    content = isDictation
      ? parseGeneratedDictationDraft(toolUseBlock.input, spec, ordinal)
      : isFreeWriting
        ? parseGeneratedFreeWritingDraft(toolUseBlock.input, spec)
        : parseToolInput(toolUseBlock.input, spec);
```

- [ ] **Step 7: Make `parseToolInput`'s free-writing case explicit**

In `parseToolInput` (`generate.ts:1091-1116`), add a case before `default`:

```typescript
    case ExerciseType.FREE_WRITING:
      // Unreachable: generateOneDraft routes free_writing to
      // parseGeneratedFreeWritingDraft before reaching parseToolInput. Defensive.
      throw new Error(
        "Free-writing exercises are parsed via parseGeneratedFreeWritingDraft, not parseToolInput.",
      );
```

- [ ] **Step 8: Replace the `canonicalSurface` throw for free-writing**

In `packages/ai/src/generation-prompts.ts`, replace the `FREE_WRITING` case (`:529-532`):

```typescript
    case ExerciseType.FREE_WRITING:
      // The prompt title is the dedup surface (drives `_dedupKey` and in-batch
      // duplicate detection) — two prompts on the same topic must differ in title.
      return normaliseSurface(content.title);
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- generate`
Expected: PASS, including the four new `parseGeneratedFreeWritingDraft` tests and all existing ones.

- [ ] **Step 10: Commit**

```bash
git add packages/ai/src/generate.ts packages/ai/src/generation-prompts.ts packages/ai/src/generate.test.ts
git commit -m "feat(free-writing): generation tool, draft parser, dispatch + dedup surface"
```

---

## Task 4: Validation prompt module + dispatch

**Files:**
- Create: `packages/ai/src/free-writing-validation-prompts.ts`
- Create: `packages/ai/src/free-writing-validation-prompts.test.ts`
- Modify: `packages/ai/src/validate.ts` (import + `isFreeWriting` dispatch)
- Test: `packages/ai/src/validate.test.ts` (add a dispatch assertion)

- [ ] **Step 1: Write the failing test for the prompt module**

Create `packages/ai/src/free-writing-validation-prompts.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { CefrLevel, ExerciseType, Language, type FreeWritingContent } from "@language-drill/shared";
import {
  FREE_WRITING_GENERATION_VALIDATION_PROMPT_VERSION,
  computeFreeWritingValidationPromptVars,
  buildFreeWritingValidationUserPrompt,
} from "./free-writing-validation-prompts.js";
import type { GenerationSpec } from "./generate.js";

const spec: GenerationSpec = {
  language: Language.ES,
  cefrLevel: CefrLevel.B2,
  exerciseType: ExerciseType.FREE_WRITING,
  grammarPoint: {
    key: "es-b2-fw-remote-work",
    kind: "free-writing",
    name: "El teletrabajo",
    description: "Opinion essay.",
    cefrLevel: CefrLevel.B2,
    language: Language.ES,
    examplesPositive: ["a", "b"],
    examplesNegative: ["*c"],
    commonErrors: ["d"],
    freeWriting: { register: "formal" },
  },
  topicDomain: null,
  count: 1,
  batchSeed: "t",
};

const content: FreeWritingContent = {
  type: ExerciseType.FREE_WRITING,
  instructions: "Escribe un párrafo.",
  title: "El teletrabajo",
  task: "Da tu opinión.",
  domain: "opinión",
  register: "formal",
  minWords: 150,
  maxWords: 200,
  suggestedMinutes: 25,
  requiredElements: [{ id: "thesis", label: "Expón tu opinión." }],
};

describe("free-writing validation prompt", () => {
  it("pins a dated version tag", () => {
    expect(FREE_WRITING_GENERATION_VALIDATION_PROMPT_VERSION).toMatch(
      /^free-writing-validate@\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("system vars carry language + level", () => {
    const vars = computeFreeWritingValidationPromptVars(spec);
    expect(vars.language).toBe("ES");
    expect(vars.cefrLevel).toBe("B2");
  });

  it("user prompt states the expected register and band + fixed-field reminder", () => {
    const p = buildFreeWritingValidationUserPrompt(content, spec);
    expect(p).toContain("formal");
    expect(p).toContain("150");
    expect(p).toContain("200");
    expect(p).toContain("grammarPointMatch=true");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- free-writing-validation-prompts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the validation prompt module**

Create `packages/ai/src/free-writing-validation-prompts.ts`:

```typescript
/**
 * packages/ai — Validation prompt for generated free-writing PROMPTS.
 *
 * Distinct from validation-prompts.ts (cloze/SC: ambiguous blank, spoiled
 * answer) and free-writing-prompts.ts (which GRADES a learner's paragraph). This
 * validates the generated prompt itself: is the task clear, scorable, achievable
 * at the CEFR level in the word band, with realistic required elements at the
 * declared register? It reuses the shared `submit_validation_result` tool and
 * `routeValidationResult` unchanged: the model sets ambiguous=false,
 * contextSpoilsAnswer=false, grammarPointMatch=true, leaves coverage empty, and
 * sets levelMatch + qualityScore per the rubric.
 */

import { type FreeWritingContent } from "@language-drill/shared";

import { CEFR_LEVEL_DESCRIPTORS } from "./prompts.js";
import type { GenerationSpec } from "./generate.js";
import { freeWritingLengthFor } from "./free-writing-generation-prompts.js";
import { getPromptWithVarsOrFallback } from "./prompts-registry.js";

export const FREE_WRITING_GENERATION_VALIDATION_PROMPT_VERSION =
  "free-writing-validate@2026-06-15";

const CEFR_DESCRIPTOR_BULLETS = (
  Object.entries(CEFR_LEVEL_DESCRIPTORS) as [string, string][]
)
  .map(([level, descriptor]) => `- **${level}**: ${descriptor}`)
  .join("\n");

export const FREE_WRITING_GENERATION_VALIDATION_SYSTEM_PROMPT = `You are a strict reviewer of free-writing PROMPTS for {{language}} learners at CEFR {{cefrLevel}}. You validate ONE already-generated prompt: an open-ended writing task (title + task + a checklist of required elements) the learner will answer in a single paragraph. You are NOT grading a learner answer — you judge whether the prompt itself is good.

Be conservative. A flagged prompt costs a human ~30 seconds of review; an auto-approved bad prompt wastes the learner's time.

## Routing implication of your scores

- qualityScore < 0.5  OR  any cultural issue  → REJECTED (dropped, not stored)
- qualityScore in [0.5, 0.7)                  → FLAGGED (waits for human review)
- qualityScore >= 0.7 AND levelMatch          → AUTO-APPROVED (shown to learners)
- otherwise                                    → FLAGGED

## CEFR level descriptors

{{cefrDescriptors}}

## What to score

1. **qualityScore** (0.0–1.0): overall fitness as a {{cefrLevel}} free-writing prompt. Judge:
   - **Clarity & scorability** — does \`task\` say exactly what to write, so a learner knows when they are done? Vague "write about X" → lower.
   - **Achievability for level + band** — answerable at {{cefrLevel}} within the stated word band, at the stated register.
   - **Required elements** — 2–4 concrete, checkable items, realistic at level; not impossibly many, not trivially one, not self-contradictory, not off-topic.
   - **Register match** — the task wording fits the stated register.
   - **Does not write the answer** — no model paragraph or copyable sentences.
   Anchors: 0.9 publishable as-is; 0.8 one cosmetic edit; 0.65 borderline (FLAGGED); 0.5 unusable (REJECTED).
2. **levelMatch** (boolean): does the prompt's demand sit at {{cefrLevel}}?
3. **culturalIssues** (array): stereotyping, sensitive or unsafe framing. Non-empty → REJECTED.
4. **flaggedReasons** (array): anything a reviewer should know.

## Fields that do not apply to free-writing — set them as follows

- **ambiguous**: always \`false\` (open task; many valid answers is expected).
- **contextSpoilsAnswer**: always \`false\` (there is no single answer to spoil).
- **grammarPointMatch**: always \`true\` (a free-writing prompt targets production, not a single grammar point).
- Leave the \`coverage\` object empty.

## Output

You MUST use the submit_validation_result tool. Do not return plain text.`;

export function computeFreeWritingValidationPromptVars(
  spec: GenerationSpec,
): Record<string, string> {
  return {
    language: spec.language,
    cefrLevel: spec.cefrLevel,
    cefrDescriptors: CEFR_DESCRIPTOR_BULLETS,
  };
}

export async function buildFreeWritingValidationSystemPrompt(
  spec: GenerationSpec,
): Promise<string> {
  const vars = computeFreeWritingValidationPromptVars(spec);
  const { text } = await getPromptWithVarsOrFallback(
    "free-writing-validate-system-prompt",
    FREE_WRITING_GENERATION_VALIDATION_SYSTEM_PROMPT,
    FREE_WRITING_GENERATION_VALIDATION_PROMPT_VERSION,
    vars,
  );
  return text;
}

export function buildFreeWritingValidationUserPrompt(
  content: FreeWritingContent,
  spec: GenerationSpec,
): string {
  const band = freeWritingLengthFor(spec.cefrLevel);
  const elements = content.requiredElements
    .map((el) => `- ${el.label}${el.detail ? ` (${el.detail})` : ""}`)
    .join("\n");
  return `## Validate this free-writing prompt

**Spec:** language=${spec.language}, cefrLevel=${spec.cefrLevel}
**Expected register:** ${content.register}
**Expected length band:** ${band.minWords}–${band.maxWords} words

**Title:** ${content.title}
**Task:** ${content.task}
**Domain:** ${content.domain}

**Required elements:**
${elements}

Score the dimensions in the system prompt and submit via the submit_validation_result tool. Remember: ambiguous=false, contextSpoilsAnswer=false, grammarPointMatch=true for free-writing.`;
}
```

- [ ] **Step 4: Run the prompt-module test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- free-writing-validation-prompts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire dispatch in `validate.ts`**

After the dictation validation import (`validate.ts:35-38`), add:

```typescript
import {
  buildFreeWritingValidationSystemPrompt,
  buildFreeWritingValidationUserPrompt,
} from "./free-writing-validation-prompts.js";
```

Replace the system/user selection block (`validate.ts:367-374`) with:

```typescript
  const isDictation = draft.contentJson.type === ExerciseType.DICTATION;
  const isFreeWriting = draft.contentJson.type === ExerciseType.FREE_WRITING;
  const systemText = isDictation
    ? await buildDictationValidationSystemPrompt(spec)
    : isFreeWriting
      ? await buildFreeWritingValidationSystemPrompt(spec)
      : await buildValidationSystemPrompt(spec);
  const userText = isDictation
    ? buildDictationValidationUserPrompt(draft.contentJson, spec)
    : isFreeWriting
      ? buildFreeWritingValidationUserPrompt(draft.contentJson, spec)
      : buildValidationUserPrompt(draft, spec);
```

(The `draft.contentJson.type in TOOL_NAME_BY_TYPE` guard at `:361` now passes for free-writing because Task 3 added it to the map. TypeScript narrows `draft.contentJson` to `FreeWritingContent` inside the `isFreeWriting` branch via the discriminant, so the `buildFreeWritingValidationUserPrompt(draft.contentJson, …)` call typechecks.)

- [ ] **Step 6: Add a self-contained dispatch test in `validate.test.ts`**

Add this test, which stubs a minimal Anthropic client inline (no dependency on the file's existing helpers) and asserts the captured system text is the free-writing rubric. The fake `create` records the `system` block and returns a canned valid `submit_validation_result` tool_use so `validateDraft` parses cleanly:

```typescript
import { CefrLevel, ExerciseType, Language, type FreeWritingContent } from "@language-drill/shared";
import { validateDraft, type ExerciseDraft, type GenerationSpec } from "./generate.js"; // adjust: validateDraft is from "./validate.js"

it("routes a free-writing draft to the free-writing validation prompt", async () => {
  let capturedSystem = "";
  const fakeClient = {
    messages: {
      create: async (params: { system: { text: string }[] }) => {
        capturedSystem = params.system[0].text;
        return {
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              name: "submit_validation_result",
              input: {
                qualityScore: 0.9,
                ambiguous: false,
                contextSpoilsAnswer: false,
                levelMatch: true,
                grammarPointMatch: true,
                culturalIssues: [],
                flaggedReasons: [],
              },
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    },
  };

  const fwContent: FreeWritingContent = {
    type: ExerciseType.FREE_WRITING,
    instructions: "Escribe un párrafo.",
    title: "El teletrabajo",
    task: "Da tu opinión.",
    domain: "opinión",
    register: "formal",
    minWords: 150,
    maxWords: 200,
    suggestedMinutes: 25,
    requiredElements: [{ id: "thesis", label: "Expón tu opinión." }],
  };
  const draft = {
    id: "00000000-0000-0000-0000-000000000000",
    contentJson: fwContent,
    metadata: {
      grammarPointKey: "es-b2-fw-remote-work",
      topicDomain: null,
      modelId: "claude-sonnet-4-6",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      inBatchDuplicate: false,
    },
  } as unknown as ExerciseDraft;
  const spec: GenerationSpec = {
    language: Language.ES,
    cefrLevel: CefrLevel.B2,
    exerciseType: ExerciseType.FREE_WRITING,
    grammarPoint: {
      key: "es-b2-fw-remote-work",
      kind: "free-writing",
      name: "El teletrabajo",
      description: "Opinion essay.",
      cefrLevel: CefrLevel.B2,
      language: Language.ES,
      examplesPositive: ["a", "b"],
      examplesNegative: ["*c"],
      commonErrors: ["d"],
      freeWriting: { register: "formal" },
    },
    topicDomain: null,
    count: 1,
    batchSeed: "t",
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await validateDraft(fakeClient as any, draft, spec);
  expect(capturedSystem).toContain("free-writing PROMPTS");
  expect(result.result.qualityScore).toBe(0.9);
});
```

Fix the imports to match the file: `validateDraft`, `ExerciseDraft`, `GenerationSpec` come from `./validate.js` / `./generate.js` as the file already imports them — merge with existing import lines rather than duplicating. If `getPromptWithVarsOrFallback` makes a real network attempt for the system prompt, the in-repo fallback returns the `FREE_WRITING_GENERATION_VALIDATION_SYSTEM_PROMPT` body (which contains "free-writing PROMPTS"), so the assertion holds offline.

- [ ] **Step 7: Run the validate tests**

Run: `pnpm --filter @language-drill/ai test -- validate`
Expected: PASS, including the new dispatch test.

- [ ] **Step 8: Commit**

```bash
git add packages/ai/src/free-writing-validation-prompts.ts packages/ai/src/free-writing-validation-prompts.test.ts packages/ai/src/validate.ts packages/ai/src/validate.test.ts
git commit -m "feat(free-writing): validation prompt + validate.ts dispatch"
```

---

## Task 5: Cell-key regex + cells.ts routing

**Files:**
- Modify: `packages/db/src/lib/cell-key.ts:22` (regex)
- Modify: `packages/db/src/generation/cells.ts` (`compatibleTypes`)
- Test: `packages/db/src/lib/cell-key.test.ts` and `packages/db/src/generation/cells.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests**

In `packages/db/src/lib/cell-key.test.ts`, add:

```typescript
it("accepts a free_writing cell key", () => {
  expect(() => assertValidCellKey("es:b2:free_writing:es-b2-fw-remote-work")).not.toThrow();
});
```

In `packages/db/src/generation/cells.test.ts`, add:

```typescript
import { ExerciseType } from "@language-drill/shared";

it("pairs a free-writing umbrella with exactly the free_writing cell", () => {
  const entry = {
    key: "es-b2-fw-remote-work",
    kind: "free-writing" as const,
    name: "x",
    description: "y",
    cefrLevel: "B2" as const,
    language: "ES" as const,
    examplesPositive: ["a", "b"],
    examplesNegative: ["*c"],
    commonErrors: ["d"],
    freeWriting: { register: "formal" as const },
  };
  const cells = enumerateCurriculumCells([entry]);
  expect(cells.map((c) => c.exerciseType)).toEqual([ExerciseType.FREE_WRITING]);
  expect(cells[0].cellKey).toBe("es:b2:free_writing:es-b2-fw-remote-work");
});
```

(Confirm the test file already imports `enumerateCurriculumCells` and `assertValidCellKey`; add the imports if missing.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- cell-key cells`
Expected: FAIL — regex rejects `free_writing`; `compatibleTypes` returns `[cloze, translation]` for the unknown kind (or empty), not `[free_writing]`.

- [ ] **Step 3: Update the cell-key regex**

In `packages/db/src/lib/cell-key.ts:22`, change:

```typescript
const CELL_KEY_REGEX = /^(es|de|tr):(a1|a2|b1|b2):(cloze|translation|vocab_recall|sentence_construction|dictation):[a-z0-9-]+$/;
```
to:
```typescript
const CELL_KEY_REGEX = /^(es|de|tr):(a1|a2|b1|b2):(cloze|translation|vocab_recall|sentence_construction|dictation|free_writing):[a-z0-9-]+$/;
```

- [ ] **Step 4: Route the new kind in `compatibleTypes`**

In `packages/db/src/generation/cells.ts`, add the constant near the other kind lists (`:51-59`):

```typescript
const FREE_WRITING_KIND_TYPES: ReadonlyArray<ExerciseType> = [ExerciseType.FREE_WRITING];
```

In `compatibleTypes` (`:61-73`), add a branch before the grammar fallthrough:

```typescript
  if (entry.kind === 'free-writing') return FREE_WRITING_KIND_TYPES;
```

(Place it alongside the existing `dictation` / `vocab` early-returns.)

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- cell-key cells`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/lib/cell-key.ts packages/db/src/lib/cell-key.test.ts packages/db/src/generation/cells.ts packages/db/src/generation/cells.test.ts
git commit -m "feat(free-writing): route free-writing kind to a free_writing cell + cell-key regex"
```

---

## Task 6: Per-cell generation target

**Files:**
- Modify: `infra/lambda/src/generation/cell-targets.ts:62-65`
- Test: `infra/lambda/src/generation/cell-targets.test.ts` (add a case)

- [ ] **Step 1: Write the failing test**

In `infra/lambda/src/generation/cell-targets.test.ts`, add (mirroring the existing dictation target test):

```typescript
it("resolves the free_writing B1/B2 per-cell target to 12", () => {
  const cell = {
    language: "ES" as const,
    cefrLevel: "B2" as const,
    exerciseType: ExerciseType.FREE_WRITING,
    grammarPoint: {
      key: "es-b2-fw-remote-work",
      kind: "free-writing" as const,
      name: "x",
      description: "y",
      cefrLevel: "B2" as const,
      language: "ES" as const,
      examplesPositive: ["a", "b"],
      examplesNegative: ["*c"],
      commonErrors: ["d"],
      freeWriting: { register: "formal" as const },
    },
    cellKey: "es:b2:free_writing:es-b2-fw-remote-work",
  };
  expect(resolveCellTarget(cell)).toBe(12);
});
```

(Confirm `resolveCellTarget` and `ExerciseType` are imported in the test file; add if missing.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- cell-targets`
Expected: FAIL — `resolveCellTarget` returns `TARGET_PER_CELL` (50) because the `FREE_WRITING` map is empty.

- [ ] **Step 3: Set the targets**

In `infra/lambda/src/generation/cell-targets.ts`, replace the `FREE_WRITING` entry (`:62-65`):

```typescript
  // Free-writing prompts are batch-generated (Phase 2). A small rotating pool per
  // (language, level, topic) cell fills the writing slot across sessions; topic
  // breadth comes from more curated topic umbrellas, not a high per-cell target.
  [ExerciseType.FREE_WRITING]: { B1: 12, B2: 12 },
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/lambda test -- cell-targets`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/generation/cell-targets.ts infra/lambda/src/generation/cell-targets.test.ts
git commit -m "feat(free-writing): per-cell generation target (B1/B2 = 12)"
```

---

## Task 7: ES curriculum topic entries + version bump + invariant

**Files:**
- Modify: `packages/db/src/curriculum/es.ts` (add entries before the closing `]`, bump version)
- Modify: `packages/db/src/curriculum/index.ts` (`assertCurriculumInvariants` — add the `freeWriting`/`kind` invariant)
- Test: `packages/db/src/curriculum/curriculum.test.ts` (invariants run automatically; add an explicit count assertion)

- [ ] **Step 1: Add the curriculum invariant + write its failing test**

In `packages/db/src/curriculum/index.ts`, inside `assertCurriculumInvariants`'s per-entry loop, after invariant `9c` (sentenceConstructionSuitable, ~`:198`), add:

```typescript
    // 9e. freeWriting config is present iff the entry is a free-writing umbrella.
    if (entry.kind === 'free-writing' && !entry.freeWriting) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' is kind 'free-writing' but has no freeWriting config`,
      );
    }
    if (entry.kind !== 'free-writing' && entry.freeWriting) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' has freeWriting config but is not kind 'free-writing'`,
      );
    }
```

In `packages/db/src/curriculum/curriculum.test.ts`, add:

```typescript
it("has 6 free-writing topic umbrellas per ES B1 and B2", () => {
  const fw = esCurriculum.filter((e) => e.kind === "free-writing");
  expect(fw.filter((e) => e.cefrLevel === "B1")).toHaveLength(6);
  expect(fw.filter((e) => e.cefrLevel === "B2")).toHaveLength(6);
  for (const e of fw) {
    expect(e.freeWriting?.register).toBeDefined();
  }
});
```

(Confirm `esCurriculum` is imported in the test file; it is used by existing ES count tests.)

- [ ] **Step 2: Run to verify the count test fails**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- curriculum`
Expected: FAIL — `expected length 6, got 0`.

- [ ] **Step 3: Add the 12 ES topic entries**

In `packages/db/src/curriculum/es.ts`, insert the following block immediately before the closing `];` of the `esCurriculum` array (after the dictation umbrellas, `:520`):

```typescript

  // ---------------------------------------------------------------------------
  // Free-writing topic umbrellas — kind: 'free-writing' (Phase 2 generation)
  // One cell per (language, level, topic); register is author-declared, the word
  // band is CEFR-derived (FREE_WRITING_LENGTH_BY_CEFR in packages/ai).
  // ---------------------------------------------------------------------------
  {
    key: 'es-b1-fw-ideal-weekend',
    kind: 'free-writing',
    name: 'Mi fin de semana ideal',
    description: 'A friendly, informal prompt to describe an ideal weekend and why it appeals.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Asks the learner to describe plans and give one reason for each.',
      'Requires a closing sentence about how they would feel.',
    ],
    examplesNegative: ['*Write whatever you want about weekends.'],
    commonErrors: ['Prompt too open to score; no concrete checklist.'],
    freeWriting: { register: 'informal' },
  },
  {
    key: 'es-b1-fw-my-town',
    kind: 'free-writing',
    name: 'Mi ciudad',
    description: 'A neutral prompt to describe the learner\'s town and what there is to do there.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Asks for two places and what you can do in each.',
      'Requires a recommendation for a visitor.',
    ],
    examplesNegative: ['*Describe a city (any city, anything).'],
    commonErrors: ['Conflating "describe" with an unscoped free dump.'],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'es-b1-fw-daily-routine',
    kind: 'free-writing',
    name: 'Un día normal',
    description: 'A neutral prompt to narrate a typical day from morning to night.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Asks for at least three moments of the day in order.',
      'Requires one thing they would like to change.',
    ],
    examplesNegative: ['*Tell me about your life.'],
    commonErrors: ['Scope too broad (whole life instead of one day).'],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'es-b1-fw-favorite-meal',
    kind: 'free-writing',
    name: 'Mi comida favorita',
    description: 'An informal prompt to describe a favourite dish and when the learner eats it.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Asks what the dish is and why they like it.',
      'Requires naming who they usually eat it with.',
    ],
    examplesNegative: ['*Write about food.'],
    commonErrors: ['Listing ingredients instead of a connected paragraph.'],
    freeWriting: { register: 'informal' },
  },
  {
    key: 'es-b1-fw-a-trip',
    kind: 'free-writing',
    name: 'Un viaje que recuerdo',
    description: 'A neutral prompt to narrate a memorable trip and one thing that happened.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Asks where and when, plus one memorable event.',
      'Requires a closing sentence on whether they would return.',
    ],
    examplesNegative: ['*Describe travelling in general.'],
    commonErrors: ['Generic travel essay with no specific trip.'],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'es-b1-fw-free-time',
    kind: 'free-writing',
    name: 'Mi tiempo libre',
    description: 'An informal prompt to describe what the learner does for fun and why.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Asks for two activities and how often they do them.',
      'Requires one activity they would like to try.',
    ],
    examplesNegative: ['*Hobbies.'],
    commonErrors: ['One-word answers instead of a paragraph.'],
    freeWriting: { register: 'informal' },
  },
  {
    key: 'es-b2-fw-remote-work',
    kind: 'free-writing',
    name: 'El teletrabajo: ¿avance o aislamiento?',
    description: 'A formal opinion prompt weighing the benefits and drawbacks of remote work.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Asks for a clear thesis plus one supporting and one opposing argument.',
      'Requires a concluding sentence that restates the position.',
    ],
    examplesNegative: ['*Write your opinion about work.'],
    commonErrors: ['Prompt too open to score; no required structure.'],
    freeWriting: { register: 'formal' },
  },
  {
    key: 'es-b2-fw-environment',
    kind: 'free-writing',
    name: 'El medio ambiente y las decisiones individuales',
    description: 'A formal prompt arguing whether individual choices can affect the environment.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Asks for a position plus two concrete examples.',
      'Requires one counter-argument and a response to it.',
    ],
    examplesNegative: ['*Talk about the environment.'],
    commonErrors: ['Listing facts with no argued position.'],
    freeWriting: { register: 'formal' },
  },
  {
    key: 'es-b2-fw-technology-relationships',
    kind: 'free-writing',
    name: 'La tecnología y las relaciones humanas',
    description: 'A formal prompt on whether technology brings people closer or pushes them apart.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Asks for a thesis plus two reasons with examples.',
      'Requires a concessive paragraph acknowledging the other view.',
    ],
    examplesNegative: ['*Is technology good or bad?'],
    commonErrors: ['Yes/no framing with no developed argument.'],
    freeWriting: { register: 'formal' },
  },
  {
    key: 'es-b2-fw-study-abroad',
    kind: 'free-writing',
    name: '¿Estudiar en casa o en el extranjero?',
    description: 'A neutral prompt comparing studying at home versus abroad and recommending one.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Asks for two advantages of each option.',
      'Requires a justified recommendation at the end.',
    ],
    examplesNegative: ['*Studying abroad.'],
    commonErrors: ['Describing only one side; no comparison.'],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'es-b2-fw-social-media',
    kind: 'free-writing',
    name: 'Las redes sociales en la vida diaria',
    description: 'A formal prompt arguing how social media shapes everyday life, for better or worse.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Asks for a position plus two effects with examples.',
      'Requires a suggestion for healthier use.',
    ],
    examplesNegative: ['*Social media is bad. Discuss.'],
    commonErrors: ['One-sided rant with no nuance or examples.'],
    freeWriting: { register: 'formal' },
  },
  {
    key: 'es-b2-fw-work-life-balance',
    kind: 'free-writing',
    name: 'Trabajo y vida personal',
    description: 'A neutral prompt on how to balance work and personal life and why it matters.',
    cefrLevel: B2,
    language: ES,
    examplesPositive: [
      'Asks for two strategies and why each helps.',
      'Requires one obstacle and how to handle it.',
    ],
    examplesNegative: ['*Work-life balance.'],
    commonErrors: ['Abstract platitudes with no concrete strategies.'],
    freeWriting: { register: 'neutral' },
  },
```

- [ ] **Step 4: Bump `CURRICULUM_VERSION_ES`**

In `packages/db/src/curriculum/es.ts`, change `export const CURRICULUM_VERSION_ES = '2026-06-15';` — since the value is already today's date, append a disambiguating suffix so the scheduler sees a change versus the dictation-era value:

```typescript
export const CURRICULUM_VERSION_ES = '2026-06-15b';
```

Add a sentence to the version doc-comment above it:

```typescript
 * `2026-06-15b` adds the twelve `kind: 'free-writing'` topic umbrellas (six each
 * for B1/B2); the bump clears any low-yield / saturated-dedup suppression so the
 * brand-new free-writing cells run on the next scheduler tick.
```

> Note: per the memory "scheduler-low-yield-needs-curriculum-bump", a brand-new cell has no prior job so it is not suppressed; the bump is belt-and-suspenders and keeps the version honest about the curriculum change.

- [ ] **Step 5: Run the curriculum tests**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- curriculum`
Expected: PASS — invariants hold (keys match `^es-b[12]-[a-z0-9-]+$`, ≥2 positive, ≥1 negative with `*`, ≥1 commonError, description ≤200 chars, freeWriting present iff kind free-writing), and the count test passes.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/curriculum/es.ts packages/db/src/curriculum/index.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "feat(free-writing): ES B1/B2 topic umbrellas + curriculum invariant + version bump"
```

---

## Task 8: Barrel re-exports + prompt manifest + CLAUDE.md

**Files:**
- Modify: `packages/ai/src/index.ts` (re-export new symbols)
- Modify: `packages/ai/scripts/bootstrap-prompts.ts` (imports + two `PROMPTS` entries)
- Modify: `CLAUDE.md` (two version-table rows)
- Test: `packages/ai/scripts/bootstrap-prompts.test.ts` if it exists (a manifest-coverage test may already assert every registry name is in `PROMPTS`); otherwise the `--check` run in Task 9 covers it.

- [ ] **Step 1: Re-export from the AI barrel**

In `packages/ai/src/index.ts`, find the block that re-exports the dictation generation/validation symbols (search `dictation-generation-prompts`) and add parallel exports:

```typescript
export {
  FREE_WRITING_GENERATION_PROMPT_VERSION,
  FREE_WRITING_GENERATION_SYSTEM_PROMPT,
  FREE_WRITING_LENGTH_BY_CEFR,
  freeWritingLengthFor,
  computeFreeWritingGenerationPromptVars,
  buildFreeWritingGenerationSystemPrompt,
  buildFreeWritingGenerationUserPrompt,
} from "./free-writing-generation-prompts.js";
export {
  FREE_WRITING_GENERATION_VALIDATION_PROMPT_VERSION,
  FREE_WRITING_GENERATION_VALIDATION_SYSTEM_PROMPT,
  computeFreeWritingValidationPromptVars,
  buildFreeWritingValidationSystemPrompt,
  buildFreeWritingValidationUserPrompt,
} from "./free-writing-validation-prompts.js";
```

Also add `parseGeneratedFreeWritingDraft` and `FREE_WRITING_GENERATION_TOOL` to the existing `export { … } from "./generate.js";` block (next to `parseGeneratedDictationDraft` / `DICTATION_GENERATION_TOOL`).

- [ ] **Step 2: Add the two manifest entries**

In `packages/ai/scripts/bootstrap-prompts.ts`, add to the import block from `../src/index.js` (alphabetically near the dictation imports):

```typescript
  FREE_WRITING_GENERATION_SYSTEM_PROMPT,
  FREE_WRITING_GENERATION_PROMPT_VERSION,
  FREE_WRITING_GENERATION_VALIDATION_SYSTEM_PROMPT,
  FREE_WRITING_GENERATION_VALIDATION_PROMPT_VERSION,
```

Then add two entries to the `PROMPTS` array (after the dictation entries, `:194`):

```typescript
  {
    // Runtime fetches this via getPromptWithVarsOrFallback("free-writing-generate-system-prompt", …)
    // in free-writing-generation-prompts.ts — the name MUST match that registry key.
    name: "free-writing-generate-system-prompt",
    text: FREE_WRITING_GENERATION_SYSTEM_PROMPT,
    version: FREE_WRITING_GENERATION_PROMPT_VERSION,
    surface: "free-writing-generate",
  },
  {
    // Runtime fetches this via getPromptWithVarsOrFallback("free-writing-validate-system-prompt", …)
    // in free-writing-validation-prompts.ts — the name MUST match that registry key.
    name: "free-writing-validate-system-prompt",
    text: FREE_WRITING_GENERATION_VALIDATION_SYSTEM_PROMPT,
    version: FREE_WRITING_GENERATION_VALIDATION_PROMPT_VERSION,
    surface: "free-writing-validate",
  },
```

- [ ] **Step 3: Add the CLAUDE.md version-table rows**

In `CLAUDE.md`, in the "Prompt Editing" table, add two rows after the `free-writing-prompts.ts` row:

```markdown
| `free-writing-generation-prompts.ts` | `FREE_WRITING_GENERATION_PROMPT_VERSION` |
| `free-writing-validation-prompts.ts` | `FREE_WRITING_GENERATION_VALIDATION_PROMPT_VERSION` |
```

- [ ] **Step 4: Build the AI package**

Run: `pnpm --filter @language-drill/ai build`
Expected: exits 0 (barrel + manifest imports resolve).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/index.ts packages/ai/scripts/bootstrap-prompts.ts CLAUDE.md
git commit -m "feat(free-writing): export prompts, register in manifest, document versions"
```

---

## Task 9: Full-suite gate + end-to-end smoke

**Files:** none (verification only), plus any fixups the gate surfaces.

- [ ] **Step 1: Typecheck the whole workspace, fixing any exhaustiveness fallout**

Run: `pnpm typecheck`
Expected: 0 errors. The likely fallout from widening `TOOL_NAME_BY_TYPE` / `GENERATION_TOOL_BY_TYPE` to the full `Record<ExerciseType, …>` is any consumer that iterated the old `Exclude<…, FREE_WRITING>` domain. If a `error TS` appears, run `pnpm typecheck --continue 2>&1 | grep "error TS"` to list all sites and fix them in one pass (memory: ExerciseType enum ripple). Re-run until clean.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: 0 errors. Fix any import-order / unused-symbol issues introduced.

- [ ] **Step 3: Full test suite (serial — the real gate)**

Run: `pnpm turbo run test --concurrency=1`
Expected: all packages green. (Per memory, the parallel `pnpm test` flakes on `infra` under load; `--concurrency=1` is the honest gate.)

- [ ] **Step 4: Verify the prompt manifest has no drift for the two new prompts**

This needs no live Langfuse keys — `bootstrap-prompts --check` reports drift only when keys are set. Instead assert the in-repo wiring is internally consistent:

Run: `pnpm --filter @language-drill/ai exec node -e "import('./dist/index.js').then(m => { const names = ['free-writing-generate-system-prompt','free-writing-validate-system-prompt']; console.log(typeof m.buildFreeWritingGenerationSystemPrompt, typeof m.buildFreeWritingValidationSystemPrompt); })"`
Expected: prints `function function` (barrel exports resolve at runtime).

- [ ] **Step 5: Dry-run the generator against one cell (no DB writes) — optional but recommended**

If `ANTHROPIC_API_KEY` is set in `.env`, generate a single free-writing draft to eyeball quality before trusting the scheduler. The unified CLI routes `--type free_writing` through `runOneCell` (which writes to the DB), so for a no-write smoke prefer the `eval:gen` harness if a free-writing arm is wired, OR run with a throwaway Neon branch. If neither is convenient, skip — the unit tests cover the parsing/dispatch contract, and the scheduler will pick the cells up on the next ~04:00 UTC tick after seed.

Document in the PR description that, post-merge, the operator must run `pnpm db:seed:exercises` (to create the new `skill_topics` rows) before the scheduler or CLI generates free-writing — `runOneCell` fails closed with "Skill-topic row missing" otherwise.

- [ ] **Step 6: Final commit (if Steps 1–2 required fixups)**

```bash
git add -A
git commit -m "chore(free-writing): typecheck/lint fixups across workspace"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** Task 1 (kind + register) ↔ spec §1; Task 2 (generation prompt + length table) ↔ spec §2/§4; Task 3 (tool/parser/dispatch/dedup) ↔ spec §2/§5; Task 4 (validation) ↔ spec §3; Task 5 (cells + cell-key) ↔ spec §1/§6; Task 6 (targets) ↔ spec §6; Task 7 (curriculum + version) ↔ spec §1/§7; Task 8 (manifest + exports + docs) ↔ spec §7. No audio / scheduler / web / CDK work — matches "Out of scope".
- **Name consistency:** generation version `FREE_WRITING_GENERATION_PROMPT_VERSION` (`free-writing-generate@…`); validation version `FREE_WRITING_GENERATION_VALIDATION_PROMPT_VERSION` (`free-writing-validate@…`) — deliberately distinct from the existing learner-answer grader `FREE_WRITING_EVAL_PROMPT_VERSION`. Tool name `submit_free_writing_exercise` used identically in the generation-prompt vars, the tool definition, `TOOL_NAME_BY_TYPE`, and the user-prompt assertion.
- **Registry-key parity:** the `name` strings in the `PROMPTS` manifest (`free-writing-generate-system-prompt`, `free-writing-validate-system-prompt`) match the first argument of `getPromptWithVarsOrFallback` in each module — required or the runtime serves the fallback forever (memory: new-prompt-needs-manifest-entry).
```
