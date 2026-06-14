/**
 * Pure coverage-controller decision logic for the **person** axis (Pool Coverage
 * Controller, Phase 1). No `@aws-sdk/*`, no Drizzle, no env reads — pure inputs →
 * pure output, unit-tested in isolation. Mirrors `scheduler-decision.ts`.
 *
 * Turns the scalar `need` from `decideEnqueue` into an explicit per-draft
 * `PersonCode[]` by greedily water-filling each draft into the eligible person
 * currently lowest in the approved pool — which realizes the uniform per-person
 * floor (`ceil(target / N)`) without an explicit floor term, and covers both the
 * deficit regime (starved persons first) and the top-up regime (level persons,
 * spread evenly) in one loop. Buckets that were targeted last batch but yielded
 * nothing are suppressed (excluded), cleared upstream by a CURRICULUM_VERSION
 * bump (the caller passes `recentOutcome: null` in that case).
 */

import type { Language, PersonCode, PersonOutcome } from '@language-drill/shared';
import { personCodesForLanguage } from '@language-drill/ai';
import { GIVE_UP_MIN_ATTEMPTS } from './cell-targets';

export { GIVE_UP_MIN_ATTEMPTS };

export type CoverageDecisionInput = {
  language: Exclude<Language, Language.EN>;
  /** decideEnqueue's scalar need (= target − approvedInPool). */
  need: number;
  /** Measured approved-pool count per person (from coverage_tags GROUP BY). */
  approvedByPerson: Partial<Record<PersonCode, number>>;
  /**
   * The most-recent succeeded job's per-person outcome — ONLY when that job's
   * curriculumVersion matches the on-disk constant. `null` clears all give-up
   * (no recent job, or a curriculum bump invalidated the suppression).
   */
  recentOutcome: PersonOutcome | null;
};

export type CoverageDecision = {
  /** length === max(0, need); [] ⇒ caller omits spec.personTargets (blind). */
  personTargets: PersonCode[];
  /** Buckets excluded as zero-yield — surfaced for the scheduler's log line. */
  suppressed: PersonCode[];
};

export function decideCoverageTargets(
  input: CoverageDecisionInput,
): CoverageDecision {
  const { language, need, approvedByPerson, recentOutcome } = input;
  const persons = personCodesForLanguage(language);

  const suppressed = persons.filter((p) => {
    const o = recentOutcome?.[p];
    return o !== undefined && o.requested >= GIVE_UP_MIN_ATTEMPTS && o.approved === 0;
  });

  if (need <= 0) return { personTargets: [], suppressed };

  const eligible = persons.filter((p) => !suppressed.includes(p));
  if (eligible.length === 0) return { personTargets: [], suppressed };

  // Running projected count per eligible person, seeded from the approved pool.
  const counts = new Map<PersonCode, number>(
    eligible.map((p) => [p, approvedByPerson[p] ?? 0]),
  );

  const personTargets: PersonCode[] = [];
  for (let i = 0; i < need; i++) {
    // Pick the eligible person with the smallest projected count; ties broken by
    // paradigm order (the first such person in `eligible`).
    let best = eligible[0];
    for (const p of eligible) {
      if ((counts.get(p) ?? 0) < (counts.get(best) ?? 0)) best = p;
    }
    personTargets.push(best);
    counts.set(best, (counts.get(best) ?? 0) + 1);
  }

  return { personTargets, suppressed };
}
