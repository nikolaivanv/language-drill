import { z } from 'zod';
import { FreeWritingEvaluationSchema, type FreeWritingEvaluationResponse } from './exercise';

// GET /free-writing/history — one summary row per graded free-writing attempt.
// Every field read out of the stored evaluation / prompt is nullable: rows
// written by older evaluator versions may lack them.
export const FreeWritingHistoryItemSchema = z.object({
  id: z.string(),
  exerciseId: z.string().nullable(),
  evaluatedAt: z.string().nullable(),
  language: z.string().nullable(),
  difficulty: z.string().nullable(),
  title: z.string().nullable(),
  score: z.number().nullable(),
  overallCefr: z.string().nullable(),
  headline: z.string().nullable(),
  wordCount: z.number().nullable(),
});

export type FreeWritingHistoryItem = z.infer<typeof FreeWritingHistoryItemSchema>;

export const FreeWritingHistoryPageSchema = z.object({
  items: z.array(FreeWritingHistoryItemSchema),
  nextCursor: z.string().nullable(),
});

export type FreeWritingHistoryPage = z.infer<typeof FreeWritingHistoryPageSchema>;

// GET /free-writing/history/:submissionId — the stored essay, evaluation and
// prompt. `evaluation` and `content` stay `unknown` here so one attempt saved
// in an outdated shape does not fail the request; parse the evaluation with
// `parseStoredFreeWritingEvaluation` and degrade per attempt.
export const FreeWritingAttemptSchema = z.object({
  id: z.string(),
  exerciseId: z.string().nullable(),
  evaluatedAt: z.string().nullable(),
  language: z.string().nullable(),
  difficulty: z.string().nullable(),
  content: z.unknown(),
  userAnswer: z.string().nullable(),
  evaluation: z.unknown(),
});

export type FreeWritingAttempt = z.infer<typeof FreeWritingAttemptSchema>;

/** The stored evaluation if it still matches today's schema, else null. */
export function parseStoredFreeWritingEvaluation(
  value: unknown,
): FreeWritingEvaluationResponse | null {
  const parsed = FreeWritingEvaluationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
