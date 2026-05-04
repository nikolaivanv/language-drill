import { describe, it, expect } from 'vitest';
import type { RadarAxis, RadarAxisKey } from '@language-drill/api-client';
import { computeFraming, pickWeakestAxis } from './framing-rules';

// ---------------------------------------------------------------------------
// Fixture builder — keeps each test focused on what it cares about
// ---------------------------------------------------------------------------

function axis(
  key: RadarAxisKey,
  currentMastery: number,
  evidenceCount = 5,
  label: string = key,
): RadarAxis {
  return {
    key,
    label,
    currentMastery,
    previousMastery: currentMastery,
    lastPracticedAt: null,
    evidenceCount,
  };
}

// ---------------------------------------------------------------------------
// pickWeakestAxis
// ---------------------------------------------------------------------------

describe('pickWeakestAxis', () => {
  it('returns null when axes is undefined (radar in flight)', () => {
    expect(pickWeakestAxis(undefined)).toBeNull();
  });

  it('returns null when every axis has evidenceCount === 0', () => {
    const axes: RadarAxis[] = [
      axis('grammar', 0.2, 0),
      axis('vocabulary', 0.4, 0),
    ];
    expect(pickWeakestAxis(axes)).toBeNull();
  });

  it('ignores zero-evidence axes even when they look weakest', () => {
    const axes: RadarAxis[] = [
      axis('speaking', 0.1, 0), // would win on mastery, but no evidence
      axis('grammar', 0.6, 4),
      axis('vocabulary', 0.7, 4),
    ];
    expect(pickWeakestAxis(axes)?.key).toBe('grammar');
  });

  it('returns the lowest-mastery qualifying axis', () => {
    const axes: RadarAxis[] = [
      axis('grammar', 0.42),
      axis('vocabulary', 0.81),
      axis('reading', 0.55),
    ];
    expect(pickWeakestAxis(axes)?.key).toBe('grammar');
  });

  it('breaks ties via key.localeCompare (stable ordering)', () => {
    const axes: RadarAxis[] = [
      axis('vocabulary', 0.5),
      axis('grammar', 0.5),
      axis('reading', 0.5),
    ];
    // grammar < reading < vocabulary alphabetically
    expect(pickWeakestAxis(axes)?.key).toBe('grammar');
  });
});

// ---------------------------------------------------------------------------
// computeFraming — one branch per case
// ---------------------------------------------------------------------------

describe('computeFraming', () => {
  it('returns the generic line when axes is undefined', () => {
    const result = computeFraming(undefined);
    expect(result.isGeneric).toBe(true);
    expect(result.paragraph).toBe(
      'a balanced session — production first, then a vocabulary rep.',
    );
  });

  it('returns the generic line when no axis has evidence', () => {
    const axes: RadarAxis[] = [
      axis('grammar', 0.2, 0),
      axis('vocabulary', 0.4, 0),
    ];
    const result = computeFraming(axes);
    expect(result.isGeneric).toBe(true);
  });

  it('returns the production-leaning line when weakest mastery < 0.5', () => {
    const axes: RadarAxis[] = [
      axis('grammar', 0.3, 5, 'grammar'),
      axis('vocabulary', 0.8),
    ];
    const result = computeFraming(axes);
    expect(result.isGeneric).toBeUndefined();
    expect(result.paragraph).toContain('grammar');
    expect(result.paragraph).toContain('weakest right now');
    expect(result.paragraph).toContain('production, not recognition');
  });

  it('returns the soft-spot line when weakest mastery is in [0.5, 0.7)', () => {
    const axes: RadarAxis[] = [
      axis('grammar', 0.6, 5, 'grammar'),
      axis('vocabulary', 0.85),
    ];
    const result = computeFraming(axes);
    expect(result.isGeneric).toBeUndefined();
    expect(result.paragraph).toContain('grammar');
    expect(result.paragraph).toContain('soft spot');
    expect(result.paragraph).toContain('one extra rep');
  });

  it('returns the soft-spot line at the lower boundary (0.5)', () => {
    const axes: RadarAxis[] = [axis('grammar', 0.5, 5, 'grammar')];
    expect(computeFraming(axes).paragraph).toContain('soft spot');
  });

  it('returns the maintenance line when every practised axis is ≥ 0.7', () => {
    const axes: RadarAxis[] = [
      axis('grammar', 0.7),
      axis('vocabulary', 0.85),
      axis('reading', 0.92),
    ];
    const result = computeFraming(axes);
    expect(result.isGeneric).toBeUndefined();
    expect(result.paragraph).toBe(
      'a maintenance session — your shape is in good order, today is just to keep it that way.',
    );
  });

  it('uses the axis label (not the key) in the paragraph', () => {
    const axes: RadarAxis[] = [
      axis('vocabulary', 0.3, 5, 'vocabulary breadth'),
    ];
    expect(computeFraming(axes).paragraph).toContain('vocabulary breadth');
  });
});
