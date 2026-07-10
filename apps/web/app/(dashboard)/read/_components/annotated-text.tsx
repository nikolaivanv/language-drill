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
// Selection model:
//   - Mouse (desktop): mousedown on a word arms a selection, mouseenter over
//     words extends the head, and a window-level mouseup finalizes it (so
//     releasing over whitespace still resolves) into the smallest span type
//     (word | phrase | sentence). The trailing synthetic click is swallowed so
//     a drag isn't double-handled; a bare click (keyboard activation) is handled
//     directly. The begin/extend/finalize core is factored out for clarity.
//   - Touch (mobile): select-first drag. A horizontal drag from a word selects
//     a multi-word span live (the finger's word becomes the moving head) and
//     fires one `onSpanSelect` for the final span on release — so nothing covers
//     the passage during selection and a phrase costs a single model call. A
//     plain tap (no drag) falls through to the synthetic click → single word.
//     The listeners are native + non-passive (React attaches touch handlers
//     passively, which forbids the `preventDefault` that captures the gesture
//     and suppresses the trailing emulated mouse events); `touch-action: pan-y`
//     leaves a vertical drag to scroll the passage natively.
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
  /**
   * Words currently in the spaced-review rotation (Req 13.2). A token is under
   * review when its flag's `lemma` ∈ `lemmas` (primary) or its surface key ∈
   * `surfaces` (fallback for non-flagged words / annotations lacking a lemma).
   * Both sets are lowercased. Drives the distinct `.underReview` highlight.
   */
  underReview?: { lemmas: Set<string>; surfaces: Set<string> };
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

export function AnnotatedText({
  text,
  flaggedMap,
  intensity,
  bankSet,
  activeWord,
  savedWordKeys,
  underReview,
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
  // Wraps the rendered tokens so the touch adapter can attach native,
  // non-passive listeners (see the effect below).
  const rootRef = React.useRef<HTMLSpanElement>(null);

  const emitTap = React.useCallback((token: OffsetToken, rect: DOMRect) => {
    const live = liveRef.current;
    // onWordClick stays flagged-only (the parent's handler is skim-specific).
    if (live.flaggedMap[token.key]) live.onWordClick(token.key, rect);
    if (live.onSpanSelect) {
      live.onSpanSelect({ start: token.start, end: token.end, type: 'word', rect });
    }
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
    if (emit) {
      emit({ start, end, type, rect });
    }

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

  // ---- Touch adapter (mobile) ---------------------------------------------
  // Select-first drag, sharing the same begin/extend/finalize core as the mouse
  // adapter. Native listeners (not React props) because `onTouchMove` is passive
  // under React, and we must `preventDefault` to (a) stop the passage scrolling
  // mid-selection and (b) cancel the emulated mouse/click events that would
  // otherwise re-handle the drag as a single-word tap.
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const START_THRESHOLD = 8; // px of travel before a horizontal drag counts
    let startIndex: number | null = null;
    let startX = 0;
    let startY = 0;
    let selecting = false;

    const wordAt = (
      x: number,
      y: number,
    ): { index: number; rect: DOMRect } | null => {
      const el = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>('[data-idx]');
      if (!el) return null;
      return { index: Number(el.dataset.idx), rect: el.getBoundingClientRect() };
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const hit =
        (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-idx]') ??
        document.elementFromPoint(t.clientX, t.clientY)?.closest<HTMLElement>('[data-idx]') ??
        null;
      startIndex = hit ? Number(hit.dataset.idx) : null;
      startX = t.clientX;
      startY = t.clientY;
      selecting = false;
    };

    const onMove = (e: TouchEvent) => {
      if (startIndex === null || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (!selecting) {
        // Commit to a selection only on a clearly horizontal drag; a vertical
        // drag is a scroll (touch-action: pan-y handles it) — bail out.
        if (Math.abs(dx) > START_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
          selecting = true;
          beginSelection(startIndex, wordAt(startX, startY)?.rect ?? new DOMRect());
        } else if (Math.abs(dy) > START_THRESHOLD) {
          startIndex = null;
          return;
        } else {
          return;
        }
      }
      // Own the gesture: stop the scroll + suppress the emulated mouse events.
      e.preventDefault();
      const hit = wordAt(t.clientX, t.clientY);
      if (hit) extendSelection(hit.index, hit.rect);
    };

    const onEnd = () => {
      if (selecting) finalizeSelection();
      startIndex = null;
      selecting = false;
    };

    root.addEventListener('touchstart', onStart, { passive: false });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd, { passive: false });
    root.addEventListener('touchcancel', onEnd, { passive: false });
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
    };
  }, [beginSelection, extendSelection, finalizeSelection]);

  return (
    <span ref={rootRef}>
      {tokens.map((token, i) => {
        if (token.kind === 'sep') {
          // Leading punctuation (the run before the first whitespace, e.g. the
          // "." in ". ") is pinned to the PRECEDING word by its no-break wrapper
          // below, so drop it here to avoid rendering it twice. The remaining
          // whitespace stays a normal line-break opportunity.
          const prev = tokens[i - 1];
          const raw =
            prev && prev.kind === 'word'
              ? token.raw.slice(leadingPunct(token.raw).length)
              : token.raw;
          return <React.Fragment key={i}>{raw}</React.Fragment>;
        }
        // Pull the following separator's leading punctuation into this word's
        // no-break wrapper so a sentence-final "." can't orphan to the next line.
        const next = tokens[i + 1];
        const glued = next && next.kind === 'sep' ? leadingPunct(next.raw) : '';
        const flag = flaggedMap[token.key];
        const isFlagged = Boolean(flag);
        const inBank = bankSet.has(token.key) || Boolean(savedWordKeys?.has(token.key));
        const isActive = activeWord === token.key;
        const inSelection = selRange !== null && i >= selRange.min && i <= selRange.max;
        // Under review: flag lemma matches (primary) or surface key matches
        // (fallback — covers non-flagged words still in the rotation) (Req 13.2).
        const isUnderReview = Boolean(
          underReview &&
            ((flag && underReview.lemmas.has(flag.lemma.toLowerCase())) ||
              underReview.surfaces.has(token.key)),
        );
        return (
          <span key={i} className={styles.noBreak}>
            <button
              type="button"
              data-word={token.key}
              data-idx={i}
              className={cn(
                styles.word,
                // Highlight classes apply to flagged words only; non-flagged
                // words stay visually plain but remain interactive.
                isFlagged && styles[intensity],
                isFlagged && inBank && styles.saved,
                isUnderReview && styles.underReview,
                isActive && styles.active,
                inSelection && styles.selecting,
              )}
              onMouseDown={(e) => handleMouseDown(i, e)}
              onMouseEnter={(e) => handleMouseEnter(i, e)}
              onClick={(e) => handleClick(token, e)}
            >
              {token.raw}
            </button>
            {glued}
          </span>
        );
      })}
    </span>
  );
}

// Leading run of non-whitespace characters in a separator's raw text — the
// punctuation (".", ",", "”", ")", …) that directly abuts the preceding word.
// Empty when the separator starts with whitespace (a plain inter-word space).
function leadingPunct(raw: string): string {
  return /^\S*/.exec(raw)?.[0] ?? '';
}
