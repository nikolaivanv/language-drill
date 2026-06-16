'use client';

import * as React from 'react';
import { useIsMobile } from '../../../../lib/responsive';
import { LoadingSkeleton } from './loading-skeleton';

export interface DrillLayoutProps {
  rail: React.ReactNode;
  main: React.ReactNode;
  /** Sticky action-bar slot rendered at the bottom on mobile only. */
  actionBar?: React.ReactNode;
  progressFraction?: number;
  isLoading?: boolean;
}

export function DrillLayout({
  rail,
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

  // Mobile: single column, no side rail; the coach card + dots live in `main`
  // (composed by the page) and the sticky action bar sits at the bottom.
  if (isMobile) {
    return (
      <div className="flex flex-col">
        {progressStrip}
        <div className="pt-s-4">{isLoading ? <LoadingSkeleton /> : main}</div>
        {actionBar}
      </div>
    );
  }

  // Desktop: the coach rail + content grid. The previous 900px breakpoint is
  // reconciled to the canonical 760 seam above (Deliberate Deviation).
  return (
    <div className="grid grid-cols-[280px_1fr]">
      <aside className="bg-paper-2 border-r border-rule p-s-6">{rail}</aside>

      <div className="flex flex-col">
        {progressStrip}
        {/* Content column caps at 760px and centers — text never runs
            full-bleed on wide screens (DRILL-UI-GUIDELINES §3). */}
        <div className="mx-auto w-full max-w-[760px] p-s-6">
          {isLoading ? <LoadingSkeleton /> : main}
        </div>
      </div>
    </div>
  );
}
