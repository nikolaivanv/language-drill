'use client';

import * as React from 'react';
import type {
  EvaluationError,
  LearningLanguage,
  SentenceConstructionContent,
} from '@language-drill/shared';
import {
  AccentPicker,
  Button,
  Card,
  Textarea,
} from '../../../../components/ui';
import { useAnswerDraft } from '../../../../lib/drill/use-answer-draft';
import { submitOnModEnter } from '../../../../lib/drill/keyboard';
import { translationVerdict } from '../../../../lib/drill/verdict-tier';
import { stripInlineMarkdown } from '../../../../lib/drill/strip-inline-markdown';
import { useDrillAction } from './drill-action-context';
import { FeedbackShell, type CoachNudge } from './feedback-shell';
import type { SubmissionMeta, SubmissionState } from './types';

export type { SubmissionMeta, SubmissionState } from './types';

export interface SentenceConstructionExerciseProps {
  content: SentenceConstructionContent;
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

const SEVERITY_COLOR: Record<EvaluationError['severity'], string> = {
  minor: 'text-ok',
  major: 'text-accent-2',
};

export function SentenceConstructionExercise({
  content,
  language,
  submission,
  onSubmit,
  onNext,
  nextLabel,
  exerciseId,
  coach,
}: SentenceConstructionExerciseProps) {
  const [answer, setAnswer, clearDraft] = useAnswerDraft(exerciseId);
  const [exampleShown, setExampleShown] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const isLocked = submission.kind !== 'idle';
  const showAccentPicker = isAccentLanguage(language);
  const canSubmit = answer.trim().length > 0;

  function handleSubmit() {
    if (!canSubmit || isLocked) return;
    // Count the example reveal as one hint for honest progress weighting.
    onSubmit(answer, { hintCount: exampleShown ? 1 : 0 });
    clearDraft();
  }

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
    // handleSubmit closes over answer/exampleShown — both listed.
  }, [active, setPrimaryAction, submission.kind, canSubmit, isLocked, answer, exampleShown]);

  return (
    <div className="flex flex-col gap-s-4">
      <p className="t-micro text-ink-mute">sentence construction · {language}</p>

      {content.instructions && (
        <p className="t-small text-ink-mute">
          {stripInlineMarkdown(content.instructions)}
        </p>
      )}

      <p className="t-display-s">{stripInlineMarkdown(content.prompt)}</p>

      {content.promptMode === 'keywords' &&
        content.keywords &&
        content.keywords.length > 0 && (
          <div className="flex flex-wrap gap-s-2">
            {content.keywords.map((kw) => (
              <span
                key={kw}
                className="t-small rounded-full bg-paper-2 px-s-3 py-s-1"
              >
                {kw}
              </span>
            ))}
          </div>
        )}

      {(content.targetStructure || content.register) && (
        <p className="t-small text-ink-mute">
          {content.targetStructure
            ? `structure: ${content.targetStructure}`
            : ''}
          {content.targetStructure && content.register ? ' · ' : ''}
          {content.register ? `register: ${content.register}` : ''}
        </p>
      )}

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

      {exampleShown && (
        <p className="t-small text-ink-mute">
          e.g. {content.modelAnswers[0]}
        </p>
      )}

      {!exampleShown && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setExampleShown(true)}
          disabled={isLocked}
        >
          show an example
        </Button>
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
              hintLevel={exampleShown ? 1 : 0}
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
                            <span
                              aria-hidden="true"
                              className="text-ink-mute"
                            >
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
                  <p className="t-micro text-ink-mute">example answers</p>
                  <ul className="mt-s-1 flex flex-col gap-s-1">
                    {content.modelAnswers.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </Card>
              </div>
            </FeedbackShell>
          );
        })()}
    </div>
  );
}
