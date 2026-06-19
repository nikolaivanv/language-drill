'use client';

import * as React from 'react';
import { ExerciseType, type ExerciseContent } from '@language-drill/shared';
import { AccentPicker, Button, Input } from '../../../../components/ui';
import { ClozePrompt, type BlankState } from '../../../../components/drill/cloze-prompt';
import { VocabPromptCard } from '../../../../components/drill/vocab-prompt';
import { ConjugationPromptCard } from '../../../../components/drill/conjugation-prompt';
import { FeedbackShell } from '../../drill/_components/feedback-shell';
import { formatSeconds } from './fluency-metrics';

export type FluencyVerdict = { correct: boolean; correctAnswer: string } | null;

export interface FluencyItemProps {
  content: ExerciseContent;
  language: string;
  elapsedMs: number;
  verdict: FluencyVerdict;
  onSubmit: (answer: string) => void;
  onNext: () => void;
  isLast: boolean;
}

function isAccentLanguage(lang: string): lang is 'ES' | 'DE' | 'TR' {
  return lang === 'ES' || lang === 'DE' || lang === 'TR';
}

// Fluency reuses the standard drill's prompt visuals (so cloze/vocab/conjugation
// look identical to normal mode) but grades locally — no Claude. The verdict
// uses FeedbackShell with the response latency in the score chip, on-theme for a
// speed drill. Timed-recall scaffolds (cloze MC options, vocab hints) are
// deliberately omitted.
export function FluencyItem({
  content,
  language,
  elapsedMs,
  verdict,
  onSubmit,
  onNext,
  isLast,
}: FluencyItemProps) {
  const [answer, setAnswer] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const locked = verdict !== null;

  React.useEffect(() => {
    setAnswer('');
    inputRef.current?.focus();
  }, [content]);

  const submit = React.useCallback(() => {
    if (answer.trim() && !locked) onSubmit(answer);
  }, [answer, locked, onSubmit]);

  const blankState: BlankState = verdict
    ? verdict.correct
      ? 'correct'
      : 'wrong'
    : answer.trim().length > 0
      ? 'filled'
      : 'idle';

  function onKeyDownInput(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex flex-col gap-s-4">
      {!locked && (
        <p className="t-small text-ink-mute" aria-live="off">
          {formatSeconds(elapsedMs)}
        </p>
      )}

      {content.type === ExerciseType.CLOZE && (
        <ClozePrompt
          content={content}
          answer={answer}
          onAnswerChange={setAnswer}
          blankState={blankState}
          disabled={locked}
          onEnterSubmit={submit}
          inputRef={inputRef}
          showHelper={!locked}
        />
      )}

      {content.type === ExerciseType.VOCAB_RECALL && (
        <>
          <VocabPromptCard content={content} />
          <Input
            ref={inputRef}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={onKeyDownInput}
            readOnly={locked}
            disabled={locked}
            className={locked ? 'opacity-60' : undefined}
          />
        </>
      )}

      {content.type === ExerciseType.CONJUGATION && (
        <>
          <ConjugationPromptCard content={content} />
          <Input
            ref={inputRef}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={onKeyDownInput}
            readOnly={locked}
            disabled={locked}
            className={locked ? 'opacity-60' : undefined}
          />
        </>
      )}

      {isAccentLanguage(language) && (
        <AccentPicker language={language} targetRef={inputRef} disabled={locked} />
      )}

      {verdict ? (
        <div role="status">
          <FeedbackShell
            tier={verdict.correct ? 'sage' : 'terracotta'}
            label={verdict.correct ? 'correct' : 'not quite'}
            scoreChipText={formatSeconds(elapsedMs)}
            onNext={onNext}
            nextLabel={isLast ? 'finish' : 'next'}
          >
            <div className="flex flex-col gap-s-1">
              <p className="t-micro text-ink-mute">correct answer</p>
              <p className="t-display-m">{verdict.correctAnswer}</p>
            </div>
          </FeedbackShell>
        </div>
      ) : (
        <Button variant="primary" onClick={submit} disabled={!answer.trim()}>
          submit
        </Button>
      )}
    </div>
  );
}
