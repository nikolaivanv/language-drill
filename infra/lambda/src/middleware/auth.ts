import type { Context, Next } from 'hono';
import type { LambdaEvent } from 'hono/aws-lambda';

export type Variables = {
  userId: string;
};

export type Bindings = {
  event: LambdaEvent;
};

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

  c.set('userId', sub);
  await next();
}
