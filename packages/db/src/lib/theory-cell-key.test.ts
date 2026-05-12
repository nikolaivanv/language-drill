import { describe, expect, it } from 'vitest';

import {
  assertValidTheoryCellKey,
  buildTheoryCellKey,
} from './theory-cell-key';

describe('assertValidTheoryCellKey', () => {
  it('accepts valid theory cell keys', () => {
    const valid = [
      'es:b1:es-b1-present-subjunctive',
      'de:a2:de-a2-akkusativ',
      'tr:b2:tr-b2-academic-vocab',
      'es:a1:es-a1-present-indicative-regular',
    ];
    for (const key of valid) {
      expect(() => assertValidTheoryCellKey(key)).not.toThrow();
    }
  });

  it('throws when the language segment is missing', () => {
    const broken = 'b1:es-b1-present-subjunctive';
    expect(() => assertValidTheoryCellKey(broken)).toThrow(
      /theory cell key/,
    );
    expect(() => assertValidTheoryCellKey(broken)).toThrow(
      JSON.stringify(broken),
    );
  });

  it('throws when the level segment is missing', () => {
    const broken = 'es:es-b1-present-subjunctive';
    expect(() => assertValidTheoryCellKey(broken)).toThrow(/theory cell key/);
  });

  it('throws when the grammar-point segment is missing', () => {
    const broken = 'es:b1:';
    expect(() => assertValidTheoryCellKey(broken)).toThrow(/theory cell key/);
  });

  it('throws on an unknown language code', () => {
    const broken = 'fr:b1:fr-b1-subjonctif';
    expect(() => assertValidTheoryCellKey(broken)).toThrow(/theory cell key/);
  });

  it('throws on an unknown CEFR level', () => {
    const broken = 'es:c1:es-c1-conditional-perfect';
    expect(() => assertValidTheoryCellKey(broken)).toThrow(/theory cell key/);
  });

  it('throws on an uppercase grammar-point key', () => {
    const broken = 'es:b1:ES-B1-Present-Subjunctive';
    expect(() => assertValidTheoryCellKey(broken)).toThrow(/theory cell key/);
  });

  it('throws on a grammar-point key with special characters', () => {
    const broken = 'es:b1:es-b1-präsens';
    expect(() => assertValidTheoryCellKey(broken)).toThrow(/theory cell key/);
  });

  it('rejects an exercise cell key (no type segment in theory keys)', () => {
    const broken = 'es:b1:cloze:es-b1-present-subjunctive';
    expect(() => assertValidTheoryCellKey(broken)).toThrow(/theory cell key/);
  });
});

describe('buildTheoryCellKey', () => {
  it('lowercases language and level segments', () => {
    expect(
      buildTheoryCellKey({
        language: 'ES',
        cefrLevel: 'B1',
        grammarPointKey: 'es-b1-present-subjunctive',
      }),
    ).toBe('es:b1:es-b1-present-subjunctive');
  });

  it('produces a key that round-trips through assertValidTheoryCellKey', () => {
    const key = buildTheoryCellKey({
      language: 'TR',
      cefrLevel: 'B2',
      grammarPointKey: 'tr-b2-academic-vocab',
    });
    expect(() => assertValidTheoryCellKey(key)).not.toThrow();
  });

  it('asserts on its own output (empty grammarPointKey throws)', () => {
    expect(() =>
      buildTheoryCellKey({
        language: 'ES',
        cefrLevel: 'B1',
        grammarPointKey: '',
      }),
    ).toThrow(/theory cell key/);
  });

  it('asserts on its own output (grammarPointKey without enough segments throws)', () => {
    // 'no-hyphens-enough' lowercases fine but the regex requires the
    // grammar-point key to have the shape `<lang>-<level>-<rest>` (two
    // hyphens), so a single-hyphen key fails after the build.
    expect(() =>
      buildTheoryCellKey({
        language: 'ES',
        cefrLevel: 'B1',
        grammarPointKey: 'one-hyphen',
      }),
    ).toThrow(/theory cell key/);
  });
});
