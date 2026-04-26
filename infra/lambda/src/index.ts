import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { cors } from 'hono/cors';

import health from './routes/health';
import exercises from './routes/exercises';
import profiles from './routes/profiles';
import webhooks from './routes/webhooks/clerk';

const app = new Hono();

app.use(
  '*',
  cors({
    origin: (origin) => {
      if (origin.endsWith('.vercel.app')) return origin;
      if (origin === 'https://langdrill.app' || origin === 'https://www.langdrill.app') return origin;
      return null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
  })
);

app.route('/', health);
app.route('/', exercises);
app.route('/', profiles);
app.route('/', webhooks);

export const handler = handle(app);
