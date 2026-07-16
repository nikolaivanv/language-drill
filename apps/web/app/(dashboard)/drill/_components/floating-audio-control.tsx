'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

export interface FloatingAudioControlProps {
  /** The inline player root; the control reveals once this scrolls out of view. */
  anchorRef: React.RefObject<HTMLDivElement | null>;
  playing: boolean;
  progress: number; // 0..1
  onToggle: () => void;
  onSeekBy: (deltaSec: number) => void;
  /** Hide while a bottom sheet covers the lower screen. */
  suppressed?: boolean;
}

// Progress ring geometry around the play/pause button.
const RING_R = 24;
const RING_C = 2 * Math.PI * RING_R;

export function FloatingAudioControl({
  anchorRef,
  playing,
  progress,
  onToggle,
  onSeekBy,
  suppressed = false,
}: FloatingAudioControlProps) {
  const [pastAnchor, setPastAnchor] = React.useState(false);

  // Reveal once the inline player has scrolled up out of the viewport.
  React.useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        // Reveal only when the anchor has left the TOP of the viewport (scrolled
        // past), not when it sits below an as-yet-unscrolled fold.
        setPastAnchor(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      { threshold: 0 },
    );
    io.observe(anchor);
    return () => io.disconnect();
  }, [anchorRef]);

  // Reserve scroll room only while the pill is visible, so the passage's last
  // content clears the pinned control. A short passage that never reveals the
  // pill keeps its natural height (no spurious bottom whitespace/scrollbar).
  React.useEffect(() => {
    if (!pastAnchor || suppressed) return;
    const scroller = anchorRef.current?.closest('main');
    if (!scroller) return;
    const prevPad = scroller.style.paddingBottom;
    // Base tab-bar clearance (mirrors app-shell) + room for the pill.
    scroller.style.paddingBottom = 'calc(64px + env(safe-area-inset-bottom) + 114px)';
    return () => {
      scroller.style.paddingBottom = prevPad;
    };
  }, [pastAnchor, suppressed, anchorRef]);

  if (suppressed || !pastAnchor || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="group"
      aria-label="audio controls"
      className="fixed right-[16px] z-40 flex items-center gap-[2px] rounded-pill border border-rule bg-card p-[5px]"
      style={{
        bottom: 'calc(64px + env(safe-area-inset-bottom) + 16px)',
        boxShadow: 'var(--shadow-3)',
      }}
    >
      <MiniSeekButton label="back 10 seconds" dir={-1} onClick={() => onSeekBy(-10)} />
      <button
        type="button"
        aria-label={playing ? 'pause' : 'play'}
        onClick={onToggle}
        className="relative h-[52px] w-[52px] flex-shrink-0 cursor-pointer border-none bg-transparent p-0"
      >
        <svg width="52" height="52" viewBox="0 0 52 52" className="absolute inset-0" aria-hidden>
          <circle cx="26" cy="26" r={RING_R} fill="none" stroke="var(--color-rule)" strokeWidth="3" />
          <circle
            cx="26"
            cy="26"
            r={RING_R}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - progress)}
            transform="rotate(-90 26 26)"
            style={{ transition: 'stroke-dashoffset .1s linear' }}
          />
        </svg>
        <span className="absolute left-1/2 top-1/2 flex h-[40px] w-[40px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-paper">
          {playing ? <PauseGlyph /> : <PlayGlyph />}
        </span>
      </button>
      <MiniSeekButton label="forward 10 seconds" dir={1} onClick={() => onSeekBy(10)} />
    </div>,
    document.body,
  );
}

function MiniSeekButton({
  label,
  dir,
  onClick,
}: {
  label: string;
  dir: -1 | 1;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-[44px] w-[44px] flex-shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-ink transition-colors hover:bg-paper-2"
    >
      <span className="relative inline-flex h-[26px] w-[26px] items-center justify-center">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {dir < 0 ? (
            <>
              <path d="M4 12a8 8 0 1 0 2.3-5.6" />
              <path d="M3.5 4v3.6h3.6" />
            </>
          ) : (
            <>
              <path d="M20 12a8 8 0 1 1-2.3-5.6" />
              <path d="M20.5 4v3.6h-3.6" />
            </>
          )}
        </svg>
        <span
          aria-hidden
          className="t-mono absolute left-1/2 top-[54%] -translate-x-1/2 -translate-y-1/2 text-[8px] font-semibold"
          style={{ letterSpacing: '-0.5px' }}
        >
          10
        </span>
      </span>
    </button>
  );
}

function PlayGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ marginLeft: 2 }}>
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6.5" y="5.5" width="3.6" height="13" rx="1" />
      <rect x="13.9" y="5.5" width="3.6" height="13" rx="1" />
    </svg>
  );
}
