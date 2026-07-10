# Read Practice — floating mobile audio control (design)

**Date:** 2026-07-10
**Follows:** PR #550 (read audio player layout + mobile support), which introduced the
inline `PassageAudio` row on mobile but left the transport unreachable once scrolled past.
**Prototype:** Claude Design `read-proto` (`Reading Mode.html` + `read-ui.jsx` `FloatingMiniPlayer`).

## Problem

On mobile you want to read along while the shadowing audio plays, but the inline audio
player sits at the top of the passage. Scroll down to keep reading and the play/pause +
seek controls scroll out of reach. You have to scroll back up to pause or re-seek.

## Goal

Once the inline audio player scrolls out of view on mobile, pin a compact floating
transport to the bottom-right — **seek −10s · play/pause · seek +10s** — so playback stays
controllable while reading anywhere in the passage.

## Scope

- **Mobile only** (`useIsMobile()`, ≤760px). Desktop is unchanged.
- **Read practice passage only**, via `PassageAudio`. The drill dictation `AudioPlayer`
  is behaviorally untouched — the new prop defaults off.
- **Reuses the existing `<audio>` element and playback state.** No second audio stream,
  no duplicated/hoisted state. One source of truth.

Out of scope: any change to `AudioPlayer`'s inline layout, the drill/dictation surface,
the read desktop layout, waveform rendering, the `0.75× slow` / `replay` controls (they
stay inline-only — the floating pill is a minimal transport).

## Architecture — single owner, portaled twin

`AudioPlayer` (`apps/web/app/(dashboard)/drill/_components/audio-player.tsx`) remains the
**sole owner** of the `<audio>` element and its tuned state (`playing`, `progress`, `dur`,
and the drag / keyboard / `liveDuration()` logic). We add three purely-additive things:

1. **`seekBy(deltaSec)` helper** — sets `currentTime` to `clamp(current ± delta, 0, dur)`
   using the existing `liveDuration()` + `seekToFraction()` math, so a floating ±10 and an
   inline drag divide by the same number.
2. **`floating?: boolean` prop** (default `false`).
3. When **`floating && isMobile && !disabled`**, `AudioPlayer` also renders a
   `FloatingAudioControl` **from inside its own render** (closing over the same state and
   handlers), portaled to `document.body` with `position: fixed`.

Rendering the twin from within `AudioPlayer` gives one source of truth with **no state
hoisting** — it reads `playing`/`progress` and calls `togglePlay`/`seekBy` directly. This
was chosen over the prototype's `useAudioEngine` hoist because the inline logic is
carefully tuned (#550 deliberately left it alone); an additive prop + sub-component carries
zero regression risk to drag/keyboard/duration behavior, and the drill/dictation caller
(which never passes `floating`) is entirely unaffected.

### Why not hoist to a shared hook (the prototype's approach)

The prototype simulated playback with a RAF timer in `useAudioEngine`, so hoisting was
free. The real component drives a DOM `<audio>` element with delicate seek/duration
reconciliation. Extracting that into a hook to share with a second consumer is a larger,
riskier refactor for no user-visible benefit over the twin-inside approach.

## FloatingAudioControl

Ported from the prototype `FloatingMiniPlayer` / `MiniIconBtn` / `Seek10`.

- **Layout:** a pill — `bg-card`, `border-rule`, `shadow-3`, small gap/padding — containing
  `[−10s] [play/pause] [+10s]`.
  - **Side buttons:** 44×44 circular icon buttons (touch target), transparent → `paper-2`
    on hover. Icons are circular-arrow glyphs with a small "10" overlaid. `aria-label`
    "back 10 seconds" / "forward 10 seconds".
  - **Center:** 52×52 button. An SVG **progress ring** (radius 24, `stroke-accent`,
    `strokeDashoffset = C · (1 − progress)`) wraps a 40×40 `bg-ink text-paper` circle
    holding the play/pause glyph. `aria-label` "play"/"pause".
- **Position:** `fixed; right: 16px; bottom: calc(64px + env(safe-area-inset-bottom) + 16px)`
  so it clears the fixed `MobileTabBar` (`bottom-0`, `min-h-[64px]`,
  `pb-[env(safe-area-inset-bottom)]`). `z-40` (peer of the tab bar; above reading content).
  Portaled to `document.body` so no ancestor `transform`/`overflow` clips or re-anchors it.
- **Reveal trigger:** an `IntersectionObserver` on the inline `AudioPlayer` root element.
  The floating control shows once the inline player has left the top of the viewport
  (`entry.isIntersecting === false` while scrolled past). On mobile the **window** is the
  scroll root, so the observer's default root (viewport) is correct — no scroll polling.
- **Suppress while a bottom sheet is open:** a `floatingSuppressed` boolean prop. When
  `true` the control is hidden (short opacity fade). This is threaded from `annotated-view`
  as `cardOpen || bankSheetOpen`, so tapping a word (WordSheet) or opening the bank
  (WordBankSheet) — both of which cover the bottom of the screen — cleanly removes the pill.
- **Bottom clearance:** while the control is shown it reserves extra scroll room by adding
  bottom padding to the mobile scroll region (`anchor.closest('main')`), restoring the prior
  value on unmount/hide. This mirrors the prototype's 132px reservation so the collect bar
  at the end of the passage can scroll clear of the pinned pill instead of hiding under it.

## Data flow / prop threading

```
annotated-view (knows cardOpen, bankSheetOpen)
  └─ audioRow (shared mobile+desktop)
       └─ <PassageAudio floating floatingSuppressed={cardOpen || bankSheetOpen} />
            └─ <AudioPlayer floating floatingSuppressed=… />   ← mobile-gated internally
```

- `audioRow` is defined once and shared by the mobile and desktop branches of
  `annotated-view`. The `floating` / `floatingSuppressed` props are inert on desktop
  because `AudioPlayer` gates the floating control on `useIsMobile()`.
- `PassageAudio` forwards both props straight to `AudioPlayer`; it keeps its existing
  Listen → preparing → player gating (the floating control only exists once `AudioPlayer`
  mounts with a real `src`).

## Testing

Extend the existing test files (no orphan files).

**`audio-player.test.tsx`:**
- `seekBy` clamps at both ends (does not go below 0 or above duration) and moves
  `currentTime` + `progress` together.
- The floating twin renders **only** when `floating` is true, `useIsMobile()` is true, and
  a `src` is present; absent otherwise (default `floating=false`, desktop, or disabled).
- The floating play/pause and ±10 buttons drive the **same** `<audio>` element / `progress`
  as the inline transport (assert shared state, not a second element).
- `floatingSuppressed` hides the floating control while the inline player still renders.
- Stub `IntersectionObserver` (jsdom lacks it) and mock `useIsMobile()` — matching the
  existing responsive-mock idiom.

**`passage-audio.test.tsx`:**
- Forwards `floating` / `floatingSuppressed` to `AudioPlayer`.
- Still gated on `opened` + ready (no floating control before Listen is tapped / audio is
  ready); desktop path unaffected.

## Verification

Per the "verify drill components via esbuild harness" memory: bundle `AudioPlayer` +
`FloatingAudioControl` with esbuild against the Next-built CSS chunk, silent-WAV blob for
`src`, drive with Playwright at mobile width (≤760px), both themes:
1. Inline player visible at top; scroll down → pill appears bottom-right, above the tab bar.
2. Tap play / −10 / +10 → progress ring + inline progress update together.
3. Open the word sheet → pill hides; close → pill returns.
