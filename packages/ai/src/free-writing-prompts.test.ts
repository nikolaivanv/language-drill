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
});
