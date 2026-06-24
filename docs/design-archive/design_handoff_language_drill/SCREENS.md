# Screens — Language Drill

Per-screen specification. For each screen: purpose, layout, components, copy, states, interactions.

Read in order — they describe the user flow.

---

## 0. Onboarding

Reached on first launch. 4 sequential steps. Same structure on web and mobile, different chrome.

### Web — `prototypes/web/hifi/onboarding.jsx`

**Layout:** two-column. Left rail (320px) is a "coach" pane with brand mark, coach avatar, contextual coach message for the current step, and a vertical checklist of steps with progress indicators. Right pane is the active step content (max-width 760px), with a 4-segment progress bar at the top, fade-in animation between steps, and bottom action row (← back · "x / 4" · continue →).

**Step 1 · Languages.**
- Headline: "which languages are you learning?"
- Body: "pick any you're working on — even ones you haven't started yet."
- Component: 2-column grid of choice cards with flag dots (codeword on a colored circle) + language name + multi-select checkbox.
- Languages: español, français, 日本語, deutsch, italiano, português, 中文, 한국어. Default-selected: es, fr, ja, de.

**Step 2 · Primary + level.**
- Headline: "roughly, where are you with [primary]?" — `[primary]` shown with `.hilite` highlight.
- Body: "don't overthink it. you can always retake the placement test later."
- Component: vertical stack of 6 choice cards, one per CEFR band (A1–C2) with code + label + description.
  - A1 beginner — basic phrases, hello / goodbye
  - A2 elementary — simple convos, familiar topics
  - B1 intermediate — can handle most situations
  - B2 upper int. — fluent on familiar topics, some friction
  - C1 advanced — comfortable, occasional gaps
  - C2 mastery — near-native, all registers
- **Placement test callout** below the list. Dashed border, paper background, displays "not sure?" (Caveat 18px) + body text "take a 5-min adaptive placement test for a more accurate band." + two buttons: primary "take it now →" and ghost "later".
  - States: `idle` (default) · `dismissed` (replaced with sage confirmation strip "noted — you can run the placement test anytime from **settings → calibration**" with an undo) · `taking` (replaced with amber callout containing a stub message — placeholder for the real test launch).

**Step 3 · Goals.**
- Headline: "what do you want to drill?"
- Body: "i'll prioritize these in your daily plan. multi-select."
- Component: 2-column grid of choice cards. Each card: icon (placeholder emoji in prototype — replace with real icons), label, description, multi-select checkbox.
  - 📝 grammar — subjunctive, tenses, conjugation
  - 🗣 speaking fluency — real conversations, less hesitation
  - 🎧 understanding fast speech — podcasts, native speakers, films
  - ✍️ writing — emails, essays, longer texts
  - 📚 vocabulary — expanding active range
  - 🎯 prep for a trip / convo — specific upcoming need
- Below: textarea, label "anything specific i should know? (optional)", placeholder "e.g. I keep mixing up preterite vs imperfect…"

**Step 4 · Schedule.**
- Headline: "how much time per day?"
- Body: "consistent and short beats long and irregular. you can change this anytime."
- Component: 4-column grid, large numbers (28px Fraunces) — 5 / 10 / 20 / 30. "min / day" caption.
- Below: card with checkbox "gentle nudges on quiet days · no streak shaming. one calm note if you've missed two days, never more."
- Below that: Caveat "p.s." note: "no XP, no levels, no leaderboards. honest skill numbers only."
- Final CTA: "finish setup →"

**Coach pane content (left rail):**
- Brand mark + "drill" wordmark.
- Avatar (ink dot with "c") + label "coach" / "your AI tutor".
- Contextual message changing per step:
  - 0: "let's start with languages. you can add more later."
  - 1: "for spanish — where would you place yourself? rough is fine."
  - 2: "what do you want to drill? pick whatever fits — even all of them."
  - 3: "last thing — how much time can you usually give me?"
- "so far" checklist of steps with `○` (pending), `●` (current), `✓` (done) markers + selected values.
- Footer: Caveat note "~2 min total · skip anything"

### Mobile — `prototypes/mobile/mobile/onboarding.jsx`

Same 4 steps, vertically stacked. Top progress bar (4 segments, current is 2x flex), back arrow on steps 2–4, "x/4" text indicator. Sticky bottom CTA row (back · continue/finish).

**Headline copy is shortened on mobile** to fit single-line at 26px display:
- "which languages?" (instead of full sentence)
- "your spanish level?"
- "what to drill?"
- "time per day?"

Leading paragraph and step-by-step body content matches web.

Layout: full-bleed, 14–20px horizontal padding, scrollable body, `border-top: 1px solid var(--rule)` separating sticky CTA.

Coach pane is collapsed on mobile — the contextual coach message is omitted (the headline + body carry the same intent). If you want a coach presence on mobile onboarding, surface it via the CoachFab on later screens.

---

## 1. Dashboard / today's plan

The home screen. Shown on launch (post-onboarding) and tab navigation.

### Web — `prototypes/web/hifi/dashboard.jsx`

**Layout:** within `.main-inner` (1100px max). Top: editorial today header. Middle: today's plan card with a sequenced list of drills. Bottom: skill meters strip.

**Today header.**
- Eyebrow: `t-micro` "tuesday · day 12"
- Title: `t-display-l` "buenos días, sam" (warm hello in primary language)
- Body: "you're tracking around B1+. today: 24 min, focus on production."
- Right side: language switcher chip (current language flag + name + chevron).

**Today's plan card.**
- `.card` container, padding 24–32px.
- `t-display-m` "today's plan"
- Subtitle: "5 items · ~24 min · grammar + production"
- Vertical list of plan items, each row:
  - Icon/dot (small accent or paper3 fill) indicating drill type.
  - Title (`t-display-s`): "preterite vs imperfect — 8 cloze items"
  - Subtitle (`t-small`): "grammar · ~6 min"
  - Right-aligned chip: status (queued / in progress / done).
- Items in the prototype:
  1. "preterite vs imperfect" — 8 cloze items, grammar, ~6 min. Status: in progress.
  2. "kitchen + cooking vocabulary" — 12 vocab items, vocab, ~5 min.
  3. "production · en→es translation" — 6 phrases & sentences, production, ~7 min.
  4. "fast speech: el pais headlines" — 4 listening clips, listening, ~4 min. (Wireframed only — placeholder card.)
  5. "narrate yesterday in past" — 1 speaking task, speaking, ~2 min. (Wireframed only.)
- Each row is clickable → routes to the corresponding drill screen.

**Skill meters strip.**
- 6 horizontal bars, one per skill: listening · reading · writing · speaking · grammar · vocab.
- Each row: skill name (`t-small`) · band tag (e.g. "B1+") · `MBar` filled to 0–100%.
- The strip lives below the today's plan card, possibly within a tinted background block (`--paper-2`) for separation.

### Mobile — `prototypes/mobile/mobile/dashboard.jsx`

**Layout:** scrollable column. Top: header with avatar + greeting + language chip. Middle: today's plan card stack. Bottom: skill meters compact view. Coach FAB in bottom-right above bottom nav.

**Header section:**
- Eyebrow: "tuesday · day 12"
- Title: `t-display(26)` "buenos días, sam" (line-height 1.2, letter-spacing -0.3px)
- Body: "you're tracking around **B1+**. today: 24 min, focus on production."
- Right side: language pill (rounded chip, paper2 bg).

**Plan items:** stacked `MCard`s, each with a colored vertical accent strip on the left (kind-coded), title, subtitle, time chip, "→" trailing icon.

**Skill meters:** 6-row block, simpler than web — small label + band + bar, tighter spacing (`s-2` / `s-3`).

**Bottom nav:** today (active) · drill · progress · you.

---

## 2. Cloze drill

The core practice loop for grammar items. Multi-item session (default 6).

### `prototypes/web/hifi/cloze.jsx` and `prototypes/mobile/mobile/cloze.jsx`

**Layout (web):** Full-screen drill mode (no main-inner padding). Top: 3px progress bar showing position in session. Below: split layout — large prompt area on left, coach/feedback rail on right. Bottom: action bar with "skip" (ghost) · "check" / "next" (primary).

**Layout (mobile):** Same as web stripped down — prompt fills the viewport, action bar is sticky bottom.

### Modes

A pill toggle near the top — "multiple choice" / "type it" — switches the input mode for the same items.

**Multiple-choice mode:**
- Prompt: sentence with a styled blank, e.g. "Si yo ___ más tiempo, viajaría a Japón."
- Below the prompt: 4 choice cards in a 2×2 (web) / vertical stack (mobile). Cards use the choice-card pattern.
- "check" CTA appears once a choice is selected.

**Typed mode:**
- Same sentence, but the blank is an inline text input (focused on render).
- Below input: tiny secondary controls — "show hint" (link, reveals first letter or person/tense hint), "I don't know" (skip + show answer + add to review).
- "check" CTA enables when the input is non-empty.

### States

1. **Prompt** — sentence + input(s) visible, no feedback.
2. **Checked** — feedback inline:
   - **Correct:** sage `--ok-soft` strip below prompt, with the sentence rendered with the blank filled in green-ink, plus a brief coach line: "exact." or "right — past hypothetical takes imperfect subjunctive."
   - **Incorrect:** terracotta `--accent-soft` strip with the user's answer struck through + correct answer in green-ink + coach explanation. A "show theory" trigger appears that opens the theory panel.
3. **Answered** → "next" CTA replaces "check"; pressing it advances the cursor and resets state with fade-in.

### Theory trigger

Small dashed-border pill, top-right of the prompt area, label: "theory · subjunctive". Clicking opens the theory side panel scrolled to the relevant topic.

### Item bank (in prototype)

6 items mixing preterite / imperfect / subjunctive / por vs para. Topics surface on the theory trigger.

---

## 3. Translation drill

Open-ended production. EN → ES.

### `prototypes/web/hifi/translation.jsx` and `prototypes/mobile/mobile/translation.jsx`

**Layout:** prompt card top (with English source + small "context" hint), large textarea below for the user's translation, accent-character row below the textarea (á é í ó ú ñ ¿ ¡), action bar at the bottom with "skip" / "check".

**Prompt card:**
- `t-micro` eyebrow: "translate to spanish"
- `t-display-m` source sentence in English.
- `t-small` context hint if present, italicized: "spoken to a friend, casual."

**Textarea:** 4–6 rows visible, autofocus, max-width 720px on web, full width on mobile. `t-body-l` line-height for comfortable typing.

**Accent picker:** small row of buttons for accented Spanish characters. Tapping inserts at the cursor.

**States:**
1. **Typing** — content present, "check" enabled.
2. **Graded** — feedback section appears below the textarea:
   - Correct: sage strip "✓ correct — your translation is accepted." + the user's input in green-ink + (if applicable) "alternate accepted: …" listing other valid translations.
   - Near-miss: amber strip "close — small fix" + diff highlighting (struck-through user word + correct word in `--ok` green) + coach note explaining the gap.
   - Incorrect: terracotta strip with explanation.
3. **Next** — same advance pattern as cloze.

**Mid-typing state (mobile)** has the keyboard up — the action bar sits above the keyboard, the textarea takes the remaining space.

### Items (in prototype)

6 items mixing phrases ("I'm starving") and full sentences ("If I had more time, I'd travel to Japan."). The grading is stubbed — in production, call your LLM with a rubric.

---

## 4. Vocabulary recall (mobile-only as a designed screen)

### `prototypes/mobile/mobile/vocab.jsx`

Rapid recall, like flashcards but with tighter pacing.

**Layout:** centered prompt card.
- Top: term in target language (`t-display-l`), e.g. "**la sartén**".
- Below: optional hint button — "show hint" reveals a small note ("kitchen item, used for frying").
- Input: text field for the English meaning OR "I know" / "show me" buttons depending on the mode.
- Action: "check" → graded inline (sage = exact / fuzzy match accepted; terracotta = wrong; with the correct meaning shown).

States: `prompt` · `hint revealed` · `graded`.

The web version isn't built — if implementing on web, follow the same structure with the cloze layout's split-pane.

---

## 5. Theory reference panel

Reachable from any drill screen and from the dashboard.

### Web — `prototypes/web/hifi/theory.jsx`

**Layout:** right-side slide-over, full height, ≤960px wide. Backdrop is `rgba(26,22,18,0.42)` with `backdrop-filter: blur(4px)`.

**Internal structure:**
- **Header** (full width): `t-display-m` topic title + close button (×, top right). Border-bottom 1px rule.
- **TOC sidebar** (240px wide, paper-2 background): vertical list of section titles. Active section highlighted with `--accent` left-border, paper-3 fill, ink text. Below the TOC, separated by a dashed rule, a "other topics" list — quick-jumps to other theory topics.
- **Scrollable content** (right): rendered theory. Smooth scroll. Sections separated by dashed rules.

**Section content patterns:**
- `theory-section-title` (Fraunces 24px) — section heading.
- `theory-content` paragraphs (15px / 1.65), with `<strong>` keywords in `--ink`.
- `theory-list` for bullets.
- `theory-table` for conjugation tables (Inter labels, Mono values, paper-2 header).
- `example` blocks for worked examples (Spanish line in Fraunces 18px, English translation italicized in `--ink-soft`, optional note in `--ink-mute` separated by dashed border).
- `callout` for emphasis: amber bg, accent left-border, body text. `.warn` variant uses accent-soft + accent border.

**Topics in prototype:** subjunctive, preterite vs imperfect (linked from cloze).

**Footer CTA (sticky):** "back to drill" (primary) · "open in study mode" (ghost). Sticky-positioned with paper-fade gradient above it.

**Scroll-sync:** as user scrolls the content, the TOC item for the visible section highlights. Click TOC → smooth-scroll to section.

### Mobile

Same content rendered in a bottom sheet (`MSheet`). 78% screen height, drag-to-dismiss. The TOC collapses to a horizontal scrolling chip row at the top of the sheet body. Sections stack normally below.

---

## 6. Post-session debrief / feedback

After completing a drill session, the user lands here.

### Web — `prototypes/web/hifi/feedback.jsx`

**Layout:** centered, max-width 920px. Top: editorial header. Below: tab switcher (review · debrief). Tab content fills the remaining space.

**Header:**
- Eyebrow: "session complete · 6 items · 4m 38s"
- Title: `t-display-l` "nicely done." (or "good attempt." for <70% correct, "back next time?" for <40% — three variants.)
- Body: 1-line coach summary referencing what was studied.

**Tabs:**
- **review** (default): per-item diff list. Each row shows the prompt, user's answer (struck through if wrong) vs correct answer, optional note. Correct items collapse by default; incorrect items expand. Click row to expand/collapse.
- **debrief**: narrative coach text — 2–3 paragraphs of analysis. Below: skill deltas as horizontal bars showing before/after positions on each skill (e.g. grammar +2 toward B2). Below that: "what's next" suggestion ("3 more sessions on conditional should land you in B2.")

**Action footer:**
- Primary: "next session" · ghost: "see progress" · ghost: "done"

### Mobile — `prototypes/mobile/mobile/debrief.jsx`

Same content, single-column. Tabs stack as a segmented control at the top. Item rows are full-width cards. Action footer sticky bottom.

---

## 7. Progress / skill breakdown

Reached from bottom nav (mobile) or left rail (web).

### Web — `prototypes/web/hifi/progress.jsx`

**Layout:** within `.main-inner`. Top header (page title + body). Middle: skill radar visualization. Below: heatmap (28 days, 7×4 grid showing minutes/day). Below: per-skill detail cards.

**Header:**
- Eyebrow: "spanish · since march 4"
- Title: `t-display-l` "your progress."
- Body: "you're tracking around B1+ overall. last 30 days: +6 percentile points in grammar."

**Skill radar:** 6-axis SVG radar (listening, reading, writing, speaking, grammar, vocab). Points connected, area filled with `--accent-soft`. Radar gridlines in `--rule`. Axis labels in `t-small`. The radar is paired with a 28-day-ago dotted overlay to show change.

**Heatmap:** 7-row × 4-column grid, each cell ~20×20px. Cell color encodes minutes practiced (paper-3 = 0, paper-2 = 1–9, hilite-soft = 10–19, hilite = 20–29, accent-soft = 30+). Tooltip on hover.

**Skill detail cards:** horizontal grid of 6 cards, one per skill. Each: skill name (`t-display-s`), current band (large numeric, Fraunces), bar showing position within the band, change tag (+/−), and a tiny sparkline of the last 14 days.

### Mobile — `prototypes/mobile/mobile/progress.jsx`

Vertical column. Same radar at smaller size (~280px). Heatmap is 7×7 (49 days) compressed. Skill cards stack vertically.

---

## 8. Read & collect (paste-text → annotate → word bank)

A lightweight bridge between the user's external reading and the drill pipeline. The user pastes a passage from anything they're reading; the system flags words above their estimated level; the user picks which to learn; saved words flow into cloze, vocab recall, and translation drills.

### Web — `prototypes/web/hifi/read.jsx`

**Entry points.**
- Left-nav item "read" (between drill and progress).
- Dashboard card at the bottom: "reading something this week? — paste a paragraph — i'll mark words above your level and weave them into your next session." Primary CTA "open reader →".

**Top bar.** Eyebrow "reading" + title `t-display-m` "read & collect". Right side: three small buttons — "current text" / "history" (with count badge) / "+ paste new". Border-bottom 1px rule.

**Layout uses `.main-inner` (1100px max).** Below the top bar there's a single view (`empty` / `pasting` / `annotated` / `history`) selected by the buttons. Default view on first launch is `empty`; once a passage exists it defaults to `annotated`.

### Empty state

Centered column, max-width 640px, top margin 60px.
- Caveat eyebrow (26px, accent): "read in the wild"
- Title: `t-display-l` "paste anything you're reading."
- Body: "a paragraph from a book, an article, a conversation. i'll mark the words above your level and surface them in your next sessions."
- Primary CTA: "paste a text →"
- Below: paper-2 dashed-border instructional card with `t-micro` heading "how it works" + 4-step ordered list (paste ≤ 2,000 chars · highlight rarer than band · tap to see meaning · saved words appear in drills tagged "from your reading").

### Pasting state

Max-width 720px column.
- Eyebrow "new text" + title "paste a passage"
- Field 1 (optional): "title or source" — single-line input, placeholder `e.g. Cien años de soledad — ch. 1`. 14px Inter.
- Field 2: "passage" — textarea, min-height 240px, **Fraunces 16px / 1.6 line-height** (treated as reading text, not UI). Placeholder: "paste a paragraph here. just one or two — quality over quantity. i'll work better with prose than with code or lists."
- Below textarea: char counter (`tnum` mono) on the left ("0 / 2,000"), action row on the right — "cancel" (ghost) + "annotate →" (primary, disabled until non-empty and ≤ 2,000).
- At >2,000 chars: counter color flips to `--accent`, suffix "· too long", primary disabled.
- Tip strip below: paper-2 background, Caveat "tip" + `t-small` "annotation runs locally first; if you save, the text is stored only in your account. nothing is shared."

### Annotated read view

**Two-column layout: text pane (1fr) + sticky right rail (280px).**

**Left — reader pane.**
- Header row: title (`t-display-m`) + source line (`t-small`) on the left; **highlight intensity segmented control** on the right ("subtle" / "assertive" — pill border container, active option fills `--ink` with `--paper` text).
- Calibration strip below header: `chip` reading "~B1+ calibration" + body text "showing words rarer than top-3000 · refined by your known set" + "adjust" ghost button at far right. Bordered with a dashed bottom rule.
- **The text** itself, Fraunces 19px / 1.75 line-height, ink color, no max-width constraint other than the column. Flagged words wrap in `<button class="rd-word ${intensity} ${saved?}">` — see highlight styles below. Clicking outside any word/popover dismisses the active popover.
- Footer summary row (paper-2 fill, rounded): mono counter "N flagged · N saved · N skipped" on the left; "clear bank" (ghost) + "save N to bank →" (primary, disabled when bank is empty) on the right.

**Right — word bank rail.** Sticky, top: 24px from top, max-height calc(100vh − 80px), card surface.
- Header row: `t-display-s` "word bank" + mono count.
- `t-small` subtitle: "marked from this passage".
- Empty state: dashed-border message "tap a highlighted word to see its meaning, then save it here."
- List: vertical stack of paper-2 rows. Each row = `lemma` (Fraunces 14px 500) + `gloss` (Inter 11px ink-soft) on the left, CEFR badge (mono 10px ink-mute) on the right, "×" button to remove.
- Footer (dashed top rule): explanatory `t-small` "saved words appear in cloze, vocab recall, and translation drills tagged [from your reading chip]".

### Highlight metaphors (intensity toggle)

Two visual treatments for above-level words. Both render on the same DOM; switching the toggle re-applies CSS classes.

**Subtle (default).** Dotted underline in `--accent`, 1.5px thickness, 4px underline-offset. Hover fills `--accent-soft` background, switches underline to solid.

**Assertive.** Amber wash gradient — `linear-gradient(180deg, transparent 50%, var(--hilite-soft) 50%, var(--hilite-soft) 92%, transparent 92%)`. 1px horizontal padding for visual separation. Hover deepens to flat `--hilite-soft`.

**Saved (state on top of either intensity):** in subtle mode, swaps to a 2px solid `--accent` underline + `--accent-2` ink color + 500 weight. In assertive mode, becomes a flat `--accent-soft` pill (3px radius) with `--accent-2` ink color + 500 weight + 1px outer halo.

**Active (popover open):** override both — fills `--ink`, sets text to `--paper`, 3px radius, 0 3px padding, no underline. Resets when the popover dismisses.

### Word card popover (web)

Click-anchored, 320px wide, `--card` background, 1px `--ink` border, `--shadow-3`, fade-in 180ms. Auto-positions: `x` is clamped to keep the card on screen; `y` is 6px below the word.

**Internal structure:**
- Pointer triangle on the top edge, aligned to the word's center via the original click coordinates.
- Header: lemma (Fraunces 22px 500) + POS label (`t-small`, italic) inline + CEFR badge (mono 11px accent) right-aligned. Border-bottom rule. Below: gloss (`t-body`, ink-2).
- Body: `t-micro` "example" + Fraunces 15px example sentence (em-dash separator between Spanish and English).
- Footer (paper-2 fill, top rule): mono frequency rank on the left ("freq #N") + two buttons — "skip" (ghost) and "+ save to bank" (primary). When already saved, the right button becomes "✓ saved · undo" with `accent` variant.

### Save toast

Triggered by "save N to bank →". Fixed bottom-center, 80px from bottom, 540px max-width, `--ink` background, `--paper` text, `--shadow-3`.
- Sage circle ✓ on the left.
- Body: bold "N words added" + secondary "your next session will weave them in."
- Right side: outlined button "see next session" → routes to cloze. "×" dismiss.
- Auto-dismisses after 4 seconds.

### History view

Max-width 800px column.
- Eyebrow "your reading" + title "past texts".
- Vertical stack of cards (1px `--rule` border, `--card` background, hover swaps to `--ink` border + `--paper-2` background).
- Each card: title (Fraunces 18px 500) + source line (`t-small`) on a row, then a Fraunces-italic preview line (truncated with ellipsis), and on the right column a mono count "N flagged" + an `ok` chip "N saved".
- Sample history (mock): "Cien años de soledad" / "El País — opinión" / "NYT en español" / "Conversación con Marina". When clicked, opens the annotated view (in production, scrolls to that text's annotations and saved words).

### Mobile — `prototypes/mobile/mobile/read.jsx`

Same 4 views (`empty` / `paste` / `annotated` / `history`), adapted to phone idioms.

**Top bar.** `MTopbar` with title "read". Right action: in `annotated` view it's a clock icon → opens history; in `paste`/`history` views it's a back arrow → returns to `annotated`.

**Empty state.** Centered, `t-display(28)` headline, max-width 320px body text. Primary `MBtn` (pill, 48px) "paste a text →". Below: paper-2 dashed instructional card with the same 4-step list.

**Paste state.** Same fields, full-width inputs (12–14px padding, 10px radius). Textarea sets `font-family: Fraunces, fontSize: 16px, line-height: 1.55`. Char counter mono, accent on overflow. Action row: "cancel" (secondary `MBtn`, flex 1) + "annotate →" (primary, flex 2).

**Annotated state.**
- Title `t-display(22)` + source `t-ui(12)` ink-soft.
- Calibration row with a `Chip` ("~B1+ calibration") + segmented control on the right ("subtle" / "assertive", same active styling as web). Wraps if narrow.
- Text: Fraunces 18px / 1.7. Same `.mrd-word` highlight classes, same intensity logic.
- **Word bank as a chip strip below the text** (instead of a sticky rail). Paper-1 card. Header row: "word bank" (Fraunces 16px) + mono "N saved" count. List: flex-wrap row of accent-soft pill chips, each = `lemma` + `×`. Tapping a chip removes it. Empty state: "tap a highlighted word to add it." (italic, ink-mute).
- Footer action row: "clear" (ghost `MBtn`) + "save N to bank →" (primary, flex 2).
- Below: explanatory line + the "from your reading" chip inline.

**Word definition — bottom sheet (mobile-native).** Replaces the popover. `MSheet` 50% screen height, drag-to-dismiss.
- Lemma (Fraunces 28px) + POS (italic, ink-soft) inline + CEFR badge (mono 12px accent 600) right-aligned.
- Gloss in `t-ui(15)` ink-2.
- Example block: paper-2 fill, `t-micro` label + Fraunces 15px example.
- Bottom row: mono `t-mono(11)` frequency rank + matched form on the right.
- Action buttons: "skip" (secondary, flex 1) + "+ save to bank" / "✓ saved · undo" (primary or accent, flex 2).

**Save toast (mobile).** Absolute, 16px from edges, 84px from bottom. Same content as web, narrower layout, `--ink` background, `mslidein` 220ms entrance.

**History view.** Vertical stack of cards (paper-1 fill, 1px `--rule` border, 14px radius). Per card: title + when (mono 10px) on a row, source line, italic preview, then a chip row ("N flagged" default chip + "N saved" ok chip). Bottom: a "+ paste new text" secondary button spanning width.

**Dashboard entry.** Below the today-plan footer note, before the bottom nav: a card row with a small accent-soft icon tile (book icon) + "reading something?" headline + `new` accent chip + 1-line description + a chevron. Taps route to `read`.

### Data model (suggested)

```ts
type ReadEntry = {
  id: string,
  title?: string,
  source?: string,           // user-entered free-text "García Márquez · ch. 1"
  text: string,              // ≤ 2,000 chars
  pastedAt: number,
  flagged: { [matchedForm: string]: WordFlag },
  bank: string[],            // matched-form keys the user saved
};

type WordFlag = {
  lemma: string,
  pos: string,               // "f. noun", "v. (imp. pl.)", etc — short
  gloss: string,
  example: string,           // includes the EN translation after an em-dash
  freq: number,              // frequency-rank lookup (lower = more common)
  cefr: 'A2' | 'B1' | 'B2' | 'C1' | 'C2',
};
```

### Calibration logic (suggested)

> Default = **frequency rank**: flag any word whose form/lemma is rarer than a CEFR-band frequency floor (B1 user → flag rarer than top-3000). Refine with the user's known set: never flag a word the user has already drilled correctly twice; always flag a word the user has marked "I don't know" recently. Show the calibration as a chip ("~B1+ calibration") with an "adjust" affordance — fine for v1 to be no-op, just don't hide the calibration from the user.

### Drill integration

Saved words flow into:
- **Vocab recall** drills: term/definition pairs, prioritized when the dashboard's plan generator picks vocab items.
- **Cloze** drills: where the saved word is the blank. The cloze item carries an attribution chip "from your reading" pointing at the source title — render the chip below the prompt, not in the topic strip.
- **Translation** drills: prompts containing the saved word in the EN source (or its translation in the ES target).

Tagging is "tagged" (per the user's preference at the questions stage) — every derived item shows a small `accent` chip ("from your reading") so the user knows which items came from their bank.

### States checklist

For the read screen, account for:
- Empty (no past texts) → empty state.
- Paste in progress (user typing, > 0 chars).
- Paste at limit (≥ 2,000 chars) → counter accent, primary disabled.
- Annotation rendering (server-side analysis is slow) → skeleton: blank text with shimmer-tinted words at random positions; show a `Chip` "annotating…" near the title. This isn't designed but should match the existing skeleton vocabulary (`--paper-3`/`--paper-2` shimmer).
- Annotation done, no flagged words (all common) → instead of the bank rail, show a sage-tinted strip "this passage is well within your level — nice." with a CTA "paste something harder?".
- Word card / sheet open with no entry available (rare race) → show a `t-small` ink-mute "no entry yet for this word" + a "report missing" link.
- Save error (network) → keep optimistic local save, show a small accent toast "saved locally — will sync when you're back online."

---

These are designed in the wireframes (`prototypes/web/Language Drill Wireframes.html`) but haven't been brought to hi-fi. Apply the design language above when implementing.

- **Speaking exercise** — 3 wireframe variants (read-aloud, prompted response, conversation simulation). Microphone-driven, transcript appears, AI grades pronunciation + content.
- **Listening exercise** — 3 wireframe variants (clip + comprehension, dictation, real-time transcription quiz).
- **Writing exercise** — 3 wireframe variants (paragraph prompt, structured fill-in, journaling).
- **Theory standalone reading mode** — wireframed only. Probably skip in v1; the side panel covers the need.

---

## Component states checklist

For every component you build, account for these states:

- **Default**
- **Hover** (web only — `--ink` border, `--paper-2` background on choice card)
- **Focus** (keyboard-visible — `:focus-visible` with 3px `rgba(26,22,18,0.08)` ring)
- **Active / pressed** (mobile — slight scale-down via `transform: scale(0.97)` 80ms)
- **Selected** (`--ink` border, `--hilite-soft` background)
- **Disabled** (40% opacity, no pointer events)
- **Loading** (skeleton shimmer in `--paper-3`/`--paper-2`)
- **Error** (border `--accent`, error text below in `t-small` color `--accent`)

---

## Last word

The prototype HTML is the visual spec; this document is the behavioral spec. When in doubt, run the prototype and look at it — that's why I built it.
