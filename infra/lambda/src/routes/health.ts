import { Hono } from 'hono';

const health = new Hono();

// Unauthenticated — used for CDK deploy verification only
health.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }));

export default health;
