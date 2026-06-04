import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { invitations, users } from '@language-drill/db';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import { limitFor } from '../usage/limits';

const RedeemSchema = z.object({
  // Codes are canonically uppercase alphanumeric, 8 chars (the admin generator
  // and the dev seed script both emit uppercase). We normalize the submitted
  // code to uppercase so a user who types lowercase still matches, then do an
  // exact DB lookup.
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{8}$/),
});

function boostedLimitsPayload() {
  return {
    plan: 'boosted' as const,
    limits: {
      evaluation: limitFor('ai_evaluation', 'boosted'),
      annotation: limitFor('read_annotation', 'boosted'),
      deepSpan: limitFor('read_span_annotation', 'boosted'),
    },
  };
}

const invites = new Hono<{ Bindings: Bindings; Variables: Variables }>();

invites.use('/invites/*', authMiddleware);

invites.post('/invites/redeem', async (c) => {
  const userId = c.get('userId');
  const parsed = RedeemSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid code', code: 'VALIDATION_ERROR', kind: 'invalid' }, 400);
  }
  const { code } = parsed.data;

  const [invite] = await db
    .select({
      id: invitations.id,
      usedBy: invitations.usedBy,
      revokedAt: invitations.revokedAt,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(eq(invitations.code, code))
    .limit(1);

  // Not-found and revoked deliberately collapse into one opaque response so we
  // don't confirm to a submitter that a revoked code ever existed.
  if (!invite || invite.revokedAt) {
    return c.json({ error: 'Invite not found', code: 'INVITE_INVALID', kind: 'invalid' }, 404);
  }
  if (invite.usedBy && invite.usedBy === userId) {
    // Idempotent: this user already redeemed it.
    return c.json(boostedLimitsPayload(), 200);
  }
  if (invite.usedBy) {
    return c.json({ error: 'Invite already used', code: 'INVITE_USED', kind: 'used' }, 409);
  }
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    return c.json({ error: 'Invite expired', code: 'INVITE_EXPIRED', kind: 'expired' }, 410);
  }

  // Claim the invite, then boost the user. Two small writes, no transaction: a
  // race where two users submit the same fresh code is bounded by the per-user
  // 10x limit, and if the second write fails the invite is consumed without the
  // plan being set (support can fix manually). Acceptable at this scale (single
  // inviter, low volume).
  await db
    .update(invitations)
    .set({ usedBy: userId, usedAt: new Date() })
    .where(eq(invitations.id, invite.id));
  await db
    .update(users)
    .set({ plan: 'boosted', updatedAt: new Date() })
    .where(eq(users.id, userId));

  return c.json(boostedLimitsPayload(), 200);
});

export default invites;
