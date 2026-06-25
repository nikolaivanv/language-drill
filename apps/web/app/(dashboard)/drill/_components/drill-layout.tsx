'use client';

import * as React from 'react';
import { useIsMobile } from '../../../../lib/responsive';
import { LoadingSkeleton } from './loading-skeleton';

export interface DrillLayoutProps {
  /**
   * @deprecated The coach rail column has been removed (2026-06). Pass null.
   * The prop is retained to avoid a breaking change in callers until they are
   * updated; the value is ignored on desktop.
   */
  rail?: React.ReactNode;
  main: React.ReactNode;
  /** Sticky action-bar slot rendered at the bottom on mobile only. */
  actionBar?: React.ReactNode;
  progressFraction?: number;
  isLoading?: boolean;
}

export function DrillLayout({
  main,
  actionBar,
  progressFraction = 0,
  isLoading = false,
}: DrillLayoutProps) {
  const isMobile = useIsMobile();
  const clamped = Math.min(1, Math.max(0, progressFraction));
  const pct = clamped * 100;

  const progressStrip = (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-[3px] w-full bg-paper-3"
    >
      <div
        className="h-full bg-accent transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );

  // Mobile: single column; the coach card + dots live in `main` (composed by
  // the page) and the sticky action bar sits at the bottom.
  if (isMobile) {
    return (
      <div className="flex flex-col">
        {progressStrip}
        <div className="pt-s-4">{isLoading ? <LoadingSkeleton /> : main}</div>
        {actionBar}
      </div>
    );
  }

  // Desktop: single content column capped at 1040px and centered. The coach
  // rail column has been removed (2026-06) — dots now render inline at the top
  // of the main column (see page.tsx) and the coach nudge will move into the
  // per-answer feedback card (Task 11).
  return (
    <div className="flex flex-col">
      {progressStrip}
      <div className="mx-auto w-full max-w-[1040px] p-s-6">
        {isLoading ? <LoadingSkeleton /> : main}
      </div>
    </div>
  );
}
