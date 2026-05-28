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

  it('adds the deep-annotation jsonb columns as nullable (Req 8.1, 11.1)', () => {
    const reCfg = getTableConfig(readEntries);
    const span = reCfg.columns.find((c) => c.name === 'span_annotations');
    expect(span).toBeDefined();
    expect(span!.getSQLType()).toBe('jsonb');
    // Nullable — absent ⇒ no deep cards persisted yet.
    expect(span!.notNull).toBe(false);

    const uvCfg = getTableConfig(userVocabulary);
    const card = uvCfg.columns.find((c) => c.name === 'card');
    expect(card).toBeDefined();
    expect(card!.getSQLType()).toBe('jsonb');
    expect(card!.notNull).toBe(false);
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

  it('leaves the (user, language, word) unique key unchanged after the additions (Req 8.3)', () => {
    const cfg = getTableConfig(userVocabulary);
    const uq = cfg.uniqueConstraints.find(
      (u) => u.name === 'user_vocabulary_user_lang_word_uq',
    );
    expect(uq).toBeDefined();
    expect(uq!.columns.map((c) => c.name)).toEqual(['user_id', 'language', 'word']);
    // The `card` column added no new unique constraint.
    expect(cfg.uniqueConstraints).toHaveLength(1);
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
