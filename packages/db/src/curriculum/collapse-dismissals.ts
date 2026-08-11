/**
 * Collapse-dismissals ledger — every "this concentration is CORRECT" judgement,
 * recorded so `pnpm audit:collapse` stops re-triaging it on every run.
 *
 * Lives beside the curriculum because that is what it describes: a dismissal is
 * a statement about a grammar point's pedagogy, not about the audit tool. It is
 * also the durable record `docs/curriculum-authoring.md` already asks for
 * ("Record the 'no'") — previously scattered across PR descriptions.
 *
 * Keyed on (point, type, surface, signal). The SURFACE component is deliberate:
 * dismissing `es-a2-personal-a` for the dominant surface `a` must NOT mask a
 * different collapse on that same cell two quarters later. Use `surface: null`
 * only when the cell is legitimately concentrated whatever dominates.
 *
 * Seeded from the "Out of scope — metric false positives" section of
 * docs/superpowers/specs/2026-08-08-construction-variants-design.md.
 */

import { ExerciseType } from '@language-drill/shared';

export type CollapseSignal = 'answer-surface' | 'stem-monotony';

export type CollapseDismissal = Readonly<{
  grammarPointKey: string;
  type: ExerciseType;
  /** The dominant surface this dismissal covers; null dismisses the cell
   *  regardless of which surface dominates. */
  surface: string | null;
  signal: CollapseSignal;
  /** Why the concentration is correct. Non-empty; this is the whole value. */
  reason: string;
  /** ISO date (YYYY-MM-DD). Shown in the report so a stale dismissal is visible
   *  rather than silently permanent. */
  dismissedOn: string;
}>;

export const COLLAPSE_DISMISSALS: readonly CollapseDismissal[] = Object.freeze([
  {
    grammarPointKey: 'es-a2-personal-a',
    type: ExerciseType.CLOZE,
    surface: 'a',
    signal: 'answer-surface',
    reason:
      'The personal `a` IS the point. A cloze on this point has exactly one correct answer by construction, so 100% concentration is the target state, not a defect.',
    dismissedOn: '2026-08-11',
  },
  {
    grammarPointKey: 'es-b1-ser-location-events',
    type: ExerciseType.CLOZE,
    surface: null,
    signal: 'answer-surface',
    reason:
      'A ser/estar contrast point where `ser` is the answer and `estar` is the distractor, not an alternative answer. The 94% `ser` share measured in the 2026-08-08 sweep is correct; any dominant surface here is legitimate.',
    dismissedOn: '2026-08-11',
  },
  {
    grammarPointKey: 'es-a2-hace-ago',
    type: ExerciseType.CLOZE,
    surface: 'hace',
    signal: 'answer-surface',
    reason:
      '`hace + time` is a fixed construction; the marker is invariant and the variation lives in the time expression, which this metric does not read.',
    dismissedOn: '2026-08-11',
  },
  {
    grammarPointKey: 'tr-a2-enumerator-tane',
    type: ExerciseType.CLOZE,
    surface: 'tane',
    signal: 'answer-surface',
    reason:
      'The enumerator `tane` is the single target form of the point; a cloze blank on it admits no other answer.',
    dismissedOn: '2026-08-11',
  },
  {
    grammarPointKey: 'es-b1-adjective-de-infinitive',
    type: ExerciseType.CLOZE,
    surface: 'de',
    signal: 'answer-surface',
    reason:
      'The point is the fixed `adjective + de + infinitive` frame; `de` is invariant, and the adjective/infinitive variation is outside this metric.',
    dismissedOn: '2026-08-11',
  },
]);

/** True when the ledger already accounts for this exact finding. */
export function isDismissed(
  grammarPointKey: string,
  type: ExerciseType,
  surface: string,
  signal: CollapseSignal,
): boolean {
  return COLLAPSE_DISMISSALS.some(
    (d) =>
      d.grammarPointKey === grammarPointKey &&
      d.type === type &&
      d.signal === signal &&
      (d.surface === null || d.surface === surface),
  );
}
