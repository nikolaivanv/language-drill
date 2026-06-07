'use client';

// ---------------------------------------------------------------------------
// EmptyView — "nothing to read yet" landing for /read
// ---------------------------------------------------------------------------
// Shows when the user has no current text open. Presents three CTAs:
//   1. Primary: "generate a passage →" — opens the composer
//   2. Ghost: "or paste your own" — opens the paste view
//   3. Popular starts: IdeaCards grid → onPickIdea (populates the composer)
// ---------------------------------------------------------------------------

import { READING_IDEAS } from '@language-drill/shared';
import type { ReadingIdea } from '@language-drill/shared';
import { Button } from '../../../../components/ui/button';
import { IdeaCards } from './idea-cards';

type Props = {
  onGenerate: () => void;
  onPaste: () => void;
  onPickIdea: (idea: ReadingIdea) => void;
  languageLabel: string;
};

export function EmptyView({ onGenerate, onPaste, onPickIdea, languageLabel }: Props) {
  return (
    <div className="mx-auto mt-[60px] max-w-[640px] mobile:mt-[32px] mobile:max-w-none">
      {/* Eyebrow */}
      <div className="t-hand text-accent text-[26px] leading-[1.2] mb-[4px]">
        read at your level
      </div>

      {/* Title */}
      <h2 className="t-display-l my-[8px]">nothing to read yet.</h2>

      {/* Body */}
      <p className="t-body text-ink-soft mt-[16px]">
        Tell me what you&apos;re in the mood for and I&apos;ll write a passage in{' '}
        {languageLabel} at just the right difficulty — then flag the words worth
        collecting.
      </p>

      {/* CTAs */}
      <div className="mt-[32px] flex items-center gap-[12px] mobile:flex-col mobile:items-start">
        <Button variant="primary" size="lg" onClick={onGenerate}>
          generate a passage →
        </Button>
        <Button variant="ghost" size="lg" onClick={onPaste}>
          or paste your own
        </Button>
      </div>

      {/* Popular starts */}
      <div className="mt-[48px]">
        <div className="t-micro text-ink-mute mb-[12px]">POPULAR STARTS</div>
        <IdeaCards
          variant="card"
          ideas={READING_IDEAS}
          onPick={onPickIdea}
        />
      </div>
    </div>
  );
}
