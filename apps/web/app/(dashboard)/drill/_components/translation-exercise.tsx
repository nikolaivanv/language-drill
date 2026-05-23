'use client';

import * as React from 'react';
import type {
  EvaluationError,
  LearningLanguage,
  TranslationContent,
} from '@language-drill/shared';
import {
  AccentPicker,
  Button,
  Card,
  Textarea,
} from '../../../../components/ui';
import { translationVerdict } from '../../../../lib/drill/verdict-tier';
import { lookupGloss } from '../../../../lib/translation/gloss-en';
import { useDrillAction } from './drill-action-context';
import { FeedbackShell } from './feedback-shell';
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
}

function isAccentLanguage(lang: string): lang is 'ES' | 'DE' | 'TR' {
  return lang === 'ES' || lang === 'DE' || lang === 'TR';
}

/**
 * Find the first whitespace-separated source token that has a gloss entry.
 * Returns the lemma (cleaned) and gloss text, or null if none found.
 */
function firstGloss(
  sourceText: string,
): { lemma: string; gloss: string } | null {
  const tokens = sourceText.split(/\s+/);
  for (const raw of tokens) {
    const entry = lookupGloss(raw);
    if (entry) {
      const lemma = raw.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
      return { lemma, gloss: entry.gloss };
    }
  }
  return null;
}

/**
 * Slice the reference translation at the nearest whitespace boundary to
 * the midpoint, suffixed with an ellipsis.
 */
function halfReference(text: string): string {
  if (text.length === 0) return '…';
  const mid = Math.ceil(text.length / 2);
  // Look for whitespace at or after mid first; fall back to before.
  let cut = text.indexOf(' ', mid);
  if (cut === -1) {
    cut = text.lastIndexOf(' ', mid);
  }
  if (cut === -1) {
    cut = mid;
  }
  return `${text.slice(0, cut)}…`;
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
}: TranslationExerciseProps) {
  const [answer, setAnswer] = React.useState('');
  const [hintCount, setHintCount] = React.useState<0 | 1 | 2 | 3>(0);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const isLocked = submission.kind !== 'idle';
  const showAccentPicker = isAccentLanguage(language);

  const gloss = React.useMemo(
    () => firstGloss(content.sourceText),
    [content.sourceText],
  );
  const halfRef = React.useMemo(
    () => halfReference(content.referenceTranslation),
    [content.referenceTranslation],
  );

  function handleHint() {
    setHintCount((prev) => {
      if (prev >= 3) return prev;
      return ((prev + 1) as 0 | 1 | 2 | 3);
    });
  }

  function handleSubmit() {
    if (!answer.trim() || isLocked) return;
    onSubmit(answer, { hintCount });
  }

  const canSubmit = answer.trim().length > 0;

  // On mobile, publish the submit CTA to the sticky action bar; the "show me a
  // hint" control stays inline in the body. FeedbackShell owns the next action.
  const { active, setPrimaryAction } = useDrillAction();
  React.useEffect(() => {
    if (!active || submission.kind === 'evaluated') return;
    setPrimaryAction({
      label: 'submit',
      onClick: handleSubmit,
      disabled: !canSubmit || isLocked,
      loading: submission.kind === 'submitting',
    });
    // handleSubmit closes over answer/hintCount — both listed.
  }, [active, setPrimaryAction, submission.kind, canSubmit, isLocked, answer, hintCount]);

  return (
    <div className="flex flex-col gap-s-4">
      <p className="t-micro text-ink-mute">EN &rarr; {language}</p>

      <p className="t-display-s">
        <GlossedText text={content.sourceText} />
      </p>

      <div className="flex flex-col gap-s-3">
        <Textarea
          ref={textareaRef}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
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

      {hintCount > 0 && (
        <div className="flex flex-col gap-s-2">
          {hintCount >= 1 && gloss && (
            <p className="t-small text-ink-mute">
              {gloss.lemma} &mdash; {gloss.gloss}
            </p>
          )}
          {(hintCount >= 2 || (hintCount >= 1 && !gloss)) && (
            <p className="t-small text-ink-mute">{halfRef}</p>
          )}
          {hintCount >= 3 && (
            <p className="t-small text-ink-mute">
              {content.referenceTranslation}
            </p>
          )}
        </div>
      )}

      <div className="flex gap-s-3">
        {hintCount < 3 && (
          <Button
            variant="ghost"
            onClick={handleHint}
            disabled={isLocked}
          >
            show me a hint
          </Button>
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
      </div>

      {submission.kind === 'evaluated' &&
        (() => {
          const verdict = translationVerdict(submission.result.score);
          const errors = submission.result.errors ?? [];
          return (
            <FeedbackShell
              tier={verdict.tier}
              label={verdict.label}
              scoreChipText={`${Math.round(submission.result.score * 100)}%`}
              hintLevel={hintCount}
              onNext={onNext}
              nextLabel={nextLabel}
            >
              <div className="flex flex-col gap-s-4">
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
