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
  [ExerciseType.DICTATION]: 3,
  // Free writing is a standalone drill, not drawn into the auto-composed
  // session plan; this estimate is a sensible default for the rare path that
  // ever surfaces a free-writing row.
  [ExerciseType.FREE_WRITING]: 8,
  // Conjugation is an opt-in single-form drill, not auto-composed into the
  // session plan; 2 min is a sensible default for the rare path that
  // ever surfaces a conjugation row.
  [ExerciseType.CONJUGATION]: 2,
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
  // Dictation is a single-clip listening drill — one audio clip = one item.
  [ExerciseType.DICTATION]: 1,
  // One piece of writing per free-writing drill.
  [ExerciseType.FREE_WRITING]: 1,
  // One conjugation prompt per drill (single-form production exercise).
  [ExerciseType.CONJUGATION]: 1,
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
 * The fixed v1 slot mix. Five items: warm-up cloze + core sentence construction
 * + production translation + core vocab + cool-down cloze.
 */
export const V1_PLAN_SHAPE: readonly PlanCompositionSlot[] = [
  { index: 1, prefix: 'warm-up', type: ExerciseType.CLOZE },
  { index: 2, prefix: 'core', type: ExerciseType.SENTENCE_CONSTRUCTION },
  { index: 3, prefix: 'production', type: ExerciseType.TRANSLATION },
  { index: 4, prefix: 'core', type: ExerciseType.VOCAB_RECALL },
  { index: 5, prefix: 'cool-down', type: ExerciseType.CLOZE },
] as const;

/**
 * Core type cycle for variable-length skeletons. Used to vary exercise types
 * in the core section of a dynamically-sized plan.
 */
const CORE_TYPE_CYCLE: readonly ExerciseType[] = [
  ExerciseType.SENTENCE_CONSTRUCTION,
  ExerciseType.TRANSLATION,
  ExerciseType.VOCAB_RECALL,
  ExerciseType.CLOZE,
];

/**
 * Generates a warm-up · core×(N-2) · cool-down skeleton of `targetCount` slots.
 * A single-slot plan is just that slot (no warm-up/cool-down distinction).
 * A two-slot plan is warm-up then cool-down.
 * Larger plans cycle through CORE_TYPE_CYCLE for variety in the middle slots.
 */
export function planSkeleton(targetCount: number): PlanCompositionSlot[] {
  const n = Math.max(1, Math.floor(targetCount));
  const slots: PlanCompositionSlot[] = [];
  for (let i = 0; i < n; i++) {
    const index = i + 1;
    let prefix: PlanSlotPrefix;
    let type: ExerciseType;
    if (i === 0 && n > 1) {
      prefix = 'warm-up';
      type = ExerciseType.CLOZE;
    } else if (i === n - 1 && n > 1) {
      prefix = 'cool-down';
      type = ExerciseType.CLOZE;
    } else {
      prefix = 'core';
      type = CORE_TYPE_CYCLE[(i - 1 + CORE_TYPE_CYCLE.length) % CORE_TYPE_CYCLE.length];
    }
    slots.push({ index, prefix, type });
  }
  return slots;
}

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
  /** Curriculum grammar point this item drills (null for unmapped exercises). The route resolves its display name for the timeline subtitle. */
  grammarPointKey: string | null;
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
// Free-writing cadence (Plan 1)
// ---------------------------------------------------------------------------
// A long, single-focus free-writing block is nudged on a fixed rotation rather
// than every day. Deterministic and stateless — purely a function of the UTC
// day and the language's rotation offset. The /drill hub launcher (Plan 2)
// gives anytime access, so this governs only the nudge.
// ---------------------------------------------------------------------------

/** Length of the free-writing rotation, in days. */
export const FREE_WRITING_CADENCE_DAYS = 3;

/**
 * Per-language offset into the rotation. The three learning languages use
 * distinct residues (0,1,2) mod FREE_WRITING_CADENCE_DAYS, so exactly one
 * language surfaces a free-writing block on any given UTC day. Languages absent
 * from this map default to offset 0 (defensive).
 */
const FREE_WRITING_LANGUAGE_OFFSET: Record<string, number> = {
  ES: 0,
  DE: 1,
  TR: 2,
};

/** Whole UTC days since the Unix epoch for the day containing `now`. */
function utcDayIndex(now: Date): number {
  return Math.floor(startOfUtcDay(now).getTime() / 86_400_000);
}

/**
 * True when `language` should surface a free-writing block on the UTC day
 * containing `now`.
 */
export function isFreeWritingDay(now: Date, language: string): boolean {
  const offset = FREE_WRITING_LANGUAGE_OFFSET[language] ?? 0;
  return (utcDayIndex(now) + offset) % FREE_WRITING_CADENCE_DAYS === 0;
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
  /** Curriculum grammar point this exercise targets (null for unmapped items). Used for mastery-aware ranking and carried through to the PlanItem for the timeline subtitle. */
  grammarPointKey: string | null;
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
  ExerciseType.SENTENCE_CONSTRUCTION,
];

/** Projects a single draw into the in-memory PlanItem shape at the given index. */
function toPlanItem(index: number, draw: PoolDraw): PlanItem {
  return {
    index,
    type: draw.type,
    topicHint: draw.topicHint,
    grammarPointKey: draw.grammarPointKey,
    difficulty: draw.difficulty,
    itemCount: ITEM_COUNT_BY_TYPE[draw.type],
    estimatedMinutes: ESTIMATED_MINUTES_BY_TYPE[draw.type],
    status: 'queued',
  };
}

/**
 * Selects pool draws into the skeleton's slot order — the single source of truth
 * for "which exercise fills which slot". Returns the chosen draws in slot order
 * (the source `PoolDraw`, id intact), so callers that need the exercise ids
 * (e.g. POST /sessions, which persists a session manifest) and callers that only
 * need the plan shape (composeFreshPlan, for the dashboard preview) share one
 * algorithm. This is what keeps the previewed plan and the created session in
 * agreement — see the divergence bug fixed in sessions.ts POST /sessions.
 *
 * Two passes over the skeleton:
 *   1. Assign each slot a distinct exercise of its native type (FIFO from the
 *      per-type candidate queue).
 *   2. Backfill any slot left empty (its native type ran out) with a distinct
 *      exercise of another type, following `BACKFILL_TYPE_PRIORITY`. A
 *      substituted slot keeps its position but takes the substitute's type.
 *
 * Candidates are consumed in the order given — the caller pre-ranks them
 * (exposure + mastery) so slot assignment picks the highest-priority item per
 * type. The result drops empty slots; callers re-index as needed.
 *
 * @param candidates Pool of exercises to draw from
 * @param skeleton Plan shape to fill; defaults to V1_PLAN_SHAPE for back-compat
 */
export function selectPlanDraws(
  candidates: readonly PoolDraw[],
  skeleton: readonly PlanCompositionSlot[] = V1_PLAN_SHAPE,
): PoolDraw[] {
  // Per-type FIFO queues. Mutated by `take`; ordering within a type is the
  // caller's pre-ranked order, so each shift is the highest-priority remaining
  // item of that type.
  const byType = new Map<ExerciseType, PoolDraw[]>();
  for (const candidate of candidates) {
    const queue = byType.get(candidate.type);
    if (queue) queue.push(candidate);
    else byType.set(candidate.type, [candidate]);
  }
  const take = (type: ExerciseType): PoolDraw | undefined =>
    byType.get(type)?.shift();

  // Pass 1 — native assignment.
  const slots: (PoolDraw | null)[] = skeleton.map((slot) => take(slot.type) ?? null);

  // Pass 2 — backfill empties with a distinct exercise of another type.
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] !== null) continue;
    for (const type of BACKFILL_TYPE_PRIORITY) {
      const sub = take(type);
      if (sub) {
        slots[i] = sub;
        break;
      }
    }
  }

  return slots.filter((slot): slot is PoolDraw => slot !== null);
}

/**
 * Composes the fresh-plan branch (Path B) deterministically from a pool sample.
 * Thin wrapper over `selectPlanDraws` that projects each selected draw into the
 * in-memory `PlanItem` shape for the dashboard preview.
 *
 * The plan is only `insufficient` when the pool is genuinely empty (no
 * candidate of any type) — a pool merely missing one type still yields a full
 * plan matching the skeleton size. Surviving items are re-indexed 1..n so the
 * client's index-derived labels stay contiguous.
 *
 * @param candidates Pool of exercises to draw from
 * @param skeleton Plan shape to fill; defaults to V1_PLAN_SHAPE for back-compat
 */
export function composeFreshPlan(
  candidates: readonly PoolDraw[],
  skeleton: readonly PlanCompositionSlot[] = V1_PLAN_SHAPE,
): ComposeFreshPlanResult {
  const items = selectPlanDraws(candidates, skeleton).map((draw, i) =>
    toPlanItem(i + 1, draw),
  );
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
  exercises: Map<
    string,
    { type: ExerciseType; topicHint: string | null; grammarPointKey: string | null; difficulty: CefrLevel }
  >;
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
      grammarPointKey: exercise.grammarPointKey,
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
