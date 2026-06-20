import { describe, it, expect } from 'vitest';
import { MIN_FLUENCY_POOL, ExerciseType, FLUENCY_ELIGIBLE_TYPES } from '@language-drill/shared';
import { composeFluencySession, type EligibleExercise, resolveFluencyTypes } from './fluency-session';

function eligible(id: string): EligibleExercise {
  return {
    id,
    type: 'cloze',
    language: 'ES',
    difficulty: 'B1',
    grammarPointKey: null,
    contentJson: { type: 'cloze', correctAnswer: 'x' },
  };
}

describe('composeFluencySession', () => {
  it('returns insufficient when below MIN_FLUENCY_POOL', () => {
    const pool = Array.from({ length: MIN_FLUENCY_POOL - 1 }, (_, i) => eligible(`e${i}`));
    const result = composeFluencySession(pool, 8, () => 0);
    expect(result.insufficient).toBe(true);
    expect(result.available).toBe(MIN_FLUENCY_POOL - 1);
    expect(result.items).toEqual([]);
  });

  it('returns up to `count` items when enough are eligible', () => {
    const pool = Array.from({ length: 10 }, (_, i) => eligible(`e${i}`));
    const result = composeFluencySession(pool, 8, () => 0);
    expect(result.insufficient).toBe(false);
    expect(result.items).toHaveLength(8);
  });

  it('returns all items when fewer than `count` but >= MIN_FLUENCY_POOL', () => {
    const pool = Array.from({ length: MIN_FLUENCY_POOL }, (_, i) => eligible(`e${i}`));
    const result = composeFluencySession(pool, 8, () => 0);
    expect(result.insufficient).toBe(false);
    expect(result.items).toHaveLength(MIN_FLUENCY_POOL);
  });

  it('shuffles deterministically given an injected rng', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'].map(eligible);
    // rng always returns 0 → Fisher-Yates swaps every i with index 0
    const result = composeFluencySession(pool, 5, () => 0);
    expect(result.items.map((i) => i.id)).toHaveLength(5);
    // every original id is still present (permutation, no loss/dupe)
    expect(new Set(result.items.map((i) => i.id))).toEqual(new Set(pool.map((p) => p.id)));
    // exact order pins the swap direction: each i swaps with index 0, leaving
    // [b, c, d, e, a]. A reversed/off-by-one Fisher-Yates would fail this.
    expect(result.items.map((i) => i.id)).toEqual(['b', 'c', 'd', 'e', 'a']);
  });
});

describe('resolveFluencyTypes', () => {
  it('returns all eligible types when nothing is requested', () => {
    expect(resolveFluencyTypes()).toEqual([...FLUENCY_ELIGIBLE_TYPES]);
    expect(resolveFluencyTypes([])).toEqual([...FLUENCY_ELIGIBLE_TYPES]);
  });

  it('includes conjugation among the defaults', () => {
    expect(resolveFluencyTypes()).toContain(ExerciseType.CONJUGATION);
  });

  it('filters to the requested eligible subset', () => {
    expect(resolveFluencyTypes([ExerciseType.CONJUGATION])).toEqual([ExerciseType.CONJUGATION]);
  });

  it('drops non-eligible requested types', () => {
    expect(
      resolveFluencyTypes([ExerciseType.CONJUGATION, ExerciseType.TRANSLATION]),
    ).toEqual([ExerciseType.CONJUGATION]);
  });

  it('falls back to all eligible when every requested type is non-eligible', () => {
    expect(resolveFluencyTypes([ExerciseType.TRANSLATION])).toEqual([...FLUENCY_ELIGIBLE_TYPES]);
  });
});
