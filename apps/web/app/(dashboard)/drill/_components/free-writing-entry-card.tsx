'use client';
import * as React from 'react';
import Link from 'next/link';
import { FwIcon } from '../free-writing/_components/fw-atoms';

export function FreeWritingEntryCard() {
  return (
    <Link
      href="/drill/free-writing"
      className="mb-s-6 flex items-center gap-s-4 rounded-r-lg border border-accent bg-card p-s-5 no-underline"
    >
      <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-r-md bg-accent text-white">
        <FwIcon kind="write" size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="t-display-s">free writing</span>
          <span
            className="rounded-r-md px-2 py-0.5 text-[10px] font-semibold uppercase"
            style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent-2)' }}
          >
            new
          </span>
        </span>
        <span className="t-body block text-ink-2">
          Write a paragraph to a constrained prompt, then Claude grades it on IELTS-style criteria and marks every error in place.
        </span>
      </span>
      <span className="t-mono flex-shrink-0 text-accent-2">start →</span>
    </Link>
  );
}
