# Mobile conjugation drill: keyboard-open scroll + chip packing — Design

**Date:** 2026-07-05
**Status:** Approved

## Problem

On a phone (`/drill/conjugation`, mobile web) with the software keyboard open:

1. The browser's default scroll-focused-input-into-view leaves the viewport
   positioned so the exercise card (lemma + gloss + feature chips) is cut off
   above the fold while the "finish session" button is pulled into view. The
   learner sees controls instead of the prompt.
2. The feature chips wrap poorly: the subject badge takes row 1 with the long
   tense chip pushed to row 2 and the short polarity chip to row 3 — three rows
   where two would fit if short chips shared a row.

## Change 1 — scroll exercise to top when the keyboard opens (mobile only)

In `apps/web/app/(dashboard)/drill/_components/conjugation-exercise.tsx`:

- Add a ref on the component's root `div` (its first child is the prompt card,
  so aligning the root's top aligns the card's top).
- On answer-input focus, **only when `matchMedia('(max-width: 639px)')`
  matches** (phone-sized, matching Tailwind's `sm` breakpoint):
  - Attach a one-shot `window.visualViewport` `resize` listener — it fires when
    the keyboard finishes opening, *after* the browser has done its own
    scroll-input-into-view — and then call
    `root.scrollIntoView({ block: 'start' })`.
  - Also arm a ~350 ms fallback timeout for the case where the keyboard is
    already open (auto-focus on the next exercise re-fires focus but no
    viewport resize happens). Whichever fires first wins; both are cleaned up
    (on blur/unmount and after firing).
- Give the root a small `scroll-margin-top` (spacing token `s-2`) so the card
  is not glued to the viewport edge.

Result: lemma + chips + input stay above the fold; submit sits at/below the
fold edge and "finish session" falls below naturally. Desktop/tablet: zero
behavior change. No changes to `page.tsx` layout.

## Change 2 — chip packing (mobile only)

In `apps/web/components/drill/conjugation-feature-bundle.tsx`, `card` variant:

- Keep DOM order semantic (subject → features in stored order) so `≥sm`
  renders exactly as today.
- Compute a length rank per feature chip — `max(term.length, gloss.length)`
  ascending, stable on ties — and assign literal `max-sm:order-1` /
  `max-sm:order-2` / `max-sm:order-3` (…) classes from a static lookup array
  (Tailwind-JIT-safe; no dynamic class interpolation). The subject badge gets
  no order class (order 0), so it stays first.
- Below `sm`, short chips pack next to the subject badge: e.g. `sen` +
  `olumsuz` on row 1, the long tense chip alone on row 2.
- Fluency mode shares this component and gets the same fix (desirable — same
  problem there). The `inline` variant and the unstructured fallback are
  untouched.

## Testing

- `conjugation-feature-bundle.test.tsx`: order classes follow length rank;
  subject badge unranked; no order classes on the inline variant or the
  unstructured fallback.
- `conjugation-exercise.test.tsx`: with mocked `matchMedia` +
  `visualViewport`, input focus at phone width triggers `scrollIntoView` on
  the exercise root (via viewport resize and via the fallback timer); no
  scroll at desktop width.
- Visual check via `pnpm --filter @language-drill/web shoot` at a mobile
  viewport.

## Out of scope

- Other drill types (cloze, translation, vocab) keep the browser default
  focus-scroll behavior.
- No layout compaction of the title/meta rows.
