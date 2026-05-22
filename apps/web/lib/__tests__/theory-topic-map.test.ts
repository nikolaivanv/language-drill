import { describe, it, expect } from 'vitest';
import { Language } from '@language-drill/shared';
import { topicIdForGrammarPointKey } from '../theory-topic-map';

describe('topicIdForGrammarPointKey', () => {
  it('strips the language prefix and returns the rest', () => {
    expect(topicIdForGrammarPointKey('tr-a1-vowel-harmony', Language.TR)).toBe(
      'a1-vowel-harmony',
    );
    expect(topicIdForGrammarPointKey('es-b1-conditional', Language.ES)).toBe(
      'b1-conditional',
    );
    expect(
      topicIdForGrammarPointKey('de-a2-modal-verbs', Language.DE),
    ).toBe('a2-modal-verbs');
  });

  it('returns null for null / undefined / empty input', () => {
    expect(topicIdForGrammarPointKey(null, Language.ES)).toBeNull();
    expect(topicIdForGrammarPointKey(undefined, Language.ES)).toBeNull();
    expect(topicIdForGrammarPointKey('', Language.ES)).toBeNull();
  });

  it('returns null when the prefix does not match the language', () => {
    // Defensive: a TR exercise should never expose a key prefixed `es-`,
    // but if it does we refuse to render — avoids cross-language theory
    // lookups (`GET /theory/TR/b1-conditional` with no TR row).
    expect(topicIdForGrammarPointKey('es-b1-conditional', Language.TR)).toBeNull();
    expect(topicIdForGrammarPointKey('tr-a1-locative', Language.DE)).toBeNull();
  });

  it('returns null when the key has no segment after the language prefix', () => {
    expect(topicIdForGrammarPointKey('tr-', Language.TR)).toBeNull();
  });

  it('matches the prefix case-insensitively against the language enum', () => {
    // Language enum values are uppercase ("TR"); keys in the DB are
    // lowercase-prefixed ("tr-..."). The resolver normalises.
    expect(topicIdForGrammarPointKey('tr-a1-locative', Language.TR)).toBe(
      'a1-locative',
    );
  });
});
