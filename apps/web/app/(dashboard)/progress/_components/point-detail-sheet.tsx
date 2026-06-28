'use client';

import { useEffect } from 'react';
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

  // Esc closes
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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

  return (
    <>
      {/* Overlay */}
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 50,
          background: 'rgba(26, 22, 18, 0.42)',
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={name}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 51,
          width: 'min(520px, 94vw)',
          background: 'var(--color-paper)',
          borderLeft: '1.5px solid var(--color-rule)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
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
              onClick={onClose}
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
                  gap: 24,
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
