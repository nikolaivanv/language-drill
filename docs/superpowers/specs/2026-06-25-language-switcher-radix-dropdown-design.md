# LanguageSwitcher → Radix DropdownMenu + RadioGroup

**Date:** 2026-06-25
**Status:** Approved design
**Scope:** PR 2 of the headless-library accessibility batch (`docs/ui-library-decision.md`). Reordered ahead of the word-popover (see Roadmap).

## Problem

`apps/web/components/shell/language-switcher.tsx` is a hand-rolled `role="listbox"`
dropdown in the desktop sidebar. It hand-implements arrow-key navigation
(`handleListboxKey` + `focusedIdx`), Escape, and outside-click via a manual
`useEffect`/`document` listener. Hand-rolled menu keyboard a11y is exactly the
class of widget the batch is replacing: no typeahead, no Home/End, focus is
tracked with a `data-focused` attribute rather than real roving focus, and
focus is not returned to the trigger on close.

The menu is **mixed**: single-select language options plus a "manage
languages →" navigation link footer.

## Decision

Rebuild on **`@radix-ui/react-dropdown-menu`** using a **RadioGroup** for the
languages (the menu-pattern expression of single-select: `menuitemradio` +
`aria-checked`) and a normal `Item` after a `Separator` for the manage-languages
link. Radix owns open/close, keyboard nav (arrows, typeahead, Home/End),
Escape, outside-click, focus trap, and focus-return-to-trigger.

Per the batch rules: no shadcn CLI, no shadcn theme variables — style with the
existing `--color-*` / spacing tokens only.

## Public API — unchanged

```ts
export function LanguageSwitcher(props: { profiles: LanguageProfile[] }): JSX.Element | null
```

No change to the only call site, `apps/web/components/shell/nav.tsx`.

## Structure

- **Zero learning profiles** → `return null` (unchanged).
- **Single learning profile** → the current plain **disabled** `<button>` (flagdot
  + name + level), no Radix wrapper, no `aria-haspopup`/`aria-expanded`
  (unchanged — there is nothing to open).
- **Multiple learning profiles:**
  - `DropdownMenu.Root` with **controlled** `open` state (`useState`) so behavior
    is deterministic and testable.
  - `DropdownMenu.Trigger asChild` wrapping the existing trigger button (flagdot,
    lowercased `LANGUAGE_NAMES[activeLanguage]`, `activeProfile.proficiencyLevel`).
    Radix sets `aria-haspopup="menu"` and `aria-expanded`.
  - `DropdownMenu.Portal` → `DropdownMenu.Content` styled with tokens
    (`bg-card border border-rule rounded-r-md shadow-2 py-1`), `align="start"`,
    `sideOffset={4}`. Match the current full-width sidebar look by sizing the
    content to the trigger width via the Radix CSS var, i.e.
    `style={{ width: 'var(--radix-dropdown-menu-trigger-width)' }}`.
  - `DropdownMenu.RadioGroup value={activeLanguage} onValueChange={onValueChange}`
    containing one `DropdownMenu.RadioItem value={p.language}` per learning
    profile: flagdot + lowercased name + mono CEFR level. The active-language
    accent dot renders via a conditional on `p.language === activeLanguage`
    (a decorative `aria-hidden` dot, as today — not `ItemIndicator`, since the
    selected state is already conveyed by `aria-checked` on the `RadioItem`).
  - `DropdownMenu.Separator` (token `border-rule`).
  - `DropdownMenu.Item asChild` wrapping `<Link href="/settings">manage
    languages →</Link>`.

## Behavior

- `onValueChange(next)`: `if (isLearningLanguage(next) && next !== activeLanguage)
  setActiveLanguage(next)`. Selecting the active language is a no-op. Radix closes
  the menu on any item select.
- Selecting a different language → `setActiveLanguage` → existing provider
  behavior (`window.location.reload`). Unchanged.
- **Removed:** `handleListboxKey`, `focusedIdx`, and the manual
  `useEffect` outside-click/Escape listener — all now Radix-managed.

## Accessibility change

`role="listbox"` → `menu`; `role="option"` → `menuitemradio` (`aria-checked`);
`aria-haspopup` → `"menu"`. Gained: typeahead, Home/End, roving DOM focus,
focus-return-to-trigger, and robust outside/Escape dismissal.

## Test strategy

Rewrite `apps/web/components/shell/__tests__/language-switcher.test.tsx`:

- Add dev dep **`@testing-library/user-event`**; open the menu with
  `await userEvent.click(trigger)` (Radix Trigger reacts to pointer events, which
  `fireEvent.click` does not dispatch). Tests that interact with the menu become
  `async`.
- Add Radix polyfills to `apps/web/vitest.setup.ts` (jsdom lacks them):
  - `ResizeObserver` (no-op observe/unobserve/disconnect class)
  - `Element.prototype.scrollIntoView` (`vi.fn()`)
  - `Element.prototype.hasPointerCapture` (`() => false`),
    `setPointerCapture`, `releasePointerCapture` (`vi.fn()`)
- Requery roles: `getByRole('listbox')` → `getByRole('menu')`;
  `getAllByRole('option')` → `getAllByRole('menuitemradio')`;
  `aria-haspopup` expectation `'listbox'` → `'menu'`.
- **Keep (requeried):** active-language trigger render; EN filtered out (2
  menuitemradios); single-profile disabled + no `aria-haspopup`; zero-profile
  null; open-on-click sets `aria-expanded='true'` and shows the menu; click a
  different language → `reload` once; click active language → closes, no reload;
  Escape closes; outside-click closes; "manage languages" link → `/settings`.
- **Drop** the two `data-focused` arrow-index tests (that attribute no longer
  exists — Radix uses roving focus). **Replace** with one keyboard test: open →
  `ArrowDown` → `Enter` selects the next language → `reload` called once.

## New dependencies

- `@radix-ui/react-dropdown-menu` (latest stable) — first Radix package in the repo.
- `@testing-library/user-event` (latest stable, dev) — for Radix pointer interactions.

## Out of scope

- The mobile `language-sheet.tsx` (separate surface, already a bottom sheet) and
  its tests — untouched.
- The other batch components (own specs/PRs).

---

## Appendix — batch roadmap (updated order)

| # | Component | Path | Target | Status |
|---|---|---|---|---|
| 1 | GrammarPointCombobox | `components/admin/grammar-point-combobox.tsx` | downshift | ✅ merged (#449) |
| 2 | LanguageSwitcher | `components/shell/language-switcher.tsx` | **Radix DropdownMenu + RadioGroup** | this spec |
| 3 | Word popover | `app/(dashboard)/read/_components/word-popover.tsx` | revisit — Radix Popover vs. minimal focus-trap (most integrated, least broken) |
| 4 | Cookie banner | `components/consent/cookie-banner.tsx` | reassess — a persistent banner is **not** a modal; Radix Dialog may be the wrong primitive |

Token mapping and "no shadcn theme-var leak" rules from `docs/ui-library-decision.md` apply to every PR.
