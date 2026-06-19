'use client';

import * as React from 'react';
import type { ClozeContent, LearningLanguage } from '@language-drill/shared';
import { AccentPicker, Button, Input } from '../../../../components/ui';
import { cn } from '../../../../lib/cn';
import { splitClozeSentence } from '../../../../lib/drill/cloze-blank';
import { useAnswerDraft } from '../../../../lib/drill/use-answer-draft';
import { clozeVerdict } from '../../../../lib/drill/verdict-tier';
import { useDrillAction } from './drill-action-context';
import { FeedbackShell } from './feedback-shell';
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
}

function isAccentLanguage(lang: string): lang is 'ES' | 'DE' | 'TR' {
  return lang === 'ES' || lang === 'DE' || lang === 'TR';
}

type BlankState = 'idle' | 'filled' | 'correct' | 'wrong';

// Inline-blank colour by state. Empty reads terracotta (an open prompt), filled
// goes ink, and a graded blank fills green / terracotta in place.
const BLANK_STATE_CLASS: Record<BlankState, string> = {
  idle: 'border-[var(--color-accent)] text-ink',
  filled: 'border-ink text-ink',
  correct:
    'border-[var(--color-ok)] text-[var(--color-ok)] bg-[var(--color-ok-soft)] rounded-t-sm',
  wrong:
    'border-[var(--color-accent)] text-[var(--color-accent-2)] bg-[var(--color-accent-soft)] rounded-t-sm',
};

export function ClozeExercise({
  content,
  language,
  submission,
  onSubmit,
  onNext,
  nextLabel,
  exerciseId,
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
  const { before, after, hasBlank } = splitClozeSentence(content.sentence);

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
      variant: 'accent',
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

  // The blank is the input. It lives inline in the sentence and grows with what
  // the learner types; the accent keys and option chips both write into it.
  const blankInput = (
    <input
      ref={inputRef}
      type="text"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      aria-label="fill the blank"
      data-state={blankState}
      value={answer}
      onChange={(e) => setAnswer(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSubmit();
        }
      }}
      disabled={isLocked}
      style={{ font: 'inherit', fontWeight: 600, width: `${Math.max(answer.length, 4)}ch` }}
      className={cn(
        'inline-block text-center align-baseline bg-transparent outline-none',
        'border-b-[3px] px-s-1 caret-[var(--color-accent)] disabled:cursor-default',
        BLANK_STATE_CLASS[blankState],
      )}
    />
  );

  return (
    <div className="flex flex-col gap-s-4">
      {/* level 1 — grammar point as a quiet eyebrow tag */}
      {content.context && content.context.length > 0 && (
        <span className="inline-flex items-center gap-s-2">
          <span
            aria-hidden="true"
            className="inline-block h-[5px] w-[5px] rounded-full bg-[var(--color-accent)]"
          />
          <span className="t-micro text-ink-mute">{content.context}</span>
        </span>
      )}

      {/* level 2 (hero) — the sentence; the blank is the live input */}
      <p className="t-display-m">
        {hasBlank ? (
          <>
            {before}
            {blankInput}
            {after}
          </>
        ) : (
          content.sentence
        )}
      </p>

      {hasBlank && !showOptions && !isLocked && (
        <p className="t-small text-ink-mute">type straight into the gap</p>
      )}

      {/* level 3 — meaning gloss, clearly secondary */}
      {content.glossEn && content.glossEn.length > 0 && (
        <p className="t-body text-ink-soft">
          <span className="t-micro text-ink-mute mr-s-2">meaning</span>
          {content.glossEn}
        </p>
      )}

      {/* Non-blank fallback: keep a standalone field for sentences with no gap. */}
      {!hasBlank && (
        <Input
          ref={inputRef}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          readOnly={isLocked}
          disabled={isLocked}
          className={isLocked ? 'opacity-60' : undefined}
        />
      )}

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
          <button
            type="button"
            className="t-small self-start text-ink-mute underline underline-offset-2 hover:text-ink"
            onClick={() => (showOptions ? setShowOptions(false) : revealOptions())}
          >
            {showOptions ? 'hide options' : 'show options · easier'}
          </button>
        )}
      </div>

      {!active && submission.kind !== 'evaluated' && (
        <Button
          variant="accent"
          onClick={handleSubmit}
          disabled={!canSubmit || isLocked}
          loading={submission.kind === 'submitting'}
        >
          submit
        </Button>
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
