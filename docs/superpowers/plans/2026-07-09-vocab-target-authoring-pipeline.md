# Vocab Target Authoring Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce curated, human-reviewed ES A1 vocabulary lists — one `vocab_target` row per (topic word), frequency-ranked — via a Claude-backed authoring CLI.

**Architecture:** A new `vocab_target` table (mirroring the `theory_topics` review pattern: rows land `flagged`, a human review CLI promotes to `approved`). A Claude prompt proposes words per ES A1 vocab umbrella, anchored on the umbrella's metadata + the A1 frequency band from `vocab_lemma`. A pure structural validator drops malformed proposals; surviving words are joined to `vocab_lemma` for their frequency rank + importance tier, then inserted `flagged`. This is Plan 1 of 2 for the ES A1 pilot; Plan 2 (browse hub + coverage read model) consumes these rows.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres/Neon), Anthropic SDK (`@anthropic-ai/sdk`), Vitest, tsx CLIs.

## Global Constraints

- Package boundary: `packages/ai` **source must never import `@language-drill/db`** (only db→ai is allowed). Prompts live in `ai`; orchestration + db access live in `packages/db`.
- Every new `*_SYSTEM_PROMPT`/`*_TEMPLATE` needs a matching `*_PROMPT_VERSION` constant (`<surface>@YYYY-MM-DD`), a re-export from `packages/ai/src/index.ts`, **and** an entry in the `PROMPTS` manifest in `packages/ai/scripts/bootstrap-prompts.ts` — otherwise it only ever serves the in-repo fallback.
- Language/level scope: **ES A1 only.** Rows are `language='ES'`, `cefr_level='A1'`.
- Migrations are forward-only; generate via `pnpm --filter @language-drill/db db:generate` (never hand-number the `.sql`).
- After editing `packages/db` source, rebuild before single-package vitest (`pnpm --filter @language-drill/db build`) — stale `db/dist` yields phantom results. Delete `infra/lambda/dist` is **not** relevant here (no lambda changes in this plan).
- The real test gate is `pnpm turbo run test --concurrency=1` (package `tsc` typecheck excludes `*.test.ts`).
- Branch: `feat/vocab-coverage-hub` (already created off `main`). Assert the branch before every commit — the workspace silently flips to `main`.

---

### Task 1: `vocab_target` table + migration

**Files:**
- Modify: `packages/db/src/schema/vocab.ts` (append the table; file currently ends at line 30)
- Test: `packages/db/src/schema/vocab.test.ts` (create)
- Generated: `packages/db/migrations/NNNN_*.sql` (via drizzle-kit)

**Interfaces:**
- Produces: `vocabTarget` pgTable; types `VocabTarget = InferSelectModel<typeof vocabTarget>`, `NewVocabTarget = InferInsertModel<typeof vocabTarget>`. Columns: `id` (uuid PK), `language`, `umbrellaKey`, `cefrLevel`, `lemma`, `displayForm`, `gloss`, `exampleSentence`, `freqRank` (nullable int), `tier`, `status`, `source`, `createdAt`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/schema/vocab.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { vocabTarget } from './vocab';

describe('vocab_target schema', () => {
  it('has the expected columns and table name', () => {
    const cfg = getTableConfig(vocabTarget);
    expect(cfg.name).toBe('vocab_target');
    const cols = cfg.columns.map((c) => c.name).sort();
    expect(cols).toEqual(
      [
        'cefr_level',
        'created_at',
        'display_form',
        'example_sentence',
        'freq_rank',
        'gloss',
        'id',
        'language',
        'lemma',
        'source',
        'status',
        'tier',
        'umbrella_key',
      ].sort(),
    );
  });

  it('declares a unique index on (language, umbrella_key, lemma)', () => {
    const cfg = getTableConfig(vocabTarget);
    const unique = cfg.indexes.find((i) => i.config.unique);
    expect(unique?.config.columns.map((c: { name: string }) => c.name)).toEqual([
      'language',
      'umbrella_key',
      'lemma',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- vocab.test`
Expected: FAIL — `vocabTarget` is not exported from `./vocab`.

- [ ] **Step 3: Implement the table**

Append to `packages/db/src/schema/vocab.ts` (add `timestamp`, `uniqueIndex` to the existing `drizzle-orm/pg-core` import, and `sql` from `drizzle-orm`):

```ts
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ... existing vocabLemma table unchanged ...

/**
 * Curated, reviewed vocabulary targets — the canonical "words we teach" list,
 * grouped by curriculum vocab umbrella. Mirrors the theory_topics review
 * pattern: rows are authored `status='flagged'` and promoted to `approved` by
 * human review. `freqRank` is copied from vocab_lemma at author time (null if
 * the lemma is unmatched); `tier` is the importance band derived from it.
 * See docs/superpowers/specs/2026-07-09-vocab-coverage-hub-design.md.
 */
export const vocabTarget = pgTable(
  'vocab_target',
  {
    id: text('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    language: text('language').notNull(), // ES | DE | TR (TS-enforced LearningLanguage)
    umbrellaKey: text('umbrella_key').notNull(), // grammar-point key, e.g. es-a1-vocab-food-drink
    cefrLevel: text('cefr_level').notNull(), // A1 | A2 | ... (denormalized from the umbrella)
    lemma: text('lemma').notNull(), // dictionary form; join key to vocab_lemma
    displayForm: text('display_form').notNull(), // learner-facing form, may include article
    gloss: text('gloss').notNull(), // short EN meaning; hidden-by-default in UI
    exampleSentence: text('example_sentence').notNull(),
    freqRank: integer('freq_rank'), // from vocab_lemma.rank; null if unmatched
    tier: text('tier').notNull(), // core | common | extended (TS-enforced)
    status: text('status').notNull().default('flagged'), // flagged | approved
    source: text('source').notNull().default('llm'), // llm | edited
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqLemma: uniqueIndex('vocab_target_lang_umbrella_lemma_idx').on(
      t.language,
      t.umbrellaKey,
      t.lemma,
    ),
    browseIdx: index('vocab_target_browse_idx').on(
      t.language,
      t.umbrellaKey,
      t.status,
    ),
  }),
);

export type VocabTarget = InferSelectModel<typeof vocabTarget>;
export type NewVocabTarget = InferInsertModel<typeof vocabTarget>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- vocab.test`
Expected: PASS (both tests).

- [ ] **Step 5: Generate the migration**

Run: `pnpm --filter @language-drill/db db:generate`
Expected: a new `packages/db/migrations/NNNN_*.sql` creating `vocab_target` + the two indexes, and an updated `migrations/meta/` snapshot. Inspect the `.sql` to confirm `CREATE TABLE "vocab_target"` and both `CREATE ... INDEX`.

> If another branch has claimed the next `NNNN` slot on merge, take `main`'s `migrations/meta`, `git rm` the stale `.sql`, and re-run `db:generate` to renumber (known merge-conflict hazard).

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must be feat/vocab-coverage-hub
git add packages/db/src/schema/vocab.ts packages/db/src/schema/vocab.test.ts packages/db/migrations
git commit -m "feat(vocab): vocab_target table + migration"
```

---

### Task 2: authoring + validation prompts, version constants, manifest

**Files:**
- Create: `packages/ai/src/vocab-target-prompts.ts`
- Modify: `packages/ai/src/index.ts` (re-export the constants)
- Modify: `packages/ai/scripts/bootstrap-prompts.ts` (add two `PROMPTS` entries)
- Test: `packages/ai/src/vocab-target-prompts.test.ts` (create)
- Test: `packages/ai/scripts/bootstrap-prompts.test.ts` (extend existing — assert the two new names are present)

**Interfaces:**
- Produces:
  - `VOCAB_TARGET_GENERATION_PROMPT_VERSION: string` (`vocab-target-generate@2026-07-09`)
  - `VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE: string` (uses `{{languageName}}`, `{{cefrLevel}}`, `{{umbrellaName}}`, `{{umbrellaDescription}}`, `{{wordCount}}`, `{{freqAnchorWords}}`, `{{avoidWords}}`)
  - `buildVocabTargetUserPrompt(input): string` — renders the per-umbrella user message
  - JSON output contract: the model returns `{ "words": [{ "displayForm": string, "lemma": string, "gloss": string, "exampleSentence": string }] }`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/vocab-target-prompts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  VOCAB_TARGET_GENERATION_PROMPT_VERSION,
  VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE,
  buildVocabTargetUserPrompt,
} from './vocab-target-prompts';

describe('vocab-target prompts', () => {
  it('version is a dated surface tag', () => {
    expect(VOCAB_TARGET_GENERATION_PROMPT_VERSION).toMatch(
      /^vocab-target-generate@\d{4}-\d{2}-\d{2}$/,
    );
  });

  it('system template exposes the substitution slots', () => {
    for (const slot of [
      '{{languageName}}',
      '{{cefrLevel}}',
      '{{umbrellaName}}',
      '{{wordCount}}',
    ]) {
      expect(VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE).toContain(slot);
    }
  });

  it('user prompt embeds anchor + avoid words and requests JSON', () => {
    const out = buildVocabTargetUserPrompt({
      umbrellaName: 'Food and drink (A1)',
      umbrellaDescription: 'Core A1 food vocabulary.',
      wordCount: 30,
      freqAnchorWords: ['pan', 'agua', 'manzana'],
      avoidWords: ['leche'],
    });
    expect(out).toContain('Food and drink (A1)');
    expect(out).toContain('pan, agua, manzana');
    expect(out).toContain('leche');
    expect(out).toMatch(/"words"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- vocab-target-prompts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the prompts**

Create `packages/ai/src/vocab-target-prompts.ts`:

```ts
/**
 * Prompts for the curated vocab-target authoring pipeline (ES A1 pilot).
 * The model proposes learner-facing words for one curriculum vocab umbrella,
 * anchored on the umbrella metadata + a frequency band from vocab_lemma.
 * See docs/superpowers/specs/2026-07-09-vocab-coverage-hub-design.md.
 */

export const VOCAB_TARGET_GENERATION_PROMPT_VERSION =
  'vocab-target-generate@2026-07-09';

export const VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE = `You are a lexicographer building a curated vocabulary list for {{languageName}} learners at CEFR {{cefrLevel}}.

Your task: propose exactly {{wordCount}} of the most useful words for the topic "{{umbrellaName}}" ({{umbrellaDescription}}).

Rules:
- Words MUST be squarely on-topic for "{{umbrellaName}}" and appropriate for CEFR {{cefrLevel}} (high-frequency, concrete, everyday).
- "lemma" is the bare dictionary form (no article, singular, infinitive). "displayForm" is how a learner should see it (nouns include their article, e.g. "la manzana"; verbs are the infinitive).
- "gloss" is a 1-4 word English meaning. "exampleSentence" is one natural {{languageName}} sentence USING the word.
- No proper nouns, no multi-word phrases (single lexical items only), no duplicates.
- Prefer the words a beginner most needs first.

Return ONLY minified JSON: {"words":[{"displayForm":"...","lemma":"...","gloss":"...","exampleSentence":"..."}]}`;

export type VocabTargetUserPromptInput = {
  umbrellaName: string;
  umbrellaDescription: string;
  wordCount: number;
  freqAnchorWords: readonly string[];
  avoidWords: readonly string[];
};

export function buildVocabTargetUserPrompt(
  input: VocabTargetUserPromptInput,
): string {
  const anchor =
    input.freqAnchorWords.length > 0
      ? `High-frequency candidate lemmas from our corpus (use as inspiration, not a hard constraint): ${input.freqAnchorWords.join(', ')}.`
      : '';
  const avoid =
    input.avoidWords.length > 0
      ? `Do NOT propose any of these already-listed words: ${input.avoidWords.join(', ')}.`
      : '';
  return [
    `Topic: ${input.umbrellaName}`,
    input.umbrellaDescription,
    anchor,
    avoid,
    `Propose ${input.wordCount} words as JSON {"words":[...]}.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
```

- [ ] **Step 4: Re-export from the package index**

Add to `packages/ai/src/index.ts` (alongside the other prompt re-exports):

```ts
export {
  VOCAB_TARGET_GENERATION_PROMPT_VERSION,
  VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE,
  buildVocabTargetUserPrompt,
  type VocabTargetUserPromptInput,
} from './vocab-target-prompts';
```

- [ ] **Step 5: Add the manifest entry**

In `packages/ai/scripts/bootstrap-prompts.ts`, import the new constants at the top with the others, then append to the `PROMPTS` array:

```ts
  {
    name: 'vocab-target-generate-system-prompt',
    text: VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE,
    version: VOCAB_TARGET_GENERATION_PROMPT_VERSION,
    surface: 'vocab-target-generate',
  },
```

Extend `packages/ai/scripts/bootstrap-prompts.test.ts` — add to whatever assertion enumerates expected names (or add a focused one):

```ts
it('includes the vocab-target generation prompt', () => {
  expect(PROMPTS.map((p) => p.name)).toContain(
    'vocab-target-generate-system-prompt',
  );
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- vocab-target-prompts bootstrap-prompts`
Expected: PASS. Also run `pnpm --filter @language-drill/ai typecheck` to confirm the new module typechecks.

- [ ] **Step 7: Commit**

```bash
git branch --show-current   # feat/vocab-coverage-hub
git add packages/ai/src/vocab-target-prompts.ts packages/ai/src/vocab-target-prompts.test.ts packages/ai/src/index.ts packages/ai/scripts/bootstrap-prompts.ts packages/ai/scripts/bootstrap-prompts.test.ts
git commit -m "feat(vocab): vocab-target authoring prompt + manifest entry"
```

---

### Task 3: pure validator + tier derivation

**Files:**
- Create: `packages/db/src/vocab-target/validate.ts`
- Test: `packages/db/src/vocab-target/validate.test.ts`

**Interfaces:**
- Consumes: the model's `{ displayForm, lemma, gloss, exampleSentence }` shape.
- Produces:
  - `type ProposedWord = { displayForm: string; lemma: string; gloss: string; exampleSentence: string }`
  - `validateProposedWord(w: unknown): ProposedWord | null` — returns the trimmed word if structurally valid (all four fields non-empty strings, single-token lemma, example contains the lemma or displayForm token case-insensitively), else `null`.
  - `deriveTier(freqRank: number | null): 'core' | 'common' | 'extended'` — `core` if `rank <= 1000`, `common` if `rank <= 2500`, else `extended` (also `extended` when `rank` is null).

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/vocab-target/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveTier, validateProposedWord } from './validate';

describe('validateProposedWord', () => {
  it('accepts a well-formed word', () => {
    expect(
      validateProposedWord({
        displayForm: 'la manzana',
        lemma: 'manzana',
        gloss: 'apple',
        exampleSentence: 'Como una manzana roja.',
      }),
    ).toEqual({
      displayForm: 'la manzana',
      lemma: 'manzana',
      gloss: 'apple',
      exampleSentence: 'Como una manzana roja.',
    });
  });

  it('rejects a multi-token lemma', () => {
    expect(
      validateProposedWord({
        displayForm: 'buenos días',
        lemma: 'buenos días',
        gloss: 'good morning',
        exampleSentence: 'Buenos días a todos.',
      }),
    ).toBeNull();
  });

  it('rejects when the example omits the word', () => {
    expect(
      validateProposedWord({
        displayForm: 'la manzana',
        lemma: 'manzana',
        gloss: 'apple',
        exampleSentence: 'Como una pera.',
      }),
    ).toBeNull();
  });

  it('rejects missing/empty fields and non-objects', () => {
    expect(validateProposedWord({ lemma: 'x' })).toBeNull();
    expect(validateProposedWord(null)).toBeNull();
    expect(
      validateProposedWord({
        displayForm: '  ',
        lemma: 'x',
        gloss: 'y',
        exampleSentence: 'x here',
      }),
    ).toBeNull();
  });
});

describe('deriveTier', () => {
  it('bands by rank with null → extended', () => {
    expect(deriveTier(500)).toBe('core');
    expect(deriveTier(1000)).toBe('core');
    expect(deriveTier(2000)).toBe('common');
    expect(deriveTier(9000)).toBe('extended');
    expect(deriveTier(null)).toBe('extended');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db test -- vocab-target/validate`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/db/src/vocab-target/validate.ts`:

```ts
export type ProposedWord = {
  displayForm: string;
  lemma: string;
  gloss: string;
  exampleSentence: string;
};

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Structural gate before human review. Returns a trimmed word or null. */
export function validateProposedWord(w: unknown): ProposedWord | null {
  if (typeof w !== 'object' || w === null) return null;
  const r = w as Record<string, unknown>;
  if (
    !nonEmptyString(r.displayForm) ||
    !nonEmptyString(r.lemma) ||
    !nonEmptyString(r.gloss) ||
    !nonEmptyString(r.exampleSentence)
  ) {
    return null;
  }
  const lemma = r.lemma.trim();
  if (/\s/.test(lemma)) return null; // single lexical item only

  const example = r.exampleSentence.toLowerCase();
  const lemmaTok = lemma.toLowerCase();
  // displayForm's last token drops a leading article (e.g. "la manzana" -> "manzana")
  const displayTok = r.displayForm.trim().toLowerCase().split(/\s+/).pop() ?? '';
  if (!example.includes(lemmaTok) && !example.includes(displayTok)) return null;

  return {
    displayForm: r.displayForm.trim(),
    lemma,
    gloss: r.gloss.trim(),
    exampleSentence: r.exampleSentence.trim(),
  };
}

export type VocabTier = 'core' | 'common' | 'extended';

/** Importance band from corpus frequency rank; null rank → extended. */
export function deriveTier(freqRank: number | null): VocabTier {
  if (freqRank === null) return 'extended';
  if (freqRank <= 1000) return 'core';
  if (freqRank <= 2500) return 'common';
  return 'extended';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- vocab-target/validate`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # feat/vocab-coverage-hub
git add packages/db/src/vocab-target/validate.ts packages/db/src/vocab-target/validate.test.ts
git commit -m "feat(vocab): vocab-target structural validator + tier derivation"
```

---

### Task 4: umbrella orchestration (propose → validate → freq-join → rows)

**Files:**
- Create: `packages/db/src/vocab-target/run-one-umbrella.ts`
- Test: `packages/db/src/vocab-target/run-one-umbrella.test.ts`

**Interfaces:**
- Consumes: `validateProposedWord`, `deriveTier` (Task 3); `loadFrequencyBand` (`../generation/vocab-band`); prompts from `@language-drill/ai` (Task 2); `cefrRankWindow` (`@language-drill/ai`); `vocabLemma` schema; an `Anthropic`-shaped client with `messages.create`.
- Produces: `runOneUmbrella(deps): Promise<{ rows: NewVocabTarget[]; rawCount: number; keptCount: number }>` where `deps = { db, client, umbrella: GrammarPoint, wordCount: number, avoidWords: readonly string[] }`. Rows are ready-to-insert `NewVocabTarget` with `status:'flagged'`, `source:'llm'`, `freqRank` looked up from `vocab_lemma`, `tier` from `deriveTier`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/vocab-target/run-one-umbrella.test.ts`. The db + client are mocked; the test asserts the transform (validation drop, freq-join, tier, flagged status):

```ts
import { describe, expect, it, vi } from 'vitest';
import type { GrammarPoint } from '@language-drill/shared';
import { runOneUmbrella } from './run-one-umbrella';

const umbrella = {
  key: 'es-a1-vocab-food-drink',
  kind: 'vocab',
  name: 'Food and drink (A1)',
  description: 'Core A1 food vocabulary.',
  cefrLevel: 'A1',
  language: 'ES',
} as unknown as GrammarPoint;

function mockClient(words: unknown[]) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ words }) }],
      }),
    },
  };
}

// db.select(...).from(...).where(...) resolving to vocab_lemma rank rows
function mockDb(rankByLemma: Record<string, number>) {
  return {
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve(
            Object.entries(rankByLemma).map(([lemma, rank]) => ({ lemma, rank })),
          ),
      }),
    }),
  };
}

describe('runOneUmbrella', () => {
  it('drops invalid words, joins freq rank, sets tier + flagged status', async () => {
    const client = mockClient([
      { displayForm: 'la manzana', lemma: 'manzana', gloss: 'apple', exampleSentence: 'Como una manzana.' },
      { displayForm: 'buenos días', lemma: 'buenos días', gloss: 'hi', exampleSentence: 'Buenos días.' }, // multi-token → dropped
      { displayForm: 'el pan', lemma: 'pan', gloss: 'bread', exampleSentence: 'Compro pan.' },
    ]);
    const db = mockDb({ manzana: 800, pan: 300 });

    const out = await runOneUmbrella({
      db: db as never,
      client: client as never,
      umbrella,
      wordCount: 3,
      avoidWords: [],
    });

    expect(out.rawCount).toBe(3);
    expect(out.keptCount).toBe(2);
    const byLemma = Object.fromEntries(out.rows.map((r) => [r.lemma, r]));
    expect(byLemma.manzana).toMatchObject({
      language: 'ES',
      umbrellaKey: 'es-a1-vocab-food-drink',
      cefrLevel: 'A1',
      freqRank: 800,
      tier: 'core',
      status: 'flagged',
      source: 'llm',
    });
    expect(byLemma.pan.tier).toBe('core');
  });

  it('leaves freqRank null (tier extended) for lemmas absent from vocab_lemma', async () => {
    const client = mockClient([
      { displayForm: 'el zumo', lemma: 'zumo', gloss: 'juice', exampleSentence: 'Bebo zumo.' },
    ]);
    const db = mockDb({}); // no matches
    const out = await runOneUmbrella({
      db: db as never,
      client: client as never,
      umbrella,
      wordCount: 1,
      avoidWords: [],
    });
    expect(out.rows[0]).toMatchObject({ freqRank: null, tier: 'extended' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db test -- vocab-target/run-one-umbrella`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/db/src/vocab-target/run-one-umbrella.ts`:

```ts
import { and, eq, inArray } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';
import {
  VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE,
  buildVocabTargetUserPrompt,
  cefrRankWindow,
} from '@language-drill/ai';
import type { CefrLevel, GrammarPoint, LearningLanguage } from '@language-drill/shared';

import type { Db } from '../client';
import { loadFrequencyBand } from '../generation/vocab-band';
import { vocabLemma } from '../schema/index';
import type { NewVocabTarget } from '../schema/vocab';
import { deriveTier, validateProposedWord, type ProposedWord } from './validate';

const LANGUAGE_NAME: Record<LearningLanguage, string> = {
  ES: 'Spanish',
  DE: 'German',
  TR: 'Turkish',
};

/** Max anchor lemmas fed to the model as frequency inspiration. */
const ANCHOR_WORD_LIMIT = 40;

export type RunOneUmbrellaDeps = {
  db: Db;
  client: Pick<Anthropic, 'messages'>;
  umbrella: GrammarPoint;
  wordCount: number;
  avoidWords: readonly string[];
};

export type RunOneUmbrellaResult = {
  rows: NewVocabTarget[];
  rawCount: number;
  keptCount: number;
};

function extractText(msg: Anthropic.Messages.Message): string {
  const block = msg.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? block.text : '';
}

function parseWords(text: string): unknown[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { words?: unknown };
    return Array.isArray(parsed.words) ? parsed.words : [];
  } catch {
    return [];
  }
}

export async function runOneUmbrella(
  deps: RunOneUmbrellaDeps,
): Promise<RunOneUmbrellaResult> {
  const { db, client, umbrella, wordCount, avoidWords } = deps;
  const language = umbrella.language as LearningLanguage;
  const cefr = umbrella.cefrLevel as CefrLevel;
  const { rankMin, rankMax } = cefrRankWindow(cefr);

  const anchorAll = await loadFrequencyBand(db, language, rankMin, rankMax);
  const freqAnchorWords = anchorAll.slice(0, ANCHOR_WORD_LIMIT);

  const system = VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE.replace(
    /\{\{languageName\}\}/g,
    LANGUAGE_NAME[language],
  )
    .replace(/\{\{cefrLevel\}\}/g, cefr)
    .replace(/\{\{umbrellaName\}\}/g, umbrella.name)
    .replace(/\{\{umbrellaDescription\}\}/g, umbrella.description)
    .replace(/\{\{wordCount\}\}/g, String(wordCount));

  const user = buildVocabTargetUserPrompt({
    umbrellaName: umbrella.name,
    umbrellaDescription: umbrella.description,
    wordCount,
    freqAnchorWords,
    avoidWords,
  });

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const raw = parseWords(extractText(msg as Anthropic.Messages.Message));
  const valid: ProposedWord[] = raw
    .map((w) => validateProposedWord(w))
    .filter((w): w is ProposedWord => w !== null);

  // De-dup within this batch and against the avoid-list (case-insensitive).
  const avoid = new Set(avoidWords.map((w) => w.toLowerCase()));
  const seen = new Set<string>();
  const deduped = valid.filter((w) => {
    const k = w.lemma.toLowerCase();
    if (avoid.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Frequency-join: one query for all kept lemmas.
  const rankByLemma = new Map<string, number>();
  if (deduped.length > 0) {
    const rows = await db
      .select({ lemma: vocabLemma.lemma, rank: vocabLemma.rank })
      .from(vocabLemma)
      .where(
        and(
          eq(vocabLemma.language, language),
          inArray(
            vocabLemma.lemma,
            deduped.map((w) => w.lemma),
          ),
        ),
      );
    for (const r of rows) rankByLemma.set(r.lemma, r.rank);
  }

  const targetRows: NewVocabTarget[] = deduped.map((w) => {
    const freqRank = rankByLemma.get(w.lemma) ?? null;
    return {
      language,
      umbrellaKey: umbrella.key,
      cefrLevel: cefr,
      lemma: w.lemma,
      displayForm: w.displayForm,
      gloss: w.gloss,
      exampleSentence: w.exampleSentence,
      freqRank,
      tier: deriveTier(freqRank),
      status: 'flagged',
      source: 'llm',
    };
  });

  return { rows: targetRows, rawCount: raw.length, keptCount: targetRows.length };
}
```

> The test's `mockDb` returns from `.where(...)` directly (no extra chain call), matching the single `.select().from().where()` used here. If the real Drizzle chain needs `.execute()`, adjust both together.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- vocab-target/run-one-umbrella`
Expected: PASS (both cases). Run `pnpm --filter @language-drill/db typecheck` too.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # feat/vocab-coverage-hub
git add packages/db/src/vocab-target/run-one-umbrella.ts packages/db/src/vocab-target/run-one-umbrella.test.ts
git commit -m "feat(vocab): per-umbrella vocab-target orchestration"
```

---

### Task 5: `generate:vocab-targets` CLI

**Files:**
- Create: `packages/db/scripts/generate-vocab-targets.ts`
- Modify: `packages/db/package.json` (add `"generate:vocab-targets"` script)
- Test: `packages/db/scripts/generate-vocab-targets.test.ts` (unit-test the pure resolver + insert-planning helpers, not the live Claude call)

**Interfaces:**
- Consumes: `runOneUmbrella` (Task 4); `ALL_CURRICULA` (`../src/curriculum`); `createDb`, `requireEnv`; `createClaudeClient` (`@language-drill/ai`); `vocabTarget` schema.
- Produces:
  - `resolveEsA1VocabUmbrellas(curricula): GrammarPoint[]` — filters `language==='ES' && cefrLevel==='A1' && kind==='vocab'`.
  - `loadExistingLemmas(db, umbrellaKey): Promise<string[]>` — existing `vocab_target.lemma` for the umbrella (the avoid-list, so re-runs don't re-propose).
  - a `main()` that runs each umbrella, inserts rows `onConflictDoNothing` (idempotent on the unique index), and prints `<inserted>/<proposed>` per umbrella.

- [ ] **Step 1: Write the failing test**

Create `packages/db/scripts/generate-vocab-targets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ALL_CURRICULA } from '../src/curriculum';
import { resolveEsA1VocabUmbrellas } from './generate-vocab-targets';

describe('resolveEsA1VocabUmbrellas', () => {
  it('returns only ES A1 vocab umbrellas', () => {
    const out = resolveEsA1VocabUmbrellas(ALL_CURRICULA);
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) {
      expect(p.language).toBe('ES');
      expect(p.cefrLevel).toBe('A1');
      expect(p.kind).toBe('vocab');
    }
    expect(out.map((p) => p.key)).toContain('es-a1-vocab-food-drink');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db test -- generate-vocab-targets`
Expected: FAIL — module/export not found.

- [ ] **Step 3: Implement the CLI**

Create `packages/db/scripts/generate-vocab-targets.ts`:

```ts
/**
 * `pnpm generate:vocab-targets` — Claude-backed authoring of curated ES A1
 * vocabulary targets. For each ES A1 vocab umbrella, proposes words, validates
 * them structurally, joins corpus frequency, and inserts rows `status='flagged'`
 * for human review (`pnpm review:flagged-vocab`). Idempotent: re-runs skip
 * lemmas already present for the umbrella (avoid-list + onConflictDoNothing).
 *
 * Required env: ANTHROPIC_API_KEY, DATABASE_URL.
 * Usage: pnpm --filter @language-drill/db generate:vocab-targets [--word-count 30]
 */

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createClaudeClient } from '@language-drill/ai';
import type { GrammarPoint } from '@language-drill/shared';

import { createDb, type Db } from '../src/client';
import { ALL_CURRICULA } from '../src/curriculum';
import { requireEnv } from '../src/lib/env';
import { vocabTarget } from '../src/schema/vocab';
import { runOneUmbrella } from '../src/vocab-target/run-one-umbrella';

const DEFAULT_WORD_COUNT = 30;

export function resolveEsA1VocabUmbrellas(
  curricula: readonly GrammarPoint[],
): GrammarPoint[] {
  return curricula.filter(
    (p) => p.language === 'ES' && p.cefrLevel === 'A1' && p.kind === 'vocab',
  );
}

export async function loadExistingLemmas(
  db: Db,
  umbrellaKey: string,
): Promise<string[]> {
  const rows = await db
    .select({ lemma: vocabTarget.lemma })
    .from(vocabTarget)
    .where(
      and(
        eq(vocabTarget.language, 'ES'),
        eq(vocabTarget.umbrellaKey, umbrellaKey),
      ),
    );
  return rows.map((r) => r.lemma);
}

function parseWordCount(argv: readonly string[]): number {
  const i = argv.indexOf('--word-count');
  if (i !== -1 && argv[i + 1]) {
    const n = Number.parseInt(argv[i + 1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_WORD_COUNT;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  requireEnv('ANTHROPIC_API_KEY');
  const wordCount = parseWordCount(process.argv.slice(2));

  const db = createDb(databaseUrl);
  const client = createClaudeClient();
  const umbrellas = resolveEsA1VocabUmbrellas(ALL_CURRICULA);

  process.stdout.write(
    `Authoring ${umbrellas.length} ES A1 vocab umbrella(s), ~${wordCount} words each.\n`,
  );

  for (const umbrella of umbrellas) {
    const avoidWords = await loadExistingLemmas(db, umbrella.key);
    const { rows, rawCount, keptCount } = await runOneUmbrella({
      db,
      client,
      umbrella,
      wordCount,
      avoidWords,
    });

    let inserted = 0;
    if (rows.length > 0) {
      const res = await db
        .insert(vocabTarget)
        .values(rows)
        .onConflictDoNothing({
          target: [
            vocabTarget.language,
            vocabTarget.umbrellaKey,
            vocabTarget.lemma,
          ],
        })
        .returning({ id: vocabTarget.id });
      inserted = res.length;
    }
    process.stdout.write(
      `[${umbrella.key}] proposed ${rawCount}, kept ${keptCount}, inserted ${inserted}\n`,
    );
  }
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Add the package script**

In `packages/db/package.json` `scripts`, after `generate:theory`:

```json
    "generate:vocab-targets": "npx tsx scripts/generate-vocab-targets.ts",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- generate-vocab-targets`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # feat/vocab-coverage-hub
git add packages/db/scripts/generate-vocab-targets.ts packages/db/scripts/generate-vocab-targets.test.ts packages/db/package.json
git commit -m "feat(vocab): generate:vocab-targets authoring CLI"
```

---

### Task 6: `review:flagged-vocab` review CLI

**Files:**
- Create: `packages/db/scripts/review-flagged-vocab.ts`
- Modify: `packages/db/package.json` (add `"review:flagged-vocab"` script)
- Test: `packages/db/scripts/review-flagged-vocab.test.ts`

**Interfaces:**
- Consumes: `vocabTarget` schema; `createDb`, `requireEnv`.
- Produces:
  - `formatFlaggedRow(row): string` — one review line: `key | displayForm (lemma) — gloss [tier, rank] :: exampleSentence`.
  - `main()` with two modes: default lists all `status='flagged'` ES rows grouped by umbrella; `--approve-all` flips every ES `flagged` row to `approved`; `--approve <id>` approves one. Prints counts.

- [ ] **Step 1: Write the failing test**

Create `packages/db/scripts/review-flagged-vocab.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatFlaggedRow } from './review-flagged-vocab';

describe('formatFlaggedRow', () => {
  it('renders a compact review line', () => {
    const line = formatFlaggedRow({
      umbrellaKey: 'es-a1-vocab-food-drink',
      displayForm: 'la manzana',
      lemma: 'manzana',
      gloss: 'apple',
      tier: 'core',
      freqRank: 800,
      exampleSentence: 'Como una manzana.',
    });
    expect(line).toContain('es-a1-vocab-food-drink');
    expect(line).toContain('la manzana');
    expect(line).toContain('manzana');
    expect(line).toContain('apple');
    expect(line).toContain('core');
    expect(line).toContain('800');
    expect(line).toContain('Como una manzana.');
  });

  it('shows rank as n/a when null', () => {
    const line = formatFlaggedRow({
      umbrellaKey: 'es-a1-vocab-food-drink',
      displayForm: 'el zumo',
      lemma: 'zumo',
      gloss: 'juice',
      tier: 'extended',
      freqRank: null,
      exampleSentence: 'Bebo zumo.',
    });
    expect(line).toContain('n/a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db test -- review-flagged-vocab`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/db/scripts/review-flagged-vocab.ts`:

```ts
/**
 * `pnpm review:flagged-vocab` — review + promote authored vocab targets.
 * Default: list ES rows with status='flagged', grouped by umbrella.
 * `--approve-all`: promote every flagged ES row to approved.
 * `--approve <id>`: promote a single row.
 * Required env: DATABASE_URL.
 */

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';

import { createDb } from '../src/client';
import { requireEnv } from '../src/lib/env';
import { vocabTarget } from '../src/schema/vocab';

export type FlaggedRowView = {
  umbrellaKey: string;
  displayForm: string;
  lemma: string;
  gloss: string;
  tier: string;
  freqRank: number | null;
  exampleSentence: string;
};

export function formatFlaggedRow(row: FlaggedRowView): string {
  const rank = row.freqRank === null ? 'n/a' : String(row.freqRank);
  return `${row.umbrellaKey} | ${row.displayForm} (${row.lemma}) — ${row.gloss} [${row.tier}, ${rank}] :: ${row.exampleSentence}`;
}

async function main(): Promise<void> {
  const db = createDb(requireEnv('DATABASE_URL'));
  const argv = process.argv.slice(2);

  if (argv.includes('--approve-all')) {
    const res = await db
      .update(vocabTarget)
      .set({ status: 'approved' })
      .where(and(eq(vocabTarget.language, 'ES'), eq(vocabTarget.status, 'flagged')))
      .returning({ id: vocabTarget.id });
    process.stdout.write(`Approved ${res.length} row(s).\n`);
    return;
  }

  const approveIdx = argv.indexOf('--approve');
  if (approveIdx !== -1 && argv[approveIdx + 1]) {
    const id = argv[approveIdx + 1];
    const res = await db
      .update(vocabTarget)
      .set({ status: 'approved' })
      .where(eq(vocabTarget.id, id))
      .returning({ id: vocabTarget.id });
    process.stdout.write(`Approved ${res.length} row(s).\n`);
    return;
  }

  const rows = await db
    .select({
      id: vocabTarget.id,
      umbrellaKey: vocabTarget.umbrellaKey,
      displayForm: vocabTarget.displayForm,
      lemma: vocabTarget.lemma,
      gloss: vocabTarget.gloss,
      tier: vocabTarget.tier,
      freqRank: vocabTarget.freqRank,
      exampleSentence: vocabTarget.exampleSentence,
    })
    .from(vocabTarget)
    .where(and(eq(vocabTarget.language, 'ES'), eq(vocabTarget.status, 'flagged')));

  process.stdout.write(`${rows.length} flagged ES vocab target(s):\n`);
  for (const r of rows) {
    process.stdout.write(`  [${r.id}] ${formatFlaggedRow(r)}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Add the package script**

In `packages/db/package.json` `scripts`, after `review:flagged-theory`:

```json
    "review:flagged-vocab": "npx tsx scripts/review-flagged-vocab.ts",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- review-flagged-vocab`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # feat/vocab-coverage-hub
git add packages/db/scripts/review-flagged-vocab.ts packages/db/scripts/review-flagged-vocab.test.ts packages/db/package.json
git commit -m "feat(vocab): review:flagged-vocab promotion CLI"
```

---

### Task 7: full-suite gate + prompt-sync note

**Files:** none (verification task)

- [ ] **Step 1: Run the full gate**

Run from repo root:
```bash
rm -rf infra/lambda/dist   # guard against stale compiled test files
pnpm lint
pnpm typecheck
pnpm turbo run test --concurrency=1
```
Expected: zero failures. Report `X passed, Y failed`; if any fail, fix before proceeding.

- [ ] **Step 2: Document the manual authoring run (do NOT run against prod blindly)**

The pipeline calls Claude for real. To author the ES A1 pilot lists against the **dev** DB (local `.env` points at the Neon dev branch):

```bash
pnpm --filter @language-drill/db generate:vocab-targets --word-count 30
pnpm --filter @language-drill/db review:flagged-vocab            # inspect
pnpm --filter @language-drill/db review:flagged-vocab --approve-all   # after review
```

Record in the PR description that the new `vocab-target-generate-system-prompt` must be synced to each Langfuse env after merge via `push-prompts` (per CLAUDE.md "Prompt Editing") — though for the pilot the in-repo fallback is sufficient to run the CLI.

- [ ] **Step 3: Commit any fixes from Step 1**

```bash
git branch --show-current   # feat/vocab-coverage-hub
git add -A && git commit -m "chore(vocab): full-suite gate fixes" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage (Spec 1, Components A + B authoring half):**
- `vocab_target` table (Component A) → Task 1. ✅
- Authoring CLI: LLM propose + validate + freq-join + flagged insert (Component B) → Tasks 2–5. ✅
- Human review / promote → Task 6. ✅
- Positioning guardrails (gloss hidden, mastery-map, no counter) → these belong to the **browse UI (Plan 2)**, not this pipeline plan. Noted, deferred. ✅
- Deliberate spec deviation: the spec listed "structural **+ a validation prompt**"; this plan does **structural validation + human review** only (human review is the real gate for a tiny pilot). An LLM validation pass can be added if review surfaces systematic issues. Flagged here so the deviation is explicit.

**Placeholder scan:** No TBDs, no "add error handling"-style hand-waves; every code step shows complete code.

**Type consistency:** `NewVocabTarget` (Task 1) is consumed by `runOneUmbrella` (Task 4) and inserted in Task 5. `ProposedWord`/`deriveTier`/`validateProposedWord` (Task 3) are consumed in Task 4. `runOneUmbrella` signature in Task 4 matches its call in Task 5. `resolveEsA1VocabUmbrellas`/`loadExistingLemmas` (Task 5) match their test. `formatFlaggedRow` (Task 6) matches its test. Consistent.
