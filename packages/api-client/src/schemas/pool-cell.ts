import { z } from 'zod';

export const PoolCellDetailSchema = z.object({
  floors: z.record(z.string(), z.record(z.string(), z.number())),
  rejectionReasonCounts: z.record(z.string(), z.number()),
});
export type PoolCellDetail = z.infer<typeof PoolCellDetailSchema>;

export type PoolCellQuery = {
  language: string;
  level: string;
  type: string;
  grammarPoint: string;
};
