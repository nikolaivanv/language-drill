'use client';

// ---------------------------------------------------------------------------
// IdeaCards — shared idea/popular-start component
// ---------------------------------------------------------------------------
// Two variants:
//   card  — 2-col grid of large bordered cards (empty state "POPULAR STARTS")
//   chip  — flex-wrap row of compact pills (composer "start from an idea")
//
// Each button has aria-pressed reflecting whether that idea is currently
// selected (its prompt matches `selectedPrompt`).
// ---------------------------------------------------------------------------

import type { ReadingIdea } from '@language-drill/shared';
import { cn } from '../../../../lib/cn';

type Props = {
  ideas: readonly ReadingIdea[];
  selectedPrompt?: string | null;
  onPick: (idea: ReadingIdea) => void;
  variant: 'card' | 'chip';
  disabled?: boolean;
};

export function IdeaCards({ ideas, selectedPrompt, onPick, variant, disabled }: Props) {
  if (variant === 'chip') {
    return (
      <div className="flex flex-wrap gap-[8px]">
        {ideas.map((idea) => {
          const isSelected = selectedPrompt === idea.prompt;
          return (
            <button
              key={idea.prompt}
              type="button"
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => onPick(idea)}
              className={cn(
                'inline-flex items-center gap-[4px] rounded-r-pill border px-[10px] py-[4px] text-[12px] transition-colors',
                isSelected
                  ? 'border-ink bg-ink text-paper'
                  : 'border-rule bg-transparent text-ink hover:bg-paper-2',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <span className="t-micro text-accent">{idea.category.toUpperCase()}</span>
              <span>{idea.prompt}</span>
            </button>
          );
        })}
      </div>
    );
  }

  // card variant
  return (
    <div className="grid grid-cols-2 gap-[12px] mobile:grid-cols-1">
      {ideas.map((idea) => {
        const isSelected = selectedPrompt === idea.prompt;
        return (
          <button
            key={idea.prompt}
            type="button"
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => onPick(idea)}
            className={cn(
              'p-s-4 rounded-r-md border text-left transition-colors',
              isSelected
                ? 'border-ink bg-ink text-paper'
                : 'border-rule bg-card hover:bg-paper-2',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <div className="t-micro text-accent mb-[4px]">
              {idea.category.toUpperCase()}
            </div>
            <div className={cn('t-body', isSelected ? 'text-paper' : 'text-ink')}>
              {idea.prompt}
            </div>
            <div className={cn('t-mono mt-[4px] text-[12px]', isSelected ? 'text-paper/70' : 'text-ink-mute')}>
              {idea.descriptor}
            </div>
          </button>
        );
      })}
    </div>
  );
}
