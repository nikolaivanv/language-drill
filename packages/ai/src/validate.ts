/**
 * packages/ai — Validator core (Phase 3).
 *
 * The static surface of the validator: model constants, the tool schema, and
 * the public types `ValidationResult` and `ValidateDraftResult`.
 * `parseValidationResult` lands in Task 7; `validateDraft` lands in Task 8.
 *
 * Mirrors `evaluate.ts` structurally — same `Anthropic.Tool` shape, same
 * `tool_choice` form, same cached `system` block, same per-model request
 * shaping for sampling params and thinking. As of 2026-08-11 the model is
 * deliberately DECOUPLED from `GENERATION_MODEL` (see `VALIDATION_MODEL`'s
 * doc comment below) — the old three-way generator/validator/evaluator pin
 * asserted in `validate.test.ts` no longer holds.
 */

import type Anthropic from "@anthropic-ai/sdk";

import {
  COVERAGE_AXIS_VALUES,
  ExerciseType,
  type CoverageAxis,
  type CoverageTags,
} from "@language-drill/shared";

import type { ClaudeUsageBreakdown } from "./cost-model.js";
import {
  TOOL_NAME_BY_TYPE,
  type ExerciseDraft,
  type GenerationSpec,
} from "./generate.js";
import {
  buildValidationSystemPrompt,
  buildValidationUserPrompt,
} from "./validation-prompts.js";
import {
  buildDictationValidationSystemPrompt,
  buildDictationValidationUserPrompt,
} from "./dictation-validation-prompts.js";
import {
  buildFreeWritingValidationSystemPrompt,
  buildFreeWritingValidationUserPrompt,
} from "./free-writing-validation-prompts.js";

// ---------------------------------------------------------------------------
// Model + sampling constants
// ---------------------------------------------------------------------------

/**
 * Validator model. Deliberately still `claude-sonnet-4-6` — the sonnet-5
 * upgrade was built, measured, and NOT shipped.
 *
 * The five-arm run on 2026-08-13 (82 audited cases, 53 ambiguous / 29 clean,
 * `docs/findings/2026-08-12-validator-alternative-enumeration-experiment.md`):
 *
 *   arm           recall        false-flag
 *   baseline      32/53 60.4%   5/29 17.2%   sonnet-4-6, prior prompt
 *   prompt-only   32/53 60.4%   2/29  6.9%   sonnet-4-6, THIS prompt  <- shipped
 *   model-only    31/53 58.5%   4/29 13.8%   sonnet-5,   prior prompt
 *   both          39/53 73.6%   6/29 20.7%   sonnet-5,   this prompt
 *
 * The recall gain is superadditive — it appears ONLY with both changes, and
 * neither alone moves recall at all. Shipping the prompt without the model
 * therefore buys precision (false-flags 5 -> 2, the best discrimination of any
 * arm) and NOT the +7-case recall gain.
 *
 * The model was held back because it is the costlier half of that bet: reverting
 * `VALIDATION_MODEL` needs a deploy, whereas the prompt reverts by re-pointing a
 * Langfuse label. Revisit `both` once the interaction is confirmed on a second
 * run — `pnpm eval:validator` reproduces the table above.
 */
export const VALIDATION_MODEL = "claude-sonnet-4-6" as const;

/** Sized for `candidateFillers` (~150-250 tokens) plus the seven verdict
 *  fields; 1024 was the pre-enumeration budget and risks truncating the
 *  forced tool call mid-JSON. Mirrors evaluate.ts's bump for the same reason. */
export const VALIDATION_MAX_TOKENS = 2048;

/** Strict reviewer: zero diversity, deterministic output. */
export const VALIDATION_TEMPERATURE = 0.0;

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

export const VALIDATION_TOOL_NAME = "submit_validation_result";

// ---------------------------------------------------------------------------
// Candidate fillers — working-out for the ambiguous verdict
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Existing validation properties (preserved byte-identical for prompt stability)
// ---------------------------------------------------------------------------

/**
 * Per-property descriptions restate the routing implication from plan §3.1
 * so Claude can self-calibrate while filling the tool input. The actual
 * routing happens in `routeValidationResult`
 * (packages/db/scripts/generate-exercises-validate.ts), not here.
 */
const EXISTING_VALIDATION_PROPERTIES = {
  qualityScore: {
    type: "number",
    description:
      "Overall quality from 0.0 to 1.0. Below 0.5 will reject the draft; 0.5–0.7 will flag it for human review; >= 0.7 (with no other failures) auto-approves.",
  },
  ambiguous: {
    type: "boolean",
    description:
      "True if more than one substantively different answer would be equally correct. For cloze: true when more than one plausibly-fitting lexeme/form satisfies the targeted grammar point in this sentence AND the draft's `acceptableAnswers` list does not enumerate them (e.g. 'Sınıfta sekiz ___ var' — chair/student/book all fit — with no `acceptableAnswers`). For translation: surface variation is fine, but two structurally different correct translations is ambiguous. For vocab_recall: the prompt must single out exactly one headword.",
  },
  contextSpoilsAnswer: {
    type: "boolean",
    description:
      "True if the draft's `instructions` or `context` field gives away the answer — names the required suffix/form, states the rule's outcome, or otherwise lets the learner write the answer without engaging with the blank. Naming the rule category (e.g. 'vowel harmony', 'plural agreement after a numeral') is acceptable; stating the outcome (e.g. 'front vowel (e) requires -ler suffix' for a blank that takes -ler) is not. Auto-approval requires this to be false. Exception: when the user prompt carries a scoring note declaring a digit-form or definition-based elicitation as intended for this cell, that declared cue is NOT spoilage.",
  },
  levelMatch: {
    type: "boolean",
    description:
      "True if the exercise sits at the requested CEFR level. False if vocabulary or grammar drifts above or below the target level.",
  },
  grammarPointMatch: {
    type: "boolean",
    description:
      "True if the exercise actually tests the target grammar point. False if the targeting is incidental or absent.",
  },
  culturalIssues: {
    type: "array",
    items: { type: "string" },
    description:
      'Free-text descriptions of cultural concerns: stereotyping, sensitive content, exclusion. A single non-empty entry routes the draft to "rejected" regardless of qualityScore — this is intentional. Use sparingly.',
  },
  flaggedReasons: {
    type: "array",
    items: { type: "string" },
    description:
      'Free-text reasons that go into exercises.flagged_reasons when the draft routes to "flagged". Add anything that future-you would want to see when reviewing manually.',
  },
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
      number: {
        type: "string",
        enum: [...COVERAGE_AXIS_VALUES.number],
        description:
          "Grammatical number realized by the target form (singular/plural).",
      },
      case: {
        type: "string",
        enum: [...COVERAGE_AXIS_VALUES.case],
        description:
          "Grammatical case realized by the target form (nominative/accusative/dative/locative/ablative/genitive).",
      },
      comparison: {
        type: "string",
        enum: [...COVERAGE_AXIS_VALUES.comparison],
        description:
          "Comparison construction realized by the target: comparative (superiority), superlative, equative (equality), or less (inferiority).",
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Validation tool builder
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Eval-harness escape hatch. Production never sets these — the no-override
 *  path is byte-identical to before. Mirrors generate.ts's
 *  `spec.systemPromptOverride` and evaluate.ts's `modelOverride`. */
export type ValidateDraftOptions = {
  modelOverride?: string;
  systemPromptOverride?: string;
};

export type ValidationResult = {
  /** 0..1 inclusive. */
  qualityScore: number;
  /** Multiple equally-correct answers? */
  ambiguous: boolean;
  /**
   * Does the draft's `instructions` or `context` field state the rule's
   * outcome / name the required suffix or form / otherwise let the learner
   * write the answer without engaging with the blank? `true` is a hard veto:
   * `routeValidationResult` rejects the draft regardless of `qualityScore`.
   */
  contextSpoilsAnswer: boolean;
  /** Does the draft sit at the requested CEFR level? */
  levelMatch: boolean;
  /** Does the draft actually test the target grammar point? */
  grammarPointMatch: boolean;
  /**
   * Sensitive content, stereotyping, exclusion. A non-empty array is a hard
   * veto: `routeValidationResult` rejects the draft regardless of
   * `qualityScore` (intentional from plan §3.1 — the human reviewer never
   * sees rejected items, so culturally problematic drafts must be filtered
   * here, not deferred to manual review).
   */
  culturalIssues: string[];
  /** Free-text reasons the writer denormalizes into `exercises.flagged_reasons`. */
  flaggedReasons: string[];
  /**
   * Realized coverage values for pool-diversity monitoring (Phase 0). Strictly
   * non-load-bearing: `routeValidationResult` ignores it, and
   * `parseValidationResult` coerces anything malformed to `{}`. Only axis
   * values present in `COVERAGE_AXIS_VALUES` survive parsing.
   */
  coverage: CoverageTags;
  /**
   * The validator's adjudicated candidate fills (cloze only). Strictly
   * non-load-bearing: `routeValidationResult` ignores it and
   * `parseValidationResult` coerces anything malformed to `[]`. Present so the
   * `ambiguous` verdict is conditioned on a search rather than replacing one.
   */
  candidateFillers: CandidateFiller[];
};

export type ValidateDraftResult = {
  result: ValidationResult;
  tokenUsage: ClaudeUsageBreakdown;
};

// ---------------------------------------------------------------------------
// parseValidationResult — validates and coerces a raw tool-use input into a
// ValidationResult. Mirrors `parseEvaluationResult` (evaluate.ts:128-200):
// error messages use the `Invalid <field>: must be <expected>, got
// <JSON.stringify(value)>` format so an operator inspecting
// `generation_jobs.error_message` can find the offending field immediately.
//
// R8 split: load-bearing fields (`qualityScore` + the four booleans, which
// `routeValidationResult` actually branches on) throw a typed
// `ValidationParseError` so `runValidatorPool` can isolate one bad response to
// its ordinal instead of failing the whole cell closed. The two reason arrays
// (`flaggedReasons` / `culturalIssues`) are NON-load-bearing annotations —
// routing only consumes them when present — so a missing/non-array value (the
// exact `Invalid flaggedReasons: must be an array, got undefined` that killed
// `tr-a1-cloze-personal-suffixes` on 2026-05-24) leniently coerces to `[]`,
// and stray non-string elements are dropped, rather than vetoing the draft.
// ---------------------------------------------------------------------------

/**
 * Thrown by `parseValidationResult` when a LOAD-BEARING field is missing or
 * malformed (`qualityScore` out of range / non-number, or any of the four
 * routing booleans non-boolean). Distinct from a bare `Error` so
 * `runValidatorPool` (R8) can catch *this* per worker and route the single
 * ordinal to `rejected` (parse-failed), while genuine transport/abort errors —
 * which are NOT `ValidationParseError` — still propagate and fail the cell
 * closed (the correct response to a 429 / network drop / SIGINT).
 */
export class ValidationParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationParseError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Lenient reader for the non-load-bearing reason arrays. A missing or
 * non-array value yields `[]`; an array yields only its string elements (stray
 * non-strings are dropped). Never throws — these fields never gate routing, so
 * a malformed one must not cost the draft (R8.2).
 */
function coerceStringArray(
  raw: Record<string, unknown>,
  field: string,
): string[] {
  const v = raw[field];
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is string => typeof item === "string");
}

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

export function parseValidationResult(input: unknown): ValidationResult {
  if (!isObject(input)) {
    throw new ValidationParseError("Validation result must be an object");
  }

  const raw = input;

  // qualityScore: number in [0, 1]. Load-bearing — drives the
  // reject/flag/approve routing — so a bad value is a hard parse failure.
  const qualityScore = raw.qualityScore;
  if (typeof qualityScore !== "number" || qualityScore < 0 || qualityScore > 1) {
    throw new ValidationParseError(
      `Invalid qualityScore: must be a number between 0 and 1, got ${JSON.stringify(qualityScore)}`,
    );
  }

  // Four boolean fields. Each is a routing veto, so all are load-bearing.
  for (const field of [
    "ambiguous",
    "contextSpoilsAnswer",
    "levelMatch",
    "grammarPointMatch",
  ] as const) {
    if (typeof raw[field] !== "boolean") {
      throw new ValidationParseError(
        `Invalid ${field}: must be a boolean, got ${JSON.stringify(raw[field])}`,
      );
    }
  }

  // Two array-of-strings fields — non-load-bearing, coerced leniently (R8).
  const culturalIssues = coerceStringArray(raw, "culturalIssues");
  const flaggedReasons = coerceStringArray(raw, "flaggedReasons");

  // Non-load-bearing coverage object — coerced leniently, never throws.
  const coverage = coerceCoverage(raw);

  // Non-load-bearing candidateFillers array — coerced leniently, never throws.
  const candidateFillers = coerceCandidateFillers(raw);

  return {
    qualityScore,
    ambiguous: raw.ambiguous as boolean,
    contextSpoilsAnswer: raw.contextSpoilsAnswer as boolean,
    levelMatch: raw.levelMatch as boolean,
    grammarPointMatch: raw.grammarPointMatch as boolean,
    culturalIssues,
    flaggedReasons,
    coverage,
    candidateFillers,
  };
}

// ---------------------------------------------------------------------------
// applyCandidateFillerConsistency — self-consistency check (report-only)
// ---------------------------------------------------------------------------

export const SELF_INCONSISTENT_REASON = "validator-self-inconsistent";

/** Case/whitespace-insensitive membership, matching how a learner's answer
 *  would be compared against the stored list. Exported for
 *  `eval-validator-run.ts`'s blind-solver arm, which needs the identical
 *  "already enumerated" notion this module uses — see that file's
 *  `blindSolverVerdict`. */
export function listed(needle: string, haystack: readonly string[]): boolean {
  const n = needle.trim().toLowerCase();
  return haystack.some((h) => h.trim().toLowerCase() === n);
}

/**
 * `candidateFillers` makes `ambiguous` derivable: an `also-correct` filler that
 * is not `correctAnswer` and not in `acceptableAnswers` contradicts
 * `ambiguous: false`.
 *
 * `correctAnswer` is passed explicitly (not read off a draft) so the accepted
 * set mirrors the contract in `fluency.ts:90`
 * (`[correctAnswer, ...(acceptableAnswers ?? [])]`) — `acceptableAnswers` is
 * only the ADDITIONAL answers, and the tool schema always has the model list
 * `correctAnswer` itself as a candidate (marked `also-correct` by
 * definition), so omitting it here made the signal fire on nearly every
 * cloze.
 *
 * REPORT-ONLY BY DESIGN. This appends a `flaggedReasons` entry and returns a
 * new result; it must never mutate `ambiguous` or change routing. Flipping
 * verdicts from an unvetted scratchpad is how #606's over-flagging happened.
 * Promote to enforcement only once the replay harness shows the enumeration is
 * trustworthy.
 */
export function applyCandidateFillerConsistency(
  result: ValidationResult,
  correctAnswer: string,
  acceptableAnswers: readonly string[] | undefined,
): ValidationResult {
  if (result.ambiguous) return result;
  const accepted = [correctAnswer, ...(acceptableAnswers ?? [])];
  const contradiction = result.candidateFillers.some(
    (c) => c.verdict === "also-correct" && !listed(c.filler, accepted),
  );
  if (!contradiction) return result;
  return {
    ...result,
    flaggedReasons: [...result.flaggedReasons, SELF_INCONSISTENT_REASON],
  };
}

// ---------------------------------------------------------------------------
// validateDraft — single Claude call. Mirror of `evaluateAnswer`
// (evaluate.ts:220-272) and `generateBatch`'s per-iter call shape
// (generate.ts:551-580). Pure with respect to inputs — does NOT mutate
// `draft` or `spec`.
// ---------------------------------------------------------------------------

/** Reads `response.usage` and falls back to 0 for any unset cache field.
 *  Re-declared locally — generate.ts has the same helper but it's module-
 *  private. Keeping the validator self-contained avoids a circular import. */
function readUsage(response: Anthropic.Message): ClaudeUsageBreakdown {
  const u = response.usage;
  return {
    inputTokens: u.input_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
  };
}

/**
 * Validates one already-generated draft via a single Claude call.
 *
 * @throws Error if Claude API call fails, the response carries no tool_use
 *   block, the tool name is unexpected, or the tool input fails
 *   `parseValidationResult`'s field-level checks.
 */
export async function validateDraft(
  client: Anthropic,
  draft: ExerciseDraft,
  spec: GenerationSpec,
  signal?: AbortSignal,
  options?: ValidateDraftOptions,
): Promise<ValidateDraftResult> {
  // Top-of-function guard. Keys off `draft.contentJson.type` (not
  // `spec.exerciseType`) so a caller that hands the validator a draft whose
  // content type doesn't match the spec is caught here independently of spec
  // validation. Phase 6 widens TOOL_NAME_BY_TYPE to add new types; this guard
  // is the seam.
  if (!(draft.contentJson.type in TOOL_NAME_BY_TYPE)) {
    throw new Error(
      `Unsupported draft.contentJson.type: ${draft.contentJson.type}`,
    );
  }

  const isDictation = draft.contentJson.type === ExerciseType.DICTATION;
  const isFreeWriting = draft.contentJson.type === ExerciseType.FREE_WRITING;
  const systemText =
    options?.systemPromptOverride ??
    (isDictation
      ? await buildDictationValidationSystemPrompt(spec)
      : isFreeWriting
        ? await buildFreeWritingValidationSystemPrompt(spec)
        : await buildValidationSystemPrompt(spec));
  // The user-prompt builders take the NARROWED content, so the discriminant
  // must be inlined here — TypeScript cannot narrow a union through a boolean
  // alias (the `isDictation` / `isFreeWriting` consts above only gate the
  // spec-only system-prompt builders).
  const userText =
    draft.contentJson.type === ExerciseType.DICTATION
      ? buildDictationValidationUserPrompt(draft.contentJson, spec)
      : draft.contentJson.type === ExerciseType.FREE_WRITING
        ? buildFreeWritingValidationUserPrompt(draft.contentJson, spec)
        : buildValidationUserPrompt(draft, spec);

  // Per-model request shaping (see evaluate.ts:399-411 for the same guards):
  //  - Sonnet 5 / Opus 4.7+ / Fable reject non-default sampling params
  //    (`temperature: 0` → 400), so temperature only goes to models that take it.
  //  - Sonnet 5 (and Fable) run ADAPTIVE thinking when `thinking` is omitted —
  //    send an explicit `disabled` so this stays a model change and not a
  //    silent thinking change (which would also spend against max_tokens).
  const effectiveModel = options?.modelOverride ?? VALIDATION_MODEL;
  const rejectsSamplingParams = /sonnet-5|opus-4-[7-9]|opus-5|fable/.test(
    effectiveModel,
  );
  const omittedThinkingMeansAdaptive = /sonnet-5|opus-5|fable/.test(
    effectiveModel,
  );

  const request: Anthropic.MessageCreateParamsNonStreaming = {
    model: effectiveModel,
    max_tokens: VALIDATION_MAX_TOKENS,
    system: [
      {
        type: "text" as const,
        text: systemText,
        cache_control: { type: "ephemeral" as const },
      },
    ],
    messages: [{ role: "user" as const, content: userText }],
    tools: [buildValidationTool(draft.contentJson.type)],
    tool_choice: { type: "tool" as const, name: VALIDATION_TOOL_NAME },
  };
  if (!rejectsSamplingParams) request.temperature = VALIDATION_TEMPERATURE;
  if (omittedThinkingMeansAdaptive) request.thinking = { type: "disabled" };

  const response = await client.messages.create(request, { signal });

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );

  if (!toolUseBlock) {
    throw new Error(
      "Validator did not return a tool use block. " +
        `Stop reason: ${response.stop_reason}. ` +
        `Content types: ${response.content.map((b) => b.type).join(", ")}`,
    );
  }

  if (toolUseBlock.name !== VALIDATION_TOOL_NAME) {
    throw new Error(
      `Unexpected tool name: expected "${VALIDATION_TOOL_NAME}", got "${toolUseBlock.name}"`,
    );
  }

  const parsed = parseValidationResult(toolUseBlock.input);
  const result =
    draft.contentJson.type === ExerciseType.CLOZE
      ? applyCandidateFillerConsistency(
          parsed,
          draft.contentJson.correctAnswer,
          draft.contentJson.acceptableAnswers,
        )
      : parsed;
  const tokenUsage = readUsage(response);
  return { result, tokenUsage };
}
