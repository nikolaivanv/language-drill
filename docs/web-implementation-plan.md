# Web Implementation Plan

A phased roadmap for implementing the design prototypes in `docs/design-archive/design_handoff_language_drill/` into the Next.js web app at `apps/web/`. Mobile (Expo) is deferred — we'll return to it after the web is feature-complete.

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
| **C** | [onboarding](#phase-c--onboarding) | ✅ complete | ~2 days | A, B |
| **F** | [exercise-ui](#phase-f--exercise-ui-redesign) | ✅ complete | ~3 days | A, B |
| **E** | [session-flow](#phase-e--session-flow) | ✅ complete | ~2 days | F |
| **D** | [dashboard](#phase-d--dashboard--todays-plan) | ✅ complete | ~2 days | A, B, E |
| **G** | [debrief](#phase-g--post-session-debrief) | ✅ complete | ~2 days | E |
| **H** | [theory-panel](#phase-h--theory-reference-panel) | ✅ complete | ~2 days | A |
| **I** | [progress-page](#phase-i--progress-page) | ✅ complete | ~3 days | A, B |
| **J** | [read-collect](#phase-j--read--collect) | ✅ complete | ~4 days | A, B, D |

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

**Spec:** `.claude/specs/onboarding/`

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

**Spec:** `.claude/specs/dashboard/` (35/35 tasks complete)

Replaced the welcome placeholder with the editorial dashboard from `prototypes/web/hifi/dashboard.jsx`. Two parallel TanStack Query hooks fan out to per-section orchestrators with their own error / loading / empty states; no streaks, XP, or lesson-completion counters anywhere.

**Output:**
- Wire schema + hook: `packages/api-client/src/schemas/today.ts` (`TodayPlanResponseSchema` + inferred types) and `packages/api-client/src/hooks/useTodayPlan.ts` (typed query, `staleTime: 60s`, language-keyed cache key)
- Pure plan composition: `infra/lambda/src/lib/today-plan.ts` (`startOfUtcDay`, `V1_PLAN_SHAPE` of `cloze, cloze, translation, vocab_recall, cloze`, `composeFreshPlan`, `hydrateFromSession`, plus `ESTIMATED_MINUTES_BY_TYPE` and `ITEMS_BY_TYPE` constants)
- Lambda route: `GET /sessions/today` in `infra/lambda/src/routes/sessions.ts` — Path A hydrates from today's `practice_sessions` row (LEFT JOIN `user_exercise_history`), Path B composes a fresh plan from a UNION-ALL pool sample; insufficient pool returns `code: 'INSUFFICIENT_POOL'` with `items: []`
- Page-scoped helpers: `apps/web/app/(dashboard)/_lib/{greeting,timeline-labels,framing-rules}.ts` — time-of-day greeting / ISO-week math, slot-prefix + type-label tables, deterministic framing-paragraph generator (no Claude call)
- UI components: `apps/web/app/(dashboard)/_components/{greeting-block,dashboard-header,timeline-item,today-timeline,state-cards,skill-row,skill-snapshot-grid,read-collect-card}.tsx` — `GreetingBlock` defers time-dependent strings to a post-mount `useEffect` to avoid SSR mismatch; `TodayTimeline` switches between skeleton / error / pool-not-ready / all-done / rail; `SkillSnapshotGrid` sorts axes weakest-first with `key.localeCompare` tiebreak
- Page: `apps/web/app/(dashboard)/page.tsx` rewritten as the dashboard host (parallel `useTodayPlan` + `useProgressRadar`, per-section error boundaries via the orchestrators)

**Backend impact:**
- New `GET /sessions/today?language=<ES|DE|TR>` — returns `{ language, generatedAt, totalEstimatedMinutes, items, summary, code }` keyed by today's UTC date; ≤ 2 SQL round-trips (today-session lookup + proficiency-level fetch in parallel via `Promise.all`, then either Path-A items join or Path-B pool sample)
- No new tables — reuses `practice_sessions`, `user_exercise_history`, `exercises`, `user_language_profiles`
- Skill snapshot reuses the existing `GET /progress/radar` endpoint (no new `/stats/skills` endpoint added — the radar already covers the six axes)

Includes the **dashboard entry card for Read & Collect** (linking to `/read`, added ahead of section J).

---

## Phase E — Session flow

**Spec:** `.claude/specs/session-flow/` (29/29 tasks complete)

Wraps the single-exercise drill page in a server-tracked session of N pre-selected exercises (default 5) bound to one `(language, difficulty)` filter. Submitting items advances a top progress bar; the last item routes to a lightweight summary screen.

**Output:**
- Reducer + selectors: `apps/web/app/(dashboard)/drill/_components/session-reducer.ts` (SessionState discriminated union, sessionReducer with 12 actions, `selectCurrentItem` / `selectProgressFraction` / `selectIsLastItem`)
- Components: `_components/{session-summary,submission-error-card}.tsx`; threaded a `nextLabel` prop through `feedback-shell` + `{cloze,translation,vocab}-exercise` + `exercise-pane`
- Helpers: `apps/web/lib/drill/session-config.ts` (`DEFAULT_EXERCISE_COUNT = 5`); `coach-messages.ts` gains a `sessionComplete` branch
- API client: `packages/api-client/src/{schemas/session,hooks/useSession}.ts` (`useCreateSession`, `useCompleteSession`); `useSubmitAnswer` threads optional `sessionId`
- Server: `infra/lambda/src/routes/sessions.ts` (`POST /sessions`, `POST /sessions/:id/complete` with race-safe atomic UPDATE); `routes/exercises.ts` validates ownership/membership when `sessionId` is present, before rate-limit/Claude
- Schema: `packages/db/src/schema/sessions.ts` + `progress.ts` adds `session_id` FK + index; migration `0003_*.sql`
- Shared: `CORRECT_THRESHOLD = 0.7` exported and used by both the server's `correctCount` query and the UI verdict tier
- Page: `drill/page.tsx` rewritten as a session host (creation effect, per-item submit threading sessionId, "see results" on the last item, summary screen, rate-limit "end session early" + 5xx "skip item" buttons); `drill/page.test.tsx` rewritten with 16 cases covering create → per-item → completion → summary

**Backend impact:**
- New `practiceSessions` table (id, userId, language, difficulty, exerciseCount, correctCount, exerciseIds JSONB, startedAt, completedAt)
- `userExerciseHistory` gains a nullable `sessionId` foreign key (`ON DELETE SET NULL`) and an index
- `POST /sessions` — create session, returns id + exercise manifest; 422 `INSUFFICIENT_EXERCISES` when the pool is too small
- `POST /sessions/:id/complete` — finalize via atomic UPDATE; returns summary `{ exerciseCount, correctCount, attemptedCount, skippedCount, durationSeconds }`

---

## Phase F — Exercise UI redesign

**Spec:** `.claude/specs/exercise-ui/` (33/33 tasks complete)

Redesigned the existing cloze, translation, and vocab exercise UIs to match the prototypes:

- **Cloze** — split layout (280px coach rail + main), type-it default with optional MC toggle (labelled "reduces progress signal"), accent picker, sage/yellow/terracotta verdict shell
- **Translation** — `EN → {LANG}` eyebrow + glossed source (~60-entry static list, hover tooltips) + textarea + accent picker + on-demand hint ladder (gloss → half-reference → full-reference); evaluated view shows diff rows + reference-translation card
- **Vocab recall** — definition card + auto-focused input + progressive hints (first letter → letter count → example sentence with masked target) + accent picker; evaluated view shows target word, example, and a confusions list parsed from Claude feedback

**Output:**
- Helpers: `apps/web/lib/drill/{verdict-tier,coach-messages,cloze-blank,syllabify,parse-confusions}.ts` + `apps/web/lib/translation/gloss-en.ts`
- Components: `apps/web/app/(dashboard)/drill/_components/{drill-layout,coach-rail,exercise-pane,cloze-exercise,translation-exercise,vocab-exercise,feedback-shell,glossed-text,hint-row,loading-skeleton}.tsx`
- New `disabled` prop on `AccentPicker`; rewrote `drill/page.tsx` (560 → 289 lines) and `drill/page.test.tsx` (653 → 578 lines)
- Theory-panel wiring from Phase H preserved verbatim

**Backend impact:** None — same existing endpoints; UI-only changes.

---

## Phase G — Post-session debrief

**Spec:** `.claude/specs/debrief/` (21/21 tasks complete)

Replaces the in-page `SessionSummary` card from Phase E with a routed page at `/drill/debrief/[sessionId]`. The drill page now navigates to the debrief on `useCompleteSession` success; the debrief page reads a single endpoint that returns session metadata + per-item review data in manifest order.

**Output:**
- Helpers: `apps/web/lib/drill/{accuracy-tier,debrief-narrative}.ts` — three-bucket tier function (high / mid / low) + templated coach narrative with what's-next routing (`/progress` for high tier, `/drill` otherwise)
- API client: `packages/api-client/src/{schemas/debrief,hooks/useDebrief}.ts` — `DebriefResponseSchema` + `useSessionDebrief` (TanStack `useQuery`, `staleTime: Infinity` since the payload is immutable once `completedAt` is set)
- Server: `infra/lambda/src/routes/sessions.ts` adds `GET /sessions/:id/debrief` — single SQL trip using `DISTINCT ON (exercise_id) ORDER BY evaluated_at DESC NULLS LAST` to collapse retry rows; ownership + completion gate in one `WHERE`; cross-user / unknown / not-completed all return 404; `Cache-Control: private, max-age=300` on success only
- Page: `apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.tsx` orchestrates `useSessionDebrief` + tab state; renders `<DebriefSkeleton>` / `<DebriefNotFound>` / full view (header + tabs + footer); 8-case integration tests
- Components: `apps/web/app/(dashboard)/drill/debrief/_components/{debrief-header,debrief-tabs,debrief-tab,review-tab,review-item-card,debrief-footer,debrief-not-found,debrief-skeleton}.tsx` — editorial header (tier-keyed display title, `m:ss` duration, lowercase invariant); WAI-ARIA tablist mirroring `progress-tabs.tsx`; per-item review cards for cloze / translation / vocab with collapsed-by-default for correct items; three-button action footer
- Phase E cleanup: removed `SessionSummary` component + test, dropped the `summary` discriminant from `SessionState` and the `COMPLETE_SUCCEEDED` action, simplified `selectProgressFraction` accordingly; drill page tests now assert `router.push('/drill/debrief/${sessionId}')` instead of summary markup

**Backend impact:**
- `GET /sessions/:id/debrief` — pure read, no Claude calls, no row writes. Returns session metadata, aggregate counters (`exerciseCount` / `correctCount` / `attemptedCount` / `skippedCount`), and a manifest-ordered `items` array; per-item `status` derives from the most-recent `user_exercise_history.score` against `CORRECT_THRESHOLD` (0.7), or `'skipped'` if no history row exists for the manifest exercise
- **No new migrations** — Phase E's `0003_*.sql` already supplied the `(session_id)` index this endpoint depends on
- Skill deltas explicitly deferred — endpoint shape leaves room to add them later without a versioned breaking change

---

## Phase H — Theory reference panel

**Spec:** `.claude/specs/theory-panel/`

A right-side slide-over panel (max 960px, backdrop blur) reachable from any drill via the "show me theory" button. Contains a TOC sidebar (240px, scroll-synced) and content sections per grammar topic: what is it, when to use it, formation tables, examples, common pitfalls.

**Content strategy:** Static MDX/JSON files per (language × grammar topic) in v1. Move to DB-stored Claude-generated content later.

**Backend impact:** None initially (static content). DB schema for theory entries can be added in a later phase.

---

## Phase I — Progress page

**Spec:** `.claude/specs/progress-page/`

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

**Spec:** `.claude/specs/read-collect/` (39/39 tasks complete)

A parallel entry point reachable from the dashboard card and the left nav. The user pastes a passage (≤ 2,000 chars); Claude flags above-level words via prompt-cached annotation; saved words land in `user_vocabulary` tagged `source = 'reading'` ready for the future drill-weaving phase. v1 ships the data plumbing — drill weaving is explicitly deferred (Requirement 13).

**Output:**
- Shared constants + Zod types: `packages/shared/src/read.ts` (`READ_TEXT_MAX_CHARS`, `READ_CEFR_TOP_RANK` map, `WordFlagSchema`, `FlaggedMapSchema`)
- Drizzle schema: `packages/db/src/schema/read.ts` adds `read_entries` + `user_vocabulary` (unique on `(user_id, language, word)`, descending index on `(user_id, language, pasted_at DESC)`); migration `0004_*.sql`
- Claude annotation: `packages/ai/src/annotate.ts` — `submit_annotated_words` tool + ephemeral-cached system prompt + `parseAnnotateResult` (dedupes matched forms by first-seen; rejects on Zod parse failure)
- Lambda router: `infra/lambda/src/routes/read.ts` mounts five routes (`POST /read/annotate`, `POST /read/entries`, `GET /read/entries`, `GET /read/entries/:id`, `PUT /read/entries/:id/bank`); annotation rate-limit shares the existing `usage_events` daily cap with exercise eval; save + bank-update both run in `db.transaction` so the entry row and vocab upserts can never drift
- API client: `packages/api-client/src/schemas/read.ts` + four hooks (`useReadAnnotate`, `useReadEntries`, `useReadEntry`, `useSaveReadEntry`, `useUpdateReadBank`) — `useUpdateReadBank` does cache-driven optimistic updates + rollback via `setQueryData` in `onMutate` / `onError`
- Page-level helpers: `apps/web/app/(dashboard)/read/_lib/{tokenize,calibration-copy}.ts` (Unicode-aware `\p{P}` tokenizer; `~B1+ calibration / showing words rarer than top-3000 · refined by your known set` copy generator with null fallback)
- Reducer: `apps/web/app/(dashboard)/read/_state/read-page-reducer.ts` (15-action discriminated union; `LOAD_ENTRY` clears popover + toasts in one step; `ENTRY_PERSISTED` pins the new id and raises the save toast atomically; `SET_BANK_FROM_ENTRY` is the rollback hook)
- Components: `apps/web/app/(dashboard)/read/_components/{read-top-bar,empty-view,paste-view,annotated-view,annotated-text,annotated-skeleton,annotated-error,annotated-footer,intensity-toggle,calibration-strip,word-popover,word-bank-rail,history-view,history-empty-state,save-toast,inline-error-toast}.tsx` plus `word-flag-styles.module.css` — every visual reuses `apps/web/components/ui/`; the WAI-ARIA radiogroup intensity toggle, the click-clamped popover, and the data-word-aware outside-click handler land here
- Page: `apps/web/app/(dashboard)/read/page.tsx` rewritten as the read host; integration tests in `page.test.tsx` cover every spec scenario including 429 → "annotate →" disabled, optimistic bank rollback + inline error toast, and the SaveToast 4 s auto-dismiss with fake timers

**Backend impact:**
- Two new tables (`read_entries`, `user_vocabulary`) + migration `0004_*.sql` — no destructive DDL on existing tables
- Five new routes mounted under `/read/*`, all auth-gated via the existing `authMiddleware`; OPTIONS routes have no authorizer (CORS preflight)
- Annotation calls insert one `usage_events` row each (`eventType: 'read_annotation'`, metadata `{ language, textLength, flaggedCount }`); the rate-limit query counts `IN ('ai_evaluation', 'read_annotation')` against `DAILY_EVAL_LIMIT = 50`
- 404-not-403 anti-leak applied on every ownership check (matches `GET /sessions/:id/debrief`)

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
