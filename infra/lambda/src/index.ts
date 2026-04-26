import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';

import health from './routes/health';
import exercises from './routes/exercises';
import profiles from './routes/profiles';
import webhooks from './routes/webhooks/clerk';

const app = new Hono();

app.route('/', health);
app.route('/', exercises);
app.route('/', profiles);
app.route('/', webhooks);

export const handler = handle(app);
