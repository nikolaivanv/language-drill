/**
 * packages/ai — Claude API client wrapper and prompt template registry.
 *
 * Provides the evaluation engine used by the submission route to score
 * user answers via Claude with structured tool-use output.
 */

import Anthropic from "@anthropic-ai/sdk";

export {
  EVALUATION_SYSTEM_PROMPT,
  buildUserPrompt,
  CEFR_LEVEL_DESCRIPTORS,
} from "./prompts.js";
export {
  evaluateAnswer,
  parseEvaluationResult,
  EVALUATION_TOOL,
  EVALUATION_TOOL_NAME,
} from "./evaluate.js";
export type { EvaluateAnswerInput } from "./evaluate.js";
export {
  ANNOTATE_SYSTEM_PROMPT,
  ANNOTATE_TOOL,
  ANNOTATE_TOOL_NAME,
  annotateText,
  parseAnnotateResult,
} from "./annotate.js";
export type { AnnotateInput, AnnotateOutput } from "./annotate.js";

export {
  GENERATION_MODEL,
  GENERATION_MAX_TOKENS,
  GENERATION_TEMPERATURE,
  TOOL_NAME_BY_TYPE,
  GENERATION_TOOL_BY_TYPE,
  CLOZE_GENERATION_TOOL,
  TRANSLATION_GENERATION_TOOL,
  VOCAB_RECALL_GENERATION_TOOL,
  generateBatch,
  exerciseDraftId,
  parseGeneratedClozeDraft,
  parseGeneratedTranslationDraft,
  parseGeneratedVocabRecallDraft,
} from "./generate.js";
export type {
  GenerationSpec,
  ExerciseDraft,
  GenerateBatchResult,
} from "./generate.js";

export {
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  canonicalSurface,
  tailRecentStems,
  MAX_RECENT_STEMS_IN_PROMPT,
} from "./generation-prompts.js";
export type { GenerationPromptInputs } from "./generation-prompts.js";

export {
  SONNET_4_5_PRICING,
  estimateCostUsd,
  addUsage,
  ZERO_USAGE,
} from "./cost-model.js";
export type { ClaudeUsageBreakdown } from "./cost-model.js";

/**
 * Creates an Anthropic client instance configured with the provided API key.
 */
export function createClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}
