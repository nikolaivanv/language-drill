import { z } from 'zod';

export const ErrorTrendThemeSchema = z.object({
  grammarPointKey: z.string().nullable(),
  grammarPointName: z.string().nullable(),
  errorType: z.string(),
  sample: z.object({ wrongText: z.string(), correction: z.string() }),
  firstSeen: z.string().datetime(),
  lastSeen: z.string().datetime(),
  totalErrors: z.number().int().min(0),
  weeklyErrors: z.array(z.number().int().min(0)),
  status: z.enum(['recurring', 'improving', 'quiet']),
  lastSeenDaysAgo: z.number().int().min(0),
  fromRatePct: z.number().nullable(),
  toRatePct: z.number().nullable(),
  quietWeeks: z.number().int().nullable(),
});

export const ErrorTrendsResponseSchema = z.object({
  themes: z.array(ErrorTrendThemeSchema),
});

export type ErrorTrendTheme = z.infer<typeof ErrorTrendThemeSchema>;
export type ErrorTrendsResponse = z.infer<typeof ErrorTrendsResponseSchema>;
