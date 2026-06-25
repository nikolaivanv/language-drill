# WordPopover — return focus on close

**Date:** 2026-06-25
**Status:** Approved design
**Scope:** PR 3 of the headless-library accessibility batch (`docs/ui-library-decision.md`).

## Problem

`apps/web/app/(dashboard)/read/_components/word-popover.tsx` is a custom
click-anchored word card (`role="dialog"`). On closer inspection it is the
**least-broken** of the batch components: it already has a dialog role +
aria-label, Escape-to-close, autoFocus to the skip button on keyboard openings,
and outside-click dismissal with deliberate exceptions (`[data-word]`,
`[role="status"]` toast).

Its **one confirmed accessibility gap** is that closing the card never returns
focus. There is no `.focus()` anywhere in the close path — `annotated-view.tsx`'s
`onPopoverClose` only clears reducer state — so a keyboard user who opens a word
card (Enter on the word) and presses Escape is dumped to the document start and
loses their reading position.

## Decision

Add an isolated **return-focus-on-close** to `word-popover.tsx`. Do **not**
migrate to Radix Popover (the full migration would rework `annotated-view`'s x/y
anchor model, rewrite the position-clamp tests, add `@radix-ui/react-popover`,
and depend on the still-unmerged polyfills from PR #452 — disproportionate for a
single real gap). Do **not** add a focus trap: the card is non-modal
(click-away dismisses, the page stays interactive), and WAI-ARIA non-modal
dialogs do not trap Tab.

Everything else about the component — positioning/`clampLeft`, the pointer
triangle, the click-outside exceptions, the deep-card lifecycle rendering, the
existing tests — stays unchanged.

## Mechanism

Capture the element focused at open *before* the existing `autoFocus` effect
moves focus to the skip button, and restore it on unmount:

```tsx
const openerRef = React.useRef<HTMLElement | null>(null);
React.useLayoutEffect(() => {
  openerRef.current = document.activeElement as HTMLElement | null;
  return () => {
    const opener = openerRef.current;
    if (opener && opener.isConnected && opener !== document.body) {
      opener.focus();
    }
  };
}, []);
```

Why it is correct:

- **Ordering:** React runs *all* layout effects before *any* passive effect, so
  this `useLayoutEffect` reads `document.activeElement` (the originating word for
  a keyboard open) before the existing `autoFocus` *passive* effect focuses the
  skip button. The capture is the opener, not the skip button.
- **Restore trigger:** the cleanup runs on unmount, and the card always unmounts
  on close — `annotated-view.tsx` renders it only while `cardOpen` is true
  (`{cardOpen && anchor && <WordPopover … />}`). So closing via Escape,
  outside-click, or skip all unmount it and restore focus.
- **Guards:** restore only when the opener is still connected and is not
  `document.body` (a mouse open with nothing previously focused → harmless
  no-op; never force focus onto `body`).
- **Lifecycle:** the popover stays mounted across the deep-card
  loading→loaded transition and across word-to-word switches (same instance,
  new props), so a single capture-on-mount targets the first opener — correct
  for the dominant keyboard flow (open a word → Escape). Re-capturing per word
  is unnecessary (YAGNI): there is no keyboard affordance to switch words while
  the card is open.

`useLayoutEffect` is acceptable here despite the SSR warning: the popover is
interaction-gated and never renders on the server.

## Files

- Modify: `apps/web/app/(dashboard)/read/_components/word-popover.tsx` — add the
  `openerRef` + `useLayoutEffect` above; no other behavior change.
- Test: `apps/web/app/(dashboard)/read/_components/__tests__/word-popover.test.tsx`
  — add two tests; all existing tests stay unchanged.

## Tests to add

1. **Returns focus to the opener on close (unmount).** Create and focus a
   `<button>` in the document, render `WordPopover` with `autoFocus`, assert the
   skip button has focus (existing autoFocus behavior), then unmount and assert
   the opener button regained focus.
2. **No-op when nothing was focused at open.** With `document.body` as the active
   element at render, unmounting `WordPopover` does not throw and does not move
   focus onto `body` (focus stays off the card's controls; `document.body`
   remains the active element).

## Out of scope

- Any `annotated-view.tsx` change, Radix adoption, or focus trap.
- The mobile `word-sheet.tsx` variant (separate surface) — untouched.
- The remaining batch component (#4 cookie-banner) — its own spec/PR.

---

## Appendix — batch roadmap (updated)

| # | Component | Path | Target | Status |
|---|---|---|---|---|
| 1 | GrammarPointCombobox | `components/admin/grammar-point-combobox.tsx` | downshift | ✅ merged (#449) |
| 2 | LanguageSwitcher | `components/shell/language-switcher.tsx` | Radix DropdownMenu | 🔵 PR #452 open |
| 3 | WordPopover | `app/(dashboard)/read/_components/word-popover.tsx` | **minimal return-focus fix** (this spec) — Radix Popover rejected as disproportionate |
| 4 | Cookie banner | `components/consent/cookie-banner.tsx` | reassess — a persistent banner is not a modal; Radix Dialog likely the wrong primitive |
