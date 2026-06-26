'use client';

import * as React from 'react';
import {
  isDictationResult,
  type DictationContent,
  type DictationResult,
  type LearningLanguage,
} from '@language-drill/shared';
import { AccentPicker, Button, Chip, Textarea } from '../../../../components/ui';
import { submitOnModEnter } from '../../../../lib/drill/keyboard';
import { dictationVerdict } from '../../../../lib/drill/verdict-tier';
import { AudioPlayer } from './audio-player';
import { DictationResultBody } from './dictation-result-body';
import { useDrillAction } from './drill-action-context';
import { FeedbackShell, type CoachNudge } from './feedback-shell';
import type { SubmissionMeta, SubmissionState } from './types';

export interface DictationExerciseProps {
  content: DictationContent;
  language: LearningLanguage;
  submission: SubmissionState;
  onSubmit: (answer: string, meta: SubmissionMeta) => void;
  onNext: () => void;
  nextLabel?: string;
  /** Coach nudge shown at the bottom of the feedback card when the current item
   *  is a known weak spot. Omit when the item is not a weak spot. */
  coach?: CoachNudge | null;
}

function isAccentLanguage(lang: string): lang is 'ES' | 'DE' | 'TR' {
  return lang === 'ES' || lang === 'DE' || lang === 'TR';
}

export function DictationExercise({
  content,
  language,
  submission,
  onSubmit,
  onNext,
  nextLabel,
  coach,
}: DictationExerciseProps) {
  const [answer, setAnswer] = React.useState('');
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const isLocked = submission.kind !== 'idle';
  const canSubmit = answer.trim().length > 0;

  function handleSubmit() {
    if (!answer.trim()) return;
    onSubmit(answer, {});
  }

  // On mobile, publish the submit CTA to the sticky action bar instead of
  // rendering it inline. Once evaluated, FeedbackShell owns the action (next).
  const { active, setPrimaryAction } = useDrillAction();
  React.useEffect(() => {
    if (!active || submission.kind === 'evaluated') return;
    setPrimaryAction({
      label: 'check',
      onClick: handleSubmit,
      variant: 'primary',
      disabled: !canSubmit || isLocked,
      loading: submission.kind === 'submitting',
    });
    // handleSubmit closes over answer — all captured deps listed.
  }, [active, setPrimaryAction, submission.kind, canSubmit, isLocked, answer]);

  return (
    <div className="flex flex-col gap-s-4">
      <div className="flex flex-col gap-s-2">
        <h2 className="t-display-s">{content.title}</h2>
        {content.blurb && <p className="t-small text-ink-mute">{content.blurb}</p>}
        <div className="flex flex-wrap items-center gap-s-2">
          <Chip>{content.accent}</Chip>
          {content.tested.map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
        </div>
      </div>

      <AudioPlayer
        src={content.audioUrl}
        waveform={content.waveform}
        durationSec={content.durationSec}
      />

      <div className="flex flex-col gap-s-3">
        <label htmlFor="dictation-answer" className="t-small text-ink-mute">
          type what you hear
        </label>
        <Textarea
          id="dictation-answer"
          ref={inputRef}
          rows={3}
          value={answer}
          spellCheck={false}
          readOnly={isLocked}
          disabled={isLocked}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={submitOnModEnter(handleSubmit)}
          placeholder="escribe la frase tal y como la oyes…"
          className={isLocked ? 'opacity-60' : undefined}
        />
        {isAccentLanguage(language) && (
          <AccentPicker language={language} targetRef={inputRef} disabled={isLocked} />
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
            check
          </Button>
        </div>
      )}

      {submission.kind === 'evaluated' &&
        isDictationResult(submission.result) && (
          <DictationResults
            result={submission.result}
            onNext={onNext}
            nextLabel={nextLabel}
            coach={coach}
          />
        )}
    </div>
  );
}

function DictationResults({
  result,
  onNext,
  nextLabel,
  coach,
}: {
  result: DictationResult;
  onNext: () => void;
  nextLabel?: string;
  coach?: CoachNudge | null;
}) {
  const verdict = dictationVerdict(result.score);
  return (
    <FeedbackShell
      tier={verdict.tier}
      label={result.headline}
      scoreChipText={`${Math.round(result.adjustedCharAccuracy * 100)}%`}
      coach={coach}
      onNext={onNext}
      nextLabel={nextLabel}
    >
      <DictationResultBody result={result} />
    </FeedbackShell>
  );
}
