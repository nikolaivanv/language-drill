import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { exercises as exercisesTable } from '@language-drill/db';
import { db } from '../db';
import { approvedStatusFilter, audioReadyFilter } from '../lib/exercise-filters';
import {
  conjugationSignature,
  dedupeBySignature,
  CONJUGATION_SET_FETCH_CAP,
  PUBLIC_CONJUGATION_SET_DEFAULT,
  PUBLIC_CONJUGATION_SET_MAX,
} from '../lib/exercise-set';
import { createPoolCache, shuffled } from '../lib/public-pool-cache';

// ---------------------------------------------------------------------------
// UNAUTHENTICATED ROUTER.
//
// This is the ONLY router in this app that does not apply `authMiddleware`.
// Every sibling does; the omission here is deliberate, and the corresponding
// API Gateway route is registered without a JWT authorizer in
// `infra/lib/constructs/api-gateway.ts`.
//
// Two constraints keep that safe and MUST NOT be relaxed:
//   1. `type` is a server constant, never a request parameter. `contentJson`
//      is returned wholesale (answers included), so an overridable type would
//      expose the whole ~30k-row pool.
//   2. There is no `grammarPoint` parameter, so the cache key space is exactly
//      3 languages x 4 levels = 12 and cannot be inflated by a caller.
// ---------------------------------------------------------------------------

const publicRoutes = new Hono();

const PUBLIC_TYPE = 'conjugation' as const;

const SetQuerySchema = z.object({
  lang: z.enum(['ES', 'DE', 'TR']),
  level: z.enum(['A1', 'A2', 'B1', 'B2']),
  count: z.coerce.number().int().min(1).max(PUBLIC_CONJUGATION_SET_MAX).optional(),
});

type PoolRow = {
  id: string;
  type: string | null;
  language: string | null;
  difficulty: string | null;
  grammarPointKey: string | null;
  contentJson: unknown;
};

const poolCache = createPoolCache<PoolRow>();

/** Test seam: the module-scope cache would otherwise leak rows between cases. */
export function __clearPoolCacheForTests(): void {
  poolCache.clear();
}

publicRoutes.get('/public/conjugation/set', async (c) => {
  const parsed = SetQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid query parameters',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      },
      400,
    );
  }

  const { lang, level, count } = parsed.data;
  const target = count ?? PUBLIC_CONJUGATION_SET_DEFAULT;

  const rows = await poolCache.get(`${lang}|${level}`, () =>
    db
      // Explicit projection, unlike the authenticated `.select()`: a column
      // added to `exercises` later (quality_score, flagged_reasons,
      // demotion_reason, model_id) must not start leaking to the open web.
      .select({
        id: exercisesTable.id,
        type: exercisesTable.type,
        language: exercisesTable.language,
        difficulty: exercisesTable.difficulty,
        grammarPointKey: exercisesTable.grammarPointKey,
        contentJson: exercisesTable.contentJson,
      })
      .from(exercisesTable)
      .where(
        and(
          eq(exercisesTable.language, lang),
          eq(exercisesTable.difficulty, level),
          eq(exercisesTable.type, PUBLIC_TYPE),
          approvedStatusFilter(exercisesTable),
          audioReadyFilter(exercisesTable),
        ),
      )
      .limit(CONJUGATION_SET_FETCH_CAP),
  );

  // Randomisation happens here rather than in SQL (`ORDER BY random()`): the
  // window is cached, so the DB is not re-queried per request.
  const chosen = dedupeBySignature(
    shuffled(rows),
    target,
    (r) => `${r.grammarPointKey ?? ''}|${conjugationSignature(r.contentJson)}`,
  );

  return c.json({ exercises: chosen, available: chosen.length, difficulty: level });
});

export default publicRoutes;
