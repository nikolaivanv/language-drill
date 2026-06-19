import * as React from 'react';

// Per-exercise answer draft, persisted in sessionStorage so an in-progress
// answer survives a full page reload (e.g. toggling Chrome device emulation,
// an accidental refresh). sessionStorage — not localStorage — because the
// draft's lifetime should match the tab session: it survives reloads but
// auto-clears when the tab closes, so drafts never linger on disk or leak
// across sessions. Keyed by exercise id so a restored draft can only ever
// repopulate the exact exercise it came from.

const PREFIX = 'drill:draft:';

function storageKey(exerciseId: string | undefined): string | null {
  return exerciseId ? PREFIX + exerciseId : null;
}

function readDraft(key: string | null): string {
  if (key === null || typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/**
 * Answer state backed by a sessionStorage draft.
 *
 * Returns `[answer, setAnswer, clearDraft]`:
 * - `answer` initializes from the stored draft for `exerciseId` (empty if none).
 * - `setAnswer` updates the value and writes through to storage (empty removes
 *   the key).
 * - `clearDraft` removes the stored draft but leaves the in-memory `answer`
 *   untouched, so a locked/submitted field keeps showing what was typed.
 *
 * When `exerciseId` is undefined the hook is purely in-memory (no persistence),
 * so callers that don't have an id behave exactly like `useState('')`.
 */
export function useAnswerDraft(
  exerciseId: string | undefined,
): [string, (value: string) => void, () => void] {
  const key = storageKey(exerciseId);
  const [answer, setAnswerState] = React.useState<string>(() => readDraft(key));

  const setAnswer = React.useCallback(
    (value: string) => {
      setAnswerState(value);
      if (key === null || typeof window === 'undefined') return;
      try {
        if (value) {
          window.sessionStorage.setItem(key, value);
        } else {
          window.sessionStorage.removeItem(key);
        }
      } catch {
        // Private mode / quota — persistence is best-effort, never fatal.
      }
    },
    [key],
  );

  const clearDraft = React.useCallback(() => {
    if (key === null || typeof window === 'undefined') return;
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  }, [key]);

  return [answer, setAnswer, clearDraft];
}
