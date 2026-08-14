/**
 * Shared ✗ / ⚠ classification for diversity coverage chips.
 *
 * This is the safety property of the diversity-visibility feature: a
 * deficient value (a coverage-axis value at zero against a declared floor,
 * or a construction variant at zero) renders as a PROVEN failure (✗) only
 * when its denominator proves absence — `axis.untagged === 0` for a
 * coverage axis, `seed.unlabelledRows === 0` for a construction variant.
 * Otherwise the "zero" is a measurement gap, not a defect, and must render
 * as an unresolved UNKNOWN (⚠) with neutral styling, never the failure
 * style. Mislabeling a measurement gap as a defect is what gets sound
 * exercise rows demoted — so this predicate must not drift between the two
 * surfaces that render it (the diversity hub and the pool-cell drawer).
 *
 * Keep this module small and pure: a classification function plus the
 * class constants both surfaces render from. No JSX here.
 */

export type DiversityChipClass = 'ok' | 'unknown' | 'bad';

export const DIVERSITY_CHIP_BASE =
  'inline-flex items-center rounded-pill border px-2 py-px text-[12px]';

export const DIVERSITY_CHIP_CLASSNAMES: Record<DiversityChipClass, string> = {
  ok: 'border-ok-soft bg-ok-soft text-ok',
  bad: 'border-red-200 bg-red-50 text-red-700',
  // Deliberately NOT the failure style: an unknown is a measurement gap,
  // and styling it as a failure is what gets sound rows demoted.
  unknown: 'border-rule bg-card text-ink-soft',
};

export const DIVERSITY_CHIP_SUFFIX: Record<DiversityChipClass, string> = {
  ok: '✓',
  bad: '✗',
  unknown: '⚠',
};

/**
 * Classifies a deficient value against its denominator. Callers decide what
 * counts as "deficient" for their own value shape (a coverage-axis value at
 * zero against a declared floor, a below-floor value, a construction
 * variant at zero); this function only decides whether that deficiency is
 * PROVEN (denominator is zero — no rows remain that could still supply the
 * missing value) or merely UNMEASURED (rows exist that haven't been tagged
 * or labelled yet, so the zero may just be a measurement gap).
 *
 * `unmeasuredRows: undefined` means the denominator itself is unknown (the
 * diversity fetch is still loading, errored, or the cell/point is absent
 * from the response) — that must NEVER be read as "zero rows unmeasured".
 * Absence of evidence is not evidence of absence, so it classifies the same
 * as a nonzero unmeasured count: 'unknown'.
 */
export function classifyDiversityDefect(params: {
  isDeficient: boolean;
  unmeasuredRows: number | undefined;
}): DiversityChipClass {
  if (!params.isDeficient) return 'ok';
  return params.unmeasuredRows === 0 ? 'bad' : 'unknown';
}

/**
 * The single below-floor predicate for a coverage-axis value. Both the
 * diversity hub (`diversity-point-row.tsx`) and the pool-cell drawer
 * (`pool-cell-detail.tsx`) must call this rather than restating "deficient"
 * themselves — that restatement is exactly how the two surfaces drifted
 * (one read "deficient" as `count === 0`, the other as `count < floor`).
 *
 * A value with no declared floor has nothing to be deficient against, so
 * this returns `null` — the caller renders it as a plain count with no
 * ✓/✗/⚠ suffix, never a claimed pass.
 *
 * `untagged: undefined` means the cell's tag denominator is unknown at this
 * call site (e.g. the pool-cell drawer's diversity fetch hasn't resolved, or
 * the cell isn't in the response) — never collapse that into "0 untagged".
 */
export function classifyAxisValue(
  value: { count: number; floor: number | null },
  untagged: number | undefined,
): DiversityChipClass | null {
  if (value.floor === null) return null;
  return classifyDiversityDefect({
    isDeficient: value.count < value.floor,
    unmeasuredRows: untagged,
  });
}

/**
 * The single "deficient" predicate for a construction variant: realized zero
 * times in the approved pool. `unlabelledRows` is the count of approved rows
 * in the cell that carry no `seedWord` at all (pre-#640 rows) — those could
 * still turn out to realize the variant once labelled, so a zero is only
 * PROVEN once that count is zero too.
 */
export function classifyVariant(
  variant: { count: number },
  unlabelledRows: number | undefined,
): DiversityChipClass {
  return classifyDiversityDefect({
    isDeficient: variant.count === 0,
    unmeasuredRows: unlabelledRows,
  });
}
