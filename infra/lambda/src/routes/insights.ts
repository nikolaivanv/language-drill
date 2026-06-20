import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { Language } from '@language-drill/shared';
import { errorObservations, userExerciseHistory, exercises, getGrammarPoint } from '@language-drill/db';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import { rankRecurringErrors, attachGrammarPointNames, type RecurringErrorInput } from '../lib/errors/recurring';
import { buildErrorTrends, type ErrorRow, type AttemptRow } from '../lib/errors/error-trends';

const insights = new Hono<{ Bindings: Bindings; Variables: Variables }>();

insights.use('/insights/*', authMiddleware);

// EN is a source/native language used only as a translation target, not a
// learning target — exclude it the same way sibling routes in progress.ts do.
const QuerySchema = z.object({
  language: z.enum([Language.ES, Language.DE, Language.TR]),
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

  const ranked = attachGrammarPointNames(
    rankRecurringErrors(inputs, now),
    (key) => (key ? (getGrammarPoint(key)?.name ?? null) : null),
  );
  const themes = ranked.map((t) => ({
    ...t,
    lastOccurredAt: t.lastOccurredAt.toISOString(),
  }));

  return c.json({ themes });
});

const TREND_WINDOW_MS = 8 * 7 * 86_400_000; // 8 weeks

insights.get('/insights/error-trends', async (c) => {
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
  const since = new Date(now.getTime() - TREND_WINDOW_MS);

  const errorRows = await db
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

  const attemptRows = await db
    .select({
      grammarPointKey: exercises.grammarPointKey,
      attemptedAt: userExerciseHistory.evaluatedAt,
    })
    .from(userExerciseHistory)
    .innerJoin(exercises, eq(userExerciseHistory.exerciseId, exercises.id))
    .where(
      and(
        eq(userExerciseHistory.userId, userId),
        eq(exercises.language, language),
        gte(userExerciseHistory.evaluatedAt, since),
        isNotNull(exercises.grammarPointKey),
      ),
    );

  const errors: ErrorRow[] = errorRows.map((r) => ({
    grammarPointKey: r.errorGrammarPointKey ?? r.hostGrammarPointKey,
    errorType: r.errorType,
    severity: r.severity,
    wrongText: r.wrongText,
    correction: r.correction,
    occurredAt: new Date(r.occurredAt),
  }));

  const attempts: AttemptRow[] = attemptRows
    .filter((r): r is { grammarPointKey: string; attemptedAt: Date } => r.grammarPointKey != null && r.attemptedAt != null)
    .map((r) => ({ grammarPointKey: r.grammarPointKey, attemptedAt: new Date(r.attemptedAt) }));

  const themes = buildErrorTrends(errors, attempts, now).map((t) => ({
    ...t,
    grammarPointName: t.grammarPointKey ? (getGrammarPoint(t.grammarPointKey)?.name ?? null) : null,
    firstSeen: t.firstSeen.toISOString(),
    lastSeen: t.lastSeen.toISOString(),
  }));

  return c.json({ themes });
});

export default insights;
