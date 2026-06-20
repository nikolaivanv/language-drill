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

