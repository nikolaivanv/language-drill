import { z } from 'zod';

export const CoverageStateSchema = z.enum([
  'not-yet',
  'untested',
  'practiced-weak',
  'practiced-strong',
]);
export type CoverageState = z.infer<typeof CoverageStateSchema>;

export const VocabTopicSummarySchema = z.object({
  umbrellaKey: z.string(),
  name: z.string(),
  cefrLevel: z.string(),
  wordCount: z.number().int().min(0),
  available: z.number().int().min(0),
  practiced: z.number().int().min(0),
});
export type VocabTopicSummary = z.infer<typeof VocabTopicSummarySchema>;

export const VocabTopicsResponseSchema = z.object({
  topics: z.array(VocabTopicSummarySchema),
});
export type VocabTopicsResponse = z.infer<typeof VocabTopicsResponseSchema>;

export const VocabWordSchema = z.object({
  lemma: z.string(),
  displayForm: z.string(),
  gloss: z.string(),
  exampleSentence: z.string(),
  freqRank: z.number().int().nullable(),
  tier: z.string(),
  state: CoverageStateSchema,
});
export type VocabWord = z.infer<typeof VocabWordSchema>;

export const VocabTopicDetailSchema = z.object({
  umbrellaKey: z.string(),
  name: z.string(),
  cefrLevel: z.string(),
  words: z.array(VocabWordSchema),
});
export type VocabTopicDetail = z.infer<typeof VocabTopicDetailSchema>;
