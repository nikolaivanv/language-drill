# PoS-enriched Vocab Lemma Table — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Postgres `vocab_lemma` table carrying per-language lemma + frequency rank + parts-of-speech, sourced from Wiktextract with an LLM gap-fill pass, and switch generation seed-selection to read verb/word-class bands from that table — making verb seeding language-agnostic instead of Spanish-only.

**Architecture:** A new `vocab_lemma` table is the source of truth for lemma-level vocab metadata. A build script joins the existing frequency corpus TSVs (lemma, rank) with a Wiktextract dump (lemma → PoS) into a committed per-language JSON artifact; a seed command upserts it into the table. The deterministic seed-pickers (`pickSeeds`/`pickConjugationSeeds`) become pure functions over an *injected* band array; new DB-backed band loaders (`loadFrequencyBand`/`loadVerbBand`) query `vocab_lemma`. The bundled surface→`{lemma,rank}` frequency JSON is untouched (it still serves annotation/reading-level lookups). The old morphology-based `verbBand`/`frequencyBand` in `@language-drill/ai` are deleted once nothing calls them.

**Tech Stack:** TypeScript, Drizzle ORM + Neon Postgres, Vitest, Anthropic SDK (gap-fill), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-20-vocab-lemma-pos-table-design.md`

## Global Constraints

- **`@language-drill/ai` source MUST NOT import `@language-drill/db`.** Only `db → ai` is allowed. Inject data into `ai` via parameters (the established pattern). A `db` import in `ai` source typechecks locally but fails CI from clean with TS2307.
- **Languages with frequency data: ES, DE, TR only.** EN has no frequency dictionary and is never seeded.
- **Bundle stays untouched** — `packages/ai/src/frequency/{es,de,tr}.json` (surface→`{lemma,rank}`) is not modified; no new data is bundled into the Lambda.
- **Migrations are forward-only.** Generate with `drizzle-kit generate` (`pnpm --filter @language-drill/db db:generate`); apply with `pnpm --filter @language-drill/db db:migrate` (NOT `drizzle-kit migrate`). If a migration-number collision occurs on merge, take main's `migrations/meta`, `git rm` the stale `.sql`, and re-generate to renumber.
- **DB-gated tests** require `TEST_DATABASE_URL` to be set; mock-Claude tests set `MOCK_CLAUDE=1`.
- **Pre-push gate:** `pnpm lint && pnpm typecheck && pnpm test` from repo root, zero failures.
- **No new runtime dependencies** are required.
- **Commit after each task.** Squash-merge the final PR into one clean commit.

---

## File Structure

**Create:**
- `packages/db/src/schema/vocab.ts` — `vocab_lemma` table definition.
- `packages/db/src/generation/vocab-band.ts` — DB-backed band loaders.
- `packages/db/src/generation/vocab-band.test.ts` — band-loader tests (DB-gated).
- `packages/ai/scripts/build-vocab-lemma.ts` — corpus×Wiktextract join + gap-fill → artifact.
- `packages/ai/scripts/build-vocab-lemma.test.ts` — pure join/gap-fill unit tests.
- `packages/ai/src/frequency/vocab-lemma/{es,de,tr}.json` — committed seed artifacts.
- `packages/db/scripts/seed-vocab.ts` — upsert artifact into `vocab_lemma`.
- `packages/db/migrations/00NN_*.sql` — generated migration (number assigned by drizzle-kit).

**Modify:**
- `packages/db/src/schema/index.ts` — export the new table.
- `packages/db/src/generation/seed-picker.ts` — pickers take an injected `band`.
- `packages/db/src/generation/seed-picker.test.ts` — rewrite to inject fake bands (pure).
- `packages/db/src/generation/run-one-cell.ts` — `buildSeedWords` becomes async + DB-backed; add `seedKindFor`; drop ES-only conjugation guard.
- `packages/db/src/generation/run-one-cell.test.ts` — update `buildSeedWords` call sites; DB-gate the band-dependent cases; seed a `vocab_lemma` fixture.
- `packages/ai/src/frequency/index.ts` — delete `frequencyBand`, `verbBand`, and verb-stat machinery.
- `packages/ai/src/frequency/frequency.test.ts` — remove the `frequencyBand`/`verbBand` describe blocks + imports.
- `packages/ai/package.json` — add `build:vocab-lemma` script.
- `packages/db/package.json` — add `seed:vocab` script.
- `packages/db/src/curriculum/index.ts` — raise description cap 200 → 300.
- `packages/shared/src/curriculum-types.ts` — update the `≤ 200 chars` doc comment.
- `packages/db/src/curriculum/curriculum.test.ts` — update over-long-description test.

---

## Task 1: `vocab_lemma` schema + migration

**Files:**
- Create: `packages/db/src/schema/vocab.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/00NN_*.sql` (generated)

**Interfaces:**
- Produces: `vocabLemma` table; types `VocabLemma`, `NewVocabLemma`. Columns: `language: text`, `lemma: text`, `rank: integer`, `posAll: text[]` (`pos_all`), `source: text`. Composite PK `(language, lemma)`. Index `vocab_lemma_language_rank_idx` on `(language, rank)`.

- [ ] **Step 1: Write the table definition**

Create `packages/db/src/schema/vocab.ts`:

```ts
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { index, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

/**
 * Lemma-level vocabulary metadata, source of truth for generation seed
 * selection (see docs/superpowers/specs/2026-06-20-vocab-lemma-pos-table-design.md).
 * One row per (language, lemma). `rank` is the min corpus rank across the
 * lemma's surfaces (sense-blind). `posAll` holds every attested UD upos tag —
 * consumers ask set-membership questions ('VERB' = ANY(pos_all)); there is no
 * principled scalar "dominant" PoS, so none is stored. `source` records
 * provenance for the gap-fill quality audit.
 */
export const vocabLemma = pgTable(
  'vocab_lemma',
  {
    language: text('language').notNull(), // ES | DE | TR (TS-enforced LearningLanguage)
    lemma: text('lemma').notNull(),
    rank: integer('rank').notNull(),
    posAll: text('pos_all').array().notNull().default([]), // e.g. {VERB,NOUN}
    source: text('source').notNull(), // wiktextract | llm | unmatched (TS-enforced)
  },
  (t) => ({
    pk: primaryKey({ columns: [t.language, t.lemma] }),
    langRankIdx: index('vocab_lemma_language_rank_idx').on(t.language, t.rank),
  }),
);

export type VocabLemma = InferSelectModel<typeof vocabLemma>;
export type NewVocabLemma = InferInsertModel<typeof vocabLemma>;
```

- [ ] **Step 2: Export the table**

In `packages/db/src/schema/index.ts`, add after the `generationJobs` export line:

```ts
export { vocabLemma } from './vocab';
export type { VocabLemma, NewVocabLemma } from './vocab';
```

- [ ] **Step 3: Build the package to verify it compiles**

Run: `pnpm --filter @language-drill/db build`
Expected: success, no TS errors.

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @language-drill/db db:generate`
Expected: a new file `packages/db/migrations/00NN_*.sql` containing `CREATE TABLE "vocab_lemma"` with the composite PK and the `vocab_lemma_language_rank_idx` index. Open it and confirm `pos_all` is `text[]` with `DEFAULT '{}'` (or `ARRAY[]::text[]`), and the PK is `("language","lemma")`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/vocab.ts packages/db/src/schema/index.ts packages/db/migrations
git commit -m "feat(db): add vocab_lemma table for lemma-level PoS metadata"
```

---

## Task 2: Build script — corpus × Wiktextract join

**Files:**
- Create: `packages/ai/scripts/build-vocab-lemma.ts`
- Create: `packages/ai/scripts/build-vocab-lemma.test.ts`
- Modify: `packages/ai/package.json`

**Interfaces:**
- Produces: pure function `joinLemmaPos(corpusRows, wiktRows)` and the artifact type. Artifact rows: `{ lemma: string; rank: number; posAll: string[]; source: 'wiktextract' | 'unmatched' }` (the `'llm'` source is added in Task 3). Written to `packages/ai/src/frequency/vocab-lemma/{es,de,tr}.json` as a JSON array.
- Consumes: the existing corpus TSVs at `packages/ai/scripts/sources/{es,de,tr}.tsv` (format `surface\tlemma\trank[\tcefr]`, already used by `build-frequency.ts`) and Wiktextract JSONL dumps at `packages/ai/scripts/sources/wiktextract/{es,de,tr}.jsonl` (one JSON object per line, fields `{ word: string, pos: string }`; not committed).

**Background:** Wiktextract `pos` values (e.g. `"verb"`, `"noun"`, `"adj"`, `"adv"`, `"name"`, `"num"`) map to UD upos. The verb filter only cares about `VERB` membership, so a small uppercase mapping suffices. Lemmas with no Wiktextract match keep their corpus rank, `posAll: []`, `source: 'unmatched'` — they stay available for cloze/translation seeding (which does not filter by PoS) but are never picked as verbs.

- [ ] **Step 1: Write the failing test**

Create `packages/ai/scripts/build-vocab-lemma.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

import { POS_MAP, joinLemmaPos, type CorpusRow, type WiktRow } from './build-vocab-lemma';

describe('POS_MAP', () => {
  it('maps wiktextract pos to UD upos', () => {
    expect(POS_MAP['verb']).toBe('VERB');
    expect(POS_MAP['noun']).toBe('NOUN');
    expect(POS_MAP['adj']).toBe('ADJ');
    expect(POS_MAP['adv']).toBe('ADV');
  });
});

describe('joinLemmaPos', () => {
  const corpus: CorpusRow[] = [
    { lemma: 'hablar', rank: 50 },
    { lemma: 'hablar', rank: 120 }, // another surface of the same lemma
    { lemma: 'casa', rank: 80 },
    { lemma: 'rareword', rank: 9000 },
  ];
  const wikt: WiktRow[] = [
    { word: 'hablar', pos: 'verb' },
    { word: 'casa', pos: 'noun' },
    { word: 'casa', pos: 'verb' }, // homograph: casa is also a verb form lemma
  ];

  it('dedupes by lemma keeping the lowest rank', () => {
    const rows = joinLemmaPos(corpus, wikt);
    const hablar = rows.find((r) => r.lemma === 'hablar');
    expect(hablar?.rank).toBe(50);
  });

  it('collects all attested PoS into posAll (sorted, deduped)', () => {
    const rows = joinLemmaPos(corpus, wikt);
    const casa = rows.find((r) => r.lemma === 'casa');
    expect(casa?.posAll).toEqual(['NOUN', 'VERB']);
    expect(casa?.source).toBe('wiktextract');
  });

  it('marks unmatched lemmas with empty posAll and source=unmatched', () => {
    const rows = joinLemmaPos(corpus, wikt);
    const rare = rows.find((r) => r.lemma === 'rareword');
    expect(rare?.posAll).toEqual([]);
    expect(rare?.source).toBe('unmatched');
  });

  it('orders output by rank ascending then lemma', () => {
    const rows = joinLemmaPos(corpus, wikt);
    expect(rows.map((r) => r.lemma)).toEqual(['hablar', 'casa', 'rareword']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai test build-vocab-lemma`
Expected: FAIL — cannot resolve `./build-vocab-lemma` / exports not defined.

- [ ] **Step 3: Write the build script with the pure join**

Create `packages/ai/scripts/build-vocab-lemma.ts`:

```ts
// ---------------------------------------------------------------------------
// build-vocab-lemma — join the frequency corpus (lemma, rank) with a
// Wiktextract dump (lemma -> PoS) into the per-language vocab-lemma seed
// artifact consumed by `pnpm --filter @language-drill/db seed:vocab`.
//
// Run with `pnpm --filter @language-drill/ai build:vocab-lemma`.
// Sources are NOT checked in:
//   packages/ai/scripts/sources/{es,de,tr}.tsv             (surface\tlemma\trank[\tcefr])
//   packages/ai/scripts/sources/wiktextract/{es,de,tr}.jsonl ({ "word":..., "pos":... } per line)
// Output (committed): packages/ai/src/frequency/vocab-lemma/{es,de,tr}.json
// ---------------------------------------------------------------------------

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LANGUAGES = ['es', 'de', 'tr'] as const;
type Lang = (typeof LANGUAGES)[number];

const SOURCES_DIR = path.join(__dirname, 'sources');
const WIKT_DIR = path.join(SOURCES_DIR, 'wiktextract');
const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'frequency', 'vocab-lemma');

export type CorpusRow = { lemma: string; rank: number };
export type WiktRow = { word: string; pos: string };
export type VocabLemmaSeedRow = {
  lemma: string;
  rank: number;
  posAll: string[];
  source: 'wiktextract' | 'llm' | 'unmatched';
};

// Wiktextract pos string -> UD upos. Unmapped values are uppercased verbatim
// (harmless — only 'VERB' is consulted by the verb filter).
export const POS_MAP: Record<string, string> = {
  verb: 'VERB',
  noun: 'NOUN',
  adj: 'ADJ',
  adv: 'ADV',
  name: 'PROPN',
  num: 'NUM',
  pron: 'PRON',
  adp: 'ADP',
  prep: 'ADP',
  conj: 'CCONJ',
  det: 'DET',
  intj: 'INTJ',
};

function toUpos(pos: string): string {
  return POS_MAP[pos.toLowerCase()] ?? pos.toUpperCase();
}

/**
 * Pure join. Dedupes the corpus by lemma (keeping the lowest rank), attaches
 * every attested PoS from the Wiktextract rows, and orders the result by rank
 * ascending (lemma tie-break). Unmatched lemmas keep their rank with an empty
 * `posAll` and `source: 'unmatched'`.
 */
export function joinLemmaPos(corpus: CorpusRow[], wikt: WiktRow[]): VocabLemmaSeedRow[] {
  // lemma -> sorted, deduped UD upos set
  const posByLemma = new Map<string, Set<string>>();
  for (const w of wikt) {
    const lemma = w.word.toLowerCase();
    if (!lemma) continue;
    const set = posByLemma.get(lemma) ?? new Set<string>();
    set.add(toUpos(w.pos));
    posByLemma.set(lemma, set);
  }

  // lemma -> lowest rank
  const rankByLemma = new Map<string, number>();
  for (const c of corpus) {
    const lemma = c.lemma.toLowerCase();
    if (!lemma) continue;
    const existing = rankByLemma.get(lemma);
    if (existing === undefined || c.rank < existing) rankByLemma.set(lemma, c.rank);
  }

  const rows: VocabLemmaSeedRow[] = [];
  for (const [lemma, rank] of rankByLemma) {
    const pos = posByLemma.get(lemma);
    if (pos === undefined) {
      rows.push({ lemma, rank, posAll: [], source: 'unmatched' });
    } else {
      rows.push({ lemma, rank, posAll: [...pos].sort(), source: 'wiktextract' });
    }
  }

  rows.sort((a, b) =>
    a.rank !== b.rank ? a.rank - b.rank : a.lemma < b.lemma ? -1 : a.lemma > b.lemma ? 1 : 0,
  );
  return rows;
}

function parseCorpus(raw: string): CorpusRow[] {
  const rows: CorpusRow[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed === '') continue;
    const cols = trimmed.split('\t');
    const lemma = (cols[1] ?? '').toLowerCase();
    const rank = Number.parseInt(cols[2] ?? '', 10);
    if (!lemma || !Number.isFinite(rank) || rank < 1) continue;
    rows.push({ lemma, rank });
  }
  return rows;
}

function parseWiktextract(raw: string): WiktRow[] {
  const rows: WiktRow[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const obj = JSON.parse(trimmed) as { word?: unknown; pos?: unknown };
      if (typeof obj.word === 'string' && typeof obj.pos === 'string') {
        rows.push({ word: obj.word, pos: obj.pos });
      }
    } catch {
      // skip malformed lines
    }
  }
  return rows;
}

async function buildLanguage(lang: Lang): Promise<void> {
  const corpusRaw = await fs.readFile(path.join(SOURCES_DIR, `${lang}.tsv`), 'utf-8');
  const wiktRaw = await fs.readFile(path.join(WIKT_DIR, `${lang}.jsonl`), 'utf-8');
  const rows = joinLemmaPos(parseCorpus(corpusRaw), parseWiktextract(wiktRaw));

  const outPath = path.join(OUTPUT_DIR, `${lang}.json`);
  await fs.writeFile(outPath, JSON.stringify(rows) + '\n', 'utf-8');
  const matched = rows.filter((r) => r.source !== 'unmatched').length;
  console.log(
    `[build-vocab-lemma] ${lang}: ${rows.length} lemmas, ${matched} matched, ` +
      `${rows.length - matched} unmatched -> ${path.relative(process.cwd(), outPath)}`,
  );
}

async function main(): Promise<void> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  for (const lang of LANGUAGES) await buildLanguage(lang);
}

// Only run when invoked directly, so the test can import the pure helpers.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test build-vocab-lemma`
Expected: PASS (all cases in the `joinLemmaPos`/`POS_MAP` suites).

- [ ] **Step 5: Add the build script entry**

In `packages/ai/package.json` `scripts`, add after `"build:frequency"`:

```json
"build:vocab-lemma": "tsx scripts/build-vocab-lemma.ts",
```

- [ ] **Step 6: Commit**

```bash
git add packages/ai/scripts/build-vocab-lemma.ts packages/ai/scripts/build-vocab-lemma.test.ts packages/ai/package.json
git commit -m "feat(ai): build-vocab-lemma corpus×wiktextract join"
```

---

## Task 3: Build script — LLM gap-fill for unmatched lemmas

**Files:**
- Modify: `packages/ai/scripts/build-vocab-lemma.ts`
- Modify: `packages/ai/scripts/build-vocab-lemma.test.ts`

**Interfaces:**
- Produces: pure helper `chunk(items, size)` and `applyGapFill(rows, resolved)`. `resolved` is a `Map<string /* lemma */, string[] /* UD upos */>`; `applyGapFill` rewrites matching `unmatched` rows to `source: 'llm'` with the resolved `posAll`, leaving still-unresolved rows as `unmatched`.
- Note: the actual Claude call is wired into `main()` only (not unit-tested against the live API). The pure `applyGapFill` carries the testable logic. Gap-fill targets the `unmatched` residual to recover verbs hiding outside Wiktextract — important for TR (see spec risk).

- [ ] **Step 1: Write the failing test**

Append to `packages/ai/scripts/build-vocab-lemma.test.ts`:

```ts
import { applyGapFill, chunk } from './build-vocab-lemma';

describe('chunk', () => {
  it('splits into fixed-size batches', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('applyGapFill', () => {
  const base: VocabLemmaSeedRow[] = [
    { lemma: 'hablar', rank: 50, posAll: ['VERB'], source: 'wiktextract' },
    { lemma: 'gizlemek', rank: 900, posAll: [], source: 'unmatched' },
    { lemma: 'zzz', rank: 9999, posAll: [], source: 'unmatched' },
  ];

  it('promotes resolved unmatched rows to source=llm with posAll', () => {
    const resolved = new Map<string, string[]>([['gizlemek', ['VERB']]]);
    const out = applyGapFill(base, resolved);
    const g = out.find((r) => r.lemma === 'gizlemek');
    expect(g?.posAll).toEqual(['VERB']);
    expect(g?.source).toBe('llm');
  });

  it('leaves still-unresolved rows untouched', () => {
    const out = applyGapFill(base, new Map());
    expect(out.find((r) => r.lemma === 'zzz')?.source).toBe('unmatched');
  });

  it('never downgrades a wiktextract row', () => {
    const resolved = new Map<string, string[]>([['hablar', ['NOUN']]]);
    const out = applyGapFill(base, resolved);
    const h = out.find((r) => r.lemma === 'hablar');
    expect(h?.source).toBe('wiktextract');
    expect(h?.posAll).toEqual(['VERB']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai test build-vocab-lemma`
Expected: FAIL — `applyGapFill` / `chunk` not exported.

- [ ] **Step 3: Implement the pure gap-fill helpers**

Add to `packages/ai/scripts/build-vocab-lemma.ts` (above `main`):

```ts
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Rewrites `unmatched` rows whose lemma appears in `resolved` to `source: 'llm'`
 * with the resolved PoS. `wiktextract` rows are never touched. Returns a new
 * array; ordering is preserved.
 */
export function applyGapFill(
  rows: VocabLemmaSeedRow[],
  resolved: Map<string, string[]>,
): VocabLemmaSeedRow[] {
  return rows.map((r) => {
    if (r.source !== 'unmatched') return r;
    const pos = resolved.get(r.lemma);
    if (pos === undefined || pos.length === 0) return r;
    return { ...r, posAll: [...new Set(pos)].sort(), source: 'llm' };
  });
}
```

- [ ] **Step 4: Wire the Claude call into `main` (no unit test — exercised manually)**

Update `buildLanguage` in `build-vocab-lemma.ts` to gap-fill the residual after the join. Add this between the `joinLemmaPos(...)` call and the `writeFile`:

```ts
  // Gap-fill: recover PoS for unmatched lemmas via Claude (skipped unless
  // GAP_FILL=1 and ANTHROPIC_API_KEY is set — the join alone is a valid build).
  let finalRows = rows;
  if (process.env['GAP_FILL'] === '1') {
    const unmatched = rows.filter((r) => r.source === 'unmatched').map((r) => r.lemma);
    const resolved = await gapFillPos(lang, unmatched);
    finalRows = applyGapFill(rows, resolved);
    console.log(`[build-vocab-lemma] ${lang}: gap-filled ${resolved.size}/${unmatched.length}`);
  }
```

Then change the `writeFile`/`matched` lines to use `finalRows` instead of `rows`. Add the `gapFillPos` implementation near the top of the file (after imports):

```ts
import Anthropic from '@anthropic-ai/sdk';

/**
 * Asks Claude for the parts of speech of unmatched lemmas, in batches.
 * Returns lemma -> UD upos[]. Best-effort: any batch that fails to parse is
 * skipped (those lemmas stay 'unmatched'). Manual/dev-time only.
 */
async function gapFillPos(lang: Lang, lemmas: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (lemmas.length === 0) return out;
  const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
  for (const batch of chunk(lemmas, 100)) {
    const prompt =
      `For each ${lang.toUpperCase()} word below, return its parts of speech as UD upos tags ` +
      `(VERB, NOUN, ADJ, ADV, PROPN, NUM, PRON, ADP, DET, INTJ, CCONJ). ` +
      `Reply ONLY with JSON: {"word": ["TAG", ...], ...}. Words:\n${batch.join('\n')}`;
    try {
      const resp = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = resp.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
      const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, string[]>;
      for (const [word, tags] of Object.entries(json)) {
        if (Array.isArray(tags)) out.set(word.toLowerCase(), tags.map((t) => t.toUpperCase()));
      }
    } catch {
      // skip this batch — its lemmas remain 'unmatched'
    }
  }
  return out;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test build-vocab-lemma`
Expected: PASS.

- [ ] **Step 6: Typecheck the package**

Run: `pnpm --filter @language-drill/ai typecheck`
Expected: success.

- [ ] **Step 7: Commit**

```bash
git add packages/ai/scripts/build-vocab-lemma.ts packages/ai/scripts/build-vocab-lemma.test.ts
git commit -m "feat(ai): LLM gap-fill for unmatched vocab lemmas"
```

---

## Task 4: Seed command — `db:seed:vocab`

**Files:**
- Create: `packages/db/scripts/seed-vocab.ts`
- Modify: `packages/db/package.json`

**Interfaces:**
- Consumes: the committed artifacts `packages/ai/src/frequency/vocab-lemma/{es,de,tr}.json` (read from disk by path — NOT imported, to avoid bundling) and the `vocabLemma` table from Task 1.
- Produces: `pnpm --filter @language-drill/db seed:vocab` — idempotent upsert into `vocab_lemma`.

**Note:** The artifact files may not exist yet on the implementer's machine (they require the uncommitted source dumps to build). The seed script must therefore tolerate a missing artifact for a language with a clear log line rather than crashing, so the command is runnable in CI/dev even before real data exists. Until the artifact is seeded, the band loaders (Task 5) return empty bands and generation falls back to unseeded drafts (R5.6) — a graceful degradation, not a failure.

- [ ] **Step 1: Write the seed script**

Create `packages/db/scripts/seed-vocab.ts`:

```ts
/**
 * Seed the `vocab_lemma` table from the committed per-language artifacts at
 * packages/ai/src/frequency/vocab-lemma/{es,de,tr}.json (produced by
 * `pnpm --filter @language-drill/ai build:vocab-lemma`).
 *
 * Usage: DATABASE_URL=... pnpm --filter @language-drill/db seed:vocab
 * Idempotent: upserts on the (language, lemma) PK.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDb, type Db } from '../src/client';
import { vocabLemma } from '../src/schema/index';

const LANGUAGES = ['es', 'de', 'tr'] as const;
type Lang = (typeof LANGUAGES)[number];

type SeedRow = { lemma: string; rank: number; posAll: string[]; source: string };

const ARTIFACT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'ai',
  'src',
  'frequency',
  'vocab-lemma',
);

async function seedLanguage(db: Db, lang: Lang): Promise<void> {
  const file = path.join(ARTIFACT_DIR, `${lang}.json`);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch {
    console.warn(`[seed-vocab] ${lang}: artifact not found at ${file} — skipping`);
    return;
  }
  const rows = JSON.parse(raw) as SeedRow[];
  const language = lang.toUpperCase();
  // Insert in chunks to stay well under Postgres parameter limits.
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const values = rows.slice(i, i + CHUNK).map((r) => ({
      language,
      lemma: r.lemma,
      rank: r.rank,
      posAll: r.posAll,
      source: r.source,
    }));
    await db
      .insert(vocabLemma)
      .values(values)
      .onConflictDoUpdate({
        target: [vocabLemma.language, vocabLemma.lemma],
        set: {
          rank: sql`excluded.rank`,
          posAll: sql`excluded.pos_all`,
          source: sql`excluded.source`,
        },
      });
  }
  console.log(`[seed-vocab] ${lang}: upserted ${rows.length} lemmas`);
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('Error: DATABASE_URL environment variable is not set');
    process.exit(1);
  }
  const db = createDb(databaseUrl);
  for (const lang of LANGUAGES) await seedLanguage(db, lang);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

Add the `sql` import at the top:

```ts
import { sql } from 'drizzle-orm';
```

- [ ] **Step 2: Add the package script**

In `packages/db/package.json` `scripts`, add after `"seed:dictation"`:

```json
"seed:vocab": "npx tsx scripts/seed-vocab.ts",
```

- [ ] **Step 3: Typecheck the package**

Run: `pnpm --filter @language-drill/db typecheck`
Expected: success.

- [ ] **Step 4: Smoke-run against the test DB (artifact-absent path)**

Run: `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @language-drill/db seed:vocab`
Expected: for each language, either `upserted N lemmas` (if artifacts exist) or `artifact not found … skipping` — no crash. (Requires the migration from Task 1 applied to that DB: `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @language-drill/db db:migrate` first.)

- [ ] **Step 5: Commit**

```bash
git add packages/db/scripts/seed-vocab.ts packages/db/package.json
git commit -m "feat(db): seed:vocab idempotent upsert into vocab_lemma"
```

---

## Task 5: DB-backed band loaders

**Files:**
- Create: `packages/db/src/generation/vocab-band.ts`
- Create: `packages/db/src/generation/vocab-band.test.ts`

**Interfaces:**
- Produces:
  - `loadFrequencyBand(db: Db, language: LearningLanguage, rankMin: number, rankMax: number): Promise<readonly string[]>` — content-word lemmas in `[rankMin, rankMax]`, stopwords removed, ordered by rank then lemma.
  - `loadVerbBand(db: Db, language: LearningLanguage, rankMin: number, rankMax: number): Promise<readonly string[]>` — same but restricted to lemmas where `'VERB' = ANY(pos_all)`.
- Consumes: `vocabLemma` (Task 1); `loadFrequency(language).isStopword` from `@language-drill/ai` (the curated stopword list — reused so the band excludes closed-class words exactly as the old `frequencyBand` did).

- [ ] **Step 1: Write the band loader**

Create `packages/db/src/generation/vocab-band.ts`:

```ts
/**
 * DB-backed frequency / verb bands for generation seed selection. Replaces the
 * bundle-scanning `frequencyBand`/`verbBand` in @language-drill/ai with queries
 * against `vocab_lemma` (lemma-level, PoS-bearing). Output contract matches the
 * old bands: deduped-by-lemma (the table is 1-row-per-lemma), stopwords removed,
 * ordered by rank ascending with lemma tie-break. The deterministic
 * `pickSeeds`/`pickConjugationSeeds` consume the returned array.
 */

import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { loadFrequency } from '@language-drill/ai';
import type { LearningLanguage } from '@language-drill/shared';

import type { Db } from '../client';
import { vocabLemma } from '../schema/index';

async function bandQuery(
  db: Db,
  language: LearningLanguage,
  rankMin: number,
  rankMax: number,
  verbsOnly: boolean,
): Promise<readonly string[]> {
  const conds = [
    eq(vocabLemma.language, language),
    gte(vocabLemma.rank, rankMin),
    lte(vocabLemma.rank, rankMax),
  ];
  if (verbsOnly) conds.push(sql`'VERB' = ANY(${vocabLemma.posAll})`);

  const rows = await db
    .select({ lemma: vocabLemma.lemma })
    .from(vocabLemma)
    .where(and(...conds))
    .orderBy(asc(vocabLemma.rank), asc(vocabLemma.lemma));

  const { isStopword } = loadFrequency(language);
  return rows.map((r) => r.lemma).filter((lemma) => !isStopword(lemma));
}

export function loadFrequencyBand(
  db: Db,
  language: LearningLanguage,
  rankMin: number,
  rankMax: number,
): Promise<readonly string[]> {
  return bandQuery(db, language, rankMin, rankMax, false);
}

export function loadVerbBand(
  db: Db,
  language: LearningLanguage,
  rankMin: number,
  rankMax: number,
): Promise<readonly string[]> {
  return bandQuery(db, language, rankMin, rankMax, true);
}
```

- [ ] **Step 2: Write the failing test (DB-gated)**

Create `packages/db/src/generation/vocab-band.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Language } from '@language-drill/shared';

import { createDb, type Db } from '../client';
import { vocabLemma } from '../schema/index';
import { loadFrequencyBand, loadVerbBand } from './vocab-band';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const d = TEST_DB_URL ? describe : describe.skip;

d('vocab-band loaders', () => {
  let db: Db;

  beforeAll(async () => {
    db = createDb(TEST_DB_URL!);
    await db.delete(vocabLemma);
    await db.insert(vocabLemma).values([
      { language: 'ES', lemma: 'hablar', rank: 50, posAll: ['VERB'], source: 'wiktextract' },
      { language: 'ES', lemma: 'comer', rank: 70, posAll: ['VERB'], source: 'wiktextract' },
      { language: 'ES', lemma: 'casa', rank: 60, posAll: ['NOUN'], source: 'wiktextract' },
      { language: 'ES', lemma: 'el', rank: 1, posAll: ['DET'], source: 'wiktextract' }, // stopword
      { language: 'ES', lemma: 'lejano', rank: 9000, posAll: ['ADJ'], source: 'wiktextract' }, // out of band
    ]);
  });

  afterAll(async () => {
    await db.delete(vocabLemma);
  });

  it('returns content-word lemmas in band, ordered by rank, stopwords removed', async () => {
    const band = await loadFrequencyBand(db, Language.ES, 1, 1000);
    expect(band).toEqual(['hablar', 'casa', 'comer']); // 50, 60, 70; 'el' filtered as stopword
  });

  it('excludes out-of-band lemmas', async () => {
    const band = await loadFrequencyBand(db, Language.ES, 1, 1000);
    expect(band).not.toContain('lejano');
  });

  it('loadVerbBand returns only VERB-tagged lemmas', async () => {
    const band = await loadVerbBand(db, Language.ES, 1, 1000);
    expect(band).toEqual(['hablar', 'comer']);
    expect(band).not.toContain('casa');
  });

  it('returns an empty band when nothing matches', async () => {
    const band = await loadVerbBand(db, Language.DE, 1, 1000);
    expect(band).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it passes (DB present) or skips (no DB)**

Run: `pnpm --filter @language-drill/db test vocab-band`
Expected: with `TEST_DATABASE_URL` set (and the Task 1 migration applied), PASS; without it, the suite is SKIPPED (still a green run).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @language-drill/db typecheck`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/generation/vocab-band.ts packages/db/src/generation/vocab-band.test.ts
git commit -m "feat(db): DB-backed frequency/verb band loaders over vocab_lemma"
```

---

## Task 6: Switch seed selection to DB-backed bands

This task changes `pickSeeds`/`pickConjugationSeeds` to take an injected `band`, makes `buildSeedWords` async + DB-backed, drops the ES-only conjugation guard, and updates both test files. It is one task because the picker signature change and the `buildSeedWords` rewrite must land together to keep the build green.

**Files:**
- Modify: `packages/db/src/generation/seed-picker.ts`
- Modify: `packages/db/src/generation/seed-picker.test.ts`
- Modify: `packages/db/src/generation/run-one-cell.ts`
- Modify: `packages/db/src/generation/run-one-cell.test.ts`

**Interfaces:**
- Produces:
  - `pickSeeds({ band, batchSeed, count, exclude }): (string | null)[]` — `band: readonly string[]` injected; `language`/`cefrLevel` removed.
  - `pickConjugationSeeds({ band, batchSeed, count, persons, exclude }): (string | null)[]`.
  - `seedKindFor(cell: Cell): 'frequency' | 'verb' | null`.
  - `buildSeedWords(db: Db, cell, count, batchSeed, priorSeeds, coverageTargets?): Promise<readonly (string | null)[] | undefined>`.
- Consumes: `loadFrequencyBand`/`loadVerbBand` (Task 5); `cefrRankWindow` from `@language-drill/ai` (unchanged).

- [ ] **Step 1: Rewrite the pure pickers to take an injected band**

In `packages/db/src/generation/seed-picker.ts`:

1. Change the imports at the top from:

```ts
import { type CefrLevel, type LearningLanguage } from '@language-drill/shared';
import { cefrRankWindow, frequencyBand, verbBand } from '@language-drill/ai';

import { deterministicUuid } from '../lib/deterministic-uuid';
```

to:

```ts
import { deterministicUuid } from '../lib/deterministic-uuid';
```

2. Replace `PickSeedsOptions` and `pickSeeds` with:

```ts
export type PickSeedsOptions = {
  /** Candidate lemmas (rank-ordered, stopword-filtered) — see loadFrequencyBand. */
  band: readonly string[];
  /** Per-cell+batch seed string; combined with the ordinal to index the band. */
  batchSeed: string;
  /** Number of ordinals to assign (one seed slot per ordinal). */
  count: number;
  /** Lemmas already anchored in the cell's live pool — never re-proposed. */
  exclude: ReadonlySet<string>;
};

export function pickSeeds(opts: PickSeedsOptions): (string | null)[] {
  const { band, batchSeed, count, exclude } = opts;

  const excludeLc = new Set<string>();
  for (const word of exclude) excludeLc.add(word.toLowerCase());

  const result: (string | null)[] = [];

  if (band.length === 0) {
    for (let ordinal = 0; ordinal < count; ordinal++) result.push(null);
    return result;
  }

  const chosen = new Set<string>();
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const start = hashIndex(`${batchSeed}|${ordinal}`) % band.length;
    let pick: string | null = null;
    for (let step = 0; step < band.length; step++) {
      const lemma = band[(start + step) % band.length];
      if (excludeLc.has(lemma) || chosen.has(lemma)) continue;
      pick = lemma;
      chosen.add(lemma);
      break;
    }
    result.push(pick);
  }

  return result;
}
```

3. Replace `PickConjugationSeedsOptions` and `pickConjugationSeeds` with:

```ts
export type PickConjugationSeedsOptions = {
  /** Candidate VERB lemmas (rank-ordered) — see loadVerbBand. */
  band: readonly string[];
  batchSeed: string;
  count: number;
  /** Per-ordinal grammatical-person target, or null. */
  persons: readonly (string | null)[];
  /** Prior `${lemma}|${person}` keys already in the cell's pool — never re-proposed. */
  exclude: ReadonlySet<string>;
};

export function pickConjugationSeeds(opts: PickConjugationSeedsOptions): (string | null)[] {
  const { band, batchSeed, count, persons, exclude } = opts;

  const result: (string | null)[] = [];
  if (band.length === 0) {
    for (let ordinal = 0; ordinal < count; ordinal++) result.push(null);
    return result;
  }

  const excludeLc = new Set<string>();
  for (const key of exclude) excludeLc.add(key.toLowerCase());

  const chosen = new Set<string>(); // `${lemma}|${person}` chosen this batch
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const person = persons[ordinal] ?? null;
    if (person === null) {
      result.push(null);
      continue;
    }
    const start = hashIndex(`${batchSeed}|${ordinal}`) % band.length;
    let pick: string | null = null;
    for (let step = 0; step < band.length; step++) {
      const lemma = band[(start + step) % band.length];
      const key = `${lemma}|${person}`.toLowerCase();
      if (excludeLc.has(key) || chosen.has(key)) continue;
      pick = lemma;
      chosen.add(key);
      break;
    }
    result.push(pick);
  }

  return result;
}
```

(Leave the `hashIndex` helper and the module doc-comment as-is.)

- [ ] **Step 2: Rewrite `seed-picker.test.ts` to inject fake bands (pure, no DB)**

Replace the entire contents of `packages/db/src/generation/seed-picker.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';

import { pickConjugationSeeds, pickSeeds } from './seed-picker';

// A fake rank-ordered band; the picker is pure over whatever array it's given.
const BAND = ['hablar', 'comer', 'vivir', 'beber', 'correr', 'saltar', 'mirar'];

describe('pickSeeds', () => {
  const base = { band: BAND, batchSeed: 'cell-abc|2026-05-25', count: 10, exclude: new Set<string>() } as const;

  it('returns exactly `count` slots', () => {
    expect(pickSeeds(base)).toHaveLength(10);
    expect(pickSeeds({ ...base, count: 3 })).toHaveLength(3);
  });

  it('is deterministic for identical options', () => {
    expect(pickSeeds(base)).toEqual(pickSeeds(base));
  });

  it('varies with batchSeed', () => {
    expect(pickSeeds(base)).not.toEqual(pickSeeds({ ...base, batchSeed: 'different' }));
  });

  it('assigns distinct, in-band seeds', () => {
    const seeds = pickSeeds({ ...base, count: 5 }).filter((s): s is string => s !== null);
    expect(new Set(seeds).size).toBe(seeds.length);
    const bandSet = new Set(BAND);
    for (const s of seeds) expect(bandSet.has(s)).toBe(true);
  });

  it('never proposes an excluded lemma', () => {
    const excluded = BAND.slice(0, 3);
    const seeds = pickSeeds({ ...base, exclude: new Set(excluded) });
    for (const ex of excluded) expect(seeds).not.toContain(ex);
  });

  it('honours exclude case-insensitively', () => {
    const seeds = pickSeeds({ ...base, exclude: new Set([BAND[0].toUpperCase()]) });
    expect(seeds).not.toContain(BAND[0]);
  });

  it('returns null once the candidate pool is exhausted', () => {
    const exclude = new Set(BAND.slice(2)); // leave only 2 candidates
    const seeds = pickSeeds({ ...base, count: 5, exclude });
    const nonNull = seeds.filter((s): s is string => s !== null);
    expect(nonNull).toHaveLength(2);
    expect(new Set(nonNull)).toEqual(new Set(BAND.slice(0, 2)));
    expect(seeds).toContain(null);
  });

  it('falls back to all-null when the band is empty', () => {
    expect(pickSeeds({ ...base, band: [], count: 4 })).toEqual([null, null, null, null]);
  });
});

describe('pickConjugationSeeds', () => {
  const base = { band: BAND, batchSeed: 'seed-abc', exclude: new Set<string>() };

  it('assigns a distinct (lemma, person) pair per ordinal and is deterministic', () => {
    const persons = ['1sg', '2sg', '3sg', '1pl', '3pl'];
    const a = pickConjugationSeeds({ ...base, count: 5, persons });
    expect(pickConjugationSeeds({ ...base, count: 5, persons })).toEqual(a);
    const pairs = a.map((lemma, i) => `${lemma}|${persons[i]}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(a.every((l) => typeof l === 'string')).toBe(true);
  });

  it('may reuse the same verb across persons but not within one person', () => {
    const same = pickConjugationSeeds({ ...base, count: 2, persons: ['1sg', '1sg'] });
    expect(same[0]).not.toBe(same[1]);
  });

  it('respects the exclude set of prior (lemma, person) keys', () => {
    const persons = ['1sg'];
    const first = pickConjugationSeeds({ ...base, count: 1, persons })[0]!;
    const next = pickConjugationSeeds({ ...base, count: 1, persons, exclude: new Set([`${first}|1sg`]) })[0];
    expect(next).not.toBe(first);
  });

  it('returns null for ordinals with no person target', () => {
    const out = pickConjugationSeeds({ ...base, count: 2, persons: [null, '3sg'] });
    expect(out[0]).toBeNull();
    expect(typeof out[1]).toBe('string');
  });

  it('falls back to all-null when the band is empty', () => {
    expect(pickConjugationSeeds({ ...base, band: [], count: 2, persons: ['1sg', '2sg'] })).toEqual([null, null]);
  });
});
```

- [ ] **Step 3: Run the picker tests**

Run: `pnpm --filter @language-drill/db test seed-picker`
Expected: PASS (pure, no DB needed).

- [ ] **Step 4: Add `seedKindFor` and rewrite `buildSeedWords` in `run-one-cell.ts`**

In `packages/db/src/generation/run-one-cell.ts`:

1. Update the seed-picker import (line ~60) and add the band-loader + `cefrRankWindow` imports. Change:

```ts
import { pickConjugationSeeds, pickSeeds } from './seed-picker';
```

to:

```ts
import { pickConjugationSeeds, pickSeeds } from './seed-picker';
import { loadFrequencyBand, loadVerbBand } from './vocab-band';
```

Ensure `cefrRankWindow` is imported from `@language-drill/ai` in this file (add it to the existing `@language-drill/ai` import if not already present):

```ts
import { /* …existing… */ cefrRankWindow } from '@language-drill/ai';
```

2. Replace the entire `buildSeedWords` function (lines ~424-464) with:

```ts
/**
 * Which seed band a cell draws from, or null for non-seeded types. Pure — the
 * type gate is unit-tested without a DB. cloze/translation seed at-level content
 * words; conjugation seeds at-or-below-level VERBS (any language now that PoS is
 * DB-backed — previously ES-only). vocab_recall/free-writing/etc. are unseeded.
 */
export function seedKindFor(cell: Cell): 'frequency' | 'verb' | null {
  if (
    cell.exerciseType === ExerciseType.CLOZE ||
    cell.exerciseType === ExerciseType.TRANSLATION
  ) {
    return 'frequency';
  }
  if (cell.exerciseType === ExerciseType.CONJUGATION) return 'verb';
  return null;
}

/**
 * Builds the per-ordinal seed list for a cell (R5.1), or `undefined` for
 * non-seeded types. Loads the candidate band from `vocab_lemma` (DB-backed),
 * then delegates to the deterministic pickers. The `exclude` set (live-pool
 * seeds) is supplied by the caller via `fetchPriorSeeds`/`fetchPriorConjugationSeeds`.
 */
export async function buildSeedWords(
  db: Db,
  cell: Cell,
  count: number,
  batchSeed: string,
  priorSeeds: ReadonlySet<string>,
  coverageTargets?: readonly CoverageTarget[],
): Promise<readonly (string | null)[] | undefined> {
  const kind = seedKindFor(cell);
  if (kind === null) return undefined;

  const window = cefrRankWindow(cell.cefrLevel);

  if (kind === 'frequency') {
    const band = await loadFrequencyBand(db, cell.language, window.rankMin, window.rankMax);
    return pickSeeds({ band, batchSeed, count, exclude: priorSeeds });
  }

  // Conjugation: at-or-below-level verbs (CUMULATIVE band from rank 1), keyed on
  // (lemma, person). Persons come from the ordinal's coverage target.
  const persons = Array.from(
    { length: count },
    (_, ordinal) => coverageTargets?.[ordinal]?.person ?? null,
  );
  const band = await loadVerbBand(db, cell.language, 1, window.rankMax);
  return pickConjugationSeeds({ band, batchSeed, count, persons, exclude: priorSeeds });
}
```

3. In `executeCell` (around lines 613-630), drop the ES-only guard so all conjugation cells fetch prior conjugation seeds and seed, and `await` the now-async `buildSeedWords`. Replace:

```ts
    const isClozeOrTranslation =
      cell.exerciseType === ExerciseType.CLOZE ||
      cell.exerciseType === ExerciseType.TRANSLATION;
    const isEsConjugation =
      cell.exerciseType === ExerciseType.CONJUGATION &&
      cell.language === Language.ES;
    const priorSeeds: ReadonlySet<string> = isClozeOrTranslation
      ? new Set(await fetchPriorSeeds(db, cell))
      : isEsConjugation
        ? await fetchPriorConjugationSeeds(db, cell)
        : new Set<string>();
    const seedWords = buildSeedWords(
      cell,
      args.count,
      args.batchSeed,
      priorSeeds,
      args.coverageTargets,
    );
```

with:

```ts
    const isClozeOrTranslation =
      cell.exerciseType === ExerciseType.CLOZE ||
      cell.exerciseType === ExerciseType.TRANSLATION;
    const isConjugation = cell.exerciseType === ExerciseType.CONJUGATION;
    const priorSeeds: ReadonlySet<string> = isClozeOrTranslation
      ? new Set(await fetchPriorSeeds(db, cell))
      : isConjugation
        ? await fetchPriorConjugationSeeds(db, cell)
        : new Set<string>();
    const seedWords = await buildSeedWords(
      db,
      cell,
      args.count,
      args.batchSeed,
      priorSeeds,
      args.coverageTargets,
    );
```

(If `Language` is now unused in `run-one-cell.ts` after removing the guard, remove it from its import to satisfy lint. Verify with the typecheck/lint steps below.)

- [ ] **Step 5: Update `run-one-cell.test.ts` — `buildSeedWords` call sites + DB fixture**

In `packages/db/src/generation/run-one-cell.test.ts`:

1. Add `seedKindFor` and `vocabLemma` to the imports:

```ts
import { buildSeedWords, seedKindFor, /* …existing… */ } from './run-one-cell';
import { exerciseTags, exercises, generationJobs, vocabLemma } from '../schema/index';
```

2. The previously-pure `describe('buildSeedWords', …)` block (around line 294) now needs a DB. Split it:

   a. Add a NEW pure describe for the type gate (no DB), e.g. right after the existing block's location:

```ts
describe('seedKindFor', () => {
  const cellOf = (exerciseType: ExerciseType): Cell => ({
    language: Language.ES,
    cefrLevel: CefrLevel.B1 as CurriculumCefrLevel,
    exerciseType,
    grammarPoint: ALL_CURRICULA.ES[0],
    cellKey: 'es:b1:x:es-test',
  });

  it('returns frequency for cloze and translation', () => {
    expect(seedKindFor(cellOf(ExerciseType.CLOZE))).toBe('frequency');
    expect(seedKindFor(cellOf(ExerciseType.TRANSLATION))).toBe('frequency');
  });

  it('returns verb for conjugation', () => {
    expect(seedKindFor(cellOf(ExerciseType.CONJUGATION))).toBe('verb');
  });

  it('returns null for vocab_recall', () => {
    expect(seedKindFor(cellOf(ExerciseType.VOCAB_RECALL))).toBeNull();
  });
});
```

   (Adjust the `cellOf` helper to match the real `Cell` shape if it differs — mirror how other tests in this file construct a `Cell`.)

   b. Convert the remaining band-dependent assertions (the cloze count/determinism cases at lines ~298-340 and the conjugation cases near line ~1416) to `await buildSeedWords(db, cell, …)` and move them inside the existing `TEST_DATABASE_URL`-gated integration `describe`. Seed a `vocab_lemma` fixture in that suite's `beforeAll` (alongside the existing setup):

```ts
    await db.delete(vocabLemma);
    await db.insert(vocabLemma).values([
      { language: 'ES', lemma: 'hablar', rank: 2600, posAll: ['VERB'], source: 'wiktextract' },
      { language: 'ES', lemma: 'comer', rank: 2700, posAll: ['VERB'], source: 'wiktextract' },
      { language: 'ES', lemma: 'vivir', rank: 2800, posAll: ['VERB'], source: 'wiktextract' },
      { language: 'ES', lemma: 'beber', rank: 2900, posAll: ['VERB'], source: 'wiktextract' },
      { language: 'ES', lemma: 'libro', rank: 2650, posAll: ['NOUN'], source: 'wiktextract' },
      { language: 'ES', lemma: 'mesa', rank: 2750, posAll: ['NOUN'], source: 'wiktextract' },
    ]);
```

   (Ranks sit inside the B1 window 2500-5000 used by these cells. Add the matching `await db.delete(vocabLemma)` in the suite teardown.) Each converted assertion becomes e.g.:

```ts
    const seeds = await buildSeedWords(db, clozeCell, 5, 'seed-batch', new Set());
    expect(seeds).toHaveLength(5);
```

- [ ] **Step 6: Run the affected tests**

Run: `pnpm --filter @language-drill/db test run-one-cell`
Expected: with `TEST_DATABASE_URL` set, PASS (the `seedKindFor` pure block always runs; the band-dependent cases run against the seeded fixture). Without a DB, the gated cases skip and the pure block passes.

- [ ] **Step 7: Typecheck + lint the package**

Run: `pnpm --filter @language-drill/db typecheck && pnpm --filter @language-drill/db lint`
Expected: success (resolve any now-unused `Language` import in `run-one-cell.ts`).

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/generation/seed-picker.ts packages/db/src/generation/seed-picker.test.ts packages/db/src/generation/run-one-cell.ts packages/db/src/generation/run-one-cell.test.ts
git commit -m "feat(db): DB-backed, language-agnostic seed selection over vocab_lemma"
```

---

## Task 7: Remove the dead morphology bands from `@language-drill/ai`

Now that nothing imports `frequencyBand`/`verbBand`, delete them and the verb-stat machinery (the temporary ES-only heuristic the spec replaces). `loadFrequency`, `cefrRankWindow`, the assert guards, and the bundled surface map stay.

**Files:**
- Modify: `packages/ai/src/frequency/index.ts`
- Modify: `packages/ai/src/frequency/frequency.test.ts`

- [ ] **Step 1: Delete the band/verb code from `frequency/index.ts`**

Remove from `packages/ai/src/frequency/index.ts`:
- the `BAND_CACHE` declaration (around line 102) and its doc comment,
- the entire `frequencyBand` function (lines ~159-206),
- the entire "Verb detection" section: `VERB_SUFFIXES_BY_LANGUAGE`, `MIN_VERB_SURFACES`, `MIN_SURFACE_LEN`, `VerbStat`, `VERB_STATS_CACHE`, `verbStats`, `VERB_BAND_CACHE`, `EMPTY_BAND`, and `verbBand` (lines ~208-308).

Keep `loadFrequency`, `cefrRankWindow`, `CEFR_RANK_WINDOW`, `assertFrequencyFile`, `assertStopwordList`, the types, and the per-language asset maps. (`LOOKUP_CACHE` stays.)

- [ ] **Step 2: Trim `frequency.test.ts`**

In `packages/ai/src/frequency/frequency.test.ts`:
- Remove the `import { verbBand } from "./index";` line (line 3).
- Remove `frequencyBand` from the multi-line import block (line ~9).
- Delete the entire `describe("frequencyBand", …)` block (starts ~line 220).
- Delete the entire `describe("verbBand", …)` block (starts ~line 298).

Keep the `loadFrequency`, `determinism`, `module-init guards`, and `cefrRankWindow` describe blocks. (If `esFreq`/`esStopwords`/`Language`/`CefrLevel` imports become unused after removing those blocks, remove them too — the lint step will flag any leftovers.)

- [ ] **Step 3: Run the AI package tests**

Run: `pnpm --filter @language-drill/ai test frequency`
Expected: PASS (remaining blocks only).

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm --filter @language-drill/ai typecheck && pnpm --filter @language-drill/ai lint`
Expected: success.

- [ ] **Step 5: Verify no dangling references repo-wide**

Run: `grep -rn "frequencyBand\|verbBand" packages infra --include="*.ts" | grep -v "/dist/"`
Expected: no matches (other than possibly the design/plan docs, which are fine).

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/frequency/index.ts packages/ai/src/frequency/frequency.test.ts
git commit -m "refactor(ai): remove morphology-based frequencyBand/verbBand (now DB-backed)"
```

---

## Task 8: Raise grammar-point description cap 200 → 300 (independent)

Independent of the vocab table (see spec addendum). Turkish descriptions are jammed against the 200-char ceiling; the description is injected verbatim into generation prompts, so the cap truncates TR guidance.

**Files:**
- Modify: `packages/db/src/curriculum/index.ts`
- Modify: `packages/shared/src/curriculum-types.ts`
- Modify: `packages/db/src/curriculum/curriculum.test.ts`

- [ ] **Step 1: Update the failing test to the new bound**

In `packages/db/src/curriculum/curriculum.test.ts`, replace the over-long-description test (lines ~90-93):

```ts
  it('throws on an over-long description', () => {
    const broken = mutateAt(FIRST_ES_INDEX, { description: 'x'.repeat(201) });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/exceeds 200 characters/);
  });
```

with:

```ts
  it('throws on an over-long description', () => {
    const broken = mutateAt(FIRST_ES_INDEX, { description: 'x'.repeat(301) });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/exceeds 300 characters/);
  });

  it('allows a description between the old and new caps', () => {
    const ok = mutateAt(FIRST_ES_INDEX, { description: 'x'.repeat(250) });
    expect(() => assertCurriculumInvariants(ok)).not.toThrow();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/db test curriculum`
Expected: FAIL — the 301-char case still throws "exceeds 200 characters" (message mismatch) and the 250-char case throws (still over the old cap).

- [ ] **Step 3: Raise the cap in the invariant**

In `packages/db/src/curriculum/index.ts` (lines ~192-197), replace:

```ts
    // 8. description.length <= 200
    if (entry.description.length > 200) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' description exceeds 200 characters (got ${entry.description.length})`,
      );
    }
```

with:

```ts
    // 8. description.length <= 300 (raised from 200: Turkish points were jammed
    //    against the old cap; descriptions are injected verbatim into prompts).
    if (entry.description.length > 300) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' description exceeds 300 characters (got ${entry.description.length})`,
      );
    }
```

- [ ] **Step 4: Update the doc comment**

In `packages/shared/src/curriculum-types.ts` (line ~56), change:

```ts
  /** ≤ 200 chars; English; injected verbatim into Phase 2 prompts. */
```

to:

```ts
  /** ≤ 300 chars; English; injected verbatim into Phase 2 prompts. */
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/db test curriculum`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @language-drill/db typecheck && pnpm --filter @language-drill/shared typecheck`
Expected: success.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/curriculum/index.ts packages/shared/src/curriculum-types.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "feat(curriculum): raise grammar-point description cap 200->300"
```

---

## Final verification

- [ ] **Run the full gate from repo root**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures. (DB-gated suites require `TEST_DATABASE_URL`; if unset locally they skip — ensure CI has it.)

- [ ] **Generate real artifacts and seed (operator step, requires source dumps)**

This is a deploy/operator action, not part of the green build:

```bash
# Place uncommitted sources, then:
GAP_FILL=1 ANTHROPIC_API_KEY=... pnpm --filter @language-drill/ai build:vocab-lemma
git add packages/ai/src/frequency/vocab-lemma/*.json && git commit -m "data: vocab-lemma seed artifacts"
# Per environment (after migration applies):
DATABASE_URL=<env> pnpm --filter @language-drill/db seed:vocab
```

Until `seed:vocab` runs against an environment, the band loaders return empty bands and generation falls back to unseeded drafts (R5.6) — degraded, not broken.

---

## Self-Review

**Spec coverage:**
- `vocab_lemma` table (lemma, rank, pos_all, source; PK; index) → Task 1. ✓
- No scalar `pos`, only `pos_all` → Task 1 (column set). ✓
- Wiktextract join + LLM gap-fill → Tasks 2, 3. ✓
- `source` provenance incl. `unmatched` for gap-fill-rate auditing → Tasks 2-4. ✓
- Build emits committed artifact; dumps uncommitted → Task 2 (paths), Final verification. ✓
- Seed command, idempotent upsert → Task 4. ✓
- Seed selection reads DB; pickers pure over injected band; bundle untouched → Tasks 5, 6. ✓
- Language-agnostic verb seeding (drop ES guard) → Task 6. ✓
- Stopword filtering preserved via reused curated list → Task 5. ✓
- Delete old morphology `frequencyBand`/`verbBand` → Task 7. ✓
- Description cap 200→300 (3 sites) → Task 8. ✓
- Graceful degradation when table empty (R5.6) → Tasks 4, 6, Final. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `loadFrequencyBand`/`loadVerbBand` signatures identical across Tasks 5/6; `buildSeedWords(db, cell, count, batchSeed, priorSeeds, coverageTargets?)` consistent in Task 6 definition and `executeCell` call site and test call sites; `VocabLemmaSeedRow`/`posAll` field name consistent across Tasks 2-4 and the schema's `pos_all` column; `seedKindFor` returns `'frequency' | 'verb' | null` consistently. ✓
