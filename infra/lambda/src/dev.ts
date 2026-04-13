/**
 * Local dev server for the Lambda API.
 *
 * Runs the Hono app on Node's built-in http server (no AWS Lambda runtime).
 * Auth middleware is bypassed — all requests are treated as authenticated
 * with a configurable user ID.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx src/dev.ts
 *   DATABASE_URL=... DEV_USER_ID=user_abc npx tsx src/dev.ts
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import health from './routes/health';
import exercises from './routes/exercises';

const DEV_USER_ID = process.env['DEV_USER_ID'] ?? 'dev_user_001';
const PORT = parseInt(process.env['PORT'] ?? '3001', 10);

const app = new Hono();

// CORS for local Next.js dev server
app.use(
  '*',
  cors({
    origin: ['http://localhost:3000', 'http://localhost:3001'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

// Bypass auth middleware — inject a fake userId for local dev
app.use('*', async (c, next) => {
  c.set('userId' as never, DEV_USER_ID);
  await next();
});

app.route('/', health);
app.route('/', exercises);

console.log(`Local API server running at http://localhost:${PORT}`);
console.log(`  Auth bypassed — userId: ${DEV_USER_ID}`);
console.log(`  DATABASE_URL: ${process.env['DATABASE_URL'] ? '(set)' : '(NOT SET)'}`);

serve({ fetch: app.fetch, port: PORT });
