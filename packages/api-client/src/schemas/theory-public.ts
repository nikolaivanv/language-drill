import { z } from 'zod';

/**
 * Wire schemas for the two unauthenticated theory endpoints.
 *
 * NOTE what is deliberately absent: a Zod mirror of `TheoryBlockJson`. The
 * article taxonomy has exactly one validator — `parseTheoryTopicJson` in
 * `@language-drill/shared` — and a second definition here would be free to
 * drift from it. So `sections` is passed through as unknown-shaped data and the
 * page hands the whole object to `parseTheoryTopicJson`; these schemas validate
 * the ENVELOPE the public route adds around it.
 */

export const PublicTopicSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  cefr: z.string().min(1),
  subtitle: z.string().min(1),
  category: z.string().min(1),
  order: z.number().int().nullable(),
  hasConjugationDrill: z.boolean(),
});

export const PublicTopicListResponseSchema = z.object({
  topics: z.array(PublicTopicSummarySchema),
});

export const RelatedTopicRefSchema = z.object({
  topicId: z.string().min(1),
  title: z.string().min(1),
  cefr: z.string().min(1),
});

export const RelatedTheoryTopicsSchema = z.object({
  buildsOn: z.array(RelatedTopicRefSchema),
  leadsTo: z.array(RelatedTopicRefSchema),
  siblings: z.array(RelatedTopicRefSchema),
});

export const QuickCheckItemSchema = z.object({
  sentence: z.string().min(1),
  instructions: z.string().min(1),
  correctAnswer: z.string().min(1),
  acceptableAnswers: z.array(z.string()),
  topicHint: z.string().optional(),
});

export const PublicTopicEnvelopeSchema = z
  .object({
    related: RelatedTheoryTopicsSchema,
    hasConjugationDrill: z.boolean(),
    quickCheck: z.array(QuickCheckItemSchema),
  })
  .passthrough();

export type PublicTopicSummary = z.infer<typeof PublicTopicSummarySchema>;
export type PublicTopicListResponse = z.infer<typeof PublicTopicListResponseSchema>;
export type QuickCheckItem = z.infer<typeof QuickCheckItemSchema>;
export type RelatedTheoryTopicsWire = z.infer<typeof RelatedTheoryTopicsSchema>;
export type PublicTopicEnvelope = z.infer<typeof PublicTopicEnvelopeSchema>;
