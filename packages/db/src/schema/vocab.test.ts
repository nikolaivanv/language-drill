import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { vocabTarget } from './vocab';

describe('vocab_target schema', () => {
  it('has the expected columns and table name', () => {
    const cfg = getTableConfig(vocabTarget);
    expect(cfg.name).toBe('vocab_target');
    const cols = cfg.columns.map((c) => c.name).sort();
    expect(cols).toEqual(
      [
        'cefr_level',
        'created_at',
        'display_form',
        'example_sentence',
        'freq_rank',
        'gloss',
        'id',
        'language',
        'lemma',
        'source',
        'status',
        'tier',
        'umbrella_key',
      ].sort(),
    );
  });

  it('declares a unique index on (language, umbrella_key, lemma)', () => {
    const cfg = getTableConfig(vocabTarget);
    const unique = cfg.indexes.find((i) => i.config.unique);
    expect(unique?.config.columns.map((c: { name: string }) => c.name)).toEqual([
      'language',
      'umbrella_key',
      'lemma',
    ]);
  });
});
