import type { Context, Next } from 'hono';
import type { Bindings, Variables } from './auth';

export async function adminMiddleware(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next,
): Promise<Response | void> {
  const adminIds = (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!adminIds.includes(c.get('userId'))) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  await next();
}
