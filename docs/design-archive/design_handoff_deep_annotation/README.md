# Handoff — Read feature (annotate-as-you-read)

> The rest of the Drill app is already shipped. This package documents **only** the new Read feature so it can be implemented in isolation.

## What this is

A high-fidelity HTML/React prototype showing how the Read feature looks and behaves. The files in `prototype/` are **design references**, not production code to copy verbatim. Recreate the UI in your codebase using its existing components, design tokens, and idioms — the surrounding app shell (left nav, language switcher, fonts, tokens) is already in place.

**Fidelity: high.** Colors, type, spacing, motion and copy are final. Pixel-match where reasonable.

---

## ⚠️ Prototype scaffolding — do NOT ship

Several elements in the prototype exist solely to help reviewers exercise every state from one screen. They are **not part of the production UI**:

| Element in prototype | What it is | What ships instead |
|---|---|---|
| Left rail card **"demo states / walk the flow"** | Buttons that programmatically trigger each interaction (tap-flagged, tap-cold, select phrase, select sentence) | **Nothing.** Real users trigger these states by tapping/selecting in the passage. |
| Left rail card **"legend / highlight styles"** | Inline cheat-sheet explaining `subtle` / `assertive` / `saved` styling | **Nothing.** Surface this once during onboarding or as a small `(?)` popover, not as a permanent rail card. |
| **Language picker** in the top bar (TR / DE / EN) | Lets the reviewer flip between three sample passages in different target languages | **Nothing.** The user already has one target language selected globally; the Read screen renders in that language. |
| **Layout toggle** (desktop / split / mobile) | Lets the reviewer compare popover vs. bottom-sheet presentations side by side | **Nothing.** Pick the presentation based on the actual viewport (see the [Responsive split](#responsive-split) section). |
| **Side-by-side desktop + mobile frames** rendered in `split` mode | Same as above | **Nothing.** One frame per screen — viewport-driven. |
| Top-bar heading "annotate as you read" and the page chrome | Just a hook into the existing AppShell so the prototype boots into the right screen | Whatever your existing Read route's chrome is — title, breadcrumbs, etc. |

**What does ship:** the passage rendering with its three highlight styles, the deep Word / Phrase / Sentence cards, the desktop popover and mobile bottom-sheet chrome, the cold-tap loading skeleton, the save-to-vocabulary action, and the toast confirmation. The rail card **"your bank"** (showing recently-saved words) is optional and can be folded into the existing vocabulary surface — it's not central to this feature.

---

## Feature summary

The user is reading a passage in their target language. The app does two things:

1. **Skim pass (automatic).** The app lightly marks words that are probably above the user's level. Two intensity styles co-exist in the same passage:
   - **Subtle** — dotted accent underline. "Probably worth a glance."
   - **Assertive** — soft amber wash behind the word. "Likely unknown to you."
   - **Saved** — words already in the user's vocabulary render bolder + accent color. This style is independent of the two intensities and replaces them when present.

2. **Deep annotation (on demand).** The user taps **any** word — flagged or not — or selects a multi-word span:
   - Tap a flagged word → its rich card appears instantly (gloss already cached server-side).
   - Tap an unflagged word → a loading skeleton appears in the card, then the real card resolves (~1.5s).
   - Drag-select a multi-word span → **Phrase** card.
   - Drag-select a whole sentence (or click-on-sentence-affordance, see implementation notes) → **Sentence** card.

The card appears as a **click-anchored popover** on desktop (~340px wide, with a pointer triangle) and as a **bottom sheet** on mobile (viewport ≤ 760px).

---

## The Word card

Two tiers — **core always visible**, **extras collapsed behind expandable rows**.

### CORE (always shown, top-to-bottom)

1. **Header row.** Headword (the inflected surface form, large display serif) · audio button (top-right, decorative is fine to start).
2. **Meta row.** Part of speech (italic) · CEFR badge (accent color) · frequency rank (mono, e.g. `#420`).
3. **Inflection line.** Inline below the meta row, e.g. `das · pl. Häuser` for German, `root "ev" · pl. "evler"` for Turkish. **Critical for gender-bearing languages — the gender belongs right next to the word.**
4. **Contextual sense.** A highlighted block (amber-soft background) labelled `here:` with the meaning **in this specific context**, in quotes. This is the lead — the user's primary read.
5. **Definition.** A short target-language definition (not English), labelled with the language name (`Türkçe`, `Deutsch`, `Español`). Calibrated to the user's level.
6. **Morphology breakdown.** Present when the word has internal structure. Chips showing each morpheme + its function, joined by `+` separators, with a `why this form here` explanation below. **The standout feature for Turkish and German.**

### EXTRAS (collapsed by default, one expandable row each)

- **Synonyms** — each with a nuance/register note.
- **Collocations** — each with a short gloss.
- **Register** — single line.
- **Another example** — sentence in target language + English translation.

### Footer

`Skip` (ghost) · `+ save to vocabulary` (primary; flips to `✓ saved · undo` after save).

See `prototype/read-cards.jsx` (`WordCard`) for the exact JSX and `prototype/read.css` (sections `Card body`, `Morphology`, `Extras`) for the styling.

---

## The Phrase card

Used when the user selects a multi-word span that matches a known idiom.

- **Header.** Citation form (e.g. `echar de menos`) + small "phrase" pill.
- **Meta.** `idiom · {register}`.
- **Contextual sense** block — labelled `means:` — the idiomatic meaning in quotes.
- **Literal** block — labelled `literal` — the word-by-word translation in italics.
- **Example** — target-language sentence + English translation.
- **Synonymous expressions** (when present) — e.g. dialectal alternatives.
- Footer: `Skip` · `+ save phrase`.

See `WordCard` and `PhraseCard` in `prototype/read-cards.jsx`.

---

## The Sentence card

Used when the user selects a full sentence.

- **Header.** Just a "sentence" pill.
- **Sentence quote** — highlighted block in target language.
- **Translation** — below in italics.
- **Breakdown** — labelled `breakdown` — a list of chunks, each with: the target-language chunk, a small role tag (e.g. `subordinate clause`, `main verb`, `time complement`), and a one-line note.
- **Grammar covered** — chip list of related grammar topics, intended to deep-link into the Theory section.
- Footer: `Close` · `+ add to translation drills`.

See `SentenceCard` in `prototype/read-cards.jsx`.

---

## Loading skeleton (cold tap)

When the user taps a non-flagged word, the gloss isn't cached. Show the skeleton in the card chrome immediately:

- Tapped word in the passage gains an `ink-on-paper` pill style (same as the active/tapped state) and pulses at 1.4s.
- Card chrome opens with: a shimmer block for the headword, two shimmer chips for meta, then 4 lines for body content.
- Caption at the bottom: small spinner + `looking it up · ~1.5s`.
- After fetch resolves, swap in the real Word card content. Keep the chrome mounted — don't tear down and re-mount.

See `CardSkeleton` in `prototype/read-cards.jsx`.

---

## Save-to-vocabulary

- Word card and Phrase card both have a save button in the footer.
- After save: button flips to `✓ saved · undo`. The word's style in the passage updates to the **saved** style (bolder + accent underline; if it was assertive, the wash turns terracotta).
- A toast appears (`bottom: 80px; centered`) for ~2.4s: `✓ added to vocabulary · <headword>`. Undo from the same toast is optional.
- The persistence target is whatever existing vocabulary store you already have. The Read feature is not authoritative.

---

## Responsive split

| Viewport | Presentation |
|---|---|
| > 760px (desktop / tablet landscape) | Popover, anchored to the tapped word, ~340px wide, with pointer triangle. Caps height at `min(560px, calc(100vh - 120px))` and scrolls internally if the content is taller. |
| ≤ 760px (phone) | Bottom sheet, full width, slides up from the bottom, dim backdrop, sheet handle on top. Internal scroll when content is taller. Tap backdrop to dismiss. |

The card body is identical in both presentations — only the chrome differs. See `CardChrome` in `prototype/read-cards.jsx`.

---

## Passage rendering

- Text is tokenised on word boundaries (Unicode-aware — Turkish ş/ğ, German umlauts, Spanish accented chars).
- Each word is a span with `cursor: pointer`. Highlight class is derived from a `{ surface → 'subtle' | 'assertive' }` lookup; saved class from membership in the user's vocabulary set.
- **Selection.** Mouse: drag from word A to word B (mousedown → mouseenter → mouseup). Touch: long-press to enter selection mode, then drag handles to expand (you'll need to layer this on top of the desktop drag handler — the prototype only implements the mouse path).
- **Sentence detection.** Sentence boundaries are computed up front from `.`, `!`, `?` tokens. A span that exactly matches a sentence range maps to the Sentence card; anything shorter maps to the Phrase card.

See `prototype/read-passage.jsx` for the tokeniser, sentence-range finder, and selection logic.

---

## Data shapes

The prototype hard-codes sample passages and a small word dictionary in `prototype/read-data.jsx`. The shapes you'll need from your backend:

```ts
// Per passage, computed at annotation time (server or on-device).
type Passage = {
  id: string;
  lang: 'tr' | 'de' | 'es' | ...;
  title?: string;
  source?: string;
  text: string;
  // Surface-form (lowercased) → intensity. Words not in the map are not flagged.
  highlights: Record<string, 'subtle' | 'assertive'>;
};

type WordCardData = {
  headword: string;          // the inflected surface form
  pos: string;               // 'noun', 'verb', 'adjective', ...
  cefr: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  freq: number;              // frequency rank (lower = more common)
  inflection?: string;       // e.g. 'das Haus · pl. Häuser · (here: dative plural)'
  contextualSense: string;   // "what it means HERE" — short, in the user's UI language
  definitionLabel: string;   // 'Türkçe', 'Deutsch', 'Español'
  definition: string;        // target-language definition
  morphology?: Array<{ part: string; role: string }>;
  morphWhy?: string;
  synonyms?: Array<{ word: string; note: string }>;
  collocations?: Array<{ phrase: string; gloss: string }>;
  register?: string;
  extraExample?: { tl: string; en: string };
};

type PhraseCardData = {
  surface: string;           // 'echo de menos'
  citation?: string;         // 'echar de menos' (infinitive / dictionary form)
  literal: string;           // 'to throw of less'
  idiomatic: string;         // 'to miss (someone or something)'
  register: string;
  example?: { tl: string; en: string };
  synonyms?: Array<{ word: string; note: string }>;
};

type SentenceCardData = {
  sentence: string;
  translation: string;
  chunks: Array<{ text: string; role: string; note: string }>;
  grammarNotes: string[];    // links into your Theory index
};
```

The prototype splits these across `READ_WORDS`, `READ_PHRASES`, `READ_SENTENCES` keyed by lowercased surface text — adapt to whatever lookup keys your backend uses.

---

## Design tokens

Use the existing app's design tokens (the live source of truth is the Tailwind v4 `@theme` block in `apps/web/app/globals.css`). This feature introduces no new colors, type ramps, or radii. Highlight styles map to existing tokens:

| Style | CSS |
|---|---|
| Subtle word | `text-decoration: underline dotted var(--accent); text-decoration-thickness: 1.5px; text-underline-offset: 4px;` |
| Assertive word | `background: linear-gradient(180deg, transparent 50%, var(--hilite-soft) 50%, var(--hilite-soft) 92%, transparent 92%); padding: 0 2px;` |
| Saved word | `font-weight: 600; color: var(--accent-2); text-decoration: underline solid var(--accent); text-decoration-thickness: 2px; text-underline-offset: 4px;` |
| Tapped (active) word | `background: var(--ink); color: var(--paper); border-radius: 4px; padding: 0 4px; box-shadow: 0 0 0 3px rgba(26,22,18,.08);` |
| Selected span | `background: rgba(26,22,18,.10); border-radius: 3px;` |

Card chrome: see `prototype/read.css` (`.rd-popover`, `.rd-sheet`, `.rd-popover-tail`).

---

## File map (prototype/)

| File | What's in it |
|---|---|
| `Read.html` | Standalone harness — open in a browser to run the prototype. |
| `read.jsx` | Feature shell. **Skim the demo states / language picker / layout toggle blocks and the `Bank` / `Legend` rail cards — they are scaffolding (see top of this README).** |
| `read-cards.jsx` | `WordCard`, `PhraseCard`, `SentenceCard`, `CardSkeleton`, and `CardChrome` (popover vs. sheet). **This file is mostly production-shape.** |
| `read-passage.jsx` | Tokeniser, sentence-range finder, `PassageReader` (mouse drag selection). **Production-shape.** |
| `read-data.jsx` | Sample passages + word/phrase/sentence dictionaries. **Reference for data shape only.** |
| `read.css` | All Read-specific styles. **Production-shape**, minus the rail/demo/segment classes — see the [Prototype-only CSS](#prototype-only-css) section below. |
| `tokens.css` | A prototype-local snapshot of the app's design tokens. The live source of truth is the `@theme` block in `apps/web/app/globals.css`. |

### Prototype-only CSS

These classes in `read.css` style the scaffolding and can be dropped:

```
.rd-grid, .rd-grid[data-layout=...], .rd-rail,
.rd-segment, .rd-segment-btn, .rd-segment-flag, .rd-segment-icon, .rd-layout-icon,
.rd-states-list, .rd-state-btn, .rd-state-num, .rd-state-text, .rd-state-label,
  .rd-state-sub, .rd-state-clear, .rd-hint,
.rd-legend, .rd-legend-row,
.rd-bank-empty, .rd-bank-list, .rd-bank-clear,
.rd-frame, .rd-frame-head, .rd-frame-title, .rd-frame-sub, .rd-frame-chip,
.rd-frame-body, .rd-frame-body-mobile, .rd-frame-mobile, .rd-frame-desktop
```

Keep everything under `Passage`, `Popover`, `Bottom sheet`, `Card body`, `Morphology`, `Extras`, `Footer`, `Sentence card`, `Skeleton`, and `Toast`.

---

## Open implementation questions

These deserve a product decision before / during build:

1. **Touch selection.** The prototype handles mouse drag only. On touch, decide between long-press-then-drag-handles (iOS-native feel) vs. a tap-on-first-word-then-tap-on-last-word "tap target" UI.
2. **Span boundaries.** When a drag-selection partially overlaps a sentence boundary (e.g. ends one word past the period), the prototype's "isSentence" heuristic is generous. Tighten or relax based on real usage.
3. **Failure cases.** What happens if the cold-tap lookup fails or times out? The prototype always resolves to success after 1.5s. Add an error state to the skeleton chrome.
4. **Audio.** The 🔊 button is decorative. Decide TTS provider / pre-cached audio.
5. **Re-flagging after save.** Saved words currently still show their original flag style under the "saved" override. Confirm desired ordering of styles.

---

## Acceptance checklist

- [ ] Tap a flagged word → card opens instantly with its `contextualSense` as the lead.
- [ ] Tap an unflagged word → skeleton appears in card chrome, then real card resolves.
- [ ] Drag-select two adjacent words → Phrase card.
- [ ] Drag-select an entire sentence (word-A → word-Z, ending on terminal punctuation) → Sentence card.
- [ ] Word card extras (`synonyms`, `collocations`, `register`, `another example`) all expand independently.
- [ ] Saving a word updates its in-passage style to "saved" and shows a toast.
- [ ] Mobile viewport (≤ 760px) presents the card as a bottom sheet; desktop presents as an anchored popover with pointer triangle.
- [ ] Cards with content taller than the viewport scroll internally — never overflow off-screen or get clipped.
