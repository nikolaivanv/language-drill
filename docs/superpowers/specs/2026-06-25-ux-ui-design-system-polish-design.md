# UX/UI Design-System Polish — Design Spec

**Date:** 2026-06-25
**Branch:** `ux-polish-design-system` (worktree off `origin/main`)
**Scope:** Apply the Claude Design prototype changes to the live app across Home (Today), Drill Session, and Progress — desktop + mobile — plus the global design-system rules they imply, applied app-wide for consistency.

Source prototypes (Claude Design project `d676e7c3-d8fe-495f-a250-94c38e174fbd`):
`Home (Today) - Desktop/Mobile.html`, `Drill Session - Desktop/Mobile.html`, `Progress - Desktop/Mobile.html`.

---

## 1. Goals & non-goals

**Goal:** Bring the live app's three core surfaces in line with the refreshed prototypes, and consolidate the button/typography/accent rules they establish across *every* surface so there are no leftover variant styles that contradict the new system.

**Non-goals / explicitly out of scope:**
- **Turkish accent keyboard layout is NOT changed.** The user prefers the live `AccentPicker` over the prototype's one-line/wide-shift version. Leave `components/ui/accent-picker.tsx` untouched. (The prototype's keyboard styling is ignored.)
- No backend/API/data-model changes. This is presentation only.
- No change to the `/fluency` runner, debrief math, SR scheduling, or evaluation logic.
- `work on these` stays driven by **live** `useInsightsErrors()` data — we do **not** hardcode the prototype's `kitabım→kitabımı` sample set (see §8).

**Decisions locked in (from review):**
1. Fluency mode's new home = **Drill hub launcher only** (a deliberate-choice card alongside quick/dictation/free-writing/conjugation). Removed from the active session entirely.
2. Progress drawer mastery/confidence = **keep mastery % bar + one-line plain-language hint; convert confidence % to a qualitative tag (high / building / low)**; keep evidence count.
3. Structural changes approved as specced: remove Home greeting; desktop coach rail → dormant; merge debrief+review into one scroll; rename `review` nav → `my vocabulary` / `vocab`.

---

## 2. Design-system foundations (app-wide)

These are the rules every surface must follow. Fixing them centrally (in `Button`, `globals.css`, shared components) is what makes the per-surface work consistent.

### 2.1 Buttons — exactly two styles + a text link

Target end-state for `components/ui/button.tsx`:

| Role | Variant | Resting | Hover | Notes |
|---|---|---|---|---|
| Primary | `primary` | `bg-ink text-paper`, border-ink | **`bg-[#322b24]`** (ink lighten) + shadow lift on desktop | **No longer hovers to terracotta.** |
| Secondary | `ghost` (redefined) | transparent, `border border-rule-strong text-ink-2`, no fill | `bg-paper-2` | This becomes the single "ghost/secondary" style matching the prototype. |
| Tertiary | (not a button) | underlined text link, `text-ink-soft`, trailing arrow optional | `text-ink` | Use the shared link style (§2.4), not `<Button>`. |

Changes:
- **Add token** `--color-ink-hover: #322b24` to `@theme` in `globals.css`; primary hover uses `hover:bg-ink-hover`.
- **`primary`**: change hover from `hover:bg-accent-2 hover:border-accent-2` → `hover:bg-ink-hover hover:border-ink-hover`. Add desktop shadow lift (`hover:shadow-2`, suppressed under `mobile:`/touch as appropriate — keep it cheap; a `hover:shadow-2` is fine).
- **`accent` variant**: **deprecate.** Terracotta-filled buttons violate the new rules. Migrate all `variant="accent"` usages to `variant="primary"`. Once no usages remain, remove the variant from the union + `variantClasses` (and update the `ExerciseType`-style exhaustiveness — here it's just a `Record<ButtonVariant,…>`, so removing the key is safe). If any usage genuinely needs a non-primary emphasis, it becomes `ghost`.
- **`ghost` variant**: redefine from the current border-less text style to the prototype's bordered-transparent secondary: `border border-rule-strong bg-transparent text-ink-2 hover:bg-paper-2 hover:text-ink` (no shadow). This is the "no white-filled button" secondary.
- **`default` variant**: today it's `border-ink … hover:bg-ink hover:text-paper` (an outline that fills on hover). This overlaps conceptually with the new ghost. **Consolidate:** point `default` at the same style as `ghost` (alias) OR migrate `default` usages to `ghost` and keep `default`=ghost for safety. Decide during implementation by grepping usages; the rule is *only two visible button styles ship*.
- **`chip` variant**: keep (it's the bordered pill used for mode pills etc.), but note: where a `chip` button has `border-dashed` added for the "theory" treatment, that becomes a **text link** on the Progress drawer (see §6.2). The dashed-border *button* treatment is retired wherever it reads as a button (dashed = preview containers only, §2.3).

**No white/card-filled buttons anywhere.** Grep for `bg-card`/`bg-white` on button-like elements and convert (the `chip` variant's `bg-card` is the intended exception — it's a pill control on paper, kept).

### 2.2 Accent (terracotta) discipline

`--color-accent` / `--color-accent-2` are **accent-only**: logo mark, status labels, "error-prone"/error badges, active step/progress nodes, the cloze underline, eyebrows / "next up" tags. **Never** a primary CTA fill or primary hover. Audit each surface for terracotta-filled CTAs and convert to ink primary. (This is mostly enforced by the Button changes in §2.1.)

### 2.3 Dashed borders = preview/optional only

Dashed borders are reserved for preview/optional containers (e.g. Progress "A2 preview", theory `.example`). They must **not** style buttons or interactive controls. Affected:
- Drill `theory-chip` (dashed pill in `drill-meta`) — keep as a non-button label chip OR restyle solid; it's a label, not a CTA, so it may stay, but verify it doesn't read as a button. (The `.theory-trigger` dashed pill is a known control — leave it; it's an established affordance, not in the three target surfaces' button audit. Flag if it conflicts.)
- Drill "try next / fluency mode" dashed box — **removed** (see §5.3).
- Progress drawer "read the theory" dashed-border button → **underlined text link** (§6.2).

### 2.4 Shared link style (tertiary actions)

Unify the "see the map →", "see full progress →", "see your progress →", "read the theory →" links into one style: underlined, `text-ink-soft`, `text-underline-offset:3px`, `decoration-color: rule-strong`, trailing arrow, hover `text-ink` + `decoration-color: ink-mute`. Implement as a small shared component or utility class (e.g. `.link-arrow` in globals.css, or a `<TextLink>` component) so all surfaces reuse it. Place each in a "status text (left) + action link (right)" row where the prototype does.

### 2.5 Top-level page heading size

One value everywhere: **62px desktop / 36px mobile.** Today `.t-display-xl` is 56px desktop / 34px mobile. Options:
- **Preferred:** bump `.t-display-xl` to `62px` desktop / `36px` mobile and use it for every top-level page H1 (Home, Progress, Drill summary, Drill hub, Review, etc.). Verify no layout breaks at 62px (it's +6px).
- Keep `letter-spacing` proportionate (prototype uses `-1.2px` at 62px).

Audit page H1s currently using bespoke sizes and route them all through `.t-display-xl`.

---

## 3. Navigation (sidebar + mobile tab bar)

Files: `components/shell/nav-items.tsx` (`NAV_DESTINATIONS`), `nav-icons.tsx`, `nav-item.tsx`, `mobile-tab-bar.tsx`.

- **Rename** the `/review` destination label: desktop `review` → **`my vocabulary`**, mobile tab → **`vocab`** (must fit one line). `NAV_DESTINATIONS` likely has one `label`; add a `mobileLabel`/`shortLabel` field (or per-surface label) so desktop and mobile differ. Route stays `/review`. Badge (`dueCount`) behavior unchanged.
- **Icon swap**: change the review item icon from the refresh/circular-arrow glyph to a **stacked-cards (flashcards)** glyph in `nav-icons.tsx` (`ReviewIcon`). Match stroke-width/size conventions of the other icons (1.8 stroke, 22–23px).
- Active-nav style (`bg-ink text-paper`, hover `#322b24`) already matches; just confirm the `.on:hover` lightens to ink-hover not pure ink (add if missing).

**Ripple:** grep tests/specs for the literal `review` nav label and the old icon (e.g. e2e nav specs, `nav-items` unit tests). Update label assertions. (Memory: *component-label/route change → grep all tests*.)

---

## 4. Home (Today) — `app/(dashboard)/home/` + `_components/`

### 4.1 Header — remove greeting, promote "today's plan."
`dashboard-header.tsx`:
- **Remove** the "good evening, [name]" greeting + the framing sentence's greeting framing.
- Promote **"today's plan."** to the top-level page heading (`.t-display-xl`, 62/36).
- Place **"~N min planned"** beside the heading on desktop (baseline-aligned, mono, `ink-mute`) / beneath it on mobile. Wire `~N` to the existing total-estimated-minutes from `useTodayPlan()`.
- Keep the one-line "today leans into … — your liveliest error spots" lead paragraph (`.t-body-l`/lead), now sitting under the heading.

### 4.2 Today's load — segmented control
`daily-load-control.tsx` (currently `Choice` radio cards):
- Replace the three stacked radio cards with a **horizontal segmented control**: single pill track (`bg-paper-3`, `rounded-r-pill`, 4–5px padding), three equal segments quick/medium/long; selected segment filled **brand yellow** (`--color-hilite`) with `shadow-1`, selected label `text-ink`, unselected `text-ink-soft` hover `text-ink`.
- Keep it wired to `useUpdatePreferences()` / `handleDailyGoalSelect()`; keep accessibility: it's still a single-select radio group semantically (use `role=radiogroup`/`radio` or a styled fieldset) — don't regress keyboard/AT support that `Choice` provided. Update minutes display on select.

### 4.3 Next Up card — neutral, not terracotta
`next-up-card.tsx` (mobile; desktop equivalent is the first timeline item with the `start →` button):
- Change the filled terracotta panel → **neutral white card** (`bg-card border-rule shadow-1`). Terracotta kept only in the small **"next up"** eyebrow (`text-accent-2`). CTA is a **solid ink** `start →` button (primary).
- On desktop the timeline's current item already uses a neutral row + ink `start →`; just ensure the "next up" chip is the accent-soft chip and the row isn't terracotta-filled.

### 4.4 Status + action link rows
- Below the timeline: the "you're around point N of A1 · next: …" path cue + **"see the map →"** in a parallel left-text / right-link row, using the shared link style (§2.4).
- Skill snapshot section header: eyebrow **"your turkish"** (drop **"weakest first"**) on the left, **"see full progress →"** on the right — same shared link style.

### 4.5 Skill snapshot / work-on-these / reading promo
- `skill-snapshot-grid.tsx`: keep the weakest-first ordering logic; just update the eyebrow text (drop "weakest first") and the header link style. Rows unchanged structurally.
- `work-on-these.tsx`: see §8 (shared, used here + Progress + drill hub).
- `read-collect-card.tsx`: neutral white card, ink primary `open reader →` (no terracotta fill). Keep the small accent-soft "new" tag.
- Typography: route the section headings through the consolidated scale (`.t-display-l` for "work on these"/"skill snapshot" section heads as in prototype, H1 via `.t-display-xl`).

---

## 5. Drill Session — `app/(dashboard)/drill/` + `_components/`

### 5.1 Desktop layout: 3-column → 2-column; dots inline; coach dormant
- `DrillLayout` / `coach-rail.tsx`: **drop the dedicated coach rail column** on desktop. Move the session progress dots (`SessionDots`) **inline to the top of the main column** (matching prototype `.dots` row above the topic). The coach nudge now lives **only** inside the per-answer feedback card (§5.4).
- Keep `coach-rail.tsx` in the codebase but **dormant** (not mounted) — to be reintroduced when the coach gives genuinely useful advice. Add a brief comment to that effect. Remove its mount from the desktop layout; the layout collapses to two columns (content + natural max-width, prototype `max-width:1040px`).
- Mobile already renders dots inline + coach in-card; align desktop to it.

### 5.2 Remove the top "lately" banner
- Mobile drill currently shows a passive "lately" recap banner on item 1. **Remove** it (prototype dropped it — non-actionable, mismatched the item topic). The coach signal is surfaced per-answer instead (§5.4).

### 5.3 Remove in-session fluency + desktop helper lines; relocate fluency
- **Remove `FluencyPromo` from the drill session entirely** (both the desktop coach-rail placement and the mobile bottom-of-scroll placement). Delete its mounts in the drill; keep `fluency-promo.tsx` file only if reused — otherwise it can be removed once the launcher (below) exists.
- Remove the desktop **"type straight into the gap"** helper line and the **"try next / fluency mode"** dashed box.
- **New fluency home:** add a **"fluency" launcher card** to `drill-hub.tsx` alongside quick drill / dictation / free writing / conjugation. It links to `/fluency`. Framed as a deliberate mode ("timed drills on what you already know"). The `/fluency` page and runner are unchanged.

### 5.4 Coach nudge inside the feedback card
- `feedback-shell.tsx`: when the current item's grammar point is a **known weak spot**, render a coach block at the bottom of the feedback card: brand coach-dot + tag (accent-2 eyebrow) + note (prototype `.fb-coach`). Drive "is weak spot" from the same signal the coach headline used (`useInsightsErrors()` themes / per-item coach data already threaded into the session). When not a weak spot, no coach block. This replaces the always-on rail/banner.

### 5.5 Cloze input — detached underline, color on feedback
- `cloze-exercise.tsx`: detach the terracotta underline from the white input box — small gap between the box (white, `border-rule`, `shadow-1`, `rounded`) and the underline beneath it (prototype `.gapwrap::after` at `bottom:-9px`). Underline color: accent at rest/filled, **green** (`--color-ok`) on correct, **terracotta** (`--color-accent-2`) on wrong. Gap text colors follow (filled=accent-2, correct=ok, wrong=accent-2).

### 5.6 Submit / next button hierarchy
- Primary buttons in the session (submit, next) → **ink primary** (were terracotta). Covered by §2.1 once `accent`→`primary` migration lands; verify the drill's submit/next aren't using `variant="accent"`.
- **Desktop submit:** change from a full-width bar to a **compact right-aligned button** (`submit-row` `justify-end`), matching the feedback "next →" placement. Mobile keeps the action row (`item N of M` left, button right) — already matches.

### 5.7 Session results screen — merge debrief + review
Files: `app/(dashboard)/drill/debrief/[sessionId]/page.tsx`, `_components/debrief-tabs.tsx`, `review-item-card.tsx`, `skill-movements-panel.tsx`.
- **Remove the tab switcher.** Render a single scroll:
  1. **Summary head**: eyebrow "session done · MM:SS", H1 verdict (`.t-display-xl`), "you got X of N · accuracy P%".
  2. **"what moved" card** (`skill-movements-panel` reworked): slipped ▼ / gained ▲ rows + "N skills held steady" line (prototype `.moved`).
  3. **Review list** (`review-item-card`): per-item expanders. **Desktop:** full-width cards with a topic chip + correct/missed badge, expanding to a two-column "your answer" / "corrected" diff (prototype `.rev2` / `.diff2`). **Mobile:** the compact `.rev` row + inline expand.
- **Button hierarchy (results):** primary **"practice more"**, ghost **"done"**, and a **"see your progress →"** text link — aligned in one action row (desktop: link left, ghost+primary right; mobile: stacked primary, ghost, then centered link). Fixes the misaligned floating "done".
- Keep all debrief data wiring (skill movements, per-item correctness, explanations) — only the presentation/structure changes. If `debrief-tabs.tsx` becomes unused, remove it and its tests; update the page to compose the two sections directly.

---

## 6. Progress — `app/(dashboard)/progress/` + `_components/`

### 6.1 Map list — chevron affordance
- `map-tab.tsx`: add a **"›" chevron** at the right edge of each grammar-point row (prototype `.pt-chev`), signaling it opens the detail panel. Needed especially for mobile tap discoverability. Color `rule-strong`, hover → `ink-mute` + slight translate on desktop. Ensure the whole row stays the click target (already opens `PointDetailSheet`).

### 6.2 Point detail drawer/sheet — `point-detail-sheet.tsx`
Button system per §2.1/§2.4:
- **"mixed drill — adapts to your weak spots"** → ink **primary**, full width (`btn block`).
- **"cloze" / "translation"** mode buttons → **ghost** (transparent, `border-rule-strong`), were white-filled. (These are `compatibleTypes` buttons.)
- **"read the theory →"** → **underlined text link** (shared style §2.4), was a dashed-border button.

Mastery/confidence presentation (decision #2):
- **Mastery**: keep the `%` value/bar. Add a one-line plain-language **hint** beneath the stats explaining what it means (e.g. "mastery = your recent accuracy on this point, weighted by difficulty & recency"). Keep it short; tokens only.
- **Confidence**: replace the raw `%` with a **qualitative tag** — derive a band from the existing confidence value (e.g. `≥70` → "high confidence", `40–69` → "building confidence", `<40` → "low confidence"). Show the tag where the `%` was; optionally keep the number in a tooltip/hint, but the primary display is qualitative.
- **Evidence**: keep the count as-is (it's already concrete/honest).
- Drawer slide-over (desktop) / bottom sheet (mobile) mechanics unchanged.

### 6.3 Readiness + work-on-these + tabs
- Readiness strip, A2 preview (dashed = legit preview container, keep), tabs (map/shape/fluency/history) unchanged structurally. The **fluency tab** stays as-is (stats/readiness) — fluency's *entry point* is the drill hub (§5.3), not here.
- `work-on-these` on the map tab: shared component, §8.

---

## 7. Mobile parity

Every change above applies to both breakpoints. Mobile specifics already covered: segmented load control, neutral Next Up card, inline dots + in-card coach, compact action row, chevron on map rows, bottom-sheet drawer, `vocab` tab label + flashcards icon, 36px H1. The app's `mobile:` (≤760px) variant + `.t-display-*` mobile overrides are the mechanism — no separate mobile components beyond what exists.

---

## 8. Content consistency — "work on these"

- `work-on-these.tsx` is **already shared** across Home, Drill hub, and Progress, all sourcing `useInsightsErrors().data.themes`. The prototype's "different data on each screen" was mock divergence, not a live bug.
- **Action:** verify all three call sites pass the **same** themes (same hook, same `MAX_ITEMS=3`, same sort) so they render identically in a session. If any site sorts/slices differently, normalize. **Do not** hardcode the prototype's `kitabım→kitabımı · 8× / geldiler→gelmediler · 7× / köpegi→köpeği · 9×` set into the app — that's fixture data. (If the user later wants a deterministic demo set, that's a separate fixture/storybook concern.)

---

## 9. Testing & verification

- **Unit/integration:** update any test asserting the old `review` nav label, the removed greeting text, the `accent` button variant, the debrief tab switcher, or daily-load radio-card markup. Add/adjust tests for: segmented load control selection, nav `vocab`/`my vocabulary` label + new icon, drawer confidence-band mapping, fluency launcher presence in drill hub + absence in session.
- **`next build`:** run `pnpm --filter @language-drill/web build` — Home/Drill/Progress touch layout/providers-adjacent code and Suspense boundaries; the pre-push gate (lint/typecheck/test) does **not** catch Next prerender errors. (Memory: *web-gate-misses-next-build*.)
- **Full gate:** `pnpm lint && pnpm typecheck && pnpm test` from repo root, zero failures, before push.
- **Visual check:** because Clerk blocks rendering `/` locally without real dev keys, verify changed page components in isolation via the tsc-transpile + Playwright harness pattern (Memory: *verify-landing-without-clerk*) for at least Home, Drill session, Progress drawer, and the merged debrief.
- **E2E:** the authenticated dashboard specs mock `**/profiles/languages`; keep that. Re-run drill/progress e2e if label/route assertions are touched.

## 10. Implementation ordering (suggested)

1. **Foundations** (§2): `globals.css` token + `.t-display-xl` bump + shared link style; `Button` refactor (`primary` hover, `ghost` redefine, `accent`→`primary` migration). Land + gate first — everything else depends on it.
2. **Nav** (§3): rename + icon + tests.
3. **Home** (§4).
4. **Drill session** (§5) incl. debrief merge (§5.7) and fluency relocation (§5.3).
5. **Progress** (§6).
6. **Consistency + full gate + build** (§8, §9).

Each step: implement → tests for that step → gate green → next (per CLAUDE.md testing rules).
