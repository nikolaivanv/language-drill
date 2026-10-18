import { describe, expect, it } from 'vitest';
import {
  VOCAB_TARGET_GENERATION_PROMPT_VERSION,
  VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE,
  buildVocabTargetUserPrompt,
} from './vocab-target-prompts';

describe('vocab-target prompts', () => {
  it('version is a dated surface tag', () => {
    expect(VOCAB_TARGET_GENERATION_PROMPT_VERSION).toMatch(
      /^vocab-target-generate@\d{4}-\d{2}-\d{2}[a-z]?$/,
    );
  });

  it('system template exposes the substitution slots', () => {
    for (const slot of [
      '{{languageName}}',
      '{{cefrLevel}}',
      '{{umbrellaName}}',
      '{{wordCount}}',
    ]) {
      expect(VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE).toContain(slot);
    }
  });

  it('user prompt embeds anchor + avoid words and requests JSON', () => {
    const out = buildVocabTargetUserPrompt({
      umbrellaName: 'Food and drink (A1)',
      umbrellaDescription: 'Core A1 food vocabulary.',
      wordCount: 30,
      freqAnchorWords: ['pan', 'agua', 'manzana'],
      avoidWords: ['leche'],
      request: { kind: 'themed' },
    });
    expect(out).toContain('Food and drink (A1)');
    expect(out).toContain('pan, agua, manzana');
    expect(out).toContain('leche');
    expect(out).toMatch(/"words"/);
  });
});

describe('vocab-target prompt — word classes', () => {
  const base = { umbrellaName: 'Food (A1)', umbrellaDescription: 'd', wordCount: 30, freqAnchorWords: [], avoidWords: [] };

  it('is versioned 2026-10-18a and asks for pos + grammatical, inflected examples', () => {
    expect(VOCAB_TARGET_GENERATION_PROMPT_VERSION).toBe('vocab-target-generate@2026-10-18a');
    expect(VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE).toContain('"pos"');
    expect(VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE).not.toContain('concrete');
    expect(VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE).toContain('fully grammatical');
    expect(VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE).toContain('No quiero arrepentirme');
    expect(VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE).toContain('Voy a hacer la tarea.');
    expect(VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE).not.toMatch(/must contain the lemma.*verbatim/);
  });

  it('states the themed mix', () => {
    const p = buildVocabTargetUserPrompt({ ...base, request: { kind: 'themed' } });
    expect(p).toContain('at most 60% nouns');
    expect(p).toContain('at least 20% verbs');
  });

  it('asks only for the missing classes in a follow-up', () => {
    const p = buildVocabTargetUserPrompt({ ...base, wordCount: 7, request: { kind: 'only', verb: 4, adjectiveOrAdverb: 3 } });
    expect(p).toContain('exactly 4 verbs');
    expect(p).toContain('3 adjectives or adverbs');
    expect(p).toContain('No nouns');
  });

  it('omits a class whose requested count is 0', () => {
    const v = buildVocabTargetUserPrompt({ ...base, request: { kind: 'only', verb: 0, adjectiveOrAdverb: 3 } });
    expect(v).toContain('exactly 3 adjectives or adverbs');
    expect(v).not.toContain('0 verbs');
    const a = buildVocabTargetUserPrompt({ ...base, request: { kind: 'only', verb: 4, adjectiveOrAdverb: 0 } });
    expect(a).toContain('exactly 4 verbs');
    expect(a).not.toContain('0 adjectives');
  });

  it('restricts a word-class group', () => {
    const p = buildVocabTargetUserPrompt({ ...base, request: { kind: 'group', pos: ['adverb', 'phrase'] } });
    expect(p).toContain('Every word MUST be one of: adverb, phrase');
  });

  it('tags class-scoped avoid words and explains that homographs of another class are allowed', () => {
    const p = buildVocabTargetUserPrompt({
      ...base,
      avoidWords: [{ lemma: 'yemek', pos: 'noun' }, { lemma: 'su', pos: null }, 'ekmek'],
      request: { kind: 'themed' },
    });
    expect(p).toContain('already-listed words: yemek (noun), su, ekmek.');
    expect(p).toContain('the same lemma as a different class');
  });

  it('keeps the plain avoid line when no word carries a class', () => {
    const p = buildVocabTargetUserPrompt({ ...base, avoidWords: ['leche', { lemma: 'pan', pos: null }], request: { kind: 'themed' } });
    expect(p).toContain('already-listed words: leche, pan.');
    expect(p).not.toContain('different class');
  });

  it('holds a word-class group to its topic description, not just the class', () => {
    const p = buildVocabTargetUserPrompt({
      ...base,
      umbrellaName: 'Verbs with prepositions (B1)',
      umbrellaDescription: 'Verbs that govern a fixed preposition (sich freuen auf, warten auf).',
      request: { kind: 'group', pos: ['verb'] },
    });
    expect(p).toContain('AND fit the topic description above');
    expect(p).not.toContain('any level-appropriate word of that class qualifies');
    // The description the line points back to sits above it.
    expect(p.indexOf('Verbs that govern a fixed preposition')).toBeLessThan(p.indexOf('AND fit the topic'));
  });
});
