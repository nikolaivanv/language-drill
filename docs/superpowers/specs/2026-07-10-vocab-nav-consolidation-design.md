# Vocab navigation consolidation — design

**Date:** 2026-07-10
**Status:** approved (brainstorming) → ready for implementation plan
**Related:** `docs/superpowers/specs/2026-07-09-vocab-coverage-hub-design.md` (built the `/vocab` coverage hub), PR #549 (browse hub), PR #553 (detail back link)

## Problem

The left nav carries **two vocabulary-flavoured destinations** that both read as "vocab":

- **`/review` — "my vocabulary"** (mobile "vocab", due-count badge): the personal SRS queue + word bank. Words saved while reading flow in and get scheduled for spaced practice (cloze / meaning→word / recognition). Dynamic, personal, **action**-oriented.
- **`/vocab` — "vocab coverage"** (mobile "coverage"): the curated curriculum target-word lists (ES A1 pilot). Browse topics → words, each colored by coverage state. Static, shared, **map**-oriented.

Two problems, both confirmed with the user:

1. **Label confusion** — "my vocabulary" and "vocab coverage" both say "vocab"; a user can't tell which is which or which to click.
2. **Nav density** — 7 top-level destinations feels cluttered.

The user files "coverage" mentally as a **progress/mastery view**, not a companion to their saved words. The two features are *not* being unified — they stay distinct jobs; only their placement changes.

## Chosen approach (B)

**Move coverage into Progress as a mastery-lens tab; rename `/review`; drop `/vocab` from the nav.**

This is the only option that fixes *both* drivers (density 7→6 **and** the double-"vocab" label) while respecting the "coverage is a progress view" mental model, and it reuses the Progress page's existing URL-synced tablist.

Rejected alternatives:

- **A — merge both into one "vocabulary" nav entry (Practice | Coverage tabs).** Forces a daily action queue (with its due badge) and a browse map under one roof; fights the user's mental model (coverage isn't "my vocabulary").
- **C — relabel only, keep both top-level.** Fixes confusion but leaves density at 7. Fails a stated driver.

## Design

### 1. Navigation — `apps/web/components/shell/nav-items.tsx`

`NAV_DESTINATIONS` is the single source of truth for both the desktop rail and the mobile tab-bar.

- **Remove** the `{ href: '/vocab', label: 'vocab coverage', mobileLabel: 'coverage', … }` entry.
- **Rename** the `/review` entry: `label: 'my vocabulary' → 'review'`; **remove** `mobileLabel: 'vocab'` so mobile also reads "review". Keep the `ReviewIcon` and the due-count badge (`badge={d.href === '/review' ? dueCount : undefined}`).
- Final order (6): `today · drill · read · review · theory · progress`.

`VocabIcon` in `nav-icons.tsx` becomes unused by the nav (Progress tabs are text-only, no icons). Grep for other importers; if none, remove it, otherwise leave it exported. Not load-bearing either way.

### 2. Coverage as a Progress "words" tab

Progress (`/progress`) is already a WAI-ARIA tablist with reload-safe `?tab=` URL state.

- **`_lib/use-tab-url-state.ts`**: add `'words'` to `PROGRESS_TAB_IDS`, positioned **right after `map`**: `['map', 'words', 'shape', 'fluency', 'history']`. (Grammar-mastery map and vocab-coverage map are two mastery lenses; adjacency is intentional.) `DEFAULT_TAB` stays `'map'`.
- **`_components/progress-tabs.tsx`**: add `words: 'words'` to `TAB_LABELS` and a `words: null` slot to the `buttonRefs` record. The arrow-key / Home-End / ARIA wiring then covers the new tab automatically (it iterates `PROGRESS_TAB_IDS`).
- **`_components/words-tab.tsx`** (new): renders the curated topic grid via `<VocabCoverageGrid>` (see §3). Fires `useVocabTopics({ fetchFn, language: activeLanguage })`.
- **`progress/page.tsx`**: call `useVocabTopics` alongside the existing parallel queries (so tab switches are instant), and render `<WordsTab>` when `tab === 'words'`.

The tab renders the coverage topic grid only. A topic's word detail stays a standalone route (§3) — consistent with how "map" opens a grammar point in a detail sheet rather than inline navigation, but here the detail is a full route because it already exists and is deep-linkable.

### 3. Routes — reuse, don't rebuild

- **Extract** the current `/vocab` list-page body (topic grid + `VocabListLoading`/`VocabListError`/`VocabEmpty` states) into a reusable **`apps/web/app/(dashboard)/vocab/_components/vocab-coverage-grid.tsx`**. The `words` tab renders it. The grid's markup/behaviour is unchanged.
- **Delete** `apps/web/app/(dashboard)/vocab/page.tsx` (the standalone index). Navigating to `/vocab` exactly now 404s. (User chose delete over redirect — no bookmark-preservation needed for a days-old surface.)
- **Keep** `apps/web/app/(dashboard)/vocab/[umbrellaKey]/page.tsx` (the word-grid detail) as a standalone deep-linkable route. In Next App Router a dynamic child route is valid without a parent `page.tsx`. Topic cards in the grid still link to `/vocab/[umbrellaKey]`; the "drill this topic" flow (`/drill?...&exerciseType=vocab_recall`) is untouched.
- **Retarget the detail back link** (from PR #553): `href` `/vocab → /progress?tab=words`; label `← vocabulary coverage → ← all topics` (describes the destination — the topic grid). `aria-label → "Back to all topics"`. It still renders in all three states (loading/error/loaded).

### 4. Ripple / test impact

Renaming a nav label and changing a route breaks tests beyond the components themselves (grep the whole app, not just the touched files):

- **Nav tests** — grep app-wide for `"my vocabulary"`, `"vocab coverage"`, `mobileLabel` `"vocab"`/`"coverage"`, and any assertion on the number of nav destinations. Update nav unit tests + Playwright e2e nav specs.
- **Progress tab tests** — `progress-tabs` and `use-tab-url-state` tests assert the 4 known tab ids/labels; bump to 5 and add `words`. Any "renders N tabs" count.
- **`/vocab` page test** (`vocab/page.test.tsx`) — the standalone index is deleted; move its topic-grid assertions into the new `words-tab` (or `vocab-coverage-grid`) test and delete the page test.
- **Detail back-link test** (`vocab/[umbrellaKey]/page.test.tsx`) — flip the expected `href` to `/progress?tab=words` and the accessible name to `/back to all topics/i`, in all three states.
- **Next build** — this touches routing (a deleted route) but no root layout/provider; standard `pnpm --filter @language-drill/web build` in CI covers it.

### Non-goals

- No change to the SRS/review feature itself, the word bank, or the coverage read model / API (`GET /vocab/topics`, `/vocab/topics/:key` stay as-is).
- No unification of the two features into one data model. This is purely information-architecture + routing.
- No new languages/levels for coverage (still ES A1 pilot; other languages show the empty state in the tab).

## Success criteria

- Nav shows 6 destinations; no two labels contain "vocab"; `/review` reads "review" on desktop and mobile with its due badge intact.
- `/progress` has a `words` tab (after `map`) that shows the coverage topic grid, URL-synced as `?tab=words`, keyboard-navigable like the others.
- `/vocab` 404s; `/vocab/[umbrellaKey]` still renders and its back link returns to `/progress?tab=words`.
- Full web gate green: `pnpm --filter @language-drill/web lint typecheck test` + `build`.
