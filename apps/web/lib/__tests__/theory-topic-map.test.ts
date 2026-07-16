import { describe, it, expect } from 'vitest';
import { Language, ExerciseType } from '@language-drill/shared';
import {
  topicIdForGrammarPointKey,
  exerciseTypeHasTheory,
  grammarPointKeyForTopicId,
} from '../theory-topic-map';

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

describe('exerciseTypeHasTheory', () => {
  it('returns true for grammar-kind exercise types (theory pages may exist)', () => {
    expect(exerciseTypeHasTheory(ExerciseType.CLOZE)).toBe(true);
    expect(exerciseTypeHasTheory(ExerciseType.TRANSLATION)).toBe(true);
    expect(exerciseTypeHasTheory(ExerciseType.SENTENCE_CONSTRUCTION)).toBe(true);
    expect(exerciseTypeHasTheory(ExerciseType.CONJUGATION)).toBe(true);
  });

  it('returns false for vocab / dictation / free-writing types (never grammar-kind)', () => {
    // These three exercise types are produced *exclusively* by non-grammar
    // curriculum kinds (see `compatibleTypes` in packages/db generation), so a
    // theory page can never exist for them — a `/theory/...` fetch would always
    // 404. This is the guaranteed-permanent 404 that flooded Sentry.
    expect(exerciseTypeHasTheory(ExerciseType.VOCAB_RECALL)).toBe(false);
    expect(exerciseTypeHasTheory(ExerciseType.DICTATION)).toBe(false);
    expect(exerciseTypeHasTheory(ExerciseType.FREE_WRITING)).toBe(false);
  });

  it('defaults to true for an unknown / future type string (safe: 404 still degrades to empty state)', () => {
    expect(exerciseTypeHasTheory('some_new_type')).toBe(true);
    expect(exerciseTypeHasTheory(null)).toBe(true);
    expect(exerciseTypeHasTheory(undefined)).toBe(true);
  });
});

describe('grammarPointKeyForTopicId', () => {
  it('prefixes the topic id with the lowercased language', () => {
    expect(grammarPointKeyForTopicId('a2-ser-vs-estar', Language.ES)).toBe('es-a2-ser-vs-estar');
  });

  it('returns null for a missing topic id', () => {
    expect(grammarPointKeyForTopicId(null, Language.ES)).toBeNull();
    expect(grammarPointKeyForTopicId('', Language.ES)).toBeNull();
  });
});
