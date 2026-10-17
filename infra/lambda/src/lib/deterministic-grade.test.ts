import { describe, expect, it } from 'vitest';
import { ExerciseType, type VocabRecallContent } from '@language-drill/shared';
import { deterministicFluencyResult, tagWrongArticle } from './deterministic-grade';

const vocab: VocabRecallContent = {
  type: ExerciseType.VOCAB_RECALL,
  instructions: '',
  prompt: 'The part of the body at the top of your neck.',
  expectedWord: 'cabeza',
  articleForm: 'la cabeza',
  hints: [],
  exampleSentence: 'Me duele la cabeza.',
};

describe('deterministicFluencyResult — vocab', () => {
  it('scores the word with its article as exact', () => {
    const r = deterministicFluencyResult(vocab, 'la cabeza', false, 'A2');
    expect(r?.score).toBe(1);
    expect(r?.errors).toEqual([]);
  });

  it('gives partial credit, tagged, for a missing article — no Claude call', () => {
    const r = deterministicFluencyResult(vocab, 'cabeza', false, 'A2');
    expect(r?.score).toBe(0.8);
    expect(r?.errors[0]).toMatchObject({ code: 'missing-article', correction: 'la cabeza' });
  });

  it('leaves a different article to the evaluator (common-gender nouns)', () => {
    expect(deterministicFluencyResult(vocab, 'el cabeza', false, 'A2')).toBeNull();
  });

  it('records a give-up as a revealed score-0 attempt', () => {
    const r = deterministicFluencyResult(vocab, '', true, 'A2');
    expect(r?.score).toBe(0);
    expect(r?.errors[0]).toMatchObject({ code: 'revealed', correction: 'la cabeza' });
  });

  it('falls through (null) for a different word', () => {
    expect(deterministicFluencyResult(vocab, 'el cuello', false, 'A2')).toBeNull();
  });

  it('keeps plain exact matching for rows without an article form', () => {
    const verb = { ...vocab, expectedWord: 'correr', articleForm: undefined };
    expect(deterministicFluencyResult(verb, 'correr', false, 'A2')?.score).toBe(1);
    expect(deterministicFluencyResult(verb, 'corro', false, 'A2')).toBeNull();
  });
});

describe('tagWrongArticle', () => {
  const graded = (score: number) => ({
    score,
    grammarAccuracy: score,
    vocabularyRange: 'A2',
    taskAchievement: 1,
    feedback: '',
    errors:
      score < 1
        ? [{ type: 'grammar' as const, severity: 'major' as const, text: 'el cabeza', correction: 'la cabeza', explanation: '' }]
        : [],
    estimatedCefrEvidence: 'A2',
  });

  it('tags the grammar error of an article-only miss', () => {
    expect(tagWrongArticle(vocab, 'el cabeza', graded(0.6)).errors[0]?.code).toBe('wrong-article');
  });

  it('leaves a full score (common-gender noun) and other answers alone', () => {
    const periodista = { ...vocab, expectedWord: 'periodista', articleForm: 'el periodista' };
    expect(tagWrongArticle(periodista, 'la periodista', graded(1)).errors).toEqual([]);
    expect(tagWrongArticle(vocab, 'el cuello', graded(0)).errors[0]?.code).toBeUndefined();
  });
});
