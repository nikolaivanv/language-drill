import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import type { GrammarPoint } from '@language-drill/shared';
import {
  surfaceOf,
  normalizeSurface,
  computeSurfaceCollapse,
  isSurfaceFlagged,
  computeSpecShortfall,
  computeVariantSkew,
  computeStemMonotony,
  stemOf,
  MONOTONY_THRESHOLD_DEFAULT,
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

const point = (extra: Partial<GrammarPoint> = {}): GrammarPoint =>
  ({
    key: 'es-b1-test',
    kind: 'grammar',
    name: 'Test point',
    description: 'A test point.',
    cefrLevel: 'B1',
    language: 'ES',
    examplesPositive: ['a', 'b'],
    examplesNegative: ['*c'],
    commonErrors: ['d'],
    ...extra,
  }) as GrammarPoint;

const tagged = (person: string, n: number): AuditRow[] =>
  Array.from({ length: n }, () => ({
    id: `id-${person}-${Math.random()}`,
    type: ExerciseType.CLOZE,
    content: { correctAnswer: 'x' },
    coverageTags: { person } as never,
  }));

const seeded = (seedWord: string | null, n: number): AuditRow[] =>
  Array.from({ length: n }, () => ({
    id: `id-${seedWord}-${Math.random()}`,
    type: ExerciseType.TRANSLATION,
    content: seedWord === null ? {} : { seedWord },
    coverageTags: null,
  }));

describe('computeSpecShortfall', () => {
  const spec = {
    coverageSpec: { axes: [{ name: 'person' as const, floors: { '1sg': 5, '3sg': 5, '3pl': 5 } }] },
  };

  it('returns null for a point with no coverageSpec', () => {
    expect(computeSpecShortfall(point(), [], 50)).toBeNull();
  });

  it('reports each declared value under its floor, with the observed count', () => {
    const rows = [...tagged('1sg', 5), ...tagged('3sg', 2), ...tagged('3pl', 0)];
    const result = computeSpecShortfall(point(spec), rows, 15)!;
    expect(result.shortfalls).toEqual([
      { axis: 'person', value: '3sg', floor: 5, actual: 2 },
      { axis: 'person', value: '3pl', floor: 5, actual: 0 },
    ]);
  });

  it('reports no shortfall when every floor is met', () => {
    const rows = [...tagged('1sg', 5), ...tagged('3sg', 6), ...tagged('3pl', 5)];
    expect(computeSpecShortfall(point(spec), rows, 15)!.shortfalls).toEqual([]);
  });

  it('flags atTarget — the cell that will NOT self-heal without a demote', () => {
    const rows = [...tagged('1sg', 20), ...tagged('3sg', 0), ...tagged('3pl', 0)];
    const result = computeSpecShortfall(point(spec), rows, 15)!;
    expect(result.approved).toBe(20);
    expect(result.atTarget).toBe(true);
    expect(result.shortfalls).toHaveLength(2);
  });

  it('does not flag atTarget when the cell is still filling', () => {
    expect(computeSpecShortfall(point(spec), tagged('1sg', 5), 50)!.atTarget).toBe(false);
  });

  it('ignores rows with no coverage tag for the axis', () => {
    const rows = [...tagged('1sg', 5), ...seeded(null, 3).map((r) => ({ ...r, coverageTags: null }))];
    const result = computeSpecShortfall(point(spec), rows, 15)!;
    expect(result.shortfalls.find((s) => s.value === '1sg')).toBeUndefined();
  });
});

describe('computeVariantSkew', () => {
  const variants = point({
    constructionVariants: [
      { id: 'hearsay', directive: 'H', share: 3 },
      { id: 'adversity', directive: 'A' },
      { id: 'agentless', directive: 'G' },
      { id: 'uno-generic', directive: 'U' },
    ],
  });

  it('returns null for a point with no constructionVariants', () => {
    expect(computeVariantSkew(point(), [])).toBeNull();
  });

  it('counts unrecognized and null seedWords separately from declared variants', () => {
    // The live prod shape after #631 merged inert: 49 legacy rows, zero variant coverage.
    const rows = [...seeded(null, 40), ...seeded('restaurante', 9)];
    const result = computeVariantSkew(variants, rows)!;
    expect(result.unrecognizedSeedCount).toBe(49);
    expect(result.perVariant.every((v) => v.count === 0)).toBe(true);
  });

  it('computes each quota from share over the declared-variant pool only', () => {
    // 12 declared rows, shares 3/1/1/1 → quotas 6/2/2/2. Unrecognized rows excluded.
    const rows = [...seeded('hearsay', 12), ...seeded(null, 100)];
    const result = computeVariantSkew(variants, rows)!;
    expect(result.approved).toBe(12);
    expect(result.perVariant.find((v) => v.id === 'hearsay')!.quota).toBe(6);
    expect(result.perVariant.find((v) => v.id === 'adversity')!.quota).toBe(2);
  });

  it('reports over-quota and under-MIN_PER_VARIANT ids', () => {
    const rows = [
      ...seeded('hearsay', 12),
      ...seeded('adversity', 4),
      ...seeded('agentless', 2),
      ...seeded('uno-generic', 2),
    ];
    const result = computeVariantSkew(variants, rows)!;
    // approved = 20, totalShare = 6 → quotas 10 / 3.33 / 3.33 / 3.33.
    // hearsay 12 > 10 and adversity 4 > 3.33 are both over; the other two are under 4.
    expect(result.overQuota).toEqual(['hearsay', 'adversity']);
    expect(result.underMin).toEqual(['agentless', 'uno-generic']); // < MIN_PER_VARIANT
  });

  it('reports nothing when every variant sits at its quota', () => {
    const rows = [
      ...seeded('hearsay', 12),
      ...seeded('adversity', 4),
      ...seeded('agentless', 4),
      ...seeded('uno-generic', 4),
    ];
    const result = computeVariantSkew(variants, rows)!;
    expect(result.overQuota).toEqual([]);
    expect(result.underMin).toEqual([]);
  });
});

describe('stemOf', () => {
  it('reads sentence for cloze', () => {
    expect(stemOf(ExerciseType.CLOZE, { sentence: 'El ___ es bueno.' })).toBe('El ___ es bueno.');
  });

  it('reads sourceText for translation — the L1 source, not the reference', () => {
    expect(
      stemOf(ExerciseType.TRANSLATION, {
        sourceText: 'They say it rains.',
        referenceTranslation: 'Dicen que llueve.',
      }),
    ).toBe('They say it rains.');
  });

  it('reads prompt for sentence_construction', () => {
    expect(stemOf(ExerciseType.SENTENCE_CONSTRUCTION, { prompt: 'Describe your town.' })).toBe(
      'Describe your town.',
    );
  });

  it('returns null for conjugation — the lemma IS the surface, already signal 1', () => {
    expect(stemOf(ExerciseType.CONJUGATION, { lemma: 'ir' })).toBeNull();
  });
});

describe('computeStemMonotony', () => {
  const stems = (texts: string[]): AuditRow[] =>
    texts.map((sentence) => ({
      id: `id-${Math.random()}`,
      type: ExerciseType.CLOZE,
      content: { sentence },
      coverageTags: null,
    }));

  it('reports the most common content lemma and the share of stems containing it', () => {
    const rows = stems([
      'El restaurante nuevo tiene la mejor paella.',
      'Cenamos en el restaurante ayer.',
      'El restaurante cierra los lunes.',
      'Mi hermano trabaja en un restaurante.',
      'El restaurante lleno hoy.',
      'Buscamos un restaurante barato.',
      'La iglesia es antigua.',
      'El tren llega tarde.',
      'Mi hermana estudia mucho.',
      'El perro duerme.',
    ]);
    const result = computeStemMonotony(ExerciseType.CLOZE, rows)!;
    expect(result.topLemma).toBe('restaurante');
    expect(result.count).toBe(6);
    expect(result.total).toBe(10);
    expect(result.share).toBeCloseTo(0.6, 5);
  });

  it('counts a lemma once per stem, not once per occurrence', () => {
    const rows = stems([
      'El restaurante del restaurante restaurante.',
      'La iglesia del pueblo.',
      'El restaurante nuevo.',
    ]);
    const result = computeStemMonotony(ExerciseType.CLOZE, rows)!;
    expect(result.topLemma).toBe('restaurante');
    // Two STEMS contain it, though it occurs four times overall.
    expect(result.count).toBe(2);
  });

  it('drops stopwords so function words never dominate', () => {
    const rows = stems(['El perro y la casa.', 'El gato y la casa.', 'El pez y la casa.']);
    const result = computeStemMonotony(ExerciseType.CLOZE, rows)!;
    expect(result.topLemma).toBe('casa');
  });

  it('drops the cloze blank marker', () => {
    const rows = stems(['El ___ come.', 'La ___ duerme.', 'Un ___ salta.']);
    const result = computeStemMonotony(ExerciseType.CLOZE, rows);
    expect(result?.topLemma).not.toBe('___');
  });

  it('returns null when no stem yields a content lemma', () => {
    expect(computeStemMonotony(ExerciseType.CLOZE, stems(['el la y', 'un una']))).toBeNull();
  });

  it('returns null for a type with no stem field', () => {
    const rows: AuditRow[] = [
      { id: 'a', type: ExerciseType.CONJUGATION, content: { lemma: 'ir' }, coverageTags: null },
    ];
    expect(computeStemMonotony(ExerciseType.CONJUGATION, rows)).toBeNull();
  });

  it('ships a loose default threshold — this signal is calibration-phase', () => {
    expect(MONOTONY_THRESHOLD_DEFAULT).toBeGreaterThanOrEqual(0.4);
  });
});
