# Public Theory Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish all 312 approved theory topics as server-rendered, indexable public pages at `/spanish/grammar` + `/spanish/grammar/<topic-id>` (and `/german`, `/turkish`), each funnelling into the existing no-signup drill where one exists.

**Architecture:** Two new endpoints on the existing unauthenticated `/public/*` Hono router read the same approved-status-filtered queries the authenticated theory router uses, extracted into a shared module so the filter cannot drift. The web side is React Server Components that call `renderTheoryTopicJson` — a pure, hookless function — so the entire article is emitted as HTML with no client JS, cached by ISR for an hour. No CDK change: `GET /public/{proxy+}` is already authorizer-free and throttled.

**Tech Stack:** Hono on AWS Lambda, Drizzle ORM + Neon Postgres, Next.js App Router (RSC), Zod, TanStack Query (not used on these pages — they are server-rendered), Vitest, Testing Library, Playwright, Tailwind v4 `@theme` tokens.

**Spec:** `docs/superpowers/specs/2026-10-04-public-theory-pages-design.md`

## Global Constraints

- **URL shape is `/<language-name>/grammar/<topic-id>`** — `/spanish`, `/german`, `/turkish`. Never `/es/`. The slug is the raw `theory_topics.topic_id`, CEFR prefix included (`a2-ser-vs-estar`).
- **Approved means `review_status IN ('auto-approved','manual-approved')`.** Every theory and exercise read on the public surface filters on it. No exceptions.
- **The authenticated `GET /theory/:lang` and `GET /theory/:lang/:topicId` wire contracts must not change.** Their responses stay byte-identical; `infra/lambda/src/routes/theory.test.ts` must stay green untouched.
- **`parseTheoryTopicJson` is the only validator of the article taxonomy.** Do not write a second Zod schema for `TheoryBlockJson` — Zod validates the response *envelope* only.
- **No client JS may be required to read an article.** The `<h1>`, prose and related links must be present in the server HTML.
- **Public-page error policy:** API 404 → `notFound()`. API 5xx / non-JSON / network failure → **throw**. Never a 404 for a transient failure.
- **Quick-check rows must be an explicit field pick**, never a DB row passed through, and must go through `stripWriterOnlyContent`.
- **Tailwind v4 tokens:** `--color-*`, `--radius-*`, `--font-*`, `--shadow-*`. Radius tokens never take a directional prefix.
- **Pre-push gate:** `pnpm lint && pnpm typecheck && pnpm test` from the repo root, zero failures.
- Package-level `tsconfig.json` in `packages/*` excludes `**/*.test.ts`, so a type annotation in a test file there is documentation, not a check. The full `pnpm test` is the real gate.

---

## File Structure

**Lambda (API)**

| File | Responsibility |
|---|---|
| `infra/lambda/src/lib/theory-queries.ts` *(new)* | `theory_topics` reads: approved list, approved single topic, related-topic approval filter. The single home of the approved-status filter. |
| `infra/lambda/src/lib/theory-practice.ts` *(new)* | `exercises` reads that answer "what practice exists for this theory topic": conjugation-drill availability, quick-check row selection. |
| `infra/lambda/src/routes/theory.ts` *(modify)* | Delegates to `theory-queries.ts`. No behaviour change. |
| `infra/lambda/src/routes/public.ts` *(modify)* | Adds `GET /public/theory/:lang` and `GET /public/theory/:lang/:topicId`. |

**Shared / api-client**

| File | Responsibility |
|---|---|
| `packages/shared/src/public-levels.ts` *(new)* | `PublicLanguage`, `PublicLevel`, `PUBLIC_LEVELS_BY_LANGUAGE` — moved from api-client so the Lambda can read them. |
| `packages/api-client/src/schemas/theory-public.ts` *(new)* | Zod schemas for the two public theory responses (envelope only). |

**Web**

| File | Responsibility |
|---|---|
| `apps/web/lib/public-paths.ts` *(new)* | `LANDING_PATH`, `grammarIndexHref`, `grammarTopicHref`, `tryFormsHref`. One source for public URLs. |
| `apps/web/lib/public-theory.ts` *(new)* | Server-side fetchers + the notFound/throw policy. |
| `apps/web/components/public/grammar/grammar-index.tsx` *(new)* | The hub, grouped by CEFR. Server component. |
| `apps/web/components/public/grammar/grammar-index-search.tsx` *(new)* | Client island: filters the already-rendered rows. |
| `apps/web/components/public/grammar/grammar-topic.tsx` *(new)* | The topic page. Server component. |
| `apps/web/components/public/grammar/topic-toc.tsx` *(new)* | Anchor TOC with scroll-spy. Client, but renders real anchors so SSR output carries them. |
| `apps/web/components/public/grammar/quick-check.tsx` *(new)* | Client island: three cloze items, graded locally. |
| `apps/web/components/public/grammar/practice-rail.tsx` *(new)* | Drill card (conditional) + sign-up box. Server. |
| `apps/web/components/public/grammar/topic-breadcrumbs.tsx` *(new)* | Breadcrumbs + `BreadcrumbList` JSON-LD. Server. |
| `apps/web/app/{spanish,german,turkish}/grammar/page.tsx` *(new ×3)* | Thin wrappers → `GrammarIndex`. |
| `apps/web/app/{spanish,german,turkish}/grammar/[topicId]/page.tsx` *(new ×3)* | Thin wrappers → `GrammarTopic`. |
| `apps/web/proxy.ts` *(modify)* | `isPublicRoute` gains the three `:path*` entries. |
| `apps/web/app/sitemap.ts` *(modify)* | Becomes async; adds 3 hubs + 312 topics. |
| `apps/web/app/robots.ts` *(modify)* | Disallows `/theory`. |
| `apps/web/components/public/language-landing.tsx` *(modify)* | Imports `LANDING_PATH` from `lib/public-paths`; links to the hub. |
| `apps/web/app/globals.css` *(modify)* | `.theory-public` article-typography modifier. |

---

## Task 1: Extract the approved-theory queries into a shared module

Behaviour-preserving refactor. It exists so the public router physically cannot
hold a second copy of the approved-status filter.

**Files:**
- Create: `infra/lambda/src/lib/theory-queries.ts`
- Create: `infra/lambda/src/lib/theory-queries.test.ts`
- Modify: `infra/lambda/src/routes/theory.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `APPROVED_THEORY_STATUSES: readonly ['auto-approved', 'manual-approved']`
  - `THEORY_TOPIC_ID_REGEX: RegExp`
  - `type TheoryListRow = { id: string; title: string; cefr: string; category: string; order: number | null; subtitle: string | null; grammarPointKey: string | null }`
  - `fetchApprovedTopicList(lang: string): Promise<{ rows: TheoryListRow[]; total: number }>`
  - `fetchApprovedTopicContent(lang: string, topicId: string): Promise<{ id: string; contentJson: unknown } | null>`
  - `filterApprovedRelated(lang: string, related: RelatedTheoryTopics): Promise<RelatedTheoryTopics>`

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/lib/theory-queries.test.ts`. The DB chain mock mirrors
`infra/lambda/src/routes/theory.test.ts` — Drizzle builders are thenable, so the
list query resolves at `.orderBy()`, the count query at `.where()`, and the
single-topic query at `.limit()`.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLimit = vi.fn<() => Promise<unknown>>(() => Promise.resolve([]));
const mockRowsResolver = vi.fn<() => Promise<unknown>>(() => Promise.resolve([]));
const mockTotalResolver = vi.fn<() => Promise<unknown>>(() =>
  Promise.resolve([{ total: 0 }]),
);
const captured: { where: unknown[][]; projection: unknown[] } = { where: [], projection: [] };

const mockOrderBy = vi.fn(() => ({
  limit: mockLimit,
  then: (res?: ((v: unknown) => unknown) | null, rej?: ((r: unknown) => unknown) | null) =>
    mockRowsResolver().then(res ?? undefined, rej ?? undefined),
}));
const mockWhere = vi.fn((...preds: unknown[]) => {
  captured.where.push(preds);
  return {
    orderBy: mockOrderBy,
    limit: mockLimit,
    then: (res?: ((v: unknown) => unknown) | null, rej?: ((r: unknown) => unknown) | null) =>
      mockTotalResolver().then(res ?? undefined, rej ?? undefined),
  };
});
const mockFrom = vi.fn(() => ({ where: mockWhere }));

vi.mock('../db', () => ({
  db: {
    select: (projection: unknown) => {
      captured.projection.push(projection);
      return { from: mockFrom };
    },
  },
}));

vi.mock('@language-drill/db', () => ({
  theoryTopics: {
    id: 'id',
    language: 'language',
    topicId: 'topic_id',
    contentJson: 'content_json',
    reviewStatus: 'review_status',
    grammarPointKey: 'grammar_point_key',
    cefrLevel: 'cefr_level',
    generatedAt: 'generated_at',
  },
  curriculumOrderOf: (key: string) => (key === 'es-a2-ser-vs-estar' ? 7 : null),
}));

vi.mock('@language-drill/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@language-drill/shared')>()),
  resolveTheoryCategory: () => 'pairs',
}));

import {
  APPROVED_THEORY_STATUSES,
  fetchApprovedTopicList,
  fetchApprovedTopicContent,
} from './theory-queries';

beforeEach(() => {
  vi.clearAllMocks();
  captured.where = [];
  captured.projection = [];
  mockRowsResolver.mockResolvedValue([]);
  mockTotalResolver.mockResolvedValue([{ total: 0 }]);
  mockLimit.mockResolvedValue([]);
});

describe('fetchApprovedTopicList', () => {
  it('enriches rows with category and curriculum order, and reports the pre-filter total', async () => {
    mockRowsResolver.mockResolvedValue([
      {
        id: 'a2-ser-vs-estar',
        title: 'Ser vs estar',
        cefr: 'A2',
        subtitle: 'Two verbs for one English verb.',
        grammarPointKey: 'es-a2-ser-vs-estar',
      },
    ]);
    mockTotalResolver.mockResolvedValue([{ total: 3 }]);

    const { rows, total } = await fetchApprovedTopicList('ES');

    expect(total).toBe(3);
    expect(rows).toEqual([
      {
        id: 'a2-ser-vs-estar',
        title: 'Ser vs estar',
        cefr: 'A2',
        subtitle: 'Two verbs for one English verb.',
        category: 'pairs',
        order: 7,
        grammarPointKey: 'es-a2-ser-vs-estar',
      },
    ]);
  });

  it('coerces a string count to a number', async () => {
    // Postgres returns bigint counts as strings over the wire; an uncoerced
    // total makes `total > rows.length` compare a string to a number.
    mockTotalResolver.mockResolvedValue([{ total: '12' }]);
    const { total } = await fetchApprovedTopicList('ES');
    expect(total).toBe(12);
  });

  it('selects subtitle so the public route can use it', async () => {
    await fetchApprovedTopicList('ES');
    expect(Object.keys(captured.projection[0] as object)).toContain('subtitle');
  });
});

describe('fetchApprovedTopicContent', () => {
  it('returns null when no approved row exists', async () => {
    mockLimit.mockResolvedValue([]);
    await expect(fetchApprovedTopicContent('ES', 'a2-ser-vs-estar')).resolves.toBeNull();
  });

  it('returns the newest row by generatedAt', async () => {
    mockLimit.mockResolvedValue([{ id: 'row-uuid', contentJson: { title: 'x' } }]);
    await expect(fetchApprovedTopicContent('ES', 'a2-ser-vs-estar')).resolves.toEqual({
      id: 'row-uuid',
      contentJson: { title: 'x' },
    });
    expect(mockLimit).toHaveBeenCalledWith(1);
  });
});

describe('APPROVED_THEORY_STATUSES', () => {
  it('is exactly the two approved statuses', () => {
    expect([...APPROVED_THEORY_STATUSES]).toEqual(['auto-approved', 'manual-approved']);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @language-drill/lambda test theory-queries`
Expected: FAIL — `Cannot find module './theory-queries'`.

- [ ] **Step 3: Write `theory-queries.ts`**

Lift the SQL verbatim from `infra/lambda/src/routes/theory.ts`. Two deliberate
differences from the route's current inline version: the projection gains
`subtitle` and `grammarPointKey`, and `total` is `Number()`-coerced.

```ts
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { theoryTopics, curriculumOrderOf } from '@language-drill/db';
import { resolveTheoryCategory } from '@language-drill/shared';
import { db } from '../db';
import type { RelatedTheoryTopics, RelatedTopicRef } from './theory-related';

/**
 * The single definition of "approved theory content". Both the authenticated
 * theory router and the public one filter on this; a second copy is how a
 * public surface starts serving flagged content without anyone noticing.
 */
export const APPROVED_THEORY_STATUSES = ['auto-approved', 'manual-approved'] as const;

export const THEORY_TOPIC_ID_REGEX = /^[a-z0-9-]+$/;

export type TheoryListRow = {
  id: string;
  title: string;
  cefr: string;
  subtitle: string | null;
  category: string;
  order: number | null;
  grammarPointKey: string | null;
};

/**
 * Approved topics for one language, enriched server-side with theory category
 * and curriculum order so no caller ships the curriculum to a browser.
 *
 * `total` is the count BEFORE the corrupt-row filter, so a caller can report
 * how many rows it dropped. The `title`/`cefr` NOT NULL guards are deliberately
 * the only ones in SQL: adding a `subtitle` guard here would change what the
 * already-shipped authenticated endpoint returns. Callers that need a subtitle
 * drop those rows themselves.
 */
export async function fetchApprovedTopicList(
  lang: string,
): Promise<{ rows: TheoryListRow[]; total: number }> {
  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: theoryTopics.topicId,
        title: sql<string>`${theoryTopics.contentJson}->>'title'`,
        cefr: sql<string>`${theoryTopics.contentJson}->>'cefr'`,
        subtitle: sql<string | null>`${theoryTopics.contentJson}->>'subtitle'`,
        grammarPointKey: theoryTopics.grammarPointKey,
      })
      .from(theoryTopics)
      .where(
        and(
          eq(theoryTopics.language, lang),
          inArray(theoryTopics.reviewStatus, [...APPROVED_THEORY_STATUSES]),
          sql`${theoryTopics.contentJson}->>'title' IS NOT NULL`,
          sql`${theoryTopics.contentJson}->>'cefr' IS NOT NULL`,
        ),
      )
      .orderBy(sql`${theoryTopics.contentJson}->>'title' ASC`),
    db
      .select({ total: count() })
      .from(theoryTopics)
      .where(
        and(
          eq(theoryTopics.language, lang),
          inArray(theoryTopics.reviewStatus, [...APPROVED_THEORY_STATUSES]),
        ),
      ),
  ]);

  return {
    // Postgres returns a bigint count as a string over the wire.
    total: Number(totalRows[0]?.total ?? 0),
    rows: rows.map(({ grammarPointKey, ...rest }) => ({
      ...rest,
      grammarPointKey,
      category: resolveTheoryCategory(grammarPointKey),
      order: curriculumOrderOf(grammarPointKey ?? '') ?? null,
    })),
  };
}

/** The newest approved row for one topic, or null when there is none. */
export async function fetchApprovedTopicContent(
  lang: string,
  topicId: string,
): Promise<{ id: string; contentJson: unknown } | null> {
  const rows = await db
    .select({ id: theoryTopics.id, contentJson: theoryTopics.contentJson })
    .from(theoryTopics)
    .where(
      and(
        eq(theoryTopics.language, lang),
        eq(theoryTopics.topicId, topicId),
        inArray(theoryTopics.reviewStatus, [...APPROVED_THEORY_STATUSES]),
      ),
    )
    .orderBy(sql`${theoryTopics.generatedAt} DESC NULLS LAST`)
    .limit(1);

  return rows.length === 0 ? null : rows[0];
}

/**
 * Keep only related candidates that actually have an approved theory page, so
 * no caller renders a dead link. Related links are an enhancement — on any
 * failure the topic still renders, with empty groups.
 */
export async function filterApprovedRelated(
  lang: string,
  related: RelatedTheoryTopics,
): Promise<RelatedTheoryTopics> {
  const slugs = [...related.buildsOn, ...related.leadsTo, ...related.siblings].map(
    (r) => r.topicId,
  );
  if (slugs.length === 0) return related;
  try {
    const rows = await db
      .select({ topicId: theoryTopics.topicId })
      .from(theoryTopics)
      .where(
        and(
          eq(theoryTopics.language, lang),
          inArray(theoryTopics.topicId, slugs),
          inArray(theoryTopics.reviewStatus, [...APPROVED_THEORY_STATUSES]),
        ),
      );
    const approved = new Set(rows.map((r) => r.topicId));
    const keep = (refs: RelatedTopicRef[]) => refs.filter((r) => approved.has(r.topicId));
    return {
      buildsOn: keep(related.buildsOn),
      leadsTo: keep(related.leadsTo),
      siblings: keep(related.siblings),
    };
  } catch (dbError) {
    const message = dbError instanceof Error ? dbError.message : String(dbError);
    console.error(`theory: related-topics approved-filter failed for ${lang}: ${message}`);
    return { buildsOn: [], leadsTo: [], siblings: [] };
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @language-drill/lambda test theory-queries`
Expected: PASS, 5 tests.

- [ ] **Step 5: Rewire `theory.ts` onto the shared module**

In `infra/lambda/src/routes/theory.ts`: delete the local `APPROVED_STATUSES`,
`TOPIC_ID_REGEX` and `filterApprovedRelated`, and both inline query bodies.
Import from `../lib/theory-queries` instead. **The responses must stay
byte-identical** — in particular the list route still projects exactly
`{ id, title, cefr, category, order }`, dropping `subtitle` and
`grammarPointKey`:

```ts
import {
  APPROVED_THEORY_STATUSES,
  THEORY_TOPIC_ID_REGEX,
  fetchApprovedTopicList,
  fetchApprovedTopicContent,
  filterApprovedRelated,
} from '../lib/theory-queries';
```

```ts
// GET /theory/:lang — unchanged wire shape: { topics: [{ id, title, cefr, category, order }] }
const { rows, total } = await fetchApprovedTopicList(lang);
if (total > rows.length) {
  console.warn(`theory: dropped corrupt rows from list response`, {
    language: lang,
    dropped: total - rows.length,
  });
}
const topics = rows.map(({ subtitle: _subtitle, grammarPointKey: _key, ...rest }) => rest);
return c.json({ topics });
```

```ts
// GET /theory/:lang/:topicId
const row = await fetchApprovedTopicContent(lang, topicId);
if (!row) {
  return c.json({ error: 'Topic not found', code: 'TOPIC_NOT_FOUND' }, 404);
}
```

Keep the route's existing `try`/`catch` wrappers, its `parseTheoryTopicJson`
call, its parse-failure 500 (with the row id logged) and its
`deriveRelatedGrammarPoints` call exactly as they are.

- [ ] **Step 6: Run the existing theory route tests unchanged**

Run: `pnpm --filter @language-drill/lambda test theory`
Expected: PASS. `theory.test.ts` must not be edited — if it needs editing, the
refactor changed behaviour and is wrong.

- [ ] **Step 7: Commit**

```bash
git add infra/lambda/src/lib/theory-queries.ts infra/lambda/src/lib/theory-queries.test.ts infra/lambda/src/routes/theory.ts
git commit -m "Give the approved-theory filter one home before a second router needs it"
```

---

## Task 2: Move the public level list to shared, and query practice availability

**Files:**
- Create: `packages/shared/src/public-levels.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/api-client/src/hooks/usePublicConjugationSet.ts`
- Create: `infra/lambda/src/lib/theory-practice.ts`
- Create: `infra/lambda/src/lib/theory-practice.test.ts`

**Interfaces:**
- Consumes: `APPROVED_THEORY_STATUSES` is *not* used here (this file reads `exercises`, so it uses `approvedStatusFilter`).
- Produces:
  - From `@language-drill/shared`: `type PublicLanguage = 'ES' | 'DE' | 'TR'`, `type PublicLevel = 'A1' | 'A2' | 'B1' | 'B2'`, `PUBLIC_LEVELS_BY_LANGUAGE: Record<PublicLanguage, PublicLevel[]>`
  - `fetchConjugationDrillKeys(lang: PublicLanguage): Promise<Set<string>>`
  - `type QuickCheckItem = { sentence: string; instructions: string; correctAnswer: string; acceptableAnswers: string[]; topicHint?: string }`
  - `QUICK_CHECK_SIZE = 3`
  - `fetchQuickCheck(lang: PublicLanguage, grammarPointKey: string): Promise<QuickCheckItem[]>`

- [ ] **Step 1: Move the level list into shared**

Create `packages/shared/src/public-levels.ts` with the constant moved verbatim,
comment included:

```ts
export type PublicLanguage = "ES" | "DE" | "TR";
export type PublicLevel = "A1" | "A2" | "B1" | "B2";

/**
 * Levels the public conjugation pool actually has approved content for, per
 * language. Prod measurement at branch-time found ZERO approved conjugation
 * rows for ES/DE at B2 — offering it in a picker one click from the default
 * would land a first-time, no-context visitor on an empty state. Single
 * source of truth for the page's level picker, its empty-state copy, and the
 * API's judgement of whether a theory topic can offer a drill at its own
 * level; update this when the pool gains B2 coverage for ES/DE.
 *
 * Lives in `shared` rather than `api-client` because the Lambda needs it too
 * and does not depend on `api-client`.
 */
export const PUBLIC_LEVELS_BY_LANGUAGE: Record<PublicLanguage, PublicLevel[]> = {
  ES: ["A1", "A2", "B1"],
  DE: ["A1", "A2", "B1"],
  TR: ["A1", "A2", "B1", "B2"],
};
```

Add to `packages/shared/src/index.ts`:

```ts
export * from "./public-levels";
```

In `packages/api-client/src/hooks/usePublicConjugationSet.ts`, delete the three
moved declarations and re-export them so every existing importer keeps working:

```ts
export type { PublicLanguage, PublicLevel } from '@language-drill/shared';
export { PUBLIC_LEVELS_BY_LANGUAGE } from '@language-drill/shared';
```

- [ ] **Step 2: Verify the move broke nothing**

Run: `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/api-client test && pnpm --filter @language-drill/web typecheck`
Expected: PASS. `packages/api-client/src/index.ts` already re-exports
`PUBLIC_LEVELS_BY_LANGUAGE` by name, so no change is needed there.

- [ ] **Step 3: Write the failing test for practice availability**

Create `infra/lambda/src/lib/theory-practice.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state: { rows: unknown[]; error: unknown } = { rows: [], error: null };
const captured: { where: unknown[]; projection: unknown; limit?: number; orderBy?: unknown[] } = {
  where: [],
  projection: null,
};

vi.mock('../db', () => {
  const chain = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = {};
    c.from = () => c;
    c.where = (...args: unknown[]) => {
      captured.where = args;
      return c;
    };
    c.groupBy = () => (state.error ? Promise.reject(state.error) : Promise.resolve(state.rows));
    c.orderBy = (...args: unknown[]) => {
      captured.orderBy = args;
      return c;
    };
    c.limit = (n: number) => {
      captured.limit = n;
      return state.error ? Promise.reject(state.error) : Promise.resolve(state.rows);
    };
    return c;
  };
  return {
    db: {
      select: (projection: unknown) => {
        captured.projection = projection;
        return chain();
      },
    },
  };
});

vi.mock('@language-drill/db', () => ({
  exercises: {
    id: 'id',
    type: 'type',
    language: 'language',
    difficulty: 'difficulty',
    reviewStatus: 'review_status',
    grammarPointKey: 'grammar_point_key',
    contentJson: 'content_json',
    audioS3Key: 'audio_s3_key',
  },
}));

import { fetchConjugationDrillKeys, fetchQuickCheck, QUICK_CHECK_SIZE } from './theory-practice';

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [];
  state.error = null;
  captured.where = [];
  captured.limit = undefined;
});

describe('fetchConjugationDrillKeys', () => {
  it('returns the set of point keys that have approved conjugation rows', async () => {
    state.rows = [
      { key: 'es-a2-preterite-regular' },
      { key: 'es-b1-conditional' },
    ];
    const keys = await fetchConjugationDrillKeys('ES');
    expect(keys).toEqual(new Set(['es-a2-preterite-regular', 'es-b1-conditional']));
  });

  it('drops a null point key rather than putting null in the set', async () => {
    state.rows = [{ key: null }, { key: 'es-b1-conditional' }];
    const keys = await fetchConjugationDrillKeys('ES');
    expect(keys).toEqual(new Set(['es-b1-conditional']));
  });

  it('returns an empty set when the query fails, so a topic page still renders', async () => {
    state.error = new Error('connection reset');
    await expect(fetchConjugationDrillKeys('ES')).resolves.toEqual(new Set());
  });
});

describe('fetchQuickCheck', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    contentJson: {
      type: 'cloze',
      sentence: 'Ayer ___ en un restaurante.',
      instructions: 'Type the correct form.',
      correctAnswer: 'comí',
      acceptableAnswers: ['comi'],
      topicHint: 'preterite',
      glossEn: '(a finished event)',
      _dedupKey: 'writer-only',
      seedWord: 'comer',
      ...over,
    },
  });

  it('returns exactly the wire fields, dropping gloss and writer metadata', async () => {
    state.rows = [row(), row(), row()];
    const items = await fetchQuickCheck('ES', 'es-a2-preterite-regular');

    expect(items).toHaveLength(3);
    expect(Object.keys(items[0]).sort()).toEqual([
      'acceptableAnswers',
      'correctAnswer',
      'instructions',
      'sentence',
      'topicHint',
    ]);
    // glossEn is the field `audit:gloss` polices for stating a rule's trigger
    // or outcome — on a self-graded public check it would hand over the answer.
    expect(JSON.stringify(items)).not.toContain('glossEn');
    expect(JSON.stringify(items)).not.toContain('_dedupKey');
    expect(JSON.stringify(items)).not.toContain('seedWord');
  });

  it('returns [] unless all three items are available', async () => {
    state.rows = [row(), row()];
    await expect(fetchQuickCheck('ES', 'es-a2-preterite-regular')).resolves.toEqual([]);
  });

  it('asks for exactly QUICK_CHECK_SIZE rows in a deterministic order', async () => {
    state.rows = [row(), row(), row()];
    await fetchQuickCheck('ES', 'es-a2-preterite-regular');
    expect(captured.limit).toBe(QUICK_CHECK_SIZE);
    expect(captured.orderBy).toBeDefined();
  });

  it('skips a row whose content is not usable as a cloze item', async () => {
    state.rows = [row(), row({ correctAnswer: undefined }), row()];
    await expect(fetchQuickCheck('ES', 'es-a2-preterite-regular')).resolves.toEqual([]);
  });

  it('returns [] when the query fails', async () => {
    state.error = new Error('connection reset');
    await expect(fetchQuickCheck('ES', 'es-a2-preterite-regular')).resolves.toEqual([]);
  });
});
```

- [ ] **Step 4: Run the test and confirm it fails**

Run: `pnpm --filter @language-drill/lambda test theory-practice`
Expected: FAIL — `Cannot find module './theory-practice'`.

- [ ] **Step 5: Write `theory-practice.ts`**

```ts
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { exercises as exercisesTable } from '@language-drill/db';
import { PUBLIC_LEVELS_BY_LANGUAGE, type PublicLanguage } from '@language-drill/shared';
import { db } from '../db';
import { approvedStatusFilter } from './exercise-filters';

/** The prototype's quick check is three sentences; anything less is not shown. */
export const QUICK_CHECK_SIZE = 3;

export type QuickCheckItem = {
  sentence: string;
  instructions: string;
  correctAnswer: string;
  acceptableAnswers: string[];
  topicHint?: string;
};

/**
 * The grammar-point keys whose conjugation pool `/try/forms` can actually
 * serve: approved conjugation rows AND a difficulty the public level picker
 * offers for this language. Both conditions, because a point whose only rows
 * sit at a level the picker hides would produce a drill link that silently
 * falls back to another level and then 400s on the point key.
 *
 * Failure is non-fatal: an empty set means no drill card renders, which is the
 * same page a point with no pool gets.
 */
export async function fetchConjugationDrillKeys(
  lang: PublicLanguage,
): Promise<Set<string>> {
  try {
    const rows = await db
      .select({ key: exercisesTable.grammarPointKey })
      .from(exercisesTable)
      .where(
        and(
          eq(exercisesTable.language, lang),
          eq(exercisesTable.type, 'conjugation'),
          approvedStatusFilter(exercisesTable),
          sql`${exercisesTable.difficulty} = ANY(${PUBLIC_LEVELS_BY_LANGUAGE[lang]})`,
        ),
      )
      .groupBy(exercisesTable.grammarPointKey);

    const keys = new Set<string>();
    for (const row of rows) {
      if (row.key) keys.add(row.key);
    }
    return keys;
  } catch (dbError) {
    const message = dbError instanceof Error ? dbError.message : String(dbError);
    console.warn(`public theory: conjugation-availability query failed for ${lang}: ${message}`);
    return new Set();
  }
}

/**
 * Three approved cloze rows for one grammar point, as a self-gradable check.
 *
 * Rows carrying an `options` array are excluded on purpose. Rendering their
 * options turns the exercise into multiple-choice recognition, which is the one
 * thing this product positions against; omitting the options can leave a blank
 * that is ambiguous without them. Either way the row is wrong for this surface.
 *
 * `ORDER BY id LIMIT 3` so the published HTML is stable across ISR refreshes.
 * All-or-nothing: fewer than three usable rows means no quick check at all,
 * never a one-item stub.
 */
export async function fetchQuickCheck(
  lang: PublicLanguage,
  grammarPointKey: string,
): Promise<QuickCheckItem[]> {
  let rows: { contentJson: unknown }[];
  try {
    rows = await db
      .select({ contentJson: exercisesTable.contentJson })
      .from(exercisesTable)
      .where(
        and(
          eq(exercisesTable.language, lang),
          eq(exercisesTable.type, 'cloze'),
          eq(exercisesTable.grammarPointKey, grammarPointKey),
          approvedStatusFilter(exercisesTable),
          or(
            sql`NOT (${exercisesTable.contentJson} ? 'options')`,
            sql`jsonb_typeof(${exercisesTable.contentJson}->'options') <> 'array'`,
          ),
        ),
      )
      .orderBy(exercisesTable.id)
      .limit(QUICK_CHECK_SIZE);
  } catch (dbError) {
    const message = dbError instanceof Error ? dbError.message : String(dbError);
    console.warn(
      `public theory: quick-check query failed for ${lang}/${grammarPointKey}: ${message}`,
    );
    return [];
  }

  const items = rows.flatMap((row) => {
    const item = toQuickCheckItem(row.contentJson);
    return item ? [item] : [];
  });

  return items.length === QUICK_CHECK_SIZE ? items : [];
}

/**
 * Explicit field pick — never the row. `glossEn` is deliberately absent: it is
 * present on only a minority of rows and it is exactly the field `audit:gloss`
 * exists to police for stating a rule's trigger or outcome, which on a check the
 * reader grades themselves would hand over the answer. `_dedupKey` / `seedWord`
 * are writer metadata and cannot be reached by this pick at all.
 */
function toQuickCheckItem(contentJson: unknown): QuickCheckItem | null {
  if (contentJson === null || typeof contentJson !== 'object' || Array.isArray(contentJson)) {
    return null;
  }
  const c = contentJson as Record<string, unknown>;
  if (
    typeof c.sentence !== 'string' ||
    c.sentence === '' ||
    typeof c.correctAnswer !== 'string' ||
    c.correctAnswer === ''
  ) {
    return null;
  }
  const acceptable = Array.isArray(c.acceptableAnswers)
    ? c.acceptableAnswers.filter((a): a is string => typeof a === 'string')
    : [];
  return {
    sentence: c.sentence,
    instructions: typeof c.instructions === 'string' ? c.instructions : 'Type the missing form.',
    correctAnswer: c.correctAnswer,
    acceptableAnswers: acceptable,
    ...(typeof c.topicHint === 'string' ? { topicHint: c.topicHint } : {}),
  };
}
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `pnpm --filter @language-drill/lambda test theory-practice`
Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/public-levels.ts packages/shared/src/index.ts packages/api-client/src/hooks/usePublicConjugationSet.ts infra/lambda/src/lib/theory-practice.ts infra/lambda/src/lib/theory-practice.test.ts
git commit -m "Answer what practice a theory topic can actually offer a stranger"
```

---

## Task 3: The two public theory endpoints

**Files:**
- Modify: `infra/lambda/src/routes/public.ts`
- Modify: `infra/lambda/src/routes/public.test.ts`

**Interfaces:**
- Consumes: everything Tasks 1 and 2 produced.
- Produces the wire contracts Task 4 validates:
  - `GET /public/theory/:lang` → `{ topics: Array<{ id, title, cefr, subtitle, category, order, hasConjugationDrill }> }`
  - `GET /public/theory/:lang/:topicId` → `TheoryTopicJson & { related, hasConjugationDrill, quickCheck }`

- [ ] **Step 1: Write the failing tests**

Append to `infra/lambda/src/routes/public.test.ts`. The existing `vi.mock('../db')`
chain terminates on `.limit` and `.groupBy`; the theory queries also terminate on
`.orderBy()` and on a thenable `.where()`, so extend the shared chain mock in that
file to add an `orderBy` returning the chain and a `then` on `where`, matching
`theory.test.ts`. Then stub the two lib modules so these route tests assert
*routing, validation and composition*, not SQL (the SQL has its own tests):

```ts
vi.mock('../lib/theory-queries', () => ({
  APPROVED_THEORY_STATUSES: ['auto-approved', 'manual-approved'] as const,
  THEORY_TOPIC_ID_REGEX: /^[a-z0-9-]+$/,
  fetchApprovedTopicList: vi.fn(),
  fetchApprovedTopicContent: vi.fn(),
  filterApprovedRelated: vi.fn(async (_lang: string, related: unknown) => related),
}));

vi.mock('../lib/theory-practice', () => ({
  QUICK_CHECK_SIZE: 3,
  fetchConjugationDrillKeys: vi.fn(async () => new Set<string>()),
  fetchQuickCheck: vi.fn(async () => []),
}));
```

```ts
import {
  fetchApprovedTopicList,
  fetchApprovedTopicContent,
} from '../lib/theory-queries';
import { fetchConjugationDrillKeys, fetchQuickCheck } from '../lib/theory-practice';

const TOPIC_JSON = {
  id: 'es-a2-ser-vs-estar',
  title: 'Ser vs estar',
  subtitle: 'Two verbs for one English verb.',
  cefr: 'A2',
  sections: [
    { id: 'short', title: 'The short version', body: [{ kind: 'paragraph', text: [{ kind: 'text', text: 'Ser is essence.' }] }] },
  ],
};

describe('GET /public/theory/:lang', () => {
  it('rejects a language outside ES/DE/TR', async () => {
    const res = await app.request('/public/theory/FR');
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('marks only the topics whose point has a public conjugation pool', async () => {
    vi.mocked(fetchApprovedTopicList).mockResolvedValue({
      total: 2,
      rows: [
        { id: 'a2-preterite', title: 'Preterite', cefr: 'A2', subtitle: 'Finished events.', category: 'tenses', order: 3, grammarPointKey: 'es-a2-preterite' },
        { id: 'a1-noun-gender', title: 'Noun gender', cefr: 'A1', subtitle: 'el and la.', category: 'morphology', order: 1, grammarPointKey: 'es-a1-noun-gender' },
      ],
    });
    vi.mocked(fetchConjugationDrillKeys).mockResolvedValue(new Set(['es-a2-preterite']));

    const res = await app.request('/public/theory/ES');
    expect(res.status).toBe(200);
    const { topics } = await res.json();
    expect(topics).toEqual([
      { id: 'a2-preterite', title: 'Preterite', cefr: 'A2', subtitle: 'Finished events.', category: 'tenses', order: 3, hasConjugationDrill: true },
      { id: 'a1-noun-gender', title: 'Noun gender', cefr: 'A1', subtitle: 'el and la.', category: 'morphology', order: 1, hasConjugationDrill: false },
    ]);
  });

  it('never leaks grammarPointKey to the open web', async () => {
    vi.mocked(fetchApprovedTopicList).mockResolvedValue({
      total: 1,
      rows: [{ id: 'a2-preterite', title: 'Preterite', cefr: 'A2', subtitle: 'x', category: 'tenses', order: 3, grammarPointKey: 'es-a2-preterite' }],
    });
    const res = await app.request('/public/theory/ES');
    expect(await res.text()).not.toContain('grammarPointKey');
  });

  it('drops a subtitle-less row instead of publishing a blank description', async () => {
    vi.mocked(fetchApprovedTopicList).mockResolvedValue({
      total: 2,
      rows: [
        { id: 'ok', title: 'Fine', cefr: 'A2', subtitle: 'Has one.', category: 'tenses', order: 1, grammarPointKey: 'es-a2-x' },
        { id: 'broken', title: 'Corrupt', cefr: 'A2', subtitle: null, category: 'tenses', order: 2, grammarPointKey: 'es-a2-y' },
      ],
    });
    const res = await app.request('/public/theory/ES');
    const { topics } = await res.json();
    expect(topics.map((t: { id: string }) => t.id)).toEqual(['ok']);
  });

  it('500s when the list query throws', async () => {
    vi.mocked(fetchApprovedTopicList).mockRejectedValue(new Error('connection reset'));
    const res = await app.request('/public/theory/ES');
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('INTERNAL_ERROR');
  });
});

describe('GET /public/theory/:lang/:topicId', () => {
  it('rejects a topic id outside the slug shape', async () => {
    const res = await app.request('/public/theory/ES/Ser_Vs_Estar');
    expect(res.status).toBe(400);
  });

  it('404s an unknown topic', async () => {
    vi.mocked(fetchApprovedTopicContent).mockResolvedValue(null);
    const res = await app.request('/public/theory/ES/a2-nope');
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('TOPIC_NOT_FOUND');
  });

  it('returns the article plus related, drill flag and quick check', async () => {
    vi.mocked(fetchApprovedTopicContent).mockResolvedValue({ id: 'row-uuid', contentJson: TOPIC_JSON });
    vi.mocked(fetchConjugationDrillKeys).mockResolvedValue(new Set(['es-a2-ser-vs-estar']));
    vi.mocked(fetchQuickCheck).mockResolvedValue([
      { sentence: 'Ayer ___ aquí.', instructions: 'Type it.', correctAnswer: 'estuve', acceptableAnswers: [] },
      { sentence: 'Ella ___ médica.', instructions: 'Type it.', correctAnswer: 'es', acceptableAnswers: [] },
      { sentence: 'Hoy ___ cansado.', instructions: 'Type it.', correctAnswer: 'estoy', acceptableAnswers: [] },
    ]);

    const res = await app.request('/public/theory/ES/a2-ser-vs-estar');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Ser vs estar');
    expect(body.sections).toHaveLength(1);
    expect(body.hasConjugationDrill).toBe(true);
    expect(body.quickCheck).toHaveLength(3);
    expect(body.related).toEqual({ buildsOn: [], leadsTo: [], siblings: [] });
  });

  it('500s rather than 404s when content_json cannot be parsed', async () => {
    // A 404 here would teach a crawler the page is gone; a parse failure is a
    // data bug on our side and must read as one.
    vi.mocked(fetchApprovedTopicContent).mockResolvedValue({ id: 'row-uuid', contentJson: { title: 'no sections' } });
    const res = await app.request('/public/theory/ES/a2-ser-vs-estar');
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('INTERNAL_ERROR');
  });

  it('asks for the quick check with the full grammar-point key', async () => {
    vi.mocked(fetchApprovedTopicContent).mockResolvedValue({ id: 'row-uuid', contentJson: TOPIC_JSON });
    await app.request('/public/theory/ES/a2-ser-vs-estar');
    expect(vi.mocked(fetchQuickCheck)).toHaveBeenCalledWith('ES', 'es-a2-ser-vs-estar');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm --filter @language-drill/lambda test public`
Expected: FAIL — the new routes 404.

- [ ] **Step 3: Add the routes to `public.ts`**

Add imports and a `TOPIC_PARAM` schema near the existing ones, then the two
handlers before `export default publicRoutes`:

```ts
import { parseTheoryTopicJson } from '@language-drill/shared';
import { deriveRelatedGrammarPoints } from '../lib/theory-related';
import {
  THEORY_TOPIC_ID_REGEX,
  fetchApprovedTopicList,
  fetchApprovedTopicContent,
  filterApprovedRelated,
} from '../lib/theory-queries';
import { fetchConjugationDrillKeys, fetchQuickCheck } from '../lib/theory-practice';
```

```ts
// ---------------------------------------------------------------------------
// PUBLIC THEORY. Unlike the conjugation routes above there is no answer to
// leak: a theory topic IS the published content, and `parseTheoryTopicJson`
// doubles as the wire projection because it picks only known keys. The quick
// check is the one part that ships answers, and it is an explicit field pick in
// `theory-practice.ts`, not a row pass-through.
// ---------------------------------------------------------------------------

publicRoutes.get('/public/theory/:lang', async (c) => {
  const langParse = LANG.safeParse(c.req.param('lang'));
  if (!langParse.success) {
    return c.json({ error: 'Invalid language', code: 'VALIDATION_ERROR' }, 400);
  }
  const lang = langParse.data;

  try {
    const [{ rows, total }, drillKeys] = await Promise.all([
      fetchApprovedTopicList(lang),
      fetchConjugationDrillKeys(lang),
    ]);

    const topics = rows.flatMap(({ grammarPointKey, subtitle, ...rest }) => {
      // The index renders the subtitle as each row's description. A row without
      // one is a data defect, and a blank description is worse than a missing
      // row — so drop it and let the dropped count say so.
      if (!subtitle) return [];
      return [
        {
          ...rest,
          subtitle,
          hasConjugationDrill: grammarPointKey ? drillKeys.has(grammarPointKey) : false,
        },
      ];
    });

    if (total > topics.length) {
      console.warn('public theory: dropped unusable rows from list response', {
        language: lang,
        dropped: total - topics.length,
      });
    }

    return c.json({ topics });
  } catch (dbError) {
    const message = dbError instanceof Error ? dbError.message : String(dbError);
    console.error(`public theory: list query failed for ${lang}: ${message}`);
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

publicRoutes.get('/public/theory/:lang/:topicId', async (c) => {
  const langParse = LANG.safeParse(c.req.param('lang'));
  if (!langParse.success) {
    return c.json({ error: 'Invalid language', code: 'VALIDATION_ERROR' }, 400);
  }
  const lang = langParse.data;

  const topicId = c.req.param('topicId');
  if (!THEORY_TOPIC_ID_REGEX.test(topicId)) {
    return c.json({ error: 'Invalid topicId', code: 'VALIDATION_ERROR' }, 400);
  }

  let row: { id: string; contentJson: unknown } | null;
  try {
    row = await fetchApprovedTopicContent(lang, topicId);
  } catch (dbError) {
    const message = dbError instanceof Error ? dbError.message : String(dbError);
    console.error(`public theory: query failed for (${lang}, ${topicId}): ${message}`);
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!row) {
    return c.json({ error: 'Topic not found', code: 'TOPIC_NOT_FOUND' }, 404);
  }

  let parsed;
  try {
    parsed = parseTheoryTopicJson(row.contentJson);
  } catch (parseError) {
    const message = parseError instanceof Error ? parseError.message : String(parseError);
    console.error(`public theory: failed to parse content_json for row ${row.id}: ${message}`);
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  // `content_json.id` carries the FULL grammar-point key (`es-a2-ser-vs-estar`),
  // while the URL slug is that key minus the language prefix. The drill lookup
  // and the quick check both key on the full one.
  const grammarPointKey = parsed.id;

  const [related, drillKeys, quickCheck] = await Promise.all([
    filterApprovedRelated(lang, deriveRelatedGrammarPoints(lang, topicId)),
    fetchConjugationDrillKeys(lang),
    fetchQuickCheck(lang, grammarPointKey),
  ]);

  return c.json({
    ...parsed,
    related,
    hasConjugationDrill: drillKeys.has(grammarPointKey),
    quickCheck,
  });
});
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm --filter @language-drill/lambda test public`
Expected: PASS — the 10 new tests plus every pre-existing conjugation test.

- [ ] **Step 5: Update the router's header comment**

The block comment at the top of `public.ts` states two constraints that keep the
authorizer-free router safe and says `type` is a server constant. Add a third
bullet recording that the theory routes serve `theory_topics` content whose
projection is `parseTheoryTopicJson`, and that the only answers on this router
are the three quick-check items, selected by `theory-practice.ts`.

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/routes/public.ts infra/lambda/src/routes/public.test.ts
git commit -m "Serve theory topics to readers who have not signed up"
```

---

## Task 4: Response schemas in api-client

**Files:**
- Create: `packages/api-client/src/schemas/theory-public.ts`
- Create: `packages/api-client/src/schemas/theory-public.test.ts`
- Modify: `packages/api-client/src/index.ts`

**Interfaces:**
- Consumes: the wire contracts from Task 3.
- Produces: `PublicTopicSummarySchema`, `PublicTopicListResponseSchema`, `QuickCheckItemSchema`, `PublicTopicEnvelopeSchema`, and the inferred types `PublicTopicSummary`, `PublicTopicListResponse`, `QuickCheckItem`, `PublicTopicEnvelope`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
  PublicTopicListResponseSchema,
  PublicTopicEnvelopeSchema,
} from './theory-public';

describe('PublicTopicListResponseSchema', () => {
  it('accepts a topic row', () => {
    const parsed = PublicTopicListResponseSchema.parse({
      topics: [
        { id: 'a2-ser-vs-estar', title: 'Ser vs estar', cefr: 'A2', subtitle: 'Two verbs.', category: 'pairs', order: 7, hasConjugationDrill: true },
      ],
    });
    expect(parsed.topics[0].hasConjugationDrill).toBe(true);
  });

  it('accepts a null order', () => {
    const parsed = PublicTopicListResponseSchema.parse({
      topics: [{ id: 'x', title: 'X', cefr: 'A1', subtitle: 's', category: 'other', order: null, hasConjugationDrill: false }],
    });
    expect(parsed.topics[0].order).toBeNull();
  });

  it('rejects a row missing the drill flag, rather than defaulting it', () => {
    // A silent default would render a drill card for a topic with no pool.
    expect(() =>
      PublicTopicListResponseSchema.parse({
        topics: [{ id: 'x', title: 'X', cefr: 'A1', subtitle: 's', category: 'other', order: 1 }],
      }),
    ).toThrow();
  });
});

describe('PublicTopicEnvelopeSchema', () => {
  it('validates only the envelope and passes the article through untouched', () => {
    // The article taxonomy is validated by parseTheoryTopicJson, which is the
    // one validator for it. Duplicating TheoryBlockJson in Zod would give two
    // definitions that can disagree.
    const parsed = PublicTopicEnvelopeSchema.parse({
      id: 'es-a2-ser-vs-estar',
      title: 'Ser vs estar',
      subtitle: 'Two verbs.',
      cefr: 'A2',
      sections: [{ id: 'short', title: 'Short', body: [{ kind: 'paragraph', text: [] }] }],
      related: { buildsOn: [], leadsTo: [], siblings: [] },
      hasConjugationDrill: false,
      quickCheck: [],
    });
    expect(parsed.hasConjugationDrill).toBe(false);
  });

  it('accepts a related ref and a quick-check item', () => {
    const parsed = PublicTopicEnvelopeSchema.parse({
      id: 'es-a2-ser-vs-estar',
      title: 'T',
      subtitle: 's',
      cefr: 'A2',
      sections: [],
      related: {
        buildsOn: [{ topicId: 'a1-noun-gender', title: 'Noun gender', cefr: 'A1' }],
        leadsTo: [],
        siblings: [],
      },
      hasConjugationDrill: true,
      quickCheck: [
        { sentence: 'Ayer ___ aquí.', instructions: 'Type it.', correctAnswer: 'estuve', acceptableAnswers: ['estube'] },
      ],
    });
    expect(parsed.related.buildsOn[0].topicId).toBe('a1-noun-gender');
    expect(parsed.quickCheck[0].topicHint).toBeUndefined();
  });

  it('rejects a quick-check item with no correct answer', () => {
    expect(() =>
      PublicTopicEnvelopeSchema.parse({
        id: 'x', title: 'T', subtitle: 's', cefr: 'A2', sections: [],
        related: { buildsOn: [], leadsTo: [], siblings: [] },
        hasConjugationDrill: false,
        quickCheck: [{ sentence: 'a ___ b', instructions: 'Type it.', acceptableAnswers: [] }],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @language-drill/api-client test theory-public`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the schemas**

```ts
import { z } from 'zod';

/**
 * Wire schemas for the two unauthenticated theory endpoints.
 *
 * NOTE what is deliberately absent: a Zod mirror of `TheoryBlockJson`. The
 * article taxonomy has exactly one validator — `parseTheoryTopicJson` in
 * `@language-drill/shared` — and a second definition here would be free to
 * drift from it. So `sections` is passed through as unknown-shaped data and the
 * page hands the whole object to `parseTheoryTopicJson`; these schemas validate
 * the ENVELOPE the public route adds around it.
 */

export const PublicTopicSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  cefr: z.string().min(1),
  subtitle: z.string().min(1),
  category: z.string().min(1),
  order: z.number().int().nullable(),
  hasConjugationDrill: z.boolean(),
});

export const PublicTopicListResponseSchema = z.object({
  topics: z.array(PublicTopicSummarySchema),
});

export const RelatedTopicRefSchema = z.object({
  topicId: z.string().min(1),
  title: z.string().min(1),
  cefr: z.string().min(1),
});

export const RelatedTheoryTopicsSchema = z.object({
  buildsOn: z.array(RelatedTopicRefSchema),
  leadsTo: z.array(RelatedTopicRefSchema),
  siblings: z.array(RelatedTopicRefSchema),
});

export const QuickCheckItemSchema = z.object({
  sentence: z.string().min(1),
  instructions: z.string().min(1),
  correctAnswer: z.string().min(1),
  acceptableAnswers: z.array(z.string()),
  topicHint: z.string().optional(),
});

export const PublicTopicEnvelopeSchema = z
  .object({
    related: RelatedTheoryTopicsSchema,
    hasConjugationDrill: z.boolean(),
    quickCheck: z.array(QuickCheckItemSchema),
  })
  .passthrough();

export type PublicTopicSummary = z.infer<typeof PublicTopicSummarySchema>;
export type PublicTopicListResponse = z.infer<typeof PublicTopicListResponseSchema>;
export type QuickCheckItem = z.infer<typeof QuickCheckItemSchema>;
export type RelatedTheoryTopicsWire = z.infer<typeof RelatedTheoryTopicsSchema>;
export type PublicTopicEnvelope = z.infer<typeof PublicTopicEnvelopeSchema>;
```

- [ ] **Step 4: Export from the package barrel**

`packages/api-client/src/index.ts` lists its exports explicitly. Add:

```ts
export {
  PublicTopicSummarySchema,
  PublicTopicListResponseSchema,
  RelatedTopicRefSchema,
  RelatedTheoryTopicsSchema,
  QuickCheckItemSchema,
  PublicTopicEnvelopeSchema,
} from './schemas/theory-public';
export type {
  PublicTopicSummary,
  PublicTopicListResponse,
  QuickCheckItem,
  RelatedTheoryTopicsWire,
  PublicTopicEnvelope,
} from './schemas/theory-public';
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm --filter @language-drill/api-client test theory-public`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/api-client/src/schemas/theory-public.ts packages/api-client/src/schemas/theory-public.test.ts packages/api-client/src/index.ts
git commit -m "Validate the public theory envelope without forking the article taxonomy"
```

---

## Task 5: Web data layer and public URL helpers

**Files:**
- Create: `apps/web/lib/public-paths.ts`
- Create: `apps/web/lib/public-paths.test.ts`
- Create: `apps/web/lib/public-theory.ts`
- Create: `apps/web/lib/public-theory.test.ts`
- Modify: `apps/web/components/public/language-landing.tsx`

**Interfaces:**
- Consumes: Task 4's schemas; `PublicLanguage` / `PUBLIC_LEVELS_BY_LANGUAGE` from `@language-drill/shared` (Task 2).
- Produces:
  - `LANDING_PATH: Record<PublicLanguage, string>`, `LANGUAGE_FOR_PATH: Record<string, PublicLanguage>`
  - `grammarIndexHref(lang): string`, `grammarTopicHref(lang, topicId): string`, `tryFormsHref(lang, level, point?): string`
  - `fetchPublicTopicList(lang): Promise<PublicTopicSummary[]>`
  - `fetchPublicTopic(lang, topicId): Promise<{ topic: TheoryTopic; envelope: PublicTopicEnvelope } >` — calls `notFound()` on a 404 and throws on anything else.

- [ ] **Step 1: Write the failing path tests**

```ts
import { describe, it, expect } from 'vitest';
import { LANDING_PATH, grammarIndexHref, grammarTopicHref, tryFormsHref } from './public-paths';

describe('public paths', () => {
  it('uses language names, not codes', () => {
    expect(LANDING_PATH.ES).toBe('/spanish');
    expect(grammarIndexHref('DE')).toBe('/german/grammar');
    expect(grammarTopicHref('TR', 'a1-vowel-harmony')).toBe('/turkish/grammar/a1-vowel-harmony');
  });

  it('encodes a topic id so a stray character cannot break the href', () => {
    expect(grammarTopicHref('ES', 'a2-ser vs estar')).toBe('/spanish/grammar/a2-ser%20vs%20estar');
  });

  it('builds a point-targeted drill href', () => {
    expect(tryFormsHref('ES', 'A2', 'es-a2-preterite')).toBe(
      '/try/forms?lang=ES&level=A2&point=es-a2-preterite',
    );
  });

  it('omits the point when there is none', () => {
    expect(tryFormsHref('ES', 'A2')).toBe('/try/forms?lang=ES&level=A2');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @language-drill/web test public-paths`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `public-paths.ts`**

```ts
import type { PublicLanguage, PublicLevel } from '@language-drill/shared';

/**
 * One source for every public URL. `/spanish` rather than `/es` is deliberate:
 * those paths shipped in #748 and are already in the sitemap, and the language
 * name is the term people search.
 */
export const LANDING_PATH: Record<PublicLanguage, string> = {
  ES: '/spanish',
  DE: '/german',
  TR: '/turkish',
};

/** Inverse of LANDING_PATH, for route wrappers that know only their folder. */
export const LANGUAGE_FOR_PATH: Record<string, PublicLanguage> = {
  spanish: 'ES',
  german: 'DE',
  turkish: 'TR',
};

export function grammarIndexHref(lang: PublicLanguage): string {
  return `${LANDING_PATH[lang]}/grammar`;
}

export function grammarTopicHref(lang: PublicLanguage, topicId: string): string {
  return `${grammarIndexHref(lang)}/${encodeURIComponent(topicId)}`;
}

export function tryFormsHref(
  lang: PublicLanguage,
  level: PublicLevel,
  point?: string,
): string {
  const params = new URLSearchParams({ lang, level });
  if (point) params.set('point', point);
  return `/try/forms?${params.toString()}`;
}
```

Then in `apps/web/components/public/language-landing.tsx`, delete its local
`LANDING_PATH` declaration and re-export from the new module so existing
importers are unaffected:

```ts
import { LANDING_PATH } from '../../lib/public-paths';
export { LANDING_PATH };
```

- [ ] **Step 4: Write the failing fetcher tests**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound }));

import { fetchPublicTopicList, fetchPublicTopic } from './public-theory';

const TOPIC = {
  id: 'es-a2-ser-vs-estar',
  title: 'Ser vs estar',
  subtitle: 'Two verbs.',
  cefr: 'A2',
  sections: [
    { id: 'short', title: 'Short', body: [{ kind: 'paragraph', text: [{ kind: 'text', text: 'Ser is essence.' }] }] },
  ],
  related: { buildsOn: [], leadsTo: [], siblings: [] },
  hasConjugationDrill: true,
  quickCheck: [],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.test');
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('fetchPublicTopic', () => {
  it('returns a rendered topic and its envelope', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(TOPIC));
    const { topic, envelope } = await fetchPublicTopic('ES', 'a2-ser-vs-estar');
    expect(topic.title).toBe('Ser vs estar');
    expect(topic.sections[0].id).toBe('short');
    expect(envelope.hasConjugationDrill).toBe(true);
  });

  it('calls notFound() on a 404', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ code: 'TOPIC_NOT_FOUND' }, 404));
    await expect(fetchPublicTopic('ES', 'a2-nope')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('THROWS on a 500 instead of 404ing', async () => {
    // A transient outage must not teach Google that 312 URLs are gone.
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ code: 'INTERNAL_ERROR' }, 500));
    await expect(fetchPublicTopic('ES', 'a2-ser-vs-estar')).rejects.toThrow(/500/);
    expect(notFound).not.toHaveBeenCalled();
  });

  it('throws on a network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNRESET'));
    await expect(fetchPublicTopic('ES', 'a2-ser-vs-estar')).rejects.toThrow();
    expect(notFound).not.toHaveBeenCalled();
  });

  it('throws when the envelope fails validation', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ...TOPIC, hasConjugationDrill: 'yes' }));
    await expect(fetchPublicTopic('ES', 'a2-ser-vs-estar')).rejects.toThrow();
  });

  it('requests the public endpoint with an hour of ISR', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(TOPIC));
    await fetchPublicTopic('ES', 'a2-ser-vs-estar');
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      'https://api.test/public/theory/ES/a2-ser-vs-estar',
    );
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ next: { revalidate: 3600 } });
  });

  it('throws when no API base URL is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    await expect(fetchPublicTopic('ES', 'a2-ser-vs-estar')).rejects.toThrow(/NEXT_PUBLIC_API_URL/);
  });
});

describe('fetchPublicTopicList', () => {
  it('returns the topics array', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        topics: [
          { id: 'a2-ser-vs-estar', title: 'Ser vs estar', cefr: 'A2', subtitle: 'Two verbs.', category: 'pairs', order: 7, hasConjugationDrill: true },
        ],
      }),
    );
    const topics = await fetchPublicTopicList('ES');
    expect(topics).toHaveLength(1);
  });

  it('throws on a 500 so the hub does not render as empty', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ code: 'INTERNAL_ERROR' }, 500));
    await expect(fetchPublicTopicList('ES')).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `pnpm --filter @language-drill/web test public-theory`
Expected: FAIL — module not found.

- [ ] **Step 6: Write `public-theory.ts`**

```ts
import { notFound } from 'next/navigation';
import {
  PublicTopicListResponseSchema,
  PublicTopicEnvelopeSchema,
  type PublicTopicSummary,
  type PublicTopicEnvelope,
} from '@language-drill/api-client';
import {
  parseTheoryTopicJson,
  type PublicLanguage,
} from '@language-drill/shared';
import { renderTheoryTopicJson } from '../components/theory/render-json';
import type { TheoryTopic } from '../components/theory/types';

/**
 * Server-side reads for the public theory surface.
 *
 * The error policy is the whole point of this module, and it differs from
 * `language-landing.tsx` on purpose. That page degrades to an empty points list
 * because the list is an enhancement; here the content IS the page, so:
 *
 *   - a 404 from the API means the topic genuinely does not exist → notFound()
 *   - anything else (5xx, non-JSON, network failure, schema violation) THROWS
 *
 * A thrown error renders Next's error boundary and is not cached. Returning a
 * 404 for a transient outage would teach a crawler that 312 live URLs are gone,
 * and that is expensive to undo.
 */

const REVALIDATE_SECONDS = 3600;

function apiBase(): string {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) {
    throw new Error(
      'public theory: NEXT_PUBLIC_API_URL is not set, so no topic can be fetched server-side',
    );
  }
  return base;
}

async function getJson(path: string, onNotFound: 'notFound' | 'throw'): Promise<unknown> {
  const url = `${apiBase()}${path}`;
  const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });

  if (res.status === 404) {
    if (onNotFound === 'notFound') notFound();
    throw new Error(`public theory: ${url} returned 404`);
  }
  if (!res.ok) {
    throw new Error(`public theory: ${url} returned ${res.status}`);
  }
  return res.json();
}

export async function fetchPublicTopicList(
  lang: PublicLanguage,
): Promise<PublicTopicSummary[]> {
  const body = await getJson(`/public/theory/${lang}`, 'throw');
  return PublicTopicListResponseSchema.parse(body).topics;
}

export async function fetchPublicTopic(
  lang: PublicLanguage,
  topicId: string,
): Promise<{
  topic: TheoryTopic;
  envelope: PublicTopicEnvelope;
  readingMinutes: number;
}> {
  const body = await getJson(
    `/public/theory/${lang}/${encodeURIComponent(topicId)}`,
    'notFound',
  );
  // Envelope first (cheap, and it is what this surface added), then the article
  // through its one canonical validator.
  const envelope = PublicTopicEnvelopeSchema.parse(body);
  const json = parseTheoryTopicJson(body);
  return {
    topic: renderTheoryTopicJson(json),
    envelope,
    readingMinutes: Math.max(1, Math.round(countTopicWords(json) / 200)),
  };
}

/**
 * Word count over the article JSON, not the rendered tree: `TheorySection.body`
 * is a `ReactNode` by the time `renderTheoryTopicJson` is done, and walking
 * React children to count words is both fragile and unnecessary when the source
 * data is right here.
 *
 * Conjugation-table cells are counted as one word each — they are forms, not
 * prose, and a six-row table is not 40 words of reading.
 */
function countInlineWords(nodes: TheoryInlineJson[]): number {
  let words = 0;
  for (const node of nodes) {
    if (node.kind === 'text') {
      words += node.text.split(/\s+/).filter(Boolean).length;
    } else {
      words += countInlineWords(node.children);
    }
  }
  return words;
}

function countBlockWords(block: TheoryBlockJson): number {
  switch (block.kind) {
    case 'paragraph':
      return countInlineWords(block.text);
    case 'callout':
      return block.children.reduce((n, b) => n + countBlockWords(b), 0);
    case 'example':
      return (
        countInlineWords(block.target) +
        block.en.split(/\s+/).filter(Boolean).length +
        (block.note ? countInlineWords(block.note) : 0)
      );
    case 'list':
      return block.items.reduce(
        (n, item) => n + item.reduce((m, b) => m + countBlockWords(b), 0),
        0,
      );
    case 'conjugation-table':
      return block.head.length + block.rows.reduce((n, row) => n + row.length, 0);
  }
}

export function countTopicWords(json: TheoryTopicJson): number {
  return json.sections.reduce(
    (n, section) =>
      n +
      section.title.split(/\s+/).filter(Boolean).length +
      section.body.reduce((m, block) => m + countBlockWords(block), 0),
    json.title.split(/\s+/).filter(Boolean).length +
      json.subtitle.split(/\s+/).filter(Boolean).length,
  );
}
```

The import list at the top of the file gains the three block types:

```ts
import {
  parseTheoryTopicJson,
  type PublicLanguage,
  type TheoryTopicJson,
  type TheoryBlockJson,
  type TheoryInlineJson,
} from '@language-drill/shared';
```

Add these cases to `public-theory.test.ts`:

```ts
import { countTopicWords } from './public-theory';

describe('countTopicWords', () => {
  const json = {
    id: 'es-a2-x', title: 'Ser vs estar', subtitle: 'Two verbs here',
    cefr: 'A2',
    sections: [
      {
        id: 'short', title: 'The short version',
        body: [{ kind: 'paragraph', text: [{ kind: 'text', text: 'one two three' }] }],
      },
    ],
  } as unknown as Parameters<typeof countTopicWords>[0];

  it('counts title, subtitle, section titles and paragraph text', () => {
    // 3 (title) + 3 (subtitle) + 3 (section title) + 3 (paragraph) = 12
    expect(countTopicWords(json)).toBe(12);
  });

  it('counts nested inline nodes', () => {
    const nested = {
      ...json,
      sections: [
        {
          id: 's', title: 'T',
          body: [
            {
              kind: 'paragraph',
              text: [
                { kind: 'text', text: 'plain' },
                { kind: 'strong', children: [{ kind: 'text', text: 'bold words here' }] },
              ],
            },
          ],
        },
      ],
    } as unknown as Parameters<typeof countTopicWords>[0];
    // 3 + 3 + 1 (title "T") + 1 + 3 = 11
    expect(countTopicWords(nested)).toBe(11);
  });

  it('counts a conjugation table by cells, not by prose', () => {
    const table = {
      ...json,
      sections: [
        {
          id: 's', title: 'T',
          body: [{ kind: 'conjugation-table', head: ['', 'Preterite'], rows: [['yo', 'hablé']] }],
        },
      ],
    } as unknown as Parameters<typeof countTopicWords>[0];
    // 3 + 3 + 1 + (2 head + 2 cells) = 11
    expect(countTopicWords(table)).toBe(11);
  });
});

describe('fetchPublicTopic reading time', () => {
  it('never reports less than a minute', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(TOPIC));
    const { readingMinutes } = await fetchPublicTopic('ES', 'a2-ser-vs-estar');
    expect(readingMinutes).toBe(1);
  });
});
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `pnpm --filter @language-drill/web test public-theory public-paths`
Expected: PASS, 13 tests.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/public-paths.ts apps/web/lib/public-paths.test.ts apps/web/lib/public-theory.ts apps/web/lib/public-theory.test.ts apps/web/components/public/language-landing.tsx
git commit -m "Fetch public theory with a 404 policy a crawler can trust"
```

---

## Task 6: The grammar hub, and the middleware entry that makes it reachable

**Files:**
- Create: `apps/web/components/public/grammar/grammar-index.tsx`
- Create: `apps/web/components/public/grammar/grammar-index-search.tsx`
- Create: `apps/web/components/public/grammar/__tests__/grammar-index.test.tsx`
- Create: `apps/web/app/spanish/grammar/page.tsx`, `apps/web/app/german/grammar/page.tsx`, `apps/web/app/turkish/grammar/page.tsx`
- Modify: `apps/web/proxy.ts`
- Modify: `apps/web/__tests__/proxy.test.ts`
- Modify: `apps/web/components/public/language-landing.tsx`

**Interfaces:**
- Consumes: `fetchPublicTopicList`, `grammarIndexHref`, `grammarTopicHref`, `LANDING_PATH` (Task 5).
- Produces: `GrammarIndex({ lang }: { lang: PublicLanguage })`, and the CEFR grouping helper `groupTopicsByLevel(topics): Array<{ level: string; topics: PublicTopicSummary[] }>` exported from `grammar-index.tsx` for its test.

- [ ] **Step 1: Make the routes public FIRST**

`isPublicRoute` is the single highest-consequence line in this change: miss it and
all 312 pages redirect to sign-in. In `apps/web/proxy.ts`, replace the three bare
language entries with segment-boundary wildcards and keep the explanatory comment:

```ts
  '/spanish', // per-language landing pages: public entry points + SEO
  '/spanish/:path*', // …and everything under them (/spanish/grammar/<topic>)
  '/german',
  '/german/:path*',
  '/turkish',
  '/turkish/:path*',
```

- [ ] **Step 2: Add the test that cannot be forgotten next time**

Append to `apps/web/__tests__/proxy.test.ts`. The first test is explicit; the
second is derived from the filesystem so a *future* public page cannot ship behind
Clerk without someone deliberately editing an allow-list:

```ts
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

it('treats the grammar hub and topic pages as public', () => {
  expect(isPublicRoute(req('/spanish/grammar'))).toBe(true);
  expect(isPublicRoute(req('/german/grammar'))).toBe(true);
  expect(isPublicRoute(req('/turkish/grammar'))).toBe(true);
  expect(isPublicRoute(req('/spanish/grammar/a2-ser-vs-estar'))).toBe(true);
  expect(isPublicRoute(req('/turkish/grammar/a1-vowel-harmony'))).toBe(true);
});

it('still does not make a sibling of a language path public', () => {
  expect(isPublicRoute(req('/spanishx/grammar'))).toBe(false);
});

// Derived from the app tree rather than a hand-kept list: the failure mode this
// guards is a new public page silently 307ing to sign-in, which no build or type
// check can see. Route groups in parens are layout-only and contribute no URL
// segment, so only top-level non-group directories are candidates.
const PRIVATE_BY_DESIGN = new Set([
  'onboarding', 'sign-in', 'sign-up', 'api', 'ingest',
]);

it('treats every top-level public app directory as public', () => {
  const appDir = join(__dirname, '..', 'app');
  const candidates = readdirSync(appDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !name.startsWith('(') && !name.startsWith('_') && !name.startsWith('['))
    .filter((name) => !PRIVATE_BY_DESIGN.has(name))
    .filter((name) => existsSync(join(appDir, name, 'page.tsx')));

  const missing = candidates.filter((name) => !isPublicRoute(req(`/${name}`)));
  expect(missing).toEqual([]);
});
```

- [ ] **Step 3: Run the proxy tests**

Run: `pnpm --filter @language-drill/web test proxy`
Expected: PASS. If the derived test lists a directory, either it is genuinely
public (add it to `isPublicRoute`) or it is private (add it to
`PRIVATE_BY_DESIGN` with a one-line reason).

- [ ] **Step 4: Write the failing hub test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { groupTopicsByLevel, GrammarIndexBody } from '../grammar-index';
import type { PublicTopicSummary } from '@language-drill/api-client';

const topic = (over: Partial<PublicTopicSummary>): PublicTopicSummary => ({
  id: 'a2-preterite', title: 'Preterite', cefr: 'A2', subtitle: 'Finished events.',
  category: 'tenses', order: 3, hasConjugationDrill: false, ...over,
});

describe('groupTopicsByLevel', () => {
  it('orders levels A1→B2 and sorts within a level by curriculum order', () => {
    const groups = groupTopicsByLevel([
      topic({ id: 'b1-x', cefr: 'B1', order: 2 }),
      topic({ id: 'a1-late', cefr: 'A1', order: 9 }),
      topic({ id: 'a1-early', cefr: 'A1', order: 1 }),
    ]);
    expect(groups.map((g) => g.level)).toEqual(['A1', 'B1']);
    expect(groups[0].topics.map((t) => t.id)).toEqual(['a1-early', 'a1-late']);
  });

  it('puts a null order last and breaks the tie by title', () => {
    const groups = groupTopicsByLevel([
      topic({ id: 'z', cefr: 'A1', order: null, title: 'Zebra' }),
      topic({ id: 'a', cefr: 'A1', order: null, title: 'Apple' }),
      topic({ id: 'ordered', cefr: 'A1', order: 5, title: 'Middle' }),
    ]);
    expect(groups[0].topics.map((t) => t.id)).toEqual(['ordered', 'a', 'z']);
  });

  it('keeps an unexpected CEFR value rather than dropping the topic', () => {
    const groups = groupTopicsByLevel([topic({ cefr: 'C1' })]);
    expect(groups.map((g) => g.level)).toEqual(['C1']);
  });
});

describe('GrammarIndexBody', () => {
  it('links every topic and marks only the ones with a drill', () => {
    render(
      <GrammarIndexBody
        lang="ES"
        topics={[
          topic({ id: 'a2-preterite', title: 'Preterite', hasConjugationDrill: true }),
          topic({ id: 'a1-noun-gender', title: 'Noun gender', cefr: 'A1', hasConjugationDrill: false }),
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: /Preterite/ })).toHaveAttribute(
      'href', '/spanish/grammar/a2-preterite',
    );
    expect(screen.getByRole('link', { name: /Noun gender/ })).toHaveAttribute(
      'href', '/spanish/grammar/a1-noun-gender',
    );
    // The pill is the honest signal: only 38 of 312 topics have a public drill,
    // so it belongs here rather than as a promise on every topic page.
    const drillMarkers = screen.getAllByText(/conjugation drill/i);
    expect(drillMarkers).toHaveLength(1);
  });

  it('renders each topic subtitle, so the list is readable content not just links', () => {
    render(<GrammarIndexBody lang="ES" topics={[topic({ subtitle: 'Finished events.' })]} />);
    expect(screen.getByText('Finished events.')).toBeInTheDocument();
  });

  it('shows the per-level count', () => {
    render(
      <GrammarIndexBody lang="ES" topics={[topic({ id: 'a' }), topic({ id: 'b' })]} />,
    );
    expect(screen.getByText('2 topics')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `pnpm --filter @language-drill/web test grammar-index`
Expected: FAIL — module not found.

- [ ] **Step 6: Write the hub**

`grammar-index.tsx` exports three things: `groupTopicsByLevel` (pure, tested),
`GrammarIndexBody` (pure presentational, tested, no fetching) and the async
`GrammarIndex` (fetches, then renders the body). Splitting the fetch from the
markup is what makes the body testable without mocking `fetch`.

```tsx
import Link from 'next/link';
import { LANGUAGE_NAMES, Language, type PublicLanguage } from '@language-drill/shared';
import type { PublicTopicSummary } from '@language-drill/api-client';
import { fetchPublicTopicList } from '../../../lib/public-theory';
import { grammarTopicHref, LANDING_PATH } from '../../../lib/public-paths';
import { PublicHeader } from '../public-header';
import { GrammarIndexSearch } from './grammar-index-search';

const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const LEVEL_NAME: Record<string, string> = {
  A1: 'Beginner', A2: 'Elementary', B1: 'Intermediate',
  B2: 'Upper intermediate', C1: 'Advanced', C2: 'Mastery',
};

export type LevelGroup = { level: string; topics: PublicTopicSummary[] };

/**
 * CEFR-grouped, curriculum-ordered. A null `order` sorts last with a title
 * tie-break: `curriculumOrderOf` returns null for a key the curriculum does not
 * know, and an unstable sort would reorder the list on every ISR refresh.
 * An unrecognised CEFR value keeps its own group rather than vanishing.
 */
export function groupTopicsByLevel(topics: PublicTopicSummary[]): LevelGroup[] {
  const byLevel = new Map<string, PublicTopicSummary[]>();
  for (const topic of topics) {
    const bucket = byLevel.get(topic.cefr);
    if (bucket) bucket.push(topic);
    else byLevel.set(topic.cefr, [topic]);
  }
  return [...byLevel.entries()]
    .sort(([a], [b]) => {
      const ia = LEVEL_ORDER.indexOf(a);
      const ib = LEVEL_ORDER.indexOf(b);
      return (ia === -1 ? LEVEL_ORDER.length : ia) - (ib === -1 ? LEVEL_ORDER.length : ib);
    })
    .map(([level, group]) => ({
      level,
      topics: [...group].sort(
        (x, y) =>
          (x.order ?? Number.MAX_SAFE_INTEGER) - (y.order ?? Number.MAX_SAFE_INTEGER) ||
          x.title.localeCompare(y.title),
      ),
    }));
}

export function GrammarIndexBody({
  lang,
  topics,
}: {
  lang: PublicLanguage;
  topics: PublicTopicSummary[];
}) {
  const groups = groupTopicsByLevel(topics);
  return (
    <div data-grammar-index>
      {groups.map(({ level, topics: rows }) => (
        <section key={level} id={level.toLowerCase()} className="pt-s-5">
          <div className="flex items-baseline gap-s-3 border-b border-rule pb-s-2">
            <span className="t-mono text-[11px] tracking-[1px] text-ink-mute">{level}</span>
            <span className="t-small text-ink-soft">{LEVEL_NAME[level] ?? level}</span>
            <span className="t-small ml-auto text-ink-mute">{rows.length} topics</span>
          </div>
          <ul className="m-0 list-none p-0">
            {rows.map((topic) => (
              <li key={topic.id} data-topic-row data-search={`${topic.title} ${topic.subtitle}`.toLowerCase()}>
                <Link
                  href={grammarTopicHref(lang, topic.id)}
                  className="flex flex-col gap-[2px] border-b border-rule py-s-3 no-underline"
                >
                  <span className="t-body font-medium text-ink">{topic.title}</span>
                  <span className="t-small text-ink-mute">{topic.subtitle}</span>
                  {topic.hasConjugationDrill && (
                    <span className="t-mono text-[11px] text-accent-2">
                      free conjugation drill
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export async function GrammarIndex({ lang }: { lang: PublicLanguage }) {
  const topics = await fetchPublicTopicList(lang);
  const languageName = LANGUAGE_NAMES[lang as unknown as Language];
  return (
    <div className="mx-auto flex max-w-[860px] flex-col px-s-4 py-s-6">
      <PublicHeader
        activeLanguage={lang}
        languageHref={(l) => `${LANDING_PATH[l]}/grammar`}
      />
      <main className="flex flex-col gap-s-5 pt-s-6">
        <div className="flex flex-col gap-s-2">
          <h1 className="t-display-l">{languageName} grammar</h1>
          <p className="t-body text-ink-mute">
            {topics.length} explanations, ordered the way the course teaches them.
            Free to read, no account.
          </p>
        </div>
        <GrammarIndexSearch />
        <GrammarIndexBody lang={lang} topics={topics} />
      </main>
    </div>
  );
}
```

`grammar-index-search.tsx` is a client island that filters the already-rendered
rows, so the full list is always in the HTML:

```tsx
'use client';

import { useId, useState } from 'react';

/**
 * Filters the server-rendered rows in place via `[data-topic-row]`. The list is
 * NOT re-rendered from state: the complete set of topics must stay in the HTML
 * for a crawler, so search is an enhancement over markup that already exists.
 */
export function GrammarIndexSearch() {
  const id = useId();
  const [query, setQuery] = useState('');

  function onChange(value: string) {
    setQuery(value);
    const needle = value.trim().toLowerCase();
    const rows = document.querySelectorAll<HTMLElement>('[data-topic-row]');
    for (const row of rows) {
      const hit = !needle || (row.dataset.search ?? '').includes(needle);
      row.hidden = !hit;
    }
    for (const section of document.querySelectorAll<HTMLElement>('[data-grammar-index] section')) {
      const anyVisible = [...section.querySelectorAll<HTMLElement>('[data-topic-row]')].some(
        (r) => !r.hidden,
      );
      section.hidden = !anyVisible;
    }
  }

  return (
    <div className="flex flex-col gap-s-2">
      <label htmlFor={id} className="t-small text-ink-mute">
        Search topics
      </label>
      <input
        id={id}
        type="search"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="subjunctive, past tense, cases…"
        className="rounded-md border border-rule bg-card px-s-3 py-s-2 text-ink"
      />
    </div>
  );
}
```

- [ ] **Step 7: Add the three hub routes**

`apps/web/app/spanish/grammar/page.tsx` (and the two siblings, with `lang` and
the copy changed):

```tsx
import type { Metadata } from 'next';
import { GrammarIndex } from '../../../components/public/grammar/grammar-index';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Spanish grammar explained — every topic, A1 to B2',
  description:
    'Clear explanations of Spanish grammar, ordered the way a course teaches it: '
    + 'tenses, moods, pronouns and word forms, each with examples. Free, no signup.',
  alternates: { canonical: '/spanish/grammar' },
};

export default function SpanishGrammarIndexPage() {
  return <GrammarIndex lang="ES" />;
}
```

- [ ] **Step 8: Link the hub from the language landing**

In `apps/web/components/public/language-landing.tsx`, add a link to
`grammarIndexHref(lang)` in the "What you can drill" area, worded as reading
rather than drilling (e.g. `Grammar explained →`). This edge is what makes the
hub reachable by a crawler from an already-indexed page.

- [ ] **Step 9: Run the tests**

Run: `pnpm --filter @language-drill/web test grammar-index proxy`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/components/public/grammar apps/web/app/spanish/grammar apps/web/app/german/grammar apps/web/app/turkish/grammar apps/web/proxy.ts apps/web/__tests__/proxy.test.ts apps/web/components/public/language-landing.tsx
git commit -m "A grammar index a stranger can read, and a test that keeps it public"
```

---

## Task 7: The topic page

**Files:**
- Create: `apps/web/components/public/grammar/grammar-topic.tsx`
- Create: `apps/web/components/public/grammar/topic-breadcrumbs.tsx`
- Create: `apps/web/components/public/grammar/topic-toc.tsx`
- Create: `apps/web/components/public/grammar/practice-rail.tsx`
- Create: `apps/web/components/public/grammar/related-topics-grid.tsx`
- Create: `apps/web/components/public/grammar/__tests__/grammar-topic.test.tsx`
- Create: `apps/web/app/{spanish,german,turkish}/grammar/[topicId]/page.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `fetchPublicTopic`, `grammarTopicHref`, `tryFormsHref`, `LANGUAGE_FOR_PATH` (Task 5); `TheorySections` from `components/theory/theory-sections`; `PublicHeader`; `AppFooter`.
- Produces: `GrammarTopic({ lang, topicId })`, `TopicPager`, `PracticeRail`, `TopicBreadcrumbs`.

- [ ] **Step 1: Add the public article typography**

Append to `apps/web/app/globals.css`, next to the existing `.theory-*` rules:

```css
/* ─── Theory: public long-form variant ───
   The in-app `.theory-*` scale (15px/1.65, 24px titles) is tuned for a sidebar
   panel next to a drill. A public page is an article a stranger reads on a
   phone, so it steps up. Same tokens, different scale — no forked renderer. */
.theory-public .theory-content {
  font-size: 17px;
  line-height: 1.7;
}
.theory-public .theory-section {
  border-bottom: 0;
  padding: var(--spacing-s-4) 0;
}
.theory-public .theory-section-title {
  font-size: 28px;
  letter-spacing: -0.4px;
  scroll-margin-top: 90px;
}
@media (max-width: 560px) {
  .theory-public .theory-content { font-size: 16px; }
  .theory-public .theory-section-title { font-size: 24px; }
}
```

- [ ] **Step 2: Write the failing tests**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PracticeRail } from '../practice-rail';
import { TopicPager, type PagerNeighbour } from '../grammar-topic';
import { TopicBreadcrumbs } from '../topic-breadcrumbs';

describe('PracticeRail', () => {
  it('offers the drill aimed at this point when one exists', () => {
    render(
      <PracticeRail
        lang="ES"
        cefr="A2"
        grammarPointKey="es-a2-preterite"
        hasConjugationDrill
      />,
    );
    expect(screen.getByRole('link', { name: /start drilling/i })).toHaveAttribute(
      'href', '/try/forms?lang=ES&level=A2&point=es-a2-preterite',
    );
  });

  it('offers only sign-up when the point has no public drill', () => {
    // True of 274 of 312 topics. Showing a drill card here would be a promise
    // the pool cannot keep.
    render(
      <PracticeRail
        lang="ES"
        cefr="A2"
        grammarPointKey="es-a2-noun-gender"
        hasConjugationDrill={false}
      />,
    );
    expect(screen.queryByRole('link', { name: /start drilling/i })).toBeNull();
    expect(screen.getByRole('link', { name: /sign up/i })).toBeInTheDocument();
  });

  it('never offers a coached session, which does not exist yet', () => {
    render(
      <PracticeRail lang="ES" cefr="A2" grammarPointKey="es-a2-x" hasConjugationDrill />,
    );
    expect(screen.queryByText(/coached/i)).toBeNull();
  });
});

describe('TopicPager', () => {
  const prev: PagerNeighbour = { id: 'a2-imperfect', title: 'Imperfect', cefr: 'A2' };
  const next: PagerNeighbour = { id: 'a2-dop', title: 'Direct object pronouns', cefr: 'A2' };

  it('links both neighbours', () => {
    render(<TopicPager lang="ES" previous={prev} next={next} />);
    expect(screen.getByRole('link', { name: /Imperfect/ })).toHaveAttribute(
      'href', '/spanish/grammar/a2-imperfect',
    );
    expect(screen.getByRole('link', { name: /Direct object pronouns/ })).toHaveAttribute(
      'href', '/spanish/grammar/a2-dop',
    );
  });

  it('renders one arm at the edge of a level', () => {
    render(<TopicPager lang="ES" previous={null} next={next} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('renders nothing when a level has a single topic', () => {
    const { container } = render(<TopicPager lang="ES" previous={null} next={null} />);
    expect(container.querySelector('nav')).toBeNull();
  });
});

describe('TopicBreadcrumbs', () => {
  it('emits a BreadcrumbList with the topic last', () => {
    render(<TopicBreadcrumbs lang="ES" cefr="A2" title="Ser vs estar" />);
    const script = document.querySelector('script[type="application/ld+json"]');
    const data = JSON.parse(script!.textContent!);
    expect(data['@type']).toBe('BreadcrumbList');
    expect(data.itemListElement).toHaveLength(3);
    expect(data.itemListElement[2].name).toBe('Ser vs estar');
    expect(data.itemListElement[1].item).toContain('/spanish/grammar');
  });
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `pnpm --filter @language-drill/web test grammar-topic`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write the pieces**

`practice-rail.tsx`:

```tsx
import Link from 'next/link';
import type { PublicLanguage, PublicLevel } from '@language-drill/shared';
import { tryFormsHref } from '../../../lib/public-paths';

/**
 * The drill card renders only when the point genuinely has a public
 * conjugation pool — true of 38 of 312 topics. On the rest the rail is the
 * sign-up box alone, which is the honest state; the index's per-topic pill is
 * where a reader learns which topics are drillable.
 *
 * There is deliberately no "coached session" card: that surface is specced but
 * not built, and offering it would be the one thing the public pages must never
 * do — promise something that does not exist.
 */
export function PracticeRail({
  lang,
  cefr,
  grammarPointKey,
  hasConjugationDrill,
}: {
  lang: PublicLanguage;
  cefr: string;
  grammarPointKey: string;
  hasConjugationDrill: boolean;
}) {
  return (
    <aside aria-label="Practise" className="flex flex-col gap-s-3">
      <div className="t-mono text-[11px] tracking-[1.6px] text-ink-mute uppercase">
        Practise this topic
      </div>
      {hasConjugationDrill && (
        <Link
          href={tryFormsHref(lang, cefr as PublicLevel, grammarPointKey)}
          className="flex flex-col gap-s-2 rounded-lg border border-rule bg-card p-s-4 no-underline"
        >
          <span className="t-mono text-[11px] text-accent-2">free · unlimited</span>
          <span className="t-body font-medium text-ink">Drill these forms</span>
          <span className="t-small text-ink-mute">
            Type each form, graded the moment you press enter. No account needed.
          </span>
          <span className="t-small text-accent-2">Start drilling →</span>
        </Link>
      )}
      <div className="rounded-lg border border-dashed border-rule-strong p-s-4">
        <p className="t-small m-0 text-ink-soft">
          With a free account, drill tracks this topic and brings it back when you
          start to slip.
        </p>
        <Link href="/sign-up" className="link-arrow mt-s-3 inline-flex">
          Sign up free
        </Link>
      </div>
    </aside>
  );
}
```

`topic-breadcrumbs.tsx`:

```tsx
import Link from 'next/link';
import { LANGUAGE_NAMES, Language, type PublicLanguage } from '@language-drill/shared';
import { grammarIndexHref } from '../../../lib/public-paths';

const SITE = 'https://www.langdrill.app';

export function TopicBreadcrumbs({
  lang,
  cefr,
  title,
}: {
  lang: PublicLanguage;
  cefr: string;
  title: string;
}) {
  const languageName = LANGUAGE_NAMES[lang as unknown as Language];
  const hub = grammarIndexHref(lang);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'drill', item: SITE },
      { '@type': 'ListItem', position: 2, name: `${languageName} grammar`, item: `${SITE}${hub}` },
      { '@type': 'ListItem', position: 3, name: title },
    ],
  };
  return (
    <>
      <nav aria-label="Breadcrumb" className="t-small text-ink-mute">
        <ol className="m-0 flex list-none flex-wrap gap-s-2 p-0">
          <li><Link href="/" className="text-ink-mute">drill</Link></li>
          <li aria-hidden="true">›</li>
          <li><Link href={hub} className="text-ink-mute">{languageName} grammar</Link></li>
          <li aria-hidden="true">›</li>
          <li><Link href={`${hub}#${cefr.toLowerCase()}`} className="text-ink-mute">{cefr}</Link></li>
          <li aria-hidden="true">›</li>
          <li aria-current="page" className="text-ink">{title}</li>
        </ol>
      </nav>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
```

`topic-toc.tsx` — a client component that renders real anchors, so the SSR
output carries them and the spy is pure enhancement:

```tsx
'use client';

import { useEffect, useState } from 'react';

/**
 * Anchors are rendered server-side (a client component is still SSR'd), so the
 * TOC works with JS disabled and a crawler sees the section links. The
 * IntersectionObserver only adds the current-section highlight.
 */
export function TopicToc({ sections }: { sections: { id: string; title: string }[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const headings = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    for (const h of headings) io.observe(h);
    return () => io.disconnect();
  }, [sections]);

  return (
    <nav aria-label="On this page" className="sticky top-[96px]">
      <div className="t-mono text-[11px] tracking-[1.6px] text-ink-mute uppercase">
        On this page
      </div>
      <ol className="m-0 mt-s-2 flex list-none flex-col gap-[2px] border-l border-rule p-0">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              aria-current={activeId === s.id ? 'true' : undefined}
              className={
                activeId === s.id
                  ? 'block border-l-2 border-accent py-[7px] pl-[14px] text-ink no-underline'
                  : 'block border-l-2 border-transparent py-[7px] pl-[14px] text-ink-soft no-underline hover:text-ink'
              }
            >
              {s.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
```

`related-topics-grid.tsx` renders the API's `related` groups as plain `<a>` cards
to `grammarTopicHref(lang, ref.topicId)`, with the group heading from whichever
groups are non-empty, and renders nothing when all three are empty.

`grammar-topic.tsx` composes everything and exports `TopicPager` +
`PagerNeighbour`. The pager neighbours come from the hub list, which the page
already needs for nothing else — so fetch it in parallel with the topic:

```tsx
export type PagerNeighbour = { id: string; title: string; cefr: string };

/** Neighbours within the same CEFR level, in the hub's own sort order. */
export function pagerNeighbours(
  topics: PublicTopicSummary[],
  current: { id: string; cefr: string },
): { previous: PagerNeighbour | null; next: PagerNeighbour | null } {
  const sameLevel = topics
    .filter((t) => t.cefr === current.cefr)
    .sort(
      (x, y) =>
        (x.order ?? Number.MAX_SAFE_INTEGER) - (y.order ?? Number.MAX_SAFE_INTEGER) ||
        x.title.localeCompare(y.title),
    );
  const i = sameLevel.findIndex((t) => t.id === current.id);
  if (i === -1) return { previous: null, next: null };
  const at = (n: number): PagerNeighbour | null => {
    const t = sameLevel[n];
    return t ? { id: t.id, title: t.title, cefr: t.cefr } : null;
  };
  return { previous: at(i - 1), next: at(i + 1) };
}
```

The page body wraps the article in `<div className="theory-public theory-body">`,
renders `TheorySections` with `onSwitchTopic={() => {}}` (the public page
navigates by link, not in place), and places `QuickCheck` (Task 8) after the
sections.

- [ ] **Step 5: Add the three topic routes with `generateMetadata`**

`apps/web/app/spanish/grammar/[topicId]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { GrammarTopic } from '../../../../components/public/grammar/grammar-topic';
import { fetchPublicTopic } from '../../../../lib/public-theory';
import { grammarTopicHref } from '../../../../lib/public-paths';

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topicId: string }>;
}): Promise<Metadata> {
  const { topicId } = await params;
  const { topic } = await fetchPublicTopic('ES', decodeURIComponent(topicId));
  return {
    title: `${topic.title} in Spanish: ${topic.cefr} grammar explained`,
    description: topic.subtitle,
    alternates: { canonical: grammarTopicHref('ES', topic.id) },
  };
}

export default async function SpanishGrammarTopicPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId } = await params;
  return <GrammarTopic lang="ES" topicId={decodeURIComponent(topicId)} />;
}
```

Note: `generateMetadata` and the page both call `fetchPublicTopic`; Next dedupes
identical `fetch` calls within a render, so this is one request.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @language-drill/web test grammar-topic`
Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/public/grammar apps/web/app/spanish/grammar apps/web/app/german/grammar apps/web/app/turkish/grammar apps/web/app/globals.css
git commit -m "Render a theory topic as an article, not a hydration shell"
```

---

## Task 8: The quick check

**Files:**
- Create: `apps/web/components/public/grammar/quick-check.tsx`
- Create: `apps/web/components/public/grammar/__tests__/quick-check.test.tsx`
- Modify: `apps/web/components/public/grammar/grammar-topic.tsx`

**Interfaces:**
- Consumes: `QuickCheckItem` (Task 4); `gradeFluencyAnswer` from `@language-drill/shared`.
- Produces: `QuickCheck({ items, drillHref }: { items: QuickCheckItem[]; drillHref: string | null })` — renders `null` when `items` is empty.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickCheck } from '../quick-check';
import type { QuickCheckItem } from '@language-drill/api-client';

const items: QuickCheckItem[] = [
  { sentence: 'Ayer ___ en un restaurante.', instructions: 'Type the preterite.', correctAnswer: 'comí', acceptableAnswers: [] },
  { sentence: 'De niño ___ en casa.', instructions: 'Type the imperfect.', correctAnswer: 'comía', acceptableAnswers: [] },
  { sentence: 'Hoy ___ cansado.', instructions: 'Type the present.', correctAnswer: 'estoy', acceptableAnswers: [] },
];

describe('QuickCheck', () => {
  it('renders nothing when there are no items', () => {
    // 97 of 312 topics have no usable rows; the section must be absent, not empty.
    const { container } = render(<QuickCheck items={[]} drillHref={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('accepts the correct answer', async () => {
    render(<QuickCheck items={items} drillHref={null} />);
    await userEvent.type(screen.getByRole('textbox'), 'comí');
    await userEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(screen.getByText(/right/i)).toBeInTheDocument();
  });

  it('rejects a wrong answer and shows the correct form', async () => {
    render(<QuickCheck items={items} drillHref={null} />);
    await userEvent.type(screen.getByRole('textbox'), 'comía');
    await userEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(screen.getByText(/not quite/i)).toBeInTheDocument();
    expect(screen.getByText('comí')).toBeInTheDocument();
  });

  it('treats a missing accent as wrong', async () => {
    // gradeFluencyAnswer does not strip diacritics: é/ü/ı are meaningful.
    render(<QuickCheck items={items} drillHref={null} />);
    await userEvent.type(screen.getByRole('textbox'), 'comi');
    await userEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(screen.getByText(/not quite/i)).toBeInTheDocument();
  });

  it('accepts a trailing period and different case', async () => {
    render(<QuickCheck items={items} drillHref={null} />);
    await userEvent.type(screen.getByRole('textbox'), 'Comí.');
    await userEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(screen.getByText(/right/i)).toBeInTheDocument();
  });

  it('shows a score after the last item and offers the drill when there is one', async () => {
    render(<QuickCheck items={items} drillHref="/try/forms?lang=ES&level=A2" />);
    for (const answer of ['comí', 'comía', 'estoy']) {
      await userEvent.type(screen.getByRole('textbox'), answer);
      await userEvent.click(screen.getByRole('button', { name: /check/i }));
      await userEvent.click(screen.getByRole('button', { name: /next|see result/i }));
    }
    expect(screen.getByText(/3 of 3/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /drill/i })).toHaveAttribute(
      'href', '/try/forms?lang=ES&level=A2',
    );
  });

  it('does not offer a drill link when the point has no pool', async () => {
    render(<QuickCheck items={items} drillHref={null} />);
    for (const answer of ['x', 'y', 'z']) {
      await userEvent.type(screen.getByRole('textbox'), answer);
      await userEvent.click(screen.getByRole('button', { name: /check/i }));
      await userEvent.click(screen.getByRole('button', { name: /next|see result/i }));
    }
    expect(screen.getByText(/0 of 3/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /drill/i })).toBeNull();
  });

  it('ignores a submit with an empty field', async () => {
    render(<QuickCheck items={items} drillHref={null} />);
    expect(screen.getByRole('button', { name: /check/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @language-drill/web test quick-check`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `quick-check.tsx`**

Grade with `gradeFluencyAnswer`, never a hand-rolled comparison — it already
handles NFC normalisation, whitespace collapsing, trailing punctuation and the
Turkish İ/I double case-fold, and it is the same function the public conjugation
drill uses.

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { gradeFluencyAnswer, type ExerciseContent } from '@language-drill/shared';
import type { QuickCheckItem } from '@language-drill/api-client';

/**
 * Three cloze sentences from the approved pool, graded in the browser — no LLM
 * call, no account, nothing stored.
 *
 * Grading delegates to `gradeFluencyAnswer`, the same pure function the public
 * conjugation drill and the authenticated fluency mode use. Writing a
 * `toLowerCase() === ` comparison here would silently disagree with the rest of
 * the product on diacritics and on Turkish İ/I.
 */
export function QuickCheck({
  items,
  drillHref,
}: {
  items: QuickCheckItem[];
  drillHref: string | null;
}) {
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState('');
  const [results, setResults] = useState<boolean[]>([]);
  const [showFeedback, setShowFeedback] = useState(false);

  if (items.length === 0) return null;

  const done = index >= items.length;
  const item = done ? null : items[index];

  function check() {
    if (!item || !typed.trim()) return;
    const content = {
      type: 'cloze',
      correctAnswer: item.correctAnswer,
      acceptableAnswers: item.acceptableAnswers,
    } as unknown as ExerciseContent;
    setResults((prev) => [...prev, gradeFluencyAnswer(content, typed)]);
    setShowFeedback(true);
  }

  function advance() {
    setShowFeedback(false);
    setTyped('');
    setIndex((i) => i + 1);
  }

  if (done) {
    const correct = results.filter(Boolean).length;
    return (
      <section aria-label="Quick check" className="rounded-lg border border-rule bg-card p-s-4">
        <p className="t-display-s m-0 text-ink">{correct} of {items.length} right.</p>
        <p className="t-small text-ink-soft">
          {correct === items.length
            ? 'Solid. Lock it in with a longer set.'
            : 'Worth another round.'}
        </p>
        <div className="flex flex-wrap gap-s-3">
          {drillHref && (
            <Link href={drillHref} className="link-arrow">
              Continue in the conjugation drill
            </Link>
          )}
          <button
            type="button"
            onClick={() => { setIndex(0); setResults([]); setTyped(''); setShowFeedback(false); }}
            className="t-small text-ink-mute underline underline-offset-2"
          >
            Try again
          </button>
        </div>
      </section>
    );
  }

  const lastResult = results[results.length - 1];

  return (
    <section aria-label="Quick check" className="rounded-lg border border-rule bg-card p-s-4">
      <div className="t-mono text-[11px] text-ink-mute">{index + 1} / {items.length}</div>
      <p className="t-display-s m-0 text-ink">{item!.sentence}</p>
      <p className="t-small text-ink-mute">{item!.instructions}</p>
      {!showFeedback ? (
        <div className="flex gap-s-3">
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') check(); }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Your answer"
            className="flex-1 rounded-md border border-rule bg-paper px-s-3 py-s-2 text-ink"
          />
          <button
            type="button"
            onClick={check}
            disabled={!typed.trim()}
            className="rounded-md bg-ink px-s-4 py-s-2 text-paper disabled:opacity-50"
          >
            Check
          </button>
        </div>
      ) : (
        <div className={lastResult ? 'text-ok' : 'text-accent-2'}>
          <p className="t-body m-0">{lastResult ? 'Right.' : 'Not quite.'}</p>
          {!lastResult && <p className="t-body m-0 text-ink">{item!.correctAnswer}</p>}
          <button type="button" onClick={advance} className="link-arrow mt-s-3">
            {index === items.length - 1 ? 'See result' : 'Next'}
          </button>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Mount it in the topic page**

In `grammar-topic.tsx`, after `<TheorySections …/>`:

```tsx
<QuickCheck
  items={envelope.quickCheck}
  drillHref={
    envelope.hasConjugationDrill
      ? tryFormsHref(lang, topic.cefr as PublicLevel, topic.id)
      : null
  }
/>
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @language-drill/web test quick-check grammar-topic`
Expected: PASS, 16 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/public/grammar
git commit -m "Let a reader test the rule they just read, without an account"
```

---

## Task 9: Sitemap and robots

**Files:**
- Modify: `apps/web/app/sitemap.ts`
- Modify: `apps/web/app/robots.ts`
- Create: `apps/web/app/__tests__/sitemap.test.ts`

**Interfaces:**
- Consumes: `fetchPublicTopicList`, `grammarIndexHref`, `grammarTopicHref`.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/public-theory', () => ({
  fetchPublicTopicList: vi.fn(),
}));

import { fetchPublicTopicList } from '../../lib/public-theory';
import sitemap from '../sitemap';

const topic = (id: string) => ({
  id, title: id, cefr: 'A2', subtitle: 's', category: 'tenses', order: 1,
  hasConjugationDrill: false,
});

beforeEach(() => vi.clearAllMocks());

describe('sitemap', () => {
  it('lists the three hubs and every topic', async () => {
    vi.mocked(fetchPublicTopicList).mockImplementation(async (lang) =>
      lang === 'ES' ? [topic('a2-ser-vs-estar')] : [],
    );
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain('https://www.langdrill.app/spanish/grammar');
    expect(urls).toContain('https://www.langdrill.app/german/grammar');
    expect(urls).toContain('https://www.langdrill.app/turkish/grammar');
    expect(urls).toContain('https://www.langdrill.app/spanish/grammar/a2-ser-vs-estar');
  });

  it('keeps the pre-existing entries', async () => {
    vi.mocked(fetchPublicTopicList).mockResolvedValue([]);
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain('https://www.langdrill.app/');
    expect(urls).toContain('https://www.langdrill.app/try/forms');
  });

  it('still returns the static entries when a language list fails', async () => {
    // A sitemap that throws is a sitemap Google cannot read at all. Losing one
    // language's topics is strictly better than losing every URL.
    vi.mocked(fetchPublicTopicList).mockRejectedValue(new Error('500'));
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain('https://www.langdrill.app/');
    expect(urls).not.toContain('https://www.langdrill.app/spanish/grammar/a2-ser-vs-estar');
  });

  it('emits no duplicate URLs', async () => {
    vi.mocked(fetchPublicTopicList).mockResolvedValue([topic('a2-x')]);
    const urls = (await sitemap()).map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @language-drill/web test sitemap`
Expected: FAIL — `sitemap()` is not async / returns only 7 entries.

- [ ] **Step 3: Make the sitemap async**

Keep the existing 7 entries and the file's explanatory comment, then append the
grammar surface. Note the deliberate difference from `fetchPublicTopicList`'s
usual contract: here a failure is swallowed per language, because a thrown
sitemap is worse than an incomplete one.

```ts
import type { MetadataRoute } from 'next';
import type { PublicLanguage } from '@language-drill/shared';
import { fetchPublicTopicList } from '../lib/public-theory';
import { grammarIndexHref, grammarTopicHref } from '../lib/public-paths';

export const revalidate = 3600;

const LANGS: PublicLanguage[] = ['ES', 'DE', 'TR'];

async function grammarEntries(now: Date): Promise<MetadataRoute.Sitemap> {
  const perLanguage = await Promise.all(
    LANGS.map(async (lang) => {
      const hub = {
        url: `${SITE}${grammarIndexHref(lang)}`,
        lastModified: now,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      };
      try {
        const topics = await fetchPublicTopicList(lang);
        return [
          hub,
          ...topics.map((t) => ({
            url: `${SITE}${grammarTopicHref(lang, t.id)}`,
            lastModified: now,
            changeFrequency: 'monthly' as const,
            priority: 0.6,
          })),
        ];
      } catch {
        // The hub is still a real URL even when the list read fails.
        return [hub];
      }
    }),
  );
  return perLanguage.flat();
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  return [
    /* …the seven existing entries, unchanged… */
    ...(await grammarEntries(now)),
  ];
}
```

- [ ] **Step 4: Disallow the authenticated theory surface**

In `apps/web/app/robots.ts`, add `'/theory'` to the disallow array and extend the
comment: it 307s to sign-in anyway, so this is crawl budget, not access control.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @language-drill/web test sitemap`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/sitemap.ts apps/web/app/robots.ts apps/web/app/__tests__/sitemap.test.ts
git commit -m "Put 312 grammar pages in the sitemap, and stop spending crawl budget on sign-in"
```

---

## Task 10: Prove it works as a page, not just as a test suite

The only check that can see this feature's whole point is whether the *server*
HTML contains the article. Nothing above can see the difference between a page
that renders on the server and one that fills in after hydration.

**Files:**
- Create: `apps/web/e2e/public-grammar.spec.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the E2E spec**

```ts
import { test, expect } from '@playwright/test';

// The `unauthenticated` project — these pages must work with no session at all.
test.use({ storageState: { cookies: [], origins: [] } });

test('the grammar hub lists topics without a session', async ({ page }) => {
  const response = await page.goto('/spanish/grammar');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/spanish\/grammar$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/grammar/i);
  const links = page.locator('[data-topic-row] a');
  expect(await links.count()).toBeGreaterThan(20);
});

test('a topic page renders its article and does not redirect', async ({ page }) => {
  await page.goto('/spanish/grammar');
  const first = page.locator('[data-topic-row] a').first();
  const href = await first.getAttribute('href');
  const response = await page.goto(href!);
  expect(response?.status()).toBe(200);
  await expect(page).not.toHaveURL(/sign-in/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.theory-section')).not.toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'On this page' })).toBeVisible();
});

test('search filters the list without removing it from the document', async ({ page }) => {
  await page.goto('/spanish/grammar');
  const total = await page.locator('[data-topic-row]').count();
  await page.getByLabel('Search topics').fill('zzzzznotatopic');
  await expect(page.locator('[data-topic-row]:visible')).toHaveCount(0);
  // Still in the DOM — the crawler's copy of the list is the markup, not state.
  expect(await page.locator('[data-topic-row]').count()).toBe(total);
});
```

- [ ] **Step 2: Run the E2E suite**

Run: `pnpm --filter @language-drill/web test:e2e public-grammar`
Expected: PASS. A redirect to sign-in means `isPublicRoute` is wrong.

- [ ] **Step 3: Run the full pre-push gate**

Run, from the repo root, each separately (a single full `pnpm test` has been
killed on this machine before):

```bash
pnpm lint
pnpm typecheck
pnpm --filter @language-drill/shared test
pnpm --filter @language-drill/api-client test
pnpm --filter @language-drill/lambda test
pnpm --filter @language-drill/web test
```

Expected: zero failures. Report counts per package.

- [ ] **Step 4: Verify server-rendered HTML on the dev stack**

This is the acceptance criterion for the whole plan. After the branch is deployed
to dev, with `JS DISABLED` by virtue of using curl:

```bash
URL="https://<dev-web-host>/spanish/grammar/a2-ser-vs-estar"
curl -s "$URL" -o /tmp/topic.html
grep -c '<h1' /tmp/topic.html                        # expect >= 1
grep -o 'theory-section' /tmp/topic.html | wc -l     # expect >= 1 per section
grep -c '/spanish/grammar/' /tmp/topic.html          # expect >= 2 (breadcrumb + related/pager)
grep -c 'BreadcrumbList' /tmp/topic.html             # expect 1
curl -s -o /dev/null -w '%{http_code}\n' "$URL"      # expect 200, never 307
curl -s "https://<dev-web-host>/spanish/grammar" | grep -c 'data-topic-row'  # expect >= 80
```

Do **not** pipe a command whose exit status matters through another command —
the pipeline reports the last command's status, which has previously turned a
failed deploy into a reported success. Check the effect, not the exit code.

Also confirm the article prose itself is present, not merely the shell: pick a
distinctive phrase from the topic's first paragraph in the DB and grep for it.

- [ ] **Step 5: Document the surface**

Add to `CLAUDE.md`, in the access-control section next to the `/admin/labeling`
entry:

```markdown
- `/spanish/grammar`, `/german/grammar`, `/turkish/grammar` (+ `/<lang>/grammar/<topic-id>`)
  — the public, unauthenticated theory library: 312 server-rendered pages served from
  `GET /public/theory/*`. Only 38 topics have a public conjugation drill, so the
  per-topic pill on the index is load-bearing — never promise a drill on a topic page
  without `hasConjugationDrill`. See
  `docs/superpowers/specs/2026-10-04-public-theory-pages-design.md`.
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e/public-grammar.spec.ts CLAUDE.md
git commit -m "Prove the grammar pages render server-side, and write the surface down"
```

---

## Self-review

**Spec coverage.** §A → Tasks 1–3. §B → Tasks 5–7. §C → Tasks 7–8. §D → Task 6.
§E → Tasks 2, 8. §F → Task 7 Step 1 (tokens) and throughout. §G → Tasks 6, 9.
§H → every task, plus Task 10. §I risks: middleware omission → Task 6 Steps 1–3;
the throttle and AI-content risks are operational, not implementable, and stay in
the spec. §J deferred items are deliberately absent from this plan.

Two spec refinements were made before writing this plan and are now in the spec
itself: the `subtitle` guard moved from SQL into the public route (so the
shipped authenticated response stays byte-identical), and
`PUBLIC_LEVELS_BY_LANGUAGE` moves to `packages/shared` (the Lambda has no
dependency on `api-client`).

**Placeholder scan.** One real failure was found and fixed rather than passed on:
the reading-time step originally described `countTopicWords` in prose instead of
showing it, which is exactly the "describes what to do without showing how"
pattern. Task 5 Step 6 now carries the full recursive implementation over
`TheoryBlockJson`/`TheoryInlineJson` and its tests, including the decision to
count conjugation-table cells as one word each. No `TBD`, `TODO`, "handle edge
cases" or "similar to Task N" remains.

**Type consistency.** `PublicTopicSummary` fields are identical in Tasks 3, 4, 6
and 9. `QuickCheckItem` is identical in Tasks 2, 4 and 8. `fetchPublicTopic`
returns `{ topic, envelope }` in Task 5 and is consumed as `{ topic, envelope }`
in Tasks 7 and 8. `hasConjugationDrill` is the one name used end to end — never
`hasDrill` or `hasConjugation`. `grammarTopicHref(lang, topicId)` has one
signature everywhere.
