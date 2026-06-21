import { describe, it, expect } from 'vitest';
import { Language } from '@language-drill/shared';
import { composePathCue } from '../path-cue';
import type { CurriculumMapResponse } from '@language-drill/api-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMap(
  points: { name: string; order: number; state: 'not-started' | 'learning' | 'solid' }[],
  activeLevel = 'A1',
): CurriculumMapResponse {
  return {
    language: Language.ES,
    activeLevel,
    levels: [
      {
        level: activeLevel,
        solidCount: points.filter((p) => p.state === 'solid').length,
        total: points.length,
        readyToAdvance: false,
        isPreview: false,
        points: points.map((p, i) => ({
          key: `key-${i}`,
          name: p.name,
          cefrLevel: activeLevel,
          order: p.order,
          state: p.state,
          errorProne: false,
          mastery: null,
          confidence: null,
          evidenceCount: 0,
          lastPracticedAt: null,
          recentErrorCount: 0,
          prereqKeys: [],
          prereqNames: [],
          prereqUnmet: false,
          compatibleTypes: [],
          hasTheory: false,
          errorSample: null,
        })),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('composePathCue', () => {
  it('returns null for undefined map', () => {
    expect(composePathCue(undefined)).toBeNull();
  });

  it('returns null when the active level is not in the levels array', () => {
    const map = makeMap([], 'A1');
    // Override to have no A1 level
    const noLevelMap: CurriculumMapResponse = {
      ...map,
      activeLevel: 'B1',
    };
    expect(composePathCue(noLevelMap)).toBeNull();
  });

  it('returns positionLabel "point 6 of A1" and nextName = first not-started point', () => {
    const points = [
      { name: 'Present tense', order: 1, state: 'solid' as const },
      { name: 'Ser vs Estar', order: 2, state: 'solid' as const },
      { name: 'Definite articles', order: 3, state: 'learning' as const },
      { name: 'Indefinite articles', order: 4, state: 'learning' as const },
      { name: 'Subject pronouns', order: 5, state: 'solid' as const },
      { name: 'Gender agreement', order: 6, state: 'learning' as const },
      { name: 'Plural formation', order: 7, state: 'not-started' as const },
      { name: 'Number agreement', order: 8, state: 'not-started' as const },
      { name: 'Reflexive verbs', order: 9, state: 'not-started' as const },
    ];
    const result = composePathCue(makeMap(points));
    expect(result).not.toBeNull();
    expect(result!.positionLabel).toBe('point 6 of A1');
    expect(result!.nextName).toBe('Plural formation');
  });

  it('returns nextName = the lowest-order not-started point, not just any not-started', () => {
    const points = [
      { name: 'Gamma', order: 10, state: 'not-started' as const },
      { name: 'Alpha', order: 3, state: 'not-started' as const },
      { name: 'Beta', order: 7, state: 'learning' as const },
    ];
    const result = composePathCue(makeMap(points));
    expect(result!.positionLabel).toBe('point 1 of A1');
    expect(result!.nextName).toBe('Alpha');
  });

  it('returns nextName null when all points are touched (no not-started)', () => {
    const points = [
      { name: 'Present tense', order: 1, state: 'solid' as const },
      { name: 'Ser vs Estar', order: 2, state: 'learning' as const },
      { name: 'Articles', order: 3, state: 'solid' as const },
    ];
    const result = composePathCue(makeMap(points));
    expect(result).not.toBeNull();
    expect(result!.positionLabel).toBe('point 3 of A1');
    expect(result!.nextName).toBeNull();
  });

  it('returns positionLabel "point 0 of A2" when all points are not-started', () => {
    const points = [
      { name: 'Subjunctive', order: 1, state: 'not-started' as const },
      { name: 'Passive voice', order: 2, state: 'not-started' as const },
    ];
    const result = composePathCue(makeMap(points, 'A2'));
    expect(result!.positionLabel).toBe('point 0 of A2');
    expect(result!.nextName).toBe('Subjunctive');
  });

  it('uses the activeLevel name in the positionLabel, not a hardcoded one', () => {
    const points = [
      { name: 'Conditional', order: 1, state: 'solid' as const },
      { name: 'Subjunctive past', order: 2, state: 'not-started' as const },
    ];
    const result = composePathCue(makeMap(points, 'B1'));
    expect(result!.positionLabel).toBe('point 1 of B1');
  });
});
