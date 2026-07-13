# Cross-user base-gloss cache — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache the lemma-level base gloss for reading annotations in a cross-user `(language, lemma)` table so the skim pass serves cached words instantly and calls the LLM only for cache misses (skipping it entirely when a passage is fully warm).

**Architecture:** A new `gloss_cache` Postgres table keyed on `(language, lemma)` holds `base_gloss` + `pos` + `cefr` + `freq_rank`. The streaming skim handler looks up all candidate lemmas up front, emits cache hits as `flag` events before contacting Claude, and sends only the misses to `streamAnnotation`; miss results and every resolved deep-card `baseGloss` write through to the cache. A one-off CLI seeds the cache from the existing `user_vocabulary` corpus.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres/Neon), Hono + AWS Lambda streaming, Anthropic SDK, Vitest.

## Global Constraints

- Node/TS monorepo via pnpm workspaces + Turborepo. Run commands from the worktree root `/Users/seal/dev/language-drill/.claude/worktrees/feat+base-gloss-cache`. Use worktree-relative or worktree-absolute paths for every edit (main-repo absolute paths silently write to the main checkout).
- `packages/ai` source MUST NOT import `@language-drill/db`. All cache reads/writes live in the lambda (`infra/lambda`) and db packages.
- Editing any `*_SYSTEM_PROMPT` constant requires bumping its `*_PROMPT_VERSION` to today's date (`<surface>@2026-07-13`) in the same commit (see CLAUDE.md → Prompt Editing). Tool-schema (`input_schema`) description edits ship with the code deploy and need no Langfuse sync; `ANNOTATE_SYSTEM_PROMPT` text edits additionally require a post-merge `push-prompts` sync per environment.
- Pre-push gate (must be green before any PR): `pnpm lint`, `pnpm typecheck`, `pnpm test` from the worktree root.
- Migrations are forward-only. `gloss_cache` PK is `(language, lemma)`. `cefr` is nullable; a lookup row whose `cefr` is null is NOT a valid skim hit (treated as a miss).
- If `db:generate` produces a migration whose `NNNN` number already exists on `origin/main`, resolve by taking main's `migrations/meta`, `git rm` the stale `.sql`, and regenerate (migration-renumber-on-merge convention).

---

### Task 1: `gloss_cache` schema + migration

**Files:**
- Create: `packages/db/src/schema/gloss-cache.ts`
- Create: `packages/db/src/schema/gloss-cache.test.ts`
- Modify: `packages/db/src/schema/index.ts` (add export)
- Generated: `packages/db/migrations/NNNN_*.sql` (+ `migrations/meta` update)

**Interfaces:**
- Produces:
  - `glossCache` — Drizzle pgTable, PK `(language, lemma)`.
  - `type GlossCacheRow = typeof glossCache.$inferSelect`
  - `type NewGlossCacheRow = typeof glossCache.$inferInsert`
  - Columns: `language: LearningLanguage`, `lemma: string`, `baseGloss: string`, `pos: string`, `cefr: CefrLevel | null`, `freqRank: number | null`, `source: 'skim'|'deep'|'seed'`, `promptVersion: string | null`, `createdAt`, `updatedAt`.

- [ ] **Step 1: Write the failing test**

`packages/db/src/schema/gloss-cache.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { glossCache } from './gloss-cache';

describe('glossCache schema', () => {
  it('exposes the expected columns', () => {
    const cols = Object.keys(getTableColumns(glossCache)).sort();
    expect(cols).toEqual(
      [
        'baseGloss',
        'cefr',
        'createdAt',
        'freqRank',
        'language',
        'lemma',
        'pos',
        'promptVersion',
        'source',
        'updatedAt',
      ].sort(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db exec vitest run src/schema/gloss-cache.test.ts`
Expected: FAIL — cannot find module `./gloss-cache`.

- [ ] **Step 3: Write the schema module**

`packages/db/src/schema/gloss-cache.ts`:
```ts
// ---------------------------------------------------------------------------
// Cross-user base-gloss cache
// ---------------------------------------------------------------------------
// One row per (language, lemma). `base_gloss` is the lemma's dictionary meaning
// (top 1–2 senses) shared across all users and texts — the sentence-specific
// sense is never cached (deep cards compute `contextualSense` fresh). Written
// by the skim annotation pass (misses), resolved deep cards, and a one-off
// seed from user_vocabulary. `cefr` is nullable; a null-cefr row is not a
// valid skim hit (see infra/lambda/src/annotate-stream/gloss-cache.ts).
// ---------------------------------------------------------------------------

import { integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import type { CefrLevel, LearningLanguage } from '@language-drill/shared';

export const glossCache = pgTable(
  'gloss_cache',
  {
    language: text('language').$type<LearningLanguage>().notNull(),
    lemma: text('lemma').notNull(),
    baseGloss: text('base_gloss').notNull(),
    pos: text('pos').notNull(),
    cefr: text('cefr').$type<CefrLevel>(),
    freqRank: integer('freq_rank'),
    source: text('source').$type<'skim' | 'deep' | 'seed'>().notNull(),
    promptVersion: text('prompt_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.language, t.lemma] }),
  }),
);

export type GlossCacheRow = typeof glossCache.$inferSelect;
export type NewGlossCacheRow = typeof glossCache.$inferInsert;
```

- [ ] **Step 4: Export from the schema barrel**

In `packages/db/src/schema/index.ts`, add alongside the other `export { ... } from './...'` lines:
```ts
export { glossCache } from './gloss-cache';
export type { GlossCacheRow, NewGlossCacheRow } from './gloss-cache';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @language-drill/db exec vitest run src/schema/gloss-cache.test.ts`
Expected: PASS.

- [ ] **Step 6: Generate the migration**

Run: `pnpm --filter @language-drill/db db:generate`
Expected: a new `packages/db/migrations/NNNN_*.sql` containing `CREATE TABLE "gloss_cache"` with the PK on `("language","lemma")`, plus an updated `migrations/meta/_journal.json`. Open the `.sql` and confirm the columns match the schema. If `NNNN` collides with an existing migration on `origin/main`, apply the renumber convention from Global Constraints.

- [ ] **Step 7: Build the db package (dist is what other packages resolve)**

Run: `pnpm --filter @language-drill/db build`
Expected: exit 0. (Downstream vitest runs resolve `@language-drill/db` from `dist/`.)

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema/gloss-cache.ts packages/db/src/schema/gloss-cache.test.ts packages/db/src/schema/index.ts packages/db/migrations
git commit -m "feat(db): add gloss_cache table (language, lemma) -> base_gloss"
```

---

### Task 2: gloss-cache lambda helper (lookup, synthesis, upsert)

**Files:**
- Create: `infra/lambda/src/annotate-stream/gloss-cache.ts`
- Create: `infra/lambda/src/annotate-stream/gloss-cache.test.ts`

**Interfaces:**
- Consumes: `glossCache`, `GlossCacheRow`, `NewGlossCacheRow` from `@language-drill/db` (Task 1); `db` from `../db`.
- Produces:
  - `lookupGlossCache(language: LearningLanguage, lemmas: string[]): Promise<Map<string, GlossCacheRow>>` — map lemma → row; dedupes input lemmas; returns empty map for empty input.
  - `wordFlagFromCacheRow(row: GlossCacheRow, matchedForm: string, freq: number): (WordFlag & { matchedForm: string }) | null` — returns null when `row.cefr` is null (not a valid skim hit).
  - `upsertGlossCacheRows(rows: NewGlossCacheRow[]): Promise<void>` — batch upsert on conflict `(language, lemma)`; no-op on empty input.

- [ ] **Step 1: Write the failing test**

`infra/lambda/src/annotate-stream/gloss-cache.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { wordFlagFromCacheRow } from './gloss-cache';
import type { GlossCacheRow } from '@language-drill/db';

const baseRow: GlossCacheRow = {
  language: 'es',
  lemma: 'banco',
  baseGloss: 'bench; bank',
  pos: 'noun',
  cefr: 'B1',
  freqRank: 4200,
  source: 'skim',
  promptVersion: 'annotate@2026-07-13',
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe('wordFlagFromCacheRow', () => {
  it('synthesizes a WordFlag using server freq and cache gloss/pos/cefr', () => {
    const flag = wordFlagFromCacheRow(baseRow, 'bancos', 4200);
    expect(flag).toEqual({
      matchedForm: 'bancos',
      lemma: 'banco',
      pos: 'noun',
      gloss: 'bench; bank',
      freq: 4200,
      cefr: 'B1',
    });
  });

  it('returns null when the cached row has no cefr (not a valid skim hit)', () => {
    const flag = wordFlagFromCacheRow({ ...baseRow, cefr: null }, 'banco', 4200);
    expect(flag).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/annotate-stream/gloss-cache.test.ts`
Expected: FAIL — cannot find module `./gloss-cache`.

- [ ] **Step 3: Write the helper**

`infra/lambda/src/annotate-stream/gloss-cache.ts`:
```ts
/**
 * Cross-user base-gloss cache access for the reading-annotation Lambdas.
 * Read side (skim hits) + write side (skim misses + resolved deep cards).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  glossCache,
  type GlossCacheRow,
  type NewGlossCacheRow,
} from '@language-drill/db';
import type { LearningLanguage, WordFlag } from '@language-drill/shared';

import { db } from '../db';

/** Fetch cached rows for the given lemmas, keyed by lemma. */
export async function lookupGlossCache(
  language: LearningLanguage,
  lemmas: string[],
): Promise<Map<string, GlossCacheRow>> {
  const unique = [...new Set(lemmas)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select()
    .from(glossCache)
    .where(and(eq(glossCache.language, language), inArray(glossCache.lemma, unique)));
  return new Map(rows.map((r) => [r.lemma, r]));
}

/**
 * Build a skim `WordFlag` from a cached row. `freq` comes from the caller
 * (the server frequency dict, authoritative for known lemmas). Returns null
 * when the row lacks a `cefr` band — such a row cannot form a valid WordFlag,
 * so the caller must treat the lemma as a cache miss.
 */
export function wordFlagFromCacheRow(
  row: GlossCacheRow,
  matchedForm: string,
  freq: number,
): (WordFlag & { matchedForm: string }) | null {
  if (row.cefr === null) return null;
  return {
    matchedForm,
    lemma: row.lemma,
    pos: row.pos,
    gloss: row.baseGloss,
    freq,
    cefr: row.cefr,
  };
}

/** Batch upsert on conflict (language, lemma). Last-write-wins. */
export async function upsertGlossCacheRows(rows: NewGlossCacheRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(glossCache)
    .values(rows)
    .onConflictDoUpdate({
      target: [glossCache.language, glossCache.lemma],
      set: {
        baseGloss: sql`excluded.base_gloss`,
        pos: sql`excluded.pos`,
        cefr: sql`excluded.cefr`,
        freqRank: sql`excluded.freq_rank`,
        source: sql`excluded.source`,
        promptVersion: sql`excluded.prompt_version`,
        updatedAt: sql`now()`,
      },
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/annotate-stream/gloss-cache.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/annotate-stream/gloss-cache.ts infra/lambda/src/annotate-stream/gloss-cache.test.ts
git commit -m "feat(annotate): gloss-cache lookup/synthesis/upsert helper"
```

---

### Task 3: Expose `effectiveRank` from `buildCandidateList`

**Files:**
- Modify: `infra/lambda/src/annotate-stream/pipeline.ts` (`Candidate` type + return mapping ~`241-245`)
- Modify: `infra/lambda/src/annotate-stream/pipeline.test.ts`

**Interfaces:**
- Produces: `Candidate = { matchedForm: string; lemma: string | null; effectiveRank: number }`. `buildCandidateList` returns candidates carrying `effectiveRank` (the corpus rank used for the rarest-first sort; `topRank + 1` for unknown-to-corpus words). Downstream code that only reads `matchedForm`/`lemma` is unaffected.

- [ ] **Step 1: Write the failing test**

Add to `infra/lambda/src/annotate-stream/pipeline.test.ts` (inside the existing top-level `describe`):
```ts
it('returns effectiveRank on each candidate', async () => {
  const { candidates } = await buildCandidateList({
    userId: 'u1',
    language: 'es',
    text: 'La aldea recibió al pintor con indiferencia.',
  });
  expect(candidates.length).toBeGreaterThan(0);
  for (const c of candidates) {
    expect(typeof c.effectiveRank).toBe('number');
    expect(c.effectiveRank).toBeGreaterThanOrEqual(0);
  }
});
```
(If the existing test file already stubs `loadFrequency`/`db`, reuse that harness — do not add a second mock. Match the language/userId shape the sibling tests use.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/annotate-stream/pipeline.test.ts`
Expected: FAIL — `effectiveRank` is `undefined` (currently stripped).

- [ ] **Step 3: Stop stripping `effectiveRank`**

In `pipeline.ts`, change the `Candidate` type:
```ts
export type Candidate = {
  matchedForm: string;
  lemma: string | null;
  effectiveRank: number;
};
```
Then replace the final mapping (currently strips `effectiveRank`) with a pass-through:
```ts
  // Rarest-first cap (Req 2.4). `effectiveRank` is retained so the handler can
  // populate WordFlag.freq for cache hits from the authoritative server rank.
  afterVocab.sort((a, b) => b.effectiveRank - a.effectiveRank);
  const candidates: Candidate[] = afterVocab.slice(0, CANDIDATE_LIMIT);

  return { candidates, calibration };
```
Remove the now-unused `Survivor` alias if it becomes redundant (it may still be used above — leave it if referenced). Update the doc comment near the top of the file that says the wire "carries only matchedForm + lemma" to note `effectiveRank` is retained internally.

- [ ] **Step 4: Run test to verify it passes (and no regressions in the file)**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/annotate-stream/pipeline.test.ts`
Expected: PASS. If `cross-lambda-contract.test.ts` deep-equals the candidate shape, update its expectation to include `effectiveRank`:
Run: `pnpm --filter @language-drill/lambda exec vitest run src/annotate-stream/cross-lambda-contract.test.ts`
Expected: PASS (fix the fixture if it fails on the added field).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/annotate-stream/pipeline.ts infra/lambda/src/annotate-stream/pipeline.test.ts infra/lambda/src/annotate-stream/cross-lambda-contract.test.ts
git commit -m "feat(annotate): retain effectiveRank on candidates for cache-hit freq"
```

---

### Task 4: Skim handler integration (serve hits, miss-only Claude, all-hit short-circuit, write-through)

**Files:**
- Modify: `infra/lambda/src/annotate-stream/handler.ts` (after the `meta` emit / empty short-circuit at ~`189-209`, and inside the streaming loop at ~`235-323`)
- Modify: `infra/lambda/src/annotate-stream/handler.test.ts`

**Interfaces:**
- Consumes: `lookupGlossCache`, `wordFlagFromCacheRow`, `upsertGlossCacheRows` (Task 2); `Candidate` with `effectiveRank` (Task 3); `NewGlossCacheRow` (`@language-drill/db`); `WordFlag` (`@language-drill/shared`); `ANNOTATE_SYSTEM_PROMPT_VERSION` (already imported).
- Produces: no wire-shape change. Adds a `[annotate-stream] gloss-cache split` log with `{ candidateCount, cachedCount, missCount, claudeSkipped }`.

Behavior to implement (mirror the design §2):
1. After the `meta` event and the existing `candidates.length === 0` short-circuit, look up the cache for all non-null candidate lemmas (degrade to empty map on query error).
2. Partition candidates into `hits` (row found AND `wordFlagFromCacheRow` returns non-null) and `misses`. Emit each hit as a `flag` event; seed `flaggedCount` with the hit count.
3. If `misses.length === 0`: write terminal `done`, **do not** insert a `usage_events` row, close, return.
4. Otherwise call `streamAnnotation` with `candidates: misses` (not the full list); accumulate each streamed miss flag into `NewGlossCacheRow[]`; after the loop, best-effort `upsertGlossCacheRows`.

- [ ] **Step 1: Write the failing tests**

Add to `infra/lambda/src/annotate-stream/handler.test.ts`. Use the existing hoisted mocks (`mockBuildCandidateList`, `streamAnnotationImpl`/`setStreamAnnotation`, `mockUsageInsertValues`). Add hoisted mocks for the gloss-cache helper:
```ts
// In the vi.hoisted block, add:
//   mockLookupGlossCache: vi.fn(),
//   mockUpsertGlossCacheRows: vi.fn(),
// and mock the module:
vi.mock('./gloss-cache', () => ({
  lookupGlossCache: (...a: unknown[]) => mockLookupGlossCache(...a),
  upsertGlossCacheRows: (...a: unknown[]) => mockUpsertGlossCacheRows(...a),
  // real synthesis is pure — re-export the actual implementation:
  wordFlagFromCacheRow: (row: any, matchedForm: string, freq: number) =>
    row.cefr === null
      ? null
      : { matchedForm, lemma: row.lemma, pos: row.pos, gloss: row.baseGloss, freq, cefr: row.cefr },
}));
```
Tests:
```ts
it('serves a cache hit without calling Claude and skips metering when all candidates hit', async () => {
  mockBuildCandidateList.mockResolvedValue({
    calibration: { cefr: 'B1', top: 5000 },
    candidates: [{ matchedForm: 'bancos', lemma: 'banco', effectiveRank: 4200 }],
  });
  mockLookupGlossCache.mockResolvedValue(
    new Map([['banco', { language: 'es', lemma: 'banco', baseGloss: 'bench; bank', pos: 'noun', cefr: 'B1', freqRank: 4200, source: 'seed', promptVersion: null }]]),
  );
  const setStream = vi.fn();
  setStreamAnnotation(async function* () { setStream(); }); // must NOT be called

  const { events } = await runHandler(/* existing helper that drives the handler + captures SSE */);

  const flags = events.filter((e) => e.type === 'flag');
  expect(flags).toHaveLength(1);
  expect(flags[0].data).toMatchObject({ matchedForm: 'bancos', gloss: 'bench; bank', freq: 4200 });
  expect(events.at(-1)).toMatchObject({ type: 'done', data: { flaggedCount: 1 } });
  expect(setStream).not.toHaveBeenCalled();
  expect(mockUsageInsertValues).not.toHaveBeenCalled();
});

it('sends only misses to Claude and writes their flags through to the cache', async () => {
  mockBuildCandidateList.mockResolvedValue({
    calibration: { cefr: 'B1', top: 5000 },
    candidates: [
      { matchedForm: 'bancos', lemma: 'banco', effectiveRank: 4200 },
      { matchedForm: 'aldea', lemma: 'aldea', effectiveRank: 6100 },
    ],
  });
  mockLookupGlossCache.mockResolvedValue(
    new Map([['banco', { language: 'es', lemma: 'banco', baseGloss: 'bench; bank', pos: 'noun', cefr: 'B1', freqRank: 4200, source: 'seed', promptVersion: null }]]),
  );
  let received: unknown;
  setStreamAnnotation(async function* (_client, input) {
    received = input; // assert only the miss was sent
    yield { kind: 'flag', flag: { matchedForm: 'aldea', lemma: 'aldea', pos: 'noun', gloss: 'small village', freq: 6100, cefr: 'B2' } };
    yield { kind: 'done', flaggedCount: 1 };
  });

  const { events } = await runHandler(/* ... */);

  expect((received as any).candidates).toEqual([{ matchedForm: 'aldea', lemma: 'aldea', effectiveRank: 6100 }]);
  expect(events.filter((e) => e.type === 'flag')).toHaveLength(2); // 1 hit + 1 miss
  expect(mockUsageInsertValues).toHaveBeenCalledTimes(1); // Claude ran → metered
  expect(mockUpsertGlossCacheRows).toHaveBeenCalledWith([
    { language: 'es', lemma: 'aldea', baseGloss: 'small village', pos: 'noun', cefr: 'B2', freqRank: 6100, source: 'skim', promptVersion: expect.any(String) },
  ]);
});
```
(Adapt `runHandler`/SSE-capture to the harness the existing tests already use — reuse it, do not invent a new one. If the existing tests pass `candidates` straight to `streamAnnotation`, note the assertion now expects `misses`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/annotate-stream/handler.test.ts`
Expected: FAIL — no cache split yet (Claude called for all; no upsert; metering fires on all-hit).

- [ ] **Step 3: Implement the split in the handler**

In `handler.ts`, add imports:
```ts
import { lookupGlossCache, upsertGlossCacheRows, wordFlagFromCacheRow } from './gloss-cache';
import type { NewGlossCacheRow } from '@language-drill/db';
import type { WordFlag } from '@language-drill/shared';
import type { Candidate } from './pipeline';
```
Immediately after the existing `if (candidates.length === 0) { ... }` block, insert:
```ts
    // Step 8.5: gloss-cache split — serve hits instantly, send only misses to
    // Claude. A lookup failure degrades to "all misses" (an honest, if slower,
    // result) rather than failing the request.
    const lookupLemmas = candidates
      .map((c) => c.lemma)
      .filter((l): l is string => l !== null);
    let cacheRows: Awaited<ReturnType<typeof lookupGlossCache>>;
    try {
      cacheRows = await lookupGlossCache(learningLanguage, lookupLemmas);
    } catch (err) {
      console.error('[annotate-stream] gloss-cache lookup failed", err);
      cacheRows = new Map();
    }

    const misses: Candidate[] = [];
    let flaggedCount = 0;
    for (const c of candidates) {
      const row = c.lemma !== null ? cacheRows.get(c.lemma) : undefined;
      const flag = row ? wordFlagFromCacheRow(row, c.matchedForm, c.effectiveRank) : null;
      if (flag) {
        writer.writeEvent('flag', flag);
        flaggedCount++;
      } else {
        misses.push(c);
      }
    }
    console.log('[annotate-stream] gloss-cache split', {
      candidateCount: candidates.length,
      cachedCount: flaggedCount,
      missCount: misses.length,
      claudeSkipped: misses.length === 0,
    });

    // All-hit short-circuit: no Claude call, no usage_events row (mirrors the
    // empty-candidate path above — a fully-cached passage costs nothing).
    if (misses.length === 0) {
      writer.writeTerminal('done', { flaggedCount });
      console.log('[annotate-stream] done (fully cached)', { flaggedCount });
      await writer.close();
      return;
    }
```
Fix the typo you just typed if any — the console string must be `'[annotate-stream] gloss-cache lookup failed'` (balanced quotes).

Then:
- Delete the old `let flaggedCount = 0;` declaration (now declared above).
- Add `const mintedRows: NewGlossCacheRow[] = [];` before the `try`/`withLlmTrace` block.
- Change the `streamAnnotation(client, { ... candidates, ... })` call to pass `candidates: misses`.
- In the trace context object, change `candidateCount: candidates.length` to `candidateCount: misses.length`.
- Inside the `for await` loop, extend the `ev.kind === 'flag'` branch:
```ts
            if (ev.kind === "flag") {
              writer.writeEvent("flag", ev.flag);
              flaggedCount++;
              if (ev.flag.lemma) {
                mintedRows.push({
                  language: learningLanguage,
                  lemma: ev.flag.lemma,
                  baseGloss: ev.flag.gloss,
                  pos: ev.flag.pos,
                  cefr: ev.flag.cefr,
                  freqRank: ev.flag.freq,
                  source: 'skim',
                  promptVersion: ANNOTATE_SYSTEM_PROMPT_VERSION,
                });
              }
            }
```
- After `clearTimeout(deadlineTimer);` (the clean-completion line) and before the usage insert, add the best-effort write-through:
```ts
    // Write miss results through to the shared cache (best-effort — the user
    // already has their flags; a cache write failure is backend-only).
    try {
      await upsertGlossCacheRows(mintedRows);
    } catch (err) {
      console.error('[annotate-stream] gloss-cache write-through failed', err);
    }
```
Leave the `usage_events` insert as-is (it now runs only on the partial/miss path, since all-hit returned early). Its `metadata.candidateCount` may stay `candidates.length` (total) — that is fine; add `cachedCount: flaggedCount - misses.length`? No — keep it simple: leave existing metadata, the split log already carries the breakdown.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/annotate-stream/handler.test.ts`
Expected: PASS, including the pre-existing empty-candidate, error-frame, and soft-deadline tests (unchanged behavior). If a pre-existing test asserted `streamAnnotation` received the full `candidates`, update it to expect `misses` and add a `mockLookupGlossCache.mockResolvedValue(new Map())` default in `beforeEach` so untouched tests see an empty cache (all misses → old behavior).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/annotate-stream/handler.ts infra/lambda/src/annotate-stream/handler.test.ts
git commit -m "feat(annotate): serve gloss-cache hits, send only misses to Claude, write-through"
```

---

### Task 5: Deep-card `baseGloss` write-through

**Files:**
- Modify: `infra/lambda/src/annotate-stream/deep-flow.ts` (after the `card === undefined` guard ~`317`, next to the `span_annotations` write-back)
- Modify: `infra/lambda/src/annotate-stream/deep-flow.test.ts`

**Interfaces:**
- Consumes: `upsertGlossCacheRows` (Task 2); `READ_SPAN_PROMPT_VERSION` (already imported in this file); the resolved `card: DeepCard`.
- Produces: on a resolved `word` card with a non-empty `baseGloss`, one best-effort `gloss_cache` upsert (`source: 'deep'`). No change to the streaming/`done`/metering paths.

- [ ] **Step 1: Write the failing test**

Add to `infra/lambda/src/annotate-stream/deep-flow.test.ts` (reuse the file's existing streamSpan/db mocks; add a hoisted `mockUpsertGlossCacheRows` and `vi.mock('./gloss-cache', ...)` exposing it):
```ts
it('writes a resolved word card baseGloss through to the gloss cache', async () => {
  setStreamSpan(async function* () {
    yield { kind: 'done', card: {
      type: 'word', surface: 'bancos', lemma: 'banco', pos: 'noun',
      contextualSense: 'financial institution', baseGloss: 'bench; bank',
      definition: '...', definitionLabel: 'Español', cefr: 'B1', freq: 4200,
    } };
  });

  await runDeepFlow(/* existing harness; entryId optional */);

  expect(mockUpsertGlossCacheRows).toHaveBeenCalledWith([
    { language: 'es', lemma: 'banco', baseGloss: 'bench; bank', pos: 'noun', cefr: 'B1', freqRank: 4200, source: 'deep', promptVersion: expect.any(String) },
  ]);
});

it('does not write when the resolved card has no baseGloss (older snapshot)', async () => {
  setStreamSpan(async function* () {
    yield { kind: 'done', card: {
      type: 'word', surface: 'bancos', lemma: 'banco', pos: 'noun',
      contextualSense: 'financial institution', definition: '...', definitionLabel: 'Español', cefr: 'B1', freq: 4200,
    } };
  });
  await runDeepFlow(/* ... */);
  expect(mockUpsertGlossCacheRows).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/annotate-stream/deep-flow.test.ts`
Expected: FAIL — no write-through yet.

- [ ] **Step 3: Implement the write-through**

In `deep-flow.ts`, add the import:
```ts
import { upsertGlossCacheRows } from './gloss-cache';
```
After the `if (card === undefined) { ... }` guard (and alongside the existing `if (entryId) { ...spanAnnotations... }` best-effort block), add:
```ts
  // Feed the shared gloss cache from the resolved base gloss (word cards only).
  // Best-effort: the card already streamed to the client; a cache write failure
  // is backend-only. Older cards predate `baseGloss` and are skipped.
  if (card.type === 'word' && typeof card.baseGloss === 'string' && card.baseGloss.trim() !== '') {
    try {
      await upsertGlossCacheRows([
        {
          language: learningLanguage,
          lemma: card.lemma,
          baseGloss: card.baseGloss,
          pos: card.pos,
          cefr: card.cefr,
          freqRank: card.freq ?? null,
          source: 'deep',
          promptVersion: READ_SPAN_PROMPT_VERSION,
        },
      ]);
    } catch (err) {
      console.error('[annotate-span] gloss-cache write-through failed', err);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/annotate-stream/deep-flow.test.ts`
Expected: PASS (both new tests + existing ones).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/annotate-stream/deep-flow.ts infra/lambda/src/annotate-stream/deep-flow.test.ts
git commit -m "feat(annotate-span): write resolved deep-card baseGloss through to gloss cache"
```

---

### Task 6: Prompt nudge — list top 1–2 senses in the base gloss

**Files:**
- Modify: `packages/ai/src/annotate.ts` (`gloss` description in `ANNOTATE_TOOL` ~`59-63`; the `gloss` line in `ANNOTATE_SYSTEM_PROMPT` ~`113`; bump `ANNOTATE_SYSTEM_PROMPT_VERSION` ~`90`)
- Modify: `packages/ai/src/read-span.ts` (`baseGloss` description in `WORD_CARD_SCHEMA` ~`76-80`; bump `READ_SPAN_PROMPT_VERSION`)
- Check: `packages/ai/src/annotate.test.ts` / `read-span.test.ts` for any assertion pinning the exact version string or gloss copy — update if present.

**Interfaces:**
- Produces: new prompt-version strings `annotate@2026-07-13` and `read-span@2026-07-13`. No signature changes.

- [ ] **Step 1: Update the annotate gloss guidance**

In `annotate.ts`, change the tool-schema `gloss` description to:
```ts
              description:
                "Brief English meaning, lowercase, ≤ 80 characters. When the lemma has two common senses, list the top 1–2 separated by '; ' (e.g. 'bench; bank').",
```
In `ANNOTATE_SYSTEM_PROMPT`, change the `- \`gloss\`:` bullet to:
```
- \`gloss\`: a brief English meaning, lowercase, ≤ 80 characters. When the lemma has two common senses, list the top 1–2 separated by "; " (e.g. "bench; bank").
```
Bump the version:
```ts
export const ANNOTATE_SYSTEM_PROMPT_VERSION = "annotate@2026-07-13";
```

- [ ] **Step 2: Update the deep-card baseGloss guidance**

In `read-span.ts`, change the `baseGloss` description to:
```ts
      description:
        "A short base English gloss of the LEMMA — the concise dictionary meaning (e.g. 'to eat', 'the house'), not the contextual sense. When the lemma has two common senses, list the top 1–2 separated by '; ' (e.g. 'bench; bank'). A few words at most; no punctuation beyond the separator; no examples.",
```
Bump `READ_SPAN_PROMPT_VERSION` to `read-span@2026-07-13` (match its existing `<surface>@YYYY-MM-DD` format).

- [ ] **Step 3: Run the ai package tests**

Run: `pnpm --filter @language-drill/ai test`
Expected: PASS. If a test pins the old version string or the exact gloss sentence, update the expectation to the new value.

- [ ] **Step 4: Commit**

```bash
git add packages/ai/src/annotate.ts packages/ai/src/read-span.ts packages/ai/src/annotate.test.ts packages/ai/src/read-span.test.ts
git commit -m "feat(ai): base gloss lists top 1-2 senses; bump annotate + read-span prompt versions"
```

> **Post-merge (not part of this plan's code):** `ANNOTATE_SYSTEM_PROMPT` is Langfuse-synced — after merge, run `push-prompts` per environment from a fresh `main` checkout so the runtime serves the new body (CLAUDE.md → Prompt Editing; beware the stale-worktree revert hazard). The `read-span` and `annotate` **tool-schema** description edits ship with the code deploy and need no sync.

---

### Task 7: Seed CLI — backfill `gloss_cache` from `user_vocabulary`

**Files:**
- Create: `packages/db/src/gloss-cache/derive-seed.ts` (pure derivation)
- Create: `packages/db/src/gloss-cache/derive-seed.test.ts`
- Create: `packages/db/scripts/seed-gloss-cache.ts` (CLI: fetch → derive → batch upsert)
- Modify: `packages/db/package.json` (add `"seed:gloss-cache"` script)

**Interfaces:**
- Consumes: `NewGlossCacheRow` (`../schema/gloss-cache` or barrel); `DeepCard`, `CefrLevel`, `LearningLanguage` (`@language-drill/shared`).
- Produces:
  - `type SeedVocabRow = { language: LearningLanguage; lemma: string; gloss: string; pos: string; cefrBand: CefrLevel | null; frequencyRank: number | null; card: DeepCard | null; addedAt: Date }`
  - `deriveSeedRows(rows: SeedVocabRow[]): NewGlossCacheRow[]` — applies the base-gloss derivation, drops phrases/empties/null-cefr, dedupes per `(language, lemma)` preferring a deep-card `baseGloss` source over a skim `gloss` source then most-recent `addedAt`; every returned row has `source: 'seed'`, `promptVersion: null`.

- [ ] **Step 1: Write the failing test**

`packages/db/src/gloss-cache/derive-seed.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { deriveSeedRows, type SeedVocabRow } from './derive-seed';

const row = (o: Partial<SeedVocabRow>): SeedVocabRow => ({
  language: 'es', lemma: 'banco', gloss: 'bench', pos: 'noun',
  cefrBand: 'B1', frequencyRank: 4200, card: null, addedAt: new Date(0), ...o,
});

describe('deriveSeedRows', () => {
  it('uses gloss for skim rows (card null)', () => {
    expect(deriveSeedRows([row({})])).toEqual([
      { language: 'es', lemma: 'banco', baseGloss: 'bench', pos: 'noun', cefr: 'B1', freqRank: 4200, source: 'seed', promptVersion: null },
    ]);
  });

  it('prefers card.baseGloss over gloss for deep rows', () => {
    const deep = row({ gloss: 'financial institution', card: { type: 'word', baseGloss: 'bench; bank' } as any });
    expect(deriveSeedRows([deep])[0].baseGloss).toBe('bench; bank');
  });

  it('skips phrase rows, empty base gloss, and null cefr', () => {
    expect(deriveSeedRows([row({ pos: 'phrase' })])).toEqual([]);
    expect(deriveSeedRows([row({ gloss: '   ', card: null })])).toEqual([]);
    expect(deriveSeedRows([row({ cefrBand: null })])).toEqual([]);
    // deep row whose card predates baseGloss falls back to gloss only when card is null;
    // here card is present but baseGloss missing → contextual gloss must NOT leak in:
    expect(deriveSeedRows([row({ gloss: 'contextual', card: { type: 'word' } as any })])).toEqual([]);
  });

  it('dedupes per (language, lemma): deep-source and most-recent win', () => {
    const skimOld = row({ gloss: 'bench', card: null, addedAt: new Date(1) });
    const deepNew = row({ gloss: 'ctx', card: { type: 'word', baseGloss: 'bench; bank' } as any, addedAt: new Date(2) });
    const out = deriveSeedRows([skimOld, deepNew]);
    expect(out).toHaveLength(1);
    expect(out[0].baseGloss).toBe('bench; bank');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db exec vitest run src/gloss-cache/derive-seed.test.ts`
Expected: FAIL — cannot find module `./derive-seed`.

- [ ] **Step 3: Write the pure derivation**

`packages/db/src/gloss-cache/derive-seed.ts`:
```ts
import type { CefrLevel, DeepCard, LearningLanguage } from '@language-drill/shared';
import type { NewGlossCacheRow } from '../schema/gloss-cache';

export type SeedVocabRow = {
  language: LearningLanguage;
  lemma: string;
  gloss: string;
  pos: string;
  cefrBand: CefrLevel | null;
  frequencyRank: number | null;
  card: DeepCard | null;
  addedAt: Date;
};

type Picked = { row: NewGlossCacheRow; preferDeep: boolean; addedAt: Date };

/** Resolve the clean base gloss for one vocab row, or null to skip it. */
function baseGlossOf(r: SeedVocabRow): { value: string; preferDeep: boolean } | null {
  if (r.card && (r.card as { type?: string }).type === 'word') {
    const bg = (r.card as { baseGloss?: unknown }).baseGloss;
    if (typeof bg === 'string' && bg.trim() !== '') return { value: bg, preferDeep: true };
    return null; // deep row whose gloss is contextual — never fall back to it
  }
  if (r.card === null && r.gloss.trim() !== '') return { value: r.gloss, preferDeep: false };
  return null;
}

export function deriveSeedRows(rows: SeedVocabRow[]): NewGlossCacheRow[] {
  const best = new Map<string, Picked>();
  for (const r of rows) {
    if (r.pos === 'phrase') continue;
    if (r.cefrBand === null) continue;
    const bg = baseGlossOf(r);
    if (bg === null) continue;

    const key = `${r.language} ${r.lemma}`;
    const candidate: Picked = {
      row: {
        language: r.language,
        lemma: r.lemma,
        baseGloss: bg.value,
        pos: r.pos,
        cefr: r.cefrBand,
        freqRank: r.frequencyRank,
        source: 'seed',
        promptVersion: null,
      },
      preferDeep: bg.preferDeep,
      addedAt: r.addedAt,
    };

    const existing = best.get(key);
    if (
      existing === undefined ||
      (candidate.preferDeep && !existing.preferDeep) ||
      (candidate.preferDeep === existing.preferDeep && candidate.addedAt > existing.addedAt)
    ) {
      best.set(key, candidate);
    }
  }
  return [...best.values()].map((p) => p.row);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/db exec vitest run src/gloss-cache/derive-seed.test.ts`
Expected: PASS.

- [ ] **Step 5: Export the module and write the CLI**

Add to `packages/db/src/schema/index.ts` (or a suitable barrel) if the CLI imports via the package — the CLI is internal to `packages/db`, so it may import via relative path instead; no barrel change required.

`packages/db/scripts/seed-gloss-cache.ts`:
```ts
/**
 * One-off backfill of gloss_cache from user_vocabulary. Dry-run by default.
 *   pnpm --filter @language-drill/db seed:gloss-cache            # dry run
 *   pnpm --filter @language-drill/db seed:gloss-cache --apply
 *   pnpm --filter @language-drill/db seed:gloss-cache --apply --language es --limit 5000
 * Read-only over user_vocabulary; upserts with onConflictDoNothing so it never
 * clobbers a live-minted entry and is safe to re-run.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../src/client';
import { glossCache, userVocabulary } from '../src/schema';
import { deriveSeedRows, type SeedVocabRow } from '../src/gloss-cache/derive-seed';
import type { CefrLevel, DeepCard, LearningLanguage } from '@language-drill/shared';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const language = arg('language') as LearningLanguage | undefined;
  const limit = arg('limit') ? Number(arg('limit')) : undefined;

  const where = language ? eq(userVocabulary.language, language) : undefined;
  const q = db
    .select({
      language: userVocabulary.language,
      lemma: userVocabulary.lemma,
      gloss: userVocabulary.gloss,
      pos: userVocabulary.pos,
      cefrBand: userVocabulary.cefrBand,
      frequencyRank: userVocabulary.frequencyRank,
      card: userVocabulary.card,
      addedAt: userVocabulary.addedAt,
    })
    .from(userVocabulary)
    .where(where);
  const rows = (limit ? await q.limit(limit) : await q) as SeedVocabRow[];

  const seedRows = deriveSeedRows(rows);
  console.log(`[seed:gloss-cache] source rows=${rows.length} -> unique lemmas=${seedRows.length} (apply=${apply})`);

  if (!apply) {
    console.log('[seed:gloss-cache] dry run — no writes. Re-run with --apply.');
    console.log(seedRows.slice(0, 10));
    return;
  }

  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < seedRows.length; i += BATCH) {
    const chunk = seedRows.slice(i, i + BATCH);
    await db.insert(glossCache).values(chunk).onConflictDoNothing({
      target: [glossCache.language, glossCache.lemma],
    });
    written += chunk.length;
    console.log(`[seed:gloss-cache] upserted ${written}/${seedRows.length}`);
  }
  console.log('[seed:gloss-cache] done.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```
(Confirm the client import path used by sibling scripts — match how `scripts/seed-vocab.ts` imports `db`. Use `isNotNull`/`and` only if you add extra filters; the import line above is illustrative — drop unused imports to satisfy lint.)

Add to `packages/db/package.json` scripts:
```json
    "seed:gloss-cache": "npx tsx scripts/seed-gloss-cache.ts",
```

- [ ] **Step 6: Verify the CLI runs (dry run) and lint is clean**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db seed:gloss-cache --language es --limit 50`
Expected: prints source/unique counts and up to 10 sample rows, no writes. (Requires a reachable `DATABASE_URL` from the copied `.env`; the local `.env` points at the Neon dev branch — fine for a read-only dry run.)
Run: `pnpm --filter @language-drill/db lint`
Expected: exit 0 (remove any unused imports flagged).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/gloss-cache packages/db/scripts/seed-gloss-cache.ts packages/db/package.json
git commit -m "feat(db): seed:gloss-cache CLI backfilling gloss_cache from user_vocabulary"
```

---

### Task 8: Full gate + branch verification

**Files:** none (verification only).

- [ ] **Step 1: Clear stale lambda dist (avoids phantom compiled test failures)**

Run: `rm -rf infra/lambda/dist`

- [ ] **Step 2: Full lint / typecheck / test from the worktree root**

Run: `pnpm lint`
Run: `pnpm typecheck`
Run: `pnpm test`
Expected: all green. Investigate any failure before proceeding — do not label a failure "environmental" without root-causing it (a mock-db/stub test can never be environmental).

- [ ] **Step 3: Confirm the commits are on the feature branch**

Run: `git branch --show-current` → expect `worktree-feat+base-gloss-cache`.
Run: `git log --oneline origin/main..HEAD` → expect the Task 1–7 commits, none stranded on `main`.

- [ ] **Step 4: (Optional) push + open PR when ready**

Follow the finishing-a-development-branch flow; squash-merge to one clean commit; remember the post-merge `push-prompts` sync for the annotate system prompt (Task 6 note).

---

## Self-Review

**Spec coverage:**
- §1 Data model → Task 1. ✓
- §2 Serving path (skim: lookup, hit emit, miss-only Claude, all-hit short-circuit incl. no usage row, freq from server rank) → Task 3 (effectiveRank) + Task 4. ✓
- §3 Deep card writer-only → Task 5. ✓
- §4 Write-through (skim batch-at-end, deep, best-effort, LWW) → Task 4 + Task 5 + Task 2 (`upsertGlossCacheRows`). ✓
- §5 Seeding backfill (derivation rule, dedupe precedence, onConflictDoNothing, dry-run) → Task 7. ✓
- §6 Invalidation (no TTL; version stored) → covered by schema (`promptVersion`) + Task 4/5 refresh; manual purge deferred as a follow-up (documented, not built — acceptable YAGNI; add later if needed).
- §7 Observability (`cachedCount`/`missCount`/`claudeSkipped` log) → Task 4. ✓
- §8 Error handling (lookup degrades to misses; writes swallowed; null-lemma/proper-noun/all-hit) → Task 2 + Task 4 + Task 5. ✓
- §9 Testing → per-task tests + Task 8 full gate. ✓
- Decision 2 prompt nudge → Task 6. ✓

**Placeholder scan:** No TBD/TODO. Test harness references (`runHandler`, `runDeepFlow`, `setStreamAnnotation`, `setStreamSpan`) point at the existing test files' own helpers — each step says to reuse them rather than invent new ones; the implementer must read the sibling tests. This is intentional (repeating the whole harness would be misleading), not a placeholder.

**Type consistency:** `Candidate` gains `effectiveRank` in Task 3 and is consumed with that field in Task 4. `NewGlossCacheRow`/`GlossCacheRow` from Task 1 are used verbatim in Tasks 2/4/5/7. `wordFlagFromCacheRow` returns `(WordFlag & {matchedForm}) | null` and Task 4 handles the null branch. `deriveSeedRows` emits `NewGlossCacheRow` with `source:'seed'`. Prompt-version constants bumped in Task 6 are the ones referenced in Task 4 (`ANNOTATE_SYSTEM_PROMPT_VERSION`) and Task 5 (`READ_SPAN_PROMPT_VERSION`).

**Invalidation note:** The manual purge CLI mode from spec §6 is intentionally deferred (no code) — the cache self-refreshes via write-through, so purge is only needed on a material glossing-style change. Add it if/when that happens.
