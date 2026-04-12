import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  ts: z.number(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
