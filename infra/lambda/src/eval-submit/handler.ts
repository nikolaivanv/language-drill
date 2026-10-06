/**
 * Eval-submit Lambda — entry point for its own Function URL.
 *
 * Serves exactly one route, `POST /exercises/:id/submit`, using the SAME Hono
 * `exercises` router as the API Lambda. It exists because a free-writing
 * evaluation routinely outlives API Gateway: grading a 150–200-word essay
 * emits ~3k output tokens (errors + an improved rewrite) and takes ~50s, while
 * the HTTP API integration is hard-capped at 30s. A Function URL is bounded
 * only by the Lambda's own timeout, so the long evaluation can finish.
 *
 * Auth: the Function URL is `AuthType: NONE` (there is no API Gateway JWT
 * authorizer in front of it), so this handler verifies the Clerk JWT itself
 * with the same verifier as the annotate-stream Function URL, then pre-sets
 * `userId` — the convention `authMiddleware` already honours for the local dev
 * server — so the shared router runs unchanged.
 *
 * CORS: answered by Hono with the API's own origin matching (not the Function
 * URL's `*`), and it runs BEFORE the JWT gate, so a 401 still carries
 * `Access-Control-Allow-Origin` and reaches the browser as a readable 401
 * instead of an opaque `TypeError: Failed to fetch`.
 */
import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { cors } from 'hono/cors';

import exercises from '../routes/exercises';
import { ensureUserRow } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import { matchOrigin, flushMiddleware } from '../lib/http-middleware';
import { verifyClerkJwt } from '../annotate-stream/jwt';

/** The only path this Function URL answers. Anything else is a 404. */
export const SUBMIT_PATH = /^\/exercises\/[^/]+\/submit$/;

export const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use(
  '*',
  cors({
    origin: (origin) => matchOrigin(origin),
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
  }),
);

app.use('*', flushMiddleware);

// Route allow-list, then JWT. The allow-list runs first so a probe of any
// other path is rejected without a Clerk JWKS round-trip.
app.use('*', async (c, next) => {
  if (c.req.method !== 'POST' || !SUBMIT_PATH.test(c.req.path)) {
    return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  }

  const userId = await verifyClerkJwt(c.req.header('authorization'));
  if (!userId) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  }

  await ensureUserRow(userId);
  c.set('userId', userId);
  await next();
});

app.route('/', exercises);

export const handler = handle(app);
