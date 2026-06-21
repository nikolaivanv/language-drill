import { describe, it, expect } from 'vitest';
import { CefrLevel, ExerciseType } from '@language-drill/shared';
import { rankPlanCandidates, reasonFor, type RankContext } from './rank';
import type { PoolDraw } from '../today-plan';

const draw = (id: string, grammarPointKey: string | null): PoolDraw => ({
  id,
  type: ExerciseType.CLOZE,
  topicHint: null,
  difficulty: CefrLevel.B1,
  grammarPointKey,
});

const ctx = (over: Partial<RankContext> = {}): RankContext => ({
  masteryByPoint: new Map(),
  errorCountByPoint: new Map(),
  prereqsOf: () => [],
  now: new Date('2026-06-13'),
  ...over,
});

describe('rankPlanCandidates', () => {
  it('ranks missing-evidence points above well-mastered ones', () => {
    const masteryByPoint = new Map([
      ['mastered', { masteryScore: 0.95, lastPracticedAt: new Date('2026-06-12') }],
    ]);
    const out = rankPlanCandidates(
      [draw('a', 'mastered'), draw('b', 'fresh')],
      ctx({ masteryByPoint }),
    );
    expect(out[0].id).toBe('b');
  });

  it('soft-deprioritizes (never drops) a point whose prerequisite lacks evidence', () => {
    const masteryByPoint = new Map([
      ['p-blocked', { masteryScore: 0.5, lastPracticedAt: new Date('2026-06-12') }],
      ['p-open', { masteryScore: 0.5, lastPracticedAt: new Date('2026-06-12') }],
    ]);
    const prereqsOf = (k: string) => (k === 'p-blocked' ? ['missing-prereq'] : []);
    const out = rankPlanCandidates(
      [draw('blocked', 'p-blocked'), draw('open', 'p-open')],
      ctx({ masteryByPoint, prereqsOf }),
    );
    expect(out.map((c) => c.id)).toEqual(['open', 'blocked']);
    expect(out).toHaveLength(2);
  });

  it('cold start: surfaces a no-prereq point above a prereq-gated one and keeps all', () => {
    const prereqsOf = (k: string) => (k === 'advanced' ? ['foundation'] : []);
    const out = rankPlanCandidates(
      [draw('adv', 'advanced'), draw('found', 'foundation')],
      ctx({ prereqsOf }),
    );
    expect(out[0].id).toBe('found');
    expect(out).toHaveLength(2);
  });

  it('treats null / unknown grammar keys neutrally (not bottom-pinned)', () => {
    const masteryByPoint = new Map([
      ['mastered', { masteryScore: 0.95, lastPracticedAt: new Date('2026-06-12') }],
    ]);
    const out = rankPlanCandidates(
      [draw('m', 'mastered'), draw('n', null)],
      ctx({ masteryByPoint }),
    );
    expect(out[0].id).toBe('n');
  });

  it('boosts the 0.3–0.7 growth zone', () => {
    const masteryByPoint = new Map([
      ['growth', { masteryScore: 0.5, lastPracticedAt: new Date('2026-06-13') }],
      ['near', { masteryScore: 0.72, lastPracticedAt: new Date('2026-06-13') }],
    ]);
    const out = rankPlanCandidates(
      [draw('near', 'near'), draw('growth', 'growth')],
      ctx({ masteryByPoint }),
    );
    expect(out[0].id).toBe('growth');
  });
});

describe('error-aware priority', () => {
  it('an equal-mastery point with recent errors outranks one with none', () => {
    const now = new Date('2026-06-21T00:00:00Z');
    const practiced = new Date('2026-06-20T00:00:00Z');
    const candidates = [
      { id: 'a', type: ExerciseType.CLOZE, topicHint: null, difficulty: CefrLevel.A1, grammarPointKey: 'p-clean' },
      { id: 'b', type: ExerciseType.CLOZE, topicHint: null, difficulty: CefrLevel.A1, grammarPointKey: 'p-erroring' },
    ];
    const c = ctx({
      masteryByPoint: new Map([
        ['p-clean', { masteryScore: 0.5, lastPracticedAt: practiced }],
        ['p-erroring', { masteryScore: 0.5, lastPracticedAt: practiced }],
      ]),
      errorCountByPoint: new Map([['p-erroring', 4]]),
      prereqsOf: () => [],
      now,
    });
    const ranked = rankPlanCandidates(candidates, c);
    expect(ranked[0].grammarPointKey).toBe('p-erroring');
  });

  it('caps the error term (errorCount 100 ties errorCount ERROR_CAP=5 on the error contribution)', () => {
    // Two otherwise-identical candidates: one with errorCount=5 (the cap) and one with errorCount=100.
    // If Math.min is applied correctly, both contribute ERROR_WEIGHT * 5 and thus have identical priority.
    // Stable tiebreak preserves input order. If the cap were removed (raw 100*ERROR_WEIGHT), the 100-error
    // point would rank higher — proving the assertion is genuine.
    const now = new Date('2026-06-21T00:00:00Z');
    const practiced = new Date('2026-06-20T00:00:00Z');
    const mastery = { masteryScore: 0.5, lastPracticedAt: practiced };
    const candidates = [
      { id: 'at-cap', type: ExerciseType.CLOZE, topicHint: null, difficulty: CefrLevel.A1, grammarPointKey: 'p-at-cap' },
      { id: 'over-cap', type: ExerciseType.CLOZE, topicHint: null, difficulty: CefrLevel.A1, grammarPointKey: 'p-over-cap' },
    ];
    const c = ctx({
      masteryByPoint: new Map([
        ['p-at-cap', mastery],
        ['p-over-cap', mastery],
      ]),
      // ERROR_CAP=5: one point exactly at cap, one far over it
      errorCountByPoint: new Map([['p-at-cap', 5], ['p-over-cap', 100]]),
      now,
    });
    const ranked = rankPlanCandidates(candidates, c);
    // Both have equal priority (capped to 5); stable tiebreak preserves input order.
    // If cap were removed, 'p-over-cap' would rank first — this assertion would then fail.
    expect(ranked[0].id).toBe('at-cap');
    expect(ranked[1].id).toBe('over-cap');
  });
});

describe('reasonFor', () => {
  const now = new Date('2026-06-21T00:00:00Z');
  const base = { prereqsOf: () => [], now, errorCountByPoint: new Map<string, number>(), masteryByPoint: new Map() };

  it('error-fix when recent errors are high', () => {
    const c = { ...base, masteryByPoint: new Map([['p', { masteryScore: 0.9, lastPracticedAt: now }]]), errorCountByPoint: new Map([['p', 3]]) };
    expect(reasonFor('p', c)).toBe('error-fix');
  });

  it('new when there is no mastery row', () => {
    const c = { ...base, masteryByPoint: new Map(), errorCountByPoint: new Map() };
    expect(reasonFor('p', c)).toBe('new');
  });

  it('review when a once-solid point has decayed below solid', () => {
    const old = new Date('2026-03-01T00:00:00Z'); // long idle
    const c = { ...base, masteryByPoint: new Map([['p', { masteryScore: 0.9, lastPracticedAt: old }]]), errorCountByPoint: new Map() };
    expect(reasonFor('p', c)).toBe('review');
  });

  it('reinforce for a mid-mastery point recently practiced', () => {
    const c = { ...base, masteryByPoint: new Map([['p', { masteryScore: 0.5, lastPracticedAt: now }]]), errorCountByPoint: new Map() };
    expect(reasonFor('p', c)).toBe('reinforce');
  });
});
