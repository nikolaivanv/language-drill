'use client';

// ---------------------------------------------------------------------------
// StepGoals — Step 3 of 4
// ---------------------------------------------------------------------------
// Renders the eyebrow / headline / body copy from R4.x and:
//   1. A grid of 6 multi-select goal tiles (`Choice` `mode="checkbox"`). At
//      ≥600px the grid is 2 columns × 3 rows; below 600px it collapses to a
//      single column. Tile order is fixed by the canonical `GOAL_IDS`
//      ordering exported from `@language-drill/shared` — the contract with
//      the requirements doc lives in that constant, not here.
//   2. An optional `Textarea` labelled "anything specific i should know?
//      (optional)" with a 500-char limit. Copy (label + placeholder) is
//      verbatim from R4.3.
//   3. An inline `${notes.length} / 500` counter in `t-small accent-2` that
//      appears ONLY when the notes value exceeds 500 chars (R4.5
//      paste-overflow). The Textarea sets `maxLength=500` as a UA hint, but
//      paste-overflow can still slip through; the counter surfaces that and
//      the reducer's `selectCanAdvance` (Step 3) gates the CTA.
//
// Step 3 is fully optional (R4.4): zero goals selected + empty notes still
// allows advancing. Decorative icons are wrapped in
// `<span aria-hidden="true">` so screen readers don't announce them — the
// label is the meaningful text.
// ---------------------------------------------------------------------------

import {
  GOAL_IDS,
  NOTES_MAX_LENGTH,
} from '@language-drill/shared';
import { Choice } from '../../ui/choice';
import { Textarea } from '../../ui/textarea';
import { useOnboarding } from '../onboarding-context';
import { GOAL_COPY } from '../../settings/goal-copy';
import { GoalIcon } from '../goal-icon';

// R4.3: placeholder text (verbatim — the trailing character is U+2026
// HORIZONTAL ELLIPSIS, not three dots).
const NOTES_PLACEHOLDER = 'e.g. I keep mixing up preterite vs imperfect…';
const NOTES_LABEL = 'anything specific i should know? (optional)';

export function StepGoals() {
  const { state, dispatch } = useOnboarding();
  const isOver = state.notes.length > NOTES_MAX_LENGTH;

  return (
    <div className="flex flex-col gap-s-5">
      <header className="flex flex-col gap-s-2">
        <p className="t-micro text-ink-mute">step 3</p>
        <h2 className="t-display-l">what do you want to drill?</h2>
        <p className="t-body text-ink-mute">
          pick whatever fits — even all of them. you can change this later.
        </p>
      </header>

      <div
        role="group"
        aria-label="goals"
        className="grid grid-cols-2 grid-rows-3 gap-[12px] mobile:grid-cols-1 mobile:grid-rows-none"
      >
        {GOAL_IDS.map((id) => {
          const { label, description } = GOAL_COPY[id];
          const selected = state.goals.includes(id);
          return (
            <Choice
              key={id}
              mode="checkbox"
              selected={selected}
              onSelect={() => dispatch({ type: 'toggleGoal', goal: id })}
              className="mobile:min-h-[48px]"
            >
              <span className="flex items-start gap-s-3 w-full">
                <span aria-hidden="true" className={selected ? 'text-accent' : 'text-ink-soft'}>
                  <GoalIcon id={id} />
                </span>
                <span className="flex-1 flex flex-col">
                  <span className="t-body text-ink">{label}</span>
                  <span className="t-small text-ink-mute">{description}</span>
                </span>
              </span>
            </Choice>
          );
        })}
      </div>

      <div className="flex flex-col gap-s-2">
        <label htmlFor="onboarding-notes" className="t-small text-ink-soft">
          {NOTES_LABEL}
        </label>
        <Textarea
          id="onboarding-notes"
          placeholder={NOTES_PLACEHOLDER}
          value={state.notes}
          onChange={(event) =>
            dispatch({ type: 'setNotes', notes: event.target.value })
          }
          maxLength={NOTES_MAX_LENGTH}
        />
        {isOver ? (
          <p
            role="status"
            aria-live="polite"
            className="t-small text-accent-2"
          >
            {state.notes.length} / {NOTES_MAX_LENGTH}
          </p>
        ) : null}
      </div>
    </div>
  );
}
