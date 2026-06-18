import { describe, it, expect } from 'vitest';
import {
  TheoryListItemSchema,
  TheoryListResponseSchema,
  TheoryCoverageResponseSchema,
  PoolStatusTheoryItemSchema,
  type TheoryCoverageRow,
} from './theory';

describe('TheoryListResponseSchema', () => {
  it('parses a minimal valid list response with one item', () => {
    const result = TheoryListResponseSchema.safeParse({
      topics: [{ id: 'subjunctive', title: 'the present subjunctive', cefr: 'B1–B2' }],
    });
    expect(result.success).toBe(true);
  });

  it('parses an empty topics array', () => {
    const result = TheoryListResponseSchema.safeParse({ topics: [] });
    expect(result.success).toBe(true);
  });

  it('rejects a response missing the topics array', () => {
    const result = TheoryListResponseSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a list item with a non-string id', () => {
    const result = TheoryListResponseSchema.safeParse({
      topics: [{ id: 123, title: 'oops', cefr: 'B1' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('TheoryListItemSchema — category/order enrichment', () => {
  it('preserves category + order on an enriched item', () => {
    const result = TheoryListItemSchema.safeParse({
      id: 'es-b2-compound-tenses',
      title: 'compound tenses',
      cefr: 'B2',
      category: 'tenses',
      order: 7,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe('tenses');
      expect(result.data.order).toBe(7);
    }
  });

  it("defaults category to 'other' and order to null on a legacy item (additive contract)", () => {
    const result = TheoryListItemSchema.safeParse({
      id: 'subjunctive',
      title: 'the present subjunctive',
      cefr: 'B1–B2',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe('other');
      expect(result.data.order).toBeNull();
    }
  });

  it('accepts an explicit null order', () => {
    const result = TheoryListItemSchema.safeParse({
      id: 'x',
      title: 'x',
      cefr: 'A1',
      category: 'other',
      order: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.order).toBeNull();
    }
  });

  it('rejects a non-numeric order', () => {
    const result = TheoryListItemSchema.safeParse({
      id: 'x',
      title: 'x',
      cefr: 'A1',
      order: 'first',
    });
    expect(result.success).toBe(false);
  });
});

describe('TheoryCoverageResponseSchema', () => {
  const buildRow = (overrides: Partial<TheoryCoverageRow> = {}): TheoryCoverageRow => ({
    language: 'ES',
    level: 'A1',
    approved: 0,
    flagged: 0,
    total: 0,
    ...overrides,
  });

  const buildTwelveRows = (): TheoryCoverageRow[] => {
    const languages: TheoryCoverageRow['language'][] = ['ES', 'DE', 'TR'];
    const levels: TheoryCoverageRow['level'][] = ['A1', 'A2', 'B1', 'B2'];
    const rows: TheoryCoverageRow[] = [];
    for (const language of languages) {
      for (const level of levels) {
        rows.push(buildRow({ language, level, approved: 1, flagged: 0, total: 3 }));
      }
    }
    return rows;
  };

  it('parses a 12-row coverage response (3 languages × 4 levels)', () => {
    const result = TheoryCoverageResponseSchema.safeParse({ rows: buildTwelveRows() });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rows).toHaveLength(12);
    }
  });

  it('rejects a row with negative approved count', () => {
    const result = TheoryCoverageResponseSchema.safeParse({
      rows: [buildRow({ approved: -1 })],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a row with language: 'EN'", () => {
    const result = TheoryCoverageResponseSchema.safeParse({
      rows: [{ ...buildRow(), language: 'EN' }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a row with level: 'C1'", () => {
    const result = TheoryCoverageResponseSchema.safeParse({
      rows: [{ ...buildRow(), level: 'C1' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a row with non-integer approved', () => {
    const result = TheoryCoverageResponseSchema.safeParse({
      rows: [buildRow({ approved: 1.5 })],
    });
    expect(result.success).toBe(false);
  });
});

describe('PoolStatusTheoryItemSchema', () => {
  const valid = {
    language: 'ES', level: 'B1', grammarPointKey: 'es-b1-ser-estar', name: 'ser vs estar',
    hasApprovedPage: true, flaggedCount: 0, lastGeneratedAt: null,
  };
  it('parses a valid item', () => {
    expect(PoolStatusTheoryItemSchema.parse(valid)).toEqual(valid);
  });
  it('accepts a timestamp string for lastGeneratedAt', () => {
    expect(PoolStatusTheoryItemSchema.parse({ ...valid, lastGeneratedAt: '2026-06-01T00:00:00.000Z' }).lastGeneratedAt)
      .toBe('2026-06-01T00:00:00.000Z');
  });
  it('rejects an invalid language', () => {
    expect(() => PoolStatusTheoryItemSchema.parse({ ...valid, language: 'FR' })).toThrow();
  });
});
