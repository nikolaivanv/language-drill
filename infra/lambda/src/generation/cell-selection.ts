/**
 * Pure fan-out selector for the nightly generation scheduler. Applies two
 * caps at once:
 *
 *   1. A **global cap** (`SCHEDULER_MAX_CELLS_PER_RUN`) bounding one night's
 *      Anthropic spend by limiting the total fan-out.
 *   2. A **per-language fair-share cap** (`SCHEDULER_MAX_CELLS_PER_LANGUAGE`)
 *      so a single language's curriculum expansion can't monopolize the run
 *      and starve the others. Before this, an expansion at B1/B2 (deficit 50)
 *      filled every slot for days, parking every other language's top-ups —
 *      see docs/analysis/generation-run-2026-07-18.md.
 *
 * Selection is a two-phase fair-share with redistribution:
 *
 *   - **Reserve:** per language, keep the `perLangCap` highest-need cells. This
 *     is the anti-starvation guarantee — every language gets its share first.
 *   - **Contention trim:** if the reserved picks alone exceed the global cap
 *     (every language brought a full share), keep the global top-`globalCap` by
 *     need. Each language is still ≤ `perLangCap`, so no monopoly survives.
 *   - **Redistribute:** if the reserved picks leave global slots free (some
 *     languages had little to do), fill the remainder from the leftover cells
 *     by need — so a night where only one language has work still fills to the
 *     global cap. No wasted capacity; fairness is enforced only under contention.
 *
 * Deterministic: cells sort by `need` descending, `cellKey` ascending as the
 * tie-break. No clock, no randomness.
 */

/** The minimal shape the selector needs from a scheduler cell. */
export interface CellNeed {
  cell: { language: string; cellKey: string };
  need: number;
}

export interface CellSelectionResult<T extends CellNeed> {
  /** The cells to enqueue this run, need-descending. */
  selected: T[];
  /** Under-target cells not enqueued this run (they re-enqueue next tick). */
  deferredCount: number;
  /** Enqueued count per language — surfaced in the scheduler's summary log. */
  enqueuedByLanguage: Record<string, number>;
}

/** need desc, then cellKey asc — the single deterministic ordering. */
function byNeedDesc(a: CellNeed, b: CellNeed): number {
  return b.need - a.need || a.cell.cellKey.localeCompare(b.cell.cellKey);
}

function countByLanguage(items: readonly CellNeed[]): Record<string, number> {
  const by: Record<string, number> = {};
  for (const item of items) {
    by[item.cell.language] = (by[item.cell.language] ?? 0) + 1;
  }
  return by;
}

/**
 * Choose which under-target cells to enqueue, honouring both the global cap
 * and the per-language fair-share cap. Pure — see the module doc for the
 * two-phase algorithm.
 */
export function selectCellsWithinCaps<T extends CellNeed>(
  undersized: readonly T[],
  globalCap: number,
  perLangCap: number,
): CellSelectionResult<T> {
  // Phase 1 — reserve up to `perLangCap` highest-need cells per language.
  const byLanguage = new Map<string, T[]>();
  for (const item of undersized) {
    const group = byLanguage.get(item.cell.language);
    if (group) group.push(item);
    else byLanguage.set(item.cell.language, [item]);
  }

  const reserved: T[] = [];
  const leftover: T[] = [];
  for (const group of byLanguage.values()) {
    group.sort(byNeedDesc);
    reserved.push(...group.slice(0, perLangCap));
    leftover.push(...group.slice(perLangCap));
  }

  let selected: T[];
  if (reserved.length >= globalCap) {
    // Contention: every language's fair share together overflows the run.
    // Keep the global top-`globalCap` by need; each language stays ≤ perLangCap.
    reserved.sort(byNeedDesc);
    selected = reserved.slice(0, globalCap);
  } else {
    // Redistribute: fill the remaining global slots from the leftover cells.
    leftover.sort(byNeedDesc);
    selected = reserved
      .concat(leftover.slice(0, globalCap - reserved.length))
      .sort(byNeedDesc);
  }

  return {
    selected,
    deferredCount: undersized.length - selected.length,
    enqueuedByLanguage: countByLanguage(selected),
  };
}
