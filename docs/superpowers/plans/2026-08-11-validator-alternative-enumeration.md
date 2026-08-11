# Validator Alternative-Filler Enumeration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the generation validator enumerate and adjudicate candidate cloze fillers *before* it commits to `ambiguous`, and move `VALIDATION_MODEL` from `claude-sonnet-4-6` to `claude-sonnet-5`.

**Architecture:** `VALIDATION_TOOL` becomes `buildValidationTool(exerciseType)`; for cloze only it gains a required first property `candidateFillers`, so the model writes its candidate search before the verdict field. `parseValidationResult` reads the new field leniently. A derived self-consistency check reports (never enforces) contradictions. A validation-only replay harness measures both changes against a committed labelled fixture.

**Tech Stack:** TypeScript, Vitest, `@anthropic-ai/sdk`, pnpm workspaces + Turborepo.

## Global Constraints

- **Scope is cloze only.** `sentence_construction` must never receive `candidateFillers` — handing an enumerate-alternatives field to open production is how #606's 81% over-flagging regresses.
- **`candidateFillers` is non-load-bearing.** It must never throw, never veto a draft, and never alter routing. Follow the `coerceStringArray` / `coerceCoverage` contract at `packages/ai/src/validate.ts:261-292`.
- **Self-consistency is report-only** in this change. Append to `flaggedReasons`; never mutate `ambiguous`.
- **Prompt version bump required.** `VALIDATION_PROMPT_VERSION` → the commit date. The current value is already `validate@2026-08-11`, so a same-day commit uses `validate@2026-08-11a`. It is pinned in **two** places: `validation-prompts.test.ts:193` and `:920`.
- **Template ceiling.** `VALIDATION_SYSTEM_PROMPT_TEMPLATE` is 12,885 chars against a 13,000 ceiling (`validation-prompts.test.ts:266`) — 115 chars of headroom. Raise the ceiling to 14,500 in the same task that adds prompt text, or that task cannot pass.
- **Byte-parity test.** The `VALIDATION_SYSTEM_PROMPT_TEMPLATE byte parity` block pins `applyTemplate(TEMPLATE, computeValidationPromptVars(spec)).text === buildValidationSystemPrompt(spec)`. Any template edit must keep it green.
- **Model change is not a prompt edit.** Per the convention documented at `evaluate.ts:299-306`, do **not** bump `VALIDATION_PROMPT_VERSION` for the model portion — Langfuse records the model natively.
- **Worktree discipline.** All work happens in `/Users/seal/dev/language-drill/.claude/worktrees/validator-alternative-enumeration` on branch `feat/validator-alternative-enumeration`. Assert the branch before every commit.
- **Never run `pnpm build` then `pnpm test`** without `rm -rf infra/lambda/dist` — the build emits 87 compiled `*.test.js` files that vitest double-runs, producing 7 phantom failures.

## File Structure

| File | Responsibility |
|---|---|
| `packages/ai/src/validate.ts` (modify) | Tool builder, `CandidateFiller` type, lenient coercion, self-consistency check, model + request shaping, `validateDraft` options bag |
| `packages/ai/src/validation-prompts.ts` (modify) | Dimension-2 instruction pointing at `candidateFillers`; version bump |
| `packages/ai/src/validate.test.ts` (modify) | Tool shape, parse leniency, self-consistency, model pin, request shaping |
| `packages/ai/src/validation-prompts.test.ts` (modify) | Pinned phrases, raised ceiling, bumped version |
| `packages/ai/scripts/fixtures/validator-ambiguity-cases.json` (create) | Labelled cloze cases: `ambiguous` + `clean` buckets |
| `packages/ai/scripts/eval-validator-run.ts` (create) | Replay harness: arms, metrics, JSON report |
| `packages/ai/scripts/eval-validator-run.test.ts` (create) | Fixture-shape validation, arm construction, metric arithmetic |

---

### Task 1: `buildValidationTool(exerciseType)` with `candidateFillers`

**Files:**
- Modify: `packages/ai/src/validate.ts:76-180` (the `VALIDATION_TOOL` const)
- Test: `packages/ai/src/validate.test.ts`

**Interfaces:**
- Consumes: `ExerciseType` from `@language-drill/shared`.
- Produces: `buildValidationTool(exerciseType: ExerciseType): Anthropic.Tool`; type `CandidateFiller = { filler: string; verdict: "also-correct" | "ruled-out"; reason: string }`; const `CANDIDATE_FILLER_VERDICTS = ["also-correct", "ruled-out"] as const`. `VALIDATION_TOOL` is retained as `buildValidationTool(ExerciseType.CLOZE)` **only if** other call sites need it — otherwise delete it and update callers.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/ai/src/validate.test.ts
import { buildValidationTool, CANDIDATE_FILLER_VERDICTS } from "./validate.js";
import { ExerciseType } from "@language-drill/shared";

describe("buildValidationTool", () => {
  it("puts candidateFillers FIRST in properties and required for cloze", () => {
    const tool = buildValidationTool(ExerciseType.CLOZE);
    const schema = tool.input_schema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(schema.properties)[0]).toBe("candidateFillers");
    expect(schema.required[0]).toBe("candidateFillers");
  });

  it("omits candidateFillers for sentence_construction (guards #606)", () => {
    const tool = buildValidationTool(ExerciseType.SENTENCE_CONSTRUCTION);
    const schema = tool.input_schema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.properties).not.toHaveProperty("candidateFillers");
    expect(schema.required).not.toContain("candidateFillers");
  });

  it("keeps the seven pre-existing required fields for every type", () => {
    for (const type of [ExerciseType.CLOZE, ExerciseType.TRANSLATION]) {
      const schema = buildValidationTool(type).input_schema as {
        required: string[];
      };
      for (const f of [
        "qualityScore",
        "ambiguous",
        "contextSpoilsAnswer",
        "levelMatch",
        "grammarPointMatch",
        "culturalIssues",
        "flaggedReasons",
      ]) {
        expect(schema.required).toContain(f);
      }
    }
  });

  it("constrains verdict to the two-value enum", () => {
    const schema = buildValidationTool(ExerciseType.CLOZE).input_schema as {
      properties: { candidateFillers: { items: { properties: { verdict: { enum: string[] } } } } };
    };
    expect(schema.properties.candidateFillers.items.properties.verdict.enum).toEqual([
      ...CANDIDATE_FILLER_VERDICTS,
    ]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @language-drill/ai test -- validate.test.ts`
Expected: FAIL — `buildValidationTool is not a function`.

- [ ] **Step 3: Implement the builder**

In `packages/ai/src/validate.ts`, add above the existing `VALIDATION_TOOL`:

```ts
export const CANDIDATE_FILLER_VERDICTS = ["also-correct", "ruled-out"] as const;

export type CandidateFillerVerdict = (typeof CANDIDATE_FILLER_VERDICTS)[number];

/** One adjudicated candidate fill. Non-load-bearing: never gates routing. */
export type CandidateFiller = {
  filler: string;
  verdict: CandidateFillerVerdict;
  reason: string;
};

const CANDIDATE_FILLERS_PROPERTY = {
  type: "array" as const,
  description:
    "Fill this FIRST, before any other field. List 2-4 distinct fillers a " +
    "competent speaker might write in the blank — including `correctAnswer` " +
    "itself — and adjudicate each against the VISIBLE sentence alone, never " +
    "against `correctAnswer`. This is your working-out for `ambiguous`, not a " +
    "verdict.",
  items: {
    type: "object" as const,
    properties: {
      filler: { type: "string" as const, description: "The candidate fill." },
      verdict: {
        type: "string" as const,
        enum: [...CANDIDATE_FILLER_VERDICTS],
        description:
          "`also-correct`: fully correct on the visible sentence AND satisfies " +
          "the grammar point. `ruled-out`: something in the visible sentence " +
          "forbids it.",
      },
      reason: {
        type: "string" as const,
        description:
          "For `ruled-out`, quote the span of the visible sentence that forbids " +
          "it. For `also-correct`, one clause on why it fits.",
      },
    },
    required: ["filler", "verdict", "reason"],
  },
};
```

Then convert `VALIDATION_TOOL` into a builder. Keep the existing seven properties and their descriptions **byte-identical**; only the wrapper changes:

```ts
export function buildValidationTool(exerciseType: ExerciseType): Anthropic.Tool {
  const isCloze = exerciseType === ExerciseType.CLOZE;
  return {
    name: VALIDATION_TOOL_NAME,
    description:
      "Submit the structured validation result for a generated language exercise.",
    input_schema: {
      type: "object" as const,
      properties: {
        // Ordering is the mechanism: the model emits its candidate search
        // before the `ambiguous` verdict, so the verdict is conditioned on the
        // search rather than replacing it. Mirrors evaluate.ts's required
        // `reasoning` scratchpad as first tool field.
        ...(isCloze ? { candidateFillers: CANDIDATE_FILLERS_PROPERTY } : {}),
        ...EXISTING_VALIDATION_PROPERTIES,
      },
      required: [
        ...(isCloze ? ["candidateFillers"] : []),
        "qualityScore",
        "ambiguous",
        "contextSpoilsAnswer",
        "levelMatch",
        "grammarPointMatch",
        "culturalIssues",
        "flaggedReasons",
      ],
    },
  };
}
```

Extract the current seven properties verbatim into a module-level
`const EXISTING_VALIDATION_PROPERTIES = { qualityScore: {...}, ... }` so the
descriptions are unchanged. Update the `validateDraft` call site (`validate.ts:418`)
from `tools: [VALIDATION_TOOL]` to `tools: [buildValidationTool(draft.contentJson.type)]`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- validate.test.ts`
Expected: PASS, including the pre-existing `callArgs.model` / tool-name assertions.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must be feat/validator-alternative-enumeration
git add packages/ai/src/validate.ts packages/ai/src/validate.test.ts
git commit -m "feat(ai): per-type validation tool with candidateFillers on cloze"
```

---

### Task 2: Lenient `candidateFillers` parsing

**Files:**
- Modify: `packages/ai/src/validate.ts` (`ValidationResult` type, `coerceCandidateFillers`, `parseValidationResult`)
- Test: `packages/ai/src/validate.test.ts`

**Interfaces:**
- Consumes: `CandidateFiller`, `CANDIDATE_FILLER_VERDICTS` from Task 1.
- Produces: `ValidationResult.candidateFillers: CandidateFiller[]` (always an array, never `undefined`).

- [ ] **Step 1: Write the failing tests**

```ts
describe("parseValidationResult — candidateFillers leniency", () => {
  const base = {
    qualityScore: 0.8,
    ambiguous: false,
    contextSpoilsAnswer: false,
    levelMatch: true,
    grammarPointMatch: true,
    culturalIssues: [],
    flaggedReasons: [],
  };

  it("defaults to [] when the field is absent", () => {
    expect(parseValidationResult(base).candidateFillers).toEqual([]);
  });

  it("coerces a non-array to [] without throwing", () => {
    expect(
      parseValidationResult({ ...base, candidateFillers: "nope" }).candidateFillers,
    ).toEqual([]);
  });

  it("drops entries with a missing or non-string filler", () => {
    const r = parseValidationResult({
      ...base,
      candidateFillers: [
        { filler: "el menos", verdict: "also-correct", reason: "fits" },
        { verdict: "ruled-out", reason: "no filler key" },
        { filler: 42, verdict: "ruled-out", reason: "non-string" },
      ],
    });
    expect(r.candidateFillers).toEqual([
      { filler: "el menos", verdict: "also-correct", reason: "fits" },
    ]);
  });

  it("drops entries whose verdict is outside the enum", () => {
    const r = parseValidationResult({
      ...base,
      candidateFillers: [{ filler: "x", verdict: "maybe", reason: "r" }],
    });
    expect(r.candidateFillers).toEqual([]);
  });

  it("defaults a missing reason to the empty string rather than dropping", () => {
    const r = parseValidationResult({
      ...base,
      candidateFillers: [{ filler: "x", verdict: "ruled-out" }],
    });
    expect(r.candidateFillers).toEqual([
      { filler: "x", verdict: "ruled-out", reason: "" },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @language-drill/ai test -- validate.test.ts -t candidateFillers`
Expected: FAIL — `candidateFillers` is `undefined`.

- [ ] **Step 3: Implement**

Add to the `ValidationResult` type:

```ts
  /**
   * The validator's adjudicated candidate fills (cloze only). Strictly
   * non-load-bearing: `routeValidationResult` ignores it and
   * `parseValidationResult` coerces anything malformed to `[]`. Present so the
   * `ambiguous` verdict is conditioned on a search rather than replacing one.
   */
  candidateFillers: CandidateFiller[];
```

Add the coercer beside `coerceCoverage`:

```ts
/**
 * Lenient reader for the non-load-bearing `candidateFillers` array. A missing
 * or non-array value yields `[]`; entries lacking a string `filler` or a
 * known `verdict` are dropped individually; a missing `reason` defaults to "".
 * Never throws — a malformed scratchpad must never cost the draft (R8.2).
 */
function coerceCandidateFillers(
  raw: Record<string, unknown>,
): CandidateFiller[] {
  const v = raw.candidateFillers;
  if (!Array.isArray(v)) return [];
  const out: CandidateFiller[] = [];
  for (const entry of v) {
    if (!isObject(entry)) continue;
    const { filler, verdict, reason } = entry;
    if (typeof filler !== "string") continue;
    if (
      typeof verdict !== "string" ||
      !(CANDIDATE_FILLER_VERDICTS as readonly string[]).includes(verdict)
    ) {
      continue;
    }
    out.push({
      filler,
      verdict: verdict as CandidateFillerVerdict,
      reason: typeof reason === "string" ? reason : "",
    });
  }
  return out;
}
```

Wire it into `parseValidationResult` beside the other lenient reads, and add
`candidateFillers` to the returned object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add packages/ai/src/validate.ts packages/ai/src/validate.test.ts
git commit -m "feat(ai): parse candidateFillers leniently, never gating routing"
```

---

### Task 3: Self-consistency check (report-only)

**Files:**
- Modify: `packages/ai/src/validate.ts` (new exported pure function + call in `validateDraft`)
- Test: `packages/ai/src/validate.test.ts`

**Interfaces:**
- Consumes: `ValidationResult`, `CandidateFiller` from Tasks 1-2.
- Produces: `SELF_INCONSISTENT_REASON = "validator-self-inconsistent"`; `applyCandidateFillerConsistency(result: ValidationResult, acceptableAnswers: readonly string[] | undefined): ValidationResult`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("applyCandidateFillerConsistency", () => {
  const result = (over: Partial<ValidationResult>): ValidationResult => ({
    qualityScore: 0.85, ambiguous: false, contextSpoilsAnswer: false,
    levelMatch: true, grammarPointMatch: true, culturalIssues: [],
    flaggedReasons: [], coverage: {}, candidateFillers: [], ...over,
  });

  it("flags an unlisted also-correct filler when ambiguous is false", () => {
    const out = applyCandidateFillerConsistency(
      result({ candidateFillers: [{ filler: "el menos", verdict: "also-correct", reason: "fits" }] }),
      [],
    );
    expect(out.flaggedReasons).toContain(SELF_INCONSISTENT_REASON);
  });

  it("NEVER mutates ambiguous", () => {
    const out = applyCandidateFillerConsistency(
      result({ candidateFillers: [{ filler: "el menos", verdict: "also-correct", reason: "f" }] }),
      [],
    );
    expect(out.ambiguous).toBe(false);
  });

  it("stays silent when the filler is enumerated in acceptableAnswers", () => {
    const out = applyCandidateFillerConsistency(
      result({ candidateFillers: [{ filler: "el menos", verdict: "also-correct", reason: "f" }] }),
      ["el menos"],
    );
    expect(out.flaggedReasons).not.toContain(SELF_INCONSISTENT_REASON);
  });

  it("stays silent when ambiguous is already true", () => {
    const out = applyCandidateFillerConsistency(
      result({ ambiguous: true, candidateFillers: [{ filler: "x", verdict: "also-correct", reason: "f" }] }),
      [],
    );
    expect(out.flaggedReasons).not.toContain(SELF_INCONSISTENT_REASON);
  });

  it("ignores ruled-out fillers", () => {
    const out = applyCandidateFillerConsistency(
      result({ candidateFillers: [{ filler: "x", verdict: "ruled-out", reason: "'ayer' forbids it" }] }),
      [],
    );
    expect(out.flaggedReasons).not.toContain(SELF_INCONSISTENT_REASON);
  });

  it("is a no-op on an empty candidateFillers array", () => {
    const out = applyCandidateFillerConsistency(result({}), []);
    expect(out.flaggedReasons).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @language-drill/ai test -- validate.test.ts -t applyCandidateFillerConsistency`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

```ts
export const SELF_INCONSISTENT_REASON = "validator-self-inconsistent";

/** Case/whitespace-insensitive membership, matching how a learner's answer
 *  would be compared against the stored list. */
function listed(needle: string, haystack: readonly string[]): boolean {
  const n = needle.trim().toLowerCase();
  return haystack.some((h) => h.trim().toLowerCase() === n);
}

/**
 * `candidateFillers` makes `ambiguous` derivable: an `also-correct` filler that
 * is not in `acceptableAnswers` contradicts `ambiguous: false`.
 *
 * REPORT-ONLY BY DESIGN. This appends a `flaggedReasons` entry and returns a
 * new result; it must never mutate `ambiguous` or change routing. Flipping
 * verdicts from an unvetted scratchpad is how #606's over-flagging happened.
 * Promote to enforcement only once the replay harness shows the enumeration is
 * trustworthy.
 */
export function applyCandidateFillerConsistency(
  result: ValidationResult,
  acceptableAnswers: readonly string[] | undefined,
): ValidationResult {
  if (result.ambiguous) return result;
  const accepted = acceptableAnswers ?? [];
  const contradiction = result.candidateFillers.some(
    (c) => c.verdict === "also-correct" && !listed(c.filler, accepted),
  );
  if (!contradiction) return result;
  return {
    ...result,
    flaggedReasons: [...result.flaggedReasons, SELF_INCONSISTENT_REASON],
  };
}
```

Call it in `validateDraft` after `parseValidationResult`, reading
`acceptableAnswers` off the cloze content (guard the discriminant — only
`ClozeContent` carries it in this scope):

```ts
  const parsed = parseValidationResult(toolUseBlock.input);
  const result =
    draft.contentJson.type === ExerciseType.CLOZE
      ? applyCandidateFillerConsistency(
          parsed,
          draft.contentJson.acceptableAnswers,
        )
      : parsed;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add packages/ai/src/validate.ts packages/ai/src/validate.test.ts
git commit -m "feat(ai): report validator self-inconsistency without changing routing"
```

---

### Task 4: Dimension-2 prompt instruction + version bump + ceiling raise

**Files:**
- Modify: `packages/ai/src/validation-prompts.ts:112` (version), `:153` (dimension 2), changelog comment block above the version
- Modify: `packages/ai/src/validation-prompts.test.ts:193`, `:266`, `:920`

**Interfaces:**
- Consumes: the `candidateFillers` field name from Task 1.
- Produces: `VALIDATION_PROMPT_VERSION = "validate@2026-08-11a"` (or the commit date if later).

- [ ] **Step 1: Write the failing tests**

```ts
it("instructs cloze validation to fill candidateFillers before deciding ambiguous", () => {
  expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain(
    "fill `candidateFillers` before deciding this field",
  );
  expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain(
    "quote the span of the visible sentence that forbids it",
  );
});

it("pins the bumped validation prompt version", () => {
  expect(VALIDATION_PROMPT_VERSION).toBe("validate@2026-08-11a");
});
```

Update the existing ceiling assertion at `:266` to `14500` and the two existing
version pins at `:193` and `:920` to the new value.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @language-drill/ai test -- validation-prompts.test.ts`
Expected: FAIL on the new phrases and the old version pins.

- [ ] **Step 3: Implement**

Insert as the **first** sub-bullet under dimension 2 in
`VALIDATION_SYSTEM_PROMPT_TEMPLATE` (before the Form-contrast exception):

```
   - **For cloze, fill \`candidateFillers\` before deciding this field.** Propose 2–4 distinct fillers a competent speaker might write — same-lexeme tense variants, opposite-polarity alternants, and different lexemes that fit the frame — and adjudicate each against the visible sentence ALONE, never against \`correctAnswer\`. Mark a filler \`ruled-out\` only when you can quote the span of the visible sentence that forbids it; "it is not the intended answer" is not a ruling. Then set \`ambiguous = true\` if any filler you marked \`also-correct\` is absent from \`acceptableAnswers\`. The sub-bullets below are worked examples of what \`also-correct\` looks like, not the only patterns to check.
```

Bump `VALIDATION_PROMPT_VERSION` and add a changelog entry above it following
the existing format, noting: template edit → Langfuse push per env required.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- validation-prompts.test.ts`
Expected: PASS, including the `VALIDATION_SYSTEM_PROMPT_TEMPLATE byte parity` block.

- [ ] **Step 5: Verify the ceiling headroom is real**

Run:
```bash
node -e "
const s=require('fs').readFileSync('packages/ai/src/validation-prompts.ts','utf8');
const m=s.match(/export const VALIDATION_SYSTEM_PROMPT_TEMPLATE = \`([\s\S]*?)\`;\n/);
console.log('chars:', m[1].length, 'ceiling 14500 headroom', 14500-m[1].length);
"
```
Expected: chars ≈ 13,500; headroom ≈ 1,000. If headroom is negative, the test
at `:266` will already have failed.

- [ ] **Step 6: Commit**

```bash
git branch --show-current
git add packages/ai/src/validation-prompts.ts packages/ai/src/validation-prompts.test.ts
git commit -m "feat(ai): point the cloze ambiguous dimension at candidateFillers"
```

---

### Task 5: Model upgrade + Sonnet 5 request shaping

**Files:**
- Modify: `packages/ai/src/validate.ts:54-60` (constants), `:407-423` (request), `validate.test.ts:86-98` (invariant)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `VALIDATION_MODEL = "claude-sonnet-5"`, `VALIDATION_MAX_TOKENS = 2048`; `VALIDATION_TEMPERATURE` stays exported at `0.0` but is applied conditionally.

- [ ] **Step 1: Write the failing tests**

Replace the three-way invariant block at `validate.test.ts:86-98` with:

```ts
describe("VALIDATION_MODEL", () => {
  // Deliberately DECOUPLED from GENERATION_MODEL. A validator miss ships a
  // defect to learners and costs a demote-plus-backfill repass; a generator
  // miss wastes one draft. Precedent: theory-generate.test.ts:219.
  it("is pinned to claude-sonnet-5 and decoupled from GENERATION_MODEL", () => {
    expect(VALIDATION_MODEL).toBe("claude-sonnet-5");
    expect(VALIDATION_MODEL).not.toBe(GENERATION_MODEL);
  });
});

describe("validateDraft request shaping for Sonnet 5", () => {
  it("omits temperature (Sonnet 5 rejects non-default sampling params)", async () => {
    // ...existing mock-client setup from the surrounding describe...
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("temperature");
  });

  it("sends an explicit thinking: disabled so adaptive does not silently engage", async () => {
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.thinking).toEqual({ type: "disabled" });
  });

  it("budgets 2048 max_tokens so candidateFillers cannot truncate the tool call", () => {
    expect(VALIDATION_MAX_TOKENS).toBe(2048);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @language-drill/ai test -- validate.test.ts`
Expected: FAIL — model is `claude-sonnet-4-6`, `temperature` present, no `thinking`.

- [ ] **Step 3: Implement**

Update the constants with a comment recording the rationale and the revert path:

```ts
/**
 * Validator model. DECOUPLED from `GENERATION_MODEL` as of 2026-08-11: a
 * validator miss ships a defect to learners and costs a demote-plus-backfill
 * repass, whereas a generator miss wastes one draft — so the validator is the
 * cheaper place to spend capability. Same $3/$15 list price as sonnet-4-6.
 * Gated by `pnpm eval:validator` against the labelled ambiguity fixture;
 * revert by restoring this one constant.
 */
export const VALIDATION_MODEL = "claude-sonnet-5" as const;

/** Sized for `candidateFillers` (~150-250 tokens) plus the seven verdict
 *  fields; 1024 was the pre-enumeration budget and risks truncating the
 *  forced tool call mid-JSON. Mirrors evaluate.ts's bump for the same reason. */
export const VALIDATION_MAX_TOKENS = 2048;
```

Rewrite the request in `validateDraft`, porting the shaping from
`evaluate.ts:409-443`:

```ts
  // Per-model request shaping (see evaluate.ts:399-411 for the same guards):
  //  - Sonnet 5 / Opus 4.7+ / Fable reject non-default sampling params
  //    (`temperature: 0` → 400), so temperature only goes to models that take it.
  //  - Sonnet 5 (and Fable) run ADAPTIVE thinking when `thinking` is omitted —
  //    send an explicit `disabled` so this stays a model change and not a
  //    silent thinking change (which would also spend against max_tokens).
  const effectiveModel = options?.modelOverride ?? VALIDATION_MODEL;
  const rejectsSamplingParams = /sonnet-5|opus-4-[7-9]|opus-5|fable/.test(effectiveModel);
  const omittedThinkingMeansAdaptive = /sonnet-5|opus-5|fable/.test(effectiveModel);

  const request: Anthropic.MessageCreateParamsNonStreaming = {
    model: effectiveModel,
    max_tokens: VALIDATION_MAX_TOKENS,
    system: [{ type: "text" as const, text: systemText, cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user" as const, content: userText }],
    tools: [buildValidationTool(draft.contentJson.type)],
    tool_choice: { type: "tool" as const, name: VALIDATION_TOOL_NAME },
  };
  if (!rejectsSamplingParams) request.temperature = VALIDATION_TEMPERATURE;
  if (omittedThinkingMeansAdaptive) request.thinking = { type: "disabled" };

  const response = await client.messages.create(request, { signal });
```

(`options` arrives in Task 6; until then use `VALIDATION_MODEL` directly and
swap the line in Task 6.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add packages/ai/src/validate.ts packages/ai/src/validate.test.ts
git commit -m "feat(ai): move validator to claude-sonnet-5 with matching request shaping"
```

---

### Task 6: `validateDraft` options bag

**Files:**
- Modify: `packages/ai/src/validate.ts` (signature + system-prompt selection)
- Test: `packages/ai/src/validate.test.ts`

**Interfaces:**
- Produces: `type ValidateDraftOptions = { modelOverride?: string; systemPromptOverride?: string }`; signature becomes `validateDraft(client, draft, spec, signal?, options?)`. The 5th-position optional param keeps every existing call site source-compatible.

- [ ] **Step 1: Write the failing tests**

```ts
it("uses modelOverride when supplied", async () => {
  await validateDraft(client, clozeDraft, spec, undefined, {
    modelOverride: "claude-sonnet-4-6",
  });
  expect(mockCreate.mock.calls[0][0].model).toBe("claude-sonnet-4-6");
});

it("sends temperature again when the override model accepts it", async () => {
  await validateDraft(client, clozeDraft, spec, undefined, {
    modelOverride: "claude-sonnet-4-6",
  });
  expect(mockCreate.mock.calls[0][0].temperature).toBe(0);
});

it("uses systemPromptOverride verbatim, bypassing Langfuse", async () => {
  await validateDraft(client, clozeDraft, spec, undefined, {
    systemPromptOverride: "OVERRIDDEN",
  });
  expect(mockCreate.mock.calls[0][0].system[0].text).toBe("OVERRIDDEN");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @language-drill/ai test -- validate.test.ts -t Override`
Expected: FAIL — 5th argument ignored.

- [ ] **Step 3: Implement**

```ts
/** Eval-harness escape hatch. Production never sets these — the no-override
 *  path is byte-identical to before. Mirrors generate.ts's
 *  `spec.systemPromptOverride` and evaluate.ts's `modelOverride`. */
export type ValidateDraftOptions = {
  modelOverride?: string;
  systemPromptOverride?: string;
};
```

Add `options?: ValidateDraftOptions` as the 5th parameter, and short-circuit
the system-prompt builder:

```ts
  const systemText =
    options?.systemPromptOverride ??
    (isDictation
      ? await buildDictationValidationSystemPrompt(spec)
      : isFreeWriting
        ? await buildFreeWritingValidationSystemPrompt(spec)
        : await buildValidationSystemPrompt(spec));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add packages/ai/src/validate.ts packages/ai/src/validate.test.ts
git commit -m "feat(ai): add validateDraft model/prompt overrides for eval arms"
```

---

### Task 7: Labelled ambiguity fixture

**Files:**
- Create: `packages/ai/scripts/fixtures/validator-ambiguity-cases.json`

**Interfaces:**
- Produces: a JSON array of `ValidatorFixtureCase`, consumed by Task 8.

Each entry is self-contained — no DB, no prod access:

```json
[
  {
    "id": "es-b1-superlatives-polarity-unanchored",
    "label": "ambiguous",
    "provenance": "PR #633, row ba31a2cc-721c-5ace-896d-d822d89bf703",
    "language": "es",
    "cefrLevel": "B1",
    "grammarPointKey": "es-b1-superlatives-comparisons",
    "content": {
      "type": "cloze",
      "instructions": "Completa la frase con la forma correcta.",
      "sentence": "El examen de matemáticas fue ___ difícil de todos los que hice este año.",
      "correctAnswer": "el más",
      "options": ["el más", "el menos", "más que", "el más que"],
      "acceptableAnswers": []
    },
    "why": "The superlative frame is symmetric; `el menos` is equally valid on the visible text and is shipped as a distractor."
  },
  {
    "id": "es-b1-superlatives-anchored-parque",
    "label": "clean",
    "provenance": "PR #633, named as a well-formed exemplar",
    "language": "es",
    "cefrLevel": "B1",
    "grammarPointKey": "es-b1-superlatives-comparisons",
    "content": {
      "type": "cloze",
      "instructions": "Completa la frase con la forma correcta.",
      "sentence": "Este parque es el ___ bonito de toda la ciudad, y por eso lo amamos tanto.",
      "correctAnswer": "más",
      "acceptableAnswers": []
    },
    "why": "`y por eso lo amamos tanto` is an evaluative anchor that fits only the positive pole."
  }
]
```

- [ ] **Step 1: Build the `ambiguous` bucket (~20 cases)**

Transcribe from the PR bodies, which name each row:
- **#633** — `ba31a2cc` (`el más` unanchored), `bea095af` (`menos` unanchored, the reverse direction), `a74cce3a` (malformed `la más institución importante`), plus the adjective-swallowing `Este hotel es el ___ de toda la ciudad`.
- **#611** — the anchorless-preterite family on `es-b1-influence-verbs-infinitive`: `El guardia de seguridad no nos ___ entrar al edificio sin identificación.` / `dejó`; `El portero no ___ entrar al mensajero sin identificación.` / `dejó`.
- **#619** — `9ffc33c1`: `El ruido de la calle no me ___ dormir bien por las noches.` / `deja`; `El entrenador nos ___ correr diez kilómetros todos los días.` / `hace`.
- **#625** — `Ich habe ___ Bruder.` / `einen Bruder`; `Mein Vater ist ___ Arzt.` / `Arzt`; the `es-b1-nominalizers` case `No me gusta este abrigo; prefiero ___ del escaparate.` / `el del`.

- [ ] **Step 2: Build the `clean` bucket (~20 cases)**

This bucket is the over-flagging gate — it is not optional.
- **#633's** two anchored exemplars (parque / mercado).
- **#611's** anchored preterite `Cuando llegué tarde, mi jefe no me ___ disculparme.` / `dejó`.
- **#612's** over-accept controls, which must stay non-ambiguous.
- A spread of healthy approved cloze across `de`/`tr` so the bucket is not ES-only.

- [ ] **Step 3: Sanity-check the fixture parses**

Run: `node -e "const c=require('./packages/ai/scripts/fixtures/validator-ambiguity-cases.json'); console.log(c.length, c.filter(x=>x.label==='ambiguous').length, c.filter(x=>x.label==='clean').length)"`
Expected: total ≈ 40, roughly balanced between buckets.

- [ ] **Step 4: Commit**

```bash
git branch --show-current
git add packages/ai/scripts/fixtures/validator-ambiguity-cases.json
git commit -m "test(ai): labelled cloze ambiguity fixture from #611/#619/#625/#633"
```

---

### Task 8: Replay harness `eval-validator-run.ts`

**Files:**
- Create: `packages/ai/scripts/eval-validator-run.ts`
- Create: `packages/ai/scripts/eval-validator-run.test.ts`
- Modify: `packages/ai/package.json` (add `"eval:validator"` script)

**Interfaces:**
- Consumes: `validateDraft` + `ValidateDraftOptions` (Task 6), `SELF_INCONSISTENT_REASON` (Task 3), the fixture (Task 7).
- Produces: `type ValidatorArm = { name: string; modelOverride?: string; systemPromptOverride?: string }`; `computeArmMetrics(cases, results): ArmMetrics` where `ArmMetrics = { recallOnAmbiguous: number; falseFlagRateOnClean: number; selfInconsistentRate: number; n: number }`.

- [ ] **Step 1: Write the failing metric tests**

```ts
import { computeArmMetrics } from "./eval-validator-run.js";

describe("computeArmMetrics", () => {
  it("computes recall over the ambiguous bucket only", () => {
    const m = computeArmMetrics(
      [{ label: "ambiguous" }, { label: "ambiguous" }, { label: "clean" }],
      [{ ambiguous: true }, { ambiguous: false }, { ambiguous: false }],
    );
    expect(m.recallOnAmbiguous).toBeCloseTo(0.5);
  });

  it("computes false-flag rate over the clean bucket only", () => {
    const m = computeArmMetrics(
      [{ label: "clean" }, { label: "clean" }],
      [{ ambiguous: true }, { ambiguous: false }],
    );
    expect(m.falseFlagRateOnClean).toBeCloseTo(0.5);
  });

  it("returns 0 for an empty bucket rather than NaN", () => {
    const m = computeArmMetrics([{ label: "clean" }], [{ ambiguous: false }]);
    expect(m.recallOnAmbiguous).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @language-drill/ai test -- eval-validator-run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the harness**

Follow the CLI conventions of `eval-gen-run.ts`: `--limit`, `--max-cost-usd`,
`--dry-run`, `--run-name`, output to `./eval-runs/validator-<runName>.json`.
Note `pnpm <script> -- --flag` throws for `packages/ai` CLIs — invoke as
`pnpm eval:validator --limit 5`.

Four arms, so prompt and model are never confounded:

```ts
const ARMS: ValidatorArm[] = [
  { name: "baseline",    modelOverride: "claude-sonnet-4-6", systemPromptOverride: PRIOR_TEMPLATE },
  { name: "prompt-only", modelOverride: "claude-sonnet-4-6" },
  { name: "model-only",  systemPromptOverride: PRIOR_TEMPLATE },
  { name: "both" },
];
```

`PRIOR_TEMPLATE` is the **pre-Task-4** template body. Do not read it from git at
runtime — the harness must stay reproducible after this branch merges and `HEAD~N`
stops meaning anything. Capture it once, into a committed fixture, by running this
from the worktree root:

```bash
git show 8a661129:packages/ai/src/validation-prompts.ts \
  | node -e "
    let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
      const m=s.match(/export const VALIDATION_SYSTEM_PROMPT_TEMPLATE = \`([\s\S]*?)\`;\n/);
      require('fs').writeFileSync(
        'packages/ai/scripts/fixtures/validation-system-prompt-baseline.txt', m[1]);
      console.log('captured', m[1].length, 'chars');
    });"
```

`8a661129` is this branch's spec commit — the last commit before any prompt edit.
Expected output: `captured 12885 chars`. The harness then imports that file's
contents as `PRIOR_TEMPLATE` and passes it as `systemPromptOverride`. Note the
baseline arms must also pass `modelOverride: "claude-sonnet-4-6"` explicitly,
since Task 5 has already moved the production default.

`computeArmMetrics` is a pure function over `(cases, results)` — keep every
Anthropic call out of it so the tests above need no mocking.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- eval-validator-run.test.ts`
Expected: PASS.

- [ ] **Step 5: Dry-run the harness end to end**

Run: `pnpm --filter @language-drill/ai eval:validator --dry-run`
Expected: prints the arm matrix and case counts, makes zero Anthropic calls.

- [ ] **Step 6: Commit**

```bash
git branch --show-current
git add packages/ai/scripts/eval-validator-run.ts packages/ai/scripts/eval-validator-run.test.ts packages/ai/package.json
git commit -m "feat(ai): validator replay harness with over-flag control bucket"
```

---

### Task 9: Full gate + live harness run

**Files:** none modified.

- [ ] **Step 1: Run the full gate**

```bash
rm -rf infra/lambda/dist   # build output double-runs tests; see Global Constraints
pnpm lint
pnpm typecheck
pnpm test
```
Expected: zero failures. If `@language-drill/lambda` shows `dist/**/*.test.js`
failures, the `rm -rf` was skipped — remove and re-run that package alone.

- [ ] **Step 2: Run the harness for real**

The `packages/ai` CLIs do **not** load `.env` themselves (same convention as
`eval-gen-run.ts`, which reads `process.env.ANTHROPIC_API_KEY` directly). A fresh
worktree also has no `.env` at all — copy it from the main checkout first, then
invoke through `dotenv-cli`:

```bash
cp /Users/seal/dev/language-drill/.env .        # gitignored; verify with `git check-ignore .env`
./node_modules/.bin/dotenv -e .env -- \
  pnpm --filter @language-drill/ai eval:validator --max-cost-usd 4 --run-name full
```

Measured cost from a 2-case smoke run: **~$0.025/call**, so the full 31×4 = 124
calls land near **$3**. Set the cap above that with headroom, and start with
`--limit 2` to confirm the pipeline before spending the full amount.

Expected: `./eval-runs/validator-<runName>.json` with four arms.

> ⚠️ **The prompt arms must not fetch from Langfuse.** `buildValidationSystemPrompt`
> resolves its body from Langfuse label `production`, which holds the *pre-change*
> prompt until the post-merge push. If that fetch succeeds, the `prompt-only` and
> `both` arms silently run the OLD prompt and the harness reports no prompt effect.
> Confirm from the run banner that every arm's prompt source is repo-sourced before
> trusting any number.

- [ ] **Step 3: Apply the merge criterion**

The `both` arm must **strictly beat** `baseline` on `recallOnAmbiguous` **and
not increase** `falseFlagRateOnClean`. A recall gain bought with over-flagging
is a #606 repeat — do not merge it; report the numbers and stop.

Compare `prompt-only` and `model-only` to attribute the movement. If `model-only`
carries the whole gain, reconsider whether Task 4's prompt change earns its
tokens.

- [ ] **Step 4: Report and stop**

Post the four-arm table. **Do not push or open a PR without the user's
go-ahead**, and do not run `push-prompts` — the Langfuse sync is a separate,
deliberate post-merge step per the spec's Rollout section.

---

## Post-merge (NOT part of this plan)

1. **Langfuse push required** — this edits the registered `validate-system-prompt`
   body, so the runtime serves the old prompt until synced. Push prod + dev from
   fresh `main`, never a stale worktree.
2. No pool repass yet — generation is paused; wait for the first live run's flag
   rates.
