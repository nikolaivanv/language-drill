import { describe, it, expect, vi, beforeEach } from 'vitest';

const state: { rows: unknown[]; error: unknown } = { rows: [], error: null };
const captured: { where: unknown[]; projection: unknown; limit?: number; orderBy?: unknown[] } = {
  where: [],
  projection: null,
};

vi.mock('../db', () => {
  const chain = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = {};
    c.from = () => c;
    c.where = (...args: unknown[]) => {
      captured.where = args;
      return c;
    };
    c.groupBy = () => (state.error ? Promise.reject(state.error) : Promise.resolve(state.rows));
    c.orderBy = (...args: unknown[]) => {
      captured.orderBy = args;
      return c;
    };
    c.limit = (n: number) => {
      captured.limit = n;
      return state.error ? Promise.reject(state.error) : Promise.resolve(state.rows);
    };
    return c;
  };
  return {
    db: {
      select: (projection: unknown) => {
        captured.projection = projection;
        return chain();
      },
    },
  };
});

vi.mock('@language-drill/db', () => ({
  exercises: {
    id: 'id',
    type: 'type',
    language: 'language',
    difficulty: 'difficulty',
    reviewStatus: 'review_status',
    grammarPointKey: 'grammar_point_key',
    contentJson: 'content_json',
    audioS3Key: 'audio_s3_key',
  },
}));

import { fetchConjugationDrillKeys, fetchQuickCheck, QUICK_CHECK_SIZE } from './theory-practice';

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [];
  state.error = null;
  captured.where = [];
  captured.limit = undefined;
});

describe('fetchConjugationDrillKeys', () => {
  it('returns the set of point keys that have approved conjugation rows', async () => {
    state.rows = [
      { key: 'es-a2-preterite-regular' },
      { key: 'es-b1-conditional' },
    ];
    const keys = await fetchConjugationDrillKeys('ES');
    expect(keys).toEqual(new Set(['es-a2-preterite-regular', 'es-b1-conditional']));
  });

  it('drops a null point key rather than putting null in the set', async () => {
    state.rows = [{ key: null }, { key: 'es-b1-conditional' }];
    const keys = await fetchConjugationDrillKeys('ES');
    expect(keys).toEqual(new Set(['es-b1-conditional']));
  });

  it('returns an empty set when the query fails, so a topic page still renders', async () => {
    state.error = new Error('connection reset');
    await expect(fetchConjugationDrillKeys('ES')).resolves.toEqual(new Set());
  });
});

describe('fetchQuickCheck', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    contentJson: {
      type: 'cloze',
      sentence: 'Ayer ___ en un restaurante.',
      instructions: 'Type the correct form.',
      correctAnswer: 'comí',
      acceptableAnswers: ['comi'],
      topicHint: 'preterite',
      glossEn: '(a finished event)',
      _dedupKey: 'writer-only',
      seedWord: 'comer',
      ...over,
    },
  });

  it('returns exactly the wire fields, dropping gloss and writer metadata', async () => {
    state.rows = [row(), row(), row()];
    const items = await fetchQuickCheck('ES', 'es-a2-preterite-regular');

    expect(items).toHaveLength(3);
    expect(Object.keys(items[0]).sort()).toEqual([
      'acceptableAnswers',
      'correctAnswer',
      'instructions',
      'sentence',
      'topicHint',
    ]);
    // glossEn is the field `audit:gloss` polices for stating a rule's trigger
    // or outcome — on a self-graded public check it would hand over the answer.
    expect(JSON.stringify(items)).not.toContain('glossEn');
    expect(JSON.stringify(items)).not.toContain('_dedupKey');
    expect(JSON.stringify(items)).not.toContain('seedWord');
  });

  it('returns [] unless all three items are available', async () => {
    state.rows = [row(), row()];
    await expect(fetchQuickCheck('ES', 'es-a2-preterite-regular')).resolves.toEqual([]);
  });

  it('asks for twice the quick-check size, in a deterministic order', async () => {
    state.rows = [row(), row(), row()];
    await fetchQuickCheck('ES', 'es-a2-preterite-regular');
    expect(captured.limit).toBe(QUICK_CHECK_SIZE * 2);
    expect(captured.orderBy).toBeDefined();
  });

  it('skips a malformed row in favour of a later valid one', async () => {
    state.rows = [row(), row({ correctAnswer: undefined }), row(), row()];
    const items = await fetchQuickCheck('ES', 'es-a2-preterite-regular');
    expect(items).toHaveLength(3);
  });

  it('returns [] when too many rows are malformed to reach three', async () => {
    state.rows = [row(), row({ correctAnswer: undefined }), row({ sentence: '' })];
    await expect(fetchQuickCheck('ES', 'es-a2-preterite-regular')).resolves.toEqual([]);
  });

  it('returns [] when the query fails', async () => {
    state.error = new Error('connection reset');
    await expect(fetchQuickCheck('ES', 'es-a2-preterite-regular')).resolves.toEqual([]);
  });
});
