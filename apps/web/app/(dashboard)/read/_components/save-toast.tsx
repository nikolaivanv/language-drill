'use client';

// ---------------------------------------------------------------------------
// SaveToast — bottom-center notification after a successful entry save
// ---------------------------------------------------------------------------
// Fixed-position layer (bottom: 80px), `role="status"` + `aria-live="polite"`
// so screen readers pick it up without interrupting other live regions.
// Auto-dismiss is parent-driven (the page reducer's `DISMISS_SAVE_TOAST`
// action). The "see next session" button delegates routing to the parent
// (Requirement 8.6).
// ---------------------------------------------------------------------------

import { Button } from '../../../../components/ui/button';

type Props = {
  count: number;
  onSeeNextSession: () => void;
  onDismiss: () => void;
};

export function SaveToast({ count, onSeeNextSession, onDismiss }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[80px] left-1/2 z-50 flex w-[min(540px,calc(100vw-32px))] -translate-x-1/2 items-center gap-[12px] rounded-r-md bg-ink px-[18px] py-[14px] text-paper shadow-3 mobile:bottom-[88px] mobile:left-[16px] mobile:right-[16px] mobile:w-auto mobile:translate-x-0"
    >
      <span
        aria-hidden
        className="flex h-[24px] w-[24px] flex-none items-center justify-center rounded-full text-[14px] font-semibold"
        style={{ background: 'var(--color-ok-soft)', color: 'var(--color-ok)' }}
      >
        ✓
      </span>
      <p className="t-small flex-1 leading-[1.45]">
        <strong className="font-semibold">
          {count} {count === 1 ? 'word' : 'words'} added
        </strong>{' '}
        to your bank.
        <br />
        your next session will weave them in.
      </p>
      <Button variant="default" size="sm" onClick={onSeeNextSession}>
        see next session
      </Button>
      <button
        type="button"
        aria-label="dismiss"
        onClick={onDismiss}
        className="flex h-[24px] w-[24px] cursor-pointer items-center justify-center border-none bg-transparent p-0 text-[18px] leading-none"
        style={{ color: 'rgba(250, 247, 241, 0.5)' }}
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VocabSaveToast — confirmation + undo after a deep card → vocabulary save
// ---------------------------------------------------------------------------
// The brief confirmation toast for Requirement 8.4, with the undo affordance
// of Requirement 8.5. Distinct from `SaveToast` (the whole-entry "N words →
// bank" flow): this fires per deep word/phrase card save, names the saved
// item, and offers an inline "undo" that deletes the just-created vocabulary
// record. Shares the fixed-position chrome + `role="status"` a11y of
// `SaveToast`; auto-dismiss is parent-driven.
// ---------------------------------------------------------------------------

export function VocabSaveToast({
  label,
  onUndo,
  onDismiss,
}: {
  /** The saved item's surface form, shown in the confirmation. */
  label: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[80px] left-1/2 z-50 flex w-[min(440px,calc(100vw-32px))] -translate-x-1/2 items-center gap-[12px] rounded-r-md bg-ink px-[18px] py-[14px] text-paper shadow-3 mobile:bottom-[88px] mobile:left-[16px] mobile:right-[16px] mobile:w-auto mobile:translate-x-0"
    >
      <span
        aria-hidden
        className="flex h-[24px] w-[24px] flex-none items-center justify-center rounded-full text-[14px] font-semibold"
        style={{ background: 'var(--color-ok-soft)', color: 'var(--color-ok)' }}
      >
        ✓
      </span>
      <p className="t-small flex-1 leading-[1.45]">
        saved <strong className="font-semibold">“{label}”</strong> to vocabulary.
      </p>
      <Button variant="default" size="sm" onClick={onUndo}>
        undo
      </Button>
      <button
        type="button"
        aria-label="dismiss"
        onClick={onDismiss}
        className="flex h-[24px] w-[24px] cursor-pointer items-center justify-center border-none bg-transparent p-0 text-[18px] leading-none"
        style={{ color: 'rgba(250, 247, 241, 0.5)' }}
      >
        ×
      </button>
    </div>
  );
}
