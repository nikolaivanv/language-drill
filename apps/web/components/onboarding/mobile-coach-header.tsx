'use client';

// ---------------------------------------------------------------------------
// MobileCoachHeader
// ---------------------------------------------------------------------------
// The compact coach strip rendered at narrow viewports (`<lg`). Shows the
// existing app `Brand` and the per-step coach message from
// `selectCoachMessage(state)`. Hidden at `lg` and above — the full
// `<CoachPane />` takes over there.
//
// Per R6.8, this is the minimum viable coach UX at narrow widths: just brand
// + message. Avatar, "so far" checklist, and the footer note are intentionally
// omitted (they live only in the desktop pane). `aria-live="polite"` on the
// message paragraph announces step transitions to screen readers without
// interrupting current speech.
//
// The shell hides the desktop `<CoachPane />` below `lg` via `hidden lg:flex`
// (`display: none`), which already removes it from the accessibility tree —
// no `aria-hidden` is required to avoid duplicate announcements.
// ---------------------------------------------------------------------------

import { Brand } from '../shell/brand';
import { useOnboarding } from './onboarding-context';
import { selectCoachMessage } from './use-onboarding-reducer';

export function MobileCoachHeader() {
  const { state } = useOnboarding();
  const message = selectCoachMessage(state);

  return (
    <header
      data-testid="onboarding-mobile-coach-header"
      className="lg:hidden flex flex-col gap-s-2 border-b border-rule bg-paper-2 px-s-4 py-s-3"
    >
      <Brand />
      <p aria-live="polite" className="t-body text-ink-2">
        {message}
      </p>
    </header>
  );
}
