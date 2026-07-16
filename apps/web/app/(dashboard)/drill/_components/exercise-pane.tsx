'use client';

import * as React from 'react';
import {
  isClozeContent,
  isConjugationContent,
  isContextualParaphraseContent,
  isDictationContent,
  isSentenceConstructionContent,
  isTranslationContent,
  isVocabRecallContent,
  type ExerciseContent,
  type LearningLanguage,
} from '@language-drill/shared';
import type { AuthenticatedFetch, ExerciseResponse } from '@language-drill/api-client';
import { ClozeExercise } from './cloze-exercise';
import { ConjugationExercise } from './conjugation-exercise';
import { ContextualParaphraseExercise } from './contextual-paraphrase-exercise';
import { DictationExercise } from './dictation-exercise';
import { SentenceConstructionExercise } from './sentence-construction-exercise';
import { TranslationExercise } from './translation-exercise';
import { VocabExercise } from './vocab-exercise';
import type { CoachNudge } from './feedback-shell';
import type { SubmissionMeta, SubmissionState } from './types';

export type { SubmissionMeta, SubmissionState } from './types';
export type { CoachNudge } from './feedback-shell';

export interface ExercisePaneProps {
  exercise: ExerciseResponse;
  language: LearningLanguage;
  submission: SubmissionState;
  onSubmit: (answer: string, meta: SubmissionMeta) => void;
  onNext: () => void;
  nextLabel?: string;
  /** Coach nudge shown at the bottom of the feedback card when the current item
   *  is a known weak spot. Derived from `useInsightsErrors()` themes in the
   *  parent page. Omit when the item is not a weak spot. */
  coach?: CoachNudge | null;
  /** Authenticated fetch, threaded to the exercise types that support
   *  on-demand explanations of deterministic (instant-graded) results
   *  (cloze, vocab recall). Omitted in tests/contexts that don't need it. */
  fetchFn?: AuthenticatedFetch;
}

export function ExercisePane({
  exercise,
  language,
  submission,
  onSubmit,
  onNext,
  nextLabel,
  coach,
  fetchFn,
}: ExercisePaneProps) {
  const content = exercise.contentJson as ExerciseContent;

  if (
    content === null ||
    typeof content !== 'object' ||
    !('type' in content)
  ) {
    return <p className="t-body text-ink-mute">unknown exercise type</p>;
  }

  if (isClozeContent(content)) {
    return (
      <ClozeExercise
        key={exercise.id}
        content={content}
        language={language}
        submission={submission}
        onSubmit={onSubmit}
        onNext={onNext}
        nextLabel={nextLabel}
        exerciseId={exercise.id}
        coach={coach}
        fetchFn={fetchFn}
      />
    );
  }

  if (isTranslationContent(content)) {
    return (
      <TranslationExercise
        key={exercise.id}
        content={content}
        language={language}
        submission={submission}
        onSubmit={onSubmit}
        onNext={onNext}
        nextLabel={nextLabel}
        exerciseId={exercise.id}
        coach={coach}
        fetchFn={fetchFn}
      />
    );
  }

  if (isVocabRecallContent(content)) {
    return (
      <VocabExercise
        key={exercise.id}
        content={content}
        language={language}
        submission={submission}
        onSubmit={onSubmit}
        onNext={onNext}
        nextLabel={nextLabel}
        exerciseId={exercise.id}
        coach={coach}
        fetchFn={fetchFn}
      />
    );
  }

  if (isConjugationContent(content)) {
    return (
      <ConjugationExercise
        key={exercise.id}
        content={content}
        language={language}
        submission={submission}
        onSubmit={onSubmit}
        onNext={onNext}
        nextLabel={nextLabel}
        exerciseId={exercise.id}
        coach={coach}
      />
    );
  }

  if (isSentenceConstructionContent(content)) {
    return (
      <SentenceConstructionExercise
        key={exercise.id}
        content={content}
        language={language}
        submission={submission}
        onSubmit={onSubmit}
        onNext={onNext}
        nextLabel={nextLabel}
        exerciseId={exercise.id}
        coach={coach}
      />
    );
  }

  if (isContextualParaphraseContent(content)) {
    return (
      <ContextualParaphraseExercise
        key={exercise.id}
        content={content}
        language={language}
        submission={submission}
        onSubmit={onSubmit}
        onNext={onNext}
        nextLabel={nextLabel}
        exerciseId={exercise.id}
        coach={coach}
      />
    );
  }

  if (isDictationContent(content)) {
    return (
      <DictationExercise
        key={exercise.id}
        content={content}
        language={language}
        submission={submission}
        onSubmit={onSubmit}
        onNext={onNext}
        nextLabel={nextLabel}
        coach={coach}
      />
    );
  }

  return <p className="t-body text-ink-mute">unknown exercise type</p>;
}
