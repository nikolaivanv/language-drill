# Design Guidelines Overview

A consolidated summary of the UX/UI design system as it exists in the repo today — tokens, type, components, patterns, and where each thing lives. Compiled for review; flag anything that needs polishing.

> **TL;DR.** The app has a mature, first-class, light-only "warm paper" design system built on **Tailwind v4 `@theme` tokens** + a class-based type scale + a small set of **hand-built UI primitives** (no shadcn/Radix/Headless UI, no icon library, no animation library). It originates from a detailed design handoff bundle and is documented per-feature under `docs/specs/*/design.md`.

---

## 1. Where everything lives

| Area | Path | Role |
|---|---|---|
| **Production tokens + type scale + utility classes** | `apps/web/app/globals.css` | The live source of truth (Tailwind v4 `@theme` block + `.t-*` classes + component CSS) |
| Font loading | `apps/web/app/fonts.ts` → injected in `apps/web/app/layout.tsx` | `next/font/google` with CSS-variable handoff |
| Responsive breakpoint constant | `apps/web/lib/responsive.ts` | `MOBILE_MAX_WIDTH = 760` + `useIsMobile()` |
| UI primitives | `apps/web/components/ui/*.tsx` (+ `index.ts`) | Button, Card, Chip, Choice, etc. |
| Nav / brand icons | `apps/web/components/shell/nav-icons.tsx`, `brand-mark.tsx` | Custom inline SVG |
| Landing (dark) theme | `apps/web/app/_landing/landing.css` | Marketing-only dark palette via token aliases |
| Feature-local CSS | `app/(dashboard)/drill/free-writing/free-writing.css`, `read/_components/word-flag-styles.module.css`, theory panel classes in `globals.css` | Component-specific styling |
| **Design handoff bundle (archived)** | `docs/design-archive/design_handoff_language_drill/` | `README.md` (design language), `SCREENS.md`, hi-fi JSX prototypes. Historical reference only — **not live code**. The duplicate `tokens.css`/`tokens.json` were removed; `globals.css` is the single source of truth. |
| **Design system spec** | `docs/specs/design-system/design.md` | Architecture (CSS layers, component specs) |
| Per-feature design specs | `docs/specs/*/design.md` (app-shell, onboarding, exercise-ui, theory-panel, progress-page, debrief, dashboard, responsive-web, …) | Implementation decisions per screen |
| Standalone UX proposals | `docs/coach-panel-design.md`, `docs/vocabulary-review-design.md`, `docs/reading-deep-annotation-design.md`, `docs/progress-feedback-redesign.md` | Flow/UX-focused docs |

> **Single source of truth for tokens:** the Tailwind v4 `@theme` block in `apps/web/app/globals.css`. The old duplicate `tokens.css`/`tokens.json` in the handoff bundle were deleted to avoid being mistaken for live code; the rest of the bundle is archived under `docs/design-archive/` as historical design reference.

---

## 2. Design language / principles

From `docs/design-archive/design_handoff_language_drill/README.md` and `docs/product.md`:

- **"Warm paper" aesthetic** — warm off-white background (`#faf7f1`), high-contrast near-black ink, terracotta accent, amber highlight, sage success. Never pure black/white.
- **Editorial feel** — Fraunces (variable serif) at display sizes; Inter for UI; JetBrains Mono for numbers/codes; Caveat for personality (sparingly, ≤1–2× per screen).
- **Lowercase by default** in UI labels, buttons, headlines (proper nouns / language names keep normal casing).
- **No gamification** — no XP, streaks, levels, leaderboards, or emoji in production copy. Progress is reported as honest CEFR-flavored bands. Success color is calm sage, not celebratory.
- **Coach voice** — calm, brief, second-person; gentle nudges, no streak-shaming.
- **Restraint** — prefer a 1px rule over a shadow; no gradients except a sticky footer fade; line-drawn icons (~1.6–1.9px stroke); shadows used sparingly.
- **Light-only — no dark mode** in the app (the marketing landing page is the one dark surface).
- **Accessibility / mobile-first** — ≥48px tap targets on touch, focus traps + scroll lock in modals, ARIA on all custom controls, full `prefers-reduced-motion` support.

---

## 3. Tokens

### Colors (18)

| Token | Hex | Use |
|---|---|---|
| `--color-paper` | `#faf7f1` | Primary background |
| `--color-paper-2` | `#f2ede2` | Recessed surface, hover, sidebar |
| `--color-paper-3` | `#e8e1d2` | Meter track, divider fill |
| `--color-card` | `#ffffff` | Elevated surfaces (cards, dialogs) |
| `--color-ink` | `#1a1612` | Primary text + active fills |
| `--color-ink-2` | `#3d362e` | Body copy |
| `--color-ink-soft` | `#5a5148` | Secondary text |
| `--color-ink-mute` | `#8a8074` | Tertiary / metadata |
| `--color-rule` | `#d8d0bf` | Default border |
| `--color-rule-strong` | `#c9bfac` | High-contrast border |
| `--color-accent` | `#c96442` | Primary accent (terracotta) |
| `--color-accent-2` | `#b15535` | Accent hover |
| `--color-accent-soft` | `#f7e2d3` | Accent tint |
| `--color-hilite` | `#f4d35e` | Highlight (amber) |
| `--color-hilite-soft` | `#fbeeb6` | Highlight wash (selected choice bg) |
| `--color-ok` | `#5b8a5a` | Success (sage) |
| `--color-ok-soft` | `#d8e6d3` | Success tint |

### Spacing (4px base)

`--spacing-s-1…s-8` = **4, 8, 12, 16, 20, 24, 32, 40px**

### Radius

`--radius-r-sm` 6px · `r-md` 10px · `r-lg` 16px · `r-xl` 24px · `r-pill` 999px

### Shadows (used sparingly)

```
--shadow-1: 0 1px 2px rgba(26,22,18,.05), 0 1px 3px rgba(26,22,18,.06)
--shadow-2: 0 2px 4px rgba(26,22,18,.06), 0 8px 24px rgba(26,22,18,.08)
--shadow-3: 0 4px 12px rgba(26,22,18,.10), 0 24px 60px rgba(26,22,18,.14)
```

### Layout

`--width-max-content: 1100px` (web content cap) · left nav 220px · mobile gutters 16–20px.

---

## 4. Typography

**Fonts** (loaded via `next/font/google`, `display: 'swap'`):

| Family | Token | Weights / axes | Use |
|---|---|---|---|
| Fraunces | `--font-display` | 500, variable `opsz`/`SOFT` | Display, headlines, numbers, brand |
| Inter | `--font-ui` | 400/500/600/700 | All UI text |
| JetBrains Mono | `--font-mono` | 400/500, `tnum` | Codes, CEFR bands, numeric data |
| Caveat | `--font-hand` | 600 | Personality accents (sparingly) |

**Type scale** (class-based utilities in `globals.css`):

| Class | Size / line-height | Use |
|---|---|---|
| `.t-display-xl` | 56 / 1.05 | Hero (web only) → 34px mobile |
| `.t-display-l` | 40 / 1.1 | Page title → 28px mobile |
| `.t-display-m` | 28 / 1.2 | Section title → 22px mobile |
| `.t-display-s` | 22 / 1.25 | Card title |
| `.t-body-l` | 17 / 1.55 | Lead paragraph |
| `.t-body` | 14 / 1.55 | Default body |
| `.t-small` | 12 / 1.45 | Captions |
| `.t-micro` | 11 / 1.4 | Uppercase eyebrows (letter-spacing 1.2px) |
| `.t-hand` | Caveat 600 | Personality |
| `.t-mono` | JetBrains Mono, tabular-nums | Numbers/codes |

**Rule:** line-height ≥ 1.2 on any wrappable headline (1.05–1.15 reserved for guaranteed one-liners).

---

## 5. UI primitives (`apps/web/components/ui/`)

Custom-built, semantic-HTML, accessible. **No external component library.**

| Component | Variants / notable props |
|---|---|
| **Button** | `default` / `primary` / `ghost` / `accent` / `chip`; sizes `sm`/`md`/`lg`; `loading`, `href` (renders as link), `disabled` |
| **Card** | padding `none`/`sm`/`md`/`lg` |
| **Chip** | `default` / `solid` / `accent` / `ok`; 11px pill |
| **Choice** | radio or checkbox tile; `selected`, `hideIndicator`; ≥48px mobile |
| **Checkbox** | accessible custom box, 32px tap target |
| **Switch** | 38×22 animated thumb (150ms) |
| **BottomSheet** | portal + focus trap + scroll lock; `maxHeight` (78vh default), `fullScreen` (92vh), drag handle, scrim/Escape dismiss |
| **Input / Textarea** | focus border + shadow, error styling; Textarea no resize handle |
| **Bar** | progress meter, colors `ink`/`accent`/`ok`, animated width 300ms |
| **AccentPicker** | ES/DE/TR accent-character insertion with shift-for-uppercase |

**Supporting hooks/utils:** `useIsMobile()`, `useBodyScrollLock()`, `useFocusTrap()`, `useScrollSpy()`, `cn()` (classname join).

---

## 6. Iconography, motion, layout

- **Icons** — custom inline SVG React components (`components/shell/nav-icons.tsx`), 16×16 stroke-based; brand mark is a terracotta bar. No Lucide/Heroicons.
- **Motion** — CSS keyframes + Tailwind transitions only (no Framer Motion). Conventions: ~0.15s on buttons/hovers, 0.35s drill feedback fade-in, ~280ms theory/sheet slide (`cubic-bezier`). "Calm, nothing bounces." Disabled under `prefers-reduced-motion`.
- **Responsive** — single breakpoint at **760px** via `@custom-variant mobile` (must stay in sync with `lib/responsive.ts`). Designed desktop ≥1024px; mobile reference 412×892.
- **App shell** — desktop: fixed 220px left nav + centered 1100px content. Mobile: top bar (language switcher) + 5-icon bottom tab bar. Branch via `useIsMobile()`.
- **Notable composite pattern** — the **Theory panel** (~40+ `.theory-*` classes): desktop right slide-over with 240px scroll-synced TOC; mobile full-screen bottom sheet with horizontal tab strip + searchable topic switcher.

---

## 7. Notable observations for a polish decision

1. ~~**Token duplication**~~ — *resolved:* the handoff `tokens.css`/`tokens.json` were deleted and the bundle archived under `docs/design-archive/`; `globals.css` `@theme` is now the only token source.
2. **No single human-readable "design system" page in the app/docs** that a contributor reads first — knowledge is split across the handoff `README.md`, `docs/specs/design-system/design.md`, and the live CSS. This overview could become that page if you want one canonical entry point.
3. **Component CSS is spread across** `globals.css` + feature-local CSS files + CSS modules — consistent but worth confirming naming conventions are documented.
4. **Landing page** is the only dark surface and uses a separate aliased palette — intentional, but worth a note so it isn't mistaken for dark-mode support.
5. **Primitives are mature**, but there's no Storybook/visual catalog — verifying states currently means reading code or the hi-fi prototypes.

---

*Compiled from `apps/web/app/globals.css`, `apps/web/components/ui/`, `apps/web/app/fonts.ts`, `apps/web/lib/responsive.ts`, the archived `docs/design-archive/design_handoff_language_drill/` bundle, and `docs/specs/*/design.md`.*
