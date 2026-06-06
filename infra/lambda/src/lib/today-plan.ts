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
  [ExerciseType.SENTENCE_CONSTRUCTION]: 3,
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
  [ExerciseType.SENTENCE_CONSTRUCTION]: 3,
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
 * One candidate exercise from the pool sample. The sample over-fetches several
 * distinct rows per exercise type (not one-per-slot), so `composeFreshPlan` can
 * backfill a slot whose native type is missing with a distinct exercise of
 * another available type — see Design §"Query 2 (Path B) — pool sample".
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
 * Fallback type order when a slot's native exercise type is exhausted. A missing
 * type (e.g. no vocab_recall in the pool at this level) no longer empties the
 * whole plan: the slot is backfilled with a distinct exercise of the first
 * available type in this order, keeping the plan at five items.
 */
const BACKFILL_TYPE_PRIORITY: readonly ExerciseType[] = [
  ExerciseType.CLOZE,
  ExerciseType.TRANSLATION,
  ExerciseType.VOCAB_RECALL,
];

/** Projects a single draw into the in-memory PlanItem shape at the given index. */
function toPlanItem(index: number, draw: PoolDraw): PlanItem {
  return {
    index,
    type: draw.type,
    topicHint: draw.topicHint,
    difficulty: draw.difficulty,
    itemCount: ITEM_COUNT_BY_TYPE[draw.type],
    estimatedMinutes: ESTIMATED_MINUTES_BY_TYPE[draw.type],
    status: 'queued',
  };
}

/**
 * Composes the fresh-plan branch (Path B) deterministically from a pool sample.
 *
 * Two passes over `V1_PLAN_SHAPE`:
 *   1. Assign each slot a distinct exercise of its native type (FIFO from the
 *      per-type candidate queue).
 *   2. Backfill any slot left empty (its native type ran out) with a distinct
 *      exercise of another type, following `BACKFILL_TYPE_PRIORITY`. A
 *      substituted slot keeps its position but takes the substitute's type, so
 *      itemCount / estimatedMinutes / topicHint reflect the exercise actually
 *      served.
 *
 * The plan is only `insufficient` when the pool is genuinely empty (no
 * candidate of any type) — a pool merely missing one type still yields a full
 * five-item plan. Surviving items are re-indexed 1..n so the client's
 * index-derived labels stay contiguous.
 *
 * The unused `_radarSnapshot` parameter is the deferred adaptive swap point
 * (Design §"Adaptive swap point") — v1 ignores it.
 */
export function composeFreshPlan(
  candidates: readonly PoolDraw[],
  _radarSnapshot?: unknown,
): ComposeFreshPlanResult {
  // Per-type FIFO queues. Mutated by `take`; ordering within a type is the
  // pool sample's random order, so each shift is an independent random pick.
  const byType = new Map<ExerciseType, PoolDraw[]>();
  for (const candidate of candidates) {
    const queue = byType.get(candidate.type);
    if (queue) queue.push(candidate);
    else byType.set(candidate.type, [candidate]);
  }
  const take = (type: ExerciseType): PoolDraw | undefined =>
    byType.get(type)?.shift();

  // Pass 1 — native assignment.
  const slots: (PlanItem | null)[] = V1_PLAN_SHAPE.map((slot) => {
    const native = take(slot.type);
    return native ? toPlanItem(slot.index, native) : null;
  });

  // Pass 2 — backfill empties with a distinct exercise of another type.
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] !== null) continue;
    for (const type of BACKFILL_TYPE_PRIORITY) {
      const sub = take(type);
      if (sub) {
        slots[i] = toPlanItem(V1_PLAN_SHAPE[i].index, sub);
        break;
      }
    }
  }

  const items = slots
    .filter((slot): slot is PlanItem => slot !== null)
    .map((item, i) => ({ ...item, index: i + 1 }));

  return { items, insufficient: items.length === 0 };
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
