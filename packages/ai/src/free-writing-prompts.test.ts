import { describe, it, expect } from 'vitest';
import { CefrLevel, Language, ExerciseType, type FreeWritingContent } from '@language-drill/shared';
import {
  FREE_WRITING_EVAL_SYSTEM_PROMPT,
  FREE_WRITING_EVAL_PROMPT_VERSION,
  buildFreeWritingUserPrompt,
} from './free-writing-prompts.js';

const content: FreeWritingContent = {
  type: ExerciseType.FREE_WRITING,
  instructions: 'Write a paragraph.',
  title: 'El teletrabajo',
  task: 'Argumenta a favor o en contra del teletrabajo.',
  domain: 'opinión',
  register: 'formal',
  minWords: 150,
  maxWords: 200,
  requiredElements: [{ id: 'cond', label: 'Usa dos oraciones condicionales' }],
};

describe('FREE_WRITING_EVAL_PROMPT_VERSION', () => {
  it('is a dated free-writing-eval tag', () => {
    expect(FREE_WRITING_EVAL_PROMPT_VERSION).toMatch(/^free-writing-eval@\d{4}-\d{2}-\d{2}$/);
  });
});

describe('FREE_WRITING_EVAL_SYSTEM_PROMPT', () => {
  it('names the four IELTS-style criteria', () => {
    expect(FREE_WRITING_EVAL_SYSTEM_PROMPT).toMatch(/task achievement/i);
    expect(FREE_WRITING_EVAL_SYSTEM_PROMPT).toMatch(/coherence/i);
    expect(FREE_WRITING_EVAL_SYSTEM_PROMPT).toMatch(/lexical/i);
    expect(FREE_WRITING_EVAL_SYSTEM_PROMPT).toMatch(/grammatical range/i);
  });
  it('instructs the model to return exact substrings', () => {
    expect(FREE_WRITING_EVAL_SYSTEM_PROMPT).toMatch(/exact substring/i);
  });
  it('instructs per-error grammar-point attribution from the in-scope set', () => {
    expect(FREE_WRITING_EVAL_SYSTEM_PROMPT).toMatch(/grammarPointKey/);
    expect(FREE_WRITING_EVAL_SYSTEM_PROMPT).toMatch(/in scope/i);
  });
});

describe('buildFreeWritingUserPrompt', () => {
  it('includes the task, constraints, required elements, and the learner answer', () => {
    const p = buildFreeWritingUserPrompt(content, 'Mi respuesta.', Language.ES, CefrLevel.B2);
    expect(p).toContain('Argumenta a favor');
    expect(p).toContain('150');
    expect(p).toContain('200');
    expect(p).toContain('formal');
    expect(p).toContain('Usa dos oraciones condicionales');
    expect(p).toContain('Mi respuesta.');
    expect(p).toContain('ES');
    expect(p).toContain('B2');
  });

  it('appends a Grammar points in scope block when attribution keys are provided', () => {
    const p = buildFreeWritingUserPrompt(content, 'Mi respuesta.', Language.ES, CefrLevel.B2, [
      { key: 'es-b2-subjunctive', name: 'Subjunctive' },
      { key: 'es-b1-ser-estar', name: 'Ser vs estar' },
    ]);
    expect(p).toContain('Grammar points in scope');
    expect(p).toContain('es-b2-subjunctive — Subjunctive');
    expect(p).toContain('es-b1-ser-estar — Ser vs estar');
  });

  it('omits the scope block when no attribution keys are provided', () => {
    const p = buildFreeWritingUserPrompt(content, 'Mi respuesta.', Language.ES, CefrLevel.B2);
    expect(p).not.toContain('Grammar points in scope');
  });
});
