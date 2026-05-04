// ---------------------------------------------------------------------------
// Observation rules — deterministic narrative for the Shape tab's
// observation card. No Claude call: the prose comes from a small rules
// table over the radar axes.
//
// Design reference: .claude/specs/progress-page/design.md
//   §"Observation rules table (deterministic, no Claude)"
// ---------------------------------------------------------------------------

import type { RadarAxis, RadarAxisKey } from '@language-drill/api-client';

const INPUT_KEYS: readonly RadarAxisKey[] = ['listening', 'reading'];
const OUTPUT_KEYS: readonly RadarAxisKey[] = ['speaking', 'writing'];

const INPUT_OUTPUT_GAP = 0.15;
const WEAKEST_DRAG_THRESHOLD = 0.4;

export type Observation = {
  observation: string;
  highlightedAxes: {
    strongest: RadarAxisKey;
    weakest: RadarAxisKey;
  };
};

export function computeObservation(
  axes: readonly RadarAxis[],
): Observation | null {
  const practised = axes.filter((a) => a.evidenceCount > 0);
  if (practised.length === 0) return null;

  const strongest = practised.reduce((best, a) =>
    a.currentMastery > best.currentMastery ? a : best,
  );
  const weakest = practised.reduce((worst, a) =>
    a.currentMastery < worst.currentMastery ? a : worst,
  );

  const inputAxes = practised.filter((a) => INPUT_KEYS.includes(a.key));
  const outputAxes = practised.filter((a) => OUTPUT_KEYS.includes(a.key));

  const inputAvg = average(inputAxes.map((a) => a.currentMastery));
  const outputAvg = average(outputAxes.map((a) => a.currentMastery));

  // Branch 1 — input ahead of output by ≥ 0.15
  if (
    inputAxes.length > 0 &&
    outputAxes.length > 0 &&
    inputAvg !== null &&
    outputAvg !== null &&
    inputAvg - outputAvg >= INPUT_OUTPUT_GAP
  ) {
    return {
      observation: `you're strong at input (${labelList(inputAxes)}) and weaker at production (${labelList(outputAxes)}). classic intermediate plateau shape.`,
      highlightedAxes: { strongest: strongest.key, weakest: weakest.key },
    };
  }

  // Branch 2 — output ahead of input by ≥ 0.15
  if (
    inputAxes.length > 0 &&
    outputAxes.length > 0 &&
    inputAvg !== null &&
    outputAvg !== null &&
    outputAvg - inputAvg >= INPUT_OUTPUT_GAP
  ) {
    return {
      observation: `unusual shape — your production is ahead of your comprehension. ${weakest.label} is your sharpest gap.`,
      highlightedAxes: { strongest: strongest.key, weakest: weakest.key },
    };
  }

  // Branch 3 — weakest is dragging the shape
  if (weakest.currentMastery < WEAKEST_DRAG_THRESHOLD) {
    return {
      observation: `${weakest.label} is dragging the shape — that's where the next jump is.`,
      highlightedAxes: { strongest: strongest.key, weakest: weakest.key },
    };
  }

  // Branch 4 — balanced enough to need no narrative
  return null;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function labelList(axes: readonly RadarAxis[]): string {
  return axes.map((a) => a.label).join(', ');
}
