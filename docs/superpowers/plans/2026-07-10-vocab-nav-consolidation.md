# Vocab Navigation Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the curated vocab-coverage hub into a Progress "words" tab, rename the `/review` nav entry to "review", and drop `/vocab` from the nav — fixing the double-"vocab" label and reducing nav from 7 to 6 destinations.

**Architecture:** Pure information-architecture + routing change in `apps/web`. Coverage becomes a fifth Progress tab (a mastery lens beside the grammar Map); the topic-word detail route stays deep-linkable; the standalone `/vocab` index is deleted. No API, data-model, or coverage-read-model changes.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind v4, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-10-vocab-nav-consolidation-design.md`

## Global Constraints

- All work in `apps/web`. No package/API changes.
- Progress tabs are **text-only** (no icons).
- Tab id/label/URL value is the literal string `words`; the coverage URL is `/progress?tab=words`.
- Nav labels are lowercase; `/review` keeps its due-count badge.
- TDD: failing test first, then minimal code. Commit after each task. Each commit must independently pass `tsc` and its touched tests.
- Pre-push gate (repo root): `pnpm --filter @language-drill/web lint`, `... typecheck`, `... test`, and `... build`. Zero failures before push.

---

### Task 1: Nav — remove `/vocab`, rename `/review` → "review", drop `VocabIcon`

**Files:**
- Modify: `apps/web/components/shell/nav-items.tsx`
- Modify: `apps/web/components/shell/nav-icons.tsx` (remove now-unused `VocabIcon`)
- Test: `apps/web/components/shell/__tests__/nav-items.test.tsx`

**Interfaces:**
- Produces: `NAV_DESTINATIONS` — now 6 entries `['/home','/drill','/read','/review','/theory','/progress']`; the `/review` entry has `label: 'review'` and **no** `mobileLabel`. No `/vocab` entry. `VocabIcon` no longer exported from `nav-icons.tsx`.
- Consumes: `mobile-tab-bar.tsx` already renders `d.mobileLabel ?? d.label` and iterates `NAV_DESTINATIONS`, so it needs no edits (its test iterates the array and auto-adjusts).

- [ ] **Step 1: Update the nav-items test to the new order/labels (RED)**

In `apps/web/components/shell/__tests__/nav-items.test.tsx`, replace the first `it(...)` body's two expectations and the third `it(...)` entirely:

```tsx
  it('exposes the primary destinations in order (review + theory between read and progress)', () => {
    expect(NAV_DESTINATIONS.map((d) => d.href)).toEqual([
      '/home',
      '/drill',
      '/read',
      '/review',
      '/theory',
      '/progress',
    ]);
    expect(NAV_DESTINATIONS.map((d) => d.label)).toEqual([
      'today',
      'drill',
      'read',
      'review',
      'theory',
      'progress',
    ]);
  });
```

Replace the `it('includes a distinct /vocab coverage destination', …)` test with:

```tsx
  it('has no standalone /vocab destination and no "vocab" in any label', () => {
    expect(NAV_DESTINATIONS.find((d) => d.href === '/vocab')).toBeUndefined();
    expect(NAV_DESTINATIONS.filter((d) => d.label.includes('vocab')).length).toBe(0);
    expect(NAV_DESTINATIONS.filter((d) => d.href === '/review').length).toBe(1);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web run test components/shell/__tests__/nav-items.test.tsx`
Expected: FAIL — array still contains `/vocab` / `my vocabulary` / `vocab coverage`.

- [ ] **Step 3: Update `nav-items.tsx` (GREEN)**

Remove `VocabIcon` from the import block (leave the other icons) and rewrite `NAV_DESTINATIONS` + the comment:

```tsx
import { NavItem } from './nav-item';
import {
  TodayIcon,
  DrillIcon,
  ReadIcon,
  ReviewIcon,
  TheoryIcon,
  ProgressIcon,
} from './nav-icons';
import { useReviewDueCount } from './use-review-due-count';
```

```tsx
// Single source of nav truth, shared by the desktop rail (`NavItems`) and the
// mobile tab-bar. `review` (spaced practice) and `theory` (reference) sit
// between `read` and `progress`. Vocab coverage is not a top-level destination
// — it lives as the `words` tab inside `/progress` (a mastery lens).
export const NAV_DESTINATIONS: NavDestination[] = [
  { href: '/home', label: 'today', icon: <TodayIcon /> },
  { href: '/drill', label: 'drill', icon: <DrillIcon /> },
  { href: '/read', label: 'read', icon: <ReadIcon /> },
  { href: '/review', label: 'review', icon: <ReviewIcon /> },
  { href: '/theory', label: 'theory', icon: <TheoryIcon /> },
  { href: '/progress', label: 'progress', icon: <ProgressIcon /> },
];
```

(Leave `NavItems`/`NavDestination` and the `badge={d.href === '/review' ? dueCount : undefined}` wiring unchanged.)

- [ ] **Step 4: Remove the unused `VocabIcon` from `nav-icons.tsx`**

Delete the entire `export function VocabIcon() { … }` block (the 3×3 grid of `<rect>`s, ~lines 85–99). No other file imports it (verified: only `nav-items.tsx` did).

- [ ] **Step 5: Run nav + mobile-tab-bar tests to verify they pass**

Run: `pnpm --filter @language-drill/web run test components/shell/__tests__/nav-items.test.tsx components/shell/__tests__/mobile-tab-bar.test.tsx`
Expected: PASS (mobile-tab-bar iterates `NAV_DESTINATIONS`, so its label loop auto-adjusts to "review").

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/shell/nav-items.tsx apps/web/components/shell/nav-icons.tsx apps/web/components/shell/__tests__/nav-items.test.tsx
git commit -m "feat(nav): drop /vocab entry, rename /review to 'review'"
```

---

### Task 2: Add the `words` tab to the Progress tablist

Adding `words` to `PROGRESS_TAB_IDS` forces matching keys in `TAB_LABELS` and the `buttonRefs` record (both are `Record<ProgressTabId, …>`), so all three files change in **one** commit to stay type-consistent.

**Files:**
- Modify: `apps/web/app/(dashboard)/progress/_lib/use-tab-url-state.ts`
- Modify: `apps/web/app/(dashboard)/progress/_components/progress-tabs.tsx`
- Test: `apps/web/app/(dashboard)/progress/_lib/use-tab-url-state.test.ts`
- Test: `apps/web/app/(dashboard)/progress/_components/__tests__/progress-tabs.test.tsx`

**Interfaces:**
- Produces: `PROGRESS_TAB_IDS = ['map','words','shape','fluency','history']`; `ProgressTabId` union now includes `'words'`. `TAB_LABELS.words === 'words'`.
- Consumes: nothing new.

- [ ] **Step 1: Add failing tests (RED)**

In `use-tab-url-state.test.ts`, add after the `?tab=fluency` test:

```tsx
  it("returns 'words' when ?tab=words", () => {
    mockSearchParams = new URLSearchParams('tab=words');
    const { result } = renderHook(() => useTabUrlState());
    expect(result.current.tab).toBe('words');
  });
```

In `progress-tabs.test.tsx`, update the first test to expect five tabs in the new order:

```tsx
  it('renders five tabs with the right labels and roles', () => {
    render(
      <ProgressTabs active="map" onChange={() => {}}>
        <div>panel</div>
      </ProgressTabs>,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    expect(tabs[0]).toHaveProperty('textContent', 'map');
    expect(tabs[1]).toHaveProperty('textContent', 'words');
    expect(tabs[2]).toHaveProperty('textContent', 'shape');
    expect(tabs[3]).toHaveProperty('textContent', 'fluency');
    expect(tabs[4]).toHaveProperty('textContent', 'history');
  });
```

Still in `progress-tabs.test.tsx`, in the `it('moves activation left on ArrowLeft and wraps before the first tab', …)` test, update the second assertion (ArrowLeft from `shape`) — `shape`'s left neighbor is now `words`, not `map`:

```tsx
    fireEvent.keyDown(screen.getAllByRole('tab', { name: 'shape' })[1], {
      key: 'ArrowLeft',
    });
    expect(onChange).toHaveBeenCalledWith('words'); // words is left of shape
```

(The ArrowRight/wrap, Home/End, and other tests need no change: `shape→fluency`, `history→map` wrap, `Home→map`, `End→history` all still hold.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/web run test progress/_lib/use-tab-url-state.test.ts progress/_components/__tests__/progress-tabs.test.tsx`
Expected: FAIL — `'words'` unknown → falls back to `'map'`; only 4 tabs; ArrowLeft yields `'map'`.

- [ ] **Step 3: Add `words` to `PROGRESS_TAB_IDS` (GREEN, part 1)**

In `use-tab-url-state.ts`:

```ts
export const PROGRESS_TAB_IDS = ['map', 'words', 'shape', 'fluency', 'history'] as const;
```

(`DEFAULT_TAB` stays `'map'`.)

- [ ] **Step 4: Add `words` to `progress-tabs.tsx` (GREEN, part 2)**

Add the label:

```tsx
const TAB_LABELS: Record<ProgressTabId, string> = {
  map: 'map',
  words: 'words',
  shape: 'shape',
  fluency: 'fluency',
  history: 'history',
};
```

Add the ref slot:

```tsx
  const buttonRefs = useRef<Record<ProgressTabId, HTMLButtonElement | null>>({
    map: null,
    words: null,
    shape: null,
    fluency: null,
    history: null,
  });
```

- [ ] **Step 5: Run tests + typecheck to verify pass**

Run: `pnpm --filter @language-drill/web run test progress/_lib/use-tab-url-state.test.ts progress/_components/__tests__/progress-tabs.test.tsx`
Expected: PASS.
Run: `pnpm --filter @language-drill/web run typecheck`
Expected: PASS (no missing-key errors on the two `Record<ProgressTabId, …>`).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(dashboard)/progress/_lib/use-tab-url-state.ts" "apps/web/app/(dashboard)/progress/_components/progress-tabs.tsx" "apps/web/app/(dashboard)/progress/_lib/use-tab-url-state.test.ts" "apps/web/app/(dashboard)/progress/_components/__tests__/progress-tabs.test.tsx"
git commit -m "feat(progress): add 'words' tab to the progress tablist"
```

---

### Task 3: `WordsTab` — the coverage grid as a Progress tab body

Presentational component (data comes from props, mirroring `MapTab`/`ShapeTab`). Reuses the existing `VocabTopicCard` + `VocabList*` state components from the `vocab` feature.

**Files:**
- Create: `apps/web/app/(dashboard)/progress/_components/words-tab.tsx`
- Test: `apps/web/app/(dashboard)/progress/_components/__tests__/words-tab.test.tsx`

**Interfaces:**
- Produces: `WordsTab(props: { data: VocabTopicsResponse | undefined; isLoading: boolean; isError: boolean; onRetry: () => void })`. `VocabTopicsResponse` and `VocabTopicSummary` are exported from `@language-drill/api-client`.
- Consumes: `VocabTopicCard` (`../../vocab/_components/vocab-topic-card`), `VocabListLoading`/`VocabListError`/`VocabEmpty` (`../../vocab/_components/vocab-list-states`).

- [ ] **Step 1: Write the failing test (RED)**

Create `apps/web/app/(dashboard)/progress/_components/__tests__/words-tab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { VocabTopicSummary, VocabTopicsResponse } from '@language-drill/api-client';
import { WordsTab } from '../words-tab';

// next/link → plain anchor (jsdom); VocabTopicCard renders a <Link>.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function topic(o: Partial<VocabTopicSummary> & { umbrellaKey: string }): VocabTopicSummary {
  return {
    name: o.name ?? o.umbrellaKey,
    cefrLevel: o.cefrLevel ?? 'A1',
    wordCount: o.wordCount ?? 0,
    available: o.available ?? 0,
    practiced: o.practiced ?? 0,
    ...o,
  };
}

function loaded(topics: VocabTopicSummary[]): VocabTopicsResponse {
  return { topics };
}

const mockRetry = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WordsTab', () => {
  it('renders topic cards linking to the detail route', () => {
    render(
      <WordsTab
        data={loaded([
          topic({ umbrellaKey: 'es-a1-vocab-food-drink', name: 'Food and drink (A1)' }),
        ])}
        isLoading={false}
        isError={false}
        onRetry={mockRetry}
      />,
    );
    const link = screen.getByRole('link', { name: /food and drink/i });
    expect(link).toHaveAttribute('href', '/vocab/es-a1-vocab-food-drink');
  });

  it('shows the loading state', () => {
    render(<WordsTab data={undefined} isLoading isError={false} onRetry={mockRetry} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows the error state and wires retry', () => {
    render(<WordsTab data={undefined} isLoading={false} isError onRetry={mockRetry} />);
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(mockRetry).toHaveBeenCalled();
  });

  it('shows the empty state when there are no topics', () => {
    render(<WordsTab data={loaded([])} isLoading={false} isError={false} onRetry={mockRetry} />);
    expect(screen.getByText(/no vocab topics/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web run test progress/_components/__tests__/words-tab.test.tsx`
Expected: FAIL — `Cannot find module '../words-tab'`.

- [ ] **Step 3: Implement `words-tab.tsx` (GREEN)**

Create `apps/web/app/(dashboard)/progress/_components/words-tab.tsx`:

```tsx
'use client';

import type { VocabTopicsResponse } from '@language-drill/api-client';
import { VocabTopicCard } from '../../vocab/_components/vocab-topic-card';
import {
  VocabListLoading,
  VocabListError,
  VocabEmpty,
} from '../../vocab/_components/vocab-list-states';

type WordsTabProps = {
  data: VocabTopicsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
};

// The curated vocab-coverage grid, surfaced as a Progress mastery lens beside
// the grammar Map. Topic rows link to the standalone /vocab/[umbrellaKey]
// detail. Presentational — /progress owns the useVocabTopics query so it fires
// in parallel with the other tabs on mount.
export function WordsTab({ data, isLoading, isError, onRetry }: WordsTabProps) {
  if (isLoading) return <VocabListLoading />;
  if (isError) return <VocabListError onRetry={onRetry} />;
  if (!data || data.topics.length === 0) return <VocabEmpty />;
  return (
    <div className="mt-s-4 overflow-hidden rounded-lg border border-rule bg-card">
      {data.topics.map((topic) => (
        <VocabTopicCard key={topic.umbrellaKey} topic={topic} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web run test progress/_components/__tests__/words-tab.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/progress/_components/words-tab.tsx" "apps/web/app/(dashboard)/progress/_components/__tests__/words-tab.test.tsx"
git commit -m "feat(progress): add WordsTab coverage-grid component"
```

---

### Task 4: Wire `WordsTab` into `/progress` and delete the standalone `/vocab` index

**Files:**
- Modify: `apps/web/app/(dashboard)/progress/page.tsx`
- Test: `apps/web/app/(dashboard)/progress/page.test.tsx`
- Delete: `apps/web/app/(dashboard)/vocab/page.tsx`
- Delete: `apps/web/app/(dashboard)/vocab/page.test.tsx`

**Interfaces:**
- Consumes: `useVocabTopics({ fetchFn, language })` from `@language-drill/api-client` (returns `{ data, isLoading, isError, refetch }`); `WordsTab` from `./_components/words-tab`.
- Produces: `/progress?tab=words` renders the coverage grid. `/vocab` (exact) now 404s; `/vocab/[umbrellaKey]` is unaffected.

- [ ] **Step 1: Update the progress page test — mock `useVocabTopics` + add a wiring test (RED)**

In `apps/web/app/(dashboard)/progress/page.test.tsx`:

Add a mock fn declaration alongside the others:

```tsx
const mockUseVocabTopics = vi.fn();
```

Add the hook to the `@language-drill/api-client` mock object:

```tsx
  useVocabTopics: (...args: unknown[]) => mockUseVocabTopics(...args),
```

Add a default return inside `beforeEach` (after the other `mockUse*` defaults):

```tsx
  mockUseVocabTopics.mockReturnValue({
    data: { topics: [] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
```

Add a new test inside `describe('ProgressPage', …)`:

```tsx
  it('renders the words (vocab coverage) tab with topic rows when ?tab=words', () => {
    mockSearchParams = new URLSearchParams('tab=words');
    mockUseVocabTopics.mockReturnValue({
      data: {
        topics: [
          {
            umbrellaKey: 'es-a1-vocab-food-drink',
            name: 'Food and drink (A1)',
            cefrLevel: 'A1',
            wordCount: 30,
            available: 12,
            practiced: 5,
          },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderPage();

    const wordsTab = screen.getByRole('tab', { name: 'words' });
    expect(wordsTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Food and drink (A1)')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web run test progress/page.test.tsx`
Expected: FAIL — the words tab renders an empty panel (page has no `tab==='words'` branch yet), so `Food and drink (A1)` is absent. (The other progress tests already pass because the mock now provides `useVocabTopics`.)

- [ ] **Step 3: Wire the page (GREEN)**

In `apps/web/app/(dashboard)/progress/page.tsx`:

Add `useVocabTopics` to the `@language-drill/api-client` import list, and `WordsTab` to the local imports:

```tsx
import { WordsTab } from './_components/words-tab';
```

Add the query alongside the other parallel queries (near `const insights = useInsightsErrors(...)`):

```tsx
  const vocabTopics = useVocabTopics({ fetchFn, language: activeLanguage });
```

Add the tab panel branch immediately after the `{tab === 'map' && ( … )}` block:

```tsx
        {tab === 'words' && (
          <WordsTab
            data={vocabTopics.data}
            isLoading={vocabTopics.isLoading}
            isError={vocabTopics.isError}
            onRetry={() => {
              void vocabTopics.refetch();
            }}
          />
        )}
```

- [ ] **Step 4: Delete the standalone `/vocab` index page and its test**

```bash
git rm "apps/web/app/(dashboard)/vocab/page.tsx" "apps/web/app/(dashboard)/vocab/page.test.tsx"
```

(The topic-grid coverage now lives only in `WordsTab`; its behavior is covered by `words-tab.test.tsx`. `/vocab/[umbrellaKey]` and the `_components/` remain.)

- [ ] **Step 5: Run the progress tests to verify they pass**

Run: `pnpm --filter @language-drill/web run test progress/page.test.tsx`
Expected: PASS (existing tests + the new `?tab=words` test).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(dashboard)/progress/page.tsx" "apps/web/app/(dashboard)/progress/page.test.tsx"
git commit -m "feat(progress): wire WordsTab; delete standalone /vocab index"
```

---

### Task 5: Retarget the topic-detail back link to the words tab

**Files:**
- Modify: `apps/web/app/(dashboard)/vocab/[umbrellaKey]/page.tsx`
- Test: `apps/web/app/(dashboard)/vocab/[umbrellaKey]/page.test.tsx`

**Interfaces:**
- Produces: the detail page's back link now points to `/progress?tab=words` with visible text `← all topics` and `aria-label="Back to all topics"`, in all three render states (loading / error / loaded).

- [ ] **Step 1: Update the detail test expectations (RED)**

In `apps/web/app/(dashboard)/vocab/[umbrellaKey]/page.test.tsx`, change the three back-link assertions.

In `it('links back to the vocab topic list', …)`:

```tsx
    const back = screen.getByRole('link', { name: /back to all topics/i });
    expect(back).toHaveAttribute('href', '/progress?tab=words');
```

In `it('shows loading and error states', …)`, both back-link assertions become:

```tsx
    expect(
      screen.getByRole('link', { name: /back to all topics/i }),
    ).toHaveAttribute('href', '/progress?tab=words');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web run test "vocab/[umbrellaKey]/page.test.tsx"`
Expected: FAIL — link name is still "back to vocabulary coverage" / href `/vocab`.

- [ ] **Step 3: Update the back link (GREEN)**

In `apps/web/app/(dashboard)/vocab/[umbrellaKey]/page.tsx`, change the `backLink` element:

```tsx
  const backLink = (
    <Link
      href="/progress?tab=words"
      aria-label="Back to all topics"
      className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-[1.2px] text-ink-mute transition-colors hover:text-ink"
    >
      <span aria-hidden="true">&larr;</span> all topics
    </Link>
  );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web run test "vocab/[umbrellaKey]/page.test.tsx"`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/vocab/[umbrellaKey]/page.tsx" "apps/web/app/(dashboard)/vocab/[umbrellaKey]/page.test.tsx"
git commit -m "feat(vocab): point detail back link to the progress words tab"
```

---

### Task 6: Full gate, push, PR

**Files:** none (verification + delivery).

- [ ] **Step 1: Lint**

Run: `pnpm --filter @language-drill/web run lint`
Expected: no errors.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @language-drill/web run typecheck`
Expected: no errors.

- [ ] **Step 3: Full web test suite**

Run: `pnpm --filter @language-drill/web run test`
Expected: all files pass (nav, mobile-tab-bar, progress tabs, tab-url-state, words-tab, progress page, vocab detail). No orphan reference to the deleted `/vocab` page.

- [ ] **Step 4: Next build (catches routing/prerender issues from the deleted route)**

Run: `pnpm --filter @language-drill/web run build`
Expected: build succeeds; `/vocab` no longer in the route manifest, `/vocab/[umbrellaKey]` still present.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feat/vocab-nav-consolidation
```

Then open a PR (base `main`) via the `nikolaivanv`-pinned `gh` alias (`ghp pr create`), summarizing: coverage → Progress `words` tab, `/review` → "review", `/vocab` index deleted (detail route kept, back link retargeted), 7→6 nav destinations.

---

## Self-Review

**Spec coverage:**
- Nav: remove `/vocab`, rename `/review`, 7→6 → Task 1. ✓
- `VocabIcon` unused → removed in Task 1. ✓
- `words` tab id after `map`, URL-synced → Task 2. ✓
- Coverage grid as tab body (reuses `VocabTopicCard` + states) → Task 3. ✓
- Page wiring + parallel query + delete `/vocab` index → Task 4. ✓
- Keep `/vocab/[umbrellaKey]`; retarget back link to `/progress?tab=words`, "← all topics" → Task 5. ✓
- Test ripple (nav, mobile-tab-bar auto, progress-tabs, use-tab-url-state, `/vocab` page removed, detail back link, progress page mock) → Tasks 1–5. ✓
- Full gate incl. `build` → Task 6. ✓
- Non-goals (no API / read-model / new-language changes) — honored; no such tasks. ✓

**Placeholder scan:** none — every code/test step shows literal content.

**Type consistency:** `WordsTab` prop shape (`data/isLoading/isError/onRetry`) matches its call site in Task 4 and its test in Task 3. `PROGRESS_TAB_IDS` / `TAB_LABELS` / `buttonRefs` all gain `words` in the same commit (Task 2). `VocabTopicsResponse` / `VocabTopicSummary` are confirmed exports of `@language-drill/api-client`. Back-link href `/progress?tab=words` matches the tab id from Task 2.
