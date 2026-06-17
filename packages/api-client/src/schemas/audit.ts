import { z } from 'zod';

export const AuditEntrySchema = z.object({
  id: z.string(),
  adminUserId: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  metadata: z.unknown(),
  createdAt: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditLogResponseSchema = z.object({
  items: z.array(AuditEntrySchema),
  total: z.number(),
});

export type AuditQuery = {
  action?: string;
  targetType?: string;
  adminUserId?: string;
  limit?: number;
  offset?: number;
};
