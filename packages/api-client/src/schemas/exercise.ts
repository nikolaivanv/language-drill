import { z } from 'zod';
import { CefrLevel } from '@language-drill/shared';

// Exercise response from GET /exercises and GET /exercises/:id
export const ExerciseResponseSchema = z.object({
  id: z.string(),
  type: z.string(),
  language: z.string(),
  difficulty: z.string(),
  // Nullable: the DB column is `text` nullable. Vocab-recall and other
  // grammar-agnostic exercise types omit it; theory-trigger lookups
  // gracefully no-op when null.
  grammarPointKey: z.string().nullable(),
  contentJson: z.unknown(),
});

export type ExerciseResponse = z.infer<typeof ExerciseResponseSchema>;

// Response from GET /exercises/set — a pre-composed, distinct-by-content set of
// exercises for a single sitting (no in-session repeats). `available` is the
// number of distinct items returned (≤ requested count).
export const ExerciseSetResponseSchema = z.object({
  exercises: z.array(ExerciseResponseSchema),
  available: z.number().int().nonnegative(),
  // The difficulty the set was ACTUALLY pulled at. For a grammarPoint-targeted
  // request the server derives it from the point's own CEFR level, which can
  // differ from the requested (profile) difficulty. Optional so a client built
  // against this schema stays compatible with an already-deployed API that
  // predates this field (Vercel preview deploys point at the live API).
  difficulty: z.nativeEnum(CefrLevel).optional(),
});

export type ExerciseSetResponse = z.infer<typeof ExerciseSetResponseSchema>;

// Error in evaluation
const EvaluationErrorSchema = z.object({
  type: z.enum(['grammar', 'vocabulary', 'spelling', 'pragmatics']),
  severity: z.enum(['minor', 'major']),
  text: z.string(),
  correction: z.string(),
  explanation: z.string(),
});

// Evaluation result from POST /exercises/:id/submit
export const EvaluationResultSchema = z.object({
  score: z.number().min(0).max(1),
  grammarAccuracy: z.number().min(0).max(1),
  vocabularyRange: z.string(),
  taskAchievement: z.number().min(0).max(1),
  feedback: z.string(),
  errors: z.array(EvaluationErrorSchema),
  estimatedCefrEvidence: z.string(),
  evaluationSource: z.enum(['deterministic', 'llm']).optional(),
  submissionId: z.string().uuid().optional(),
});

export type EvaluationResultResponse = z.infer<typeof EvaluationResultSchema>;

// Dictation result schemas
const DictationDiffSegmentSchema = z.union([
  z.object({ kind: z.literal('match'), text: z.string() }),
  z.object({ kind: z.literal('error'), id: z.number(), got: z.string(), expected: z.string(), severity: z.enum(['low', 'high']) }),
  z.object({ kind: z.literal('accepted'), id: z.number(), got: z.string(), expected: z.string() }),
]);

const DictationDifferenceSchema = z.object({
  id: z.number(),
  kind: z.enum(['error', 'accepted']),
  category: z.string(),
  severity: z.enum(['low', 'high']).nullable(),
  got: z.string(),
  expected: z.string(),
  note: z.string(),
});

const DictationCriterionSchema = z.object({
  id: z.string(),
  label: z.string(),
  score: z.number(),
  cefr: z.string(),
  note: z.string(),
});

export const DictationResultSchema = z.object({
  kind: z.literal('dictation'),
  score: z.number().min(0).max(1),
  grammarAccuracy: z.number().min(0).max(1),
  vocabularyRange: z.string(),
  taskAchievement: z.number().min(0).max(1),
  feedback: z.string(),
  errors: z.array(EvaluationErrorSchema),
  estimatedCefrEvidence: z.string(),
  evaluationSource: z.enum(['deterministic', 'llm']).optional(),
  rawCharAccuracy: z.number().min(0).max(1),
  adjustedCharAccuracy: z.number().min(0).max(1),
  wordAccuracy: z.number().min(0).max(1),
  listeningCefr: z.string(),
  headline: z.string(),
  summary: z.string(),
  diff: z.array(DictationDiffSegmentSchema),
  differences: z.array(DictationDifferenceSchema),
  criteria: z.array(DictationCriterionSchema),
  submissionId: z.string().uuid().optional(),
});

export type DictationResultResponse = z.infer<typeof DictationResultSchema>;

export type SubmitResultResponse = EvaluationResultResponse | DictationResultResponse;

/** Routes a raw submit response to the right schema by its `kind` discriminator. */
export function parseSubmitResult(json: unknown): SubmitResultResponse {
  if (json !== null && typeof json === 'object' && (json as { kind?: unknown }).kind === 'dictation') {
    return DictationResultSchema.parse(json);
  }
  return EvaluationResultSchema.parse(json);
}

// Generic API error response
export const ApiErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  details: z.unknown().optional(),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorSchema>;

// Free Writing evaluation from POST /exercises/:id/submit (free_writing type)
const FreeWritingCriterionSchema = z.object({
  id: z.enum(['task', 'coherence', 'lexis', 'grammar']),
  label: z.string(),
  score: z.number().min(0).max(1),
  cefr: z.string(),
  note: z.string(),
});

const FreeWritingErrorSchema = z.object({
  n: z.number(),
  severity: z.enum(['high', 'med', 'low']),
  type: z.string(),
  original: z.string(),
  correction: z.string(),
  where: z.string().optional(),
  note: z.string(),
});

export const FreeWritingEvaluationSchema = z.object({
  overallScore: z.number().min(0).max(1),
  overallCefr: z.string(),
  headline: z.string(),
  summary: z.string(),
  criteria: z.array(FreeWritingCriterionSchema),
  errors: z.array(FreeWritingErrorSchema),
  goodSpans: z.array(z.string()),
  improved: z.object({ text: z.string(), upgrades: z.array(z.string()).optional() }),
  wordCount: z.number(),
  improvedWordCount: z.number(),
  submissionId: z.string().uuid().optional(),
});

export type FreeWritingEvaluationResponse = z.infer<typeof FreeWritingEvaluationSchema>;

// Response from POST /exercises/:id/submissions/:submissionId/explain
export const ExplainResponseSchema = z.object({ explanation: z.string() });

export type ExplainResponse = z.infer<typeof ExplainResponseSchema>;

// Response from POST /exercises/:id/word-hints (translation click-to-reveal hints)
export const WordHintUnitSchema = z.object({
  text: z.string(),
  hintable: z.boolean(),
  lemma: z.string().optional(),
});

export const WordHintsResponseSchema = z.object({
  units: z.array(WordHintUnitSchema),
  cached: z.boolean(),
});

export type WordHintsResponse = z.infer<typeof WordHintsResponseSchema>;
