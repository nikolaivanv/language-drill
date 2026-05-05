'use client';

// ---------------------------------------------------------------------------
// InlineErrorToast — bottom-right notification for save / bank failures
// ---------------------------------------------------------------------------
// Fixed-position layer (bottom-right), accent palette, `role="status"` +
// `aria-live="polite"`. Auto-dismiss is parent-driven — the page schedules
// the timeout, the toast itself is pure render. Copy is kind-driven so
// the parent does not need to construct the message string (Requirement
// 11.6).
// ---------------------------------------------------------------------------

type Kind = 'save' | 'bank';

type Props = {
  kind: Kind;
  onDismiss: () => void;
};

const COPY: Record<Kind, string> = {
  save: "couldn't save — try again",
  bank: "couldn't update — try again",
};

export function InlineErrorToast({ kind, onDismiss }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[24px] right-[24px] z-50 flex items-center gap-[10px] rounded-r-md border border-accent bg-accent px-[14px] py-[10px] text-white shadow-3"
    >
      <span className="t-small">{COPY[kind]}</span>
      <button
        type="button"
        aria-label="dismiss"
        onClick={onDismiss}
        className="flex h-[20px] w-[20px] cursor-pointer items-center justify-center border-none bg-transparent p-0 text-[16px] leading-none text-white opacity-70 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}
