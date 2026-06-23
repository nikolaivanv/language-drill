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

  it('the validation rubric covers A1 and A2 (short clips are not "too short")', () => {
    expect(DICTATION_VALIDATION_SYSTEM_PROMPT).toContain('A1');
    expect(DICTATION_VALIDATION_SYSTEM_PROMPT).toContain('A2');
  });

  it('version is bumped to the level-scope edit date', () => {
    expect(DICTATION_VALIDATION_PROMPT_VERSION).toBe('dictation-validate@2026-06-23');
  });

  it('renders the curriculum level-scope and tells levelMatch to use it as ground truth', () => {
    const scoped = {
      ...spec,
      levelScopePoints: [
        { key: 'tr-a1-stem-changes', name: 'Stem changes: consonant softening & vowel drop', cefrLevel: 'A1' },
        { key: 'tr-a1-present-continuous', name: 'Present continuous -iyor', cefrLevel: 'A1' },
      ],
    };
    const { text, missingVars } = applyTemplate(
      DICTATION_VALIDATION_SYSTEM_PROMPT, computeDictationValidationPromptVars(scoped as never));
    expect(missingVars).toEqual([]);
    expect(text).toContain("Grammar in this learner's scope");
    expect(text).toContain('consonant softening');
    // The levelMatch rubric must defer to the scope list, not the model's own sense of level.
    expect(text).toContain('ground truth');
  });

  it('omits the level-scope section when no levelScopePoints are supplied', () => {
    expect(computeDictationValidationPromptVars(spec as never).levelScopeSection).toBe('');
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
