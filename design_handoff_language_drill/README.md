# Handoff: Language Drill app

A focused language-learning app — fluency through deliberate drilling. Web (desktop SPA) and Android mobile, both designed end-to-end as hi-fi prototypes.

## About the design files

The files in this bundle are **design references** — HTML/JSX prototypes built to show intended look, layout, copy, and behavior. They are **not production code to copy directly**. Your job is to recreate them in your target environment (React/Next.js for web, native Android / React Native / Compose for mobile, etc.) using your codebase's existing patterns. If no environment exists yet, pick what fits — the design is framework-agnostic.

Treat the prototypes as the source of truth for visuals and interaction; treat `tokens.css` / `tokens.json` as the source of truth for design values.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, copy, micro-interactions. Recreate pixel-close. Where two ways are equally valid, prefer your codebase's idioms over copying my markup verbatim — but keep the visual outcome identical.

## File layout in this bundle

```
design_handoff_language_drill/
├── README.md                    ← you are here
├── tokens.css                   ← all design tokens as CSS custom properties
├── tokens.json                  ← same tokens in JSON (for build tools / Tailwind config)
├── prototypes/
│   ├── web/
│   │   ├── Language Drill Prototype.html      ← entry — open in browser
│   │   └── hifi/                              ← per-screen JSX components
│   │       ├── shell.jsx        ← left nav + lang switcher (web shell)
│   │       ├── onboarding.jsx   ← 4-step onboarding
│   │       ├── dashboard.jsx    ← today's plan + skill meters
│   │       ├── cloze.jsx        ← cloze drill (choice + typed modes)
│   │       ├── translation.jsx  ← (not currently rendered on web canvas — see notes)
│   │       ├── theory.jsx       ← right-side theory slide-over
│   │       ├── feedback.jsx     ← post-session debrief (review + narrative tabs)
│   │       ├── progress.jsx     ← skill radar + heatmap
│   │       ├── read.jsx         ← paste-text → annotate → word bank (feeds drills)
│   │       └── styles.css       ← web stylesheet (use tokens.css as the canonical source)
│   └── mobile/
│       ├── Mobile Prototype.html              ← entry — opens design canvas of all phone screens
│       └── mobile/                            ← per-screen JSX
│           ├── m-kit.jsx        ← M (color) + T (type) tokens + primitives (MBtn, MSheet, MScreen, MBottomNav, CoachFab, MCard, MBar, Chip)
│           ├── onboarding.jsx   ← 4-step onboarding (mobile)
│           ├── dashboard.jsx    ← today's plan
│           ├── cloze.jsx
│           ├── translation.jsx
│           ├── vocab.jsx
│           ├── debrief.jsx
│           ├── progress.jsx
│           └── read.jsx         ← paste-text → annotate → word bank (mobile)
└── SCREENS.md                   ← screen-by-screen spec (layout, copy, states, interactions)
```

To open the prototypes locally: `cd prototypes/web && python3 -m http.server` then visit `Language Drill Prototype.html`. Same for mobile.

---

## Stack assumptions (suggested, not prescriptive)

**Web:** React 18 + Vite or Next.js. Plain CSS or CSS Modules driven by `tokens.css`. No CSS-in-JS dependency — the prototype mostly uses className + a single stylesheet plus inline styles for one-offs.

**Mobile:** Native Android (Kotlin + Compose) is the cleanest fit for the design language. React Native / Expo also works if you want code sharing. The prototype is rendered in React inside an Android frame for visualization only — don't take that as a recommendation.

**Fonts:** Fraunces, Inter, JetBrains Mono, Caveat — all on Google Fonts.

---

## Design language (tl;dr)

- **Voice:** lowercase, plainspoken, warm-but-not-cute. No XP / streaks / leaderboards / gamification. The product talks to the user like a calm tutor, not a slot machine.
- **Visual:** "warm paper" palette — off-white background (`--paper`), high-contrast ink, terracotta accent, amber highlights for selection/emphasis. Slight editorial/literary feel via Fraunces in display sizes.
- **Type pairing:** Fraunces (display, weight 500) + Inter (UI) + JetBrains Mono (numbers/codes) + Caveat (sparingly, for personality — coach voice, "p.s." notes). Use Caveat at most 1–2 times per screen.
- **Density:** generous on web (1100px max content width); compact-but-not-cramped on mobile (16px gutters, 48px tap targets).
- **Restraint:** no gradients except the sticky-fade footer. No emoji (the wireframes had some — the hi-fi removed them). Icons are line-drawn, 1.6–1.9px stroke. Never reach for shadow when a 1px rule will do.

---

## Tokens (see `tokens.css`)

### Color

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#faf7f1` | primary background |
| `--paper-2` | `#f2ede2` | recessed surface, hover background, sidebar |
| `--paper-3` | `#e8e1d2` | meter track, inactive bar fill |
| `--card` | `#ffffff` | elevated surfaces (drill items, cards, dialogs) |
| `--ink` | `#1a1612` | primary text + active fills |
| `--ink-2` | `#3d362e` | body copy (web only) |
| `--ink-soft` | `#5a5148` | secondary text |
| `--ink-mute` | `#8a8074` | tertiary / metadata |
| `--rule` | `#d8d0bf` | default border |
| `--rule-strong` | `#c9bfac` | high-contrast border |
| `--accent` | `#c96442` | primary accent (terracotta) |
| `--accent-2` | `#b15535` | accent hover |
| `--accent-soft` | `#f7e2d3` | accent tint |
| `--hilite` | `#f4d35e` | highlight (amber) |
| `--hilite-soft` | `#fbeeb6` | highlight wash (selected choice background) |
| `--ok` | `#5b8a5a` | success (sage) |
| `--ok-soft` | `#d8e6d3` | success tint |

Mobile uses a slightly lighter rule (`#e0d8c8`) — visually equivalent on retina displays. If you're unifying, use the web value.

### Type scale

| Token | Size | Family | Notes |
|---|---|---|---|
| `t-display-xl` | 56 / 1.05 | Fraunces 500 | hero, web only |
| `t-display-l` | 40 / 1.10 | Fraunces 500 | page title, web |
| `t-display-m` | 28 / 1.20 | Fraunces 500 | section title |
| `t-display-s` | 22 / 1.25 | Fraunces 500 | card title |
| (mobile display) | 26 / 1.20 | Fraunces 500 | replaces XL/L on phone |
| `t-body-l` | 17 / 1.55 | Inter 400 | lead paragraph |
| `t-body` | 14 / 1.55 | Inter 400 | default |
| `t-small` | 12 / 1.45 | Inter 400 | captions |
| `t-micro` | 11 / 1.40 | Inter 500, uppercase, letter-spacing 1.2 | step indicators, eyebrows |

**Important: line-height ≥ 1.2 on any wrappable display headline.** I learned the hard way that 1.05–1.15 produces collisions when text wraps to a second line. Use 1.05 only for headlines that are guaranteed to fit on one line (e.g. `t-display-xl` in a wide container).

### Radius

`--r-sm: 6px` (chips, kbd) · `--r-md: 10px` (buttons, inputs, choice cards) · `--r-lg: 16px` (web cards) · `--r-xl: 24px` (mobile sheet header) · pill: `999px` (mobile buttons, chips, bars).

### Spacing

4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 px scale. Mobile screen padding: 16–20px horizontal. Web main content: 36px vertical / 48px horizontal, capped at 1100px.

### Shadows

Three levels (`--shadow-1/2/3`) — see `tokens.css`. Use shadows sparingly. The design lives on `1px solid var(--rule)` borders, not on elevation.

---

## Component patterns

These appear repeatedly across screens. Build them once, reuse.

### Buttons

```css
.btn { padding: 10px 18px; border-radius: 10px; border: 1px solid var(--ink); background: transparent; color: var(--ink); font-size: 13px; font-weight: 500; }
.btn:hover { background: var(--ink); color: var(--paper); }
.btn.primary { background: var(--ink); color: var(--paper); }
.btn.primary:hover { background: var(--accent-2); border-color: var(--accent-2); }
.btn.ghost { border-color: transparent; color: var(--ink-soft); }
.btn.sm { padding: 6px 12px; font-size: 12px; }
.btn.lg { padding: 14px 24px; font-size: 15px; }
```

**Mobile buttons** are pill-shaped (`border-radius: 999px`), 48px tall (lg), 40px (md), 32px (sm). See `mobile/m-kit.jsx → MBtn`.

### Choice card

The radio/checkbox tile pattern used in onboarding (languages, level, goals) and cloze (multiple-choice). Default state has a 1px `--rule` border on `--card`; hover deepens to `--ink` border + `--paper-2` background; selected has `--ink` border + `--hilite-soft` background. Single-select uses a circular dot indicator on the right; multi-select uses a square checkbox.

### Chip

Pill, 11px Inter 500, `--paper` bg, `--rule` border, `--ink-soft` text. Variants: `solid` (filled `--ink`), `accent` (`--accent-soft` bg), `ok` (`--ok-soft` bg).

### Bar (progress meter)

Track is `--paper-3`, fill is `--ink` by default, optional `accent` and `ok` variants. Height 6px, fully rounded. Animated width transition 0.3s.

### Top nav (web)

Fixed-width left rail (220px) with brand mark, language switcher, nav items (drill / progress / theory), and avatar at the bottom. See `hifi/shell.jsx`.

### Bottom nav (mobile)

4 items — today / drill / progress / you. 64px tall, line icons, active item is `--ink`, inactive is `--ink-mute`. See `mobile/m-kit.jsx → MBottomNav`.

### Bottom sheet (mobile)

Drag-to-dismiss, 78% screen height by default, 24px corner radius on top edge. Backdrop is `rgba(26,22,18,0.45)`. See `mobile/m-kit.jsx → MSheet`.

### Theory slide-over (web)

Right-side panel, full-height, ≤960px wide. Has its own internal layout: 240px TOC sidebar (scroll-syncs to active section, plus quick-jump to other topics) + scrollable content area. See `hifi/theory.jsx`.

### Coach FAB (mobile)

Floating "c" button, bottom-right, above the bottom nav. Opens a coach sheet. Optional accent dot for unread.

---

## Voice / copy rules

Read these before writing any new strings.

- **Lowercase by default.** UI labels, button text, headlines — all lowercase. Proper nouns and language names keep their normal casing (`spanish`, `English`, `日本語`).
- **No XP, no levels, no streaks, no leaderboards.** The progress screen reports honest skill numbers (CEFR-flavored bands per skill), not a points game.
- **No emoji in production copy.** They appear in the wireframes as placeholders only.
- **The coach.** Internal AI tutor voice. Calm, brief, second-person. Sample lines: "let's start with languages. you can add more later.", "for spanish — where would you place yourself? rough is fine.", "consistent and short beats long and irregular."
- **Caveat font for personality only.** "p.s." notes, "not sure?" asides on the placement-test callout, occasional one-liners. Never for actionable text.
- **Don't shame quiet days.** "gentle nudges on quiet days · no streak shaming. one calm note if you've missed two days, never more."

---

## Screens

See `SCREENS.md` for the full screen-by-screen spec — layout, components, copy, states, interactions, behavior.

The flow:

```
onboarding (4 steps)
   ↓
dashboard (today's plan + skill meters)
   ↓
[user picks a drill] →  cloze · translation · vocab
   ↓                       (each: prompt → answer → feedback inline → next)
debrief (after session: per-item review + narrative + skill deltas)
   ↓
[continue / next session / progress]
   ↺
```

Theory is a side panel reachable from any drill (via a "theory" trigger on the prompt) and from the dashboard.

**Read & collect** is a parallel entry point reachable from the dashboard card and the left nav (web) / bottom nav (mobile). The user pastes a passage; the system flags above-level words; saved words are tagged "from your reading" and surfaced in subsequent cloze, vocab, and translation drills. See section 8 of `SCREENS.md`.

---

## State management

The prototype uses local `React.useState` and a tiny `window.AppNav()` helper for navigation between screens. In production:

**Web app state shape (suggested):**
```ts
{
  user: { id, languages: string[], primary: string, level: number, goals: string[], schedule: number, nudge: boolean },
  session: { items: Item[], cursor: number, results: Result[] } | null,
  skills: { listening, reading, writing, speaking, grammar, vocab }, // 0–100
  itemBank: Item[],  // server-driven
}
```

**Drill data:**
```ts
type Item =
  | { kind: 'cloze', sentence: string, blank_idx: number, answer: string, choices?: string[], topic: string, en: string }
  | { kind: 'translation', en: string, es_accepted: string[], hints?: string[] }
  | { kind: 'vocab', term: string, hint?: string, accepted: string[] };

type Result = { item: Item, input: string | null, picked?: string, correct: boolean, graded?: AIGrade };
```

The translation drill expects an AI-graded result (`{ correct: boolean, near?: string, why?: string }`). For prototype purposes I stub this; in production it's a server call to your LLM with a graded-rubric prompt.

---

## Interactions worth getting right

Everything below appears in the prototype — don't drop these in implementation.

1. **Session cursor.** Drills are multi-item (typically 6). The screen shows the current item, top-of-screen progress bar, "x / y" counter. After answering, inline feedback animates in below the prompt; then a "next" CTA advances. After the last item, navigate to debrief.

2. **Cloze modes.** Pill toggle (multiple-choice / type-it). Same items, two interaction modes — one is recognition, the other production. Don't make these separate screens; they share state.

3. **Translation grading.** Free-text → AI-graded with multiple accepted translations. On correct, show the user's answer + the "model" answer if different ("you said X, I'd also accept Y"). On incorrect, show diff + a coach note explaining the gap.

4. **Theory panel scroll-sync.** TOC entries highlight as you scroll the content; clicking a TOC item smooth-scrolls to that section. On mobile this is a bottom sheet instead.

5. **Onboarding placement test opt-in.** The level step has a self-report list AND a dashed callout: "not sure? take a 5-min adaptive placement test." Two CTAs — "take it now" and "later." "Later" dismisses the callout and shows a small confirmation strip ("you can run it anytime from settings → calibration") with an undo. Don't drop this — it's the way around the cold-start UX problem.

6. **Skill meters.** Six skills on a 0–100 scale, but reported as A1–C2 bands with a soft "+/−" suffix when between bands. The dashboard shows them as horizontal bars; progress page shows them as a radar.

7. **Gentle nudges.** Schedule step has a checkbox: "gentle nudges on quiet days · no streak shaming. one calm note if you've missed two days, never more." Implement nudges accordingly — push notification, max one per missed-2-day window, calm copy.

---

## Animations / transitions

- Choice card hover: `transition: all 0.15s` on border-color, background.
- Bar fill: `transition: width 0.3s`.
- Button hover: `0.15s` background/color.
- Drill prompt-to-feedback: fade-in 0.35s ease (`@keyframes fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }`).
- Bottom sheet: 280ms slide-up, `cubic-bezier(.22,.9,.32,1)` easing.
- Theory panel: 280ms slide-in from right, same easing.

Nothing flashy. The product feels calm because nothing bounces.

---

## Responsive / breakpoints

**Web** is currently designed for ≥1024px desktop. There's no defined tablet/mobile-web breakpoint — for those, use the mobile prototype as the source of truth and defer responsive web to a later phase, OR adapt: collapse the left nav to a top bar at <900px, drop max-width.

**Mobile** is designed at 412×892 (Pixel 7 Pro reference). It scales fluidly within reasonable phone sizes; tap targets are 48px minimum.

---

## What's mocked, what's real

- **Mocked:** the actual LLM grading, the placement test (button shows a stub message), the item bank (hard-coded examples in JSX), the speaking exercise (referenced in the wireframes — see `wireframes/wf-exercises.jsx` — but not built in hi-fi yet), audio/listening (similar — wireframed only).
- **Real (in design):** all visual states for cloze, translation, vocab, dashboard, debrief, progress, theory, onboarding (web + mobile).
- **Not designed:** settings, account, billing, social/sharing (none planned), data export.

---

## Known gaps

- **Speaking & listening** drills exist as wireframes only (`Language Drill Wireframes.html` → "Exercises" section). Hi-fi not built. If you're implementing those, refer to the wireframes for layout intent and apply this hi-fi system to them.
- **Translation on web** is implemented (`hifi/translation.jsx`) but the dashboard's "translate" CTA on web routes through the cloze entry currently — wire it up correctly in your impl.
- **Empty states** (no items today, all drilled, brand new account before any data) — not designed. Use sensible defaults: a brief paragraph in the coach voice + a primary CTA.
- **Errors** (network, grading failed, audio unavailable) — not designed. Toast in `--accent-soft` background with an undo or retry, matching the existing component vocabulary.

---

## Questions a developer will probably hit

**Q: Are we using Tailwind, vanilla CSS, or CSS-in-JS?**
A: Your call. The tokens are framework-agnostic. If you go Tailwind, port `tokens.json` to `tailwind.config.js → theme.extend.colors / fontFamily / fontSize / borderRadius / spacing`. Make sure your custom font sizes preserve the line-height pairings.

**Q: Should mobile share components with web?**
A: Where it's React on both, you can share leaf components (Chip, Bar) but not layout primitives — the dashboards differ structurally enough that forcing one will create awkward branching. Share the tokens, not the components.

**Q: Why Fraunces?**
A: Editorial warmth without being precious. It's a variable font with `opsz` (optical size) — at display sizes set `font-variation-settings: "opsz" 144` for the proper display cut. At UI sizes (Inter handles those, not Fraunces), don't use Fraunces.

**Q: Do I need to support older browsers?**
A: The prototype uses CSS custom properties, `oklch` is not used (we stayed in hex), no `:has()` is required, but the theory panel uses `backdrop-filter: blur(4px)` — gracefully degrades on Firefox-mobile.

---

## Asset list

**Fonts (Google Fonts):** Fraunces (400, 500, 600), Inter (400, 500, 600, 700), JetBrains Mono (400, 500, 600), Caveat (500, 600, 700).

**Icons:** all SVG-inline in components, line style, 1.6–1.9px stroke. No icon library used. If you want to switch to Lucide / Phosphor, match the line weight and use the "duotone" or "regular" sets.

**Images:** none.

**Sounds:** none designed.

---

That's the package. Open `SCREENS.md` next for the per-screen spec.
