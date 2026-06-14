import { describe, it, expect, vi } from 'vitest';
import { Language, CefrLevel, type DictationContent } from '@language-drill/shared';
import { gradeDictationAnswer, parseDictationClassification } from './dictation-eval.js';

const content: DictationContent = {
  type: 'dictation' as never,
  title: 't',
  referenceText: 'el tiempo lo cura todo',
  sentences: ['el tiempo lo cura todo'],
  accent: 'es',
  voiceId: 'Sergio',
  tested: [],
  durationSec: 5,
  waveform: [0.5],
};

function mockClient(classification: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', name: 'submit_dictation_classification', input: classification }],
      }),
    },
  } as never;
}

describe('parseDictationClassification', () => {
  it('rejects a non-object', () => {
    expect(() => parseDictationClassification(null)).toThrow();
  });
});

describe('gradeDictationAnswer', () => {
  it('treats accepted differences as correct in the adjusted accuracy', async () => {
    // "bale" vs "vale": one substitution; Claude accepts it (b/v).
    const client = mockClient({
      headline: 'h',
      summary: 's',
      listeningCefr: 'B2',
      differences: [{ id: 1, kind: 'accepted', category: 'b/v', severity: null, note: 'n' }],
      criteria: [
        { id: 'phon', label: 'Phoneme discrimination', score: 0.9, cefr: 'B2', note: 'n' },
        { id: 'bound', label: 'Word-boundary tracking', score: 0.8, cefr: 'B1', note: 'n' },
      ],
    });
    const r = await gradeDictationAnswer(client, {
      exercise: { ...content, referenceText: 'vale la pena', sentences: ['vale la pena'] },
      userAnswer: 'bale la pena',
      language: Language.ES,
      difficulty: CefrLevel.B2,
    });
    expect(r.kind).toBe('dictation');
    // accepted → adjusted accuracy is a perfect 1.0 even though raw < 1.
    expect(r.adjustedCharAccuracy).toBe(1);
    expect(r.rawCharAccuracy).toBeLessThan(1);
    expect(r.score).toBe(r.adjustedCharAccuracy);
    expect(r.errors).toHaveLength(0); // accepted ⇒ not an EvaluationError
  });

  it('accepted diffs reach adjusted 1.0 even with a capitalized reference', async () => {
    const client = mockClient({
      headline: 'h', summary: 's', listeningCefr: 'B2',
      differences: [{ id: 1, kind: 'accepted', category: 'b/v', severity: null, note: 'n' }],
      criteria: [
        { id: 'phon', label: 'Phoneme discrimination', score: 0.9, cefr: 'B2', note: 'n' },
        { id: 'bound', label: 'Word-boundary tracking', score: 0.8, cefr: 'B1', note: 'n' },
      ],
    });
    const r = await gradeDictationAnswer(client, {
      exercise: { ...content, referenceText: 'Vale la pena', sentences: ['Vale la pena'] },
      userAnswer: 'bale la pena',
      language: Language.ES,
      difficulty: CefrLevel.B2,
    });
    expect(r.adjustedCharAccuracy).toBe(1);
  });

  it('keeps genuine errors and maps them to EvaluationError', async () => {
    const client = mockClient({
      headline: 'h',
      summary: 's',
      listeningCefr: 'B1',
      differences: [{ id: 1, kind: 'error', category: 'word boundary', severity: 'high', note: 'n' }],
      criteria: [
        { id: 'phon', label: 'Phoneme discrimination', score: 0.7, cefr: 'B1', note: 'n' },
        { id: 'bound', label: 'Word-boundary tracking', score: 0.5, cefr: 'A2', note: 'n' },
      ],
    });
    const r = await gradeDictationAnswer(client, {
      exercise: content,
      userAnswer: 'el tiempo locura todo',
      language: Language.ES,
      difficulty: CefrLevel.B2,
    });
    expect(r.adjustedCharAccuracy).toBeCloseTo(r.rawCharAccuracy, 5); // nothing forgiven
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].severity).toBe('major');
    expect(r.criteria.map((c) => c.id)).toEqual(['char', 'word', 'phon', 'bound']);
  });
});
