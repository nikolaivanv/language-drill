# Web Implementation Plan

A phased roadmap for implementing the design prototypes in `design_handoff_language_drill/` into the Next.js web app at `apps/web/`. Mobile (Expo) is deferred — we'll return to it after the web is feature-complete.

Each phase has a kebab-case spec at `.claude/specs/<spec-name>/` with three documents (`requirements.md`, `design.md`, `tasks.md`) and a set of generated slash commands (`/<spec-name>-task-N`) for atomic execution.

---

## Adjustments from the original handoff

These are decisions made up front to align the prototypes with `docs/exercise-strategy.md`, `docs/progress-tracking.md`, and `CLAUDE.md`:

| Topic | Handoff prototype | Our adaptation | Reason |
|-------|-------------------|----------------|--------|
| Languages | 8 (es, fr, ja, de, it, pt, zh, ko) | **3 (ES, DE, TR)** + EN as source-only | Matches the `Language` enum and our supported language scope |
| Cloze MC mode | First-class toggle (MC ↔ type) | Type-it default; MC labelled as "reduces progress signal" | exercise-strategy.md treats MC as scaffolding, not a primary mode |
| Coach persona | Throughout (avatar, FAB, messages) | Implement as designed | Adds personality without conflicting with the no-gamification rule |
| Placement test | Live in onboarding step 2 | Disabled "coming soon" callout | Level assessment is a Phase 3+ feature per docs |
| Progress page | 6-axis radar + topic × days heatmap | Same in v1; **defer** the docs' grammar mastery grid | Visual radar matches the "warm paper" aesthetic; mastery grid can be a drilldown later |
| Footer streak | "🔥 12 day streak" | **No streak / no XP** anywhere | Hard rule from CLAUDE.md and exercise-strategy.md |
| Review queue | Nav item with badge count | Deferred until SR scheduling is wired up | Review functionality isn't built yet |

---

## Phase summary

| Phase | Spec | Status | Effort | Depends on |
|-------|------|--------|--------|------------|
| **A** | [design-system](#phase-a--design-system) | ✅ complete | ~2 days | — |
| **B** | [app-shell](#phase-b--app-shell) | ✅ complete | ~1 day | A |
| **C** | onboarding | 🚧 in progress | ~2 days | A, B |
| **F** | exercise-ui | ⬜ not started | ~3 days | A, B |
| **E** | session-flow | ⬜ not started | ~2 days | F |
| **D** | dashboard | ⬜ not started | ~2 days | A, B, E |
| **G** | debrief | ⬜ not started | ~2 days | E |
| **H** | theory-panel | ⬜ not started | ~2 days | A |
| **I** | progress | ⬜ not started | ~3 days | A, B |
| **J** | read-collect | ⬜ not started | ~4 days | A, B, D |

**Total:** ~23 working days. Phases A → B → F → E form the critical path; H, I, J can be parallelized once their deps are in.

---

## Phase A — Design system

**Spec:** `.claude/specs/design-system/`

The visual foundation: design tokens (colors, typography, spacing, shadows, radii), Google Fonts integration, Tailwind v4 `@theme` block, base styles, and a 9-component library.

**Components:** `Button`, `Chip`, `Card`, `Bar`, `Input`, `Textarea`, `Choice`, `Checkbox`, `AccentPicker`

**Output:**
- `apps/web/app/globals.css` — full token system + type scale utility classes
- `apps/web/app/fonts.ts` — Fraunces + Inter + JetBrains Mono + Caveat via `next/font/google`
- `apps/web/components/ui/` — 9 components, 109 tests
- `apps/web/lib/cn.ts` — class name helper

---

## Phase B — App shell

**Spec:** `.claude/specs/app-shell/`

The persistent left-rail navigation: 220px sidebar with brand mark, language switcher (dropdown with flagdots), 4 nav items (today / drill / read / progress), and a user footer (Clerk identity + sign out — no streaks).

**Components:** `ActiveLanguageProvider`, `AppShell`, `Nav`, `Brand`, `Flagdot`, `LanguageSwitcher`, `NavItem`, `NavItems`, `NavIcons`, `UserFooter`

**Key decisions:**
- Active language stored in `active_language` cookie, exposed via React context
- `LearningLanguage` type = `Exclude<Language, 'EN'>` (EN is source-only for translation exercises)
- `/practice` → `/drill` route migration with redirect
- Placeholder pages for `/read`, `/progress`, `/settings`

**Backend impact:** None — purely frontend.

---

## Phase C — Onboarding

**Spec:** to be written (`.claude/specs/onboarding/`)

Replace the current single-step onboarding with the 4-step flow from `prototypes/web/hifi/onboarding.jsx`:

1. **Languages** — multi-select 2×2 grid (ES, DE, TR + checkboxes)
2. **Primary + level** — CEFR band selector + disabled placement test callout
3. **Goals** — multi-select grid (grammar, speaking, fast speech, writing, vocabulary, trip prep) + optional notes textarea
4. **Schedule** — daily time commitment (5/10/20/30 min) + gentle nudges checkbox

Plus the **left coach pane** (320px) showing brand, avatar, contextual coach messages per step, and a vertical checklist of completed steps.

**Backend impact:**
- Add `goals` (JSONB), `dailyMinutes` (int), `gentleNudges` (bool) to `userLanguageProfiles` (or new `userPreferences` table — TBD in spec)
- Update `PUT /profiles/languages` to accept new fields

---

## Phase D — Dashboard / today's plan

**Spec:** to be written (`.claude/specs/dashboard/`)

Replace the current minimal welcome page with the editorial dashboard from `prototypes/web/hifi/dashboard.jsx`:

- **Greeting header** — eyebrow + display title with localized greeting + body with current level and time
- **Editorial timeline** — 5-item visual rail (circles + connecting line, colored accents, exercise type + topic + difficulty chip per item)
- **Skill snapshot grid** — 2-column grid of 6 skill metrics (listening, reading, writing, speaking, grammar, vocabulary) with CEFR band chip + percentage bar + delta indicator

**Backend impact:**
- New `GET /sessions/today` — returns 5 planned exercises (simple weighted heuristic in v1; adaptive logic later)
- New `GET /stats/skills` — per-skill mastery summary for the active language

Includes the **dashboard entry card for Read & Collect** (added in section J).

---

## Phase E — Session flow

**Spec:** to be written (`.claude/specs/session-flow/`)

Multi-exercise sessions with a top progress bar, navigation between exercises, and a session summary at the end. Replaces the current single-exercise practice page.

**Backend impact:**
- New `practiceSessions` table (id, userId, language, startedAt, completedAt, exerciseCount, correctCount)
- `userExerciseHistory` gets a `sessionId` foreign key
- `POST /sessions` — create session, returns id + exercise list
- `POST /sessions/:id/complete` — finalize session, return summary stats

---

## Phase F — Exercise UI redesign

**Spec:** to be written (`.claude/specs/exercise-ui/`)

Redesign the existing cloze, translation, and vocab exercise UIs to match the prototypes:

- **Cloze** — split layout (large prompt + coach rail), type-it default with optional MC toggle (clearly labelled as scaffolding), accent picker, sage/terracotta feedback strip
- **Translation** — eyebrow + English source + glossed words + textarea + accent picker; graded view with diff display and alternate accepted translations
- **Vocab recall** — definition card + progressive hints (first letter → syllable count → example sentence), graded state with pronunciation/context/confusion notes

**Backend impact:** None — same existing endpoints; UI-only changes.

---

## Phase G — Post-session debrief

**Spec:** to be written (`.claude/specs/debrief/`)

After a session ends, route to `/practice/debrief/[sessionId]` with:

- Header: accuracy summary (x of y, %), coach message varying by accuracy tier
- Tabs: **Review** (per-item diff list) / **Debrief** (coach narrative + skill delta bars + "what's next")
- Action footer: "next session" / "see progress" / "done"

**Backend impact:**
- `GET /sessions/:id/debrief` — session summary + per-item results + skill deltas (snapshot pre-session mastery to compute deltas)

---

## Phase H — Theory reference panel

**Spec:** to be written (`.claude/specs/theory-panel/`)

A right-side slide-over panel (max 960px, backdrop blur) reachable from any drill via the "show me theory" button. Contains a TOC sidebar (240px, scroll-synced) and content sections per grammar topic: what is it, when to use it, formation tables, examples, common pitfalls.

**Content strategy:** Static MDX/JSON files per (language × grammar topic) in v1. Move to DB-stored Claude-generated content later.

**Backend impact:** None initially (static content). DB schema for theory entries can be added in a later phase.

---

## Phase I — Progress page

**Spec:** to be written (`.claude/specs/progress/`)

The progress dashboard at `/progress`:

- Header with overall level card (e.g., "B1+ tracking to B2") + progress bar
- Tabbed layout: **Shape** (6-axis radar + recommended drill card) / **Heatmap** (topic × days grid) / **History**
- Per-skill detail cards (band + bar + sparkline)

**Backend impact:**
- `GET /progress/overview` — CEFR estimates per macro-skill
- `GET /progress/radar` — 6-axis scores
- `GET /progress/heatmap` — practice activity by topic and date

---

## Phase J — Read & collect

**Spec:** to be written (`.claude/specs/read-collect/`)

Per `SCREENS.md §8`, a parallel entry point reachable from the dashboard card and the left nav. The user pastes a passage; Claude flags above-level words; saved words flow into cloze, vocab recall, and translation drills tagged "from your reading".

**Views:** `empty` / `pasting` / `annotated` / `history` (toggled via top-bar buttons)

**Key features:**
- Annotated reader: 2-column layout (text pane + sticky 280px word bank rail)
- Highlight intensity toggle: subtle (dotted underline) / assertive (amber wash)
- Word card popover: 320px, lemma + POS + CEFR + gloss + example + "save to bank"
- History view of past texts

**Backend impact:**
- New `readEntries` table (id, userId, language, title, source, text, flaggedWords JSONB, bank string[], pastedAt)
- `POST /read/annotate` — Claude pass to flag above-level words, returns `WordFlag[]`
- `POST /read/entries`, `GET /read/entries`, `GET /read/entries/:id`, `PUT /read/entries/:id/bank`
- Saved words upserted into `user_vocabulary` with `source = 'reading'` for drill integration

This screen accelerates **Layer 3 — Reading integration** from `exercise-strategy.md` (originally Phase 3+); the design promotes it to a first-class feature.

---

## Out of scope for the web roadmap

- **Mobile (Expo / React Native)** — separate roadmap after web is complete; mobile prototypes already exist in `prototypes/mobile/`
- **Speaking exercises** — wireframed only; requires MediaRecorder + AWS Transcribe (Phase 6 of the docs)
- **Listening exercises** — wireframed only; requires AWS Polly integration
- **Writing exercises** — wireframed only
- **Theory standalone reading mode** — wireframed but the side panel covers the need
- **Stripe / paid tiers** — not part of the design handoff

---

## Workflow

For each phase:

1. `/spec-create <spec-name> "<description>"` — guides through Requirements → Design → Tasks
2. Each phase generates `/{spec-name}-task-N` slash commands (one per atomic task)
3. Tasks are 5–30 min, 1–3 files, with clear verification (`pnpm typecheck`, `pnpm test`)
4. Pre-push: `pnpm lint && pnpm typecheck && pnpm test` from repo root must all pass
