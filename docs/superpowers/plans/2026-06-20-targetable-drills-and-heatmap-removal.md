# Targetable Drills + Heatmap Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a drill be scoped to a single grammar point (with a mixed top-up when that point's pool is thin), make the home-page "work on these" rows launch those targeted drills, and remove the untargetable topic heatmap.

**Architecture:** `POST /sessions` gains an optional `grammarPointKey`; when present it selects from the (already-indexed) `(language, difficulty, type, grammarPointKey)` approved pool first, then tops up the remainder from the normal fresh pool (deduped) so sessions are never short. The web threads the point through a `/drill?start=quick&grammarPoint=<key>` link; each `WorkOnThese` row becomes such a link. The topic heatmap (a `/progress` tab + its route, hook, components, and aggregation) is deleted end-to-end.

**Tech Stack:** TypeScript, Hono (AWS Lambda), Drizzle, Zod, TanStack Query, Next.js (App Router) + React, Vitest + Testing Library.

## Global Constraints

- The web/api-client must NOT import `@language-drill/db`.
- "Approved" pool = `review_status IN ('auto-approved','manual-approved')` (via the existing `approvedStatusFilter`); targeted selection uses the same filter plus `audioReadyFilter`.
- A targeted session must NEVER be short: if the point has fewer approved exercises than `exerciseCount`, fill the remainder from the normal fresh pool (excluding already-picked ids). Targeted exercises come first.
- `grammarPointKey` on the session request is OPTIONAL — omitting it preserves today's exact behavior (single untargeted query).
- Per-item targeted drilling is the ONLY new targeting surface this round. Do NOT retarget `RecommendedDrillCard` (its "weakest" is a macro-skill axis, not a grammar point) and do NOT build a new grammar-point browse grid.
- Languages uppercase (TR/ES/DE). No DB schema/migration change (the column + index already exist).
- After editing `packages/db` or `packages/api-client` source, run `pnpm build` before dependent typecheck/tests. Before the Lambda suite, `rm -rf infra/lambda/dist`.
- The FULL gate is the real check (a shared-schema or page change can pass focused vitest while `tsc`/full suite fails): before finishing run `pnpm lint && pnpm typecheck && pnpm test` from the repo root and confirm real exit 0 (do not pipe through `tail`, which masks the exit code).
- Git commit trailer (every commit): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Create** `infra/lambda/src/lib/session-selection.ts` — pure `mergeSessionRows` (targeted-first, deduped, capped).
- **Create** `infra/lambda/src/lib/session-selection.test.ts` — its tests.
- **Modify** `infra/lambda/src/routes/sessions.ts` — `grammarPointKey` on the request schema + targeted-then-top-up selection.
- **Modify** `packages/api-client/src/hooks/useSession.ts` — `grammarPointKey` on `CreateSessionRequestSchema`.
- **Modify** `packages/api-client/src/hooks/__tests__/useSession.test.ts` (or sibling) — schema accepts/omits the field.
- **Modify** `apps/web/app/(dashboard)/drill/page.tsx` — parse `?grammarPoint=` and thread into the quick-drill config.
- **Modify** the drill page test — asserts the param reaches `createSession`.
- **Modify** `apps/web/app/(dashboard)/_components/work-on-these.tsx` — rows become targeted drill links.
- **Modify** `apps/web/app/(dashboard)/_components/__tests__/work-on-these.test.tsx` — link hrefs.
- **Delete** `apps/web/app/(dashboard)/progress/_components/heatmap-tab.tsx`, `heatmap-grid.tsx`, `hot-cold-summary.tsx` (+ their tests).
- **Modify** `apps/web/app/(dashboard)/progress/page.tsx`, `progress/_components/progress-tabs.tsx`, `progress/_lib/use-tab-url-state.ts` — drop the heatmap tab.
- **Modify** `packages/api-client/src/hooks/useProgress.ts` + `packages/api-client/src/index.ts` — remove `useProgressHeatmap` + its schema/exports.
- **Modify** `infra/lambda/src/routes/progress.ts` + `infra/lambda/src/lib/progress-aggregation.ts` (+ tests) — remove `GET /progress/heatmap`, `pivotCells`, `aggregateTopicMastery`.

---

### Task 1: Backend — grammar-point-targeted selection with mixed top-up

**Files:**
- Create: `infra/lambda/src/lib/session-selection.ts`
- Create: `infra/lambda/src/lib/session-selection.test.ts`
- Modify: `infra/lambda/src/routes/sessions.ts` (`CreateSessionRequestSchema` ~lines 50–55; selection query ~lines 93–106)

**Interfaces:**
- Produces: `mergeSessionRows<T extends { id: string }>(targeted: T[], topUp: T[], exerciseCount: number): T[]` — returns targeted rows first, then top-up rows whose id isn't already included, capped at `exerciseCount`. `POST /sessions` accepts optional `grammarPointKey: string`.

- [ ] **Step 1: Write the failing test for `mergeSessionRows`**

Create `infra/lambda/src/lib/session-selection.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { mergeSessionRows } from './session-selection';

const row = (id: string) => ({ id, n: id });

describe('mergeSessionRows', () => {
  it('returns targeted rows first, then top-up, capped at count', () => {
    const out = mergeSessionRows([row('a'), row('b')], [row('c'), row('d')], 3);
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops top-up rows whose id is already in targeted', () => {
    const out = mergeSessionRows([row('a'), row('b')], [row('b'), row('c')], 5);
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns just targeted when already at/over count', () => {
    const out = mergeSessionRows([row('a'), row('b'), row('c')], [row('d')], 2);
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('handles an empty top-up', () => {
    const out = mergeSessionRows([row('a')], [], 5);
    expect(out.map((r) => r.id)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test session-selection`
Expected: FAIL — `Cannot find module './session-selection'`.

- [ ] **Step 3: Implement the helper**

Create `infra/lambda/src/lib/session-selection.ts`:

```typescript
/**
 * Targeted-first, deduped, capped merge of a grammar-point-targeted exercise
 * set with a mixed top-up set. Targeted rows keep their order and priority;
 * top-up rows fill the remainder up to `exerciseCount`, skipping any id already
 * present so a session never repeats an exercise.
 */
export function mergeSessionRows<T extends { id: string }>(
  targeted: T[],
  topUp: T[],
  exerciseCount: number,
): T[] {
  const seen = new Set(targeted.map((r) => r.id));
  const merged = [...targeted];
  for (const r of topUp) {
    if (merged.length >= exerciseCount) break;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(r);
  }
  return merged.slice(0, exerciseCount);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @language-drill/lambda test session-selection`
Expected: PASS (4 assertions).

- [ ] **Step 5: Add `grammarPointKey` to the request schema**

In `infra/lambda/src/routes/sessions.ts`, in `CreateSessionRequestSchema` (~lines 50–55), add after `exerciseType`:

```typescript
  grammarPointKey: z.string().min(1).optional(),
```

- [ ] **Step 6: Implement targeted-then-top-up selection**

In `sessions.ts`: ensure `notInArray` is imported from `drizzle-orm` (add to the existing drizzle import if absent) and import `mergeSessionRows` from `../lib/session-selection`. Destructure `grammarPointKey` from the parsed body alongside `language`, `difficulty`, `exerciseCount`, `exerciseType`. Replace the current single selection query (~lines 93–106) with:

```typescript
  const baseWhere = [
    eq(exercisesTable.language, language),
    eq(exercisesTable.difficulty, difficulty),
    approvedStatusFilter(exercisesTable),
    audioReadyFilter(exercisesTable),
    ...(exerciseType ? [eq(exercisesTable.type, exerciseType)] : []),
  ];

  let rows;
  if (grammarPointKey) {
    const targeted = await db
      .select()
      .from(exercisesTable)
      .where(and(...baseWhere, eq(exercisesTable.grammarPointKey, grammarPointKey)))
      .orderBy(freshFirstOrderBy(userId))
      .limit(exerciseCount);

    if (targeted.length >= exerciseCount) {
      rows = targeted;
    } else {
      const targetedIds = targeted.map((r) => r.id);
      const topUpWhere = targetedIds.length
        ? [...baseWhere, notInArray(exercisesTable.id, targetedIds)]
        : baseWhere;
      const topUp = await db
        .select()
        .from(exercisesTable)
        .where(and(...topUpWhere))
        .orderBy(freshFirstOrderBy(userId))
        .limit(exerciseCount - targeted.length);
      rows = mergeSessionRows(targeted, topUp, exerciseCount);
    }
  } else {
    rows = await db
      .select()
      .from(exercisesTable)
      .where(and(...baseWhere))
      .orderBy(freshFirstOrderBy(userId))
      .limit(exerciseCount);
  }
```

> Read the real ~93–106 block first — keep whatever variable name the rest of the handler uses for the selected rows (the example uses `rows`). The untargeted `else` branch must be byte-equivalent to today's query so existing behavior is unchanged.

- [ ] **Step 7: Verify typecheck + full Lambda suite**

Run: `pnpm --filter @language-drill/lambda typecheck && rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test`
Expected: PASS. (Existing session-creation route tests pass unchanged — the optional field defaults to untargeted; the new merge logic is unit-tested.)

- [ ] **Step 8: Commit**

```bash
git add infra/lambda/src/lib/session-selection.ts infra/lambda/src/lib/session-selection.test.ts infra/lambda/src/routes/sessions.ts
git commit -m "$(printf 'feat(lambda): grammar-point-targeted session selection with mixed top-up\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: api-client — `grammarPointKey` on the session request

**Files:**
- Modify: `packages/api-client/src/hooks/useSession.ts` (`CreateSessionRequestSchema` ~lines 6–13)
- Modify: the existing useSession test file if present (search `packages/api-client/src` for `useSession.test` / a CreateSessionRequest schema test); otherwise add a small schema test in a sibling `__tests__/useSession.test.ts`.

**Interfaces:**
- Produces: `CreateSessionRequestSchema` (and the inferred `CreateSessionRequest` type) now has optional `grammarPointKey?: string`.

- [ ] **Step 1: Write/extend the failing schema test**

Locate the api-client test that imports `CreateSessionRequestSchema` (or create `packages/api-client/src/hooks/__tests__/useSession.test.ts`). Add:

```typescript
import { describe, expect, it } from 'vitest';
import { CreateSessionRequestSchema } from '../useSession';
import { Language, CefrLevel } from '@language-drill/shared';

describe('CreateSessionRequestSchema · grammarPointKey', () => {
  const base = { language: Language.TR, difficulty: CefrLevel.A1, exerciseCount: 5 };

  it('accepts a grammarPointKey', () => {
    const parsed = CreateSessionRequestSchema.parse({ ...base, grammarPointKey: 'tr-a1-locative' });
    expect(parsed.grammarPointKey).toBe('tr-a1-locative');
  });

  it('is optional (valid when omitted)', () => {
    const parsed = CreateSessionRequestSchema.parse(base);
    expect(parsed.grammarPointKey).toBeUndefined();
  });
});
```

> Match the real import path for `CreateSessionRequestSchema` (the Explore found it in `packages/api-client/src/hooks/useSession.ts`; if a sibling test dir differs, mirror the existing one).

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/api-client test useSession`
Expected: FAIL — `grammarPointKey` not in the parsed object (schema lacks the field).

- [ ] **Step 3: Add the field**

In `packages/api-client/src/hooks/useSession.ts`, in `CreateSessionRequestSchema`, add after `exerciseType`:

```typescript
  grammarPointKey: z.string().min(1).optional(),
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @language-drill/api-client test useSession`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
pnpm build
git add packages/api-client/src/hooks/useSession.ts packages/api-client/src/hooks/__tests__/useSession.test.ts
git commit -m "$(printf 'feat(api-client): optional grammarPointKey on CreateSessionRequest\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

> If you extended an existing test file rather than creating one, stage that path instead.

---

### Task 3: Web — `/drill` reads `?grammarPoint=` and targets the quick drill

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/page.tsx` (param parse ~lines 78–86; session `config` ~lines 151/159)
- Modify: the drill page test (search `apps/web/app/(dashboard)/drill` for `page.test.tsx`)

**Interfaces:**
- Consumes: `grammarPointKey` on the session config (Task 2).
- Produces: when the URL has `?start=quick&grammarPoint=<key>`, the created session config includes `grammarPointKey: <key>`. Dictation and untargeted quick drills are unaffected.

- [ ] **Step 1: Add a failing test**

Read the existing drill `page.test.tsx` (it mocks `useCreateSession` / `useSession`). Add a test asserting that rendering the page with search params `start=quick&grammarPoint=tr-a1-locative` calls the create-session mutation with `grammarPointKey: 'tr-a1-locative'`. Mirror the file's existing mock/render setup; the assertion shape:

```typescript
expect(mockMutate).toHaveBeenCalledWith(
  expect.objectContaining({ grammarPointKey: 'tr-a1-locative' }),
  expect.anything(),
);
```

> Use the file's real mock handle for the mutation (e.g. `mockMutate` / the `useCreateSession` mock's `.mutate`). If the page reads search params via a mocked `useSearchParams`, set it to return `start=quick&grammarPoint=tr-a1-locative`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/web test "drill/page"`
Expected: FAIL — `grammarPointKey` not present in the mutate call.

- [ ] **Step 3: Parse the param and thread it into the config**

In `drill/page.tsx`, alongside the existing `startIntent`/`resumeId` param parsing (~lines 78–86), add:

```typescript
const [grammarPointKey] = useState<string | null>(() => {
  const g = searchParams.get('grammarPoint');
  return g && g.length > 0 ? g : null;
});
```

Then, in the quick-drill branch of the session `config` (the non-dictation branch ~line 159), include the key when present:

```typescript
      : {
          language: activeLanguage,
          difficulty,
          exerciseCount: DEFAULT_EXERCISE_COUNT,
          ...(grammarPointKey ? { grammarPointKey } : {}),
        };
```

Leave the dictation branch unchanged. (Targeting only applies to the quick-drill path.)

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @language-drill/web test "drill/page"`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @language-drill/web typecheck`
Then:

```bash
git add apps/web/app/\(dashboard\)/drill/page.tsx apps/web/app/\(dashboard\)/drill/page.test.tsx
git commit -m "$(printf 'feat(web): /drill targets a grammar point via ?grammarPoint=\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: Web — `WorkOnThese` rows launch targeted drills

**Files:**
- Modify: `apps/web/app/(dashboard)/_components/work-on-these.tsx`
- Modify: `apps/web/app/(dashboard)/_components/__tests__/work-on-these.test.tsx`

**Interfaces:**
- Consumes: `/drill?start=quick&grammarPoint=<key>` (Task 3); `InsightsErrorTheme.grammarPointKey`.
- Produces: each row with a non-null `grammarPointKey` is a link to its targeted drill; rows with a null `grammarPointKey` render as plain (non-link) text. The standalone header "practice →" link is removed (the rows are the CTAs now).

- [ ] **Step 1: Update the test first (RED)**

In `work-on-these.test.tsx`, add/adjust tests so they assert:
- a row with `grammarPointKey: 'tr-a1-locative'` renders a link whose `href` is `/drill?start=quick&grammarPoint=tr-a1-locative`,
- a row with `grammarPointKey: null` renders its label but NOT as a link (no anchor),
- the old standalone "practice →" header link is gone.

```typescript
  it('links each row to a drill targeted at its grammar point', () => {
    render(<WorkOnThese themes={[theme({ grammarPointKey: 'tr-a1-locative', grammarPointName: 'Locative case' })]} />);
    const link = screen.getByRole('link', { name: /Locative case/i });
    expect(link).toHaveAttribute('href', '/drill?start=quick&grammarPoint=tr-a1-locative');
  });

  it('renders a null-grammar-point row as plain text, not a link', () => {
    render(<WorkOnThese themes={[theme({ grammarPointKey: null, grammarPointName: null })]} />);
    expect(screen.queryByRole('link', { name: /grammar errors/i })).not.toBeInTheDocument();
    expect(screen.getByText('grammar errors')).toBeInTheDocument();
  });
```

Remove any existing assertion that depends on the old header "practice →" link.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/web test work-on-these`
Expected: FAIL — rows aren't links yet.

- [ ] **Step 3: Make rows into targeted links**

In `work-on-these.tsx`, remove the standalone header `<Link href="/drill">practice →</Link>`. Wrap each item's content in a `next/link` when `t.grammarPointKey` is non-null, pointing at the targeted drill; otherwise render the same content without a link. Keep `label(t)`, the slip, and the count. Example list body:

```tsx
{items.map((t) => {
  const inner = (
    <span className="flex items-baseline justify-between gap-s-3">
      <span className="text-[14px] font-medium">{label(t)}</span>
      <span className="t-mono text-[12px] text-ink-soft">
        {t.sample.wrongText} → {t.sample.correction} · {t.count}×
      </span>
    </span>
  );
  const key = `${t.grammarPointKey ?? '∅'}:${t.errorType}`;
  return (
    <li key={key}>
      {t.grammarPointKey ? (
        <Link
          href={`/drill?start=quick&grammarPoint=${encodeURIComponent(t.grammarPointKey)}`}
          className="block hover:text-accent"
        >
          {inner}
        </Link>
      ) : (
        inner
      )}
    </li>
  );
})}
```

Keep the section heading "work on these" (drop only the separate practice link). Match the surrounding spacing tokens.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @language-drill/web test work-on-these`
Expected: PASS (existing render tests + the two new link tests).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @language-drill/web typecheck`
Then:

```bash
git add apps/web/app/\(dashboard\)/_components/work-on-these.tsx apps/web/app/\(dashboard\)/_components/__tests__/work-on-these.test.tsx
git commit -m "$(printf 'feat(web): work-on-these rows launch grammar-point-targeted drills\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: Web — remove the heatmap tab

**Files:**
- Delete: `apps/web/app/(dashboard)/progress/_components/heatmap-tab.tsx`, `heatmap-grid.tsx`, `hot-cold-summary.tsx`, and any of their `__tests__` files.
- Modify: `apps/web/app/(dashboard)/progress/page.tsx` (remove the `useProgressHeatmap` import + call ~lines 9/32 and the `tab === 'heatmap'` panel ~lines 72–81).
- Modify: `apps/web/app/(dashboard)/progress/_components/progress-tabs.tsx` (remove `heatmap: 'practice heatmap'` from `TAB_LABELS` ~lines 22–27).
- Modify: `apps/web/app/(dashboard)/progress/_lib/use-tab-url-state.ts` (remove `'heatmap'` from `PROGRESS_TAB_IDS` ~line 13; ensure an unknown/legacy `?tab=heatmap` URL falls back to the default `'shape'`).

**Interfaces:**
- Produces: `/progress` has three tabs — `shape`, `fluency`, `history`. `useProgressHeatmap` is no longer called from the web (it is removed from api-client in Task 6).

- [ ] **Step 1: Remove the tab id + label, verify fallback**

Read `use-tab-url-state.ts`. Remove `'heatmap'` from `PROGRESS_TAB_IDS`. Confirm the hook validates the URL `?tab=` against `PROGRESS_TAB_IDS` and falls back to the first/default id when it doesn't match (so a stale `?tab=heatmap` link resolves to `shape`). If it does NOT already guard, add a guard so an unknown id returns the default. Remove the `heatmap` entry from `TAB_LABELS` in `progress-tabs.tsx`.

- [ ] **Step 2: Remove the heatmap usage from the progress page**

In `progress/page.tsx`: delete the `HeatmapTab` import, the `const heatmap = useProgressHeatmap(...)` call, and the entire `{tab === 'heatmap' && (<HeatmapTab .../>)}` panel. Leave `shape`, `fluency`, `history` panels intact.

- [ ] **Step 3: Delete the heatmap components + their tests**

Delete `heatmap-tab.tsx`, `heatmap-grid.tsx`, `hot-cold-summary.tsx` and any `__tests__/heatmap-*.test.tsx` / `hot-cold-summary.test.tsx`. Then grep to confirm nothing else imports them:

```bash
grep -rn "heatmap-tab\|heatmap-grid\|hot-cold-summary\|HeatmapTab\|HeatmapGrid\|HotColdSummary" apps/web/app
```
Expected: no matches (other than, possibly, the now-removed lines you're deleting). If `useProgressHeatmap` is still imported anywhere in `apps/web`, that's a leftover — remove it.

- [ ] **Step 4: Verify typecheck + progress tests**

Run: `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web test progress`
Expected: PASS. (The web still imports `useProgressHeatmap`'s symbol? No — all web usages removed. The api-client still exports it until Task 6; that's fine.)

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/app/\(dashboard\)/progress
git commit -m "$(printf 'feat(web): remove the practice heatmap tab\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

> `git add -A` is scoped to the progress directory here so the deletions are staged; do not widen it.

---

### Task 6: api-client + Lambda — remove the heatmap hook, route, and aggregation

**Files:**
- Modify: `packages/api-client/src/hooks/useProgress.ts` (remove `useProgressHeatmap` ~lines 46–69 + its response schema/types if local) and `packages/api-client/src/index.ts` (remove its exports).
- Modify: `infra/lambda/src/routes/progress.ts` (remove `GET /progress/heatmap` ~lines 123–208).
- Modify: `infra/lambda/src/lib/progress-aggregation.ts` (remove `pivotCells` ~line 261 and `aggregateTopicMastery` ~line 282) and any test asserting them (`progress-aggregation.test.ts`).

**Interfaces:**
- Produces: no `/progress/heatmap` route; no `useProgressHeatmap` export; the radar path (`aggregateRadar`, `aggregateAxisMastery`, `axisForExerciseType`, `recencyWeight`, `difficultyWeight`, `RADAR_AXIS_ORDER`) is untouched.

- [ ] **Step 1: Remove the api-client hook + exports**

In `useProgress.ts`, delete the `useProgressHeatmap` function and any heatmap-only schema/types defined in that file (`ProgressHeatmapResponseSchema`, `HeatmapTopic`, `UseProgressHeatmapParams`, etc. — only the heatmap ones; keep the radar exports). In `packages/api-client/src/index.ts`, remove the corresponding `useProgressHeatmap` / heatmap-schema / heatmap-type exports. Grep to confirm none remain referenced:

```bash
grep -rn "useProgressHeatmap\|ProgressHeatmap\|HeatmapTopic" packages apps infra
```
Expected: no matches.

- [ ] **Step 2: Remove the Lambda route + aggregation helpers**

In `infra/lambda/src/routes/progress.ts`, delete the `GET /progress/heatmap` handler (and any heatmap-only query-schema/imports it alone used — keep anything shared with `/progress/radar`). In `progress-aggregation.ts`, delete `pivotCells` and `aggregateTopicMastery` and any heatmap-only constants they alone use; delete the corresponding cases in `progress-aggregation.test.ts`. Grep:

```bash
grep -rn "pivotCells\|aggregateTopicMastery\|/progress/heatmap" infra
```
Expected: no matches.

- [ ] **Step 3: Verify builds + full suites**

Run:
```bash
pnpm build
pnpm --filter @language-drill/api-client test && pnpm --filter @language-drill/api-client typecheck
rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test && pnpm --filter @language-drill/lambda typecheck
pnpm --filter @language-drill/web typecheck
```
Expected: all PASS (web typecheck confirms nothing in the app still imports the removed hook).

- [ ] **Step 4: Commit**

```bash
git add packages/api-client/src/hooks/useProgress.ts packages/api-client/src/index.ts infra/lambda/src/routes/progress.ts infra/lambda/src/lib/progress-aggregation.ts infra/lambda/src/lib/progress-aggregation.test.ts
git commit -m "$(printf 'feat: remove heatmap hook, route, and topic aggregation\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Final verification (whole plan)

- [ ] From repo root, capturing real exit codes (do NOT pipe through `tail`):
  `rm -rf infra/lambda/dist; pnpm lint; echo "lint=$?"; pnpm typecheck; echo "tc=$?"; pnpm test; echo "test=$?"`
- [ ] Confirm `lint=0 tc=0 test=0`. Report X passed / Y failed.
- [ ] Grep the whole repo for heatmap leftovers: `grep -rn "heatmap\|HotCold\|pivotCells\|aggregateTopicMastery" apps packages infra | grep -v node_modules` — expect only incidental matches (e.g. `topicHint` in generation, which stays per D5), no live heatmap wiring.

---

## Self-review notes

- **Spec coverage:** targeted selection + mixed top-up (Task 1, top-up per the "never short" constraint); request plumbing (Tasks 2–3); tappable work-on-these rows (Task 4); heatmap removed end-to-end (Tasks 5–6). `RecommendedDrillCard` deliberately untouched (its weakest is a macro-skill, not a grammar point). No new browse grid (out of scope per the decision).
- **Type consistency:** `grammarPointKey` is `string` (optional) on both the lambda `CreateSessionRequestSchema` and the api-client one; the web sends it only when non-null; `mergeSessionRows` is generic over `{ id: string }` so it works on the Drizzle row type. The targeted link format `/drill?start=quick&grammarPoint=<encoded key>` is produced in Task 4 and parsed in Task 3 — same param name `grammarPoint`.
- **Never-short guarantee:** Task 1 tops up from the untargeted pool excluding already-picked ids; `mergeSessionRows` caps and dedups. A point with zero approved exercises yields an all-mixed session (no error, no empty session).
- **Deferred (unchanged):** `RecommendedDrillCard` targeting (needs weakest-grammar-point data), a browsable grammar mastery grid, radar confidence-gating on `/progress`, Phase 3 per-error attribution, History tab, vocab-review number cleanup.
