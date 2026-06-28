# Theory footer reveals at end of article scroll

## Problem

On the theory **detail** page (`/theory/[topicId]`), the app footer is always
visible and permanently occupies space at the bottom of the viewport, regardless
of how far the reader has scrolled through a long article.

Root cause: `AppShell` always appends `<AppFooter/>` below `children`. On normal
pages (e.g. `/settings`) `children` is ordinary document flow, so the footer lands
at the natural end of scroll — you only see it when you reach the bottom. But the
theory detail page renders a **fixed-height** panel (`.theory-detail` =
`calc(100dvh − 72px)`) with its **own inner scroller** (`.theory-scroll`). That
panel fills the viewport, so the shell footer is parked just below it and always
occupies space. The inner scroller can't be removed: the scroll-spy's
IntersectionObserver root depends on `.theory-scroll` being the scroll container
(see `theory-detail.tsx` header comment).

Desired behavior: the footer should appear only when the reader scrolls to the end
of the article — the same effect `/settings` gets for free by being normal flow.

## Approach

Move the footer *inside* the theory article's scroller so it becomes the last
element of the actual scroll region (mirroring how `/settings`' footer is the last
element of the shell's `main` scroll region). A small context lets the theory page
suppress the shell's footer and render its own.

## Components

1. **`ShellFooterContext`** (new — `apps/web/components/shell/shell-footer-context.tsx`)
   - Provider holds a ref-counted suppression count and exposes `suppressed`
     (`count > 0`). Ref-counting keeps it correct across overlapping mounts.
   - `useShellFooterSuppressed(): boolean` — read the flag (used by the shell).
   - `useSuppressShellFooter(active: boolean): void` — effect that increments the
     count while `active` is true and decrements on cleanup / when `active`
     flips false. Safe to call unconditionally (Rules of Hooks) with a boolean.

2. **`AppShell`** (`apps/web/components/shell/app-shell.tsx`)
   - Split into `AppShell` (wraps children in `<ShellFooterProvider>`) and an
     inner consumer that reads `useShellFooterSuppressed()` and renders
     `<AppFooter/>` only when not suppressed. Both the desktop and the ≤760px
     ("mobile") branches honor the same flag, so the responsive layout is fixed by
     the same change. The layout (`(dashboard)/layout.tsx`) is untouched.

3. **`TheoryDetail`** (`apps/web/app/(dashboard)/theory/_components/theory-detail.tsx`)
   - Call `useSuppressShellFooter(Boolean(topic))` — suppress the shell footer only
     in the loaded (article) state.
   - Render `<AppFooter/>` as the **last child of `.theory-scroll`**, after the
     existing browse-all button and the 40px spacer.
   - In loading / error / empty states (`topic` falsy) suppression is off, so the
     shell footer behaves exactly as today — no footer-less screens.

## Why this matches `/settings`

In both cases the footer becomes the final element of the *actual scroll region* —
for settings that's the shell's `main`; for theory it's the inner `.theory-scroll`.

## Mobile

`apps/mobile` does not exist yet (Phase 4). "Mobile" today means the web app's
≤760px responsive layout, which this fix covers via the shared `suppressed` flag.
A future native app will need its own equivalent; out of scope here.

## Testing

- `shell-footer-context.test`: `useSuppressShellFooter(true)` sets `suppressed`
  true; unmount / `active=false` restores false; overlapping suppressors
  ref-count correctly (two suppress → one unmount still suppressed).
- `theory-detail` render test: with a loaded topic, exactly one `<AppFooter/>`
  renders and it is inside `.theory-scroll`; the shell footer is suppressed.
