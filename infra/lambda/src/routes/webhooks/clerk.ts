import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { Webhook } from 'svix';

import { db } from '../../db';
import { users } from '@language-drill/db';

interface ClerkUserCreatedEvent {
  type: 'user.created';
  data: {
    id: string;
    email_addresses: Array<{ email_address: string }>;
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
type ClerkWebhookEvent = ClerkUserCreatedEvent | ClerkUserDeletedEvent;

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
    const { id: userId, email_addresses } = event.data;
    const email = email_addresses[0]?.email_address;

    if (!email) {
      return c.json({ error: 'No email address in event' }, 400);
    }

    // Upsert user row. New users default to the 'free' plan (the
    // `users.plan` column default handles this — no explicit set needed).
    // Invites are no longer auto-claimed here; they are redeemed explicitly
    // via POST /invites/redeem to upgrade the user's plan.
    await db
      .insert(users)
      .values({ id: userId, email })
      .onConflictDoUpdate({
        target: users.id,
        set: { email, updatedAt: new Date() },
      });
  } else if (event.type === 'user.deleted') {
    // Right-to-erasure: delete the user row. The user FKs on playlists,
    // spaced_repetition_cards, usage_events, user_exercise_history,
    // user_language_profiles, user_preferences, user_vocabulary,
    // practice_sessions, and the read/review tables are all ON DELETE CASCADE,
    // so this one delete sweeps every PII-adjacent row for the account
    // (migration 0021 backfilled five legacy FKs that predated the cascade
    // convention; 0025 added practice_sessions, which 0021 missed).
    const userId = event.data.id;
    if (!userId) {
      return c.json({ error: 'No user id in event' }, 400);
    }
    await db.delete(users).where(eq(users.id, userId));
  }

  return c.json({ received: true }, 200);
});

export default webhooks;
