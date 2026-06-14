/**
 * Pure, axis-agnostic coverage-controller decision logic (Pool Coverage
 * Controller, Phase 2). No `@aws-sdk/*`, no Drizzle, no env — pure inputs →
 * pure output, unit-tested in isolation. Generalizes the Phase-1 person-only
 * water-fill: for each axis in the spec INDEPENDENTLY, greedily fill each draft
 * into the eligible value currently lowest in the approved pool (realizing the
 * per-value floors without an explicit floor term), then zip the per-axis
 * sequences into per-draft `CoverageTarget`s. The cross-product emerges in the
 * drafts but is never measured or suppressed — give-up is strictly
 * per-`(axis, value)`. A value absent from `floors` is "NA" (never targeted); a
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

  // Build an independent water-filled sequence of length `need` per axis.
  const perAxisSeq: Partial<Record<CoverageAxis, string[]>> = {};
  for (const axis of spec.axes) {
    const eligible = orderedFloorValues(axis).filter(
      (v) => !(suppressed[axis.name]?.includes(v) ?? false),
    );
    if (eligible.length === 0) continue; // axis contributes no constraint
    const counts = new Map<string, number>(
      eligible.map((v) => [v, approvedByAxis[axis.name]?.[v] ?? 0]),
    );
    const seq: string[] = [];
    for (let i = 0; i < need; i++) {
      let best = eligible[0];
      for (const v of eligible) {
        if ((counts.get(v) ?? 0) < (counts.get(best) ?? 0)) best = v;
      }
      seq.push(best);
      counts.set(best, (counts.get(best) ?? 0) + 1);
    }
    perAxisSeq[axis.name] = seq;
  }

  const activeAxes = Object.keys(perAxisSeq) as CoverageAxis[];
  if (activeAxes.length === 0) return { coverageTargets: [], suppressed };

  const coverageTargets: CoverageTarget[] = [];
  for (let i = 0; i < need; i++) {
    const target: CoverageTarget = {};
    for (const axis of activeAxes) target[axis] = perAxisSeq[axis]![i];
    coverageTargets.push(target);
  }
  return { coverageTargets, suppressed };
}
