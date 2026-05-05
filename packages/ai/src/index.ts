/**
 * packages/ai — Claude API client wrapper and prompt template registry.
 *
 * Provides the evaluation engine used by the submission route to score
 * user answers via Claude with structured tool-use output.
 */

import Anthropic from "@anthropic-ai/sdk";

export { EVALUATION_SYSTEM_PROMPT, buildUserPrompt } from "./prompts.js";
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

/**
 * Creates an Anthropic client instance configured with the provided API key.
 */
export function createClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}
