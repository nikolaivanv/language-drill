import { z } from 'zod';
import { VOCAB_GROUP_LABELS } from '@language-drill/shared';

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
  // Words practiced to a strong best score. Defaulted so a response from an
  // API deployed before the field existed still parses.
  strong: z.number().int().min(0).default(0),
  // Word-class group tag ("verbs", "connectors" ...) or null for a themed topic.
  // Defaulted so a response from an API deployed before the field still parses.
  group: z.enum(VOCAB_GROUP_LABELS).nullable().default(null),
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
