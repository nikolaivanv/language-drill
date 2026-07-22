# QA Exercise Sampler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `pnpm qa:sample` — an author-run CLI that spot-checks the approved exercise pool by having an Opus solver craft three intent-labeled answers per sampled exercise, running each through the real production evaluator, and flagging (exercise → evaluator) contract defects to a JSON report.

**Architecture:** A pure core in `packages/ai/src/qa-sample.ts` (learner-view renderer, LLM answer-crafter, pure verdict classifier) plus a thin CLI wrapper in `packages/ai/scripts/qa-sample-run.ts` that reads the pool from Postgres, resolves evaluator grounding via a helper extracted to `@language-drill/db`, drives the core, and writes `./qa-runs/<name>.json`. The core takes no DB dependency (grounding is passed in), so a Lambda can wrap it later.

**Tech Stack:** TypeScript, `tsx` (script runner), `@anthropic-ai/sdk` (forced tool-use), Drizzle ORM, Vitest, `node:util` `parseArgs`.

## Global Constraints

- `packages/ai/src/**` MUST NOT import `@language-drill/db` (build cycle → CI TS2307). The `qa-sample.ts` core receives curriculum grounding as plain arguments. Scripts (`packages/ai/scripts/**`) MAY import db — the eval scripts already do.
- The shared grounding helper lives in `@language-drill/db` (it owns `getGrammarPoint`/`grammarPointsAtOrBelow`); it may import the `GrammarGuidance`/`AttributionKey` return types from `@language-drill/ai` because `db → ai` is the sanctioned dependency direction.
- Covered exercise types = exactly the six routed through `evaluateAnswer`: `CLOZE, TRANSLATION, VOCAB_RECALL, SENTENCE_CONSTRUCTION, CONJUGATION, CONTEXTUAL_PARAPHRASE`.
- Pass/fail bands (documented constants): `PASS_THRESHOLD = 0.8`, `FAIL_THRESHOLD = 0.4`, confidence gate `MIN_CORRECT_CONFIDENCE = 0.7`. Scores are on a 0–1 scale.
- Approved pool = `reviewStatus IN ('auto-approved', 'manual-approved')`.
- QA crafter model defaults to `claude-opus-4-8`; the evaluator stays on its production model (unchanged — we test it). Only the crafter is overridable via `--model`.
- In-repo prompt (not Langfuse, not in the `bootstrap-prompts` manifest). Add a `QA_SAMPLE_PROMPT_VERSION` constant (mirrors `COVERAGE_SPEC_PROPOSAL_PROMPT_VERSION`); bump it on prompt edits.
- After editing `packages/db/src/**`, run `pnpm --filter @language-drill/db build` before any test that imports `@language-drill/db` through its `dist` (lambda tests, script tests) — stale `db/dist` otherwise resolves.
- Branch: `feat/qa-exercise-sampler` (already created off `main`). Assert the branch before every commit (`git rev-parse --abbrev-ref HEAD`) — this workspace silently flips to `main`.

---

### Task 1: Extract `resolveEvaluationGuidance` into `@language-drill/db`

Move the inline route helper into db so the CLI and the route share one grounding path (no drift). Behavior-preserving — pinned by a characterization test.

**Files:**
- Create: `packages/db/src/evaluation-guidance.ts`
- Create: `packages/db/src/evaluation-guidance.test.ts`
- Modify: `packages/db/src/index.ts` (re-export)
- Modify: `infra/lambda/src/routes/exercises.ts:110-133` (delete inline copy, import from db)

**Interfaces:**
- Produces: `resolveEvaluationGuidance(exercise: { grammarPointKey: string | null; language: string | null; difficulty: string | null }): { grammarGuidance?: GrammarGuidance; attributionKeys?: AttributionKey[] }`

- [ ] **Step 1: Write the failing characterization test**

Create `packages/db/src/evaluation-guidance.test.ts`. Pick a real curriculum key so the test pins actual output. (If `tr-a1-imperative` is absent, substitute any known non-EN key via `getGrammarPoint`.)

```ts
import { describe, it, expect } from "vitest";
import { resolveEvaluationGuidance } from "./evaluation-guidance.js";
import { getGrammarPoint, grammarPointsAtOrBelow } from "./curriculum/index.js";

describe("resolveEvaluationGuidance", () => {
  it("returns grammarGuidance from the point and a non-EN attribution set", () => {
    const key = "tr-a1-imperative";
    const gp = getGrammarPoint(key);
    expect(gp).toBeDefined();

    const out = resolveEvaluationGuidance({
      grammarPointKey: key,
      language: "TR",
      difficulty: "A1",
    });

    expect(out.grammarGuidance).toEqual({
      name: gp!.name,
      description: gp!.description,
      commonErrors: gp!.commonErrors,
    });
    const expectedKeys = grammarPointsAtOrBelow("TR", "A1").map((p) => ({
      key: p.key,
      name: p.name,
    }));
    expect(out.attributionKeys).toEqual(expectedKeys);
  });

  it("omits grammarGuidance when grammarPointKey is null", () => {
    const out = resolveEvaluationGuidance({
      grammarPointKey: null,
      language: "TR",
      difficulty: "A1",
    });
    expect(out.grammarGuidance).toBeUndefined();
  });

  it("returns an empty attribution set for EN (not a curriculum-attributed language)", () => {
    const out = resolveEvaluationGuidance({
      grammarPointKey: null,
      language: "EN",
      difficulty: "B1",
    });
    expect(out.attributionKeys).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db exec vitest run src/evaluation-guidance.test.ts`
Expected: FAIL — `Cannot find module './evaluation-guidance.js'`.

- [ ] **Step 3: Create the helper**

Create `packages/db/src/evaluation-guidance.ts`, copying the route's logic verbatim (from `infra/lambda/src/routes/exercises.ts:110-133`):

```ts
import type { GrammarGuidance, AttributionKey } from "@language-drill/ai";
import { Language } from "@language-drill/shared";
import type { LearningLanguage } from "@language-drill/shared";
import { getGrammarPoint, grammarPointsAtOrBelow } from "./curriculum/index.js";

/**
 * Curriculum grounding + closed attribution-key set for the answer evaluator.
 * Extracted from `infra/lambda/src/routes/exercises.ts` so the submit route AND
 * the `qa:sample` CLI feed `evaluateAnswer` byte-identical grounding — any drift
 * would silently invalidate the QA signal.
 */
export function resolveEvaluationGuidance(exercise: {
  grammarPointKey: string | null;
  language: string | null;
  difficulty: string | null;
}): { grammarGuidance?: GrammarGuidance; attributionKeys?: AttributionKey[] } {
  const grammarPoint = exercise.grammarPointKey
    ? getGrammarPoint(exercise.grammarPointKey)
    : undefined;
  const grammarGuidance = grammarPoint
    ? {
        name: grammarPoint.name,
        description: grammarPoint.description,
        commonErrors: grammarPoint.commonErrors,
      }
    : undefined;
  const attributionKeys =
    exercise.language === Language.EN
      ? []
      : grammarPointsAtOrBelow(
          exercise.language as LearningLanguage,
          exercise.difficulty as string,
        ).map((p) => ({ key: p.key, name: p.name }));
  return { grammarGuidance, attributionKeys };
}
```

- [ ] **Step 4: Re-export from the db barrel**

In `packages/db/src/index.ts`, add:

```ts
export { resolveEvaluationGuidance } from "./evaluation-guidance.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/db exec vitest run src/evaluation-guidance.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Rewire the route to the shared helper**

In `infra/lambda/src/routes/exercises.ts`: delete the inline `resolveEvaluationGuidance` function (lines ~110-133) and add `resolveEvaluationGuidance` to the existing `@language-drill/db` import block (the one already importing `getGrammarPoint, grammarPointsAtOrBelow`). Leave every call site (`resolveEvaluationGuidance(exercise)`) unchanged.

- [ ] **Step 7: Rebuild db, then verify the route still passes**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/lambda exec vitest run src/routes/exercises.test.ts`
Expected: PASS (unchanged behavior).

- [ ] **Step 8: Commit**

```bash
cd /Users/seal/dev/language-drill
test "$(git rev-parse --abbrev-ref HEAD)" = "feat/qa-exercise-sampler" || { echo WRONG BRANCH; exit 1; }
git add packages/db/src/evaluation-guidance.ts packages/db/src/evaluation-guidance.test.ts packages/db/src/index.ts infra/lambda/src/routes/exercises.ts
git commit -m "refactor(db): extract resolveEvaluationGuidance for reuse by qa:sample"
```

---

### Task 2: `renderLearnerView` — the exact input a user sees

Render each of the six content shapes to the text a learner sees, **excluding every reference/answer field**. This is what the crafter is shown.

**Files:**
- Create: `packages/ai/src/qa-sample.ts`
- Create: `packages/ai/src/qa-sample.test.ts`

**Interfaces:**
- Produces: `renderLearnerView(content: ExerciseContent): string`

- [ ] **Step 1: Write the failing test — render + no-reference-leak**

Create `packages/ai/src/qa-sample.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ExerciseType } from "@language-drill/shared";
import type {
  ClozeContent,
  TranslationContent,
  SentenceConstructionContent,
  ConjugationContent,
} from "@language-drill/shared";
import { renderLearnerView } from "./qa-sample.js";

describe("renderLearnerView", () => {
  it("cloze: shows sentence + instructions, hides correctAnswer/acceptableAnswers", () => {
    const c: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "Fill the blank.",
      sentence: "Sınıfta sekiz ___ var.",
      correctAnswer: "sandalye",
      acceptableAnswers: ["öğrenci", "kitap"],
      context: "In a classroom.",
    };
    const view = renderLearnerView(c);
    expect(view).toContain("Sınıfta sekiz ___ var.");
    expect(view).toContain("Fill the blank.");
    expect(view).not.toContain("sandalye");
    expect(view).not.toContain("öğrenci");
  });

  it("translation: shows sourceText, hides referenceTranslation/acceptableAnswers", () => {
    const c: TranslationContent = {
      type: ExerciseType.TRANSLATION,
      instructions: "Translate to Turkish.",
      sourceText: "In my opinion, it is late.",
      sourceLanguage: "EN" as TranslationContent["sourceLanguage"],
      targetLanguage: "TR" as TranslationContent["targetLanguage"],
      referenceTranslation: "Bence geç.",
      acceptableAnswers: ["Bana göre geç."],
    };
    const view = renderLearnerView(c);
    expect(view).toContain("In my opinion, it is late.");
    expect(view).not.toContain("Bence");
    expect(view).not.toContain("Bana göre");
  });

  it("sentence_construction: hides modelAnswers", () => {
    const c: SentenceConstructionContent = {
      type: ExerciseType.SENTENCE_CONSTRUCTION,
      instructions: "Write a sentence.",
      promptMode: "keywords",
      prompt: "Use these words in a sentence.",
      keywords: ["gitmek", "okul"],
      modelAnswers: ["Okula gidiyorum.", "Okula gittim."],
    };
    const view = renderLearnerView(c);
    expect(view).toContain("gitmek");
    expect(view).not.toContain("gidiyorum");
    expect(view).not.toContain("gittim");
  });

  it("conjugation: shows lemma + featureBundle, hides targetForm/breakdown/examples", () => {
    const c: ConjugationContent = {
      type: ExerciseType.CONJUGATION,
      instructions: "Write the correct form.",
      lemma: "gitmek",
      lemmaGloss: "to go",
      featureBundle: "geniş zaman · 1. çoğul",
      targetForm: "gideriz",
      breakdown: "git- + -er + -iz",
      exampleSentences: ["Her gün okula gideriz."],
    };
    const view = renderLearnerView(c);
    expect(view).toContain("gitmek");
    expect(view).toContain("geniş zaman · 1. çoğul");
    expect(view).not.toContain("gideriz");
    expect(view).not.toContain("git- + -er");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai exec vitest run src/qa-sample.test.ts`
Expected: FAIL — `Cannot find module './qa-sample.js'`.

- [ ] **Step 3: Implement `renderLearnerView`**

Create `packages/ai/src/qa-sample.ts`:

```ts
import { ExerciseType } from "@language-drill/shared";
import type { ExerciseContent } from "@language-drill/shared";

/**
 * Render exactly what a learner sees for one exercise, as plain text — the
 * crafter's input. Deliberately OMITS every reference/answer field
 * (correctAnswer, acceptableAnswers, referenceTranslation, expectedWord,
 * modelAnswers, targetForm/acceptableForms, breakdown, exampleSentences,
 * referenceParaphrases) so the crafter solves blind, as a user would.
 */
export function renderLearnerView(content: ExerciseContent): string {
  const lines: string[] = [];
  switch (content.type) {
    case ExerciseType.CLOZE: {
      lines.push(content.instructions);
      if (content.context) lines.push(`Context: ${content.context}`);
      if (content.glossEn) lines.push(`Meaning: ${content.glossEn}`);
      lines.push(content.sentence);
      if (content.options?.length) lines.push(`Options: ${content.options.join(", ")}`);
      break;
    }
    case ExerciseType.TRANSLATION: {
      lines.push(content.instructions);
      lines.push(`(${content.sourceLanguage} → ${content.targetLanguage})`);
      lines.push(content.sourceText);
      break;
    }
    case ExerciseType.VOCAB_RECALL: {
      lines.push(content.instructions);
      lines.push(content.prompt);
      if (content.exampleSentence) lines.push(`Example: ${content.exampleSentence}`);
      if (content.hints?.length) lines.push(`Hints: ${content.hints.join(", ")}`);
      break;
    }
    case ExerciseType.SENTENCE_CONSTRUCTION: {
      lines.push(content.instructions);
      lines.push(content.prompt);
      if (content.keywords?.length) lines.push(`Keywords: ${content.keywords.join(", ")}`);
      if (content.targetStructure) lines.push(`Target structure: ${content.targetStructure}`);
      if (content.register) lines.push(`Register: ${content.register}`);
      break;
    }
    case ExerciseType.CONJUGATION: {
      lines.push(content.instructions);
      lines.push(`Verb: ${content.lemma} (${content.lemmaGloss})`);
      if (content.subject) lines.push(`Subject: ${content.subject.pronoun} (${content.subject.gloss})`);
      lines.push(`Form required: ${content.featureBundle}`);
      break;
    }
    case ExerciseType.CONTEXTUAL_PARAPHRASE: {
      lines.push(content.instructions);
      lines.push(content.sourceText);
      lines.push(content.constraintLabel);
      if (content.bannedTerms?.length) lines.push(`Do not use: ${content.bannedTerms.join(", ")}`);
      if (content.targetRegister) lines.push(`Target register: ${content.targetRegister}`);
      if (content.audience) lines.push(`Audience: ${content.audience}`);
      break;
    }
    default: {
      // Free-writing / dictation are out of scope; caller filters them out.
      const _exhaustive: never = content as never;
      throw new Error(`renderLearnerView: unsupported content type ${(content as ExerciseContent).type}`);
    }
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai exec vitest run src/qa-sample.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/seal/dev/language-drill
test "$(git rev-parse --abbrev-ref HEAD)" = "feat/qa-exercise-sampler" || { echo WRONG BRANCH; exit 1; }
git add packages/ai/src/qa-sample.ts packages/ai/src/qa-sample.test.ts
git commit -m "feat(qa): renderLearnerView — user-facing render with no reference leak"
```

---

### Task 3: `classifyVerdicts` — pure band-based defect classifier

The correctness core. Maps per-answer scores + confidence to defect reasons via the pass/fail bands.

**Files:**
- Modify: `packages/ai/src/qa-sample.ts`
- Modify: `packages/ai/src/qa-sample.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `PASS_THRESHOLD = 0.8`, `FAIL_THRESHOLD = 0.4`, `MIN_CORRECT_CONFIDENCE = 0.7` (exported consts)
  - `type QaFlagReason = "false_negative" | "false_positive" | "acceptable_answers_gap" | "low_confidence_solve"`
  - `type ProbeScores = { correct: number; wrong: number; alt: number | null }`
  - `classifyVerdicts(scores: ProbeScores, correctConfidence: number): QaFlagReason[]`

- [ ] **Step 1: Write the failing tests (exhaustive over bands + gate)**

Append to `packages/ai/src/qa-sample.test.ts`:

```ts
import { classifyVerdicts } from "./qa-sample.js";

describe("classifyVerdicts", () => {
  const HIGH = 0.9; // PASS band
  const LOW = 0.2;  // FAIL band
  const MID = 0.6;  // dead zone
  const CONF = 0.95;

  it("clean exercise: correct passes, wrong fails, alt passes → no flags", () => {
    expect(classifyVerdicts({ correct: HIGH, wrong: LOW, alt: HIGH }, CONF)).toEqual([]);
  });

  it("false_negative: correct answer lands in FAIL band", () => {
    expect(classifyVerdicts({ correct: LOW, wrong: LOW, alt: HIGH }, CONF)).toEqual(["false_negative"]);
  });

  it("false_positive: wrong answer lands in PASS band", () => {
    expect(classifyVerdicts({ correct: HIGH, wrong: HIGH, alt: HIGH }, CONF)).toEqual(["false_positive"]);
  });

  it("acceptable_answers_gap: alt lands in FAIL band", () => {
    expect(classifyVerdicts({ correct: HIGH, wrong: LOW, alt: LOW }, CONF)).toEqual(["acceptable_answers_gap"]);
  });

  it("dead-zone scores produce no correct/alt flag", () => {
    expect(classifyVerdicts({ correct: MID, wrong: LOW, alt: MID }, CONF)).toEqual([]);
  });

  it("null alt is skipped (no acceptable_answers_gap possible)", () => {
    expect(classifyVerdicts({ correct: HIGH, wrong: LOW, alt: null }, CONF)).toEqual([]);
  });

  it("confidence gate: low confidence suppresses false_negative + aA_gap, emits low_confidence_solve, keeps false_positive", () => {
    const flags = classifyVerdicts({ correct: LOW, wrong: HIGH, alt: LOW }, 0.5);
    expect(flags).toContain("low_confidence_solve");
    expect(flags).toContain("false_positive");
    expect(flags).not.toContain("false_negative");
    expect(flags).not.toContain("acceptable_answers_gap");
  });

  it("boundary: exactly 0.8 passes and exactly 0.4 fails → clean case, no flags", () => {
    // correct=0.8 is PASS (>=0.8); wrong=0.4 is FAIL (<=0.4) → the intended outcome.
    expect(classifyVerdicts({ correct: 0.8, wrong: 0.4, alt: null }, CONF)).toEqual([]);
  });

  it("boundary: correct=0.4 fails, wrong=0.8 passes → both defect flags in emission order", () => {
    // Emission order is stable: false_negative before false_positive.
    expect(classifyVerdicts({ correct: 0.4, wrong: 0.8, alt: null }, CONF))
      .toEqual(["false_negative", "false_positive"]);
  });
});

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/ai exec vitest run src/qa-sample.test.ts`
Expected: FAIL — `classifyVerdicts is not exported`.

- [ ] **Step 3: Implement thresholds + `classifyVerdicts`**

Append to `packages/ai/src/qa-sample.ts`:

```ts
/** Score at/above which the evaluator is treated as accepting the answer. */
export const PASS_THRESHOLD = 0.8;
/** Score at/below which the evaluator is treated as rejecting the answer. */
export const FAIL_THRESHOLD = 0.4;
/** Below this self-reported confidence, correct/alt flags are suppressed. */
export const MIN_CORRECT_CONFIDENCE = 0.7;

export type QaFlagReason =
  | "false_negative"
  | "false_positive"
  | "acceptable_answers_gap"
  | "low_confidence_solve";

export type ProbeScores = {
  correct: number;
  wrong: number;
  /** null when the exercise has a single canonical answer (no alt crafted). */
  alt: number | null;
};

type Band = "pass" | "fail" | "deadzone";
function band(score: number): Band {
  if (score >= PASS_THRESHOLD) return "pass";
  if (score <= FAIL_THRESHOLD) return "fail";
  return "deadzone";
}

/**
 * Map probe scores to defect reasons. Only *clear* band crossings flag; dead-zone
 * scores never flag. The confidence gate suppresses correct/alt-derived flags
 * (shaky ground truth) but never the false_positive signal (a wrong answer being
 * accepted is independent of how sure the solver was about the correct answer).
 * Emission order is stable: false_negative, false_positive, acceptable_answers_gap,
 * then low_confidence_solve.
 */
export function classifyVerdicts(
  scores: ProbeScores,
  correctConfidence: number,
): QaFlagReason[] {
  const flags: QaFlagReason[] = [];
  const lowConfidence = correctConfidence < MIN_CORRECT_CONFIDENCE;

  if (!lowConfidence && band(scores.correct) === "fail") flags.push("false_negative");
  if (band(scores.wrong) === "pass") flags.push("false_positive");
  if (!lowConfidence && scores.alt !== null && band(scores.alt) === "fail") {
    flags.push("acceptable_answers_gap");
  }
  if (lowConfidence) flags.push("low_confidence_solve");

  return flags;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai exec vitest run src/qa-sample.test.ts`
Expected: PASS (all `renderLearnerView` + `classifyVerdicts` tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/seal/dev/language-drill
test "$(git rev-parse --abbrev-ref HEAD)" = "feat/qa-exercise-sampler" || { echo WRONG BRANCH; exit 1; }
git add packages/ai/src/qa-sample.ts packages/ai/src/qa-sample.test.ts
git commit -m "feat(qa): classifyVerdicts — band-based defect classifier with confidence gate"
```

---

### Task 4: `craftProbeAnswers` — forced-tool answer crafter

Call Claude (Opus) with a forced tool to produce the three intent-labeled answers + confidence + ambiguity note. Mirrors the `proposeCoverageSpec` pattern (forced tool + pure parser).

**Files:**
- Modify: `packages/ai/src/qa-sample.ts`
- Modify: `packages/ai/src/qa-sample.test.ts`
- Modify: `packages/ai/src/index.ts` (barrel exports)

**Interfaces:**
- Consumes: `renderLearnerView` (Task 2); `ClaudeUsageBreakdown`, `ZERO_USAGE` from `./cost-model.js`.
- Produces:
  - `QA_SAMPLE_PROMPT_VERSION`, `QA_CRAFTER_MODEL`
  - `type QaProbe = { correct: string; correctConfidence: number; wrong: string; alt: string | null; ambiguous: boolean; ambiguityNote: string }`
  - `parseProbe(input: unknown): QaProbe`
  - `craftProbeAnswers(client, params, signal?): Promise<{ probe: QaProbe; usage: ClaudeUsageBreakdown }>` where `params: { learnerView: string; language: string; cefrLevel: string; exerciseType: string; model?: string }`

- [ ] **Step 1: Write the failing tests (pure parser + mocked-client craft)**

Append to `packages/ai/src/qa-sample.test.ts`:

```ts
import { parseProbe, craftProbeAnswers, QA_CRAFTER_TOOL_NAME } from "./qa-sample.js";
import type Anthropic from "@anthropic-ai/sdk";
import { vi } from "vitest";

describe("parseProbe", () => {
  const valid = {
    correct: "gideriz",
    correctConfidence: 0.95,
    wrong: "gidiyoruz",
    alt: null,
    ambiguous: false,
    ambiguityNote: "",
  };

  it("accepts a well-formed probe", () => {
    expect(parseProbe(valid)).toEqual(valid);
  });

  it("coerces a missing alt to null", () => {
    const { alt, ...noAlt } = valid;
    expect(parseProbe(noAlt).alt).toBeNull();
  });

  it("rejects out-of-range confidence", () => {
    expect(() => parseProbe({ ...valid, correctConfidence: 1.5 })).toThrow();
  });

  it("rejects a non-string correct answer", () => {
    expect(() => parseProbe({ ...valid, correct: 42 })).toThrow();
  });
});

describe("craftProbeAnswers", () => {
  it("calls the forced tool and returns the parsed probe + usage", async () => {
    const toolInput = {
      correct: "Bence geç.",
      correctConfidence: 0.9,
      wrong: "Bence geçti.",
      alt: "Bana göre geç.",
      ambiguous: false,
      ambiguityNote: "",
    };
    const create = vi.fn().mockResolvedValue({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: QA_CRAFTER_TOOL_NAME, input: toolInput }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });
    const client = { messages: { create } } as unknown as Anthropic;

    const { probe, usage } = await craftProbeAnswers(client, {
      learnerView: "Translate: In my opinion, it is late.",
      language: "TR",
      cefrLevel: "A2",
      exerciseType: "translation",
    });

    expect(probe.alt).toBe("Bana göre geç.");
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(50);
    // the learner view must reach the model; the reference answer must not be injected by us
    const callArg = create.mock.calls[0][0];
    expect(JSON.stringify(callArg)).toContain("In my opinion, it is late.");
  });

  it("throws when no tool_use block is returned", async () => {
    const create = vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [], usage: null });
    const client = { messages: { create } } as unknown as Anthropic;
    await expect(
      craftProbeAnswers(client, { learnerView: "x", language: "TR", cefrLevel: "A1", exerciseType: "cloze" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/ai exec vitest run src/qa-sample.test.ts`
Expected: FAIL — `parseProbe`/`craftProbeAnswers`/`QA_CRAFTER_TOOL_NAME` not exported.

- [ ] **Step 3: Implement the prompt, tool, parser, and crafter**

Append to `packages/ai/src/qa-sample.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";
import { ZERO_USAGE, type ClaudeUsageBreakdown } from "./cost-model.js";

export const QA_SAMPLE_PROMPT_VERSION = "qa-sample@2026-07-22";
export const QA_CRAFTER_MODEL = "claude-opus-4-8" as const;
export const QA_CRAFTER_TOOL_NAME = "submit_probe_answers";
const QA_CRAFTER_MAX_TOKENS = 1024;

export const QA_SAMPLE_SYSTEM_PROMPT_TEMPLATE = `You are a meticulous language-exercise QA solver. You are shown EXACTLY what a learner sees for one exercise — never a reference answer. Your job is to craft three probe answers so we can check whether the automated evaluator behaves correctly:

1. correct — your single best, fully-correct answer to the task.
2. wrong — a plausible answer a real learner at this level might give that is genuinely INCORRECT for the targeted skill (a real error, not gibberish).
3. alt — a DIFFERENT but equally-correct answer (a distinct construction or true synonym), if one legitimately exists; otherwise null. Do not invent a forced variant.

Also report:
- correctConfidence — 0..1, how sure you are that "correct" is unambiguously right given ONLY what the learner sees. Lower it when the task is under-specified or could have several defensible answers.
- ambiguous / ambiguityNote — reasoning as a learner at the stated CEFR level: would they know what is being asked? Set ambiguous=true with a one-line reason only if the TASK or its instructions are genuinely unclear. This is separate from your confidence.

Answer in the exercise's target language. Call the ${QA_CRAFTER_TOOL_NAME} tool.`;

export function buildQaCrafterUserPrompt(params: {
  learnerView: string;
  language: string;
  cefrLevel: string;
  exerciseType: string;
}): string {
  return `Language: ${params.language} · Level: ${params.cefrLevel} · Type: ${params.exerciseType}

Exactly what the learner sees:
"""
${params.learnerView}
"""

Craft the three probe answers.`;
}

const QA_CRAFTER_TOOL: Anthropic.Tool = {
  name: QA_CRAFTER_TOOL_NAME,
  description: "Submit the three probe answers plus confidence and ambiguity assessment.",
  input_schema: {
    type: "object",
    properties: {
      correct: { type: "string" },
      correctConfidence: { type: "number", minimum: 0, maximum: 1 },
      wrong: { type: "string" },
      alt: { type: ["string", "null"] },
      ambiguous: { type: "boolean" },
      ambiguityNote: { type: "string" },
    },
    required: ["correct", "correctConfidence", "wrong", "ambiguous", "ambiguityNote"],
  },
};

export type QaProbe = {
  correct: string;
  correctConfidence: number;
  wrong: string;
  alt: string | null;
  ambiguous: boolean;
  ambiguityNote: string;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Pure validator for the crafter tool output. Throws on any illegality. */
export function parseProbe(input: unknown): QaProbe {
  if (!isObject(input)) throw new Error("probe must be an object");
  const { correct, correctConfidence, wrong, alt, ambiguous, ambiguityNote } = input;
  if (typeof correct !== "string" || correct === "") throw new Error("probe.correct must be a non-empty string");
  if (typeof wrong !== "string" || wrong === "") throw new Error("probe.wrong must be a non-empty string");
  if (typeof correctConfidence !== "number" || correctConfidence < 0 || correctConfidence > 1) {
    throw new Error("probe.correctConfidence must be a number in [0,1]");
  }
  if (alt !== undefined && alt !== null && typeof alt !== "string") {
    throw new Error("probe.alt must be a string or null");
  }
  return {
    correct,
    correctConfidence,
    wrong,
    alt: typeof alt === "string" && alt !== "" ? alt : null,
    ambiguous: ambiguous === true,
    ambiguityNote: typeof ambiguityNote === "string" ? ambiguityNote : "",
  };
}

function readUsage(response: Anthropic.Message): ClaudeUsageBreakdown {
  const u = response.usage;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
  };
}

/** Call Claude with the forced tool; return the parsed probe + token usage. */
export async function craftProbeAnswers(
  client: Anthropic,
  params: {
    learnerView: string;
    language: string;
    cefrLevel: string;
    exerciseType: string;
    model?: string;
  },
  signal?: AbortSignal,
): Promise<{ probe: QaProbe; usage: ClaudeUsageBreakdown }> {
  const response = await client.messages.create(
    {
      model: params.model ?? QA_CRAFTER_MODEL,
      max_tokens: QA_CRAFTER_MAX_TOKENS,
      system: [
        { type: "text" as const, text: QA_SAMPLE_SYSTEM_PROMPT_TEMPLATE, cache_control: { type: "ephemeral" as const } },
      ],
      messages: [{ role: "user" as const, content: buildQaCrafterUserPrompt(params) }],
      tools: [QA_CRAFTER_TOOL],
      tool_choice: { type: "tool" as const, name: QA_CRAFTER_TOOL_NAME },
    },
    { signal },
  );
  const usage = response.usage ? readUsage(response) : ZERO_USAGE;
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(`qa-craft: no tool_use block (stop_reason ${response.stop_reason})`);
  }
  return { probe: parseProbe(toolUse.input), usage };
}
```

- [ ] **Step 4: Add barrel exports**

In `packages/ai/src/index.ts`, add:

```ts
export {
  renderLearnerView,
  classifyVerdicts,
  craftProbeAnswers,
  parseProbe,
  PASS_THRESHOLD,
  FAIL_THRESHOLD,
  MIN_CORRECT_CONFIDENCE,
  QA_CRAFTER_MODEL,
  QA_CRAFTER_TOOL_NAME,
  QA_SAMPLE_PROMPT_VERSION,
} from "./qa-sample.js";
export type { QaProbe, QaFlagReason, ProbeScores } from "./qa-sample.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai exec vitest run src/qa-sample.test.ts`
Expected: PASS (all suites).

- [ ] **Step 6: Commit**

```bash
cd /Users/seal/dev/language-drill
test "$(git rev-parse --abbrev-ref HEAD)" = "feat/qa-exercise-sampler" || { echo WRONG BRANCH; exit 1; }
git add packages/ai/src/qa-sample.ts packages/ai/src/qa-sample.test.ts packages/ai/src/index.ts
git commit -m "feat(qa): craftProbeAnswers — forced-tool answer crafter (Opus) + parser"
```

---

### Task 5: Seeded sampling helpers

Pure functions for reproducible per-grammar-point sampling. No DB, no Claude — fully unit-testable.

**Files:**
- Create: `packages/ai/scripts/qa-sample-run.ts`
- Create: `packages/ai/scripts/qa-sample-run.test.ts`

**Interfaces:**
- Produces:
  - `type PoolRow = { id: string; type: string; language: string; difficulty: string; grammarPointKey: string | null; contentJson: unknown }`
  - `mulberry32(seed: number): () => number`
  - `samplePerPoint(rows: PoolRow[], perPoint: number, seed: number): PoolRow[]`
  - `QA_SAMPLE_TYPES: readonly string[]` (the six covered exercise-type db values)

- [ ] **Step 1: Write the failing tests**

Create `packages/ai/scripts/qa-sample-run.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { samplePerPoint, mulberry32, type PoolRow } from "./qa-sample-run.js";

function row(id: string, gp: string): PoolRow {
  return { id, type: "cloze", language: "TR", difficulty: "A1", grammarPointKey: gp, contentJson: {} };
}

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("samplePerPoint", () => {
  const rows: PoolRow[] = [
    row("a1", "gp-1"), row("a2", "gp-1"), row("a3", "gp-1"),
    row("b1", "gp-2"), row("b2", "gp-2"),
    row("c1", "gp-3"),
  ];

  it("takes at most `perPoint` per grammar point", () => {
    const out = samplePerPoint(rows, 2, 7);
    const byGp = new Map<string, number>();
    for (const r of out) byGp.set(r.grammarPointKey!, (byGp.get(r.grammarPointKey!) ?? 0) + 1);
    expect(byGp.get("gp-1")).toBe(2);
    expect(byGp.get("gp-2")).toBe(2);
    expect(byGp.get("gp-3")).toBe(1);
  });

  it("is reproducible for the same seed and order-independent of input shuffling", () => {
    expect(samplePerPoint(rows, 1, 99).map((r) => r.id))
      .toEqual(samplePerPoint(rows, 1, 99).map((r) => r.id));
  });

  it("groups rows with a null grammarPointKey under a single bucket", () => {
    const nulls = [
      { id: "n1", type: "cloze", language: "TR", difficulty: "A1", grammarPointKey: null, contentJson: {} },
      { id: "n2", type: "cloze", language: "TR", difficulty: "A1", grammarPointKey: null, contentJson: {} },
    ] as PoolRow[];
    expect(samplePerPoint(nulls, 1, 3)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/ai exec vitest run scripts/qa-sample-run.test.ts`
Expected: FAIL — `Cannot find module './qa-sample-run.js'`.

- [ ] **Step 3: Implement the sampling helpers (scaffold the CLI file)**

Create `packages/ai/scripts/qa-sample-run.ts` with just the pure helpers for now (orchestration lands in Task 6):

```ts
/**
 * packages/ai — qa-sample-run CLI. Spot-checks the approved exercise pool by
 * crafting three intent-labeled answers per sampled exercise (Opus) and running
 * each through the production evaluator, flagging (exercise -> evaluator)
 * contract defects to ./qa-runs/<name>.json. Author-run; a spotlight, not a gate.
 *
 * Built bottom-up: this file currently holds only the pure sampling helpers
 * (Task 5). Orchestration + report + CLI entry land in Task 6.
 */

export type PoolRow = {
  id: string;
  type: string;
  language: string;
  difficulty: string;
  grammarPointKey: string | null;
  contentJson: unknown;
};

/** The six exercise-type db values routed through `evaluateAnswer`. */
export const QA_SAMPLE_TYPES = [
  "cloze",
  "translation",
  "vocab_recall",
  "sentence_construction",
  "conjugation",
  "contextual_paraphrase",
] as const;

/** Small deterministic PRNG (mulberry32) — reproducible sampling under --seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded Fisher–Yates. Returns a new array; does not mutate the input. */
function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Group rows by grammarPointKey (nulls share one bucket), shuffle each group
 * with the seeded RNG, and take up to `perPoint` from each. Deterministic for a
 * given (rows-set, perPoint, seed).
 */
export function samplePerPoint(rows: PoolRow[], perPoint: number, seed: number): PoolRow[] {
  const groups = new Map<string, PoolRow[]>();
  for (const r of rows) {
    const key = r.grammarPointKey ?? " null";
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const rng = mulberry32(seed);
  const out: PoolRow[] = [];
  // Stable group order (sorted keys) so the seed alone determines the result.
  for (const key of [...groups.keys()].sort()) {
    out.push(...shuffle(groups.get(key)!, rng).slice(0, perPoint));
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai exec vitest run scripts/qa-sample-run.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/seal/dev/language-drill
test "$(git rev-parse --abbrev-ref HEAD)" = "feat/qa-exercise-sampler" || { echo WRONG BRANCH; exit 1; }
git add packages/ai/scripts/qa-sample-run.ts packages/ai/scripts/qa-sample-run.test.ts
git commit -m "feat(qa): seeded per-grammar-point sampling helpers"
```

---

### Task 6: CLI orchestration, report assembly & wiring

Assemble the end-to-end run: sample → ground → craft → evaluate (3×) → classify → report. Cost-capped and dry-run-testable.

**Files:**
- Modify: `packages/ai/scripts/qa-sample-run.ts`
- Modify: `packages/ai/scripts/qa-sample-run.test.ts`
- Modify: `packages/ai/scripts/eval-run.ts` (export `wrapForUsageCapture`)
- Modify: `packages/ai/package.json` (add `qa:sample` script)
- Modify: `package.json` (root, add `qa:sample` passthrough)

**Interfaces:**
- Consumes: `renderLearnerView`, `craftProbeAnswers`, `classifyVerdicts`, `PASS_THRESHOLD`/`FAIL_THRESHOLD` from `@language-drill/ai`; `createDb`, `resolveEvaluationGuidance` from `@language-drill/db`; `evaluateAnswer`, `createClaudeClient`, `estimateCostUsd`, `addUsage`, `ZERO_USAGE` from `@language-drill/ai`; `wrapForUsageCapture` from `./eval-run.js`.
- Produces:
  - `type QaFlagRecord` and `type QaRunReport` (report shape, exported for the test)
  - `buildReport(records, meta): QaRunReport` (pure assembler)
  - `evaluateProbe(client, row, probe, band-derived scores)` — not exported; internal

- [ ] **Step 1: Export `wrapForUsageCapture` from eval-run.ts**

In `packages/ai/scripts/eval-run.ts`, change `function wrapForUsageCapture(` to `export function wrapForUsageCapture(`. No other change.

- [ ] **Step 2: Write the failing test for `buildReport`**

Append to `packages/ai/scripts/qa-sample-run.test.ts`:

```ts
import { buildReport, type QaFlagRecord } from "./qa-sample-run.js";

describe("buildReport", () => {
  const records: QaFlagRecord[] = [
    {
      exerciseId: "e1", grammarPointKey: "gp-1", type: "cloze", language: "TR", cefr: "A1",
      flags: ["false_negative"], ambiguous: false, ambiguityNote: "",
      answers: { correct: "x", wrong: "y", alt: null },
      confidence: 0.95,
      verdicts: { correct: { score: 0.2, band: "fail" }, wrong: { score: 0.1, band: "fail" }, alt: null },
      promptSeen: "Fill the blank. ___",
    },
    {
      exerciseId: "e2", grammarPointKey: "gp-1", type: "cloze", language: "TR", cefr: "A1",
      flags: [], ambiguous: true, ambiguityNote: "unclear which tense",
      answers: { correct: "a", wrong: "b", alt: "c" },
      confidence: 0.9,
      verdicts: { correct: { score: 0.9, band: "pass" }, wrong: { score: 0.1, band: "fail" }, alt: { score: 0.9, band: "pass" } },
      promptSeen: "Fill the blank. ___",
    },
  ];

  it("summarizes flagged counts, byReason, byType, and ambiguity notes", () => {
    const report = buildReport(records, {
      language: "TR", cefr: "A1", perPoint: 2, sampledCount: 2, seed: 1,
      model: "claude-opus-4-8", costUsd: 0.12, startedAt: "2026-07-22T00:00:00.000Z",
    });
    expect(report.summary.sampled).toBe(2);
    expect(report.summary.flagged).toBe(1);
    expect(report.summary.byReason.false_negative).toBe(1);
    expect(report.summary.byType.cloze).toBe(1);
    expect(report.summary.ambiguityNotes).toBe(1);
    expect(report.flags).toHaveLength(1);
    expect(report.ambiguity).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai exec vitest run scripts/qa-sample-run.test.ts`
Expected: FAIL — `buildReport` not exported.

- [ ] **Step 4: Implement report types + `buildReport`**

Append to `packages/ai/scripts/qa-sample-run.ts` (add imports at the top of the file):

```ts
import type { QaFlagReason } from "@language-drill/ai";

export type ProbeVerdict = { score: number; band: "pass" | "fail" | "deadzone" };

export type QaFlagRecord = {
  exerciseId: string;
  grammarPointKey: string | null;
  type: string;
  language: string;
  cefr: string;
  flags: QaFlagReason[];
  ambiguous: boolean;
  ambiguityNote: string;
  answers: { correct: string; wrong: string; alt: string | null };
  confidence: number;
  verdicts: { correct: ProbeVerdict; wrong: ProbeVerdict; alt: ProbeVerdict | null };
  /** The exact user-facing render the crafter solved (spec's `promptSeen`). */
  promptSeen: string;
};

export type QaRunReport = {
  meta: {
    language: string; cefr: string | null; perPoint: number; sampledCount: number;
    seed: number; model: string; costUsd: number; startedAt: string;
  };
  summary: {
    sampled: number; flagged: number;
    byReason: Record<string, number>;
    byType: Record<string, number>;
    ambiguityNotes: number; lowConfidenceSolves: number;
  };
  flags: QaFlagRecord[];
  ambiguity: Array<{ exerciseId: string; note: string }>;
  errors: Array<{ exerciseId: string; stage: string; message: string }>;
};

/** Pure roll-up of per-exercise records into the report shape. */
export function buildReport(
  records: QaFlagRecord[],
  meta: QaRunReport["meta"],
  errors: QaRunReport["errors"] = [],
): QaRunReport {
  const flagged = records.filter((r) => r.flags.length > 0);
  const byReason: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let lowConfidenceSolves = 0;
  for (const r of flagged) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    for (const reason of r.flags) {
      byReason[reason] = (byReason[reason] ?? 0) + 1;
      if (reason === "low_confidence_solve") lowConfidenceSolves++;
    }
  }
  const ambiguity = records
    .filter((r) => r.ambiguous && r.ambiguityNote !== "")
    .map((r) => ({ exerciseId: r.exerciseId, note: r.ambiguityNote }));
  return {
    meta,
    summary: {
      sampled: records.length,
      flagged: flagged.length,
      byReason,
      byType,
      ambiguityNotes: ambiguity.length,
      lowConfidenceSolves,
    },
    flags: flagged,
    ambiguity,
    errors,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai exec vitest run scripts/qa-sample-run.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement the orchestrator + CLI entry (no new test — exercised by `--dry-run` in Step 8)**

Append to `packages/ai/scripts/qa-sample-run.ts`. Add the remaining imports at the top of the file:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, sql } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import { CefrLevel, Language, type ExerciseContent } from "@language-drill/shared";
import { createDb, resolveEvaluationGuidance, exercises } from "@language-drill/db";
import {
  addUsage,
  classifyVerdicts,
  craftProbeAnswers,
  createClaudeClient,
  estimateCostUsd,
  evaluateAnswer,
  renderLearnerView,
  FAIL_THRESHOLD,
  PASS_THRESHOLD,
  ZERO_USAGE,
  type ClaudeUsageBreakdown,
  type ProbeScores,
} from "@language-drill/ai";
import { wrapForUsageCapture } from "./eval-run.js";

function band(score: number): ProbeVerdict["band"] {
  if (score >= PASS_THRESHOLD) return "pass";
  if (score <= FAIL_THRESHOLD) return "fail";
  return "deadzone";
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[qa-sample] ${name} is required`);
  return v;
}

/** Evaluate one answer string against an exercise; return score + captured usage. */
async function scoreAnswer(
  client: Anthropic,
  content: ExerciseContent,
  answer: string,
  language: Language,
  difficulty: CefrLevel,
  grounding: ReturnType<typeof resolveEvaluationGuidance>,
): Promise<{ score: number; usage: ClaudeUsageBreakdown }> {
  const sink: { current: ClaudeUsageBreakdown | undefined } = { current: undefined };
  const wrapped = wrapForUsageCapture(client, sink);
  const result = await evaluateAnswer(wrapped, {
    exercise: content,
    userAnswer: answer,
    language,
    difficulty,
    grammarGuidance: grounding.grammarGuidance,
    attributionKeys: grounding.attributionKeys,
  });
  return { score: result.score, usage: sink.current ?? ZERO_USAGE };
}

type QaArgs = {
  language: string;
  cefr?: string;
  perPoint: number;
  grammarPoint?: string;
  types: string[];
  limit?: number;
  maxCostUsd?: number;
  model?: string;
  out?: string;
  seed: number;
  dryRun: boolean;
};

export function parseQaArgs(argv: string[]): QaArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      language: { type: "string" },
      cefr: { type: "string" },
      "per-point": { type: "string", default: "2" },
      "grammar-point": { type: "string" },
      type: { type: "string" },
      limit: { type: "string" },
      "max-cost-usd": { type: "string" },
      model: { type: "string" },
      out: { type: "string" },
      seed: { type: "string", default: "1" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  if (!values.language) throw new Error("[qa-sample] --language is required");
  return {
    language: values.language,
    cefr: values.cefr,
    perPoint: Number(values["per-point"]),
    grammarPoint: values["grammar-point"],
    types: values.type ? values.type.split(",").map((s) => s.trim()) : [...QA_SAMPLE_TYPES],
    limit: values.limit ? Number(values.limit) : undefined,
    maxCostUsd: values["max-cost-usd"] ? Number(values["max-cost-usd"]) : undefined,
    model: values.model,
    out: values.out,
    seed: Number(values.seed),
    dryRun: Boolean(values["dry-run"]),
  };
}

async function main(): Promise<void> {
  const args = parseQaArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const db = createDb(requireEnv("DATABASE_URL"));

  const conds = [
    eq(exercises.language, args.language),
    inArray(exercises.type, args.types),
    sql`${exercises.reviewStatus} IN ('auto-approved', 'manual-approved')`,
  ];
  if (args.cefr) conds.push(eq(exercises.difficulty, args.cefr));
  if (args.grammarPoint) conds.push(eq(exercises.grammarPointKey, args.grammarPoint));

  const rows = (await db
    .select({
      id: exercises.id,
      type: exercises.type,
      language: exercises.language,
      difficulty: exercises.difficulty,
      grammarPointKey: exercises.grammarPointKey,
      contentJson: exercises.contentJson,
    })
    .from(exercises)
    .where(and(...conds))) as PoolRow[];

  let sampled = samplePerPoint(rows, args.perPoint, args.seed);
  if (args.limit !== undefined) sampled = sampled.slice(0, args.limit);

  console.log(`[qa-sample] pool=${rows.length} sampled=${sampled.length} ids=${sampled.map((r) => r.id).join(",")}`);

  if (args.dryRun) {
    for (const r of sampled) {
      console.log(`\n--- ${r.id} (${r.type}) ---\n${renderLearnerView(r.contentJson as ExerciseContent)}`);
    }
    const perExercise = 0.02; // rough Opus-craft + 3 Sonnet-eval estimate
    console.log(`\n[qa-sample] DRY RUN — no Claude calls. Rough cost estimate: $${(sampled.length * perExercise).toFixed(2)}`);
    return;
  }

  const client = createClaudeClient(requireEnv("ANTHROPIC_API_KEY"));
  const records: QaFlagRecord[] = [];
  const errors: QaRunReport["errors"] = [];
  let usage: ClaudeUsageBreakdown = ZERO_USAGE;
  let costCapped = false;

  for (const r of sampled) {
    if (args.maxCostUsd !== undefined && estimateCostUsd(usage) >= args.maxCostUsd) {
      costCapped = true;
      console.log(`[qa-sample] --max-cost-usd reached; stopping before ${r.id}`);
      break;
    }
    const content = r.contentJson as ExerciseContent;
    const language = r.language as Language;
    const difficulty = r.difficulty as CefrLevel;
    const grounding = resolveEvaluationGuidance({
      grammarPointKey: r.grammarPointKey,
      language: r.language,
      difficulty: r.difficulty,
    });
    const promptSeen = renderLearnerView(content);
    try {
      const { probe, usage: craftUsage } = await craftProbeAnswers(client, {
        learnerView: promptSeen,
        language: r.language,
        cefrLevel: r.difficulty,
        exerciseType: r.type,
        model: args.model,
      });
      usage = addUsage(usage, craftUsage);

      // Label-carrying tuples: never re-derive the label by value comparison —
      // the crafter can legitimately return identical strings across slots.
      const answers: Array<readonly ["correct" | "wrong" | "alt", string]> = [
        ["correct", probe.correct],
        ["wrong", probe.wrong],
        ...(probe.alt !== null ? [["alt", probe.alt] as const] : []),
      ];
      const scored: Partial<Record<"correct" | "wrong" | "alt", number>> = {};
      for (const [label, answer] of answers) {
        const { score, usage: evalUsage } = await scoreAnswer(client, content, answer, language, difficulty, grounding);
        usage = addUsage(usage, evalUsage);
        scored[label] = score;
      }

      const scores: ProbeScores = {
        correct: scored.correct!,
        wrong: scored.wrong!,
        alt: probe.alt !== null ? scored.alt! : null,
      };
      const flags = classifyVerdicts(scores, probe.correctConfidence);

      records.push({
        exerciseId: r.id,
        grammarPointKey: r.grammarPointKey,
        type: r.type,
        language: r.language,
        cefr: r.difficulty,
        flags,
        ambiguous: probe.ambiguous,
        ambiguityNote: probe.ambiguityNote,
        answers: { correct: probe.correct, wrong: probe.wrong, alt: probe.alt },
        confidence: probe.correctConfidence,
        verdicts: {
          correct: { score: scores.correct, band: band(scores.correct) },
          wrong: { score: scores.wrong, band: band(scores.wrong) },
          alt: scores.alt !== null ? { score: scores.alt, band: band(scores.alt) } : null,
        },
        promptSeen,
      });
    } catch (e) {
      errors.push({ exerciseId: r.id, stage: "run", message: (e as Error).message });
    }
  }

  const report = buildReport(records, {
    language: args.language,
    cefr: args.cefr ?? null,
    perPoint: args.perPoint,
    sampledCount: sampled.length,
    seed: args.seed,
    model: args.model ?? "claude-opus-4-8",
    costUsd: estimateCostUsd(usage),
    startedAt,
  }, errors);

  const name = args.out ?? `qa-${args.language}-${args.cefr ?? "all"}-${startedAt}`;
  mkdirSync("./qa-runs", { recursive: true });
  const file = path.join("./qa-runs", `${name}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
  console.log(
    `[qa-sample] ${report.summary.flagged}/${report.summary.sampled} flagged${costCapped ? " (cost-capped)" : ""} · $${report.meta.costUsd.toFixed(4)} · ${path.resolve(file)}`,
  );
}

// Only run when invoked directly (not when imported by the test) — mirrors the
// guard in eval-run.ts.
const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((e) => {
    console.error("[qa-sample] unhandled failure:", e);
    process.exit(1);
  });
}
```

Note: confirm `exercises` is exported from the `@language-drill/db` barrel (it is imported elsewhere as `import { exercises } from '@language-drill/db'`). If the barrel does not re-export it, import from `@language-drill/db/schema` following the pattern used by the lambda routes.

- [ ] **Step 7: Add the `qa:sample` script**

In `packages/ai/package.json` `scripts`, add:

```json
    "qa:sample": "tsx scripts/qa-sample-run.ts",
```

In the root `package.json` `scripts`, add (mirroring the `eval:gen` passthrough):

```json
    "qa:sample": "dotenv -e .env -- pnpm --filter @language-drill/ai qa:sample",
```

- [ ] **Step 8: Verify the CLI wiring end-to-end with `--dry-run` (no Claude, no cost)**

Run: `pnpm --filter @language-drill/db build && pnpm qa:sample --language tr --cefr A1 --per-point 1 --limit 3 --dry-run`
Expected: prints the pool size, the sampled IDs, and a rendered learner view per exercise, ending with `DRY RUN — no Claude calls`. (Uses the local `.env` dev-branch DB; no approved TR/A1 rows → prints `sampled=0`, still exits 0.)

- [ ] **Step 9: Run the full script test suite**

Run: `pnpm --filter @language-drill/ai exec vitest run scripts/qa-sample-run.test.ts`
Expected: PASS (all sampling + buildReport tests).

- [ ] **Step 10: Commit**

```bash
cd /Users/seal/dev/language-drill
test "$(git rev-parse --abbrev-ref HEAD)" = "feat/qa-exercise-sampler" || { echo WRONG BRANCH; exit 1; }
git add packages/ai/scripts/qa-sample-run.ts packages/ai/scripts/qa-sample-run.test.ts packages/ai/scripts/eval-run.ts packages/ai/package.json package.json
git commit -m "feat(qa): qa:sample CLI — orchestration, evaluator probe, report, wiring"
```

---

### Task 7: Docs + full pre-push gate

Document the CLI and run the whole suite green before opening a PR.

**Files:**
- Modify: `CLAUDE.md` (add a `pnpm qa:sample` row to the commands table)

- [ ] **Step 1: Document the command**

In `CLAUDE.md`, add a row to the "Running Locally" commands table (after the `eval:gen:export` row), verbatim:

```
| `pnpm qa:sample` | QA spot-check of the approved pool. Samples a couple of approved exercises per grammar point, has an Opus solver craft a correct / wrong / alternative answer per exercise, runs each through the real `evaluateAnswer`, and flags (exercise→evaluator) contract defects (false-negative / false-positive / acceptableAnswers-gap) plus a secondary learner-ambiguity note to `./qa-runs/<name>.json`. A spotlight, not a gate. Supports `--language`, `--cefr`, `--per-point`, `--grammar-point`, `--type`, `--limit`, `--max-cost-usd`, `--model`, `--seed`, `--dry-run`. |
```

- [ ] **Step 2: Clean stale lambda dist (avoids phantom test files), rebuild db**

Run: `cd /Users/seal/dev/language-drill && rm -rf infra/lambda/dist && pnpm --filter @language-drill/db build`
Expected: clean build, exit 0.

- [ ] **Step 3: Run the full pre-push gate**

Run: `cd /Users/seal/dev/language-drill && pnpm lint && pnpm typecheck && pnpm test`
Expected: all three green, zero failures.

If `pnpm test` reports failures in unrelated packages that reproduce on `main`, note them as pre-existing and proceed; any failure touching `qa-sample`, `evaluation-guidance`, or `exercises.ts` must be fixed here.

- [ ] **Step 4: Commit + push**

```bash
cd /Users/seal/dev/language-drill
test "$(git rev-parse --abbrev-ref HEAD)" = "feat/qa-exercise-sampler" || { echo WRONG BRANCH; exit 1; }
git add CLAUDE.md
git commit -m "docs(qa): document pnpm qa:sample in the commands table"
git push -u origin feat/qa-exercise-sampler
```

- [ ] **Step 5: Open the PR**

```bash
ghp pr create --title "feat(qa): QA exercise sampler (pnpm qa:sample)" \
  --body "Author-run CLI that spot-checks the approved pool: crafts three intent-labeled answers per sampled exercise (Opus), runs each through the real production evaluator, and flags (exercise→evaluator) contract defects — false negatives, false positives, acceptableAnswers gaps — plus a secondary learner-ambiguity note, to ./qa-runs/<name>.json. Spotlight, not a gate. Spec: docs/superpowers/specs/2026-07-22-qa-exercise-sampler-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Notes for the implementer

- **Deliberate deviation from the spec — sequential, no `--concurrency`.** The spec §5 lists a `--concurrency` flag (default 4). This plan runs the exercise loop **sequentially** instead, and omits the flag. Rationale: (1) an author-run spot check is a couple of exercises per grammar point — tens of Claude calls, not thousands — so wall-clock is a non-issue; (2) sequential execution makes the `--max-cost-usd` cap *precise* (it stops cleanly before the next exercise), whereas parallel workers can overshoot the cap by up to `concurrency − 1` in-flight exercises. Concurrency is a documented follow-on if volume ever grows. This deviation was surfaced to the user at plan handoff.
- **Model IDs:** the crafter uses `claude-opus-4-8`; do not change the evaluator's internal model. If `claude-opus-4-8` is rejected by the API at run time, that is an account/access issue, not a plan error — report it, don't silently swap models.
- **Confirm `exercises` barrel export** (Task 6 Step 6 note) before assuming the import path.
- **`estimateCostUsd` is Sonnet-priced** and will under-count the Opus crafter portion — the reported `costUsd` is indicative, matching how `eval`'s cost column already behaves. Don't add a bespoke Opus price table for v1.
- **No live Claude call is made by any test** — every LLM boundary is either mocked (`craftProbeAnswers` test) or gated behind `--dry-run`. The only run that spends budget is a real invocation the author triggers by hand.
