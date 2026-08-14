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
 */
export function classifyDiversityDefect(params: {
  isDeficient: boolean;
  unmeasuredRows: number;
}): DiversityChipClass {
  if (!params.isDeficient) return 'ok';
  return params.unmeasuredRows === 0 ? 'bad' : 'unknown';
}
