import { Hono } from 'hono';
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

type ClerkWebhookEvent = ClerkUserCreatedEvent;

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
  }

  return c.json({ received: true }, 200);
});

export default webhooks;
