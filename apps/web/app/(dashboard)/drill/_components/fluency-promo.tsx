'use client';

import Link from 'next/link';

/**
 * Cross-sell to fluency mode. Per DRILL-UI-GUIDELINES §5 the promo never sits
 * in the task flow — it's demoted to the coach rail (desktop) or the bottom of
 * the scroll (mobile). Presentational; the caller owns placement.
 */
export function FluencyPromo({ className }: { className?: string }) {
  return (
    <div
      className={`rounded-r-md border border-dashed border-rule px-s-4 py-s-3 ${className ?? ''}`}
    >
      <p className="t-micro mb-s-1 text-accent-2">try next</p>
      <Link
        href="/fluency"
        className="t-small leading-snug text-ink-2 no-underline hover:text-accent-2"
      >
        fluency mode — timed drills on what you already know →
      </Link>
    </div>
  );
}
