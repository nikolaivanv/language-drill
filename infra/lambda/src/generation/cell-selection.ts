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
 * Selection runs in execution order — finishing reserve first, then the
 * per-language fair-share pass:
 *
 *   - **Finishing reserve (phase 0):** before the fair-share runs, carve up to
 *     `finishingReserveSlots` slots for near-complete cells (`need ≤
 *     finishingThreshold`), closest-to-done first, so a cell one draft from
 *     target isn't perpetually outranked by the chronic high-need tail.
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

/** need desc, then cellKey asc — the deterministic ordering for the backlog. */
function byNeedDesc(a: CellNeed, b: CellNeed): number {
  return b.need - a.need || a.cell.cellKey.localeCompare(b.cell.cellKey);
}

/** need asc, then cellKey asc — closest-to-done first, for the finishing reserve. */
function byNeedAsc(a: CellNeed, b: CellNeed): number {
  return a.need - b.need || a.cell.cellKey.localeCompare(b.cell.cellKey);
}

function countByLanguage(items: readonly CellNeed[]): Record<string, number> {
  const by: Record<string, number> = {};
  for (const item of items) {
    by[item.cell.language] = (by[item.cell.language] ?? 0) + 1;
  }
  return by;
}

/**
 * The per-language fair-share pass: reserve up to `perLangCap` highest-need
 * cells per language, trim to `globalCap` by need under contention, else
 * redistribute unused global slots from the leftover. Extracted verbatim from
 * the former `selectCellsWithinCaps` body so the main-cell pass reuses it.
 */
function fairShareSelect<T extends CellNeed>(
  cells: readonly T[],
  globalCap: number,
  perLangCap: number,
): T[] {
  const byLanguage = new Map<string, T[]>();
  for (const item of cells) {
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

  if (reserved.length >= globalCap) {
    reserved.sort(byNeedDesc);
    return reserved.slice(0, globalCap);
  }
  leftover.sort(byNeedDesc);
  return reserved
    .concat(leftover.slice(0, globalCap - reserved.length))
    .sort(byNeedDesc);
}

/**
 * Choose which under-target cells to enqueue. Partitions cells by
 * `finishingThreshold` into near-complete **finishers** (`need ≤ threshold`)
 * and **main cells**, then:
 *
 *   0. Finishing reserve — carve up to `finishingReserveSlots` global slots for
 *      finishers, closest-to-done first (need ASC), so near-complete cells close
 *      permanently instead of being perpetually outranked by the high-need tail.
 *   1–3. Fair-share (`fairShareSelect`) on the main cells with the remaining
 *      budget — unchanged. Excluding finishers from the per-language reserve
 *      means a near-saturated language stops burning `perLangCap` on need-1
 *      cells, so redistribution can free another language's high-need overflow.
 *   4. Fill any residual budget with leftover finishers (need DESC) so a light
 *      night still fills to `globalCap`.
 *
 * Pure and deterministic — need + cellKey tie-break, no clock, no randomness.
 */
export function selectCellsWithinCaps<T extends CellNeed>(
  undersized: readonly T[],
  globalCap: number,
  perLangCap: number,
  finishingThreshold: number,
  finishingReserveSlots: number,
): CellSelectionResult<T> {
  const finishers: T[] = [];
  const mainCells: T[] = [];
  for (const item of undersized) {
    if (item.need <= finishingThreshold) finishers.push(item);
    else mainCells.push(item);
  }

  // Phase 0 — finishing reserve, closest-to-done first, bounded by the global cap.
  // This is a GLOBAL reserve (optimizes total cells-closed-per-run), not a
  // per-language guarantee: under finisher contention exceeding
  // `finishingReserveSlots`, a given language's finisher may lose out to a
  // closer-to-done finisher from another language and wait for a later run.
  finishers.sort(byNeedAsc);
  const reserveCount = Math.min(
    finishingReserveSlots,
    finishers.length,
    globalCap,
  );
  const reservedFinishers = finishers.slice(0, reserveCount);

  // Phases 1–3 — existing fair-share on the main backlog, budget net of phase 0.
  const mainBudget = globalCap - reservedFinishers.length;
  const mainSelected =
    mainBudget > 0 ? fairShareSelect(mainCells, mainBudget, perLangCap) : [];

  // Phase 4 — fill any residual budget with the leftover finishers.
  const residual = mainBudget - mainSelected.length;
  const extraFinishers =
    residual > 0
      ? finishers.slice(reserveCount).sort(byNeedDesc).slice(0, residual)
      : [];

  const selected = [...reservedFinishers, ...mainSelected, ...extraFinishers].sort(
    byNeedDesc,
  );

  return {
    selected,
    deferredCount: undersized.length - selected.length,
    enqueuedByLanguage: countByLanguage(selected),
  };
}
