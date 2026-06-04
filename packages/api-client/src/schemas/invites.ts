import { z } from 'zod';

export const RedeemResponseSchema = z.object({
  plan: z.literal('boosted'),
  limits: z.object({
    evaluation: z.number(),
    annotation: z.number(),
    deepSpan: z.number(),
  }),
});
export type RedeemResponse = z.infer<typeof RedeemResponseSchema>;

export const AdminInviteSchema = z.object({
  id: z.string(),
  code: z.string(),
  usedBy: z.string().nullable(),
  usedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string().nullable(),
  status: z.enum(['unused', 'redeemed', 'expired', 'revoked']),
});
export const AdminInvitesResponseSchema = z.object({
  items: z.array(AdminInviteSchema),
});
export type AdminInvite = z.infer<typeof AdminInviteSchema>;

export const CreateInvitesResponseSchema = z.object({
  codes: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      expiresAt: z.string().nullable(),
      note: z.string().nullable(),
    }),
  ),
});
export type CreateInvitesResponse = z.infer<typeof CreateInvitesResponseSchema>;
