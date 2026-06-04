import { Hono } from 'hono';
import { and, count, eq, gte } from 'drizzle-orm';
import { usageEvents } from '@language-drill/db';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import { limitFor } from '../usage/limits';
import { getEffectivePlan, isAdmin } from '../usage/plan';

const me = new Hono<{ Bindings: Bindings; Variables: Variables }>();

me.use('/me', authMiddleware);

me.get('/me', async (c) => {
  const userId = c.get('userId');
  const plan = await getEffectivePlan(userId);

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ eventType: usageEvents.eventType, count: count() })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, oneDayAgo)))
    .groupBy(usageEvents.eventType);

  const used = (t: string) =>
    Number(rows.find((r) => r.eventType === t)?.count ?? 0);

  return c.json({
    plan,
    isAdmin: isAdmin(userId),
    limits: {
      evaluation: limitFor('ai_evaluation', plan),
      annotation: limitFor('read_annotation', plan),
      deepSpan: limitFor('read_span_annotation', plan),
    },
    usageToday: {
      evaluation: used('ai_evaluation'),
      annotation: used('read_annotation'),
      deepSpan: used('read_span_annotation'),
    },
  });
});

export default me;
