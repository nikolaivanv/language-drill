// ---------------------------------------------------------------------------
// path-cue — compose the "point N of A1 · next: X" linear-path cue
// ---------------------------------------------------------------------------
// Pure function: takes a CurriculumMapResponse and returns a quiet label
// describing the learner's current position in the active level.
// ---------------------------------------------------------------------------

import type { CurriculumMapResponse } from '@language-drill/api-client';

export type PathCue = {
  positionLabel: string;
  nextName: string | null;
};

/**
 * Compose the path cue from the curriculum map.
 *
 * - Returns `null` when `map` is undefined or the active level is missing.
 * - `positionLabel` = "point {count of touched points} of {activeLevel}"
 *   where "touched" means state !== 'not-started'.
 * - `nextName` = the `name` of the first point (by `order`) whose state is
 *   'not-started'; `null` when all points are touched.
 */
export function composePathCue(
  map: CurriculumMapResponse | undefined,
): PathCue | null {
  if (!map) return null;

  const activeLevel = map.levels.find((l) => l.level === map.activeLevel);
  if (!activeLevel) return null;

  const touchedCount = activeLevel.points.filter(
    (p) => p.state !== 'not-started',
  ).length;

  const positionLabel = `point ${touchedCount} of ${map.activeLevel}`;

  const notStartedPoints = activeLevel.points
    .filter((p) => p.state === 'not-started')
    .sort((a, b) => a.order - b.order);

  const nextName = notStartedPoints[0]?.name ?? null;

  return { positionLabel, nextName };
}
