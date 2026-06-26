'use client';

import * as React from 'react';
import { Button, Card, Chip } from '../../../../components/ui';
import { cn } from '../../../../lib/cn';
import type { VerdictTier } from '../../../../lib/drill/verdict-tier';
import { useAdvanceOnEnter } from '../../../../lib/drill/keyboard';
import { useDrillAction } from './drill-action-context';

export interface CoachNudge {
  /** Short label shown in the accent eyebrow (e.g. grammar-point name or error type). */
  tag: string;
  /** One-sentence nudge shown below the tag. */
  note: string;
}

export interface FeedbackShellProps {
  tier: VerdictTier;
  label: string;
  scoreChipText: string;
  scaffolded?: boolean;
  hintLevel?: 0 | 1 | 2 | 3;
  /** When provided, renders a coach nudge block at the bottom of the feedback
   *  card. Omit (or pass null/undefined) when the current item is not a weak spot. */
  coach?: CoachNudge | null;
  children: React.ReactNode;
  onNext: () => void;
  nextLabel?: string;
}

const TIER_BG: Record<VerdictTier, string> = {
  sage: 'bg-[var(--color-ok-soft)]',
  yellow: 'bg-[var(--color-hilite-soft)]',
  terracotta: 'bg-[var(--color-accent-soft)]',
};

export function FeedbackShell({
  tier,
  label,
  scoreChipText,
  scaffolded,
  hintLevel,
  coach,
  children,
  onNext,
  nextLabel = 'next',
}: FeedbackShellProps) {
  // On mobile, publish "next" to the sticky action bar and omit the inline
  // button; the cleanup clears it when the feedback unmounts (next item).
  const { active, setPrimaryAction } = useDrillAction();
  React.useEffect(() => {
    if (!active) return;
    setPrimaryAction({
      label: `${nextLabel} →`,
      onClick: onNext,
      variant: 'primary',
    });
    return () => setPrimaryAction(null);
  }, [active, nextLabel, onNext, setPrimaryAction]);

  // The feedback is the post-answer surface, so while it's shown plain Enter
  // advances to the next item — keyboard-only drilling on every viewport.
  useAdvanceOnEnter(onNext);

  return (
    <Card padding="lg" className={cn(TIER_BG[tier])}>
      <div className="flex flex-wrap items-center gap-s-3">
        <h3 className="t-display-s">{label}</h3>
        <Chip variant="solid">{scoreChipText}</Chip>
        {scaffolded === true && (
          <Chip
            className="t-micro bg-paper-3"
            aria-label="answered using multiple-choice scaffolding"
          >
            scaffolded
          </Chip>
        )}
        {hintLevel !== undefined && hintLevel > 0 && (
          <Chip className="t-micro bg-paper-3">hint level {hintLevel}</Chip>
        )}
      </div>
      <div className="mt-s-4">{children}</div>
      {coach && (
        <div className="mt-s-6 flex items-start gap-s-3 border-t border-rule pt-s-5">
          {/* Coach avatar: a terracotta pencil ("note/correction") in an
              accent-soft disc — the design system's avatar treatment
              (accent-soft fill + accent-2 mark), legible on light and dark. */}
          <span className="mt-[2px] flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
          </span>
          <div>
            {/* Raw micro utilities (not `t-micro`) so text-accent-2 applies —
                `.t-micro` is unlayered and would otherwise force ink-mute. */}
            <span className="block text-[11px] font-medium uppercase leading-[1.4] tracking-[1.2px] text-accent-2">
              {coach.tag}
            </span>
            <p className="mt-1 t-body text-ink-2">{coach.note}</p>
          </div>
        </div>
      )}
      {!active && (
        <div className="mt-s-6 flex justify-end">
          <Button variant="primary" onClick={onNext}>
            {nextLabel}
            <span aria-hidden="true">→</span>
          </Button>
        </div>
      )}
    </Card>
  );
}
