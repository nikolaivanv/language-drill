import type { SkillMovement } from '@language-drill/shared';

// Single source of truth for the post-session debrief headline. Maps the bands
// already present on the payload to a session-shaped verdict.
//
// The header states the SHAPE of the session; SkillMovementsPanel is the only
// place point names and bands appear. Keeping those jobs separate is what stops
// the two from contradicting each other — the failure this replaced, where
// "you got 5 of 5 · accuracy 100%" sat directly above "slipped".
//
// No banding happens here and no mastery number is ever read: `band` is computed
// server-side precisely so the client cannot render raw scores.

export type MovementState =
  | 'none'
  | 'mixed'
  | 'slipped'
  | 'gained'
  | 'new'
  | 'steady';

export interface MovementSummary {
  state: MovementState;
  title: string;
  subline: string;
}

const STATE_TITLE: Record<MovementState, string> = {
  none: 'nothing answered.',
  mixed: 'mixed session.',
  slipped: 'worth another look.',
  gained: 'solid session.',
  new: 'new ground.',
  steady: 'steady session.',
};

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four',
  'five', 'six', 'seven', 'eight', 'nine',
] as const;

/** Spelled out for 0–9, digits from 10 up. Subline copy only. */
function count(n: number): string {
  return n < NUMBER_WORDS.length ? NUMBER_WORDS[n]! : String(n);
}

function pluralSkills(n: number): string {
  return `${count(n)} ${n === 1 ? 'skill' : 'skills'}`;
}

export function movementSummary(
  movements: readonly SkillMovement[],
  attemptedCount: number,
): MovementSummary {
  const gained = movements.filter(
    (m) => m.band === 'gain' || m.band === 'strong-gain',
  ).length;
  const slipped = movements.filter((m) => m.band === 'slip').length;
  const fresh = movements.filter((m) => m.band === 'new').length;

  // First match wins. `new` never decides the title when a gain or slip is
  // present — it only reaches rule 5 as the sole mover.
  //
  // `none` requires BOTH an empty movement list AND zero attempts. A session
  // whose graded items all carry a null grammar_point_key also yields an
  // empty movement list, so `movements.length === 0` alone is not proof
  // nothing was graded — it already produced one false "nothing graded this
  // round" claim on a genuinely graded session. `attemptedCount` is the
  // independent signal that rules that out; when items were attempted but
  // nothing moved, rule 6 (steady) reports it instead.
  let state: MovementState;
  let subline: string;

  if (movements.length === 0 && attemptedCount === 0) {
    state = 'none';
    subline = 'every item skipped this round';
  } else if (gained > 0 && slipped > 0) {
    state = 'mixed';
    subline = `${count(gained)} gained · ${count(slipped)} slipped`;
  } else if (slipped > 0) {
    state = 'slipped';
    subline = `${count(slipped)} slipped`;
  } else if (gained > 0) {
    state = 'gained';
    subline = `${pluralSkills(gained)} gained · nothing slipped`;
  } else if (fresh > 0) {
    state = 'new';
    subline = `${pluralSkills(fresh)} · first evidence`;
  } else {
    state = 'steady';
    subline = 'no skill moved far enough to call';
  }

  return { state, title: STATE_TITLE[state], subline };
}
