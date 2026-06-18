# Admin Langfuse Trace Deep-Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a config-gated "View traces in Langfuse ↗" deep-link to the pool-cell view and flagged-exercise items, opening the Langfuse trace list filtered to that cell's `cellKey`. Frontend-only, off by default.

**Architecture:** A web util (`cellKeyFor` + `buildLangfuseTracesUrl`) driven by a `NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE` env, a presentational `LangfuseTracesLink` component, wired into two existing components. No backend/api-client/db/CDK change.

**Tech Stack:** Next.js client components, TypeScript, Vitest + Testing Library, Tailwind.

---

## Context the implementer needs

Work from the worktree `/Users/seal/dev/language-drill/.claude/worktrees/feat-admin-langfuse-links` (branch `feat-admin-langfuse-links`). `cd` into it in every Bash call (the checked-out branch can silently flip). Paths contain a `(admin)` route-group segment — quote them.

**Dist gotcha:** if a test errors resolving `@language-drill/*`, run `pnpm build` at repo root.

**Single-file test command:** `pnpm --filter @language-drill/web test <path>`.

**Key facts (verified):**
- Traces are tagged `cellKey:<key>` (generate + validate) — `packages/ai/src/observability.ts` + `infra/lambda/src/generation/handler.ts`. The link filters a Langfuse trace list by that tag.
- Canonical cell key (`packages/db/src/lib/cell-key.ts`): `` `${language.toLowerCase()}:${cefrLevel.toLowerCase()}:${exerciseType.toLowerCase()}:${grammarPointKey}` `` — e.g. `tr:a1:cloze:tr-a1-vowel-harmony` (grammarPointKey NOT lowercased). The web util replicates this WITHOUT importing `@language-drill/db`.
- `PoolStatusItem` (`packages/api-client/src/schemas/pool-status.ts`): non-null `language`, `level`, `type`, `grammarPointKey`.
- `FlaggedExercise` (`packages/api-client/src/schemas/flagged.ts`): `language`, `level`, `type`, `grammarPointKey` all `z.string().nullable()`.
- `flagged-exercise-card.tsx` renders a header row `type · language · level · grammarPointKey` and uses link/text classes like `text-[13px]`/`text-ink`/`text-ink-soft`; `pool-cell-detail.tsx` has `text-[13px] text-ink underline` links (e.g. "View … approved exercises →"). Match these.
- `pool-cell-detail.test.tsx` mocks `@language-drill/api-client` (usePoolCell/useGenerateCell/useRevalidateCell). `flagged-exercise-card.test.tsx` renders the card with a literal `FlaggedExercise` fixture (no api mock).
- `NEXT_PUBLIC_*` vars: reference `process.env.NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE` as a full literal (so Next inlines it at build); in tests use `vi.stubEnv('NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE', ...)` + `vi.unstubAllEnvs()`.
- `.env.example` exists; Langfuse block is around lines 45-63. CLAUDE.md has a Vercel environment-variables table (search "Vercel environment variables").

---

## File structure

**Create:** `apps/web/lib/admin/langfuse.ts`, `apps/web/lib/admin/__tests__/langfuse.test.ts`, `apps/web/components/admin/langfuse-traces-link.tsx`, `apps/web/components/admin/__tests__/langfuse-traces-link.test.tsx`.
**Modify:** `apps/web/app/(admin)/admin/generation/_components/pool-cell-detail.tsx` (+ its test), `apps/web/app/(admin)/admin/moderation/_components/flagged-exercise-card.tsx` (+ its test), `.env.example`, `CLAUDE.md`.

---

## Task 1: util + link component (+ config docs)

**Files:** Create `apps/web/lib/admin/langfuse.ts`, `apps/web/lib/admin/__tests__/langfuse.test.ts`, `apps/web/components/admin/langfuse-traces-link.tsx`, `apps/web/components/admin/__tests__/langfuse-traces-link.test.tsx`; modify `.env.example`, `CLAUDE.md`.

- [ ] **Step 1: Write the failing util test**

`apps/web/lib/admin/__tests__/langfuse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { cellKeyFor, buildLangfuseTracesUrl } from '../langfuse';

describe('cellKeyFor', () => {
  it('builds the canonical lowercased cell key (grammarPoint not lowercased)', () => {
    expect(cellKeyFor({ language: 'TR', level: 'A1', type: 'cloze', grammarPoint: 'tr-a1-vowel-harmony' }))
      .toBe('tr:a1:cloze:tr-a1-vowel-harmony');
  });
  it('returns null when any part is missing or empty', () => {
    expect(cellKeyFor({ language: null, level: 'A1', type: 'cloze', grammarPoint: 'g' })).toBeNull();
    expect(cellKeyFor({ language: 'TR', level: '', type: 'cloze', grammarPoint: 'g' })).toBeNull();
    expect(cellKeyFor({ language: 'TR', level: 'A1', type: null, grammarPoint: 'g' })).toBeNull();
    expect(cellKeyFor({ language: 'TR', level: 'A1', type: 'cloze', grammarPoint: null })).toBeNull();
  });
});

describe('buildLangfuseTracesUrl', () => {
  const tmpl = 'https://cloud.langfuse.com/project/p1/traces?q={cellKey}';
  it('interpolates and URL-encodes the cell key', () => {
    expect(buildLangfuseTracesUrl('tr:a1:cloze:g', tmpl))
      .toBe('https://cloud.langfuse.com/project/p1/traces?q=tr%3Aa1%3Acloze%3Ag');
  });
  it('replaces every occurrence of the placeholder', () => {
    expect(buildLangfuseTracesUrl('a:b', 'x={cellKey}&y={cellKey}'))
      .toBe('x=a%3Ab&y=a%3Ab');
  });
  it('returns null when the template is undefined or lacks the placeholder', () => {
    expect(buildLangfuseTracesUrl('a:b', undefined)).toBeNull();
    expect(buildLangfuseTracesUrl('a:b', 'https://x/traces')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `cd <worktree> && pnpm --filter @language-drill/web test "lib/admin/__tests__/langfuse.test.ts"`

- [ ] **Step 3: Implement the util**

`apps/web/lib/admin/langfuse.ts`:
```ts
/**
 * Cell key for Langfuse trace filtering. Mirrors the canonical buildCellKey
 * (`@language-drill/db` lib/cell-key.ts) WITHOUT importing db into the web
 * bundle. Pinned by langfuse.test.ts — keep in sync if buildCellKey changes.
 * Returns null when any part is missing (flagged item fields are nullable).
 */
export function cellKeyFor(parts: {
  language: string | null;
  level: string | null;
  type: string | null;
  grammarPoint: string | null;
}): string | null {
  const { language, level, type, grammarPoint } = parts;
  if (!language || !level || !type || !grammarPoint) return null;
  return `${language.toLowerCase()}:${level.toLowerCase()}:${type.toLowerCase()}:${grammarPoint}`;
}

/**
 * Build a Langfuse traces-list URL by interpolating {cellKey} into the operator-
 * supplied template (`NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE`). Returns null
 * when the template is unset or has no {cellKey} placeholder, so the link is
 * hidden until configured. `template` is overridable for testing.
 */
export function buildLangfuseTracesUrl(
  cellKey: string,
  template: string | undefined = process.env.NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE,
): string | null {
  if (!template || !template.includes('{cellKey}')) return null;
  return template.replaceAll('{cellKey}', encodeURIComponent(cellKey));
}
```

- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @language-drill/web test "lib/admin/__tests__/langfuse.test.ts"`

- [ ] **Step 5: Write the failing component test**

`apps/web/components/admin/__tests__/langfuse-traces-link.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { LangfuseTracesLink } from '../langfuse-traces-link';

afterEach(() => vi.unstubAllEnvs());

describe('LangfuseTracesLink', () => {
  it('renders an external link with the interpolated href when configured', () => {
    vi.stubEnv('NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE', 'https://lf/traces?q={cellKey}');
    render(<LangfuseTracesLink cellKey="tr:a1:cloze:g" />);
    const link = screen.getByRole('link', { name: /traces in langfuse/i });
    expect(link).toHaveAttribute('href', 'https://lf/traces?q=tr%3Aa1%3Acloze%3Ag');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });
  it('renders nothing when cellKey is null', () => {
    vi.stubEnv('NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE', 'https://lf/traces?q={cellKey}');
    const { container } = render(<LangfuseTracesLink cellKey={null} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('renders nothing when the template env is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE', '');
    const { container } = render(<LangfuseTracesLink cellKey="tr:a1:cloze:g" />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 6: Run, expect FAIL** — `pnpm --filter @language-drill/web test "components/admin/__tests__/langfuse-traces-link.test.tsx"`

- [ ] **Step 7: Implement the component**

`apps/web/components/admin/langfuse-traces-link.tsx`:
```tsx
import { buildLangfuseTracesUrl } from '../../lib/admin/langfuse';

export function LangfuseTracesLink({ cellKey }: { cellKey: string | null }) {
  const href = cellKey ? buildLangfuseTracesUrl(cellKey) : null;
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-[13px] text-ink underline">
      View traces in Langfuse ↗
    </a>
  );
}
```
(Confirm the relative import path to `lib/admin/langfuse` from `components/admin/` and adjust if the repo uses a path alias like `@/`; match how sibling admin components import from `lib`/`components`. Use the link class names that match the sibling admin links.)

- [ ] **Step 8: Run, expect PASS** — `pnpm --filter @language-drill/web test "components/admin/__tests__/langfuse-traces-link.test.tsx"`

- [ ] **Step 9: Document the env var**

In `.env.example`, under the Langfuse block (~line 63), add:
```
# Optional (web, admin): Langfuse traces-list URL template for the admin
# "View traces in Langfuse" deep-link. Capture a tag-filtered traces URL from
# your Langfuse project UI (filter on tag cellKey=<any cell>), then replace the
# cell value with the literal {cellKey} placeholder. Unset → the link is hidden.
# NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE=https://cloud.langfuse.com/project/<projectId>/traces?filter=<...>{cellKey}<...>
```
In `CLAUDE.md`, add a row to the **Vercel environment variables** table:
```
| `NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE` | prod Langfuse traces-URL template (`{cellKey}` placeholder) | dev Langfuse traces-URL template | 
```
(Match the table's existing column layout; it's optional/off-by-default — note that if the table has a notes column.)

- [ ] **Step 10: Typecheck + commit**
- `pnpm --filter @language-drill/web typecheck` → clean (a known pre-existing `e2e/helpers/auth.ts` "@language-drill/db" worktree-dist error is acceptable only if it's the sole error)
```bash
git add apps/web/lib/admin/langfuse.ts "apps/web/lib/admin/__tests__/langfuse.test.ts" apps/web/components/admin/langfuse-traces-link.tsx "apps/web/components/admin/__tests__/langfuse-traces-link.test.tsx" .env.example CLAUDE.md
git commit -m "feat(admin): Langfuse traces deep-link util + component (config-gated)"
```

---

## Task 2: wire into the cell view + flagged exercise card

**Files:** Modify `apps/web/app/(admin)/admin/generation/_components/pool-cell-detail.tsx` + `__tests__/pool-cell-detail.test.tsx`; `apps/web/app/(admin)/admin/moderation/_components/flagged-exercise-card.tsx` + `__tests__/flagged-exercise-card.test.tsx`.

- [ ] **Step 1: Write the failing surface tests**

In `pool-cell-detail.test.tsx`, add a case (the file already mocks `usePoolCell` to provide detail; the item has language/level/type/grammarPointKey). Use `vi.stubEnv` + `vi.unstubAllEnvs()` (add an `afterEach` if not present):
```tsx
it('renders a Langfuse traces link when the template env is set', () => {
  vi.stubEnv('NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE', 'https://lf/traces?q={cellKey}');
  // ...render PoolCellDetail with the existing item fixture (mock usePoolCell as the other tests do)...
  const link = screen.getByRole('link', { name: /traces in langfuse/i });
  // item fixture is language X / level Y / type Z / grammarPointKey G → cellKey x:y:z:G
  expect(link).toHaveAttribute('href', expect.stringContaining('traces?q='));
});
it('omits the Langfuse link when the template env is unset', () => {
  vi.stubEnv('NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE', '');
  // ...render...
  expect(screen.queryByRole('link', { name: /traces in langfuse/i })).not.toBeInTheDocument();
});
```
Match the file's existing render/mock setup for `PoolCellDetail` (it needs `usePoolCell` mocked to return `detail.data`); assert the exact href using the test's known item fixture cell key.

In `flagged-exercise-card.test.tsx`, add:
```tsx
it('renders a Langfuse traces link for a complete item when configured', () => {
  vi.stubEnv('NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE', 'https://lf/traces?q={cellKey}');
  render(<FlaggedExerciseCard item={item} onResolve={vi.fn()} pending={false} demoted={false} />);
  // item: ES / A2 / cloze / obj-pronoun → cellKey es:a2:cloze:obj-pronoun
  expect(screen.getByRole('link', { name: /traces in langfuse/i }))
    .toHaveAttribute('href', 'https://lf/traces?q=es%3Aa2%3Acloze%3Aobj-pronoun');
});
it('omits the Langfuse link when grammarPointKey is missing', () => {
  vi.stubEnv('NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE', 'https://lf/traces?q={cellKey}');
  render(<FlaggedExerciseCard item={{ ...item, grammarPointKey: null }} onResolve={vi.fn()} pending={false} demoted={false} />);
  expect(screen.queryByRole('link', { name: /traces in langfuse/i })).not.toBeInTheDocument();
});
```
Add `import { vi } from 'vitest'` usage + an `afterEach(() => vi.unstubAllEnvs())` to both files if not already present.

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @language-drill/web test "app/(admin)/admin/generation/_components/__tests__/pool-cell-detail.test.tsx" "app/(admin)/admin/moderation/_components/__tests__/flagged-exercise-card.test.tsx"`

- [ ] **Step 3: Wire into `pool-cell-detail.tsx`**

Import the component + helper:
```tsx
import { LangfuseTracesLink } from '../../../../../components/admin/langfuse-traces-link';
import { cellKeyFor } from '../../../../../lib/admin/langfuse';
```
(Verify the exact relative depth / path alias against other imports in this file; adjust.) Render near the existing "View {approved} approved exercises →" link (e.g. directly after it):
```tsx
<LangfuseTracesLink cellKey={cellKeyFor({ language: item.language, level: item.level, type: item.type, grammarPoint: item.grammarPointKey })} />
```

- [ ] **Step 4: Wire into `flagged-exercise-card.tsx`**

Same imports (adjust relative path for this file's location). Render the link in/under the header row (after the `grammarPointKey` span or below the reason chips):
```tsx
<LangfuseTracesLink cellKey={cellKeyFor({ language: item.language, level: item.level, type: item.type, grammarPoint: item.grammarPointKey })} />
```

- [ ] **Step 5: Run, expect PASS** — `pnpm --filter @language-drill/web test "app/(admin)/admin/generation/_components/__tests__/pool-cell-detail.test.tsx" "app/(admin)/admin/moderation/_components/__tests__/flagged-exercise-card.test.tsx"`

- [ ] **Step 6: Typecheck + commit**
- `pnpm --filter @language-drill/web typecheck` → clean (modulo the known e2e/db artifact)
```bash
git add "apps/web/app/(admin)/admin/generation/_components/pool-cell-detail.tsx" "apps/web/app/(admin)/admin/generation/_components/__tests__/pool-cell-detail.test.tsx" "apps/web/app/(admin)/admin/moderation/_components/flagged-exercise-card.tsx" "apps/web/app/(admin)/admin/moderation/_components/__tests__/flagged-exercise-card.test.tsx"
git commit -m "feat(admin): wire Langfuse traces link into cell view + flagged exercise card"
```

---

## Task 3: Full verification

**Files:** none.

- [ ] **Step 1: Lint** — `pnpm lint` → no errors
- [ ] **Step 2: Repo typecheck** — `pnpm typecheck` → no errors (all packages)
- [ ] **Step 3: Full serial test suite** — `pnpm turbo run test --concurrency=1` → all packages pass
- [ ] **Step 4: Commit (only if a lint/format autofix changed files; else skip)**
```bash
git add -A && git commit -m "chore(admin): verification fixes" || echo "nothing to commit"
```

---

## Self-review notes

- **Spec coverage:** util `cellKeyFor` + `buildLangfuseTracesUrl` with template-env + null-guards (Task 1); `LangfuseTracesLink` config-gated component (Task 1); `.env.example` + CLAUDE.md docs (Task 1); wired into pool-cell-detail + flagged-exercise-card, NOT flagged-theory (Task 2); tests throughout + Task 3 gate. eval:gen links, per-item trace isolation, theory, and backend changes are all out of scope per the spec.
- **Type consistency:** `cellKeyFor` accepts the nullable shape (`string | null` fields) and returns `string | null`; `LangfuseTracesLink` takes `cellKey: string | null`; both surfaces pass `cellKeyFor({language, level, type, grammarPoint})`. The format `lang:level:type:grammarPoint` (lowercased except grammarPoint) matches the canonical `buildCellKey` and is pinned by the Task-1 test.
- **Known pitfalls flagged inline:** reference `process.env.NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE` as a literal (Next inlining) + `template` override param for tests; `vi.stubEnv`/`vi.unstubAllEnvs` for env-dependent tests; verify relative import paths / path alias; match sibling link class names; the known web-only e2e/db typecheck artifact.
- **No placeholders:** every code step is complete; the two surface tests note "match the file's existing render/mock setup" because the exact fixture wiring lives in those files — the assertions (link href / absence) are concrete.
```
