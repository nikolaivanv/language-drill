# Contextual Paraphrase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new pre-generated, Claude-evaluated exercise type — Contextual Paraphrase — where the learner rewrites a source sentence under a single-answer transformation constraint (avoid a word / shift register / simplify for an audience).

**Architecture:** New `ExerciseType.CONTEXTUAL_PARAPHRASE` + `ContextualParaphraseContent` in `@language-drill/shared`. Umbrella-anchored in the curriculum (new `kind: 'paraphrase'`, like `free-writing`), one generation cell per `(language, level)`. Generation/validation/eval mirror the **sentence_construction inline-helper** pattern (per-type helpers inside the generic evaluator/validator, NOT free_writing's bespoke module). Diversity is enforced by four layers: `_dedupKey` uniqueness on the normalized source sentence, a prior-source-sentence avoid-list, ordinal constraint-kind rotation, and curated scenario-seed rotation with cross-run exclude. Grading reuses the generic `EvaluationResult` (constraint-adherence + meaning-preservation → `taskAchievement`).

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo). Vitest. Drizzle ORM (Neon Postgres). Anthropic Claude (generation/validation/eval, tool-calling). Langfuse-hosted prompts (in-repo fallback). Next.js App Router web tier.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-09-contextual-paraphrase-design.md` — read it first.
- **Work in the worktree only:** `/Users/seal/dev/language-drill/.claude/worktrees/feat+contextual-paraphrase-exercise`. Use absolute paths under this root or `cd` into it (edits via main-checkout absolute paths silently write to `main`). Assert `git branch --show-current` is `worktree-feat+contextual-paraphrase-exercise` before every commit.
- **Enum value string:** `"contextual_paraphrase"` (matches the existing `<lower_snake>` convention).
- **v1 constraint kinds (ONLY these three):** `"avoid" | "register" | "simplify"`. Do NOT build the "rewrite N ways" multi-answer variant.
- **v1 hint model:** single reference-paraphrase reveal (mirrors sentence_construction's "show an example", `hintCount` 0 or 1). The spec's 3-level ladder (L1 structure hint, L2 synonym) is a documented follow-up — its hints have no fields in `ContextualParaphraseContent` and no existing component implements a multi-level ladder. Do NOT add `structureHint`/synonym fields in v1.
- **CEFR range:** B1–C2, four languages — but author only the umbrellas whose `(language, level)` the curriculum already carries other umbrella kinds for; match existing `free-writing`/`dictation` umbrella level coverage, do not force a flat 4×4.
- **Fluency:** paraphrase is intentionally NOT fluency-eligible (it is free-form, Claude-graded). `packages/shared/src/fluency.ts` `FLUENCY_ELIGIBLE_TYPES` is a plain array (not an exhaustive `Record`), so it needs NO change and `isFluencyEligibleType` correctly returns `false` for the new type — do not add it, and `fluency.test.ts` stays green.
- **Grading:** reuse `EvaluationResult` verbatim (no new result type). `taskAchievement` ← meaning-preserved AND constraint-satisfied; `grammarAccuracy` ← rewrite grammar; `vocabularyRange` ← lexis CEFR; `errors[].grammarPointKey` ← attributed from the level's closed key set.
- **Prompt versioning:** any semantic edit to a generation/validation/eval prompt bumps the matching `*_PROMPT_VERSION` in the same commit (format `<surface>@YYYY-MM-DD`, add an `a`/`b` suffix if today's date is already used). See the per-task steps.
- **Test gate is the FULL serial run, not typecheck:** several runtime allowlists (`VALID_EXERCISE_TYPES`, `CELL_KEY_REGEX`, `axisForExerciseType`) and `*.test.ts` count assertions pass `tsc` while silently breaking. Before the final full run: `rm -rf infra/lambda/dist` (stale compiled `*.test.js` cause phantom failures) and `pnpm build` (turbo, so `packages/db` tests resolve fresh `dist`). Then `pnpm turbo run test --concurrency=1` from the worktree root, followed by `pnpm lint && pnpm typecheck`.
- **Enumerate compile-time ripple in one pass:** after Task 1, run `pnpm turbo run typecheck --continue 2>&1 | grep "error TS"` to list every exhaustive-switch / `Record<ExerciseType,…>` site the new enum member breaks.

---

## File Structure

**Created:**
- `apps/web/app/(dashboard)/drill/_components/contextual-paraphrase-exercise.tsx` — drill UI component.
- `apps/web/app/(dashboard)/drill/_components/__tests__/contextual-paraphrase-exercise.test.tsx` — its test.

**Modified (by package):**
- `packages/shared/src/index.ts` — enum, content type, union, guard. `index.test.ts` — count + membership.
- `packages/shared/src/curriculum-types.ts` — `kind` union + `paraphrase` config field.
- `packages/ai/src/generate.ts` — tool schema, parser, `TOOL_NAME_BY_TYPE`, `GENERATION_TOOL_BY_TYPE`, `parseToolInput`.
- `packages/ai/src/generation-prompts.ts` — `canonicalSurface`, constraint-kind rotation, prompt section + placeholder, `GENERATION_PROMPT_VERSION`, `GENERATION_SYSTEM_PROMPT_TEMPLATE`.
- `packages/ai/src/prompts.ts` — `buildContextualParaphraseUserPrompt` + case. `validation-prompts.ts` — validation helper + case + `VALIDATION_PROMPT_VERSION`.
- `packages/db/src/generation/cells.ts` — `PARAPHRASE_KIND_TYPES` + `compatibleTypes`.
- `packages/db/src/lib/cell-key.ts` — `CELL_KEY_REGEX`.
- `packages/db/src/generation/run-one-cell.ts` — `fetchPriorParaphraseSurfaces`, `priorPoolSurfaces` arm, `seedKindFor`/`buildSeedWords` arm.
- `packages/db/src/curriculum/{es,de,tr,en}.ts` — umbrellas + `CURRICULUM_VERSION_<LANG>` bumps. `curriculum/index.ts` — invariant. `curriculum/curriculum.test.ts` — counts.
- `infra/lambda/src/generation/job-message.ts`, `generation/cell-targets.ts`, `lib/today-plan.ts`, `lib/progress-aggregation.ts`; test allowlists `routes/admin.test.ts`, `packages/db/src/generation/cells.test.ts`.
- `apps/web/app/(dashboard)/drill/_components/exercise-pane.tsx`, `.../debrief/_components/review-item-card.tsx`, `app/(dashboard)/_lib/timeline-labels.ts`, `lib/drill/coach-messages.ts`.
- `docs/exercise-strategy.md` — status refresh (final task).

---

## Task 1: Shared types — enum, content, union, guard, count test

**Files:**
- Modify: `packages/shared/src/index.ts` (enum ~79-87; union ~256-263; guards ~277-309)
- Test: `packages/shared/src/index.test.ts` (count ~76-90)

**Interfaces:**
- Produces: `ExerciseType.CONTEXTUAL_PARAPHRASE = "contextual_paraphrase"`; `type ContextualParaphraseContent`; `isContextualParaphraseContent(content): content is ContextualParaphraseContent`.

- [ ] **Step 1: Update the count/membership test first (failing)**

In `packages/shared/src/index.test.ts`, change the count from 7 to 8 and add the membership assertion:

```ts
  it("has exactly 8 values", () => {
    const values = Object.values(ExerciseType);
    expect(values).toHaveLength(8);
  });

  it("contains CLOZE, TRANSLATION, VOCAB_RECALL, SENTENCE_CONSTRUCTION, DICTATION, FREE_WRITING, CONJUGATION, CONTEXTUAL_PARAPHRASE", () => {
    expect(ExerciseType.CLOZE).toBe("cloze");
    expect(ExerciseType.TRANSLATION).toBe("translation");
    expect(ExerciseType.VOCAB_RECALL).toBe("vocab_recall");
    expect(ExerciseType.SENTENCE_CONSTRUCTION).toBe("sentence_construction");
    expect(ExerciseType.DICTATION).toBe("dictation");
    expect(ExerciseType.FREE_WRITING).toBe("free_writing");
    expect(ExerciseType.CONJUGATION).toBe("conjugation");
    expect(ExerciseType.CONTEXTUAL_PARAPHRASE).toBe("contextual_paraphrase");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/shared test -- index.test.ts`
Expected: FAIL — `expected length 7 to be 8` / `ExerciseType.CONTEXTUAL_PARAPHRASE` is `undefined`.

- [ ] **Step 3: Add the enum member**

In `packages/shared/src/index.ts`, add to the `ExerciseType` enum:

```ts
export enum ExerciseType {
  CLOZE = "cloze",
  TRANSLATION = "translation",
  VOCAB_RECALL = "vocab_recall",
  SENTENCE_CONSTRUCTION = "sentence_construction",
  DICTATION = "dictation",
  FREE_WRITING = "free_writing",
  CONJUGATION = "conjugation",
  CONTEXTUAL_PARAPHRASE = "contextual_paraphrase",
}
```

- [ ] **Step 4: Add the content type** (place it after `ConjugationContent`, before the `ExerciseContent` union)

```ts
export type ContextualParaphraseContent = {
  type: ExerciseType.CONTEXTUAL_PARAPHRASE;
  instructions: string;
  /** The sentence the learner must rewrite. */
  sourceText: string;
  /** Which transformation is required. Drives rendering + eval framing. */
  constraintKind: "avoid" | "register" | "simplify";
  /** avoid: words/structures that must NOT appear in the answer (≥1 when kind==="avoid"). */
  bannedTerms?: string[];
  /** register: the register the rewrite must adopt (required when kind==="register"). */
  targetRegister?: "informal" | "neutral" | "formal";
  /** simplify: the audience to simplify for, e.g. "a child" (required when kind==="simplify"). */
  audience?: string;
  /** Rendered task shown to the learner, e.g. "Say this without using «gustar»". */
  constraintLabel: string;
  /** 2–3 model paraphrases that satisfy the constraint AND preserve meaning.
   *  Used by the validator and the reveal hint. */
  referenceParaphrases: string[];
  topicHint?: string;
};
```

- [ ] **Step 5: Add to the `ExerciseContent` union and add the guard**

Union:

```ts
export type ExerciseContent =
  | ClozeContent
  | TranslationContent
  | VocabRecallContent
  | SentenceConstructionContent
  | DictationContent
  | FreeWritingContent
  | ConjugationContent
  | ContextualParaphraseContent;
```

Guard (after `isConjugationContent`):

```ts
export function isContextualParaphraseContent(
  content: ExerciseContent,
): content is ContextualParaphraseContent {
  return content.type === ExerciseType.CONTEXTUAL_PARAPHRASE;
}
```

- [ ] **Step 6: Run the shared test to verify it passes**

Run: `pnpm --filter @language-drill/shared test -- index.test.ts`
Expected: PASS.

- [ ] **Step 7: Build shared so downstream packages resolve the new symbols**

Run: `pnpm --filter @language-drill/shared build`
Expected: exit 0.

- [ ] **Step 8: Enumerate the compile-time ripple (informational)**

Run: `pnpm turbo run typecheck --continue 2>&1 | grep "error TS"`
Expected: errors at `generate.ts` (2 Records + 1 switch), `generation-prompts.ts` (canonicalSurface), `prompts.ts`, `validation-prompts.ts`, `cell-targets.ts`, `today-plan.ts`, `timeline-labels.ts`, `coach-messages.ts`. These are the checklist for Tasks 2–11.

- [ ] **Step 9: Commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/feat+contextual-paraphrase-exercise
git add packages/shared/src/index.ts packages/shared/src/index.test.ts
git commit -m "feat(shared): add CONTEXTUAL_PARAPHRASE exercise type + content"
```

---

## Task 2: AI generation — canonicalSurface, tool schema, parser, tool maps

**Files:**
- Modify: `packages/ai/src/generate.ts` (`TOOL_NAME_BY_TYPE` ~92-100; `GENERATION_TOOL_BY_TYPE` ~465-474; `parseToolInput` ~1357-1394; add tool + parser near the SC ones ~311-364 / ~892-966)
- Modify: `packages/ai/src/generation-prompts.ts` (`canonicalSurface` ~707-748)
- Test: `packages/ai/src/generate.test.ts`

**Interfaces:**
- Consumes: `ContextualParaphraseContent`, `ExerciseType.CONTEXTUAL_PARAPHRASE` (Task 1).
- Produces: `CONTEXTUAL_PARAPHRASE_GENERATION_TOOL: Anthropic.Tool`; `parseGeneratedContextualParaphraseDraft(input, spec): ContextualParaphraseContent`; `TOOL_NAME_BY_TYPE.contextual_paraphrase = "submit_contextual_paraphrase_exercise"`; `canonicalSurface` returns `normaliseSurface(content.sourceText)` for this type.

- [ ] **Step 1: Write the failing parser test**

Add to `packages/ai/src/generate.test.ts`:

```ts
import { parseGeneratedContextualParaphraseDraft } from "./generate.js";
// (add ExerciseType import if not present)

describe("parseGeneratedContextualParaphraseDraft", () => {
  const spec = { exerciseType: ExerciseType.CONTEXTUAL_PARAPHRASE } as never;

  it("parses an avoid-constraint draft", () => {
    const out = parseGeneratedContextualParaphraseDraft(
      {
        instructions: "Rewrite the sentence.",
        sourceText: "Me gusta mucho el café por la mañana.",
        constraintKind: "avoid",
        bannedTerms: ["gustar"],
        constraintLabel: "Say this without using «gustar».",
        referenceParaphrases: [
          "Disfruto mucho del café por la mañana.",
          "Adoro tomar café por la mañana.",
        ],
      },
      spec,
    );
    expect(out.type).toBe(ExerciseType.CONTEXTUAL_PARAPHRASE);
    expect(out.constraintKind).toBe("avoid");
    expect(out.bannedTerms).toEqual(["gustar"]);
    expect(out.referenceParaphrases).toHaveLength(2);
  });

  it("rejects an avoid draft with no bannedTerms", () => {
    expect(() =>
      parseGeneratedContextualParaphraseDraft(
        {
          instructions: "Rewrite.",
          sourceText: "X.",
          constraintKind: "avoid",
          constraintLabel: "Avoid.",
          referenceParaphrases: ["a", "b"],
        },
        spec,
      ),
    ).toThrow(/bannedTerms/);
  });

  it("rejects a register draft with no targetRegister", () => {
    expect(() =>
      parseGeneratedContextualParaphraseDraft(
        {
          instructions: "Rewrite.",
          sourceText: "X.",
          constraintKind: "register",
          constraintLabel: "Formal.",
          referenceParaphrases: ["a", "b"],
        },
        spec,
      ),
    ).toThrow(/targetRegister/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- generate.test.ts -t "ContextualParaphrase"`
Expected: FAIL — `parseGeneratedContextualParaphraseDraft is not a function`.

- [ ] **Step 3: Add the generation tool** in `packages/ai/src/generate.ts` (near `SENTENCE_CONSTRUCTION_GENERATION_TOOL`)

```ts
export const CONTEXTUAL_PARAPHRASE_GENERATION_TOOL: Anthropic.Tool = {
  name: TOOL_NAME_BY_TYPE.contextual_paraphrase,
  description:
    "Submit a single contextual-paraphrase exercise: a source sentence plus one transformation constraint (avoid a word/structure, shift register, or simplify for an audience) and 2–3 model paraphrases.",
  input_schema: {
    type: "object" as const,
    properties: {
      instructions: {
        type: "string",
        description:
          "Short imperative telling the learner to rewrite the sentence to satisfy the constraint while keeping the meaning.",
      },
      sourceText: {
        type: "string",
        description:
          "The sentence the learner must rewrite, in the target language, natural at the target CEFR level.",
      },
      constraintKind: {
        type: "string",
        enum: ["avoid", "register", "simplify"],
        description:
          "The transformation required. Set this to the constraintKind named in the user message.",
      },
      bannedTerms: {
        type: "array",
        items: { type: "string" },
        description:
          "REQUIRED and non-empty when constraintKind is 'avoid': the word(s)/structure(s) that MUST appear in sourceText and MUST NOT appear in any valid paraphrase. Omit otherwise.",
      },
      targetRegister: {
        type: "string",
        enum: ["informal", "neutral", "formal"],
        description:
          "REQUIRED when constraintKind is 'register': the register the rewrite must adopt (must differ from the source's register). Omit otherwise.",
      },
      audience: {
        type: "string",
        description:
          "REQUIRED when constraintKind is 'simplify': the audience to simplify for (e.g. 'a child', 'a non-expert'). Omit otherwise.",
      },
      constraintLabel: {
        type: "string",
        description:
          "The task line shown to the learner, phrased in English, e.g. 'Say this without using «gustar»' or 'Rewrite this in a formal register'.",
      },
      referenceParaphrases: {
        type: "array",
        items: { type: "string" },
        description:
          "2 or 3 distinct, natural target-language paraphrases that preserve the source meaning AND satisfy the constraint (for 'avoid', none may contain any bannedTerm). These prove the task is solvable and seed the learner's reveal hint.",
      },
      topicHint: {
        type: "string",
        description: "Optional topic theme (e.g. 'travel', 'work', 'family').",
      },
    },
    required: [
      "instructions",
      "sourceText",
      "constraintKind",
      "constraintLabel",
      "referenceParaphrases",
    ],
  },
};
```

- [ ] **Step 4: Add the parser** in `packages/ai/src/generate.ts` (near `parseGeneratedSentenceConstructionDraft`)

```ts
const PARAPHRASE_CONSTRAINT_KINDS: ReadonlySet<string> = new Set([
  "avoid",
  "register",
  "simplify",
]);

export function parseGeneratedContextualParaphraseDraft(
  input: unknown,
  _spec: GenerationSpec,
): ContextualParaphraseContent {
  const ctx = "contextual_paraphrase draft";
  if (!isObject(input)) {
    throw new Error(`${ctx}: must be an object, got ${typeof input}`);
  }
  const instructions = requireString(input, "instructions", ctx);
  const sourceText = requireString(input, "sourceText", ctx);
  const constraintKind = requireString(input, "constraintKind", ctx);
  const bannedTerms = optionalStringArray(input, "bannedTerms", ctx);
  const targetRegister = optionalString(input, "targetRegister", ctx);
  const audience = optionalString(input, "audience", ctx);
  const constraintLabel = requireString(input, "constraintLabel", ctx);
  const referenceParaphrases = requireStringArray(input, "referenceParaphrases", ctx);
  const topicHint = optionalString(input, "topicHint", ctx);

  if (!PARAPHRASE_CONSTRAINT_KINDS.has(constraintKind)) {
    throw new Error(
      `${ctx}: invalid constraintKind: must be one of avoid|register|simplify, got ${JSON.stringify(constraintKind)}`,
    );
  }
  if (sourceText.trim().length === 0) {
    throw new Error(`${ctx}: invalid sourceText: must contain non-whitespace characters`);
  }
  if (constraintKind === "avoid" && (!bannedTerms || bannedTerms.length === 0)) {
    throw new Error(
      `${ctx}: invalid bannedTerms: constraintKind 'avoid' requires a non-empty bannedTerms array`,
    );
  }
  if (constraintKind === "register" && targetRegister === undefined) {
    throw new Error(
      `${ctx}: invalid targetRegister: constraintKind 'register' requires targetRegister`,
    );
  }
  if (
    targetRegister !== undefined &&
    !REGISTERS.has(targetRegister) // REGISTERS Set already defined for sentence_construction
  ) {
    throw new Error(
      `${ctx}: invalid targetRegister: must be one of informal|neutral|formal, got ${JSON.stringify(targetRegister)}`,
    );
  }
  if (constraintKind === "simplify" && (audience === undefined || audience.trim().length === 0)) {
    throw new Error(
      `${ctx}: invalid audience: constraintKind 'simplify' requires a non-empty audience`,
    );
  }
  if (referenceParaphrases.length < 2 || referenceParaphrases.length > 3) {
    throw new Error(
      `${ctx}: invalid referenceParaphrases: expected 2–3 entries, got ${referenceParaphrases.length}`,
    );
  }
  for (let i = 0; i < referenceParaphrases.length; i++) {
    if (referenceParaphrases[i].trim().length === 0) {
      throw new Error(`${ctx}: invalid referenceParaphrases[${i}]: must contain non-whitespace characters`);
    }
  }

  return {
    type: ExerciseType.CONTEXTUAL_PARAPHRASE,
    instructions,
    sourceText,
    constraintKind: constraintKind as ContextualParaphraseContent["constraintKind"],
    ...(constraintKind === "avoid" && bannedTerms ? { bannedTerms } : {}),
    ...(targetRegister !== undefined
      ? { targetRegister: targetRegister as ContextualParaphraseContent["targetRegister"] }
      : {}),
    ...(audience !== undefined ? { audience } : {}),
    constraintLabel,
    referenceParaphrases,
    ...(topicHint !== undefined ? { topicHint } : {}),
  };
}
```

Add `ContextualParaphraseContent` to the `@language-drill/shared` import at the top of `generate.ts`.

- [ ] **Step 5: Wire the maps and the `parseToolInput` switch**

In `TOOL_NAME_BY_TYPE`:

```ts
  contextual_paraphrase: "submit_contextual_paraphrase_exercise",
```

In `GENERATION_TOOL_BY_TYPE`:

```ts
  contextual_paraphrase: CONTEXTUAL_PARAPHRASE_GENERATION_TOOL,
```

In `parseToolInput`, add a case before `default`:

```ts
    case ExerciseType.CONTEXTUAL_PARAPHRASE:
      return parseGeneratedContextualParaphraseDraft(input, spec);
```

- [ ] **Step 6: Add the `canonicalSurface` arm** in `packages/ai/src/generation-prompts.ts` (before `default`)

```ts
    case ExerciseType.CONTEXTUAL_PARAPHRASE:
      // The source sentence is the dedup surface: no two paraphrase exercises
      // in a cell may reuse the same sentence, regardless of constraint kind.
      return normaliseSurface(content.sourceText);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- generate.test.ts -t "ContextualParaphrase"`
Expected: PASS.
Run: `pnpm --filter @language-drill/ai typecheck`
Expected: exit 0 (canonicalSurface + both Records + switch now exhaustive).

- [ ] **Step 8: Commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/feat+contextual-paraphrase-exercise
git add packages/ai/src/generate.ts packages/ai/src/generate.test.ts packages/ai/src/generation-prompts.ts
git commit -m "feat(ai): contextual-paraphrase generation tool, parser, dedup surface"
```

---

## Task 3: AI generation prompt — constraint-kind rotation + guidance section

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts` (mode-rotation ~571-586; `renderSentenceConstructionSection` neighbour ~222-259; `computeGenerationPromptVars` ~404-418; `buildGenerationUserPrompt` `modeBlock` ~681-691; `GENERATION_SYSTEM_PROMPT_TEMPLATE` ~359; `GENERATION_PROMPT_VERSION` ~200)
- Test: `packages/ai/src/generation-prompts.test.ts`

**Interfaces:**
- Produces: `contextualParaphraseConstraintForOrdinal(ordinal): "avoid" | "register" | "simplify"`; `renderContextualParaphraseSection(...)`; new template var `{{contextualParaphraseSection}}`; a per-draft constraint directive block in the user prompt.

- [ ] **Step 1: Write the failing rotation + section tests**

Add to `packages/ai/src/generation-prompts.test.ts`:

```ts
import {
  contextualParaphraseConstraintForOrdinal,
  buildGenerationUserPrompt,
} from "./generation-prompts.js";

describe("contextualParaphraseConstraintForOrdinal", () => {
  it("rotates avoid → register → simplify", () => {
    expect(contextualParaphraseConstraintForOrdinal(0)).toBe("avoid");
    expect(contextualParaphraseConstraintForOrdinal(1)).toBe("register");
    expect(contextualParaphraseConstraintForOrdinal(2)).toBe("simplify");
    expect(contextualParaphraseConstraintForOrdinal(3)).toBe("avoid");
  });
});

describe("buildGenerationUserPrompt — contextual_paraphrase", () => {
  it("names the constraint kind for the ordinal", () => {
    const prompt = buildGenerationUserPrompt(
      {
        language: "es",
        cefrLevel: "B1",
        exerciseType: ExerciseType.CONTEXTUAL_PARAPHRASE,
        grammarPoint: { key: "es-b1-paraphrase", name: "Paraphrase (B1)" },
      } as never,
      1, // ordinal 1 → register
      undefined,
    );
    expect(prompt).toMatch(/constraint kind: register/i);
  });
});
```

(Match the real `buildGenerationUserPrompt` signature seen in the file; adapt the arg shape to the existing `inputs`/`ordinal`/`coverageTargets` parameters.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts.test.ts -t "contextual_paraphrase"`
Expected: FAIL — `contextualParaphraseConstraintForOrdinal is not a function`.

- [ ] **Step 3: Add the rotation helper** (near `sentenceConstructionModeForOrdinal`)

```ts
const CONTEXTUAL_PARAPHRASE_CONSTRAINTS = ["avoid", "register", "simplify"] as const;

/** Deterministic constraint-kind rotation so a batch covers all three kinds. */
export function contextualParaphraseConstraintForOrdinal(
  ordinal: number,
): (typeof CONTEXTUAL_PARAPHRASE_CONSTRAINTS)[number] {
  return CONTEXTUAL_PARAPHRASE_CONSTRAINTS[
    ordinal % CONTEXTUAL_PARAPHRASE_CONSTRAINTS.length
  ];
}
```

- [ ] **Step 4: Add the guidance section renderer** (near `renderSentenceConstructionSection`)

```ts
function renderContextualParaphraseSection(
  exerciseType: ExerciseType,
  language: string,
  cefrLevel: string,
): string {
  if (exerciseType !== ExerciseType.CONTEXTUAL_PARAPHRASE) return "";
  return `## Contextual-paraphrase specifics (this exercise type)

This is a contextual_paraphrase exercise: there is NO blank. You author a natural ${language} \`sourceText\` sentence at CEFR ${cefrLevel} and ONE transformation constraint; the learner rewrites the sentence to satisfy the constraint while preserving meaning. The cloze/blank rules above do not apply; the **anti-leak**, vocabulary-band, and **Safe, neutral topics** rules DO apply, adapted as follows:

- **The meaning MUST be preservable under the constraint.** Never author a source + constraint whose only faithful rewrite is the source itself, or which forces a meaning change. A competent learner must be able to produce at least two distinct valid paraphrases.
- **Per constraint kind (the user message selects one per draft):**
  - \`avoid\`: put the banned word(s)/structure(s) in \`bannedTerms\`; they MUST occur in \`sourceText\` and MUST NOT occur in any \`referenceParaphrases\`. Choose a term that has real ${language} synonyms or a circumlocution route at CEFR ${cefrLevel} — never a function word with no paraphrase.
  - \`register\`: set \`targetRegister\`; the source must be in a clearly DIFFERENT register, and the rewrite changes register (address forms, politeness, lexis) WITHOUT changing the propositional content.
  - \`simplify\`: set \`audience\`; the rewrite conveys the same information in language appropriate for that audience.
- **\`referenceParaphrases\` (2–3) must each be fully grammatical ${language} at CEFR ${cefrLevel}, preserve the source meaning, and satisfy the constraint.** They are the learner's reveal hint and the validator's evidence that the task is solvable.
- **Plain text only — no markdown.** \`instructions\`, \`sourceText\`, and \`constraintLabel\` render verbatim; use no emphasis markup.
- **Do not spoil.** \`constraintLabel\` names the transformation; it must not hand the learner a finished paraphrase.

`;
}
```

- [ ] **Step 5: Add the template placeholder + register the var**

In `GENERATION_SYSTEM_PROMPT_TEMPLATE`, add `{{contextualParaphraseSection}}` immediately after `{{sentenceConstructionSection}}` (so it splices before `## Output`, byte-identical to today for all other types because the renderer returns `""`).

In `computeGenerationPromptVars`, add alongside `sentenceConstructionSection`:

```ts
    contextualParaphraseSection: renderContextualParaphraseSection(
      exerciseType,
      language,
      cefrLevel,
    ),
```

- [ ] **Step 6: Add the per-draft constraint directive** in `buildGenerationUserPrompt` (extend the `modeBlock` region)

```ts
  const paraphraseBlock =
    inputs.exerciseType === ExerciseType.CONTEXTUAL_PARAPHRASE
      ? `Use constraint kind: ${contextualParaphraseConstraintForOrdinal(ordinal)}.\n\n`
      : "";
```

and include `${paraphraseBlock}` in the returned template string (next to `${modeBlock}`).

- [ ] **Step 7: Bump `GENERATION_PROMPT_VERSION`**

```ts
export const GENERATION_PROMPT_VERSION = "generate@2026-07-09";
```

Add a one-line changelog entry in the comment block above it noting the paraphrase section.

- [ ] **Step 8: Run tests + typecheck**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts.test.ts -t "contextual_paraphrase"`
Expected: PASS.
Run: `pnpm --filter @language-drill/ai typecheck` → exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/ai/src/generation-prompts.ts packages/ai/src/generation-prompts.test.ts
git commit -m "feat(ai): contextual-paraphrase generation guidance + constraint rotation (generate@2026-07-09)"
```

---

## Task 4: AI validation prompt

**Files:**
- Modify: `packages/ai/src/validation-prompts.ts` (`buildValidationUserPrompt` switch ~397-437; add helper near the SC one; `VALIDATION_PROMPT_VERSION` ~80-82)
- Test: `packages/ai/src/validation-prompts.test.ts`

**Interfaces:**
- Produces: `buildContextualParaphraseValidationUserPrompt(content, spec): string`; a `CONTEXTUAL_PARAPHRASE` case in `buildValidationUserPrompt`.

- [ ] **Step 1: Write the failing validation-prompt test**

Add to `packages/ai/src/validation-prompts.test.ts` a test that builds a validation prompt for a paraphrase draft and asserts it mentions meaning preservation and (for an avoid draft) that banned terms must not appear in the paraphrases:

```ts
it("validation prompt for contextual_paraphrase checks meaning preservation + banned-term exclusion", () => {
  const draft = {
    contentJson: {
      type: ExerciseType.CONTEXTUAL_PARAPHRASE,
      instructions: "Rewrite.",
      sourceText: "Me gusta el café.",
      constraintKind: "avoid",
      bannedTerms: ["gustar"],
      constraintLabel: "Say this without «gustar».",
      referenceParaphrases: ["Disfruto del café.", "Adoro el café."],
    },
  } as never;
  const spec = { language: "es", cefrLevel: "B1" } as never;
  const prompt = buildValidationUserPrompt(draft, spec);
  expect(prompt).toMatch(/meaning/i);
  expect(prompt).toMatch(/gustar/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/ai test -- validation-prompts.test.ts -t "contextual_paraphrase"`
Expected: FAIL — the `default` exhaustiveness branch throws `unsupported content type contextual_paraphrase`.

- [ ] **Step 3: Add the validation helper** (near `buildSentenceConstructionValidationUserPrompt`)

```ts
function buildContextualParaphraseValidationUserPrompt(
  content: ContextualParaphraseContent,
  spec: GenerationSpec,
): string {
  const constraintDetail =
    content.constraintKind === "avoid"
      ? `Banned terms (must appear in the source, must NOT appear in any paraphrase): ${(content.bannedTerms ?? []).join(", ")}`
      : content.constraintKind === "register"
        ? `Target register: ${content.targetRegister}`
        : `Simplify for: ${content.audience}`;
  return `Validate this ${spec.language} contextual-paraphrase exercise (CEFR ${spec.cefrLevel}).

Source sentence: ${content.sourceText}
Constraint kind: ${content.constraintKind}
${constraintDetail}
Task shown to learner: ${content.constraintLabel}
Reference paraphrases:
${content.referenceParaphrases.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Reject (flag) the exercise if ANY of the following hold:
- The meaning cannot be preserved under the constraint, or the only faithful rewrite is the source itself.
- constraintKind 'avoid': a banned term is absent from the source, OR appears in any reference paraphrase, OR has no reasonable ${spec.language} synonym/circumlocution at CEFR ${spec.cefrLevel}.
- constraintKind 'register': the source is already in the target register (no shift to perform), or a reference paraphrase changes the propositional content.
- constraintKind 'simplify': a reference paraphrase omits information or is not simpler for the stated audience.
- Any reference paraphrase is ungrammatical, unnatural, or above/below CEFR ${spec.cefrLevel}.
- The source sentence is unnatural, or the constraintLabel leaks a finished paraphrase.
Otherwise approve it.`;
}
```

Add `ContextualParaphraseContent` to the shared import in `validation-prompts.ts`.

- [ ] **Step 4: Add the switch case** (before `default`)

```ts
    case ExerciseType.CONTEXTUAL_PARAPHRASE:
      base = buildContextualParaphraseValidationUserPrompt(content, spec);
      break;
```

- [ ] **Step 5: Bump `VALIDATION_PROMPT_VERSION`**

```ts
export const VALIDATION_PROMPT_VERSION = "validate@2026-07-09";
```

(The per-type validation user prompt is code-side per-draft — no Langfuse template edit here; still bump the version constant per project convention.)

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @language-drill/ai test -- validation-prompts.test.ts -t "contextual_paraphrase"` → PASS.
Run: `pnpm --filter @language-drill/ai typecheck` → exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/ai/src/validation-prompts.ts packages/ai/src/validation-prompts.test.ts
git commit -m "feat(ai): contextual-paraphrase validation prompt (validate@2026-07-09)"
```

---

## Task 5: AI evaluation prompt

**Files:**
- Modify: `packages/ai/src/prompts.ts` (`buildUserPrompt` switch ~262-311; add helper near `buildSentenceConstructionUserPrompt`)
- Test: `packages/ai/src/evaluate.test.ts`

**Interfaces:**
- Consumes: `EvaluationResult` (unchanged).
- Produces: `buildContextualParaphraseUserPrompt(exercise, userAnswer, language, difficulty): string`; a `CONTEXTUAL_PARAPHRASE` case in `buildUserPrompt`.

- [ ] **Step 1: Write the failing eval-prompt test**

Add to `packages/ai/src/evaluate.test.ts` (or the file that tests `buildUserPrompt`):

```ts
it("buildUserPrompt renders a contextual_paraphrase exercise with the constraint + reference paraphrases", () => {
  const prompt = buildUserPrompt(
    {
      type: ExerciseType.CONTEXTUAL_PARAPHRASE,
      instructions: "Rewrite.",
      sourceText: "Me gusta el café.",
      constraintKind: "avoid",
      bannedTerms: ["gustar"],
      constraintLabel: "Say this without «gustar».",
      referenceParaphrases: ["Disfruto del café."],
    },
    "Adoro el café.",
    Language.ES,
    "B1" as never,
  );
  expect(prompt).toMatch(/Me gusta el café/);
  expect(prompt).toMatch(/gustar/);
  expect(prompt).toMatch(/Adoro el café/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/ai test -- evaluate.test.ts -t "contextual_paraphrase"`
Expected: FAIL — `default` throws `Unknown exercise type: contextual_paraphrase`.

- [ ] **Step 3: Add the helper** (near `buildSentenceConstructionUserPrompt`)

```ts
function buildContextualParaphraseUserPrompt(
  exercise: ContextualParaphraseContent,
  userAnswer: string,
  language: Language,
  difficulty: CefrLevel,
): string {
  const constraintDetail =
    exercise.constraintKind === "avoid"
      ? `The learner must NOT use these words/structures: ${(exercise.bannedTerms ?? []).join(", ")}.`
      : exercise.constraintKind === "register"
        ? `The rewrite must be in ${exercise.targetRegister} register.`
        : `The rewrite must be simplified for: ${exercise.audience}.`;
  return `Evaluate this ${language} contextual-paraphrase answer at CEFR ${difficulty}.

Original sentence: ${exercise.sourceText}
Task: ${exercise.constraintLabel}
Constraint: ${constraintDetail}
Model paraphrases (for reference — accept any valid alternative): ${exercise.referenceParaphrases.join(" / ")}

Learner's paraphrase: ${userAnswer}

Score taskAchievement on BOTH meaning preservation AND constraint adherence: a rewrite that changes the meaning OR violates the constraint (uses a banned term / wrong register / not simplified) scores low on taskAchievement even if otherwise fluent. Score grammarAccuracy on the rewrite's grammar and vocabularyRange on the lexis reached for (reward valid synonyms/circumlocution). List concrete errors with corrections.`;
}
```

Add `ContextualParaphraseContent` to the shared import in `prompts.ts`.

- [ ] **Step 4: Add the switch case** (before `default`)

```ts
    case ExerciseType.CONTEXTUAL_PARAPHRASE:
      base = buildContextualParaphraseUserPrompt(exercise, userAnswer, language, difficulty);
      break;
```

- [ ] **Step 5: Decide the eval version bump**

The shared `EVALUATION_SYSTEM_PROMPT` body is unchanged (only a new user-prompt helper is added), matching how `SENTENCE_CONSTRUCTION` is handled. Per that precedent, do NOT bump `EVALUATION_SYSTEM_PROMPT_VERSION` unless you edit the system prompt body. Leave it as-is.

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @language-drill/ai test -- evaluate.test.ts -t "contextual_paraphrase"` → PASS.
Run: `pnpm --filter @language-drill/ai typecheck` → exit 0. Then `pnpm --filter @language-drill/ai test` → all AI tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/ai/src/prompts.ts packages/ai/src/evaluate.test.ts
git commit -m "feat(ai): contextual-paraphrase evaluation prompt (generic evaluator)"
git push -u origin worktree-feat+contextual-paraphrase-exercise
```

(Build the ai package now so db/lambda pick up new exports: `pnpm --filter @language-drill/ai build`.)

---

## Task 6: Curriculum types — `paraphrase` kind + config field + invariant

**Files:**
- Modify: `packages/shared/src/curriculum-types.ts` (`kind` union ~54; doc block ~30-50; new field near `freeWriting` ~183-192)
- Modify: `packages/db/src/curriculum/index.ts` (`assertCurriculumInvariants` ~130-339; the 9e free-writing pattern ~282-292; coverageSpec gate 9d ~294-338)
- Test: `packages/db/src/curriculum/curriculum.test.ts`

**Interfaces:**
- Produces: `GrammarPoint.kind` includes `'paraphrase'`; `GrammarPoint.paraphrase?: { seeds: readonly string[] }`; invariant "paraphrase config present iff kind==='paraphrase'" + "paraphrase.seeds non-empty".

- [ ] **Step 1: Write the failing invariant test**

Add to `packages/db/src/curriculum/curriculum.test.ts`:

```ts
it("rejects a paraphrase umbrella with no paraphrase config", () => {
  expect(() =>
    assertCurriculumInvariants([
      {
        key: "es-b1-paraphrase",
        kind: "paraphrase",
        name: "Paraphrase (B1)",
        description: "x",
        cefrLevel: "B1",
        language: "es",
        examplesPositive: ["a", "b"],
        examplesNegative: ["*c"],
        commonErrors: ["d"],
        // paraphrase config intentionally missing
      } as never,
    ]),
  ).toThrow(/paraphrase/i);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/db test -- curriculum.test.ts -t "paraphrase umbrella with no paraphrase config"`
Expected: FAIL — no error thrown (invariant absent) OR a `kind` type error.

- [ ] **Step 3: Extend the `kind` union + doc block** in `packages/shared/src/curriculum-types.ts`

```ts
  kind: 'grammar' | 'vocab' | 'dictation' | 'free-writing' | 'paraphrase';
```

Add a bullet to the doc block (lines ~30-50) describing `'paraphrase'`: a synthetic per-`(language, level)` umbrella owning one contextual-paraphrase cell; carries no grammar-point semantics; its name/description/examples frame the generation prompt; `paraphrase.seeds` is the scenario-seed rotation pool.

- [ ] **Step 4: Add the config field** (near `freeWriting`)

```ts
  /**
   * Contextual-paraphrase umbrella config. REQUIRED iff kind === 'paraphrase'.
   * `seeds` is the per-ordinal scenario-seed rotation pool (the diversity
   * backbone) — analogous to conjugationSeedWords / elicitationSeedValues.
   * Size it comfortably above the cell target so per-ordinal rotation does not
   * exhaust. Enforced by a curriculum invariant.
   */
  paraphrase?: { seeds: readonly string[] };
```

- [ ] **Step 5: Add the invariant** in `packages/db/src/curriculum/index.ts` (mirror the 9e free-writing block)

```ts
    // 9i. paraphrase config is present iff the entry is a paraphrase umbrella,
    // and its seed pool is non-empty.
    if (entry.kind === 'paraphrase' && (!entry.paraphrase || entry.paraphrase.seeds.length === 0)) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' is kind 'paraphrase' but has no non-empty paraphrase.seeds`,
      );
    }
    if (entry.kind !== 'paraphrase' && entry.paraphrase) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' has paraphrase config but is not kind 'paraphrase'`,
      );
    }
```

The coverageSpec gate 9d already rejects a coverageSpec on non-grammar kinds, which correctly forbids one on a paraphrase umbrella — no change needed there.

- [ ] **Step 6: Run test + typecheck**

Run: `pnpm --filter @language-drill/db test -- curriculum.test.ts -t "paraphrase umbrella with no paraphrase config"` → PASS.
Run: `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/db typecheck` → exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/curriculum-types.ts packages/db/src/curriculum/index.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "feat(curriculum): add 'paraphrase' umbrella kind + config invariant"
```

---

## Task 7: Cell derivation — compatibleTypes + cell-key regex

**Files:**
- Modify: `packages/db/src/generation/cells.ts` (kind-type consts ~51-60; `compatibleTypes` ~62-80)
- Modify: `packages/db/src/lib/cell-key.ts` (`CELL_KEY_REGEX` ~22)
- Test: `packages/db/src/generation/cells.test.ts`

**Interfaces:**
- Produces: `compatibleTypes(paraphraseUmbrella)` returns `[ExerciseType.CONTEXTUAL_PARAPHRASE]`; `CELL_KEY_REGEX` accepts `…:contextual_paraphrase:…`.

- [ ] **Step 1: Write the failing test**

Add to `packages/db/src/generation/cells.test.ts`:

```ts
it("compatibleTypes returns contextual_paraphrase for a paraphrase umbrella", () => {
  const umbrella = {
    key: "es-b1-paraphrase",
    kind: "paraphrase",
    paraphrase: { seeds: ["a"] },
  } as never;
  expect(compatibleTypes(umbrella)).toEqual([ExerciseType.CONTEXTUAL_PARAPHRASE]);
});
```

Also extend the existing type-membership allowlist test at `cells.test.ts:70` to include `ExerciseType.CONTEXTUAL_PARAPHRASE` in its expected set.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/db test -- cells.test.ts -t "paraphrase umbrella"`
Expected: FAIL — falls through to the grammar branch, returns cloze/translation.

- [ ] **Step 3: Add the kind-type const + branch** in `packages/db/src/generation/cells.ts`

```ts
const PARAPHRASE_KIND_TYPES: ReadonlyArray<ExerciseType> = [
  ExerciseType.CONTEXTUAL_PARAPHRASE,
];
```

In `compatibleTypes`, add before the grammar `base` logic:

```ts
  if (entry.kind === 'paraphrase') return PARAPHRASE_KIND_TYPES;
```

- [ ] **Step 4: Update the cell-key regex** in `packages/db/src/lib/cell-key.ts`

```ts
const CELL_KEY_REGEX = /^(es|de|tr):(a1|a2|b1|b2):(cloze|translation|vocab_recall|sentence_construction|dictation|free_writing|conjugation|contextual_paraphrase):[a-z0-9-]+$/;
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @language-drill/db test -- cells.test.ts` → PASS.
Run: `pnpm --filter @language-drill/db typecheck` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/generation/cells.ts packages/db/src/lib/cell-key.ts packages/db/src/generation/cells.test.ts
git commit -m "feat(db): emit contextual_paraphrase cells for paraphrase umbrellas"
```

---

## Task 8: Diversity — prior-surface avoid-list + scenario-seed rotation

**Files:**
- Modify: `packages/db/src/generation/run-one-cell.ts` (`fetchPriorFreeWritingTitles` neighbour ~306-341; `priorPoolSurfaces` arm ~707-712; `seedKindFor` ~465-498; `buildSeedWords` ~506-569)
- Test: `packages/db/src/generation/run-one-cell.test.ts`

**Interfaces:**
- Consumes: `Cell`, `paraphrase.seeds`.
- Produces: `fetchPriorParaphraseSurfaces(db, cell): Promise<readonly string[]>` (distinct source sentences); `seedKindFor` returns `'elicitation-values'` for a paraphrase cell so the curated seed pool + `fetchPriorSeeds` cross-run exclude engage; `buildSeedWords` sources the band from `paraphrase.seeds`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/db/src/generation/run-one-cell.test.ts`:

```ts
it("seedKindFor returns 'elicitation-values' for a paraphrase cell", () => {
  const cell = {
    exerciseType: ExerciseType.CONTEXTUAL_PARAPHRASE,
    grammarPoint: { kind: "paraphrase", paraphrase: { seeds: ["s1", "s2"] } },
  } as never;
  expect(seedKindFor(cell)).toBe("elicitation-values");
});

it("buildSeedWords draws paraphrase seeds from paraphrase.seeds", async () => {
  const cell = {
    language: "es",
    cefrLevel: "B1",
    exerciseType: ExerciseType.CONTEXTUAL_PARAPHRASE,
    grammarPoint: { kind: "paraphrase", paraphrase: { seeds: ["scenario-a", "scenario-b", "scenario-c"] } },
  } as never;
  const seeds = await buildSeedWords({} as never, cell, 2, "batch-1", new Set());
  expect(seeds).toHaveLength(2);
  expect(seeds!.every((s) => s === null || ["scenario-a", "scenario-b", "scenario-c"].includes(s))).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/db test -- run-one-cell.test.ts -t "paraphrase"`
Expected: FAIL — `seedKindFor` returns `null`; `buildSeedWords` returns `undefined`.

- [ ] **Step 3: Add `fetchPriorParaphraseSurfaces`** (mirror `fetchPriorFreeWritingTitles`, reading `sourceText`)

```ts
/**
 * Distinct paraphrase source sentences already approved/flagged in this cell,
 * fed into the generation prompt as an avoid-list (cross-run dedup). The dedup
 * surface for contextual_paraphrase is the source sentence, so without this the
 * generator re-proposes the same sentence every run and `exercises_dedup_idx`
 * rejects it. Deterministically ordered, capped so the prompt stays bounded.
 */
export async function fetchPriorParaphraseSurfaces(
  db: Db,
  cell: Cell,
): Promise<readonly string[]> {
  const rows = await db
    .select({ src: sql<string>`content_json->>'sourceText'` })
    .from(exercises)
    .where(
      and(
        eq(exercises.language, cell.language),
        eq(exercises.difficulty, cell.cefrLevel),
        eq(exercises.type, cell.exerciseType),
        eq(exercises.grammarPointKey, cell.grammarPoint.key),
        inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved', 'flagged']),
        sql`content_json ? 'sourceText'`,
      ),
    )
    .groupBy(sql`content_json->>'sourceText'`)
    .orderBy(sql`content_json->>'sourceText'`)
    .limit(60);
  return rows
    .map((r) => r.src)
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
}
```

- [ ] **Step 4: Wire the `priorPoolSurfaces` arm** — extend the conditional (~707-712)

```ts
    const priorPoolSurfaces =
      cell.exerciseType === ExerciseType.VOCAB_RECALL
        ? await fetchPriorVocabRecallSurfaces(db, cell)
        : cell.exerciseType === ExerciseType.FREE_WRITING
          ? await fetchPriorFreeWritingTitles(db, cell)
          : cell.exerciseType === ExerciseType.CONTEXTUAL_PARAPHRASE
            ? await fetchPriorParaphraseSurfaces(db, cell)
            : undefined;
```

- [ ] **Step 5: Add the `seedKindFor` branch** (before the final `return null`)

```ts
  if (cell.exerciseType === ExerciseType.CONTEXTUAL_PARAPHRASE) {
    // Curated scenario-seed rotation from the umbrella's paraphrase.seeds pool,
    // reusing the elicitation-values path: persisted as content_json.seedWord and
    // excluded cross-run via fetchPriorSeeds — the identity-diversity axis.
    return 'elicitation-values';
  }
```

- [ ] **Step 6: Add the `buildSeedWords` band source** — extend the `elicitation-values` arm so a paraphrase cell reads `paraphrase.seeds` (that arm currently reads `elicitationSeedValues`):

```ts
  if (kind === 'elicitation-values') {
    const band =
      cell.exerciseType === ExerciseType.CONTEXTUAL_PARAPHRASE
        ? (cell.grammarPoint.paraphrase?.seeds ?? [])
        : (cell.grammarPoint.elicitationSeedValues ?? []);
    return pickSeeds({ band, batchSeed, count, exclude: priorSeeds });
  }
```

(The cross-run exclude for `elicitation-values` already uses `fetchPriorSeeds` reading `content_json->>'seedWord'`, so no change to the `priorSeeds` branch is needed.)

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --filter @language-drill/db test -- run-one-cell.test.ts -t "paraphrase"` → PASS.
Run: `pnpm --filter @language-drill/db typecheck` → exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/generation/run-one-cell.ts packages/db/src/generation/run-one-cell.test.ts
git commit -m "feat(db): paraphrase diversity — source-sentence avoid-list + scenario-seed rotation"
```

---

## Task 9: Author the paraphrase umbrellas + curriculum version bumps

**Files:**
- Modify: `packages/db/src/curriculum/es.ts`, `de.ts`, `tr.ts`, `en.ts` (add umbrellas; bump `CURRICULUM_VERSION_<LANG>`)
- Test: `packages/db/src/curriculum/curriculum.test.ts` (count floors)

**Interfaces:**
- Consumes: `GrammarPoint` with `kind: 'paraphrase'` + `paraphrase.seeds` (Task 6).
- Produces: one paraphrase umbrella per `(language, level)` for each B1/B2(/C1/C2) level the language already carries umbrella kinds for.

- [ ] **Step 1: Determine the target umbrella set**

Run: `rg -n "kind: 'free-writing'|kind: 'dictation'" packages/db/src/curriculum/es.ts packages/db/src/curriculum/de.ts packages/db/src/curriculum/tr.ts packages/db/src/curriculum/en.ts | rg "b1|b2|c1|c2"`
Use the observed `(language, level)` coverage to decide which paraphrase umbrellas to author (B1–C2 only). Note: `en.ts` may not exist / may be minimal — only add umbrellas for languages with a curriculum file.

- [ ] **Step 2: Author one umbrella per target `(language, level)`** — example for ES B1 (repeat per level/language, varying seeds + level):

```ts
  {
    key: 'es-b1-paraphrase',
    kind: 'paraphrase',
    name: 'Paraphrase — say it another way (B1)',
    description:
      'Rewrite a B1 sentence under one constraint: avoid a given word, shift register, or simplify for an audience — preserving meaning while reaching for synonyms and alternative structures.',
    cefrLevel: B1,
    language: ES,
    examplesPositive: [
      'Source "Me encanta el cine" → without «encantar»: "Disfruto muchísimo del cine."',
      'Source "¿Me pasas la sal?" → formal register: "¿Sería tan amable de pasarme la sal?"',
    ],
    examplesNegative: ['*A rewrite that changes the meaning of the source.'],
    commonErrors: [
      'Using a banned word in a different inflected form.',
      'Changing register but also changing what is said.',
    ],
    paraphrase: {
      seeds: [
        'a complaint to a landlord',
        'describing a childhood memory',
        'asking a colleague for a deadline extension',
        'giving directions to a tourist',
        'declining an invitation politely',
        'explaining why you are late',
        'recommending a restaurant',
        'apologising for a mistake at work',
        'describing your morning routine',
        'asking for a refund in a shop',
        'inviting a friend to an event',
        'summarising a film you saw',
      ],
    },
  },
```

Author ≥ ~12 seeds per umbrella (comfortably above the cell target from Task 10). Keep seeds English scenario cues; vary them across levels so different umbrellas do not share identical pools.

- [ ] **Step 3: Bump the curriculum version for every language you touched**

In each edited curriculum file, bump `CURRICULUM_VERSION_<LANG>` to today's date (format `YYYY-MM-DD`, add `a`/`b` if already used), e.g.:

```ts
export const CURRICULUM_VERSION_ES = '2026-07-09';
```

- [ ] **Step 4: Update curriculum count assertions**

Run: `pnpm --filter @language-drill/db test -- curriculum.test.ts`
Expected: FAIL on per-language count floors / totals. Update those assertions to the new counts (add the number of umbrellas you authored). Re-run until green.

- [ ] **Step 5: Run the curriculum tests + typecheck**

Run: `pnpm --filter @language-drill/db test -- curriculum.test.ts` → PASS (invariants + counts).
Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db typecheck` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/curriculum/*.ts
git commit -m "feat(curriculum): paraphrase umbrellas (B1–C2) + version bumps"
```

---

## Task 10: Lambda ripple — targets, plan minutes/counts, radar axis, job allowlist

**Files:**
- Modify: `infra/lambda/src/generation/job-message.ts` (`VALID_EXERCISE_TYPES` ~106-114)
- Modify: `infra/lambda/src/generation/cell-targets.ts` (`CELL_TARGET_DEFAULTS` ~41-73)
- Modify: `infra/lambda/src/lib/today-plan.ts` (`ESTIMATED_MINUTES_BY_TYPE` ~26-40; `ITEM_COUNT_BY_TYPE` ~50-61)
- Modify: `infra/lambda/src/lib/progress-aggregation.ts` (`axisForExerciseType` ~91-117)
- Test: the co-located `*.test.ts` for each (`cell-targets.test.ts`, `today-plan.test.ts`, `progress-aggregation.test.ts`)

**Interfaces:**
- Produces: paraphrase accepted by the SQS job parser; a distinct-exercise target; plan minutes/count; radar axis `'writing'`.

- [ ] **Step 1: Write the failing tests**

`progress-aggregation.test.ts`:

```ts
it("maps contextual_paraphrase to the writing axis", () => {
  expect(axisForExerciseType(ExerciseType.CONTEXTUAL_PARAPHRASE)).toBe("writing");
});
```

`cell-targets.test.ts`:

```ts
it("has a target for contextual_paraphrase", () => {
  expect(CELL_TARGET_DEFAULTS[ExerciseType.CONTEXTUAL_PARAPHRASE]).toBeDefined();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/lambda test -- progress-aggregation.test.ts cell-targets.test.ts`
Expected: FAIL — axis returns `null`; `CELL_TARGET_DEFAULTS` typecheck error / undefined.

- [ ] **Step 3: `job-message.ts` — add to `VALID_EXERCISE_TYPES`** (runtime allowlist — missing this silently drops all paraphrase jobs)

```ts
  ExerciseType.CONTEXTUAL_PARAPHRASE,
```

- [ ] **Step 4: `cell-targets.ts` — add to `CELL_TARGET_DEFAULTS`** (production type, cap low like free_writing)

```ts
  [ExerciseType.CONTEXTUAL_PARAPHRASE]: { B1: 8, B2: 8 },
```

(Add `C1`/`C2` entries if you authored those umbrellas. Unset levels fall through to `TARGET_PER_CELL`; keeping it modest matches free_writing's low cap for open-ended production.)

- [ ] **Step 5: `today-plan.ts` — add to both Records**

```ts
  [ExerciseType.CONTEXTUAL_PARAPHRASE]: 3, // ESTIMATED_MINUTES_BY_TYPE
```
```ts
  [ExerciseType.CONTEXTUAL_PARAPHRASE]: 2, // ITEM_COUNT_BY_TYPE
```

(v1: do NOT add paraphrase to the hand-picked `V1_PLAN_SHAPE` / `CORE_TYPE_CYCLE` / `BACKFILL_TYPE_PRIORITY` lists — it stays selectable on demand but is not auto-composed into the default plan. This is a deliberate scope choice; revisit after the pool fills.)

- [ ] **Step 6: `progress-aggregation.ts` — add the case**

```ts
    case ExerciseType.CONTEXTUAL_PARAPHRASE:
      return 'writing';
```

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm --filter @language-drill/lambda test -- progress-aggregation.test.ts cell-targets.test.ts today-plan.test.ts` → PASS.
Run: `pnpm --filter @language-drill/lambda typecheck` → exit 0.

- [ ] **Step 8: Commit**

```bash
git add infra/lambda/src/generation/job-message.ts infra/lambda/src/generation/cell-targets.ts infra/lambda/src/lib/today-plan.ts infra/lambda/src/lib/progress-aggregation.ts
git commit -m "feat(lambda): wire contextual_paraphrase (job allowlist, targets, plan, radar axis)"
```

---

## Task 11: Web drill component + test

**Files:**
- Create: `apps/web/app/(dashboard)/drill/_components/contextual-paraphrase-exercise.tsx`
- Create: `apps/web/app/(dashboard)/drill/_components/__tests__/contextual-paraphrase-exercise.test.tsx`

**Interfaces:**
- Consumes: `ContextualParaphraseContent`, `SubmissionState`, `SubmissionMeta`, `CoachNudge`, the drill helpers (`useAnswerDraft`, `submitOnModEnter`, `translationVerdict`, `stripInlineMarkdown`, `useDrillAction`, `FeedbackShell`).
- Produces: `ContextualParaphraseExercise` component + `ContextualParaphraseExerciseProps`.

- [ ] **Step 1: Write the failing component test** (mirror `sentence-construction-exercise.test.tsx`)

Create `.../__tests__/contextual-paraphrase-exercise.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExerciseType, Language, type ContextualParaphraseContent } from '@language-drill/shared';
import {
  ContextualParaphraseExercise,
  type ContextualParaphraseExerciseProps,
  type SubmissionState,
} from '../contextual-paraphrase-exercise';

const baseContent: ContextualParaphraseContent = {
  type: ExerciseType.CONTEXTUAL_PARAPHRASE,
  instructions: 'Rewrite the sentence.',
  sourceText: 'Me gusta mucho el café.',
  constraintKind: 'avoid',
  bannedTerms: ['gustar'],
  constraintLabel: 'Say this without using «gustar».',
  referenceParaphrases: ['Disfruto mucho del café.', 'Adoro el café.'],
};

const idle: SubmissionState = { kind: 'idle' };
const evaluated: SubmissionState = {
  kind: 'evaluated',
  result: { score: 0.8, grammarAccuracy: 0.8, vocabularyRange: 'B1', taskAchievement: 0.8, feedback: 'good', errors: [], estimatedCefrEvidence: 'B1' },
  meta: {},
};

function renderEx(overrides: Partial<ContextualParaphraseExerciseProps> = {}) {
  const props: ContextualParaphraseExerciseProps = {
    content: baseContent, language: Language.ES, submission: idle,
    onSubmit: vi.fn(), onNext: vi.fn(), ...overrides,
  };
  return { props, ...render(<ContextualParaphraseExercise {...props} />) };
}

describe('ContextualParaphraseExercise', () => {
  it('renders the source sentence and the constraint label', () => {
    renderEx();
    expect(screen.getByText('Me gusta mucho el café.')).toBeInTheDocument();
    expect(screen.getByText(/Say this without using/)).toBeInTheDocument();
  });
  it('shows banned terms for an avoid constraint', () => {
    renderEx();
    expect(screen.getByText('gustar')).toBeInTheDocument();
  });
  it('submits the typed paraphrase with hintCount 0', () => {
    const onSubmit = vi.fn();
    renderEx({ onSubmit });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Adoro el café.' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith('Adoro el café.', expect.objectContaining({ hintCount: 0 }));
  });
  it('reveals a reference paraphrase and submits with hintCount 1', () => {
    const onSubmit = vi.fn();
    renderEx({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: /show an example/i }));
    expect(screen.getByText(/Disfruto mucho del café\./)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith('x', expect.objectContaining({ hintCount: 1 }));
  });
  it('renders score + reference paraphrases when evaluated', () => {
    renderEx({ submission: evaluated });
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Disfruto mucho del café.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/web test -- contextual-paraphrase-exercise.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component** (adapt `sentence-construction-exercise.tsx`: source sentence in place of prompt; banned-term chips only for `avoid`; register/audience line for the other kinds; single reference-reveal; reference paraphrases card in feedback)

```tsx
'use client';

import * as React from 'react';
import type {
  EvaluationError,
  LearningLanguage,
  ContextualParaphraseContent,
} from '@language-drill/shared';
import { AccentPicker, Button, Card, Textarea } from '../../../../components/ui';
import { useAnswerDraft } from '../../../../lib/drill/use-answer-draft';
import { submitOnModEnter } from '../../../../lib/drill/keyboard';
import { translationVerdict } from '../../../../lib/drill/verdict-tier';
import { stripInlineMarkdown } from '../../../../lib/drill/strip-inline-markdown';
import { useDrillAction } from './drill-action-context';
import { FeedbackShell, type CoachNudge } from './feedback-shell';
import type { SubmissionMeta, SubmissionState } from './types';

export type { SubmissionMeta, SubmissionState } from './types';

export interface ContextualParaphraseExerciseProps {
  content: ContextualParaphraseContent;
  language: LearningLanguage;
  submission: SubmissionState;
  onSubmit: (answer: string, meta: SubmissionMeta) => void;
  onNext: () => void;
  nextLabel?: string;
  exerciseId?: string;
  coach?: CoachNudge | null;
}

function isAccentLanguage(lang: string): lang is 'ES' | 'DE' | 'TR' {
  return lang === 'ES' || lang === 'DE' || lang === 'TR';
}

const SEVERITY_COLOR: Record<EvaluationError['severity'], string> = {
  minor: 'text-ok',
  major: 'text-accent-2',
};

function constraintDetailLine(content: ContextualParaphraseContent): string | null {
  if (content.constraintKind === 'register' && content.targetRegister) {
    return `register: ${content.targetRegister}`;
  }
  if (content.constraintKind === 'simplify' && content.audience) {
    return `audience: ${content.audience}`;
  }
  return null;
}

export function ContextualParaphraseExercise({
  content, language, submission, onSubmit, onNext, nextLabel, exerciseId, coach,
}: ContextualParaphraseExerciseProps) {
  const [answer, setAnswer, clearDraft] = useAnswerDraft(exerciseId);
  const [exampleShown, setExampleShown] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => { textareaRef.current?.focus(); }, []);

  const isLocked = submission.kind !== 'idle';
  const showAccentPicker = isAccentLanguage(language);
  const canSubmit = answer.trim().length > 0;
  const detail = constraintDetailLine(content);

  function handleSubmit() {
    if (!canSubmit || isLocked) return;
    onSubmit(answer, { hintCount: exampleShown ? 1 : 0 });
    clearDraft();
  }

  const { active, setPrimaryAction } = useDrillAction();
  React.useEffect(() => {
    if (!active || submission.kind === 'evaluated') return;
    setPrimaryAction({
      label: 'submit', onClick: handleSubmit, variant: 'primary',
      disabled: !canSubmit || isLocked, loading: submission.kind === 'submitting',
    });
  }, [active, setPrimaryAction, submission.kind, canSubmit, isLocked, answer, exampleShown]);

  return (
    <div className="flex flex-col gap-s-4">
      <p className="t-micro text-ink-mute">contextual paraphrase · {language}</p>

      {content.instructions && (
        <p className="t-small text-ink-mute">{stripInlineMarkdown(content.instructions)}</p>
      )}

      <p className="t-display-s">{stripInlineMarkdown(content.sourceText)}</p>

      <p className="t-body">{stripInlineMarkdown(content.constraintLabel)}</p>

      {content.constraintKind === 'avoid' && content.bannedTerms && content.bannedTerms.length > 0 && (
        <div className="flex flex-col gap-s-1">
          <p className="t-micro text-ink-mute">must not use</p>
          <div className="flex flex-wrap gap-s-2">
            {content.bannedTerms.map((t) => (
              <span key={t} className="t-small rounded-full bg-paper-2 px-s-3 py-s-1 line-through">{t}</span>
            ))}
          </div>
        </div>
      )}

      {detail && <p className="t-small text-ink-mute">{detail}</p>}

      <div className="flex flex-col gap-s-3">
        <Textarea
          ref={textareaRef}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={submitOnModEnter(handleSubmit)}
          readOnly={isLocked}
          disabled={isLocked}
          className={isLocked ? 'opacity-60' : undefined}
        />
        {showAccentPicker && (
          <AccentPicker language={language} targetRef={textareaRef} disabled={isLocked} />
        )}
      </div>

      {exampleShown && (
        <p className="t-small text-ink-mute">e.g. {content.referenceParaphrases[0]}</p>
      )}
      {!exampleShown && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setExampleShown(true)} disabled={isLocked}>
          show an example
        </Button>
      )}

      {!active && submission.kind !== 'evaluated' && (
        <div className="mt-s-6 flex justify-end">
          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit || isLocked} loading={submission.kind === 'submitting'}>
            submit
          </Button>
        </div>
      )}

      {submission.kind === 'evaluated' && (() => {
        const verdict = translationVerdict(submission.result.score);
        const errors = submission.result.errors ?? [];
        return (
          <FeedbackShell
            tier={verdict.tier}
            label={verdict.label}
            scoreChipText={`${Math.round(submission.result.score * 100)}%`}
            hintLevel={exampleShown ? 1 : 0}
            coach={coach}
            onNext={onNext}
            nextLabel={nextLabel}
          >
            <div className="flex flex-col gap-s-4">
              {submission.result.feedback && <p className="t-body">{submission.result.feedback}</p>}
              {errors.length > 0 && (
                <ul className="flex flex-col gap-s-3">
                  {errors.map((err, idx) => {
                    if (!err || typeof err.text !== 'string' || typeof err.correction !== 'string' ||
                        (err.severity !== 'minor' && err.severity !== 'major')) return null;
                    return (
                      <li key={idx} className="flex flex-col gap-s-1">
                        <div className="flex flex-wrap items-baseline gap-s-2">
                          <span className="line-through text-ink-mute">{err.text}</span>
                          <span aria-hidden="true" className="text-ink-mute">&rarr;</span>
                          <span className={SEVERITY_COLOR[err.severity]}>{err.correction}</span>
                        </div>
                        {err.explanation && <p className="t-small text-ink-mute">{err.explanation}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
              <Card padding="md" className="bg-paper-2">
                <p className="t-micro text-ink-mute">other ways to say it</p>
                <ul className="mt-s-1 flex flex-col gap-s-1">
                  {content.referenceParaphrases.map((m, i) => (<li key={i}>{m}</li>))}
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- contextual-paraphrase-exercise.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/_components/contextual-paraphrase-exercise.tsx" "apps/web/app/(dashboard)/drill/_components/__tests__/contextual-paraphrase-exercise.test.tsx"
git commit -m "feat(web): contextual-paraphrase drill component"
```

---

## Task 12: Web wiring — pane dispatch, labels, coach messages, debrief

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/_components/exercise-pane.tsx` (imports ~4-22; branch after SC ~130-144; fallthrough ~161)
- Modify: `apps/web/app/(dashboard)/_lib/timeline-labels.ts` (`TYPE_LABELS` ~27-35)
- Modify: `apps/web/lib/drill/coach-messages.ts` (`idleMessage` ~10-31; `evaluatedMessage` ~40-125)
- Modify: `apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx` (guard imports ~4-17; ternary chain ~79-104; add `ContextualParaphraseBody`)
- Test: `apps/web/app/(dashboard)/_lib/__tests__/timeline-labels.test.ts`, `apps/web/lib/drill/__tests__/coach-messages.test.ts`

**Interfaces:**
- Consumes: `isContextualParaphraseContent`, `ContextualParaphraseExercise`.

- [ ] **Step 1: Update the label test (failing)**

In `timeline-labels.test.ts`, extend the expected-labels assertion to include `[ExerciseType.CONTEXTUAL_PARAPHRASE]: 'paraphrase'`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/web test -- timeline-labels.test.ts coach-messages.test.ts`
Expected: FAIL — missing label; and coach-messages typecheck/`never` break at build.

- [ ] **Step 3: `timeline-labels.ts` — add the label**

```ts
  [ExerciseType.CONTEXTUAL_PARAPHRASE]: 'paraphrase',
```

- [ ] **Step 4: `coach-messages.ts` — add both cases**

`idleMessage`:

```ts
    case ExerciseType.CONTEXTUAL_PARAPHRASE:
      return "say it another way · keep the meaning";
```

`evaluatedMessage` (tier sub-switch, mirroring the SC case):

```ts
    case ExerciseType.CONTEXTUAL_PARAPHRASE:
      switch (tier) {
        case "praise":
          return "same meaning, fresh wording · excellent";
        case "light":
          return "good paraphrase · one small tweak";
        case "encourage":
          return "close · keep the meaning and try again";
        case "reset":
          return "tricky · let's rebuild the rewrite";
      }
      break;
```

- [ ] **Step 5: `exercise-pane.tsx` — import guard + component, add branch**

Add `isContextualParaphraseContent` to the shared import; import `ContextualParaphraseExercise`. Add after the SC branch:

```tsx
  if (isContextualParaphraseContent(content)) {
    return (
      <ContextualParaphraseExercise
        key={exercise.id}
        content={content}
        language={language}
        submission={submission}
        onSubmit={onSubmit}
        onNext={onNext}
        nextLabel={nextLabel}
        exerciseId={exercise.id}
        coach={coach}
      />
    );
  }
```

- [ ] **Step 6: `review-item-card.tsx` — add guard import, ternary branch, and body**

Add `isContextualParaphraseContent` to the guard import. In the ternary chain add before the closing `: null`:

```tsx
          ) : isContextualParaphraseContent(content) ? (
            <ContextualParaphraseBody item={item} content={content} />
```

Add the body component (adapt `SentenceConstructionBody`, source sentence at top, reference paraphrase as "reference"/"one accepted form"):

```tsx
interface ContextualParaphraseBodyProps {
  item: DebriefItem;
  content: ContextualParaphraseContent;
}

function ContextualParaphraseBody({ item, content }: ContextualParaphraseBodyProps) {
  const isCorrect = item.status === 'correct';
  return (
    <>
      <p className="t-small italic mb-s-2">"{content.sourceText}"</p>
      <p className="t-small mb-s-2 text-ink-mute">{content.constraintLabel}</p>
      <div className="grid grid-cols-2 mobile:grid-cols-1 gap-s-3">
        <div className="rounded-md p-s-3 bg-paper-2">
          <div className="t-micro">your paraphrase</div>
          <div className="mt-s-2" style={{ fontFamily: 'var(--font-display)', fontSize: 16, lineHeight: 1.4,
            textDecoration: isCorrect ? 'none' : 'line-through',
            color: isCorrect ? 'var(--color-ok)' : 'var(--color-accent-2)' }}>
            {item.userAnswer ?? ''}
          </div>
        </div>
        <div className="rounded-md p-s-3" style={{ background: isCorrect ? 'transparent' : 'var(--color-ok-soft)',
          border: isCorrect ? '1px dashed var(--color-rule)' : 'none' }}>
          <div className="t-micro">{isCorrect ? 'one accepted form' : 'reference'}</div>
          <div className="mt-s-2" style={{ fontFamily: 'var(--font-display)', fontSize: 16, lineHeight: 1.4 }}>
            {content.referenceParaphrases[0] ?? ''}
          </div>
          {content.referenceParaphrases.length > 1 && (
            <p className="t-small mt-s-2 text-ink-mute">e.g. {content.referenceParaphrases.slice(1).join(' / ')}</p>
          )}
        </div>
      </div>
      {item.evaluation?.feedback && <p className="t-small mt-s-3">{item.evaluation.feedback}</p>}
    </>
  );
}
```

Add `ContextualParaphraseContent` to the type imports in `review-item-card.tsx`.

- [ ] **Step 7: Run tests + typecheck + web build**

Run: `pnpm --filter @language-drill/web test -- timeline-labels.test.ts coach-messages.test.ts` → PASS.
Run: `pnpm --filter @language-drill/web typecheck` → exit 0.
Run: `pnpm --filter @language-drill/web build` → exit 0 (catches Next prerender issues the unit gate misses).

- [ ] **Step 8: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/_components/exercise-pane.tsx" "apps/web/app/(dashboard)/_lib/timeline-labels.ts" "apps/web/lib/drill/coach-messages.ts" "apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx" "apps/web/app/(dashboard)/_lib/__tests__/timeline-labels.test.ts"
git commit -m "feat(web): wire contextual_paraphrase into pane, labels, coach, debrief"
```

---

## Task 13: Test-allowlist sweep + full gate

**Files:**
- Modify: `infra/lambda/src/routes/admin.test.ts` (type allowlist ~248), any other full-set enumerations surfaced by grep
- Verify: whole repo

- [ ] **Step 1: Grep for remaining full-set enumerations**

Run: `rg -n "sentence_construction.*dictation|cloze.*translation.*vocab|'conjugation'\]" --type ts`
Fix any array/allowlist that enumerates the 7-type set to include `contextual_paraphrase` — notably `infra/lambda/src/routes/admin.test.ts:248`.

- [ ] **Step 2: Clean stale compiled tests, rebuild, run the full serial gate**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/feat+contextual-paraphrase-exercise
rm -rf infra/lambda/dist
pnpm build
pnpm turbo run test --concurrency=1
```
Expected: all packages pass. Fix any surfaced count/allowlist assertions (they are the intended ripple), re-run until green.

- [ ] **Step 3: Lint + typecheck**

```bash
pnpm lint
pnpm typecheck
```
Expected: exit 0 both.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: extend exercise-type allowlists for contextual_paraphrase; full suite green"
git push
```

---

## Task 14: Quality gate + Langfuse prompt sync (deploy-time)

**Files:** none (operational)

- [ ] **Step 1: Contract + diversity check via eval:gen**

Build a small paraphrase cell dataset and run `pnpm eval:gen` (see the CLAUDE.md table / `docs`), comparing `--baseline repo` vs `--candidate repo` on paraphrase cells. Confirm: approval rate is healthy (generate↔validate agree), constraint-kind distribution is spread across avoid/register/simplify, and distinct `sourceText` values dominate (diversity works). If approval is low, inspect rejection reasons and adjust the generation/validation prompts (Tasks 3–4) before merge.

- [ ] **Step 2: Note the Langfuse push requirement for merge**

The generation SYSTEM template changed (new `{{contextualParaphraseSection}}` placeholder), so after merge each environment's Langfuse project must be synced or the runtime serves the old template body. Record in the PR description: run `pnpm push-prompts` (dry-run then apply) per environment for the generation prompt, per the CLAUDE.md "Prompt Editing" runbook. The validation/eval user-prompt helpers ship with the code deploy (no push needed). `EVALUATION_SYSTEM_PROMPT_VERSION` unchanged.

- [ ] **Step 3 (post-merge, operational):** the scheduler picks up the new cells on the next ~04:00 UTC run (guaranteed by the `CURRICULUM_VERSION` bumps). No code action.

---

## Task 15: Doc-status refresh — `docs/exercise-strategy.md`

**Files:**
- Modify: `docs/exercise-strategy.md` (per-section `**Status:**` lines)

- [ ] **Step 1: Verify each claim against the enum before editing**

Confirm `SENTENCE_CONSTRUCTION`, `FREE_WRITING`, `CONJUGATION`, `DICTATION`, `CONTEXTUAL_PARAPHRASE` are all in `ExerciseType` (they are, after this feature).

- [ ] **Step 2: Edit the Status lines**

- #4 Sentence Construction (line ~124): `**Status:** Implemented`
- #6 Paragraph / Free Writing (line ~196): `**Status:** Implemented`
- #7 Listening Comprehension (line ~243): `**Status:** Partially implemented — Dictation sub-type live (Polly audio); comprehension-questions and gap-fill-from-audio not yet built`
- #10 Contextual Paraphrase (line ~362): `**Status:** Implemented`
- #14 Conjugation / Inflection Drill (line ~510): `**Status:** Implemented (deterministic-first grading)` — keep the scaffolding/remediation framing prose.

- [ ] **Step 3: Reconcile the Implementation Order section if inconsistent** (optional) — the "Phase 1 already implemented" note now understates progress; add a short parenthetical noting Phases 2–3 text types (SC, free writing, conjugation, contextual paraphrase) are shipped, dictation covers the listening entry point.

- [ ] **Step 4: Commit**

```bash
git add docs/exercise-strategy.md
git commit -m "docs: refresh exercise-strategy statuses (SC, free-writing, conjugation, dictation, paraphrase)"
git push
```

---

## Definition of Done

- `pnpm turbo run test --concurrency=1`, `pnpm lint`, `pnpm typecheck`, and `pnpm --filter @language-drill/web build` all pass from the worktree.
- `eval:gen` shows a healthy paraphrase approval rate with constraint-kind + source-sentence diversity.
- A paraphrase exercise renders, submits, evaluates, and appears in the debrief in the running app.
- `docs/exercise-strategy.md` statuses corrected.
- PR description records the required `push-prompts` step for the generation template.
