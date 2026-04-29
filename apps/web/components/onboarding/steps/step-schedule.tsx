'use client';

// ---------------------------------------------------------------------------
// StepSchedule — Step 4 of 4
// ---------------------------------------------------------------------------
// Renders the eyebrow / headline / body copy and:
//   1. A 4-column grid of `Choice` tiles (`mode="radio"`) for the canonical
//      `DAILY_MINUTES` values (5 / 10 / 20 / 30). At ≥600px the grid is 4
//      columns; below 600px it collapses to a 2×2 layout. Each tile shows
//      the number in `t-display-m` and the caption "min / day" in a smaller
//      style, matching R5.1.
//   2. A `Card padding="md"` containing the gentle-nudges `Checkbox` plus
//      its label and the body copy from R5.3 (verbatim — see comment below).
//   3. A hand-script p.s. note (R5.4, verbatim) where only the literal
//      "p.s." is rendered in `accent` colour; the rest of the line uses the
//      regular ink colour.
//
// `initialNewUserState()` already seeds `dailyMinutes: 10` (R5.2 default), so
// the `10` tile starts selected without any mount-time dispatch from this
// component. The `gentleNudges` toggle defaults to `true` for the same reason.
//
// The headline / body copy below is not pinned by R5.x; we kept the lowercase
// voice consistent with the other three steps. If R5 ever pins these strings,
// update them here and in `step-schedule.test.tsx`.
// ---------------------------------------------------------------------------

import { DAILY_MINUTES } from '@language-drill/shared';
import { Card } from '../../ui/card';
import { Checkbox } from '../../ui/checkbox';
import { Choice } from '../../ui/choice';
import { useOnboarding } from '../onboarding-context';

// R5.3 verbatim — the apostrophe in "you've" is a regular ASCII apostrophe
// (U+0027), matching the requirements doc byte-for-byte.
const GENTLE_NUDGES_LABEL = 'gentle nudges on quiet days';
const GENTLE_NUDGES_BODY =
  "no streak shaming. one calm note if you've missed two days, never more.";

// R5.4 verbatim. The accent colour applies only to the literal "p.s." prefix;
// the rest of the line uses the default ink colour.
const PS_PREFIX = 'p.s.';
const PS_BODY = ' no XP, no levels, no leaderboards. honest skill numbers only.';

export function StepSchedule() {
  const { state, dispatch } = useOnboarding();

  return (
    <div className="flex flex-col gap-s-5">
      <header className="flex flex-col gap-s-2">
        <p className="t-micro text-ink-mute">step 4</p>
        <h2 className="t-display-l">
          how much time can you give me each day?
        </h2>
        <p className="t-body text-ink-mute">
          we&apos;ll keep sessions tight and respect your schedule.
        </p>
      </header>

      <div
        role="radiogroup"
        aria-label="daily time"
        className="grid grid-cols-2 gap-[12px] [@media(min-width:600px)]:grid-cols-4"
      >
        {DAILY_MINUTES.map((minutes) => (
          <Choice
            key={minutes}
            mode="radio"
            selected={state.dailyMinutes === minutes}
            onSelect={() =>
              dispatch({ type: 'setDailyMinutes', minutes })
            }
          >
            <span className="flex flex-col items-start">
              <span className="t-display-m text-ink">{minutes}</span>
              <span className="t-small text-ink-mute">min / day</span>
            </span>
          </Choice>
        ))}
      </div>

      <Card padding="md">
        {/* The Checkbox renders a `<button role="checkbox">`. A wrapping
            <label> would NOT auto-bind for screen readers (that behaviour is
            for native form controls only), so we point `aria-labelledby` at
            the visible label text — that's what makes the accessible name
            "gentle nudges on quiet days" rather than empty. */}
        <div className="flex items-start gap-s-3">
          <Checkbox
            checked={state.gentleNudges}
            onChange={(on) =>
              dispatch({ type: 'setGentleNudges', on })
            }
            className="-ml-s-2"
            aria-labelledby="gentle-nudges-label"
          />
          <div className="flex-1 flex flex-col gap-s-1">
            <span id="gentle-nudges-label" className="t-body text-ink">
              {GENTLE_NUDGES_LABEL}
            </span>
            <span className="t-small text-ink-mute">{GENTLE_NUDGES_BODY}</span>
          </div>
        </div>
      </Card>

      <p className="t-hand text-ink">
        <span className="text-accent">{PS_PREFIX}</span>
        {PS_BODY}
      </p>
    </div>
  );
}
