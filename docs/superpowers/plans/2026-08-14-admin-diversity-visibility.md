# Admin Diversity Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the exercise pool's diversity machinery — coverage axes and floors, construction variants, curated seed pools, frequency-band seeding — to a human operator across four admin surfaces.

**Architecture:** A new pure resolver in `packages/db` answers "which mechanisms are declared for this cell" by delegating to the existing `seedKindFor` and `coverageAxesFor`. A new admin endpoint joins that declared shape to SQL-aggregated realization counts, running them through counts-based cores extracted from the existing `audit:collapse` metrics so the panel and the CLI can never disagree. The web app consumes the resolved shape through `api-client` Zod schemas and never imports `@language-drill/db` at runtime.

**Tech Stack:** TypeScript, Hono (Lambda), Drizzle ORM, Zod, TanStack Query, Next.js App Router, Tailwind, Vitest.

## Global Constraints

- **Read-only.** No endpoint in this plan writes to the database. No LLM calls anywhere in this feature.
- **`packages/ai` must NOT import `@language-drill/db`** (CI fails with TS2307). The dependency direction is `shared` ← `ai` ← `db` ← `lambda`.
- **`apps/web` must NOT import `@language-drill/db` at runtime.** Types reach the web app only through `@language-drill/api-client` Zod schemas. Precedent: `apps/web/lib/admin/langfuse.ts` duplicates `cell-key` for exactly this reason.
- **A zero is only rendered as a failure (`✗`) when its denominator proves absence.** A zero with untagged/unlabelled rows remaining renders as unknown (`⚠`). This is non-negotiable: an axis at 0 across a cell usually means missing *tags*, not missing *content*.
- **New response enums must be mirrored in the api-client Zod schema** or production throws `ZodError` at parse time.
- **Run `pnpm build` before single-package vitest runs** — `packages/db` gains new source, and single-package tests otherwise resolve a stale `db/dist`.
- Pre-push gate, from the repo root: `pnpm lint`, `pnpm typecheck`, `pnpm test` — all must pass.

---

## File Structure

**Created:**
- `packages/db/src/generation/seed-kind.ts` — the pure seed-kind gate, extracted so importers don't pull in drizzle.
- `packages/db/src/generation/diversity-mechanisms.ts` — the resolver: declared mechanisms for one cell.
- `packages/db/src/generation/diversity-mechanisms.test.ts`
- `infra/lambda/src/routes/admin-diversity.ts` — the endpoint's query + assembly logic, kept out of the already-1927-line `admin.ts`.
- `infra/lambda/src/routes/admin-diversity.test.ts`
- `packages/api-client/src/schemas/diversity.ts`
- `packages/api-client/src/hooks/useDiversity.ts`
- `apps/web/app/(admin)/admin/diversity/page.tsx`
- `apps/web/app/(admin)/admin/diversity/_components/diversity-point-row.tsx`
- `apps/web/app/(admin)/admin/diversity/_components/diversity-glossary.tsx`
- `apps/web/app/(admin)/admin/diversity/__tests__/page.test.tsx`
- `apps/web/app/(admin)/admin/diversity/_components/__tests__/diversity-point-row.test.tsx`

**Modified:**
- `packages/db/src/generation/run-one-cell.ts` — import + re-export `seedKindFor` from its new home.
- `packages/db/src/index.ts` — export the resolver and its types.
- `packages/ai/src/collapse-metrics.ts` — extract counts-based cores.
- `packages/ai/src/collapse-metrics.test.ts` — add counts-based cases.
- `infra/lambda/src/routes/admin.ts` — mount the new sub-router.
- `packages/api-client/src/index.ts` — barrel exports.
- `apps/web/components/admin/admin-nav-items.tsx` — nav entry.
- `apps/web/components/admin/__tests__/admin-nav.test.tsx`
- `apps/web/app/(admin)/admin/pool/_components/pool-cell-detail.tsx` — variants + seeds panels.
- `apps/web/app/(admin)/admin/pool/_components/__tests__/pool-cell-detail.test.tsx`
- `apps/web/app/(admin)/admin/content/_components/content-exercise-card.tsx` — tag + seed chips.
- `apps/web/app/(admin)/admin/content/_components/__tests__/content-exercise-card.test.tsx`

---

## Task 1: Extract `seedKindFor` into a pure module

Today `seedKindFor` lives in `run-one-cell.ts`, a file that imports drizzle, the Anthropic SDK, and the DB schema. The resolver in Task 2 needs only this function; importing it from `run-one-cell.ts` would drag all of that into every consumer. This task is a pure move with no behaviour change.

**Files:**
- Create: `packages/db/src/generation/seed-kind.ts`
- Modify: `packages/db/src/generation/run-one-cell.ts:609-670` (remove the function, import and re-export it)

**Interfaces:**
- Consumes: `Cell` from `./cells`, `ExerciseType` from `@language-drill/shared`.
- Produces: `seedKindFor(cell: Cell): 'frequency' | 'verb' | 'noun' | 'predicate-nominal' | 'elicitation-values' | 'vocab-target' | 'construction-variants' | null`

- [ ] **Step 1: Confirm the existing tests pass before the move**

The function already has thorough tests in `run-one-cell.test.ts` (the `seedKindFor` describes at lines 294, 419, 2057). They import from `../generation/run-one-cell`, and after this task they must still pass unchanged — that is the proof the move was faithful.

Run: `pnpm --filter @language-drill/db exec vitest run src/generation/run-one-cell.test.ts -t seedKindFor`
Expected: PASS

- [ ] **Step 2: Create the new module**

Create `packages/db/src/generation/seed-kind.ts`. Move the function body verbatim from `run-one-cell.ts:609-670` — do not alter any branch, including the 2026-08-14 `SENTENCE_CONSTRUCTION` clause. Keep the full docblock with it.

```ts
import { ExerciseType } from '@language-drill/shared';

import type { Cell } from './cells';

/**
 * Which seed band a cell draws from, or null for non-seeded types. Pure — the
 * type gate is unit-tested without a DB. cloze/translation seed at-level content
 * words; verb-morphology conjugation seeds at-or-below-level VERBS. NOMINAL-
 * inflection points (`conjugationSeedKind: 'noun'` — possessive/case/copula)
 * decline a noun, not a verb, so their conjugation cell seeds from the NOUN band
 * instead. The legacy `'none'` opts out of seeding entirely. vocab_recall seeds
 * from the curated `vocab_target` list — an umbrella with no approved targets
 * falls back to unseeded free generation. free-writing/etc. remain unseeded.
 *
 * Lives in its own module (rather than in `run-one-cell.ts`) so pure consumers
 * — `diversity-mechanisms.ts`, and through it the admin API — can import the
 * gate without pulling in drizzle, the schema, and the Anthropic SDK.
 */
export function seedKindFor(
  cell: Cell,
):
  | 'frequency'
  | 'verb'
  | 'noun'
  | 'predicate-nominal'
  | 'elicitation-values'
  | 'vocab-target'
  | 'construction-variants'
  | null {
  // ← verbatim body from run-one-cell.ts:613-670
}
```

- [ ] **Step 3: Re-point `run-one-cell.ts`**

Delete the function from `run-one-cell.ts` and add, alongside the other relative imports (near line 63, `import { pickConjugationSeeds, pickSeeds } from './seed-picker';`):

```ts
import { seedKindFor } from './seed-kind';
```

Then re-export it so every existing importer — including the ~20 assertions in `run-one-cell.test.ts` — keeps working untouched:

```ts
export { seedKindFor };
```

- [ ] **Step 4: Verify the move changed nothing**

Run: `pnpm --filter @language-drill/db exec vitest run src/generation/run-one-cell.test.ts`
Expected: PASS, same test count as Step 1.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/generation/seed-kind.ts packages/db/src/generation/run-one-cell.ts
git commit -m "refactor(db): extract seedKindFor into a pure module

The admin diversity resolver needs the seed-kind gate but not drizzle,
the schema, or the Anthropic SDK that run-one-cell.ts pulls in. Pure
move, re-exported from the old location so every importer is unchanged."
```

---

## Task 2: The diversity resolver

Answers "which diversity mechanisms are declared for this cell" without touching the database. Delegates to `seedKindFor` and `coverageAxesFor` rather than restating their precedence rules, so a future change to the seed picker cannot silently desync the panel from the generator.

**Files:**
- Create: `packages/db/src/generation/diversity-mechanisms.ts`
- Create: `packages/db/src/generation/diversity-mechanisms.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `seedKindFor` (Task 1); `Cell` from `./cells`; `coverageAxesFor`, `resolveCellTargetFor`, `type CoverageAxis` from `@language-drill/shared`; `cefrRankWindow` from `@language-drill/ai`.
- Produces: `resolveCellMechanisms(cell: Cell): DiversityMechanisms`, plus the exported types `DiversityMechanisms`, `DeclaredAxis`, `DeclaredSeed`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/generation/diversity-mechanisms.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import type { GrammarPoint } from '@language-drill/shared';

import { buildCellKey } from '../lib/cell-key';
import type { Cell } from './cells';
import { resolveCellMechanisms } from './diversity-mechanisms';

const basePoint: GrammarPoint = {
  key: 'es-b1-test',
  kind: 'grammar',
  name: 'Test point',
  description: 'A test point.',
  cefrLevel: 'B1',
  language: 'ES',
  examplesPositive: ['a', 'b'],
  examplesNegative: ['*c'],
  commonErrors: ['d'],
};

function cellOf(gp: GrammarPoint, exerciseType: ExerciseType): Cell {
  return {
    language: gp.language,
    cefrLevel: gp.cefrLevel,
    exerciseType,
    grammarPoint: gp,
    cellKey: buildCellKey({
      language: gp.language,
      cefrLevel: gp.cefrLevel,
      exerciseType,
      grammarPointKey: gp.key,
    }),
  };
}

describe('resolveCellMechanisms — seed source', () => {
  it('reports the frequency band for a plain grammar cloze cell', () => {
    const m = resolveCellMechanisms(cellOf(basePoint, ExerciseType.CLOZE));
    expect(m.seed.kind).toBe('frequency-band');
    if (m.seed.kind !== 'frequency-band') throw new Error('narrowing');
    expect(m.seed.band).toBe('content-word');
    expect(m.seed.rankMax).toBeGreaterThan(0);
  });

  it('reports the variant pool when the point declares constructionVariants', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      constructionVariants: [
        { id: 'hearsay', directive: 'Use the hearsay reading.', share: 3 },
        { id: 'adversity', directive: 'Use the adversity reading.' },
      ],
    };
    const m = resolveCellMechanisms(cellOf(gp, ExerciseType.CLOZE));
    expect(m.seed.kind).toBe('construction-variants');
    if (m.seed.kind !== 'construction-variants') throw new Error('narrowing');
    expect(m.seed.variants).toEqual([
      { id: 'hearsay', directive: 'Use the hearsay reading.', share: 3 },
      { id: 'adversity', directive: 'Use the adversity reading.', share: 1 },
    ]);
  });

  it('defaults an omitted variant share to 1', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      constructionVariants: [
        { id: 'a', directive: 'A.' },
        { id: 'b', directive: 'B.' },
      ],
    };
    const m = resolveCellMechanisms(cellOf(gp, ExerciseType.CLOZE));
    if (m.seed.kind !== 'construction-variants') throw new Error('narrowing');
    expect(m.seed.variants.map((v) => v.share)).toEqual([1, 1]);
  });

  it('routes a sentence_construction cell through the variant pool too (2026-08-14)', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      sentenceConstructionSuitable: true,
      constructionVariants: [
        { id: 'a', directive: 'A.' },
        { id: 'b', directive: 'B.' },
      ],
    };
    const m = resolveCellMechanisms(
      cellOf(gp, ExerciseType.SENTENCE_CONSTRUCTION),
    );
    expect(m.seed.kind).toBe('construction-variants');
  });

  it('reports the curated predicate pool for a predicate-nominal conjugation cell', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      key: 'tr-a1-copula',
      language: 'TR',
      cefrLevel: 'A1',
      conjugationSuitable: true,
      conjugationSeedKind: 'predicate-nominal',
      conjugationSeedWords: ['doktor', 'öğretmen', 'yorgun'],
    };
    const m = resolveCellMechanisms(cellOf(gp, ExerciseType.CONJUGATION));
    expect(m.seed).toEqual({
      kind: 'curated',
      source: 'conjugationSeedWords',
      values: ['doktor', 'öğretmen', 'yorgun'],
    });
  });

  it('reports the curated elicitation pool for a self-revealing point', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      selfRevealingElicitation: 'digit-form',
      elicitationSeedValues: ['tercero', 'doscientas'],
    };
    const m = resolveCellMechanisms(cellOf(gp, ExerciseType.CLOZE));
    expect(m.seed).toEqual({
      kind: 'curated',
      source: 'elicitationSeedValues',
      values: ['tercero', 'doscientas'],
    });
  });

  it('reports the paraphrase scenario pool for a contextual_paraphrase cell', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      key: 'es-b2-paraphrase',
      kind: 'paraphrase',
      paraphrase: { seeds: ['at the airport', 'at the doctor'] },
    };
    const m = resolveCellMechanisms(
      cellOf(gp, ExerciseType.CONTEXTUAL_PARAPHRASE),
    );
    expect(m.seed).toEqual({
      kind: 'curated',
      source: 'paraphrase.seeds',
      values: ['at the airport', 'at the doctor'],
    });
  });

  it('reports the noun band for a nominal-inflection conjugation cell', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      key: 'tr-a2-possessive',
      language: 'TR',
      cefrLevel: 'A2',
      conjugationSuitable: true,
      conjugationSeedKind: 'noun',
    };
    const m = resolveCellMechanisms(cellOf(gp, ExerciseType.CONJUGATION));
    expect(m.seed.kind).toBe('frequency-band');
    if (m.seed.kind !== 'frequency-band') throw new Error('narrowing');
    expect(m.seed.band).toBe('noun');
  });

  it('reports no seeding when conjugationSeedKind is none', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      conjugationSuitable: true,
      conjugationSeedKind: 'none',
    };
    const m = resolveCellMechanisms(cellOf(gp, ExerciseType.CONJUGATION));
    expect(m.seed).toEqual({ kind: 'none' });
  });
});

describe('resolveCellMechanisms — axes', () => {
  it('marks spec axes controlled and monitoring axes monitored', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      coverageSpec: {
        axes: [{ name: 'person', floors: { '1sg': 4, '3sg': 6 } }],
      },
    };
    const m = resolveCellMechanisms(cellOf(gp, ExerciseType.CLOZE));
    const byName = Object.fromEntries(m.axes.map((a) => [a.name, a]));
    expect(byName.person).toEqual({
      name: 'person',
      role: 'controlled',
      floors: { '1sg': 4, '3sg': 6 },
    });
    // cloze monitors polarity + sentenceType regardless of the spec
    expect(byName.polarity.role).toBe('monitored');
    expect(byName.polarity.floors).toBeUndefined();
    expect(byName.sentenceType.role).toBe('monitored');
  });

  it('returns axes in the canonical order coverageAxesFor produces', () => {
    const gp: GrammarPoint = {
      ...basePoint,
      coverageSpec: { axes: [{ name: 'person', floors: { '1sg': 2 } }] },
    };
    const m = resolveCellMechanisms(cellOf(gp, ExerciseType.CLOZE));
    expect(m.axes.map((a) => a.name)).toEqual([
      'person',
      'polarity',
      'sentenceType',
    ]);
  });
});

describe('resolveCellMechanisms — target', () => {
  it('surfaces an explicit targetOverride alongside the resolved target', () => {
    const gp: GrammarPoint = { ...basePoint, targetOverride: 12 };
    const m = resolveCellMechanisms(cellOf(gp, ExerciseType.CLOZE));
    expect(m.target).toBe(12);
    expect(m.targetOverride).toBe(12);
  });

  it('reports a null override when the target comes from the defaults table', () => {
    const m = resolveCellMechanisms(cellOf(basePoint, ExerciseType.CLOZE));
    expect(m.targetOverride).toBeNull();
    expect(m.target).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/db exec vitest run src/generation/diversity-mechanisms.test.ts`
Expected: FAIL — `Failed to resolve import "./diversity-mechanisms"`.

- [ ] **Step 3: Implement the resolver**

Create `packages/db/src/generation/diversity-mechanisms.ts`:

```ts
/**
 * The DECLARED diversity mechanisms for one cell — which coverage axes it
 * tags and which it controls with floors, and where its per-draft seed comes
 * from. Pure: no I/O, no realization counts. The admin diversity endpoint
 * joins this to SQL-aggregated realization; `audit:collapse` reads the same
 * curriculum fields through its own path.
 *
 * Deliberately delegates the two hard rules to their existing owners —
 * `seedKindFor` (the generator's own seed precedence) and `coverageAxesFor`
 * (the validator's monitoring ∪ controlled union) — so this module cannot
 * drift from what generation actually does.
 */
import { cefrRankWindow } from '@language-drill/ai';
import {
  ExerciseType,
  coverageAxesFor,
  resolveCellTargetFor,
  type CoverageAxis,
} from '@language-drill/shared';

import type { Cell } from './cells';
import { seedKindFor } from './seed-kind';

export type DeclaredAxis = {
  name: CoverageAxis;
  /** `controlled` = named by the point's `coverageSpec`, so it carries floors
   *  and the scheduler targets it. `monitored` = tagged for measurement only. */
  role: 'controlled' | 'monitored';
  /** Present iff `role === 'controlled'`. */
  floors?: Record<string, number>;
};

export type DeclaredSeed =
  | {
      kind: 'construction-variants';
      variants: Array<{ id: string; directive: string; share: number }>;
    }
  | {
      kind: 'curated';
      source:
        | 'conjugationSeedWords'
        | 'elicitationSeedValues'
        | 'paraphrase.seeds';
      values: string[];
    }
  | {
      kind: 'frequency-band';
      band: 'verb' | 'noun' | 'content-word';
      rankMax: number;
    }
  | { kind: 'vocab-target' }
  | { kind: 'none' };

export type DiversityMechanisms = {
  axes: DeclaredAxis[];
  seed: DeclaredSeed;
  target: number;
  targetOverride: number | null;
};

export function resolveCellMechanisms(cell: Cell): DiversityMechanisms {
  const gp = cell.grammarPoint;
  const spec = gp.coverageSpec;

  // Floors live on the spec; `coverageAxesFor` owns which axes appear at all.
  const floorsByAxis = new Map<CoverageAxis, Record<string, number>>();
  for (const axis of spec?.axes ?? []) {
    const floors: Record<string, number> = {};
    for (const [value, n] of Object.entries(axis.floors)) {
      if (typeof n === 'number') floors[value] = n;
    }
    floorsByAxis.set(axis.name, floors);
  }

  const axes: DeclaredAxis[] = coverageAxesFor(cell.exerciseType, spec).map(
    (name) => {
      const floors = floorsByAxis.get(name);
      return floors
        ? { name, role: 'controlled' as const, floors }
        : { name, role: 'monitored' as const };
    },
  );

  return {
    axes,
    seed: resolveSeed(cell),
    target: resolveCellTargetFor({
      exerciseType: cell.exerciseType,
      cefrLevel: cell.cefrLevel,
      grammarPoint: gp,
    }),
    targetOverride: gp.targetOverride ?? null,
  };
}

function resolveSeed(cell: Cell): DeclaredSeed {
  const gp = cell.grammarPoint;
  const kind = seedKindFor(cell);
  if (kind === null) return { kind: 'none' };

  switch (kind) {
    case 'construction-variants':
      return {
        kind: 'construction-variants',
        variants: (gp.constructionVariants ?? []).map((v) => ({
          id: v.id,
          directive: v.directive,
          share: v.share ?? 1,
        })),
      };

    case 'elicitation-values':
      // Both paths persist to `content_json.seedWord` and both are bounded
      // curated pools; only the curriculum field they draw from differs.
      return cell.exerciseType === ExerciseType.CONTEXTUAL_PARAPHRASE
        ? {
            kind: 'curated',
            source: 'paraphrase.seeds',
            values: [...(gp.paraphrase?.seeds ?? [])],
          }
        : {
            kind: 'curated',
            source: 'elicitationSeedValues',
            values: [...(gp.elicitationSeedValues ?? [])],
          };

    case 'predicate-nominal':
      return {
        kind: 'curated',
        source: 'conjugationSeedWords',
        values: [...(gp.conjugationSeedWords ?? [])],
      };

    case 'vocab-target':
      return { kind: 'vocab-target' };

    case 'noun':
    case 'verb': {
      // A curated list REPLACES the DB band for both nominal and verb
      // conjugation cells (`run-one-cell.ts` picks `conjugationSeedWords`
      // over the band when it is non-empty), so report what generation will
      // actually draw from rather than the nominal seed kind.
      const curated = gp.conjugationSeedWords;
      if (curated && curated.length > 0) {
        return {
          kind: 'curated',
          source: 'conjugationSeedWords',
          values: [...curated],
        };
      }
      return {
        kind: 'frequency-band',
        band: kind,
        rankMax: cefrRankWindow(cell.cefrLevel).rankMax,
      };
    }

    case 'frequency':
      return {
        kind: 'frequency-band',
        band: 'content-word',
        rankMax: cefrRankWindow(cell.cefrLevel).rankMax,
      };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/db exec vitest run src/generation/diversity-mechanisms.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Export from the package barrel**

In `packages/db/src/index.ts`, alongside the other `generation/` exports:

```ts
export {
  resolveCellMechanisms,
  type DiversityMechanisms,
  type DeclaredAxis,
  type DeclaredSeed,
} from './generation/diversity-mechanisms';
export { seedKindFor } from './generation/seed-kind';
```

- [ ] **Step 6: Rebuild and verify the whole db package**

Run: `pnpm build && pnpm --filter @language-drill/db test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/generation/diversity-mechanisms.ts \
        packages/db/src/generation/diversity-mechanisms.test.ts \
        packages/db/src/index.ts
git commit -m "feat(db): resolve a cell's declared diversity mechanisms

Pure resolver reporting which coverage axes a cell tags (and which the
point's coverageSpec controls, with floors) and where its per-draft seed
comes from. Delegates to seedKindFor and coverageAxesFor so it cannot
drift from what generation actually does."
```

---

## Task 3: Counts-based cores in `collapse-metrics`

`computeSpecShortfall` and `computeVariantSkew` currently scan full exercise rows. The admin endpoint has SQL counts, not rows, and must not load ~13k `content_json` blobs per request. Extract counts-based cores and have the row-scanning versions delegate, so the CLI and the panel share one implementation.

**Files:**
- Modify: `packages/ai/src/collapse-metrics.ts:176-201` (`computeSpecShortfall`), `:237-278` (`computeVariantSkew`)
- Modify: `packages/ai/src/collapse-metrics.test.ts`

**Interfaces:**
- Consumes: existing `SpecShortfall`, `VariantSkew`, `FloorShortfall`, `VariantCoverage` types; `MIN_PER_VARIANT` from `@language-drill/shared`.
- Produces:
  - `computeSpecShortfallFromCounts(gp: GrammarPoint, countsByAxis: Record<string, Record<string, number>>, approved: number, target: number): SpecShortfall | null`
  - `computeVariantSkewFromCounts(gp: GrammarPoint, countsById: Record<string, number>, unrecognizedSeedCount: number): VariantSkew | null`

- [ ] **Step 1: Write the failing tests**

Append to `packages/ai/src/collapse-metrics.test.ts`. The critical property is **equivalence** — the counts core must produce byte-identical output to the row scanner for the same data, because that equivalence is what lets the panel and the CLI agree.

```ts
describe('computeSpecShortfallFromCounts', () => {
  const gp = {
    ...pointFixture,
    coverageSpec: {
      axes: [{ name: 'person' as const, floors: { '1sg': 4, '3sg': 6 } }],
    },
  };

  it('reports a shortfall for a value under its floor', () => {
    const result = computeSpecShortfallFromCounts(
      gp,
      { person: { '1sg': 2, '3sg': 9 } },
      11,
      20,
    );
    expect(result?.shortfalls).toEqual([
      { axis: 'person', value: '1sg', floor: 4, actual: 2 },
    ]);
    expect(result?.approved).toBe(11);
    expect(result?.target).toBe(20);
    expect(result?.atTarget).toBe(false);
  });

  it('treats a value absent from the counts as zero', () => {
    const result = computeSpecShortfallFromCounts(gp, { person: {} }, 0, 20);
    expect(result?.shortfalls).toEqual([
      { axis: 'person', value: '1sg', floor: 4, actual: 0 },
      { axis: 'person', value: '3sg', floor: 6, actual: 0 },
    ]);
  });

  it('flags atTarget — the cell the scheduler will never revisit', () => {
    const result = computeSpecShortfallFromCounts(
      gp,
      { person: { '1sg': 0, '3sg': 20 } },
      20,
      20,
    );
    expect(result?.atTarget).toBe(true);
    expect(result?.shortfalls.length).toBeGreaterThan(0);
  });

  it('returns null for a point with no coverageSpec', () => {
    expect(
      computeSpecShortfallFromCounts(pointFixture, {}, 5, 20),
    ).toBeNull();
  });

  it('agrees exactly with the row-scanning version', () => {
    const rows = [
      rowWithTags({ person: '1sg' }),
      rowWithTags({ person: '1sg' }),
      rowWithTags({ person: '3sg' }),
      rowWithTags(null), // untagged — evidence for no floor
    ];
    const fromRows = computeSpecShortfall(gp, rows, 20);
    const fromCounts = computeSpecShortfallFromCounts(
      gp,
      { person: { '1sg': 2, '3sg': 1 } },
      rows.length,
      20,
    );
    expect(fromCounts).toEqual(fromRows);
  });
});

describe('computeVariantSkewFromCounts', () => {
  const gp = {
    ...pointFixture,
    constructionVariants: [
      { id: 'hearsay', directive: 'H.', share: 3 },
      { id: 'adversity', directive: 'A.' },
    ],
  };

  it('computes per-variant quota from the declared-row denominator', () => {
    const skew = computeVariantSkewFromCounts(
      gp,
      { hearsay: 30, adversity: 10 },
      0,
    );
    expect(skew?.declaredRows).toBe(40);
    expect(skew?.perVariant).toEqual([
      { id: 'hearsay', count: 30, share: 3, quota: 30 },
      { id: 'adversity', count: 10, share: 1, quota: 10 },
    ]);
    expect(skew?.overQuota).toEqual([]);
  });

  it('carries unrecognizedSeedCount through as the unlabelled denominator', () => {
    const skew = computeVariantSkewFromCounts(gp, { hearsay: 5 }, 42);
    expect(skew?.unrecognizedSeedCount).toBe(42);
    expect(skew?.declaredRows).toBe(5);
  });

  it('lists variants below MIN_PER_VARIANT as underMin', () => {
    const skew = computeVariantSkewFromCounts(
      gp,
      { hearsay: 30, adversity: 0 },
      0,
    );
    expect(skew?.underMin).toContain('adversity');
  });

  it('returns null for a point with no constructionVariants', () => {
    expect(computeVariantSkewFromCounts(pointFixture, {}, 0)).toBeNull();
  });

  it('agrees exactly with the row-scanning version', () => {
    const rows = [
      rowWithSeed('hearsay'),
      rowWithSeed('hearsay'),
      rowWithSeed('adversity'),
      rowWithSeed('restaurante'), // legacy frequency word — unrecognized
      rowWithSeed(null),
    ];
    const fromRows = computeVariantSkew(gp, rows);
    const fromCounts = computeVariantSkewFromCounts(
      gp,
      { hearsay: 2, adversity: 1 },
      2,
    );
    expect(fromCounts).toEqual(fromRows);
  });
});
```

Add these two helpers near the file's existing fixtures if it does not already have equivalents (check first — reuse the file's existing row factory if one exists rather than duplicating it):

```ts
function rowWithTags(coverageTags: CoverageTags | null): AuditRow {
  return { id: 'x', type: ExerciseType.CLOZE, content: {}, coverageTags };
}

function rowWithSeed(seedWord: string | null): AuditRow {
  return {
    id: 'x',
    type: ExerciseType.CLOZE,
    content: seedWord === null ? {} : { seedWord },
    coverageTags: null,
  };
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/ai exec vitest run src/collapse-metrics.test.ts`
Expected: FAIL — `computeSpecShortfallFromCounts is not a function`.

- [ ] **Step 3: Extract the counts cores**

In `packages/ai/src/collapse-metrics.ts`, replace the body of `computeSpecShortfall` with a delegation and add the core above it:

```ts
/**
 * Counts-based core. `countsByAxis[axis][value]` is the number of approved
 * rows whose `coverage_tags` carry that value; a value absent from the map is
 * zero. `approved` is ALL rows in the cell, tagged or not — untagged rows are
 * not evidence that a floor is met, so they inflate `approved` (and therefore
 * `atTarget`) without contributing to any value's count.
 *
 * Exists so callers holding SQL aggregates — the admin diversity endpoint —
 * get the identical verdict to the CLI without loading every row's blob.
 */
export function computeSpecShortfallFromCounts(
  gp: GrammarPoint,
  countsByAxis: Record<string, Record<string, number>>,
  approved: number,
  target: number,
): SpecShortfall | null {
  const spec = gp.coverageSpec;
  if (!spec) return null;

  const shortfalls: FloorShortfall[] = [];
  for (const axis of spec.axes) {
    const counts = countsByAxis[axis.name] ?? {};
    for (const [value, floor] of Object.entries(axis.floors)) {
      const actual = counts[value] ?? 0;
      if (actual < (floor as number)) {
        shortfalls.push({
          axis: axis.name,
          value,
          floor: floor as number,
          actual,
        });
      }
    }
  }

  return { shortfalls, approved, target, atTarget: approved >= target };
}

export function computeSpecShortfall(
  gp: GrammarPoint,
  rows: readonly AuditRow[],
  target: number,
): SpecShortfall | null {
  if (!gp.coverageSpec) return null;
  const countsByAxis: Record<string, Record<string, number>> = {};
  for (const axis of gp.coverageSpec.axes) {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      const value = r.coverageTags?.[axis.name];
      if (typeof value !== 'string') continue;
      counts[value] = (counts[value] ?? 0) + 1;
    }
    countsByAxis[axis.name] = counts;
  }
  return computeSpecShortfallFromCounts(gp, countsByAxis, rows.length, target);
}
```

Then the same treatment for the variant skew:

```ts
/**
 * Counts-based core. `countsById` holds only DECLARED variant ids;
 * `unrecognizedSeedCount` is every other approved row (null seedWord, or a
 * legacy frequency word). Keeping the two separate is the whole point: an
 * unlabelled row occupies an approved slot while contributing to no variant's
 * quota, so it is the denominator that decides whether a variant at 0 is a
 * proven absence or merely unmeasured.
 */
export function computeVariantSkewFromCounts(
  gp: GrammarPoint,
  countsById: Record<string, number>,
  unrecognizedSeedCount: number,
): VariantSkew | null {
  const variants = gp.constructionVariants;
  if (!variants || variants.length === 0) return null;

  const declaredRows = variants.reduce(
    (sum, v) => sum + (countsById[v.id] ?? 0),
    0,
  );
  const totalShare = variants.reduce((sum, v) => sum + (v.share ?? 1), 0);

  const perVariant: VariantCoverage[] = variants.map((v) => {
    const share = v.share ?? 1;
    return {
      id: v.id,
      count: countsById[v.id] ?? 0,
      share,
      quota: (declaredRows * share) / totalShare,
    };
  });

  return {
    perVariant,
    overQuota: perVariant.filter((v) => v.count > v.quota).map((v) => v.id),
    underMin: perVariant
      .filter((v) => v.count < MIN_PER_VARIANT)
      .map((v) => v.id),
    unrecognizedSeedCount,
    declaredRows,
  };
}

export function computeVariantSkew(
  gp: GrammarPoint,
  rows: readonly AuditRow[],
): VariantSkew | null {
  const variants = gp.constructionVariants;
  if (!variants || variants.length === 0) return null;

  const declared = new Set(variants.map((v) => v.id));
  const countsById: Record<string, number> = {};
  let unrecognizedSeedCount = 0;
  for (const r of rows) {
    const seed = r.content.seedWord;
    if (typeof seed === 'string' && declared.has(seed)) {
      countsById[seed] = (countsById[seed] ?? 0) + 1;
    } else {
      unrecognizedSeedCount += 1;
    }
  }
  return computeVariantSkewFromCounts(gp, countsById, unrecognizedSeedCount);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/ai exec vitest run src/collapse-metrics.test.ts`
Expected: PASS — including every pre-existing row-based test, unchanged. Those passing is the proof the delegation is faithful.

- [ ] **Step 5: Export the new functions**

Add both to `packages/ai/src/index.ts` next to the existing `collapse-metrics` exports.

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/collapse-metrics.ts packages/ai/src/collapse-metrics.test.ts packages/ai/src/index.ts
git commit -m "refactor(ai): counts-based cores for the collapse metrics

The admin diversity endpoint has SQL aggregates, not rows, and must not
load ~13k content_json blobs per request. The row-scanning versions now
delegate to the counts cores, so the panel and audit:collapse cannot
disagree. Existing row-based tests pass unchanged."
```

---

## Task 4: `GET /admin/diversity`

**Files:**
- Create: `infra/lambda/src/routes/admin-diversity.ts`
- Create: `infra/lambda/src/routes/admin-diversity.test.ts`
- Modify: `infra/lambda/src/routes/admin.ts` (mount the sub-router)

**Interfaces:**
- Consumes: `resolveCellMechanisms` (Task 2); `computeSpecShortfallFromCounts`, `computeVariantSkewFromCounts` (Task 3); `enumerateCurriculumCells`, `ALL_CURRICULA`, `buildCellKey`, `exercises` from `@language-drill/db`.
- Produces: the wire shape below, consumed verbatim by Task 5's Zod schema.

```ts
type DiversityAxisValue = { value: string; count: number; floor: number | null };
type DiversityAxis = {
  name: string;
  role: 'controlled' | 'monitored';
  values: DiversityAxisValue[];
  /** Approved rows in this cell whose coverage_tags lack this axis. > 0 means
   *  a zero on any value of this axis is UNKNOWN, not proven absent. */
  untagged: number;
};
type DiversitySeed =
  | { kind: 'construction-variants';
      variants: Array<{ id: string; directive: string; share: number; count: number; quota: number }>;
      unlabelledRows: number }
  | { kind: 'curated'; source: string; poolSize: number; usedCount: number; unused: string[] }
  | { kind: 'frequency-band'; band: string; rankMax: number; distinctSeeds: number; unlabelledRows: number }
  | { kind: 'vocab-target' }
  | { kind: 'none' };
type DiversityCell = {
  cellKey: string; type: string; level: string;
  approved: number; target: number; atTarget: boolean;
  axes: DiversityAxis[]; seed: DiversitySeed;
  /** Floors not met. Cross-reference `axes[].untagged` before believing one. */
  shortfalls: Array<{ axis: string; value: string; floor: number; actual: number }>;
};
type DiversityPoint = {
  key: string; name: string; language: string; cefrLevel: string; kind: string;
  targetOverride: number | null;
  /** Problems the denominator PROVES: a declared variant at 0 with no
   *  unlabelled rows, a floor unmet on a fully-tagged axis, or an at-target
   *  cell with unmet floors (the scheduler will never revisit it). */
  provenIssues: number;
  /** Zeros that may be a tagging gap rather than missing content. */
  unknowns: number;
  cells: DiversityCell[];
};
// response: { items: DiversityPoint[]; total: number }
```

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/routes/admin-diversity.test.ts`. Copy the mock harness header from `admin.test.ts:1-120` verbatim (the SQS mock, the `makeChain` DB chain mock, the `vi.mock('../db')` and `vi.mock('@language-drill/db')` blocks) — that harness is the established pattern in this package and diverging from it causes the auth middleware's user upsert to hit a real driver.

**Read this before staging the queue.** `db.execute` shifts `queryQueue` **synchronously at call time**, while a `db.select()` chain shifts **lazily on await**. Inside a `Promise.all`, every `execute()` therefore takes its entry before any `select()` does, regardless of argument order. Stage the queue in that order — all `execute` results first, then the `select` results — and never assume source order.

```ts
describe('GET /admin/diversity', () => {
  beforeEach(() => {
    queryQueue.length = 0;
  });

  it('reports a declared variant at zero as a PROVEN issue when every row is labelled', async () => {
    // execute() #1: coverage-tag counts (none for this cell)
    queryQueue.push([]);
    // execute() #2: seedWord counts — all 40 rows carry a declared id
    queryQueue.push([
      { cellKey: VARIANT_CELL_KEY, seed: 'hearsay', n: 31 },
      { cellKey: VARIANT_CELL_KEY, seed: 'adversity', n: 9 },
    ]);
    // execute() #3: per-cell approved totals + untagged/unlabelled denominators
    queryQueue.push([
      { cellKey: VARIANT_CELL_KEY, approved: 40, untaggedRows: 0, unlabelledRows: 0 },
    ]);

    const res = await app.request('/admin/diversity?language=ES', {
      headers: { 'x-user-id': 'admin_1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    const point = body.items.find((p) => p.key === VARIANT_POINT_KEY);
    const cell = point.cells.find((c) => c.cellKey === VARIANT_CELL_KEY);
    if (cell.seed.kind !== 'construction-variants') throw new Error('narrowing');

    const unrealized = cell.seed.variants.filter((v) => v.count === 0);
    expect(unrealized.length).toBeGreaterThan(0);
    expect(cell.seed.unlabelledRows).toBe(0);
    expect(point.provenIssues).toBeGreaterThan(0);
    expect(point.unknowns).toBe(0);
  });

  it('reports the SAME zero as an UNKNOWN when unlabelled rows remain', async () => {
    queryQueue.push([]);
    queryQueue.push([{ cellKey: VARIANT_CELL_KEY, seed: 'hearsay', n: 31 }]);
    // 9 rows carry no declared variant id — the zero is unmeasured, not absent
    queryQueue.push([
      { cellKey: VARIANT_CELL_KEY, approved: 40, untaggedRows: 0, unlabelledRows: 9 },
    ]);

    const res = await app.request('/admin/diversity?language=ES', {
      headers: { 'x-user-id': 'admin_1' },
    });
    const body = await res.json();
    const point = body.items.find((p) => p.key === VARIANT_POINT_KEY);
    const cell = point.cells.find((c) => c.cellKey === VARIANT_CELL_KEY);

    if (cell.seed.kind !== 'construction-variants') throw new Error('narrowing');
    expect(cell.seed.unlabelledRows).toBe(9);
    expect(point.unknowns).toBeGreaterThan(0);
  });

  it('reports an axis zero as UNKNOWN while rows are untagged', async () => {
    queryQueue.push([
      { cellKey: SPEC_CELL_KEY, axis: 'person', value: '1sg', n: 12 },
    ]);
    queryQueue.push([]);
    queryQueue.push([
      { cellKey: SPEC_CELL_KEY, approved: 26, untaggedRows: 14, unlabelledRows: 26 },
    ]);

    const res = await app.request('/admin/diversity?language=ES', {
      headers: { 'x-user-id': 'admin_1' },
    });
    const body = await res.json();
    const point = body.items.find((p) => p.key === SPEC_POINT_KEY);
    const cell = point.cells.find((c) => c.cellKey === SPEC_CELL_KEY);
    const personAxis = cell.axes.find((a) => a.name === 'person');

    expect(personAxis.role).toBe('controlled');
    expect(personAxis.untagged).toBe(14);
    expect(point.unknowns).toBeGreaterThan(0);
  });

  it('flags an at-target cell whose floors are unmet — the scheduler never revisits it', async () => {
    queryQueue.push([
      { cellKey: SPEC_CELL_KEY, axis: 'person', value: '3sg', n: 50 },
    ]);
    queryQueue.push([]);
    queryQueue.push([
      { cellKey: SPEC_CELL_KEY, approved: 50, untaggedRows: 0, unlabelledRows: 50 },
    ]);

    const res = await app.request('/admin/diversity?language=ES', {
      headers: { 'x-user-id': 'admin_1' },
    });
    const body = await res.json();
    const point = body.items.find((p) => p.key === SPEC_POINT_KEY);
    const cell = point.cells.find((c) => c.cellKey === SPEC_CELL_KEY);

    expect(cell.atTarget).toBe(true);
    expect(cell.shortfalls.length).toBeGreaterThan(0);
    expect(point.provenIssues).toBeGreaterThan(0);
  });

  it('restricts the response to points with problems when issuesOnly=true', async () => {
    queryQueue.push([]);
    queryQueue.push([]);
    queryQueue.push([]);

    const res = await app.request('/admin/diversity?issuesOnly=true', {
      headers: { 'x-user-id': 'admin_1' },
    });
    const body = await res.json();
    expect(
      body.items.every((p) => p.provenIssues > 0 || p.unknowns > 0),
    ).toBe(true);
  });

  it('rejects an unknown language with 400', async () => {
    const res = await app.request('/admin/diversity?language=FR', {
      headers: { 'x-user-id': 'admin_1' },
    });
    expect(res.status).toBe(400);
  });
});
```

Define `VARIANT_POINT_KEY` / `SPEC_POINT_KEY` at the top of the file by picking real points out of `ALL_CURRICULA` rather than hardcoding keys — a curriculum edit must not break this test:

```ts
const variantPoint = ALL_CURRICULA.find(
  (p) => p.language === 'ES' && (p.constructionVariants?.length ?? 0) > 0,
)!;
const VARIANT_POINT_KEY = variantPoint.key;
const VARIANT_CELL_KEY = buildCellKey({
  language: variantPoint.language,
  cefrLevel: variantPoint.cefrLevel,
  exerciseType: ExerciseType.CLOZE,
  grammarPointKey: variantPoint.key,
});

const specPoint = ALL_CURRICULA.find(
  (p) =>
    p.language === 'ES' &&
    p.coverageSpec?.axes.some((a) => a.name === 'person'),
)!;
const SPEC_POINT_KEY = specPoint.key;
const SPEC_CELL_KEY = buildCellKey({
  language: specPoint.language,
  cefrLevel: specPoint.cefrLevel,
  exerciseType: ExerciseType.CLOZE,
  grammarPointKey: specPoint.key,
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/routes/admin-diversity.test.ts`
Expected: FAIL — 404 from the unmounted route.

- [ ] **Step 3: Implement the endpoint**

Create `infra/lambda/src/routes/admin-diversity.ts`:

```ts
/**
 * GET /admin/diversity — the declared diversity mechanisms of every grammar
 * point, joined to what the approved pool actually realizes.
 *
 * Read-only and deterministic: three cell-grouped SQL aggregates, then the
 * same pure metric cores `audit:collapse` uses. No LLM calls.
 *
 * The three aggregates deliberately include the DENOMINATORS (`untaggedRows`,
 * `unlabelledRows`). Without them a zero is ambiguous — an axis at 0 across a
 * whole cell usually means missing TAGS, not missing content — and acting on
 * the wrong reading demotes sound rows.
 */
import {
  ALL_CURRICULA,
  buildCellKey,
  enumerateCurriculumCells,
  resolveCellMechanisms,
} from '@language-drill/db';
import {
  computeSpecShortfallFromCounts,
  computeVariantSkewFromCounts,
} from '@language-drill/ai';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db';
import type { Bindings, Variables } from '../types';

const DiversityQuerySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']).optional(),
  level: z.enum(['A1', 'A2', 'B1', 'B2']).optional(),
  kind: z.string().optional(),
  mechanism: z
    .enum(['variants', 'curated-seeds', 'frequency-band', 'coverage-spec', 'none'])
    .optional(),
  issuesOnly: z.coerce.boolean().optional(),
});

export const adminDiversity = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

adminDiversity.get('/admin/diversity', async (c) => {
  const parsed = DiversityQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid query parameters',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      },
      400,
    );
  }
  const { language, level, kind, mechanism, issuesOnly } = parsed.data;

  const APPROVED = sql`review_status IN ('auto-approved', 'manual-approved')`;
  // MUST be lowercased. `buildCellKey` lowercases every part, so the canonical
  // key is `es:a1:cloze:<point>`, while `exercises.language` and `difficulty`
  // store 'ES' and 'A1'. Concatenating raw yields `ES:A1:cloze:<point>`, which
  // matches no cell in the curriculum map — every cell would silently report
  // zero approved rows, zero coverage, and zero realized variants.
  const CELL_KEY = sql`LOWER(language || ':' || difficulty || ':' || type || ':' || grammar_point_key)`;

  const [tagResult, seedResult, totalResult] = await Promise.all([
    db.execute(sql`
      SELECT ${CELL_KEY} AS "cellKey",
             tag.key AS axis, tag.value AS value, COUNT(*)::int AS n
      FROM exercises
      CROSS JOIN LATERAL jsonb_each_text(coverage_tags) AS tag
      WHERE ${APPROVED} AND coverage_tags IS NOT NULL
        AND grammar_point_key IS NOT NULL
      GROUP BY 1, 2, 3
    `),
    db.execute(sql`
      SELECT ${CELL_KEY} AS "cellKey",
             content_json->>'seedWord' AS seed, COUNT(*)::int AS n
      FROM exercises
      WHERE ${APPROVED} AND grammar_point_key IS NOT NULL
        AND content_json->>'seedWord' IS NOT NULL
      GROUP BY 1, 2
    `),
    db.execute(sql`
      SELECT ${CELL_KEY} AS "cellKey",
             COUNT(*)::int AS approved,
             COUNT(*) FILTER (WHERE coverage_tags IS NULL)::int AS "untaggedRows",
             COUNT(*) FILTER (WHERE content_json->>'seedWord' IS NULL)::int AS "unlabelledRows"
      FROM exercises
      WHERE ${APPROVED} AND grammar_point_key IS NOT NULL
      GROUP BY 1
    `),
  ]);

  const tagRows = tagResult.rows as unknown as Array<{
    cellKey: string; axis: string; value: string; n: number;
  }>;
  const seedRows = seedResult.rows as unknown as Array<{
    cellKey: string; seed: string; n: number;
  }>;
  const totalRows = totalResult.rows as unknown as Array<{
    cellKey: string; approved: number; untaggedRows: number; unlabelledRows: number;
  }>;

  const tagsByCell = new Map<string, Record<string, Record<string, number>>>();
  for (const r of tagRows) {
    const byAxis = tagsByCell.get(r.cellKey) ?? {};
    const byValue = byAxis[r.axis] ?? {};
    byValue[r.value] = r.n;
    byAxis[r.axis] = byValue;
    tagsByCell.set(r.cellKey, byAxis);
  }

  const seedsByCell = new Map<string, Record<string, number>>();
  for (const r of seedRows) {
    const counts = seedsByCell.get(r.cellKey) ?? {};
    counts[r.seed] = r.n;
    seedsByCell.set(r.cellKey, counts);
  }

  const totalsByCell = new Map<
    string,
    { approved: number; untaggedRows: number; unlabelledRows: number }
  >();
  for (const r of totalRows) {
    totalsByCell.set(r.cellKey, {
      approved: r.approved,
      untaggedRows: r.untaggedRows,
      unlabelledRows: r.unlabelledRows,
    });
  }

  const cellsByPoint = new Map<string, ReturnType<typeof buildCell>[]>();
  for (const cell of enumerateCurriculumCells(ALL_CURRICULA)) {
    if (language && cell.language !== language) continue;
    if (level && cell.cefrLevel !== level) continue;
    if (kind && cell.grammarPoint.kind !== kind) continue;
    const list = cellsByPoint.get(cell.grammarPoint.key) ?? [];
    list.push(buildCell(cell));
    cellsByPoint.set(cell.grammarPoint.key, list);
  }

  function buildCell(cell: Parameters<typeof resolveCellMechanisms>[0]) {
    const key = cell.cellKey;
    const mech = resolveCellMechanisms(cell);
    const totals = totalsByCell.get(key) ?? {
      approved: 0, untaggedRows: 0, unlabelledRows: 0,
    };
    const tagCounts = tagsByCell.get(key) ?? {};
    const seedCounts = seedsByCell.get(key) ?? {};

    const shortfall = computeSpecShortfallFromCounts(
      cell.grammarPoint, tagCounts, totals.approved, mech.target,
    );

    const axes = mech.axes.map((axis) => {
      const counts = tagCounts[axis.name] ?? {};
      const values = Array.from(
        new Set([...Object.keys(counts), ...Object.keys(axis.floors ?? {})]),
      )
        .sort()
        .map((value) => ({
          value,
          count: counts[value] ?? 0,
          floor: axis.floors?.[value] ?? null,
        }));
      // Rows carrying SOME tag but not this axis are untagged for it too.
      const tagged = Object.values(counts).reduce((a, b) => a + b, 0);
      return {
        name: axis.name,
        role: axis.role,
        values,
        untagged: Math.max(0, totals.approved - tagged),
      };
    });

    return {
      cellKey: key,
      type: cell.exerciseType,
      level: cell.cefrLevel,
      approved: totals.approved,
      target: mech.target,
      atTarget: totals.approved >= mech.target,
      axes,
      seed: buildSeed(cell, mech, seedCounts, totals.unlabelledRows),
      shortfalls: shortfall?.shortfalls ?? [],
    };
  }

  function buildSeed(
    cell: Parameters<typeof resolveCellMechanisms>[0],
    mech: ReturnType<typeof resolveCellMechanisms>,
    seedCounts: Record<string, number>,
    unlabelledRows: number,
  ) {
    const seed = mech.seed;
    if (seed.kind === 'construction-variants') {
      const declared = new Set(seed.variants.map((v) => v.id));
      const declaredCounts: Record<string, number> = {};
      let unrecognized = unlabelledRows;
      for (const [id, n] of Object.entries(seedCounts)) {
        if (declared.has(id)) declaredCounts[id] = n;
        else unrecognized += n;
      }
      const skew = computeVariantSkewFromCounts(
        cell.grammarPoint, declaredCounts, unrecognized,
      );
      const byId = new Map(skew?.perVariant.map((v) => [v.id, v]) ?? []);
      return {
        kind: 'construction-variants' as const,
        variants: seed.variants.map((v) => ({
          ...v,
          count: byId.get(v.id)?.count ?? 0,
          quota: byId.get(v.id)?.quota ?? 0,
        })),
        unlabelledRows: skew?.unrecognizedSeedCount ?? unrecognized,
      };
    }
    if (seed.kind === 'curated') {
      const used = seed.values.filter((v) => (seedCounts[v] ?? 0) > 0);
      return {
        kind: 'curated' as const,
        source: seed.source,
        poolSize: seed.values.length,
        usedCount: used.length,
        unused: seed.values.filter((v) => !(seedCounts[v] ?? 0)),
      };
    }
    if (seed.kind === 'frequency-band') {
      return {
        kind: 'frequency-band' as const,
        band: seed.band,
        rankMax: seed.rankMax,
        distinctSeeds: Object.keys(seedCounts).length,
        unlabelledRows,
      };
    }
    return seed;
  }

  const items = [];
  for (const point of ALL_CURRICULA) {
    const cells = cellsByPoint.get(point.key);
    if (!cells || cells.length === 0) continue;

    let provenIssues = 0;
    let unknowns = 0;
    for (const cell of cells) {
      if (cell.seed.kind === 'construction-variants') {
        for (const v of cell.seed.variants) {
          if (v.count > 0) continue;
          if (cell.seed.unlabelledRows === 0) provenIssues += 1;
          else unknowns += 1;
        }
      }
      if (cell.seed.kind === 'curated' && cell.seed.poolSize > 0
          && cell.seed.usedCount >= cell.seed.poolSize) {
        // Bounded pool fully covered — pickSeeds returns nulls and the cell
        // silently stops generating.
        provenIssues += 1;
      }
      for (const s of cell.shortfalls) {
        const axis = cell.axes.find((a) => a.name === s.axis);
        if ((axis?.untagged ?? 0) > 0) unknowns += 1;
        else provenIssues += 1;
      }
      // At target with unmet floors: no deficit, so the scheduler never
      // revisits the cell and the floors never fire. Needs demote:pool.
      if (cell.atTarget && cell.shortfalls.length > 0) provenIssues += 1;
    }

    if (mechanism && !matchesMechanism(mechanism, point, cells)) continue;
    if (issuesOnly && provenIssues === 0 && unknowns === 0) continue;

    items.push({
      key: point.key,
      name: point.name,
      language: point.language,
      cefrLevel: point.cefrLevel,
      kind: point.kind,
      targetOverride: point.targetOverride ?? null,
      provenIssues,
      unknowns,
      cells,
    });
  }

  return c.json({ items, total: items.length });
});

function matchesMechanism(
  mechanism: string,
  point: (typeof ALL_CURRICULA)[number],
  cells: Array<{ seed: { kind: string } }>,
): boolean {
  if (mechanism === 'coverage-spec') return !!point.coverageSpec;
  if (mechanism === 'variants')
    return cells.some((c) => c.seed.kind === 'construction-variants');
  if (mechanism === 'curated-seeds')
    return cells.some((c) => c.seed.kind === 'curated');
  if (mechanism === 'frequency-band')
    return cells.some((c) => c.seed.kind === 'frequency-band');
  return cells.every((c) => c.seed.kind === 'none');
}
```

- [ ] **Step 4: Mount the sub-router**

In `infra/lambda/src/routes/admin.ts`, after the `admin.use('/admin/*', authMiddleware, adminMiddleware);` line (`:66`), mount it so it inherits the same auth gate:

```ts
import { adminDiversity } from './admin-diversity';
// …
admin.route('/', adminDiversity);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/routes/admin-diversity.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Verify the neighbouring suite still passes**

The `queryQueue` is shared module state. Confirm the pre-existing admin tests did not shift.

Run: `pnpm --filter @language-drill/lambda exec vitest run src/routes/admin.test.ts`
Expected: PASS, unchanged count.

- [ ] **Step 7: Commit**

```bash
git add infra/lambda/src/routes/admin-diversity.ts infra/lambda/src/routes/admin-diversity.test.ts infra/lambda/src/routes/admin.ts
git commit -m "feat(api): GET /admin/diversity

Declared diversity mechanisms per grammar point joined to what the
approved pool realizes. Carries the denominators (untagged rows,
unlabelled rows) so a zero can be told apart from a tagging gap, and
separates proven issues from unknowns on exactly that basis."
```

---

## Task 5: api-client schema + hook

**Files:**
- Create: `packages/api-client/src/schemas/diversity.ts`
- Create: `packages/api-client/src/hooks/useDiversity.ts`
- Modify: `packages/api-client/src/index.ts`

**Interfaces:**
- Consumes: the Task 4 wire shape.
- Produces: `useDiversity({ fetchFn, params })`, `DiversityResponseSchema`, and the types `DiversityPoint`, `DiversityCell`, `DiversityAxis`, `DiversitySeed`.

- [ ] **Step 1: Write the schema**

Create `packages/api-client/src/schemas/diversity.ts`. Every enum here must match Task 4's output exactly — a missing member throws `ZodError` in production, not a type error at build time.

```ts
import { z } from 'zod';

export const DiversityAxisSchema = z.object({
  name: z.string(),
  role: z.enum(['controlled', 'monitored']),
  values: z.array(
    z.object({
      value: z.string(),
      count: z.number(),
      floor: z.number().nullable(),
    }),
  ),
  untagged: z.number(),
});

export const DiversitySeedSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('construction-variants'),
    variants: z.array(
      z.object({
        id: z.string(),
        directive: z.string(),
        share: z.number(),
        count: z.number(),
        quota: z.number(),
      }),
    ),
    unlabelledRows: z.number(),
  }),
  z.object({
    kind: z.literal('curated'),
    source: z.string(),
    poolSize: z.number(),
    usedCount: z.number(),
    unused: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('frequency-band'),
    band: z.string(),
    rankMax: z.number(),
    distinctSeeds: z.number(),
    unlabelledRows: z.number(),
  }),
  z.object({ kind: z.literal('vocab-target') }),
  z.object({ kind: z.literal('none') }),
]);

export const DiversityCellSchema = z.object({
  cellKey: z.string(),
  type: z.string(),
  level: z.string(),
  approved: z.number(),
  target: z.number(),
  atTarget: z.boolean(),
  axes: z.array(DiversityAxisSchema),
  seed: DiversitySeedSchema,
  shortfalls: z.array(
    z.object({
      axis: z.string(),
      value: z.string(),
      floor: z.number(),
      actual: z.number(),
    }),
  ),
});

export const DiversityPointSchema = z.object({
  key: z.string(),
  name: z.string(),
  language: z.string(),
  cefrLevel: z.string(),
  kind: z.string(),
  targetOverride: z.number().nullable(),
  provenIssues: z.number(),
  unknowns: z.number(),
  cells: z.array(DiversityCellSchema),
});

export const DiversityResponseSchema = z.object({
  items: z.array(DiversityPointSchema),
  total: z.number(),
});

export type DiversityAxis = z.infer<typeof DiversityAxisSchema>;
export type DiversitySeed = z.infer<typeof DiversitySeedSchema>;
export type DiversityCell = z.infer<typeof DiversityCellSchema>;
export type DiversityPoint = z.infer<typeof DiversityPointSchema>;

export type DiversityQuery = {
  language?: string;
  level?: string;
  kind?: string;
  mechanism?: string;
  issuesOnly?: boolean;
};
```

- [ ] **Step 2: Write the hook**

Create `packages/api-client/src/hooks/useDiversity.ts`, mirroring `usePoolCell.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { buildQueryString } from '../lib/build-query-string';
import {
  DiversityResponseSchema,
  type DiversityQuery,
} from '../schemas/diversity';

export function useDiversity({
  fetchFn,
  params = {},
  enabled = true,
}: {
  fetchFn: AuthenticatedFetch;
  params?: DiversityQuery;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['admin', 'diversity', params],
    queryFn: async () => {
      const res = await fetchFn(`/admin/diversity${buildQueryString({ ...params })}`);
      const json: unknown = await res.json();
      return DiversityResponseSchema.parse(json);
    },
    enabled,
  });
}
```

- [ ] **Step 3: Export from the barrel**

In `packages/api-client/src/index.ts`, add exports for `useDiversity` and every type/schema from `schemas/diversity`, following the file's existing grouping.

- [ ] **Step 4: Verify types compile**

Run: `pnpm --filter @language-drill/api-client typecheck && pnpm --filter @language-drill/api-client test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/schemas/diversity.ts packages/api-client/src/hooks/useDiversity.ts packages/api-client/src/index.ts
git commit -m "feat(api-client): useDiversity hook + schema"
```

---

## Task 6: `/admin/diversity` page + nav

**Files:**
- Create: `apps/web/app/(admin)/admin/diversity/page.tsx`
- Create: `apps/web/app/(admin)/admin/diversity/_components/diversity-point-row.tsx`
- Create: `apps/web/app/(admin)/admin/diversity/__tests__/page.test.tsx`
- Create: `apps/web/app/(admin)/admin/diversity/_components/__tests__/diversity-point-row.test.tsx`
- Modify: `apps/web/components/admin/admin-nav-items.tsx`
- Modify: `apps/web/components/admin/__tests__/admin-nav.test.tsx`

**Interfaces:**
- Consumes: `useDiversity`, `type DiversityPoint`, `type DiversityCell` (Task 5); `Chip` from `components/ui`; `FilterSelect` from `components/admin/filter-select`.
- Produces: default-exported `DiversityPage`; named `DiversityPointRow({ point }: { point: DiversityPoint })`.

- [ ] **Step 1: Write the failing component test**

Create `apps/web/app/(admin)/admin/diversity/_components/__tests__/diversity-point-row.test.tsx`. The `✗` vs `⚠` distinction is the contract this whole feature rests on, so it gets the most tests.

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DiversityPoint } from '@language-drill/api-client';

import { DiversityPointRow } from '../diversity-point-row';

function pointWith(overrides: Partial<DiversityPoint> = {}): DiversityPoint {
  return {
    key: 'es-b1-impersonal-plural',
    name: 'Impersonal plural',
    language: 'ES',
    cefrLevel: 'B1',
    kind: 'grammar',
    targetOverride: null,
    provenIssues: 0,
    unknowns: 0,
    cells: [],
    ...overrides,
  };
}

const variantCell = (unlabelledRows: number): DiversityPoint['cells'][number] => ({
  cellKey: 'ES:B1:cloze:es-b1-impersonal-plural',
  type: 'cloze',
  level: 'B1',
  approved: 47,
  target: 50,
  atTarget: false,
  axes: [],
  seed: {
    kind: 'construction-variants',
    variants: [
      { id: 'hearsay', directive: 'H.', share: 3, count: 31, quota: 30 },
      { id: 'passive-like', directive: 'P.', share: 1, count: 0, quota: 10 },
    ],
    unlabelledRows,
  },
  shortfalls: [],
});

describe('DiversityPointRow', () => {
  it('marks a variant at zero as PROVEN absent when no rows are unlabelled', () => {
    render(
      <DiversityPointRow
        point={pointWith({ cells: [variantCell(0)], provenIssues: 1 })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /impersonal plural/i }));
    expect(screen.getByTestId('variant-passive-like')).toHaveTextContent('✗');
  });

  it('marks the SAME zero as UNKNOWN while rows remain unlabelled', () => {
    render(
      <DiversityPointRow
        point={pointWith({ cells: [variantCell(9)], unknowns: 1 })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /impersonal plural/i }));
    const chip = screen.getByTestId('variant-passive-like');
    expect(chip).toHaveTextContent('⚠');
    expect(chip).not.toHaveTextContent('✗');
    expect(screen.getByText(/9 rows unlabelled/i)).toBeInTheDocument();
  });

  it('marks an axis value at zero as UNKNOWN while rows are untagged', () => {
    const cell = {
      ...variantCell(0),
      axes: [
        {
          name: 'person',
          role: 'controlled' as const,
          values: [
            { value: '1sg', count: 12, floor: 4 },
            { value: '2pl', count: 0, floor: 2 },
          ],
          untagged: 14,
        },
      ],
      shortfalls: [{ axis: 'person', value: '2pl', floor: 2, actual: 0 }],
    };
    render(<DiversityPointRow point={pointWith({ cells: [cell], unknowns: 1 })} />);
    fireEvent.click(screen.getByRole('button', { name: /impersonal plural/i }));
    const chip = screen.getByTestId('axis-person-2pl');
    expect(chip).toHaveTextContent('⚠');
    expect(screen.getByText(/14 rows untagged/i)).toBeInTheDocument();
  });

  it('calls out an at-target cell with unmet floors as needing demote:pool', () => {
    const cell = {
      ...variantCell(0),
      approved: 50,
      atTarget: true,
      axes: [
        {
          name: 'person',
          role: 'controlled' as const,
          values: [{ value: '2pl', count: 0, floor: 2 }],
          untagged: 0,
        },
      ],
      shortfalls: [{ axis: 'person', value: '2pl', floor: 2, actual: 0 }],
    };
    render(<DiversityPointRow point={pointWith({ cells: [cell], provenIssues: 2 })} />);
    fireEvent.click(screen.getByRole('button', { name: /impersonal plural/i }));
    expect(screen.getByText(/at target/i)).toBeInTheDocument();
    expect(screen.getByText(/demote:pool/i)).toBeInTheDocument();
  });

  it('shows curated pool burn-down', () => {
    const cell = {
      ...variantCell(0),
      seed: {
        kind: 'curated' as const,
        source: 'conjugationSeedWords',
        poolSize: 12,
        usedCount: 9,
        unused: ['a', 'b', 'c'],
      },
    };
    render(<DiversityPointRow point={pointWith({ cells: [cell] })} />);
    fireEvent.click(screen.getByRole('button', { name: /impersonal plural/i }));
    expect(screen.getByText(/9 of 12 used/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/web exec vitest run app/\(admin\)/admin/diversity`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the row component**

Create `apps/web/app/(admin)/admin/diversity/_components/diversity-point-row.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { DiversityCell, DiversityPoint } from '@language-drill/api-client';

import { Chip } from '../../../../../components/ui';
import { cn } from '../../../../../lib/cn';

const chipBase =
  'inline-flex items-center rounded-pill border px-2 py-px text-[12px]';
const ok = 'border-ok-soft bg-ok-soft text-ok';
const bad = 'border-red-200 bg-red-50 text-red-700';
// Deliberately NOT the failure style: an unknown is a measurement gap, and
// styling it as a failure is what gets sound rows demoted.
const unknown = 'border-rule bg-card text-ink-soft';

export function DiversityPointRow({ point }: { point: DiversityPoint }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col gap-1 border-b border-rule py-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex flex-wrap items-center gap-2 text-left text-[13px]"
      >
        <span className="font-mono text-ink">{point.key}</span>
        <span className="text-ink">{point.name}</span>
        <span className="text-ink-soft">{point.cefrLevel}</span>
        {point.provenIssues > 0 && (
          <Chip variant="danger">✗ {point.provenIssues}</Chip>
        )}
        {point.unknowns > 0 && <Chip>⚠ {point.unknowns} unknown</Chip>}
        {point.provenIssues === 0 && point.unknowns === 0 && (
          <span className="text-[12px] text-ink-soft">— ok</span>
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-3 pl-2">
          {point.cells.map((cell) => (
            <CellPanel key={cell.cellKey} cell={cell} />
          ))}
        </div>
      )}
    </li>
  );
}

function CellPanel({ cell }: { cell: DiversityCell }) {
  return (
    <section className="flex flex-col gap-1 text-[12px]">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-mute">
        {cell.type} · {cell.level} · {cell.approved}/{cell.target}
      </h4>

      {cell.atTarget && cell.shortfalls.length > 0 && (
        <p className="text-red-700">
          At target with unmet floors — the scheduler has no deficit here, so it
          will never revisit this cell and the floors will never fire. Needs{' '}
          <code>pnpm demote:pool</code>.
        </p>
      )}

      {cell.axes.map((axis) => (
        <div key={axis.name} className="flex flex-wrap items-center gap-2">
          <span className="min-w-[88px] font-medium text-ink">
            {axis.name}
            {axis.role === 'controlled' ? '*' : ''}
          </span>
          {axis.values.map((v) => {
            const proven = v.count === 0 && v.floor !== null && axis.untagged === 0;
            const unsure = v.count === 0 && v.floor !== null && axis.untagged > 0;
            return (
              <span
                key={v.value}
                data-testid={`axis-${axis.name}-${v.value}`}
                className={cn(chipBase, proven ? bad : unsure ? unknown : ok)}
              >
                {v.value} {v.count}
                {v.floor !== null ? `/${v.floor}` : ''}
                {proven ? ' ✗' : unsure ? ' ⚠' : ' ✓'}
              </span>
            );
          })}
          {axis.untagged > 0 && (
            <span className="text-ink-soft">
              {axis.untagged} rows untagged — a zero here may be a tagging gap
            </span>
          )}
        </div>
      ))}

      <SeedPanel seed={cell.seed} />
    </section>
  );
}

function SeedPanel({ seed }: { seed: DiversityCell['seed'] }) {
  if (seed.kind === 'construction-variants') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-[88px] font-medium text-ink">variants</span>
        {seed.variants.map((v) => {
          const proven = v.count === 0 && seed.unlabelledRows === 0;
          const unsure = v.count === 0 && seed.unlabelledRows > 0;
          return (
            <span
              key={v.id}
              title={v.directive}
              data-testid={`variant-${v.id}`}
              className={cn(chipBase, proven ? bad : unsure ? unknown : ok)}
            >
              {v.id} {v.count}/{Math.round(v.quota)}
              {proven ? ' ✗' : unsure ? ' ⚠' : ' ✓'}
            </span>
          );
        })}
        {seed.unlabelledRows > 0 && (
          <span className="text-ink-soft">
            {seed.unlabelledRows} rows unlabelled (pre-#640) — a variant at zero
            here is unmeasured, not absent
          </span>
        )}
      </div>
    );
  }
  if (seed.kind === 'curated') {
    return (
      <p className="text-ink-soft">
        seeds: curated <code>{seed.source}</code> — {seed.usedCount} of{' '}
        {seed.poolSize} used
        {seed.usedCount >= seed.poolSize && seed.poolSize > 0
          ? ' — pool exhausted; this cell has stopped generating'
          : ''}
      </p>
    );
  }
  if (seed.kind === 'frequency-band') {
    return (
      <p className="text-ink-soft">
        seeds: {seed.band} band (ranks ≤ {seed.rankMax}) — {seed.distinctSeeds}{' '}
        distinct realized
      </p>
    );
  }
  if (seed.kind === 'vocab-target') {
    return <p className="text-ink-soft">seeds: curated vocab-target list</p>;
  }
  return <p className="text-ink-soft">seeds: none (unseeded cell)</p>;
}
```

If `Chip` has no `danger` variant, use `<Chip>` with the `bad` classes applied instead — check `components/ui` before assuming.

- [ ] **Step 4: Run the component test**

Run: `pnpm --filter @language-drill/web exec vitest run app/\(admin\)/admin/diversity`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the page test**

Create `apps/web/app/(admin)/admin/diversity/__tests__/page.test.tsx`, mocking `@language-drill/api-client` the way the sibling admin page tests do (check `app/(admin)/admin/curriculum/__tests__/page.test.tsx` for the established mocking shape and copy it):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockUseDiversity = vi.fn();
vi.mock('@language-drill/api-client', () => ({
  createAuthenticatedFetch: () => vi.fn(),
  useDiversity: (args: unknown) => mockUseDiversity(args),
}));
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));

import DiversityPage from '../page';

describe('DiversityPage', () => {
  it('renders a loading state', () => {
    mockUseDiversity.mockReturnValue({ isLoading: true });
    render(<DiversityPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders an error state', () => {
    mockUseDiversity.mockReturnValue({ isLoading: false, isError: true });
    render(<DiversityPage />);
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
  });

  it('lists points and shows the total', () => {
    mockUseDiversity.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        total: 1,
        items: [
          {
            key: 'es-b1-x', name: 'X', language: 'ES', cefrLevel: 'B1',
            kind: 'grammar', targetOverride: null, provenIssues: 0,
            unknowns: 0, cells: [],
          },
        ],
      },
    });
    render(<DiversityPage />);
    expect(screen.getByText('es-b1-x')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Implement the page**

Create `apps/web/app/(admin)/admin/diversity/page.tsx`, following the `curriculum/page.tsx` structure (filters via `FilterSelect`, loading/error early returns, a `{visible} of {total}` line):

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useDiversity } from '@language-drill/api-client';

import { FilterSelect } from '../../../../components/admin/filter-select';
import { DiversityGlossary } from './_components/diversity-glossary';
import { DiversityPointRow } from './_components/diversity-point-row';

const LANGUAGES = ['ES', 'DE', 'TR'];
const LEVELS = ['A1', 'A2', 'B1', 'B2'];
const MECHANISMS = ['variants', 'curated-seeds', 'frequency-band', 'coverage-spec', 'none'];

export default function DiversityPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [params, setParams] = useState<{
    language?: string; level?: string; mechanism?: string; issuesOnly?: boolean;
  }>({});
  const diversity = useDiversity({ fetchFn, params });

  const setParam = (k: 'language' | 'level' | 'mechanism', v: string) =>
    setParams((p) => ({ ...p, [k]: v || undefined }));

  if (diversity.isLoading)
    return <p className="text-[13px] text-ink-soft">Loading…</p>;
  if (diversity.isError || !diversity.data)
    return <p className="text-[13px] text-ink-soft">Failed to load diversity data.</p>;

  const { items, total } = diversity.data;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">Diversity</h1>
      <DiversityGlossary />

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect aria-label="language" value={params.language ?? ''}
          onChange={(e) => setParam('language', e.target.value)}>
          <option value="">All languages</option>
          {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
        </FilterSelect>
        <FilterSelect aria-label="level" value={params.level ?? ''}
          onChange={(e) => setParam('level', e.target.value)}>
          <option value="">All levels</option>
          {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </FilterSelect>
        <FilterSelect aria-label="mechanism" value={params.mechanism ?? ''}
          onChange={(e) => setParam('mechanism', e.target.value)}>
          <option value="">All mechanisms</option>
          {MECHANISMS.map((m) => <option key={m} value={m}>{m}</option>)}
        </FilterSelect>
        <label className="flex items-center gap-1 text-[12px] text-ink-soft">
          <input type="checkbox" aria-label="issues only"
            checked={!!params.issuesOnly}
            onChange={(e) =>
              setParams((p) => ({ ...p, issuesOnly: e.target.checked || undefined }))
            } />
          only points with issues
        </label>
      </div>

      <p className="text-[12px] text-ink-soft">{items.length} of {total}</p>

      {items.length === 0 ? (
        <p className="text-[13px] text-ink-soft">No points match.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((p) => <DiversityPointRow key={p.key} point={p} />)}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Add the nav entry**

In `apps/web/components/admin/admin-nav-items.tsx`, append to `ADMIN_NAV`:

```ts
  { href: '/admin/diversity', label: 'Diversity' },
```

Then update `apps/web/components/admin/__tests__/admin-nav.test.tsx` — if it asserts an exact list or a count, add the new entry there too.

- [ ] **Step 8: Run the web suite**

Run: `pnpm --filter @language-drill/web test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add "apps/web/app/(admin)/admin/diversity" apps/web/components/admin/admin-nav-items.tsx "apps/web/components/admin/__tests__/admin-nav.test.tsx"
git commit -m "feat(web): /admin/diversity hub

One row per grammar point, expandable to per-cell realization. A zero
renders as a failure only when its denominator proves absence; a zero
with untagged or unlabelled rows remaining renders as unknown."
```

---

## Task 7: Glossary

**Files:**
- Create: `apps/web/app/(admin)/admin/diversity/_components/diversity-glossary.tsx`

**Interfaces:**
- Consumes: nothing (static content).
- Produces: `DiversityGlossary()` — used by Task 6's page.

- [ ] **Step 1: Implement**

```tsx
'use client';

import { useState } from 'react';

/**
 * The mechanism vocabulary, in the panel rather than in CLAUDE.md. Static —
 * not generated, not fetched.
 */
export function DiversityGlossary() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-rule bg-paper-2 p-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-[12px] font-semibold uppercase tracking-wide text-ink-mute"
      >
        {open ? '▾' : '▸'} What these mechanisms do
      </button>
      {open && (
        <dl className="mt-2 flex flex-col gap-2 text-[12px] text-ink-soft">
          <div>
            <dt className="font-medium text-ink">Coverage axis</dt>
            <dd>
              A categorical dimension the validator records for every approved
              exercise (person, polarity, case…). An axis marked <code>*</code>{' '}
              is <em>controlled</em>: the point&apos;s <code>coverageSpec</code>{' '}
              declares a minimum count per value, and the scheduler steers drafts
              toward the values that are short. An unmarked axis is only
              monitored.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Construction variant</dt>
            <dd>
              A named sub-construction of a multi-construction point. Without
              them the generator collapses onto the most prototypical member.
              Each approved row records the variant it realizes in{' '}
              <code>content_json.seedWord</code>; the quota is that variant&apos;s
              fair share of the labelled rows, weighted by its declared share.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Seed source</dt>
            <dd>
              What each draft rotates over so the pool varies. Precedence:
              construction variants, then a curated pool (self-revealing target
              forms, predicate nominals, paraphrase scenarios), otherwise the
              frequency band from the vocabulary table. A curated pool is{' '}
              <strong>bounded</strong> — once the live pool covers every entry,
              seeding returns nothing and the cell silently stops generating.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Why &ldquo;at target&rdquo; is a problem</dt>
            <dd>
              The scheduler tops a cell up to its target. A cell already at
              target has no deficit, so it is never revisited — and its declared
              floors never fire, however loudly they are declared. Fixing that
              needs <code>pnpm demote:pool</code> to open headroom first.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">✗ versus ⚠</dt>
            <dd>
              <strong>✗</strong> means the denominator proves absence: every row
              in the cell is tagged (or carries a declared variant id) and the
              value still has none. <strong>⚠</strong> means rows remain untagged
              or unlabelled, so the zero may be a measurement gap rather than
              missing content. Demoting on a ⚠ destroys sound rows.
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it renders inside the page**

Run: `pnpm --filter @language-drill/web exec vitest run app/\(admin\)/admin/diversity`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(admin)/admin/diversity/_components/diversity-glossary.tsx"
git commit -m "feat(web): diversity mechanism glossary"
```

---

## Task 8: Pool cell drawer — variants + seeds panels

**Files:**
- Modify: `apps/web/app/(admin)/admin/pool/_components/pool-cell-detail.tsx:73-127`
- Modify: `apps/web/app/(admin)/admin/pool/_components/__tests__/pool-cell-detail.test.tsx`

**Interfaces:**
- Consumes: `useDiversity` (Task 5), filtered to this cell's point.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Add to `pool-cell-detail.test.tsx`, mocking `useDiversity` alongside the existing `usePoolCell` mock:

```tsx
it('shows the construction variants for the cell with realized counts', async () => {
  mockUseDiversity.mockReturnValue({
    isLoading: false, isError: false,
    data: { total: 1, items: [diversityPointFixture] },
  });
  render(<PoolCellDetail item={itemFixture} fetchFn={vi.fn()} />);
  expect(await screen.findByText(/hearsay/i)).toBeInTheDocument();
  expect(screen.getByTestId('variant-passive-like')).toHaveTextContent('✗');
});

it('names the resolved seed source', async () => {
  mockUseDiversity.mockReturnValue({
    isLoading: false, isError: false,
    data: { total: 1, items: [diversityPointFixture] },
  });
  render(<PoolCellDetail item={itemFixture} fetchFn={vi.fn()} />);
  expect(await screen.findByText(/variant pool/i)).toBeInTheDocument();
});

it('reports untagged rows next to the existing floors panel', async () => {
  // The existing "Diversity vs. floors" panel must not present a zero as a
  // failure while rows are untagged.
  mockUseDiversity.mockReturnValue({
    isLoading: false, isError: false,
    data: { total: 1, items: [untaggedPointFixture] },
  });
  render(<PoolCellDetail item={itemFixture} fetchFn={vi.fn()} />);
  expect(await screen.findByText(/rows untagged/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(admin)/admin/pool"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `pool-cell-detail.tsx`, add the hook next to the existing `usePoolCell` call:

```tsx
const diversity = useDiversity({
  fetchFn,
  params: { language: item.language, level: item.level },
});
const diversityCell = diversity.data?.items
  .find((p) => p.key === item.grammarPointKey)
  ?.cells.find((cc) => cc.type === item.type);
```

Then, after the existing "Diversity vs. floors" `<section>` (currently ending at line 127), add two sections reusing the same chip vocabulary as Task 6 — variants with `count/quota` and the `unlabelledRows` caption, and a one-line seed summary ("variant pool", "curated conjugationSeedWords — 9 of 12 used", "content-word band, ranks ≤ N"). In the existing floors panel, append the untagged caption when `diversityCell` reports `untagged > 0` for that axis, and downgrade its `✗` to `⚠` in that case — same rule as Task 6.

Add a link to the hub:

```tsx
<a
  href={`/admin/diversity?language=${item.language}&level=${item.level}`}
  className="text-[13px] font-medium text-accent-2 hover:underline"
>
  Diversity for this point →
</a>
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(admin)/admin/pool"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(admin)/admin/pool/_components"
git commit -m "feat(web): variants + seeds panels in the pool cell drawer"
```

---

## Task 9: Content card — coverage tag and seed chips

Today the card renders coverage tags as raw `JSON.stringify` (`content-exercise-card.tsx:25`) and does not surface `seedWord` at all. Both values are already on the wire; this is a rendering change only.

**Files:**
- Modify: `apps/web/app/(admin)/admin/content/_components/content-exercise-card.tsx:24-27`
- Modify: `apps/web/app/(admin)/admin/content/_components/__tests__/content-exercise-card.test.tsx`

**Interfaces:**
- Consumes: `item.coverageTags`, `item.contentJson.seedWord` from the existing `ContentExercise` type.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

```tsx
it('renders each coverage tag as its own chip', () => {
  render(
    <ContentExerciseCard
      item={{ ...itemFixture, coverageTags: { person: '1sg', polarity: 'negative' } }}
      onResolve={vi.fn()} pending={false} demoted={false}
    />,
  );
  expect(screen.getByText('person: 1sg')).toBeInTheDocument();
  expect(screen.getByText('polarity: negative')).toBeInTheDocument();
});

it('labels a declared variant id as a variant, not a seed word', () => {
  render(
    <ContentExerciseCard
      item={{
        ...itemFixture,
        grammarPointKey: 'es-b1-impersonal-plural',
        contentJson: { ...itemFixture.contentJson, seedWord: 'hearsay' },
        isVariantSeed: true,
      }}
      onResolve={vi.fn()} pending={false} demoted={false}
    />,
  );
  expect(screen.getByText('variant: hearsay')).toBeInTheDocument();
});

it('labels a frequency seed as a seed', () => {
  render(
    <ContentExerciseCard
      item={{
        ...itemFixture,
        contentJson: { ...itemFixture.contentJson, seedWord: 'okul' },
        isVariantSeed: false,
      }}
      onResolve={vi.fn()} pending={false} demoted={false}
    />,
  );
  expect(screen.getByText('seed: okul')).toBeInTheDocument();
});

it('renders nothing for an unseeded, untagged exercise', () => {
  render(
    <ContentExerciseCard
      item={{ ...itemFixture, coverageTags: null,
              contentJson: { ...itemFixture.contentJson, seedWord: undefined } }}
      onResolve={vi.fn()} pending={false} demoted={false}
    />,
  );
  expect(screen.queryByText(/^seed:/)).not.toBeInTheDocument();
});
```

`isVariantSeed` is a new optional boolean on the card's props, not on the wire type — the content page computes it by checking whether the point declares a variant with that id. Add it to the component's props signature:

```tsx
export function ContentExerciseCard({
  item, onResolve, pending, demoted, isVariantSeed = false,
}: {
  item: ContentExercise;
  onResolve: (action: 'demote' | 'reject') => void;
  pending: boolean;
  demoted: boolean;
  isVariantSeed?: boolean;
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(admin)/admin/content"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace lines 24-26 of `content-exercise-card.tsx`:

```tsx
{item.coverageTags || seedWord ? (
  <div className="flex flex-wrap gap-1">
    {Object.entries(item.coverageTags ?? {}).map(([axis, value]) => (
      <Chip key={axis}>{axis}: {String(value)}</Chip>
    ))}
    {seedWord ? (
      // A variant id and a frequency word both live in `seedWord`; labelling
      // them the same way invites reading a construction id as vocabulary.
      <Chip>{isVariantSeed ? 'variant' : 'seed'}: {seedWord}</Chip>
    ) : null}
  </div>
) : null}
```

with, above the return:

```tsx
const seedWord =
  typeof (item.contentJson as { seedWord?: unknown }).seedWord === 'string'
    ? ((item.contentJson as { seedWord: string }).seedWord)
    : null;
```

Import `Chip` from `components/ui`. In `content/page.tsx`, pass `isVariantSeed` by checking the point's declared variant ids (available from `useCurriculum`, already fetched there — if it is not, pass `false` and leave a comment rather than adding a fetch).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @language-drill/web exec vitest run "app/(admin)/admin/content"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(admin)/admin/content/_components"
git commit -m "feat(web): coverage tag + seed chips on the content card"
```

---

## Task 10: Full gate and documentation

**Files:**
- Modify: `docs/admin-panel.md` (if it exists — check first; if not, skip the doc step)

- [ ] **Step 1: Run the full pre-push gate from the repo root**

```bash
pnpm lint
pnpm typecheck
pnpm test
```
Expected: all three pass with zero failures. Do not proceed otherwise.

- [ ] **Step 2: Verify the page renders for real**

```bash
pnpm --filter @language-drill/web shoot --route /admin/diversity
```
Note: a fresh worktree has no `/.env` or `apps/web/.env` — copy both from the main checkout first, or `shoot` cannot authenticate. Confirm the screenshot in `apps/web/e2e/.shots/` shows the matrix, not an error state.

- [ ] **Step 3: Document the surface**

If `docs/admin-panel.md` exists, add a `Diversity` section: what the page answers, the `✗` vs `⚠` rule, and the fact that it is read-only and links to `/admin/pool` for actions.

- [ ] **Step 4: Commit and open the PR**

```bash
git add -A
git commit -m "docs: admin diversity panel"
gh pr create --title "feat(admin): expose exercise diversity mechanisms" --body "..."
```

---

## Self-Review

**Spec coverage:** Surface A → Tasks 6+7. Surface B → Task 8. Surface C → Task 9. Surface D → Task 7. Resolver → Task 2. Package-placement constraint → Task 1. Counts-based refactor → Task 3. API → Task 4. api-client → Task 5. All four risks from the spec are addressed: mock ordering (Task 4 Step 1), perf (no index, single scan — Task 4), Zod enum drift (Task 5 Step 1), stale `db/dist` (Global Constraints + Task 2 Step 6).

**Type consistency:** `DiversityMechanisms.seed` (Task 2, declared only) is deliberately a *different* type from the wire `DiversitySeed` (Tasks 4/5, declared + realized). The resolver has no realization data, so conflating them would be wrong. `unlabelledRows` is the wire name for what `VariantSkew` calls `unrecognizedSeedCount`; Task 4 Step 3 maps between them explicitly.

**Known follow-up, deliberately out of scope:** `apps/web/app/(admin)/admin/content/page.tsx` needs the declared variant ids to compute `isVariantSeed`. Task 9 handles the case where they are not already available by passing `false` rather than adding a fetch — a correct-but-degraded label, not a broken one.
