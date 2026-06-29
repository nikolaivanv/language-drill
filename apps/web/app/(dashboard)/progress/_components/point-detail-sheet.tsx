'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CurriculumMapPoint } from '@language-drill/api-client';
import type { LearningLanguage } from '@language-drill/shared';
import { ExerciseType } from '@language-drill/shared';
import { Button } from '../../../../components/ui/button';
import { typeLabel } from '../../_lib/timeline-labels';
import { topicIdForGrammarPointKey } from '../../../../lib/theory-topic-map';
import { formatAgo } from '../_lib/format-ago';
import { confidenceBand } from './confidence-band';

// ---------------------------------------------------------------------------
// PointDetailSheet — right-side sheet that opens when a map cell is tapped.
// Props: the selected grammar-point, the active learning language, and a
// close callback.  Esc + scrim-click + × button + swipe-right all dismiss it.
//
// Motion: the panel slides in from the right (scrim fades in) on mount and
// slides back out on close; on touch devices a rightward swipe drags the panel
// with the finger and dismisses it past a threshold. All motion is skipped
// under `prefers-reduced-motion` (the close is then immediate).
// ---------------------------------------------------------------------------

export type PointDetailSheetProps = {
  point: CurriculumMapPoint;
  language: LearningLanguage;
  onClose: () => void;
};

// Distance the panel must be dragged before release dismisses it: 40% of the
// panel width, capped so a long panel doesn't demand an awkwardly long swipe.
function dismissThreshold(panelWidth: number): number {
  return Math.min(140, panelWidth * 0.4);
}

export function PointDetailSheet({ point, language, onClose }: PointDetailSheetProps) {
  const {
    name,
    cefrLevel,
    order,
    state,
    mastery,
    confidence,
    evidenceCount,
    errorProne,
    recentErrorCount,
    errorSample,
    prereqUnmet,
    prereqNames,
    hasTheory,
    compatibleTypes,
    lastPracticedAt,
    key,
  } = point;

  // Honour the OS "reduce motion" setting (jsdom ships no matchMedia → false).
  // Stable for the sheet's lifetime; the value can't meaningfully change while
  // a single sheet is open.
  const [reduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      !!window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  // `shown` drives the enter/exit transition (false = parked off-screen right).
  // Under reduced motion it starts visible so there is no animation.
  const [shown, setShown] = useState(reduced);
  // Live finger offset while swiping (px, ≥0). null when not dragging.
  const [drag, setDrag] = useState<number | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<number | null>(null); // latest `drag` for touch-end
  const widthRef = useRef(0); // panel width captured at touch-start
  const closingRef = useRef(false); // an exit animation is in flight
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureRef = useRef<{
    x: number;
    y: number;
    decided: boolean;
    dragging: boolean;
  } | null>(null);

  const setDragValue = useCallback((v: number | null) => {
    dragRef.current = v;
    setDrag(v);
  }, []);

  // Enter animation: park off-screen on first paint, then slide in on the next
  // frame so the browser has a "from" state to transition from.
  useEffect(() => {
    if (reduced) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [reduced]);

  // Animate out, then call onClose once the slide-out finishes (transitionend),
  // with a timer fallback. Reduced motion closes immediately.
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    if (reduced) {
      onClose();
      return;
    }
    closingRef.current = true;
    setDragValue(null);
    setShown(false);
    closeTimerRef.current = setTimeout(onClose, 360);
  }, [reduced, onClose, setDragValue]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  // Esc closes (animated)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') requestClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [requestClose]);

  // Touch-driven swipe-to-dismiss. `touch-action: pan-y` on the panel reserves
  // horizontal gestures for us while leaving vertical scrolling to the browser,
  // so we never need to call preventDefault.
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    widthRef.current = panelRef.current?.offsetWidth ?? 0;
    gestureRef.current = { x: t.clientX, y: t.clientY, decided: false, dragging: false };
  }

  function onTouchMove(e: React.TouchEvent) {
    const g = gestureRef.current;
    if (!g) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (!g.decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      g.decided = true;
      // Only a clearly-horizontal, rightward gesture becomes a dismiss drag;
      // anything else is left to the panel's vertical scroll.
      g.dragging = Math.abs(dx) > Math.abs(dy) && dx > 0;
    }
    if (g.dragging) setDragValue(Math.max(0, dx));
  }

  function onTouchEnd() {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g || !g.dragging) return;
    const offset = dragRef.current ?? 0;
    if (offset > dismissThreshold(widthRef.current || 1)) {
      requestClose();
    } else {
      setDragValue(null); // snap back to open
    }
  }

  // When the slide-out transform finishes, hand control back to the parent.
  function onPanelTransitionEnd(e: React.TransitionEvent) {
    if (
      e.target === panelRef.current &&
      e.propertyName === 'transform' &&
      closingRef.current &&
      !shown
    ) {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      onClose();
    }
  }

  // Lock background scroll while the sheet is open (it only mounts when open),
  // so the page behind the overlay doesn't scroll. Restore the prior value on
  // close so we don't clobber any other scroll management.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const lastPracticedLabel = lastPracticedAt
    ? `last practiced ${formatAgo(lastPracticedAt)}`
    : 'never practiced';

  const stateTagColor =
    state === 'not-started'
      ? 'var(--color-ink-mute)'
      : state === 'learning'
        ? 'var(--color-accent-2)'
        : 'var(--color-ok)';

  const stateDotBg =
    state === 'solid'
      ? 'var(--color-ink)'
      : state === 'learning'
        ? 'var(--color-accent)'
        : 'var(--color-paper-3)';

  const topicId = hasTheory ? topicIdForGrammarPointKey(key, language) : null;

  // Build the href for a given compatible type chip
  function chipHref(type: string): string {
    if (type === ExerciseType.CONJUGATION) {
      return `/drill/conjugation?grammarPoint=${encodeURIComponent(key)}`;
    }
    return `/drill?start=quick&grammarPoint=${encodeURIComponent(key)}&exerciseType=${type}`;
  }

  // Scrim fades with the panel, and dims proportionally as you drag it away.
  const scrimOpacity =
    drag !== null && widthRef.current > 0
      ? Math.max(0, 1 - drag / widthRef.current)
      : shown
        ? 1
        : 0;

  // Panel sits off-screen-right until shown; follows the finger while dragging.
  const panelTransform =
    drag !== null ? `translateX(${drag}px)` : shown ? 'translateX(0)' : 'translateX(100%)';

  return (
    <>
      {/* Overlay */}
      <div
        aria-hidden="true"
        onClick={requestClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 50,
          background: 'rgba(26, 22, 18, 0.42)',
          opacity: scrimOpacity,
          // Track the finger instantly while dragging; otherwise fade in/out.
          transition: drag !== null || reduced ? 'none' : 'opacity 0.2s ease',
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      />

      {/* Sheet */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTransitionEnd={onPanelTransitionEnd}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 51,
          width: 'min(520px, 94vw)',
          background: 'var(--color-paper)',
          borderLeft: '1.5px solid var(--color-rule)',
          overflowX: 'hidden',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          transform: panelTransform,
          transition:
            drag !== null || reduced
              ? 'none'
              : 'transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)',
          touchAction: 'pan-y',
          willChange: 'transform',
        }}
      >
        {/* Head */}
        <div
          style={{
            padding: '26px 30px 20px',
            borderBottom: '1px solid var(--color-rule)',
          }}
        >
          {/* State row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 10,
              flexWrap: 'wrap',
            }}
          >
            {/* State dot */}
            <span
              aria-hidden
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: stateDotBg,
                border: state === 'not-started' ? '1.5px solid var(--color-rule)' : 'none',
                flexShrink: 0,
              }}
            />
            {state !== 'not-started' && (
              <span
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: stateTagColor,
                  fontWeight: 500,
                }}
              >
                {state}
              </span>
            )}
            {errorProne && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--color-accent-2)',
                  background: 'var(--color-accent-soft)',
                  borderRadius: 4,
                  padding: '1px 5px',
                }}
              >
                ⚠ error-prone
              </span>
            )}

            {/* × close button — positioned to the right */}
            <button
              type="button"
              aria-label="close"
              onClick={requestClose}
              style={{
                marginLeft: 'auto',
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-ink-soft)',
                fontSize: 18,
              }}
            >
              ×
            </button>
          </div>

          {/* Name */}
          <h2 className="t-display-m" style={{ margin: '0 0 6px' }}>
            {name}
          </h2>

          {/* Level / order / last practiced */}
          <div
            className="t-mono"
            style={{ color: 'var(--color-ink-soft)', fontSize: 12 }}
          >
            {cefrLevel} · point {order} · {lastPracticedLabel}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '24px 30px 40px', flex: 1 }}>
          {/* Mastery readout */}
          {state !== 'not-started' && (
            <div style={{ marginBottom: 20 }}>
              <div
                style={{
                  display: 'flex',
                  gap: 20,
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div className="t-micro" style={{ color: 'var(--color-ink-mute)' }}>
                    mastery
                  </div>
                  <div
                    className="t-mono"
                    style={{ fontSize: 18, marginTop: 2, color: 'var(--color-ink)' }}
                  >
                    {mastery !== null ? `${Math.round(mastery * 100)}%` : '—'}
                  </div>
                </div>
                <div>
                  <div className="t-micro" style={{ color: 'var(--color-ink-mute)' }}>
                    confidence
                  </div>
                  <div
                    className="t-mono"
                    style={{ fontSize: 18, marginTop: 2, color: 'var(--color-ink)' }}
                  >
                    {confidence !== null
                      ? confidenceBand(Math.round(confidence * 100)).label
                      : '—'}
                  </div>
                </div>
                <div>
                  <div className="t-micro" style={{ color: 'var(--color-ink-mute)' }}>
                    evidence
                  </div>
                  <div
                    className="t-mono"
                    style={{ fontSize: 18, marginTop: 2, color: 'var(--color-ink)' }}
                  >
                    {evidenceCount}
                  </div>
                </div>
              </div>
              <p className="t-small text-ink-mute mt-s-2">
                mastery = your recent accuracy on this point, weighted by difficulty &amp; recency
              </p>
            </div>
          )}

          {/* Prereq cue */}
          {prereqUnmet && prereqNames.length > 0 && (
            <div
              style={{
                background: 'var(--color-paper-2)',
                borderRadius: 8,
                padding: '10px 14px',
                marginBottom: 20,
              }}
            >
              <p className="t-small" style={{ color: 'var(--color-ink-mute)', margin: 0 }}>
                builds on <strong>{prereqNames.join(', ')}</strong> — not solid yet, but you
                can still drill this.
              </p>
            </div>
          )}

          {/* Recurring error block */}
          {errorProne && errorSample && (
            <div style={{ marginBottom: 20 }}>
              <div className="t-micro" style={{ color: 'var(--color-ink-mute)', marginBottom: 8 }}>
                recurring slip · {recentErrorCount}× in 30 days
              </div>
              <div
                className="t-mono"
                style={{
                  background: 'var(--color-accent-soft)',
                  borderRadius: 6,
                  padding: '12px 16px',
                  fontSize: 14,
                }}
              >
                <s style={{ color: 'var(--color-ink-mute)' }}>{errorSample.wrongText}</s>
                {' → '}
                <strong style={{ color: 'var(--color-accent-2)' }}>{errorSample.correction}</strong>
              </div>
            </div>
          )}

          {/* Theory link */}
          {hasTheory && topicId && (
            <div style={{ marginBottom: 20 }}>
              <a href={`/theory/${topicId}`} className="link-arrow">
                read the theory{' '}
                <span className="lk-arr" aria-hidden="true">
                  →
                </span>
              </a>
            </div>
          )}

          {/* Drill options */}
          <div>
            <div className="t-micro" style={{ color: 'var(--color-ink-mute)', marginBottom: 10 }}>
              drill this point
            </div>
            <Button
              href={`/drill?start=quick&grammarPoint=${encodeURIComponent(key)}`}
              variant="primary"
              size="md"
              className="w-full"
            >
              mixed drill — adapts to your weak spots
            </Button>

            {compatibleTypes.length > 0 && (
              <>
                <div
                  className="t-micro"
                  style={{ color: 'var(--color-ink-mute)', marginTop: 16, marginBottom: 8 }}
                >
                  or pick one mode
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {compatibleTypes.map((type) => (
                    <Button
                      key={type}
                      href={chipHref(type)}
                      variant="ghost"
                      size="sm"
                    >
                      {typeLabel(type as ExerciseType)}
                    </Button>
                  ))}
                </div>
                <div
                  className="t-small"
                  style={{ color: 'var(--color-ink-mute)' }}
                >
                  each mode launches a single-mode targeted drill on this point.
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
