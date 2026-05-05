import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { readEntries, userVocabulary } from './index';

describe('read schema', () => {
  it('exposes the wide column set on readEntries', () => {
    expect(readEntries.flaggedWords).toBeDefined();
    expect(readEntries.bank).toBeDefined();
    expect(readEntries.pastedAt).toBeDefined();
    expect(readEntries.userId).toBeDefined();
    expect(readEntries.language).toBeDefined();
    expect(readEntries.text).toBeDefined();
  });

  it('declares the unique constraint and helper index on userVocabulary', () => {
    const cfg = getTableConfig(userVocabulary);
    expect(
      cfg.uniqueConstraints.some((u) => u.name === 'user_vocabulary_user_lang_word_uq'),
    ).toBe(true);
    expect(
      cfg.indexes.some((i) => i.config.name === 'user_vocabulary_user_lang_idx'),
    ).toBe(true);
  });

  it('declares the descending pastedAt index on readEntries', () => {
    const cfg = getTableConfig(readEntries);
    expect(
      cfg.indexes.some((i) => i.config.name === 'read_entries_user_lang_pasted_at_idx'),
    ).toBe(true);
  });

  it('cascades userVocabulary.userId on user deletion', () => {
    const cfg = getTableConfig(userVocabulary);
    const fk = cfg.foreignKeys.find((f) =>
      f.reference().columns.some((c) => c.name === 'user_id'),
    );
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe('cascade');
  });

  it('sets userVocabulary.sourceReadEntryId to null when its entry is deleted', () => {
    const cfg = getTableConfig(userVocabulary);
    const fk = cfg.foreignKeys.find((f) =>
      f.reference().columns.some((c) => c.name === 'source_read_entry_id'),
    );
    expect(fk).toBeDefined();
    expect(fk!.onDelete).toBe('set null');
  });
});
