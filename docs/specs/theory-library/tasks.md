# Implementation Plan

## Task Overview

Build the Theory Library bottom-up: first the curriculum-anchored data (category taxonomy + curriculum-order helper), then the additive server enrichment of `GET /theory/:lang` and its api-client schema, then the web layer (hook extension, pure list logic, the `TheorySections` extraction, nav entry), and finally the two pages with their co-located sub-components, closing with one E2E happy path. Every step reuses existing code; the only net-new modules are the category taxonomy, the pure list logic, and the page/component files. No DB migration.

## Steering Document Compliance

- **structure.md:** category taxonomy in `packages/shared` (next to `curriculum-types.ts`); curriculum-order helper with curriculum data in `packages/db`; route change stays in `infra/lambda/src/routes/theory.ts`; web pages follow the `(dashboard)/<route>/page.tsx` + `_components/`/`_lib/` convention used by `progress/`; shared theory components stay in `apps/web/components/theory/`.
- **tech.md:** Hono + per-route JWT (no new surface), shared Zod types in `@language-drill/api-client`, TanStack Query hooks with `createAuthenticatedFetch`, Drizzle read-only, design-system tokens / `globals.css` `.theory-*` class convention, `useIsMobile` (760px) for responsive branching.
- **CLAUDE.md:** no `*_SYSTEM_PROMPT`/`CURRICULUM_VERSION_*` bump required (no prompt or grammar-entry edits); tests written and run per task; additive list contract protects the in-drill `TheoryPanel`.

## Atomic Task Requirements

Each task touches 1-3 files, is completable in 15-30 minutes, has one testable outcome, names exact files, and references requirements + code to leverage.

## Tasks

### Backend: curriculum-anchored data

- [x] 1. Create theory category taxonomy in packages/shared/src/theory-categories.ts
  - File: packages/shared/src/theory-categories.ts (new)
  - Define `TheoryCategoryId` union (`'tenses' | 'moods' | 'pairs' | 'syntax' | 'pronouns' | 'articles' | 'orthography' | 'other'`), `TheoryCategory` type (`{ id, label, order }`), `THEORY_CATEGORIES` readonly array (stable `order`, `'other'` last), `FALLBACK_CATEGORY_ID = 'other'`, and `getTheoryCategory(id)`
  - Add a `Record<string, TheoryCategoryId>` map keyed by curriculum `grammarPointKey` (e.g. `es-b1-present-subjunctive`) for the currently-uncommented curriculum entries, plus `resolveTheoryCategory(key)` returning the mapped id or `'other'` for unmapped/null/undefined
  - Purpose: single curriculum-anchored source for category id/label/order, resolvable server-side
  - _Leverage: packages/shared/src/curriculum-types.ts (GrammarPoint.key format), .claude/specs/theory-library/prototypes/desktop-theory-index.jsx (TOPIC_CATEGORIES shape)_
  - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 2. Re-export theory-categories from packages/shared/src/index.ts
  - File: packages/shared/src/index.ts (modify)
  - Add `export * from './theory-categories'` alongside the existing exports
  - Purpose: make the taxonomy + resolver importable by `@language-drill/db`, `@language-drill/api-client`, lambda, and web
  - _Leverage: packages/shared/src/index.ts (existing re-export pattern)_
  - _Requirements: 8.1_

- [x] 3. Write unit tests for theory-categories in packages/shared/src/theory-categories.test.ts
  - File: packages/shared/src/theory-categories.test.ts (new)
  - Assert every value in the key→category map is a valid `TheoryCategoryId` present in `THEORY_CATEGORIES`; `THEORY_CATEGORIES` ids are unique and `order` values are strictly increasing with `'other'` last; `resolveTheoryCategory` returns the mapped id for known keys and `'other'` for unmapped key, `null`, and `undefined`
  - Run: `pnpm --filter @language-drill/shared test`
  - Purpose: lock the taxonomy invariants (NFR maintainability)
  - _Leverage: packages/shared/src/theory.test.ts (Vitest patterns in this package)_
  - _Requirements: 8.2, 8.3_

- [x] 4. Add curriculumOrderOf helper in packages/db/src/curriculum/index.ts
  - File: packages/db/src/curriculum/index.ts (modify)
  - Build a module-scope `Map<key, index>` from the per-language arrays (`esCurriculum`, `deCurriculum`, `trCurriculum`) — order is position within the language's own array; export `curriculumOrderOf(key: string): number | undefined` returning the index or `undefined` for unknown keys
  - Purpose: stable curriculum sequence number for the "curriculum" sort
  - _Leverage: packages/db/src/curriculum/index.ts (GRAMMAR_POINT_INDEX construction pattern)_
  - _Requirements: 4.2_

- [x] 5. Write unit tests for curriculumOrderOf in packages/db/src/curriculum/curriculum.test.ts
  - File: packages/db/src/curriculum/curriculum.test.ts (modify — add a describe block)
  - Assert known keys return a non-negative integer matching their array position, ordering is consistent within a language, and unknown keys return `undefined`
  - Run: `pnpm --filter @language-drill/db test`
  - Purpose: guard the curriculum-order contract
  - _Leverage: packages/db/src/curriculum/curriculum.test.ts (existing curriculum tests)_
  - _Requirements: 4.2_

### Backend: list-endpoint enrichment + schema

- [x] 6. Enrich GET /theory/:lang response in infra/lambda/src/routes/theory.ts
  - File: infra/lambda/src/routes/theory.ts (modify the `theory.get('/theory/:lang', …)` handler)
  - Add `grammarPointKey: theoryTopics.grammarPointKey` to the list `select`; map each surviving row to `{ id, title, cefr, category: resolveTheoryCategory(row.grammarPointKey), order: curriculumOrderOf(row.grammarPointKey) ?? null }`; keep the approved-status filter, the `title`/`cefr` NOT NULL corrupt-row guards, and the warn-log drop count unchanged
  - Purpose: serve per-topic category + curriculum order so the client groups/sorts without curriculum data (NFR performance)
  - _Leverage: infra/lambda/src/routes/theory.ts (existing list query + filters), @language-drill/shared (resolveTheoryCategory), @language-drill/db (curriculumOrderOf)_
  - _Requirements: 3.7, 4.2, NFR security (approved-only), NFR reliability (skip corrupt rows)_

- [x] 7. Add enrichment tests in infra/lambda/src/routes/theory.test.ts
  - File: infra/lambda/src/routes/theory.test.ts (modify — file exists)
  - Assert the list response items now carry correct `category` and `order` for a mapped topic, `category: 'other'` + `order: null` for an unmapped/null grammar-point key, corrupt rows are still skipped, and approved-status filtering is intact
  - Run: `pnpm --filter @language-drill/lambda test`
  - Purpose: prove enrichment + preserved filters
  - _Leverage: infra/lambda/src/routes/theory.test.ts or a sibling route test for the harness/db-mock pattern_
  - _Requirements: 3.7, 4.2, NFR reliability_

- [x] 8. Extend TheoryListItemSchema in packages/api-client/src/schemas/theory.ts
  - File: packages/api-client/src/schemas/theory.ts (modify)
  - Add `category: z.string().default('other')` and `order: z.number().nullable().default(null)` to `TheoryListItemSchema`; the inferred `TheoryListItem` type then carries both
  - Purpose: type the enriched item while staying backward compatible with payloads that omit the fields (NFR reliability — additive contract)
  - _Leverage: packages/api-client/src/schemas/theory.ts (existing schema)_
  - _Requirements: 3.7, 4.2, NFR reliability_

- [x] 9. Add schema tests in packages/api-client/src/schemas/theory.test.ts
  - File: packages/api-client/src/schemas/theory.test.ts (modify)
  - Assert an enriched item parses with `category`/`order` preserved, and a legacy item (no `category`/`order`) parses with defaults `'other'`/`null`
  - Run: `pnpm --filter @language-drill/api-client test`
  - Purpose: lock backward-compat defaults
  - _Leverage: packages/api-client/src/schemas/theory.test.ts (existing tests)_
  - _Requirements: NFR reliability_

### Web: hook extension + pure list logic

- [x] 10. Carry category/order through useTheoryTopics in apps/web/lib/hooks/use-theory-topics.ts
  - File: apps/web/lib/hooks/use-theory-topics.ts (modify)
  - Widen `UseTheoryTopicsResult.topics` items to `{ id, title, cefr, category: TheoryCategoryId, order: number | null }`; DB topics carry the enriched fields through; static (editorial-override) topics default to `category: 'other'`, `order: null`; preserve the existing static+DB dedupe, title sort, query key, and 5-min stale time
  - Purpose: surface category/order to the index without breaking the static-merge or the `TheoryToc`/`TheoryEmpty` call sites (which read only id/title)
  - _Leverage: apps/web/lib/hooks/use-theory-topics.ts (existing hook), @language-drill/shared (TheoryCategoryId)_
  - _Requirements: 2.1, 3.7, 4.2_

- [x] 11. Update useTheoryTopics tests in apps/web/lib/hooks/use-theory-topics.test.ts
  - File: apps/web/lib/hooks/use-theory-topics.test.ts (modify)
  - Assert DB topics expose the enriched `category`/`order`, static topics default to `'other'`/`null`, and dedupe/sort still hold
  - Run: `pnpm --filter @language-drill/web test`
  - Purpose: guard the widened hook contract
  - _Leverage: apps/web/lib/hooks/use-theory-topics.test.ts (existing tests + fetch mocks)_
  - _Requirements: 2.1, 3.7_

- [x] 12. Create grouping/sort/search types + filter/sort in apps/web/lib/theory-library/group-sort.ts
  - File: apps/web/lib/theory-library/group-sort.ts (new)
  - Define `GroupBy = 'category' | 'level' | 'none'`, `SortBy = 'curriculum' | 'alpha'`, `LibraryTopic`, `TopicGroup`; implement `filterTopics(topics, query)` (case-insensitive match on title + cefr) and `sortTopics(topics, sortBy)` (curriculum: `order` asc with `null` last then title; alpha: `localeCompare`)
  - Purpose: pure, testable filter + sort primitives
  - _Leverage: @language-drill/shared (TheoryCategoryId), .claude/specs/theory-library/prototypes/desktop-theory-index.jsx (sort/filter logic)_
  - _Requirements: 4.2, 4.3, 5.2_

- [x] 13. Add groupTopics + highlightMatch in apps/web/lib/theory-library/group-sort.ts
  - File: apps/web/lib/theory-library/group-sort.ts (continue from task 12)
  - Implement `groupTopics(topics, groupBy, sortBy, query)`: when `query` non-empty → one `results` group sorted by `sortBy`; else group by category (THEORY_CATEGORIES order, `'other'` last, empty groups dropped), by CEFR (A1,A2,B1,B2,C1,C2 order, empties dropped), or flat (`all`); each group carries `{ id, label, topics }` sorted within. Implement `highlightMatch(title, query)` returning `{ before, match, after } | null`
  - Purpose: grouping precedence + search highlight (Requirement 3/5)
  - _Leverage: @language-drill/shared (THEORY_CATEGORIES, getTheoryCategory), .claude/specs/theory-library/prototypes/desktop-theory-index.jsx (groups memo)_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.3_

- [x] 14. Write unit tests for theory-library logic in apps/web/lib/theory-library/group-sort.test.ts
  - File: apps/web/lib/theory-library/group-sort.test.ts (new)
  - Cover `filterTopics` (title + cefr, case-insensitive), `sortTopics` (curriculum nulls-last-by-title; alpha localeCompare), `groupTopics` (category order + `'other'` last + empty-group drop; CEFR order + empties dropped; flat; search→single `results` group sorted by active sort), `highlightMatch` (split + no-match null)
  - Run: `pnpm --filter @language-drill/web test`
  - Purpose: lock the pure list logic (these are the trickiest correctness rules)
  - _Leverage: apps/web test setup (Vitest)_
  - _Requirements: 3.1-3.6, 4.2, 4.3, 5.2, 5.3_

### Web: shared component extraction + nav

- [x] 15. Extract TheorySections in apps/web/components/theory/theory-sections.tsx
  - File: apps/web/components/theory/theory-sections.tsx (new)
  - Move the `TheoryErrorBoundary` + the `topic.sections.map(...)` `<section id className="theory-section">` markup out of `theory-content.tsx` into a `TheorySections({ topic, language, onSwitchTopic })` component (sections + error boundary only — NO scroll container, spacer, or footer); the boundary's fallback stays `TheoryEmpty`
  - Purpose: shareable section renderer for both panel and detail page
  - _Leverage: apps/web/components/theory/theory-content.tsx (boundary + section markup), apps/web/components/theory/theory-empty.tsx_
  - _Requirements: 6.2, NFR reliability (render error boundary)_

- [x] 16. Refactor TheoryContent to compose TheorySections in apps/web/components/theory/theory-content.tsx
  - File: apps/web/components/theory/theory-content.tsx (modify)
  - Replace the inlined boundary + sections with `<div ref={scrollRef} className="theory-scroll"><TheorySections topic language onSwitchTopic /> {80px spacer} {existing back-to-drill footer}</div>`; keep the `scrollRef`, spacer, and `onClose` footer exactly as-is so panel DOM output is unchanged
  - Purpose: panel reuses the extracted renderer without behavior change
  - _Leverage: apps/web/components/theory/theory-sections.tsx (task 15)_
  - _Requirements: NFR reliability (in-drill flow unchanged)_

- [x] 17. Verify panel regression tests pass in apps/web/components/theory/__tests__/theory-panel.test.tsx
  - File: apps/web/components/theory/__tests__/theory-panel.test.tsx (run; extend only if needed)
  - Run the existing panel + content tests; confirm section markup, error-boundary fallback, and footer are unchanged after the extraction; add an assertion only if a gap surfaces
  - Run: `pnpm --filter @language-drill/web test`
  - Purpose: prove the extraction is behavior-preserving
  - _Leverage: apps/web/components/theory/__tests__/theory-panel.test.tsx (existing)_
  - _Requirements: NFR reliability_

- [x] 18. Add TheoryIcon in apps/web/components/shell/nav-icons.tsx
  - File: apps/web/components/shell/nav-icons.tsx (modify)
  - Add an exported `TheoryIcon()` SVG (book/open-book or grid glyph) using the shared `SHARED_PROPS` + `aria-hidden`, matching the existing icon style
  - Purpose: nav glyph for the theory destination
  - _Leverage: apps/web/components/shell/nav-icons.tsx (ReadIcon/ProgressIcon + SHARED_PROPS)_
  - _Requirements: 1.1_

- [x] 19. Add /theory destination in apps/web/components/shell/nav-items.tsx
  - File: apps/web/components/shell/nav-items.tsx (modify)
  - Insert `{ href: '/theory', label: 'theory', icon: <TheoryIcon /> }` into `NAV_DESTINATIONS` after `/read` and before `/progress`
  - Purpose: surface the library in desktop rail + mobile tab bar with correct active state (handled by existing `isActive` startsWith rule)
  - _Leverage: apps/web/components/shell/nav-items.tsx (NAV_DESTINATIONS), nav-item.tsx (isActive)_
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

### Web: index page + sub-components

- [x] 20. Create index header + search box in apps/web/app/(dashboard)/theory/_components/theory-library-header.tsx and theory-search-box.tsx
  - Files: apps/web/app/(dashboard)/theory/_components/theory-library-header.tsx (new), apps/web/app/(dashboard)/theory/_components/theory-search-box.tsx (new)
  - Header: "theory library." title, total-topic count, intro line. Search box: controlled input + clear (×) button + desktop ⌘K hint chip + a ⌘K/Ctrl+K window listener that `preventDefault`s and focuses the input only when focus is not already in a text input
  - Purpose: header + search affordances
  - _Leverage: apps/web/components/ui (Chip/Button), apps/web/lib/cn, .claude/specs/theory-library/prototypes/{desktop-theory-index.jsx, mobile-theory-index.jsx}_
  - _Requirements: 2.6, 5.1, 5.5, 5.6_

- [x] 21. Create group/sort controls in apps/web/app/(dashboard)/theory/_components/theory-controls.tsx
  - File: apps/web/app/(dashboard)/theory/_components/theory-controls.tsx (new)
  - Group-by (category/CEFR level/flat list) + sort (curriculum/A→Z) controls; segmented controls on desktop, horizontally scrollable chip strips on mobile (branch via `useIsMobile`); controlled value + onChange props
  - Purpose: grouping + sorting UI (Requirement 3.1/4.1, responsive 7.1/7.2)
  - _Leverage: apps/web/lib/responsive (useIsMobile), apps/web/lib/cn, .claude/specs/theory-library/prototypes/{desktop-theory-index.jsx (SegControl), mobile-theory-index.jsx (chip strips)}_
  - _Requirements: 3.1, 4.1, 7.1, 7.2_

- [x] 22. Create topic row + group section in apps/web/app/(dashboard)/theory/_components/theory-topic-row.tsx and theory-group.tsx
  - Files: apps/web/app/(dashboard)/theory/_components/theory-topic-row.tsx (new), apps/web/app/(dashboard)/theory/_components/theory-group.tsx (new)
  - Row: `next/link` to `/theory/[id]`, title (with `highlightMatch` when searching), CEFR `Chip`, `→` affordance, accessible name. Group: header (label + count) + rows; desktop = card-framed list, mobile = collapsible accordion (default-open largest two groups)
  - Purpose: list rows + group rendering (Requirement 2.2/3.6, responsive 7.1/7.2, nav 6.1)
  - _Leverage: apps/web/components/ui (Chip), apps/web/lib/theory-library (highlightMatch), apps/web/lib/responsive, .claude/specs/theory-library/prototypes/{desktop-theory-index.jsx (TopicRow), mobile-theory-index.jsx (accordion)}_
  - _Requirements: 2.2, 3.6, 5.3, 6.1, 7.1, 7.2_

- [x] 23. Create list state components in apps/web/app/(dashboard)/theory/_components/theory-list-states.tsx
  - File: apps/web/app/(dashboard)/theory/_components/theory-list-states.tsx (new)
  - Export loading, error-with-retry (calls a passed `onRetry`), empty-language ("no topics yet for {language}"), and no-search-results (with clear-search action) states
  - Purpose: index loading/error/empty branches (Requirement 2.4/2.5/5.4)
  - _Leverage: apps/web/components/ui (Button), @language-drill/shared (LANGUAGE_NAMES), apps/web/components/theory/theory-empty.tsx (tone)_
  - _Requirements: 2.4, 2.5, 5.4_

- [x] 24. Create the index page in apps/web/app/(dashboard)/theory/page.tsx
  - File: apps/web/app/(dashboard)/theory/page.tsx (new, `'use client'`)
  - Wire `useActiveLanguage` + `useMemo(() => createAuthenticatedFetch(getToken), [getToken])` + `useTheoryTopics({ language, fetchFn })`; local `search/groupBy(default 'category')/sortBy(default 'curriculum')` state; derive groups via `groupTopics`; compose header, search box, controls, groups, and the loading/error/empty/no-results states; header count is the language total (not filtered)
  - Purpose: assemble the index (Requirements 2-5)
  - _Leverage: apps/web/app/(dashboard)/progress/page.tsx (page pattern), apps/web/lib/hooks/use-theory-topics.ts, apps/web/lib/theory-library, the _components from tasks 20-23_
  - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 3.x, 4.x, 5.x, 7.1, 7.2_

- [x] 25. Add index page render tests in apps/web/app/(dashboard)/theory/page.test.tsx
  - File: apps/web/app/(dashboard)/theory/page.test.tsx (new, co-located like progress/page.test.tsx)
  - With a mocked enriched list: assert grouped rendering, that group-by/sort/search controls change the rendered groups, header count is the language total (unaffected by search), and the empty-language / error / no-results branches render
  - Run: `pnpm --filter @language-drill/web test`
  - Purpose: cover index orchestration
  - _Leverage: apps/web testing utilities, fetch mocks from use-theory-topics tests_
  - _Requirements: 2.x, 3.x, 4.x, 5.x_

### Web: detail page

- [x] 26. Create TheoryDetail in apps/web/app/(dashboard)/theory/_components/theory-detail.tsx
  - File: apps/web/app/(dashboard)/theory/_components/theory-detail.tsx (new, `'use client'`)
  - Props `{ topicId, language, fetchFn }`; `useTheoryTopic` + `useScrollSpy(sectionIds, scrollRef)`; header (back-to-library `next/link` to `/theory`, `theory · reference` eyebrow, `<h1>` title, CEFR `Chip`, subtitle); body = `TheoryToc` (with `onSwitchTopic = (id) => router.push('/theory/' + id)`, `onJump` via `scrollIntoView`+`CSS.escape`) + a `theory-scroll` `overflow-y:auto` wrapper (the scroll-spy root) around `<TheorySections/>`; back-to-library footer; loading / error / not-found (`TheoryEmpty` with router-wired other-topics) states; reset `scrollRef.scrollTop` on topic change
  - Purpose: full-page detail reusing panel internals (Requirement 6, 7.3/7.4)
  - _Leverage: apps/web/lib/hooks/use-theory-topic.ts, apps/web/lib/hooks/use-scroll-spy.ts, apps/web/components/theory/{theory-toc, theory-sections, theory-empty}.tsx, theory-panel.tsx (handleJump/scroll-reset pattern), apps/web/components/ui (Chip)_
  - _Requirements: 6.2, 6.3, 6.5, 6.6, 6.7, 7.3, 7.4_

- [x] 27. Create the detail route in apps/web/app/(dashboard)/theory/[topicId]/page.tsx
  - File: apps/web/app/(dashboard)/theory/[topicId]/page.tsx (new, `'use client'`)
  - Read + decode `topicId` from route params; wire `useActiveLanguage` + `createAuthenticatedFetch(getToken)`; render `<TheoryDetail topicId language fetchFn />`
  - Purpose: deep-linkable `/theory/[topicId]` route (Requirement 6.1, 6.4)
  - _Leverage: apps/web/app/(dashboard)/progress/page.tsx (client page + fetchFn pattern), theory-detail.tsx (task 26)_
  - _Requirements: 6.1, 6.4_

- [x] 28. Add TheoryDetail tests in apps/web/app/(dashboard)/theory/_components/__tests__/theory-detail.test.tsx
  - File: apps/web/app/(dashboard)/theory/_components/__tests__/theory-detail.test.tsx (new)
  - With fetch mocks: success renders title + sections + TOC and tracks an active section id; 404 renders `TheoryEmpty` with router-wired other-topic links; an other-topic click calls `router.push('/theory/<slug>')`; error state renders
  - Run: `pnpm --filter @language-drill/web test`
  - Purpose: cover detail states + navigation (Requirements 6.2-6.7)
  - _Leverage: next/navigation router mock, apps/web fetch mocks_
  - _Requirements: 6.2, 6.3, 6.5, 6.7_

### Web: styling + E2E

- [x] 29. Add theory-library styles to apps/web/app/globals.css
  - File: apps/web/app/globals.css (modify)
  - Add a `.theory-library-*` block (index header, search, controls/chips, group header, topic row, accordion, list states) mirroring the existing `.theory-*` convention, with token-backed colors/spacing only and a `@media (max-width: 760px)` block mirroring `MOBILE_MAX_WIDTH`; ensure the detail page's `.theory-scroll` container styling carries over (reuse existing class)
  - Purpose: token-based styling for the new surfaces (Requirement 7.5)
  - _Leverage: apps/web/app/globals.css (existing .theory-* block + media-query convention), apps/web/lib/responsive.ts (MOBILE_MAX_WIDTH)_
  - _Requirements: 7.1, 7.2, 7.5_

- [x] 30. Add the library happy-path E2E in apps/web/e2e/theory-library.spec.ts
  - File: apps/web/e2e/theory-library.spec.ts (new, `authenticated` project)
  - Navigate via the "theory" nav item → assert `/theory` shows topics → open a topic → assert `/theory/[topicId]` shows title + sections + TOC → use back-to-library → assert return to `/theory`
  - Run: `pnpm --filter @language-drill/web test:e2e`
  - Purpose: end-to-end happy path (NFR testing)
  - _Leverage: apps/web/e2e (authenticated project, auth.setup.ts, existing spec patterns), docs/testing.md_
  - _Requirements: 1.2, 2.1, 6.1, 6.2, 6.6_

- [x] 31. Run the full pre-push suite and fix any failures
  - Files: any touched by failures
  - Run `pnpm lint`, `pnpm typecheck`, `pnpm test` from the repo root; fix lint/type/test failures introduced by tasks 1-30; report X passed / Y failed
  - Purpose: satisfy the CLAUDE.md pre-push gate before the feature is mergeable
  - _Leverage: CLAUDE.md (Pre-Push Checks)_
  - _Requirements: All_
