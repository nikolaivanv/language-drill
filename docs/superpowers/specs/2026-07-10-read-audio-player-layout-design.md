# Read Practice — Audio Player Layout + Mobile

**Date:** 2026-07-10
**Status:** Approved design; ready for implementation plan
**Branch:** `feat/read-audio-player-layout`
**Follows:** PR #543 (Listen & Shadow audio playback) — this is a UI-only refinement of that feature.

## Summary

Two changes to the read-practice "Listen" audio feature shipped in #543:

1. **Relayout** the audio control on **desktop** — move it out of the passage header (where the expanding `<AudioPlayer>` overlaps the header controls) into its **own full-width row** between the header and the calibration strip.
2. **Bring the feature to mobile** — the audio control currently renders on desktop only; add the same full-width row to the mobile reader.

Plus small design-system alignment of the `PassageAudio` control (Listen button uses `<Button>`, a speaker icon, and a real loading spinner). This is a **layout/presentation change only** — no backend, API, schema, or `<AudioPlayer>` behavior changes.

## Source of truth

Claude Design prototypes (project `d676e7c3-d8fe-495f-a250-94c38e174fbd`, `read-proto/`):
- Desktop: `read-proto/Reading Mode Desktop.html` (composition in `read-desktop-app.jsx`)
- Mobile: `read-proto/Reading Mode.html` (composition in `read-app.jsx`)
- Shared components: `read-proto/read-ui.jsx` (`PassageAudio`, `AudioPlayer`)

The prototype tokens are the app's own `globals.css` variables (verified), so this is restructuring, not re-skinning. The prototype is a **simplified mock** — it omits states/chrome we already ship; those must be preserved (see "Preserve").

## Background — current state (post-#543)

- `PassageAudio` (`apps/web/app/(dashboard)/read/_components/passage-audio.tsx`) renders: idle "Listen" button → pending "preparing audio…" (bare text) → error "retry audio" → `too_long` / null-`audioUrl` unavailable message → ready `<AudioPlayer waveform={[]}>`. Listen/retry use a hand-rolled pill button (`buttonClass`), not the design-system `<Button>`.
- `AnnotatedView` (`apps/web/app/(dashboard)/read/_components/annotated-view.tsx`) has **two** return branches: a mobile branch (`if (isMobile)`) and a desktop branch. `PassageAudio` is rendered **only in the desktop header's right cluster**, next to the "highlight" label + `<IntensityToggle>`. The mobile branch renders **no** audio control. Both receive `entryId?: string | null` and `fetchFn?: AuthenticatedFetch` props already (only the desktop branch uses them).
- `<AudioPlayer>` (`apps/web/app/(dashboard)/drill/_components/audio-player.tsx`) is the shared player; the prototype's player is a faithful copy of it — **no changes needed**.

## Design-system references (use these, per theme)

- `<Button>` (`apps/web/components/ui/button.tsx`): variants `default | primary | ghost | chip`; the **`chip`** variant is `border border-rule bg-card text-ink hover:border-ink hover:bg-paper-2` — an exact match for the Listen control. Has a built-in `loading` prop + `<Spinner>`, but that spinner replaces the button's children (not what we want for the inline "preparing" text).
- Spinner idiom for the loading state — reuse the read feature's existing one from `word-card-body.tsx`: `inline-block h-[10px] w-[10px] animate-spin rounded-full border border-rule border-t-accent` (identical to the prototype's spinner). Paired with "preparing audio…" text.
- `Chip` (`apps/web/components/ui/chip.tsx`) is a non-interactive `<span>` — **not** used for Listen (Listen is a button).

## Design

### 1. `PassageAudio` component

- **Idle:** `<Button variant="chip" size="sm">` (design-system) with `rounded-pill` retained (matches prototype + current control) + a **speaker icon** (inline SVG, `aria-hidden`) before the text "Listen". Icon path from the prototype: a speaker with two sound-wave arcs.
- **Loading:** replace the bare text with a row: the spinner idiom above + "preparing audio…" (`t-small text-ink-mute`), `min-h-[44px]`.
- **Error:** `<Button variant="chip" size="sm">` "retry audio" (design-system) — same treatment as idle.
- **`too_long` / null-`audioUrl`:** keep the existing distinct messages (`t-small text-ink-mute`) — "audio unavailable — passage too long to narrate" and "audio unavailable — try again later".
- **Ready:** `<AudioPlayer src={data.audioUrl} waveform={[]} durationSec={data.durationSec} />` — unchanged. Because `PassageAudio` now sits in a full-width row, the player spans the reader column.
- **Unchanged behavior:** the `reset()`-on-`entryId`-change effect, and all state transitions, stay exactly as-is.

### 2. `AnnotatedView` desktop branch

- **Remove** `PassageAudio` from the header's right cluster; that cluster becomes just the "highlight" label + `<IntensityToggle>`.
- **Add** a full-width row **between the header and the calibration strip**:
  `{entryId && fetchFn ? <div className="mb-[18px]"><PassageAudio entryId={entryId} fetchFn={fetchFn} /></div> : null}`
- Order becomes: header → **audio row** → calibration → provenance chrome → reader text → footer → collect bar.

### 3. `AnnotatedView` mobile branch

- **Add** the identical full-width audio row between the mobile passage header (title + "word bank · N" chip) and the calibration strip, gated the same way (`entryId && fetchFn`). This is the "mobile support" deliverable — the component is shared, only the mount point is new.

## Preserve (prototype omits these — do NOT drop)

- All `PassageAudio` states beyond idle/loading/ready: `error` (retry), `too_long`, null-`audioUrl` unavailable.
- The `entryId && fetchFn` gate (Listen only for a persisted entry — no `/read/null/audio`).
- `reset`-on-passage-change.
- `<AudioPlayer>` accessibility (role=slider, keyboard seek) and the empty-waveform fallback.
- Everything else on the reader: header "highlight" + `IntensityToggle`, `CalibrationStrip`, provenance chrome (generated texts), `CollectBar`, `WordBankRail`/`WordBankSheet`, popover/word-sheet.

## Theme

All styling routes through design-system tokens (`border-rule`, `bg-card`, `text-ink`, `text-ink-mute`, `border-t-accent`, …) and `<Button>`, which already handle dark/light. No bespoke colors.

## Out of scope

- Any `<AudioPlayer>` visual/behavioral change (it already matches the prototype).
- Backend / API / schema / metering (all unchanged from #543).
- Sentence-level segmentation, karaoke sync, pronunciation scoring (future specs).

## Testing

- `passage-audio.test.tsx`: still passes (role=button "Listen" name preserved; icon is `aria-hidden`); add assertions for the speaker icon presence and the loading spinner. Keep the existing too_long / unavailable / mount-player cases.
- `annotated-view` / read page tests: after moving/adding the audio row, grep for tests that render `AnnotatedView` (desktop AND mobile) and assert the audio control's presence/position; update any header-structure assertions. Ensure the mobile branch now renders the control when `entryId`+`fetchFn` are supplied.
- Run `pnpm --filter @language-drill/web build` (Next prerender) since the read page is touched.

## Open questions

None — the prototypes + design-system components fully specify the change. The one judgment call (Listen keeps `rounded-pill` rather than the chip variant's default `rounded-sm`) is recorded above.
