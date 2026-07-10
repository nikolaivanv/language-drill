# Vocab Generation-Seeding Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `vocab_recall` generation seed its target word from approved `vocab_target` rows, preferring uncovered targets, and make the scheduler measure vocab progress by *distinct covered targets* — so curated-word coverage converges to 100% and then the cell goes quiet.

**Architecture:** Reuse the existing per-draft seed machinery (`buildSeedWords` → picker → per-draft "build around word X" directive → persisted `content_json.seedWord`) that already drives cloze/translation/conjugation. The new seed source is the `vocab_target` table (approved rows for the umbrella), the seed band is the umbrella's *uncovered* approved targets, and a strict prompt directive + a post-generation reject gate pin `expectedWord` to the seed so every approved seeded exercise registers against its target. The scheduler passes coverage-based `target`/`approvedInPool` into the unchanged `decideEnqueue`, so `need = |uncovered targets|` for free.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres/Neon), Anthropic SDK, Vitest. Monorepo packages: `@language-drill/shared`, `@language-drill/db`, `@language-drill/ai`, `@language-drill/lambda` (infra/lambda).

## Global Constraints

- **Package boundary:** `packages/ai` source must NEVER import `@language-drill/db`. `packages/db` must NEVER import `infra/lambda`. Shared code (e.g. `normalizeWord`) lives in `@language-drill/shared`, which both may import.
- **Prompt version bump:** editing any `*_SYSTEM_PROMPT`/`*_TEMPLATE`-adjacent generation behavior bumps `GENERATION_PROMPT_VERSION` to `<surface>@2026-07-10` (`generation-prompts.ts`). The per-draft user-prompt directive ships with the **code deploy**, NOT `push-prompts` — do not run push-prompts for this change.
- **Covered = `['auto-approved','manual-approved']`** everywhere (matches `APPROVED_STATUSES` in `infra/lambda/src/lib/exercise-filters.ts` and the Spec-1 coverage read model). NOT `flagged`.
- **One `normalizeWord`:** the generator's exclude, the reject gate, the scheduler count, and the Spec-1 read model MUST all call the identical `normalizeWord`. Move it to shared; never re-implement.
- **Rebuild after source edits:** `pnpm --filter @language-drill/shared build` after editing shared source, `pnpm --filter @language-drill/db build` after editing db source — single-package vitest resolves stale `dist` otherwise. Delete `infra/lambda/dist` before the full lambda run (stale compiled `.test.js` hazard).
- **Real gate:** `pnpm lint && pnpm typecheck && pnpm turbo run test --concurrency=1` (package `tsc` excludes `*.test.ts`).
- **Branch:** `worktree-feat+vocab-generation-seeding` (already checked out in this worktree, off `origin/main`). Assert the branch before every commit — the workspace can silently flip to `main`.
- **Scope:** ES A1 activates now (it has approved targets); the mechanism is language/level-agnostic and gates purely on the presence of approved `vocab_target` rows.

---

### Task 1: Move `normalizeWord` to `@language-drill/shared`

Both the generator (`packages/db`) and the read model / scheduler (`infra/lambda`) must share one `normalizeWord`. It currently lives only in `infra/lambda/src/lib/vocab-coverage.ts`, which `packages/db` cannot import.

**Files:**
- Create: `packages/shared/src/vocab-normalize.ts`
- Test: `packages/shared/src/vocab-normalize.test.ts`
- Modify: `packages/shared/src/index.ts` (add re-export)
- Modify: `infra/lambda/src/lib/vocab-coverage.ts` (import + re-export from shared; delete local copy)

**Interfaces:**
- Produces: `normalizeWord(s: string): string` — lowercase, trim, collapse whitespace, strip a leading Spanish article (`el/la/los/las/un/una/unos/unas`) on multi-token strings.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/vocab-normalize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeWord } from './vocab-normalize';

describe('normalizeWord', () => {
  it('lowercases and trims', () => {
    expect(normalizeWord('  Manzana  ')).toBe('manzana');
  });

  it('strips a leading article on multi-token strings', () => {
    expect(normalizeWord('la manzana')).toBe('manzana');
    expect(normalizeWord('los libros')).toBe('libros');
    expect(normalizeWord('un coche')).toBe('coche');
  });

  it('does NOT strip a single bare token that happens to be an article', () => {
    expect(normalizeWord('la')).toBe('la');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeWord('la   casa')).toBe('casa');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/shared test -- vocab-normalize`
Expected: FAIL — `./vocab-normalize` not found.

- [ ] **Step 3: Implement the shared module**

Create `packages/shared/src/vocab-normalize.ts`:

```ts
/**
 * Canonical surface-form normalization for vocab coverage matching. Shared by
 * the coverage read model (infra/lambda), the generation seed exclude and
 * seed-match reject gate (packages/db), and the scheduler's covered-target
 * count. All four MUST agree by construction, so there is exactly one copy.
 *
 * Lowercase, trim, collapse whitespace, and strip a leading Spanish article
 * when the string is multi-token (so "la manzana" matches the bare headword
 * "manzana" the generator emits as expectedWord).
 */
const ARTICLES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas']);

export function normalizeWord(s: string): string {
  const lowered = s.trim().toLowerCase();
  const tokens = lowered.split(/\s+/);
  if (tokens.length > 1 && ARTICLES.has(tokens[0])) return tokens.slice(1).join(' ');
  return lowered;
}
```

- [ ] **Step 4: Re-export from the shared index**

In `packages/shared/src/index.ts`, add alongside the other `export * from './...'` lines (e.g. after `export * from './tokenize';`):

```ts
export * from './vocab-normalize';
```

- [ ] **Step 5: Point `vocab-coverage.ts` at the shared copy**

In `infra/lambda/src/lib/vocab-coverage.ts`, delete the local `ARTICLES` const and the `normalizeWord` function, and instead import + re-export from shared. Replace:

```ts
const ARTICLES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas']);

export function normalizeWord(s: string): string {
  const lowered = s.trim().toLowerCase();
  const tokens = lowered.split(/\s+/);
  if (tokens.length > 1 && ARTICLES.has(tokens[0])) return tokens.slice(1).join(' ');
  return lowered;
}
```

with:

```ts
import { normalizeWord } from '@language-drill/shared';

// Re-exported so existing importers (routes/vocab.ts, tests) keep their
// `../lib/vocab-coverage` import path; the single source of truth is shared.
export { normalizeWord };
```

Put the `import` at the top of the file with the other imports (the file currently has none — add it as the first line after the top doc comment).

- [ ] **Step 6: Build shared, run both test suites**

Run:
```bash
pnpm --filter @language-drill/shared build
pnpm --filter @language-drill/shared test -- vocab-normalize
pnpm --filter @language-drill/lambda test -- vocab-coverage
```
Expected: PASS. The lambda `vocab-coverage` suite still passes because `normalizeWord` behavior is unchanged and the export path is preserved.

- [ ] **Step 7: Commit**

```bash
git branch --show-current   # worktree-feat+vocab-generation-seeding
git add packages/shared/src/vocab-normalize.ts packages/shared/src/vocab-normalize.test.ts packages/shared/src/index.ts infra/lambda/src/lib/vocab-coverage.ts
git commit -m "refactor(vocab): move normalizeWord to @language-drill/shared"
```

---

### Task 2: `vocab-target-seed` pure helpers (uncovered band + sequential picker)

The convergence logic is pure: from the umbrella's approved targets and the set of already-covered words, compute the uncovered band (priority-ordered), then assign band entries to draft ordinals sequentially (core/high-frequency first).

**Files:**
- Create: `packages/db/src/generation/vocab-target-seed.ts`
- Test: `packages/db/src/generation/vocab-target-seed.test.ts`

**Interfaces:**
- Consumes: `normalizeWord` from `@language-drill/shared` (Task 1).
- Produces:
  - `type VocabTargetRow = { lemma: string; displayForm: string }`
  - `computeUncoveredTargetBand(targets: readonly VocabTargetRow[], covered: ReadonlySet<string>): string[]` — the target lemmas whose normalized `lemma` AND `displayForm` are both absent from `covered` (which holds already-`normalizeWord`-ed surfaces), preserving input order.
  - `pickTargetSeeds(opts: { band: readonly string[]; count: number; exclude: ReadonlySet<string> }): (string | null)[]` — assigns band entries to `count` ordinal slots sequentially in band order, skipping `exclude` (case-insensitive) and already-chosen; unfilled slots are `null`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/generation/vocab-target-seed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeUncoveredTargetBand, pickTargetSeeds } from './vocab-target-seed';

describe('computeUncoveredTargetBand', () => {
  const targets = [
    { lemma: 'manzana', displayForm: 'la manzana' },
    { lemma: 'pan', displayForm: 'el pan' },
    { lemma: 'agua', displayForm: 'el agua' },
  ];

  it('drops targets whose lemma is covered', () => {
    const covered = new Set(['manzana']); // already normalized surfaces
    expect(computeUncoveredTargetBand(targets, covered)).toEqual(['pan', 'agua']);
  });

  it('drops targets whose displayForm (article-stripped) is covered', () => {
    // "el pan" normalizes to "pan"; a covered "pan" must exclude it.
    const covered = new Set(['pan']);
    expect(computeUncoveredTargetBand(targets, covered)).toEqual(['manzana', 'agua']);
  });

  it('preserves input (priority) order', () => {
    expect(computeUncoveredTargetBand(targets, new Set())).toEqual(['manzana', 'pan', 'agua']);
  });
});

describe('pickTargetSeeds', () => {
  const band = ['manzana', 'pan', 'agua', 'leche'];

  it('assigns band entries to ordinals in order', () => {
    expect(pickTargetSeeds({ band, count: 3, exclude: new Set() })).toEqual([
      'manzana',
      'pan',
      'agua',
    ]);
  });

  it('returns exactly `count` slots, padding with null when the band is short', () => {
    expect(pickTargetSeeds({ band: ['manzana'], count: 3, exclude: new Set() })).toEqual([
      'manzana',
      null,
      null,
    ]);
  });

  it('skips excluded seeds case-insensitively', () => {
    expect(pickTargetSeeds({ band, count: 2, exclude: new Set(['MANZANA']) })).toEqual([
      'pan',
      'agua',
    ]);
  });

  it('is deterministic', () => {
    const a = pickTargetSeeds({ band, count: 4, exclude: new Set() });
    const b = pickTargetSeeds({ band, count: 4, exclude: new Set() });
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db test -- vocab-target-seed`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/db/src/generation/vocab-target-seed.ts`:

```ts
/**
 * Pure helpers for vocab_recall target-seeding (generation-seeding alignment,
 * Spec 2). `computeUncoveredTargetBand` water-fills toward gaps: it drops any
 * curated target already covered by an approved exercise. `pickTargetSeeds`
 * assigns the uncovered band to draft ordinals in priority order (the band is
 * pre-sorted core/high-frequency first), so a partial batch covers the most
 * important words first. See
 * docs/superpowers/specs/2026-07-10-vocab-generation-seeding-design.md.
 */

import { normalizeWord } from '@language-drill/shared';

export type VocabTargetRow = { lemma: string; displayForm: string };

/**
 * Target lemmas not yet covered. `covered` holds already-`normalizeWord`-ed
 * surfaces (from approved exercises' expectedWord); a target is covered when
 * EITHER its normalized lemma OR its normalized displayForm is present — the
 * same lemma-or-displayForm match the Spec-1 coverage read model uses.
 */
export function computeUncoveredTargetBand(
  targets: readonly VocabTargetRow[],
  covered: ReadonlySet<string>,
): string[] {
  return targets
    .filter(
      (t) =>
        !covered.has(normalizeWord(t.lemma)) &&
        !covered.has(normalizeWord(t.displayForm)),
    )
    .map((t) => t.lemma);
}

export type PickTargetSeedsOptions = {
  /** Uncovered target lemmas, priority-ordered (core/high-frequency first). */
  band: readonly string[];
  /** Number of ordinal slots (one seed per draft). */
  count: number;
  /** In-flight seeds already anchored in the cell (case-insensitive). */
  exclude: ReadonlySet<string>;
};

/**
 * Sequential, priority-preserving picker: walk the band once, assigning each
 * non-excluded, not-yet-chosen lemma to the next ordinal. Unlike the hashing
 * `pickSeeds`, this keeps the band's priority order so a batch smaller than the
 * band still covers the most important words. Slots past the band's end are
 * `null` (the caller falls back to unseeded generation for them).
 */
export function pickTargetSeeds(opts: PickTargetSeedsOptions): (string | null)[] {
  const { band, count, exclude } = opts;
  const excludeLc = new Set<string>();
  for (const w of exclude) excludeLc.add(w.toLowerCase());

  const result: (string | null)[] = [];
  const chosen = new Set<string>();
  let bandIdx = 0;
  for (let ordinal = 0; ordinal < count; ordinal++) {
    let pick: string | null = null;
    while (bandIdx < band.length) {
      const lemma = band[bandIdx++];
      const lc = lemma.toLowerCase();
      if (excludeLc.has(lc) || chosen.has(lc)) continue;
      pick = lemma;
      chosen.add(lc);
      break;
    }
    result.push(pick);
  }
  return result;
}
```

- [ ] **Step 4: Build db, run test to verify it passes**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- vocab-target-seed`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # worktree-feat+vocab-generation-seeding
git add packages/db/src/generation/vocab-target-seed.ts packages/db/src/generation/vocab-target-seed.test.ts
git commit -m "feat(vocab): pure uncovered-band + sequential target-seed picker"
```

---

### Task 3: wire `vocab-target` seeding into `run-one-cell.ts`

Add the DB query helpers and the `seedKindFor` / `buildSeedWords` / prior-seed branches so `vocab_recall` cells seed from approved `vocab_target` rows, preferring uncovered targets. Zero approved targets → `undefined` → today's free generation (the data-driven gate).

**Files:**
- Modify: `packages/db/src/generation/run-one-cell.ts`
- Modify: `packages/db/src/generation/run-one-cell.test.ts` (reframe the "vocab returns undefined" test + add a targets-present case)

**Interfaces:**
- Consumes: `computeUncoveredTargetBand`, `pickTargetSeeds` (Task 2); `normalizeWord` (`@language-drill/shared`); `vocabTarget` schema.
- Produces (module-internal): `loadApprovedVocabTargets(db, language, umbrellaKey)`, `loadCoveredVocabWords(db, cell)`; `seedKindFor` now returns `'vocab-target'` for `vocab_recall`; `buildSeedWords` handles it.

- [ ] **Step 1: Add imports**

In `run-one-cell.ts`, add to the existing `@language-drill/shared` import (currently ending near line 41) the `normalizeWord` symbol:

```ts
import { /* ...existing symbols..., */ normalizeWord } from '@language-drill/shared';
```

Add `vocabTarget` to the schema import (the file already imports `exercises` from the schema barrel — add `vocabTarget` alongside it). And import the Task-2 helpers:

```ts
import {
  computeUncoveredTargetBand,
  pickTargetSeeds,
} from './vocab-target-seed';
```

- [ ] **Step 2: Add the two query helpers**

Place these near the other `fetchPrior*` helpers (e.g. after `fetchPriorVocabRecallSurfaces`). `loadCoveredVocabWords` mirrors `fetchPriorVocabRecallSurfaces` but uses the approved-only status set and no per-word cap, and returns normalized surfaces:

```ts
/**
 * Approved vocab targets for an umbrella, priority-ordered: `core` → `common`
 * → `extended` tier, then ascending `freqRank` (nulls last). The seed band is
 * built from this order so a partial batch covers the most important words
 * first. Empty when the umbrella has no approved targets (→ data-driven gate:
 * buildSeedWords returns undefined → unseeded free generation, unchanged).
 */
export async function loadApprovedVocabTargets(
  db: Db,
  language: string,
  umbrellaKey: string,
): Promise<readonly { lemma: string; displayForm: string }[]> {
  const rows = await db
    .select({
      lemma: vocabTarget.lemma,
      displayForm: vocabTarget.displayForm,
      tier: vocabTarget.tier,
      freqRank: vocabTarget.freqRank,
    })
    .from(vocabTarget)
    .where(
      and(
        eq(vocabTarget.language, language),
        eq(vocabTarget.umbrellaKey, umbrellaKey),
        eq(vocabTarget.status, 'approved'),
      ),
    );
  const tierRank = (t: string): number =>
    t === 'core' ? 0 : t === 'common' ? 1 : 2;
  return [...rows]
    .sort((a, b) => {
      const dt = tierRank(a.tier) - tierRank(b.tier);
      if (dt !== 0) return dt;
      return (a.freqRank ?? Number.MAX_SAFE_INTEGER) - (b.freqRank ?? Number.MAX_SAFE_INTEGER);
    })
    .map((r) => ({ lemma: r.lemma, displayForm: r.displayForm }));
}

/**
 * Normalized `expectedWord`s already APPROVED (auto/manual — matches the Spec-1
 * coverage read model's APPROVED_STATUSES, NOT flagged) in this vocab_recall
 * cell. This is the authoritative "covered" set: it captures both new seeded
 * exercises and the legacy pool that carries no seedWord, so we never re-seed a
 * word an old free-gen exercise already tests.
 */
export async function loadCoveredVocabWords(db: Db, cell: Cell): Promise<Set<string>> {
  const rows = await db
    .select({ surface: sql<string>`content_json->>'expectedWord'` })
    .from(exercises)
    .where(
      and(
        eq(exercises.language, cell.language),
        eq(exercises.difficulty, cell.cefrLevel),
        eq(exercises.type, cell.exerciseType),
        eq(exercises.grammarPointKey, cell.grammarPoint.key),
        inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']),
        sql`content_json ? 'expectedWord'`,
      ),
    );
  const set = new Set<string>();
  for (const r of rows) {
    if (typeof r.surface === 'string' && r.surface) set.add(normalizeWord(r.surface));
  }
  return set;
}
```

- [ ] **Step 3: Extend `seedKindFor`**

Widen the return type and add the `vocab_recall` branch. Change the signature return union to include `'vocab-target'`:

```ts
export function seedKindFor(
  cell: Cell,
): 'frequency' | 'verb' | 'noun' | 'predicate-nominal' | 'elicitation-values' | 'vocab-target' | null {
```

and add, before the final `return null;`:

```ts
  if (cell.exerciseType === ExerciseType.VOCAB_RECALL) {
    // Seed the target word from the curated vocab_target list, preferring
    // uncovered targets so coverage converges (Spec 2). buildSeedWords returns
    // undefined when the umbrella has no approved targets, restoring today's
    // free generation for un-authored umbrellas (the data-driven gate).
    return 'vocab-target';
  }
```

- [ ] **Step 4: Add the `buildSeedWords` branch**

In `buildSeedWords`, immediately after `if (kind === null) return undefined;` and BEFORE `const window = cefrRankWindow(...)`, add:

```ts
  if (kind === 'vocab-target') {
    const targets = await loadApprovedVocabTargets(db, cell.language, cell.grammarPoint.key);
    if (targets.length === 0) return undefined; // no curated list → free gen
    const covered = await loadCoveredVocabWords(db, cell);
    const band = computeUncoveredTargetBand(targets, covered);
    return pickTargetSeeds({ band, count, exclude: priorSeeds });
  }
```

- [ ] **Step 5: Wire the prior-seed exclude set**

In `runOneCell`'s `priorSeeds` assignment (the `seedKind === 'frequency' || seedKind === 'elicitation-values'` branch), add `'vocab-target'` so it shares `fetchPriorSeeds` (all three persist the seed under `content_json.seedWord`). Change:

```ts
      seedKind === 'frequency' || seedKind === 'elicitation-values'
```
to:
```ts
      seedKind === 'frequency' ||
      seedKind === 'elicitation-values' ||
      seedKind === 'vocab-target'
```

This makes a flagged-but-not-yet-approved seeded word an in-flight exclude, so re-runs don't pile up duplicate flagged exercises for the same target before it's approved.

- [ ] **Step 6: Reframe the existing test and add a targets-present case**

In `run-one-cell.test.ts`, the DB-backed suite (`describe.skipIf(!process.env['TEST_DATABASE_URL'])`, ~line 1201) has a test asserting vocab_recall returns `undefined`. Reframe it to the "no approved targets" case, and add a "seeds when targets exist" case. First extend the suite's `beforeAll` to also clear `vocabTarget` and insert two approved rows for a test umbrella:

```ts
    beforeAll(async () => {
      seedDb = createDb(process.env['TEST_DATABASE_URL']!);
      await seedDb.delete(vocabLemma);
      await seedDb.insert(vocabLemma).values([
        // ...existing rows unchanged...
      ]);
      await seedDb.delete(vocabTarget);
      await seedDb.insert(vocabTarget).values([
        { language: 'ES', umbrellaKey: 'es-vt-test', cefrLevel: 'A1', lemma: 'manzana', displayForm: 'la manzana', gloss: 'apple', exampleSentence: 'Como una manzana.', freqRank: 800, tier: 'core', status: 'approved', source: 'llm' },
        { language: 'ES', umbrellaKey: 'es-vt-test', cefrLevel: 'A1', lemma: 'pan', displayForm: 'el pan', gloss: 'bread', exampleSentence: 'Compro pan.', freqRank: 300, tier: 'core', status: 'approved', source: 'llm' },
      ]);
    });
```

Add `vocabTarget` to the file's schema imports if not already present. Then update the `afterAll` to also `await seedDb.delete(vocabTarget)`.

Replace the existing test body:

```ts
    it('does NOT seed a vocab_recall cell whose umbrella has no approved targets', async () => {
      const clozeCell = buildTestCell(); // its grammarPoint is not a vocab umbrella
      const vocabCell: Cell = { ...clozeCell, exerciseType: ExerciseType.VOCAB_RECALL };
      expect(await buildSeedWords(seedDb, vocabCell, 5, 'seed-batch', new Set())).toBeUndefined();
    });

    it('seeds a vocab_recall cell from approved vocab_target rows, uncovered first', async () => {
      const clozeCell = buildTestCell();
      const vocabCell: Cell = {
        ...clozeCell,
        exerciseType: ExerciseType.VOCAB_RECALL,
        grammarPoint: { ...clozeCell.grammarPoint, key: 'es-vt-test' },
        cellKey: 'es:a1:vocab_recall:es-vt-test',
      };
      const seeds = await buildSeedWords(seedDb, vocabCell, 2, 'seed-batch', new Set());
      expect(seeds).toBeDefined();
      const chosen = seeds!.filter((s): s is string => typeof s === 'string');
      // Both approved targets are uncovered (no exercises seeded yet); priority
      // order is by tier then freqRank, so 'pan' (rank 300) precedes 'manzana' (800).
      expect(chosen).toEqual(['pan', 'manzana']);
    });
```

> The DB-backed suite is skipped without `TEST_DATABASE_URL`; the pure convergence logic is fully covered by Task 2. This suite adds integration confidence when a test DB is present (CI PR branch).

- [ ] **Step 7: Build db, run tests, typecheck**

Run:
```bash
pnpm --filter @language-drill/db build
pnpm --filter @language-drill/db test -- run-one-cell
pnpm --filter @language-drill/db typecheck
```
Expected: PASS (the pure suites always run; the DB-backed suite runs only with `TEST_DATABASE_URL`). Typecheck clean (the widened `seedKindFor` union is consumed only in the branches added here and the priorSeeds condition).

- [ ] **Step 8: Commit**

```bash
git branch --show-current   # worktree-feat+vocab-generation-seeding
git add packages/db/src/generation/run-one-cell.ts packages/db/src/generation/run-one-cell.test.ts
git commit -m "feat(vocab): seed vocab_recall generation from approved vocab_target rows"
```

---

### Task 4: strict vocab seed directive + prompt version bump (`packages/ai`)

The default seed directive is loose ("choose a related content word of similar frequency instead") — a substitution escape hatch that defeats convergence. Add a strict `vocab_recall` branch that pins `expectedWord` to the seed.

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts` (add the `VOCAB_RECALL` seedBlock branch; bump `GENERATION_PROMPT_VERSION`)
- Test: `packages/ai/src/generation-prompts.test.ts` (assert the strict text; assert the loose substitution phrase is absent for vocab)

**Interfaces:**
- Consumes: existing `buildGenerationUserPrompt(inputs, ordinal, topicDomain, seedWord)`; `ExerciseType.VOCAB_RECALL`.
- Produces: for a seeded `vocab_recall` draft, a user-prompt block pinning `expectedWord` to the seed.

- [ ] **Step 1: Write the failing test**

Add to `packages/ai/src/generation-prompts.test.ts` (near the other `buildGenerationUserPrompt` seed tests; adapt the `inputs` factory the file already uses — search for an existing `buildGenerationUserPrompt(` call to copy its `inputs` shape and swap `exerciseType: ExerciseType.VOCAB_RECALL`):

```ts
describe('buildGenerationUserPrompt — vocab_recall seed directive', () => {
  it('pins expectedWord to the seed and forbids substitution', () => {
    const out = buildGenerationUserPrompt(
      { ...vocabInputs, exerciseType: ExerciseType.VOCAB_RECALL },
      0,
      null,
      'manzana',
    );
    expect(out).toContain('manzana');
    expect(out).toMatch(/must be exactly/i);
    // Must NOT offer the loose frequency-substitution escape hatch.
    expect(out).not.toContain('similar frequency');
  });
});
```

> `vocabInputs` = a minimal `GenerationPromptInputs` for a vocab_recall cell. Reuse the existing test's inputs factory; if none exists, build one mirroring the other seed tests (grammarPoint with a `name`, `language`, `cefrLevel`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts`
Expected: FAIL — the current vocab path emits the loose block (contains "similar frequency", no "must be exactly").

- [ ] **Step 3: Implement the strict branch**

In `buildGenerationUserPrompt`, the `seedBlock` ternary currently falls to the loose default for any non-conjugation, non-paraphrase type. Insert a `VOCAB_RECALL` branch before that default. Locate:

```ts
          : `Build this exercise around the word "${seedWord}". If "${seedWord}" does not fit ${inputs.grammarPoint.name} naturally, choose a related content word of similar frequency instead.\n\n`
```

and change the preceding `:` chain so vocab_recall is handled first. Replace that final alternative with:

```ts
          : inputs.exerciseType === ExerciseType.VOCAB_RECALL
            ? // Strict: the seed IS the target word. No substitution escape hatch —
              // the seed comes from the curated vocab_target list and coverage only
              // registers when expectedWord matches it (Spec 2). The anti-leak rule
              // (system prompt) still forbids the clue from containing the word.
              `The target word (expectedWord) MUST be exactly "${seedWord}". Write a clue or definition that elicits "${seedWord}" without revealing it — the clue must NOT contain "${seedWord}". Do not substitute another word.\n\n`
            : `Build this exercise around the word "${seedWord}". If "${seedWord}" does not fit ${inputs.grammarPoint.name} naturally, choose a related content word of similar frequency instead.\n\n`
```

- [ ] **Step 4: Confirm the prompt version**

`GENERATION_PROMPT_VERSION` in `generation-prompts.ts` is **already** `generate@2026-07-10` (a sibling PR bumped it to today). The CLAUDE.md "version = today's date" rule is therefore already satisfied — **no edit needed**. Do NOT invent a finer-grained tag; leave the constant as is. (It ships with the code deploy regardless — **do NOT run `push-prompts`**; the per-draft user prompt is not the Langfuse template.) If, by the time you implement this, the date constant is no longer today's, bump it to the current date.

- [ ] **Step 5: Run tests, typecheck**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts && pnpm --filter @language-drill/ai typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # worktree-feat+vocab-generation-seeding
git add packages/ai/src/generation-prompts.ts packages/ai/src/generation-prompts.test.ts
git commit -m "feat(vocab): strict vocab_recall seed directive pinning expectedWord to the target"
```

---

### Task 5: seed-match reject gate (`packages/db`)

Guarantee that every approved seeded exercise registers against its target: reject a seeded `vocab_recall` draft whose `expectedWord` doesn't normalize-match the seed. Without this, a model drift produces an approved exercise that never covers the target — leaving it `not-yet` forever.

**Files:**
- Create: `packages/db/src/generation/vocab-seed-check.ts`
- Test: `packages/db/src/generation/vocab-seed-check.test.ts`
- Modify: `packages/db/src/generation/validate-and-insert.ts` (apply the veto to the routing decision)

**Interfaces:**
- Consumes: `normalizeWord` (`@language-drill/shared`); `ExerciseType`, exercise content types (`@language-drill/shared`).
- Produces:
  - `SEED_TARGET_MISMATCH_REASON: string` (`'seed-target-mismatch'`)
  - `vocabSeedMismatchReason(content: unknown, seedWord: string | null): string | null` — returns the reason when `content.type === 'vocab_recall'` and `seedWord` is set and `normalizeWord(content.expectedWord) !== normalizeWord(seedWord)`, else `null`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/generation/vocab-seed-check.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SEED_TARGET_MISMATCH_REASON, vocabSeedMismatchReason } from './vocab-seed-check';

const vocab = (expectedWord: string) => ({
  type: 'vocab_recall' as const,
  instructions: 'x',
  prompt: 'x',
  expectedWord,
  hints: [],
  exampleSentence: 'x',
});

describe('vocabSeedMismatchReason', () => {
  it('returns null when the expectedWord matches the seed', () => {
    expect(vocabSeedMismatchReason(vocab('manzana'), 'manzana')).toBeNull();
  });

  it('matches after normalization (article strip / case)', () => {
    expect(vocabSeedMismatchReason(vocab('Manzana'), 'la manzana')).toBeNull();
  });

  it('returns the reason when the model drifted off the seed', () => {
    expect(vocabSeedMismatchReason(vocab('pera'), 'manzana')).toBe(SEED_TARGET_MISMATCH_REASON);
  });

  it('is a no-op when unseeded', () => {
    expect(vocabSeedMismatchReason(vocab('pera'), null)).toBeNull();
  });

  it('is a no-op for non-vocab content', () => {
    expect(vocabSeedMismatchReason({ type: 'cloze' }, 'manzana')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db test -- vocab-seed-check`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/db/src/generation/vocab-seed-check.ts`:

```ts
/**
 * Seed-match reject gate (Spec 2). A seeded vocab_recall draft whose
 * expectedWord doesn't normalize-match its seed would, if approved, never
 * register against the curated target — the target stays `not-yet` forever
 * despite the spend. Rejecting it makes "seeded → covered on approval" an
 * invariant; the target is simply re-seeded next scheduler run. Uses the same
 * normalizeWord as the coverage read model so the gate and the read agree.
 */

import { normalizeWord } from '@language-drill/shared';

export const SEED_TARGET_MISMATCH_REASON = 'seed-target-mismatch';

export function vocabSeedMismatchReason(
  content: unknown,
  seedWord: string | null,
): string | null {
  if (seedWord === null || seedWord.length === 0) return null;
  if (typeof content !== 'object' || content === null) return null;
  const c = content as { type?: unknown; expectedWord?: unknown };
  if (c.type !== 'vocab_recall') return null;
  if (typeof c.expectedWord !== 'string') return null;
  return normalizeWord(c.expectedWord) === normalizeWord(seedWord)
    ? null
    : SEED_TARGET_MISMATCH_REASON;
}
```

- [ ] **Step 4: Apply the veto in `validate-and-insert.ts`**

Add the import at the top with the other generation-module imports:

```ts
import { SEED_TARGET_MISMATCH_REASON, vocabSeedMismatchReason } from './vocab-seed-check';
```

In the attempt loop, immediately AFTER the `const decision = applyDeterministicChecks(...)` block (~line 363) and BEFORE the `if (decision.reviewStatus === 'rejected')` branch, override the decision on a seed mismatch:

```ts
    // Seed-match gate (Spec 2): a seeded vocab_recall draft that drifted off
    // its curated target is rejected here (not inserted), so an approved
    // exercise always covers its seed. The target is re-seeded next run.
    const seedMismatch = vocabSeedMismatchReason(currentDraft.contentJson, seedWord);
    const gatedDecision = seedMismatch
      ? {
          reviewStatus: 'rejected' as const,
          flaggedReasons: [seedMismatch, ...decision.flaggedReasons],
        }
      : decision;
```

Then replace every subsequent use of `decision` in this iteration with `gatedDecision` (the `if (decision.reviewStatus === 'rejected')` guard, the `rejectionReasons: decision.flaggedReasons` in the rejected-return, and the `reviewStatus: decision.reviewStatus` / `flaggedReasons: decision.flaggedReasons` in the insert branch). Confirm with:

```bash
grep -n "decision" packages/db/src/generation/validate-and-insert.ts
```

and change the references from the `const decision = applyDeterministicChecks` line down to the end of the loop body to `gatedDecision` (leave the `const decision =` declaration itself). A mismatch is not a dedup collision, so `firstAttemptDeduped` is false → the rejected branch takes the terminal `return { terminalStatus: 'rejected', rejectionReasons: gatedDecision.flaggedReasons, ... }` path (no within-run retry); convergence retries it next scheduler run.

- [ ] **Step 5: Build db, run tests, typecheck**

Run:
```bash
pnpm --filter @language-drill/db build
pnpm --filter @language-drill/db test -- vocab-seed-check validate-and-insert
pnpm --filter @language-drill/db typecheck
```
Expected: PASS. The existing `validate-and-insert` tests are unseeded (`seedWord` null) or non-vocab, so the gate is a no-op for them.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # worktree-feat+vocab-generation-seeding
git add packages/db/src/generation/vocab-seed-check.ts packages/db/src/generation/vocab-seed-check.test.ts packages/db/src/generation/validate-and-insert.ts
git commit -m "feat(vocab): reject seeded vocab_recall drafts that drift off the target word"
```

---

### Task 6: coverage-aware scheduler need (`infra/lambda`)

For `vocab_recall` cells whose umbrella has approved targets, pass coverage-based `target` (= approved-target count) and `approvedInPool` (= distinct-covered count) into the unchanged `decideEnqueue`, so `need = |uncovered targets|` and the cell stops when all covered. This also fixes the flat-10 cap that structurally blocked full coverage.

**Files:**
- Create: `infra/lambda/src/generation/vocab-target-coverage.ts`
- Test: `infra/lambda/src/generation/vocab-target-coverage.test.ts`
- Modify: `infra/lambda/src/generation/scheduler.ts` (compute the map; use it in the decide loop)

**Interfaces:**
- Consumes: `normalizeWord` (`@language-drill/shared`); `vocabTarget`, `exercises` schema; `decideEnqueue` (unchanged).
- Produces:
  - `type VocabTargetCoverage = { approvedTargets: number; coveredTargets: number }`
  - `computeVocabTargetCoverage(targets, expectedWordsByUmbrella): Map<string, VocabTargetCoverage>` — pure; key `${language}|${umbrellaKey}`.
  - `loadVocabTargetCoveragePerUmbrella(db): Promise<Map<string, VocabTargetCoverage>>` — the two reads + the pure combine.

- [ ] **Step 1: Write the failing test (pure combine)**

Create `infra/lambda/src/generation/vocab-target-coverage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeVocabTargetCoverage } from './vocab-target-coverage';

describe('computeVocabTargetCoverage', () => {
  const targets = [
    { language: 'ES', umbrellaKey: 'es-a1-vocab-food-drink', lemma: 'manzana', displayForm: 'la manzana' },
    { language: 'ES', umbrellaKey: 'es-a1-vocab-food-drink', lemma: 'pan', displayForm: 'el pan' },
    { language: 'ES', umbrellaKey: 'es-a1-vocab-food-drink', lemma: 'agua', displayForm: 'el agua' },
  ];

  it('counts approved targets and distinct covered targets per umbrella', () => {
    // Two approved exercises: one for "manzana", one "el pan" (article form).
    const byUmbrella = new Map([
      ['ES|es-a1-vocab-food-drink', ['manzana', 'el pan']],
    ]);
    const out = computeVocabTargetCoverage(targets, byUmbrella);
    expect(out.get('ES|es-a1-vocab-food-drink')).toEqual({
      approvedTargets: 3,
      coveredTargets: 2, // manzana + pan (via displayForm normalize); agua uncovered
    });
  });

  it('reports zero covered when no exercises exist', () => {
    const out = computeVocabTargetCoverage(targets, new Map());
    expect(out.get('ES|es-a1-vocab-food-drink')).toEqual({
      approvedTargets: 3,
      coveredTargets: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- vocab-target-coverage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `infra/lambda/src/generation/vocab-target-coverage.ts`:

```ts
/**
 * Scheduler-side vocab coverage counts (Spec 2). For each umbrella with
 * approved vocab_target rows, how many targets are approved and how many are
 * covered by an approved vocab_recall exercise. The scheduler feeds these as
 * (target, approvedInPool) into the unchanged decideEnqueue so
 * need = |uncovered targets| — the cell converges to full coverage then stops.
 * Uses the same normalizeWord as the read model + the generator's exclude.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { exercises, vocabTarget, type Db } from '@language-drill/db';
import { normalizeWord } from '@language-drill/shared';

export type VocabTargetCoverage = { approvedTargets: number; coveredTargets: number };

type TargetRow = {
  language: string;
  umbrellaKey: string;
  lemma: string;
  displayForm: string;
};

const APPROVED_STATUSES = ['auto-approved', 'manual-approved'] as const;

const keyOf = (language: string, umbrellaKey: string): string =>
  `${language}|${umbrellaKey}`;

/** Pure combine: approved-target count + distinct-covered count per umbrella. */
export function computeVocabTargetCoverage(
  targets: readonly TargetRow[],
  expectedWordsByUmbrella: ReadonlyMap<string, readonly string[]>,
): Map<string, VocabTargetCoverage> {
  const byUmbrella = new Map<string, TargetRow[]>();
  for (const t of targets) {
    const k = keyOf(t.language, t.umbrellaKey);
    const list = byUmbrella.get(k);
    if (list) list.push(t);
    else byUmbrella.set(k, [t]);
  }

  const out = new Map<string, VocabTargetCoverage>();
  for (const [k, rows] of byUmbrella) {
    const covered = new Set(
      (expectedWordsByUmbrella.get(k) ?? []).map((w) => normalizeWord(w)),
    );
    let coveredTargets = 0;
    for (const t of rows) {
      if (covered.has(normalizeWord(t.lemma)) || covered.has(normalizeWord(t.displayForm))) {
        coveredTargets += 1;
      }
    }
    out.set(k, { approvedTargets: rows.length, coveredTargets });
  }
  return out;
}

/** Two reads (approved targets; approved vocab_recall expectedWords) + combine. */
export async function loadVocabTargetCoveragePerUmbrella(
  db: Db,
): Promise<Map<string, VocabTargetCoverage>> {
  const targets = await db
    .select({
      language: vocabTarget.language,
      umbrellaKey: vocabTarget.umbrellaKey,
      lemma: vocabTarget.lemma,
      displayForm: vocabTarget.displayForm,
    })
    .from(vocabTarget)
    .where(eq(vocabTarget.status, 'approved'));

  const exRows = await db
    .select({
      language: exercises.language,
      umbrellaKey: exercises.grammarPointKey,
      word: sql<string>`content_json->>'expectedWord'`,
    })
    .from(exercises)
    .where(
      and(
        eq(exercises.type, 'vocab_recall'),
        inArray(exercises.reviewStatus, [...APPROVED_STATUSES]),
        sql`content_json ? 'expectedWord'`,
      ),
    );

  const expectedWordsByUmbrella = new Map<string, string[]>();
  for (const r of exRows) {
    if (r.umbrellaKey == null || typeof r.word !== 'string' || !r.word) continue;
    const k = keyOf(r.language, r.umbrellaKey);
    const list = expectedWordsByUmbrella.get(k);
    if (list) list.push(r.word);
    else expectedWordsByUmbrella.set(k, [r.word]);
  }

  return computeVocabTargetCoverage(targets, expectedWordsByUmbrella);
}
```

> Confirm `Db`, `exercises`, and `vocabTarget` are exported from the `@language-drill/db` barrel (routes/vocab.ts already imports `exercises`, `vocabTarget` from it). If `Db` is not on the barrel, import it from its actual export path used elsewhere in `infra/lambda` (grep `import.*Db.*@language-drill/db`).

- [ ] **Step 4: Add a `toSQL` guard test for the reads**

Append to `vocab-target-coverage.test.ts` a guard that the two queries render without an ambiguous/unqualified column (the "drizzle projection subquery unqualified" hazard) — build the queries via a lightweight mock and assert `.toSQL()` mentions the expected columns. Simpler and robust: assert the SQL string of each select is well-formed by constructing against the real schema and calling `.toSQL()`:

```ts
import { and, eq, inArray, sql } from 'drizzle-orm';
import { exercises, vocabTarget } from '@language-drill/db';
import { drizzle } from 'drizzle-orm/node-postgres';

it('renders the coverage reads without unqualified columns', () => {
  // A driver-less builder is enough to call toSQL(); no DB connection is made.
  const qb = drizzle({} as never);
  const targetsSql = qb
    .select({ language: vocabTarget.language, umbrellaKey: vocabTarget.umbrellaKey })
    .from(vocabTarget)
    .where(eq(vocabTarget.status, 'approved'))
    .toSQL();
  expect(targetsSql.sql).toContain('vocab_target');

  const exSql = qb
    .select({
      language: exercises.language,
      umbrellaKey: exercises.grammarPointKey,
      word: sql<string>`content_json->>'expectedWord'`,
    })
    .from(exercises)
    .where(
      and(
        eq(exercises.type, 'vocab_recall'),
        inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']),
        sql`content_json ? 'expectedWord'`,
      ),
    )
    .toSQL();
  expect(exSql.sql).toContain('exercises');
  expect(exSql.sql).toContain("content_json->>'expectedWord'");
});
```

> If `drizzle-orm/node-postgres`'s `drizzle({})` shape differs in this repo's version, mirror however existing lambda tests build a driver-less query builder for `toSQL` (grep `toSQL` under `infra/lambda`). The intent is only to render SQL, not execute it.

- [ ] **Step 5: Wire into the scheduler decide loop**

In `infra/lambda/src/generation/scheduler.ts`:

Add the import:
```ts
import { loadVocabTargetCoveragePerUmbrella } from './vocab-target-coverage';
```
Ensure `ExerciseType` is imported (grep the file; if absent, add `import { ExerciseType } from '@language-drill/shared';` or from the db barrel as other files do).

After the `approvedCoverageByCell` load (~line 217, step "4b"), add step 4c:
```ts
  // 4c. Spec 2: per-umbrella vocab_target coverage (approved-target count +
  //     distinct-covered count). Drives coverage-aware need for vocab_recall
  //     cells whose umbrella has approved targets, so curated-word coverage
  //     converges to 100% then the cell stops.
  const vocabCoverageByUmbrella = await loadVocabTargetCoveragePerUmbrella(db);
```

In the per-cell loop (~line 232), replace the `approvedInPool` and `target` lines:
```ts
    const approvedInPool = approvedByCell.get(cell.cellKey) ?? 0;
    // ...
    const target = resolveCellTarget(cell);
```
with:
```ts
    const vocabCoverage =
      cell.exerciseType === ExerciseType.VOCAB_RECALL
        ? vocabCoverageByUmbrella.get(`${cell.language}|${cell.grammarPoint.key}`)
        : undefined;
    const usingTargets = vocabCoverage !== undefined && vocabCoverage.approvedTargets > 0;
    // Coverage-aware for seeded vocab umbrellas: measure progress as distinct
    // covered targets vs total approved targets, so decideEnqueue yields
    // need = |uncovered targets| and skip-target-reached fires when all covered.
    const approvedInPool = usingTargets
      ? vocabCoverage!.coveredTargets
      : (approvedByCell.get(cell.cellKey) ?? 0);
    const target = usingTargets ? vocabCoverage!.approvedTargets : resolveCellTarget(cell);
```

Leave the `decideEnqueue(cell, approvedInPool, target, recentJob, curriculumVersionOnDisk)` call unchanged.

- [ ] **Step 6: Add a decide-passthrough test**

In `vocab-target-coverage.test.ts` (or the scheduler-decision test file), assert the intended semantics through the unchanged `decideEnqueue`:

```ts
import { decideEnqueue } from './scheduler-decision';

const vocabCell = {
  cefrLevel: 'A1',
  language: 'ES',
  exerciseType: 'vocab_recall',
  grammarPoint: { key: 'es-a1-vocab-food-drink' },
  cellKey: 'es:a1:vocab_recall:es-a1-vocab-food-drink',
} as never;

describe('coverage-aware need (via decideEnqueue)', () => {
  it('enqueues need = uncovered when targets remain', () => {
    // approvedTargets 30, coveredTargets 4 → target 30, approvedInPool 4.
    expect(decideEnqueue(vocabCell, 4, 30, null, undefined)).toEqual({
      kind: 'enqueue',
      need: 26,
    });
  });

  it('skips when every target is covered', () => {
    expect(decideEnqueue(vocabCell, 30, 30, null, undefined)).toEqual({
      kind: 'skip-target-reached',
    });
  });
});
```

- [ ] **Step 7: Delete stale dist, run lambda tests, typecheck**

Run:
```bash
rm -rf infra/lambda/dist
pnpm --filter @language-drill/lambda test -- vocab-target-coverage scheduler
pnpm --filter @language-drill/lambda typecheck
```
Expected: PASS. If `scheduler.ts` has a dedicated test that snapshots the decide loop, confirm it still passes (vocab cells with no targets fall through to `resolveCellTarget`, unchanged).

- [ ] **Step 8: Commit**

```bash
git branch --show-current   # worktree-feat+vocab-generation-seeding
git add infra/lambda/src/generation/vocab-target-coverage.ts infra/lambda/src/generation/vocab-target-coverage.test.ts infra/lambda/src/generation/scheduler.ts
git commit -m "feat(vocab): coverage-aware scheduler need for seeded vocab_recall umbrellas"
```

---

### Task 7: full-suite gate + rollout note

**Files:** none (verification task).

- [ ] **Step 1: Run the full gate**

Run from the worktree root:
```bash
rm -rf infra/lambda/dist
pnpm lint
pnpm typecheck
pnpm turbo run test --concurrency=1
```
Expected: zero failures. Report `X passed, Y failed`; fix any failure before proceeding (do not mark complete on a red suite). Likely touch-points if red: an exhaustive `switch (seedKind)` elsewhere that now misses `'vocab-target'` (grep `seedKindFor(` / `seedKind ===`), or a `decision`→`gatedDecision` reference missed in Task 5.

- [ ] **Step 2: Record the rollout in the PR description**

No `push-prompts`, no `CURRICULUM_VERSION` bump. State in the PR body:

> After merge, the ~04:00 UTC scheduler recomputes `need` for the 5 ES A1 vocab
> cells (previously capped at 10) as `|uncovered approved targets|` (~20–29 each)
> and enqueues them. Coverage converges over ~1–2 nights. Verify via the vocab
> coverage grid (Spec 1 UI) or a prod SQL check that `covered / approved_targets`
> climbs toward 1.0 per umbrella. `GENERATION_PROMPT_VERSION` bumped for trace
> cohorting; the strict seed directive ships with this code deploy, NOT a
> Langfuse push.

Optional immediate spot-check (do NOT run against prod blindly): trigger one vocab cell manually and confirm the generated `expectedWord`s match uncovered curated lemmas and the reject gate drops any drift.

- [ ] **Step 3: Commit any fixes from Step 1**

```bash
git branch --show-current   # worktree-feat+vocab-generation-seeding
git add -A && git commit -m "chore(vocab): full-suite gate fixes" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage (Spec 2 design → tasks):**
- Component 1 (vocab-target seed kind: load approved targets, exclude covered, seed bare lemma, empty→undefined gate) → Tasks 2 + 3. ✅
- Component 2 (strict per-draft directive, version bump, no Langfuse push) → Task 4. ✅
- Component 3 (coverage-aware `need = |uncovered|`, stop-when-covered, fixes flat-10 cap) → Task 6. ✅
- Component 4 (reject `expectedWord ≠ seed`, shared `normalizeWord`) → Tasks 1 + 5. ✅
- "One `normalizeWord`" invariant → Task 1 (move to shared; all four consumers import it). ✅
- Data-driven gating (presence of approved rows) → Task 3 Step 4 (`targets.length === 0 → undefined`) + Task 6 (`usingTargets`). ✅
- Rollout: no push-prompts / no CURRICULUM_VERSION bump → Task 7. ✅

**Placeholder scan:** No TBDs; every code step shows complete code. Two soft references are bounded with a concrete grep/mirror instruction (the `Db` barrel export in Task 6 Step 3; the `toSQL` driver-less builder shape in Task 6 Step 4) — resolvable deterministically, not hand-waves.

**Type consistency:** `normalizeWord` (Task 1) is consumed by `computeUncoveredTargetBand` (Task 2), `loadCoveredVocabWords` (Task 3), `vocabSeedMismatchReason` (Task 5), `computeVocabTargetCoverage` (Task 6) — one signature `(string) => string`. `pickTargetSeeds`/`computeUncoveredTargetBand` (Task 2) are consumed by `buildSeedWords` (Task 3) with matching shapes (`VocabTargetRow`, `{band,count,exclude}`). `seedKindFor`'s widened union `'vocab-target'` (Task 3) is consumed only in the branches added in the same task. `SEED_TARGET_MISMATCH_REASON`/`vocabSeedMismatchReason` (Task 5) match their use in `validate-and-insert.ts`. `VocabTargetCoverage` + `computeVocabTargetCoverage` (Task 6) match the scheduler wiring. Consistent.
