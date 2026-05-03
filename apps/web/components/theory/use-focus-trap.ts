import { useEffect, type RefObject } from 'react';

// Limited focus-trap. When `active`, focus is moved to the first focusable
// element inside `containerRef`, and Tab/Shift+Tab wrap around the first/last
// focusable elements so keyboard users cannot leave the dialog.
//
// The selector intentionally omits `select`, `textarea`, and `[contenteditable]`
// — the theory panel is a read-only reference and never renders form fields.
// If a future variant adds inputs, widen the selector at that point.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active) return;
    const initialContainer = containerRef.current;
    if (!initialContainer) return;

    // Auto-focus the first focusable element on activation.
    const initialFocusable = initialContainer.querySelectorAll<HTMLElement>(
      FOCUSABLE_SELECTOR,
    );
    if (initialFocusable.length > 0) {
      initialFocusable[0].focus();
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      // Re-read the ref each time so we handle teardown races correctly.
      const node = containerRef.current;
      if (!node) return;

      const focusable = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (activeEl === first || !node.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !node.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [active, containerRef]);
}
