import type { Context, Next } from 'hono';
import type { LambdaEvent } from 'hono/aws-lambda';
import { db } from '../db';
import { users } from '@language-drill/db';
import { PLACEHOLDER_EMAIL } from '../lib/placeholder-email';

export type Variables = {
  userId: string;
};

export type Bindings = {
  event: LambdaEvent;
};

/**
 * Ensure the user row exists — fallback for missed/delayed Clerk webhooks.
 * Never throws: a failed upsert is logged and the request proceeds. Shared
 * with entry points that verify the JWT themselves (eval-submit Function URL)
 * and therefore pre-set `userId`, which makes `authMiddleware` skip this.
 */
export async function ensureUserRow(userId: string): Promise<void> {
  try {
    await db
      .insert(users)
      .values({ id: userId, email: PLACEHOLDER_EMAIL })
      .onConflictDoNothing({ target: users.id });
  } catch (err) {
    console.error('Failed to ensure user row:', err);
  }
}

export async function authMiddleware(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next
): Promise<Response | void> {
  const event = c.env?.event as
    | {
        requestContext?: {
          authorizer?: {
            jwt?: {
              claims?: Record<string, string>;
            };
          };
        };
      }
    | undefined;

  // In local dev mode, userId is pre-set by the dev server — skip JWT extraction
  const existingUserId = c.get('userId');
  if (existingUserId) {
    await next();
    return;
  }

  const sub = event?.requestContext?.authorizer?.jwt?.claims?.sub;

  if (!sub) {
    return c.json({ error: 'Unauthorized', code: 'MISSING_SUB' }, 401);
  }

  await ensureUserRow(sub);

  c.set('userId', sub);
  await next();
}
