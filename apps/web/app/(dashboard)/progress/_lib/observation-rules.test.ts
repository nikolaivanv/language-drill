import { describe, it, expect } from 'vitest';
import type { RadarAxis, RadarAxisKey } from '@language-drill/api-client';
import { computeObservation } from './observation-rules';

// ---------------------------------------------------------------------------
// Helpers — build a 6-axis array with selected overrides per axis. Untouched
// axes default to evidenceCount 0 / mastery 0 (the "no signal" shape).
// ---------------------------------------------------------------------------

const ALL_KEYS: RadarAxisKey[] = [
  'listening',
  'reading',
  'speaking',
  'writing',
  'grammar',
  'vocabulary',
];

function buildAxes(
  overrides: Partial<
    Record<RadarAxisKey, { mastery: number; evidence?: number }>
  >,
): RadarAxis[] {
  return ALL_KEYS.map((key) => {
    const o = overrides[key];
    return {
      key,
      label: key,
      currentMastery: o?.mastery ?? 0,
      previousMastery: o?.mastery ?? 0,
      lastPracticedAt: o ? '2026-04-30T12:00:00.000Z' : null,
      evidenceCount: o?.evidence ?? (o ? 1 : 0),
    };
  });
}

describe('computeObservation', () => {
  it('returns null when no axis has evidence', () => {
    expect(computeObservation(buildAxes({}))).toBeNull();
  });

  it('returns the input-strong narrative when input avg ≥ 0.15 above output avg', () => {
    const result = computeObservation(
      buildAxes({
        listening: { mastery: 0.85 },
        reading: { mastery: 0.85 },
        speaking: { mastery: 0.55 },
        writing: { mastery: 0.55 },
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.observation).toBe(
      "you're strong at input (listening, reading) and weaker at production (speaking, writing). classic intermediate plateau shape.",
    );
    // Strongest is one of the input axes; weakest is one of the output axes.
    expect(['listening', 'reading']).toContain(result!.highlightedAxes.strongest);
    expect(['speaking', 'writing']).toContain(result!.highlightedAxes.weakest);
  });

  it('returns the output-strong narrative when output avg ≥ 0.15 above input avg', () => {
    const result = computeObservation(
      buildAxes({
        listening: { mastery: 0.5 },
        reading: { mastery: 0.5 },
        speaking: { mastery: 0.85 },
        writing: { mastery: 0.85 },
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.observation).toContain('production is ahead of your comprehension');
    expect(result!.observation).toMatch(/(listening|reading) is your sharpest gap/);
  });

  it('returns the weakest-drag narrative when no input/output gap but weakest < 0.4', () => {
    const result = computeObservation(
      buildAxes({
        listening: { mastery: 0.65 },
        reading: { mastery: 0.65 },
        speaking: { mastery: 0.6 },
        writing: { mastery: 0.6 },
        grammar: { mastery: 0.3 }, // weakest, < 0.4
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.observation).toBe(
      "grammar is dragging the shape — that's where the next jump is.",
    );
    expect(result!.highlightedAxes.weakest).toBe('grammar');
  });

  it('returns null when the radar is balanced and no axis is below 0.4', () => {
    expect(
      computeObservation(
        buildAxes({
          listening: { mastery: 0.6 },
          reading: { mastery: 0.6 },
          speaking: { mastery: 0.55 },
          writing: { mastery: 0.55 },
          grammar: { mastery: 0.6 },
          vocabulary: { mastery: 0.5 },
        }),
      ),
    ).toBeNull();
  });

  it('does NOT pick the input-strong branch when only output axes have evidence', () => {
    // Only speaking and writing have evidence — input avg cannot be compared.
    // The branch should fall through; weakest of practised may still trigger
    // the weakest-drag branch if low enough, otherwise null.
    const balanced = computeObservation(
      buildAxes({
        speaking: { mastery: 0.6 },
        writing: { mastery: 0.6 },
      }),
    );
    expect(balanced).toBeNull();

    const dragging = computeObservation(
      buildAxes({
        speaking: { mastery: 0.6 },
        writing: { mastery: 0.3 },
      }),
    );
    expect(dragging).not.toBeNull();
    expect(dragging!.observation).toContain('writing');
  });

  it('ignores axes with evidenceCount 0 when picking strongest/weakest', () => {
    const result = computeObservation(
      buildAxes({
        // listening has the highest mastery on paper, but no evidence — should be ignored
        listening: { mastery: 0.99, evidence: 0 },
        reading: { mastery: 0.7 },
        speaking: { mastery: 0.3 },
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.highlightedAxes.strongest).not.toBe('listening');
  });
});
