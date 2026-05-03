'use client';

import * as React from 'react';
import { cn } from '../../../../lib/cn';
import { LoadingSkeleton } from './loading-skeleton';

export interface DrillLayoutProps {
  rail: React.ReactNode;
  main: React.ReactNode;
  progressFraction?: number;
  isLoading?: boolean;
}

export function DrillLayout({
  rail,
  main,
  progressFraction = 0,
  isLoading = false,
}: DrillLayoutProps) {
  const clamped = Math.min(1, Math.max(0, progressFraction));
  const pct = clamped * 100;

  return (
    <div
      className={cn(
        'grid grid-cols-1',
        '[@media(min-width:900px)]:grid-cols-[280px_1fr]'
      )}
    >
      <aside className="bg-paper-2 border-r border-rule p-s-6">{rail}</aside>

      <div className="flex flex-col">
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

        <div className="p-s-6">{isLoading ? <LoadingSkeleton /> : main}</div>
      </div>
    </div>
  );
}
