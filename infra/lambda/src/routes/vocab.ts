/**
 * Read-only vocab browse hub API. Surfaces curated ES A1 vocab_target rows as
 * topics -> words with derived per-word coverage state (see ../lib/vocab-coverage).
 * Coverage joins vocab_target -> exercises (on expectedWord) -> user_exercise_history.
 */

import { Hono } from 'hono';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  exercises,
  userExerciseHistory,
  vocabTarget,
  getGrammarPoint,
  curriculumOrderOf,
} from '@language-drill/db';
import type { LearningLanguage } from '@language-drill/shared';

import { db } from '../db';
import { approvedStatusFilter } from '../lib/exercise-filters';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import {
  deriveWordCoverage,
  normalizeWord,
  pickWordStat,
  summarizeCoverage,
  type CoverageState,
  type ExerciseWordStat,
} from '../lib/vocab-coverage';

const vocab = new Hono<{ Bindings: Bindings; Variables: Variables }>();
vocab.use('/vocab/*', authMiddleware);

/** Null-safe max: a missing score never wins over a present one. */
function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/** expectedWord -> {attempts, bestScore} for one (user, language, umbrella). */
async function loadWordStats(
  userId: string,
  language: string,
  umbrellaKey: string,
): Promise<Map<string, ExerciseWordStat>> {
  const rows = await db
    .select({
      word: sql<string>`(${exercises.contentJson} ->> 'expectedWord')`,
      attempts: sql<number>`count(${userExerciseHistory.id})::int`,
      bestScore: sql<number | null>`max(${userExerciseHistory.score})`,
    })
    .from(exercises)
    .leftJoin(
      userExerciseHistory,
      and(
        eq(userExerciseHistory.exerciseId, exercises.id),
        eq(userExerciseHistory.userId, userId),
      ),
    )
    .where(
      and(
        eq(exercises.language, language),
        eq(exercises.grammarPointKey, umbrellaKey),
        approvedStatusFilter(exercises),
        sql`(${exercises.contentJson} ->> 'expectedWord') IS NOT NULL`,
      ),
    )
    .groupBy(sql`(${exercises.contentJson} ->> 'expectedWord')`);

  const byWord = new Map<string, ExerciseWordStat>();
  for (const r of rows) {
    if (r.word == null) continue;
    const key = normalizeWord(r.word);
    const existing = byWord.get(key);
    byWord.set(
      key,
      existing
        ? {
            attempts: existing.attempts + r.attempts,
            bestScore: maxNullable(existing.bestScore, r.bestScore),
          }
        : { attempts: r.attempts, bestScore: r.bestScore },
    );
  }
  return byWord;
}

vocab.get('/vocab/topics/:umbrellaKey', async (c) => {
  const umbrellaKey = c.req.param('umbrellaKey');
  const point = getGrammarPoint(umbrellaKey);
  if (!point || point.kind !== 'vocab') {
    return c.json({ error: 'Unknown vocab topic', code: 'NOT_FOUND' }, 404);
  }
  const userId = c.get('userId');

  const [targets, byWord] = await Promise.all([
    db
      .select({
        lemma: vocabTarget.lemma,
        displayForm: vocabTarget.displayForm,
        gloss: vocabTarget.gloss,
        exampleSentence: vocabTarget.exampleSentence,
        freqRank: vocabTarget.freqRank,
        tier: vocabTarget.tier,
      })
      .from(vocabTarget)
      .where(
        and(
          eq(vocabTarget.language, point.language),
          eq(vocabTarget.umbrellaKey, umbrellaKey),
          eq(vocabTarget.status, 'approved'),
        ),
      )
      .orderBy(asc(vocabTarget.freqRank)),
    loadWordStats(userId, point.language, umbrellaKey),
  ]);

  const words = targets.map((t) => ({
    ...t,
    state: deriveWordCoverage(pickWordStat(t, byWord)) satisfies CoverageState,
  }));

  return c.json({
    umbrellaKey,
    name: point.name,
    cefrLevel: point.cefrLevel,
    words,
  });
});

vocab.get('/vocab/topics', async (c) => {
  const language = (c.req.query('language') ?? 'ES') as LearningLanguage;
  const userId = c.get('userId');

  // Approved targets grouped by umbrella (one query), then per-topic coverage.
  const targets = await db
    .select({
      umbrellaKey: vocabTarget.umbrellaKey,
      lemma: vocabTarget.lemma,
      displayForm: vocabTarget.displayForm,
    })
    .from(vocabTarget)
    .where(and(eq(vocabTarget.language, language), eq(vocabTarget.status, 'approved')));

  const byUmbrella = new Map<string, Array<{ lemma: string; displayForm: string }>>();
  for (const t of targets) {
    const arr = byUmbrella.get(t.umbrellaKey) ?? [];
    arr.push({ lemma: t.lemma, displayForm: t.displayForm });
    byUmbrella.set(t.umbrellaKey, arr);
  }

  const topics = [];
  for (const [umbrellaKey, rows] of byUmbrella) {
    const point = getGrammarPoint(umbrellaKey);
    if (!point || point.kind !== 'vocab') continue;
    const byWord = await loadWordStats(userId, language, umbrellaKey);
    const states = rows.map((r) => deriveWordCoverage(pickWordStat(r, byWord)));
    const { total, available, practiced } = summarizeCoverage(states);
    topics.push({
      umbrellaKey,
      name: point.name,
      cefrLevel: point.cefrLevel,
      order: curriculumOrderOf(umbrellaKey) ?? Number.MAX_SAFE_INTEGER,
      wordCount: total,
      available,
      practiced,
    });
  }

  topics.sort((a, b) => a.order - b.order);
  return c.json({ topics: topics.map(({ order: _o, ...rest }) => rest) });
});

export default vocab;
