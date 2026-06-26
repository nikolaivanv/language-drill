'use client';

import * as React from 'react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';
import { useBodyScrollLock } from '../../lib/hooks/use-body-scroll-lock';
import { useFocusTrap } from '../../lib/hooks/use-focus-trap';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Optional header content shown to the left of the close button. */
  title?: React.ReactNode;
  /** Panel max height. Defaults to 78vh; ignored when `fullScreen` is set. */
  maxHeight?: string;
  /** Near-full-height variant (~92vh) — used by the theory sheet. */
  fullScreen?: boolean;
  /** Accessible label for the dialog (sheets have no guaranteed visible title). */
  ariaLabel: string;
  children: React.ReactNode;
}

// The single reusable bottom sheet for the language switcher, theory (mobile),
// word card, and word bank. Portals to <body>, slides up over a scrim, traps
// focus, locks background scroll, and closes on scrim/close-button/Escape.
export function BottomSheet({
  open,
  onClose,
  title,
  maxHeight = '78vh',
  fullScreen = false,
  ariaLabel,
  children,
}: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Hooks run unconditionally; both no-op while the sheet is closed.
  useBodyScrollLock(open);
  useFocusTrap(open, panelRef);

  // Escape dismisses the sheet while it is open.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const panelHeight = fullScreen ? '92vh' : undefined;
  const panelMaxHeight = fullScreen ? '92vh' : maxHeight;

  return createPortal(
    <div
      className="sheet-scrim fixed inset-0 z-[90] flex items-end justify-center bg-[rgba(26,22,18,0.42)]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={cn(
          'sheet-panel relative flex w-full flex-col overflow-hidden rounded-t-[24px] bg-paper shadow-3',
        )}
        style={{ height: panelHeight, maxHeight: panelMaxHeight }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle (decorative — close affordances are the scrim/button/Esc). */}
        <div className="flex flex-none justify-center pt-[10px] pb-[6px]" aria-hidden="true">
          <span className="h-[4px] w-[36px] rounded-pill bg-rule-strong" />
        </div>

        <header className="flex flex-none items-start justify-between gap-s-3 px-[18px] pb-s-3">
          <div className="min-w-0">{title}</div>
          <button
            type="button"
            className="-mr-[6px] -mt-[2px] flex h-[44px] w-[44px] flex-none items-center justify-center text-[22px] leading-none text-ink-soft transition-colors hover:text-ink"
            onClick={onClose}
            aria-label="close"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-[18px] pb-[18px]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
