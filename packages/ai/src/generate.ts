/**
 * packages/ai — Exercise generator core.
 *
 * The static surface of the generator: model constants, per-type tool schemas,
 * and the public types `GenerationSpec`, `ExerciseDraft`, `GenerateBatchResult`.
 * Parsers (Task 7), the deterministic ID derivation + guards + `generateBatch`
 * skeleton (Task 8), and the per-iter Claude/parse/dedup loop (Task 9) ship
 * separately.
 *
 * Calls Claude with `tool_choice: { type: 'tool', name: <type-specific> }` and
 * a single cached system block, the same pattern as `evaluate.ts`. Generation
 * uses temperature 0.7 (vs. evaluation's 0) — drafts need surface diversity.
 */

import type Anthropic from "@anthropic-ai/sdk";
import {
  type CefrLevel,
  type ClozeContent,
  type ExerciseContent,
  ExerciseType,
  Language,
  deterministicUuid,
  type GrammarPoint,
  type TranslationContent,
  type VocabRecallContent,
} from "@language-drill/shared";

import { ZERO_USAGE, addUsage, type ClaudeUsageBreakdown } from "./cost-model.js";
import {
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  canonicalSurface,
  type GenerationPromptInputs,
} from "./generation-prompts.js";

// ---------------------------------------------------------------------------
// Model + sampling constants
// ---------------------------------------------------------------------------

/**
 * Authoritative model id for the generator. Test-pinned equal to evaluate.ts's
 * MODEL constant via cross-file assertions in generate.test.ts (Task 10) and
 * evaluate.test.ts:320 — bumping the generator without bumping the evaluator
 * (or vice versa) fails CI.
 */
export const GENERATION_MODEL = "claude-sonnet-4-6" as const;

export const GENERATION_MAX_TOKENS = 1024;

export const GENERATION_TEMPERATURE = 0.7;

// ---------------------------------------------------------------------------
// Tool-name map
// ---------------------------------------------------------------------------

export const TOOL_NAME_BY_TYPE: Readonly<Record<ExerciseType, string>> =
  Object.freeze({
    cloze: "submit_cloze_exercise",
    translation: "submit_translation_exercise",
    vocab_recall: "submit_vocab_recall_exercise",
    sentence_construction: "submit_sentence_construction_exercise",
  });

// ---------------------------------------------------------------------------
// Per-type tool schemas — input_schema mirrors the matching ExerciseContent
// shape from @language-drill/shared field-for-field. The discriminator (`type`)
// is set by the parser, not by Claude — the tool name is the discriminator at
// the message-API level.
// ---------------------------------------------------------------------------

export const CLOZE_GENERATION_TOOL: Anthropic.Tool = {
  name: TOOL_NAME_BY_TYPE.cloze,
  description:
    "Submit a single cloze (fill-in-the-blank) exercise targeting the configured grammar point.",
  input_schema: {
    type: "object" as const,
    properties: {
      instructions: {
        type: "string",
        description:
          "Short imperative instructing the learner what to do (e.g. 'Fill in the blank with the correct subjunctive form.').",
      },
      sentence: {
        type: "string",
        description:
          "The full sentence with exactly one blank rendered as `___` (three underscores).",
      },
      correctAnswer: {
        type: "string",
        description:
          "The canonical fill for the blank. Must satisfy the targeted grammar point. If the sentence's surrounding text does not pick out one specific lexeme/form, you MUST also populate `acceptableAnswers` with every other lexeme/form that fits — otherwise the exercise is ambiguous and will be rejected.",
      },
      acceptableAnswers: {
        type: "array",
        items: { type: "string" },
        description:
          "Every additional lexeme/form (beyond `correctAnswer`) that fits the blank and satisfies the targeted grammar point in this exact sentence. Required whenever the surrounding text does not single out one specific word — e.g. for 'Sınıfta sekiz ___ var', supply ['öğrenci', 'kitap', 'kalem', ...]. Omit (or pass `[]`) only when the sentence references the blank's referent explicitly enough that no other lexeme plausibly fits.",
      },
      options: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional multiple-choice distractors (3–4 items). When present, must include the correctAnswer.",
      },
      context: {
        type: "string",
        description:
          "Optional one-line framing shown above the sentence. May name the grammar category being tested (e.g. 'vowel harmony', 'noun-numeral agreement') but MUST NOT state the rule's outcome or otherwise reveal the answer. 'Vowel harmony: front vowel (e) requires -ler suffix' is forbidden — it tells the learner the answer. 'Plural agreement after a numeral' is acceptable. Same constraint applies to `instructions`.",
      },
      topicHint: {
        type: "string",
        description:
          "Optional topic theme (e.g. 'travel', 'work', 'family').",
      },
      glossEn: {
        type: "string",
        description:
          "Optional one-line English gloss shown above the sentence as a disambiguation device — chiefly for Turkish accusative (definiteness-marking) clozes where a short L2-only sentence cannot force the case. Include it for CEFR A1–A2; omit it for B1+. It MUST convey meaning/case WITHOUT stating the rule's outcome or naming the required form: 'I drink the coffee' is allowed; 'use the accusative -yi' is forbidden (same anti-spoil constraint as `context`).",
      },
    },
    required: ["instructions", "sentence", "correctAnswer"],
  },
};

export const TRANSLATION_GENERATION_TOOL: Anthropic.Tool = {
  name: TOOL_NAME_BY_TYPE.translation,
  description:
    "Submit a single translation exercise (English source → target language) targeting the configured grammar point.",
  input_schema: {
    type: "object" as const,
    properties: {
      instructions: {
        type: "string",
        description:
          "Short imperative instructing the learner to translate the source text into the target language.",
      },
      sourceText: {
        type: "string",
        description:
          "The English sentence to translate. Must use vocabulary appropriate for the target CEFR level.",
      },
      sourceLanguage: {
        type: "string",
        description:
          "Always 'EN' in round 1 (resolved decision #2 in the exercise-generation plan).",
      },
      targetLanguage: {
        type: "string",
        description:
          "The target language code: 'ES', 'DE', or 'TR'. Must match the spec's language.",
      },
      referenceTranslation: {
        type: "string",
        description:
          "A canonical correct translation. Other valid translations are accepted at evaluation time; this is the anchor.",
      },
      topicHint: {
        type: "string",
        description:
          "Optional topic theme (e.g. 'travel', 'work', 'family').",
      },
    },
    required: [
      "instructions",
      "sourceText",
      "sourceLanguage",
      "targetLanguage",
      "referenceTranslation",
    ],
  },
};

export const VOCAB_RECALL_GENERATION_TOOL: Anthropic.Tool = {
  name: TOOL_NAME_BY_TYPE.vocab_recall,
  description:
    "Submit a single vocabulary recall exercise (definition/context → target word) for the configured frequency band.",
  input_schema: {
    type: "object" as const,
    properties: {
      instructions: {
        type: "string",
        description:
          "Short imperative instructing the learner to produce the target word.",
      },
      prompt: {
        type: "string",
        description:
          "The definition, description, or contextual clue. May be in the target language at higher CEFR levels; in English at lower levels.",
      },
      expectedWord: {
        type: "string",
        description:
          "The target lexeme the learner should produce. Usually a single word, but a short multi-word lexeme (e.g. 'medio ambiente', 'cambio climático', 'efecto invernadero') is allowed when the curriculum names one. Use the canonical headword form: no leading/trailing whitespace, no internal whitespace runs longer than a single space, and no surrounding articles unless the article is part of the lexeme itself.",
      },
      hints: {
        type: "array",
        items: { type: "string" },
        description:
          "Progressive hints the UI can reveal (first letter, syllable count, partial reveal, etc.).",
      },
      exampleSentence: {
        type: "string",
        description:
          "An example sentence using the target word in context, with the target word visible.",
      },
      topicHint: {
        type: "string",
        description:
          "Optional topic theme (e.g. 'travel', 'work', 'family').",
      },
    },
    required: [
      "instructions",
      "prompt",
      "expectedWord",
      "hints",
      "exampleSentence",
    ],
  },
};

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

export const GENERATION_TOOL_BY_TYPE: Readonly<
  Record<ExerciseType, Anthropic.Tool>
> = Object.freeze({
  cloze: CLOZE_GENERATION_TOOL,
  translation: TRANSLATION_GENERATION_TOOL,
  vocab_recall: VOCAB_RECALL_GENERATION_TOOL,
  sentence_construction: SENTENCE_CONSTRUCTION_GENERATION_TOOL,
});

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GenerationSpec = {
  /** EN is rejected at the generator's top-level guard (Task 8 / Requirement 1.8). */
  language: Exclude<Language, Language.EN>;
  cefrLevel: CefrLevel;
  exerciseType: ExerciseType;
  grammarPoint: GrammarPoint;
  /** CLI passthrough; current prompts ignore the value (resolved decision #3). */
  topicDomain: string | null;
  /** 1..200; CLI default is 50. */
  count: number;
  /** Default `'phase-2-default'` from the CLI. Bump to add 50 more drafts to a cell. */
  batchSeed: string;
  /**
   * Eval-harness only: an explicit, already-rendered system-prompt body used
   * verbatim as the cached system block in `generateOneDraft`, bypassing the
   * Langfuse fetch (and its in-repo fallback) entirely. Production never sets
   * this — when undefined, generation behaves byte-identically to today. Lets
   * `pnpm eval:gen` drive a candidate generation prompt without mutating the
   * live Langfuse prompt or relying on the module-scope prompt cache.
   */
  systemPromptOverride?: string;
  /**
   * Surfaces already persisted in this cell, fed into the generator's system
   * prompt so Claude stops proposing what `exercises_dedup_idx` would reject
   * on insert. Populated by `runOneCell` for `vocab_recall` cells; left
   * undefined for cloze/translation (where the surface space is unbounded).
   * Frozen for the whole batch — same list across every ordinal in the cell
   * — so the prompt-cache prefix stays stable.
   */
  priorPoolSurfaces?: readonly string[];
  /**
   * Per-ordinal frequency seed (R5): `seedWords[ordinal]` is a content-word
   * lemma the generator should build the draft around, or `null` for an
   * unseeded ordinal. Injected into the per-draft USER prompt only (never the
   * cached system prompt), so the Anthropic cache prefix stays byte-identical
   * across the batch. Populated by `runOneCell` for cloze/translation cells
   * (task 15); `undefined` → every ordinal unseeded.
   */
  seedWords?: readonly (string | null)[];
};

export type ExerciseDraft = {
  /** Deterministic UUID — see `exerciseDraftId` (Task 8). */
  id: string;
  /** The discriminated-union element; type-checked by the matching parser. */
  contentJson: ExerciseContent;
  metadata: {
    grammarPointKey: string;
    topicDomain: string | null;
    /** Always `=== GENERATION_MODEL` for drafts produced in this phase. */
    modelId: string;
    /** Total billable input across all three tiers (non-cached + cache-write + cache-read). */
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    /** True when the draft's canonical surface matches another draft earlier in the same batch. */
    inBatchDuplicate: boolean;
  };
};

export type MalformedDraft = {
  ordinal: number;
  /** The validator / parser message, with the `Draft ordinal=N malformed: ` prefix. */
  errorMessage: string;
};

export type GenerateBatchResult = {
  drafts: ExerciseDraft[];
  tokenUsage: ClaudeUsageBreakdown;
  /**
   * Ordinals where Claude returned a payload that failed parsing or validation.
   * Per-ordinal failures no longer abort the batch (so one bad draft in 50
   * doesn't kill the other 49); the offending ordinals show up here for
   * caller-level logging and operational visibility. Token usage for the
   * malformed responses is still folded into `tokenUsage` — the Claude call
   * happened and cost real tokens.
   */
  malformedDrafts: MalformedDraft[];
};

// ---------------------------------------------------------------------------
// Per-type parsers — validate Claude's tool-input against the matching
// ExerciseContent shape, throw with a field-level message on any mismatch,
// return a typed literal ready for the generator's `drafts` array. Mirror of
// `parseEvaluationResult` (evaluate.ts:128-200). The caller (generateBatch)
// prefixes ordinal info on re-throw.
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(
  raw: Record<string, unknown>,
  field: string,
  ctx: string,
): string {
  const v = raw[field];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(
      `${ctx}: invalid ${field}: must be a non-empty string, got ${JSON.stringify(v)}`,
    );
  }
  return v;
}

function optionalString(
  raw: Record<string, unknown>,
  field: string,
  ctx: string,
): string | undefined {
  const v = raw[field];
  if (v === undefined) return undefined;
  if (typeof v !== "string") {
    throw new Error(
      `${ctx}: invalid ${field}: must be a string when present, got ${JSON.stringify(v)}`,
    );
  }
  return v;
}

function requireStringArray(
  raw: Record<string, unknown>,
  field: string,
  ctx: string,
): string[] {
  const v = raw[field];
  if (!Array.isArray(v)) {
    throw new Error(
      `${ctx}: invalid ${field}: must be an array, got ${JSON.stringify(v)}`,
    );
  }
  for (let i = 0; i < v.length; i++) {
    if (typeof v[i] !== "string") {
      throw new Error(
        `${ctx}: invalid ${field}[${i}]: must be a string, got ${JSON.stringify(v[i])}`,
      );
    }
  }
  return v as string[];
}

function optionalStringArray(
  raw: Record<string, unknown>,
  field: string,
  ctx: string,
): string[] | undefined {
  if (raw[field] === undefined) return undefined;
  return requireStringArray(raw, field, ctx);
}

const ALL_LANGUAGE_CODES: ReadonlySet<string> = new Set(
  Object.values(Language),
);

export function parseGeneratedClozeDraft(
  input: unknown,
  _spec: GenerationSpec,
): ClozeContent {
  const ctx = "cloze draft";
  if (!isObject(input)) {
    throw new Error(`${ctx}: must be an object, got ${typeof input}`);
  }

  const instructions = requireString(input, "instructions", ctx);
  const sentence = requireString(input, "sentence", ctx);
  const correctAnswer = requireString(input, "correctAnswer", ctx);
  const acceptableAnswers = optionalStringArray(input, "acceptableAnswers", ctx);
  const options = optionalStringArray(input, "options", ctx);
  const contextField = optionalString(input, "context", ctx);
  const topicHint = optionalString(input, "topicHint", ctx);
  const glossEn = optionalString(input, "glossEn", ctx);

  if (correctAnswer.trim().length === 0) {
    throw new Error(
      `${ctx}: invalid correctAnswer: must contain non-whitespace characters`,
    );
  }
  if (!sentence.includes("___")) {
    throw new Error(
      `${ctx}: invalid sentence: must contain a '___' blank marker`,
    );
  }
  if (acceptableAnswers !== undefined) {
    for (let i = 0; i < acceptableAnswers.length; i++) {
      if (acceptableAnswers[i].trim().length === 0) {
        throw new Error(
          `${ctx}: invalid acceptableAnswers[${i}]: must contain non-whitespace characters`,
        );
      }
    }
  }

  return {
    type: ExerciseType.CLOZE,
    instructions,
    sentence,
    correctAnswer,
    ...(acceptableAnswers !== undefined && acceptableAnswers.length > 0
      ? { acceptableAnswers }
      : {}),
    ...(options !== undefined ? { options } : {}),
    ...(contextField !== undefined ? { context: contextField } : {}),
    ...(topicHint !== undefined ? { topicHint } : {}),
    ...(glossEn !== undefined ? { glossEn } : {}),
  };
}

export function parseGeneratedTranslationDraft(
  input: unknown,
  spec: GenerationSpec,
): TranslationContent {
  const ctx = "translation draft";
  if (!isObject(input)) {
    throw new Error(`${ctx}: must be an object, got ${typeof input}`);
  }

  const instructions = requireString(input, "instructions", ctx);
  const sourceText = requireString(input, "sourceText", ctx);
  const sourceLanguageRaw = requireString(input, "sourceLanguage", ctx);
  const targetLanguageRaw = requireString(input, "targetLanguage", ctx);
  const referenceTranslation = requireString(input, "referenceTranslation", ctx);
  const topicHint = optionalString(input, "topicHint", ctx);

  if (!ALL_LANGUAGE_CODES.has(sourceLanguageRaw)) {
    throw new Error(
      `${ctx}: invalid sourceLanguage: not a known Language code, got ${JSON.stringify(sourceLanguageRaw)}`,
    );
  }
  if (!ALL_LANGUAGE_CODES.has(targetLanguageRaw)) {
    throw new Error(
      `${ctx}: invalid targetLanguage: not a known Language code, got ${JSON.stringify(targetLanguageRaw)}`,
    );
  }
  if (sourceLanguageRaw !== Language.EN) {
    throw new Error(
      `${ctx}: invalid sourceLanguage: round 1 supports only EN→target translations (got ${sourceLanguageRaw})`,
    );
  }
  if (targetLanguageRaw !== spec.language) {
    throw new Error(
      `${ctx}: invalid targetLanguage: must equal spec.language (${spec.language}), got ${targetLanguageRaw}`,
    );
  }
  if (sourceText.length === 0) {
    throw new Error(`${ctx}: invalid sourceText: must be non-empty`);
  }
  if (referenceTranslation.length === 0) {
    throw new Error(
      `${ctx}: invalid referenceTranslation: must be non-empty`,
    );
  }

  return {
    type: ExerciseType.TRANSLATION,
    instructions,
    sourceText,
    sourceLanguage: sourceLanguageRaw as Language,
    targetLanguage: targetLanguageRaw as Language,
    referenceTranslation,
    ...(topicHint !== undefined ? { topicHint } : {}),
  };
}

export function parseGeneratedVocabRecallDraft(
  input: unknown,
  _spec: GenerationSpec,
): VocabRecallContent {
  const ctx = "vocab_recall draft";
  if (!isObject(input)) {
    throw new Error(`${ctx}: must be an object, got ${typeof input}`);
  }

  const instructions = requireString(input, "instructions", ctx);
  const prompt = requireString(input, "prompt", ctx);
  const expectedWordRaw = requireString(input, "expectedWord", ctx);
  const hints = requireStringArray(input, "hints", ctx);
  const exampleSentence = requireString(input, "exampleSentence", ctx);
  const topicHint = optionalString(input, "topicHint", ctx);

  // Multi-word lexemes are valid headwords in several languages (Spanish
  // `medio ambiente`, `cambio climático`, etc.) and already ship in the
  // curated seeds — see `.claude/bugs/vocab-recall-multi-word-rejected/`.
  // Normalize to canonical surface (trim + collapse internal whitespace)
  // so downstream dedup, grading, and display agree on a single form.
  const expectedWord = expectedWordRaw.trim().replace(/\s+/g, " ");
  if (expectedWord.length === 0) {
    throw new Error(
      `${ctx}: invalid expectedWord: must contain non-whitespace characters, got ${JSON.stringify(expectedWordRaw)}`,
    );
  }

  return {
    type: ExerciseType.VOCAB_RECALL,
    instructions,
    prompt,
    expectedWord,
    hints,
    exampleSentence,
    ...(topicHint !== undefined ? { topicHint } : {}),
  };
}

// ---------------------------------------------------------------------------
// Deterministic ID derivation
// ---------------------------------------------------------------------------

/**
 * Stable UUID for a draft. The hash inputs cover every dimension that defines
 * the draft's place in the pool: language, level, type, grammar point, batch
 * seed, and ordinal. Re-running the same `GenerationSpec` produces the same
 * IDs ordinal-by-ordinal — the property the CLI's `INSERT ... ON CONFLICT DO
 * NOTHING` relies on for safe re-runs (Requirement 3.3).
 *
 * Bump `spec.batchSeed` to add fresh drafts to a cell that's already filled.
 */
export function exerciseDraftId(spec: GenerationSpec, ordinal: number): string {
  return deterministicUuid(
    [
      spec.language,
      spec.cefrLevel,
      spec.exerciseType,
      spec.grammarPoint.key,
      spec.batchSeed,
      String(ordinal),
    ].join("|"),
  );
}

// ---------------------------------------------------------------------------
// Token-usage extraction
// ---------------------------------------------------------------------------

/** Reads `response.usage` and falls back to 0 for any unset cache field. */
function readUsage(response: Anthropic.Message): ClaudeUsageBreakdown {
  const u = response.usage;
  return {
    inputTokens: u.input_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
  };
}

// ---------------------------------------------------------------------------
// generateOneDraft — single-ordinal Claude call. Stateless across ordinals so
// callers (sequential generateBatch + the parallel generator-pool in
// packages/db/src/generation/generator-pool.ts) can fan it out freely. The
// `inBatchDuplicate` flag is left `false` here — only the caller, which sees
// the whole batch in ordinal order, can populate it. Use
// `populateInBatchDuplicates` after collecting all results.
// ---------------------------------------------------------------------------

export type GenerateOneDraftResult =
  | { kind: "draft"; draft: ExerciseDraft; usage: ClaudeUsageBreakdown }
  | {
      kind: "malformed";
      malformed: MalformedDraft;
      usage: ClaudeUsageBreakdown;
    };

export async function generateOneDraft(
  client: Anthropic,
  spec: GenerationSpec,
  ordinal: number,
  signal?: AbortSignal,
): Promise<GenerateOneDraftResult> {
  const promptInputs: GenerationPromptInputs = {
    language: spec.language,
    cefrLevel: spec.cefrLevel,
    exerciseType: spec.exerciseType,
    grammarPoint: spec.grammarPoint,
    priorPoolSurfaces: spec.priorPoolSurfaces,
  };

  // Empty `recentStems` — intra-batch diversity feedback was dropped when the
  // per-ordinal loop became parallelizable. Hard dedup is still enforced
  // downstream: `populateInBatchDuplicates` flags within-batch collisions,
  // `exercises_dedup_idx` rejects cross-batch collisions at INSERT time, and
  // `runRetryGeneration` (sequential, sees prior drafts via dedup-index
  // collision) handles retries.
  //
  // `systemPromptOverride` (eval-harness only) is used verbatim when present,
  // bypassing the Langfuse fetch + in-repo fallback in
  // `buildGenerationSystemPrompt`. Production never sets it, so the no-override
  // path is byte-identical to before.
  const systemText =
    spec.systemPromptOverride ??
    (await buildGenerationSystemPrompt(promptInputs, []));
  const userText = buildGenerationUserPrompt(
    promptInputs,
    ordinal,
    spec.topicDomain,
    spec.seedWords?.[ordinal] ?? null,
  );
  const tool = GENERATION_TOOL_BY_TYPE[spec.exerciseType];

  // Infrastructure-level failures (network, rate-limit, auth) propagate
  // — they're not per-ordinal data quality issues. Only the parse path
  // below is loss-tolerant.
  const response = await client.messages.create(
    {
      model: GENERATION_MODEL,
      max_tokens: GENERATION_MAX_TOKENS,
      system: [
        {
          type: "text" as const,
          text: systemText,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: [{ role: "user" as const, content: userText }],
      tools: [tool],
      tool_choice: { type: "tool" as const, name: tool.name },
      temperature: GENERATION_TEMPERATURE,
    },
    { signal },
  );

  // Token usage is paid whether the parse succeeds or not — return it on
  // both branches so per-ordinal failures are still accounted for in cost
  // reporting.
  const usage = readUsage(response);

  let content: ExerciseContent;
  try {
    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUseBlock) {
      throw new Error(
        `no tool_use block returned (stop_reason=${response.stop_reason})`,
      );
    }
    if (toolUseBlock.name !== tool.name) {
      throw new Error(
        `expected tool '${tool.name}', got '${toolUseBlock.name}'`,
      );
    }
    content = parseToolInput(toolUseBlock.input, spec);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      kind: "malformed",
      malformed: {
        ordinal,
        errorMessage: `Draft ordinal=${ordinal} malformed: ${message}`,
      },
      usage,
    };
  }

  return {
    kind: "draft",
    draft: {
      id: exerciseDraftId(spec, ordinal),
      contentJson: content,
      metadata: {
        grammarPointKey: spec.grammarPoint.key,
        topicDomain: spec.topicDomain,
        modelId: GENERATION_MODEL,
        inputTokens:
          usage.inputTokens +
          usage.cacheCreationInputTokens +
          usage.cacheReadInputTokens,
        outputTokens: usage.outputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        inBatchDuplicate: false,
      },
    },
    usage,
  };
}

/**
 * Walks drafts in ordinal order, setting `inBatchDuplicate = true` on every
 * occurrence after the first whose canonical surface matches an earlier draft
 * in the array. Mutates in place. Caller responsibility: pass drafts in
 * ordinal order so the marking is deterministic across serial and parallel
 * generation paths.
 */
export function populateInBatchDuplicates(drafts: ExerciseDraft[]): void {
  const seen = new Set<string>();
  for (const draft of drafts) {
    const surface = canonicalSurface(draft.contentJson);
    if (seen.has(surface)) {
      draft.metadata.inBatchDuplicate = true;
    } else {
      seen.add(surface);
    }
  }
}

// ---------------------------------------------------------------------------
// generateBatch — sequential wrapper. The parallel path lives in
// `packages/db/src/generation/generator-pool.ts` (calls `generateOneDraft`
// directly). This wrapper is kept for `runRetryGeneration` (count=1) and any
// other caller that wants serial semantics with no concurrency concerns.
// ---------------------------------------------------------------------------

export async function generateBatch(
  client: Anthropic,
  spec: GenerationSpec,
  signal?: AbortSignal,
): Promise<GenerateBatchResult> {
  // Top-of-function guards. The CLI rejects EN at argument-parse time; the
  // guard here exists so a caller that bypassed the CLI (e.g. an SDK consumer
  // in a future phase) can't sneak past resolved decision #4. The cast through
  // `Language` is needed because `spec.language` is statically typed as
  // `Exclude<Language, Language.EN>` — TS would otherwise reject the
  // comparison as tautologically false, but we want the runtime check.
  if ((spec.language as Language) === Language.EN) {
    throw new Error(
      "language EN is not a learning language for generation (resolved decision #4)",
    );
  }
  if (!(spec.exerciseType in TOOL_NAME_BY_TYPE)) {
    throw new Error(`Unsupported exerciseType: ${spec.exerciseType}`);
  }

  let tokenUsage: ClaudeUsageBreakdown = ZERO_USAGE;
  const drafts: ExerciseDraft[] = [];
  const malformedDrafts: MalformedDraft[] = [];

  for (let ordinal = 0; ordinal < spec.count; ordinal++) {
    const result = await generateOneDraft(client, spec, ordinal, signal);
    tokenUsage = addUsage(tokenUsage, result.usage);
    if (result.kind === "draft") {
      drafts.push(result.draft);
    } else {
      malformedDrafts.push(result.malformed);
    }
  }

  populateInBatchDuplicates(drafts);
  return { drafts, tokenUsage, malformedDrafts };
}

// Dispatches to the matching parser. Exported via the function level only —
// not re-exported through the package barrel, since callers should use the
// per-type parsers directly when they know the type at compile time.
function parseToolInput(
  input: unknown,
  spec: GenerationSpec,
): ExerciseContent {
  switch (spec.exerciseType) {
    case ExerciseType.CLOZE:
      return parseGeneratedClozeDraft(input, spec);
    case ExerciseType.TRANSLATION:
      return parseGeneratedTranslationDraft(input, spec);
    case ExerciseType.VOCAB_RECALL:
      return parseGeneratedVocabRecallDraft(input, spec);
    default: {
      const _exhaustive: never = spec.exerciseType;
      throw new Error(
        `parseToolInput: unsupported exerciseType ${(_exhaustive as ExerciseType)}`,
      );
    }
  }
}
