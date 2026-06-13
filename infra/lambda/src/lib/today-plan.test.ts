import { describe, it, expect } from 'vitest';
import { CefrLevel, ExerciseType } from '@language-drill/shared';
import {
  ESTIMATED_MINUTES_BY_TYPE,
  ITEM_COUNT_BY_TYPE,
  V1_PLAN_SHAPE,
  composeFreshPlan,
  hydrateFromSession,
  startOfUtcDay,
  type PoolDraw,
  type HydrateSessionInput,
} from './today-plan';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function draw(
  type: ExerciseType,
  overrides: Partial<PoolDraw> = {},
): PoolDraw {
  return {
    id: overrides.id ?? `${type}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    topicHint: overrides.topicHint ?? null,
    difficulty: overrides.difficulty ?? CefrLevel.B1,
    grammarPointKey: overrides.grammarPointKey ?? null,
  };
}

/** Build a 5-draw pool aligned with V1_PLAN_SHAPE (cloze, sentence_construction, translation, vocab_recall, cloze). */
function fullPool(): PoolDraw[] {
  return V1_PLAN_SHAPE.map((slot, i) =>
    draw(slot.type, { id: `slot-${i + 1}-${slot.type}` }),
  );
}

// ---------------------------------------------------------------------------
// Static lookup tables
// ---------------------------------------------------------------------------

describe('ESTIMATED_MINUTES_BY_TYPE / ITEM_COUNT_BY_TYPE', () => {
  it('exposes minute/count estimates for sentence_construction', () => {
    expect(ESTIMATED_MINUTES_BY_TYPE[ExerciseType.SENTENCE_CONSTRUCTION]).toBe(3);
    expect(ITEM_COUNT_BY_TYPE[ExerciseType.SENTENCE_CONSTRUCTION]).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// V1_PLAN_SHAPE
// ---------------------------------------------------------------------------

describe('V1_PLAN_SHAPE', () => {
  it('places sentence construction in the core slot 2', () => {
    expect(V1_PLAN_SHAPE.map((s) => s.type)).toEqual([
      ExerciseType.CLOZE,
      ExerciseType.SENTENCE_CONSTRUCTION,
      ExerciseType.TRANSLATION,
      ExerciseType.VOCAB_RECALL,
      ExerciseType.CLOZE,
    ]);
  });
});

// ---------------------------------------------------------------------------
// startOfUtcDay
// ---------------------------------------------------------------------------

describe('startOfUtcDay', () => {
  it('collapses a midday UTC timestamp to 00:00:00 UTC of the same day', () => {
    const result = startOfUtcDay(new Date('2026-05-04T15:23:45.678Z'));
    expect(result.toISOString()).toBe('2026-05-04T00:00:00.000Z');
  });

  it('preserves the year on a year-boundary input (2026-01-01T00:30 UTC)', () => {
    const result = startOfUtcDay(new Date('2026-01-01T00:30:00Z'));
    expect(result.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('preserves the year on a December 31st late-evening UTC input', () => {
    const result = startOfUtcDay(new Date('2025-12-31T23:59:59.999Z'));
    expect(result.toISOString()).toBe('2025-12-31T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// composeFreshPlan
// ---------------------------------------------------------------------------

describe('composeFreshPlan', () => {
  it('returns 5 items in V1_PLAN_SHAPE order, all queued, when given a full pool', () => {
    const result = composeFreshPlan(fullPool());

    expect(result.insufficient).toBe(false);
    expect(result.items).toHaveLength(5);

    expect(result.items.map((it) => it.type)).toEqual(
      V1_PLAN_SHAPE.map((s) => s.type),
    );
    expect(result.items.map((it) => it.index)).toEqual([1, 2, 3, 4, 5]);
    expect(result.items.every((it) => it.status === 'queued')).toBe(true);
  });

  it('returns { items: [], insufficient: true } only when the pool is empty', () => {
    expect(composeFreshPlan([])).toEqual({ items: [], insufficient: true });
  });

  it('backfills a missing type so a pool lacking vocab_recall still yields 5 distinct items', () => {
    // A1-Turkish shape: plenty of cloze + translation, zero vocab_recall.
    // Distinct topicHints let us assert no exercise is reused across slots.
    const candidates: PoolDraw[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        draw(ExerciseType.CLOZE, { id: `cloze-${i}`, topicHint: `cloze-${i}` }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        draw(ExerciseType.TRANSLATION, { id: `tr-${i}`, topicHint: `tr-${i}` }),
      ),
    ];

    const { items, insufficient } = composeFreshPlan(candidates);

    expect(insufficient).toBe(false);
    expect(items).toHaveLength(5);
    // The vocab_recall slot (index 4) is backfilled with a cloze.
    expect(items[3].type).toBe(ExerciseType.CLOZE);
    expect(items.map((it) => it.index)).toEqual([1, 2, 3, 4, 5]);
    // Every served exercise is distinct (no candidate reused across slots).
    expect(new Set(items.map((it) => it.topicHint)).size).toBe(5);
  });

  it('serves a shorter plan (no insufficient) when the pool cannot reach 5', () => {
    const candidates: PoolDraw[] = [
      draw(ExerciseType.CLOZE, { id: 'c1' }),
      draw(ExerciseType.TRANSLATION, { id: 't1' }),
    ];

    const { items, insufficient } = composeFreshPlan(candidates);

    expect(insufficient).toBe(false);
    expect(items).toHaveLength(2);
    expect(items.map((it) => it.index)).toEqual([1, 2]);
  });

  it('hydrates estimatedMinutes and itemCount from the static lookup tables', () => {
    const result = composeFreshPlan(fullPool());
    for (const item of result.items) {
      expect(item.estimatedMinutes).toBe(
        ESTIMATED_MINUTES_BY_TYPE[item.type],
      );
      expect(item.itemCount).toBe(ITEM_COUNT_BY_TYPE[item.type]);
    }
  });

  it('preserves the topicHint and difficulty from each draw', () => {
    // One draw per slot matching the new V1_PLAN_SHAPE:
    // cloze / sentence_construction / translation / vocab_recall / cloze
    const draws: PoolDraw[] = [
      draw(ExerciseType.CLOZE, { id: 's1', topicHint: 'subjunctive', difficulty: CefrLevel.B2 }),
      draw(ExerciseType.SENTENCE_CONSTRUCTION, { id: 's2', topicHint: 'pronoun-placement', difficulty: CefrLevel.B2 }),
      draw(ExerciseType.TRANSLATION, { id: 's3', topicHint: null, difficulty: CefrLevel.B2 }),
      draw(ExerciseType.VOCAB_RECALL, { id: 's4', topicHint: 'food', difficulty: CefrLevel.B2 }),
      draw(ExerciseType.CLOZE, { id: 's5', topicHint: 'preterite', difficulty: CefrLevel.B2 }),
    ];

    const { items } = composeFreshPlan(draws);
    expect(items.map((it) => it.topicHint)).toEqual([
      'subjunctive',
      'pronoun-placement',
      null,
      'food',
      'preterite',
    ]);
    expect(items.every((it) => it.difficulty === CefrLevel.B2)).toBe(true);
  });

  it('ignores the deferred radarSnapshot parameter (v1)', () => {
    const withRadar = composeFreshPlan(fullPool(), { whatever: true });
    const withoutRadar = composeFreshPlan(fullPool());
    // Same shape ignoring the random ids — compare just the structural fields.
    expect(withRadar.insufficient).toBe(withoutRadar.insufficient);
    expect(withRadar.items.length).toBe(withoutRadar.items.length);
  });

  it('backfills an SC slot from other types when the SC pool is empty', () => {
    const cloze = Array.from({ length: 5 }, (_, i) =>
      draw(ExerciseType.CLOZE, { id: `c${i}` }),
    );
    const { items, insufficient } = composeFreshPlan(cloze);
    expect(insufficient).toBe(false);
    expect(items).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// hydrateFromSession
// ---------------------------------------------------------------------------

const SESSION_STARTED_AT = new Date('2026-05-04T08:00:00Z');
const SESSION_COMPLETED_AT = new Date('2026-05-04T08:18:00Z'); // +18 minutes

function buildExercisesMap(entries: Array<[string, ExerciseType]>) {
  return new Map(
    entries.map(([id, type]) => [
      id,
      {
        type,
        topicHint: 'subjunctive',
        difficulty: CefrLevel.B1,
      },
    ]),
  );
}

function baseSession(overrides: Partial<HydrateSessionInput['session']> = {}) {
  return {
    id: 'session-1',
    exerciseIds: ['e1', 'e2', 'e3', 'e4', 'e5'],
    exerciseCount: 5,
    correctCount: 4,
    startedAt: SESSION_STARTED_AT,
    completedAt: SESSION_COMPLETED_AT,
    ...overrides,
  };
}

describe('hydrateFromSession', () => {
  const fullExercises = buildExercisesMap([
    ['e1', ExerciseType.CLOZE],
    ['e2', ExerciseType.CLOZE],
    ['e3', ExerciseType.TRANSLATION],
    ['e4', ExerciseType.VOCAB_RECALL],
    ['e5', ExerciseType.CLOZE],
  ]);

  it('populates summary when every item is attempted and completedAt is set', () => {
    const result = hydrateFromSession({
      session: baseSession(),
      exercises: fullExercises,
      attemptedIds: new Set(['e1', 'e2', 'e3', 'e4', 'e5']),
    });

    expect(result.items.every((it) => it.status === 'done')).toBe(true);
    expect(result.summary).toEqual({
      itemCount: 5,
      correctCount: 4,
      durationMinutes: 18,
    });
  });

  it('returns summary: null when only some items are attempted (partial completion)', () => {
    const result = hydrateFromSession({
      session: baseSession(),
      exercises: fullExercises,
      attemptedIds: new Set(['e1', 'e2']),
    });

    expect(result.items.map((it) => it.status)).toEqual([
      'done',
      'done',
      'queued',
      'queued',
      'queued',
    ]);
    expect(result.summary).toBeNull();
  });

  it('returns summary: null when every item is attempted but completedAt is null (transient state)', () => {
    const result = hydrateFromSession({
      session: baseSession({ completedAt: null }),
      exercises: fullExercises,
      attemptedIds: new Set(['e1', 'e2', 'e3', 'e4', 'e5']),
    });

    expect(result.items.every((it) => it.status === 'done')).toBe(true);
    expect(result.summary).toBeNull();
  });

  it('drops items whose exercise row is missing from the map (defensive)', () => {
    const partial = buildExercisesMap([
      ['e1', ExerciseType.CLOZE],
      // e2 deliberately missing
      ['e3', ExerciseType.TRANSLATION],
      ['e4', ExerciseType.VOCAB_RECALL],
      ['e5', ExerciseType.CLOZE],
    ]);

    const result = hydrateFromSession({
      session: baseSession(),
      exercises: partial,
      attemptedIds: new Set(['e1', 'e3', 'e4', 'e5']),
    });

    // 4 items survive (e2 dropped); indices renumber 1..4.
    expect(result.items).toHaveLength(4);
    expect(result.items.map((it) => it.index)).toEqual([1, 2, 3, 4]);
    // Missing item shouldn't poison "all done" — it's not counted.
    expect(result.items.every((it) => it.status === 'done')).toBe(true);
    // exerciseCount in summary still reflects the session row (5), not surviving items (4).
    expect(result.summary).toEqual({
      itemCount: 5,
      correctCount: 4,
      durationMinutes: 18,
    });
  });

  it('preserves session.exerciseIds order in the output items', () => {
    const exercises = buildExercisesMap([
      ['e1', ExerciseType.VOCAB_RECALL],
      ['e2', ExerciseType.TRANSLATION],
      ['e3', ExerciseType.CLOZE],
      ['e4', ExerciseType.CLOZE],
      ['e5', ExerciseType.TRANSLATION],
    ]);

    const result = hydrateFromSession({
      session: baseSession({ exerciseIds: ['e3', 'e1', 'e5', 'e2', 'e4'] }),
      exercises,
      attemptedIds: new Set(),
    });

    expect(result.items.map((it) => it.type)).toEqual([
      ExerciseType.CLOZE, // e3
      ExerciseType.VOCAB_RECALL, // e1
      ExerciseType.TRANSLATION, // e5
      ExerciseType.TRANSLATION, // e2
      ExerciseType.CLOZE, // e4
    ]);
  });

  it('rounds durationMinutes from a 17m32s session to 18 minutes', () => {
    const startedAt = new Date('2026-05-04T08:00:00Z');
    const completedAt = new Date('2026-05-04T08:17:32Z'); // 17m32s → rounds to 18
    const result = hydrateFromSession({
      session: baseSession({ startedAt, completedAt }),
      exercises: fullExercises,
      attemptedIds: new Set(['e1', 'e2', 'e3', 'e4', 'e5']),
    });

    expect(result.summary?.durationMinutes).toBe(18);
  });
});
