import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
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

  // Claim the invite, then boost the user — atomically. The claim is a
  // conditional UPDATE … WHERE used_by IS NULL whose affected rows are read
  // via `.returning()`: if a concurrent redemption won the race between our
  // SELECT above and this write, the claim matches zero rows and we bail with
  // 409 instead of boosting on a code we never actually consumed. Wrapping
  // both writes in one transaction also closes the "invite consumed but plan
  // not boosted" partial-failure path the previous two-write version had.
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .update(invitations)
      .set({ usedBy: userId, usedAt: new Date() })
      .where(and(eq(invitations.id, invite.id), isNull(invitations.usedBy)))
      .returning({ id: invitations.id });

    if (rows.length === 0) {
      // Lost the race — another user claimed this code first. Nothing was
      // written (the conditional UPDATE matched no rows), so there's nothing
      // to roll back; returning early simply commits an empty transaction.
      return false;
    }

    await tx
      .update(users)
      .set({ plan: 'boosted', updatedAt: new Date() })
      .where(eq(users.id, userId));
    return true;
  });

  if (!claimed) {
    return c.json({ error: 'Invite already used', code: 'INVITE_USED', kind: 'used' }, 409);
  }

  return c.json(boostedLimitsPayload(), 200);
});

export default invites;
