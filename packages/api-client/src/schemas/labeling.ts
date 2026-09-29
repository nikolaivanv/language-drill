import { z } from 'zod';
import { LABEL_STRATA, LABEL_TAGS } from '@language-drill/shared';

export const LabelTagEnum = z.enum(LABEL_TAGS);
export type LabelTagValue = z.infer<typeof LabelTagEnum>;

export const LabelStratumEnum = z.enum(LABEL_STRATA);
export type LabelStratumValue = z.infer<typeof LabelStratumEnum>;

export const LabelQueueItemSchema = z.object({
  submissionId: z.string(),
  exerciseId: z.string(),
  language: z.string().nullable(),
  cefrLevel: z.string().nullable(),
  exerciseType: z.string().nullable(),
  grammarPointKey: z.string().nullable(),
  learnerView: z.string(),
  referenceAnswers: z.record(z.unknown()),
  userAnswer: z.unknown(),
  evaluation: z.unknown(),
  score: z.number().nullable(),
  evaluatedAt: z.string().nullable(),
  optionsRevealed: z.boolean(),
});
export type LabelQueueItem = z.infer<typeof LabelQueueItemSchema>;

export const LabelQueueResponseSchema = z.object({
  items: z.array(LabelQueueItemSchema),
  remaining: z.number(),
  // Count of rows the server could not render (renderLearnerView threw — a
  // stale row, a renamed type, or an exercises.type / content_json.type
  // mismatch) and therefore omitted from `items`. Required, not defaulted:
  // those rows still count toward `remaining` and the queue's stable md5
  // order means they sit at the same position on every refresh, so a client
  // that silently defaulted a missing `dropped` to 0 would reintroduce the
  // exact invisibility (empty page, large `remaining`, no explanation) the
  // field exists to fix.
  dropped: z.number(),
});
export type LabelQueueResponse = z.infer<typeof LabelQueueResponseSchema>;

export const SaveLabelResponseSchema = z.object({
  saved: z.literal(true),
  promptVersion: z.string(),
});

export const LabelingStatsSchema = z.object({
  strata: z.array(
    z.object({
      stratum: z.string(),
      count: z.number(),
      gradeOkRate: z.number(),
      feedbackOkRate: z.number(),
    }),
  ),
  tags: z.array(z.object({ tag: LabelTagEnum, count: z.number() })),
  labeledToday: z.number(),
});
export type LabelingStats = z.infer<typeof LabelingStatsSchema>;
