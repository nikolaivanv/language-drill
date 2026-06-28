'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CurriculumMapPoint } from '@language-drill/api-client';
import type { LearningLanguage } from '@language-drill/shared';
import { ExerciseType } from '@language-drill/shared';
import { Button } from '../../../../components/ui/button';
import { typeLabel } from '../../_lib/timeline-labels';
import { topicIdForGrammarPointKey } from '../../../../lib/theory-topic-map';
import { useBodyScrollLock } from '../../../../lib/hooks/use-body-scroll-lock';
import { formatAgo } from '../_lib/format-ago';
import { confidenceBand } from './confidence-band';

// ---------------------------------------------------------------------------
// PointDetailSheet — right-side sheet that opens when a map cell is tapped.
// Props: the selected grammar-point, the active learning language, and a
// close callback.  Esc + overlay-click + × button all call onClose.
// ---------------------------------------------------------------------------

export type PointDetailSheetProps = {
  point: CurriculumMapPoint;
  language: LearningLanguage;
  onClose: () => void;
};

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

  useBodyScrollLock(true);

  // Closing state drives the slide-out animation: a close request flips this on,
  // then `onClose` (which unmounts us) fires after the animation completes so the
  // drawer glides out instead of vanishing. Reduced-motion users skip straight
  // to onClose.
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestClose = useCallback(() => {
    if (closeTimer.current) return;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      onClose();
      return;
    }
    setClosing(true);
    closeTimer.current = setTimeout(onClose, 240);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  // Esc closes
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') requestClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [requestClose]);

  // Swipe-to-close: a rightward, mostly-horizontal drag dismisses the drawer
  // (mobile parity with tapping the scrim). Vertical scrolls are ignored so the
  // body still scrolls normally.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (dx > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) requestClose();
  }

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

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`point-detail-overlay${closing ? ' point-detail-overlay-closing' : ''}`}
      onClick={requestClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(26, 22, 18, 0.42)',
        display: 'flex',
        justifyContent: 'flex-end',
        overflow: 'hidden',
      }}
    >
      <div
        className={`point-detail-panel${closing ? ' point-detail-panel-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{
          position: 'relative',
          width: 'min(520px, 90vw)',
          height: '100%',
          background: 'var(--color-paper)',
          borderLeft: '1.5px solid var(--color-rule)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {/* Head */}
        <div
          style={{
            padding: '26px 18px 20px',
            borderBottom: '1px solid var(--color-rule)',
            flexShrink: 0,
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
        <div
          style={{
            padding: '24px 18px 40px',
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          {/* Mastery readout */}
          {state !== 'not-started' && (
            <div style={{ marginBottom: 20 }}>
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
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
                <div style={{ flex: 1, minWidth: 0 }}>
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
                <div style={{ flex: 1, minWidth: 0 }}>
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
                  overflowWrap: 'anywhere',
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
    </div>,
    document.body,
  );
}
