# WordPopover Return-Focus-on-Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Closing the word card returns focus to the element that was focused when it opened, so keyboard users don't lose their reading position.

**Architecture:** A single `useLayoutEffect` in `word-popover.tsx` captures `document.activeElement` at mount (before the existing `autoFocus` passive effect moves focus to the skip button) and restores it on unmount. No focus trap (the card is non-modal), no `annotated-view` change, no new dependency.

**Tech Stack:** Next.js (App Router client component), React 19, TypeScript, Vitest + Testing Library.

## Global Constraints

- Self-contained: only `word-popover.tsx` and its test file change. Do **not** touch `annotated-view.tsx`, `word-sheet.tsx`, or add any dependency.
- No focus trap — the card is non-modal; only return-focus is added.
- All existing tests in `word-popover.test.tsx` (content, save/skip/Escape, position clamp, autoFocus, deep-card states) must stay **unchanged** and pass.
- Pre-push gate (repo root, must be clean): `pnpm lint`, `pnpm typecheck`, `pnpm test`.

---

### Task 1: Return focus to the opener on close (TDD)

**Files:**
- Modify: `apps/web/app/(dashboard)/read/_components/word-popover.tsx`
- Test: `apps/web/app/(dashboard)/read/_components/__tests__/word-popover.test.tsx` (add one `describe` block; leave all existing tests unchanged)

**Interfaces:**
- Consumes: existing `WordPopover` props (unchanged); `React` (already imported as `import * as React from 'react'`).
- Produces: no API change — same `WordPopover` export and props.

- [ ] **Step 1: Add the two failing tests**

Append this `describe` block to
`apps/web/app/(dashboard)/read/_components/__tests__/word-popover.test.tsx`
(keep every existing test as-is; `render`, `screen`, and the `baseProps`
helper already exist at the top of the file):

```tsx
describe('WordPopover — return focus on close', () => {
  it('returns focus to the opener element on unmount', () => {
    const opener = document.createElement('button');
    opener.textContent = 'word';
    document.body.appendChild(opener);
    opener.focus();
    expect(opener).toHaveFocus();

    const { unmount } = render(<WordPopover {...baseProps} autoFocus />);
    // autoFocus moved focus into the card (skip button)
    expect(screen.getByRole('button', { name: /^skip$/i })).toHaveFocus();

    unmount();

    expect(opener).toHaveFocus();
    document.body.removeChild(opener);
  });

  it('does not force focus onto body when nothing was focused at open', () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    expect(document.activeElement).toBe(document.body);

    const { unmount } = render(<WordPopover {...baseProps} />);
    unmount();

    // The cleanup must not throw and must not focus body.
    expect(document.activeElement).toBe(document.body);
  });
});
```

- [ ] **Step 2: Run the new tests — verify the first FAILS**

Run:

```bash
pnpm --filter @language-drill/web test -- word-popover
```

Expected: `returns focus to the opener element on unmount` FAILS — the current
component restores nothing, so after unmount the focused skip button is removed
and `document.activeElement` falls back to `body`, not the opener. The
`does not force focus onto body…` test PASSES (current code never restores
focus), and all pre-existing tests still pass.

- [ ] **Step 3: Add the capture/restore layout effect**

In `apps/web/app/(dashboard)/read/_components/word-popover.tsx`, locate the two
refs at the top of the component body:

```tsx
  const skipRef = React.useRef<HTMLButtonElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);
```

Insert this block immediately after them (before the existing
`React.useEffect(() => { if (autoFocus) … })` effect):

```tsx
  // Return focus to whatever was focused when the card opened (e.g. the word a
  // keyboard user activated) once it closes. Captured in a layout effect, which
  // React runs before the passive autoFocus effect below — so we record the
  // opener, not the skip button. Restored on unmount; the card always unmounts
  // on close (annotated-view gates it on `cardOpen`). Non-modal card → no focus
  // trap, only this return-focus.
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

Make no other change to the file.

- [ ] **Step 4: Run the word-popover suite — all PASS**

Run:

```bash
pnpm --filter @language-drill/web test -- word-popover
```

Expected: every test in the file passes, including the two new ones and the
unchanged `autoFocus` tests (the layout effect captures the opener before
autoFocus runs, so autoFocus still focuses the skip/close button).

- [ ] **Step 5: Pre-push gate**

Run from repo root:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all three pass with zero failures.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(dashboard\)/read/_components/word-popover.tsx \
        apps/web/app/\(dashboard\)/read/_components/__tests__/word-popover.test.tsx
git commit -m "fix(read): return focus to the opener word when the card closes"
```

---

## Self-Review

**Spec coverage:**
- Return-focus-on-close via `useLayoutEffect` capturing before autoFocus → Task 1 Step 3. ✓
- Restore on unmount, guarded (connected + not `body`) → Step 3 cleanup. ✓
- No focus trap, no `annotated-view`/`word-sheet`/dependency change → Global Constraints + single-file diff. ✓
- Existing tests unchanged and green → Step 4. ✓
- Two new tests (return-focus on unmount; no-op when nothing focused) → Step 1. ✓

**Placeholder scan:** none — all code is complete.

**Type consistency:** `openerRef: React.useRef<HTMLElement | null>`; `document.activeElement` cast to `HTMLElement | null`; `isConnected`/`focus()` are valid on `HTMLElement`. The new tests reuse the existing `baseProps` and skip-button query (`{ name: /^skip$/i }`) already used by the file's `autoFocus` block.

**Roadmap:** #4 (cookie-banner) remains, tracked in the spec appendix.
