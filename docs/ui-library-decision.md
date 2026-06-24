# UI Library Decision: shadcn / Radix

**Status:** Recommendation (not yet executed) · **Date:** 2026-06-24

## Question

Should we adopt **shadcn/ui** to get more consistent UI and better accessibility, replacing the current hand-built component set?

## TL;DR

**No wholesale switch to shadcn.** Keep the bespoke design tokens and the simple visual primitives. **Selectively adopt Radix UI primitives** (the headless layer shadcn is built on) for the handful of genuinely hard, accessibility-sensitive interactive components — combobox/select, popover, dropdown-menu, dialog, tooltip — restyled to our existing tokens. We already depend on `vaul` (the same author's drawer lib) for sheets, so this direction is consistent with what's here.

---

## Context: what we have today

- **Styling:** Tailwind v4 with a custom `@theme` token block in `apps/web/app/globals.css` (the "warm paper" identity: `--color-paper`, `--color-ink`, `--color-accent`, …) + a class-based type scale (`.t-display-*`, `.t-body`, …).
- **Primitives:** hand-built, semantic-HTML components in `apps/web/components/ui/` — Button, Card, Chip, Choice, Checkbox, Switch, Input, Textarea, Bar, BottomSheet, AccentPicker.
- **No external component/primitive library** installed (no Radix, Headless UI, CVA, cmdk). **One related dep is present:** `vaul ^1.1.2` (drawer/sheet).
- **Accessibility is currently hand-rolled** via `useFocusTrap()`, `useBodyScrollLock()`, manual `role=`/`aria-*` wiring, and `createPortal`.

## Why not a full shadcn migration

| Concern | Detail |
|---|---|
| **Consistency benefit largely evaporates** | shadcn ships a neutral look and assumes `--background`/`--foreground`/`--primary` HSL variables. Our identity is bespoke "warm paper" on Tailwind v4 `@theme` tokens. Every shadcn component would need restyling to our tokens — so the "free consistency" is mostly not free. |
| **It's not a dependency you "switch to"** | shadcn copy-pastes component source you then own and maintain. There is no upstream you track for fixes. |
| **High migration churn** | Every page and test references current component labels/props. In this repo, renaming labels/routes reliably breaks integration/page tests (a documented recurring failure mode). A blanket rewrite multiplies that. |
| **Simple primitives gain nothing** | Button, Card, Chip, Bar, Switch, Input are already accessible semantic HTML. Radix adds no value there. |

## Where Radix genuinely helps

The real accessibility ROI is **Radix UI** (focus management, ARIA, keyboard nav, collision-aware positioning) — and only for the hard interactive widgets. These are the current hand-rolled candidates:

| Current component | Path | Radix primitive |
|---|---|---|
| Grammar-point combobox | `apps/web/components/admin/grammar-point-combobox.tsx` | `@radix-ui/react-*` combobox pattern (or `cmdk`) |
| Word popover | `apps/web/app/(dashboard)/read/_components/word-popover.tsx` | `@radix-ui/react-popover` |
| Language switcher / sheet | `apps/web/components/shell/language-switcher.tsx`, `language-sheet.tsx` | `@radix-ui/react-dropdown-menu` |
| Bottom sheets | `bottom-sheet.tsx`, `theory/topic-switcher-sheet.tsx`, `progress/.../point-detail-sheet.tsx` | already on `vaul` — keep / consolidate |
| Cookie banner, detail dialogs | `apps/web/components/consent/cookie-banner.tsx`, various | `@radix-ui/react-dialog` |

**Combobox is the strongest case** — comboboxes are notoriously hard to make accessible (active-descendant, type-ahead, keyboard, screen-reader announcements), and a hand-rolled one is the most likely to have latent a11y bugs.

## Recommended approach

1. **Keep** `globals.css` tokens, the type scale, and the simple `components/ui/*` primitives as-is.
2. **Add `@radix-ui/*` primitives incrementally**, restyled to our tokens. Optionally scaffold with the shadcn CLI as a starting point, then strip its default styling and map to our `@theme` variables.
3. **Keep public props/labels stable** during each swap so existing tests and call sites don't churn.
4. **Sequence by accessibility risk:** combobox → popover → dropdown-menu → dialog → tooltip. Consolidate sheets onto `vaul`.
5. Each migration is its own PR with before/after a11y check (keyboard + screen-reader pass).

## Risks / notes

- shadcn's default theme tokens (HSL `--background`, etc.) must **not** leak into `globals.css` — map everything to the existing `--color-*` tokens or the warm-paper identity drifts.
- Radius/shadow/spacing must continue to come from our tokens, not Radix/shadcn defaults.
- Watch bundle size: add Radix primitives per-component, not the umbrella package.
- Tests in this repo are sensitive to label/role changes — assert the new ARIA roles intentionally rather than incidentally.

## Decision

Adopt **targeted Radix** for the components in the table above; **do not** migrate the full UI to shadcn. Revisit only if the component count grows enough that maintaining bespoke primitives becomes a burden.
