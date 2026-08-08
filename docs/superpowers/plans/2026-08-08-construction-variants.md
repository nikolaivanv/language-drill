# Construction Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop multi-construction grammar points collapsing onto one exemplar by rotating each cloze/translation draft through a curated set of sub-constructions, picked by deficit against each variant's share of the pool.

**Architecture:** A new `constructionVariants` field on `GrammarPoint` carries `{id, directive, share}` triples. A new pure picker (`construction-variant-seed.ts`) assigns one variant id per draft ordinal, ranked by how far that variant's live approved count sits below its fair share. `seedKindFor` routes cloze/translation cells with variants to this picker instead of the frequency band; the id is persisted as `content_json.seedWord`, and the directive is rendered into the per-draft user prompt as a strict instruction. The validation system prompt is amended so a non-prototypical draft is not scored `grammarPointMatch: false`.

**Tech Stack:** TypeScript, pnpm workspaces + Turborepo, Vitest, Drizzle ORM (Postgres/Neon), Anthropic Claude API.

## Global Constraints

- **Work in the worktree.** All paths below are relative to `/Users/seal/dev/language-drill/.claude/worktrees/construction-variants`. Use absolute paths prefixed with that root for every Edit/Write — a main-repo absolute path silently writes to the main checkout instead.
- **Branch.** Implement on `feat/construction-variants`, created off `design/construction-variants` so the spec commit rides along in the PR. **Assert the branch before every commit** (`git branch --show-current`) — the checked-out branch has been observed flipping to `main` between operations.
- **`packages/ai` must NOT import `@language-drill/db`.** It passes locally and fails CI with TS2307. Curriculum data reaches `packages/ai` only through `GenerationSpec` fields.
- **Tests go in the existing test file for that module.** Do not create orphaned test files, except where this plan explicitly says "Create".
- **Pre-push gate, from the repo root, zero failures:** `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- **Prompt versions:** editing a `*_SYSTEM_PROMPT*` constant requires bumping its matching `*_PROMPT_VERSION` to `<surface>@2026-08-08` in the same commit. Per-draft **user** prompts are not Langfuse-registered and ship with the code deploy — no version bump, no push.
- **`CURRICULUM_VERSION_ES` / `_DE` / `_TR`** bump to `'2026-08-08'` in the task that authors that language's variants (not before).
- **Cost:** the only paid step is Task 12's `eval:gen` A/B. Cap it with `--max-cost-usd 8`.

---

### Task 1: `constructionVariants` on the curriculum type

**Files:**
- Modify: `packages/shared/src/curriculum-types.ts` (add type + field to `GrammarPoint`, after `elicitationSeedValues` at ~L181)
- Modify: `packages/db/src/curriculum/index.ts` (invariants, after block 9h at ~L296)
- Test: `packages/db/src/curriculum/curriculum.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ConstructionVariant = { id: string; directive: string; share?: number }`, exported from `@language-drill/shared`; optional `GrammarPoint.constructionVariants?: readonly ConstructionVariant[]`. Tasks 2–10 all depend on these names.

- [ ] **Step 1: Write the failing invariant tests**

In `packages/db/src/curriculum/curriculum.test.ts`, add to the invariants describe block:

```ts
describe('constructionVariants invariants', () => {
  const base = {
    key: 'es-b1-test-point',
    kind: 'grammar' as const,
    name: 'Test point',
    description: 'A test point.',
    cefrLevel: 'B1',
    language: 'ES',
    examplesPositive: ['uno', 'dos'],
    examplesNegative: ['*tres'],
    commonErrors: ['an error'],
  };

  it('rejects fewer than two variants', () => {
    expect(() =>
      assertCurriculumInvariants([
        { ...base, constructionVariants: [{ id: 'only-one', directive: 'x' }] },
      ] as never),
    ).toThrow(/at least 2 constructionVariants/);
  });

  it('rejects duplicate variant ids', () => {
    expect(() =>
      assertCurriculumInvariants([
        {
          ...base,
          constructionVariants: [
            { id: 'dup', directive: 'x' },
            { id: 'dup', directive: 'y' },
          ],
        },
      ] as never),
    ).toThrow(/duplicate constructionVariant id 'dup'/);
  });

  it('rejects a non-kebab-case variant id', () => {
    expect(() =>
      assertCurriculumInvariants([
        {
          ...base,
          constructionVariants: [
            { id: 'Not Kebab', directive: 'x' },
            { id: 'fine-id', directive: 'y' },
          ],
        },
      ] as never),
    ).toThrow(/malformed constructionVariant id 'Not Kebab'/);
  });

  it('rejects an empty directive', () => {
    expect(() =>
      assertCurriculumInvariants([
        {
          ...base,
          constructionVariants: [
            { id: 'a-id', directive: '' },
            { id: 'b-id', directive: 'y' },
          ],
        },
      ] as never),
    ).toThrow(/empty directive/);
  });

  it('rejects a non-positive share', () => {
    expect(() =>
      assertCurriculumInvariants([
        {
          ...base,
          constructionVariants: [
            { id: 'a-id', directive: 'x', share: 0 },
            { id: 'b-id', directive: 'y' },
          ],
        },
      ] as never),
    ).toThrow(/share must be > 0/);
  });

  it('rejects constructionVariants on a non-grammar entry', () => {
    expect(() =>
      assertCurriculumInvariants([
        {
          ...base,
          kind: 'vocab' as const,
          constructionVariants: [
            { id: 'a-id', directive: 'x' },
            { id: 'b-id', directive: 'y' },
          ],
        },
      ] as never),
    ).toThrow(/constructionVariants but is not kind 'grammar'/);
  });

  it('rejects constructionVariants alongside selfRevealingElicitation', () => {
    expect(() =>
      assertCurriculumInvariants([
        {
          ...base,
          selfRevealingElicitation: 'digit-form' as const,
          elicitationSeedValues: ['tercero'],
          constructionVariants: [
            { id: 'a-id', directive: 'x' },
            { id: 'b-id', directive: 'y' },
          ],
        },
      ] as never),
    ).toThrow(/cannot combine constructionVariants with selfRevealingElicitation/);
  });

  it('accepts a well-formed pair', () => {
    expect(() =>
      assertCurriculumInvariants([
        {
          ...base,
          constructionVariants: [
            { id: 'hearsay-dicen-que', directive: 'x', share: 3 },
            { id: 'adversity-experiencer', directive: 'y' },
          ],
        },
      ] as never),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @language-drill/db test -- curriculum.test.ts
```

Expected: FAIL — the invariants do not exist, so `.toThrow` assertions fail with "received function did not throw".

- [ ] **Step 3: Add the type to `packages/shared/src/curriculum-types.ts`**

Above `export type GrammarPoint = Readonly<{`:

```ts
/**
 * One sub-construction of a multi-construction grammar point (e.g. the hearsay
 * `dicen que…` vs. the adversity `me robaron la cartera` readings of the ES
 * impersonal plural). Drives per-ordinal rotation for CLOZE/TRANSLATION cells:
 * without it the generator collapses the whole pool onto the point's most
 * prototypical member (43/50 `Dicen` clozes, 49/50 `dicen que` translations).
 * See docs/superpowers/specs/2026-08-08-construction-variants-design.md.
 */
export type ConstructionVariant = Readonly<{
  /** kebab-case, stable — persisted as `content_json.seedWord` and used as the
   *  coverage key, so renaming one resets that variant's measured coverage. */
  id: string;
  /** Strict prompt text naming the sub-construction, with an exemplar. Injected
   *  verbatim into the per-draft user prompt. */
  directive: string;
  /** Relative weight, default 1. The prototype keeps a plurality without
   *  owning the pool: share 3 against three share-1 variants targets 50%. */
  share?: number;
}>;
```

Then inside `GrammarPoint`, immediately after the `elicitationSeedValues` field:

```ts
  /**
   * Curated sub-construction rotation for a multi-construction point. Present
   * ⇒ CLOZE and TRANSLATION cells for this point seed from the variant pool
   * instead of the frequency band, and each draft carries a strict directive
   * naming its variant. Mutually exclusive with `selfRevealingElicitation`
   * (both claim the single seed slot). ≥2 entries, unique kebab-case ids —
   * enforced by curriculum invariant 9i. Only valid on `kind: 'grammar'`.
   */
  constructionVariants?: readonly ConstructionVariant[];
```

- [ ] **Step 4: Confirm the type is re-exported**

```bash
grep -n "curriculum-types" packages/shared/src/index.ts
```

Expected: a `export * from './curriculum-types'` (or equivalent) line already present — `ConstructionVariant` is then exported automatically. If the file instead names types explicitly, add `ConstructionVariant` to that list.

- [ ] **Step 5: Add invariant 9i to `packages/db/src/curriculum/index.ts`**

Immediately after the `9h` block (which ends with the `elicitationSeedValues but no selfRevealingElicitation` throw), insert:

```ts
    // 9i. constructionVariants — the curated sub-construction rotation pool for
    //     a multi-construction point. Only meaningful on grammar points (a
    //     vocab/dictation umbrella has no cloze/translation construction to
    //     vary), needs ≥2 entries to rotate at all, and cannot coexist with
    //     selfRevealingElicitation because both claim the single seed slot.
    if (entry.constructionVariants) {
      if (entry.kind !== 'grammar') {
        throw new Error(
          `Curriculum invariant violated: '${entry.key}' has constructionVariants but is not kind 'grammar'`,
        );
      }
      if (entry.constructionVariants.length < 2) {
        throw new Error(
          `Curriculum invariant violated: '${entry.key}' needs at least 2 constructionVariants to rotate (has ${entry.constructionVariants.length})`,
        );
      }
      if (entry.selfRevealingElicitation) {
        throw new Error(
          `Curriculum invariant violated: '${entry.key}' cannot combine constructionVariants with selfRevealingElicitation — both claim the seed slot`,
        );
      }
      const seenVariantIds = new Set<string>();
      for (const variant of entry.constructionVariants) {
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(variant.id)) {
          throw new Error(
            `Curriculum invariant violated: '${entry.key}' has malformed constructionVariant id '${variant.id}' (expected kebab-case)`,
          );
        }
        if (seenVariantIds.has(variant.id)) {
          throw new Error(
            `Curriculum invariant violated: '${entry.key}' has duplicate constructionVariant id '${variant.id}'`,
          );
        }
        seenVariantIds.add(variant.id);
        if (variant.directive.trim().length === 0) {
          throw new Error(
            `Curriculum invariant violated: '${entry.key}' constructionVariant '${variant.id}' has an empty directive`,
          );
        }
        if (variant.share !== undefined && !(variant.share > 0)) {
          throw new Error(
            `Curriculum invariant violated: '${entry.key}' constructionVariant '${variant.id}' share must be > 0`,
          );
        }
      }
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @language-drill/db test -- curriculum.test.ts
pnpm --filter @language-drill/shared build
```

Expected: PASS, all 8 new tests green. The `shared` build is required because `packages/db` tests resolve `@language-drill/shared` through its `dist`.

- [ ] **Step 7: Commit**

```bash
git branch --show-current   # must print feat/construction-variants
git add packages/shared/src/curriculum-types.ts packages/db/src/curriculum/index.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "feat(curriculum): add constructionVariants field and invariant 9i"
```

---

### Task 2: The deficit-ranked variant picker (pure)

**Files:**
- Create: `packages/db/src/generation/construction-variant-seed.ts`
- Create: `packages/db/src/generation/construction-variant-seed.test.ts`

**Interfaces:**
- Consumes: `ConstructionVariant` from `@language-drill/shared` (Task 1).
- Produces: `pickVariantSeeds(opts: PickVariantSeedsOptions): string[]` where
  `PickVariantSeedsOptions = { variants: readonly ConstructionVariant[]; coverage: ReadonlyMap<string, number>; count: number }`.
  Returns exactly `count` variant ids, never `null`. Task 3 calls it.

**Why no cell target is passed:** quotas are computed against `totalCovered + count`, which self-normalizes toward the declared shares as the pool grows. `resolveCellTarget` lives in `@language-drill/lambda`, and `packages/db` must not depend on it.

**Why never `null`:** a `null` seed slot means "generate unseeded", which is exactly the free-frame collapse this work removes. When every variant is at or over quota, the picker keeps cycling in share order.

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/generation/construction-variant-seed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { pickVariantSeeds } from './construction-variant-seed';

const VARIANTS = [
  { id: 'hearsay', directive: 'hearsay', share: 3 },
  { id: 'adversity', directive: 'adversity' },
  { id: 'doorbell', directive: 'doorbell' },
  { id: 'uno-generic', directive: 'uno' },
];

describe('pickVariantSeeds', () => {
  it('returns exactly `count` slots and never null', () => {
    const out = pickVariantSeeds({
      variants: VARIANTS,
      coverage: new Map(),
      count: 6,
    });
    expect(out).toHaveLength(6);
    expect(out.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
  });

  it('starves the over-covered variant and fills the empty ones first', () => {
    // The live pool is the observed prod collapse: 43 hearsay, nothing else.
    const out = pickVariantSeeds({
      variants: VARIANTS,
      coverage: new Map([['hearsay', 43]]),
      count: 6,
    });
    expect(out).not.toContain('hearsay');
    expect(new Set(out)).toEqual(new Set(['adversity', 'doorbell', 'uno-generic']));
  });

  it('honours share when nothing is covered yet', () => {
    // shares 3/1/1/1 over 12 slots → hearsay 6, others 2 each.
    const out = pickVariantSeeds({
      variants: VARIANTS,
      coverage: new Map(),
      count: 12,
    });
    const counts = out.reduce<Record<string, number>>((acc, id) => {
      acc[id] = (acc[id] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts['hearsay']).toBe(6);
    expect(counts['adversity']).toBe(2);
    expect(counts['doorbell']).toBe(2);
    expect(counts['uno-generic']).toBe(2);
  });

  it('keeps cycling in share order when every variant is over quota', () => {
    const out = pickVariantSeeds({
      variants: VARIANTS,
      coverage: new Map([
        ['hearsay', 500],
        ['adversity', 500],
        ['doorbell', 500],
        ['uno-generic', 500],
      ]),
      count: 4,
    });
    expect(out).toHaveLength(4);
    expect(out.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
  });

  it('ignores coverage keys that are not declared variants (legacy seedWords)', () => {
    // Legacy rows carry a frequency word in seedWord, never a variant id.
    const out = pickVariantSeeds({
      variants: VARIANTS,
      coverage: new Map([['restaurante', 40], ['iglesia', 12]]),
      count: 4,
    });
    expect(new Set(out).size).toBeGreaterThan(1);
  });

  it('is deterministic for identical inputs', () => {
    const opts = { variants: VARIANTS, coverage: new Map([['hearsay', 5]]), count: 7 };
    expect(pickVariantSeeds(opts)).toEqual(pickVariantSeeds(opts));
  });

  it('returns an empty array for count 0', () => {
    expect(pickVariantSeeds({ variants: VARIANTS, coverage: new Map(), count: 0 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @language-drill/db test -- construction-variant-seed.test.ts
```

Expected: FAIL — "Failed to resolve import ./construction-variant-seed".

- [ ] **Step 3: Write the implementation**

Create `packages/db/src/generation/construction-variant-seed.ts`:

```ts
/**
 * packages/db — Deficit-ranked picker for construction-variant seeding
 * (construction variants, 2026-08-08 spec).
 *
 * Unlike `pickSeeds` / `pickTargetSeeds`, whose band entries are one-shot
 * identities excluded once used, a construction variant is a BUCKET that needs
 * many exercises. Plain exclusion would consume every variant in the first
 * batch and then stall the cell. This picker instead ranks variants by how far
 * their live approved count sits below their fair share of the pool, and
 * decrements that deficit as it assigns slots.
 *
 * Quotas are computed against `totalCovered + count` rather than an injected
 * cell target: it self-normalizes toward the declared shares as the pool grows,
 * and it keeps this module free of any dependency on `@language-drill/lambda`
 * (where `resolveCellTarget` lives).
 *
 * Pure function — no I/O. Deterministic: identical inputs, identical output.
 */

import type { ConstructionVariant } from '@language-drill/shared';

export type PickVariantSeedsOptions = {
  /** The point's declared variants, in curriculum order (ties break on it). */
  variants: readonly ConstructionVariant[];
  /** Live approved count per variant id. Unknown keys (legacy frequency-word
   *  seeds) are ignored — they belong to no variant. */
  coverage: ReadonlyMap<string, number>;
  /** Number of draft ordinals to assign. */
  count: number;
};

/**
 * One variant id per ordinal, most-starved first. NEVER returns null: an
 * unseeded slot would fall back to free generation, which is the frame collapse
 * this picker exists to remove. When every variant is at or over quota the
 * assignment keeps cycling in share order.
 */
export function pickVariantSeeds(opts: PickVariantSeedsOptions): string[] {
  const { variants, coverage, count } = opts;
  if (count <= 0 || variants.length === 0) return [];

  const totalShare = variants.reduce((sum, v) => sum + (v.share ?? 1), 0);
  // Only declared variants count toward the pool size — a legacy frequency-word
  // seedWord is not evidence that any variant is covered.
  const totalCovered = variants.reduce(
    (sum, v) => sum + (coverage.get(v.id) ?? 0),
    0,
  );
  const poolAfterBatch = totalCovered + count;

  // Remaining need per variant, floored at 0.
  const deficits = variants.map((v) => {
    const quota = (poolAfterBatch * (v.share ?? 1)) / totalShare;
    return Math.max(0, quota - (coverage.get(v.id) ?? 0));
  });

  const result: string[] = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    let best = 0;
    for (let i = 1; i < variants.length; i++) {
      // Strict `>` keeps curriculum order as the tie-break, which makes the
      // whole picker deterministic without hashing.
      if (deficits[i] > deficits[best]) best = i;
    }
    if (deficits[best] <= 0) {
      // Everything is at or over quota (a saturated cell being topped up).
      // Cycle in share order rather than emitting a null/unseeded slot.
      best = ordinal % variants.length;
    }
    result.push(variants[best].id);
    deficits[best] -= 1;
  }
  return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @language-drill/db test -- construction-variant-seed.test.ts
```

Expected: PASS, 7 tests green.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print feat/construction-variants
git add packages/db/src/generation/construction-variant-seed.ts packages/db/src/generation/construction-variant-seed.test.ts
git commit -m "feat(generation): add deficit-ranked construction-variant picker"
```

---

### Task 3: Wire the picker into the generation path

**Files:**
- Modify: `packages/db/src/generation/run-one-cell.ts` — `seedKindFor` (~L575), `buildSeedWords` (~L631), the `priorSeeds` routing (~L879), plus a new `loadVariantCoverage` beside `loadCoveredVocabWords` (~L358)
- Test: `packages/db/src/generation/run-one-cell.test.ts`

**Interfaces:**
- Consumes: `pickVariantSeeds` (Task 2), `GrammarPoint.constructionVariants` (Task 1).
- Produces: `seedKindFor` may now return `'construction-variants'`; `loadVariantCoverage(db, cell): Promise<Map<string, number>>`. Task 6 relies on nothing here; Task 7 re-implements the seeding inline for the eval harness.

**Note on `priorSeeds`:** the `'construction-variants'` kind deliberately does NOT join the `fetchPriorSeeds` exclude group. That set exists to stop one-shot identities being re-proposed; excluding a variant after one use is exactly the stall this design avoids. Coverage arrives through `loadVariantCoverage` instead.

- [ ] **Step 1: Write the failing tests**

In `packages/db/src/generation/run-one-cell.test.ts`, add:

```ts
describe('seedKindFor — construction variants', () => {
  const variants = [
    { id: 'hearsay', directive: 'hearsay' },
    { id: 'adversity', directive: 'adversity' },
  ];

  it('routes a cloze cell with variants to construction-variants', () => {
    expect(
      seedKindFor({
        language: 'ES',
        cefrLevel: 'B1',
        exerciseType: ExerciseType.CLOZE,
        grammarPoint: { kind: 'grammar', constructionVariants: variants },
      } as never),
    ).toBe('construction-variants');
  });

  it('routes a translation cell with variants to construction-variants', () => {
    expect(
      seedKindFor({
        language: 'ES',
        cefrLevel: 'B1',
        exerciseType: ExerciseType.TRANSLATION,
        grammarPoint: { kind: 'grammar', constructionVariants: variants },
      } as never),
    ).toBe('construction-variants');
  });

  it('leaves a cloze cell without variants on the frequency band', () => {
    expect(
      seedKindFor({
        language: 'ES',
        cefrLevel: 'B1',
        exerciseType: ExerciseType.CLOZE,
        grammarPoint: { kind: 'grammar' },
      } as never),
    ).toBe('frequency');
  });

  it('does not divert a conjugation cell that happens to declare variants', () => {
    expect(
      seedKindFor({
        language: 'ES',
        cefrLevel: 'B1',
        exerciseType: ExerciseType.CONJUGATION,
        grammarPoint: { kind: 'grammar', constructionVariants: variants },
      } as never),
    ).toBe('verb');
  });

  it('ignores an empty variants array', () => {
    expect(
      seedKindFor({
        language: 'ES',
        cefrLevel: 'B1',
        exerciseType: ExerciseType.CLOZE,
        grammarPoint: { kind: 'grammar', constructionVariants: [] },
      } as never),
    ).toBe('frequency');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @language-drill/db test -- run-one-cell.test.ts
```

Expected: FAIL — the first two return `'frequency'`, not `'construction-variants'`.

- [ ] **Step 3: Add the `seedKindFor` branch**

In `packages/db/src/generation/run-one-cell.ts`, extend the return type and add the branch **immediately after** the `selfRevealingElicitation` block and **before** the `'frequency'` block:

```ts
export function seedKindFor(
  cell: Cell,
): | 'frequency' | 'verb' | 'noun' | 'predicate-nominal' | 'elicitation-values'
  | 'vocab-target' | 'construction-variants' | null {
```

```ts
  if (
    (cell.exerciseType === ExerciseType.CLOZE ||
      cell.exerciseType === ExerciseType.TRANSLATION) &&
    cell.grammarPoint.constructionVariants &&
    cell.grammarPoint.constructionVariants.length > 0
  ) {
    // Multi-construction point: the SUB-CONSTRUCTION is the diversity axis, not
    // the content word. A frequency seed gets absorbed into the complement
    // (`restaurante`, `iglesia`) while the frame stays free and collapses onto
    // the prototype — 43/50 `Dicen` clozes for es-b1-impersonal-plural.
    return 'construction-variants';
  }
```

- [ ] **Step 4: Add `loadVariantCoverage`**

Immediately after `loadCoveredVocabWords` in the same file:

```ts
/**
 * Live approved count per `constructionVariants` id in this cell, read from the
 * writer-only `content_json.seedWord` field. APPROVED statuses only (matching
 * `loadCoveredVocabWords`): a flagged draft is not pool coverage. Legacy rows
 * carry a frequency word here rather than a variant id; `pickVariantSeeds`
 * ignores keys it does not recognise.
 */
export async function loadVariantCoverage(
  db: Db,
  cell: Cell,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ seed: sql<string>`content_json->>'seedWord'` })
    .from(exercises)
    .where(
      and(
        eq(exercises.language, cell.language),
        eq(exercises.difficulty, cell.cefrLevel),
        eq(exercises.type, cell.exerciseType),
        eq(exercises.grammarPointKey, cell.grammarPoint.key),
        inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']),
        sql`content_json ? 'seedWord'`,
      ),
    );
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (typeof r.seed === 'string' && r.seed.length > 0) {
      counts.set(r.seed, (counts.get(r.seed) ?? 0) + 1);
    }
  }
  return counts;
}
```

- [ ] **Step 5: Add the `buildSeedWords` branch**

In `buildSeedWords`, immediately after the `if (kind === 'vocab-target') { … }` block (before `const window = cefrRankWindow(...)`, which this branch does not need):

```ts
  if (kind === 'construction-variants') {
    // Deficit-ranked over the point's curated sub-constructions. `priorSeeds`
    // is deliberately unused: it is a one-shot exclude set, and excluding a
    // variant after a single use would stall the cell after one batch.
    const coverage = await loadVariantCoverage(db, cell);
    return pickVariantSeeds({
      variants: cell.grammarPoint.constructionVariants ?? [],
      coverage,
      count,
    });
  }
```

Add the import at the top of the file:

```ts
import { pickVariantSeeds } from './construction-variant-seed';
```

- [ ] **Step 6: Confirm the `priorSeeds` routing needs no change**

The `priorSeeds` ternary at ~L880 lists `'frequency' | 'elicitation-values' | 'vocab-target'`, then `'noun' | 'predicate-nominal'`, then `'verb'`, else `new Set<string>()`. `'construction-variants'` falls to the final `else` and gets an empty set — which is what this design wants. Verify by reading the block; make no edit.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm --filter @language-drill/db test -- run-one-cell.test.ts
pnpm --filter @language-drill/db typecheck
```

Expected: PASS, 5 new tests green, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git branch --show-current   # must print feat/construction-variants
git add packages/db/src/generation/run-one-cell.ts packages/db/src/generation/run-one-cell.test.ts
git commit -m "feat(generation): seed cloze/translation cells from construction variants"
```

---

### Task 4: The strict per-draft directive

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts` — `buildGenerationUserPrompt`'s seed-block chain (~L769–802)
- Test: `packages/ai/src/generation-prompts.test.ts`

**Interfaces:**
- Consumes: `GenerationSpec.seedWords` (already carries the variant id after Task 3), `inputs.grammarPoint.constructionVariants` (Task 1).
- Produces: no new exports. Task 7's eval harness relies on this rendering.

**No version bump and no Langfuse push in this task.** The directive lives in the per-draft **user** prompt, which is not Langfuse-registered — it ships with the code deploy. `GENERATION_SYSTEM_PROMPT_TEMPLATE` is untouched, so its byte-parity snapshot test must still pass unchanged; treat any diff there as a mistake.

- [ ] **Step 1: Write the failing tests**

In `packages/ai/src/generation-prompts.test.ts`:

```ts
describe('construction-variant directive', () => {
  const grammarPoint = {
    key: 'es-b1-impersonal-plural',
    kind: 'grammar' as const,
    name: 'Impersonal third-person plural',
    description: 'Agentless third-person plural.',
    cefrLevel: 'B1',
    language: 'ES',
    examplesPositive: ['Dicen que llueve.', 'Me robaron la cartera.'],
    examplesNegative: ['*Mi cartera fue robada.'],
    commonErrors: ['Forcing a ser-passive.'],
    constructionVariants: [
      { id: 'hearsay', directive: 'hearsay report — `dicen que…`' },
      {
        id: 'adversity',
        directive: 'a mishap the speaker suffered — `me robaron la cartera`',
      },
    ],
  };

  const baseInputs = {
    language: 'ES',
    cefrLevel: 'B1',
    grammarPoint,
    priorPoolSurfaces: undefined,
    levelScopePoints: [],
  };

  it('emits the matching variant directive for a cloze draft', () => {
    const prompt = buildGenerationUserPrompt(
      { ...baseInputs, exerciseType: ExerciseType.CLOZE } as never,
      0,
      'home',
      'adversity',
    );
    expect(prompt).toContain('a mishap the speaker suffered');
    expect(prompt).toContain('do not substitute another');
    // The loose frequency-seed wording must NOT appear — it offers an escape
    // hatch ("choose a word of similar frequency instead") that would let the
    // model discard the construction.
    expect(prompt).not.toContain('Build this exercise around the word');
  });

  it('adds the source-side clause for a translation draft', () => {
    const prompt = buildGenerationUserPrompt(
      { ...baseInputs, exerciseType: ExerciseType.TRANSLATION } as never,
      0,
      'home',
      'adversity',
    );
    expect(prompt).toContain('English source');
  });

  it('falls back to the loose frequency wording when the seed is not a variant id', () => {
    const prompt = buildGenerationUserPrompt(
      { ...baseInputs, exerciseType: ExerciseType.CLOZE } as never,
      0,
      'home',
      'restaurante',
    );
    expect(prompt).toContain('Build this exercise around the word');
  });

  it('emits no seed block when the ordinal has no seed', () => {
    const prompt = buildGenerationUserPrompt(
      { ...baseInputs, exerciseType: ExerciseType.CLOZE } as never,
      0,
      'home',
      null,
    );
    expect(prompt).not.toContain('sub-construction');
  });
});
```

If `buildGenerationUserPrompt`'s signature in this file differs, match the call shape used by the neighbouring tests in the same describe block rather than the one written above.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @language-drill/ai test -- generation-prompts.test.ts
```

Expected: FAIL — the first test finds "Build this exercise around the word" instead of the directive.

- [ ] **Step 3: Implement the branch**

In `buildGenerationUserPrompt`, above the `const seedBlock =` assignment:

```ts
  // A construction-variant seed is the variant's `id`, not a content word: look
  // up its directive so the per-draft block names the sub-construction. Only
  // cloze/translation seed this way (see `seedKindFor`).
  const constructionVariant =
    (inputs.exerciseType === ExerciseType.CLOZE ||
      inputs.exerciseType === ExerciseType.TRANSLATION) &&
    seedWord
      ? inputs.grammarPoint.constructionVariants?.find((v) => v.id === seedWord)
      : undefined;
```

Then, inside the `seedBlock` conditional chain, add this as the FIRST branch after the `!digitForm && !baseWordCue && seedWord && seedWord.length > 0` guard — i.e. before the `CONJUGATION` test:

```ts
      : constructionVariant
        ? // Strict: the sub-construction IS the diversity axis for this cell.
          // No substitution escape hatch — the loose frequency wording's
          // "choose a word of similar frequency instead" is what let the model
          // discard the frame and collapse the pool onto the prototype.
          inputs.exerciseType === ExerciseType.TRANSLATION
          ? `This exercise MUST use the following sub-construction of ${inputs.grammarPoint.name}: ${constructionVariant.directive}. Write an English source sentence that naturally elicits exactly this sub-construction — the source must not telegraph a different one, and must not lean on the point's most common pattern. Use exactly this sub-construction; do not substitute another.\n\n`
          : `This exercise MUST use the following sub-construction of ${inputs.grammarPoint.name}: ${constructionVariant.directive}. Use exactly this sub-construction; do not substitute another, and do not fall back to the point's most common pattern.\n\n`
```

Take care with the ternary chain's shape — the existing chain is `cond ? A : cond2 ? B : C`. Insert so the new branch is tested first and the existing chain becomes its `else`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @language-drill/ai test -- generation-prompts.test.ts
```

Expected: PASS — 4 new tests green, AND the pre-existing `GENERATION_SYSTEM_PROMPT_TEMPLATE` byte-parity test still green (the system template was not touched).

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print feat/construction-variants
git add packages/ai/src/generation-prompts.ts packages/ai/src/generation-prompts.test.ts
git commit -m "feat(generation): emit strict sub-construction directive per draft"
```

---

### Task 5: Mirror the contract in the validation prompt

**Files:**
- Modify: `packages/ai/src/validation-prompts.ts` — `VALIDATION_SYSTEM_PROMPT_TEMPLATE` (~L156, the `grammarPointMatch` clause) and `VALIDATION_PROMPT_VERSION` (L103)
- Test: `packages/ai/src/validation-prompts.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (the prompt already interpolates `{{grammarPointDescription}}`).
- Produces: nothing.

**Why this task exists:** a generation-side structural fix is nullified when the validate prompt still rejects the new shape. A `me robaron la cartera` or `Uno nunca sabe` draft, submitted under a point the validator reads as "Impersonal third-person plural", is a live `grammarPointMatch: false` candidate — the exact generate↔validate split that has bitten this repo before.

- [ ] **Step 1: Write the failing tests**

In `packages/ai/src/validation-prompts.test.ts`:

```ts
describe('multi-construction grammarPointMatch guidance', () => {
  it('tells the validator that any construction in the description is on-target', () => {
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain(
      'ANY construction described in the grammar-point description is on-target',
    );
  });

  it('names the failure mode it is preventing', () => {
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain(
      'not merely because it is not the point’s most common pattern',
    );
  });

  it('bumps the prompt version to today', () => {
    expect(VALIDATION_PROMPT_VERSION).toBe('validate@2026-08-08');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @language-drill/ai test -- validation-prompts.test.ts
```

Expected: FAIL on all three.

- [ ] **Step 3: Amend the `grammarPointMatch` clause**

Find the numbered item in `VALIDATION_SYSTEM_PROMPT_TEMPLATE`:

```
5. **grammarPointMatch** (boolean): does this actually test {{grammarPointName}}?
```

Append to that item, before the next numbered item:

```
   - **Multi-construction points.** Many points cover several constructions (the ES impersonal plural covers hearsay `dicen que…`, the agentless `llaman a la puerta`, the adversity `me robaron la cartera`, and the `uno + 3sg` generic; the DE purpose point covers both `um … zu` and `damit`). ANY construction described in the grammar-point description is on-target. Set grammarPointMatch=false only when the draft tests a genuinely DIFFERENT grammar-point key — never merely because it is not the point’s most common pattern, and never because the point’s name happens to quote one exemplar. A draft exercising a rarely-seen construction of the point is exactly what the pool needs; rejecting it re-collapses the pool onto the prototype.
```

Note the curly apostrophe in `point’s` — the test asserts `’`.

- [ ] **Step 4: Bump the version**

```ts
export const VALIDATION_PROMPT_VERSION = "validate@2026-08-08";
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @language-drill/ai test -- validation-prompts.test.ts
```

Expected: PASS. If a byte-parity/snapshot test for the validation template fails, update the snapshot — the template legitimately changed here.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/construction-variants
git add packages/ai/src/validation-prompts.ts packages/ai/src/validation-prompts.test.ts
git commit -m "fix(validation): treat any described construction as on-target"
```

---

### Task 6: Size the cell target to the variant count

**Files:**
- Modify: `infra/lambda/src/generation/cell-targets.ts` — `resolveCellTarget` (~L100)
- Test: `infra/lambda/src/generation/cell-targets.test.ts`

**Interfaces:**
- Consumes: `GrammarPoint.constructionVariants` (Task 1).
- Produces: `MIN_PER_VARIANT` (exported const, value `4`).

**Ordering trap:** `targetOverride` returns early and wins outright. A point that declares both a `targetOverride` and enough variants to exceed it would silently under-fill, so the guard must sit inside the override branch.

- [ ] **Step 1: Write the failing tests**

In `infra/lambda/src/generation/cell-targets.test.ts`:

```ts
describe('resolveCellTarget — construction variants', () => {
  const variantsOf = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `v-${i}`, directive: `d${i}` }));

  it('raises the target to cover MIN_PER_VARIANT per variant', () => {
    const target = resolveCellTarget({
      exerciseType: ExerciseType.CLOZE,
      cefrLevel: 'B1',
      grammarPoint: { constructionVariants: variantsOf(20) },
    } as never);
    expect(target).toBeGreaterThanOrEqual(20 * MIN_PER_VARIANT);
  });

  it('leaves the base target alone when the variant floor is lower', () => {
    const withVariants = resolveCellTarget({
      exerciseType: ExerciseType.CLOZE,
      cefrLevel: 'B1',
      grammarPoint: { constructionVariants: variantsOf(3) },
    } as never);
    const without = resolveCellTarget({
      exerciseType: ExerciseType.CLOZE,
      cefrLevel: 'B1',
      grammarPoint: {},
    } as never);
    expect(withVariants).toBe(without);
  });

  it('throws when targetOverride cannot cover the variant floor', () => {
    expect(() =>
      resolveCellTarget({
        exerciseType: ExerciseType.CLOZE,
        cefrLevel: 'B1',
        grammarPoint: { targetOverride: 6, constructionVariants: variantsOf(5) },
      } as never),
    ).toThrow(/targetOverride 6 cannot cover 5 constructionVariants/);
  });

  it('accepts a targetOverride that does cover the floor', () => {
    expect(
      resolveCellTarget({
        exerciseType: ExerciseType.CLOZE,
        cefrLevel: 'B1',
        grammarPoint: { targetOverride: 20, constructionVariants: variantsOf(5) },
      } as never),
    ).toBe(20);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @language-drill/lambda test -- cell-targets.test.ts
```

Expected: FAIL — `MIN_PER_VARIANT` is not exported, first test errors on the undefined symbol.

- [ ] **Step 3: Implement**

In `infra/lambda/src/generation/cell-targets.ts`, above `resolveCellTarget`:

```ts
/**
 * Minimum approved exercises a single construction variant should reach before
 * the cell is considered done. Four is enough for a variant to appear in a
 * learner's rotation without letting a 6-variant point balloon its cell target.
 */
export const MIN_PER_VARIANT = 4;
```

Then inside `resolveCellTarget`:

```ts
export function resolveCellTarget(cell: Cell): number {
  const variants = cell.grammarPoint.constructionVariants;
  const variantFloor = variants ? variants.length * MIN_PER_VARIANT : 0;

  const override = cell.grammarPoint.targetOverride;
  if (override !== undefined) {
    // targetOverride wins outright, so a too-small override would silently
    // starve variants that can never reach MIN_PER_VARIANT. Fail loudly at
    // authoring time instead.
    if (variants && override < variantFloor) {
      throw new Error(
        `targetOverride ${override} cannot cover ${variants.length} constructionVariants (needs >= ${variantFloor})`,
      );
    }
    return override;
  }

  const fromTable = CELL_TARGET_DEFAULTS[cell.exerciseType][cell.cefrLevel];
  const base = fromTable ?? TARGET_PER_CELL;
  const spec = cell.grammarPoint.coverageSpec;
  let maxAxisFloorSum = 0;
  if (spec) {
    for (const axis of spec.axes) {
      let sum = 0;
      for (const floor of Object.values(axis.floors)) sum += (floor as number) ?? 0;
      if (sum > maxAxisFloorSum) maxAxisFloorSum = sum;
    }
  }
  return Math.max(base, maxAxisFloorSum, variantFloor);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @language-drill/lambda test -- cell-targets.test.ts
```

Expected: PASS, 4 new tests green plus the pre-existing coverage-floor tests.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print feat/construction-variants
git add infra/lambda/src/generation/cell-targets.ts infra/lambda/src/generation/cell-targets.test.ts
git commit -m "feat(generation): size cell targets to the construction-variant floor"
```

---

### Task 7: Make `eval:gen` able to measure this

**Files:**
- Modify: `packages/ai/scripts/eval-gen-run.ts` — `makeRealArmExecutor` (~L460), `ArmStats` (~L241), `GenEvalSummary` (~L262), the stats fold (~L770), the markdown render (~L880)
- Test: `packages/ai/scripts/eval-gen-run.test.ts`

**Interfaces:**
- Consumes: `pickVariantSeeds` — but `packages/ai` may NOT import `@language-drill/db`. Copy the 30-line pure function into `packages/ai/scripts/eval-gen-run.ts` as a local helper named `pickVariantSeedsForEval`, with a comment pointing at `packages/db/src/generation/construction-variant-seed.ts` as the source of truth. Duplication is the correct call here: the alternative is a package dependency that breaks CI.
- Produces: `ArmStats.variantCounts: Record<string, number>`; `GenEvalSummary.variantDeltas: Record<string, { baseline: number; candidate: number }>`.

**Why this task is not optional:** `makeRealArmExecutor` builds its `GenerationSpec` with no `seedWords` (L469), so today every eval draft generates unseeded. Without this task an A/B on a variant point would compare two identical unseeded arms and show no movement — the run would look like a clean negative result while measuring nothing.

- [ ] **Step 1: Write the failing tests**

In `packages/ai/scripts/eval-gen-run.test.ts`:

```ts
describe('eval-gen construction-variant seeding', () => {
  const grammarPoint = {
    key: 'es-b1-impersonal-plural',
    kind: 'grammar' as const,
    name: 'Impersonal third-person plural',
    description: 'Agentless third-person plural.',
    cefrLevel: 'B1',
    language: 'ES',
    examplesPositive: ['Dicen que llueve.', 'Me robaron la cartera.'],
    examplesNegative: ['*Mi cartera fue robada.'],
    commonErrors: ['Forcing a ser-passive.'],
    constructionVariants: [
      { id: 'hearsay', directive: 'hearsay — dicen que' },
      { id: 'adversity', directive: 'adversity — me robaron' },
    ],
  };

  it('assigns a variant to every draft ordinal', () => {
    const seeds = pickVariantSeedsForEval(grammarPoint.constructionVariants, 5);
    expect(seeds).toHaveLength(5);
    expect(new Set(seeds)).toEqual(new Set(['hearsay', 'adversity']));
  });

  it('returns no seeds for a point without variants', () => {
    expect(pickVariantSeedsForEval(undefined, 5)).toBeUndefined();
  });

  it('counts realized variants per arm', () => {
    const stats = computeArmStats([
      { bucket: 'auto-approved', reasons: [], variantId: 'hearsay' },
      { bucket: 'auto-approved', reasons: [], variantId: 'adversity' },
      { bucket: 'flagged', reasons: ['ambiguous'], variantId: 'adversity' },
    ] as never, { inputTokens: 0, outputTokens: 0 } as never);
    expect(stats.variantCounts).toEqual({ hearsay: 1, adversity: 2 });
  });
});
```

Match `computeArmStats`'s real name and signature from the neighbouring tests in that file; the stats folder is at ~L770.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @language-drill/ai test -- eval-gen-run.test.ts
```

Expected: FAIL — `pickVariantSeedsForEval` is not defined.

- [ ] **Step 3: Add the local seeder**

In `packages/ai/scripts/eval-gen-run.ts`:

```ts
/**
 * Eval-local copy of `pickVariantSeeds`
 * (packages/db/src/generation/construction-variant-seed.ts — the source of
 * truth). Duplicated rather than imported because `packages/ai` must never
 * depend on `@language-drill/db`: that import passes locally and fails CI with
 * TS2307. The eval has no live pool, so coverage is empty and the assignment
 * reduces to a share-weighted round robin.
 */
export function pickVariantSeedsForEval(
  variants: readonly ConstructionVariant[] | undefined,
  count: number,
): string[] | undefined {
  if (!variants || variants.length === 0 || count <= 0) return undefined;
  const totalShare = variants.reduce((sum, v) => sum + (v.share ?? 1), 0);
  const deficits = variants.map((v) => (count * (v.share ?? 1)) / totalShare);
  const result: string[] = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    let best = 0;
    for (let i = 1; i < variants.length; i++) {
      if (deficits[i] > deficits[best]) best = i;
    }
    if (deficits[best] <= 0) best = ordinal % variants.length;
    result.push(variants[best].id);
    deficits[best] -= 1;
  }
  return result;
}
```

- [ ] **Step 4: Pass the seeds into the arm's `GenerationSpec`**

In `makeRealArmExecutor`, add to the spec literal (after `batchSeed`):

```ts
      seedWords: pickVariantSeedsForEval(
        grammarPoint.constructionVariants,
        draftsPerCell,
      ),
```

- [ ] **Step 5: Record the realized variant per draft**

Add `variantId?: string` to `DraftOutcome`, and in the draft loop of `makeRealArmExecutor`:

```ts
    const variantSeeds = pickVariantSeedsForEval(
      grammarPoint.constructionVariants,
      draftsPerCell,
    );
```

then when pushing each outcome, include `variantId: variantSeeds?.[index]` (the loop needs an index — convert `for (const draft of batch.drafts)` to `batch.drafts.entries()`).

Add `variantCounts: Record<string, number>` to `ArmStats` and fold it in the stats function:

```ts
  const variantCounts: Record<string, number> = {};
  for (const o of outcomes) {
    if (o.variantId) variantCounts[o.variantId] = (variantCounts[o.variantId] ?? 0) + 1;
  }
```

Add `variantDeltas: Record<string, { baseline: number; candidate: number }>` to `GenEvalSummary`, populated the same way `reasonDeltas` is, and add a markdown table row block after the approval-rate row so the spread is visible without opening the JSON.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @language-drill/ai test -- eval-gen-run.test.ts
pnpm --filter @language-drill/ai typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git branch --show-current   # must print feat/construction-variants
git add packages/ai/scripts/eval-gen-run.ts packages/ai/scripts/eval-gen-run.test.ts
git commit -m "feat(eval): seed construction variants and report per-variant spread"
```

---

### Task 8: Author the ES variants

**Files:**
- Modify: `packages/db/src/curriculum/es.ts` — 13 entries + `CURRICULUM_VERSION_ES` (L180) + the changelog comment block above it
- Test: `packages/db/src/curriculum/curriculum.test.ts` (existing invariant suite covers the new data)

**Interfaces:**
- Consumes: `ConstructionVariant` (Task 1), `MIN_PER_VARIANT` semantics (Task 6 — keep variant counts ≤ 12 so cell targets stay sane).
- Produces: authored curriculum data. No code.

**Points to author (13):** `es-b1-impersonal-plural`, `es-b1-que-vs-cual`, `es-b2-sino-adversatives`, `es-b2-comparatives-advanced`, `es-b2-consecutives-intensity`, `es-a2-por-para`, `es-b2-verbs-of-change`, `es-b1-imperative-negative-pronouns`, `es-a1-porque-para`, `es-a1-hay-estar`, `es-a1-ser-estar-basic`, `es-a1-quantifiers-muy-mucho`, `es-a1-coordination-basic`.

**Authoring rules:**
1. Every variant must already be described in the point's `description`. If it is not, the variant is out of scope — do not extend the point's syllabus here.
2. `directive` names the construction AND gives one exemplar, e.g. `` `a hearsay report about something the speaker has not verified — dicen que…` ``. Keep it under 200 characters.
3. Give the genuinely most frequent construction `share: 3`; leave the rest at default 1. Do not weight a construction to zero — drop it instead.
4. 3–6 variants per point. More than 6 makes the cell target balloon (Task 6).
5. Where the point's `name` quotes a single exemplar, rewrite the name to name the category. `es-b1-impersonal-plural` is the known case: `'Impersonal third-person plural (dicen que...)'` → `'Impersonal third-person plural for unspecified agents'`. **The name is injected into the generation prompt twice, so this is load-bearing, not cosmetic.**
6. Ground each variant in Butt & Benjamin (markdown mirror at `/Users/seal/dev/language-tools/Spanish/spanish-grammar-book/spanish-grammar-md`).

- [ ] **Step 1: Author `es-b1-impersonal-plural` first as the reference case**

```ts
    constructionVariants: [
      {
        id: 'hearsay-dicen-que',
        directive:
          'a hearsay report the speaker has not verified — bare 3pl reporting verb + que (Dicen que va a llover)',
        share: 3,
      },
      {
        id: 'unknown-agent-event',
        directive:
          'an event whose agent is unknown and unnamed — 3pl with no subject (Llaman a la puerta; Te llaman por teléfono)',
      },
      {
        id: 'adversity-experiencer',
        directive:
          'a mishap the speaker suffered, with the victim as a dative/accusative clitic — 3pl where English would use a passive (Me robaron la cartera en el metro)',
      },
      {
        id: 'uno-generic',
        directive:
          'the uno/una + 3sg generic for a truth about people in general (Uno nunca sabe qué puede pasar); use una when the speaker is female',
      },
      {
        id: 'impersonal-tu',
        directive:
          'informal impersonal tú addressing people in general, not the listener (Si lo piensas, es increíble)',
      },
    ],
```

Also rewrite that entry's `name` per rule 5.

- [ ] **Step 2: Run the invariant suite**

```bash
pnpm --filter @language-drill/shared build
pnpm --filter @language-drill/db test -- curriculum.test.ts
```

Expected: PASS. A failure here names the exact rule broken (duplicate id, malformed id, empty directive).

- [ ] **Step 3: Author the remaining 12 ES points**

Apply the same rules. Re-run the command from Step 2 after each point rather than at the end — a single malformed id fails the whole suite and is cheaper to locate immediately.

- [ ] **Step 3b: Triage the two ES sub-inspection points**

`es-b1-passive-se` (100% `se` answers, four sub-uses) and `es-b2-se-middle-accidental` (84% `se`) are invisible to the collapse sweep, because on these points every answer *is* the marker. Read their approved rows directly:

```sql
SELECT content_json->>'sentence' AS stem, content_json->>'correctAnswer' AS answer
FROM exercises
WHERE grammar_point_key = 'es-b1-passive-se'
  AND review_status IN ('auto-approved','manual-approved')
ORDER BY stem;
```

Run against the prod branch via the Neon MCP (project `twilight-smoke-01114337`, branch `br-green-waterfall-ancrvpr5`). Decide per point: if the sub-uses named in the description (passive `se venden libros` / impersonal `se vive bien aquí` / `se le nota cansada` / `uno se levanta temprano`) are genuinely varied, author nothing. If one dominates, author variants under the same rules. Record the decision either way in the commit message — a "no variants needed" finding is a result, not a skip.

- [ ] **Step 4: Bump `CURRICULUM_VERSION_ES`**

```ts
export const CURRICULUM_VERSION_ES = '2026-08-08';
```

Add a matching entry to the dated changelog comment block above it, in the style of the existing `2026-07-18` entry, naming the 13 points and the reason (construction-variant rotation).

- [ ] **Step 5: Run the db suite**

```bash
pnpm --filter @language-drill/db test
```

Expected: PASS. Watch for the pinned ES-A1 regex assertions and grammar-point count tests that ES curriculum edits have broken before.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/construction-variants
git add packages/db/src/curriculum/es.ts
git commit -m "feat(curriculum): author ES construction variants for 13 collapsed points"
```

---

### Task 9: Author the DE variants

**Files:**
- Modify: `packages/db/src/curriculum/de.ts` — 9 entries + `CURRICULUM_VERSION_DE` (L70) + its changelog block
- Test: `packages/db/src/curriculum/curriculum.test.ts`

**Interfaces:**
- Consumes: everything Task 8 consumes. Follow Task 8's six authoring rules verbatim — they are not repeated here, but they are not optional.
- Produces: authored curriculum data.

**Points to author (9):** `de-b1-um-zu-damit`, `de-a2-wenn-als`, `de-a2-nicht-sondern`, `de-a2-indirect-questions`, `de-b2-adversative-connectors`, `de-b2-causal-connectors`, `de-b2-conditional-connectors`, `de-b2-modal-connectors`, `de-b2-relatives-advanced`.

Ground each variant in Durrell's Hammer (mirror at `/Users/seal/dev/language-tools/German/german-grammar-book/german-grammar-md`).

- [ ] **Step 1: Author `de-b1-um-zu-damit` first — the worst collapse in the pool (49/50 `damit`, `um … zu` never generated)**

```ts
    constructionVariants: [
      {
        id: 'um-zu-same-subject',
        directive:
          'um … zu + infinitive for a purpose whose subject is the SAME as the main clause (Ich lerne Deutsch, um in Berlin zu arbeiten) — the preferred form when subjects match',
        share: 2,
      },
      {
        id: 'damit-different-subject',
        directive:
          'damit + full clause where the subjects DIFFER, so um … zu is ungrammatical (Ich spare Geld, damit meine Kinder studieren können)',
        share: 2,
      },
      {
        id: 'damit-modal-outcome',
        directive:
          'damit + a modal verb clause expressing an enabled outcome (…, damit wir pünktlich ankommen können)',
      },
    ],
```

- [ ] **Step 2: Run the invariant suite**

```bash
pnpm --filter @language-drill/db test -- curriculum.test.ts
```

Expected: PASS.

- [ ] **Step 3: Author the remaining 8 DE points, re-running Step 2 after each**

- [ ] **Step 3b: Triage the two DE sub-inspection points**

`de-b1-es-expressions` (82% `es` answers) and `de-a2-lassen` (100% `lässt`) are invisible to the sweep for the same reason as the ES pair — the answer is always the marker. Query their approved rows as in Task 8 Step 3b (prod branch via Neon MCP) and check whether the described sub-uses actually vary: for `es-expressions`, impersonal subject vs. fixed expression vs. placeholder-`es`; for `lassen`, have-something-done vs. let-someone-do vs. `Lass uns …`. Author variants only where one dominates, and record the decision either way in the commit message.

- [ ] **Step 4: Bump `CURRICULUM_VERSION_DE` to `'2026-08-08'` and add its changelog entry**

- [ ] **Step 5: Run the db suite**

```bash
pnpm --filter @language-drill/db test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/construction-variants
git add packages/db/src/curriculum/de.ts
git commit -m "feat(curriculum): author DE construction variants for 9 collapsed points"
```

---

### Task 10: Author the TR variants

**Files:**
- Modify: `packages/db/src/curriculum/tr.ts` — 4 entries + `CURRICULUM_VERSION_TR` (L191) + its changelog block
- Test: `packages/db/src/curriculum/curriculum.test.ts`

**Interfaces:**
- Consumes: Task 8's authoring rules, verbatim.
- Produces: authored curriculum data.

**Points to author (4):** `tr-a2-adversative-connectors`, `tr-a2-causal-connectors`, `tr-a2-reported-speech`, `tr-a2-gibi-kadar`.

Ground each variant in Göksel & Kerslake (mirror at `/Users/seal/dev/language-tools/Turkish/turkish-grammar-book/turkish-grammar-md`).

- [ ] **Step 1: Author `tr-a2-adversative-connectors` first (30/30 `ama` in the live pool)**

```ts
    constructionVariants: [
      {
        id: 'ama-fakat-conjoining',
        directive:
          'ama or fakat conjoining two conflicting clauses (Gezmek istiyor ama zamanı yok)',
        share: 2,
      },
      {
        id: 'ancak-yalniz-limitation',
        directive:
          'ancak or yalnız opening the sentence to introduce a limitation or drawback (Ancak bu çözüm çok pahalı)',
      },
      {
        id: 'clause-final-ama',
        directive:
          'discourse-connective ama closing the clause in speech (Okuyamadım ama.)',
      },
    ],
```

- [ ] **Step 2: Run the invariant suite**

```bash
pnpm --filter @language-drill/db test -- curriculum.test.ts
```

Expected: PASS.

- [ ] **Step 3: Author the remaining 3 TR points, re-running Step 2 after each**

- [ ] **Step 3b: Triage the TR sub-inspection point**

`tr-b1-olarak` shows 78% `olarak` answers, but `olarak` is the point's single marker, so the sweep cannot see whether its two sub-uses vary: role/capacity after a bare noun (`avukat olarak çalışıyor`) vs. adverbialising a derived adjective (`yazılı olarak`, `bilimsel olarak`). Query its approved rows as in Task 8 Step 3b and author variants only if one dominates. Record the decision in the commit message.

- [ ] **Step 4: Bump `CURRICULUM_VERSION_TR` to `'2026-08-08'` and add its changelog entry**

- [ ] **Step 5: Run the db suite**

```bash
pnpm --filter @language-drill/db test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/construction-variants
git add packages/db/src/curriculum/tr.ts
git commit -m "feat(curriculum): author TR construction variants for 4 collapsed points"
```

---

### Task 11: `--limit` for the demotion CLI

**Files:**
- Modify: `packages/db/scripts/demote-cell-pool.ts` — `DemoteArgs` (L43), `parseDemoteArgs` (L52), and the demote query in `main`
- Test: `packages/db/scripts/demote-cell-pool.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DemoteArgs.limit: number | null`.

**Why:** the repass caps a collapsed frame at N rows rather than clearing it — 43 sound `dicen que` exercises should not all be discarded and regenerated at cost. Today `--content-ilike 'Dicen que%'` demotes every match.

- [ ] **Step 1: Write the failing tests**

```ts
describe('parseDemoteArgs — limit', () => {
  const base = ['--language', 'ES', '--cefr', 'B1', '--type', 'cloze',
                '--grammar-point', 'es-b1-impersonal-plural'];

  it('defaults limit to null', () => {
    expect(parseDemoteArgs(base).limit).toBeNull();
  });

  it('parses a numeric limit', () => {
    expect(parseDemoteArgs([...base, '--limit', '28']).limit).toBe(28);
  });

  it('rejects a non-numeric limit', () => {
    expect(() => parseDemoteArgs([...base, '--limit', 'many'])).toThrow(/--limit/);
  });

  it('rejects a negative limit', () => {
    expect(() => parseDemoteArgs([...base, '--limit', '-3'])).toThrow(/--limit/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @language-drill/db test -- demote-cell-pool.test.ts
```

Expected: FAIL — `limit` is undefined, not null.

- [ ] **Step 3: Implement**

Add to `DemoteArgs`:

```ts
  /** Cap the number of rows demoted (oldest first). null = no cap. */
  limit: number | null;
```

In `parseDemoteArgs`, before the return:

```ts
  const rawLimit = get('--limit');
  let limit: number | null = null;
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`--limit must be a positive integer (got '${rawLimit}')`);
    }
    limit = parsed;
  }
```

Add `limit` to the returned object. In `main`, when `args.limit !== null`, restrict the update to the oldest `limit` matching ids — select ids with `ORDER BY created_at ASC LIMIT n` first, then demote by `inArray(exercises.id, ids)`. Oldest-first keeps the most recently generated (and so most prompt-current) rows in the pool.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @language-drill/db test -- demote-cell-pool.test.ts
```

Expected: PASS.

- [ ] **Step 5: Document the flag**

Add `--limit` to the `demote:pool` row of the command table in `CLAUDE.md`.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/construction-variants
git add packages/db/scripts/demote-cell-pool.ts packages/db/scripts/demote-cell-pool.test.ts CLAUDE.md
git commit -m "feat(cli): add --limit to demote:pool"
```

---

### Task 12: Full gate and the paid A/B

**Files:**
- Create: `packages/ai/eval-datasets/construction-variants.json` (cell dataset for the A/B)
- Modify: none (verification only)

**Interfaces:**
- Consumes: everything.
- Produces: an `eval-runs/construction-variants-2026-08-08.json` summary, quoted in the PR body.

- [ ] **Step 1: Clear the stale lambda dist**

```bash
rm -rf infra/lambda/dist
```

Compiled `infra/lambda/dist/**/*.test.js` files are picked up by the full suite and produce phantom failures.

- [ ] **Step 2: Run the full gate from the repo root**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: zero failures. If `packages/db` tests fail resolving `@language-drill/shared`, run `pnpm build` first — db tests resolve shared through its `dist`.

- [ ] **Step 3: Write the A/B cell dataset**

Create `packages/ai/eval-datasets/construction-variants.json`:

```json
[
  { "language": "ES", "cefrLevel": "B1", "exerciseType": "cloze", "grammarPointKey": "es-b1-impersonal-plural" },
  { "language": "ES", "cefrLevel": "B1", "exerciseType": "translation", "grammarPointKey": "es-b1-impersonal-plural" },
  { "language": "DE", "cefrLevel": "B1", "exerciseType": "cloze", "grammarPointKey": "de-b1-um-zu-damit" },
  { "language": "TR", "cefrLevel": "A2", "exerciseType": "cloze", "grammarPointKey": "tr-a2-adversative-connectors" }
]
```

Match the exact `CellDescriptor` field names from `packages/ai/scripts/eval-gen-run.ts:76` — correct the JSON above if they differ.

- [ ] **Step 4: Run the A/B**

```bash
pnpm --filter @language-drill/ai eval:gen \
  --baseline repo --candidate repo \
  --dataset-file eval-datasets/construction-variants.json \
  --drafts-per-cell 6 --max-cost-usd 8 \
  --runName construction-variants-2026-08-08
```

Both arms are `repo` because the change is in the **user** prompt and the curriculum, not in a swappable system-prompt source — the arms differ only in whether variants are seeded, which the candidate arm now does automatically. If both arms come out identical, that is the signal that Task 7's seeding is not actually reaching the spec; investigate before trusting the result.

- [ ] **Step 5: Read the result and decide**

Two conditions must hold, both in `eval-runs/construction-variants-2026-08-08.json`:

1. `approvalRateDelta` ≥ `-0.05` — a small dip is acceptable (rarer constructions are genuinely harder to author), a large one is not.
2. `variantDeltas` shows drafts landing on **every** declared variant, not just the prototype. This is the whole point of the change; a run where `um-zu-same-subject` is still 0 has failed even at 100% approval.

Record both numbers in the PR body. If condition 2 fails, the directive is not strict enough — strengthen the Task 4 wording and re-run before merging.

- [ ] **Step 6: Commit and open the PR**

```bash
git branch --show-current   # must print feat/construction-variants
git add packages/ai/eval-datasets/construction-variants.json
git commit -m "test(eval): add construction-variants A/B dataset"
git push -u origin feat/construction-variants
```

PR body must state: the two eval numbers, that the change **ships inert** (nightly generation is paused at `infra/bin/app.ts:54`), and that the pool repass in the spec's Rollout section runs only when the nightly is resumed.

- [ ] **Step 7: Post-merge Langfuse sync**

Only `VALIDATION_SYSTEM_PROMPT_TEMPLATE` changed, so only the validate prompt needs pushing. Run from a **fresh checkout of `main`**, never from a stale worktree — `push-prompts` syncs every drifted prompt from the current source, and a stale tree silently reverts other PRs' prompts.

```bash
PK=$(aws --region eu-central-1 secretsmanager get-secret-value \
  --secret-id language-drill/LANGFUSE_PUBLIC_KEY --query SecretString --output text)
SK=$(aws --region eu-central-1 secretsmanager get-secret-value \
  --secret-id language-drill/LANGFUSE_SECRET_KEY --query SecretString --output text)

LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai push-prompts --dry-run
```

Confirm the dry run lists **only** the validate prompt, then re-run without `--dry-run`, then verify with `bootstrap-prompts --check` (exit 0). Repeat the whole block with the `language-drill-dev/` secret prefix for dev.

---

## Notes for the reviewer

- **The mechanism is inert until the pool is repassed.** Cell targets count approved rows, so a cell sitting at 50/50 will not generate at all — the variants change nothing until demotion frees slots. The repass recipe lives in the spec's Rollout section and runs when the nightly is un-paused.
- **Task 7 is a correction to the spec.** The spec assumed `eval:gen` could measure this as-is; it cannot, because `makeRealArmExecutor` passes no `seedWords`.
- **No `GENERATION_PROMPT_VERSION` bump.** The directive is a per-draft user prompt, which is not Langfuse-registered. Bumping it would create a spurious cohort split in the Langfuse dashboards.
