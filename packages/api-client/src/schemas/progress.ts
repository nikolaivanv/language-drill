import { z } from 'zod';
import { LearningLanguageEnum } from './preferences';

// ---------------------------------------------------------------------------
// Radar axis keys — fixed taxonomy mirrored on the Lambda side
// (see infra/lambda/src/lib/progress-aggregation.ts)
// ---------------------------------------------------------------------------

export const RadarAxisKeyEnum = z.enum([
  'listening',
  'reading',
  'speaking',
  'writing',
  'grammar',
  'vocabulary',
]);

export type RadarAxisKey = z.infer<typeof RadarAxisKeyEnum>;

// ---------------------------------------------------------------------------
// GET /progress/radar response
// ---------------------------------------------------------------------------

export const RadarAxisSchema = z.object({
  key: RadarAxisKeyEnum,
  label: z.string(),
  currentMastery: z.number().min(0).max(1),
  previousMastery: z.number().min(0).max(1),
  lastPracticedAt: z.string().datetime().nullable(),
  evidenceCount: z.number().int().min(0),
});

export type RadarAxis = z.infer<typeof RadarAxisSchema>;

export const ProgressRadarResponseSchema = z.object({
  language: LearningLanguageEnum,
  axes: z.array(RadarAxisSchema).length(6),
});

export type ProgressRadarResponse = z.infer<typeof ProgressRadarResponseSchema>;

// ---------------------------------------------------------------------------
// GET /progress/heatmap response
// ---------------------------------------------------------------------------

export const HeatmapTopicSchema = z.object({
  topicId: z.string().min(1),
  name: z.string().min(1),
  mastery: z.number().min(0).max(1),
  cells: z.array(z.number().int().min(0)).length(30),
});

export type HeatmapTopic = z.infer<typeof HeatmapTopicSchema>;

export const ShadeThresholdsSchema = z.object({
  paper2: z.number().int().min(1),
  accentSoft: z.number().int().min(1),
  accent: z.number().int().min(1),
});

export type ShadeThresholds = z.infer<typeof ShadeThresholdsSchema>;

export const ProgressHeatmapResponseSchema = z.object({
  language: LearningLanguageEnum,
  days: z.literal(30),
  topics: z.array(HeatmapTopicSchema).max(8),
  shadeThresholds: ShadeThresholdsSchema,
});

export type ProgressHeatmapResponse = z.infer<
  typeof ProgressHeatmapResponseSchema
>;
