import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import health from './health';

describe('GET /health', () => {
  const app = new Hono();
  app.route('/', health);

  it('returns 200 with status ok and a timestamp', async () => {
    const res = await app.request('/health');

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      status: 'ok',
      ts: expect.any(Number),
    });
  });
});
