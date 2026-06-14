import { describe, it, expect } from 'vitest';
import { FreeWritingEvaluationSchema } from '../schemas/exercise';

const valid = {
  overallScore: 0.8, overallCefr: 'B2', headline: 'h', summary: 's',
  criteria: [
    { id: 'task', label: 'Task achievement', score: 0.85, cefr: 'B2', note: 'n' },
    { id: 'coherence', label: 'Coherence & cohesion', score: 0.9, cefr: 'C1', note: 'n' },
    { id: 'lexis', label: 'Lexical resource', score: 0.75, cefr: 'B2', note: 'n' },
    { id: 'grammar', label: 'Grammatical range & accuracy', score: 0.68, cefr: 'B1', note: 'n' },
  ],
  errors: [{ n: 1, severity: 'high', type: 'Modo verbal', original: 'tendría', correction: 'tuviera', note: 'n' }],
  goodSpans: ['Sin embargo'],
  improved: { text: 'mejor', upgrades: ['mejor'] },
  wordCount: 162, improvedWordCount: 168,
};

describe('FreeWritingEvaluationSchema', () => {
  it('parses a valid evaluation', () => {
    expect(FreeWritingEvaluationSchema.parse(valid).overallScore).toBe(0.8);
  });
  it('rejects an out-of-range score', () => {
    expect(() => FreeWritingEvaluationSchema.parse({ ...valid, overallScore: 2 })).toThrow();
  });
});
