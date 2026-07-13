'use client';

import * as React from 'react';
import type {
  EvaluationError,
  LearningLanguage,
  TranslationContent,
  WordHintUnit,
} from '@language-drill/shared';
import { useWordHints, type AuthenticatedFetch } from '@language-drill/api-client';
import {
  AccentPicker,
  Button,
  Card,
  Textarea,
} from '../../../../components/ui';
import { useAnswerDraft } from '../../../../lib/drill/use-answer-draft';
import { submitOnModEnter } from '../../../../lib/drill/keyboard';
import { translationVerdict } from '../../../../lib/drill/verdict-tier';
import { useDrillAction } from './drill-action-context';
import { FeedbackShell, type CoachNudge } from './feedback-shell';
import { GlossedText } from './glossed-text';
import type { SubmissionMeta, SubmissionState } from './types';

export type { SubmissionMeta, SubmissionState } from './types';

export interface TranslationExerciseProps {
  content: TranslationContent;
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
  /** Authenticated fetch, used to lazily fetch the per-word hint map when the
   *  learner opts into "need a hint". Omitted in tests/contexts that don't
   *  need it (the mutation throws if invoked without one). */
  fetchFn?: AuthenticatedFetch;
}

function isAccentLanguage(lang: string): lang is 'ES' | 'DE' | 'TR' {
  return lang === 'ES' || lang === 'DE' || lang === 'TR';
}

const SEVERITY_COLOR: Record<EvaluationError['severity'], string> = {
  minor: 'text-ok',
  major: 'text-accent-2',
};

export function TranslationExercise({
  content,
  language,
  submission,
  onSubmit,
  onNext,
  nextLabel,
  exerciseId,
  coach,
  fetchFn,
}: TranslationExerciseProps) {
  const [answer, setAnswer, clearDraft] = useAnswerDraft(exerciseId);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const isLocked = submission.kind !== 'idle';
  const showAccentPicker = isAccentLanguage(language);

  const wordHints = useWordHints({
    fetchFn:
      fetchFn ??
      (async () => {
        throw new Error('no fetchFn');
      }),
  });
  const [hintsOpen, setHintsOpen] = React.useState(false);
  const [revealed, setRevealed] = React.useState<Set<number>>(new Set());
  const [fullAnswerShown, setFullAnswerShown] = React.useState(false);

  function openHints() {
    setHintsOpen(true);
    if (!wordHints.data && !wordHints.isPending && exerciseId) {
      wordHints.mutate({ exerciseId });
    }
  }
  function revealUnit(idx: number) {
    setRevealed((prev) => new Set(prev).add(idx));
  }

  function handleSubmit() {
    if (!answer.trim() || isLocked) return;
    onSubmit(answer, {
      hintUsage: { wordsRevealed: revealed.size, fullAnswerRevealed: fullAnswerShown },
    });
    clearDraft();
  }

  const canSubmit = answer.trim().length > 0;

  // On mobile, publish the submit CTA to the sticky action bar; the "need a
  // hint" control stays inline in the body. FeedbackShell owns the next action.
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
    // handleSubmit closes over answer/revealed/fullAnswerShown — all listed.
  }, [
    active,
    setPrimaryAction,
    submission.kind,
    canSubmit,
    isLocked,
    answer,
    revealed,
    fullAnswerShown,
  ]);

  return (
    <div className="flex flex-col gap-s-4">
      {/* level 1 — direction + topic as a quiet eyebrow tag */}
      <span className="inline-flex items-center gap-s-2">
        <span
          aria-hidden="true"
          className="inline-block h-[5px] w-[5px] rounded-full bg-[var(--color-accent)]"
        />
        <span className="t-micro text-ink-mute">
          EN &rarr; {language}
          {content.topicHint && content.topicHint.length > 0
            ? ` · ${content.topicHint}`
            : ''}
        </span>
      </span>

      {/* level 2 (hero) — the source sentence */}
      <p className="t-display-m">
        <GlossedText text={content.sourceText} />
      </p>

      {/* level 3 — goal gloss, clearly secondary */}
      <p className="t-body text-ink-soft">
        <span className="t-micro text-ink-mute mr-s-2">goal</span>
        translate the meaning, not every word.
      </p>

      <div className="flex flex-col gap-s-3">
        <Textarea
          ref={textareaRef}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={submitOnModEnter(handleSubmit)}
          readOnly={isLocked}
          disabled={isLocked}
          className={isLocked ? 'opacity-60' : undefined}
        />
        {showAccentPicker && (
          <AccentPicker
            language={language}
            targetRef={textareaRef}
            disabled={isLocked}
          />
        )}
      </div>

      {!hintsOpen && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={openHints}
          disabled={isLocked}
        >
          need a hint
        </Button>
      )}

      {hintsOpen && (
        <div className="flex flex-col gap-s-3">
          {wordHints.isPending && (
            <p className="t-small text-ink-mute">loading hints&hellip;</p>
          )}
          {wordHints.isError && (
            <div className="flex flex-wrap items-center gap-s-2">
              <p className="t-small text-accent-2">couldn&rsquo;t load hints</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (exerciseId && !wordHints.isPending) {
                    wordHints.mutate({ exerciseId });
                  }
                }}
                disabled={isLocked || wordHints.isPending}
              >
                try again
              </Button>
            </div>
          )}
          {wordHints.data && (
            <>
              <p className="t-small text-ink-mute">
                tap a word to reveal its dictionary form
              </p>
              <p className="t-body">
                {wordHints.data.units.map((u: WordHintUnit, i: number) => {
                  const space = i > 0 ? ' ' : '';
                  if (!u.hintable) {
                    return (
                      <span key={i} className="text-ink-mute">
                        {space}
                        {u.text}
                      </span>
                    );
                  }
                  return (
                    <React.Fragment key={i}>
                      {space}
                      <button
                        type="button"
                        aria-label={u.text}
                        onClick={() => revealUnit(i)}
                        className="rounded-sm px-[2px] underline decoration-dotted underline-offset-2 hover:bg-[var(--color-hilite-soft)]"
                      >
                        {u.text}
                      </button>
                    </React.Fragment>
                  );
                })}
              </p>
              {revealed.size > 0 && (
                <ul className="flex flex-col gap-s-1">
                  {[...revealed]
                    .sort((a, b) => a - b)
                    .map((i) => (
                      <li key={i} className="t-small">
                        <span className="text-ink-mute">
                          {wordHints.data!.units[i].text} &rarr;{' '}
                        </span>
                        <span className="text-ink">
                          {wordHints.data!.units[i].lemma}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {/* full-answer give-up exit — always available, independent of word-hint mode */}
      {!fullAnswerShown ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setFullAnswerShown(true)}
          disabled={isLocked}
        >
          reveal full answer
        </Button>
      ) : (
        <p className="t-small text-ink-mute">{content.referenceTranslation}</p>
      )}

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
          const verdict = translationVerdict(submission.result.score);
          const errors = submission.result.errors ?? [];
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
                {submission.result.feedback && (
                  <p className="t-body">{submission.result.feedback}</p>
                )}
                {errors.length > 0 && (
                  <ul className="flex flex-col gap-s-3">
                    {errors.map((err, idx) => {
                      if (
                        !err ||
                        typeof err.text !== 'string' ||
                        typeof err.correction !== 'string' ||
                        (err.severity !== 'minor' && err.severity !== 'major')
                      ) {
                        return null;
                      }
                      return (
                        <li key={idx} className="flex flex-col gap-s-1">
                          <div className="flex flex-wrap items-baseline gap-s-2">
                            <span className="line-through text-ink-mute">
                              {err.text}
                            </span>
                            <span aria-hidden="true" className="text-ink-mute">
                              &rarr;
                            </span>
                            <span className={SEVERITY_COLOR[err.severity]}>
                              {err.correction}
                            </span>
                          </div>
                          {err.explanation && (
                            <p className="t-small text-ink-mute">
                              {err.explanation}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <Card padding="md" className="bg-paper-2">
                  <p className="t-micro text-ink-mute">the version we coded</p>
                  <p className="mt-s-1">{content.referenceTranslation}</p>
                </Card>
              </div>
            </FeedbackShell>
          );
        })()}
    </div>
  );
}
