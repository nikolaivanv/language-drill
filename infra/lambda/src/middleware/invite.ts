import { eq } from 'drizzle-orm';
import type { Context, Next } from 'hono';

import { db } from '../db';
import { invitations } from '@language-drill/db';

type Variables = {
  userId: string;
};

export async function inviteMiddleware(
  c: Context<{ Variables: Variables }>,
  next: Next
): Promise<Response | void> {
  const userId = c.get('userId');

  const rows = await db
    .select()
    .from(invitations)
    .where(eq(invitations.usedBy, userId))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Forbidden', code: 'NO_INVITE' }, 403);
  }

  await next();
}
