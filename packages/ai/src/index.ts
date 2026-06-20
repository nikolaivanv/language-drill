/**
 * packages/ai — Claude API client wrapper and prompt template registry.
 *
 * Provides the evaluation engine used by the submission route to score
 * user answers via Claude with structured tool-use output.
 */

import Anthropic from "@anthropic-ai/sdk";

export {
  EVALUATION_SYSTEM_PROMPT,
  EVALUATION_SYSTEM_PROMPT_VERSION,
  buildUserPrompt,
  CEFR_LEVEL_DESCRIPTORS,
} from "./prompts.js";
export {
  evaluateAnswer,
  parseEvaluationResult,
  EVALUATION_TOOL,
  EVALUATION_TOOL_NAME,
  EVAL_REQUEST_TIMEOUT_MS,
  EVAL_MAX_RETRIES,
} from "./evaluate.js";
export type { EvaluateAnswerInput } from "./evaluate.js";
export { ContentRejectedError } from "./content-rejected-error.js";
export { diffDictation } from "./dictation-diff.js";
export type { DictationDiff } from "./dictation-diff.js";
export {
  DICTATION_EVAL_SYSTEM_PROMPT,
  DICTATION_EVAL_PROMPT_VERSION,
  buildDictationUserPrompt,
} from "./dictation-prompts.js";
export {
  gradeDictationAnswer,
  parseDictationClassification,
  DICTATION_TOOL,
  DICTATION_TOOL_NAME,
} from "./dictation-eval.js";
export type { GradeDictationInput } from "./dictation-eval.js";
export {
  DICTATION_GENERATION_PROMPT_VERSION,
  DICTATION_GENERATION_SYSTEM_PROMPT,
  buildDictationGenerationSystemPrompt,
  buildDictationGenerationUserPrompt,
  computeDictationGenerationPromptVars,
} from "./dictation-generation-prompts.js";
export {
  DICTATION_VALIDATION_PROMPT_VERSION,
  DICTATION_VALIDATION_SYSTEM_PROMPT,
  buildDictationValidationSystemPrompt,
  buildDictationValidationUserPrompt,
  computeDictationValidationPromptVars,
} from "./dictation-validation-prompts.js";
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
export {
  evaluateFreeWriting,
  parseFreeWritingEvaluation,
  FREE_WRITING_EVAL_TOOL,
  FREE_WRITING_EVAL_TOOL_NAME,
  FREE_WRITING_EVAL_REQUEST_TIMEOUT_MS,
  FREE_WRITING_EVAL_MAX_RETRIES,
} from "./free-writing-evaluate.js";
export type { EvaluateFreeWritingInput } from "./free-writing-evaluate.js";
export {
  FREE_WRITING_EVAL_SYSTEM_PROMPT,
  FREE_WRITING_EVAL_PROMPT_VERSION,
  buildFreeWritingUserPrompt,
} from "./free-writing-prompts.js";
export {
  generateBrainstorm,
  generateVocabBoost,
  parseBrainstorm,
  parseVocabBoost,
  BRAINSTORM_TOOL,
  BRAINSTORM_TOOL_NAME,
  VOCAB_BOOST_TOOL,
  VOCAB_BOOST_TOOL_NAME,
  WRITING_HELPER_REQUEST_TIMEOUT_MS,
  WRITING_HELPER_MAX_RETRIES,
  generateStartMyParagraph,
  parseStartMyParagraph,
  START_MY_PARAGRAPH_TOOL,
  START_MY_PARAGRAPH_TOOL_NAME,
  type WritingHelperInput,
  type BrainstormResult,
  type VocabBoostResult,
  type StartMyParagraphResult,
} from "./writing-helper.js";
export {
  BRAINSTORM_SYSTEM_PROMPT,
  BRAINSTORM_PROMPT_VERSION,
  VOCAB_BOOST_SYSTEM_PROMPT,
  VOCAB_BOOST_PROMPT_VERSION,
  buildBrainstormUserPrompt,
  buildVocabBoostUserPrompt,
  START_MY_PARAGRAPH_SYSTEM_PROMPT,
  START_MY_PARAGRAPH_PROMPT_VERSION,
  buildStartMyParagraphUserPrompt,
} from "./writing-helper-prompts.js";
export {
  ANNOTATE_SYSTEM_PROMPT,
  ANNOTATE_SYSTEM_PROMPT_VERSION,
  ANNOTATE_TOOL,
  ANNOTATE_TOOL_NAME,
  AnnotateStreamMaxTokensError,
  extractCompletedFields,
  isProperNounPos,
  streamAnnotation,
} from "./annotate.js";
export type {
  AnnotateStreamEvent,
  AnnotateStreamInput,
} from "./annotate.js";

// Read: Deep Annotation — on-demand span enrichment (Sonnet). The deep
// counterpart to the cheap skim pass in `annotate.js`.
export {
  READ_SPAN_SYSTEM_PROMPT,
  READ_SPAN_PROMPT_VERSION,
  READ_SPAN_TOOL_NAME,
  READ_SPAN_WORD_TOOL,
  READ_SPAN_PHRASE_TOOL,
  READ_SPAN_SENTENCE_TOOL,
  pickSpanTool,
  annotateSpan,
  parseSpanResult,
  buildSpanUserPrompt,
  streamSpan,
  ReadSpanStreamMaxTokensError,
} from "./read-span.js";
export type {
  AnnotateSpanInput,
  SpanType,
  ReadSpanStreamEvent,
} from "./read-span.js";

export {
  GENERATION_MODEL,
  GENERATION_MAX_TOKENS,
  GENERATION_TEMPERATURE,
  TOOL_NAME_BY_TYPE,
  GENERATION_TOOL_BY_TYPE,
  CLOZE_GENERATION_TOOL,
  TRANSLATION_GENERATION_TOOL,
  VOCAB_RECALL_GENERATION_TOOL,
  DICTATION_GENERATION_TOOL,
  DICTATION_VOICE_POOL_BY_LANGUAGE,
  generateBatch,
  generateOneDraft,
  populateInBatchDuplicates,
  exerciseDraftId,
  parseGeneratedClozeDraft,
  parseGeneratedTranslationDraft,
  parseGeneratedVocabRecallDraft,
  parseGeneratedDictationDraft,
  parseGeneratedFreeWritingDraft,
  FREE_WRITING_GENERATION_TOOL,
} from "./generate.js";
export type {
  GenerationSpec,
  ExerciseDraft,
  GenerateBatchResult,
  GenerateOneDraftResult,
  MalformedDraft,
} from "./generate.js";

export {
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  canonicalSurface,
  tailRecentStems,
  GENERATION_PROMPT_VERSION,
  GENERATION_SYSTEM_PROMPT_TEMPLATE,
  MAX_RECENT_STEMS_IN_PROMPT,
  PERSON_ROTATION_BY_LANGUAGE,
  personCodesForLanguage,
  personDisplayForCode,
} from "./generation-prompts.js";
export type { GenerationPromptInputs } from "./generation-prompts.js";

export {
  SONNET_4_5_PRICING,
  estimateCostUsd,
  addUsage,
  ZERO_USAGE,
} from "./cost-model.js";
export type { ClaudeUsageBreakdown } from "./cost-model.js";

export {
  validateDraft,
  parseValidationResult,
  ValidationParseError,
  VALIDATION_TOOL,
  VALIDATION_TOOL_NAME,
  VALIDATION_MODEL,
  VALIDATION_MAX_TOKENS,
  VALIDATION_TEMPERATURE,
} from "./validate.js";
export type { ValidationResult, ValidateDraftResult } from "./validate.js";

export {
  buildValidationSystemPrompt,
  buildValidationUserPrompt,
  VALIDATION_PROMPT_VERSION,
  VALIDATION_SYSTEM_PROMPT_TEMPLATE,
} from "./validation-prompts.js";

// Per-language frequency-dictionary lookup used by the streaming-annotate
// Lambda's pre-filter (more-responsive-reading spec Req 1.1).
export * from "./frequency/index.js";

// Deterministic Turkish vowel-harmony + word-formedness checker. Consumed by
// the generation/revalidation routing combiner in `packages/db`.
export {
  checkTurkishCloze,
  lastVowel,
  firstVowel,
  harmonize,
  extractSuffixalStem,
  VOWELS,
} from "./turkish-harmony.js";
export type { DeterministicVerdict, TurkishVowel } from "./turkish-harmony.js";

export {
  THEORY_TOOL_NAME,
  THEORY_GENERATION_MODEL,
  THEORY_GENERATION_TEMPERATURE,
  THEORY_GENERATION_MAX_TOKENS,
  THEORY_GENERATION_MAX_RETRIES,
  THEORY_GENERATION_TOOL,
  generateTheoryTopic,
  theoryDraftId,
  deriveTheoryTopicId,
  TheoryDraftMalformedError,
} from "./theory-generate.js";
export type {
  TheoryGenerationSpec,
  TheoryDraft,
  TheoryGenerateResult,
} from "./theory-generate.js";

export {
  buildTheorySystemPrompt,
  buildTheoryUserPrompt,
  THEORY_GENERATION_PROMPT_VERSION,
  THEORY_SYSTEM_PROMPT_TEMPLATE,
} from "./theory-prompts.js";
export type { TheoryPromptInputs } from "./theory-prompts.js";

export { THEORY_VALIDATION_THRESHOLDS } from "./theory-validation-thresholds.js";
export type { THEORY_VALIDATION_THRESHOLDS_TYPE } from "./theory-validation-thresholds.js";

export {
  validateTheoryDraft,
  parseTheoryValidationResult,
  THEORY_VALIDATION_TOOL,
  THEORY_VALIDATION_TOOL_NAME,
  THEORY_VALIDATION_MODEL,
  THEORY_VALIDATION_MAX_TOKENS,
  THEORY_VALIDATION_TEMPERATURE,
} from "./theory-validate.js";
export type {
  TheoryValidationResult,
  ValidateTheoryDraftResult,
} from "./theory-validate.js";

export {
  buildTheoryValidationSystemPrompt,
  buildTheoryValidationUserPrompt,
  THEORY_VALIDATION_PROMPT_VERSION,
  THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE,
} from "./theory-validation-prompts.js";

export {
  READING_GENERATION_PROMPT_VERSION,
  READING_GENERATION_SYSTEM_PROMPT,
  buildReadingGenerationSystemPrompt,
  buildReadingGenerationUserPrompt,
} from "./reading-generation-prompts.js";
export type { ReadingGenerationPromptInputs } from "./reading-generation-prompts.js";

export { scoreTextLevel } from "./reading-level-check.js";
export type { ScoreTextLevelInput, TextLevelScore } from "./reading-level-check.js";

export {
  READING_GENERATION_MODEL,
  READING_GENERATION_MAX_TOKENS,
  READING_GENERATION_TEMPERATURE,
  SUBMIT_READING_TEXT_TOOL,
  generateReadingText,
} from "./reading-generate.js";
export type {
  GenerateReadingTextInput,
  GenerateReadingTextResult,
} from "./reading-generate.js";

/**
 * Creates an Anthropic client instance configured with the provided API key.
 */
export function createClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

// ---------------------------------------------------------------------------
// Langfuse observability (Phase 1)
// ---------------------------------------------------------------------------

export {
  createObservedClaudeClient,
  withLlmTrace,
  getCurrentLlmTraceContext,
  setResolvedPromptVersion,
  setResolvedPromptClient,
  getLangfuse,
  flushObservability,
  LANGFUSE_FLUSH_TIMEOUT_MS,
  TOOL_NAME_TO_FEATURE,
  __resetForTests as __resetObservabilityForTests,
} from "./observability.js";
export type {
  LlmFeature,
  LlmEnv,
  LlmTraceContext,
} from "./observability.js";

// ---------------------------------------------------------------------------
// Langfuse prompt registry (Phase 2)
// ---------------------------------------------------------------------------

export {
  applyTemplate,
  getPromptOrFallback,
  getPromptWithVarsOrFallback,
  LANGFUSE_PROMPT_CACHE_TTL_MS,
  LANGFUSE_PROMPT_FETCH_TIMEOUT_MS,
  PROMPT_LABEL_PRODUCTION,
  __resetRegistryForTests,
} from "./prompts-registry.js";
export type { ResolvedPrompt } from "./prompts-registry.js";

export {
  buildCoverageSpecProposalUserPrompt,
  parseCoverageSpecProposal,
  proposeCoverageSpec,
  renderCoverageSpecSnippet,
  COVERAGE_SPEC_PROPOSAL_PROMPT_VERSION,
  COVERAGE_SPEC_PROPOSAL_SYSTEM_PROMPT_TEMPLATE,
  PROPOSE_COVERAGE_SPEC_TOOL,
  PROPOSE_COVERAGE_SPEC_TOOL_NAME,
} from "./coverage-spec-proposal.js";
export type { CoverageSpecProposal } from "./coverage-spec-proposal.js";

export {
  parseConjugationStructure,
  deriveConjugationStructure,
  buildConjugationBackfillUserPrompt,
  CONJUGATION_BACKFILL_PROMPT_VERSION,
  CONJUGATION_BACKFILL_SYSTEM_PROMPT,
  DERIVE_CONJUGATION_STRUCTURE_TOOL,
  DERIVE_CONJUGATION_STRUCTURE_TOOL_NAME,
} from "./conjugation-backfill.js";
export type {
  ConjugationCellDescriptor,
  ConjugationStructure,
} from "./conjugation-backfill.js";
