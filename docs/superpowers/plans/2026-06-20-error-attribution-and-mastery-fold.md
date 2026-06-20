# Per-Error Grammar-Point Attribution + Mastery Fold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 3 of `docs/progress-feedback-redesign.md` (minus the already-shipped History tab #398 and radar confidence-gating #397): have the answer evaluator tag each error with the curriculum grammar point it violates — constrained to a closed per-(language, level) key set so it never hallucinates a key — persist that into `error_observations.error_grammar_point_key`, then fold incidental slips (errors attributed to a point that was *not* the exercise's host point) into per-point mastery so vowel-harmony / plural / case stop reading as "mastered" while generating the most errors.

**Architecture:** The evaluator (`packages/ai`) must not import the curriculum (the `ai`-must-not-import-`db` build constraint). So the Lambda route resolves the valid grammar-point keys for the exercise's `(language, difficulty)` via the existing `grammarPointsAtOrBelow(language, level)` and injects them into `EvaluateAnswerInput` — exactly the pattern the existing `grammarGuidance` field already uses. `evaluateAnswer` builds the `submit_evaluation` tool schema per-call with a closed `enum` of those keys on each error's optional `grammarPointKey`, lists the keys+names in the user prompt, and `parseEvaluationResult` validates each returned key against the passed set (unknown/absent → `null`). `errorObservationsFromEvaluation` writes the chosen key into `error_grammar_point_key`. Part B then feeds incidental errors (attributed-key ≠ host-key) as negative evidence into per-point mastery.

**Tech Stack:** TypeScript, Anthropic SDK (Claude **Haiku 4.5** evaluator — unchanged), Hono (AWS Lambda), Drizzle, Zod, Vitest. Eval gate via the existing `pnpm eval` Langfuse-dataset harness.

## Global Constraints

- **Evaluator model stays Haiku 4.5** (`claude-haiku-4-5-20251001`, `packages/ai/src/evaluate.ts:243`). This plan does NOT change the model. The attribution accuracy is carried by the *closed-key constraint*, not a model upgrade; an eval gate confirms no scoring regression before merge (Task A7).
- **`packages/ai` source must NOT import `@language-drill/db`** (the `ai`/`db` build cycle: a db import in ai source typechecks locally but fails CI from clean with TS2307). Curriculum keys are resolved in the Lambda route and injected via `EvaluateAnswerInput`, mirroring the existing `grammarGuidance` field.
- **Closed key set per request.** The evaluator may only attribute an error to a key from the injected list (the `(language, difficulty)` scope from `grammarPointsAtOrBelow`), or omit it. `parseEvaluationResult` coerces any key not in the set to `null` — defense in depth behind the schema `enum`.
- **Prompt-version bump + push-prompts.** Editing `EVALUATION_SYSTEM_PROMPT` requires bumping `EVALUATION_SYSTEM_PROMPT_VERSION` to today's date (`evaluate@YYYY-MM-DD`) in the same commit (CLAUDE.md "Prompt Editing"). The runtime fetches the body from Langfuse, so after merge you MUST `pnpm push-prompts` to **each** environment (prod + dev) or the old body keeps serving. The per-exercise key list is runtime-substituted into the *user* prompt (ships with the code deploy, like `grammarGuidance` — NOT via Langfuse; see the "Langfuse registers template not rendered body" note). Only the SYSTEM-prompt text edit drifts and needs push-prompts.
- **The model change is NOT happening, so do NOT bump the version for a model reason** — the version bump in this plan is for the genuine SYSTEM-prompt body edit (the attribution instruction).
- **Backfill: none.** Per the product decision, attribution is forward-only. Existing `error_observations` rows keep `error_grammar_point_key = null`; consumers already fall back to `host_grammar_point_key` (`recurring.ts:41`, `error-trends.ts:2`). Do NOT write a backfill.
- **Languages are uppercase** (`TR`/`ES`/`DE`). `grammarPointsAtOrBelow` is keyed off `LearningLanguage` (ES/DE/TR); EN is source-only and has no curriculum — guard for it.
- **Build/test ordering:** after editing `packages/shared`, `packages/ai`, or `packages/db` source, run `pnpm build` (turbo) before dependent typecheck/tests so `dist` reflects new exports. Before the Lambda suite, `rm -rf infra/lambda/dist` (stale compiled `*.test.js` cause phantom failures). The FULL gate is the real check: `pnpm lint && pnpm typecheck && pnpm test` from repo root with real exit codes — do NOT pipe through `tail`/`head`.
- **Do NOT run `pnpm db:migrate` locally** (local `.env` → shared Neon dev branch). No schema/migration change is needed — `error_grammar_point_key` already exists (`packages/db/src/schema/progress.ts:126`).
- **Git commit trailer (every commit):**
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

**Part A — attribution (ship first; populates `error_grammar_point_key` going forward):**
- **Modify** `packages/shared/src/index.ts` — add optional `grammarPointKey?: string | null` to `EvaluationError` (line ~315).
- **Modify** `packages/ai/src/prompts.ts` — `EVALUATION_SYSTEM_PROMPT` attribution instruction + `EVALUATION_SYSTEM_PROMPT_VERSION` bump; add an `AttributionKey` type + a user-prompt key-list block; thread keys through `buildUserPrompt`.
- **Modify** `packages/ai/src/evaluate.ts` — `buildEvaluationTool(attributionKeys?)` (per-call schema with the closed `enum`), thread `attributionKeys` through `EvaluateAnswerInput` + `evaluateAnswer`, validate the per-error key in `parseEvaluationResult`.
- **Modify** `packages/ai/src/evaluate.test.ts`, `packages/ai/src/prompts.test.ts` — tests for the new schema/parse/prompt behavior.
- **Modify** `packages/db/src/errors/observations.ts` — map `e.grammarPointKey ?? null` into `errorGrammarPointKey`.
- **Modify** `packages/db/src/errors/observations.test.ts` — assert attribution flows through.
- **Modify** `infra/lambda/src/routes/exercises.ts` — resolve `grammarPointsAtOrBelow(language, difficulty)`, inject as `attributionKeys` into `evaluateAnswer`.
- **Modify** `infra/lambda/src/routes/exercises.test.ts` — assert keys are passed and the chosen key is persisted.

**Part B — fold incidental errors into mastery (ship after A; consumes `error_grammar_point_key`):**
- **Create** `infra/lambda/src/lib/mastery/incidental-fold.ts` — pure helper turning incidental `error_observations` into negative `MasteryObservation`s.
- **Create** `infra/lambda/src/lib/mastery/incidental-fold.test.ts` — its tests.
- **Modify** `infra/lambda/src/routes/exercises.ts` — after attribution write, fold incidental errors into `userGrammarMastery`.
- **Modify** `infra/lambda/src/routes/exercises.test.ts` — assert incidental slips lower the violated point's mastery.

> Part B Task B1 is a **design-decision task** that resolves the one open fork (which mastery surface to fix, and the incidental-error weighting) before any code. Do not skip it.

---

# PART A — Per-Error Grammar-Point Attribution

### Task A1: Add optional `grammarPointKey` to `EvaluationError` (shared)

**Files:**
- Modify: `packages/shared/src/index.ts:315-321`
- Test: (type-only change; verified by downstream package builds — no dedicated unit test)

**Interfaces:**
- Produces: `EvaluationError.grammarPointKey?: string | null` — consumed by `packages/ai` (parse/tool) and `packages/db` (`errorObservationsFromEvaluation`).

- [ ] **Step 1: Add the field**

In `packages/shared/src/index.ts`, change:

```typescript
export type EvaluationError = {
  type: "grammar" | "vocabulary" | "spelling" | "pragmatics";
  severity: "minor" | "major";
  text: string;
  correction: string;
  explanation: string;
};
```

to:

```typescript
export type EvaluationError = {
  type: "grammar" | "vocabulary" | "spelling" | "pragmatics";
  severity: "minor" | "major";
  text: string;
  correction: string;
  explanation: string;
  /**
   * The curriculum grammar-point key this specific error violates, when the
   * evaluator could attribute it to one of the exercise's in-scope points.
   * Null/absent when no in-scope point applies. Populated only by the generic
   * evaluator (Phase 3); the free-writing path leaves it unset.
   */
  grammarPointKey?: string | null;
};
```

- [ ] **Step 2: Build shared**

Run: `pnpm --filter @language-drill/shared build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): add optional grammarPointKey to EvaluationError"
```

---

### Task A2: Closed-key tool schema + parse validation (packages/ai)

**Files:**
- Modify: `packages/ai/src/evaluate.ts:31-115` (tool), `:121-142` (input type), `:155-227` (parse), `:272-291` (call site)
- Test: `packages/ai/src/evaluate.test.ts`

**Interfaces:**
- Consumes: `EvaluationError.grammarPointKey` (Task A1); `AttributionKey` (Task A3 — define it in `prompts.ts` and import here).
- Produces: `buildEvaluationTool(attributionKeys?: readonly AttributionKey[]): Anthropic.Tool`; `EvaluateAnswerInput.attributionKeys?: readonly AttributionKey[]`; `parseEvaluationResult(input, validKeys?: ReadonlySet<string>)`.

- [ ] **Step 1: Write failing tests**

Add to `packages/ai/src/evaluate.test.ts`:

```typescript
import { buildEvaluationTool, parseEvaluationResult } from "./evaluate";

describe("buildEvaluationTool — closed-key attribution", () => {
  it("omits grammarPointKey from the error schema when no keys are supplied", () => {
    const tool = buildEvaluationTool();
    const errorItems = (tool.input_schema as any).properties.errors.items;
    expect(errorItems.properties.grammarPointKey).toBeUndefined();
  });

  it("adds an optional grammarPointKey enum constrained to the supplied keys", () => {
    const tool = buildEvaluationTool([
      { key: "tr-a1-vowel-harmony", name: "Vowel harmony" },
      { key: "tr-a1-plural-suffix", name: "Plural suffix" },
    ]);
    const errorItems = (tool.input_schema as any).properties.errors.items;
    expect(errorItems.properties.grammarPointKey.enum).toEqual([
      "tr-a1-vowel-harmony",
      "tr-a1-plural-suffix",
    ]);
    // optional: NOT added to the error item's `required`
    expect(errorItems.required).not.toContain("grammarPointKey");
  });
});

describe("parseEvaluationResult — attribution coercion", () => {
  const base = {
    score: 0.5,
    grammarAccuracy: 0.5,
    vocabularyRange: "A1",
    taskAchievement: 0.5,
    feedback: "ok",
    estimatedCefrEvidence: "A1",
  };

  it("keeps a grammarPointKey that is in the valid set", () => {
    const out = parseEvaluationResult(
      {
        ...base,
        errors: [
          { type: "grammar", severity: "major", text: "x", correction: "y", explanation: "z", grammarPointKey: "tr-a1-locative" },
        ],
      },
      new Set(["tr-a1-locative"]),
    );
    expect(out.errors[0].grammarPointKey).toBe("tr-a1-locative");
  });

  it("coerces an out-of-set grammarPointKey to null", () => {
    const out = parseEvaluationResult(
      {
        ...base,
        errors: [
          { type: "grammar", severity: "major", text: "x", correction: "y", explanation: "z", grammarPointKey: "tr-a1-not-real" },
        ],
      },
      new Set(["tr-a1-locative"]),
    );
    expect(out.errors[0].grammarPointKey).toBeNull();
  });

  it("defaults grammarPointKey to null when absent", () => {
    const out = parseEvaluationResult(
      { ...base, errors: [{ type: "grammar", severity: "major", text: "x", correction: "y", explanation: "z" }] },
      new Set(["tr-a1-locative"]),
    );
    expect(out.errors[0].grammarPointKey).toBeNull();
  });

  it("sets grammarPointKey null for every error when no valid set is passed", () => {
    const out = parseEvaluationResult({
      ...base,
      errors: [{ type: "grammar", severity: "major", text: "x", correction: "y", explanation: "z", grammarPointKey: "tr-a1-locative" }],
    });
    expect(out.errors[0].grammarPointKey).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @language-drill/ai test -- evaluate.test.ts`
Expected: FAIL — `buildEvaluationTool` is not exported; `parseEvaluationResult` ignores the 2nd arg.

- [ ] **Step 3: Convert the static tool into a builder**

In `packages/ai/src/evaluate.ts`, replace the `export const EVALUATION_TOOL: Anthropic.Tool = { ... }` block (lines 33-115) with a builder. Import `AttributionKey` from `./prompts.js` (added in Task A3). Keep the existing error-item properties verbatim; add `grammarPointKey` only when keys are supplied:

```typescript
import type { AttributionKey } from "./prompts.js";

/**
 * Build the `submit_evaluation` tool. When `attributionKeys` is non-empty,
 * each error gains an OPTIONAL `grammarPointKey` whose value is constrained to
 * a closed `enum` of the exercise's in-scope curriculum keys — so the (Haiku)
 * evaluator can attribute an error to a point but can never invent a key.
 */
export function buildEvaluationTool(
  attributionKeys?: readonly AttributionKey[],
): Anthropic.Tool {
  const errorProps: Record<string, unknown> = {
    type: {
      type: "string",
      enum: ["grammar", "vocabulary", "spelling", "pragmatics"],
      description: "Category of the error.",
    },
    severity: {
      type: "string",
      enum: ["minor", "major"],
      description:
        "Severity: minor (does not impede communication) or major (changes meaning or is ungrammatical).",
    },
    text: { type: "string", description: "The erroneous text from the user's answer." },
    correction: { type: "string", description: "The corrected version of the text." },
    explanation: {
      type: "string",
      description: "Brief explanation of why this is an error and how to fix it.",
    },
  };

  if (attributionKeys && attributionKeys.length > 0) {
    errorProps.grammarPointKey = {
      type: "string",
      enum: attributionKeys.map((k) => k.key),
      description:
        "OPTIONAL. The curriculum key of the grammar point THIS error violates. " +
        "Must be one of the keys listed in the user message's 'Grammar points in scope' block. " +
        "Omit entirely if the error does not violate any listed point (e.g. a vocabulary or spelling slip).",
    };
  }

  return {
    name: EVALUATION_TOOL_NAME,
    description:
      "Submit the structured evaluation result for a language exercise answer.",
    input_schema: {
      type: "object" as const,
      properties: {
        score: { type: "number", description: "Overall score from 0.0 to 1.0 combining all evaluation factors." },
        grammarAccuracy: { type: "number", description: "Grammar accuracy score from 0.0 to 1.0. Covers morphology, syntax, agreement, tense, word order." },
        vocabularyRange: { type: "string", description: 'CEFR level string (A1–C2) representing the sophistication of vocabulary used.' },
        taskAchievement: { type: "number", description: "Task achievement score from 0.0 to 1.0. How well the answer fulfills the exercise requirements." },
        feedback: { type: "string", description: "Concise, encouraging explanation of what was good and what needs improvement." },
        errors: {
          type: "array",
          description: "Array of specific errors found in the answer.",
          items: {
            type: "object",
            properties: errorProps,
            // grammarPointKey is intentionally NOT required (attribution is best-effort).
            required: ["type", "severity", "text", "correction", "explanation"],
          },
        },
        estimatedCefrEvidence: { type: "string", description: 'The CEFR level this answer provides evidence for (e.g. "B1").' },
      },
      required: [
        "score", "grammarAccuracy", "vocabularyRange", "taskAchievement",
        "feedback", "errors", "estimatedCefrEvidence",
      ],
    },
  };
}

/** Back-compat default tool (no attribution field). */
export const EVALUATION_TOOL: Anthropic.Tool = buildEvaluationTool();
```

- [ ] **Step 4: Validate the attributed key in `parseEvaluationResult`**

Change the signature and the per-error mapper. Update the function header:

```typescript
export function parseEvaluationResult(
  input: unknown,
  validKeys?: ReadonlySet<string>,
): EvaluationResult {
```

Then, inside the `(raw.errors as unknown[]).map((err, i) => { ... })` body, after the existing `text`/`correction`/`explanation` string checks and before the `return {...}`, add:

```typescript
    // Per-error attribution (Phase 3): keep the key only if it is in the
    // exercise's in-scope set; otherwise null. Null when absent or no set.
    let grammarPointKey: string | null = null;
    if (validKeys && typeof e.grammarPointKey === "string" && validKeys.has(e.grammarPointKey)) {
      grammarPointKey = e.grammarPointKey;
    }
```

and add `grammarPointKey,` to the returned error object literal (the `return { type, severity, text, correction, explanation }`).

- [ ] **Step 5: Thread `attributionKeys` through `EvaluateAnswerInput` + the call**

In `EvaluateAnswerInput` (around line 133, beside `grammarGuidance`) add:

```typescript
  /**
   * The closed set of curriculum grammar-point keys (key + display name) in
   * scope for this exercise's (language, level). Resolved by the caller from
   * `grammarPointsAtOrBelow`. When present, the evaluator may attribute each
   * error to one of these keys (constrained by the tool-schema enum + the
   * user-prompt list); when absent, attribution is skipped (keys → null).
   */
  attributionKeys?: readonly AttributionKey[];
```

In `evaluateAnswer`, destructure `attributionKeys`, pass it to `buildUserPrompt` (Task A3 extends the signature), build the tool per-call, and pass the valid-key set to the parser. Replace the `tools: [EVALUATION_TOOL]` line and the final `return parseEvaluationResult(...)`:

```typescript
  const tool = buildEvaluationTool(attributionKeys);
  // ... in client.messages.create({ ... tools: [tool], ... })
```

and at the end:

```typescript
  const validKeys =
    attributionKeys && attributionKeys.length > 0
      ? new Set(attributionKeys.map((k) => k.key))
      : undefined;
  return parseEvaluationResult(toolUseBlock.input, validKeys);
```

Also pass `attributionKeys` into the `buildUserPrompt(exercise, userAnswer, language, difficulty, grammarGuidance, attributionKeys)` call (the 6th arg added in Task A3).

- [ ] **Step 6: Run the tests, verify they pass**

Run: `pnpm --filter @language-drill/ai build && pnpm --filter @language-drill/ai test -- evaluate.test.ts`
Expected: PASS. (The existing `EVALUATION_TOOL`-shape tests still pass — the default tool is unchanged.)

- [ ] **Step 7: Commit** (combined with Task A3 — they share the `AttributionKey` type; commit after A3.)

---

### Task A3: Prompt instruction + key-list block + version bump (packages/ai)

**Files:**
- Modify: `packages/ai/src/prompts.ts:46` (version), `:48-97` (system prompt), `:211-218` (add `AttributionKey`), `:241-286` (`buildUserPrompt`)
- Test: `packages/ai/src/prompts.test.ts`

**Interfaces:**
- Produces: `export type AttributionKey = { key: string; name: string }`; `buildUserPrompt(..., attributionKeys?: readonly AttributionKey[])`.

- [ ] **Step 1: Write failing tests**

Add to `packages/ai/src/prompts.test.ts`:

```typescript
import { buildUserPrompt, EVALUATION_SYSTEM_PROMPT, EVALUATION_SYSTEM_PROMPT_VERSION } from "./prompts";
import { ExerciseType } from "@language-drill/shared";

describe("attribution prompt wiring", () => {
  const exercise = {
    type: ExerciseType.TRANSLATION,
    // ...minimal valid TRANSLATION content (copy the shape the existing
    // translation-prompt tests already use in this file)...
  } as any;

  it("system prompt instructs per-error grammarPointKey attribution", () => {
    expect(EVALUATION_SYSTEM_PROMPT).toMatch(/grammarPointKey/);
    expect(EVALUATION_SYSTEM_PROMPT).toMatch(/in scope/i);
  });

  it("version is bumped to today", () => {
    expect(EVALUATION_SYSTEM_PROMPT_VERSION).toBe("evaluate@2026-06-20");
  });

  it("appends a Grammar points in scope block when keys are provided", () => {
    const out = buildUserPrompt(exercise, "answer", "TR" as any, "A1" as any, undefined, [
      { key: "tr-a1-vowel-harmony", name: "Vowel harmony" },
      { key: "tr-a1-locative", name: "Locative case" },
    ]);
    expect(out).toMatch(/Grammar points in scope/);
    expect(out).toMatch(/tr-a1-vowel-harmony — Vowel harmony/);
    expect(out).toMatch(/tr-a1-locative — Locative case/);
  });

  it("omits the scope block when no keys are provided", () => {
    const out = buildUserPrompt(exercise, "answer", "TR" as any, "A1" as any);
    expect(out).not.toMatch(/Grammar points in scope/);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @language-drill/ai test -- prompts.test.ts`
Expected: FAIL (no `AttributionKey`/block; version still `evaluate@2026-06-18`; system prompt lacks `grammarPointKey`).

- [ ] **Step 3: Bump the version**

`packages/ai/src/prompts.ts:46`:

```typescript
export const EVALUATION_SYSTEM_PROMPT_VERSION = "evaluate@2026-06-20";
```

- [ ] **Step 4: Add the attribution instruction to the system prompt**

In `EVALUATION_SYSTEM_PROMPT`, replace the existing errors bullet (line ~59):

```
6. **Errors**: An array of specific errors found, each with type, severity, the erroneous text, correction, and explanation.
```

with:

```
6. **Errors**: An array of specific errors found, each with type, severity, the erroneous text, correction, and explanation. When the user message includes a **Grammar points in scope** block and a grammar/morphology error violates one of those listed points, set that error's optional **grammarPointKey** to the exact key shown for it (e.g. a wrong plural vowel → the vowel-harmony key; a missing accusative ending on a definite object → the accusative key). Use **only** keys from that list, attribute at most one point per error, and omit grammarPointKey when the error violates none of the listed points or is a vocabulary/spelling slip.
```

- [ ] **Step 5: Add the `AttributionKey` type**

Beside `GrammarGuidance` (line ~211):

```typescript
/** A curriculum grammar point the evaluator may attribute an error to. */
export type AttributionKey = {
  /** Curriculum key, e.g. "tr-a1-vowel-harmony". */
  key: string;
  /** Human-readable name, e.g. "Vowel harmony" — shown to the model so it can pick. */
  name: string;
};
```

- [ ] **Step 6: Thread keys through `buildUserPrompt` and append the block**

Extend the signature and the tail:

```typescript
export function buildUserPrompt(
  exercise: ExerciseContent,
  userAnswer: string,
  language: Language,
  difficulty: CefrLevel,
  grammarGuidance?: GrammarGuidance,
  attributionKeys?: readonly AttributionKey[],
): string {
  // ...existing switch unchanged...

  let out = grammarGuidance ? `${base}\n\n${buildGrammarGuidanceBlock(grammarGuidance)}` : base;
  if (attributionKeys && attributionKeys.length > 0) {
    const lines = attributionKeys.map((k) => `- ${k.key} — ${k.name}`).join("\n");
    out += `\n\n## Grammar points in scope\nWhen an error violates one of these points, set that error's grammarPointKey to its key:\n${lines}`;
  }
  return out;
}
```

(Replace the existing `if (!grammarGuidance) return base; return ...` tail with the above.)

- [ ] **Step 7: Run tests, verify pass**

Run: `pnpm --filter @language-drill/ai build && pnpm --filter @language-drill/ai test`
Expected: PASS (both `prompts.test.ts` and `evaluate.test.ts` from A2).

- [ ] **Step 8: Commit A1-tail + A2 + A3 together**

```bash
git add packages/ai/src/prompts.ts packages/ai/src/prompts.test.ts \
        packages/ai/src/evaluate.ts packages/ai/src/evaluate.test.ts
git commit -m "feat(ai): closed-key per-error grammar-point attribution in the evaluator

Adds an optional, enum-constrained grammarPointKey to each error in the
submit_evaluation tool + a 'Grammar points in scope' user-prompt block, and
validates the returned key against the in-scope set. Bumps
EVALUATION_SYSTEM_PROMPT_VERSION to evaluate@2026-06-20."
```

---

### Task A4: Persist the attributed key (packages/db)

**Files:**
- Modify: `packages/db/src/errors/observations.ts:36-56`
- Test: `packages/db/src/errors/observations.test.ts`

**Interfaces:**
- Consumes: `EvaluationError.grammarPointKey` (Task A1).
- Produces: `errorObservationsFromEvaluation` writes `errorGrammarPointKey: e.grammarPointKey ?? null`.

- [ ] **Step 1: Write the failing test**

Add to `packages/db/src/errors/observations.test.ts`, inside `describe('errorObservationsFromEvaluation', ...)`:

```typescript
  it('carries a per-error grammarPointKey into errorGrammarPointKey', () => {
    const rows = errorObservationsFromEvaluation(
      [err({ grammarPointKey: 'tr-a1-vowel-harmony' }), err()],
      ctx,
    );
    expect(rows[0].errorGrammarPointKey).toBe('tr-a1-vowel-harmony');
    expect(rows[1].errorGrammarPointKey).toBeNull(); // absent → null
  });
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @language-drill/db test -- observations.test.ts`
Expected: FAIL — currently hardcodes `errorGrammarPointKey: null`.

- [ ] **Step 3: Map the field**

In `errorObservationsFromEvaluation`, change `errorGrammarPointKey: null,` to:

```typescript
    errorGrammarPointKey: e.grammarPointKey ?? null,
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- observations.test.ts`
Expected: PASS. (The existing `errorGrammarPointKey: null` assertion in the "maps each error" test still passes — those `err()` fixtures have no `grammarPointKey`.)

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/errors/observations.ts packages/db/src/errors/observations.test.ts
git commit -m "feat(db): persist per-error grammarPointKey into error_grammar_point_key"
```

---

### Task A5: Resolve + inject in-scope keys in the submit route (lambda)

**Files:**
- Modify: `infra/lambda/src/routes/exercises.ts:13` (import), `:276-291` (resolve), `:500-517` (pass)
- Test: `infra/lambda/src/routes/exercises.test.ts`

**Interfaces:**
- Consumes: `grammarPointsAtOrBelow` (from `@language-drill/db`); `EvaluateAnswerInput.attributionKeys` (Task A2).

- [ ] **Step 1: Write the failing test**

Add an integration test to `infra/lambda/src/routes/exercises.test.ts` modeled on the existing submit tests in that file. It must: seed a TR/A1 translation exercise whose primary point is `tr-a1-locative`; stub the Anthropic client so `submit_evaluation` returns one error `{ type: 'grammar', severity: 'major', text: 'kitaplar', correction: 'kitapları', grammarPointKey: 'tr-a1-accusative-definite-object' }`; POST the answer; then assert a row exists in `error_observations` with `error_grammar_point_key = 'tr-a1-accusative-definite-object'` and `host_grammar_point_key = 'tr-a1-locative'`. Reuse the file's existing Anthropic-stub helper and DB-seeding helpers (grep the file for the current submit test's setup and copy its shape exactly — do not invent new harness).

```typescript
it('persists the evaluator-attributed grammarPointKey as error_grammar_point_key', async () => {
  // ...seed exercise (host tr-a1-locative), stub client to return the error above...
  // ...POST /exercises/:id/submit...
  const rows = await db
    .select()
    .from(errorObservations)
    .where(eq(errorObservations.exerciseHistoryId, submissionId));
  expect(rows[0].errorGrammarPointKey).toBe('tr-a1-accusative-definite-object');
  expect(rows[0].hostGrammarPointKey).toBe('tr-a1-locative');
});
```

- [ ] **Step 2: Run, verify fail**

Run: `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test -- exercises.test.ts`
Expected: FAIL — `errorGrammarPointKey` is null (keys not yet injected, so the parser coerces the returned key to null).

- [ ] **Step 3: Import the resolver**

`infra/lambda/src/routes/exercises.ts:13` — add `grammarPointsAtOrBelow` to the existing `@language-drill/db` import (alongside `getGrammarPoint`).

- [ ] **Step 4: Resolve the in-scope keys beside `grammarGuidance`**

After the existing `grammarGuidance` block (line ~291), add:

```typescript
  // Closed key set for per-error attribution: the grammar points the learner
  // at this (language, level) has plausibly studied. EN is source-only (no
  // curriculum) → empty, which disables attribution for that path.
  const attributionKeys =
    exercise.language === Language.EN
      ? []
      : grammarPointsAtOrBelow(
          exercise.language as LearningLanguage,
          exercise.difficulty as string,
        ).map((p) => ({ key: p.key, name: p.name }));
```

(Confirm `LearningLanguage` is imported from `@language-drill/shared`; if not, add it.)

- [ ] **Step 5: Pass into `evaluateAnswer`**

In the non-dictation `evaluateAnswer(client, { ... })` call (line ~510), add `attributionKeys,` after `grammarGuidance,`.

- [ ] **Step 6: Run, verify pass**

Run: `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test -- exercises.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add infra/lambda/src/routes/exercises.ts infra/lambda/src/routes/exercises.test.ts
git commit -m "feat(lambda): inject in-scope curriculum keys for per-error attribution on submit"
```

---

### Task A6: Full gate for Part A

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: exit 0.

- [ ] **Step 2: Full suite**

Run: `rm -rf infra/lambda/dist && pnpm lint && pnpm typecheck && pnpm test`
Expected: exit 0, zero failures. (Watch for: `EvaluationError` consumers in the web drill components and free-writing components — they read `.errors`; the new optional field is additive and must not break them. The `ExerciseType` exhaustiveness in `buildUserPrompt` is unchanged.)

- [ ] **Step 3: No separate commit** (gate only).

---

### Task A7: Eval gate — confirm no scoring regression before deploy

> The `pnpm eval` harness measures **scoring** quality (score / grammarAccuracy / taskAchievement / CEFR agreement), not attribution accuracy. Its job here is to prove the prompt edit didn't degrade scoring. Attribution accuracy is spot-checked in Step 4.

**Files:** none (verification only). Requires `ANTHROPIC_API_KEY` + Langfuse creds in `.env`.

- [ ] **Step 1: Build/refresh an eval dataset** (skip if a recent one exists)

Run: `pnpm --filter @language-drill/ai eval:export -- --help` and follow it to sample a TR/A1-heavy window into a Langfuse dataset (the prompt-update-and-revalidate runbook covers the exact flags). Note the dataset name.

- [ ] **Step 2: Run baseline (repo prompt) vs candidate (new prompt)**

The candidate prompt body is the edited `EVALUATION_SYSTEM_PROMPT`. Save it to a file (`/tmp/eval-candidate.txt`) and run:

```bash
pnpm --filter @language-drill/ai eval -- \
  --dataset <dataset-name> \
  --candidate file:/tmp/eval-candidate.txt \
  --run-name attribution-candidate-2026-06-20 \
  --limit 40
```

- [ ] **Step 3: Inspect the summary**

Open `packages/ai/eval-runs/attribution-candidate-2026-06-20.json`. Confirm `okCount` ≈ `itemCount` (no parse failures from the new field), and that `score`/`grammarAccuracy`/`taskAchievement` DeltaStats show no material regression and `cefr.agreementRate` is unchanged. **If scoring regressed, stop** and revise the instruction (the attribution sentence should not change scoring) before merge.

- [ ] **Step 4: Attribution spot-check (manual)**

From the per-item `actual.errors` in that JSON (or a throwaway script that calls `evaluateAnswer` with `attributionKeys` on ~20 real recent TR answers — query the **prod** Neon branch per the local-env-is-dev-branch note), record: (a) fraction of **major grammar** errors that got a non-null `grammarPointKey`, and (b) eyeball correctness on a 10-example sample (e.g. `pazarda→pazara` → a motion/dative or locative key; a wrong plural vowel → `tr-a1-vowel-harmony`). Acceptance: ≥60% of major grammar errors attributed, and ≤1/10 obviously-wrong attributions. If below bar, tighten the instruction wording (one key per error, tie to the error's `text`) and re-run; only consider a Sonnet evaluator if Haiku cannot clear the bar after prompt iteration (a separate decision — out of scope here).

- [ ] **Step 5: Record the result** in the PR description (dataset name, run name, the scoring deltas, and the attribution spot-check numbers).

---

### Task A8: Post-merge — sync the prompt to Langfuse (deploy step)

> Not a code task — a release step. The runtime serves the SYSTEM-prompt body from Langfuse; without this, the old body keeps serving for ~5 min cache TTL and forever after.

- [ ] **Step 1:** After the PR merges, follow CLAUDE.md "Prompt Editing" → `push-prompts` for **prod** (pull `language-drill/LANGFUSE_*` creds), preview with `--dry-run`, then apply.
- [ ] **Step 2:** Repeat for **dev** (`language-drill-dev/` prefix).
- [ ] **Step 3:** Confirm in-sync: `bootstrap-prompts --check` exits 0 for each env.

---

# PART B — Fold Incidental Errors Into Mastery

> Ship after Part A is merged and attribution data is flowing. Part B consumes `error_observations.error_grammar_point_key`.

### Task B1: Resolve the fold target + weighting (DESIGN DECISION — do this first)

**Why this is a task:** the codebase does not settle where per-point mastery is *shown*. `userGrammarMastery` is a stored per-point table updated incrementally on submit **only for the host point** (`exercises.ts:95-149`); the radar (`progress-aggregation.ts → aggregateRadar`) is computed from raw history by **macro-skill axis** (already confidence-gated, #397) and does not read `userGrammarMastery`. There is no located `/progress/grammar-map` read endpoint. So "fold incidental errors into mastery" needs a target and a weighting decided before code.

**Files:** none (investigation + a short decision recorded in this plan / the PR).

- [ ] **Step 1: Locate every consumer of `userGrammarMastery` reads**

Run: `grep -rn "userGrammarMastery" infra/lambda/src apps/web --include='*.ts' --include='*.tsx' | grep -v '\.test\.'`
Record which surfaces *display* per-point mastery (vs. only update it / use it for review scheduling). If a "mastery map" UI exists, it is the fold target; if none exists yet, the fold still makes the stored signal honest for the coach/history ranking and any future map.

- [ ] **Step 2: Choose write-time vs read-time fold.** Recommendation: **write-time negative evidence into `userGrammarMastery`** — it reuses the exact `updateMastery` + upsert path already in `exercises.ts:117-145`, keeps reads unchanged, and makes the stored per-point mastery honest everywhere it is (or will be) shown. Read-time fold would re-derive mastery on every read and duplicate the formula. Record the choice.

- [ ] **Step 3: Fix the incidental-error weighting.** Decide and record:
  - **Which errors count:** only errors where `errorGrammarPointKey = P` **and** `hostGrammarPointKey ≠ P` (incidental). Errors on the host point are already reflected in that submission's score — counting them again would double-penalize.
  - **Score contribution:** `major → 0.0`, `minor → 0.4` (a slip is negative evidence, scaled by severity). Record the exact mapping.
  - **Difficulty:** the violated point's own curriculum level — `getGrammarPoint(P).cefrLevel` — so an A1 vowel-harmony slip folds at A1 weight (and triggers the existing asymmetric "punish easy errors" weighting in `updateMastery`).
  - **`at`:** the submission time (`new Date()` / `occurredAt`).

- [ ] **Step 4: Record the decision** as a short note in the PR description and proceed. Tasks B2–B3 below assume the recommended write-time approach with the weighting above; if Step 2/3 chose differently, adjust their code accordingly before implementing.

---

### Task B2: Pure incidental-fold helper (lambda)

**Files:**
- Create: `infra/lambda/src/lib/mastery/incidental-fold.ts`
- Test: `infra/lambda/src/lib/mastery/incidental-fold.test.ts`

**Interfaces:**
- Consumes: the evaluator's `EvaluationError[]` for a submission + the submission's `hostGrammarPointKey`.
- Produces: `incidentalObservations(errors, hostKey, at): IncidentalObs[]` where `IncidentalObs = { grammarPointKey: string; score: number; at: Date }`. (Difficulty is resolved by the caller via `getGrammarPoint`, which lives in the route — keeping this helper curriculum-free is optional, but the route already imports `getGrammarPoint`, so resolve difficulty there.)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { incidentalObservations } from './incidental-fold';
import type { EvaluationError } from '@language-drill/shared';

const e = (over: Partial<EvaluationError>): EvaluationError => ({
  type: 'grammar', severity: 'major', text: 'x', correction: 'y', explanation: 'z', ...over,
});
const at = new Date('2026-06-20T00:00:00Z');

describe('incidentalObservations', () => {
  it('emits a negative obs only for attributed keys that differ from the host', () => {
    const out = incidentalObservations(
      [
        e({ grammarPointKey: 'tr-a1-vowel-harmony', severity: 'major' }), // incidental
        e({ grammarPointKey: 'tr-a1-locative' }),                          // == host → skip
        e({ grammarPointKey: null }),                                      // unattributed → skip
        e({ grammarPointKey: 'tr-a1-plural-suffix', severity: 'minor' }),  // incidental, minor
      ],
      'tr-a1-locative',
      at,
    );
    expect(out).toEqual([
      { grammarPointKey: 'tr-a1-vowel-harmony', score: 0, at },
      { grammarPointKey: 'tr-a1-plural-suffix', score: 0.4, at },
    ]);
  });

  it('dedups multiple incidental errors on the same point to the worst (lowest) score', () => {
    const out = incidentalObservations(
      [
        e({ grammarPointKey: 'tr-a1-vowel-harmony', severity: 'minor' }),
        e({ grammarPointKey: 'tr-a1-vowel-harmony', severity: 'major' }),
      ],
      'tr-a1-locative',
      at,
    );
    expect(out).toEqual([{ grammarPointKey: 'tr-a1-vowel-harmony', score: 0, at }]);
  });

  it('returns [] when host is null (no incidental distinction possible)', () => {
    expect(incidentalObservations([e({ grammarPointKey: 'tr-a1-vowel-harmony' })], null, at)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test -- incidental-fold.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```typescript
import type { EvaluationError } from '@language-drill/shared';

export type IncidentalObs = { grammarPointKey: string; score: number; at: Date };

const SEVERITY_SCORE: Record<EvaluationError['severity'], number> = {
  major: 0,
  minor: 0.4,
};

/**
 * Turn a submission's errors into negative mastery evidence for the points they
 * violated INCIDENTALLY — i.e. attributed to a point other than the exercise's
 * host point (errors on the host point are already reflected in the submission
 * score; folding them again would double-penalize). Multiple incidental errors
 * on the same point collapse to the worst (lowest) score. Empty when host is null.
 */
export function incidentalObservations(
  errors: readonly EvaluationError[] | undefined,
  hostGrammarPointKey: string | null,
  at: Date,
): IncidentalObs[] {
  if (!errors || hostGrammarPointKey === null) return [];
  const worst = new Map<string, number>();
  for (const e of errors) {
    const key = e.grammarPointKey;
    if (!key || key === hostGrammarPointKey) continue;
    const score = SEVERITY_SCORE[e.severity];
    const prev = worst.get(key);
    if (prev === undefined || score < prev) worst.set(key, score);
  }
  return [...worst].map(([grammarPointKey, score]) => ({ grammarPointKey, score, at }));
}
```

- [ ] **Step 4: Run, verify pass** — same command → PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/mastery/incidental-fold.ts infra/lambda/src/lib/mastery/incidental-fold.test.ts
git commit -m "feat(lambda): pure helper deriving incidental negative mastery evidence from attributed errors"
```

---

### Task B3: Apply the incidental fold on submit (lambda)

**Files:**
- Modify: `infra/lambda/src/routes/exercises.ts` (the `userGrammarMastery` update helper at `:95-149` + the submit handler near the `recordErrorObservations` call at `:531`)
- Test: `infra/lambda/src/routes/exercises.test.ts`

**Interfaces:**
- Consumes: `incidentalObservations` (B2), `getGrammarPoint`, the existing per-point mastery upsert (`updateMastery` + `onConflictDoUpdate`).

- [ ] **Step 1: Write the failing test**

Add to `infra/lambda/src/routes/exercises.test.ts`: seed a host exercise on `tr-a1-locative`; stub the client to return a major error attributed to `tr-a1-vowel-harmony` (incidental). After submit, assert a `userGrammarMastery` row exists for `tr-a1-vowel-harmony` for the user with a `masteryScore` below 0.5 and `evidenceCount >= 1` — i.e. the incidental slip created/decremented that point's mastery even though it was not the host. (If the point already had mastery from a prior seed, assert the score dropped.)

- [ ] **Step 2: Run, verify fail** — `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test -- exercises.test.ts` → FAIL.

- [ ] **Step 3: Generalize the mastery-update helper to accept an explicit point+difficulty**

The existing helper (`:95-149`) updates the host point from `opts.grammarPointKey`/`opts.difficulty`. It already does exactly the read→`updateMastery`→upsert we need. Extract its body so it can be called for an arbitrary `(grammarPointKey, difficulty, score, at)` — or call it in a loop. Then, in the submit handler right after the `recordErrorObservations(...)` call (`:531`), add:

```typescript
  // Fold incidental slips into the VIOLATED point's mastery (Phase 3): an error
  // attributed to a point other than the host gets no signal today, so a point
  // can read "mastered" while generating the most errors. Best-effort.
  for (const obs of incidentalObservations(result.errors, exercise.grammarPointKey, new Date())) {
    const point = getGrammarPoint(obs.grammarPointKey);
    if (!point) continue;
    await updateGrammarMastery(db, {
      userId,
      language: exercise.language as string,
      grammarPointKey: obs.grammarPointKey,
      difficulty: point.cefrLevel as CefrLevel,
      score: obs.score,
    });
  }
```

(`updateGrammarMastery` = the existing per-point upsert helper, named per what's in the file; reuse it verbatim — it already does the non-fatal try/catch and the `onConflictDoUpdate`.)

- [ ] **Step 4: Run, verify pass** — same command → PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/exercises.ts infra/lambda/src/routes/exercises.test.ts
git commit -m "feat(lambda): fold incidental attributed errors into the violated point's mastery on submit"
```

---

### Task B4: Full gate for Part B

- [ ] **Step 1:** `pnpm build`
- [ ] **Step 2:** `rm -rf infra/lambda/dist && pnpm lint && pnpm typecheck && pnpm test` → exit 0.
- [ ] **Step 3:** Manually re-derive the design-doc example if feasible: for the dogfood TR/A1 account, after a few sessions, confirm a point like `tr-a1-vowel-harmony` no longer reads green while its incidental error count is high (query `userGrammarMastery` vs `error_observations` on the prod branch). Record in the PR.

---

## Self-Review

- **Spec coverage** (Phase 3 of `progress-feedback-redesign.md`, minus shipped items):
  - "Add per-error `grammarPointKey` attribution (prompt change, option a, version-bump)" → Tasks A1–A5, A8. ✓
  - "Confidence-gate the radar" → already shipped #397 (out of scope). ✓ (noted)
  - "Ship the History error-resolution + trend view" → already shipped #398 (out of scope). ✓ (noted)
  - "Fold incidental errors into the mastery fold so vowel-harmony/plural/case stop reading as mastered" → Tasks B1–B4. ✓ (B1 resolves the one codebase-level fork.)
  - D1 (RESOLVED, option a + version bump) honored; D2 backfill explicitly **not** done (forward-only per the latest product decision — supersedes the doc's D2 for Phase-3 attribution). ✓
- **Placeholder scan:** Part A steps carry full code. Part B Task B1 is a genuine investigation/decision task with a concrete recorded deliverable (not a code placeholder); B2–B3 carry full code contingent on B1's recommended (and pre-filled) choice. The one residual unknown — the exact name of the existing per-point mastery upsert helper in `exercises.ts` and whether the integration-test harness names match — is resolved by reading the file at execution time (the surrounding verbatim code is quoted). Acceptable: these are "match the existing pattern in this file" instructions, not invented APIs.
- **Type consistency:** `AttributionKey { key, name }` defined in `prompts.ts`, imported by `evaluate.ts`; `EvaluationError.grammarPointKey?` defined in shared, consumed in ai (parse) + db (observations) + lambda (incidental-fold). `IncidentalObs { grammarPointKey, score, at }` produced by B2, consumed by B3. Consistent.
- **Eval/version discipline:** `EVALUATION_SYSTEM_PROMPT_VERSION` bumped (A3) and pushed (A8); model unchanged (so no model-driven version bump); eval gate (A7) proves no scoring regression and spot-checks attribution.
