import { describe, it, expect } from 'vitest';
import { CefrLevel, ExerciseType } from '@language-drill/shared';
import {
  RADAR_AXIS_ORDER,
  axisForExerciseType,
  difficultyWeight,
  recencyWeight,
  aggregateAxisMastery,
  aggregateRadar,
  pivotCells,
  aggregateTopicMastery,
  DEFAULT_SHADE_THRESHOLDS,
  type ContributingRow,
} from './progress-aggregation';

const NOW = new Date('2026-04-01T12:00:00Z');
const DAY = 86_400_000;

function rowsAt(
  offsetsDays: number[],
  options: { score?: number; difficulty?: CefrLevel; type?: string } = {},
): ContributingRow[] {
  const {
    score = 1,
    difficulty = CefrLevel.B1,
    type = ExerciseType.CLOZE,
  } = options;
  return offsetsDays.map((d) => ({
    score,
    difficulty,
    type,
    evaluatedAt: new Date(NOW.getTime() - d * DAY),
  }));
}

describe('axisForExerciseType', () => {
  it('maps the three implemented types', () => {
    expect(axisForExerciseType(ExerciseType.CLOZE)).toBe('grammar');
    expect(axisForExerciseType(ExerciseType.TRANSLATION)).toBe('writing');
    expect(axisForExerciseType(ExerciseType.VOCAB_RECALL)).toBe('vocabulary');
  });

  it('maps the reserved listening and speaking types', () => {
    expect(axisForExerciseType('listening')).toBe('listening');
    expect(axisForExerciseType('speaking')).toBe('speaking');
  });

  it('maps any "reading*" prefix to the reading axis', () => {
    expect(axisForExerciseType('reading')).toBe('reading');
    expect(axisForExerciseType('reading_mc')).toBe('reading');
    expect(axisForExerciseType('reading_short_answer')).toBe('reading');
  });

  it('returns null for unknown types', () => {
    expect(axisForExerciseType('mystery_type')).toBeNull();
    expect(axisForExerciseType('')).toBeNull();
  });
});

describe('difficultyWeight', () => {
  it('returns the documented weight per CEFR level', () => {
    expect(difficultyWeight(CefrLevel.A1)).toBe(0.5);
    expect(difficultyWeight(CefrLevel.A2)).toBe(0.7);
    expect(difficultyWeight(CefrLevel.B1)).toBe(0.9);
    expect(difficultyWeight(CefrLevel.B2)).toBe(1.1);
    expect(difficultyWeight(CefrLevel.C1)).toBe(1.3);
    expect(difficultyWeight(CefrLevel.C2)).toBe(1.5);
  });
});

describe('recencyWeight', () => {
  it('returns 1 at zero days ago and decays exponentially', () => {
    expect(recencyWeight(NOW, NOW)).toBeCloseTo(1, 10);
    const thirtyDaysAgo = new Date(NOW.getTime() - 30 * DAY);
    expect(recencyWeight(thirtyDaysAgo, NOW)).toBeCloseTo(Math.exp(-1), 6);
  });
});

describe('aggregateAxisMastery', () => {
  it('returns 0 on empty input', () => {
    expect(aggregateAxisMastery([], NOW)).toBe(0);
  });

  it('returns the score itself for a single row', () => {
    expect(
      aggregateAxisMastery(rowsAt([0], { score: 0.7 }), NOW),
    ).toBeCloseTo(0.7, 6);
  });

  it('weights B2 rows more heavily than A1 rows when scores differ', () => {
    // B2 (weight 1.1) at score 1.0 + A1 (weight 0.5) at score 0.0,
    // both today → mastery = 1.1 / 1.6 ≈ 0.6875
    const rows: ContributingRow[] = [
      ...rowsAt([0], { score: 1, difficulty: CefrLevel.B2 }),
      ...rowsAt([0], { score: 0, difficulty: CefrLevel.A1 }),
    ];
    const mastery = aggregateAxisMastery(rows, NOW);
    expect(mastery).toBeGreaterThan(0.6);
    expect(mastery).toBeLessThan(0.75);
    // Exact value, derived from the documented weights
    expect(mastery).toBeCloseTo(1.1 / 1.6, 6);
  });

  it('discounts older evidence relative to fresh evidence', () => {
    // 60-day-old correct (recency exp(-2) ≈ 0.135) + same-day wrong → mastery < 0.5
    const rows: ContributingRow[] = [
      ...rowsAt([60], { score: 1 }),
      ...rowsAt([0], { score: 0 }),
    ];
    const mastery = aggregateAxisMastery(rows, NOW);
    expect(mastery).toBeLessThan(0.5);
  });

  it('clamps results to [0, 1] even given pathological scores', () => {
    const rows: ContributingRow[] = rowsAt([0], { score: 1.5 });
    expect(aggregateAxisMastery(rows, NOW)).toBe(1);

    const negativeRows: ContributingRow[] = rowsAt([0], { score: -0.2 });
    expect(aggregateAxisMastery(negativeRows, NOW)).toBe(0);
  });
});

describe('aggregateRadar', () => {
  it('always returns six axes in RADAR_AXIS_ORDER', () => {
    const axes = aggregateRadar([], NOW);
    expect(axes).toHaveLength(6);
    expect(axes.map((a) => a.key)).toEqual([...RADAR_AXIS_ORDER]);
  });

  it('marks axes without contributing rows as zero with evidenceCount 0', () => {
    const axes = aggregateRadar([], NOW);
    for (const axis of axes) {
      expect(axis.currentMastery).toBe(0);
      expect(axis.previousMastery).toBe(0);
      expect(axis.lastPracticedAt).toBeNull();
      expect(axis.evidenceCount).toBe(0);
    }
  });

  it('routes rows to the right axis and tracks lastPracticedAt + evidenceCount', () => {
    const rows: ContributingRow[] = [
      ...rowsAt([0], { type: ExerciseType.CLOZE, score: 0.8 }),
      ...rowsAt([5], { type: ExerciseType.CLOZE, score: 0.9 }),
      ...rowsAt([1], { type: ExerciseType.VOCAB_RECALL, score: 0.6 }),
    ];

    const axes = aggregateRadar(rows, NOW);
    const grammar = axes.find((a) => a.key === 'grammar')!;
    const vocab = axes.find((a) => a.key === 'vocabulary')!;
    const writing = axes.find((a) => a.key === 'writing')!;

    expect(grammar.evidenceCount).toBe(2);
    expect(grammar.lastPracticedAt).toBe(NOW.toISOString());
    expect(grammar.currentMastery).toBeGreaterThan(0);

    expect(vocab.evidenceCount).toBe(1);
    expect(vocab.lastPracticedAt).toBe(
      new Date(NOW.getTime() - 1 * DAY).toISOString(),
    );

    // Untouched axis stays at zero / null
    expect(writing.evidenceCount).toBe(0);
    expect(writing.lastPracticedAt).toBeNull();
  });

  it('falls back previousMastery to currentMastery when no rows older than 30 days', () => {
    const rows: ContributingRow[] = rowsAt([0, 5, 10], {
      type: ExerciseType.CLOZE,
      score: 0.8,
    });
    const grammar = aggregateRadar(rows, NOW).find((a) => a.key === 'grammar')!;
    expect(grammar.previousMastery).toBe(grammar.currentMastery);
  });

  it('computes previousMastery from rows older than 30 days only', () => {
    // Recent rows are perfect, older rows are awful — previousMastery should
    // reflect only the older bucket and therefore be well below currentMastery.
    const rows: ContributingRow[] = [
      ...rowsAt([0, 5, 10], { type: ExerciseType.CLOZE, score: 1 }),
      ...rowsAt([45, 60], { type: ExerciseType.CLOZE, score: 0 }),
    ];
    const grammar = aggregateRadar(rows, NOW).find((a) => a.key === 'grammar')!;
    expect(grammar.currentMastery).toBeGreaterThan(grammar.previousMastery);
    expect(grammar.previousMastery).toBe(0);
  });

  it('drops rows whose type does not map to any axis', () => {
    const rows: ContributingRow[] = rowsAt([0], { type: 'wat' });
    const axes = aggregateRadar(rows, NOW);
    for (const axis of axes) expect(axis.evidenceCount).toBe(0);
  });
});

describe('pivotCells', () => {
  it('returns a fixed-length array of 30 zeros for empty input', () => {
    const cells = pivotCells([], NOW);
    expect(cells).toHaveLength(30);
    expect(cells.every((c) => c === 0)).toBe(true);
  });

  it("places today's attempts at the last index", () => {
    const cells = pivotCells([{ evaluatedAt: NOW }], NOW);
    expect(cells[29]).toBe(1);
    expect(cells.slice(0, 29).every((c) => c === 0)).toBe(true);
  });

  it('counts two attempts on the same UTC day as 2', () => {
    const cells = pivotCells(
      [
        { evaluatedAt: new Date('2026-04-01T01:00:00Z') },
        { evaluatedAt: new Date('2026-04-01T22:00:00Z') },
      ],
      NOW,
    );
    expect(cells[29]).toBe(2);
  });

  it('places yesterday at index 28 and a 29-day-old attempt at index 0', () => {
    const yesterday = new Date(NOW.getTime() - DAY);
    const oldest = new Date(NOW.getTime() - 29 * DAY);
    const cells = pivotCells(
      [{ evaluatedAt: yesterday }, { evaluatedAt: oldest }],
      NOW,
    );
    expect(cells[28]).toBe(1);
    expect(cells[0]).toBe(1);
  });

  it('drops attempts outside the window', () => {
    const tooOld = new Date(NOW.getTime() - 30 * DAY);
    const future = new Date(NOW.getTime() + DAY);
    const cells = pivotCells(
      [{ evaluatedAt: tooOld }, { evaluatedAt: future }],
      NOW,
    );
    expect(cells.every((c) => c === 0)).toBe(true);
  });
});

describe('aggregateTopicMastery', () => {
  it('matches aggregateAxisMastery for the same input', () => {
    const rows = rowsAt([0, 5, 10], { score: 0.7 });
    expect(aggregateTopicMastery(rows, NOW)).toBe(
      aggregateAxisMastery(rows, NOW),
    );
  });
});

describe('DEFAULT_SHADE_THRESHOLDS', () => {
  it('matches the prototype bucketing', () => {
    expect(DEFAULT_SHADE_THRESHOLDS).toEqual({
      paper2: 1,
      accentSoft: 2,
      accent: 4,
    });
  });
});
