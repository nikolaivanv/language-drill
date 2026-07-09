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
    });
    expect(out).toContain('Food and drink (A1)');
    expect(out).toContain('pan, agua, manzana');
    expect(out).toContain('leche');
    expect(out).toMatch(/"words"/);
  });
});
