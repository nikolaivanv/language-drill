# Blind-Solver Arm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth arm to the validator replay harness that judges cloze ambiguity **without seeing the stored answer**, so we can measure whether access — not effort — explains a recall rate that four sighted configurations could not move.

**Architecture:** The arm does not call `validateDraft` at all. It renders the learner view (minus `options`), calls `qa-sample`'s existing `craftProbeAnswers` on `claude-sonnet-5`, and applies a pure set-membership test: the case is ambiguous when the crafted alternative is absent from `correctAnswer` + `acceptableAnswers`. `ValidatorArm` gains a `kind` discriminator; the executor branches on it and the four existing arms are byte-identical.

**Tech Stack:** TypeScript, Vitest, `@anthropic-ai/sdk`, pnpm workspaces.

## Global Constraints

- **The solver must NOT see `options`.** `showOptions` defaults to `false` (`cloze-exercise.tsx:54`) and the fixture was labelled under exactly that rule (`_visibilityRule`). A solver shown options answers a different question than the labels encode. `instructions`, `context`, `sentence`, `glossEn` ARE visible and must be included.
- **The solver runs on `claude-sonnet-5`**, not `craftProbeAnswers`'s `QA_CRAFTER_MODEL` default (`claude-opus-4-8`). Matching the `both` arm's model isolates blind-vs-sighted from capability.
- **The verdict is a set-membership test only.** `correctConfidence` and the crafter's own `ambiguous` flag are recorded in per-case output but MUST NOT influence the verdict — introducing a threshold would fit a free parameter on the same 82 cases being measured.
- **`selfInconsistentRate` for this arm reports `null`, not `0`.** Zero reads as "measured, found none"; the truth is "not applicable" — the solver has no `flaggedReasons`.
- **The four existing arms must be unchanged.** Their `ARMS` entries keep their current model/prompt pinning and continue to run through `validateDraft`.
- **Do not modify** `packages/ai/src/validate.ts`, `validation-prompts.ts`, or any prompt body.
- **Do not run the harness against the live API.** Build and unit-test only; the controller runs it.
- **Worktree discipline.** All work in `/Users/seal/dev/language-drill/.claude/worktrees/validator-alternative-enumeration` on branch `feat/validator-alternative-enumeration`. Assert the branch before every commit.
- **Never run `pnpm build` then `pnpm test`** without `rm -rf infra/lambda/dist` — the build emits 87 compiled `*.test.js` files vitest double-runs, producing 7 phantom failures.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/ai/src/qa-sample.ts` | Learner-view rendering + crafter | Add an options-omitting variant |
| `packages/ai/src/qa-sample.test.ts` | Its tests | Cover the new variant |
| `packages/ai/scripts/eval-validator-run.ts` | Harness: arms, executor, metrics, report | `kind` discriminator, solver branch, `null` self-inconsistency |
| `packages/ai/scripts/eval-validator-run.test.ts` | Harness tests | Verdict function, arm table, view contents |

---

### Task 1: Options-omitting learner view

**Files:**
- Modify: `packages/ai/src/qa-sample.ts` (`renderLearnerView`, around line 13)
- Test: `packages/ai/src/qa-sample.test.ts`

**Interfaces:**
- Produces: `renderLearnerView(content: ExerciseContent, opts?: { includeOptions?: boolean }): string`. Default `includeOptions: true` so the existing `qa:sample` caller is unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
import { ExerciseType, type ClozeContent } from "@language-drill/shared";
import { renderLearnerView } from "./qa-sample.js";

const cloze: ClozeContent = {
  type: ExerciseType.CLOZE,
  instructions: "Fill in the blank with either 'de' or nothing.",
  sentence: "Las instrucciones son difíciles ___ entender.",
  correctAnswer: "de",
  options: ["de", "para", "en"],
  context: "adjective + de + infinitive",
  glossEn: "The instructions are hard to understand.",
};

describe("renderLearnerView — options visibility", () => {
  it("includes options by default (unchanged for qa:sample)", () => {
    expect(renderLearnerView(cloze)).toContain("para");
  });

  it("omits options when includeOptions is false", () => {
    const v = renderLearnerView(cloze, { includeOptions: false });
    expect(v).not.toContain("para");
    expect(v).not.toMatch(/Options:/);
  });

  it("still includes instructions, context, gloss and sentence when options are omitted", () => {
    const v = renderLearnerView(cloze, { includeOptions: false });
    expect(v).toContain("either 'de' or nothing");
    expect(v).toContain("adjective + de + infinitive");
    expect(v).toContain("The instructions are hard to understand.");
    expect(v).toContain("difíciles ___ entender");
  });

  it("never leaks the stored answer field itself", () => {
    // `de` appears inside the instructions legitimately; assert the view
    // carries no answer-bearing label rather than no substring.
    const v = renderLearnerView(cloze, { includeOptions: false });
    expect(v).not.toMatch(/correctAnswer|Correct answer|Answer:/i);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @language-drill/ai test -- qa-sample.test.ts`
Expected: the `includeOptions: false` tests FAIL (options still present); the default test PASSES.

- [ ] **Step 3: Implement**

Change the signature and the CLOZE branch only:

```ts
export function renderLearnerView(
  content: ExerciseContent,
  opts: { includeOptions?: boolean } = {},
): string {
  const includeOptions = opts.includeOptions ?? true;
```

and in the CLOZE case replace the options line with:

```ts
      if (includeOptions && content.options?.length) {
        lines.push(`Options: ${content.options.join(", ")}`);
      }
```

Add a comment recording WHY the option exists:

```ts
// `includeOptions: false` is for the blind-solver arm. In production
// `showOptions` defaults to false (cloze-exercise.tsx) — options sit behind a
// toggle — and the ambiguity fixture was labelled under that rule. A solver
// shown options would answer a different question than the labels encode.
```

Leave every other exercise type's branch untouched.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- qa-sample.test.ts`
Expected: PASS, including all pre-existing tests in the file.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must be feat/validator-alternative-enumeration
git add packages/ai/src/qa-sample.ts packages/ai/src/qa-sample.test.ts
git commit -m "feat(ai): optional options-free learner view for a blind solver"
```

---

### Task 2: The verdict function

**Files:**
- Modify: `packages/ai/scripts/eval-validator-run.ts`
- Test: `packages/ai/scripts/eval-validator-run.test.ts`

**Interfaces:**
- Consumes: `QaProbe` from `@language-drill/ai` (fields `correct`, `correctConfidence`, `wrong`, `alt`, `ambiguous`, `ambiguityNote`).
- Produces: `blindSolverVerdict(probe: QaProbe, content: ClozeContent): { ambiguous: boolean; competitor: string | null }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { blindSolverVerdict } from "./eval-validator-run.js";

const probe = (over: Partial<QaProbe> = {}): QaProbe => ({
  correct: "de", correctConfidence: 0.9, wrong: "xx",
  alt: null, ambiguous: false, ambiguityNote: "", ...over,
});
const content = (over: Partial<ClozeContent> = {}): ClozeContent => ({
  type: ExerciseType.CLOZE, instructions: "i", sentence: "s ___ e",
  correctAnswer: "de", acceptableAnswers: [], ...over,
});

describe("blindSolverVerdict", () => {
  it("is not ambiguous when the solver crafted no alternative", () => {
    expect(blindSolverVerdict(probe({ alt: null }), content()).ambiguous).toBe(false);
  });

  it("is not ambiguous when the alt equals correctAnswer", () => {
    expect(blindSolverVerdict(probe({ alt: "de" }), content()).ambiguous).toBe(false);
  });

  it("is not ambiguous when the alt is enumerated in acceptableAnswers", () => {
    const r = blindSolverVerdict(probe({ alt: "para" }), content({ acceptableAnswers: ["para"] }));
    expect(r.ambiguous).toBe(false);
  });

  it("is ambiguous when the alt is unlisted, and names the competitor", () => {
    const r = blindSolverVerdict(probe({ alt: "para" }), content());
    expect(r.ambiguous).toBe(true);
    expect(r.competitor).toBe("para");
  });

  it("matches case- and whitespace-insensitively", () => {
    const r = blindSolverVerdict(probe({ alt: "  DE " }), content());
    expect(r.ambiguous).toBe(false);
  });

  it("ignores correctConfidence entirely", () => {
    // A very low confidence must NOT by itself produce an ambiguous verdict —
    // the spec forbids a tunable threshold.
    const r = blindSolverVerdict(probe({ alt: null, correctConfidence: 0.01 }), content());
    expect(r.ambiguous).toBe(false);
  });

  it("ignores the crafter's own ambiguous flag entirely", () => {
    const r = blindSolverVerdict(probe({ alt: null, ambiguous: true }), content());
    expect(r.ambiguous).toBe(false);
  });

  it("treats a missing acceptableAnswers as an empty list", () => {
    const c = content(); delete (c as { acceptableAnswers?: string[] }).acceptableAnswers;
    expect(blindSolverVerdict(probe({ alt: "para" }), c).ambiguous).toBe(true);
  });
});
```

The last two tests are the ones that matter most: they pin the spec's "no free
parameter" rule, which is otherwise easy to erode later.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @language-drill/ai test -- eval-validator-run.test.ts -t blindSolverVerdict`
Expected: FAIL — `blindSolverVerdict is not a function`.

- [ ] **Step 3: Implement**

```ts
/** Case/whitespace-insensitive membership — same contract as validate.ts's
 *  `listed`, duplicated here rather than exported because that one is module
 *  -private and this file is a script, not a consumer of that internal. */
function listedIn(needle: string, haystack: readonly string[]): boolean {
  const n = needle.trim().toLowerCase();
  return haystack.some((h) => h.trim().toLowerCase() === n);
}

/**
 * The blind solver's ambiguity verdict: a crafted alternative that is fully
 * correct on the visible sentence, and is NOT already enumerated, IS the
 * fixture's definition of an ambiguous item.
 *
 * Deliberately ignores `probe.correctConfidence` and `probe.ambiguous`. Both
 * are recorded in the per-case output as free observations, but letting either
 * decide the verdict would introduce a threshold fitted on the same 82 cases
 * this arm is measured against.
 */
export function blindSolverVerdict(
  probe: QaProbe,
  content: ClozeContent,
): { ambiguous: boolean; competitor: string | null } {
  const alt = probe.alt;
  if (alt === null || alt.trim() === "") {
    return { ambiguous: false, competitor: null };
  }
  const accepted = [content.correctAnswer, ...(content.acceptableAnswers ?? [])];
  if (listedIn(alt, accepted)) return { ambiguous: false, competitor: null };
  return { ambiguous: true, competitor: alt };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- eval-validator-run.test.ts`
Expected: PASS, all pre-existing harness tests included.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add packages/ai/scripts/eval-validator-run.ts packages/ai/scripts/eval-validator-run.test.ts
git commit -m "feat(ai): blind-solver ambiguity verdict, no tunable threshold"
```

---

### Task 3: The fifth arm

**Files:**
- Modify: `packages/ai/scripts/eval-validator-run.ts` (`ValidatorArm` ~195, `ARMS` ~230, `makeRealValidatorExecutor` ~388, the summary/report builder)
- Test: `packages/ai/scripts/eval-validator-run.test.ts`

**Interfaces:**
- Consumes: `blindSolverVerdict` (Task 2), `renderLearnerView(content, { includeOptions: false })` (Task 1), `craftProbeAnswers` from `@language-drill/ai`.
- Produces: `ValidatorArm` gains `kind: "validator" | "solver"`; `ARMS` gains a fifth entry named `blind-solver`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("ARMS — the blind-solver arm", () => {
  it("keeps the four validator arms unchanged and pinned", () => {
    const v = ARMS.filter((a) => a.kind === "validator");
    expect(v.map((a) => a.name)).toEqual(["baseline", "prompt-only", "model-only", "both"]);
    expect(v.find((a) => a.name === "baseline")?.modelOverride).toBe("claude-sonnet-4-6");
    expect(v.find((a) => a.name === "prompt-only")?.modelOverride).toBe("claude-sonnet-4-6");
    expect(v.find((a) => a.name === "model-only")?.modelOverride).toBeUndefined();
    expect(v.find((a) => a.name === "both")?.modelOverride).toBeUndefined();
  });

  it("adds exactly one solver arm, pinned to sonnet-5", () => {
    const s = ARMS.filter((a) => a.kind === "solver");
    expect(s).toHaveLength(1);
    expect(s[0].name).toBe("blind-solver");
    expect(s[0].modelOverride).toBe("claude-sonnet-5");
  });
});

describe("solver executor", () => {
  it("calls the crafter with an options-free learner view on sonnet-5", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "tool_use", name: "submit_probe_answers",
        input: { correct: "de", correctConfidence: 0.9, wrong: "x", alt: "para",
                 ambiguous: false, ambiguityNote: "" } }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: "tool_use",
    });
    const client = { messages: { create: mockCreate } } as unknown as Anthropic;
    const exec = makeRealValidatorExecutor(client);
    const c = clozeCaseWithOptions();   // fixture helper: options ["de","para","en"]
    const out = await exec({ case: c, arm: ARMS.find((a) => a.kind === "solver")!, signal: undefined });

    const req = mockCreate.mock.calls[0][0];
    expect(req.model).toBe("claude-sonnet-5");
    const userText = req.messages[0].content as string;
    expect(userText).not.toContain("Options:");
    expect(userText).toContain(c.content.instructions);
    expect(out.result.ambiguous).toBe(true);   // alt "para" is unlisted
  });

  it("does not call validateDraft for a solver arm", async () => {
    // validateDraft would build the VALIDATION tool; assert the request's tool
    // is the crafter's, which is how we know we took the solver branch.
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "tool_use", name: "submit_probe_answers",
        input: { correct: "de", correctConfidence: 0.9, wrong: "x", alt: null,
                 ambiguous: false, ambiguityNote: "" } }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: "tool_use",
    });
    const client = { messages: { create: mockCreate } } as unknown as Anthropic;
    await makeRealValidatorExecutor(client)({
      case: clozeCaseWithOptions(),
      arm: ARMS.find((a) => a.kind === "solver")!,
      signal: undefined,
    });
    expect(mockCreate.mock.calls[0][0].tools[0].name).toBe("submit_probe_answers");
  });
});
```

Write `clozeCaseWithOptions()` beside the file's existing case helpers, reusing
their shape — read them first rather than inventing a new one.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @language-drill/ai test -- eval-validator-run.test.ts`
Expected: FAIL — `kind` is not a property of `ValidatorArm`.

- [ ] **Step 3: Implement**

Add the discriminator, keeping `promptSource` required only for validator arms:

```ts
export type ValidatorArm =
  | {
      kind: "validator";
      name: string;
      modelOverride?: string;
      promptSource: "prior" | "current";
    }
  | {
      kind: "solver";
      name: string;
      modelOverride: string;   // required: never inherit the crafter's Opus default
    };
```

Add `kind: "validator"` to the four existing entries and append:

```ts
  // Blind: judges ambiguity from the learner view alone, never seeing
  // `correctAnswer`. Pinned to sonnet-5 to match the `both` arm, so the
  // variable under test is blind-vs-sighted and not capability.
  { kind: "solver", name: "blind-solver", modelOverride: "claude-sonnet-5" },
```

**First, widen the executor's result type — this is required, not optional.**
`ValidatorCaseExecutorResult.result` is currently `ValidationResult`
(`eval-validator-run.ts:379`), whose required fields include `qualityScore`,
`contextSpoilsAnswer`, `levelMatch`, `grammarPointMatch`, `culturalIssues`,
`coverage`, and `candidateFillers`. **A blind solver measures none of those.**
Filling them with neutral values would put unmeasured numbers into the per-case
record as though they had been observed — the same dishonesty the spec forbids
for `selfInconsistentRate`.

`computeArmMetrics` already consumes only the minimal `ArmMetricsResultInput`
(`{ ambiguous: boolean; flaggedReasons?: string[] }`, line 278), so widening
costs nothing downstream:

```ts
/** What a solver arm can honestly report: the ambiguity verdict and the
 *  observations that came free with the crafter call. It deliberately does NOT
 *  carry qualityScore/levelMatch/grammarPointMatch — a blind solver never
 *  judges those, and emitting neutral values would read as measurements. */
export type SolverCaseResult = {
  ambiguous: boolean;
  flaggedReasons?: string[];
  competitor: string | null;
  /** Recorded, never used in the verdict — see blindSolverVerdict. */
  correctConfidence: number;
  /** The crafter's own flag. Recorded, never used in the verdict. */
  crafterAmbiguous: boolean;
};

export type ValidatorCaseExecutorResult = {
  result: ValidationResult | SolverCaseResult;
  usage: ClaudeUsageBreakdown;
};
```

Then branch at the top of the returned function in `makeRealValidatorExecutor`:

```ts
    if (arm.kind === "solver") {
      const learnerView = renderLearnerView(c.content, { includeOptions: false });
      const { probe, usage } = await craftProbeAnswers(
        client,
        {
          learnerView,
          language: c.language,
          cefrLevel: c.cefrLevel,
          exerciseType: "cloze",
          model: arm.modelOverride,
        },
        signal,
      );
      const verdict = blindSolverVerdict(probe, c.content);
      return {
        result: {
          ambiguous: verdict.ambiguous,
          flaggedReasons: [],
          competitor: verdict.competitor,
          correctConfidence: probe.correctConfidence,
          crafterAmbiguous: probe.ambiguous,
        },
        usage,
      };
    }
```

Everything below this branch is the existing validator path, unchanged — the
early return also narrows `arm` to the validator variant, so `arm.promptSource`
still typechecks without a cast.

In the summary builder, report `selfInconsistentRate: null` for solver arms
rather than computing `0`, and render it as `n/a` in the markdown table.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- eval-validator-run.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the dry run lists five arms**

Run: `pnpm --filter @language-drill/ai eval:validator --dry-run`
Expected: five arms listed, the fifth showing `blind-solver` on `claude-sonnet-5`; zero Claude calls; the cost estimate rises to reflect 82 more calls.

- [ ] **Step 6: Commit**

```bash
git branch --show-current
git add packages/ai/scripts/eval-validator-run.ts packages/ai/scripts/eval-validator-run.test.ts
git commit -m "feat(ai): blind-solver arm — judge ambiguity without seeing the answer"
```

---

### Task 4: Per-arm checkpointing

**Files:**
- Modify: `packages/ai/scripts/eval-validator-run.ts` (`runValidatorEval`)
- Test: `packages/ai/scripts/eval-validator-run.test.ts`

**Why this is in scope:** the harness writes its summary only at completion. Two
long runs were killed mid-flight and lost their entire spend — nothing was
recoverable. A five-arm run is ~$11.50 and ~35 minutes, long enough that this
stops being hypothetical.

**Interfaces:**
- Produces: after each arm completes, `./eval-runs/validator-<runName>.partial.json` is written containing the arms finished so far.

- [ ] **Step 1: Write the failing test**

```ts
it("writes a partial checkpoint after each arm", async () => {
  const writes: Array<{ path: string; arms: number }> = [];
  const result = await runValidatorEval({
    executor: stubExecutor(),          // reuse the file's existing DI stub
    cases: twoCases(),
    arms: ARMS,
    runName: "chk",
    datasetName: "d",
    maxCostUsd: 100,
    onArmComplete: (path, run) => writes.push({ path, arms: run.arms.length }),
  });
  expect(writes.map((w) => w.arms)).toEqual([1, 2, 3, 4, 5]);
  expect(writes[0].path).toMatch(/validator-chk\.partial\.json$/);
  expect(result.arms).toHaveLength(5);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- eval-validator-run.test.ts -t checkpoint`
Expected: FAIL — `onArmComplete` is not a parameter.

- [ ] **Step 3: Implement**

Add an optional `onArmComplete?: (path: string, run: ValidatorRun) => void` to
`runValidatorEval`'s params. After each arm's results are collected, call it. In
`main`, pass a callback that writes the partial JSON with the same serializer the
final summary uses. Keep it optional so every existing test constructs
`runValidatorEval` unchanged.

Delete the partial file on successful completion, so a stale `.partial.json`
always means "this run did not finish".

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- eval-validator-run.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add packages/ai/scripts/eval-validator-run.ts packages/ai/scripts/eval-validator-run.test.ts
git commit -m "feat(ai): checkpoint each arm so a killed run keeps its spend"
```

---

### Task 5: Full gate

**Files:** none modified.

- [ ] **Step 1: Run the gate**

```bash
rm -rf infra/lambda/dist
pnpm lint
pnpm typecheck
./node_modules/.bin/turbo test --concurrency=1
```
Expected: lint 7/7, typecheck 13/13, tests 13/13. Do NOT use root `pnpm test` — it fails under parallel load in this repo for unrelated reasons.

- [ ] **Step 2: Confirm the dry run one more time**

Run: `pnpm --filter @language-drill/ai eval:validator --dry-run`
Expected: five arms, zero calls.

- [ ] **Step 3: Report and stop**

Report the gate results and the dry-run banner. **Do not run the harness against the live API, do not push, and do not touch any PR** — the controller owns the live run and the branch has open PRs.

---

## Post-implementation (controller, not the implementer)

The four validator arms' `prior` template no longer represents `main`: `#639`
changed the validator prompt to render `glossEn` and bumped
`VALIDATION_PROMPT_VERSION` past this branch's. **Rebase on `main` and re-run the
four validator arms before treating any five-arm comparison as current.** The
blind-solver arm is insulated — it uses the `qa-sample` prompt, which `#639` did
not touch.

Pre-registered success criterion: **recall meaningfully above 60.4% (32/53)
without false-flag rising above ~13.8% (4/29)**. One ambiguous case is 1.9pp;
40+/53 would be the first real signal in this investigation. A null result is
also informative and should be reported as such — it would move the hypothesis
from access to knowledge.
