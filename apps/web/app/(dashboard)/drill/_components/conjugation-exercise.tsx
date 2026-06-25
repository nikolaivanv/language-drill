'use client';

import * as React from 'react';
import type { ConjugationContent, LearningLanguage } from '@language-drill/shared';
import { AccentPicker, Button, Input } from '../../../../components/ui';
import { ConjugationPromptCard } from '../../../../components/drill/conjugation-prompt';
import { useAnswerDraft } from '../../../../lib/drill/use-answer-draft';
import { submitOnEnter } from '../../../../lib/drill/keyboard';
import { conjugationVerdict } from '../../../../lib/drill/verdict-tier';
import { useDrillAction } from './drill-action-context';
import { FeedbackShell, type CoachNudge } from './feedback-shell';
import type { SubmissionMeta, SubmissionState } from './types';

export type { SubmissionMeta, SubmissionState } from './types';

export interface ConjugationExerciseProps {
  content: ConjugationContent;
  language: LearningLanguage;
  submission: SubmissionState;
  onSubmit: (answer: string, meta: SubmissionMeta) => void;
  onNext: () => void;
  nextLabel?: string;
  /** When set, the typed answer is drafted in sessionStorage so it survives a
   *  full page reload. Omitted in tests/contexts that don't need persistence. */
  exerciseId?: string;
  /** Coach nudge shown at the bottom of the feedback card when the current item
   *  is a known weak spot. Omit when the item is not a weak spot. */
  coach?: CoachNudge | null;
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
  exerciseId,
  coach,
}: ConjugationExerciseProps) {
  const [answer, setAnswer, clearDraft] = useAnswerDraft(exerciseId);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isLocked = submission.kind !== 'idle';
  const showAccentPicker = isAccentLanguage(language);

  function handleSubmit() {
    if (!answer.trim() || isLocked) return;
    onSubmit(answer, {});
    clearDraft();
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
      <ConjugationPromptCard content={content} />

      <div className="flex flex-col gap-s-3">
        <Input
          ref={inputRef}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={submitOnEnter(handleSubmit)}
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
        <div className="mt-s-6 flex justify-end">
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit || isLocked}
            loading={submission.kind === 'submitting'}
          >
            submit
          </Button>
        </div>
      )}

      {submission.kind === 'evaluated' &&
        (() => {
          const verdict = conjugationVerdict(submission.result.score);
          const alsoAccepted = (content.acceptableForms ?? []).filter(
            (f) =>
              f.trim().toLowerCase() !== content.targetForm.trim().toLowerCase(),
          );
          return (
            <FeedbackShell
              tier={verdict.tier}
              label={verdict.label}
              scoreChipText={`${Math.round(submission.result.score * 100)}%`}
              coach={coach}
              onNext={onNext}
              nextLabel={nextLabel}
            >
              <div className="flex flex-col gap-s-4">
                <p className="t-display-m">{content.targetForm}</p>
                {alsoAccepted.length > 0 && (
                  <p className="t-small text-ink-mute">
                    also accepted: {alsoAccepted.join(', ')}
                  </p>
                )}
                {submission.result.feedback && (
                  <p className="t-body">{submission.result.feedback}</p>
                )}
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
