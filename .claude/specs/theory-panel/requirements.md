# Theory Panel — Requirements

## Introduction

A right-side slide-over **theory reference panel** reachable from any drill screen (and later, the dashboard). Phase H of the web roadmap (`docs/web-implementation-plan.md`). The panel surfaces grammar theory — definitions, use cases, conjugation tables, worked examples, and common pitfalls — for the topic the user is currently drilling, without leaving the exercise.

**Current state:** No theory content exists in the app. When a learner gets confused by a cloze on the Spanish subjunctive, the only escape is closing the tab and Googling. The drill page (`apps/web/app/(dashboard)/drill/page.tsx`) has no "show me theory" affordance.

**Target state (v1):** A keyboard-dismissible slide-over (≤960px wide, backdrop blur) opens from a small "theory · {topic}" trigger near the exercise prompt. Inside: a 240px TOC rail with scroll-spy on the left, sectioned content on the right (`what is it`, `when to use`, `formation`, `irregulars`, `examples`, `pitfalls`), and a sticky "back to drill" CTA. Content is loaded from static files keyed by `(language, topic)` — no backend changes in this phase. A "more topics" list at the bottom of the TOC lets the user swap topic without closing the panel.

**Explicit non-goals for v1:**
- No DB schema for theory entries (deferred per `web-implementation-plan.md` §H — "Move to DB-stored Claude-generated content later")
- No mobile bottom-sheet variant (mobile/Expo is its own separate roadmap; web only here)
- No "open in study mode" full-page reading view (out of scope per `SCREENS.md §5` adaptation — "Theory standalone reading mode — wireframed but the side panel covers the need")
- No author-tooling/CMS — content authors edit MDX/TSX files directly and ship a PR
- No deep-linking to a specific topic via URL (panel is overlay state, not a route)

---

## Alignment with Product Vision

Language Drill targets the **intermediate plateau** — learners past A2 who "know grammar rules but make errors anyway" (`product.md` §1). When a learner stumbles on a subjunctive cloze, the most useful intervention is a 30-second refresher on the rule plus 2–3 worked examples — not a 20-minute video, not abandoning the session. The theory panel delivers that refresher *in context*, preserving session momentum.

It also reinforces three differentiators from `CLAUDE.md`:

1. **Active production over passive recognition** — theory is consulted *during* a production drill, not as a standalone lesson, keeping the learner in producer mode.
2. **Skill-based mastery, not content consumption** — no "lesson complete" check. Reading theory is a tool, not progress.
3. **Editorial / "warm paper" aesthetic** — the panel's visual style (Fraunces section titles, dashed rules, amber callouts, conjugation tables in JetBrains Mono) reinforces the seriousness-with-restraint that separates Language Drill from cartoon-style competitors.

---

## Assumptions & Constraints

- Phases A (design-system) and B (app-shell) are complete and merged. Tokens, fonts, and `apps/web/components/ui/*` are available.
- Drill page exists at `apps/web/app/(dashboard)/drill/page.tsx` (post-`app-shell` migration). Practice page (`/practice`) is deprecated and out of scope.
- Languages in scope: **ES, DE, TR** (the three `LearningLanguage` values; EN is source-only per `app-shell` decision).
- v1 ships with **content for ES only** — at minimum two topics fully written (`subjunctive`, `preterite-imperfect`) plus one stub (`conditional`). DE and TR get the loader plumbing but no authored content yet (their topic registry is empty; the panel surfaces an empty state if opened). This unblocks Phase F (exercise-ui) without blocking on bilingual authoring.
- Topic IDs are kebab-case strings (`subjunctive`, `preterite-imperfect`, `por-vs-para`). The drill exercise must already know which topic ID maps to its current item — see Requirement 6.
- Static content lives at `apps/web/content/theory/{language}/{topic}.tsx` and is statically imported (no dynamic `import()`/network fetch). Bundle-size impact is acceptable for v1 — three topics is small; we can switch to dynamic import or DB later when the catalog grows.
- No dependency on Phase F (exercise-ui redesign). The panel must work with the existing drill page structure as well as the redesigned one.
- No new npm packages. Scroll-spy is implemented with `IntersectionObserver` (already used in the prototype). No headless-UI / Radix dialog — the slide-over is hand-rolled with a portal.

---

## User Stories

### US-1 — Theory mid-drill
**As an** intermediate Spanish learner stuck on a subjunctive cloze,
**I want** to open a theory reference for the *exact* topic I'm drilling without losing my exercise progress,
**so that** I can refresh the rule and finish the item instead of abandoning the session.

### US-2 — Topic switching from inside the panel
**As a** learner who realized the topic I really need is `por vs para`, not `subjunctive`,
**I want** to switch topics from inside the panel via a "more topics" list,
**so that** I don't have to close the panel and re-trigger it from a different drill.

### US-3 — Scroll-synced TOC
**As a** learner reading a long topic,
**I want** the table of contents to highlight the section I'm currently reading and let me jump to any section,
**so that** I can navigate dense reference material without scrolling blindly.

### US-4 — Quick exit
**As a** learner who only needed a 5-second glance at the formation table,
**I want** to dismiss the panel with `Esc`, by clicking the backdrop, or by tapping the close button,
**so that** I'm back at my drill in one keystroke.

### US-5 — Author content as code
**As the** content author,
**I want** to add a new theory topic by creating one TSX file under `apps/web/content/theory/{language}/`,
**so that** I don't have to set up a CMS or DB before I can ship content.

### US-6 — Empty / not-found state
**As a** learner drilling a topic with no theory written yet,
**I want** to see a calm "no theory yet for this topic" message with a list of topics that *do* have theory in this language,
**so that** I'm never staring at a blank panel and can pivot to a related topic.

---

## Functional Requirements

### FR-1 — Trigger affordance on the drill page
1.1. WHEN a drill exercise is loaded AND the exercise has a known `grammarTopicId` (see FR-6) THEN the drill page SHALL render a small dashed-border pill near the exercise prompt with the label `theory · {topic title}` (e.g., `theory · el subjuntivo`).
1.2. WHEN the exercise has *no* known `grammarTopicId` for the active language THEN the trigger pill SHALL NOT render. (No empty-state hover.)
1.3. WHEN the user clicks the trigger pill THEN the theory panel SHALL open scrolled to the top of that topic.
1.4. The trigger SHALL be keyboard-focusable and activatable with `Enter` or `Space`.

### FR-2 — Panel layout
2.1. The panel SHALL render as a right-aligned slide-over of width `min(960px, 92vw)` and full viewport height.
2.2. The backdrop SHALL be `rgba(26,22,18,0.42)` with `backdrop-filter: blur(4px)`. Clicking the backdrop SHALL close the panel.
2.3. The header SHALL show: a `t-micro` eyebrow `theory · reference`, the topic title in `t-display-l`, a CEFR-band chip, the topic subtitle in `t-small`, and a close button (`×`).
2.4. The body SHALL be a two-column layout: a 240px-wide TOC on the left (paper-2 background) and a scrollable content area on the right.
2.5. The content area SHALL have a sticky bottom CTA — a `Button.primary.sm` labelled `back to drill →`. (No "open in study mode" — explicitly out of scope.)

### FR-3 — TOC and scroll-spy
3.1. The TOC SHALL list every section in the current topic in render order, using each section's `title`.
3.2. WHEN a section's heading enters the upper portion of the scroll viewport THEN the TOC item for that section SHALL receive an `active` visual state (accent left-border, paper-3 fill, ink text).
3.3. WHEN the user clicks a TOC item THEN the content area SHALL smooth-scroll to that section's heading and the active state SHALL update.
3.4. Below the TOC, separated by a dashed rule, an `other topics` list SHALL show every other topic in the current language. Clicking one SHALL swap the active topic in place (no panel close/reopen) and reset scroll to the top.
3.5. WHEN the active language has only one topic with content THEN the `other topics` list SHALL be hidden.

### FR-4 — Section content patterns
4.1. Section content SHALL render the following primitives, all styled in `globals.css`:
- `theory-section-title` — Fraunces 24px section heading
- `theory-content` paragraph — 15px / 1.65 line-height body text
- `<strong>` — keywords in `--color-ink`
- `theory-list` — bulleted lists
- `theory-table` — conjugation tables (Inter row labels, JetBrains Mono cell values, paper-2 thead)
- `example` block — Spanish/target line in Fraunces 18px, English translation in italic `--color-ink-soft`, optional note in `--color-ink-mute` separated by a dashed border
- `callout` — amber background, `--color-accent` left-border, body text. `callout.warn` variant uses `--color-accent-soft` background with `--color-accent` border.
- `hilite` — inline highlight using existing `.hilite` class
- `t-mono` — inline monospace using existing `.t-mono` class
4.2. These primitives SHALL be available as JSX components from a shared module (e.g., `apps/web/components/theory/primitives.tsx`) so content files import them rather than re-hardcoding class names.

### FR-5 — Content registry and lookup
5.1. Theory content SHALL live at `apps/web/content/theory/{language}/{topic-id}.tsx`. Each file default-exports an object matching the `TheoryTopic` shape (see Data Models).
5.2. A registry module (`apps/web/content/theory/index.ts`) SHALL export a typed map `theoryRegistry: Record<LearningLanguage, Record<string, TheoryTopic>>`. Topics SHALL be added by appending an import + map entry to the registry — no filesystem globbing.
5.3. A lookup helper `getTheoryTopic(language, topicId)` SHALL return `TheoryTopic | null`. WHEN the topic is missing OR the language has no entries THEN it SHALL return `null` and the panel SHALL render the empty state from FR-7.
5.4. A second helper `listTheoryTopics(language)` SHALL return `Array<{ id; title; cefr }>` sorted by title; this powers the TOC's `other topics` list.

### FR-6 — Drill → topic mapping
6.1. The drill page SHALL determine the current exercise's `grammarTopicId` by inspecting topic tags surfaced from `exercise_tags` / `skill_topics`. **[Open Question for design]** Whether the API already exposes tags on the exercise response, whether we extend the response, or whether we map client-side from `skillTopicId` will be resolved in `design.md` before tasks are written.
6.2. A typed mapping `apps/web/lib/theory-topic-map.ts` SHALL translate from server topic identifiers (DB `skill_topics.name`, currently free text) to a closed enum of theory topic IDs known to the registry. Unknown topics SHALL map to `null` (no trigger renders — see FR-1.2).
6.3. The mapping table SHALL be exported as a constant so it can be unit-tested independently of the panel.

### FR-7 — Empty state
7.1. WHEN `getTheoryTopic(language, topicId)` returns `null` AND the panel is opened anyway (e.g., via a forced `?theory=...` development override) THEN the panel SHALL render an empty state with: the eyebrow `theory · reference`, the headline `no theory written yet for {topicId}`, body copy `we'll add this topic soon — try one of these:`, and the `other topics` list from FR-3.4.
7.2. WHEN the active language has *no* theory at all (e.g., DE in v1) THEN the trigger pill never renders (FR-1.2), so the empty state is only reachable via dev override.

### FR-8 — Dismissal and reopen
8.1. WHEN the user presses `Escape` THEN the panel SHALL close.
8.2. WHEN the user clicks the backdrop (any area outside the `aside`) THEN the panel SHALL close.
8.3. WHEN the user clicks the `×` close button OR the `back to drill →` CTA THEN the panel SHALL close.
8.4. The drill state (current exercise, typed answer, evaluation, scroll position) SHALL be unaffected by opening or closing the panel.
8.5. WHEN the panel is closed and reopened on the same exercise THEN it SHALL reset to the top of the topic with the first section active. (No persistence of scroll position across opens — keeps the implementation simple and matches the prototype.)
8.6. WHEN the active learning language changes (via the app-shell language switcher) while the panel is open THEN the panel SHALL close. The trigger pill on the new language's drill exercise will offer to reopen if a topic mapping exists.
8.7. WHEN the panel is open THEN background page scroll SHALL be locked (the underlying drill page does not scroll on wheel/touch). On close, scroll lock SHALL be released and the page SHALL retain its previous scroll position.

### FR-9 — Focus and accessibility
9.1. WHEN the panel opens THEN focus SHALL move to the close button.
9.2. WHEN the panel is open THEN keyboard focus SHALL be trapped within the panel (Tab / Shift+Tab cycle through focusable elements inside the `aside`, not the underlying drill page).
9.3. WHEN the panel closes THEN focus SHALL return to the trigger pill that opened it.
9.4. The `aside` SHALL have `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` pointing at the topic title.
9.5. The TOC `<button>`s SHALL set `aria-current="true"` when active.
9.6. The backdrop SHALL be `aria-hidden="true"` (its only role is the close-on-click target; screen-reader users use Escape).
9.7. WHEN `prefers-reduced-motion: reduce` is set THEN the slide-in transform and any smooth-scroll behavior on TOC clicks SHALL be replaced with instant positioning (no animation).

---

## Data Models

### TheoryTopic
The shape every content file (`apps/web/content/theory/{language}/{topic-id}.tsx`) default-exports.

```
TheoryTopic
- id: string                  // kebab-case, matches the filename and registry key
- title: string               // displayed in header (e.g., "el subjuntivo")
- subtitle: string            // one-line gloss under the title
- cefr: string                // CEFR band string (e.g., "B1–B2"); free text, not the CefrLevel enum
- sections: TheorySection[]   // ordered; rendered in TOC and content area in this order
```

### TheorySection
```
TheorySection
- id: string                  // kebab-case, unique within the topic; used as anchor for scroll-spy
- title: string               // shown in TOC and as the section heading
- body: ReactNode             // rendered JSX using primitives from FR-4.2
```

### TheoryTopicId (registry-side)
A TS string-literal union of every topic key registered in `theoryRegistry`, derived from the registry constant via `keyof typeof` so adding a topic automatically widens the type.

These types live in `apps/web/components/theory/types.ts` and are shared between content files, the registry, the panel, and the drill→topic map.

---

## Non-Functional Requirements

### Performance
- The static content registry adds <50KB gzipped to the initial bundle for v1's three topics. The budget SHALL be verified by inspecting `next build` route output (no new dependency); if exceeded at any point during implementation, the registry switches to per-topic dynamic `import()` before merging.
- WHEN we exceed 10 topics or 200KB total content in any future PR, the design SHALL switch to per-topic dynamic `import()` (tracked as a follow-up, not in this spec).
- Opening the panel SHALL render the first paint within 100ms on a 4× CPU-throttled M-series Mac (no network round-trip; content is statically imported).
- Scroll-spy SHALL use a single `IntersectionObserver` rather than per-section listeners.

### Security
- No user input is rendered into theory content; section bodies are author-written JSX compiled at build time, so there is no XSS surface.
- No new auth boundary is introduced — the panel is a client-only overlay and reads no user data beyond the active language (already in `ActiveLanguageProvider`).
- No new network calls in v1; nothing to rate-limit or authorize.

### Reliability
- WHEN `getTheoryTopic(...)` throws or a content file fails to render (e.g., a typo in JSX caught only at render time) THEN an error boundary inside the panel SHALL catch it and render the FR-7 empty state with a brief diagnostic. The drill page itself SHALL NOT crash.
- The panel introduces no offline / sync requirements; content is bundled with the app, so it works offline once the page is loaded.

### Accessibility (a11y)
- Conforms to WCAG 2.1 AA: keyboard-only navigation works (FR-9), color contrast on `callout.warn` and active TOC states meets ≥4.5:1, focus rings are visible (use existing `--color-accent` outline tokens).
- The panel SHALL announce as a modal dialog so screen-reader users understand they've entered an overlay.

### Maintainability
- Adding a new topic SHALL require touching exactly two files: a new `{topic-id}.tsx` content file and one line in `apps/web/content/theory/index.ts` (the import + registry entry). No build configuration changes.
- Type errors SHALL prevent a topic from shipping with malformed sections (`TheoryTopic` is a strict TS type with no `any`).

### Testing
- Unit tests for the registry helpers (`getTheoryTopic`, `listTheoryTopics`, the topic map).
- Unit tests for the `TheoryPanel` component's open/close, Esc key, backdrop click, and TOC active state behavior using Vitest + React Testing Library (existing pattern — see `apps/web/components/ui/__tests__/`).
- Unit test that every entry in `theoryRegistry[Language.ES]` renders without throwing.
- The drill page test (`apps/web/app/(dashboard)/drill/page.test.tsx` — already exists from prior phases) SHALL be extended to cover: trigger pill renders when exercise topic is mapped; trigger pill does *not* render when topic is unmapped; clicking the pill opens the panel.

### Out of scope
- DB schema for theory (`theory_entries` table) — explicitly deferred per `web-implementation-plan.md` §H.
- Backend endpoints (`GET /theory/:language/:topic` etc.) — none in v1.
- Mobile bottom-sheet — out of scope for the web roadmap.
- "Open in study mode" full-page reading view — covered by the side panel.
- Pre-rendering theory content into the drill page (we keep theory lazy at panel-open time even though content is statically imported, to keep the drill bundle from growing for users who never open theory).
