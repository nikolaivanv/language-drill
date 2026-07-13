import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { glossCache } from './gloss-cache';

describe('glossCache schema', () => {
  it('exposes the expected columns', () => {
    const cols = Object.keys(getTableColumns(glossCache)).sort();
    expect(cols).toEqual(
      [
        'baseGloss',
        'cefr',
        'createdAt',
        'freqRank',
        'language',
        'lemma',
        'pos',
        'promptVersion',
        'source',
        'updatedAt',
      ].sort(),
    );
  });
});
