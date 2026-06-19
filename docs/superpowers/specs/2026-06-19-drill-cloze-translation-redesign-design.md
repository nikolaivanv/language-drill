# Drill cloze + translation redesign — design

**Date:** 2026-06-19
**Source design:** Claude Design project `d676e7c3-d8fe-495f-a250-94c38e174fbd`,
files `Drill Types - Redesign.html` (web) and
`Drill Types - Mobile Web Redesign.html` (mobile).
**Goal:** fix the prompt visual hierarchy and make the cloze blank an inline,
typeable input; bring translation's prompt presentation into the same system.
Not pixel-perfect — focus on the real deltas: *how a task is presented* and
*how the learner provides an answer*.

## Scope

Two components in `apps/web/app/(dashboard)/drill/_components/`:

- `cloze-exercise.tsx`
- `translation-exercise.tsx`

Plus their tests. One responsive implementation each — desktop and mobile-web
share the component (mobile gets the sticky submit bar already provided by
`DrillActionProvider` / `useDrillAction`).

**Out of scope** (prototype-only chrome / data changes):

- The Cloze ⇄ Translation mode switch (a generated cloze is not convertible to a
  translation — different exercise rows).
- The inline "A1" drill-level dropdown (level is handled elsewhere).
- Multi-blank clozes (the mobile mock demos two gaps; our `ClozeContent` has a
  single `___` marker + single `correctAnswer`. Multi-blank needs schema +
  generation changes).
- No changes to `ClozeContent` / `TranslationContent`, generation, or the API.

The design tokens (`--accent` terracotta, `--ok` green, `--paper`, the Fraunces
display serif) already exist in the app's `globals.css`. This is restructuring,
not re-skinning.

## A. Cloze — 3-level hierarchy + typeable inline blank

### Presentation

Replaces the current stack (context line → italic glossEn → `t-display-s`
sentence → detached `<Input>`). New order:

1. **Grammar eyebrow (level 1).** `content.context` rendered as an uppercase
   `t-micro` eyebrow preceded by a 5px accent dot (`bg-accent` round). The dot +
   eyebrow read as a quiet "what's tested" tag. Hidden when `context` is empty.
2. **Hero sentence (level 2).** `content.sentence` at hero display-serif scale
   (`t-display-m`, ~40px Fraunces 500), with the **typeable blank inline** at the
   `___` position.
3. **Meaning gloss (level 3).** `content.glossEn` with a "MEANING" eyebrow label
   (`t-micro text-ink-mute`) and the gloss in `text-ink-soft`. Hidden when
   `glossEn` is empty.

### The inline blank (the real interaction delta)

- A controlled, auto-widening inline `<input>` placed between the `before` /
  `after` slices from `splitClozeSentence(content.sentence)`.
- Auto-width: width tracks `max(value.length, minChars)` so it grows as the
  learner types; never collapses below a small minimum.
- States via class, matching the mock:
  - empty → `border-bottom` terracotta (`--accent`), terracotta caret.
  - filled (idle) → `border-bottom` ink.
  - correct (evaluated) → green text + green underline + faint green fill.
  - wrong (evaluated) → terracotta text + terracotta underline + faint fill.
- Autofocus on mount (replaces the current `inputRef` focus). `Enter` submits
  when enabled.
- `AccentPicker` is reused unchanged, with `targetRef` pointing at the blank's
  `ref` — it already inserts at the cursor via the native value setter, so an
  inline `<input>` works as-is.
- **"show options · easier"** toggles a chip row (`content.options`). Tapping a
  chip writes the word into the blank and sets `usedMc = true` (preserves the
  scaffolded progress signal). This replaces the old behaviour where MC mode
  swapped the input for a radio group. A "type straight into the gap" hint sits
  under the sentence and hides once options are shown.
- Submit is the existing full-strength terracotta `Button variant="accent"`,
  enabled only when the blank has non-whitespace input.
- On evaluation: the blank is disabled and gets the correct/wrong colour inline;
  the existing `FeedbackShell` renders below (it already reveals the correct
  answer + "also accepted" — added earlier this session). Submit hides; `next`
  lives in the shell.
- Mobile: when `useDrillAction().active`, the submit CTA is published to the
  sticky bottom bar exactly as today; `canSubmit` is driven by the blank value.

### Fallback

When the sentence has no `___` marker (`hasBlank === false`), keep the current
detached `<Input>` below the sentence so non-blank clozes still work. The
typeable-blank path is only taken when there is a real gap.

## B. Translation — hierarchy consistency

Current: a `t-micro` "EN → TR" line, `t-display-s` source (GlossedText),
textarea + AccentPicker, hints, submit. New presentation:

1. **Eyebrow + accent dot.** `EN → {targetLang}` plus `· {topicHint}` when
   present, as the same dot+eyebrow tag used in cloze.
2. **Hero source.** `content.sourceText` via `GlossedText`, bumped to the hero
   display scale to match cloze.
3. **GOAL gloss.** A secondary "translate the meaning, not every word" line with
   a "GOAL" eyebrow label (`t-micro`), in soft ink.
4. Textarea, AccentPicker, "show me a hint", and the full-terracotta submit are
   unchanged in behaviour.

## Testing

- `cloze-exercise.test.tsx` (extend; update assumptions):
  - Renders the inline blank inside the sentence (before/after text present).
  - Typing enables submit; empty disables it; `Enter` submits.
  - Accent-key insertion lands in the blank.
  - "show options" reveals chips; clicking a chip fills the blank and the
    submitted `meta.usedMc === true`.
  - Evaluated state disables the blank and applies the correct/wrong class.
  - Grammar eyebrow (context), hero sentence, and MEANING gloss render; each is
    omitted when its field is empty.
  - Non-blank fallback: a sentence without `___` renders the detached input.
  - Replace tests that asserted the old detached-`<Input>` / radio-pill MC.
- `translation-exercise.test.tsx` (extend): eyebrow shows `EN → TR · {topic}`;
  GOAL gloss renders; source still glossed.
- Keep `drill/page.test.tsx` green (it renders cloze in-session).

## Risks / notes

- Auto-width inline input: keep a sensible min width and let it grow; our clozes
  are single short words/forms, so wrapping is not a concern.
- Accessibility: the blank keeps an `aria-label` ("fill the blank") since it has
  no visible `<label>`; it remains a real `<input>` (not contenteditable) so the
  accent picker, selection APIs, and tests work unchanged.
- The mobile "tap a gap and type" copy collapses to the single hint string; we
  do not implement gap-focus routing because there is only one gap.
