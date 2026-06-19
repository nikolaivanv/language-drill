# Debrief Grammar Points + Today Error-Driven Surfaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the debrief and today-page surfaces grammar-point-centric and honest: replace the noisy free-text topic chip on debrief review items with the grammar point, surface an error-driven "work on these" block on the home page from the `/insights/errors` spine, and stop the skill snapshot presenting untrained skills as "weakest".

**Architecture:** Server-side, resolve grammar-point display names (via `getGrammarPoint` from `@language-drill/db`) onto debrief items and `/insights/errors` themes — keeping curriculum lookups out of the web bundle. Client-side, the debrief review card renders the grammar point instead of `topicHint`; a new `useInsightsErrors` hook feeds a "work on these" block above the skill snapshot; and the skill snapshot partitions axes into trained vs. not-started so zero-evidence skills no longer sort to the top of "weakest first".

**Tech Stack:** TypeScript, Hono (AWS Lambda), Drizzle, Zod, TanStack Query, Next.js (App Router) + React, Vitest + Testing Library.

## Global Constraints

- The web app (`apps/web`) and `@language-drill/api-client` must **not** import `@language-drill/db` — curriculum/grammar-point name resolution happens server-side (in the Lambda routes) and is delivered as plain strings in the API response.
- This is decision **D5** from `docs/progress-feedback-redesign.md`: `topicHint` is removed from every user-facing surface. The debrief review chip is such a surface — replace it, do not keep both.
- Languages are uppercase (`TR`/`ES`/`DE`). The `Language` enum has a 4th member `EN` (source-only); learning-language UI uses ES/DE/TR.
- The "work on these" CTA links to the existing `/drill` hub (generic). Per-item **targeted** drilling (scoping a session to one grammar point) is a separate follow-on and must NOT be implied as working — do not render a per-item "drill this exact point" button.
- After editing `packages/db` or `packages/api-client` source, run `pnpm build` (turbo) before running dependent Lambda/web tests so dist reflects new exports.
- Before running the Lambda suite, `rm -rf infra/lambda/dist` (stale compiled `*.test.js` cause phantom failures).
- Test commands: `pnpm --filter @language-drill/lambda test`, `pnpm --filter @language-drill/api-client test`, `pnpm --filter @language-drill/web test`. Full gate before finishing: `pnpm lint && pnpm typecheck && pnpm test` from repo root.
- Do NOT run `pnpm db:migrate` locally (local `.env` → shared dev branch). No schema change is needed in this plan anyway.
- Git commit trailer (every commit): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Modify** `infra/lambda/src/lib/errors/recurring.ts` — add `grammarPointName?` to `RecurringErrorTheme`; add a pure `attachGrammarPointNames(themes, resolve)` helper.
- **Modify** `infra/lambda/src/lib/errors/recurring.test.ts` — tests for `attachGrammarPointNames`.
- **Modify** `infra/lambda/src/routes/insights.ts` — call `attachGrammarPointNames(themes, getGrammarPoint-based resolver)` before responding.
- **Modify** `infra/lambda/src/routes/sessions.ts` — attach `grammarPointName` to each debrief review item.
- **Modify** `packages/api-client/src/schemas/debrief.ts` — add `grammarPointName` to `DebriefItemSchema`.
- **Create** `packages/api-client/src/schemas/insights.ts` — `InsightsErrorsResponseSchema` + types.
- **Create** `packages/api-client/src/hooks/useInsights.ts` — `useInsightsErrors` hook.
- **Modify** `packages/api-client/src/index.ts` — export the new schema + hook.
- **Modify** `apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx` — render grammar-point chip instead of topic.
- **Modify** `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/review-item-card.test.tsx` — assert grammar point shown, topic not shown.
- **Create** `apps/web/app/(dashboard)/_components/work-on-these.tsx` — the error-driven block.
- **Create** `apps/web/app/(dashboard)/_components/__tests__/work-on-these.test.tsx` — its tests.
- **Modify** `apps/web/app/(dashboard)/home/page.tsx` — render `WorkOnThese` above the skill snapshot.
- **Modify** `apps/web/app/(dashboard)/_components/skill-snapshot-grid.tsx` — partition trained vs. not-started axes.
- **Modify** `apps/web/app/(dashboard)/_components/skill-row.tsx` — thin-evidence cue.
- **Modify** `apps/web/app/(dashboard)/_components/__tests__/skill-snapshot.test.tsx` — assertions for the partition + thin cue.

---

### Task 1: Backend — resolve grammar-point names on insights themes + debrief items

**Files:**
- Modify: `infra/lambda/src/lib/errors/recurring.ts`
- Modify: `infra/lambda/src/lib/errors/recurring.test.ts`
- Modify: `infra/lambda/src/routes/insights.ts`
- Modify: `infra/lambda/src/routes/sessions.ts` (the `GET /sessions/:id/debrief` per-item builder, ~lines 789–798)

**Interfaces:**
- Produces: `RecurringErrorTheme` now has `grammarPointName?: string | null`. New pure helper `attachGrammarPointNames(themes: RecurringErrorTheme[], resolve: (key: string | null) => string | null): RecurringErrorTheme[]` — sets `grammarPointName` on each theme via `resolve(theme.grammarPointKey)`. The `/sessions/:id/debrief` response items now include `grammarPointName: string | null`.

- [ ] **Step 1: Write the failing test for `attachGrammarPointNames`**

In `infra/lambda/src/lib/errors/recurring.test.ts`, add a new describe block (keep the existing `rankRecurringErrors` tests). Import `attachGrammarPointNames` alongside the existing import:

```typescript
import { rankRecurringErrors, attachGrammarPointNames, type RecurringErrorTheme } from './recurring';

describe('attachGrammarPointNames', () => {
  const theme = (over: Partial<RecurringErrorTheme> = {}): RecurringErrorTheme => ({
    grammarPointKey: 'tr-a1-locative',
    errorType: 'grammar',
    count: 2,
    majorCount: 1,
    lastOccurredAt: new Date('2026-06-19T00:00:00Z'),
    sample: { wrongText: 'pazarda', correction: 'pazara' },
    score: 1,
    ...over,
  });

  it('resolves each theme key to a display name', () => {
    const resolve = (k: string | null) => (k === 'tr-a1-locative' ? 'Locative case' : null);
    const out = attachGrammarPointNames([theme()], resolve);
    expect(out[0].grammarPointName).toBe('Locative case');
  });

  it('passes a null key through to the resolver and keeps null', () => {
    const resolve = (k: string | null) => (k === null ? null : 'x');
    const out = attachGrammarPointNames([theme({ grammarPointKey: null })], resolve);
    expect(out[0].grammarPointName).toBeNull();
  });

  it('does not mutate the input themes', () => {
    const input = [theme()];
    attachGrammarPointNames(input, () => 'Name');
    expect(input[0]).not.toHaveProperty('grammarPointName');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test recurring`
Expected: FAIL — `attachGrammarPointNames` is not exported.

- [ ] **Step 3: Implement the helper + extend the type**

In `infra/lambda/src/lib/errors/recurring.ts`: add `grammarPointName?: string | null;` to the `RecurringErrorTheme` interface (after `score`), and append this exported function at the end of the file:

```typescript
/**
 * Pure: attach a resolved display name to each theme using the injected
 * resolver (the route passes a getGrammarPoint-based resolver). Returns new
 * objects; does not mutate the input.
 */
export function attachGrammarPointNames(
  themes: RecurringErrorTheme[],
  resolve: (key: string | null) => string | null,
): RecurringErrorTheme[] {
  return themes.map((t) => ({ ...t, grammarPointName: resolve(t.grammarPointKey) }));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @language-drill/lambda test recurring`
Expected: PASS (existing `rankRecurringErrors` tests + 3 new ones).

- [ ] **Step 5: Wire the resolver into the insights route**

In `infra/lambda/src/routes/insights.ts`: import `getGrammarPoint` and `attachGrammarPointNames`, then apply the helper to the ranked themes before serialization. Read the file first (it's ~73 lines). Add to imports:

```typescript
import { errorObservations, getGrammarPoint } from '@language-drill/db';
import { rankRecurringErrors, attachGrammarPointNames, type RecurringErrorInput } from '../lib/errors/recurring';
```

Then change the themes-mapping block (currently maps `rankRecurringErrors(...)` to ISO-serialize `lastOccurredAt`) so names are attached first:

```typescript
const ranked = attachGrammarPointNames(
  rankRecurringErrors(inputs, now),
  (key) => (key ? (getGrammarPoint(key)?.name ?? null) : null),
);
const themes = ranked.map((t) => ({
  ...t,
  lastOccurredAt: t.lastOccurredAt.toISOString(),
}));
return c.json({ themes });
```

- [ ] **Step 6: Attach `grammarPointName` to debrief review items**

In `infra/lambda/src/routes/sessions.ts`, the `GET /sessions/:id/debrief` per-item builder returns `{ exerciseId, submissionId, type, grammarPointKey, contentJson, status, userAnswer, score, evaluation }` (~lines 789–798). `getGrammarPoint` is already imported (line 11). Add a resolved name to the returned object:

```typescript
    return {
      exerciseId,
      submissionId: row.history_id,
      type: row.type as ExerciseType,
      grammarPointKey: row.grammar_point_key,
      grammarPointName: row.grammar_point_key
        ? (getGrammarPoint(row.grammar_point_key)?.name ?? null)
        : null,
      contentJson,
      status,
      userAnswer,
      score,
      evaluation,
    };
```

- [ ] **Step 7: Verify typecheck + full Lambda suite**

Run: `pnpm --filter @language-drill/lambda typecheck && rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test`
Expected: PASS. (Existing debrief route tests should still pass; the new field is additive.)

- [ ] **Step 8: Commit**

```bash
git add infra/lambda/src/lib/errors/recurring.ts infra/lambda/src/lib/errors/recurring.test.ts infra/lambda/src/routes/insights.ts infra/lambda/src/routes/sessions.ts
git commit -m "$(printf 'feat(lambda): resolve grammar-point names on insights themes + debrief items\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: api-client — debrief schema field, insights schema + hook

**Files:**
- Modify: `packages/api-client/src/schemas/debrief.ts` (`DebriefItemSchema`, ~lines 20–42)
- Create: `packages/api-client/src/schemas/insights.ts`
- Create: `packages/api-client/src/schemas/insights.test.ts`
- Create: `packages/api-client/src/hooks/useInsights.ts`
- Modify: `packages/api-client/src/index.ts` (exports — hooks ~lines 170–175, schemas ~lines 47–60)

**Interfaces:**
- Consumes: the `fetchFn` pattern from existing hooks (`useProgressRadar` in `hooks/useProgress.ts`).
- Produces:
  - `DebriefItemSchema` gains `grammarPointName: z.string().nullable()`.
  - `InsightsErrorTheme` = `{ grammarPointKey: string | null; grammarPointName: string | null; errorType: string; count: number; majorCount: number; lastOccurredAt: string; sample: { wrongText: string; correction: string }; score: number }`.
  - `InsightsErrorsResponse` = `{ themes: InsightsErrorTheme[] }`.
  - `useInsightsErrors({ fetchFn, language, enabled? }): UseQueryResult<InsightsErrorsResponse, Error>` — queryKey `['insightsErrors', language]`, GET `/insights/errors?language=…`.

- [ ] **Step 1: Add `grammarPointName` to `DebriefItemSchema`**

In `packages/api-client/src/schemas/debrief.ts`, in `DebriefItemSchema` (next to `grammarPointKey: z.string().nullable()` at ~line 29), add:

```typescript
  grammarPointName: z.string().nullable(),
```

- [ ] **Step 2: Write the failing insights-schema test**

Create `packages/api-client/src/schemas/insights.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { InsightsErrorsResponseSchema } from './insights';

describe('InsightsErrorsResponseSchema', () => {
  const theme = {
    grammarPointKey: 'tr-a1-locative',
    grammarPointName: 'Locative case',
    errorType: 'grammar',
    count: 6,
    majorCount: 4,
    lastOccurredAt: '2026-06-19T00:00:00.000Z',
    sample: { wrongText: 'pazarda', correction: 'pazara' },
    score: 4.2,
  };

  it('parses a valid response', () => {
    const parsed = InsightsErrorsResponseSchema.parse({ themes: [theme] });
    expect(parsed.themes[0].grammarPointName).toBe('Locative case');
  });

  it('accepts null grammar point name/key', () => {
    const parsed = InsightsErrorsResponseSchema.parse({
      themes: [{ ...theme, grammarPointKey: null, grammarPointName: null }],
    });
    expect(parsed.themes[0].grammarPointKey).toBeNull();
  });

  it('rejects a missing sample', () => {
    const bad = { ...theme } as Record<string, unknown>;
    delete bad.sample;
    expect(() => InsightsErrorsResponseSchema.parse({ themes: [bad] })).toThrow();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @language-drill/api-client test insights`
Expected: FAIL — `Cannot find module './insights'`.

- [ ] **Step 4: Implement the insights schema**

Create `packages/api-client/src/schemas/insights.ts`:

```typescript
import { z } from 'zod';

export const InsightsErrorThemeSchema = z.object({
  grammarPointKey: z.string().nullable(),
  grammarPointName: z.string().nullable(),
  errorType: z.string(),
  count: z.number().int().min(0),
  majorCount: z.number().int().min(0),
  lastOccurredAt: z.string().datetime(),
  sample: z.object({
    wrongText: z.string(),
    correction: z.string(),
  }),
  score: z.number(),
});

export const InsightsErrorsResponseSchema = z.object({
  themes: z.array(InsightsErrorThemeSchema),
});

export type InsightsErrorTheme = z.infer<typeof InsightsErrorThemeSchema>;
export type InsightsErrorsResponse = z.infer<typeof InsightsErrorsResponseSchema>;
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @language-drill/api-client test insights`
Expected: PASS (3 assertions).

- [ ] **Step 6: Implement the hook**

Read `packages/api-client/src/hooks/useProgress.ts` to confirm the exact `fetchFn` param type and `UseQueryResult` import. Create `packages/api-client/src/hooks/useInsights.ts` mirroring it:

```typescript
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LearningLanguage } from '@language-drill/shared';
import {
  InsightsErrorsResponseSchema,
  type InsightsErrorsResponse,
} from '../schemas/insights';

const INSIGHTS_STALE_TIME_MS = 5 * 60 * 1000;

export interface UseInsightsErrorsParams {
  fetchFn: (path: string) => Promise<Response>;
  language: LearningLanguage;
  enabled?: boolean;
}

export function useInsightsErrors({
  fetchFn,
  language,
  enabled = true,
}: UseInsightsErrorsParams): UseQueryResult<InsightsErrorsResponse, Error> {
  return useQuery<InsightsErrorsResponse, Error>({
    queryKey: ['insightsErrors', language],
    queryFn: async () => {
      const response = await fetchFn(
        `/insights/errors?language=${encodeURIComponent(language)}`,
      );
      const json: unknown = await response.json();
      return InsightsErrorsResponseSchema.parse(json);
    },
    enabled,
    staleTime: INSIGHTS_STALE_TIME_MS,
  });
}
```

> If `useProgress.ts` types `fetchFn` differently (e.g. an imported `AuthenticatedFetch` type), use that exact type instead of the inline signature above — match the sibling hook.

- [ ] **Step 7: Export schema + hook from the barrel**

In `packages/api-client/src/index.ts`, add to the schema export group (near the progress schemas, ~lines 47–60):

```typescript
export {
  InsightsErrorThemeSchema,
  InsightsErrorsResponseSchema,
  type InsightsErrorTheme,
  type InsightsErrorsResponse,
} from './schemas/insights';
```

and to the hook export group (~lines 170–175):

```typescript
export { useInsightsErrors, type UseInsightsErrorsParams } from './hooks/useInsights';
```

- [ ] **Step 8: Verify typecheck + tests + build**

Run: `pnpm --filter @language-drill/api-client typecheck && pnpm --filter @language-drill/api-client test && pnpm build`
Expected: PASS. (`pnpm build` so dependent web typecheck/tests resolve the new exports.)

- [ ] **Step 9: Commit**

```bash
git add packages/api-client/src/schemas/debrief.ts packages/api-client/src/schemas/insights.ts packages/api-client/src/schemas/insights.test.ts packages/api-client/src/hooks/useInsights.ts packages/api-client/src/index.ts
git commit -m "$(printf 'feat(api-client): grammarPointName on debrief items + useInsightsErrors hook\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: Debrief review card — grammar point instead of topic

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx` (topic extraction ~lines 46–49, chip render ~lines 63–65)
- Modify: `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/review-item-card.test.tsx`

**Interfaces:**
- Consumes: `item.grammarPointName` (Task 2) and `item.grammarPointKey` from `DebriefItem`.

- [ ] **Step 1: Update the test first (RED)**

Read the existing `review-item-card.test.tsx`. Its fixture builder (`clozeItem()`, ~lines 41–60) sets `grammarPointKey: null` and a `contentJson.topicHint`. Update the fixture to also accept `grammarPointName`, and change the header-chrome test (~lines 86–108) so it:
- builds an item with `grammarPointName: 'Locative case'` and a `contentJson.topicHint: 'shopping'`,
- asserts `screen.getByText('Locative case')` is present,
- asserts `screen.queryByText('shopping')` is `null` (topic no longer rendered).

Concretely, in the fixture builder add `grammarPointName: null,` to the default object (alongside `grammarPointKey: null`), and replace the topic-chip assertion test body with:

```typescript
  it('renders the grammar point chip and not the topic', () => {
    render(
      <ReviewItemCard
        index={0}
        item={clozeItem({
          grammarPointKey: 'tr-a1-locative',
          grammarPointName: 'Locative case',
          contentJson: { topicHint: 'shopping' },
        })}
        fetchFn={fetchFn}
      />,
    );
    expect(screen.getByText('Locative case')).toBeInTheDocument();
    expect(screen.queryByText('shopping')).not.toBeInTheDocument();
  });
```

> Keep the rest of the test file intact. If `clozeItem` does not already accept a `contentJson` override, extend the builder's `overrides` spread to include it.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/web test review-item-card`
Expected: FAIL — "Locative case" not found / "shopping" still present (component still renders topic).

- [ ] **Step 3: Render the grammar point instead of the topic**

In `review-item-card.tsx`, remove the `topicHint` extraction (~lines 46–49) and replace the chip render (~lines 63–65) with a grammar-point chip. The chip shows `item.grammarPointName` (fallback to `item.grammarPointKey`); render nothing when both are null:

```tsx
{(() => {
  const grammar = item.grammarPointName ?? item.grammarPointKey;
  return grammar ? <Chip variant="default">{grammar}</Chip> : null;
})()}
<StatusChip status={item.status} />
```

Remove the now-unused `topic`/`content`/`topicHint` local variables. Keep the `StatusChip` and everything else unchanged.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @language-drill/web test review-item-card`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(dashboard\)/drill/debrief/_components/review-item-card.tsx apps/web/app/\(dashboard\)/drill/debrief/_components/__tests__/review-item-card.test.tsx
git commit -m "$(printf 'feat(web): debrief review card shows grammar point, not topic (D5)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: Today — "work on these" error-driven block

**Files:**
- Create: `apps/web/app/(dashboard)/_components/work-on-these.tsx`
- Create: `apps/web/app/(dashboard)/_components/__tests__/work-on-these.test.tsx`
- Modify: `apps/web/app/(dashboard)/home/page.tsx` (render above `SkillSnapshotGrid`, ~line 69–70)

**Interfaces:**
- Consumes: `useInsightsErrors` + `InsightsErrorsResponse`/`InsightsErrorTheme` (Task 2).
- Produces: `WorkOnThese` component. Renders nothing when there are no themes. Shows up to 3 themes (the API already limits to 5; the block shows the top 3), each: the grammar-point name (fallback to a humanized error type), the recurring slip `wrongText → correction`, and the count. A single "practice →" link to `/drill` (generic — NOT per-item targeted).

- [ ] **Step 1: Write the failing component test**

Read `apps/web/app/(dashboard)/_components/__tests__/skill-snapshot.test.tsx` first to mirror the render/fixture conventions. Create `apps/web/app/(dashboard)/_components/__tests__/work-on-these.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { InsightsErrorTheme } from '@language-drill/api-client';
import { WorkOnThese } from '../work-on-these';

const theme = (over: Partial<InsightsErrorTheme> = {}): InsightsErrorTheme => ({
  grammarPointKey: 'tr-a1-locative',
  grammarPointName: 'Locative case',
  errorType: 'grammar',
  count: 6,
  majorCount: 4,
  lastOccurredAt: '2026-06-19T00:00:00.000Z',
  sample: { wrongText: 'pazarda', correction: 'pazara' },
  score: 4.2,
  ...over,
});

describe('WorkOnThese', () => {
  it('renders nothing when there are no themes', () => {
    const { container } = render(<WorkOnThese themes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the grammar point, the slip, and the count', () => {
    render(<WorkOnThese themes={[theme()]} />);
    expect(screen.getByText('Locative case')).toBeInTheDocument();
    expect(screen.getByText(/pazarda/)).toBeInTheDocument();
    expect(screen.getByText(/pazara/)).toBeInTheDocument();
    expect(screen.getByText(/6×/)).toBeInTheDocument();
  });

  it('falls back to the error type when grammar point name is null', () => {
    render(<WorkOnThese themes={[theme({ grammarPointKey: null, grammarPointName: null })]} />);
    expect(screen.getByText(/grammar/i)).toBeInTheDocument();
  });

  it('caps the list at three themes', () => {
    const themes = ['a', 'b', 'c', 'd', 'e'].map((k, i) =>
      theme({ grammarPointKey: k, grammarPointName: `Point ${k}`, count: 10 - i }),
    );
    render(<WorkOnThese themes={themes} />);
    expect(screen.getByText('Point a')).toBeInTheDocument();
    expect(screen.queryByText('Point d')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/web test work-on-these`
Expected: FAIL — `Cannot find module '../work-on-these'`.

- [ ] **Step 3: Implement the presentational component**

Create `apps/web/app/(dashboard)/_components/work-on-these.tsx`. Keep it presentational (takes `themes` as a prop) so it's testable without a query provider; the page wires the hook (Step 5). Match the surrounding component styling conventions (read `skill-snapshot-grid.tsx` for the card/heading classes like `t-micro`, `t-display-m`, `Chip`, and `Link`):

```tsx
import Link from 'next/link';
import type { InsightsErrorTheme } from '@language-drill/api-client';

const MAX_ITEMS = 3;

function label(theme: InsightsErrorTheme): string {
  return theme.grammarPointName ?? theme.grammarPointKey ?? `${theme.errorType} errors`;
}

export function WorkOnThese({ themes }: { themes: InsightsErrorTheme[] }) {
  const items = themes.slice(0, MAX_ITEMS);
  if (items.length === 0) return null;

  return (
    <section>
      <div className="flex items-baseline justify-between gap-s-4">
        <h2 className="t-display-m">work on these</h2>
        <Link href="/drill" className="t-micro underline">
          practice →
        </Link>
      </div>
      <ul className="mt-s-3 flex flex-col gap-s-2">
        {items.map((t) => (
          <li key={`${t.grammarPointKey ?? '∅'}:${t.errorType}`} className="flex items-baseline justify-between gap-s-3">
            <span className="text-[14px] font-medium">{label(t)}</span>
            <span className="t-mono text-[12px] text-ink-soft">
              {t.sample.wrongText} → {t.sample.correction} · {t.count}×
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

> Use whatever spacing/typography tokens the sibling components use; the class names above mirror `skill-snapshot-grid.tsx`. If a token differs, match the real one — the test asserts text content, not classes.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @language-drill/web test work-on-these`
Expected: PASS (4 assertions).

- [ ] **Step 5: Wire the hook into the home page**

In `apps/web/app/(dashboard)/home/page.tsx`, read how `SkillSnapshotGrid` gets its data (it uses a progress hook with `fetchFn` + `language`). Add the `useInsightsErrors` hook the same way and render `WorkOnThese` above the skill snapshot (between the `<hr />` at ~line 69 and `SkillSnapshotGrid` at ~line 70). Pass `themes={insights.data?.themes ?? []}` so the component self-hides when empty or still loading:

```tsx
// near the other hooks:
const insights = useInsightsErrors({ fetchFn, language });

// in the JSX, above <SkillSnapshotGrid ... />:
<WorkOnThese themes={insights.data?.themes ?? []} />
```

Add the imports for `useInsightsErrors` (from `@language-drill/api-client`) and `WorkOnThese` (from `../_components/work-on-these` — match the existing relative-import style for sibling `_components`). Use the same `fetchFn` and `language` values already in scope for `SkillSnapshotGrid`.

- [ ] **Step 6: Verify typecheck + focused web tests**

Run: `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web test work-on-these`
Expected: PASS. (The page itself has no new unit test; the component is tested in isolation and the page wiring is covered by typecheck.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/\(dashboard\)/_components/work-on-these.tsx apps/web/app/\(dashboard\)/_components/__tests__/work-on-these.test.tsx apps/web/app/\(dashboard\)/home/page.tsx
git commit -m "$(printf 'feat(web): today-page work-on-these block from /insights/errors\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: Skill snapshot honesty — partition trained vs. not-started + thin-evidence cue

**Files:**
- Modify: `apps/web/app/(dashboard)/_components/skill-snapshot-grid.tsx` (sort ~lines 131–137, render ~lines 55–59, `isEmpty` ~line 128)
- Modify: `apps/web/app/(dashboard)/_components/skill-row.tsx` (render ~lines 22–56)
- Modify: `apps/web/app/(dashboard)/_components/__tests__/skill-snapshot.test.tsx`

**Interfaces:**
- Consumes: `RadarAxis.evidenceCount` (already on the schema). "Trained" = `evidenceCount > 0`. "Thin" = `evidenceCount > 0 && evidenceCount < THIN_EVIDENCE_THRESHOLD` (THIN_EVIDENCE_THRESHOLD = 5).

- [ ] **Step 1: Write failing tests for the partition + thin cue**

Read the existing `skill-snapshot.test.tsx` for the `axis()` and `radar()` fixture builders (they let you set `evidenceCount`). Add tests:

```tsx
describe('SkillSnapshotGrid — trained vs not-started', () => {
  it('excludes zero-evidence axes from the weakest-first list and shows them as not started', () => {
    const data = radar([
      axis('reading', 0, { evidenceCount: 0 }),
      axis('grammar', 0.84, { evidenceCount: 47 }),
      axis('writing', 0.85, { evidenceCount: 38 }),
    ]);
    render(<SkillSnapshotGrid {...baseGridProps} data={data} />);
    // 'reading' is presented as not started, not as a 0% weakest row
    expect(screen.getByText(/not started/i)).toBeInTheDocument();
    expect(screen.getByText('reading')).toBeInTheDocument();
    // a trained axis still shows its percentage
    expect(screen.getByText('84%')).toBeInTheDocument();
  });
});

describe('SkillRow — thin evidence', () => {
  it('marks a trained-but-thin axis (evidenceCount < 5)', () => {
    render(<SkillRow axis={axis('listening', 0.97, { evidenceCount: 4 })} />);
    expect(screen.getByText(/thin/i)).toBeInTheDocument();
  });

  it('does not mark a well-evidenced axis', () => {
    render(<SkillRow axis={axis('grammar', 0.84, { evidenceCount: 47 })} />);
    expect(screen.queryByText(/thin/i)).not.toBeInTheDocument();
  });
});
```

> If the existing `axis()` builder signature differs (e.g. `axis(key, mastery, evidenceCount)` positional rather than an options object), use its real signature — set `evidenceCount` whichever way the builder supports. If the builder defaults `evidenceCount` to a non-zero value, the existing tests keep passing.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @language-drill/web test skill-snapshot`
Expected: FAIL — no "not started" text; no "thin" marker.

- [ ] **Step 3: Partition axes in `skill-snapshot-grid.tsx`**

Read the file. Split the rendered axes into trained (`evidenceCount > 0`) and notStarted (`evidenceCount === 0`). Keep the existing `sortAxes` for the trained group only; render not-started axes as a muted group below with a "not started yet" label (no percentage / no bar). Replace the single `sortAxes(data).map(...)` render (~lines 55–59) with:

```tsx
{(() => {
  const trained = data.axes.filter((a) => a.evidenceCount > 0).sort(
    (a, b) => a.currentMastery - b.currentMastery || a.key.localeCompare(b.key),
  );
  const notStarted = data.axes.filter((a) => a.evidenceCount === 0);
  return (
    <>
      {trained.map((axis) => (
        <SkillRow key={axis.key} axis={axis} />
      ))}
      {notStarted.length > 0 && (
        <p className="t-micro text-ink-soft mt-s-2">
          not started yet · {notStarted.map((a) => a.label.toLowerCase()).join(' · ')}
        </p>
      )}
    </>
  );
})()}
```

Leave the existing `isEmpty(data)` early-return (all axes zero-evidence → existing empty state) unchanged — it still correctly handles the "nothing trained at all" case. Remove the now-unused standalone `sortAxes` function only if nothing else references it; otherwise leave it.

- [ ] **Step 4: Add the thin-evidence cue in `skill-row.tsx`**

Read the file. Add a constant and render a small "thin · N" marker next to the percentage when the axis is trained but thinly evidenced. Near the top of the module:

```tsx
const THIN_EVIDENCE_THRESHOLD = 5;
```

In the row render (next to the `{pct}%` span, ~line 41), add:

```tsx
{axis.evidenceCount > 0 && axis.evidenceCount < THIN_EVIDENCE_THRESHOLD && (
  <span className="t-mono text-[11px] text-ink-soft ml-s-1">thin · {axis.evidenceCount}</span>
)}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/web test skill-snapshot`
Expected: PASS (existing tests + the new partition/thin tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(dashboard\)/_components/skill-snapshot-grid.tsx apps/web/app/\(dashboard\)/_components/skill-row.tsx apps/web/app/\(dashboard\)/_components/__tests__/skill-snapshot.test.tsx
git commit -m "$(printf 'feat(web): skill snapshot separates not-started skills + flags thin evidence\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Final verification (whole plan)

- [ ] From repo root: `pnpm lint && pnpm typecheck && pnpm build && rm -rf infra/lambda/dist && pnpm test`
- [ ] Confirm zero failures. Report: X passed, Y failed.

---

## Self-review notes

- **Spec coverage:** Debrief topic→grammar point (Tasks 1,2,3 — completes D5 on that surface). Today "work on these" from `/insights/errors` (Tasks 1,2,4). Skill-snapshot honesty: untrained no longer sorts as weakest + thin-evidence cue (Task 5). The CTA is explicitly generic (`/drill`), with per-item targeting left to the separate targetable-drills follow-on — no fake targeting.
- **Type consistency:** `grammarPointName` is `string | null` everywhere (lambda item builder → `DebriefItemSchema` → review card; insights theme → `InsightsErrorThemeSchema` → `WorkOnThese`). `attachGrammarPointNames` resolver signature `(string | null) => string | null` matches the route's `(key) => key ? getGrammarPoint(key)?.name ?? null : null`. `evidenceCount` (already on `RadarAxisSchema`) drives both the partition (`> 0`) and the thin cue (`< 5`).
- **No web→db import:** all grammar-point name resolution is server-side (Task 1); the web only consumes resolved strings.
- **Deferred (named follow-ons, unchanged):** targetable drills (per-item targeted CTA), radar confidence-gating on `/progress` shape tab, Phase 3 per-error attribution, History tab.
