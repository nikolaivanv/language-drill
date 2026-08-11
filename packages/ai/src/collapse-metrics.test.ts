import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import {
  surfaceOf,
  normalizeSurface,
  computeSurfaceCollapse,
  isSurfaceFlagged,
  type AuditRow,
} from './collapse-metrics.js';

const row = (type: ExerciseType, content: Record<string, unknown>): AuditRow => ({
  id: `id-${Math.random()}`,
  type,
  content,
  coverageTags: null,
});

const clozeRows = (answers: string[]): AuditRow[] =>
  answers.map((a) => row(ExerciseType.CLOZE, { sentence: 'x ___ y', correctAnswer: a }));

describe('surfaceOf', () => {
  it('reads correctAnswer for cloze', () => {
    expect(surfaceOf(ExerciseType.CLOZE, { correctAnswer: 'Dicen' })).toBe('Dicen');
  });

  it('reads referenceTranslation for translation', () => {
    expect(
      surfaceOf(ExerciseType.TRANSLATION, { referenceTranslation: 'Dicen que llueve.' }),
    ).toBe('Dicen que llueve.');
  });

  it('reads lemma for conjugation', () => {
    expect(surfaceOf(ExerciseType.CONJUGATION, { lemma: 'ir' })).toBe('ir');
  });

  it('reads prompt for sentence_construction', () => {
    expect(surfaceOf(ExerciseType.SENTENCE_CONSTRUCTION, { prompt: 'Sie hat gestern...' })).toBe(
      'Sie hat gestern...',
    );
  });

  it('returns null for a type with no defined surface', () => {
    expect(surfaceOf(ExerciseType.FREE_WRITING, { title: 'x' })).toBeNull();
  });

  it('returns null when the field is missing or not a string', () => {
    expect(surfaceOf(ExerciseType.CLOZE, {})).toBeNull();
    expect(surfaceOf(ExerciseType.CLOZE, { correctAnswer: 42 })).toBeNull();
  });
});

describe('normalizeSurface', () => {
  it('cloze: lowercases and takes the first token', () => {
    expect(normalizeSurface(ExerciseType.CLOZE, 'Dicen que')).toBe('dicen');
  });

  it('cloze: strips edge punctuation but keeps word-internal apostrophes', () => {
    expect(normalizeSurface(ExerciseType.CLOZE, "¿Anne'nin?")).toBe("anne'nin");
  });

  it('translation: takes the leading bigram', () => {
    expect(normalizeSurface(ExerciseType.TRANSLATION, 'Dicen que llueve mucho.')).toBe('dicen que');
  });

  it('translation: a one-word surface yields that single token', () => {
    expect(normalizeSurface(ExerciseType.TRANSLATION, 'Llueve.')).toBe('llueve');
  });

  it('conjugation: uses the whole lemma, not just its first token', () => {
    expect(normalizeSurface(ExerciseType.CONJUGATION, 'sich freuen')).toBe('sich freuen');
  });

  it('returns null for an empty or punctuation-only surface', () => {
    expect(normalizeSurface(ExerciseType.CLOZE, '   ')).toBeNull();
    expect(normalizeSurface(ExerciseType.CLOZE, '...')).toBeNull();
  });
});

describe('computeSurfaceCollapse', () => {
  it('reports the top surface, its share, and a descending distribution', () => {
    const rows = clozeRows([
      ...Array(43).fill('Dicen'),
      'robaron',
      'robaron',
      'identificaron',
      'guían',
      'metieron',
      'entraron',
    ]);
    const result = computeSurfaceCollapse(ExerciseType.CLOZE, rows);
    expect(result).not.toBeNull();
    expect(result!.total).toBe(49);
    expect(result!.topSurface).toBe('dicen');
    expect(result!.topCount).toBe(43);
    expect(result!.share).toBeCloseTo(43 / 49, 5);
    expect(result!.distribution[0]).toEqual({ surface: 'dicen', count: 43 });
    expect(result!.distribution[1]).toEqual({ surface: 'robaron', count: 2 });
  });

  it('caps the distribution at 8 entries', () => {
    const rows = clozeRows(Array.from({ length: 20 }, (_, i) => `w${i}`));
    expect(computeSurfaceCollapse(ExerciseType.CLOZE, rows)!.distribution).toHaveLength(8);
  });

  it('skips rows with no usable surface rather than counting them as empty', () => {
    const rows = [...clozeRows(['ir', 'ir']), row(ExerciseType.CLOZE, {})];
    const result = computeSurfaceCollapse(ExerciseType.CLOZE, rows);
    expect(result!.total).toBe(2);
  });

  it('returns null when no row has a usable surface', () => {
    expect(computeSurfaceCollapse(ExerciseType.CLOZE, [row(ExerciseType.CLOZE, {})])).toBeNull();
  });

  it('breaks count ties deterministically, alphabetically', () => {
    const result = computeSurfaceCollapse(ExerciseType.CLOZE, clozeRows(['b', 'a']));
    expect(result!.topSurface).toBe('a');
  });
});

describe('isSurfaceFlagged', () => {
  const opts = { minRows: 15, threshold: 0.65 };

  it('flags at or above the threshold with enough rows', () => {
    const rows = clozeRows([...Array(13).fill('x'), ...Array(7).fill('y')]); // 20 rows, 0.65
    expect(isSurfaceFlagged(computeSurfaceCollapse(ExerciseType.CLOZE, rows), opts)).toBe(true);
  });

  it('does not flag below the threshold', () => {
    const rows = clozeRows([...Array(12).fill('x'), ...Array(8).fill('y')]); // 0.60
    expect(isSurfaceFlagged(computeSurfaceCollapse(ExerciseType.CLOZE, rows), opts)).toBe(false);
  });

  it('does not flag a cell below minRows, however concentrated', () => {
    const rows = clozeRows(Array(14).fill('x')); // 100% but only 14 rows
    expect(isSurfaceFlagged(computeSurfaceCollapse(ExerciseType.CLOZE, rows), opts)).toBe(false);
  });

  it('does not flag null', () => {
    expect(isSurfaceFlagged(null, opts)).toBe(false);
  });
});
