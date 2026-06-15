import { describe, it, expect } from 'vitest';
import {
  DICTATION_GENERATION_PROMPT_VERSION,
  DICTATION_GENERATION_SYSTEM_PROMPT,
  computeDictationGenerationPromptVars,
  buildDictationGenerationUserPrompt,
} from './dictation-generation-prompts';
import { applyTemplate } from './prompts-registry';
import { ExerciseType, Language } from '@language-drill/shared';

const inputs = {
  language: Language.ES, cefrLevel: 'B1', exerciseType: ExerciseType.DICTATION,
  grammarPoint: { key: 'es-b1-dictation', kind: 'dictation', name: 'Dictation — connected speech (B1)',
    description: 'Natural B1 clips.', cefrLevel: 'B1', language: Language.ES,
    examplesPositive: ['Ejemplo uno.', 'Ejemplo dos.'], examplesNegative: ['*malo'], commonErrors: ['sinalefa'] },
} as const;

it('version string is date-stamped for the dictation-generate surface', () => {
  expect(DICTATION_GENERATION_PROMPT_VERSION).toMatch(/^dictation-generate@\d{4}-\d{2}-\d{2}$/);
});

it('template renders with no leftover {{vars}}', () => {
  const vars = computeDictationGenerationPromptVars(inputs as never);
  const { text, missingVars } = applyTemplate(DICTATION_GENERATION_SYSTEM_PROMPT, vars);
  expect(missingVars).toEqual([]);
  expect(text).toContain('B1');
  expect(text).toContain('submit_dictation_exercise');
});

it('user prompt names the ordinal and the domain', () => {
  const u = buildDictationGenerationUserPrompt(inputs as never, 2, 'travel');
  expect(u).toContain('#3');
  expect(u).toContain('travel');
  expect(u).toContain('submit_dictation_exercise');
});
