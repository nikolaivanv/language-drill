import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { cors } from 'hono/cors';

import health from './routes/health';
import exercises from './routes/exercises';
import sessions from './routes/sessions';
import profiles from './routes/profiles';
import progress from './routes/progress';
import read from './routes/read';
import webhooks from './routes/webhooks/clerk';

const app = new Hono();

const FALLBACK_ORIGINS = [
  'https://*.vercel.app',
  'https://langdrill.app',
  'https://www.langdrill.app',
];

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
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
  })
);

app.route('/', health);
app.route('/', exercises);
app.route('/', sessions);
app.route('/', profiles);
app.route('/', progress);
app.route('/', read);
app.route('/', webhooks);

export const handler = handle(app);
