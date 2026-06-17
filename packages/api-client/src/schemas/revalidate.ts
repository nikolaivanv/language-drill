import { z } from 'zod';

export type RevalidateRequest = {
  language: string;
  level: string;
  type: string;
  grammarPoint: string;
  apply: boolean;
};

export const RevalidateResponseSchema = z.object({
  apply: z.boolean(),
  scanned: z.number(),
  noChange: z.number(),
  demotedToFlagged: z.number(),
  demotedToRejected: z.number(),
  skipped: z.number(),
  skipReasons: z.record(z.string(), z.number()),
  estCostUsd: z.number(),
  truncated: z.boolean(),
  totalCandidates: z.number(),
  demotions: z.array(
    z.object({
      id: z.string(),
      from: z.string(),
      to: z.string(),
      reasons: z.array(z.string()),
    }),
  ),
});
export type RevalidateResponse = z.infer<typeof RevalidateResponseSchema>;
