import { Hono } from 'hono';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { Webhook } from 'svix';

import { db } from '../../db';
import { users, invitations } from '@language-drill/db';

interface ClerkUserCreatedEvent {
  type: 'user.created';
  data: {
    id: string;
    email_addresses: Array<{ email_address: string }>;
    first_name?: string | null;
    last_name?: string | null;
  };
}

interface ClerkUserUpdatedEvent {
  type: 'user.updated';
  data: {
    id: string;
    email_addresses: Array<{ email_address: string }>;
    first_name?: string | null;
    last_name?: string | null;
  };
}

interface ClerkUserDeletedEvent {
  type: 'user.deleted';
  data: {
    // Clerk sends the deleted user's id plus `deleted: true`. `id` can be
    // absent for some deletion variants (e.g. a never-synced user), so it's
    // optional here and guarded at the handler.
    id?: string;
    deleted?: boolean;
  };
}

// Discriminated union of the events we act on. Other event types may arrive if
// the dashboard subscription is widened; none of the handler branches match, so
// they're acknowledged with 200 and ignored. (Kept a clean discriminated union
// — no `{ type: string }` catch-all member, which would defeat narrowing.)
type ClerkWebhookEvent = ClerkUserCreatedEvent | ClerkUserUpdatedEvent | ClerkUserDeletedEvent;

/**
 * Free an email address from any defunct `users` row that still holds it under a
 * different id, so the incoming (live) user can claim it.
 *
 * Clerk enforces primary-email uniqueness among LIVE users, so a row with this
 * email under a different id is always a deleted-then-recreated account whose
 * `user.deleted` webhook was missed or raced (common during invite testing).
 * Left in place, its `NOT NULL UNIQUE` email blocks the new user's email from
 * ever syncing — every upsert fails with `23505 users_email_unique`, and any
 * email-sending path then sees the un-synced placeholder. Erase it exactly like
 * the `user.deleted` branch: null the FK-less `invitations.usedBy`, then delete
 * (the ON DELETE CASCADE FKs sweep the stale account's dependent rows).
 */
async function reclaimEmail(email: string, keepId: string): Promise<void> {
  const stale = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), ne(users.id, keepId)));
  if (stale.length === 0) return;
  const staleIds = stale.map((r) => r.id);
  await db
    .update(invitations)
    .set({ usedBy: null, usedAt: null })
    .where(inArray(invitations.usedBy, staleIds));
  await db.delete(users).where(inArray(users.id, staleIds));
}

const webhooks = new Hono();

webhooks.post('/webhooks/clerk', async (c) => {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return c.json({ error: 'Webhook secret not configured' }, 500);
  }

  const svixId = c.req.header('svix-id');
  const svixTimestamp = c.req.header('svix-timestamp');
  const svixSignature = c.req.header('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return c.json({ error: 'Missing svix headers' }, 400);
  }

  const body = await c.req.text();

  let event: ClerkWebhookEvent;
  try {
    const wh = new Webhook(webhookSecret);
    event = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkWebhookEvent;
  } catch {
    return c.json({ error: 'Invalid webhook signature' }, 400);
  }

  if (event.type === 'user.created') {
    const { id: userId, email_addresses, first_name, last_name } = event.data;
    const email = email_addresses[0]?.email_address;

    if (!email) {
      return c.json({ error: 'No email address in event' }, 400);
    }

    // Reclaim the email from any defunct account before upserting, otherwise the
    // upsert below fails with a unique violation.
    await reclaimEmail(email, userId);

    // Upsert user row. New users default to the 'free' plan (the
    // `users.plan` column default handles this — no explicit set needed).
    // Invites are no longer auto-claimed here; they are redeemed explicitly
    // via POST /invites/redeem to upgrade the user's plan.
    await db
      .insert(users)
      .values({ id: userId, email, firstName: first_name ?? null, lastName: last_name ?? null })
      .onConflictDoUpdate({
        target: users.id,
        set: { email, firstName: first_name ?? null, lastName: last_name ?? null, updatedAt: new Date() },
      });
  } else if (event.type === 'user.updated') {
    const { id: userId, email_addresses, first_name, last_name } = event.data;
    const email = email_addresses[0]?.email_address;
    // Same reclaim as user.created: a re-pointed email may now collide with a
    // defunct row's address.
    if (email) await reclaimEmail(email, userId);
    await db
      .update(users)
      .set({
        ...(email ? { email } : {}),
        firstName: first_name ?? null,
        lastName: last_name ?? null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  } else if (event.type === 'user.deleted') {
    // Right-to-erasure: delete the user row. Every user FK is ON DELETE
    // CASCADE, so this one delete sweeps every PII-adjacent row for the account
    // (migration 0021 backfilled five legacy FKs that predated the cascade
    // convention; 0025 added practice_sessions, which 0021 missed; 0033 added
    // read_entries and user_grammar_mastery, which were still NO ACTION and
    // would otherwise fail this delete with a FK violation — see the same fix
    // relied on by reclaimEmail above).
    // invitations.usedBy is a plain nullable text column (no FK, no cascade),
    // so the redeemer reference must be nulled explicitly before the user
    // delete to honor the right-to-erasure guarantee.
    const userId = event.data.id;
    if (!userId) {
      return c.json({ error: 'No user id in event' }, 400);
    }
    // Null usedAt too, not just usedBy: a freed code should read as fully
    // available (a stale usedAt with no usedBy looks "used" in the admin list,
    // even though the redeem path only gates on usedBy).
    await db
      .update(invitations)
      .set({ usedBy: null, usedAt: null })
      .where(eq(invitations.usedBy, userId));
    await db.delete(users).where(eq(users.id, userId));
  }

  return c.json({ received: true }, 200);
});

export default webhooks;
