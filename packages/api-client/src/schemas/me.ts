import { z } from 'zod';

const LimitsSchema = z.object({
  evaluation: z.number(),
  annotation: z.number(),
  deepSpan: z.number(),
});

export const MeResponseSchema = z.object({
  plan: z.enum(['free', 'boosted']),
  isAdmin: z.boolean(),
  limits: LimitsSchema,
  usageToday: LimitsSchema,
});

export type MeResponse = z.infer<typeof MeResponseSchema>;
