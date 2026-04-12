import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';

import health from './routes/health';
import webhooks from './routes/webhooks/clerk';

const app = new Hono();

app.route('/', health);
app.route('/', webhooks);

export const handler = handle(app);
