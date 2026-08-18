import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import {
  CONSTRUCTION_DISMISSALS,
  findConstructionDismissal,
  dismissedConstructionIds,
} from './construction-dismissals';

describe('CONSTRUCTION_DISMISSALS', () => {
  it('gives every entry a non-empty reason', () => {
    for (const d of CONSTRUCTION_DISMISSALS) {
      expect(d.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it('dates every entry as an ISO day', () => {
    for (const d of CONSTRUCTION_DISMISSALS) {
      expect(d.dismissedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('has no duplicate (point, type, constructionId) keys', () => {
    const keys = CONSTRUCTION_DISMISSALS.map(
      (d) => `${d.grammarPointKey}|${d.type}|${d.constructionId}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('findConstructionDismissal', () => {
  it('returns undefined for an unlisted construction', () => {
    expect(
      findConstructionDismissal('es-b1-reported-speech', ExerciseType.CLOZE, 'not-listed'),
    ).toBeUndefined();
  });
});

describe('dismissedConstructionIds', () => {
  it('returns an empty set for an unlisted cell', () => {
    expect(dismissedConstructionIds('es-b1-reported-speech', ExerciseType.CLOZE).size).toBe(0);
  });
});
