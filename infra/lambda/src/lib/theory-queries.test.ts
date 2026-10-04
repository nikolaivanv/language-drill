import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLimit = vi.fn<() => Promise<unknown>>(() => Promise.resolve([]));
const mockRowsResolver = vi.fn<() => Promise<unknown>>(() => Promise.resolve([]));
const mockTotalResolver = vi.fn<() => Promise<unknown>>(() =>
  Promise.resolve([{ total: 0 }]),
);
const captured: { where: unknown[][]; projection: unknown[] } = { where: [], projection: [] };

const mockOrderBy = vi.fn(() => ({
  limit: mockLimit,
  then: (res?: ((v: unknown) => unknown) | null, rej?: ((r: unknown) => unknown) | null) =>
    mockRowsResolver().then(res ?? undefined, rej ?? undefined),
}));
const mockWhere = vi.fn((...preds: unknown[]) => {
  captured.where.push(preds);
  return {
    orderBy: mockOrderBy,
    limit: mockLimit,
    then: (res?: ((v: unknown) => unknown) | null, rej?: ((r: unknown) => unknown) | null) =>
      mockTotalResolver().then(res ?? undefined, rej ?? undefined),
  };
});
const mockFrom = vi.fn(() => ({ where: mockWhere }));

vi.mock('../db', () => ({
  db: {
    select: (projection: unknown) => {
      captured.projection.push(projection);
      return { from: mockFrom };
    },
  },
}));

vi.mock('@language-drill/db', () => ({
  theoryTopics: {
    id: 'id',
    language: 'language',
    topicId: 'topic_id',
    contentJson: 'content_json',
    reviewStatus: 'review_status',
    grammarPointKey: 'grammar_point_key',
    cefrLevel: 'cefr_level',
    generatedAt: 'generated_at',
  },
  curriculumOrderOf: (key: string) => (key === 'es-a2-ser-vs-estar' ? 7 : null),
}));

vi.mock('@language-drill/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@language-drill/shared')>()),
  resolveTheoryCategory: () => 'pairs',
}));

import {
  APPROVED_THEORY_STATUSES,
  fetchApprovedTopicList,
  fetchApprovedTopicContent,
} from './theory-queries';

beforeEach(() => {
  vi.clearAllMocks();
  captured.where = [];
  captured.projection = [];
  mockRowsResolver.mockResolvedValue([]);
  mockTotalResolver.mockResolvedValue([{ total: 0 }]);
  mockLimit.mockResolvedValue([]);
});

describe('fetchApprovedTopicList', () => {
  it('enriches rows with category and curriculum order, and reports the pre-filter total', async () => {
    mockRowsResolver.mockResolvedValue([
      {
        id: 'a2-ser-vs-estar',
        title: 'Ser vs estar',
        cefr: 'A2',
        subtitle: 'Two verbs for one English verb.',
        grammarPointKey: 'es-a2-ser-vs-estar',
      },
    ]);
    mockTotalResolver.mockResolvedValue([{ total: 3 }]);

    const { rows, total } = await fetchApprovedTopicList('ES');

    expect(total).toBe(3);
    expect(rows).toEqual([
      {
        id: 'a2-ser-vs-estar',
        title: 'Ser vs estar',
        cefr: 'A2',
        subtitle: 'Two verbs for one English verb.',
        category: 'pairs',
        order: 7,
        grammarPointKey: 'es-a2-ser-vs-estar',
      },
    ]);
  });

  it('coerces a string count to a number', async () => {
    // Postgres returns bigint counts as strings over the wire; an uncoerced
    // total makes `total > rows.length` compare a string to a number.
    mockTotalResolver.mockResolvedValue([{ total: '12' }]);
    const { total } = await fetchApprovedTopicList('ES');
    expect(total).toBe(12);
  });

  it('selects subtitle so the public route can use it', async () => {
    await fetchApprovedTopicList('ES');
    expect(Object.keys(captured.projection[0] as object)).toContain('subtitle');
  });
});

describe('fetchApprovedTopicContent', () => {
  it('returns null when no approved row exists', async () => {
    mockLimit.mockResolvedValue([]);
    await expect(fetchApprovedTopicContent('ES', 'a2-ser-vs-estar')).resolves.toBeNull();
  });

  it('returns the newest row by generatedAt', async () => {
    mockLimit.mockResolvedValue([{ id: 'row-uuid', contentJson: { title: 'x' } }]);
    await expect(fetchApprovedTopicContent('ES', 'a2-ser-vs-estar')).resolves.toEqual({
      id: 'row-uuid',
      contentJson: { title: 'x' },
    });
    expect(mockLimit).toHaveBeenCalledWith(1);
  });
});

describe('APPROVED_THEORY_STATUSES', () => {
  it('is exactly the two approved statuses', () => {
    expect([...APPROVED_THEORY_STATUSES]).toEqual(['auto-approved', 'manual-approved']);
  });
});
