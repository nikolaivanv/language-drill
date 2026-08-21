/**
 * Pure, axis-agnostic coverage-controller decision logic (Pool Coverage
 * Controller, Phase 2). No `@aws-sdk/*`, no Drizzle, no env — pure inputs →
 * pure output, unit-tested in isolation. Generalizes the Phase-1 person-only
 * water-fill: for each axis in the spec INDEPENDENTLY, greedily fill each draft
 * into the eligible value currently lowest in the approved pool (realizing the
 * per-value floors without an explicit floor term), assigning each draft the
 * COMBINATION that is most starved, breaking ties toward combinations this
 * batch has not used yet. The combination is the unit of assignment: an earlier
 * implementation water-filled each axis separately and zipped the sequences
 * index-wise, which can only reach `lcm(m, n)` of the `m x n` combinations and
 * left real pools stuck on a diagonal with every floor satisfied (see the
 * comment in `decideCoverageTargets`). Approved counts are still measured
 * strictly per-`(axis, value)` — the cross-product is requested, never measured
 * — and give-up remains strictly per-`(axis, value)`. A value absent from `floors` is "NA" (never targeted); a
 * value targeted >= GIVE_UP_MIN_ATTEMPTS last batch with zero approvals is
 * suppressed until a CURRICULUM_VERSION bump clears it (caller passes
 * `recentOutcome: null`).
 */

import {
  COVERAGE_AXIS_VALUES,
  type CoverageAxis,
  type CoverageOutcome,
  type CoverageSpec,
  type CoverageTarget,
} from "@language-drill/shared";
import { GIVE_UP_MIN_ATTEMPTS } from "./cell-targets";

export { GIVE_UP_MIN_ATTEMPTS };

export type CoverageDecisionInput = {
  spec: CoverageSpec;
  /** decideEnqueue's scalar need (= target − approvedInPool). */
  need: number;
  /** Measured approved-pool count per axis/value (from coverage_tags GROUP BY). */
  approvedByAxis: Partial<Record<CoverageAxis, Partial<Record<string, number>>>>;
  /**
   * The most-recent succeeded job's outcome — ONLY when that job's
   * curriculumVersion matches the on-disk constant. `null` clears all give-up.
   */
  recentOutcome: CoverageOutcome | null;
};

export type CoverageDecision = {
  /** length === max(0, need) when any axis is targetable; [] otherwise. */
  coverageTargets: CoverageTarget[];
  /** Per-axis values excluded as zero-yield — surfaced for the scheduler log. */
  suppressed: Partial<Record<CoverageAxis, string[]>>;
};

/** Floor values in canonical paradigm order (1sg,2sg,… / affirmative,negative,…). */
function orderedFloorValues(axis: CoverageSpec["axes"][number]): string[] {
  const order = COVERAGE_AXIS_VALUES[axis.name];
  return order.filter((v) => v in axis.floors);
}

function suppressedFor(
  axis: CoverageSpec["axes"][number],
  recentOutcome: CoverageOutcome | null,
): string[] {
  const out = recentOutcome?.[axis.name];
  if (!out) return [];
  return orderedFloorValues(axis).filter((v) => {
    const o = out[v];
    return o !== undefined && o.requested >= GIVE_UP_MIN_ATTEMPTS && o.approved === 0;
  });
}

export function decideCoverageTargets(
  input: CoverageDecisionInput,
): CoverageDecision {
  const { spec, need, approvedByAxis, recentOutcome } = input;

  const suppressed: Partial<Record<CoverageAxis, string[]>> = {};
  for (const axis of spec.axes) {
    const s = suppressedFor(axis, recentOutcome);
    if (s.length > 0) suppressed[axis.name] = s;
  }

  if (need <= 0) return { coverageTargets: [], suppressed };

  // Eligible values per axis, in canonical paradigm order, minus suppressions.
  const eligibleByAxis: Array<{ axis: CoverageAxis; values: string[] }> = [];
  for (const axis of spec.axes) {
    const values = orderedFloorValues(axis).filter(
      (v) => !(suppressed[axis.name]?.includes(v) ?? false),
    );
    if (values.length === 0) continue; // axis contributes no constraint
    eligibleByAxis.push({ axis: axis.name, values });
  }
  if (eligibleByAxis.length === 0) return { coverageTargets: [], suppressed };

  // Live per-(axis,value) counts, seeded from the approved pool and incremented
  // as this batch is assigned — this is the water-fill signal.
  const counts = new Map<string, number>();
  for (const { axis, values } of eligibleByAxis) {
    for (const v of values) counts.set(`${axis}\u0000${v}`, approvedByAxis[axis]?.[v] ?? 0);
  }

  // Every combination of eligible values, in canonical order. Bounded and small:
  // axes are <= 6 values and specs carry at most a handful of axes, so this is
  // tens of entries, not a blowup.
  let combos: CoverageTarget[] = [{}];
  for (const { axis, values } of eligibleByAxis) {
    const next: CoverageTarget[] = [];
    for (const partial of combos) {
      for (const v of values) next.push({ ...partial, [axis]: v });
    }
    combos = next;
  }

  const comboKey = (t: CoverageTarget): string =>
    eligibleByAxis.map(({ axis }) => t[axis]).join("\u0000");
  const comboUsed = new Map<string, number>();

  // Per draft, choose the combination that is (1) most starved by the sum of its
  // per-axis counts — the original water-fill signal, unchanged — and only then
  // (2) least used in THIS batch.
  //
  // That second key is the fix. The previous implementation water-filled each
  // axis into its own sequence and zipped them index-wise, which can only ever
  // emit `lcm(m, n)` of the `m x n` combinations: for two 2-value axes, 2 of 4 —
  // a hard diagonal no floor value escapes. Measured on prod 2026-08-21,
  // `tr-a1-imperative` held 10 rows of 2sg+affirmative and 10 of 2pl+negative
  // and NOTHING else, and `tr-a2-optative` 15/15 in the same shape, with every
  // floor satisfied on both. The module doc used to claim "the cross-product
  // emerges in the drafts"; it does not, and could not.
  //
  // Ordering matters: per-axis deficit stays PRIMARY, so single-axis specs
  // behave exactly as before and a genuinely starved value is still filled
  // first. The combination counter only breaks ties — which is precisely the
  // situation the diagonal arises in, since a diagonal pool leaves every
  // per-axis count balanced.
  const coverageTargets: CoverageTarget[] = [];
  for (let i = 0; i < need; i++) {
    let best = combos[0];
    let bestScore = Number.POSITIVE_INFINITY;
    let bestUsed = Number.POSITIVE_INFINITY;
    for (const combo of combos) {
      let score = 0;
      for (const { axis } of eligibleByAxis) {
        score += counts.get(`${axis}\u0000${combo[axis]}`) ?? 0;
      }
      const used = comboUsed.get(comboKey(combo)) ?? 0;
      if (score < bestScore || (score === bestScore && used < bestUsed)) {
        best = combo;
        bestScore = score;
        bestUsed = used;
      }
    }
    coverageTargets.push({ ...best });
    for (const { axis } of eligibleByAxis) {
      const k = `${axis}\u0000${best[axis]}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const ck = comboKey(best);
    comboUsed.set(ck, (comboUsed.get(ck) ?? 0) + 1);
  }
  return { coverageTargets, suppressed };
}
