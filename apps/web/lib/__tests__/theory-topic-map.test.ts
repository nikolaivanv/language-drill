import { describe, it, expect } from 'vitest';
import { Language } from '@language-drill/shared';
import { HINT_TO_TOPIC, topicIdForHint } from '../theory-topic-map';

describe('topicIdForHint', () => {
  it('returns null when the hint is undefined', () => {
    expect(topicIdForHint(undefined, Language.ES)).toBeNull();
  });

  it('returns null when the hint is an empty string', () => {
    expect(topicIdForHint('', Language.ES)).toBeNull();
  });

  it('maps a known hint to its registered topic id for ES', () => {
    expect(topicIdForHint('subjunctive', Language.ES)).toBe('subjunctive');
  });

  it('maps the alias "present-subjunctive" to the same topic', () => {
    expect(topicIdForHint('present-subjunctive', Language.ES)).toBe(
      'subjunctive',
    );
  });

  it('maps "preterite-vs-imperfect" and "pret-imp" to preterite-imperfect', () => {
    expect(topicIdForHint('preterite-vs-imperfect', Language.ES)).toBe(
      'preterite-imperfect',
    );
    expect(topicIdForHint('pret-imp', Language.ES)).toBe('preterite-imperfect');
  });

  it('returns null when the hint is unmapped', () => {
    expect(topicIdForHint('past-subjunctive', Language.ES)).toBeNull();
    expect(topicIdForHint('totally-fake-topic', Language.ES)).toBeNull();
  });

  it('returns null for cross-language gaps (mapped hint, language without that topic)', () => {
    // 'subjunctive' is in HINT_TO_TOPIC but DE/TR have empty registries in v1.
    expect(topicIdForHint('subjunctive', Language.DE)).toBeNull();
    expect(topicIdForHint('subjunctive', Language.TR)).toBeNull();
  });

  it('every value in HINT_TO_TOPIC is one of the valid registry ids', () => {
    const validIds = new Set([
      'subjunctive',
      'preterite-imperfect',
      'conditional',
    ]);
    for (const id of Object.values(HINT_TO_TOPIC)) {
      expect(validIds.has(id)).toBe(true);
    }
  });
});
