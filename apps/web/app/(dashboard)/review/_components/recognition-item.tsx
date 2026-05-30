'use client';

import * as React from 'react';
import type { ReviewItem } from '@language-drill/api-client';
import { Button, Card, Choice } from '../../../../components/ui';

// ---------------------------------------------------------------------------
// Recognition item pane (Req 7.1)
// ---------------------------------------------------------------------------
// The low-stakes warm-up for `new`/low-stability cards: show the word and pick
// its meaning from a few options. Cheap + local — the server grades by exact
// string-equality of the chosen gloss against the card's `gloss`, so the
// correct option MUST be `item.gloss` verbatim. The server carries no
// distractors, so they're supplied by the session page (built from sibling
// cards' glosses) and combined with the correct gloss here.
//
// Choice order is seeded by `stateId` so it's stable across re-renders (no
// reshuffle on keystroke) and deterministic for tests, while still varying per
// card so the correct slot isn't always first. No hints (warm-up) → hintsUsed
// is always 0. Feedback is owned by the session page (tasks 44/45); this pane is
// presentational and locks once a submission is in flight.
// ---------------------------------------------------------------------------

export interface RecognitionItemProps {
  item: ReviewItem;
  /** Wrong-meaning options from sibling cards; the correct gloss is added here. */
  distractors: string[];
  /** Locks the choices while a submission is in flight or evaluated. */
  isLocked: boolean;
  /** Disables the submit CTA while the network request is pending. */
  isSubmitting?: boolean;
  /** Submit the selected gloss (or '' for reveal) plus the hint count (always 0). */
  onSubmit: (answer: string, meta: { hintsUsed: number }) => void;
}

// Stable 32-bit string hash for deterministic ordering.
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Correct gloss + up to three distinct distractors, ordered deterministically
// by a `seed`-keyed hash so the correct answer isn't always first.
export function buildRecognitionChoices(
  gloss: string,
  distractors: string[],
  seed: string,
): string[] {
  const wrong: string[] = [];
  for (const d of distractors) {
    if (d !== gloss && !wrong.includes(d) && wrong.length < 3) wrong.push(d);
  }
  return [gloss, ...wrong].sort(
    (a, b) => hashString(seed + a) - hashString(seed + b),
  );
}

export function RecognitionItem({
  item,
  distractors,
  isLocked,
  isSubmitting,
  onSubmit,
}: RecognitionItemProps) {
  const { lemma, gloss, pos, cefr, stateId } = item;
  const [selected, setSelected] = React.useState<string | null>(null);

  const choices = React.useMemo(
    () => buildRecognitionChoices(gloss, distractors, stateId),
    [gloss, distractors, stateId],
  );

  const canSubmit = selected !== null && !isLocked;

  function handleSubmit() {
    if (!canSubmit || selected === null) return;
    onSubmit(selected, { hintsUsed: 0 });
  }

  // "I don't know" — submit an empty answer so the server grades it Again.
  function handleReveal() {
    if (isLocked) return;
    onSubmit('', { hintsUsed: 0 });
  }

  return (
    <div className="flex flex-col gap-s-4">
      <div className="flex flex-col gap-s-1">
        <p className="t-micro text-ink-mute">recognition · warm-up</p>
        <h2 className="t-display-s">which meaning fits?</h2>
      </div>

      <Card padding="lg">
        <p className="t-display-m">{lemma}</p>
        <p className="t-body text-ink-soft mt-s-1">
          {[pos, cefr].filter(Boolean).join(' · ')}
        </p>
      </Card>

      <div className="flex flex-col gap-s-2" role="radiogroup" aria-label="meaning options">
        {choices.map((choice) => {
          const pill = (
            <Choice
              mode="radio"
              selected={selected === choice}
              onSelect={() => setSelected(choice)}
            >
              {choice}
            </Choice>
          );
          return isLocked ? (
            <div key={choice} className="opacity-60 pointer-events-none">
              {pill}
            </div>
          ) : (
            <React.Fragment key={choice}>{pill}</React.Fragment>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-s-3 flex-wrap">
        <p className="t-small text-ink-mute">
          warm-up · recognition only · local-graded
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
  );
}
