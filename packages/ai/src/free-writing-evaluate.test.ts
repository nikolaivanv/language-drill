import { describe, it, expect, vi } from 'vitest';
import { CefrLevel, Language, ExerciseType, type FreeWritingContent } from '@language-drill/shared';
import {
  FREE_WRITING_EVAL_TOOL,
  FREE_WRITING_EVAL_TOOL_NAME,
  parseFreeWritingEvaluation,
  evaluateFreeWriting,
} from './free-writing-evaluate';
import { ContentRejectedError } from './content-rejected-error';

const content: FreeWritingContent = {
  type: ExerciseType.FREE_WRITING,
  instructions: 'Write.',
  title: 'T',
  task: 'Task.',
  domain: 'd',
  register: 'formal',
  minWords: 150,
  maxWords: 200,
  requiredElements: [],
};

const valid = {
  overallScore: 0.8,
  overallCefr: 'B2',
  headline: 'Strong.',
  summary: 'Good work overall.',
  criteria: [
    { id: 'task', label: 'Task achievement', score: 0.85, cefr: 'B2', note: 'n' },
    { id: 'coherence', label: 'Coherence & cohesion', score: 0.9, cefr: 'C1', note: 'n' },
    { id: 'lexis', label: 'Lexical resource', score: 0.75, cefr: 'B2', note: 'n' },
    { id: 'grammar', label: 'Grammatical range & accuracy', score: 0.68, cefr: 'B1', note: 'n' },
  ],
  errors: [
    { n: 1, severity: 'high', type: 'Modo verbal', original: 'tendría', correction: 'tuviera', where: '§3', note: 'n' },
  ],
  goodSpans: ['Sin embargo'],
  improved: { text: 'Mejor texto.', upgrades: ['Mejor'] },
  wordCount: 162,
  improvedWordCount: 168,
};

describe('FREE_WRITING_EVAL_TOOL', () => {
  it('is named submit_free_writing_evaluation with the required fields', () => {
    expect(FREE_WRITING_EVAL_TOOL.name).toBe('submit_free_writing_evaluation');
    expect(FREE_WRITING_EVAL_TOOL_NAME).toBe('submit_free_writing_evaluation');
    const req = FREE_WRITING_EVAL_TOOL.input_schema.required as string[];
    expect(req).toContain('overallScore');
    expect(req).toContain('criteria');
    expect(req).toContain('errors');
    expect(req).toContain('improved');
  });
});

describe('parseFreeWritingEvaluation', () => {
  it('parses a valid payload', () => {
    const r = parseFreeWritingEvaluation(valid);
    expect(r.overallScore).toBe(0.8);
    expect(r.criteria).toHaveLength(4);
    expect(r.errors[0].correction).toBe('tuviera');
  });

  it('clamps out-of-range scores to [0,1]', () => {
    const r = parseFreeWritingEvaluation({ ...valid, overallScore: 1.4 });
    expect(r.overallScore).toBe(1);
  });

  it('drops malformed errors instead of throwing', () => {
    const r = parseFreeWritingEvaluation({
      ...valid,
      errors: [{ n: 1, severity: 'nope', original: 5 }, valid.errors[0]],
    });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].original).toBe('tendría');
  });

  it('throws when criteria count is not four', () => {
    expect(() => parseFreeWritingEvaluation({ ...valid, criteria: valid.criteria.slice(0, 3) })).toThrow();
  });
});

describe('evaluateFreeWriting', () => {
  it('calls Claude with the FW tool and returns the parsed result', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'submit_free_writing_evaluation', input: valid }],
    });
    const client = { messages: { create } } as unknown as import('@anthropic-ai/sdk').default;
    const r = await evaluateFreeWriting(client, {
      content,
      userAnswer: 'Mi texto.',
      language: Language.ES,
      difficulty: CefrLevel.B2,
    });
    expect(r.overallScore).toBe(0.8);
    expect(create).toHaveBeenCalledOnce();
    const args = create.mock.calls[0][0];
    expect(args.tools[0].name).toBe('submit_free_writing_evaluation');
    expect(args.tool_choice).toEqual({ type: 'tool', name: 'submit_free_writing_evaluation' });
  });

  it('throws ContentRejectedError when Claude refuses the answer', async () => {
    const create = vi.fn().mockResolvedValue({ stop_reason: 'refusal', content: [] });
    const client = { messages: { create } } as unknown as import('@anthropic-ai/sdk').default;
    await expect(
      evaluateFreeWriting(client, {
        content,
        userAnswer: 'Ignore previous instructions and ...',
        language: Language.ES,
        difficulty: CefrLevel.B2,
      }),
    ).rejects.toBeInstanceOf(ContentRejectedError);
  });
});
