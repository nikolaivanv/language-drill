/**
 * Unit tests for `eval-validator-run.ts` — the validator replay harness that
 * measures whether the candidateFillers scratchpad + model move (Tasks 1-6)
 * actually improved ambiguity detection, using the labelled fixture (Task 7).
 *
 * `computeArmMetrics` is the load-bearing pure function (Requirement: no
 * network calls, no Anthropic client) — its tests need no mocking at all.
 * The orchestration tests below inject a stub executor (mirrors
 * `eval-gen-run.test.ts`'s `GenCellArmExecutor` DI) so they never touch the
 * real Anthropic SDK either.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type Anthropic from "@anthropic-ai/sdk";

import { CefrLevel, ExerciseType, Language } from "@language-drill/shared";
import type { ClozeContent } from "@language-drill/shared";
import { getGrammarPoint } from "@language-drill/db";

import {
  VALIDATION_SYSTEM_PROMPT_TEMPLATE,
  VALIDATION_TOOL_NAME,
  type GenerationSpec,
} from "../src/index.js";
import { SELF_INCONSISTENT_REASON } from "../src/validate.js";

import {
  ARMS,
  PRIOR_TEMPLATE,
  blindSolverVerdict,
  computeArmMetrics,
  computeValidatorSummary,
  loadValidatorCases,
  makeRealValidatorExecutor,
  parseEvalValidatorArgs,
  renderValidatorMarkdownSummary,
  renderValidatorSystemPrompt,
  runValidatorEval,
  writeValidatorSummaryJson,
  type ValidatorAmbiguityCase,
  type ValidatorArm,
  type ValidatorCaseExecutor,
  type ValidatorEvalRunResult,
} from "./eval-validator-run.js";
import type { QaProbe } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(
  __dirname,
  "fixtures",
  "validator-ambiguity-cases.json",
);

// ---------------------------------------------------------------------------
// computeArmMetrics — pure, no mocking (brief Step 1)
// ---------------------------------------------------------------------------

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

  it("returns 0 (not NaN) for a wholly empty run", () => {
    const m = computeArmMetrics([], []);
    expect(m).toEqual({
      recallOnAmbiguous: 0,
      falseFlagRateOnClean: 0,
      selfInconsistentRate: 0,
      n: 0,
    });
  });

  it("computes selfInconsistentRate over ALL results, not just one bucket", () => {
    const m = computeArmMetrics(
      [{ label: "ambiguous" }, { label: "clean" }, { label: "clean" }],
      [
        { ambiguous: true },
        { ambiguous: false, flaggedReasons: [SELF_INCONSISTENT_REASON] },
        { ambiguous: false, flaggedReasons: ["some-other-reason"] },
      ],
    );
    expect(m.selfInconsistentRate).toBeCloseTo(1 / 3);
  });

  it("treats a missing flaggedReasons as not self-inconsistent", () => {
    const m = computeArmMetrics(
      [{ label: "clean" }],
      [{ ambiguous: false }],
    );
    expect(m.selfInconsistentRate).toBe(0);
  });

  it("reports n as the number of paired results", () => {
    const m = computeArmMetrics(
      [{ label: "ambiguous" }, { label: "clean" }],
      [{ ambiguous: true }, { ambiguous: false }],
    );
    expect(m.n).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// blindSolverVerdict — pure, no mocking (Task 2)
// ---------------------------------------------------------------------------

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

  it("treats empty-string alt as no alternative", () => {
    const r = blindSolverVerdict(probe({ alt: "" }), content());
    expect(r.ambiguous).toBe(false);
    expect(r.competitor).toBeNull();
  });

  it("correctConfidence does not affect the verdict when an alt is present and listed", () => {
    // Low confidence with alt=listed must stay false; catches wiring
    // correctConfidence into the alt-present branch.
    const r = blindSolverVerdict(
      probe({ alt: "de", correctConfidence: 0.01 }),
      content(),
    );
    expect(r.ambiguous).toBe(false);
  });

  it("correctConfidence does not affect the verdict when an alt is present and unlisted", () => {
    // Low confidence with alt=unlisted must stay true; catches wiring
    // correctConfidence to suppress an ambiguity flag.
    const r = blindSolverVerdict(
      probe({ alt: "para", correctConfidence: 0.01 }),
      content(),
    );
    expect(r.ambiguous).toBe(true);
  });

  it("probe.ambiguous does not affect the verdict when an alt is present and listed", () => {
    // probe.ambiguous=true with alt=listed must stay false; catches wiring
    // the crafter's own flag into the decision.
    const r = blindSolverVerdict(
      probe({ alt: "de", ambiguous: true }),
      content(),
    );
    expect(r.ambiguous).toBe(false);
  });

  it("probe.ambiguous does not affect the verdict when an alt is present and unlisted", () => {
    // probe.ambiguous=false with alt=unlisted must stay true; catches wiring
    // the crafter's own flag to override the verdict.
    const r = blindSolverVerdict(
      probe({ alt: "para", ambiguous: false }),
      content(),
    );
    expect(r.ambiguous).toBe(true);
  });

  it("treats a missing acceptableAnswers as an empty list", () => {
    const c = content(); delete (c as { acceptableAnswers?: string[] }).acceptableAnswers;
    expect(blindSolverVerdict(probe({ alt: "para" }), c).ambiguous).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadValidatorCases — the real fixture must parse cleanly
// ---------------------------------------------------------------------------

describe("loadValidatorCases", () => {
  // Deliberately NOT pinned to an absolute count: the fixture is a measurement
  // instrument that is expected to grow (it went 31 -> 82 when the first run
  // proved underpowered at 1 case = 5-9pp). Pin the invariants that must hold
  // at any size — cloze-only, both buckets populated, and every case parsed —
  // so widening the fixture never requires editing this test.
  it("parses the real fixture into cloze-only cases with both buckets populated", () => {
    const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as unknown[];
    const cases = loadValidatorCases(readFileSync(FIXTURE_PATH, "utf8"));
    expect(cases).toHaveLength(raw.length); // nothing silently dropped
    expect(cases.every((c) => c.content.type === "cloze")).toBe(true);
    expect(
      cases.filter((c) => c.label === "ambiguous").length,
    ).toBeGreaterThan(0);
    expect(cases.filter((c) => c.label === "clean").length).toBeGreaterThan(0);
    expect(
      cases.filter((c) => c.label === "ambiguous").length +
        cases.filter((c) => c.label === "clean").length,
    ).toBe(cases.length); // no third label
  });

  it("normalizes the fixture's lowercase language to the uppercase enum", () => {
    const cases = loadValidatorCases(readFileSync(FIXTURE_PATH, "utf8"));
    expect(cases.every((c) => c.language === c.language.toUpperCase())).toBe(
      true,
    );
    expect(cases.some((c) => c.language === Language.ES)).toBe(true);
  });

  it("throws (file-level) on non-JSON input", () => {
    expect(() => loadValidatorCases("not json")).toThrow(/not valid JSON/);
  });

  it("throws when the top-level value is not an array", () => {
    expect(() => loadValidatorCases("{}")).toThrow(/must be a JSON array/);
  });

  it("throws on a non-cloze content type (cloze-only harness)", () => {
    const raw = JSON.stringify([
      {
        id: "x",
        label: "clean",
        language: "es",
        cefrLevel: "B1",
        grammarPointKey: "es-b1-nominalizers",
        content: { type: "translation" },
      },
    ]);
    expect(() => loadValidatorCases(raw)).toThrow(/must be "cloze"/);
  });

  it("throws on an invalid label", () => {
    const raw = JSON.stringify([
      {
        id: "x",
        label: "maybe",
        language: "es",
        cefrLevel: "B1",
        grammarPointKey: "es-b1-nominalizers",
        content: { type: "cloze" },
      },
    ]);
    expect(() => loadValidatorCases(raw)).toThrow(/label must be/);
  });
});

// ---------------------------------------------------------------------------
// ARMS — the four-arm matrix must never confound prompt and model
// ---------------------------------------------------------------------------

describe("ARMS", () => {
  it("declares exactly the four documented validator arms plus the blind-solver arm", () => {
    expect(ARMS.map((a) => a.name)).toEqual([
      "baseline",
      "prompt-only",
      "model-only",
      "both",
      "blind-solver",
    ]);
  });

  it("pins both baseline arms to claude-sonnet-4-6 explicitly", () => {
    const baseline = ARMS.find((a) => a.name === "baseline")!;
    const promptOnly = ARMS.find((a) => a.name === "prompt-only")!;
    expect(baseline.modelOverride).toBe("claude-sonnet-4-6");
    expect(promptOnly.modelOverride).toBe("claude-sonnet-4-6");
  });

  it("leaves model-only and both on the production default model", () => {
    const modelOnly = ARMS.find((a) => a.name === "model-only")!;
    const both = ARMS.find((a) => a.name === "both")!;
    expect(modelOnly.modelOverride).toBeUndefined();
    expect(both.modelOverride).toBeUndefined();
  });

  /** Narrow a lookup to the validator variant — `promptSource` only exists
   *  there. Throws (rather than returning `undefined`) if the name isn't
   *  found or isn't a validator arm, so a typo fails loud in the test itself. */
  function findValidatorArm(name: string): Extract<ValidatorArm, { kind: "validator" }> {
    const arm = ARMS.find((a) => a.name === name);
    if (!arm || arm.kind !== "validator") {
      throw new Error(`expected a validator arm named '${name}'`);
    }
    return arm;
  }

  it("sources baseline and model-only from the pre-Task-4 (prior) template", () => {
    expect(findValidatorArm("baseline").promptSource).toBe("prior");
    expect(findValidatorArm("model-only").promptSource).toBe("prior");
  });

  it("sources prompt-only and both from the current (post-Task-4) template", () => {
    expect(findValidatorArm("prompt-only").promptSource).toBe("current");
    expect(findValidatorArm("both").promptSource).toBe("current");
  });

  it("every validator arm declares a promptSource — none is left to fall through to a network fetch", () => {
    // The bug this guards: a validator arm with `promptSource` unset (or an
    // optional `systemPromptOverride` left undefined) would fall through to
    // `buildValidationSystemPrompt` -> Langfuse. Every validator arm must
    // always resolve to an in-repo source. The blind-solver arm never calls
    // `validateDraft` at all, so it has no `promptSource` by design (see the
    // "ARMS — the blind-solver arm" describe block below).
    for (const arm of ARMS.filter((a) => a.kind === "validator")) {
      expect(["prior", "current"]).toContain(arm.promptSource);
    }
  });

  it("PRIOR_TEMPLATE is read from the committed fixture, not git", () => {
    const expected = readFileSync(
      path.join(__dirname, "fixtures", "validation-system-prompt-baseline.txt"),
      "utf8",
    );
    expect(PRIOR_TEMPLATE).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// ARMS — the blind-solver arm (Task 3)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// parseEvalValidatorArgs
// ---------------------------------------------------------------------------

describe("parseEvalValidatorArgs", () => {
  it("defaults to no limit, a sane max-cost-usd, and dryRun=false", () => {
    const args = parseEvalValidatorArgs([]);
    expect(args.limit).toBeUndefined();
    expect(args.dryRun).toBe(false);
    expect(args.maxCostUsd).toBeGreaterThan(0);
    expect(args.runName).toBeUndefined();
  });

  it("parses --limit, --max-cost-usd, --dry-run, --run-name", () => {
    const args = parseEvalValidatorArgs([
      "--limit",
      "5",
      "--max-cost-usd",
      "1.5",
      "--dry-run",
      "--run-name",
      "smoke",
    ]);
    expect(args.limit).toBe(5);
    expect(args.maxCostUsd).toBe(1.5);
    expect(args.dryRun).toBe(true);
    expect(args.runName).toBe("smoke");
  });

  it("rejects a non-positive --limit", () => {
    expect(() => parseEvalValidatorArgs(["--limit", "0"])).toThrow(
      /--limit must be a positive integer/,
    );
  });

  it("rejects a non-positive --max-cost-usd", () => {
    expect(() => parseEvalValidatorArgs(["--max-cost-usd", "0"])).toThrow(
      /--max-cost-usd must be a positive number/,
    );
  });
});

// ---------------------------------------------------------------------------
// runValidatorEval — orchestration, DI'd executor (no live Claude)
// ---------------------------------------------------------------------------

function makeCase(
  id: string,
  label: "ambiguous" | "clean",
  grammarPointKey = "es-b1-nominalizers",
): ValidatorAmbiguityCase {
  return {
    id,
    label,
    provenance: "test fixture",
    language: Language.ES,
    cefrLevel: CefrLevel.B1,
    grammarPointKey,
    content: {
      type: ExerciseType.CLOZE,
      instructions: "Completa la frase.",
      sentence: "___ es la respuesta.",
      correctAnswer: "esta",
      acceptableAnswers: [],
    },
    why: "test",
  };
}

/** A cloze case whose content carries `options` — the blind-solver arm must
 *  render the learner view WITHOUT them (`includeOptions: false`); options
 *  sit behind a toggle in production and the ambiguity fixture was labelled
 *  under that rule (see `renderLearnerView`'s docstring). */
function clozeCaseWithOptions(): ValidatorAmbiguityCase {
  return {
    id: "solver-options-1",
    label: "clean",
    provenance: "test fixture",
    language: Language.ES,
    cefrLevel: CefrLevel.B1,
    grammarPointKey: "es-b1-nominalizers",
    content: {
      type: ExerciseType.CLOZE,
      instructions: "Completa la frase.",
      sentence: "Voy ___ casa.",
      correctAnswer: "de",
      acceptableAnswers: [],
      options: ["de", "para", "en"],
    },
    why: "test",
  };
}

const cleanResult = () => ({
  qualityScore: 0.9,
  ambiguous: false,
  contextSpoilsAnswer: false,
  levelMatch: true,
  grammarPointMatch: true,
  culturalIssues: [],
  flaggedReasons: [],
  coverage: {},
  candidateFillers: [],
});

// ---------------------------------------------------------------------------
// Fix Round 1 regression — the harness's prompt source must ALWAYS be
// in-repo and must NEVER depend on Langfuse being reachable/unreachable.
//
// The bug: `prompt-only`/`both` passed no `systemPromptOverride`, so
// `validateDraft` called `buildValidationSystemPrompt(spec)`, which fetches
// from Langfuse (label `production`). When that fetch SUCCEEDS but
// `production` still holds the pre-Task-4 body (a deliberately-deferred
// post-merge step — see CLAUDE.md "Prompt Editing"), those two arms would
// silently run the OLD prompt, producing a false negative on the exact
// question this harness exists to answer. A test that only checks the ARMS
// table (as Fix Round 0's did) cannot catch this — the table looked correct;
// the bug was in `makeRealValidatorExecutor` reaching a network branch at
// all. These tests exercise the REAL executor end-to-end against a mocked
// Anthropic client and assert on the literal `system` text it sent.
// ---------------------------------------------------------------------------

const regressionGrammarPoint = getGrammarPoint("es-b1-nominalizers");
if (!regressionGrammarPoint) {
  throw new Error(
    "test fixture missing: curriculum entry 'es-b1-nominalizers'",
  );
}

const regressionSpec: GenerationSpec = {
  language: Language.ES,
  cefrLevel: CefrLevel.B1,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint: regressionGrammarPoint,
  topicDomain: null,
  count: 1,
  batchSeed: "test",
};

/** A mocked Anthropic client whose `messages.create` never leaves the
 *  process — proves the executor makes exactly one call (to this mock), with
 *  no separate network path to Langfuse. */
function makeMockAnthropicClient(): {
  mockCreate: ReturnType<typeof vi.fn>;
  client: Anthropic;
} {
  const mockCreate = vi.fn().mockResolvedValue({
    content: [
      {
        type: "tool_use",
        id: "toolu_regression_1",
        name: VALIDATION_TOOL_NAME,
        input: cleanResult(),
      },
    ],
    stop_reason: "tool_use",
    usage: {
      input_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 5,
    },
  });
  return {
    mockCreate,
    client: { messages: { create: mockCreate } } as unknown as Anthropic,
  };
}

describe("prompt source — always in-repo, never Langfuse (Fix Round 1)", () => {
  // Validator arms only — the blind-solver arm never calls `validateDraft`
  // or renders a system-prompt template (see "ARMS — the blind-solver arm").
  for (const arm of ARMS.filter((a) => a.kind === "validator")) {
    it(`arm '${arm.name}' sends the LOCALLY rendered '${arm.promptSource}' template as the system prompt`, async () => {
      const { mockCreate, client } = makeMockAnthropicClient();
      const executor = makeRealValidatorExecutor(client);
      const testCase = makeCase(
        `regression-${arm.name}`,
        "clean",
        regressionGrammarPoint!.key,
      );

      await executor({ case: testCase, arm });

      expect(mockCreate).toHaveBeenCalledOnce();
      const callArgs = mockCreate.mock.calls[0][0];
      const expectedText = renderValidatorSystemPrompt(
        arm.promptSource === "prior"
          ? PRIOR_TEMPLATE
          : VALIDATION_SYSTEM_PROMPT_TEMPLATE,
        regressionSpec,
      );
      expect(callArgs.system[0].text).toBe(expectedText);
    });
  }

  it("the 'current' template's rendered text contains the Task-4 candidateFillers instruction; 'prior' does not", () => {
    // Byte-level proof the two templates actually differ on the thing this
    // whole branch exists to test — if this assertion ever fails, the two
    // template sources have drifted into being identical and the harness
    // would report a zero effect by construction, independent of the
    // Langfuse bug this suite otherwise guards against.
    const priorText = renderValidatorSystemPrompt(PRIOR_TEMPLATE, regressionSpec);
    const currentText = renderValidatorSystemPrompt(
      VALIDATION_SYSTEM_PROMPT_TEMPLATE,
      regressionSpec,
    );
    expect(priorText).not.toContain("candidateFillers");
    expect(currentText).toContain("candidateFillers");
  });
});

describe("prompt source is independent of Langfuse env vars (the exact Fix Round 1 bug)", () => {
  const originalPublicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const originalSecretKey = process.env.LANGFUSE_SECRET_KEY;

  afterEach(() => {
    if (originalPublicKey === undefined) delete process.env.LANGFUSE_PUBLIC_KEY;
    else process.env.LANGFUSE_PUBLIC_KEY = originalPublicKey;
    if (originalSecretKey === undefined) delete process.env.LANGFUSE_SECRET_KEY;
    else process.env.LANGFUSE_SECRET_KEY = originalSecretKey;
  });

  it("prompt-only still sends the LOCAL current-template text even with both Langfuse keys present", async () => {
    // This is the exact scenario that produced the false negative: keys
    // present -> `getLangfuse()` returns a real client -> a fetch COULD
    // succeed. The executor must never give that fetch a chance to run.
    process.env.LANGFUSE_PUBLIC_KEY = "dummy-public-key";
    process.env.LANGFUSE_SECRET_KEY = "dummy-secret-key";

    const { mockCreate, client } = makeMockAnthropicClient();
    const executor = makeRealValidatorExecutor(client);
    const arm = ARMS.find((a) => a.name === "prompt-only")!;
    const testCase = makeCase(
      "regression-langfuse-present",
      "clean",
      regressionGrammarPoint!.key,
    );

    await executor({ case: testCase, arm });

    // Exactly one call was made, and it went to our mocked Anthropic client
    // — never to a Langfuse SDK call. Its text is the byte-identical LOCAL
    // render of the current template, carrying the candidateFillers
    // instruction — not whatever Langfuse's `production` label happens to
    // hold.
    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system[0].text).toContain("candidateFillers");
    expect(callArgs.system[0].text).toBe(
      renderValidatorSystemPrompt(VALIDATION_SYSTEM_PROMPT_TEMPLATE, regressionSpec),
    );
  });

  it("baseline still sends the LOCAL prior-template text (without candidateFillers) even with both Langfuse keys present", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "dummy-public-key";
    process.env.LANGFUSE_SECRET_KEY = "dummy-secret-key";

    const { mockCreate, client } = makeMockAnthropicClient();
    const executor = makeRealValidatorExecutor(client);
    const arm = ARMS.find((a) => a.name === "baseline")!;
    const testCase = makeCase(
      "regression-langfuse-present-baseline",
      "clean",
      regressionGrammarPoint!.key,
    );

    await executor({ case: testCase, arm });

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system[0].text).not.toContain("candidateFillers");
    expect(callArgs.system[0].text).toBe(
      renderValidatorSystemPrompt(PRIOR_TEMPLATE, regressionSpec),
    );
  });
});

describe("runValidatorEval", () => {
  const arms = ARMS;

  it("runs every case against every arm and pairs results for metrics", async () => {
    const cases = [makeCase("c1", "ambiguous"), makeCase("c2", "clean")];
    const executor: ValidatorCaseExecutor = vi.fn(async () => ({
      result: cleanResult(),
      usage: {
        inputTokens: 100,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 50,
      },
    }));

    const result = await runValidatorEval({
      executor,
      cases,
      arms,
      runName: "test-run",
      datasetName: "test.json",
    });

    // 2 cases x arms.length (currently 5: 4 validator + 1 solver) — not
    // hardcoded, since `arms` is the real exported `ARMS` and this test is
    // about the orchestrator's generic loop, not any one arm's identity.
    expect(executor).toHaveBeenCalledTimes(cases.length * arms.length);
    expect(result.arms).toHaveLength(arms.length);
    for (const arm of result.arms) {
      expect(arm.records).toHaveLength(2);
      expect(arm.records.every((r) => r.result !== undefined)).toBe(true);
    }
    expect(result.costCapped).toBe(false);
  });

  it("isolates a per-(case,arm) executor throw; other pairs still complete", async () => {
    const cases = [makeCase("c1", "ambiguous"), makeCase("c2", "clean")];
    const executor: ValidatorCaseExecutor = vi.fn(async ({ case: c, arm }) => {
      if (c.id === "c1" && arm.name === "baseline") {
        throw new Error("boom");
      }
      return {
        result: cleanResult(),
        usage: {
          inputTokens: 10,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          outputTokens: 5,
        },
      };
    });

    const result = await runValidatorEval({
      executor,
      cases,
      arms,
      runName: "test-run",
      datasetName: "test.json",
    });

    const baseline = result.arms.find((a) => a.arm.name === "baseline")!;
    const c1Record = baseline.records.find((r) => r.caseId === "c1")!;
    expect(c1Record.error).toMatch(/boom/);
    expect(c1Record.result).toBeUndefined();
    // The other arm x case pairs are unaffected.
    expect(
      result.arms
        .flatMap((a) => a.records)
        .filter((r) => r.error !== undefined),
    ).toHaveLength(1);
  });

  it("stops at a case boundary once --max-cost-usd is reached", async () => {
    // Each (case, arm) call bills 100k output tokens = $1.50.
    const cases = [
      makeCase("c1", "ambiguous"),
      makeCase("c2", "clean"),
      makeCase("c3", "clean"),
    ];
    const executor: ValidatorCaseExecutor = vi.fn(async () => ({
      result: cleanResult(),
      usage: {
        inputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 100_000,
      },
    }));

    const result = await runValidatorEval({
      executor,
      cases,
      arms, // arms.length arms (real ARMS)
      runName: "test-run",
      datasetName: "test.json",
      // Trips after 1 full case: arms.length x $1.50 >= $5 (true for any
      // arms.length >= 4, so this holds regardless of ARMS growing).
      maxCostUsd: 5,
    });

    expect(result.costCapped).toBe(true);
    // Exactly one case fully attempted across every arm before stopping.
    expect(executor).toHaveBeenCalledTimes(arms.length);
    for (const arm of result.arms) {
      expect(arm.records).toHaveLength(1);
    }
  });

  it("writes partial results rather than discarding the run when cost-capped", async () => {
    const cases = [makeCase("c1", "ambiguous"), makeCase("c2", "clean")];
    const executor: ValidatorCaseExecutor = vi.fn(async () => ({
      result: cleanResult(),
      usage: {
        inputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 100_000,
      },
    }));

    const result: ValidatorEvalRunResult = await runValidatorEval({
      executor,
      cases,
      arms,
      runName: "test-run",
      datasetName: "test.json",
      // Trips after case 1 (arms.length x $1.50 >= $3), before case 2.
      maxCostUsd: 3,
    });

    expect(result.costCapped).toBe(true);
    // Case 1's results are preserved, not discarded, even though the run capped.
    expect(executor).toHaveBeenCalledTimes(arms.length);
    expect(result.arms).toHaveLength(arms.length);
    expect(result.arms.every((a) => a.records.length === 1)).toBe(true);
    expect(result.arms.every((a) => a.records[0].caseId === "c1")).toBe(true);
  });

  it("invokes onCaseComplete once per case, at the SAME boundary the cost cap breaks at, with every arm balanced", async () => {
    const cases = [makeCase("c1", "ambiguous"), makeCase("c2", "clean")];
    const executor: ValidatorCaseExecutor = vi.fn(async () => ({
      result: cleanResult(),
      usage: {
        inputTokens: 10,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 5,
      },
    }));

    const calls: Array<{ path: string; recordCounts: number[] }> = [];
    const result = await runValidatorEval({
      executor,
      cases,
      arms,
      runName: "chk",
      datasetName: "test.json",
      onCaseComplete: (partialPath, run) => {
        calls.push({
          path: partialPath,
          recordCounts: run.arms.map((a) => a.records.length),
        });
      },
    });

    // Fires once per case — the SAME boundary the case-boundary cost cap
    // (tested above) already breaks at, not once per (case, arm) pair.
    expect(calls).toHaveLength(cases.length);
    // Every checkpoint targets the SAME path, derived from runName — never
    // the final (non-partial) summary path.
    expect(calls.every((c) => c.path === calls[0].path)).toBe(true);
    expect(calls[0].path).toMatch(/validator-chk\.partial\.json$/);
    // The load-bearing property: at the FIRST checkpoint (after case 1),
    // every arm has exactly ONE record — never a mix of 1 and 0. A bare
    // call-count assertion would also pass if the hook still fired inside
    // the inner loop and someone divided the count by arms.length; this
    // pins that every arm actually saw the same cases at every checkpoint.
    expect(calls[0].recordCounts).toEqual(arms.map(() => 1));
    // By the final checkpoint (after case 2), every arm has both cases.
    expect(calls.at(-1)!.recordCounts).toEqual(arms.map(() => cases.length));
    expect(result.arms).toHaveLength(arms.length);
  });

  it("never calls onCaseComplete when it is omitted (optional hook)", async () => {
    const cases = [makeCase("c1", "ambiguous")];
    const executor: ValidatorCaseExecutor = vi.fn(async () => ({
      result: cleanResult(),
      usage: {
        inputTokens: 10,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 5,
      },
    }));

    // No onCaseComplete passed — existing call sites must keep compiling and
    // behaving exactly as before.
    const result = await runValidatorEval({
      executor,
      cases,
      arms,
      runName: "test-run",
      datasetName: "test.json",
    });

    expect(result.arms).toHaveLength(arms.length);
  });
});

// ---------------------------------------------------------------------------
// computeValidatorSummary + rendering (pure roll-up)
// ---------------------------------------------------------------------------

describe("computeValidatorSummary", () => {
  it("rolls per-arm records into metrics + cost, keyed by arm name", () => {
    const cases = [makeCase("c1", "ambiguous"), makeCase("c2", "clean")];
    const run: ValidatorEvalRunResult = {
      runName: "r1",
      datasetName: "test.json",
      startedAt: "2026-01-01T00:00:00.000Z",
      caseCount: 2,
      costCapped: false,
      arms: [
        {
          arm: ARMS[0],
          usage: {
            inputTokens: 100,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            outputTokens: 50,
          },
          records: [
            { caseId: "c1", label: "ambiguous", result: { ...cleanResult(), ambiguous: true } },
            { caseId: "c2", label: "clean", result: cleanResult() },
          ],
        },
      ],
    };

    const summary = computeValidatorSummary(run, cases);
    expect(summary.arms).toHaveLength(1);
    expect(summary.arms[0].arm).toBe("baseline");
    expect(summary.arms[0].metrics.recallOnAmbiguous).toBe(1);
    expect(summary.arms[0].metrics.falseFlagRateOnClean).toBe(0);
    expect(summary.arms[0].costUsd).toBeGreaterThan(0);
    expect(summary.arms[0].errors).toHaveLength(0);
  });

  it("surfaces per-case errors on the owning arm", () => {
    const cases = [makeCase("c1", "ambiguous")];
    const run: ValidatorEvalRunResult = {
      runName: "r1",
      datasetName: "test.json",
      startedAt: "2026-01-01T00:00:00.000Z",
      caseCount: 1,
      costCapped: false,
      arms: [
        {
          arm: ARMS[0],
          usage: {
            inputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            outputTokens: 0,
          },
          records: [{ caseId: "c1", label: "ambiguous", error: "boom" }],
        },
      ],
    };

    const summary = computeValidatorSummary(run, cases);
    expect(summary.arms[0].errors).toEqual([{ caseId: "c1", error: "boom" }]);
    expect(summary.arms[0].metrics.n).toBe(0);
  });

  it("reports the solver arm's selfInconsistentRate as null (not 0) while a validator arm in the same summary still reports a number", () => {
    // `flaggedReasons: []` is what the real solver executor always emits
    // (SolverCaseResult never populates it) — if computeValidatorSummary
    // regressed to running the solver arm's metrics through unmodified, this
    // would compute `0`, not `null`, and the assertion below (`toBe(null)`,
    // not a falsy check) would catch it.
    const cases = [makeCase("c1", "ambiguous"), makeCase("c2", "clean")];
    const validatorArm = ARMS[0]; // baseline
    const solverArm = ARMS.find((a) => a.kind === "solver")!;
    const zeroUsage = {
      inputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 0,
    };
    const run: ValidatorEvalRunResult = {
      runName: "r1",
      datasetName: "test.json",
      startedAt: "2026-01-01T00:00:00.000Z",
      caseCount: 2,
      costCapped: false,
      arms: [
        {
          arm: validatorArm,
          usage: zeroUsage,
          records: [
            { caseId: "c1", label: "ambiguous", result: cleanResult() },
            { caseId: "c2", label: "clean", result: cleanResult() },
          ],
        },
        {
          arm: solverArm,
          usage: zeroUsage,
          records: [
            {
              caseId: "c1",
              label: "ambiguous",
              result: {
                ambiguous: true,
                flaggedReasons: [],
                competitor: "para",
                correctConfidence: 0.9,
                crafterAmbiguous: false,
              },
            },
            {
              caseId: "c2",
              label: "clean",
              result: {
                ambiguous: false,
                flaggedReasons: [],
                competitor: null,
                correctConfidence: 0.95,
                crafterAmbiguous: false,
              },
            },
          ],
        },
      ],
    };

    const summary = computeValidatorSummary(run, cases);
    const validatorSummary = summary.arms.find((a) => a.arm === validatorArm.name)!;
    const solverSummary = summary.arms.find((a) => a.arm === "blind-solver")!;

    expect(solverSummary.metrics.selfInconsistentRate).toBe(null);
    expect(solverSummary.promptSource).toBeUndefined();
    expect(solverSummary.templateSha).toBeUndefined();
    // The solver arm's ambiguity verdict WAS measured — recall/false-flag are
    // still real numbers, only selfInconsistentRate is unmeasured.
    expect(solverSummary.metrics.recallOnAmbiguous).toBe(1);
    expect(solverSummary.metrics.falseFlagRateOnClean).toBe(0);
    // Pins the distinction: a validator arm's selfInconsistentRate is a real
    // (measured) number, never null.
    expect(validatorSummary.metrics.selfInconsistentRate).not.toBeNull();
    expect(typeof validatorSummary.metrics.selfInconsistentRate).toBe("number");
  });
});

describe("renderValidatorMarkdownSummary", () => {
  it("renders a table row per arm with no throw", () => {
    const cases = [makeCase("c1", "ambiguous")];
    const run: ValidatorEvalRunResult = {
      runName: "r1",
      datasetName: "test.json",
      startedAt: "2026-01-01T00:00:00.000Z",
      caseCount: 1,
      costCapped: false,
      arms: [
        {
          arm: ARMS[0],
          usage: {
            inputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            outputTokens: 0,
          },
          records: [{ caseId: "c1", label: "ambiguous", result: cleanResult() }],
        },
      ],
    };
    const summary = computeValidatorSummary(run, cases);
    const md = renderValidatorMarkdownSummary(summary);
    expect(md).toContain("baseline");
    expect(md).toContain("r1");
  });

  it("renders 'n/a' (not a numeric percentage) for the solver arm's prompt-source/template/self-inconsistent cells", () => {
    const cases = [makeCase("c1", "ambiguous")];
    const solverArm = ARMS.find((a) => a.kind === "solver")!;
    const run: ValidatorEvalRunResult = {
      runName: "r1",
      datasetName: "test.json",
      startedAt: "2026-01-01T00:00:00.000Z",
      caseCount: 1,
      costCapped: false,
      arms: [
        {
          arm: solverArm,
          usage: {
            inputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            outputTokens: 0,
          },
          records: [
            {
              caseId: "c1",
              label: "ambiguous",
              result: {
                ambiguous: true,
                flaggedReasons: [],
                competitor: "para",
                correctConfidence: 0.9,
                crafterAmbiguous: false,
              },
            },
          ],
        },
      ],
    };

    const summary = computeValidatorSummary(run, cases);
    const md = renderValidatorMarkdownSummary(summary);
    const row = md.split("\n").find((l) => l.startsWith("| blind-solver "));
    expect(row).toBeDefined();
    // Columns: Arm | Model | Prompt source | Template sha | Recall |
    //          False-flag | Self-inconsistent | n | Cost
    const cells = row!
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    expect(cells[2]).toBe("n/a (blind)"); // prompt source
    expect(cells[3]).toBe("n/a"); // template sha
    expect(cells[6]).toBe("n/a"); // self-inconsistent — NOT "0.0%"
    // Recall WAS measured for the solver arm (unlike self-inconsistent), so
    // that column is still a real percentage, not "n/a".
    expect(cells[4]).toBe("100.0%");
  });
});

describe("writeValidatorSummaryJson", () => {
  it("names the file validator-<runName>.json", () => {
    const cases = [makeCase("c1", "ambiguous")];
    const run: ValidatorEvalRunResult = {
      runName: "smoke-test-xyz",
      datasetName: "test.json",
      startedAt: "2026-01-01T00:00:00.000Z",
      caseCount: 1,
      costCapped: false,
      arms: [
        {
          arm: ARMS[0],
          usage: {
            inputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            outputTokens: 0,
          },
          records: [],
        },
      ],
    };
    const summary = computeValidatorSummary(run, cases);
    const outDir = mkdtempSync(path.join(os.tmpdir(), "eval-validator-test-"));
    const written = writeValidatorSummaryJson(summary, outDir);
    expect(written).toMatch(/validator-smoke-test-xyz\.json$/);
    const contents = JSON.parse(readFileSync(written, "utf8"));
    expect(contents.runName).toBe("smoke-test-xyz");
  });
});
