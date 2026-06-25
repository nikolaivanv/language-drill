# CookieBanner Preferences Focus Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the cookie *preferences* dialog opens, move focus into it; on Escape or Close, return focus to the Manage button — so keyboard users aren't stranded.

**Architecture:** The `CookieBanner` component swaps the banner and preferences views in place via `preferencesOpen`, so the fix keys off that transition with three refs (`dialogRef`, `manageRef`, `returnFocusRef`) and one `useEffect`. The banner (`role="region"`) is untouched; only the preferences `role="dialog"` view gains focus-on-open, an Escape handler, and return-focus-on-close.

**Tech Stack:** Next.js (App Router client component), React 19, TypeScript, Vitest + Testing Library.

## Global Constraints

- Self-contained: only `cookie-banner.tsx` and its test file change. Do **not** touch `consent-provider.tsx`, `consent-gate.tsx`, or `layout.tsx`. No new dependency.
- The **banner** (`role="region"`, "Cookie notice") stays exactly as-is. Only the **preferences** dialog gains focus management. No modal, scrim, or focus trap.
- No copy, class, or markup changes beyond the focus wiring listed in the task.
- The existing three tests (banner shows / Accept all / Reject) must stay **unchanged** and pass.
- Pre-push gate (repo root, must be clean): `pnpm lint`, `pnpm typecheck`, `pnpm test`.

---

### Task 1: Preferences dialog focus management (TDD)

**Files:**
- Modify: `apps/web/components/consent/cookie-banner.tsx`
- Test: `apps/web/components/consent/__tests__/cookie-banner.test.tsx` (add three tests; leave the existing three unchanged)

**Interfaces:**
- Consumes: `useConsent()` → `{ state, ready, update, preferencesOpen, openPreferences, closePreferences }` from `./consent-provider` (unchanged); `Link` from `next/link`.
- Produces: no API change — same `CookieBanner` export, same provider contract.

- [ ] **Step 1: Add the three failing tests**

In `apps/web/components/consent/__tests__/cookie-banner.test.tsx`, change the
testing-library import to include `fireEvent`:

```tsx
import { render, screen, act, fireEvent } from '@testing-library/react';
```

Then append these tests inside the existing `describe('CookieBanner', …)` block
(keep the three existing tests unchanged):

```tsx
  it('moves focus into the dialog when preferences open', async () => {
    setup();
    const manage = await screen.findByRole('button', { name: /manage/i });
    await act(async () => { manage.click(); });
    const dialog = screen.getByRole('dialog', { name: /cookie preferences/i });
    expect(dialog).toHaveFocus();
  });

  it('Escape closes preferences and returns focus to Manage', async () => {
    setup();
    const manage = await screen.findByRole('button', { name: /manage/i });
    await act(async () => { manage.click(); });
    const dialog = screen.getByRole('dialog', { name: /cookie preferences/i });
    await act(async () => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
    expect(screen.getByRole('region', { name: /cookie/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manage/i })).toHaveFocus();
  });

  it('Close button returns focus to Manage', async () => {
    setup();
    const manage = await screen.findByRole('button', { name: /manage/i });
    await act(async () => { manage.click(); });
    const close = screen.getByRole('button', { name: /^close$/i });
    await act(async () => { close.click(); });
    expect(screen.getByRole('region', { name: /cookie/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manage/i })).toHaveFocus();
  });
```

- [ ] **Step 2: Run the new tests against the old component — verify they FAIL**

Run:

```bash
pnpm --filter @language-drill/web test -- cookie-banner
```

Expected: the three new tests FAIL — the current dialog never receives focus
(`moves focus…` fails: focus is on `body`), has no Escape handler (`Escape…`
fails: the dialog stays open so the region query throws), and never returns
focus (`Close…` fails: Manage isn't focused). The existing three tests still pass.

- [ ] **Step 3: Rewrite the component with focus management**

Replace the entire contents of `apps/web/components/consent/cookie-banner.tsx` with:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useConsent } from './consent-provider';

export function CookieBanner() {
  const { state, ready, update, preferencesOpen, openPreferences, closePreferences } = useConsent();

  const dialogRef = useRef<HTMLDivElement>(null);
  const manageRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef(false);

  // Move focus into the preferences dialog when it opens, and return focus to
  // the Manage button when it closes. The component swaps views in place, so we
  // key off the `preferencesOpen` transition rather than mount/unmount. Refs
  // attach during commit before this effect runs, so on close the re-rendered
  // banner's Manage button is already available. Closing via Allow/Necessary
  // hides the whole banner (no Manage button) → manageRef is null → harmless.
  useEffect(() => {
    if (preferencesOpen) {
      dialogRef.current?.focus();
      returnFocusRef.current = true;
    } else if (returnFocusRef.current) {
      returnFocusRef.current = false;
      manageRef.current?.focus();
    }
  }, [preferencesOpen]);

  // Show the banner only after hydration, when no choice has been recorded.
  const showBanner = ready && state === null;

  if (preferencesOpen) {
    return (
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="Cookie preferences"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            closePreferences();
          }
        }}
        className="fixed inset-x-0 bottom-0 z-50 border-t border-rule bg-paper p-s-5 shadow-lg outline-none"
      >
        <div className="mx-auto max-w-[760px]">
          <h2 className="t-display-m mb-s-2">Cookie preferences</h2>
          <ul className="mb-s-4 list-none p-0 m-0 flex flex-col gap-s-3">
            <li>
              <strong>Strictly necessary</strong> — always on. Required to sign you in and keep drafts.
            </li>
            <li>
              <strong>Analytics</strong> — optional. Off unless you turn it on. Powered by PostHog (EU); masks your typed answers.
            </li>
          </ul>
          <div className="flex gap-s-3">
            <button type="button" className="btn" onClick={() => update({ analytics: true })}>
              Allow analytics
            </button>
            <button type="button" className="btn" onClick={() => update({ analytics: false })}>
              Necessary only
            </button>
            <button type="button" className="btn-ghost" onClick={closePreferences}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!showBanner) return null;

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-rule bg-paper p-s-5 shadow-lg"
    >
      <div className="mx-auto max-w-[760px] flex flex-col gap-s-3 mobile:items-stretch sm:flex-row sm:items-center sm:justify-between">
        <p className="t-small text-ink-soft m-0">
          We use strictly-necessary cookies, and analytics only if you opt in.{' '}
          <Link href="/cookies" className="underline">Learn more</Link>.
        </p>
        <div className="flex gap-s-3 shrink-0">
          <button ref={manageRef} type="button" className="btn-ghost" onClick={openPreferences}>Manage</button>
          <button type="button" className="btn-ghost" onClick={() => update({ analytics: false })}>Reject</button>
          <button type="button" className="btn" onClick={() => update({ analytics: true })}>Accept all</button>
        </div>
      </div>
    </div>
  );
}
```

What changed vs. the original (for the reviewer's reference, do not paste this list into the file):
- Added `useEffect`, `useRef` imports; the three refs; the transition effect.
- Preferences dialog `<div>`: added `ref={dialogRef}`, `tabIndex={-1}`, the Escape `onKeyDown`, and `outline-none` (suppresses the default focus ring on the programmatically-focused strip).
- Banner Manage `<button>`: added `ref={manageRef}`.
- Everything else (copy, classes, structure, the region banner) is byte-for-byte the original.

- [ ] **Step 4: Run the cookie-banner suite — all PASS**

Run:

```bash
pnpm --filter @language-drill/web test -- cookie-banner
```

Expected: all six tests pass (the three existing + three new).

- [ ] **Step 5: Pre-push gate**

Run from repo root:

```bash
pnpm lint && pnpm typecheck && pnpm --filter @language-drill/web test
```

Expected: lint and typecheck pass; the web suite passes. (The change is web-only;
the full-monorepo `pnpm test` is large — the web filter is the relevant gate here,
and lint/typecheck still run repo-wide.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/consent/cookie-banner.tsx \
        apps/web/components/consent/__tests__/cookie-banner.test.tsx
git commit -m "fix(consent): manage focus for the cookie preferences dialog"
```

---

## Self-Review

**Spec coverage:**
- Focus into the dialog on open → `dialogRef.current?.focus()` in the effect. ✓
- Escape closes → `onKeyDown` Escape → `closePreferences`. ✓
- Return focus to Manage on close → `manageRef.current?.focus()` in the effect's else-branch. ✓
- Banner (region) unchanged → only `ref={manageRef}` added to its Manage button; markup/copy identical. ✓
- Edge case (close via update hides banner → no Manage) → documented; `manageRef.current` null → no-op. ✓
- No new dependency, no modal/scrim/trap, no provider/layout change → Global Constraints + single-file diff. ✓
- Existing three tests unchanged and green → Step 4. ✓
- Three new tests → Step 1. ✓

**Placeholder scan:** none — all code is complete.

**Type consistency:** `dialogRef: useRef<HTMLDivElement>`, `manageRef: useRef<HTMLButtonElement>`, `returnFocusRef: useRef(false)`; refs are attached to the matching elements (`<div role="dialog">`, the Manage `<button>`). The new tests use the existing `setup()` helper and role/name queries (`dialog` / `region` / button names) consistent with the component's ARIA.

**Roadmap:** this is the final batch component (#4). After it, all four are spec'd/implemented.
