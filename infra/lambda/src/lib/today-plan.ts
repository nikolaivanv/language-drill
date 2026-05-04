// ---------------------------------------------------------------------------
// Today-plan composition — constants, types, and pure helpers
// ---------------------------------------------------------------------------
// The dashboard's `GET /sessions/today` endpoint either hydrates from today's
// existing practice_sessions row or composes a fresh 5-item plan from the
// exercise pool. This module is the single source of truth for the slot mix,
// minute estimates, item-count lookups, and date-bucket math used by both
// paths.
//
// Design reference: .claude/specs/dashboard/design.md
//   §"Plan composition heuristic (v1)"
//   §"Internal type — PlanCompositionSlot"
//
// Pure functions only — no DB or network dependencies.
// ---------------------------------------------------------------------------

import { CefrLevel, ExerciseType } from '@language-drill/shared';

// ---------------------------------------------------------------------------
// Static minute estimate per exercise type
// ---------------------------------------------------------------------------
// These are integer minutes (the wire schema rejects non-integer values). The
// route sums per-item estimates for the response's totalEstimatedMinutes.
// ---------------------------------------------------------------------------

export const ESTIMATED_MINUTES_BY_TYPE: Record<ExerciseType, number> = {
  [ExerciseType.CLOZE]: 2,
  [ExerciseType.TRANSLATION]: 4,
  [ExerciseType.VOCAB_RECALL]: 2,
};

// ---------------------------------------------------------------------------
// Static item-count per exercise type (size of the underlying drill)
// ---------------------------------------------------------------------------
// Mirrors the typical exercise-pool shape: cloze blocks ship 4 blanks,
// translation is one prompt, vocab_recall is a 6-card spaced set. Drives the
// "X items" subtitle on each timeline row.
// ---------------------------------------------------------------------------

export const ITEM_COUNT_BY_TYPE: Record<ExerciseType, number> = {
  [ExerciseType.CLOZE]: 4,
  [ExerciseType.TRANSLATION]: 1,
  [ExerciseType.VOCAB_RECALL]: 6,
};

// ---------------------------------------------------------------------------
// Plan-composition slot taxonomy
// ---------------------------------------------------------------------------
// `prefix` is a label-only concern (used by the client's timeline-labels lib);
// it doesn't affect the SQL or pool draw and isn't carried on the wire (the
// client derives it deterministically from `index`).
// ---------------------------------------------------------------------------

export type PlanSlotPrefix = 'warm-up' | 'core' | 'production' | 'cool-down';

export type PlanCompositionSlot = {
  /** 1-based position within today's plan (1..5). */
  index: number;
  prefix: PlanSlotPrefix;
  type: ExerciseType;
};

/**
 * The fixed v1 slot mix. Five items: warm-up cloze + core cloze + production
 * translation + core vocab + cool-down cloze. Adaptive weighting by the
 * user's weakest axis is explicitly deferred — see `composeFreshPlan`'s
 * unused `radarSnapshot` parameter (lands in a later phase).
 */
export const V1_PLAN_SHAPE: readonly PlanCompositionSlot[] = [
  { index: 1, prefix: 'warm-up', type: ExerciseType.CLOZE },
  { index: 2, prefix: 'core', type: ExerciseType.CLOZE },
  { index: 3, prefix: 'production', type: ExerciseType.TRANSLATION },
  { index: 4, prefix: 'core', type: ExerciseType.VOCAB_RECALL },
  { index: 5, prefix: 'cool-down', type: ExerciseType.CLOZE },
] as const;

// ---------------------------------------------------------------------------
// In-memory plan-item shape
// ---------------------------------------------------------------------------
// Used by both `composeFreshPlan` and `hydrateFromSession`. The route maps
// these to the wire shape (`TodayPlanItem`) — keeping the lib output
// independent of the wire schema avoids a circular dep on api-client.
// ---------------------------------------------------------------------------

export type PlanItemStatus = 'done' | 'queued';

export type PlanItem = {
  index: number;
  type: ExerciseType;
  topicHint: string | null;
  difficulty: CefrLevel;
  itemCount: number;
  estimatedMinutes: number;
  status: PlanItemStatus;
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Collapses a Date to 00:00:00.000 UTC of the same calendar day. Used by the
 * route's "today" lookup against `practice_sessions.started_at`.
 *
 * Rationale: v1 buckets days in UTC (per Requirements §NFR Reliability — a
 * timezone-aware bucket is deferred). A learner practising late-evening in
 * CET may see the session attributed to the next UTC day; that's accepted
 * for v1.
 */
export function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

// ---------------------------------------------------------------------------
// Path B — fresh plan composition
// ---------------------------------------------------------------------------

/**
 * One row from the pool-sample query, in the order the UNION-ALL emitted it.
 * The route guarantees `draws[i]` aligns with `V1_PLAN_SHAPE[i]` by issuing
 * five `LIMIT 1` selects partitioned by slot type — see Design §"Query 2
 * (Path B) — pool sample".
 */
export type PoolDraw = {
  id: string;
  type: ExerciseType;
  topicHint: string | null;
  difficulty: CefrLevel;
};

export type ComposeFreshPlanResult = {
  items: PlanItem[];
  insufficient: boolean;
};

/**
 * Composes the fresh-plan branch (Path B) deterministically from a pool sample.
 *
 * `draws.length < 5` → `{ items: [], insufficient: true }` so the route can
 * return `INSUFFICIENT_POOL` without further work. Otherwise the function
 * walks `V1_PLAN_SHAPE` in order and maps each slot to the corresponding
 * draw, projecting the in-memory `PlanItem` shape.
 *
 * The unused `_radarSnapshot` parameter is the deferred adaptive swap point
 * (Design §"Adaptive swap point") — v1 ignores it.
 */
export function composeFreshPlan(
  draws: readonly PoolDraw[],
  _radarSnapshot?: unknown,
): ComposeFreshPlanResult {
  if (draws.length < V1_PLAN_SHAPE.length) {
    return { items: [], insufficient: true };
  }

  const items: PlanItem[] = V1_PLAN_SHAPE.map((slot, i) => {
    const draw = draws[i];
    return {
      index: slot.index,
      type: draw.type,
      topicHint: draw.topicHint,
      difficulty: draw.difficulty,
      itemCount: ITEM_COUNT_BY_TYPE[draw.type],
      estimatedMinutes: ESTIMATED_MINUTES_BY_TYPE[draw.type],
      status: 'queued',
    };
  });

  return { items, insufficient: false };
}

// ---------------------------------------------------------------------------
// Path A — hydrate from today's existing practice_sessions row
// ---------------------------------------------------------------------------

export type HydrateSessionInput = {
  session: {
    id: string;
    exerciseIds: readonly string[];
    exerciseCount: number;
    correctCount: number;
    startedAt: Date;
    completedAt: Date | null;
  };
  /**
   * One entry per exercise referenced by the session, keyed by exercise id.
   * Missing entries are dropped silently — defensive for an exercise that's
   * been deleted between session creation and dashboard load.
   */
  exercises: Map<string, { type: ExerciseType; topicHint: string | null; difficulty: CefrLevel }>;
  /**
   * Exercise ids the user has already submitted in this session (history rows
   * exist for them). The route builds this set from a left-join of
   * `user_exercise_history` × `exercises` filtered by `sessionId`.
   */
  attemptedIds: ReadonlySet<string>;
};

export type HydrateSessionResult = {
  items: PlanItem[];
  summary: {
    itemCount: number;
    correctCount: number;
    durationMinutes: number;
  } | null;
};

/**
 * Hydrates Path A deterministically.
 *
 * Items are produced in `session.exerciseIds` order so the timeline rendering
 * matches what the user actually drilled. An id without a corresponding entry
 * in the `exercises` map is silently dropped (defensive against deleted
 * exercises) — the dropped count counts toward neither `done` nor `queued`.
 *
 * `summary` is populated iff:
 *   1. Every kept item resolves to `done` (i.e., the user attempted every
 *      surviving exercise in this session), AND
 *   2. `session.completedAt` is non-null (the drill page already finalised
 *      the session via POST /sessions/:id/complete).
 *
 * The "all attempted but no completedAt" transient state therefore returns
 * `summary: null` — refetching after `/sessions/:id/complete` resolves it.
 */
export function hydrateFromSession(
  input: HydrateSessionInput,
): HydrateSessionResult {
  const { session, exercises, attemptedIds } = input;

  const items: PlanItem[] = [];
  let nextIndex = 1;
  for (const exerciseId of session.exerciseIds) {
    const exercise = exercises.get(exerciseId);
    if (!exercise) continue; // dropped silently
    items.push({
      index: nextIndex++,
      type: exercise.type,
      topicHint: exercise.topicHint,
      difficulty: exercise.difficulty,
      itemCount: ITEM_COUNT_BY_TYPE[exercise.type],
      estimatedMinutes: ESTIMATED_MINUTES_BY_TYPE[exercise.type],
      status: attemptedIds.has(exerciseId) ? 'done' : 'queued',
    });
  }

  const allDone = items.length > 0 && items.every((it) => it.status === 'done');
  const summary =
    allDone && session.completedAt !== null
      ? {
          itemCount: session.exerciseCount,
          correctCount: session.correctCount,
          durationMinutes: Math.round(
            (session.completedAt.getTime() - session.startedAt.getTime()) /
              60_000,
          ),
        }
      : null;

  return { items, summary };
}
