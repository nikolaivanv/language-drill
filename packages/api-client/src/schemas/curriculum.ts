import { z } from 'zod';
import { LearningLanguageEnum } from './preferences';

export const CoverageAxisSchema = z.object({
  name: z.string(),
  floors: z.record(z.string(), z.number()),
});

export const CurriculumEntrySchema = z.object({
  key: z.string(),
  kind: z.enum(['grammar', 'vocab', 'dictation', 'free-writing', 'paraphrase']),
  name: z.string(),
  description: z.string(),
  cefrLevel: z.enum(['A1', 'A2', 'B1', 'B2']),
  language: z.enum(['ES', 'DE', 'TR']),
  examplesPositive: z.array(z.string()),
  examplesNegative: z.array(z.string()),
  commonErrors: z.array(z.string()),
  prerequisiteKeys: z.array(z.string()),
  targetOverride: z.number().nullable(),
  clozeUnsuitable: z.boolean(),
  sentenceConstructionSuitable: z.boolean(),
  conjugationSuitable: z.boolean(),
  coverageSpec: z.object({ axes: z.array(CoverageAxisSchema) }).nullable(),
  freeWritingRegister: z.enum(['informal', 'neutral', 'formal']).nullable(),
  exerciseTypes: z.array(z.string()),
});
export type CurriculumEntry = z.infer<typeof CurriculumEntrySchema>;

export const CurriculumResponseSchema = z.object({
  items: z.array(CurriculumEntrySchema),
  total: z.number(),
  curriculumVersionByLanguage: z.object({ ES: z.string(), DE: z.string(), TR: z.string() }),
});
export type CurriculumResponse = z.infer<typeof CurriculumResponseSchema>;

// ---------------------------------------------------------------------------
// GET /progress/curriculum response (curriculum map)
// ---------------------------------------------------------------------------

export const PointStateEnum = z.enum(['not-started', 'learning', 'solid']);
export type PointState = z.infer<typeof PointStateEnum>;

export const CurriculumMapPointSchema = z.object({
  key: z.string(),
  name: z.string(),
  cefrLevel: z.string(),
  order: z.number().int(),
  state: PointStateEnum,
  errorProne: z.boolean(),
  mastery: z.number().min(0).max(1).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  evidenceCount: z.number().int().min(0),
  lastPracticedAt: z.string().datetime().nullable(),
  recentErrorCount: z.number().int().min(0),
  prereqKeys: z.array(z.string()),
  prereqNames: z.array(z.string()),
  prereqUnmet: z.boolean(),
  compatibleTypes: z.array(z.string()),
  hasTheory: z.boolean(),
  errorSample: z.object({ wrongText: z.string(), correction: z.string() }).nullable(),
});
export type CurriculumMapPoint = z.infer<typeof CurriculumMapPointSchema>;

export const CurriculumMapLevelSchema = z.object({
  level: z.string(),
  solidCount: z.number().int().min(0),
  total: z.number().int().min(0),
  readyToAdvance: z.boolean(),
  isPreview: z.boolean(),
  points: z.array(CurriculumMapPointSchema),
});
export type CurriculumMapLevel = z.infer<typeof CurriculumMapLevelSchema>;

export const CurriculumMapResponseSchema = z.object({
  language: LearningLanguageEnum,
  activeLevel: z.string(),
  levels: z.array(CurriculumMapLevelSchema),
});
export type CurriculumMapResponse = z.infer<typeof CurriculumMapResponseSchema>;
