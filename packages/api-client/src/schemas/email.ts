import { z } from 'zod';

export const EmailPreferencesSchema = z.object({
  weeklySummary: z.enum(['off', 'pending', 'confirmed']),
});

export type EmailPreferences = z.infer<typeof EmailPreferencesSchema>;

export const UpdateWeeklySummaryInputSchema = z.object({ enabled: z.boolean() });
export type UpdateWeeklySummaryInput = z.infer<typeof UpdateWeeklySummaryInputSchema>;
