import * as React from 'react';

// Keyboard-flow helpers shared by the standard drill and fluency mode, so a
// learner can run a whole session without the mouse: type → submit → advance.

/**
 * onKeyDown for a SINGLE-LINE input: plain Enter submits. Shift+Enter and IME
 * composition are ignored. (Cloze's inline blank uses the same rule inline.)
 */
export function submitOnEnter(submit: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
}

/**
 * onKeyDown for a MULTI-LINE textarea: Cmd/Ctrl+Enter submits, so plain Enter
 * stays a newline. IME composition is ignored.
 */
export function submitOnModEnter(submit: () => void) {
  return (e: React.KeyboardEvent) => {
    if (
      e.key === 'Enter' &&
      (e.metaKey || e.ctrlKey) &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      submit();
    }
  };
}

/**
 * While mounted, advance (e.g. to the next exercise) when the learner presses
 * plain Enter anywhere on the page. Mounted only on the post-answer feedback,
 * so it reads as "Enter = next". Guards:
 *  - `e.repeat` is ignored, so holding Enter to submit doesn't skip the verdict;
 *  - IME composition and Shift+Enter are ignored;
 *  - Enter landing on a focused button/link/field is left to that element,
 *    avoiding a double-advance when the next button itself has focus.
 */
export function useAdvanceOnEnter(onAdvance: () => void) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter' || e.repeat || e.shiftKey || e.isComposing) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        typeof target.closest === 'function' &&
        target.closest('button, a, input, textarea, select, [role="button"]')
      ) {
        return;
      }
      e.preventDefault();
      onAdvance();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAdvance]);
}
