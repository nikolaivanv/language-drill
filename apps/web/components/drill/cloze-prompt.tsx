'use client';

import * as React from 'react';
import type { ClozeContent } from '@language-drill/shared';
import { Input } from '../ui';
import { cn } from '../../lib/cn';
import { splitClozeSentence } from '../../lib/drill/cloze-blank';

export type BlankState = 'idle' | 'filled' | 'correct' | 'wrong';

// Inline-blank colour by state. Empty reads terracotta (an open prompt), filled
// goes ink, and a graded blank fills green / terracotta in place.
export const BLANK_STATE_CLASS: Record<BlankState, string> = {
  idle: 'border-[var(--color-accent)] text-ink',
  filled: 'border-ink text-ink',
  correct:
    'border-[var(--color-ok)] text-[var(--color-ok)] bg-[var(--color-ok-soft)] rounded-t-sm',
  wrong:
    'border-[var(--color-accent)] text-[var(--color-accent-2)] bg-[var(--color-accent-soft)] rounded-t-sm',
};

export interface ClozePromptProps {
  content: ClozeContent;
  answer: string;
  onAnswerChange: (value: string) => void;
  blankState: BlankState;
  disabled: boolean;
  onEnterSubmit: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  showHelper?: boolean;
}

// Pure presentation of a cloze prompt: the grammar-point eyebrow, the hero
// sentence whose blank IS the live input, the meaning gloss, and a standalone
// field fallback when the sentence has no `___`. The consumer owns the accent
// picker, any MC options, the submit control, and the post-grade feedback.
export function ClozePrompt({
  content,
  answer,
  onAnswerChange,
  blankState,
  disabled,
  onEnterSubmit,
  inputRef,
  showHelper = false,
}: ClozePromptProps) {
  const { before, after, hasBlank } = splitClozeSentence(content.sentence);

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
      onChange={(e) => onAnswerChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onEnterSubmit();
        }
      }}
      disabled={disabled}
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

      {hasBlank && showHelper && (
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
          onChange={(e) => onAnswerChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onEnterSubmit();
            }
          }}
          readOnly={disabled}
          disabled={disabled}
          className={disabled ? 'opacity-60' : undefined}
        />
      )}
    </div>
  );
}
