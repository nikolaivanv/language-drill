/**
 * Maps a cell + the validator's raw coverage map to the coverage tags that
 * should be persisted for that cell — the thin DB-side wrapper over the pure
 * `pickCoverageTags` rule in @language-drill/shared. Lives next to the routing
 * helpers because the generation insert path and the backfill CLI both use it.
 */

import { pickCoverageTags, type CoverageTags } from "@language-drill/shared";

import type { Cell } from "./cells";

export function applicableCoverageTags(
  cell: Cell,
  coverage: CoverageTags,
): CoverageTags | null {
  return pickCoverageTags(
    coverage,
    cell.exerciseType,
    cell.grammarPoint.coverageSpec,
  );
}
