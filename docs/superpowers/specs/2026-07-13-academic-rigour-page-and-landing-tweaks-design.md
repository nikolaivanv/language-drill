# Academic Rigour page + landing tweaks — design/spec

Date: 2026-07-13
Status: approved (design), in implementation

## Goal

Port two Claude Design prototypes into the Next.js web app and refresh the guest
landing page:

1. A new standalone **Academic Rigour** marketing page (desktop + mobile).
2. Five **tweaks** to the guest landing (`/`) that bring it in line with the
   updated prototype.
3. A **new slogan** replacing "read, save, produce" / "Read · Save · Review ·
   Produce" everywhere it appears.

The current app already contains the dark "Drill Floor" landing (ported earlier
from an older revision of the same prototype files), so this is a faithful
update, not a from-scratch build. Prototype source lives in the Claude Design
project `d676e7c3` (`landing/*.jsx`, `landing/landing.css`,
`landing/landing-mobile.css`). App code lives in `apps/web/app/_landing/`.

## Decisions (locked)

- **Slogan:** _"Type it, don't tap it."_
  - Hero eyebrow → `Produce, don't recognise`
  - Footers (both landings, both ChatGPT pages, the two new rigour pages, and the
    signed-in app footer) → `© 2026 drill · type it, don't tap it`
  - `app/page.tsx` metadata title → `drill — type it, don't tap it`
- **Home scope:** match the updated prototype — **remove** the 4-step Loop strip
  and the standalone Vocab-review section; **add** the academic-rigour stat band
  and the richer deep-annotation showcase.
- No `globals.css` `@theme` token changes (keeps `globals-tokens.test.ts` green);
  all new CSS is scoped `.df` / `.dfm` in `landing.css` / `landing-mobile.css`.

## Work items

### A. New Academic Rigour page
- Route: `apps/web/app/academic-rigour/page.tsx` — public, **no** auth redirect,
  renders `<LandingDarkCanvas/>` + `.landing-desktop`/`.landing-mobile` trees
  (same pattern as `app/page.tsx`). Own `metadata` (title + description).
- `apps/web/app/_landing/academic-rigour.tsx` — `AcademicRigourPage` (`'use
  client'`): brand top bar (Academic-rigour navlink → back home + Sign up),
  hero, stat band, provenance pipeline (A→B→C), per-language curriculum,
  4 quality principles, 8 production modes, interactive review-loop demo
  (34%→71% cloze fix; `useState`), CTA, footer. Local data consts inline.
- `apps/web/app/_landing/academic-rigour-mobile.tsx` — `AcademicRigourMobile`,
  reflowed sections, own `ARMReview` interactive demo.
- All prototype `*.html` hrefs → Next `<Link>`: back-home → `/`, sign-up →
  `/sign-up`. Reuse `DBrand` from landing-chrome.

### B. Landing tweaks (`drill-landing.tsx`, `drill-landing-mobile.tsx`)
1. Hero **languages strip** ("On the floor now" — D_LANGS pills + `soon` +
   D_SOON). Web + mobile.
2. **Sign-in** restyled to a bordered box: desktop via `.df-signin` (make the
   base rule the bordered button the existing `:hover` already assumes), mobile
   via `.dfm-signin-btn`. Web + mobile.
3. Desktop header **"Academic rigour" navlink** (`<Link href="/academic-rigour"
   className="vs-navlink">`).
4. **Rigour stat band** section after the hero (`DRigourBand` / `MRigourBand`)
   with "See how the material is made →" → `/academic-rigour`. Web + mobile.
5. **Deep-annotation showcase** (`DeepAnnotationShowcase` / `MDeepAnno`) — new
   reading section with the deep word card (morphology breakdown). Web + mobile.
- **Remove** `LoopStrip`/`MLoop` and `VocabReview`/`MVocab` renders + component
  defs. Keep the `bank`/`onSave` state (still used by the carousel reading mode).

### C. Shared plumbing
- `landing-chrome.tsx`: add `DeepAnnotationCard` (+ `DeepCard` type) so desktop
  and mobile share it.
- `landing-data.ts`: add `DeepCard`/`DeepSeg` types and `D_READING` (Turkish A2
  beach passage with deep tokens). `D_DEEP` is not needed (unused by these
  pages).

### D. CSS
- `landing.css`: add `.hero-langs*`, `.df-rigour-link`, `.da-*`
  (deep-annotation card + deck), `.ar-*` (stats / flow / curric / principles /
  modes / case demo / status / quote), and set `.df-signin` base to the bordered
  button. (Confirm against existing file — add only what's missing.)
- `landing-mobile.css`: add `.dfm-stats/-stat*`, `.dfm-flow-badge`,
  `.dfm-mode-head/-tag`, `.dfm-curric-under`, `.dfm-rigour-link`,
  `.dfm-signin-btn`, `.dfm .da-*`, `.dfm .ar-case-card` overrides. (Confirm
  against existing — add only what's missing.)

### E. Slogan swap (audited occurrences)
`app/page.tsx:9`; hero eyebrows in `drill-landing.tsx` + `drill-landing-mobile.tsx`;
footers in `drill-landing.tsx`, `drill-landing-mobile.tsx`, `why-not-chatgpt.tsx`,
`why-not-chatgpt-mobile.tsx`, both new rigour files, and
`components/shell/app-footer.tsx`. Update stale code comments referencing the old
loop in passing.

## Testing
- Add render smoke tests for `AcademicRigourPage` + `AcademicRigourMobile`
  (assert a signature heading renders) and a header assertion that the desktop
  landing exposes an "Academic rigour" link to `/academic-rigour`. No existing
  landing copy tests exist, so nothing breaks on the slogan change.
- Heavy interactive home components (timers/`matchMedia`) are covered by build +
  visual shoot rather than jsdom.

## Verification
- `pnpm --filter @language-drill/web shoot --route /` and `--route
  /academic-rigour`, desktop + mobile, into `apps/web/e2e/.shots/`.
  (Worktree already has `.env` + `apps/web/.env` copied so `shoot` runs.)

## Pre-push gate
`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm --filter
@language-drill/web build` (Next build, since a new route is added). All green
before pushing.

## Notes / risks
- The prototype hero eyebrow still literally says "Read · Save · Review ·
  Produce" — intentionally overridden to the new slogan.
- Adding a route + touching the root layout-adjacent landing is exactly the case
  the pre-push gate misses without `next build`; run it.
