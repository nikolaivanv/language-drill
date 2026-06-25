'use client';

import * as React from 'react';
import type { LearningLanguage, VocabRecallContent } from '@language-drill/shared';
import { AccentPicker, Button, Input } from '../../../../components/ui';
import { VocabPromptCard } from '../../../../components/drill/vocab-prompt';
import { parseConfusions } from '../../../../lib/drill/parse-confusions';
import { useAnswerDraft } from '../../../../lib/drill/use-answer-draft';
import { submitOnEnter } from '../../../../lib/drill/keyboard';
import { vocabVerdict } from '../../../../lib/drill/verdict-tier';
import { useDrillAction } from './drill-action-context';
import { FeedbackShell, type CoachNudge } from './feedback-shell';
import { HintRow } from './hint-row';
import type { SubmissionMeta, SubmissionState } from './types';

export type { SubmissionMeta, SubmissionState } from './types';

export interface VocabExerciseProps {
  content: VocabRecallContent;
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

export function VocabExercise({
  content,
  language,
  submission,
  onSubmit,
  onNext,
  nextLabel,
  exerciseId,
  coach,
}: VocabExerciseProps) {
  const [answer, setAnswer, clearDraft] = useAnswerDraft(exerciseId);
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
      variant: 'primary',
      disabled: !canSubmit || isLocked,
      loading: submission.kind === 'submitting',
    });
    // handleSubmit closes over answer/hintLevel — both listed.
  }, [active, setPrimaryAction, submission.kind, canSubmit, isLocked, answer, hintLevel]);

  return (
    <div className="flex flex-col gap-s-4">
      <VocabPromptCard content={content} />

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

      <HintRow
        expectedWord={content.expectedWord}
        exampleSentence={content.exampleSentence}
        level={hintLevel}
        onAdvance={handleAdvanceHint}
      />

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
              coach={coach}
              onNext={onNext}
              nextLabel={nextLabel}
            >
              <div className="flex flex-col gap-s-4">
                <p className="t-display-m">{content.expectedWord}</p>
                {content.exampleSentence && (
                  <p className="t-body-l">{content.exampleSentence}</p>
                )}
                {submission.result.feedback && (
                  <p className="t-body">{submission.result.feedback}</p>
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
