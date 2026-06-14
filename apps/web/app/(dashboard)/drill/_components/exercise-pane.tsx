'use client';

import * as React from 'react';
import {
  isClozeContent,
  isDictationContent,
  isSentenceConstructionContent,
  isTranslationContent,
  isVocabRecallContent,
  type ExerciseContent,
  type LearningLanguage,
} from '@language-drill/shared';
import type { ExerciseResponse } from '@language-drill/api-client';
import { ClozeExercise } from './cloze-exercise';
import { DictationExercise } from './dictation-exercise';
import { SentenceConstructionExercise } from './sentence-construction-exercise';
import { TranslationExercise } from './translation-exercise';
import { VocabExercise } from './vocab-exercise';
import type { SubmissionMeta, SubmissionState } from './types';

export type { SubmissionMeta, SubmissionState } from './types';

export interface ExercisePaneProps {
  exercise: ExerciseResponse;
  language: LearningLanguage;
  submission: SubmissionState;
  onSubmit: (answer: string, meta: SubmissionMeta) => void;
  onNext: () => void;
  nextLabel?: string;
}

export function ExercisePane({
  exercise,
  language,
  submission,
  onSubmit,
  onNext,
  nextLabel,
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
      />
    );
  }

  return <p className="t-body text-ink-mute">unknown exercise type</p>;
}
