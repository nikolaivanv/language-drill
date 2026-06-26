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

/**
 * Slice the reference at the nearest whitespace boundary to the midpoint,
 * suffixed with an ellipsis — the first, gentler hint level (mirrors the
 * translation exercise's `halfReference`).
 */
function halfReference(text: string): string {
  if (text.length === 0) return '…';
  const mid = Math.ceil(text.length / 2);
  let cut = text.indexOf(' ', mid);
  if (cut === -1) cut = text.lastIndexOf(' ', mid);
  if (cut === -1) cut = mid;
  return `${text.slice(0, cut)}…`;
}

// Dictation transcribes a whole sentence, so the hint escalates over the
// reference text itself: level 1 reveals the first half, level 2 the full line.
const MAX_HINT_LEVEL = 2;

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
  const [hintCount, setHintCount] = React.useState<0 | 1 | 2>(0);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const isLocked = submission.kind !== 'idle';
  const canSubmit = answer.trim().length > 0;

  const halfRef = React.useMemo(
    () => halfReference(content.referenceText),
    [content.referenceText],
  );

  function handleHint() {
    setHintCount((prev) =>
      prev >= MAX_HINT_LEVEL ? prev : ((prev + 1) as 0 | 1 | 2),
    );
  }

  function handleSubmit() {
    if (!answer.trim()) return;
    onSubmit(answer, { hintCount });
  }

  // On mobile, publish the submit CTA to the sticky action bar instead of
  // rendering it inline; the "show me a hint" control stays inline in the body.
  // Once evaluated, FeedbackShell owns the action (next).
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
    // handleSubmit closes over answer + hintCount — all captured deps listed.
  }, [active, setPrimaryAction, submission.kind, canSubmit, isLocked, answer, hintCount]);

  return (
    <div className="flex flex-col gap-s-5">
      <div className="flex flex-col gap-s-3">
        <h2 className="t-display-l">{content.title}</h2>
        {content.blurb && (
          <p className="t-body-l text-ink-soft">{content.blurb}</p>
        )}
        <div className="flex flex-wrap items-center gap-s-2">
          <Chip className="text-ink-mute">{content.accent}</Chip>
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
        <label htmlFor="dictation-answer" className="t-body text-ink-soft">
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
          // The dictation field is the page's writing surface — set it in the
          // display serif at a larger size (the prototype's transcription look).
          style={{ fontFamily: 'var(--font-display)', fontSize: 22, lineHeight: 1.5 }}
          className={isLocked ? 'opacity-60' : undefined}
        />
        {isAccentLanguage(language) && (
          <AccentPicker language={language} targetRef={inputRef} disabled={isLocked} />
        )}
      </div>

      {hintCount > 0 && (
        <p className="t-small text-ink-mute">
          {hintCount >= MAX_HINT_LEVEL ? content.referenceText : halfRef}
        </p>
      )}

      {!isLocked && hintCount < MAX_HINT_LEVEL && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={handleHint}
          disabled={isLocked}
        >
          show me a hint
        </Button>
      )}

      {!active && submission.kind !== 'evaluated' && (
        <div className="mt-s-4 flex justify-end">
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
            hintLevel={hintCount}
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
  hintLevel,
}: {
  result: DictationResult;
  onNext: () => void;
  nextLabel?: string;
  coach?: CoachNudge | null;
  hintLevel?: 0 | 1 | 2;
}) {
  const verdict = dictationVerdict(result.score);
  return (
    <FeedbackShell
      tier={verdict.tier}
      label={result.headline}
      scoreChipText={`${Math.round(result.adjustedCharAccuracy * 100)}%`}
      hintLevel={hintLevel}
      coach={coach}
      onNext={onNext}
      nextLabel={nextLabel}
    >
      <DictationResultBody result={result} />
    </FeedbackShell>
  );
}
