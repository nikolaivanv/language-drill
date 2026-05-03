'use client';

import * as React from 'react';
import { Button, Card, Chip } from '../../../../components/ui';
import { cn } from '../../../../lib/cn';
import type { VerdictTier } from '../../../../lib/drill/verdict-tier';

export interface FeedbackShellProps {
  tier: VerdictTier;
  label: string;
  scoreChipText: string;
  scaffolded?: boolean;
  hintLevel?: 0 | 1 | 2 | 3;
  children: React.ReactNode;
  onNext: () => void;
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
}: FeedbackShellProps) {
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
      <div className="mt-s-6 flex justify-end">
        <Button variant="accent" onClick={onNext}>
          next
        </Button>
      </div>
    </Card>
  );
}
