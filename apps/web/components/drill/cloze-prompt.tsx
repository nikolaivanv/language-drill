'use client';

import * as React from 'react';
import type { ClozeContent } from '@language-drill/shared';
import { Input } from '../ui';
import { cn } from '../../lib/cn';
import { splitClozeSentence } from '../../lib/drill/cloze-blank';

export type BlankState = 'idle' | 'filled' | 'correct' | 'wrong';

// Wrapper span classes for the gap + detached underline per state.
// The underline is an `after:` pseudo-element offset ~9px below the box.
export const BLANK_WRAP_CLASS: Record<BlankState, string> = {
  idle: 'after:bg-accent',
  filled: 'after:bg-accent',
  correct: 'after:bg-ok',
  wrong: 'after:bg-accent-2',
};

// Input text colour by state.
export const BLANK_STATE_CLASS: Record<BlankState, string> = {
  idle: 'text-ink',
  filled: 'text-accent-2',
  correct: 'text-ok',
  wrong: 'text-accent-2',
};

export interface ClozePromptProps {
  content: ClozeContent;
  answer: string;
  onAnswerChange: (value: string) => void;
  blankState: BlankState;
  disabled: boolean;
  onEnterSubmit: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
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
}: ClozePromptProps) {
  const { before, after, hasBlank } = splitClozeSentence(content.sentence);

  const blankInput = (
    <span
      className={cn(
        'relative inline-block align-baseline',
        // Detached underline: a 2px bar ~9px below the box bottom
        'after:absolute after:left-0 after:right-0 after:-bottom-[9px] after:h-[2px] after:rounded-[2px] after:content-[\'\']',
        BLANK_WRAP_CLASS[blankState],
      )}
    >
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
          'inline-block text-center align-baseline bg-card border border-rule rounded-r-sm shadow-1',
          'px-s-1 outline-none caret-[var(--color-accent)] disabled:cursor-default',
          BLANK_STATE_CLASS[blankState],
        )}
      />
    </span>
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
