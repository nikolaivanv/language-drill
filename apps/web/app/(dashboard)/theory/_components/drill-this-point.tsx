'use client';

import type { AuthenticatedFetch } from '@language-drill/api-client';
import { usePointDrillInfo } from '@language-drill/api-client';
import { ExerciseType } from '@language-drill/shared';
import { Button } from '../../../../components/ui/button';
import { typeLabel } from '../../_lib/timeline-labels';
import { confidenceBand } from '../../progress/_components/confidence-band';

// ---------------------------------------------------------------------------
// DrillThisPoint — "drill this point" block at the end of a theory article.
// Mirrors the lower half of the /progress PointDetailSheet, but availability
// is inventory-checked: buttons render only for modes with approved exercises
// at the point's OWN level (GET /progress/points/:key), so a tap can't land on
// INSUFFICIENT_EXERCISES. The whole block hides (renders null) when the pool
// is empty or the lookup fails — the article stays a clean read.
// ---------------------------------------------------------------------------

// Fixed chip order; grammar-drillable types only. Types produced by
// non-grammar curriculum kinds (vocab/dictation/free-writing) never chart
// here — a theory page maps to a grammar point.
const MODE_ORDER: readonly ExerciseType[] = [
  ExerciseType.CLOZE,
  ExerciseType.TRANSLATION,
  ExerciseType.SENTENCE_CONSTRUCTION,
  ExerciseType.CONJUGATION,
];

export type DrillThisPointProps = {
  grammarPointKey: string;
  fetchFn: AuthenticatedFetch;
};

function chipHref(type: ExerciseType, key: string): string {
  if (type === ExerciseType.CONJUGATION) {
    return `/drill/conjugation?grammarPoint=${encodeURIComponent(key)}`;
  }
  return `/drill?start=quick&grammarPoint=${encodeURIComponent(key)}&exerciseType=${type}`;
}

export function DrillThisPoint({ grammarPointKey, fetchFn }: DrillThisPointProps) {
  const query = usePointDrillInfo({ fetchFn, grammarPointKey });

  if (query.isLoading) {
    return (
      <section
        aria-busy="true"
        aria-label="drill this point"
        style={{ borderTop: '1px solid var(--color-rule)', marginTop: 40, paddingTop: 24 }}
      >
        <div
          aria-hidden="true"
          style={{ height: 120, borderRadius: 8, background: 'var(--color-paper-2)' }}
        />
      </section>
    );
  }

  if (!query.data) return null;

  const { exerciseCounts, mastery } = query.data;
  const total = Object.values(exerciseCounts).reduce((sum, n) => sum + n, 0);
  if (total === 0) return null;

  const modes = MODE_ORDER.filter((type) => (exerciseCounts[type] ?? 0) > 0);

  return (
    <section
      aria-label="drill this point"
      style={{ borderTop: '1px solid var(--color-rule)', marginTop: 40, paddingTop: 24 }}
    >
      {mastery && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 20, justifyContent: 'space-between', maxWidth: 420 }}>
            <div>
              <div className="t-micro" style={{ color: 'var(--color-ink-mute)' }}>
                mastery
              </div>
              <div className="t-mono" style={{ fontSize: 18, marginTop: 2, color: 'var(--color-ink)' }}>
                {Math.round(mastery.masteryScore * 100)}%
              </div>
            </div>
            <div>
              <div className="t-micro" style={{ color: 'var(--color-ink-mute)' }}>
                confidence
              </div>
              <div className="t-mono" style={{ fontSize: 18, marginTop: 2, color: 'var(--color-ink)' }}>
                {confidenceBand(Math.round(mastery.confidence * 100)).label}
              </div>
            </div>
            <div>
              <div className="t-micro" style={{ color: 'var(--color-ink-mute)' }}>
                evidence
              </div>
              <div className="t-mono" style={{ fontSize: 18, marginTop: 2, color: 'var(--color-ink)' }}>
                {mastery.evidenceCount}
              </div>
            </div>
          </div>
          <p className="t-small text-ink-mute mt-s-2">
            mastery = your recent accuracy on this point, weighted by difficulty &amp; recency
          </p>
        </div>
      )}

      <div className="t-micro" style={{ color: 'var(--color-ink-mute)', marginBottom: 10 }}>
        drill this point
      </div>
      <Button
        href={`/drill?start=quick&grammarPoint=${encodeURIComponent(grammarPointKey)}`}
        variant="primary"
        size="md"
        className="w-full"
      >
        mixed drill — adapts to your weak spots
      </Button>

      {modes.length > 0 && (
        <>
          <div className="t-micro" style={{ color: 'var(--color-ink-mute)', marginTop: 16, marginBottom: 8 }}>
            or pick one mode
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {modes.map((type) => (
              <Button key={type} href={chipHref(type, grammarPointKey)} variant="ghost" size="sm">
                {typeLabel(type)}
              </Button>
            ))}
          </div>
          <div className="t-small" style={{ color: 'var(--color-ink-mute)' }}>
            each mode launches a single-mode targeted drill on this point.
          </div>
        </>
      )}
    </section>
  );
}
