import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { cors } from 'hono/cors';
import { matchOrigin, flushMiddleware } from './lib/http-middleware';

import health from './routes/health';
import publicRoutes from './routes/public';
import exercises from './routes/exercises';
import theory from './routes/theory';
import sessions from './routes/sessions';
import profiles from './routes/profiles';
import progress from './routes/progress';
import vocab from './routes/vocab';
import insights from './routes/insights';
import fluency from './routes/fluency';
import read from './routes/read';
import review from './routes/review';
import invites from './routes/invites';
import me from './routes/me';
import admin from './routes/admin';
import exerciseFlags from './routes/exercise-flags';
import freeWritingHistory from './routes/free-writing-history';
import emailRoutes from './routes/email';
import webhooks from './routes/webhooks/clerk';

// Re-exported so existing callers/tests keep importing from the entry point.
export { matchOrigin, flushMiddleware };

const app = new Hono();

app.use(
  '*',
  cors({
    origin: (origin) => matchOrigin(origin),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
  })
);

app.use('*', flushMiddleware);

app.route('/', health);
app.route('/', publicRoutes); // unauthenticated — see routes/public.ts
app.route('/', exercises);
app.route('/', theory);
app.route('/', sessions);
app.route('/', profiles);
app.route('/', progress);
app.route('/', vocab);
app.route('/', insights);
app.route('/', fluency);
app.route('/', read);
app.route('/', review);
app.route('/', invites);
app.route('/', me);
app.route('/', admin);
app.route('/', exerciseFlags);
app.route('/', freeWritingHistory);
app.route('/', emailRoutes);
app.route('/', webhooks);

export const handler = handle(app);
