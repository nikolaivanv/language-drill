# Pool Coverage Controller — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make exercise-pool diversity a measured, queryable quantity — the validator emits the realized coverage value (`person`/`wordClass`/`polarity`/`sentenceType`) of each draft, those values are persisted on the exercise row, surfaced per-cell on `GET /admin/pool-status`, and backfilled onto the existing pool.

**Architecture:** A new shared `coverage` module defines the axes, their value sets, and the pure applicability rule. The generation-time validator (`packages/ai`) gains a non-required `coverage` tool field read leniently into `ValidationResult`. The persistence path (`packages/db`) writes the cell-applicable subset to a new `coverage_tags` JSONB column. The admin endpoint (`infra/lambda`) aggregates it generically via `LATERAL jsonb_each_text`. A one-off CLI replays the validator over legacy approved rows. **Measurement-only** — no generation-prompt or scheduler changes.

**Tech Stack:** TypeScript, pnpm workspaces + Turborepo, Drizzle ORM (Neon Postgres, serverless/ws driver), Anthropic SDK, Hono (Lambda), Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-13-pool-coverage-controller-phase-0-design.md`

---

## Build / test notes (read once before starting)

- **Stale `db/dist`:** `packages/db` and `infra/lambda` import the **compiled** `@language-drill/ai` and `@language-drill/shared`. After editing `packages/shared` or `packages/ai` source, run `pnpm build` (turbo) from the repo root **before** running db/infra tests, or they test against stale dist.
- **Infra parallel flake:** the full `pnpm test` flakily fails `infra` under parallel load. To confirm green, use `pnpm turbo run test --concurrency=1`.
- **Targeted test runs:** `pnpm --filter @language-drill/<pkg> test -- <file>` (e.g. `pnpm --filter @language-drill/ai test -- validate.test.ts`).
- Work happens in the worktree `/.claude/worktrees/feat-pool-coverage-controller-phase-0` on branch `feat-pool-coverage-controller-phase-0`.

---

## File Structure

**Create:**
- `packages/shared/src/coverage.ts` — axis codes, value sets, `CoverageTags`/`CoverageAxis` types, `coverageAxesFor`, `pickCoverageTags`. One responsibility: the coverage vocabulary + pure applicability rule, importable by `ai`, `db`, and tests.
- `packages/shared/src/coverage.test.ts`
- `packages/db/scripts/backfill-coverage-tags.ts` — one-off CLI.
- `packages/db/scripts/backfill-coverage-tags.test.ts`

**Modify:**
- `packages/shared/src/index.ts` — re-export `./coverage`.
- `packages/ai/src/validate.ts` — `coverage` tool field, `ValidationResult.coverage`, lenient parse.
- `packages/ai/src/validation-prompts.ts` — per-axis directive + `VALIDATION_PROMPT_VERSION` bump.
- `packages/ai/src/validate.test.ts`, `packages/ai/src/validation-prompts.test.ts` (or the existing colocated test) — tests.
- `packages/db/src/schema/exercises.ts` — `coverage_tags` column.
- `packages/db/src/generation/coverage-tags.ts` (new small file) + `index.ts` re-export — `applicableCoverageTags` wrapper.
- `packages/db/src/generation/validate-and-insert.ts` — write `coverageTags` at INSERT.
- `packages/db/migrations/` — generated migration.
- `packages/db/package.json`, root `package.json` — `backfill:coverage-tags` script.
- `infra/lambda/src/routes/admin.ts` — 4th aggregate query + `coverageDistribution`.
- `infra/lambda/src/routes/admin.test.ts` — endpoint test.
- `packages/api-client/src/schemas/pool-status.ts` — `coverageDistribution` field.

---

## Task 1: Shared coverage module

**Files:**
- Create: `packages/shared/src/coverage.ts`
- Create: `packages/shared/src/coverage.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/coverage.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { ExerciseType } from "./index";
import {
  COVERAGE_AXIS_VALUES,
  PERSON_CODES,
  coverageAxesFor,
  pickCoverageTags,
  type CoverageTags,
} from "./coverage";

describe("coverage axis constants", () => {
  it("PERSON_CODES is the canonical six-member superset", () => {
    expect([...PERSON_CODES]).toEqual([
      "1sg",
      "2sg",
      "3sg",
      "1pl",
      "2pl",
      "3pl",
    ]);
  });

  it("COVERAGE_AXIS_VALUES lists every axis", () => {
    expect(Object.keys(COVERAGE_AXIS_VALUES).sort()).toEqual([
      "person",
      "polarity",
      "sentenceType",
      "wordClass",
    ]);
  });
});

describe("coverageAxesFor", () => {
  it("vocab_recall → wordClass only", () => {
    expect(coverageAxesFor(ExerciseType.VOCAB_RECALL, false)).toEqual([
      "wordClass",
    ]);
  });

  it("grammar cloze without personRotation → polarity + sentenceType", () => {
    expect(coverageAxesFor(ExerciseType.CLOZE, false)).toEqual([
      "polarity",
      "sentenceType",
    ]);
  });

  it("grammar cloze with personRotation → person + polarity + sentenceType", () => {
    expect(coverageAxesFor(ExerciseType.CLOZE, true)).toEqual([
      "person",
      "polarity",
      "sentenceType",
    ]);
  });

  it("translation and sentence_construction behave like grammar cells", () => {
    expect(coverageAxesFor(ExerciseType.TRANSLATION, true)).toContain("person");
    expect(coverageAxesFor(ExerciseType.SENTENCE_CONSTRUCTION, false)).toEqual([
      "polarity",
      "sentenceType",
    ]);
  });
});

describe("pickCoverageTags", () => {
  it("keeps only axes applicable to the cell", () => {
    const coverage: CoverageTags = {
      person: "2pl",
      wordClass: "verb",
      polarity: "negative",
    };
    // vocab cell → only wordClass survives
    expect(pickCoverageTags(coverage, ExerciseType.VOCAB_RECALL, false)).toEqual(
      { wordClass: "verb" },
    );
    // personRotation grammar cell → person + polarity (wordClass dropped)
    expect(pickCoverageTags(coverage, ExerciseType.CLOZE, true)).toEqual({
      person: "2pl",
      polarity: "negative",
    });
  });

  it("returns null when no applicable axis is present", () => {
    expect(
      pickCoverageTags({ wordClass: "noun" }, ExerciseType.CLOZE, true),
    ).toBeNull();
    expect(pickCoverageTags({}, ExerciseType.VOCAB_RECALL, false)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/shared test -- coverage.test.ts`
Expected: FAIL — `Cannot find module './coverage'`.

- [ ] **Step 3: Write the module**

Create `packages/shared/src/coverage.ts`:

```ts
/**
 * Coverage axes — the categorical dimensions the validator reports per draft so
 * the approved pool's distribution can be measured (Pool Coverage Controller,
 * Phase 0). Pure vocabulary + applicability rule; no I/O. Imported by the
 * validator (packages/ai), the persistence path + backfill (packages/db), and
 * tests, so the value sets cannot drift across them.
 */

import { ExerciseType } from "./index";

export const PERSON_CODES = [
  "1sg",
  "2sg",
  "3sg",
  "1pl",
  "2pl",
  "3pl",
] as const;
export const WORD_CLASS_CODES = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "other",
] as const;
export const POLARITY_CODES = ["affirmative", "negative"] as const;
export const SENTENCE_TYPE_CODES = [
  "declarative",
  "interrogative",
  "imperative",
] as const;

export type PersonCode = (typeof PERSON_CODES)[number];
export type WordClassCode = (typeof WORD_CLASS_CODES)[number];
export type PolarityCode = (typeof POLARITY_CODES)[number];
export type SentenceTypeCode = (typeof SENTENCE_TYPE_CODES)[number];

export type CoverageAxis = "person" | "wordClass" | "polarity" | "sentenceType";

/** The realized coverage values for one exercise; partial — only applicable
 *  axes are ever set. Stored verbatim in `exercises.coverage_tags`. */
export type CoverageTags = {
  person?: PersonCode;
  wordClass?: WordClassCode;
  polarity?: PolarityCode;
  sentenceType?: SentenceTypeCode;
};

/** Allowed string values per axis — drives the validator tool enum AND the
 *  lenient parser (a value not in this set is dropped, never stored). */
export const COVERAGE_AXIS_VALUES: Record<CoverageAxis, readonly string[]> = {
  person: PERSON_CODES,
  wordClass: WORD_CLASS_CODES,
  polarity: POLARITY_CODES,
  sentenceType: SENTENCE_TYPE_CODES,
};

/**
 * Which axes are meaningful for a cell. vocab_recall → wordClass; the grammar
 * exercise types (cloze/translation/sentence_construction) → polarity +
 * sentenceType, plus person when the grammar point rotates person. Any other
 * exercise type (listening/speaking) → none.
 */
export function coverageAxesFor(
  exerciseType: ExerciseType,
  personRotation: boolean,
): CoverageAxis[] {
  if (exerciseType === ExerciseType.VOCAB_RECALL) return ["wordClass"];
  if (
    exerciseType === ExerciseType.CLOZE ||
    exerciseType === ExerciseType.TRANSLATION ||
    exerciseType === ExerciseType.SENTENCE_CONSTRUCTION
  ) {
    return personRotation
      ? ["person", "polarity", "sentenceType"]
      : ["polarity", "sentenceType"];
  }
  return [];
}

/**
 * Filter a raw coverage map down to the axes applicable to the cell. Returns
 * `null` when nothing applicable is present, so callers can write the column
 * as `null` rather than `{}`.
 */
export function pickCoverageTags(
  coverage: CoverageTags,
  exerciseType: ExerciseType,
  personRotation: boolean,
): CoverageTags | null {
  const axes = coverageAxesFor(exerciseType, personRotation);
  const out: Record<string, string> = {};
  for (const axis of axes) {
    const v = coverage[axis];
    if (v !== undefined) out[axis] = v;
  }
  return Object.keys(out).length > 0 ? (out as CoverageTags) : null;
}
```

- [ ] **Step 4: Re-export from the package index**

In `packages/shared/src/index.ts`, add at the end of the file:

```ts
export * from "./coverage";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @language-drill/shared test -- coverage.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/coverage.ts packages/shared/src/coverage.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): coverage axis vocabulary + applicability rule"
```

---

## Task 2: Validator emits `coverage` (tool field + type + parse)

**Files:**
- Modify: `packages/ai/src/validate.ts`
- Test: `packages/ai/src/validate.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/ai/src/validate.test.ts` (inside the existing `describe` for `parseValidationResult`, or a new `describe` block):

```ts
import { parseValidationResult } from "./validate";

describe("parseValidationResult — coverage", () => {
  const base = {
    qualityScore: 0.9,
    ambiguous: false,
    contextSpoilsAnswer: false,
    levelMatch: true,
    grammarPointMatch: true,
    culturalIssues: [],
    flaggedReasons: [],
  };

  it("keeps valid axis values", () => {
    const r = parseValidationResult({
      ...base,
      coverage: { person: "2pl", polarity: "negative" },
    });
    expect(r.coverage).toEqual({ person: "2pl", polarity: "negative" });
  });

  it("drops values not in the axis enum", () => {
    const r = parseValidationResult({
      ...base,
      coverage: { person: "4sg", wordClass: "noun", bogus: "x" },
    });
    expect(r.coverage).toEqual({ wordClass: "noun" });
  });

  it("missing or non-object coverage → empty object", () => {
    expect(parseValidationResult(base).coverage).toEqual({});
    expect(
      parseValidationResult({ ...base, coverage: "nope" }).coverage,
    ).toEqual({});
  });

  it("a malformed coverage never affects routing fields", () => {
    const r = parseValidationResult({ ...base, coverage: 42 });
    expect(r.qualityScore).toBe(0.9);
    expect(r.grammarPointMatch).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- validate.test.ts`
Expected: FAIL — `r.coverage` is `undefined` (property not yet on `ValidationResult`).

- [ ] **Step 3: Add the import, tool field, type, and parser**

In `packages/ai/src/validate.ts`:

3a. Add to the imports near the top (after the existing `@language-drill/shared`-free imports — this is the first such import; add it):

```ts
import {
  COVERAGE_AXIS_VALUES,
  type CoverageAxis,
  type CoverageTags,
} from "@language-drill/shared";
```

3b. Add the `coverage` property to `VALIDATION_TOOL.input_schema.properties` (after `flaggedReasons`, before the closing of `properties`). **Do NOT add it to `required`.**

```ts
      coverage: {
        type: "object",
        description:
          "Realized coverage values for this draft, on the axes the user prompt asks about. Fill ONLY the sub-fields requested for this exercise; omit the rest. These are descriptive tags for pool-diversity monitoring — they never affect approval.",
        properties: {
          person: {
            type: "string",
            enum: [...COVERAGE_AXIS_VALUES.person],
            description:
              "Grammatical person/number realized by the target answer (the form the learner must produce).",
          },
          wordClass: {
            type: "string",
            enum: [...COVERAGE_AXIS_VALUES.wordClass],
            description:
              "Part of speech of the target word (vocab_recall `expectedWord`).",
          },
          polarity: {
            type: "string",
            enum: [...COVERAGE_AXIS_VALUES.polarity],
            description:
              "Whether the target sentence is affirmative or negative.",
          },
          sentenceType: {
            type: "string",
            enum: [...COVERAGE_AXIS_VALUES.sentenceType],
            description:
              "Clause type of the target sentence: declarative, interrogative, or imperative.",
          },
        },
      },
```

3c. Add `coverage` to the `ValidationResult` type (after `flaggedReasons`):

```ts
  /**
   * Realized coverage values for pool-diversity monitoring (Phase 0). Strictly
   * non-load-bearing: `routeValidationResult` ignores it, and
   * `parseValidationResult` coerces anything malformed to `{}`. Only axis
   * values present in `COVERAGE_AXIS_VALUES` survive parsing.
   */
  coverage: CoverageTags;
```

3d. Add the lenient reader function (place it next to `coerceStringArray`):

```ts
/**
 * Lenient reader for the non-load-bearing `coverage` object. A missing or
 * non-object value yields `{}`; for each known axis, the value is kept only
 * when it is a string member of that axis's enum, otherwise dropped. Never
 * throws — coverage never gates routing, so a malformed value must not cost
 * the draft.
 */
function coerceCoverage(raw: Record<string, unknown>): CoverageTags {
  const v = raw.coverage;
  if (!isObject(v)) return {};
  const out: Record<string, string> = {};
  for (const axis of Object.keys(COVERAGE_AXIS_VALUES) as CoverageAxis[]) {
    const val = v[axis];
    if (typeof val === "string" && COVERAGE_AXIS_VALUES[axis].includes(val)) {
      out[axis] = val;
    }
  }
  return out as CoverageTags;
}
```

3e. In `parseValidationResult`, compute and include `coverage` in the returned object. Add before the `return`:

```ts
  const coverage = coerceCoverage(raw);
```

and add `coverage,` to the returned object literal (after `flaggedReasons,`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- validate.test.ts`
Expected: PASS (new coverage cases + all pre-existing cases still green).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/validate.ts packages/ai/src/validate.test.ts
git commit -m "feat(ai): validator emits realized coverage tags (non-load-bearing)"
```

---

## Task 3: Per-draft coverage directive + prompt version bump

**Files:**
- Modify: `packages/ai/src/validation-prompts.ts`
- Test: `packages/ai/src/validation-prompts.test.ts` (create if it does not exist; otherwise append)

- [ ] **Step 1: Write the failing test**

Append to `packages/ai/src/validation-prompts.test.ts` (create the file with this content if absent):

```ts
import { describe, expect, it } from "vitest";

import {
  ExerciseType,
  Language,
  CefrLevel,
  type ClozeContent,
  type VocabRecallContent,
} from "@language-drill/shared";

import { buildValidationUserPrompt } from "./validation-prompts";
import type { ExerciseDraft, GenerationSpec } from "./generate";

function grammarPoint(personRotation: boolean) {
  return {
    key: "tr-a1-test",
    kind: "grammar" as const,
    name: "Test point",
    description: "desc",
    cefr: CefrLevel.A1,
    examplesPositive: [],
    commonErrors: [],
    ...(personRotation ? { personRotation: true } : {}),
  };
}

function specFor(
  exerciseType: ExerciseType,
  personRotation: boolean,
): GenerationSpec {
  return {
    language: Language.TR,
    cefrLevel: CefrLevel.A1,
    exerciseType,
    grammarPoint: grammarPoint(personRotation) as GenerationSpec["grammarPoint"],
    topicDomain: null,
    count: 1,
    batchSeed: "test",
  };
}

const clozeDraft: ExerciseDraft = {
  id: "00000000-0000-0000-0000-000000000001",
  contentJson: {
    type: ExerciseType.CLOZE,
    instructions: "Fill the blank",
    sentence: "Ben ___ (gitmek).",
    correctAnswer: "giderim",
  } as ClozeContent,
  metadata: {
    grammarPointKey: "tr-a1-test",
    topicDomain: null,
    modelId: "claude-sonnet-4-6",
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    inBatchDuplicate: false,
  },
};

const vocabDraft: ExerciseDraft = {
  ...clozeDraft,
  contentJson: {
    type: ExerciseType.VOCAB_RECALL,
    instructions: "Recall the word",
    prompt: "water",
    expectedWord: "su",
    hints: [],
    exampleSentence: "Su içiyorum.",
  } as VocabRecallContent,
};

describe("buildValidationUserPrompt — coverage directive", () => {
  it("grammar cloze without personRotation asks polarity + sentenceType, not person", () => {
    const p = buildValidationUserPrompt(clozeDraft, specFor(ExerciseType.CLOZE, false));
    expect(p).toContain("polarity");
    expect(p).toContain("sentenceType");
    expect(p).not.toContain("grammatical person");
  });

  it("grammar cloze with personRotation also asks person", () => {
    const p = buildValidationUserPrompt(clozeDraft, specFor(ExerciseType.CLOZE, true));
    expect(p).toContain("grammatical person");
    expect(p).toContain("polarity");
  });

  it("vocab_recall asks wordClass only", () => {
    const p = buildValidationUserPrompt(vocabDraft, specFor(ExerciseType.VOCAB_RECALL, false));
    expect(p).toContain("part of speech");
    expect(p).not.toContain("polarity");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- validation-prompts.test.ts`
Expected: FAIL — the directive text (`polarity`, `part of speech`, …) is not in the prompt yet.

- [ ] **Step 3: Add the directive renderer and append it in `buildValidationUserPrompt`**

In `packages/ai/src/validation-prompts.ts`:

3a. Add to the `@language-drill/shared` import list (the file already imports types from it):

```ts
  coverageAxesFor,
  type CoverageAxis,
```

3b. Add the directive copy + renderer just above `buildValidationUserPrompt`:

```ts
// Per-axis instruction copy for the realized-coverage tags. Appended to the
// (uncached, per-draft) user prompt only for the axes applicable to the cell —
// so non-applicable cells pay zero tokens and the CACHED system prompt stays
// byte-identical. The tool field that receives these is `coverage` (validate.ts).
const COVERAGE_AXIS_DIRECTIVE: Record<CoverageAxis, string> = {
  person:
    "- `coverage.person`: the grammatical person/number the target answer realizes (1sg/2sg/3sg/1pl/2pl/3pl). Report what the draft ACTUALLY produced, not what was requested.",
  wordClass:
    "- `coverage.wordClass`: the part of speech of the target word (noun/verb/adjective/adverb/other).",
  polarity:
    "- `coverage.polarity`: whether the target sentence is affirmative or negative.",
  sentenceType:
    "- `coverage.sentenceType`: the clause type of the target sentence (declarative/interrogative/imperative).",
};

function renderCoverageDirective(spec: GenerationSpec): string {
  const axes = coverageAxesFor(
    spec.exerciseType,
    spec.grammarPoint.personRotation === true,
  );
  if (axes.length === 0) return "";
  const lines = axes.map((axis) => COVERAGE_AXIS_DIRECTIVE[axis]).join("\n");
  return `\n\n**Coverage tags (descriptive only — do NOT change qualityScore based on these):** also fill the \`coverage\` object with the realized value(s) for this draft:\n${lines}`;
}
```

3c. Wrap the `buildValidationUserPrompt` switch result so the directive is appended once for every type. Replace the body of `buildValidationUserPrompt` so the `switch` produces a `base` string and the function returns `base + renderCoverageDirective(spec)`:

```ts
export function buildValidationUserPrompt(
  draft: ExerciseDraft,
  spec: GenerationSpec,
): string {
  const content = draft.contentJson;
  let base: string;
  switch (content.type) {
    case ExerciseType.CLOZE:
      base = buildClozeValidationUserPrompt(content, spec);
      break;
    case ExerciseType.TRANSLATION:
      base = buildTranslationValidationUserPrompt(content, spec);
      break;
    case ExerciseType.VOCAB_RECALL:
      base = buildVocabRecallValidationUserPrompt(content, spec);
      break;
    case ExerciseType.SENTENCE_CONSTRUCTION:
      base = buildSentenceConstructionValidationUserPrompt(content, spec);
      break;
    default: {
      const _exhaustive: never = content;
      throw new Error(
        `buildValidationUserPrompt: unsupported content type ${(_exhaustive as { type: ExerciseType }).type}`,
      );
    }
  }
  return base + renderCoverageDirective(spec);
}
```

- [ ] **Step 4: Bump `VALIDATION_PROMPT_VERSION`**

In `packages/ai/src/validation-prompts.ts`, change the constant:

```ts
export const VALIDATION_PROMPT_VERSION = "validate@2026-06-13";
```

Note for the PR description (no code change): the Langfuse **system** body is unchanged — the new directive lives in the per-draft user prompt — so `pnpm push-prompts` is **not** required for this change.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- validation-prompts.test.ts`
Expected: PASS.

Then run the whole ai package to catch any byte-parity / snapshot test that asserts on the prompt or version:

Run: `pnpm --filter @language-drill/ai test`
Expected: PASS. If a snapshot test asserts the old `VALIDATION_PROMPT_VERSION` string, update that expectation to `validate@2026-06-13`.

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/validation-prompts.ts packages/ai/src/validation-prompts.test.ts
git commit -m "feat(ai): per-draft coverage directive + bump VALIDATION_PROMPT_VERSION"
```

---

## Task 4: `coverage_tags` column + migration

**Files:**
- Modify: `packages/db/src/schema/exercises.ts`
- Create: `packages/db/migrations/<generated>.sql` (+ snapshot/journal updates)

- [ ] **Step 1: Add the column to the schema**

In `packages/db/src/schema/exercises.ts`:

1a. Add the import at the top (alongside existing `@language-drill/shared` imports):

```ts
import type { CoverageTags } from '@language-drill/shared';
```

1b. Add the column inside the `exercises` `pgTable` columns object, after `generatedAt`:

```ts
    // Realized coverage values per axis (person/wordClass/polarity/sentenceType)
    // for pool-diversity monitoring (Pool Coverage Controller, Phase 0). Written
    // by the generation insert path from the validator's `coverage` result and
    // by the `backfill:coverage-tags` CLI for legacy rows. Aggregated generically
    // by GET /admin/pool-status via LATERAL jsonb_each_text.
    coverageTags: jsonb('coverage_tags').$type<CoverageTags | null>(),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @language-drill/db db:generate`
Expected: a new file appears under `packages/db/migrations/` containing
`ALTER TABLE "exercises" ADD COLUMN "coverage_tags" jsonb;`, and the drizzle
journal/snapshot under `packages/db/migrations/meta/` is updated.

- [ ] **Step 3: Verify it typechecks and the snapshot is coherent**

Run: `pnpm --filter @language-drill/db typecheck`
Expected: PASS.

Inspect the generated SQL: it must be a single additive `ADD COLUMN ... jsonb` (nullable, no default, no data migration). If `db:generate` produced unrelated diffs, discard them — only the `coverage_tags` column should change.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/exercises.ts packages/db/migrations
git commit -m "feat(db): coverage_tags jsonb column on exercises"
```

---

## Task 5: Write `coverage_tags` at INSERT

**Files:**
- Create: `packages/db/src/generation/coverage-tags.ts`
- Modify: `packages/db/src/generation/index.ts`
- Modify: `packages/db/src/generation/validate-and-insert.ts`
- Test: `packages/db/src/generation/coverage-tags.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/generation/coverage-tags.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { ExerciseType, Language, CefrLevel } from "@language-drill/shared";

import { applicableCoverageTags } from "./coverage-tags";

function cell(exerciseType: ExerciseType, personRotation: boolean) {
  return {
    language: Language.TR,
    cefrLevel: CefrLevel.A1,
    exerciseType,
    grammarPoint: {
      key: "tr-a1-test",
      ...(personRotation ? { personRotation: true } : {}),
    },
  } as unknown as Parameters<typeof applicableCoverageTags>[0];
}

describe("applicableCoverageTags", () => {
  it("vocab cell keeps only wordClass", () => {
    expect(
      applicableCoverageTags(cell(ExerciseType.VOCAB_RECALL, false), {
        wordClass: "verb",
        polarity: "negative",
      }),
    ).toEqual({ wordClass: "verb" });
  });

  it("personRotation grammar cell keeps person + polarity + sentenceType", () => {
    expect(
      applicableCoverageTags(cell(ExerciseType.CLOZE, true), {
        person: "2pl",
        polarity: "affirmative",
        sentenceType: "interrogative",
        wordClass: "noun",
      }),
    ).toEqual({
      person: "2pl",
      polarity: "affirmative",
      sentenceType: "interrogative",
    });
  });

  it("non-personRotation grammar cell drops person", () => {
    expect(
      applicableCoverageTags(cell(ExerciseType.CLOZE, false), {
        person: "2pl",
        polarity: "negative",
      }),
    ).toEqual({ polarity: "negative" });
  });

  it("returns null when nothing applicable is present", () => {
    expect(
      applicableCoverageTags(cell(ExerciseType.CLOZE, true), {
        wordClass: "noun",
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db test -- coverage-tags.test.ts`
Expected: FAIL — `Cannot find module './coverage-tags'`.

- [ ] **Step 3: Write the wrapper**

Create `packages/db/src/generation/coverage-tags.ts`:

```ts
/**
 * Maps a cell + the validator's raw coverage map to the coverage tags that
 * should be persisted for that cell — the thin DB-side wrapper over the pure
 * `pickCoverageTags` rule in @language-drill/shared. Lives next to the routing
 * helpers because the generation insert path and the backfill CLI both use it.
 */

import { pickCoverageTags, type CoverageTags } from "@language-drill/shared";
import type { Cell } from "../curriculum";

export function applicableCoverageTags(
  cell: Cell,
  coverage: CoverageTags,
): CoverageTags | null {
  return pickCoverageTags(
    coverage,
    cell.exerciseType,
    cell.grammarPoint.personRotation === true,
  );
}
```

> If `Cell` is not exported from `../curriculum`, import it from wherever the existing generation code imports `Cell` (grep `import.*\bCell\b` in `packages/db/src/generation/`). Match the existing import path.

- [ ] **Step 4: Re-export it**

In `packages/db/src/generation/index.ts`, add alongside the other re-exports:

```ts
export { applicableCoverageTags } from "./coverage-tags";
```

- [ ] **Step 5: Wire it into the INSERT**

In `packages/db/src/generation/validate-and-insert.ts`:

5a. Add the import (next to the `routeValidationResult` import):

```ts
import { applicableCoverageTags } from './coverage-tags';
```

5b. In the `.insert(exercises).values({ ... })` call (the success branch, currently ~line 437), add the field after `flaggedReasons: ...,`:

```ts
            coverageTags: applicableCoverageTags(opts.cell, result.coverage),
```

`result` is the validation of `currentDraft` (the actually-inserted draft, after any dedup retry), so the persisted value is the realized one.

- [ ] **Step 6: Run the focused test + the existing insert tests**

Run: `pnpm --filter @language-drill/db test -- coverage-tags.test.ts`
Expected: PASS.

Run: `pnpm --filter @language-drill/db test -- validate-and-insert`
Expected: PASS — the existing insert tests still pass. If an insert test asserts the exact `.values(...)` object shape, add `coverageTags` to its expectation. (The validator mock in those tests returns a `ValidationResult`; ensure the mock now includes `coverage: {}` if it constructs the object literally — a `{}` yields `coverageTags: null`, which is the correct default.)

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/generation/coverage-tags.ts packages/db/src/generation/coverage-tags.test.ts packages/db/src/generation/index.ts packages/db/src/generation/validate-and-insert.ts
git commit -m "feat(db): persist applicable coverage_tags on generation insert"
```

---

## Task 6: Surface per-cell distribution on `GET /admin/pool-status`

**Files:**
- Modify: `packages/api-client/src/schemas/pool-status.ts`
- Modify: `infra/lambda/src/routes/admin.ts`
- Test: `infra/lambda/src/routes/admin.test.ts`

- [ ] **Step 1: Add the schema field**

In `packages/api-client/src/schemas/pool-status.ts`, add to `PoolStatusItemSchema` (after `generationTarget`):

```ts
  /**
   * Per-axis distribution of the cell's APPROVED exercises, e.g.
   * `{ person: { "3sg": 12, "2pl": 2 }, polarity: { affirmative: 13 } }`.
   * `null` when the cell has no tagged approved rows. Axes appear only when
   * present in the pool (Pool Coverage Controller, Phase 0).
   */
  coverageDistribution: z
    .record(z.string(), z.record(z.string(), z.number()))
    .nullable(),
```

- [ ] **Step 2: Write the failing endpoint test**

In `infra/lambda/src/routes/admin.test.ts`, add a test that seeds two approved tagged exercises in one cell and asserts the distribution. Follow the file's existing pattern for inserting exercises and calling the route. Skeleton:

```ts
it("GET /admin/pool-status returns per-cell coverageDistribution for approved tagged rows", async () => {
  // Insert two approved cloze exercises in the same cell with coverage tags.
  // Use the same insert helper / test db the other admin.test.ts cases use.
  const cellFields = {
    type: "cloze",
    language: "TR",
    difficulty: "A1",
    grammarPointKey: "<an existing personRotation cloze grammar point key>",
    reviewStatus: "auto-approved" as const,
  };
  await db.insert(exercises).values([
    { ...cellFields, id: crypto.randomUUID(), contentJson: { type: "cloze" }, coverageTags: { person: "3sg", polarity: "affirmative" } },
    { ...cellFields, id: crypto.randomUUID(), contentJson: { type: "cloze" }, coverageTags: { person: "3sg", polarity: "negative" } },
  ]);

  const res = await app.request("/admin/pool-status?language=TR&level=A1", {}, testEnv);
  expect(res.status).toBe(200);
  const items = await res.json();
  const item = items.find(
    (i: any) => i.grammarPointKey === cellFields.grammarPointKey && i.type === "cloze",
  );
  expect(item.coverageDistribution).toEqual({
    person: { "3sg": 2 },
    polarity: { affirmative: 1, negative: 1 },
  });

  // A cell with no tagged rows reports null.
  const untagged = items.find((i: any) => !i.coverageDistribution);
  expect(untagged.coverageDistribution).toBeNull();
});
```

> Replace `<an existing personRotation cloze grammar point key>` with a real key — grep `personRotation: true` in `packages/db/src/curriculum/tr.ts` and use the corresponding grammar point key for a cloze cell (e.g. a TR A1 tense point). Match how other tests in this file obtain `db`, `app`, `testEnv`, and the exercises import.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @language-drill/infra test -- admin.test.ts`
(Use the actual infra package name from `infra/lambda/package.json` if different.)
Expected: FAIL — `item.coverageDistribution` is `undefined`.

- [ ] **Step 4: Add the aggregate query and merge it in**

In `infra/lambda/src/routes/admin.ts`, inside the `/admin/pool-status` handler:

4a. Add a fourth query. Because it uses `LATERAL jsonb_each_text`, run it as raw SQL via `db.execute` (the codebase already does this in `sessions.ts` / `scheduler.ts`). Add it after the `Promise.all([...])` block (a separate `await` is fine — or fold it into the `Promise.all` as a fourth element):

```ts
  const coverageResult = await db.execute(sql`
    SELECT
      language,
      difficulty,
      type,
      grammar_point_key AS "grammarPointKey",
      tag.key   AS axis,
      tag.value AS value,
      COUNT(*)::int AS n
    FROM exercises
    CROSS JOIN LATERAL jsonb_each_text(coverage_tags) AS tag
    WHERE review_status IN ('auto-approved', 'manual-approved')
      AND coverage_tags IS NOT NULL
    GROUP BY language, difficulty, type, grammar_point_key, tag.key, tag.value
  `);
  const coverageRows = coverageResult.rows as Array<{
    language: string;
    difficulty: string;
    type: string;
    grammarPointKey: string;
    axis: string;
    value: string;
    n: number;
  }>;
```

4b. Build a per-cell nested map (place near the other `Map` builders):

```ts
  const coverageByCell = new Map<
    string,
    Record<string, Record<string, number>>
  >();
  for (const row of coverageRows) {
    const cellKey = buildCellKeyFromRow(row);
    const dist = coverageByCell.get(cellKey) ?? {};
    const axisMap = dist[row.axis] ?? {};
    axisMap[row.value] = row.n;
    dist[row.axis] = axisMap;
    coverageByCell.set(cellKey, dist);
  }
```

4c. In the `items` `.map(...)`, add the field to the returned object (after `generationTarget`):

```ts
      coverageDistribution: coverageByCell.get(cellKey) ?? null,
```

- [ ] **Step 5: Run test to verify it passes**

Build first (db/shared/ai dist must be current for infra):

Run: `pnpm build`
Then: `pnpm --filter @language-drill/infra test -- admin.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api-client/src/schemas/pool-status.ts infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(api): surface per-cell coverage distribution on /admin/pool-status"
```

---

## Task 7: Backfill CLI

**Files:**
- Create: `packages/db/scripts/backfill-coverage-tags.ts`
- Create: `packages/db/scripts/backfill-coverage-tags.test.ts`
- Modify: `packages/db/package.json`
- Modify: root `package.json`

- [ ] **Step 1: Write the failing test (pure units: arg parsing + reconstruct)**

Create `packages/db/scripts/backfill-coverage-tags.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { CefrLevel, Language } from "@language-drill/shared";

import { parseBackfillArgs } from "./backfill-coverage-tags";

describe("parseBackfillArgs", () => {
  it("defaults to dry-run", () => {
    const a = parseBackfillArgs([]);
    expect(a.apply).toBe(false);
    expect(a.language).toBeNull();
    expect(a.cefrLevel).toBeNull();
    expect(a.limit).toBeNull();
  });

  it("parses flags", () => {
    const a = parseBackfillArgs([
      "--apply",
      "--language",
      "TR",
      "--cefr",
      "A1",
      "--limit",
      "50",
      "--concurrency",
      "8",
      "--max-cost-usd",
      "3",
    ]);
    expect(a.apply).toBe(true);
    expect(a.language).toBe(Language.TR);
    expect(a.cefrLevel).toBe(CefrLevel.A1);
    expect(a.limit).toBe(50);
    expect(a.concurrency).toBe(8);
    expect(a.maxCostUsd).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db test -- backfill-coverage-tags.test.ts`
Expected: FAIL — `Cannot find module './backfill-coverage-tags'`.

- [ ] **Step 3: Write the CLI**

Create `packages/db/scripts/backfill-coverage-tags.ts`. This mirrors `revalidate-cloze-pool.ts` (arg parsing, `pLimit`, cost cap) but: (a) covers all exercise types, (b) only selects rows with `coverage_tags IS NULL`, (c) writes `coverage_tags` instead of demoting.

```ts
/**
 * `pnpm backfill:coverage-tags` — one-off CLI to tag the EXISTING approved pool
 * with realized coverage values (Pool Coverage Controller, Phase 0). New
 * generation is tagged at insert time; this backfills legacy rows.
 *
 * Replays the current validator over each approved row (`auto-approved` +
 * `manual-approved`) whose `coverage_tags IS NULL`, reads `result.coverage`,
 * applies the cell-applicability rule, and writes the column.
 *
 * Scope: because polarity/sentenceType apply to all grammar cells (not only
 * personRotation ones), this effectively covers the whole approved grammar +
 * vocab pool. Bound spend with --max-cost-usd and --language/--cefr. The pass
 * is resumable: it only touches rows with coverage_tags IS NULL.
 *
 * Defaults to dry-run; pass --apply to write. The Langfuse-fallback path
 * (LANGFUSE_PUBLIC_KEY unset) uses the in-repo prompt verbatim, so dry-running
 * locally produces the same tags Lambda would in prod.
 *
 * Usage:
 *   pnpm backfill:coverage-tags                              # dry-run, all
 *   pnpm backfill:coverage-tags -- --language TR --cefr A1
 *   pnpm backfill:coverage-tags -- --apply --max-cost-usd 5
 *   pnpm backfill:coverage-tags -- --limit 100 --concurrency 4
 *
 * Required env: ANTHROPIC_API_KEY, DATABASE_URL.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  ZERO_USAGE,
  addUsage,
  createClaudeClient,
  estimateCostUsd,
  validateDraft,
  type ClaudeUsageBreakdown,
  type ExerciseDraft,
  type GenerationSpec,
} from "@language-drill/ai";
import {
  CefrLevel,
  ExerciseType,
  Language,
  type CoverageTags,
  type ExerciseContent,
} from "@language-drill/shared";

import { createDb, type Db } from "../src/client";
import { getGrammarPoint } from "../src/curriculum";
import { exercises } from "../src/schema";
import { applicableCoverageTags } from "../src/generation/coverage-tags";

import { pLimit } from "./p-limit";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_COST_USD = 5.0;

const LANGUAGE_VALUES = new Set(Object.values(Language));
const CEFR_VALUES = new Set(Object.values(CefrLevel));
const EXERCISE_TYPE_VALUES = new Set<string>(Object.values(ExerciseType));

export type BackfillArgs = {
  apply: boolean;
  language: Language | null;
  cefrLevel: CefrLevel | null;
  limit: number | null;
  concurrency: number;
  maxCostUsd: number;
};

export function parseBackfillArgs(argv: readonly string[]): BackfillArgs {
  let apply = false;
  let language: Language | null = null;
  let cefrLevel: CefrLevel | null = null;
  let limit: number | null = null;
  let concurrency = DEFAULT_CONCURRENCY;
  let maxCostUsd = DEFAULT_MAX_COST_USD;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--" ) continue;
    else if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg === "--language" || arg === "--lang") {
      const v = argv[++i];
      if (!LANGUAGE_VALUES.has(v as Language)) {
        throw new Error(`Invalid --language: ${String(v)}`);
      }
      language = v as Language;
    } else if (arg === "--cefr" || arg === "--level") {
      const v = argv[++i];
      if (!CEFR_VALUES.has(v as CefrLevel)) {
        throw new Error(`Invalid --cefr: ${String(v)}`);
      }
      cefrLevel = v as CefrLevel;
    } else if (arg === "--limit") {
      limit = Number(argv[++i]);
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new Error(`Invalid --limit: must be a positive integer`);
      }
    } else if (arg === "--concurrency") {
      concurrency = Number(argv[++i]);
      if (!Number.isInteger(concurrency) || concurrency <= 0) {
        throw new Error(`Invalid --concurrency: must be a positive integer`);
      }
    } else if (arg === "--max-cost-usd") {
      maxCostUsd = Number(argv[++i]);
      if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
        throw new Error(`Invalid --max-cost-usd: must be a positive number`);
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { apply, language, cefrLevel, limit, concurrency, maxCostUsd };
}

type CandidateRow = {
  id: string;
  type: string | null;
  language: string | null;
  difficulty: string | null;
  contentJson: unknown;
  grammarPointKey: string | null;
  topicDomain: string | null;
  modelId: string | null;
};

type Reconstructed =
  | { ok: true; draft: ExerciseDraft; spec: GenerationSpec; cell: Parameters<typeof applicableCoverageTags>[0] }
  | { ok: false; reason: string };

/** Rebuild the (draft, spec, cell) a validator call needs from a stored row.
 *  Generic over all exercise types — validateDraft switches on content.type. */
export function reconstructForValidation(row: CandidateRow): Reconstructed {
  if (!row.grammarPointKey) return { ok: false, reason: "no grammarPointKey" };
  const grammarPoint = getGrammarPoint(row.grammarPointKey);
  if (!grammarPoint) {
    return { ok: false, reason: `unknown grammar point ${row.grammarPointKey}` };
  }
  if (!row.language || !LANGUAGE_VALUES.has(row.language as Language)) {
    return { ok: false, reason: `invalid language ${String(row.language)}` };
  }
  if (row.language === Language.EN) {
    return { ok: false, reason: "EN is not a learner language" };
  }
  if (!row.difficulty || !CEFR_VALUES.has(row.difficulty as CefrLevel)) {
    return { ok: false, reason: `invalid difficulty ${String(row.difficulty)}` };
  }
  const content = row.contentJson as { type?: unknown } | null;
  if (!content || typeof content !== "object" || typeof content.type !== "string" || !EXERCISE_TYPE_VALUES.has(content.type)) {
    return { ok: false, reason: "malformed content_json" };
  }

  const language = row.language as Exclude<Language, Language.EN>;
  const cefrLevel = row.difficulty as CefrLevel;
  const exerciseType = content.type as ExerciseType;

  const draft: ExerciseDraft = {
    id: row.id,
    contentJson: content as ExerciseContent,
    metadata: {
      grammarPointKey: row.grammarPointKey,
      topicDomain: row.topicDomain,
      modelId: row.modelId ?? "unknown",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      inBatchDuplicate: false,
    },
  };
  const spec: GenerationSpec = {
    language,
    cefrLevel,
    exerciseType,
    grammarPoint,
    topicDomain: row.topicDomain,
    count: 1,
    batchSeed: "backfill",
  };
  const cell = { language, cefrLevel, exerciseType, grammarPoint } as Parameters<
    typeof applicableCoverageTags
  >[0];
  return { ok: true, draft, spec, cell };
}

async function fetchCandidates(db: Db, args: BackfillArgs): Promise<CandidateRow[]> {
  const filters = [
    inArray(exercises.reviewStatus, ["auto-approved", "manual-approved"]),
    isNull(exercises.coverageTags),
  ];
  if (args.language) filters.push(eq(exercises.language, args.language));
  if (args.cefrLevel) filters.push(eq(exercises.difficulty, args.cefrLevel));

  const query = db
    .select({
      id: exercises.id,
      type: exercises.type,
      language: exercises.language,
      difficulty: exercises.difficulty,
      contentJson: exercises.contentJson,
      grammarPointKey: exercises.grammarPointKey,
      topicDomain: exercises.topicDomain,
      modelId: exercises.modelId,
    })
    .from(exercises)
    .where(and(...filters))
    .orderBy(exercises.id);

  const rows = args.limit !== null ? await query.limit(args.limit) : await query;
  return rows as CandidateRow[];
}

async function main(): Promise<void> {
  const args = parseBackfillArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const db = createDb(databaseUrl);
  const client = createClaudeClient();
  const limit = pLimit(args.concurrency);

  const candidates = await fetchCandidates(db, args);
  console.log(
    `[backfill-coverage-tags] ${args.apply ? "APPLY" : "DRY-RUN"} — ${candidates.length} untagged approved rows`,
  );

  let usage: ClaudeUsageBreakdown = ZERO_USAGE;
  let written = 0;
  let skipped = 0;
  const axisCounts: Record<string, number> = {};
  let stopped = false;

  await Promise.all(
    candidates.map((row) =>
      limit(async () => {
        if (stopped) return;
        if (estimateCostUsd(usage) >= args.maxCostUsd) {
          stopped = true;
          return;
        }
        const rec = reconstructForValidation(row);
        if (!rec.ok) {
          skipped++;
          return;
        }
        const { result, tokenUsage } = await validateDraft(client, rec.draft, rec.spec);
        usage = addUsage(usage, tokenUsage);
        const tags: CoverageTags | null = applicableCoverageTags(rec.cell, result.coverage);
        if (!tags) {
          skipped++;
          return;
        }
        for (const axis of Object.keys(tags)) axisCounts[axis] = (axisCounts[axis] ?? 0) + 1;
        if (args.apply) {
          await db.update(exercises).set({ coverageTags: tags }).where(eq(exercises.id, row.id));
        }
        written++;
      }),
    ),
  );

  console.log(
    `[backfill-coverage-tags] ${args.apply ? "wrote" : "would write"} ${written}, skipped ${skipped}` +
      (stopped ? " (stopped at cost cap)" : ""),
  );
  console.log(`[backfill-coverage-tags] per-axis: ${JSON.stringify(axisCounts)}`);
  console.log(`[backfill-coverage-tags] est. cost: $${estimateCostUsd(usage).toFixed(4)}`);
}

// Only run when invoked directly (tests import the pure helpers).
if (process.argv[1]?.endsWith("backfill-coverage-tags.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

> Verify the exact import surface against `revalidate-cloze-pool.ts`: confirm `createClaudeClient`, `estimateCostUsd`, `addUsage`, `ZERO_USAGE` are exported from `@language-drill/ai` (they are used by that script). Confirm `pLimit` is the default vs named export in `./p-limit` and match revalidate's usage. Confirm `getGrammarPoint` is exported from `../src/curriculum`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/db test -- backfill-coverage-tags.test.ts`
Expected: PASS (arg-parsing units). The `main()` guard prevents the script from executing on import.

- [ ] **Step 5: Wire the script aliases**

In `packages/db/package.json` `scripts`, add (after `revalidate:cloze`):

```json
    "backfill:coverage-tags": "npx tsx scripts/backfill-coverage-tags.ts",
```

In the root `package.json` `scripts`, add a passthrough mirroring the existing `revalidate:cloze` root alias (which loads `.env` via `dotenv`):

```json
    "backfill:coverage-tags": "dotenv -e .env -- pnpm --filter @language-drill/db backfill:coverage-tags",
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/scripts/backfill-coverage-tags.ts packages/db/scripts/backfill-coverage-tags.test.ts packages/db/package.json package.json
git commit -m "feat(db): backfill:coverage-tags CLI for the legacy approved pool"
```

---

## Task 8: Full-suite verification + docs note

**Files:**
- Modify: `docs/pool-coverage-controller.md` (mark Phase 0 done)

- [ ] **Step 1: Build everything (refresh dist for cross-package tests)**

Run: `pnpm build`
Expected: all packages compile (turbo).

- [ ] **Step 2: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: zero errors. Fix anything reported before continuing.

- [ ] **Step 3: Full test suite (serialized to dodge the infra parallel flake)**

Run: `pnpm turbo run test --concurrency=1`
Expected: all packages PASS. Report `X passed, Y failed`; if any fail, fix before proceeding (do not mark complete with failures).

- [ ] **Step 4: Mark Phase 0 complete in the proposal**

In `docs/pool-coverage-controller.md`, update the Phase 0 heading line (line ~152) from:

```markdown
### Phase 0 — coverage tags + monitoring (recommended next step)
```

to:

```markdown
### Phase 0 — coverage tags + monitoring ✅ implemented
```

- [ ] **Step 5: Commit**

```bash
git add docs/pool-coverage-controller.md
git commit -m "docs: mark pool coverage controller Phase 0 implemented"
```

- [ ] **Step 6: (Operator follow-up, not a code step)**

After merge + deploy, run the backfill against production once, scoped + cost-capped, e.g.:

```bash
pnpm backfill:coverage-tags -- --apply --max-cost-usd 5 --language TR
```

Then spot-check `GET /admin/pool-status?language=TR&level=A1` shows `coverageDistribution`. This is operational, not part of the PR.

---

## Self-Review

**Spec coverage:**
- Component 1 (validator emits coverage) → Tasks 2 (tool field/type/parse) + 3 (directive + version bump). ✓
- Component 2 (persist) → Task 4 (column/migration) + Task 5 (write at INSERT). ✓
- Component 3 (endpoint) → Task 6. ✓
- Component 4 (backfill CLI) → Task 7. ✓
- Shared axis vocabulary + applicability (`coverageAxesFor`/`pickCoverageTags`) → Task 1. ✓
- Approved-only aggregate, generic over axes (`jsonb_each_text`) → Task 6, Step 4. ✓
- VALIDATION_PROMPT_VERSION bump + "no push-prompts" note → Task 3, Steps 4. ✓
- Testing per component → each task has TDD steps; full suite in Task 8. ✓
- Out-of-scope items (scheduler, generation fixes, web UI, Phase-2 specs) → none introduced. ✓

**Placeholder scan:** The two `<...>` placeholders (an existing personRotation cloze grammar key in Task 6; the `Cell` import path in Task 5) are explicit "look this up in the codebase" instructions with the exact grep to run, not vague TODOs — acceptable because the exact value depends on current curriculum data the worker must read. All code steps contain full code.

**Type consistency:** `CoverageTags`/`CoverageAxis`/`COVERAGE_AXIS_VALUES`/`coverageAxesFor`/`pickCoverageTags` (Task 1) are used with identical signatures in Tasks 2, 5, 7. `ValidationResult.coverage: CoverageTags` (Task 2) is read by `applicableCoverageTags` (Task 5) and the backfill (Task 7). `coverageTags` column name (Task 4) matches the insert (Task 5), backfill update/select (Task 7), and the endpoint's `coverage_tags` SQL (Task 6). `coverageDistribution` field name matches between the schema (Task 6 Step 1) and the route (Task 6 Step 4). Consistent. ✓
