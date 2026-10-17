import { describe, expect, it } from 'vitest';
import {
  VOCAB_TARGET_GENERATION_PROMPT_VERSION,
  VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE,
  buildVocabTargetUserPrompt,
} from './vocab-target-prompts';

describe('vocab-target prompts', () => {
  it('version is a dated surface tag', () => {
    expect(VOCAB_TARGET_GENERATION_PROMPT_VERSION).toMatch(
      /^vocab-target-generate@\d{4}-\d{2}-\d{2}$/,
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

  it('is versioned 2026-10-17 and asks for pos + citation-form examples', () => {
    expect(VOCAB_TARGET_GENERATION_PROMPT_VERSION).toBe('vocab-target-generate@2026-10-17');
    expect(VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE).toContain('"pos"');
    expect(VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE).not.toContain('concrete');
    expect(VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE).toMatch(/must contain the lemma.*verbatim/);
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

  it('restricts a word-class group', () => {
    const p = buildVocabTargetUserPrompt({ ...base, request: { kind: 'group', pos: ['adverb', 'phrase'] } });
    expect(p).toContain('Every word MUST be one of: adverb, phrase');
  });
});
