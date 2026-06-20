import { describe, it, expect } from 'vitest';
import { CurriculumMapResponseSchema } from './curriculum';

const point = (over = {}) => ({
  key: 'tr-a1-vowel-harmony', name: 'Vowel harmony', cefrLevel: 'A1', order: 1,
  state: 'solid', errorProne: false, mastery: 0.9, confidence: 0.8, evidenceCount: 5,
  lastPracticedAt: '2026-06-10T00:00:00.000Z', recentErrorCount: 0,
  prereqKeys: [], prereqNames: [], prereqUnmet: false, ...over,
});

describe('CurriculumMapResponseSchema', () => {
  it('parses a valid payload', () => {
    const r = CurriculumMapResponseSchema.safeParse({
      language: 'TR', activeLevel: 'A1',
      levels: [{ level: 'A1', solidCount: 1, total: 1, readyToAdvance: true, isPreview: false, points: [point()] }],
    });
    expect(r.success).toBe(true);
  });
  it('accepts null mastery/lastPracticedAt for not-started points', () => {
    const r = CurriculumMapResponseSchema.safeParse({
      language: 'TR', activeLevel: 'A1',
      levels: [{ level: 'A1', solidCount: 0, total: 1, readyToAdvance: false, isPreview: false,
        points: [point({ state: 'not-started', mastery: null, confidence: null, evidenceCount: 0, lastPracticedAt: null })] }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects an unknown state', () => {
    const r = CurriculumMapResponseSchema.safeParse({
      language: 'TR', activeLevel: 'A1',
      levels: [{ level: 'A1', solidCount: 0, total: 1, readyToAdvance: false, isPreview: false, points: [point({ state: 'mastered' })] }],
    });
    expect(r.success).toBe(false);
  });
});
