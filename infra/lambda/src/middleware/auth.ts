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
    console.error('MISSING_SUB debug', JSON.stringify({
      hasEnv: !!c.env,
      hasEvent: !!c.env?.event,
      eventKeys: c.env?.event ? Object.keys(c.env.event as object) : [],
      requestContext: (c.env?.event as Record<string, unknown>)?.requestContext,
    }));
    return c.json({ error: 'Unauthorized', code: 'MISSING_SUB' }, 401);
  }

  c.set('userId', sub);
  await next();
}
