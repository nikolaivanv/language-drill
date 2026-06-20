import { describe, it, expect } from 'vitest';
import { buildCurriculumMap, nextCefrLevel } from './curriculum-map';

const fact = (over: Partial<{ key: string; name: string; cefrLevel: string; order: number; prereqKeys: string[]; prereqNames: string[] }> = {}) => ({
  key: 'tr-a1-x',
  name: 'X',
  cefrLevel: 'A1',
  order: 1,
  prereqKeys: [],
  prereqNames: [],
  ...over,
});
const mastery = (over: Partial<{ masteryScore: number; confidence: number; evidenceCount: number; lastPracticedAt: Date }> = {}) => ({
  masteryScore: 0.9,
  confidence: 0.8,
  evidenceCount: 5,
  lastPracticedAt: new Date('2026-06-10T00:00:00Z'),
  ...over,
});
const now = new Date('2026-06-20T00:00:00Z');

describe('nextCefrLevel', () => {
  it('walks A1→A2→B1→B2→null', () => {
    expect(nextCefrLevel('A1')).toBe('A2');
    expect(nextCefrLevel('A2')).toBe('B1');
    expect(nextCefrLevel('B2')).toBeNull();
    expect(nextCefrLevel('C1')).toBeNull();
  });
});

describe('buildCurriculumMap — state classification', () => {
  const base = {
    activeLevel: 'A1',
    previewPoints: [],
    errorCountByKey: new Map<string, number>(),
    now,
  };

  it('classifies not-started (no mastery row) / learning / solid', () => {
    const points = [
      fact({ key: 'a', order: 1 }),
      fact({ key: 'b', order: 2 }),
      fact({ key: 'c', order: 3 }),
    ];
    const masteryByKey = new Map([
      ['b', mastery({ masteryScore: 0.5, confidence: 0.4, evidenceCount: 2 })], // learning
      ['c', mastery({ masteryScore: 0.85, confidence: 0.7, evidenceCount: 4 })], // solid
    ]);
    const out = buildCurriculumMap({ ...base, activePoints: points, masteryByKey });
    const byKey = Object.fromEntries(out.levels[0].points.map((p) => [p.key, p.state]));
    expect(byKey).toEqual({ a: 'not-started', b: 'learning', c: 'solid' });
  });

  it('treats evidenceCount 0 as not-started even with a mastery row', () => {
    const out = buildCurriculumMap({
      ...base,
      activePoints: [fact({ key: 'a' })],
      masteryByKey: new Map([['a', mastery({ evidenceCount: 0 })]]),
    });
    expect(out.levels[0].points[0].state).toBe('not-started');
  });

  it('requires BOTH mastery>=0.80 and confidence>=0.60 for solid', () => {
    const out = buildCurriculumMap({
      ...base,
      activePoints: [fact({ key: 'a' }), fact({ key: 'b', order: 2 })],
      masteryByKey: new Map([
        ['a', mastery({ masteryScore: 0.85, confidence: 0.5 })], // conf too low → learning
        ['b', mastery({ masteryScore: 0.7, confidence: 0.9 })], // mastery too low → learning
      ]),
    });
    expect(out.levels[0].points.map((p) => p.state)).toEqual(['learning', 'learning']);
  });

  it('flags errorProne at >=2 recent errors (overlay co-exists with solid)', () => {
    const out = buildCurriculumMap({
      ...base,
      activePoints: [fact({ key: 'a' })],
      masteryByKey: new Map([['a', mastery()]]), // solid
      errorCountByKey: new Map([['a', 3]]),
    });
    expect(out.levels[0].points[0]).toMatchObject({ state: 'solid', errorProne: true, recentErrorCount: 3 });
  });

  it('marks prereqUnmet when a prereq is not solid, resolving its name', () => {
    const out = buildCurriculumMap({
      ...base,
      activePoints: [
        fact({ key: 'vh', name: 'Vowel harmony', order: 1 }),
        fact({ key: 'loc', name: 'Locative', order: 2, prereqKeys: ['vh'], prereqNames: ['Vowel harmony'] }),
      ],
      masteryByKey: new Map(), // vh not solid
    });
    const loc = out.levels[0].points.find((p) => p.key === 'loc')!;
    expect(loc.prereqUnmet).toBe(true);
  });

  it('computes the per-level solid rollup + readyToAdvance at >=80%', () => {
    const pts = Array.from({ length: 5 }, (_, i) => fact({ key: `k${i}`, order: i + 1 }));
    const m = new Map(pts.slice(0, 4).map((p) => [p.key, mastery()])); // 4/5 solid = 80%
    const out = buildCurriculumMap({ ...base, activePoints: pts, masteryByKey: m });
    expect(out.levels[0]).toMatchObject({ solidCount: 4, total: 5, readyToAdvance: true });
  });

  it('appends the next level as a preview (isPreview true)', () => {
    const out = buildCurriculumMap({
      ...base,
      activePoints: [fact({ key: 'a' })],
      previewPoints: [fact({ key: 'a2', name: 'Aorist', cefrLevel: 'A2', order: 1 })],
      masteryByKey: new Map(),
    });
    expect(out.levels.map((l) => [l.level, l.isPreview])).toEqual([['A1', false], ['A2', true]]);
  });

  it('serializes lastPracticedAt as an ISO string and nulls it when absent', () => {
    const out = buildCurriculumMap({
      ...base,
      activePoints: [fact({ key: 'a' }), fact({ key: 'b', order: 2 })],
      masteryByKey: new Map([['a', mastery({ lastPracticedAt: new Date('2026-06-10T00:00:00Z') })]]),
    });
    const byKey = Object.fromEntries(out.levels[0].points.map((p) => [p.key, p.lastPracticedAt]));
    expect(byKey).toEqual({ a: '2026-06-10T00:00:00.000Z', b: null });
  });
});
