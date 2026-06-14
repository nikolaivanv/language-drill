import { describe, it, expect } from 'vitest';
import { CefrLevel, ExerciseType } from '@language-drill/shared';
import { rankPlanCandidates, type RankContext } from './rank';
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
