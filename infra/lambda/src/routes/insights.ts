import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, gte } from 'drizzle-orm';
import { Language } from '@language-drill/shared';
import { errorObservations } from '@language-drill/db';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import { rankRecurringErrors, type RecurringErrorInput } from '../lib/errors/recurring';

const insights = new Hono<{ Bindings: Bindings; Variables: Variables }>();

insights.use('/insights/*', authMiddleware);

const QuerySchema = z.object({
  language: z.nativeEnum(Language),
});

const WINDOW_MS = 60 * 86_400_000; // trailing 60 days

insights.get('/insights/errors', async (c) => {
  const parsed = QuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      400,
    );
  }
  const { language } = parsed.data;
  const userId = c.get('userId');
  const now = new Date();
  const since = new Date(now.getTime() - WINDOW_MS);

  const rows = await db
    .select({
      hostGrammarPointKey: errorObservations.hostGrammarPointKey,
      errorGrammarPointKey: errorObservations.errorGrammarPointKey,
      errorType: errorObservations.errorType,
      severity: errorObservations.severity,
      wrongText: errorObservations.wrongText,
      correction: errorObservations.correction,
      occurredAt: errorObservations.occurredAt,
    })
    .from(errorObservations)
    .where(
      and(
        eq(errorObservations.userId, userId),
        eq(errorObservations.language, language),
        gte(errorObservations.occurredAt, since),
      ),
    );

  const inputs: RecurringErrorInput[] = rows.map((r) => ({
    hostGrammarPointKey: r.hostGrammarPointKey,
    errorGrammarPointKey: r.errorGrammarPointKey,
    errorType: r.errorType,
    severity: r.severity,
    wrongText: r.wrongText,
    correction: r.correction,
    occurredAt: new Date(r.occurredAt),
  }));

  const themes = rankRecurringErrors(inputs, now).map((t) => ({
    ...t,
    lastOccurredAt: t.lastOccurredAt.toISOString(),
  }));

  return c.json({ themes });
});

export default insights;
