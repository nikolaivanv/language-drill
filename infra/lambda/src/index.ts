import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { cors } from 'hono/cors';
import type { Context, Next } from 'hono';
import { FALLBACK_ORIGINS } from '@language-drill/shared';
import { flushObservability } from '@language-drill/ai';

import health from './routes/health';
import exercises from './routes/exercises';
import theory from './routes/theory';
import sessions from './routes/sessions';
import profiles from './routes/profiles';
import progress from './routes/progress';
import read from './routes/read';
import review from './routes/review';
import invites from './routes/invites';
import me from './routes/me';
import admin from './routes/admin';
import webhooks from './routes/webhooks/clerk';

const app = new Hono();

const parsedAllowedOrigins = (process.env['ALLOWED_ORIGINS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOriginPatterns =
  parsedAllowedOrigins.length > 0 ? parsedAllowedOrigins : FALLBACK_ORIGINS;

export function matchOrigin(origin: string): string | null {
  for (const pattern of allowedOriginPatterns) {
    if (pattern === origin) return origin;
    const wildcardMatch = pattern.match(/^(https?:\/\/)\*\.(.+)$/);
    if (wildcardMatch) {
      const [, scheme, suffix] = wildcardMatch;
      const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^${scheme}([^/]+\\.)?${escapedSuffix}$`);
      if (re.test(origin)) return origin;
    }
  }
  return null;
}

app.use(
  '*',
  cors({
    origin: (origin) => matchOrigin(origin),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
  })
);

/**
 * Drain buffered Langfuse traces after every request so the Lambda's next
 * freeze doesn't drop them. `flushObservability` is a no-op when Langfuse
 * is disabled, and races flushAsync against a 200ms hard cap so a slow
 * sink can never delay the response (Req 6 AC 1 + AC 5).
 *
 * Exported for direct unit testing — middlewares are easier to verify as
 * pure functions than via app.request roundtrips.
 */
export async function flushMiddleware(_c: Context, next: Next): Promise<void> {
  try {
    await next();
  } finally {
    await flushObservability();
  }
}

app.use('*', flushMiddleware);

app.route('/', health);
app.route('/', exercises);
app.route('/', theory);
app.route('/', sessions);
app.route('/', profiles);
app.route('/', progress);
app.route('/', read);
app.route('/', review);
app.route('/', invites);
app.route('/', me);
app.route('/', admin);
app.route('/', webhooks);

export const handler = handle(app);
