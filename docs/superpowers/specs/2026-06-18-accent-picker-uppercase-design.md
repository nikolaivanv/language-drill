# Accent Picker — Uppercase Support

**Date:** 2026-06-18
**Component:** `apps/web/components/ui/accent-picker.tsx`

## Problem

The special-character keyboard panel (`AccentPicker`) only offers lowercase
diacritics (e.g. Turkish `ç ğ ı ö ş ü`). When an exercise answer must start with
a capitalized special character (e.g. `Şişede su yok.`), the learner has no way
to type the capital form — there is no physical key and no panel button for `Ş`.
The evaluator then flags the missing capital even though the user had no input
path for it.

`AccentPicker` is shared by every exercise surface (translation, cloze,
sentence-construction, vocab, conjugation, dictation, free-writing), so one fix
applies everywhere.

## Solution

Add an uppercase mode to the panel, reachable two ways:

1. **Physical Shift held** (desktop) — while Shift is down, buttons show and
   insert the uppercase glyph.
2. **Tap `⇧` toggle** (touch) — a sticky shift key at the front of the row
   latches uppercase until tapped off.

Effective state: `isUpper = physicalShiftHeld || latched`.

### Data shape

Replace the flat `string[]` per language with explicit `[lower, upper]` pairs so
each capital is intentional (JS `toUpperCase()` mishandles `ß → SS` and is a
no-op on punctuation):

| Lang | Pairs |
|---|---|
| ES | á/Á, é/É, í/Í, ó/Ó, ú/Ú, ñ/Ñ, ¿/¿, ¡/¡ |
| DE | ä/Ä, ö/Ö, ü/Ü, ß/ß |
| TR | ç/Ç, ğ/Ğ, ı/I, ö/Ö, ş/Ş, ü/Ü |

Deliberate "no real capital" cases map to themselves: Spanish `¿ ¡` and German
`ß` (Shift is a harmless no-op). Turkish `ı → I` is the correct dotless capital.

### State & events

- `latched` — React state toggled by the `⇧` button (sticky on/off).
- `shiftHeld` — React state driven by `window` `keydown`/`keyup` on the Shift
  key. A `window` `blur` listener resets it so Shift can't stick "on" after an
  alt-tab while held.
- Listeners are attached in a `useEffect` and cleaned up on unmount.

### Rendering

- A leading `⇧` button: `aria-label="uppercase"`, `aria-pressed={latched}`,
  shares the same `disabled` (no-target / `disabled` prop) state as the char
  buttons, visually active when `latched`.
- Each char button renders the upper glyph when `isUpper`, with `aria-label`
  `insert Ş`; otherwise the lower glyph and `insert ş`. `handleClick` inserts the
  active-case character. `insertAtCursor` is unchanged.

## Testing

Existing tests remain green (lowercase is the default state; the two
"all buttons disabled" tests already sweep the new toggle via `getAllByRole`).

New tests in `accent-picker.test.tsx`:
- Tapping `⇧` swaps glyphs to uppercase and inserts the capital (`ş → Ş`).
- Physical Shift `keydown` swaps to uppercase; `keyup` reverts.
- Turkish `ı → I` and `ş → Ş` specifically.
- No-capital chars unchanged under Shift: German `ß`, Spanish `¿`.
- The `⇧` toggle is disabled alongside the char buttons when there is no target.

## Out of scope

- One-shot (auto-release after one char) shift behavior — chose sticky for
  predictability.
- Caps-lock / double-tap-lock semantics.
- Changing which languages have a panel (ES/DE/TR only, unchanged).
