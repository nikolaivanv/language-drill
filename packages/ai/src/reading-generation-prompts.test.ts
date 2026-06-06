import { describe, it, expect } from 'vitest';
import { Language, CefrLevel, ReadingTextLength } from '@language-drill/shared';
import {
  READING_GENERATION_PROMPT_VERSION,
  buildReadingGenerationUserPrompt,
} from './reading-generation-prompts.js';

describe('READING_GENERATION_PROMPT_VERSION', () => {
  it('follows the <surface>@YYYY-MM-DD convention', () => {
    expect(READING_GENERATION_PROMPT_VERSION).toMatch(
      /^reading-generate@\d{4}-\d{2}-\d{2}$/,
    );
  });
});

describe('buildReadingGenerationUserPrompt', () => {
  it('embeds language, level, length window, and topic', () => {
    const prompt = buildReadingGenerationUserPrompt({
      language: Language.TR,
      cefr: CefrLevel.A2,
      length: ReadingTextLength.SHORT,
      topic: 'a cat at the market',
    });
    expect(prompt).toContain('Turkish');
    expect(prompt).toContain('A2');
    expect(prompt).toContain('60');
    expect(prompt).toContain('100');
    expect(prompt).toContain('a cat at the market');
  });

  it('adds a stricter instruction when regenerating', () => {
    const prompt = buildReadingGenerationUserPrompt({
      language: Language.ES,
      cefr: CefrLevel.A1,
      length: ReadingTextLength.SHORT,
      topic: 'breakfast',
      stricter: true,
    });
    expect(prompt.toLowerCase()).toContain('simpler');
  });
});
