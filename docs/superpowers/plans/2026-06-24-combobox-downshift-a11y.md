# GrammarPointCombobox → downshift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled `GrammarPointCombobox` with a `downshift`-backed implementation that adds full keyboard + ARIA support, with zero public-API change and all existing tests green.

**Architecture:** Wrap downshift's `useCombobox` headless hook around our existing `Input` primitive. Selection (`selectedItem`) and the input text (`inputValue`) are controlled from props; downshift owns open/close, highlight, keyboard, and ARIA wiring. Filtering keeps the current name-or-key substring logic.

**Tech Stack:** Next.js (App Router, client component), React, TypeScript, downshift, Tailwind v4, Vitest + Testing Library.

## Global Constraints

- Package versions: **always latest stable** (CLAUDE.md). Add `downshift` via `pnpm add` (no manual pin).
- Public API of `GrammarPointCombobox` is **frozen**: props `{ options, value, onChange, disabled?, placeholder? }`, type `GrammarPointOption = { key: string; name: string }`. No call-site changes in `app/(admin)/admin/{content,pool,moderation}/page.tsx`.
- No shadcn CLI, no shadcn theme variables — style with existing `--color-*` tokens only.
- Pre-push gate (run from repo root, must be clean): `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- Tests live in the existing file `apps/web/components/admin/__tests__/grammar-point-combobox.test.tsx` — do not create a new test file.

---

### Task 1: Add the `downshift` dependency

**Files:**
- Modify: `apps/web/package.json` (dependencies)

**Interfaces:**
- Produces: `downshift` package available to `@language-drill/web`, exporting `useCombobox`.

- [x] **Step 1: Install**

Run from repo root:

```bash
pnpm --filter @language-drill/web add downshift
```

- [x] **Step 2: Verify it resolved to a v9+ stable line**

Run:

```bash
node -e "console.log(require('./apps/web/node_modules/downshift/package.json').version)"
```

Expected: a `9.x.x` (or newer) version prints. If a major newer than 9 installed, that's fine — the `useCombobox` API used here (`getInputProps`/`getMenuProps`/`getItemProps`/`getLabelProps`, controlled `selectedItem`/`inputValue`, `onInputValueChange`/`onSelectedItemChange`, `highlightedIndex`, `isOpen`, `itemToString`) is stable across v7–v9.

- [x] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "build(web): add downshift for accessible combobox"
```

---

### Task 2: Migrate the component (TDD)

**Files:**
- Modify: `apps/web/components/admin/grammar-point-combobox.tsx` (full rewrite, same export)
- Test: `apps/web/components/admin/__tests__/grammar-point-combobox.test.tsx` (add 2 tests; keep the 8 existing ones unchanged)

**Interfaces:**
- Consumes: `Input` from `apps/web/components/ui` (forwardRef, spreads props onto `<input>`); `cn` from `apps/web/lib/cn`; `useCombobox` from `downshift`.
- Produces: unchanged export `GrammarPointCombobox(props)` and type `GrammarPointOption`.

- [x] **Step 1: Add the two failing keyboard tests**

Append these to the existing `describe('GrammarPointCombobox', ...)` block in
`apps/web/components/admin/__tests__/grammar-point-combobox.test.tsx` (keep all 8 existing tests as-is):

```tsx
it('selects an option via keyboard (ArrowDown + Enter)', () => {
  const onChange = vi.fn();
  render(<GrammarPointCombobox options={options} value="" onChange={onChange} />);
  const input = screen.getByLabelText('grammar point');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith('es-b1-present-subjunctive');
});

it('closes the menu on Escape', () => {
  render(<GrammarPointCombobox options={options} value="" onChange={vi.fn()} />);
  const input = screen.getByLabelText('grammar point');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryAllByRole('option')).toHaveLength(0);
});
```

- [x] **Step 2: Run the new tests against the old implementation — verify they FAIL**

Run:

```bash
pnpm --filter @language-drill/web test -- grammar-point-combobox
```

Expected: the two new tests FAIL (the current implementation has no keyboard handling — `ArrowDown`/`Enter` do nothing, so `onChange` is never called and no options render from a keyboard open). The 8 existing tests still PASS.

- [x] **Step 3: Rewrite the component on downshift**

Replace the entire contents of `apps/web/components/admin/grammar-point-combobox.tsx` with:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCombobox } from 'downshift';
import { Input } from '../ui';
import { cn } from '../../lib/cn';

export type GrammarPointOption = { key: string; name: string };

export function GrammarPointCombobox({
  options,
  value,
  onChange,
  disabled,
  placeholder = 'grammar point',
}: {
  options: GrammarPointOption[];
  /** Selected grammar point key, or '' for none. */
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const selectedItem = useMemo(
    () => options.find((o) => o.key === value) ?? null,
    [options, value],
  );

  const [inputValue, setInputValue] = useState(selectedItem?.name ?? '');

  // Keep the displayed text in sync when the selection changes externally:
  // the language filter clearing the grammar point, or a deep-link
  // (?grammarPoint=) whose name only resolves once options arrive.
  useEffect(() => {
    setInputValue(selectedItem?.name ?? '');
  }, [selectedItem]);

  const items = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (!q || q === selectedItem?.name.toLowerCase()) return options;
    return options.filter(
      (o) => o.name.toLowerCase().includes(q) || o.key.toLowerCase().includes(q),
    );
  }, [options, inputValue, selectedItem]);

  const {
    isOpen,
    highlightedIndex,
    getLabelProps,
    getInputProps,
    getMenuProps,
    getItemProps,
  } = useCombobox<GrammarPointOption>({
    items,
    selectedItem,
    inputValue,
    itemToString: (item) => item?.name ?? '',
    onInputValueChange: ({ inputValue: next }) => {
      const text = next ?? '';
      setInputValue(text);
      if (text === '') onChange('');
    },
    onSelectedItemChange: ({ selectedItem: next }) => onChange(next?.key ?? ''),
  });

  const menuOpen = isOpen && items.length > 0;

  return (
    <div className="relative">
      <label {...getLabelProps()} className="sr-only">
        grammar point
      </label>
      <Input
        {...getInputProps({ disabled, placeholder, autoComplete: 'off' })}
        className="rounded-md"
      />
      <ul
        {...getMenuProps()}
        className={cn(
          'absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-rule bg-card shadow-md',
          !menuOpen && 'hidden',
        )}
      >
        {menuOpen &&
          items.map((o, index) => (
            <li
              key={o.key}
              {...getItemProps({ item: o, index })}
              className={cn(
                'flex cursor-pointer flex-col items-start gap-0.5 px-[14px] py-[8px] text-left',
                highlightedIndex === index ? 'bg-paper' : 'bg-card',
              )}
            >
              <span className="text-[13px] text-ink">{o.name}</span>
              <span className="font-mono text-[11px] text-ink-soft">{o.key}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}
```

Notes for the implementer (do not paste into the file):
- `getInputProps` supplies the controlled `value`/`onChange`/`ref`/`id`/`aria-*` and keyboard handlers — do **not** also pass `value` or `onChange` to `<Input>`.
- The `<ul>` from `getMenuProps()` must stay rendered in the DOM (accessibility); we hide it with the `hidden` class when closed and render no `<li>` children, so `getAllByRole('option')` returns none when closed.
- The `sr-only` label is the accessible name; `getByLabelText('grammar point')` resolves through `getLabelProps`/`getInputProps`'s `aria-labelledby` association. Do not add a separate `aria-label` (it would conflict).

- [x] **Step 4: Run the full file — all 10 tests PASS**

Run:

```bash
pnpm --filter @language-drill/web test -- grammar-point-combobox
```

Expected: 10 passed (8 original + 2 new). If the deep-link test (`shows the selected name once options arrive after a preset value`) fails, the `useEffect` syncing `inputValue` to `selectedItem` is the fix point — confirm it is present and depends on `[selectedItem]`.

- [x] **Step 5: Pre-push gate**

Run from repo root:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all three pass with zero failures. (If a stale `infra/lambda/dist` or `db/dist` causes unrelated phantom failures, that is a known environment quirk, not this change — but the `@language-drill/web` suite must be green.)

- [x] **Step 6: Commit**

```bash
git add apps/web/components/admin/grammar-point-combobox.tsx \
        apps/web/components/admin/__tests__/grammar-point-combobox.test.tsx
git commit -m "refactor(admin): rebuild GrammarPointCombobox on downshift for keyboard + ARIA"
```

---

## Self-Review

**Spec coverage:**
- downshift migration, controlled `selectedItem` + `inputValue` → Task 2 Step 3. ✓
- Public API unchanged → frozen in Global Constraints; component signature identical. ✓
- Name-or-key substring filtering preserved → `items` useMemo. ✓
- Clear-to-empty → `onInputValueChange` empty branch. ✓
- Deep-link / late-options sync → `useEffect([selectedItem])`. ✓
- Removed `blurTimer` + `onMouseDown` hack → not present in rewrite. ✓
- Keyboard/ARIA gained + new tests → Task 2 Steps 1, 3. ✓
- 8 existing tests stay green → Task 2 Step 4. ✓
- `downshift` dependency → Task 1. ✓
- Token styling, no shadcn vars → rewrite uses `border-rule`/`bg-card`/`bg-paper`/`text-ink`. ✓

**Placeholder scan:** none — all code blocks are complete.

**Type consistency:** `GrammarPointOption` and `GrammarPointCombobox` signatures match the existing exports and all three call sites; `useCombobox<GrammarPointOption>` aligns `items`/`selectedItem`/`itemToString`.

**Roadmap:** components #2–4 (Radix popover/dropdown/dialog) are out of scope here and tracked in the spec's appendix.
