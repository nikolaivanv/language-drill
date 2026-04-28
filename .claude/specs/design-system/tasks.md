# Design System Foundation — Tasks

## Task Overview

9 components + tokens/fonts/base styles + tests = 22 atomic tasks.

Dependencies flow: tokens → fonts → base styles → cn helper → components → tests.

---

## Task 1: Design tokens in globals.css

**Ref:** FR-1.1–FR-1.9, US-1
**Files:** `apps/web/app/globals.css` (modify)
**Estimated time:** 15 min

Replace the current single-line `@import "tailwindcss"` with the full `@theme` block containing all design tokens:
- 17 color tokens (`--color-paper` through `--color-ok-soft`)
- 4 font family tokens (`--font-display`, `--font-ui`, `--font-mono`, `--font-hand`)
- 8 spacing tokens (`--spacing-s-1` through `--spacing-s-8`)
- 5 radius tokens (`--radius-r-sm` through `--radius-r-pill`)
- 5 line-height tokens (`--leading-display-tight` through `--leading-ui`)
- 3 shadow tokens (`--shadow-1` through `--shadow-3`)
- 1 layout token (`--width-max-content: 1100px`)

Keep the `@import "tailwindcss"` line — add the `@theme` block after it.

**Verify:** Run `pnpm typecheck` and `pnpm dev:web` — confirm zero compilation errors.

---

## Task 2: Font loading setup

**Ref:** FR-2.1–FR-2.4, US-2, NFR-1, NFR-5
**Files:** `apps/web/app/fonts.ts` (create), `apps/web/app/layout.tsx` (modify)
**Estimated time:** 20 min
**Depends on:** Task 1

Create `apps/web/app/fonts.ts`:
- Import Fraunces (variable, axes: opsz + SOFT), Inter (400/500/600/700, latin + latin-ext), JetBrains_Mono (400/500), Caveat (600) from `next/font/google`
- Each font configured with `display: 'swap'` and a `variable` CSS custom property (`--font-fraunces`, `--font-inter`, `--font-jetbrains-mono`, `--font-caveat`)

Modify `apps/web/app/layout.tsx`:
- Import all 4 font objects from `./fonts`
- Add their `.variable` classes to `<html className={...}>`
- Keep existing ClerkProvider and Providers wrapper

**Leverage:** `apps/web/app/layout.tsx` — existing ClerkProvider + Providers structure to preserve.

**Verify:** Run `pnpm typecheck` — confirm zero errors. Run `pnpm dev:web` — confirm app compiles and loads.

---

## Task 3: Base styles and type scale

**Ref:** FR-3.1–FR-3.2, US-4
**Files:** `apps/web/app/globals.css` (modify)
**Estimated time:** 15 min
**Depends on:** Task 1, Task 2

Add after the `@theme` block in `globals.css`:

1. `@layer base` block setting body styles: `background-color: var(--color-paper)`, `color: var(--color-ink-2)`, `font-family: var(--font-ui)`, `-webkit-font-smoothing: antialiased`, `-moz-osx-font-smoothing: grayscale`.

2. Type scale utility classes (10 total):
   - `.t-display-xl` through `.t-display-s` (Fraunces, weight 500, with paired font-size, line-height, letter-spacing, `font-variation-settings: "SOFT" 50, "opsz" 144` for xl and l, `color: var(--color-ink)`)
   - `.t-body-l`, `.t-body` (ink-2 color, 1.55 line-height)
   - `.t-small` (ink-soft, 1.45), `.t-micro` (ink-mute, uppercase, letter-spacing 1.2px)
   - `.t-hand` (Caveat, weight 600), `.t-mono` (JetBrains Mono, tnum)

3. `.fade-in` animation utility (0.35s ease, translateY 4px → 0)

**Verify:** Run `pnpm typecheck` and `pnpm dev:web` — confirm zero errors. Start the dev server and verify in browser that body background is warm off-white, not pure white.

---

## Task 4: cn() helper

**Ref:** Design doc, component foundation
**Files:** `apps/web/lib/cn.ts` (create)
**Estimated time:** 5 min

Create a simple class name merge utility:
```typescript
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
```

No test file needed — this is a one-liner that will be exercised by all component tests.

---

## Task 5: Button component

**Ref:** FR-4.1–FR-4.5, US-3, NFR-2, NFR-3
**Files:** `apps/web/components/ui/button.tsx` (create)
**Estimated time:** 25 min
**Depends on:** Task 1, Task 4

Create `Button` component with:
- 4 variants: `default`, `primary`, `ghost`, `accent` (class maps per design doc)
- 3 sizes: `sm` (min-h-[32px]), `md` (default), `lg`
- States: disabled (`opacity-50 cursor-not-allowed pointer-events-none`, `aria-disabled`), loading (spinner SVG replaces children, `aria-busy`, `pointer-events-none`)
- Renders as `<a>` when `href` is provided (use Next.js `Link` for internal paths), `<button>` otherwise
- Uses `forwardRef`, accepts `className` merged via `cn()`
- Shared classes: `inline-flex items-center justify-center gap-[6px] font-medium whitespace-nowrap transition-all duration-150`

Export component and prop types from the file. Do **not** update the barrel `index.ts` yet — that is consolidated in Task 22.

---

## Task 6: Button tests [COMPLETED]

**Ref:** NFR-7
**Files:** `apps/web/components/ui/__tests__/button.test.tsx` (create)
**Estimated time:** 20 min
**Depends on:** Task 5

**Testing note:** jsdom does not load CSS, so tests verify behavior and DOM attributes (classes, aria, event handlers) — not visual rendering. This applies to all component tests in this spec.

Test cases:
- Renders with default variant and md size
- Each variant applies correct classes (check for key class like `bg-ink` for primary)
- Each size applies correct classes
- Disabled state: `aria-disabled="true"`, has opacity class
- Loading state: shows spinner, hides children, has `aria-busy="true"`
- Renders as `<a>` when href provided
- Renders as `<button>` when no href
- Forwards ref
- Merges custom className
- Click handler fires (and does not fire when disabled/loading)

---

## Task 7: Chip component

**Ref:** FR-5.1–FR-5.2, US-3
**Files:** `apps/web/components/ui/chip.tsx` (create)
**Estimated time:** 10 min
**Depends on:** Task 4

Create `Chip` component:
- 4 variants: `default`, `solid`, `accent`, `ok`
- Renders as `<span>`
- Shared: `inline-flex items-center gap-1 px-[9px] py-[3px] rounded-r-pill text-[11px] font-medium`
- Accepts `className`, `children`

---

## Task 8: Chip tests

**Ref:** NFR-7
**Files:** `apps/web/components/ui/__tests__/chip.test.tsx` (create)
**Estimated time:** 10 min
**Depends on:** Task 7

Test: renders, each variant applies correct classes, merges className, renders children.

---

## Task 9: Card component

**Ref:** FR-6.1–FR-6.3, US-3
**Files:** `apps/web/components/ui/card.tsx` (create)
**Estimated time:** 10 min
**Depends on:** Task 4

Create `Card` component:
- Padding prop: `none` / `sm` / `md` (default) / `lg`
- Base: `bg-card border border-rule rounded-r-lg shadow-1`
- Accepts `className`, `children`

---

## Task 10: Card tests

**Ref:** NFR-7
**Files:** `apps/web/components/ui/__tests__/card.test.tsx` (create)
**Estimated time:** 10 min
**Depends on:** Task 9

Test: renders, each padding variant, default padding is md, merges className, renders children.

---

## Task 11: Bar component

**Ref:** FR-7.1–FR-7.4, US-3, NFR-2
**Files:** `apps/web/components/ui/bar.tsx` (create)
**Estimated time:** 15 min
**Depends on:** Task 4

Create `Bar` (progress meter) component:
- Props: `value` (number), `max` (default 100), `color` (`ink` | `accent` | `ok`, default `ink`)
- Track: `h-[6px] bg-paper-3 rounded-r-pill relative overflow-hidden`
- Fill: absolute positioned, width via inline style `Math.min(100, (value / max) * 100)%`, `transition-[width] duration-300`
- Fill color class: `bg-ink` / `bg-accent` / `bg-ok`
- Aria: `role="meter"`, `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax`

---

## Task 12: Bar tests

**Ref:** NFR-7
**Files:** `apps/web/components/ui/__tests__/bar.test.tsx` (create)
**Estimated time:** 10 min
**Depends on:** Task 11

Test: renders track and fill, fill width matches value/max ratio, clamps at 100%, each color variant, default color is ink, aria attributes present, merges className.

---

## Task 13: Input component

**Ref:** FR-8.1–FR-8.2, FR-8.4, US-3
**Files:** `apps/web/components/ui/input.tsx` (create)
**Estimated time:** 10 min
**Depends on:** Task 4

Create `Input` component:
- Extends `React.InputHTMLAttributes<HTMLInputElement>`
- Uses `forwardRef`
- Classes: `w-full px-[14px] py-[12px] border border-rule rounded-r-md bg-card text-[14px] text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:border-ink focus:shadow-[0_0_0_3px_rgba(26,22,18,0.08)]`
- Merges `className`

---

## Task 14: Textarea component

**Ref:** FR-8.1–FR-8.5, US-3
**Files:** `apps/web/components/ui/textarea.tsx` (create)
**Estimated time:** 10 min
**Depends on:** Task 4

Create `Textarea` component:
- Extends `React.TextareaHTMLAttributes<HTMLTextAreaElement>`
- Uses `forwardRef`
- Same base styling as Input but with uniform `p-[14px]`, `resize-none`, `leading-[1.6]`
- Default `rows={4}`

---

## Task 15: Input and Textarea tests

**Ref:** NFR-7
**Files:** `apps/web/components/ui/__tests__/input.test.tsx` (create), `apps/web/components/ui/__tests__/textarea.test.tsx` (create)
**Estimated time:** 15 min
**Depends on:** Task 13, Task 14

Input tests: renders, forwards ref, merges className, passes through HTML attributes (placeholder, disabled, type).
Textarea tests: renders, forwards ref, default rows=4, resize-none class present, merges className.

---

## Task 16: Choice component

**Ref:** FR-9.1–FR-9.5, US-3, NFR-2
**Files:** `apps/web/components/ui/choice.tsx` (create)
**Estimated time:** 20 min
**Depends on:** Task 4

Create `Choice` component:
- Props: `selected`, `onSelect`, `mode` (`radio` | `checkbox`, default `radio`), `children`, `className`
- Renders `<button>` with `role` and `aria-checked`
- Indicator: 16px circle (radio) or 16px rounded square (checkbox), filled when selected
- State classes per design doc (default → hover → selected)
- Shared: `flex items-center gap-[10px] px-s-4 py-s-3 rounded-r-md cursor-pointer transition-all duration-150 text-left w-full`

---

## Task 17: Choice tests

**Ref:** NFR-7
**Files:** `apps/web/components/ui/__tests__/choice.test.tsx` (create)
**Estimated time:** 15 min
**Depends on:** Task 16

Test: renders children, radio mode has role="radio", checkbox mode has role="checkbox", aria-checked reflects selected prop, calls onSelect on click, selected state applies correct classes, renders radio dot / checkbox check indicator when selected.

---

## Task 18: Checkbox component

**Ref:** FR-10.1–FR-10.3, US-3, NFR-2, NFR-3
**Files:** `apps/web/components/ui/checkbox.tsx` (create)
**Estimated time:** 10 min
**Depends on:** Task 4

Create `Checkbox` component:
- Props: `checked`, `onChange`, `className`
- `<button>` with `role="checkbox"`, `aria-checked`
- Visual: 18px inner square centered in 32px min tap target, 4px radius
- Unchecked: `border-[1.5px] border-ink bg-transparent`
- Checked: `bg-ink` + white ✓
- `transition-colors duration-150`

---

## Task 19: Checkbox tests

**Ref:** NFR-7
**Files:** `apps/web/components/ui/__tests__/checkbox.test.tsx` (create)
**Estimated time:** 10 min
**Depends on:** Task 18

Test: renders, role="checkbox", aria-checked matches prop, calls onChange on click, checked state shows checkmark, unchecked does not show checkmark.

---

## Task 20: AccentPicker component

**Ref:** FR-11.1–FR-11.6, US-5, NFR-2
**Files:** `apps/web/components/ui/accent-picker.tsx` (create)
**Estimated time:** 25 min
**Depends on:** Task 4, Task 5 (uses ghost/sm button styling pattern)

Create `AccentPicker` component:
- Props: `language` (`'ES' | 'DE' | 'TR'`), `targetRef` (ref to input/textarea), `className`
- Character maps: ES → [á,é,í,ó,ú,ñ,¿,¡], DE → [ä,ö,ü,ß], TR → [ç,ğ,ı,ö,ş,ü]
- Returns `null` for unsupported languages
- Each char rendered as ghost/sm-styled button with mono font
- Insert logic: read selectionStart/End, build new value, set value, dispatch native InputEvent (bubbles: true), restore cursor, re-focus target
- If targetRef.current is null, buttons are disabled
- Layout: `flex flex-wrap gap-s-1`

**Implementation note:** The InputEvent dispatch approach for triggering React's onChange on controlled inputs is a known risk. Test with both controlled and uncontrolled inputs. If InputEvent doesn't reliably trigger onChange, fall back to the `nativeInputValueSetter` pattern:
```typescript
const setter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype, 'value'
)?.set;
setter?.call(el, newValue);
el.dispatchEvent(new Event('input', { bubbles: true }));
```

---

## Task 21: AccentPicker tests

**Ref:** NFR-7
**Files:** `apps/web/components/ui/__tests__/accent-picker.test.tsx` (create)
**Estimated time:** 20 min
**Depends on:** Task 20

Test:
- Renders correct characters for ES, DE, TR
- Returns null for unsupported language (e.g., 'EN' cast via `as any`)
- Character button click inserts character into target input value
- Cursor position is restored after insert
- Buttons disabled when targetRef.current is null
- Each button has mono font class

---

## Task 22: Barrel export and final verification

**Ref:** NFR-6, NFR-7
**Files:** `apps/web/components/ui/index.ts` (create)
**Estimated time:** 10 min
**Depends on:** All previous tasks

Create the barrel file exporting all 9 components and their prop types:
```typescript
export { Button } from './button';
export { Chip } from './chip';
export { Card } from './card';
export { Bar } from './bar';
export { Input } from './input';
export { Textarea } from './textarea';
export { Choice } from './choice';
export { Checkbox } from './checkbox';
export { AccentPicker } from './accent-picker';
```

Also export all prop types for consumer use.

Run full verification:
```bash
pnpm lint
pnpm typecheck
pnpm test
```

All must pass with zero failures.

---

## Dependency Graph

```
Task 1 (tokens) ──┬──→ Task 2 (fonts) ──→ Task 3 (base styles)
                   │
                   └──→ Task 4 (cn helper) ──┬──→ Task 5 (Button) → Task 6 (tests)
                                              ├──→ Task 7 (Chip) → Task 8 (tests)
                                              ├──→ Task 9 (Card) → Task 10 (tests)
                                              ├──→ Task 11 (Bar) → Task 12 (tests)
                                              ├──→ Task 13 (Input) ──┐
                                              ├──→ Task 14 (Textarea)┴→ Task 15 (tests)
                                              ├──→ Task 16 (Choice) → Task 17 (tests)
                                              ├──→ Task 18 (Checkbox) → Task 19 (tests)
                                              └──→ Task 20 (AccentPicker) → Task 21 (tests)

                                              Task 22 (barrel + verify) depends on all
```

Tasks 5–21 (components + tests) can be parallelized after Tasks 1–4 are complete. The barrel file (`index.ts`) is only created in Task 22, so there are no file conflicts during parallel execution.
