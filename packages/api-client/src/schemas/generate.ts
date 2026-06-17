import { z } from 'zod';

export type GenerateCellRequest = {
  language: string;
  level: string;
  type: string;
  grammarPoint: string;
  count: number;
};

export const GenerateCellResponseSchema = z.object({
  jobId: z.string(),
  status: z.literal('queued'),
});
export type GenerateCellResponse = z.infer<typeof GenerateCellResponseSchema>;
