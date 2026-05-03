'use client';

import * as React from 'react';
import type { LearningLanguage, VocabRecallContent } from '@language-drill/shared';
import { AccentPicker, Button, Card, Input } from '../../../../components/ui';
import { parseConfusions } from '../../../../lib/drill/parse-confusions';
import { vocabVerdict } from '../../../../lib/drill/verdict-tier';
import { FeedbackShell } from './feedback-shell';
import { HintRow } from './hint-row';
import type { SubmissionMeta, SubmissionState } from './types';

export type { SubmissionMeta, SubmissionState } from './types';

export interface VocabExerciseProps {
  content: VocabRecallContent;
  language: LearningLanguage;
  submission: SubmissionState;
  onSubmit: (answer: string, meta: SubmissionMeta) => void;
  onNext: () => void;
}

function isAccentLanguage(lang: string): lang is 'ES' | 'DE' | 'TR' {
  return lang === 'ES' || lang === 'DE' || lang === 'TR';
}

export function VocabExercise({
  content,
  language,
  submission,
  onSubmit,
  onNext,
}: VocabExerciseProps) {
  const [answer, setAnswer] = React.useState('');
  const [hintLevel, setHintLevel] = React.useState<0 | 1 | 2 | 3>(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isLocked = submission.kind !== 'idle';
  const showAccentPicker = isAccentLanguage(language);

  function handleAdvanceHint() {
    setHintLevel((prev) => {
      if (prev >= 3) return prev;
      return ((prev + 1) as 0 | 1 | 2 | 3);
    });
  }

  function handleSubmit() {
    if (!answer.trim() || isLocked) return;
    onSubmit(answer, { hintLevel });
  }

  const canSubmit = answer.trim().length > 0;

  return (
    <div className="flex flex-col gap-s-4">
      <Card padding="lg">
        <p className="t-display-s">{content.prompt}</p>
      </Card>

      <div className="flex flex-col gap-s-3">
        <Input
          ref={inputRef}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          readOnly={isLocked}
          disabled={isLocked}
          className={isLocked ? 'opacity-60' : undefined}
        />
        {showAccentPicker && (
          <AccentPicker
            language={language}
            targetRef={inputRef}
            disabled={isLocked}
          />
        )}
      </div>

      <HintRow
        expectedWord={content.expectedWord}
        exampleSentence={content.exampleSentence}
        level={hintLevel}
        onAdvance={handleAdvanceHint}
      />

      <Button
        variant="primary"
        onClick={handleSubmit}
        disabled={!canSubmit || isLocked}
        loading={submission.kind === 'submitting'}
      >
        submit
      </Button>

      {submission.kind === 'evaluated' &&
        (() => {
          const verdict = vocabVerdict(
            submission.result.score,
            submission.result.errors ?? [],
          );
          const confusions = parseConfusions(submission.result.feedback ?? '');
          return (
            <FeedbackShell
              tier={verdict.tier}
              label={verdict.label}
              scoreChipText={`${Math.round(submission.result.score * 100)}%`}
              hintLevel={hintLevel}
              onNext={onNext}
            >
              <div className="flex flex-col gap-s-4">
                <p className="t-display-m">{content.expectedWord}</p>
                {content.exampleSentence && (
                  <p className="t-body-l">{content.exampleSentence}</p>
                )}
                {confusions.length > 0 && (
                  <div className="flex flex-col gap-s-2">
                    <p className="t-micro text-ink-mute">common confusions</p>
                    <ul className="flex flex-col gap-s-1">
                      {confusions.map(({ a, b }, idx) => (
                        <li key={idx} className="t-body">
                          {a} <span aria-hidden="true">&harr;</span> {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </FeedbackShell>
          );
        })()}
    </div>
  );
}
