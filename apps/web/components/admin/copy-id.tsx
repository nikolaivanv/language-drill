'use client';

import { useEffect, useRef, useState } from 'react';

// Compact copy-to-clipboard chip for opaque IDs (session, user, exercise,
// evaluation). Shows an 8-char prefix; the click copies the FULL id — the
// point is pasting ids into analysis tools without hand-selecting UUIDs.
// stopPropagation because several hosts are clickable table rows.
export function CopyId({ id, label }: { id: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(id);
      if (!navigator.clipboard) return; // unavailable — no false "copied"
    } catch {
      return; // denied — no false "copied"
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      title={id}
      aria-label={`copy ${label} id`}
      onClick={(e) => {
        e.stopPropagation();
        void copy();
      }}
      className="inline-flex items-center gap-s-1 whitespace-nowrap px-s-2 py-px rounded-sm bg-paper-2 text-[11px] text-ink-soft hover:text-ink"
    >
      <span>{label}</span>
      <span className="font-mono">{id.slice(0, 8)}…</span>
      {copied && <span aria-hidden="true" className="text-ok">✓</span>}
    </button>
  );
}
