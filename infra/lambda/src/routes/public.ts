import { Hono } from 'hono';
import { z } from 'zod';
import { and, count, eq } from 'drizzle-orm';
import {
  exercises as exercisesTable,
  getGrammarPoint,
  curriculumOrderOf,
} from '@language-drill/db';
import { resolveTheoryCategory } from '@language-drill/shared';
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
//   2. `grammarPoint` is optional, and when present is VALIDATED AGAINST THE
//      CURRICULUM — the key must exist, belong to `lang`, and sit at `level`.
//      That is what keeps the cache key space bounded by curriculum size
//      rather than by whatever a caller invents. The original design excluded
//      the parameter entirely for this reason; it is admitted here only with
//      that validation, because a drill you cannot aim is a worse product and
//      the bound is what actually mattered.
// ---------------------------------------------------------------------------

const publicRoutes = new Hono();

const PUBLIC_TYPE = 'conjugation' as const;

const LANG = z.enum(['ES', 'DE', 'TR']);
const LEVEL = z.enum(['A1', 'A2', 'B1', 'B2']);

const SetQuerySchema = z.object({
  lang: LANG,
  level: LEVEL,
  count: z.coerce.number().int().min(1).max(PUBLIC_CONJUGATION_SET_MAX).optional(),
  grammarPoint: z.string().min(1).max(120).optional(),
});

const PointsQuerySchema = z.object({ lang: LANG, level: LEVEL });

type PointSummary = {
  key: string;
  name: string;
  category: string;
  order: number | null;
  count: number;
};

type PoolRow = {
  id: string;
  type: string | null;
  language: string | null;
  difficulty: string | null;
  grammarPointKey: string | null;
  contentJson: unknown;
};

const poolCache = createPoolCache<PoolRow>();
const pointsCache = createPoolCache<PointSummary>();

/** Test seam: the module-scope caches would otherwise leak rows between cases. */
export function __clearPoolCacheForTests(): void {
  poolCache.clear();
  pointsCache.clear();
}

/**
 * A `grammarPoint` is only honoured when the curriculum knows it AND it belongs
 * to the requested cell. Without that check a caller could mint unlimited cache
 * keys from arbitrary strings, which is precisely why the original design had
 * no such parameter at all.
 */
function isPointInCell(key: string, lang: string, level: string): boolean {
  const point = getGrammarPoint(key);
  return !!point && point.language === lang && point.cefrLevel === level;
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

  const { lang, level, count, grammarPoint } = parsed.data;
  const target = count ?? PUBLIC_CONJUGATION_SET_DEFAULT;

  if (grammarPoint && !isPointInCell(grammarPoint, lang, level)) {
    return c.json(
      {
        error: 'Unknown grammar point for this language and level',
        code: 'VALIDATION_ERROR',
      },
      400,
    );
  }

  let rows: PoolRow[];
  try {
    rows = await poolCache.get(`${lang}|${level}|${grammarPoint ?? '*'}`, () =>
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
            // Safe to interpolate: `grammarPoint` has already been checked
            // against the curriculum, so it is one of a fixed set of keys.
            ...(grammarPoint
              ? [eq(exercisesTable.grammarPointKey, grammarPoint)]
              : []),
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

/**
 * The grammar points a visitor can actually aim at, for one language and level.
 *
 * Only points with approved rows are listed, and each carries its count — the
 * picker must never offer a cell that turns out to be empty, which is the same
 * rule that hides B2 for ES/DE in the level nav.
 *
 * Names, categories and curriculum order are resolved HERE rather than shipped
 * to the browser, mirroring `GET /theory/:lang`: the curriculum is a large
 * server-side asset and the client only needs five fields per point.
 */
publicRoutes.get('/public/conjugation/points', async (c) => {
  const parsed = PointsQuerySchema.safeParse(c.req.query());
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

  const { lang, level } = parsed.data;

  let points: PointSummary[];
  try {
    points = await pointsCache.get(`${lang}|${level}`, async () => {
      const rows = await db
        .select({
          key: exercisesTable.grammarPointKey,
          total: count(),
        })
        .from(exercisesTable)
        .where(
          and(
            eq(exercisesTable.language, lang),
            eq(exercisesTable.difficulty, level),
            eq(exercisesTable.type, PUBLIC_TYPE),
            approvedStatusFilter(exercisesTable),
          ),
        )
        .groupBy(exercisesTable.grammarPointKey);

      return rows
        .flatMap((row) => {
          const key = row.key;
          // A row whose point the curriculum no longer knows is unnameable, so
          // it cannot be offered — it stays reachable through the mixed set.
          if (!key) return [];
          const point = getGrammarPoint(key);
          if (!point) return [];
          return [
            {
              key,
              name: point.name,
              category: resolveTheoryCategory(key),
              order: curriculumOrderOf(key) ?? null,
              count: Number(row.total),
            },
          ];
        })
        .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
    });
  } catch {
    c.header('Cache-Control', 'no-store');
    return c.json(
      { error: 'The exercise pool is temporarily unavailable', code: 'POOL_UNAVAILABLE' },
      503,
    );
  }

  c.header('Cache-Control', 'no-store');
  return c.json({ points, language: lang, difficulty: level });
});

export default publicRoutes;
