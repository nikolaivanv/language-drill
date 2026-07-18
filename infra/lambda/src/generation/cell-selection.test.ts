/**
 * Unit tests for `selectCellsWithinCaps` — the pure fan-out selector that
 * applies BOTH the run-level global cap and the per-language fair-share cap.
 *
 * No DB, no env, no AWS SDK: the selector takes `{ cell: { language, cellKey },
 * need }` items and returns the chosen subset plus a per-language breakdown.
 * The invariants under test:
 *   - no language ever exceeds `perLangCap` unless redistribution fills unused
 *     global slots with its leftover (anti-starvation guarantee);
 *   - a night where only one language has work still fills to `globalCap`
 *     (no wasted capacity);
 *   - selection is deterministic (need desc, cellKey asc tie-break).
 */

import { describe, expect, it } from 'vitest';

import { selectCellsWithinCaps, type CellNeed } from './cell-selection';

/** Build `count` items for a language with descending needs and stable keys. */
function items(language: string, count: number, baseNeed = 50): CellNeed[] {
  return Array.from({ length: count }, (_, i) => ({
    cell: { language, cellKey: `${language.toLowerCase()}:${String(i).padStart(3, '0')}` },
    need: baseNeed,
  }));
}

const langsOf = (items: CellNeed[]) => {
  const by: Record<string, number> = {};
  for (const it of items) by[it.cell.language] = (by[it.cell.language] ?? 0) + 1;
  return by;
};

describe('selectCellsWithinCaps', () => {
  it('is a no-op when everything fits under both caps', () => {
    const under = [...items('DE', 10), ...items('ES', 10), ...items('TR', 10)];
    const r = selectCellsWithinCaps(under, 120, 50);
    expect(r.selected).toHaveLength(30);
    expect(r.deferredCount).toBe(0);
    expect(r.enqueuedByLanguage).toEqual({ DE: 10, ES: 10, TR: 10 });
  });

  it('serves other languages fully when one floods (real-world starvation case)', () => {
    // DE floods with 200 under-target cells; ES/TR have modest top-ups (30 each).
    // ES/TR get everything they want; DE takes the rest via redistribution —
    // this is the scenario the per-language cap exists to fix (a DE expansion
    // that previously parked every ES/TR top-up).
    const under = [...items('DE', 200), ...items('ES', 30), ...items('TR', 30)];
    const r = selectCellsWithinCaps(under, 120, 50);
    expect(r.selected).toHaveLength(120);
    const by = langsOf(r.selected);
    expect(by['ES']).toBe(30); // fully served — not starved
    expect(by['TR']).toBe(30); // fully served — not starved
    expect(by['DE']).toBe(60); // 50 reserved + 10 redistributed into free slots
    expect(r.enqueuedByLanguage).toEqual({ DE: 60, ES: 30, TR: 30 });
    expect(r.deferredCount).toBe(260 - 120);
  });

  it('caps the flooding language under full contention, leaving room for the rest', () => {
    // All three languages flood (≥50 each) → reserved = 150 > 120, no free
    // slots to redistribute. No single language exceeds perLangCap, so the
    // combined others always keep ≥ globalCap − perLangCap slots.
    const under = [...items('DE', 100), ...items('ES', 100), ...items('TR', 100)];
    const r = selectCellsWithinCaps(under, 120, 50);
    expect(r.selected).toHaveLength(120);
    const by = langsOf(r.selected);
    for (const lang of ['DE', 'ES', 'TR']) {
      expect(by[lang] ?? 0).toBeLessThanOrEqual(50);
    }
    // No monopoly: whichever language sorts first still can't exceed 50, so the
    // other two share the remaining ≥70.
    expect(Math.max(...Object.values(by))).toBeLessThanOrEqual(50);
    expect(120 - Math.max(...Object.values(by))).toBeGreaterThanOrEqual(70);
  });

  it('redistributes unused global slots to a dominant language (no wasted capacity)', () => {
    // Only DE has work → fills to the global cap despite the per-language cap.
    const under = items('DE', 200);
    const r = selectCellsWithinCaps(under, 120, 50);
    expect(r.selected).toHaveLength(120);
    expect(langsOf(r.selected)).toEqual({ DE: 120 });
    expect(r.deferredCount).toBe(80);
  });

  it('redistributes leftover when other languages under-fill their share', () => {
    // DE huge; ES/TR only 20 each → reserve 50+20+20=90, redistribute 30 to DE.
    const under = [...items('DE', 200), ...items('ES', 20), ...items('TR', 20)];
    const r = selectCellsWithinCaps(under, 120, 50);
    expect(r.selected).toHaveLength(120);
    const by = langsOf(r.selected);
    expect(by['ES']).toBe(20);
    expect(by['TR']).toBe(20);
    expect(by['DE']).toBe(80); // 50 reserved + 30 redistributed
  });

  it('selects the highest-need cells within a language (deterministic order)', () => {
    // 3 DE cells with distinct needs; perLangCap 2 keeps the two highest.
    const under: CellNeed[] = [
      { cell: { language: 'DE', cellKey: 'de:low' }, need: 10 },
      { cell: { language: 'DE', cellKey: 'de:high' }, need: 50 },
      { cell: { language: 'DE', cellKey: 'de:mid' }, need: 30 },
    ];
    // globalCap 2 = perLangCap 2 → no free slots to redistribute de:low back in.
    const r = selectCellsWithinCaps(under, 2, 2);
    expect(r.selected.map((s) => s.cell.cellKey)).toEqual(['de:high', 'de:mid']);
  });

  it('breaks need ties by cellKey ascending (stable, reproducible)', () => {
    const under: CellNeed[] = [
      { cell: { language: 'DE', cellKey: 'de:b' }, need: 50 },
      { cell: { language: 'DE', cellKey: 'de:a' }, need: 50 },
    ];
    const r = selectCellsWithinCaps(under, 1, 50);
    expect(r.selected[0]!.cell.cellKey).toBe('de:a');
  });

  it('handles an empty input', () => {
    const r = selectCellsWithinCaps([], 120, 50);
    expect(r.selected).toEqual([]);
    expect(r.deferredCount).toBe(0);
    expect(r.enqueuedByLanguage).toEqual({});
  });

  it('behaves like a pure global cap when perLangCap ≥ globalCap', () => {
    const under = [...items('DE', 100), ...items('ES', 100)];
    const r = selectCellsWithinCaps(under, 120, 500);
    expect(r.selected).toHaveLength(120);
    // No per-language guarantee when the per-lang cap is slack; top-120 by need.
    expect(r.deferredCount).toBe(80);
  });
});
