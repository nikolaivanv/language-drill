import { describe, it, expect } from 'vitest';
import {
  DICTATION_VALIDATION_PROMPT_VERSION,
  DICTATION_VALIDATION_SYSTEM_PROMPT,
  computeDictationValidationPromptVars,
  buildDictationValidationUserPrompt,
} from './dictation-validation-prompts';
import { applyTemplate } from './prompts-registry';
import { ExerciseType, Language } from '@language-drill/shared';

const spec = {
  language: Language.ES, cefrLevel: 'B1', exerciseType: ExerciseType.DICTATION,
  grammarPoint: { key: 'es-b1-dictation', kind: 'dictation', name: 'Dictation B1',
    description: 'd', cefrLevel: 'B1', language: Language.ES,
    examplesPositive: ['a','b'], examplesNegative: ['*c'], commonErrors: ['e'] },
} as const;

describe('dictation-validation-prompts', () => {
  it('version string is date-stamped for the dictation-validate surface', () => {
    expect(DICTATION_VALIDATION_PROMPT_VERSION).toMatch(/^dictation-validate@\d{4}-\d{2}-\d{2}$/);
  });

  it('template renders with no leftover vars and mentions the validation tool', () => {
    const { text, missingVars } = applyTemplate(
      DICTATION_VALIDATION_SYSTEM_PROMPT, computeDictationValidationPromptVars(spec as never));
    expect(missingVars).toEqual([]);
    expect(text).toContain('submit_validation_result');
    expect(text).toContain('listenab');
  });

  it('user prompt shows the clip text', () => {
    const content = { type: ExerciseType.DICTATION, title: 't', referenceText: 'El tiempo lo cura.',
      sentences: ['El tiempo lo cura.'], accent: 'a', voiceId: 'Sergio', tested: ['sinalefa'],
      durationSec: 6, waveform: [0.5] };
    const u = buildDictationValidationUserPrompt(content as never, spec as never);
    expect(u).toContain('El tiempo lo cura.');
    expect(u).toContain('sinalefa');
  });
});
