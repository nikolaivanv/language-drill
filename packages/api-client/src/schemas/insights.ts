import { z } from 'zod';

export const InsightsErrorThemeSchema = z.object({
  grammarPointKey: z.string().nullable(),
  grammarPointName: z.string().nullable(),
  errorType: z.string(),
  count: z.number().int().min(0),
  majorCount: z.number().int().min(0),
  lastOccurredAt: z.string().datetime(),
  sample: z.object({
    wrongText: z.string(),
    correction: z.string(),
  }),
  score: z.number(),
});

export const InsightsErrorsResponseSchema = z.object({
  themes: z.array(InsightsErrorThemeSchema),
});

export type InsightsErrorTheme = z.infer<typeof InsightsErrorThemeSchema>;
export type InsightsErrorsResponse = z.infer<typeof InsightsErrorsResponseSchema>;
