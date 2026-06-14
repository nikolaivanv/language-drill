import { z } from 'zod';

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
});

export type EvaluationResultResponse = z.infer<typeof EvaluationResultSchema>;

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
});

export type FreeWritingEvaluationResponse = z.infer<typeof FreeWritingEvaluationSchema>;
