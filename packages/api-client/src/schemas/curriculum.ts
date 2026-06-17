import { z } from 'zod';

export const CoverageAxisSchema = z.object({
  name: z.string(),
  floors: z.record(z.string(), z.number()),
});

export const CurriculumEntrySchema = z.object({
  key: z.string(),
  kind: z.enum(['grammar', 'vocab', 'dictation', 'free-writing']),
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
