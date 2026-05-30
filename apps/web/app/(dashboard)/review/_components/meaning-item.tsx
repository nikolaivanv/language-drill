'use client';

import * as React from 'react';
import type { ReviewItem } from '@language-drill/api-client';
import { AccentPicker, Button, Card, Input } from '../../../../components/ui';
import { letterCountLabel } from '../../../../lib/drill/syllabify';

// ---------------------------------------------------------------------------
// Meaning → production item pane (Req 6)
// ---------------------------------------------------------------------------
// Shows the card's contextual sense / definition plus POS · CEFR · frequency and
// an input for the learner to produce the target word (6.1). Grading is local
// and server-side from `stateId` (matching the input against the lemma + its
// accepted inflected forms). Progressive hints — first letter, letter count,
// blanked example — are revealed one step at a time; the level reached is passed
// as `hintsUsed` so the scheduler caps the achievable rating (0 hints → up to
// Good/Easy; 1+ → Hard) (6.3). The shared AccentPicker supplies special
// characters (6.4). "I don't know · reveal" submits an empty answer → Again.
// Feedback (the before→after) is rendered by the session page (tasks 44/45);
// this pane is presentational and locks once a submission is in flight.
//
// The "letter count" middle hint matches the shipped drill HintRow choice
// (`first letter / letter count / example`) rather than the prototype's
// "syllables", because the app has no syllabifier and an approximate one would
// mislead. The gradeable behaviour — progressive reveal capping the rating — is
// identical to the requirement's intent.
// ---------------------------------------------------------------------------

export type HintLevel = 0 | 1 | 2 | 3;

export interface MeaningItemProps {
  item: ReviewItem;
  /** Locks the input while a submission is in flight or evaluated. */
  isLocked: boolean;
  /** Disables the submit CTA while the network request is pending. */
  isSubmitting?: boolean;
  /** Submit the typed (or empty, for reveal) answer plus the hint count. */
  onSubmit: (answer: string, meta: { hintsUsed: number }) => void;
}

function isAccentLanguage(lang: string): lang is 'ES' | 'DE' | 'TR' {
  return lang === 'ES' || lang === 'DE' || lang === 'TR';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Blank every occurrence of `surface` in `sentence` for the level-3 example
// hint. The surface (the inflected form actually seen) is masked, not the
// lemma, so the slot is genuinely hidden.
export function maskSurface(sentence: string, surface: string): string {
  if (!surface) return sentence;
  return sentence.replace(new RegExp(escapeRegExp(surface), 'giu'), '___');
}

export function MeaningItem({ item, isLocked, isSubmitting, onSubmit }: MeaningItemProps) {
  const { occurrence, lemma, language, gloss, pos, cefr, freqRank } = item;
  const [answer, setAnswer] = React.useState('');
  const [hintLevel, setHintLevel] = React.useState<HintLevel>(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const showAccentPicker = isAccentLanguage(language);
  const canSubmit = answer.trim().length > 0 && !isLocked;

  // The contextual sense is the richer prompt; fall back to the dictionary gloss
  // for context-independent meaning items (no usable occurrence).
  const definition = occurrence?.contextualSense ?? gloss;
  const exampleSentence = occurrence?.sentence;
  // Level 3 (blanked example) only exists when there's a sentence to blank.
  const maxHintLevel: HintLevel = exampleSentence ? 3 : 2;

  function handleAdvanceHint() {
    setHintLevel((prev) => (prev < maxHintLevel ? ((prev + 1) as HintLevel) : prev));
  }

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit(answer, { hintsUsed: hintLevel });
  }

  // "I don't know" — submit an empty answer so the server grades it Again.
  function handleReveal() {
    if (isLocked) return;
    onSubmit('', { hintsUsed: hintLevel });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && canSubmit) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const nextHintLabel =
    hintLevel === 0
      ? 'hint · first letter'
      : hintLevel === 1
        ? 'hint · letter count'
        : 'hint · blanked example';

  return (
    <div className="flex flex-col gap-s-4">
      <div className="flex flex-col gap-s-1">
        <p className="t-micro text-ink-mute">meaning → production</p>
        <h2 className="t-display-s">what&apos;s the word that means…</h2>
      </div>

      <Card padding="lg">
        <p className="t-micro text-ink-soft mb-s-2">contextual sense · from your saved card</p>
        <p className="t-display-s leading-snug">&ldquo;{definition}&rdquo;</p>
        <p className="t-body text-ink-soft mt-s-2">
          {[pos, cefr, freqRank != null ? `freq #${freqRank}` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>

        {hintLevel >= 1 && (
          <div className="mt-s-4 pt-s-3 border-t border-dashed border-rule flex flex-col gap-s-2">
            <div className="flex items-center gap-s-3">
              <span className="t-micro text-ink-soft">first letter</span>
              <strong className="t-mono text-accent text-[20px]">
                {lemma[0]?.toLowerCase() ?? ''}
              </strong>
            </div>
            {hintLevel >= 2 && (
              <div className="flex items-center gap-s-3">
                <span className="t-micro text-ink-soft">length</span>
                <span className="t-mono text-ink-soft">{letterCountLabel(lemma)}</span>
              </div>
            )}
            {hintLevel >= 3 && exampleSentence && (
              <div className="mt-s-1 p-s-3 rounded-r-md bg-paper-2">
                <p className="t-micro text-ink-soft mb-s-1">blanked example</p>
                <p className="t-body">{maskSurface(exampleSentence, occurrence!.surface)}</p>
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="flex flex-col gap-s-3">
        <div className="t-micro text-ink-soft">your word</div>
        <Input
          ref={inputRef}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={handleKeyDown}
          readOnly={isLocked}
          disabled={isLocked}
          placeholder="produce the word…"
          aria-label="meaning answer"
          className={isLocked ? 'opacity-60' : undefined}
        />
        {showAccentPicker && (
          <AccentPicker language={language} targetRef={inputRef} disabled={isLocked} />
        )}

        <div className="flex items-center justify-between gap-s-3 flex-wrap">
          <p className="t-small text-ink-mute">
            hints taint the rating · 0 → <strong>Good/Easy</strong>, 1+ → capped at{' '}
            <strong>Hard</strong>
          </p>
          <div className="flex gap-s-2">
            <Button variant="ghost" size="sm" onClick={handleReveal} disabled={isLocked}>
              i don&apos;t know · reveal
            </Button>
            {hintLevel < maxHintLevel && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAdvanceHint}
                disabled={isLocked}
              >
                {nextHintLabel}
              </Button>
            )}
            <Button
              variant="primary"
              onClick={handleSubmit}
              disabled={!canSubmit}
              loading={isSubmitting}
            >
              check ↵
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
