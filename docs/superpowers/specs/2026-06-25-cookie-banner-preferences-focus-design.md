# CookieBanner — preferences dialog focus management

**Date:** 2026-06-25
**Status:** Approved design
**Scope:** PR 4 (final) of the headless-library accessibility batch (`docs/ui-library-decision.md`).

## Audit & problem

`apps/web/components/consent/cookie-banner.tsx` renders two states from one
component, switched by `preferencesOpen` (from `consent-provider`):

- **Banner** — `role="region"` ("Cookie notice"), the bottom strip with
  Manage / Reject / Accept all. A non-modal landmark is the **correct** ARIA for
  a cookie notice. **No change.** (Radix Dialog would be the wrong primitive
  here — a banner is not a modal.)
- **Preferences** — `role="dialog"` ("Cookie preferences"), opened by "Manage".
  This sub-view has real focus gaps:
  1. Opening it does not move focus into the dialog. The Manage button unmounts
     when the view swaps, so focus falls to `document.body` and a keyboard user
     is stranded.
  2. No Escape-to-close (there is a Close button, but no key handler).
  3. No return-focus to Manage when it closes.

## Decision

Add minimal, non-modal focus management to the **preferences** sub-view only.
Keep the non-modal bottom-strip UX (consistent with the app's calm, non-intrusive
ethos). Do **not** introduce Radix Dialog (a modal with scrim + focus trap would
change the UX) and do **not** touch the banner. No new dependency.

This mirrors the minimal fix applied to the word-popover (#3): close the real
focus gap, nothing more. A non-modal dialog correctly does **not** trap Tab.

## Mechanism

`CookieBanner` stays mounted and swaps views via `preferencesOpen`, so the fix
keys off that transition (not mount/unmount). Capturing
`document.activeElement` *after* open is too late (the Manage button has already
unmounted and focus fell to `body`), and the Manage button re-rendered on close
is a *new* element instance (a captured reference would be stale /
`!isConnected`). The clean model is a ref on each side plus a transition effect:

```tsx
const dialogRef = useRef<HTMLDivElement>(null);
const manageRef = useRef<HTMLButtonElement>(null);
const returnFocusRef = useRef(false);

useEffect(() => {
  if (preferencesOpen) {
    dialogRef.current?.focus();      // move focus into the dialog on open
    returnFocusRef.current = true;   // we now owe a focus return
  } else if (returnFocusRef.current) {
    returnFocusRef.current = false;
    manageRef.current?.focus();      // banner re-rendered → focus the new Manage button
  }
}, [preferencesOpen]);
```

Why it is correct:

- Refs attach during commit **before** `useEffect` runs, so when
  `preferencesOpen` flips to false the banner (with the new Manage button) is
  already committed and `manageRef.current` is valid.
- On initial mount `preferencesOpen` is false and `returnFocusRef` is false, so
  the effect is a no-op (no spurious focus move).
- Escape closes via `closePreferences`, which routes through the same
  false-transition → Manage regains focus (identical to the Close button).

## Wiring (the only edits to `cookie-banner.tsx`)

- Import `useEffect`, `useRef` from `react`.
- Add the three refs + the effect above.
- Preferences dialog `<div role="dialog">`: add `ref={dialogRef}`,
  `tabIndex={-1}` (so focusing the container announces "Cookie preferences,
  dialog"), and `onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault();
  closePreferences(); } }}`.
- Banner "Manage" `<button>`: add `ref={manageRef}`.
- No other markup, class, copy, or behavior change.

## Edge case

Closing via "Allow analytics" / "Necessary only" calls `update()`, which records
a choice and hides the entire consent UI (`showBanner` becomes false). There is
then no Manage button to return to; `manageRef.current` is null, so the effect's
focus call is a harmless no-op — correct, because the consent UI is gone.

## Tests to add

In `apps/web/components/consent/__tests__/cookie-banner.test.tsx` (the existing
three tests — banner shows / Accept all / Reject — stay unchanged):

1. **Opening preferences moves focus into the dialog.** Render, click "Manage",
   assert `screen.getByRole('dialog')` has focus.
2. **Escape returns to the banner and focuses Manage.** Open preferences, fire
   `keyDown` Escape on the dialog, assert the banner region is shown again and
   the "Manage" button has focus.
3. **The Close button returns focus to Manage.** Open preferences, click
   "Close", assert the banner is shown and "Manage" has focus.

## Out of scope

- The banner (region) — unchanged.
- Any Radix adoption, modal conversion, scrim, or focus trap.
- `consent-provider.tsx` / `consent-gate.tsx` — unchanged.

---

## Appendix — batch roadmap (final)

| # | Component | Target | Status |
|---|---|---|---|
| 1 | GrammarPointCombobox | downshift | ✅ merged (#449) |
| 2 | LanguageSwitcher | Radix DropdownMenu | ✅ merged (#452) |
| 3 | WordPopover | minimal return-focus fix | 🔵 PR #454 open |
| 4 | CookieBanner (preferences) | minimal non-modal focus fix (this spec) | in progress |

Outcome of the batch: the two genuinely hard widgets (combobox, language menu)
moved to headless libraries (downshift, Radix); the two well-built components
(popover, cookie preferences) got minimal, correct focus fixes rather than a
disproportionate Radix migration.
