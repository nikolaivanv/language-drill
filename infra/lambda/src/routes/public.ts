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
// This is the only router serving learner content without `authMiddleware`
// (`health` is the other unauthenticated one, by design — it exposes no
// content). Every other content router applies `authMiddleware`; the omission
// here is deliberate, and the corresponding API Gateway route is registered
// without a JWT authorizer in `infra/lib/constructs/api-gateway.ts`.
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

// Keys inside `content_json` that exist only to serve the generation/review
// pipeline, never the learner. `_dedupKey` provably reaches anonymous callers
// today (`packages/db/scripts/review-flagged.ts` strips it before showing
// content to a HUMAN reviewer, precisely because it is writer metadata), and
// `seedWord` (the variant-seeding backfill's classification, see
// `backfill:variant-seeds`) is the same kind of internal bookkeeping. The
// column projection above is explicit and column-level only — it cannot catch
// keys hiding inside the `contentJson` blob itself.
const WRITER_ONLY_CONTENT_KEYS = ['_dedupKey', 'seedWord'] as const;

function stripWriterOnlyContent(contentJson: unknown): unknown {
  if (contentJson === null || typeof contentJson !== 'object' || Array.isArray(contentJson)) {
    return contentJson;
  }
  const clean = { ...(contentJson as Record<string, unknown>) };
  for (const key of WRITER_ONLY_CONTENT_KEYS) {
    delete clean[key];
  }
  return clean;
}

/**
 * Explicit wire projection. Deliberately a `.map()` rather than passing the
 * DB row through whole — the DB row is exactly the wire shape today, but an
 * implicit pass-through means a future field added to `PoolRow` (or a future
 * writer-only key added inside `contentJson`) ships to anonymous callers
 * silently. This pins the shape so that can't happen unnoticed.
 */
function toWireExercise(row: PoolRow) {
  return {
    id: row.id,
    type: row.type,
    language: row.language,
    difficulty: row.difficulty,
    grammarPointKey: row.grammarPointKey,
    contentJson: stripWriterOnlyContent(row.contentJson),
  };
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

  let rows: PoolRow[];
  try {
    rows = await poolCache.get(`${lang}|${level}`, () =>
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
            // No-op today: audioReadyFilter only excludes `type = 'dictation'`
            // rows lacking audio, and `type` here is pinned to 'conjugation' —
            // it can never filter anything out. Kept for consistency with the
            // other serve paths and so it takes effect automatically if this
            // router is ever extended to a dictation-adjacent public type.
            audioReadyFilter(exercisesTable),
          ),
        )
        .limit(CONJUGATION_SET_FETCH_CAP),
    );
  } catch {
    // The pool cache has already negative-cached this key (see
    // `public-pool-cache.ts`) so a burst of requests during an outage does not
    // re-query a database that is already struggling.
    c.header('Cache-Control', 'no-store');
    return c.json(
      { error: 'The exercise pool is temporarily unavailable', code: 'POOL_UNAVAILABLE' },
      503,
    );
  }

  // Randomisation happens here rather than in SQL (`ORDER BY random()`): the
  // window is cached, so the DB is not re-queried per request.
  const chosen = dedupeBySignature(
    shuffled(rows),
    target,
    (r) => `${r.grammarPointKey ?? ''}|${conjugationSignature(r.contentJson)}`,
  );

  // "Practise more" refetches this exact URL for a fresh shuffle — an
  // intermediary that cached the response would hand back the same set and
  // make the button look broken.
  c.header('Cache-Control', 'no-store');
  return c.json({
    exercises: chosen.map(toWireExercise),
    available: chosen.length,
    difficulty: level,
  });
});

export default publicRoutes;
