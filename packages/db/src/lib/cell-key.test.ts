import { describe, expect, it } from 'vitest';

import { assertValidCellKey } from './cell-key';

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
});
