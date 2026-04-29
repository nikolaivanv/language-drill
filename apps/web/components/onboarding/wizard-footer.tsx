'use client';

// ---------------------------------------------------------------------------
// WizardFooter
// ---------------------------------------------------------------------------
// Bottom navigation row for the wizard right pane. Renders, left-to-right:
//   - a ghost "back" button (hidden on Step 1 in new mode, replaced by a
//     ghost "cancel" link in edit mode that points at `/settings`)
//   - a `t-mono` "X / 4" step counter
//   - the primary CTA, whose label depends on mode + step:
//       new  + step 1–3 → "continue →"
//       new  + step 4   → "finish setup →"
//       edit + step 1–3 → "continue →"
//       edit + step 4   → "save changes →"
//
// When `state.submission.status === 'error'` the footer renders a
// `role="alert"` message above the row in `t-small` `text-accent-2` so screen
// readers announce the failure (R7.8). The CTA disables when
// `selectCanAdvance(state)` is false or submission is loading, and shows the
// `Button`'s built-in `loading` spinner during submit (R7.7, R7.9).
//
// The footer doesn't decide what "continue" actually does on Step 4 — that's
// the parent's call (advance vs submit). The caller passes `onPrimary`; the
// `back` button dispatches `goBack` directly because that's purely a
// footer-internal concern.
//
// The smarter referrer-aware navigation for the cancel link in edit mode is
// handled by the submission orchestration (task 31c). For now `cancel`
// always points at `/settings` — the dashboard layout's redirect rules
// guarantee the user has a profile when they arrive here in edit mode, so
// `/settings` is a safe destination.
// ---------------------------------------------------------------------------

import { Button } from '../ui/button';
import { useOnboarding } from './onboarding-context';
import { selectCanAdvance } from './use-onboarding-reducer';

const STEP_COUNT = 4;

// Arrow character is U+2192 — copy must match design tokens exactly so
// future tests can assert on it.
const CTA_LABEL_CONTINUE = 'continue →';
const CTA_LABEL_FINISH = 'finish setup →';
const CTA_LABEL_SAVE = 'save changes →';

export interface WizardFooterProps {
  /**
   * Click handler for the primary CTA. The footer does not branch on
   * "advance" vs "submit" — the parent computes the right behaviour for
   * the current step and passes it in.
   */
  onPrimary: () => void;
}

export function WizardFooter({ onPrimary }: WizardFooterProps) {
  const { state, dispatch } = useOnboarding();

  const isEdit = state.mode === 'edit';
  const isLastStep = state.step === STEP_COUNT;
  const isLoading = state.submission.status === 'loading';
  const canAdvance = selectCanAdvance(state);
  // Narrow the discriminated union once so the `error.message` access
  // below typechecks without re-narrowing inside the JSX.
  const errorMessage =
    state.submission.status === 'error' ? state.submission.message : null;

  const ctaLabel = isLastStep
    ? isEdit
      ? CTA_LABEL_SAVE
      : CTA_LABEL_FINISH
    : CTA_LABEL_CONTINUE;

  // Step 1 in new mode hides the back slot entirely. Step 1 in edit mode
  // swaps it for a ghost cancel link. Steps 2–4 always show the back button.
  const leftControl = (() => {
    if (state.step === 1 && !isEdit) {
      return null;
    }
    if (state.step === 1 && isEdit) {
      return (
        <Button
          variant="ghost"
          size="md"
          href="/settings"
          data-testid="wizard-footer-cancel"
        >
          cancel
        </Button>
      );
    }
    return (
      <Button
        type="button"
        variant="ghost"
        size="md"
        onClick={() => dispatch({ type: 'goBack' })}
        data-testid="wizard-footer-back"
      >
        back
      </Button>
    );
  })();

  return (
    <div
      className="flex flex-col gap-s-2"
      data-testid="onboarding-wizard-footer"
    >
      {errorMessage ? (
        <p
          role="alert"
          className="t-small text-accent-2"
          data-testid="wizard-footer-error"
        >
          {errorMessage}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-s-4">
        <div className="flex min-w-[80px] justify-start">{leftControl}</div>
        <div
          className="t-mono text-ink-mute"
          data-testid="wizard-footer-counter"
        >
          {state.step} / {STEP_COUNT}
        </div>
        <div className="flex min-w-[80px] justify-end">
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={onPrimary}
            disabled={!canAdvance || isLoading}
            loading={isLoading}
            data-testid="wizard-footer-primary"
          >
            {ctaLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
