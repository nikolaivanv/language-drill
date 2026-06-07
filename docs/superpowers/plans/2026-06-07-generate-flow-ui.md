# Generate-Flow UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers will NOT see the design screenshots — every copy string, control, layout, and token needed is written into this plan. Match the exact copy strings (they are intentional).

**Goal:** Rebuild the Read ("read & collect") generate flow to a refined hi-fi design — empty / composer / paste / generating / result / library — on our existing components and endpoints, desktop + mobile.

**Architecture:** One responsive surface. The reducer-driven `/read` page keeps its existing annotate/stream/save machinery; we restyle the header + views, add a generation **provenance** model, a **rewrite (force-fresh)** path, and persist generation metadata (`category`/`cefr`/`length`/`prompt`) on `read_entries` so library cards are rich and "adjust" works after reopening. Generation stays **non-streaming** (decision approved); a "calibrating" loader covers the POST and the existing streamed annotation reveals highlights.

**Tech Stack:** Next.js App Router + TS (apps/web), Tailwind v4 design tokens (globals.css), Hono on Lambda (infra/lambda), Drizzle + Neon (packages/db), Zod + TanStack Query (packages/api-client), shared constants (packages/shared), Vitest.

**Decisions locked (from the user):**
1. **Generating** = loader + calibrating message; generation stays non-streaming; existing streamed annotation reveals highlights. No new streaming endpoint.
2. **Rewrite** = force a fresh variation: `POST /read/generate` gets an optional `noCache` flag that bypasses the cache read and **overwrites** the cached row (meters as a real generation).
3. **History/library metadata** = add `kind`/`category`/`cefr`/`length`/`prompt` columns to `read_entries`. Generated entries persist all of them (rich cards + adjust-from-history); pasted entries leave the generation fields null (lean cards).

---

## Design system reference (use these everywhere)

**Tokens** (defined in `apps/web/app/globals.css` `@theme`):
- Colors: `paper #faf7f1`, `paper-2 #f2ede2`, `paper-3 #e8e1d2`, `card #fff`, `ink #1a1612`, `ink-2`, `ink-soft #5a5148`, `ink-mute #8a8074`, `rule #d8d0bf`, `accent #c96442`, `accent-2 #b15535`, `accent-soft #f7e2d3`, `ok #5b8a5a`, `ok-soft #d8e6d3`.
- Type classes: `t-display-xl/l/m/s` (Fraunces serif), `t-body-l/t-body/t-small/t-micro` (Inter), `t-hand` (Caveat script), `t-mono` (JetBrains).
- Spacing `s-1`..`s-8` = 4..40px. Radius `r-sm 6`, `r-md 10`, `r-pill`. `mobile:` prefix = ≤760px.
- Primitives (`apps/web/components/ui/`): `Button` (`variant: default|primary|ghost|accent`, `size: sm|md|lg`), `Input`, `Textarea`, `Chip` (`variant: default|solid|accent|ok`). Reuse them; do not hand-roll equivalents.

**Header actions** (`READING` eyebrow + serif `read & collect`, the `&` in `text-accent`): `current text` · `history N` · `+ paste` · `+ generate` (generate = primary). On mobile, `+ paste`/`+ generate` on the top row and `current`/`history N` pills below.

**Categories** (the colored eyebrow on idea cards / library tags): STORY, NEWS, DIALOGUE, EMAIL, HOW-TO, DAILY.

**Six idea/popular-start cards** (exact copy):
| category | prompt (title) | descriptor |
|---|---|---|
| dialogue | a short café conversation | two friends, present tense |
| news | news: a small-town light festival | reportage, past tense |
| story | a short story about a cat that came back | narrative, past tenses |
| email | an email to a friend about a trip | informal register |
| how-to | a simple recipe from Madrid | imperatives, sequencing |
| daily | a morning at the neighborhood market | describing a routine |

**Length options:** short ≈ 80 words · medium ≈ 160 words · long ≈ 320 words.
**Levels:** A1 A2 B1 B2 C1 C2 with a "• matched to your level" marker under the user's tracked CEFR.
**Language:** never a form field; shown in copy ("…in español…") and as a result/library tag, using the **native** name.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `packages/shared/src/read.ts` | modify | `ReadingCategory` enum; `READING_IDEAS`; `READING_LENGTH_APPROX`; keep `READING_CHIPS_BY_LANGUAGE` until web migration |
| `packages/shared/src/index.ts` | modify | `LANGUAGE_NATIVE_NAME` map (next to `Language` enum) |
| `packages/shared/src/read.test.ts` | modify | tests for the new constants |
| `packages/db/src/schema/read.ts` | modify | add `kind`/`category`/`cefr`/`length`/`prompt` to `readEntries` |
| `packages/db/migrations/*` | create | additive migration |
| `packages/api-client/src/schemas/read.ts` | modify | `noCache` on generate req; metadata + empty-bank on save req; metadata on summary + entry response |
| `packages/api-client/src/schemas/read.test.ts` | modify | schema tests |
| `infra/lambda/src/routes/read.ts` | modify | `noCache` force-fresh; persist+return metadata; allow empty bank |
| `infra/lambda/src/routes/read.generate.test.ts` | modify | force-fresh tests |
| `infra/lambda/src/routes/read.test.ts` | modify | metadata + empty-bank tests |
| `apps/web/app/(dashboard)/read/_components/read-top-bar.tsx` | rewrite | new header layout |
| `apps/web/app/(dashboard)/read/_components/empty-view.tsx` | rewrite | "nothing to read yet" + popular starts |
| `apps/web/app/(dashboard)/read/_components/length-control.tsx` | create | segmented length |
| `apps/web/app/(dashboard)/read/_components/level-ladder.tsx` | create | CEFR ladder + your-level marker |
| `apps/web/app/(dashboard)/read/_components/idea-cards.tsx` | create | shared idea/popular-start card list |
| `apps/web/app/(dashboard)/read/_components/generate-view.tsx` | rewrite | composer |
| `apps/web/app/(dashboard)/read/_components/paste-view.tsx` | rewrite | paste a passage |
| `apps/web/app/(dashboard)/read/_components/generating-view.tsx` | create | calibrating loader |
| `apps/web/app/(dashboard)/read/_components/provenance-header.tsx` | create | result provenance + rewrite |
| `apps/web/app/(dashboard)/read/_components/adjust-bar.tsx` | create | make easier/harder/longer/rewrite |
| `apps/web/app/(dashboard)/read/_components/collect-bar.tsx` | create | flagged/saved + save/add-to-vocab |
| `apps/web/app/(dashboard)/read/_components/annotated-view.tsx` | modify | mount provenance + adjust + collect for generated texts |
| `apps/web/app/(dashboard)/read/_components/history-view.tsx` | rewrite | library card grid |
| `apps/web/app/(dashboard)/read/_state/read-page-reducer.ts` | modify | `generate.category`; `provenance` slice; `GENERATE_FIELD` category; `SET_PROVENANCE` |
| `apps/web/app/(dashboard)/read/page.tsx` | modify | wiring: provenance, adjust, popular-start→composer, save metadata, drop `READING_CHIPS_BY_LANGUAGE` |
| `apps/web/.../read/_components/__tests__/*` | modify/create | component tests |
| `apps/web/.../read/_state/read-page-reducer.test.ts` | modify | reducer tests |

---

## Task 1: Shared — categories, ideas, length approx, language names

**Files:** Modify `packages/shared/src/read.ts`, `packages/shared/src/index.ts`; Test `packages/shared/src/read.test.ts`.

- [ ] **Step 1: Failing test** — append to `packages/shared/src/read.test.ts`:

```typescript
import {
  ReadingCategory,
  READING_IDEAS,
  READING_LENGTH_APPROX,
  ReadingTextLength,
} from './index';
import { LANGUAGE_NATIVE_NAME, Language } from './index';

describe('reading ideas + categories', () => {
  it('has six categories', () => {
    expect(Object.values(ReadingCategory)).toEqual([
      'story', 'news', 'dialogue', 'email', 'how-to', 'daily',
    ]);
  });
  it('has six ideas each with a valid category, prompt, descriptor', () => {
    expect(READING_IDEAS).toHaveLength(6);
    for (const idea of READING_IDEAS) {
      expect(Object.values(ReadingCategory)).toContain(idea.category);
      expect(idea.prompt.length).toBeGreaterThan(0);
      expect(idea.descriptor.length).toBeGreaterThan(0);
    }
  });
  it('maps each length to an approx word count', () => {
    expect(READING_LENGTH_APPROX[ReadingTextLength.SHORT]).toBe(80);
    expect(READING_LENGTH_APPROX[ReadingTextLength.MEDIUM]).toBe(160);
    expect(READING_LENGTH_APPROX[ReadingTextLength.LONG]).toBe(320);
  });
  it('gives a native name per language', () => {
    expect(LANGUAGE_NATIVE_NAME[Language.ES]).toBe('español');
    expect(LANGUAGE_NATIVE_NAME[Language.DE]).toBe('Deutsch');
    expect(LANGUAGE_NATIVE_NAME[Language.TR]).toBe('Türkçe');
  });
});
```

- [ ] **Step 2: Run → fail** — `pnpm --filter @language-drill/shared test -- read.test.ts` → FAIL (missing exports).

- [ ] **Step 3: Implement** — append to `packages/shared/src/read.ts` (match the file's double-quote style):

```typescript
// ---------------------------------------------------------------------------
// Reading ideas / categories (generate composer + library tags)
// ---------------------------------------------------------------------------

/** Genre of a generated reading text — drives the colored category tag. */
export enum ReadingCategory {
  STORY = "story",
  NEWS = "news",
  DIALOGUE = "dialogue",
  EMAIL = "email",
  HOWTO = "how-to",
  DAILY = "daily",
}

export type ReadingIdea = {
  category: ReadingCategory;
  /** The prompt text inserted into the composer. */
  prompt: string;
  /** Short descriptor shown under the prompt on a card. */
  descriptor: string;
};

/** Fixed idea set shown as composer chips and empty-state "popular starts". */
export const READING_IDEAS: readonly ReadingIdea[] = [
  { category: ReadingCategory.DIALOGUE, prompt: "a short café conversation", descriptor: "two friends, present tense" },
  { category: ReadingCategory.NEWS, prompt: "news: a small-town light festival", descriptor: "reportage, past tense" },
  { category: ReadingCategory.STORY, prompt: "a short story about a cat that came back", descriptor: "narrative, past tenses" },
  { category: ReadingCategory.EMAIL, prompt: "an email to a friend about a trip", descriptor: "informal register" },
  { category: ReadingCategory.HOWTO, prompt: "a simple recipe from Madrid", descriptor: "imperatives, sequencing" },
  { category: ReadingCategory.DAILY, prompt: "a morning at the neighborhood market", descriptor: "describing a routine" },
];

/** Approx word count shown on the segmented length control. */
export const READING_LENGTH_APPROX = {
  [ReadingTextLength.SHORT]: 80,
  [ReadingTextLength.MEDIUM]: 160,
  [ReadingTextLength.LONG]: 320,
} as const satisfies Record<ReadingTextLength, number>;
```

Note: `Object.values(ReadingCategory)` order must be story,news,dialogue,email,how-to,daily — declare the enum members in THAT order (STORY, NEWS, DIALOGUE, EMAIL, HOWTO, DAILY) so the test's `toEqual` passes even though `READING_IDEAS` lists them in display order.

- [ ] **Step 4: Language names** — in `packages/shared/src/index.ts`, immediately after the `Language` enum, add:

```typescript
/** Native (endonym) display name per language — used in Read copy + tags. */
export const LANGUAGE_NATIVE_NAME: Record<Language, string> = {
  [Language.EN]: "English",
  [Language.ES]: "español",
  [Language.DE]: "Deutsch",
  [Language.TR]: "Türkçe",
};
```

- [ ] **Step 5: Run → pass** — `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/shared test -- read.test.ts` → PASS.

- [ ] **Step 6: Commit**
```bash
git add packages/shared/src/read.ts packages/shared/src/index.ts packages/shared/src/read.test.ts
git commit -m "feat(shared): add reading categories, ideas, length approx, native language names"
```

---

## Task 2: DB — generation metadata columns on `read_entries`

**Files:** Modify `packages/db/src/schema/read.ts`; generate migration under `packages/db/migrations/`.

- [ ] **Step 1: Add columns** — in `packages/db/src/schema/read.ts`, extend the `readEntries` table (match the file's single-quote + builder style; `text`/`uuid`/`jsonb`/`timestamp`/`index` are already imported). Add these columns AFTER `spanAnnotations` and BEFORE `pastedAt`:

```typescript
    // Generation provenance (null for pasted entries). Persisted so library
    // cards are rich and "adjust" works after reopening a generated text.
    kind: text('kind').$type<'generated' | 'pasted'>().notNull().default('pasted'),
    category: text('category').$type<ReadingCategory>(),
    cefr: text('cefr').$type<CefrLevel>(),
    length: text('length').$type<ReadingTextLength>(),
    prompt: text('prompt'),
```

Add the type imports to the existing `@language-drill/shared` import in this file: `ReadingCategory`, `ReadingTextLength` (and confirm `CefrLevel` is already imported — it is, used elsewhere in the file).

- [ ] **Step 2: Generate migration** — `pnpm --filter @language-drill/db db:generate`. Open the new SQL file under `packages/db/migrations/` and confirm it only `ALTER TABLE "read_entries" ADD COLUMN` for the five columns (no drops). The `kind` column has `DEFAULT 'pasted' NOT NULL` so existing rows backfill safely.

- [ ] **Step 3: Build + typecheck** — `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db typecheck` → PASS.

- [ ] **Step 4: Commit**
```bash
git add packages/db/src/schema/read.ts packages/db/migrations
git commit -m "feat(db): add generation metadata columns to read_entries"
```

---

## Task 3: api-client — schemas for noCache, save metadata, card metadata

**Files:** Modify `packages/api-client/src/schemas/read.ts`, `packages/api-client/src/schemas/read.test.ts`.

- [ ] **Step 1: Failing test** — append to `packages/api-client/src/schemas/read.test.ts`:

```typescript
import {
  GenerateReadingTextRequestSchema,
  SaveReadEntryRequestSchema,
  ReadEntrySummarySchema,
} from './read';

describe('generate noCache + save metadata', () => {
  it('accepts an optional noCache flag on generate', () => {
    const parsed = GenerateReadingTextRequestSchema.parse({
      language: 'TR', cefr: 'A2', length: 'short', topic: 'a cat', noCache: true,
    });
    expect(parsed.noCache).toBe(true);
  });
  it('allows an empty bank when saving to library', () => {
    const r = SaveReadEntryRequestSchema.safeParse({
      language: 'TR', title: '', source: '', text: 'hola', flagged: {}, bank: [],
    });
    expect(r.success).toBe(true);
  });
  it('accepts generation metadata on save', () => {
    const r = SaveReadEntryRequestSchema.safeParse({
      language: 'ES', title: 'X', source: '', text: 'hola', flagged: {}, bank: [],
      kind: 'generated', category: 'story', cefr: 'B2', length: 'long', prompt: 'a cat',
    });
    expect(r.success).toBe(true);
  });
  it('surfaces metadata on a history summary', () => {
    const s = ReadEntrySummarySchema.parse({
      id: '00000000-0000-0000-0000-000000000000', title: 'X', source: '',
      preview: 'p', flaggedCount: 1, savedCount: 0, pastedAt: new Date(0).toISOString(),
      kind: 'generated', category: 'story', cefr: 'B2', length: 'long', prompt: 'a cat',
    });
    expect(s.kind).toBe('generated');
  });
});
```

- [ ] **Step 2: Run → fail** — `pnpm --filter @language-drill/api-client test -- read.test.ts` → FAIL.

- [ ] **Step 3: Implement** — in `packages/api-client/src/schemas/read.ts`:

Add to the `@language-drill/shared` import: `ReadingCategory`. Then:

(a) Extend `GenerateReadingTextRequestSchema`:
```typescript
export const GenerateReadingTextRequestSchema = z.object({
  language: LearningLanguageEnum,
  cefr: z.nativeEnum(CefrLevel),
  length: z.nativeEnum(ReadingTextLength),
  topic: z.string().min(1).max(READING_GEN_TOPIC_MAX_CHARS),
  noCache: z.boolean().optional(),
});
```

(b) Define a reusable metadata shape and add it to the save request + both read shapes:
```typescript
// Generation provenance shared by save request, summary, and full entry.
const ReadEntryMetaSchema = {
  kind: z.enum(['generated', 'pasted']).optional(),
  category: z.nativeEnum(ReadingCategory).nullable().optional(),
  cefr: z.nativeEnum(CefrLevel).nullable().optional(),
  length: z.nativeEnum(ReadingTextLength).nullable().optional(),
  prompt: z.string().nullable().optional(),
};
```

(c) `SaveReadEntryRequestSchema` — relax bank to allow empty + add metadata:
```typescript
export const SaveReadEntryRequestSchema = z.object({
  language: LearningLanguageEnum,
  title: z.string().max(READ_TITLE_MAX_CHARS),
  source: z.string().max(READ_SOURCE_MAX_CHARS),
  text: z.string().min(1).max(READ_TEXT_MAX_CHARS),
  flagged: FlaggedMapSchema,
  bank: z.array(z.string().min(1)), // empty allowed (save-to-library with 0 collected)
  ...ReadEntryMetaSchema,
});
```

(d) Add `...ReadEntryMetaSchema` to BOTH `ReadEntrySummarySchema` and `ReadEntryResponseSchema` object shapes (spread it into the existing `z.object({ ... })`).

- [ ] **Step 4: Run → pass** — `pnpm --filter @language-drill/api-client test -- read.test.ts` and `pnpm --filter @language-drill/api-client typecheck` → PASS. (Build shared first if needed: `pnpm --filter @language-drill/shared build`.)

- [ ] **Step 5: Commit**
```bash
git add packages/api-client/src/schemas/read.ts packages/api-client/src/schemas/read.test.ts
git commit -m "feat(api-client): noCache flag + read-entry generation metadata + empty bank"
```

---

## Task 4: Backend — `noCache` force-fresh on `POST /read/generate`

**Files:** Modify `infra/lambda/src/routes/read.ts`, `infra/lambda/src/routes/read.generate.test.ts`. Package filter: `@language-drill/lambda`.

- [ ] **Step 1: Failing test** — add to `infra/lambda/src/routes/read.generate.test.ts` a case: when `noCache: true`, the handler does NOT read the cache, calls `generateReadingText`, meters, and upserts the row even if a cache entry exists. Mirror the existing db-mock setup in that file. Assertions: response `fromCache === false`; `generateReadingText` called once; a `usageEvents` insert with `eventType:'text_generation'` happened; the cache **lookup select was not used to short-circuit** (i.e., generation ran despite a present cache row).

```typescript
it('forces a fresh generation when noCache is true (ignores cache)', async () => {
  // Arrange: cache lookup would return a row, but noCache must skip it.
  // usage count = 0; generateReadingText returns a NEW text.
  // Act: POST { language:'TR', cefr:'A2', length:'short', topic:'a cat', noCache:true }
  // Assert: 200, fromCache:false, generateReadingText called once,
  //   a text_generation usageEvents insert occurred,
  //   and the returned text is the freshly generated one (not the cached one).
});
```

- [ ] **Step 2: Run → fail** — `pnpm --filter @language-drill/lambda test -- read.generate.test.ts` → FAIL.

- [ ] **Step 3: Implement** — in `infra/lambda/src/routes/read.ts`:

(a) Extend `GenerateBodySchema`:
```typescript
const GenerateBodySchema = z.object({
  language: LearningLanguageEnum,
  cefr: z.nativeEnum(CefrLevel),
  length: z.nativeEnum(ReadingTextLength),
  topic: z.string().min(1).max(READING_GEN_TOPIC_MAX_CHARS),
  noCache: z.boolean().optional(),
});
```

(b) In the handler, destructure `noCache` and guard the cache read:
```typescript
  const { language, cefr, length, topic, noCache } = bodyResult.data;
  // ...
  const cacheKey = readingCacheKey(language, cefr, length, topic);

  if (!noCache) {
    const cachedRows = await db
      .select({ /* existing projection */ })
      .from(generatedReadingTexts)
      .where(eq(generatedReadingTexts.cacheKey, cacheKey))
      .limit(1);
    const cached = cachedRows[0];
    if (cached) {
      await db.update(generatedReadingTexts)
        .set({ hitCount: sql`${generatedReadingTexts.hitCount} + 1` })
        .where(eq(generatedReadingTexts.cacheKey, cacheKey));
      return c.json({ /* existing fromCache:true response */ });
    }
  }
  // ... global capacity, per-user cap, api key, generate (unchanged) ...
```

(c) On persist, replace `onConflictDoNothing` with an upsert so a forced rewrite overwrites the cached text:
```typescript
  await db.insert(generatedReadingTexts).values({
    cacheKey, language: language as LearningLanguage, cefr, length,
    prompt: topic, title: generated.title, text: generated.text,
    difficultyScore: generated.difficultyScore,
  }).onConflictDoUpdate({
    target: generatedReadingTexts.cacheKey,
    set: {
      title: generated.title,
      text: generated.text,
      difficultyScore: generated.difficultyScore,
    },
  });
```
This keeps cache-miss behavior identical (insert) and makes `noCache` rewrites refresh the stored variation. Metering is unchanged (always meters on this path). The response is unchanged (`fromCache:false`).

- [ ] **Step 4: Run → pass** — `pnpm --filter @language-drill/lambda test -- read.generate.test.ts` and `pnpm --filter @language-drill/lambda typecheck` → PASS.

- [ ] **Step 5: Commit**
```bash
git add infra/lambda/src/routes/read.ts infra/lambda/src/routes/read.generate.test.ts
git commit -m "feat(api): noCache force-fresh rewrite on POST /read/generate"
```

---

## Task 5: Backend — persist + return generation metadata; allow empty bank

**Files:** Modify `infra/lambda/src/routes/read.ts`, `infra/lambda/src/routes/read.test.ts`.

- [ ] **Step 1: Failing tests** — add to `infra/lambda/src/routes/read.test.ts` (mirror existing db-mock style):
  1. `POST /read/entries` with `bank: []` succeeds (201) and does NOT attempt a `userVocabulary` insert.
  2. `POST /read/entries` with `kind:'generated', category:'story', cefr:'B2', length:'long', prompt:'a cat'` inserts those onto `read_entries`.
  3. `GET /read/entries` returns `kind/category/cefr/length/prompt` per row.

```typescript
it('saves an entry with an empty bank and skips vocab insert', async () => { /* assert 201, no userVocabulary insert */ });
it('persists generation metadata on save', async () => { /* assert insert values include kind/category/cefr/length/prompt */ });
it('returns generation metadata in the history list', async () => { /* assert each entry carries kind/category/cefr/length/prompt */ });
```

- [ ] **Step 2: Run → fail** — `pnpm --filter @language-drill/lambda test -- read.test.ts` → FAIL.

- [ ] **Step 3: Implement** — in `infra/lambda/src/routes/read.ts`:

(a) `SaveEntryBodySchema`: relax bank + add metadata (import `ReadingCategory` from shared):
```typescript
const SaveEntryBodySchema = z.object({
  language: LearningLanguageEnum,
  title: z.string().max(READ_TITLE_MAX_CHARS),
  source: z.string().max(READ_SOURCE_MAX_CHARS),
  text: z.string().min(1).max(READ_TEXT_MAX_CHARS),
  flagged: FlaggedMapSchema,
  bank: z.array(z.string().min(1)), // empty allowed
  kind: z.enum(['generated', 'pasted']).optional(),
  category: z.nativeEnum(ReadingCategory).nullable().optional(),
  cefr: z.nativeEnum(CefrLevel).nullable().optional(),
  length: z.nativeEnum(ReadingTextLength).nullable().optional(),
  prompt: z.string().nullable().optional(),
});
```

(b) In `POST /read/entries`: persist metadata on the `readEntries` insert, and guard the vocab insert for empty bank:
```typescript
const { language, title, source, text, flagged, bank, kind, category, cefr, length, prompt } = bodyResult.data;
// ...inside the transaction:
const [entry] = await tx.insert(readEntries).values({
  userId, language: language as LearningLanguage, title, source, text,
  flaggedWords: flagged, bank,
  kind: kind ?? 'pasted',
  category: category ?? null,
  cefr: cefr ?? null,
  length: length ?? null,
  prompt: prompt ?? null,
}).returning({ id: readEntries.id, pastedAt: readEntries.pastedAt });

if (bank.length > 0) {
  const vocabRows = bank.map((word) => { /* unchanged */ });
  await tx.insert(userVocabulary).values(vocabRows).onConflictDoUpdate({ /* unchanged */ });
}
```

(c) `GET /read/entries`: add the metadata columns to the select + response map:
```typescript
.select({
  id: readEntries.id, title: readEntries.title, source: readEntries.source,
  pastedAt: readEntries.pastedAt,
  kind: readEntries.kind, category: readEntries.category,
  cefr: readEntries.cefr, length: readEntries.length, prompt: readEntries.prompt,
  preview: sql<string>`substring(${readEntries.text} from 1 for ${READ_PREVIEW_CHARS})`,
  savedCount: sql<number>`jsonb_array_length(${readEntries.bank})`,
  flaggedCount: sql<number>`(select count(*)::int from jsonb_each(${readEntries.flaggedWords}))`,
})
// ...map each row to include kind/category/cefr/length/prompt
```

(d) `GET /read/entries/:id`: add `kind/category/cefr/length/prompt` to its select + response object (so reopening enables provenance + adjust).

- [ ] **Step 4: Run → pass** — `pnpm --filter @language-drill/lambda test -- read.test.ts` + `pnpm --filter @language-drill/lambda typecheck` → PASS.

- [ ] **Step 5: Commit**
```bash
git add infra/lambda/src/routes/read.ts infra/lambda/src/routes/read.test.ts
git commit -m "feat(api): persist + return read-entry generation metadata, allow empty bank"
```

---

## Task 6: Web — header (`ReadTopBar`) redesign

**Files:** Rewrite `apps/web/app/(dashboard)/read/_components/read-top-bar.tsx`; update `__tests__/read-top-bar.test.tsx`.

Design: left = `READING` (`t-micro text-ink-mute`) over `read & collect` (`t-display-m`, the `&` wrapped in `text-accent`). Right = actions. Desktop (≥761px): inline `current text` · `history N` · `+ paste` (all ghost/text) and `+ generate` (primary). Mobile (`mobile:`): a two-row stack — row 1 `+ paste` (ghost) + `+ generate` (primary); row 2 `current` + `history N` pills. Labels: use `current text` on desktop, `current` on mobile (render both, toggle with `hidden mobile:inline` / `mobile:hidden`). Active tab = `aria-current="page"` + `primary` variant for current/history pills.

- [ ] **Step 1: Update tests** — keep the existing behavior tests and ADD: clicking `+ paste` fires `onChange('pasting')`; clicking `+ generate` fires `onChange('generating')`; `current`/`history` fire `onChange('annotated')`/`onChange('history')`; `history` shows the count; `generating` view marks the generate action active. (The existing test file already covers most; adjust label matchers to the new copy: `/\+ paste/i`, `/\+ generate/i`, `/current/i`, `/history/i`.)

- [ ] **Step 2: Run → fail** — `pnpm --filter @language-drill/web test -- read-top-bar.test.tsx`.

- [ ] **Step 3: Implement** — keep the `Props` shape `{ view: View; onChange: (v: View) => void; historyCount: number | undefined }`. Render with `Button` primitives. Skeleton:

```tsx
'use client';
import { Button } from '../../../../components/ui/button';
import type { View } from '../_state/read-page-reducer';

type Props = { view: View; onChange: (view: View) => void; historyCount: number | undefined };

export function ReadTopBar({ view, onChange, historyCount }: Props) {
  const isCurrent = view === 'annotated' || view === 'empty';
  return (
    <div className="flex items-start justify-between gap-[12px] border-b border-rule pb-[14px] mobile:flex-col">
      <div>
        <div className="t-micro text-ink-mute">reading</div>
        <h1 className="t-display-m mt-[4px]">read <span className="text-accent">&amp;</span> collect</h1>
      </div>
      <div className="flex items-center gap-[6px] mobile:w-full mobile:flex-wrap">
        {/* current / history tabs */}
        <Button size="sm" variant={isCurrent ? 'primary' : 'ghost'} aria-current={isCurrent ? 'page' : undefined} onClick={() => onChange('annotated')}>
          <span className="mobile:hidden">current text</span><span className="hidden mobile:inline">current</span>
        </Button>
        <Button size="sm" variant={view === 'history' ? 'primary' : 'ghost'} aria-current={view === 'history' ? 'page' : undefined} onClick={() => onChange('history')}>
          history <span className="t-mono ml-[4px] text-[10px] opacity-70">{historyCount ?? '—'}</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onChange('pasting')}>+ paste</Button>
        <Button size="sm" variant={view === 'generating' ? 'primary' : 'default'} aria-current={view === 'generating' ? 'page' : undefined} onClick={() => onChange('generating')}>+ generate</Button>
      </div>
    </div>
  );
}
```
(`+ generate` uses `primary` look when active and `default` otherwise so it reads as the headline action; adjust to taste but keep it visually dominant.)

- [ ] **Step 4: Run → pass** + `pnpm --filter @language-drill/web typecheck`.

- [ ] **Step 5: Commit**
```bash
git add "apps/web/app/(dashboard)/read/_components/read-top-bar.tsx" "apps/web/app/(dashboard)/read/_components/__tests__/read-top-bar.test.tsx"
git commit -m "feat(web): redesign read & collect header"
```

---

## Task 7: Web — idea cards + empty view

**Files:** Create `_components/idea-cards.tsx`; rewrite `_components/empty-view.tsx`; tests for both.

`IdeaCards` is shared by the empty state ("POPULAR STARTS") and the composer ("start from an idea"). Props: `{ ideas: readonly ReadingIdea[]; selectedPrompt?: string | null; onPick: (idea: ReadingIdea) => void; variant: 'card' | 'chip'; disabled?: boolean }`. `card` = the 2-col grid of large cards (empty state); `chip` = compact pills (composer). Each renders the category eyebrow in `text-accent t-micro`, the prompt (`t-body`/serif for cards), and (card variant) the descriptor in `t-mono text-ink-mute`.

- [ ] **Step 1: Failing tests** — `_components/__tests__/idea-cards.test.tsx`: renders all 6 ideas; clicking one calls `onPick` with that idea; selected prompt gets a selected style (`solid`/black) — assert via `aria-pressed` on the button.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement `idea-cards.tsx`** — import `READING_IDEAS`, `ReadingCategory`, type `ReadingIdea` from `@language-drill/shared`. Use a `<button type="button" aria-pressed={selected}>` per idea (selected when `selectedPrompt === idea.prompt`). Category label = `idea.category.toUpperCase()`. `card` variant: grid `grid grid-cols-2 gap-[12px] mobile:grid-cols-1`, each a bordered `card` with padding `p-s-4`, eyebrow + serif title + descriptor. `chip` variant: `flex flex-wrap gap-[8px]`, each a pill (`rounded-r-pill border`), selected → `bg-ink text-paper`.

- [ ] **Step 4: Rewrite `empty-view.tsx`** — Props `{ onGenerate: () => void; onPaste: () => void; onPickIdea: (idea: ReadingIdea) => void; languageLabel: string }`. Layout/copy (exact):
  - eyebrow: `read at your level` in `t-hand text-accent text-[26px]`.
  - title: `nothing to read yet.` in `t-display-l`.
  - body (`t-body text-ink-soft`): `Tell me what you're in the mood for and I'll write a passage in {languageLabel} at just the right difficulty — then flag the words worth collecting.`
  - primary `Button` size `lg`: `generate a passage →` → `onGenerate`.
  - inline link/ghost: `or paste your own` → `onPaste`.
  - section label `POPULAR STARTS` (`t-micro text-ink-mute`) + `<IdeaCards variant="card" ideas={READING_IDEAS} onPick={onPickIdea} />`.

Test `empty-view.test.tsx`: title + body render with the language label; `generate a passage` fires `onGenerate`; `or paste your own` fires `onPaste`; picking a popular start fires `onPickIdea`.

- [ ] **Step 5: Run → pass** — `pnpm --filter @language-drill/web test -- idea-cards.test.tsx empty-view.test.tsx` + typecheck.

- [ ] **Step 6: Commit**
```bash
git add "apps/web/app/(dashboard)/read/_components/idea-cards.tsx" "apps/web/app/(dashboard)/read/_components/empty-view.tsx" "apps/web/app/(dashboard)/read/_components/__tests__/idea-cards.test.tsx" "apps/web/app/(dashboard)/read/_components/__tests__/empty-view.test.tsx"
git commit -m "feat(web): idea cards + redesigned empty state"
```

---

## Task 8: Web — length control + level ladder

**Files:** Create `_components/length-control.tsx` and `_components/level-ladder.tsx`; tests.

**LengthControl** — Props `{ value: ReadingTextLength; onChange: (l: ReadingTextLength) => void; disabled?: boolean }`. Three segmented cards (grid `grid-cols-3 gap-[10px] mobile:grid-cols-1`), each `<button aria-pressed>` showing the length name (`t-body` serif) + `≈ {READING_LENGTH_APPROX[l]} words` (`t-mono text-ink-mute`). Selected → `bg-ink text-paper`. Order: SHORT, MEDIUM, LONG.

**LevelLadder** — Props `{ value: CefrLevel; yourLevel: CefrLevel | null; onChange: (c: CefrLevel) => void; disabled?: boolean }`. A horizontal segmented bar over `bg-paper-2 rounded-r-pill`, with all six `Object.values(CefrLevel)` as `<button aria-pressed>`; selected → `bg-ink text-paper rounded-r-pill`. Header row: `LEVEL` (`t-micro`) on the left, `CEFR` (`t-micro text-ink-mute`) on the right. Under the bar, if `yourLevel` set, a caption `• matched to your level` (`t-micro`, the dot in `text-accent`) — position the dot under the `yourLevel` cell (acceptable to render the caption left-aligned beneath the bar for v1; the dot indicates the user's level by coloring that cell's bottom border `border-accent`). Keep it simple and accessible.

- [ ] **Step 1: Failing tests** — `length-control.test.tsx`: 3 options with approx words; clicking calls `onChange`; selected has `aria-pressed`. `level-ladder.test.tsx`: 6 levels; clicking calls `onChange`; the `yourLevel` cell is marked (e.g. `data-your-level` attr) and the "matched to your level" caption shows when `yourLevel` set, hidden when null.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** both per the specs above (import `ReadingTextLength`, `READING_LENGTH_APPROX`, `CefrLevel` from shared). Add `data-your-level="true"` to the matching ladder cell for the test hook.

- [ ] **Step 4: Run → pass** + typecheck.

- [ ] **Step 5: Commit**
```bash
git add "apps/web/app/(dashboard)/read/_components/length-control.tsx" "apps/web/app/(dashboard)/read/_components/level-ladder.tsx" "apps/web/app/(dashboard)/read/_components/__tests__/length-control.test.tsx" "apps/web/app/(dashboard)/read/_components/__tests__/level-ladder.test.tsx"
git commit -m "feat(web): segmented length control + CEFR level ladder"
```

---

## Task 9: Web — composer (`GenerateView`) rewrite

**Files:** Rewrite `_components/generate-view.tsx`; update `__tests__/generate-view.test.tsx`.

Props (controlled): `{ state: GenerateState; ideas: readonly ReadingIdea[]; languageLabel: string; yourLevel: CefrLevel | null; onChange: <K extends keyof GenerateState>(field: K, value: GenerateState[K]) => void; onPickIdea: (idea: ReadingIdea) => void; onGenerate: () => void; onCancel: () => void; isLoading: boolean; errorBody: string | null; rateLimited?: boolean }`.

Where `GenerateState = { topic: string; length: ReadingTextLength; cefr: CefrLevel; language: 'ES'|'DE'|'TR'; category: ReadingCategory | null }` — import the type from the reducer.

- [ ] **Step 0 (prereq): add `category` to the generate slice now** — in `_state/read-page-reducer.ts`, add `category: ReadingCategory | null` to the `generate` slice type, set `initialState.generate.category = null`, add `'category'` to the `GENERATE_FIELD` action's `field` union, import `ReadingCategory` from `@language-drill/shared`, and export the `generate` slice as a named `GenerateState` type. Run `pnpm --filter @language-drill/web test -- read-page-reducer.test.ts` (existing tests still pass) before continuing. (The `provenance` slice + `SET_PROVENANCE` come later in Task 14.)

Layout/copy (exact):
- eyebrow `NEW TEXT` (`t-micro text-ink-mute`); title `generate a passage` (`t-display-m`).
- subtitle (`t-body text-ink-soft`): `Describe what you'd like to read. I'll write it in {languageLabel}, tuned to your level — then flag the words worth collecting.`
- label row: `WHAT TO READ ABOUT` (`t-micro`) + counter `{topic.length} / 200` (`t-mono text-ink-mute`, turns `text-accent` if over).
- `Textarea` (reuse primitive), placeholder italic: `a letter from someone leaving their hometown...`, `maxLength={READING_GEN_TOPIC_MAX_CHARS}`.
- `or start from an idea` (the `or` in `text-accent italic`) + `<IdeaCards variant="chip" ideas={ideas} selectedPrompt={state.topic} onPick={onPickIdea} disabled={isLoading} />`.
- `LENGTH` + `<LengthControl value={state.length} onChange={(l) => onChange('length', l)} disabled={isLoading} />`.
- `<LevelLadder value={state.cefr} yourLevel={yourLevel} onChange={(c) => onChange('cefr', c)} disabled={isLoading} />`.
- live "you'll get" summary line (`t-small text-ink-soft`): `you'll get a {lengthName} (~{approx} word) {category-or-"passage"} at {cefr} in {languageLabel}.` — compute from state.
- actions: `cancel` (ghost → onCancel) + primary `generate a passage →` (→ onGenerate), disabled when `isLoading || topic.trim()===''  || topic.length>200`. While loading show `generating…`.
- error/rate-limit: if `rateLimited` show "daily generation limit reached" (`role="alert"`); else if `errorBody` show it (`role="alert"`).

`onPickIdea` sets BOTH topic and category (handled by parent). `onChange('topic', …)` also clears category (free-text has no category) — parent handles; the component just calls `onChange('topic', value)` on textarea input.

- [ ] **Step 1: Update tests** — `generate-view.test.tsx`: textarea typing → `onChange('topic', ...)`; picking an idea chip → `onPickIdea`; length/level selections → `onChange('length'|'cefr', ...)`; "you'll get" summary reflects state; generate disabled when empty and fires `onGenerate` when valid; loader/rate-limit messaging. Remove any stale language-select assertions (no language field).

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** the component composing `Textarea`, `IdeaCards`, `LengthControl`, `LevelLadder`, `Button`. No `<select>`s.

- [ ] **Step 4: Run → pass** + typecheck + `pnpm --filter @language-drill/web lint`.

- [ ] **Step 5: Commit**
```bash
git add "apps/web/app/(dashboard)/read/_components/generate-view.tsx" "apps/web/app/(dashboard)/read/_components/__tests__/generate-view.test.tsx"
git commit -m "feat(web): rebuild generate composer (ideas + length + level ladder)"
```

---

## Task 10: Web — paste view rewrite

**Files:** Rewrite `_components/paste-view.tsx`; update `__tests__/paste-view.test.tsx` if present.

Props: keep `{ paste: { title: string; source: string; text: string }; onChange: (field: 'title'|'source'|'text', value: string) => void; onCancel: () => void; onAnnotate: () => void; isLoading: boolean; errorBody: string | null; rateLimited?: boolean }`. (We map the design's single "title or source" field to the existing `source` field; leave `title` derived/empty — see note.)

Design/copy (exact):
- eyebrow `NEW TEXT`; title `paste a passage` (`t-display-m`).
- subtitle (`t-body text-ink-soft`): `Bring something you're already reading — an article, a chapter, a message. I'll flag the words above your level, just like a generated text.`
- `TITLE OR SOURCE · optional` label; `Input` placeholder `e.g. El País — opinión` bound to `paste.source` (this is the entry's source/title line). Set `paste.title` = same value on annotate, or leave title empty and use source as the display title — keep current page behavior (title can stay empty).
- `PASSAGE` label + counter `{text.length} / 2,000` (`t-mono`; `text-accent` when over `READ_TEXT_MAX_CHARS`).
- `Textarea` placeholder italic: `paste a paragraph or two here — prose works better than lists or code.`
- `HEADS UP` callout box (`bg-paper-2 rounded-r-md p-s-4`): `annotation runs on your text only — nothing is shared. words you save flow into your drills.`
- actions: `cancel` (ghost → onCancel) + primary `annotate →` (→ onAnnotate), disabled when `isLoading || text.trim()==='' || text.length>READ_TEXT_MAX_CHARS || rateLimited`.

Note: bind the single source/title field to `source`. The composer's wiring stays the same. Keep the existing char-limit + rate-limit behavior.

- [ ] **Step 1: Update tests** — render title/passage; counter; heads-up copy; annotate disabled when empty + fires `onAnnotate` when text present; cancel fires `onCancel`.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run → pass** + typecheck.

- [ ] **Step 5: Commit**
```bash
git add "apps/web/app/(dashboard)/read/_components/paste-view.tsx" "apps/web/app/(dashboard)/read/_components/__tests__/paste-view.test.tsx"
git commit -m "feat(web): redesign paste-a-passage view"
```

---

## Task 11: Web — generating (calibrating) view

**Files:** Create `_components/generating-view.tsx`; test.

A simple, calm loading state shown while a generation request is in flight (before the annotated reader takes over). Props: `{ languageLabel: string; provenance: { category: ReadingCategory | null; cefr: CefrLevel; length: ReadingTextLength; prompt: string } }`.

Copy: eyebrow `read at your level` (`t-hand text-accent`); a heading `writing your passage…` (`t-display-m`); a subline (`t-small text-ink-soft`): `tuning a {lengthName} {category-or-"passage"} to {cefr} in {languageLabel}, then calibrating the words worth collecting.` Include an indeterminate progress affordance — reuse the existing spinner used by `Button`/`CalibrationStrip` (look at `calibration-strip.tsx` for the bar) or a simple `role="status"` pulsing bar. Keep it `role="status" aria-live="polite"`.

- [ ] **Step 1: Failing test** — renders a `role="status"` with "writing your passage…" and reflects the prompt/level.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run → pass** + typecheck.

- [ ] **Step 5: Commit**
```bash
git add "apps/web/app/(dashboard)/read/_components/generating-view.tsx" "apps/web/app/(dashboard)/read/_components/__tests__/generating-view.test.tsx"
git commit -m "feat(web): calibrating generating view"
```

---

## Task 12: Web — provenance header, adjust bar, collect bar

**Files:** Create `_components/provenance-header.tsx`, `_components/adjust-bar.tsx`, `_components/collect-bar.tsx`; tests.

**ProvenanceHeader** — Props `{ prompt: string; category: ReadingCategory | null; cefr: CefrLevel; length: ReadingTextLength; languageLabel: string; onRewrite: () => void; rewriting?: boolean }`. A `bg-paper-2 rounded-r-md p-s-4` card: a small book glyph (use an emoji/inline svg or the accent-soft square seen in design — a `bg-accent-soft` rounded square), the prompt in italic quotes (`t-body`), a tag row of `Chip`s: category (variant `accent`, label uppercased) · `cefr` (default) · length uppercased (default) · `languageLabel` uppercased (default), and a circular icon button on the right calling `onRewrite` (↻; disabled while `rewriting`).

**AdjustBar** — Props `{ cefr: CefrLevel; length: ReadingTextLength; onAdjust: (kind: 'easier'|'harder'|'longer'|'rewrite') => void; busy?: boolean }`. Label `ADJUST` (`t-micro`) + buttons (ghost, size sm): `- make easier` (disabled at A1), `+ make harder` (disabled at C2), `↔ longer` (disabled at LONG), `↻ rewrite`. All disabled while `busy`.

**CollectBar** — Props `{ flaggedCount: number; savedCount: number; onSaveToLibrary: () => void; onAddToVocabulary: () => void; saving?: boolean }`. A bottom bar (`bg-paper-2 rounded-r-md p-s-4 flex items-center justify-between`): left `{flaggedCount} flagged · {savedCount} saved` (`t-small text-ink-soft`); right: `save to library` (ghost → onSaveToLibrary) and, when `savedCount > 0`, primary `add {savedCount} to vocabulary →` (→ onAddToVocabulary). When `savedCount === 0`, show only the primary `save to library`.

- [ ] **Step 1: Failing tests** — `provenance-header.test.tsx` (renders prompt + tags + rewrite fires `onRewrite`); `adjust-bar.test.tsx` (4 buttons, disabled edges at A1/C2/LONG, fire `onAdjust` with the right kind); `collect-bar.test.tsx` (counts; primary shows "add N to vocabulary" when saved>0 and "save to library" when 0; buttons fire callbacks).

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** all three using `Chip`/`Button`. Use `Object.values(CefrLevel)` / `Object.values(ReadingTextLength)` to compute edge-disabled states.

- [ ] **Step 4: Run → pass** + typecheck.

- [ ] **Step 5: Commit**
```bash
git add "apps/web/app/(dashboard)/read/_components/provenance-header.tsx" "apps/web/app/(dashboard)/read/_components/adjust-bar.tsx" "apps/web/app/(dashboard)/read/_components/collect-bar.tsx" "apps/web/app/(dashboard)/read/_components/__tests__/provenance-header.test.tsx" "apps/web/app/(dashboard)/read/_components/__tests__/adjust-bar.test.tsx" "apps/web/app/(dashboard)/read/_components/__tests__/collect-bar.test.tsx"
git commit -m "feat(web): provenance header, adjust bar, collect bar"
```

---

## Task 13: Web — library card grid (`HistoryView`)

**Files:** Rewrite `_components/history-view.tsx`; update its test.

Props: `{ entries: readonly ReadEntrySummary[]; onOpen: (id: string) => void; onGenerateNew: () => void; languageLabel: string }` where `ReadEntrySummary` now includes `kind/category/cefr/length/prompt`.

Design: heading `YOUR READING` (`t-micro`) over `past texts` (`t-display-m`). A grid `grid grid-cols-2 gap-[16px] mobile:grid-cols-1` of cards. Each card (`card rounded-r-md p-s-4 cursor-pointer` → `onOpen(id)`): title (`t-display-s` serif) + relative time (`t-mono text-ink-mute`, right-aligned — see helper); the prompt/source in italic quotes (`t-small text-ink-soft`) — use `prompt` for generated, `source` for pasted; tag row of `Chip`s: for generated → category (accent) · cefr · length uppercased; for pasted → a single `pasted` chip (default); then a green `{savedCount} saved` chip (variant `ok`) for both. A final dashed "add" card: a `+` glyph + `generate a new text` → `onGenerateNew`.

Relative-time helper: add `apps/web/app/(dashboard)/read/_lib/relative-time.ts` exporting `relativeTime(iso: string, now: number): string` returning `just now` (<60s), `today` (<24h same day), `Nd ago` (<7d), `last week` (<14d), else a short date. Keep deterministic (take `now` as a param for testability). Unit-test it.

- [ ] **Step 1: Failing tests** — `read-history.test.tsx` (or existing history test): renders a card per entry; clicking a card calls `onOpen(id)`; generated cards show category/cefr/length + saved; pasted cards show a `pasted` tag; the "generate a new text" card calls `onGenerateNew`. `relative-time.test.ts`: the buckets above.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** the grid + the helper.

- [ ] **Step 4: Run → pass** + typecheck.

- [ ] **Step 5: Commit**
```bash
git add "apps/web/app/(dashboard)/read/_components/history-view.tsx" "apps/web/app/(dashboard)/read/_lib/relative-time.ts" "apps/web/app/(dashboard)/read/_components/__tests__/"* "apps/web/app/(dashboard)/read/_lib/"*
git commit -m "feat(web): library card grid + relative-time helper"
```

---

## Task 14: Web — reducer + page wiring

**Files:** Modify `_state/read-page-reducer.ts` (+ test), `annotated-view.tsx`, `page.tsx`.

This wires everything: provenance, category, popular-start→composer, adjust/rewrite, save-with-metadata, and mounts provenance/adjust/collect in the reader. Also removes `READING_CHIPS_BY_LANGUAGE` usage.

- [ ] **Step 1: Reducer failing tests** — append to `read-page-reducer.test.ts`:
```typescript
it('sets generate.category and clears it on free-text topic', () => {
  let s = readPageReducer(initialState, { type: 'GENERATE_FIELD', field: 'category', value: 'story' });
  expect(s.generate.category).toBe('story');
  s = readPageReducer(s, { type: 'GENERATE_FIELD', field: 'topic', value: 'free text' });
  // topic edits do not auto-clear here; the page clears category — but the field write works:
  expect(s.generate.topic).toBe('free text');
});
it('stores and clears provenance', () => {
  let s = readPageReducer(initialState, { type: 'SET_PROVENANCE', provenance: { kind: 'generated', category: 'story', cefr: 'B2', length: 'long', prompt: 'a cat', language: 'ES' } });
  expect(s.provenance?.kind).toBe('generated');
  s = readPageReducer(s, { type: 'SET_PROVENANCE', provenance: null });
  expect(s.provenance).toBeNull();
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Reducer implementation:**
  - Import `ReadingCategory` from `@language-drill/shared`.
  - Extend `generate` slice type: add `category: ReadingCategory | null`; `initialState.generate.category = null`.
  - Extend `GENERATE_FIELD` action field union to include `'category'` (value typed `string`); the existing spread handler works.
  - Add `provenance` to `ReadPageState`: `provenance: { kind: 'generated' | 'pasted'; category: ReadingCategory | null; cefr: CefrLevel; length: ReadingTextLength; prompt: string; language: 'ES'|'DE'|'TR' } | null;` and `initialState.provenance = null`.
  - Add action `| { type: 'SET_PROVENANCE'; provenance: ReadPageState['provenance'] }` with handler `return { ...state, provenance: action.provenance };`.
  - Export the `GenerateState` type (the `generate` slice) if not already, so `generate-view.tsx` can import it.

- [ ] **Step 4: Page wiring (`page.tsx`)** — exact changes:
  - Import `READING_IDEAS`, `ReadingCategory`, `LANGUAGE_NATIVE_NAME`, `ReadingTextLength`, `CefrLevel` from `@language-drill/shared`; remove the `READING_CHIPS_BY_LANGUAGE` import. Import the new components (`IdeaCards` usage is inside views; import `GeneratingView`, and pass new props to `EmptyView`/`GenerateView`/`HistoryView`/`AnnotatedView`).
  - `const languageLabel = LANGUAGE_NATIVE_NAME[activeLanguage as Language];` (map 'ES'|'DE'|'TR' → native).
  - **EmptyView**: pass `onGenerate={handleOpenGenerate}`, `onPaste={handlePasteNew}`, `onPickIdea={handlePickIdea}`, `languageLabel`.
  - `handlePickIdea(idea)`: `dispatch GENERATE_FIELD topic=idea.prompt`, `GENERATE_FIELD category=idea.category`, then `handleViewChange('generating')` (defaults cefr/language). (From empty OR composer.)
  - **GenerateView**: pass `state={state.generate}`, `ideas={READING_IDEAS}`, `languageLabel`, `yourLevel={proficiencyLevel}`, `onChange` (dispatch `GENERATE_FIELD`; when field==='topic', also dispatch `GENERATE_FIELD category=''`→ set null to clear category on free-text — represent null as empty string then coerce, OR add handling), `onPickIdea={handlePickIdea}`, `onGenerate={handleGenerate}`, `onCancel`, `isLoading`, `errorBody`, `rateLimited`.
  - **handleGenerate**: build request `{ language: activeLanguage, cefr: state.generate.cefr, length: state.generate.length, topic: state.generate.topic }`; before calling, `dispatch SET_VIEW 'generating'` is already done (composer is the generating-trigger) — instead, switch to a dedicated generating screen while pending: set a local generating view. Simplest: keep composer mounted but on submit, dispatch nothing extra; rely on `generateMutation.isPending` to render `<GeneratingView>` IN PLACE of the composer when `state.view === 'generating' && generateMutation.isPending`. On success: `dispatch SET_PROVENANCE { kind:'generated', category: state.generate.category, cefr, length, prompt: topic, language: activeLanguage }`, then `startAnnotation(data.text, data.title)`. On the page's view switch, render: if `state.view === 'generating'` → if `generateMutation.isPending` render `<GeneratingView>` else `<GenerateView>`.
  - **handleAdjust(kind)**: compute next params from `state.provenance` (must be a generated text): `easier`=cefr−1, `harder`=cefr+1 (clamp via `Object.values(CefrLevel)` index), `longer`=length+1 (clamp via `Object.values(ReadingTextLength)`), `rewrite`=same params + `noCache:true`. Call `generateMutation.mutate({ language: provenance.language, cefr: nextCefr, length: nextLength, topic: provenance.prompt, noCache: kind==='rewrite' })`; on success update `SET_PROVENANCE` with the new cefr/length and `startAnnotation(data.text, data.title)`. Show the reader's adjust bar `busy` while pending.
  - **AnnotatedView additions** (Step 5).
  - **Save handlers**: extend the existing save path so the entry persists provenance. Where `saveEntry.mutate(...)` / `handleBankToggle` build the save payload, add `kind: state.provenance?.kind ?? 'pasted'`, `category: state.provenance?.category ?? null`, `cefr: state.provenance?.cefr ?? null`, `length: state.provenance?.length ?? null`, `prompt: state.provenance?.prompt ?? null`. Add `handleSaveToLibrary()` (save entry with current bank, even if empty) and `handleAddToVocabulary()` (same save; bank already holds the words) — both call the existing save with metadata; wire to `CollectBar`.
  - **History open**: in the entry-load effect, when the loaded entry has `kind === 'generated'`, `dispatch SET_PROVENANCE` from its `category/cefr/length/prompt/language`; else `SET_PROVENANCE null`.
  - **HistoryView**: pass `entries`, `onOpen={handleHistoryOpen}`, `onGenerateNew={handleOpenGenerate}`, `languageLabel`.

- [ ] **Step 5: AnnotatedView** — add optional props `{ provenance?: ProvenanceInfo | null; onAdjust?: (k) => void; adjustBusy?: boolean; flaggedCount: number; savedCount: number; onSaveToLibrary?: () => void; onAddToVocabulary?: () => void; saving?: boolean; languageLabel: string }`. When `provenance?.kind === 'generated'`, render `<ProvenanceHeader …>` + `<AdjustBar …>` above the passage and the `~N min` subline (`generated · {languageLabel} · {cefr} · ~{minutes} min`, minutes = `Math.max(1, Math.round(wordCount/200))`). Always render `<CollectBar …>` at the bottom (reuses existing bank/save counts). Do NOT remove the existing word-bank rail / popover behavior — layer these in. Keep all existing props/behavior intact.

- [ ] **Step 6: Run** — `pnpm --filter @language-drill/web test` (full web suite) + `pnpm --filter @language-drill/web typecheck` + `pnpm --filter @language-drill/web lint`. Fix fallout (e.g. other call sites of changed component props). All green.

- [ ] **Step 7: Commit**
```bash
git add "apps/web/app/(dashboard)/read"
git commit -m "feat(web): wire generate flow — provenance, adjust/rewrite, library, save metadata"
```

---

## Task 15: Full-suite verification

- [ ] **Step 1: Build** — `pnpm build` → all packages.
- [ ] **Step 2: Lint** — `pnpm lint` → 0 errors.
- [ ] **Step 3: Typecheck** — `pnpm typecheck` → 0 errors.
- [ ] **Step 4: Tests (serialized)** — `pnpm turbo run test --concurrency=1` → all green. (Per project memory, parallel `pnpm test` can flakily fail `infra`; `--concurrency=1` is the reliable signal.)
- [ ] **Step 5: Report** X passed / Y failed per package; fix any failure before claiming done.
- [ ] **Step 6: Final commit** if fixups were needed.

---

## Self-review notes (author)

- **Spec coverage:** header (T6) · empty + popular starts (T7) · composer with segmented length + level ladder + ideas + you'll-get + no language field (T8, T9) · paste redesign (T10) · generating/calibrating, non-streaming per decision 1 (T11) · result = provenance + adjust + reused annotation + collect bar (T12, T14) · rewrite force-fresh per decision 2 (T4, T12, T14) · library card grid generated-vs-pasted per decision 3 (T2, T3, T5, T13) · adjust-without-retyping via stored prompt/provenance (T2, T5, T14). All covered.
- **Review-harness exclusion:** no task builds the outer page title, device toggle, dual frames, or the left state-walker/request/what-changed cards. Only in-frame product.
- **Decisions honored:** (1) non-streaming + calibrating loader; (2) `noCache` upsert force-fresh; (3) metadata columns, rich generated / lean pasted.
- **Type consistency:** `GenerateState` (reducer) gains `category: ReadingCategory|null` (T14) and is consumed by `GenerateView` (T9) — T9 imports the type from the reducer; ensure T14's reducer change lands before T9 is reviewed, or T9 declares the prop shape to match. Implementation order is T1→T15 as numbered; T9 depends on T8 components and the `GenerateState` shape — if T9 runs before T14, add the `category` field to `GenerateState` as part of T9's prep (note in T9: "if `category` not yet on `GenerateState`, this is added in T14; declare the prop type to include it"). To avoid the ordering hazard, **move the `generate.category` reducer field addition to the START of T9** (small, additive) and keep the `provenance` slice + wiring in T14.
- **Empty-bank save:** api-client (T3) + backend (T5) both relax bank and guard the vocab insert; CollectBar's "save to library" relies on this.
- **READING_CHIPS_BY_LANGUAGE:** kept through T1–T13; removed in T14 when `page.tsx` switches to `READING_IDEAS`. No intermediate web build breaks because only T14 touches the consumer.
