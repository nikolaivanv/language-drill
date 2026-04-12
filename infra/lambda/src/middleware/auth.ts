import type { Context, Next } from 'hono';
import type { LambdaEvent } from 'hono/aws-lambda';

type Variables = {
  userId: string;
};

type Bindings = {
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

  const sub = event?.requestContext?.authorizer?.jwt?.claims?.sub;

  if (!sub) {
    return c.json({ error: 'Unauthorized', code: 'MISSING_SUB' }, 401);
  }

  c.set('userId', sub);
  await next();
}
