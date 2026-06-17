import { z } from 'zod';

export const CapacityResponseSchema = z.object({
  killSwitch: z.boolean(),
  globalDailyCap: z.number().nullable(),
  usage24h: z.object({
    total: z.number(),
    byEventType: z.array(z.object({ eventType: z.string(), count: z.number() })),
  }),
  topConsumers: z.array(z.object({ userId: z.string(), count: z.number() })),
});
export type CapacityResponse = z.infer<typeof CapacityResponseSchema>;
