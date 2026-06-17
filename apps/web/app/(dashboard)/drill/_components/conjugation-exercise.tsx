'use client';

import * as React from 'react';
import type { ConjugationContent, LearningLanguage } from '@language-drill/shared';
import { AccentPicker, Button, Card, Input } from '../../../../components/ui';
import { conjugationVerdict } from '../../../../lib/drill/verdict-tier';
import { useDrillAction } from './drill-action-context';
import { FeedbackShell } from './feedback-shell';
import type { SubmissionMeta, SubmissionState } from './types';

export type { SubmissionMeta, SubmissionState } from './types';

export interface ConjugationExerciseProps {
  content: ConjugationContent;
  language: LearningLanguage;
  submission: SubmissionState;
  onSubmit: (answer: string, meta: SubmissionMeta) => void;
  onNext: () => void;
  nextLabel?: string;
}

function isAccentLanguage(lang: string): lang is 'ES' | 'DE' | 'TR' {
  return lang === 'ES' || lang === 'DE' || lang === 'TR';
}

export function ConjugationExercise({
  content,
  language,
  submission,
  onSubmit,
  onNext,
  nextLabel,
}: ConjugationExerciseProps) {
  const [answer, setAnswer] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isLocked = submission.kind !== 'idle';
  const showAccentPicker = isAccentLanguage(language);

  function handleSubmit() {
    if (!answer.trim() || isLocked) return;
    onSubmit(answer, {});
  }

  const canSubmit = answer.trim().length > 0;

  // On mobile, publish the submit CTA to the sticky action bar instead of
  // rendering it inline. FeedbackShell owns the action once evaluated.
  const { active, setPrimaryAction } = useDrillAction();
  React.useEffect(() => {
    if (!active || submission.kind === 'evaluated') return;
    setPrimaryAction({
      label: 'submit',
      onClick: handleSubmit,
      disabled: !canSubmit || isLocked,
      loading: submission.kind === 'submitting',
    });
    // handleSubmit closes over answer — listed.
  }, [active, setPrimaryAction, submission.kind, canSubmit, isLocked, answer]);

  return (
    <div className="flex flex-col gap-s-4">
      <Card padding="lg">
        <p className="t-display-s">{content.lemma}</p>
        <p className="t-body-l text-ink-mute">{content.lemmaGloss}</p>
        <p className="t-body text-ink-mute mt-s-2">{content.featureBundle}</p>
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

      {!active && (
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={!canSubmit || isLocked}
          loading={submission.kind === 'submitting'}
        >
          submit
        </Button>
      )}

      {submission.kind === 'evaluated' &&
        (() => {
          const verdict = conjugationVerdict(submission.result.score);
          return (
            <FeedbackShell
              tier={verdict.tier}
              label={verdict.label}
              scoreChipText={`${Math.round(submission.result.score * 100)}%`}
              onNext={onNext}
              nextLabel={nextLabel}
            >
              <div className="flex flex-col gap-s-4">
                <p className="t-display-m">{content.targetForm}</p>
                <p className="t-body-l text-ink-mute">{content.breakdown}</p>
                {content.exampleSentences.length > 0 && (
                  <ul className="flex flex-col gap-s-2">
                    {content.exampleSentences.map((sentence) => (
                      <li key={sentence} className="t-body">
                        {sentence}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </FeedbackShell>
          );
        })()}
    </div>
  );
}
