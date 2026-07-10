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

import { eq } from 'drizzle-orm';

import { users, userLanguageProfiles } from '@language-drill/db';
import { db } from './db';
import health from './routes/health';
import exercises from './routes/exercises';
import profiles from './routes/profiles';
import sessions from './routes/sessions';
import progress from './routes/progress';
import vocab from './routes/vocab';
import read from './routes/read';
import theory from './routes/theory';
import admin from './routes/admin';
import emailRoutes from './routes/email';

const DEV_USER_ID = process.env['DEV_USER_ID'] ?? 'dev_user_001';
const DEV_USER_EMAIL = process.env['DEV_USER_EMAIL'] ?? `${DEV_USER_ID}@local.dev`;
const PORT = parseInt(process.env['PORT'] ?? '3001', 10);

// Ensure the dev user exists — FK constraints on user_exercise_history / usage_events
// require a matching row in the users table.
async function ensureDevUser() {
  await db
    .insert(users)
    .values({ id: DEV_USER_ID, email: DEV_USER_EMAIL })
    .onConflictDoNothing();

  // Seed default language profiles if the dev user has none
  const existing = await db
    .select()
    .from(userLanguageProfiles)
    .where(eq(userLanguageProfiles.userId, DEV_USER_ID));

  if (existing.length === 0) {
    await db.insert(userLanguageProfiles).values([
      { userId: DEV_USER_ID, language: 'EN', proficiencyLevel: 'B1', assessedAt: new Date() },
      { userId: DEV_USER_ID, language: 'ES', proficiencyLevel: 'A2', assessedAt: new Date() },
    ]);
    console.log('Dev user profiles seeded');
  }
}

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
app.route('/', profiles);
app.route('/', sessions);
app.route('/', progress);
app.route('/', vocab);
app.route('/', read);
app.route('/', theory);
app.route('/', admin);
app.route('/', emailRoutes);

ensureDevUser()
  .then(() => {
    console.log(`Local API server running at http://localhost:${PORT}`);
    console.log(`  Auth bypassed — userId: ${DEV_USER_ID} (${DEV_USER_EMAIL})`);
    console.log(`  DATABASE_URL: ${process.env['DATABASE_URL'] ? '(set)' : '(NOT SET)'}`);
    serve({ fetch: app.fetch, port: PORT });
  })
  .catch((err) => {
    console.error('Failed to ensure dev user — is DATABASE_URL correct and migrations run?');
    console.error(err);
    process.exit(1);
  });
