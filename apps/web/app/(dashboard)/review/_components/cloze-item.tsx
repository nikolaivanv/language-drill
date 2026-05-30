'use client';

import * as React from 'react';
import type { ReviewItem } from '@language-drill/api-client';
import { AccentPicker, Button, Card, Chip, Input } from '../../../../components/ui';

// ---------------------------------------------------------------------------
// Cloze-in-context item pane (Req 5)
// ---------------------------------------------------------------------------
// Renders one of the lemma's saved source sentences with the target surface
// blanked, plus its translation and source attribution (5.1), and an input for
// the inflected form graded server-side from `stateId` (5.2). For
// morphologically rich occurrences it can reveal the slot's morphology
// breakdown as an optional hint (5.3); viewing it counts as a hint so the
// scheduler caps a correct answer at Good. "I don't know · reveal" submits an
// empty answer, which grades `incorrect → Again` (5.4). Grading + the
// before→after feedback live in the session page / ReviewFeedback (tasks 44/45);
// this pane is presentational and locks once a submission is in flight.
// ---------------------------------------------------------------------------

export interface ClozeItemProps {
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

// Split `sentence` around the first occurrence of `surface` so the slot can be
// blanked. The saved surface is normally verbatim, but sentence-initial casing
// can differ, so we fall back to a case-insensitive match. `found: false` lets
// the caller render the whole sentence rather than a broken blank.
export function blankSentence(
  sentence: string,
  surface: string,
): { before: string; after: string; found: boolean } {
  let idx = sentence.indexOf(surface);
  if (idx === -1) {
    idx = sentence.toLowerCase().indexOf(surface.toLowerCase());
  }
  if (idx === -1) {
    return { before: sentence, after: '', found: false };
  }
  return {
    before: sentence.slice(0, idx),
    after: sentence.slice(idx + surface.length),
    found: true,
  };
}

export function ClozeItem({ item, isLocked, isSubmitting, onSubmit }: ClozeItemProps) {
  const { occurrence, lemma, language } = item;
  const [answer, setAnswer] = React.useState('');
  const [showMorph, setShowMorph] = React.useState(false);
  // Sticky: once the morphology hint is revealed it counts against the rating
  // cap for the rest of this item, even if the learner hides it again.
  const [hintUsed, setHintUsed] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const showAccentPicker = isAccentLanguage(language);
  const hasMorphology = Boolean(occurrence?.morphology);
  const canSubmit = answer.trim().length > 0 && !isLocked;
  const hintsUsed = hintUsed ? 1 : 0;

  function handleToggleMorph() {
    setShowMorph((prev) => {
      const next = !prev;
      if (next) setHintUsed(true);
      return next;
    });
  }

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit(answer, { hintsUsed });
  }

  // "I don't know" — submit an empty answer so the server grades it Again (5.4).
  function handleReveal() {
    if (isLocked) return;
    onSubmit('', { hintsUsed });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && canSubmit) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const blanked = occurrence
    ? blankSentence(occurrence.sentence, occurrence.surface)
    : null;

  return (
    <div className="flex flex-col gap-s-4">
      <div className="flex flex-col gap-s-1">
        <p className="t-micro text-ink-mute">cloze-in-context · from your saved sentence</p>
        <h2 className="t-display-s">type the form that fits.</h2>
      </div>

      <Card padding="lg">
        {occurrence?.source && (
          <p className="t-micro text-ink-mute mb-s-2">source · {occurrence.source}</p>
        )}

        {blanked && blanked.found ? (
          <p className="t-display-s leading-relaxed">
            {blanked.before}
            <span className="inline-block min-w-[3rem] border-b border-ink mx-1 px-2 text-center align-baseline">
              {answer || ' '}
            </span>
            {blanked.after}
          </p>
        ) : (
          // No usable sentence / surface not located — degrade to a bare prompt
          // rather than emit a broken blank (design error scenario 2).
          <p className="t-display-s leading-relaxed">
            {occurrence?.sentence ?? `produce the form of "${lemma}".`}
          </p>
        )}

        {occurrence?.translation && (
          <p className="t-small italic text-ink-mute mt-s-2">{occurrence.translation}</p>
        )}

        {/* Slot hint: the lemma we track + an optional morphology breakdown. */}
        <div className="mt-s-4 pt-s-3 border-t border-dashed border-rule">
          <div className="flex items-center gap-s-2 flex-wrap">
            <span className="t-micro text-ink-soft">slot</span>
            <span className="t-small text-ink-soft">
              lemma <strong className="t-mono">{lemma}</strong>
            </span>
            <span className="flex-1" />
            {hasMorphology && (
              <Button variant="ghost" size="sm" onClick={handleToggleMorph}>
                {showMorph ? 'hide morphology' : 'show morphology'}
              </Button>
            )}
          </div>

          {showMorph && occurrence?.morphology && (
            <div className="mt-s-3 flex flex-col gap-s-2">
              <div className="flex flex-wrap items-center gap-s-1">
                <Chip variant="solid" className="font-mono">
                  {occurrence.morphology.root}
                </Chip>
                <span className="t-small text-ink-mute">{occurrence.morphology.rootGloss}</span>
                {occurrence.morphology.segments.map((seg, i) => (
                  <React.Fragment key={`${seg.morph}-${i}`}>
                    <span className="text-ink-mute">+</span>
                    <Chip variant="accent" className="font-mono">
                      {seg.morph}
                      <span className="text-ink-soft font-normal"> · {seg.function}</span>
                    </Chip>
                  </React.Fragment>
                ))}
              </div>
              <p className="t-small italic text-ink-mute">
                {occurrence.morphology.whyThisForm}
              </p>
            </div>
          )}
        </div>
      </Card>

      <div className="flex flex-col gap-s-3">
        <div className="t-micro text-ink-soft">your answer</div>
        <Input
          ref={inputRef}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={handleKeyDown}
          readOnly={isLocked}
          disabled={isLocked}
          placeholder="type the inflected form…"
          aria-label="cloze answer"
          className={isLocked ? 'font-mono opacity-60' : 'font-mono'}
        />
        {showAccentPicker && (
          <AccentPicker language={language} targetRef={inputRef} disabled={isLocked} />
        )}

        <div className="flex items-center justify-between gap-s-3 flex-wrap">
          <p className="t-small text-ink-mute">
            local-graded · exact match → <strong>Good</strong>, mismatched → <strong>Again</strong>
          </p>
          <div className="flex gap-s-2">
            <Button variant="ghost" size="sm" onClick={handleReveal} disabled={isLocked}>
              i don&apos;t know · reveal
            </Button>
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
