'use client';

import * as React from 'react';
import type { ClozeContent, LearningLanguage } from '@language-drill/shared';
import { AccentPicker, Button, Choice, Input } from '../../../../components/ui';
import { splitClozeSentence } from '../../../../lib/drill/cloze-blank';
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
}: ClozeExerciseProps) {
  const [mode, setMode] = React.useState<'type' | 'mc'>('type');
  const [usedMc, setUsedMc] = React.useState(false);
  const [answer, setAnswer] = React.useState('');
  const [selectedOption, setSelectedOption] = React.useState<string | null>(
    null,
  );
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hasOptions =
    Array.isArray(content.options) && content.options.length >= 2;
  const isLocked = submission.kind !== 'idle';
  const showAccentPicker = isAccentLanguage(language);

  function handleToggleMode() {
    setMode((prev) => {
      const next = prev === 'type' ? 'mc' : 'type';
      if (next === 'mc') setUsedMc(true);
      return next;
    });
  }

  const canSubmit =
    mode === 'type' ? answer.trim().length > 0 : selectedOption !== null;

  function handleSubmit() {
    const value = mode === 'mc' ? (selectedOption ?? '') : answer;
    if (!value.trim()) return;
    onSubmit(value, { usedMc });
  }

  // On mobile, publish the submit CTA to the sticky action bar instead of
  // rendering it inline. Once evaluated, FeedbackShell owns the action (next).
  const { active, setPrimaryAction } = useDrillAction();
  React.useEffect(() => {
    if (!active || submission.kind === 'evaluated') return;
    setPrimaryAction({
      label: 'submit',
      onClick: handleSubmit,
      disabled: !canSubmit || isLocked,
      loading: submission.kind === 'submitting',
    });
    // handleSubmit closes over mode/answer/selectedOption/usedMc — all listed.
  }, [
    active,
    setPrimaryAction,
    submission.kind,
    canSubmit,
    isLocked,
    mode,
    answer,
    selectedOption,
    usedMc,
  ]);

  const { before, after, hasBlank } = splitClozeSentence(content.sentence);

  return (
    <div className="flex flex-col gap-s-4">
      {content.context && content.context.length > 0 && (
        <p className="t-small text-ink-mute">{content.context}</p>
      )}

      {/* Optional L1 (English) disambiguation gloss — A1–A2 case clozes. Italic
          to read as a meaning hint, visually distinct from the `context` line. */}
      {content.glossEn && content.glossEn.length > 0 && (
        <p className="t-small italic text-ink-mute">{content.glossEn}</p>
      )}

      <p className="t-display-s">
        {hasBlank ? (
          <>
            {before}
            <span className="inline-block min-w-[2rem] border-b border-ink mx-1 px-1">
              ?
            </span>
            {after}
          </>
        ) : (
          content.sentence
        )}
      </p>

      {hasOptions && (
        <button
          type="button"
          className="t-small underline text-ink-mute hover:text-ink self-start"
          onClick={handleToggleMode}
        >
          {mode === 'type'
            ? 'show options · reduces progress signal'
            : 'type it · keeps full progress signal'}
        </button>
      )}

      {mode === 'type' ? (
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
      ) : (
        <div className="flex flex-wrap gap-s-2 mobile:flex-col">
          {content.options?.map((opt) => {
            const pill = (
              <Choice
                mode="radio"
                selected={selectedOption === opt}
                onSelect={() => setSelectedOption(opt)}
              >
                {opt}
              </Choice>
            );
            return isLocked ? (
              <div
                key={opt}
                style={{ opacity: 0.6, pointerEvents: 'none' }}
              >
                {pill}
              </div>
            ) : (
              <React.Fragment key={opt}>{pill}</React.Fragment>
            );
          })}
        </div>
      )}

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
          const verdict = clozeVerdict(submission.result.score);
          return (
            <FeedbackShell
              tier={verdict.tier}
              label={verdict.label}
              scoreChipText={`${Math.round(submission.result.score * 100)}%`}
              scaffolded={usedMc}
              onNext={onNext}
              nextLabel={nextLabel}
            >
              <p className="t-body">{submission.result.feedback}</p>
            </FeedbackShell>
          );
        })()}
    </div>
  );
}
