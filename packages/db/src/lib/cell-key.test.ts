import { describe, expect, it } from 'vitest';

import {
  assertValidCellKey,
  buildCellKey,
  buildCellKeyFromRow,
} from './cell-key';

describe('assertValidCellKey', () => {
  it('accepts valid round-1 cell keys', () => {
    const valid = [
      'es:b1:cloze:es-b1-present-subjunctive',
      'de:a2:translation:de-a2-akkusativ-prepositions',
      'tr:b2:vocab_recall:tr-b2-academic-noun-vocab',
      'es:a1:cloze:es-a1-present-indicative-regular',
    ];
    for (const key of valid) {
      expect(() => assertValidCellKey(key)).not.toThrow();
    }
  });

  it('throws when the grammar-point segment is missing', () => {
    const broken = 'es:b1:cloze:';
    expect(() => assertValidCellKey(broken)).toThrow(/cell_key/);
    expect(() => assertValidCellKey(broken)).toThrow(JSON.stringify(broken));
  });

  it('throws on an unknown language', () => {
    const broken = 'fr:b1:cloze:fr-b1-something';
    expect(() => assertValidCellKey(broken)).toThrow(/cell_key/);
  });

  it('throws on an unknown exercise type', () => {
    const broken = 'es:b1:listening:es-b1-present-subjunctive';
    expect(() => assertValidCellKey(broken)).toThrow(/cell_key/);
  });

  it('accepts a sentence_construction cell key', () => {
    expect(() =>
      assertValidCellKey('es:b1:sentence_construction:es-b1-present-subjunctive'),
    ).not.toThrow();
  });

  it('accepts a dictation cell key', () => {
    expect(() =>
      assertValidCellKey('es:b1:dictation:es-b1-dictation'),
    ).not.toThrow();
  });

  it("accepts a free_writing cell key", () => {
    expect(() => assertValidCellKey("es:b2:free_writing:es-b2-fw-remote-work")).not.toThrow();
  });

  it('accepts a conjugation cell key', () => {
    expect(() =>
      assertValidCellKey('tr:a2:conjugation:tr-a2-to-be-buffer-verbs'),
    ).not.toThrow();
  });
});

describe('buildCellKey', () => {
  it('lowercases language, level, and exercise type', () => {
    expect(
      buildCellKey({
        language: 'ES',
        cefrLevel: 'B1',
        exerciseType: 'CLOZE',
        grammarPointKey: 'es-b1-present-subjunctive',
      }),
    ).toBe('es:b1:cloze:es-b1-present-subjunctive');
  });

  it('preserves the grammarPointKey case (it is already lowercase by convention)', () => {
    // The grammar-point key is the curriculum key; it carries underscores or
    // hyphens but is NEVER mixed-case, so we don't lowercase it.
    expect(
      buildCellKey({
        language: 'es',
        cefrLevel: 'b1',
        exerciseType: 'cloze',
        grammarPointKey: 'es-b1-Mixed-Case',
      }),
    ).toBe('es:b1:cloze:es-b1-Mixed-Case');
  });

  it('round-trips through assertValidCellKey for valid round-1 inputs', () => {
    const key = buildCellKey({
      language: 'TR',
      cefrLevel: 'B2',
      exerciseType: 'vocab_recall',
      grammarPointKey: 'tr-b2-academic-noun-vocab',
    });
    expect(() => assertValidCellKey(key)).not.toThrow();
  });
});

describe('buildCellKeyFromRow', () => {
  it('builds a valid cellKey when every column is non-null', () => {
    const key = buildCellKeyFromRow({
      language: 'es',
      difficulty: 'B1',
      type: 'cloze',
      grammarPointKey: 'es-b1-present-subjunctive',
    });
    expect(key).toBe('es:b1:cloze:es-b1-present-subjunctive');
    expect(() => assertValidCellKey(key)).not.toThrow();
  });

  it('emits a sentinel-bearing key when language is NULL (caught by assertValidCellKey)', () => {
    const key = buildCellKeyFromRow({
      language: null,
      difficulty: 'B1',
      type: 'cloze',
      grammarPointKey: 'es-b1-present-subjunctive',
    });
    expect(key).toBe('?:b1:cloze:es-b1-present-subjunctive');
    expect(() => assertValidCellKey(key)).toThrow(/cell_key/);
  });

  it('emits a sentinel-bearing key when grammarPointKey is NULL', () => {
    const key = buildCellKeyFromRow({
      language: 'es',
      difficulty: 'B1',
      type: 'cloze',
      grammarPointKey: null,
    });
    expect(key).toBe('es:b1:cloze:?');
    expect(() => assertValidCellKey(key)).toThrow(/cell_key/);
  });

  it('emits a fully-sentinel key when every column is NULL', () => {
    const key = buildCellKeyFromRow({
      language: null,
      difficulty: null,
      type: null,
      grammarPointKey: null,
    });
    expect(key).toBe('?:?:?:?');
    expect(() => assertValidCellKey(key)).toThrow(/cell_key/);
  });
});
