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

export const STATE_TITLE: Record<MovementState, string> = {
  none: 'session done.',
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
): MovementSummary {
  const gained = movements.filter(
    (m) => m.band === 'gain' || m.band === 'strong-gain',
  ).length;
  const slipped = movements.filter((m) => m.band === 'slip').length;
  const fresh = movements.filter((m) => m.band === 'new').length;

  // First match wins. `new` never decides the title when a gain or slip is
  // present — it only reaches rule 5 as the sole mover.
  let state: MovementState;
  let subline: string;

  if (movements.length === 0) {
    state = 'none';
    subline = 'nothing graded this round';
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
    subline = "nothing shifted much — that's normal";
  }

  return { state, title: STATE_TITLE[state], subline };
}
