'use client';

// ---------------------------------------------------------------------------
// CoachPane
// ---------------------------------------------------------------------------
// The 320px-wide left rail of the onboarding wizard. Renders, top-to-bottom:
//   1. The existing app `Brand`.
//   2. A 44×44 avatar circle ("c" glyph) with "coach" + "your AI tutor"
//      labels.
//   3. A `Card`-bordered message box rendering the per-step coach copy from
//      `selectCoachMessage(state)`.
//   4. The `<SoFarChecklist />` showing per-step progress.
//   5. A bottom-aligned hand-script footer note ("~2 min total · skip
//      anything").
//
// Hidden below the `lg` breakpoint — the shell renders `<MobileCoachHeader />`
// in its place at narrow widths. The shell sets `aria-hidden="true"` on the
// rail at those widths so screen readers don't double-announce the message.
// ---------------------------------------------------------------------------

import { Brand } from '../shell/brand';
import { Card } from '../ui/card';
import { useOnboarding } from './onboarding-context';
import { SoFarChecklist } from './so-far-checklist';
import { selectCoachMessage } from './use-onboarding-reducer';

// `·` in the footer is U+00B7 (middle dot), matching the prototype copy.
const FOOTER_NOTE = '~2 min total · skip anything';

export function CoachPane() {
  const { state } = useOnboarding();
  const message = selectCoachMessage(state);

  return (
    <aside
      data-testid="onboarding-coach-pane"
      // Visible ≥761px; hidden at the canonical ≤760 breakpoint where the
      // MobileCoachHeader carries the coach intent (Req 10.1, 1.6). `hidden`
      // removes it from the a11y tree so the message isn't double-announced.
      className="flex mobile:hidden w-[320px] flex-shrink-0 flex-col gap-s-6 border-r border-rule bg-paper-2 px-s-6 py-[22px]"
    >
      <Brand />

      <div className="flex items-center gap-s-3">
        <span
          aria-hidden="true"
          className="flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center rounded-full bg-ink text-paper t-display-s"
        >
          c
        </span>
        <div className="flex flex-col">
          <span className="t-body text-ink">coach</span>
          <span className="t-small text-ink-mute">your AI tutor</span>
        </div>
      </div>

      <Card padding="md">
        <p className="t-body text-ink-2">{message}</p>
      </Card>

      <SoFarChecklist />

      <p className="mt-auto t-hand text-ink-mute">{FOOTER_NOTE}</p>
    </aside>
  );
}
