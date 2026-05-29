'use client';

// ---------------------------------------------------------------------------
// AnnotatedText — render the tokenized passage with every word interactive
// ---------------------------------------------------------------------------
// Tokenize once per `text` change (annotating offsets as we walk so each word
// carries its `[start, end)` character span), then render every `word` token as
// a `<button>` and every `sep` token as plain text. Flagged words additionally
// carry the intensity/saved/active highlight classes; non-flagged words are
// plain-looking but still tappable (Req 3.2 — tap any word).
//
// Two interaction channels:
//   - `onWordClick(word, rect)` — fired for a tap on a FLAGGED word only,
//     preserving the existing skim-popover behavior (the parent's handler is
//     flagged-specific). Task 28 unifies this with the deep path.
//   - `onSpanSelect({ start, end, type, rect })` — fired for EVERY tap (as a
//     `word` span) and for mouse-drag selections mapped to the smallest span
//     type (word | phrase | sentence). This is the deep-annotation channel
//     (Req 3.2, 4.1, 4.3, 5.1). The server recomputes the type authoritatively;
//     the `type` here is the client hint that drives card layout.
//
// Drag model: a word press arms a selection, moving over words extends the
// head, and releasing finalizes it (so releasing over whitespace still
// resolves). The trailing synthetic click after a pointer interaction is
// swallowed so a tap isn't double-handled; a bare click (no preceding press,
// e.g. keyboard activation) is handled directly.
//
// The selection *core* (begin/extend/finalize) is input-agnostic; two adapters
// feed it:
//   - Mouse: mousedown arms, mouseenter extends, a window-level mouseup
//     finalizes.
//   - Touch: a long-press (~400 ms held still) arms — a quick tap stays a
//     single-word tap and an immediate swipe scrolls the passage — then dragging
//     extends (via `elementFromPoint`, since touchmove targets don't change as
//     the finger moves) and lifting finalizes. Scroll is suppressed only while a
//     selection is active, via a non-passive `touchmove` `preventDefault`
//     (`touch-action`/pointer-event `preventDefault` can't do this per-gesture).
//
// Visuals come from `word-flag-styles.module.css` — no inline styles.
// ---------------------------------------------------------------------------

import * as React from 'react';
import { tokenize, type FlaggedMap } from '@language-drill/shared';
import { cn } from '../../../../lib/cn';
import type { Intensity } from '../_state/read-page-reducer';
import styles from './word-flag-styles.module.css';

/** Span shapes the card can render — must match the server's resolution. */
export type SpanType = 'word' | 'phrase' | 'sentence';

/** A resolved selection reported to the parent. */
export type SpanSelection = {
  /** Character offsets into the passage `text`. */
  start: number;
  end: number;
  /** Client-side span-type hint; the server recomputes authoritatively. */
  type: SpanType;
  /** Bounding rect of the selection, for anchoring the card. */
  rect: DOMRect;
};

type OffsetToken = {
  kind: 'word' | 'sep';
  raw: string;
  key: string;
  start: number;
  end: number;
};

type Props = {
  text: string;
  flaggedMap: FlaggedMap;
  intensity: Intensity;
  bankSet: Set<string>;
  activeWord: string | null;
  /**
   * Lowercased surface forms saved to vocabulary via a deep card (Req 8.4).
   * Like `bankSet`, these flip flagged tokens to the `.saved` style; tracked
   * separately so a vocabulary save stays independent of the entry bank
   * (Req 11.7).
   */
  savedWordKeys?: Set<string>;
  onWordClick: (word: string, rect: DOMRect) => void;
  onSpanSelect?: (span: SpanSelection) => void;
};

// ---------------------------------------------------------------------------
// Span-type resolution — mirrors `infra/lambda/src/routes/read-span-utils.ts`
// so the client hint matches the server's authoritative decision.
// ---------------------------------------------------------------------------

const TERMINATORS = new Set(['.', '!', '?']);
const WS_RE = /\s/u;

function isSpace(ch: string): boolean {
  return WS_RE.test(ch);
}

/** Trim leading/trailing whitespace AND trailing terminal punctuation. */
function contentRange(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  let s = start;
  let e = end;
  while (s < e && isSpace(text[s])) s++;
  while (e > s && (isSpace(text[e - 1]) || TERMINATORS.has(text[e - 1]))) e--;
  return { start: s, end: e };
}

function detectSentenceRanges(
  text: string,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    while (i < n && isSpace(text[i])) i++;
    if (i >= n) break;
    const start = i;
    while (i < n && !TERMINATORS.has(text[i])) i++;
    while (i < n && TERMINATORS.has(text[i])) i++;
    ranges.push({ start, end: i });
  }
  return ranges;
}

function wordCountInRange(
  tokens: OffsetToken[],
  start: number,
  end: number,
): number {
  let count = 0;
  for (const t of tokens) {
    if (t.kind === 'word' && t.start >= start && t.end <= end) count++;
  }
  return count;
}

function resolveSpanType(
  text: string,
  start: number,
  end: number,
  tokens: OffsetToken[],
): SpanType {
  if (wordCountInRange(tokens, start, end) <= 1) return 'word';
  const sel = contentRange(text, start, end);
  for (const range of detectSentenceRanges(text)) {
    const content = contentRange(text, range.start, range.end);
    if (content.start === sel.start && content.end === sel.end) {
      return 'sentence';
    }
  }
  return 'phrase';
}

/** Smallest rect covering both inputs; tolerant of a missing input. */
function unionRect(a: DOMRect | null, b: DOMRect | null): DOMRect {
  if (!a) return b ?? new DOMRect();
  if (!b) return a;
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.right, b.right);
  const bottom = Math.max(a.bottom, b.bottom);
  return new DOMRect(left, top, right - left, bottom - top);
}

// Touch tuning. A press must be held this long (and stay within the slop
// radius) to arm a selection — shorter is a tap, moving sooner is a scroll.
const LONG_PRESS_MS = 400;
const MOVE_SLOP_PX = 10;

/** The word `<button>` under a point (or null) — hit-tested for touch drag,
 *  since a touchmove's target stays the element the finger first touched. */
function wordAtPoint(x: number, y: number): HTMLElement | null {
  return document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-idx]') ?? null;
}

export function AnnotatedText({
  text,
  flaggedMap,
  intensity,
  bankSet,
  activeWord,
  savedWordKeys,
  onWordClick,
  onSpanSelect,
}: Props) {
  // Tokenize and annotate each token with its character offsets. The tokenizer
  // reconstructs the passage byte-for-byte, so accumulating `raw.length` yields
  // exact offsets.
  const tokens = React.useMemo<OffsetToken[]>(() => {
    let offset = 0;
    return tokenize(text).map((t) => {
      const start = offset;
      offset += t.raw.length;
      return { ...t, start, end: offset };
    });
  }, [text]);

  // Latest props/derived values, read by the stable window mouseup handler so
  // it never needs re-subscribing (add/remove stay symmetric).
  const liveRef = React.useRef({ tokens, text, flaggedMap, onWordClick, onSpanSelect });
  liveRef.current = { tokens, text, flaggedMap, onWordClick, onSpanSelect };

  // Selection (token indices) — refs drive finalize; state drives the highlight.
  const selectionRef = React.useRef<{ anchor: number; head: number } | null>(null);
  const anchorRectRef = React.useRef<DOMRect | null>(null);
  const headRectRef = React.useRef<DOMRect | null>(null);
  // True immediately after a pointer/touch interaction so the trailing
  // synthetic click is ignored.
  const pointerHandledRef = React.useRef(false);
  const [selRange, setSelRange] = React.useState<{ min: number; max: number } | null>(null);

  const emitTap = React.useCallback((token: OffsetToken, rect: DOMRect) => {
    const live = liveRef.current;
    // onWordClick stays flagged-only (the parent's handler is skim-specific).
    if (live.flaggedMap[token.key]) live.onWordClick(token.key, rect);
    live.onSpanSelect?.({ start: token.start, end: token.end, type: 'word', rect });
  }, []);

  // ---- Selection core (input-agnostic) ------------------------------------
  // All three read/write the refs above + the highlight state, so the mouse and
  // touch adapters share identical begin/extend/finalize behaviour.

  const beginSelection = React.useCallback((index: number, rect: DOMRect) => {
    selectionRef.current = { anchor: index, head: index };
    anchorRectRef.current = rect;
    headRectRef.current = rect;
    setSelRange({ min: index, max: index });
  }, []);

  const extendSelection = React.useCallback((index: number, rect: DOMRect) => {
    const sel = selectionRef.current;
    if (!sel) return;
    selectionRef.current = { anchor: sel.anchor, head: index };
    headRectRef.current = rect;
    setSelRange({ min: Math.min(sel.anchor, index), max: Math.max(sel.anchor, index) });
  }, []);

  const finalizeSelection = React.useCallback(() => {
    const sel = selectionRef.current;
    selectionRef.current = null;
    setSelRange(null);
    if (!sel) return;
    pointerHandledRef.current = true;

    const { tokens: toks, text: txt, onSpanSelect: emit } = liveRef.current;
    const min = Math.min(sel.anchor, sel.head);
    const max = Math.max(sel.anchor, sel.head);
    const start = toks[min].start;
    const end = toks[max].end;
    const rect = unionRect(anchorRectRef.current, headRectRef.current);

    if (min === max) {
      // No drag — a tap.
      emitTap(toks[min], anchorRectRef.current ?? rect);
      return;
    }
    const type = resolveSpanType(txt, start, end, toks);
    emit?.({ start, end, type, rect });

    // After a press on word A and release on word B (A≠B), browsers fire a
    // synthetic click on the common ancestor — the rd-text container — which
    // its outside-click handler then treats as a "dismiss the open card" tap.
    // Swallow that one trailing click so the just-opened deep card sticks.
    const swallow = (e: MouseEvent) => {
      e.stopPropagation();
      window.removeEventListener('click', swallow, true);
    };
    window.addEventListener('click', swallow, true);
  }, [emitTap]);

  // ---- Mouse adapter ------------------------------------------------------
  // Stable handler (empty deps) — reads everything through refs so the same
  // function instance is added and removed from `window`.
  const onWindowMouseUp = React.useCallback(() => {
    window.removeEventListener('mouseup', onWindowMouseUp);
    finalizeSelection();
  }, [finalizeSelection]);

  const handleMouseDown = (index: number, e: React.MouseEvent<HTMLButtonElement>) => {
    // Suppress native text selection so the drag is ours.
    e.preventDefault();
    beginSelection(index, e.currentTarget.getBoundingClientRect());
    window.addEventListener('mouseup', onWindowMouseUp);
  };

  const handleMouseEnter = (index: number, e: React.MouseEvent<HTMLButtonElement>) => {
    extendSelection(index, e.currentTarget.getBoundingClientRect());
  };

  const handleClick = (token: OffsetToken, e: React.MouseEvent<HTMLButtonElement>) => {
    // Swallow the click that trails a pointer interaction already handled by
    // the window mouseup / touchend; allow a bare click (keyboard) through.
    if (pointerHandledRef.current) {
      pointerHandledRef.current = false;
      return;
    }
    emitTap(token, e.currentTarget.getBoundingClientRect());
  };

  // ---- Touch adapter (long-press → drag) ----------------------------------
  // Native listeners on `document`: this component renders a fragment (no
  // element of its own), and handlers early-return unless the touch is inside a
  // `[data-idx]` word, which only this component renders. `touchmove` is
  // non-passive so we can `preventDefault` to suppress scroll *while selecting*.
  const longPressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = React.useRef<{ x: number; y: number; index: number; rect: DOMRect } | null>(null);
  const selectingRef = React.useRef(false);

  React.useEffect(() => {
    const clearLongPress = () => {
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        // A second finger (pinch/zoom) abandons any pending/active selection.
        clearLongPress();
        if (selectingRef.current) {
          selectingRef.current = false;
          selectionRef.current = null;
          setSelRange(null);
        }
        return;
      }
      const t = e.touches[0];
      const word = (t.target as Element | null)?.closest<HTMLElement>('[data-idx]');
      if (!word) return;
      const index = Number(word.dataset.idx);
      if (!Number.isInteger(index)) return;
      const rect = word.getBoundingClientRect();
      touchStartRef.current = { x: t.clientX, y: t.clientY, index, rect };
      selectingRef.current = false;
      clearLongPress();
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        const start = touchStartRef.current;
        if (!start) return;
        selectingRef.current = true;
        beginSelection(start.index, start.rect); // anchor word highlights
        navigator.vibrate?.(10);
      }, LONG_PRESS_MS);
    };

    const onTouchMove = (e: TouchEvent) => {
      const start = touchStartRef.current;
      if (!start) return;
      const t = e.touches[0];
      if (!selectingRef.current) {
        // Moved before the long-press armed → it's a scroll: drop the timer and
        // let the browser handle it (no preventDefault).
        const moved = Math.hypot(t.clientX - start.x, t.clientY - start.y);
        if (moved > MOVE_SLOP_PX) {
          clearLongPress();
          touchStartRef.current = null;
        }
        return;
      }
      // Active selection — own the gesture and extend to the word under the
      // finger (touchmove targets don't update, so hit-test the point).
      e.preventDefault();
      const word = wordAtPoint(t.clientX, t.clientY);
      const index = word ? Number(word.dataset.idx) : NaN;
      if (!Number.isInteger(index)) return;
      extendSelection(index, word!.getBoundingClientRect());
    };

    const onTouchEnd = (e: TouchEvent) => {
      clearLongPress();
      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (selectingRef.current) {
        selectingRef.current = false;
        // Suppress the synthetic mouse click that follows touchend.
        e.preventDefault();
        finalizeSelection();
        return;
      }
      if (!start) return;
      // No long-press fired and we never bailed to scroll → a tap.
      e.preventDefault();
      pointerHandledRef.current = true;
      emitTap(liveRef.current.tokens[start.index], start.rect);
    };

    const onTouchCancel = () => {
      clearLongPress();
      touchStartRef.current = null;
      if (selectingRef.current) {
        selectingRef.current = false;
        selectionRef.current = null;
        setSelRange(null);
      }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', onTouchCancel);
    return () => {
      clearLongPress();
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [beginSelection, extendSelection, finalizeSelection, emitTap]);

  return (
    <>
      {tokens.map((token, i) => {
        if (token.kind === 'sep') {
          return <React.Fragment key={i}>{token.raw}</React.Fragment>;
        }
        const isFlagged = Boolean(flaggedMap[token.key]);
        const inBank = bankSet.has(token.key) || Boolean(savedWordKeys?.has(token.key));
        const isActive = activeWord === token.key;
        const inSelection = selRange !== null && i >= selRange.min && i <= selRange.max;
        return (
          <button
            key={i}
            type="button"
            data-word={token.key}
            data-idx={i}
            className={cn(
              styles.word,
              // Highlight classes apply to flagged words only; non-flagged
              // words stay visually plain but remain interactive.
              isFlagged && styles[intensity],
              isFlagged && inBank && styles.saved,
              isActive && styles.active,
              inSelection && styles.selecting,
            )}
            onMouseDown={(e) => handleMouseDown(i, e)}
            onMouseEnter={(e) => handleMouseEnter(i, e)}
            onClick={(e) => handleClick(token, e)}
          >
            {token.raw}
          </button>
        );
      })}
    </>
  );
}
