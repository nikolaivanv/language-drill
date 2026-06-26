'use client';

import * as React from 'react';
import type { ClozeContent, LearningLanguage } from '@language-drill/shared';
import { AccentPicker, Button } from '../../../../components/ui';
import { cn } from '../../../../lib/cn';
import { useAnswerDraft } from '../../../../lib/drill/use-answer-draft';
import { clozeVerdict } from '../../../../lib/drill/verdict-tier';
import { ClozePrompt, type BlankState } from '../../../../components/drill/cloze-prompt';
import { useDrillAction } from './drill-action-context';
import { FeedbackShell, type CoachNudge } from './feedback-shell';
import type { SubmissionMeta, SubmissionState } from './types';

export type { SubmissionMeta, SubmissionState } from './types';

export interface ClozeExerciseProps {
  content: ClozeContent;
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

export function ClozeExercise({
  content,
  language,
  submission,
  onSubmit,
  onNext,
  nextLabel,
  exerciseId,
  coach,
}: ClozeExerciseProps) {
  const [answer, setAnswer, clearDraft] = useAnswerDraft(exerciseId);
  const [usedMc, setUsedMc] = React.useState(false);
  const [showOptions, setShowOptions] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hasOptions =
    Array.isArray(content.options) && content.options.length >= 2;
  const isLocked = submission.kind !== 'idle';
  const showAccentPicker = isAccentLanguage(language);

  const canSubmit = answer.trim().length > 0;

  function handleSubmit() {
    if (!answer.trim() || isLocked) return;
    onSubmit(answer, { usedMc });
    clearDraft();
  }

  // Revealing the option set is itself the scaffold — seeing the candidate
  // answers lowers the production demand, so we flag usedMc the moment they
  // open (whether or not a chip is ultimately clicked).
  function revealOptions() {
    setShowOptions(true);
    setUsedMc(true);
  }

  function pickOption(opt: string) {
    setAnswer(opt);
    setUsedMc(true);
    inputRef.current?.focus();
  }

  // On mobile, publish the submit CTA to the sticky action bar instead of
  // rendering it inline. Once evaluated, FeedbackShell owns the action (next).
  const { active, setPrimaryAction } = useDrillAction();
  React.useEffect(() => {
    if (!active || submission.kind === 'evaluated') return;
    setPrimaryAction({
      label: 'submit',
      onClick: handleSubmit,
      variant: 'primary',
      disabled: !canSubmit || isLocked,
      loading: submission.kind === 'submitting',
    });
    // handleSubmit closes over answer/usedMc — both listed.
  }, [active, setPrimaryAction, submission.kind, canSubmit, isLocked, answer, usedMc]);

  const blankState: BlankState =
    submission.kind === 'evaluated'
      ? submission.result.score >= 0.5
        ? 'correct'
        : 'wrong'
      : answer.trim().length > 0
        ? 'filled'
        : 'idle';

  return (
    <div className="flex flex-col gap-s-4">
      <ClozePrompt
        content={content}
        answer={answer}
        onAnswerChange={setAnswer}
        blankState={blankState}
        disabled={isLocked}
        onEnterSubmit={handleSubmit}
        inputRef={inputRef}
      />

      <div className="flex flex-col gap-s-3">
        {showAccentPicker && (
          <AccentPicker
            language={language}
            targetRef={inputRef}
            disabled={isLocked}
          />
        )}

        {hasOptions && showOptions && !isLocked && (
          <div className="flex flex-wrap gap-s-2 mobile:flex-col">
            {content.options?.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => pickOption(opt)}
                className={cn(
                  'rounded-full border px-s-4 py-s-2 font-mono text-ink transition-colors',
                  answer === opt
                    ? 'border-ink bg-paper-2'
                    : 'border-rule bg-card hover:border-ink',
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {hasOptions && !isLocked && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => (showOptions ? setShowOptions(false) : revealOptions())}
          >
            {showOptions ? 'hide answer options' : 'show answer options'}
          </Button>
        )}
      </div>

      {!active && submission.kind !== 'evaluated' && (
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
          const verdict = clozeVerdict(submission.result.score);
          const alsoAccepted = (content.acceptableAnswers ?? []).filter(
            (a) =>
              a.trim().toLowerCase() !==
              content.correctAnswer.trim().toLowerCase(),
          );
          return (
            <FeedbackShell
              tier={verdict.tier}
              label={verdict.label}
              scoreChipText={`${Math.round(submission.result.score * 100)}%`}
              scaffolded={usedMc}
              coach={coach}
              onNext={onNext}
              nextLabel={nextLabel}
            >
              <div className="flex flex-col gap-s-4">
                <div className="flex flex-col gap-s-1">
                  <p className="t-micro text-ink-mute">correct answer</p>
                  <p className="t-display-m">{content.correctAnswer}</p>
                  {alsoAccepted.length > 0 && (
                    <p className="t-small text-ink-mute">
                      also accepted: {alsoAccepted.join(', ')}
                    </p>
                  )}
                </div>
                <p className="t-body">{submission.result.feedback}</p>
              </div>
            </FeedbackShell>
          );
        })()}
    </div>
  );
}
