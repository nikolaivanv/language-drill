import { describe, it, expect } from 'vitest';
import {
  ExerciseType,
  Language,
  type ClozeContent,
  type EvaluationResult,
  type SentenceConstructionContent,
  type TranslationContent,
  type VocabRecallContent,
} from '@language-drill/shared';
import { POLLY_NEURAL_MAX_CHARS } from '@language-drill/db';
import { spokenTextFor } from './spoken-text';

const cloze = (over: Partial<ClozeContent> = {}): ClozeContent => ({
  type: ExerciseType.CLOZE,
  instructions: 'fill the blank',
  sentence: 'Yarın ___ gidiyorum.',
  correctAnswer: 'okula',
  ...over,
});

const translation = (over: Partial<TranslationContent> = {}): TranslationContent => ({
  type: ExerciseType.TRANSLATION,
  instructions: 'translate',
  sourceText: 'I am going home.',
  sourceLanguage: Language.EN,
  targetLanguage: Language.TR,
  referenceTranslation: 'Eve gidiyorum.',
  ...over,
});

const sc = (over: Partial<SentenceConstructionContent> = {}): SentenceConstructionContent => ({
  type: ExerciseType.SENTENCE_CONSTRUCTION,
  instructions: 'build a sentence',
  promptMode: 'keywords',
  prompt: 'Use: ev, gitmek',
  keywords: ['ev', 'gitmek'],
  modelAnswers: ['Eve gidiyorum.', 'Eve gittim.'],
  ...over,
});

const evaluation = (over: Partial<EvaluationResult> = {}): EvaluationResult => ({
  score: 1,
  grammarAccuracy: 1,
  vocabularyRange: 'A1',
  taskAchievement: 1,
  feedback: 'ok',
  errors: [],
  estimatedCefrEvidence: 'A1',
  evaluationSource: 'llm',
  ...over,
});

const oneError = [
  { type: 'grammar' as const, severity: 'major' as const, text: 'okulda', correction: 'okula', explanation: 'dative' },
];

describe('spokenTextFor — cloze', () => {
  it('cloze deterministic voices the matched accepted form', () => {
    expect(
      spokenTextFor({
        exerciseLanguage: 'TR',
        content: cloze({ sentence: '___ kitap aldım.', correctAnswer: 'kitap', acceptableAnswers: ['iki'] }),
        userAnswer: 'Iki',
        evaluation: evaluation({ evaluationSource: 'deterministic' }),
      }),
    ).toEqual({ text: 'iki kitap aldım.', language: 'TR' });
  });

  it('cloze llm uses correctedAnswer', () => {
    expect(
      spokenTextFor({
        exerciseLanguage: 'TR',
        content: cloze(),
        userAnswer: 'okulda',
        evaluation: evaluation({ score: 0.3, errors: oneError, correctedAnswer: 'okula' }),
      }),
    ).toEqual({ text: 'Yarın okula gidiyorum.', language: 'TR' });
  });

  it('cloze llm without correctedAnswer falls back to correctAnswer', () => {
    expect(
      spokenTextFor({
        exerciseLanguage: 'TR',
        content: cloze(),
        userAnswer: 'okulda',
        evaluation: evaluation({ score: 0.3, errors: oneError }),
      })?.text,
    ).toBe('Yarın okula gidiyorum.');
  });

  it('cloze accepted unlisted alternative voices the learner answer', () => {
    expect(
      spokenTextFor({
        exerciseLanguage: 'TR',
        content: cloze(),
        userAnswer: 'işe',
        evaluation: evaluation({ correctedAnswer: 'işe' }),
      })?.text,
    ).toBe('Yarın işe gidiyorum.');
  });

  it('cloze with no blank → null', () => {
    expect(
      spokenTextFor({
        exerciseLanguage: 'TR',
        content: cloze({ sentence: 'Yarın gidiyorum.' }),
        userAnswer: 'okula',
        evaluation: evaluation({ evaluationSource: 'deterministic' }),
      }),
    ).toBeNull();
  });

  it('cloze with two blanks → null', () => {
    expect(
      spokenTextFor({
        exerciseLanguage: 'TR',
        content: cloze({ sentence: 'Yarın ___ ___ gidiyorum.' }),
        userAnswer: 'okula',
        evaluation: evaluation({ evaluationSource: 'deterministic' }),
      }),
    ).toBeNull();
  });
});

describe('spokenTextFor — translation / sentence construction', () => {
  it('translation uses correctedAnswer in the target language', () => {
    expect(
      spokenTextFor({
        exerciseLanguage: 'TR',
        content: translation(),
        userAnswer: 'Evde gidiyorum.',
        evaluation: evaluation({ score: 0.6, errors: oneError, correctedAnswer: 'Eve gidiyorum.' }),
      }),
    ).toEqual({ text: 'Eve gidiyorum.', language: 'TR' });
  });

  it('translation into EN → null', () => {
    expect(
      spokenTextFor({
        exerciseLanguage: 'TR',
        content: translation({ sourceLanguage: Language.TR, targetLanguage: Language.EN }),
        userAnswer: 'I am going home.',
        evaluation: evaluation({ correctedAnswer: 'I am going home.' }),
      }),
    ).toBeNull();
  });

  it('sentence_construction without correctedAnswer → null', () => {
    expect(
      spokenTextFor({
        exerciseLanguage: 'TR',
        content: sc(),
        userAnswer: 'Evde gidiyorum.',
        evaluation: evaluation({ score: 0.6, errors: oneError }),
      }),
    ).toBeNull();
  });

  it('errors empty → learner answer as typed', () => {
    expect(
      spokenTextFor({
        exerciseLanguage: 'TR',
        content: sc(),
        userAnswer: '  Eve   gidiyorum. ',
        evaluation: evaluation({ correctedAnswer: 'Eve gidiyorum!' }),
      })?.text,
    ).toBe('Eve gidiyorum.');
  });

  it('echo with errors → null', () => {
    expect(
      spokenTextFor({
        exerciseLanguage: 'TR',
        content: translation(),
        userAnswer: 'Evde gidiyorum.',
        evaluation: evaluation({ score: 0.5, errors: oneError, correctedAnswer: 'Evde gidiyorum.' }),
      }),
    ).toBeNull();
  });

  it('echo with taskAchievement 0.5 → null', () => {
    expect(
      spokenTextFor({
        exerciseLanguage: 'TR',
        content: translation(),
        userAnswer: 'Ev.',
        evaluation: evaluation({ score: 0.5, taskAchievement: 0.5, correctedAnswer: 'Ev.' }),
      }),
    ).toBeNull();
  });

  it('task miss rewritten → voices the rewrite', () => {
    expect(
      spokenTextFor({
        exerciseLanguage: 'TR',
        content: translation(),
        userAnswer: 'I am going home.',
        evaluation: evaluation({ score: 0.1, taskAchievement: 0.1, correctedAnswer: 'Eve gidiyorum.' }),
      })?.text,
    ).toBe('Eve gidiyorum.');
  });

  it('empty correctedAnswer → null', () => {
    expect(
      spokenTextFor({
        exerciseLanguage: 'TR',
        content: translation(),
        userAnswer: 'Evde gidiyorum.',
        evaluation: evaluation({ score: 0.5, errors: oneError, correctedAnswer: '   ' }),
      }),
    ).toBeNull();
  });

  it('longer than POLLY_NEURAL_MAX_CHARS → null', () => {
    const long = 'a'.repeat(POLLY_NEURAL_MAX_CHARS + 1);
    expect(
      spokenTextFor({
        exerciseLanguage: 'TR',
        content: sc(),
        userAnswer: long,
        evaluation: evaluation(),
      }),
    ).toBeNull();
  });
});

describe('spokenTextFor — unsupported', () => {
  it('unsupported type (vocab_recall) → null', () => {
    const vocab: VocabRecallContent = {
      type: ExerciseType.VOCAB_RECALL,
      instructions: 'recall',
      prompt: 'home',
      expectedWord: 'ev',
      hints: [],
      exampleSentence: 'Ev büyük.',
    };
    expect(
      spokenTextFor({ exerciseLanguage: 'TR', content: vocab, userAnswer: 'ev', evaluation: evaluation() }),
    ).toBeNull();
  });
});
