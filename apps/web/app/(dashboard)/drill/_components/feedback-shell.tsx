'use client';

import * as React from 'react';
import { Button, Card, Chip } from '../../../../components/ui';
import { cn } from '../../../../lib/cn';
import type { VerdictTier } from '../../../../lib/drill/verdict-tier';
import { useDrillAction } from './drill-action-context';

export interface FeedbackShellProps {
  tier: VerdictTier;
  label: string;
  scoreChipText: string;
  scaffolded?: boolean;
  hintLevel?: 0 | 1 | 2 | 3;
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
  children,
  onNext,
  nextLabel = 'next',
}: FeedbackShellProps) {
  // On mobile, publish "next" to the sticky action bar and omit the inline
  // button; the cleanup clears it when the feedback unmounts (next item).
  const { active, setPrimaryAction } = useDrillAction();
  React.useEffect(() => {
    if (!active) return;
    setPrimaryAction({ label: nextLabel, onClick: onNext, variant: 'accent' });
    return () => setPrimaryAction(null);
  }, [active, nextLabel, onNext, setPrimaryAction]);

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
      {!active && (
        <div className="mt-s-6 flex justify-end">
          <Button variant="accent" onClick={onNext}>
            {nextLabel}
          </Button>
        </div>
      )}
    </Card>
  );
}
