import { describe, it, expect } from 'vitest';
import {
  DICTATION_DOMAINS,
  dictationDomainForOrdinal,
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

it('the generation prompt gives explicit A1 and A2 length bands', () => {
  expect(DICTATION_GENERATION_SYSTEM_PROMPT).toContain('A1');
  expect(DICTATION_GENERATION_SYSTEM_PROMPT).toContain('A2');
});

it('version is bumped to the anti-stacking + seed-subordination edit date', () => {
  expect(DICTATION_GENERATION_PROMPT_VERSION).toBe('dictation-generate@2026-06-25');
});

it('the generation prompt forbids stacking multiple heavy constructions into one clip', () => {
  expect(DICTATION_GENERATION_SYSTEM_PROMPT).toContain('One construction, not a pile-up');
  expect(DICTATION_GENERATION_SYSTEM_PROMPT).toContain('{{cefrLevel}}');
});

it('user prompt names the ordinal and the domain', () => {
  const u = buildDictationGenerationUserPrompt(inputs as never, 2, 'travel', 'batch-1');
  expect(u).toContain('#3');
  expect(u).toContain('travel');
  expect(u).toContain('submit_dictation_exercise');
});

it('renders the curriculum level-scope section when levelScopePoints are supplied', () => {
  const scoped = {
    ...inputs,
    levelScopePoints: [
      { key: 'tr-a1-stem-changes', name: 'Stem changes: consonant softening & vowel drop', cefrLevel: 'A1' },
      { key: 'tr-a1-present-continuous', name: 'Present continuous -iyor', cefrLevel: 'A1' },
    ],
  };
  const vars = computeDictationGenerationPromptVars(scoped as never);
  const { text, missingVars } = applyTemplate(DICTATION_GENERATION_SYSTEM_PROMPT, vars);
  expect(missingVars).toEqual([]);
  expect(text).toContain("Grammar in this learner's scope");
  expect(text).toContain('consonant softening');
  expect(text).toContain('Present continuous -iyor');
});

it('omits the level-scope section when no levelScopePoints are supplied', () => {
  const vars = computeDictationGenerationPromptVars(inputs as never);
  expect(vars.levelScopeSection).toBe('');
});

it('user prompt anchors on a seed word but subordinates it to the level + safety bands', () => {
  const u = buildDictationGenerationUserPrompt(inputs as never, 0, 'travel', 'batch-1', 'maleta');
  expect(u).toContain('maleta');
  // The seed must yield to the vocabulary band rather than force an above-level word.
  expect(u).toContain('above this cell');
  expect(u).toContain('DROP it');
});

it('user prompt omits the seed line when no seed word is supplied', () => {
  const u = buildDictationGenerationUserPrompt(inputs as never, 0, 'travel', 'batch-1');
  expect(u).not.toContain('Anchor the clip');
});

const rotationInputs = {
  language: Language.TR, cefrLevel: 'A1', exerciseType: ExerciseType.DICTATION,
  grammarPoint: { key: 'tr-a1-dictation', kind: 'dictation', name: 'x', description: 'x',
    cefrLevel: 'A1', language: Language.TR, examplesPositive: ['a', 'b'], examplesNegative: ['*c'], commonErrors: ['d'] },
} as never;

it('rotates to a distinct domain on consecutive ordinals', () => {
  const seed = 'batch-1';
  expect(dictationDomainForOrdinal(0, seed)).not.toBe(dictationDomainForOrdinal(1, seed));
  // The first full cycle is all-distinct (one domain per ordinal).
  const cycle = Array.from({ length: DICTATION_DOMAINS.length }, (_, i) => dictationDomainForOrdinal(i, seed));
  expect(new Set(cycle).size).toBe(DICTATION_DOMAINS.length);
});

it('shifts the starting domain with the batch seed (cross-tick variety)', () => {
  const a = dictationDomainForOrdinal(0, 'scheduled-2026-06-17');
  const b = dictationDomainForOrdinal(0, 'scheduled-2026-06-18');
  expect(a).not.toBe(b);
});

it('user prompt pins a per-ordinal domain when topicDomain is null', () => {
  const p0 = buildDictationGenerationUserPrompt(rotationInputs, 0, null, 'batch-1');
  const p1 = buildDictationGenerationUserPrompt(rotationInputs, 1, null, 'batch-1');
  expect(p0).toContain(`Topic domain: ${dictationDomainForOrdinal(0, 'batch-1')}`);
  expect(p1).toContain(`Topic domain: ${dictationDomainForOrdinal(1, 'batch-1')}`);
  expect(p0).not.toBe(p1);
  expect(p0).toContain('submit_dictation_exercise');
});

it('an explicit topicDomain overrides the rotation for all ordinals', () => {
  const p0 = buildDictationGenerationUserPrompt(rotationInputs, 0, 'travel', 'batch-1');
  const p1 = buildDictationGenerationUserPrompt(rotationInputs, 1, 'travel', 'batch-1');
  expect(p0).toContain('Topic domain: travel');
  expect(p1).toContain('Topic domain: travel');
});
