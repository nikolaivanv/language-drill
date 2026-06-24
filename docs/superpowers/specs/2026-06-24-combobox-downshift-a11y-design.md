# GrammarPointCombobox → downshift (accessibility migration)

**Date:** 2026-06-24
**Status:** Approved design
**Scope:** PR 1 of a 4-component headless-library batch (see roadmap appendix)

## Problem

`apps/web/components/admin/grammar-point-combobox.tsx` is a hand-rolled
type-ahead combobox used on three admin pages (content, pool, moderation). It
has **no keyboard support** — no arrow navigation, no Enter-to-select, no
Escape, no `aria-activedescendant`. It is mouse- and free-text-only, and relies
on a fragile `blurTimer` + `onMouseDown(preventDefault)` hack to keep the list
open long enough for a click to land.

This is the highest-ROI accessibility gap identified in
`docs/ui-library-decision.md`: comboboxes are the hardest widget to make
accessible by hand, and this one currently isn't.

## Decision

Rebuild the component on **`downshift`** (`useCombobox`), per the library
strategy in `docs/ui-library-decision.md` (Radix for popover/dropdown/dialog;
downshift for the combobox, since Radix ships no combobox primitive). downshift
is headless — we keep our own `Input` primitive, two-line option markup, and
warm-paper token styling, and gain the full WAI-ARIA combobox interaction model.

No shadcn CLI, no shadcn theme variables — hand-wired against the existing
`--color-*` tokens to avoid identity drift.

## Public API — unchanged

The exported surface stays byte-for-byte compatible so the three call sites and
the existing test suite need no changes:

```ts
export type GrammarPointOption = { key: string; name: string };

export function GrammarPointCombobox(props: {
  options: GrammarPointOption[];
  /** Selected grammar point key, or '' for none. */
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
  placeholder?: string; // default 'grammar point'
}): JSX.Element
```

## Implementation mapping (`useCombobox`, controlled selection)

| Concern | Mapping |
|---|---|
| Selected item | `selectedItem = options.find(o => o.key === value) ?? null` — **controlled** from the `value` prop |
| Selection out | `onSelectedItemChange: ({ selectedItem }) => onChange(selectedItem?.key ?? '')` |
| Display text | `itemToString: item => item?.name ?? ''`. downshift syncs the input text to the selected item's name whenever `selectedItem` changes — this is what makes the deep-link / late-arriving-options case work without manual `useEffect` syncing |
| Filtering | `items = useMemo(...)` over `inputValue`: same substring logic as today — match `name` **or** `key`, case-insensitive; show all when the query is empty or equals the selected name |
| Clear-to-empty | `onInputValueChange: ({ inputValue }) => { if (inputValue === '') onChange('') }` |
| Disabled | pass `disabled` onto the input via `getInputProps` |
| Label | keep `aria-label="grammar point"` on the input so `getByLabelText('grammar point')` resolves |

**Removed:** the `blurTimer` ref, the `onMouseDown(preventDefault)` hack, and the
manual `useEffect` value→query sync — downshift handles open/close, blur, and
input-text reconciliation.

## Rendering

- Field: existing `Input` primitive, spread `getInputProps({ 'aria-label': 'grammar point', disabled, placeholder })`, `className="rounded-md"`.
- Listbox: `<ul {...getMenuProps()}>` rendered only when `isOpen && items.length > 0`, same classes as today (`absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-rule bg-card shadow-md`).
- Option: `<li {...getItemProps({ item, index })}>` with the current two-line layout — `name` (`text-[13px] text-ink`) over `key` (`font-mono text-[11px] text-ink-soft`). Highlight the active item (`highlightedIndex === index`) with `bg-paper` (replaces the current hover-only styling so keyboard highlight is visible).

## Accessibility gained

Arrow / Home / End navigation, Enter-to-select, Escape-to-revert, managed
focus, and `aria-activedescendant` / `aria-controls` / `aria-expanded` wired by
downshift. Screen readers announce the active option.

## Behavior parity & test impact

The 8 existing tests in
`apps/web/components/admin/__tests__/grammar-point-combobox.test.tsx` must stay
green **unchanged**:

1. renders input with label + placeholder
2. shows selected option name in the input
3. resolves name once options arrive after a preset value (deep-link)
4. filters by human name
5. filters by key
6. `onChange(key)` on select
7. `onChange('')` when cleared
8. disabled

All map cleanly onto the downshift wiring above. **New tests to add:** arrow-down
+ Enter selects an option (`onChange(key)`), and Escape reverts the input text to
the selected name. These lock the behavior that didn't exist before.

One intentional, test-neutral improvement: after typing a non-matching query,
blur/Escape now reverts the input to the selected option's name instead of
leaving orphaned text (downshift default).

## New dependency

`downshift` (latest stable) added to `apps/web/package.json`.

## Out of scope

- A clear (×) affordance — clearing the text already empties the selection (YAGNI).
- The other three components in the batch (own specs/PRs).

---

## Appendix — batch roadmap

Recorded for continuity; each gets its own brainstorm + spec + PR when reached.

| # | Component | Path | Target |
|---|---|---|---|
| 1 | GrammarPointCombobox | `components/admin/grammar-point-combobox.tsx` | **downshift** (this spec) |
| 2 | Word popover | `app/(dashboard)/read/_components/word-popover.tsx` | `@radix-ui/react-popover` |
| 3 | Language switcher | `components/shell/language-switcher.tsx`, `language-sheet.tsx` | `@radix-ui/react-dropdown-menu` |
| 4 | Dialogs | `components/consent/cookie-banner.tsx`, detail sheets | `@radix-ui/react-dialog` |

Sheets already on `vaul` stay on `vaul`. Token mapping and "no shadcn theme-var
leak" rules from `docs/ui-library-decision.md` apply to every PR.
