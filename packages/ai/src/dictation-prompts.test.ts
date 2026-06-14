import { describe, it, expect } from 'vitest';
import {
  DICTATION_EVAL_SYSTEM_PROMPT,
  DICTATION_EVAL_PROMPT_VERSION,
  buildDictationUserPrompt,
} from './dictation-prompts.js';

describe('dictation prompts', () => {
  it('version is dated', () => {
    expect(DICTATION_EVAL_PROMPT_VERSION).toMatch(/^dictation@\d{4}-\d{2}-\d{2}$/);
  });

  it('system prompt names the forgiveness contract', () => {
    expect(DICTATION_EVAL_SYSTEM_PROMPT).toMatch(/accepted/i);
    expect(DICTATION_EVAL_SYSTEM_PROMPT).toMatch(/error/i);
  });

  it('user prompt embeds reference, answer, and numbered differences', () => {
    const p = buildDictationUserPrompt({
      referenceText: 'el tiempo lo cura todo',
      userAnswer: 'el tiempo locura todo',
      language: 'ES' as never,
      differences: [{ id: 1, got: 'locura', expected: 'lo cura' }],
    });
    expect(p).toContain('el tiempo lo cura todo');
    expect(p).toContain('el tiempo locura todo');
    expect(p).toContain('#1');
    expect(p).toContain('locura');
  });
});
