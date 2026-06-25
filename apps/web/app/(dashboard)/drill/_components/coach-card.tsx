// DORMANT (2026-06): not mounted in the live drill session. The active coach nudge now lives in the per-answer feedback card (feedback-shell.tsx). Kept (with its tests) for reintroduction alongside coach-rail.tsx.
'use client';

import { useState } from 'react';
import { Card } from '../../../../components/ui';

export interface CoachCardProps {
  message: string;
  defaultExpanded?: boolean;
}

// The desktop coach rail rendered as a collapsible card at the top of the
// content on mobile. Same calm coach voice — just a card, not a side rail.
export function CoachCard({ message, defaultExpanded = true }: CoachCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <Card padding="md" className="bg-paper-2">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-s-3 text-left"
      >
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-r-pill bg-ink">
          <span className="font-display text-[15px] leading-none text-paper">
            c
          </span>
        </span>
        <span className="t-micro flex-1">coach</span>
        <span aria-hidden="true" className="text-ink-mute">
          {expanded ? '−' : '+'}
        </span>
      </button>
      {expanded && <p className="t-body mt-s-3">{message}</p>}
    </Card>
  );
}
