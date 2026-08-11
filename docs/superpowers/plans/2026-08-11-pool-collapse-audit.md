# Pool Collapse Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `pnpm audit:collapse` — a read-only CLI that measures collapse in the approved exercise pool, triages each flagged cell with one Anthropic call, and writes a JSON + markdown report naming the cell, the missing dimension, and the mechanism that fixes it.

**Architecture:** Three pure modules with no I/O (`collapse-metrics.ts`, `collapse-triage.ts` in `packages/ai/src`; `collapse-dismissals.ts` in `packages/db/src/curriculum`) plus one orchestrating CLI (`packages/ai/scripts/audit-collapse.ts`) that owns all SQL and all Anthropic calls. The metrics take the grammar point's declared config as an injected parameter, so `packages/ai/src` never imports `@language-drill/db`. A preparatory task moves the pure cell-target arithmetic from `@language-drill/lambda` into `@language-drill/shared` so the CLI can compute targets without depending on the CDK package.

**Tech Stack:** TypeScript, pnpm workspaces, Drizzle ORM (raw `sql` template queries), Vitest, `@anthropic-ai/sdk` (forced tool use), `tsx` for CLI entrypoints.

## Global Constraints

- **`packages/ai/src` MUST NOT import `@language-drill/db`.** It passes locally and fails CI with TS2307. Curriculum data is injected as plain parameters. `packages/ai/scripts/*` MAY import `db` (precedent: `propose-coverage-spec.ts`).
- **`packages/db` MUST NOT import `@language-drill/lambda`.** This is why Task 1 moves the target arithmetic into `shared`.
- **The CLI is read-only.** No `INSERT`, `UPDATE`, or `DELETE` against any table, ever. It reads `exercises` only.
- **No `CURRICULUM_VERSION_*` bump, no Langfuse push, no migration.** The triage prompt is an in-repo dev-time aid, exactly like `coverage-spec-proposal.ts` — it is NOT registered in Langfuse and must NOT be added to the `PROMPTS` manifest in `bootstrap-prompts.ts`.
- **Approved rows** always means `review_status IN ('auto-approved', 'manual-approved')`.
- **Default flag thresholds:** `minRows = 15`, `threshold = 0.65` (the PR #631 sweep values).
- **`MIN_PER_VARIANT = 4`**, imported from `@language-drill/shared` — never re-declared.
- Run `pnpm lint && pnpm typecheck && pnpm test` from the repo root before any push.
- Every commit message ends with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Work on branch `feat/pool-collapse-audit-spec` (already created; the design doc is its first commit).

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/shared/src/cell-targets.ts` | Create | `TARGET_PER_CELL`, `CELL_TARGET_DEFAULTS`, `resolveCellTargetFor()` — pure target arithmetic, moved out of lambda |
| `packages/shared/src/cell-targets.test.ts` | Create | Unit tests for the moved arithmetic |
| `packages/shared/src/index.ts` | Modify | Re-export the new module |
| `infra/lambda/src/generation/cell-targets.ts` | Modify | Becomes a thin delegate; keeps `GIVE_UP_MIN_ATTEMPTS` |
| `infra/lambda/src/generation/scheduler-decision.ts:44` | Modify | `TARGET_PER_CELL` becomes a re-export from `shared` |
| `packages/ai/src/collapse-metrics.ts` | Create | Signals 1–3. Pure, no I/O, no `db` import |
| `packages/ai/src/collapse-metrics.test.ts` | Create | Fixture-driven unit tests for every metric |
| `packages/ai/src/collapse-triage.ts` | Create | Triage prompt, forced tool, pure parser, `triageCell()` |
| `packages/ai/src/collapse-triage.test.ts` | Create | Parser tests (illegal verdict, mechanism/axis mismatch) |
| `packages/ai/src/index.ts` | Modify | Barrel re-exports for both new modules |
| `packages/db/src/curriculum/collapse-dismissals.ts` | Create | Committed dismissals ledger |
| `packages/db/src/curriculum/index.ts` | Modify | Re-export the ledger |
| `packages/db/src/index.ts` | Modify | Barrel re-export |
| `packages/db/src/curriculum/curriculum.test.ts` | Modify | Ledger integrity test |
| `packages/ai/scripts/audit-collapse.ts` | Create | SQL, orchestration, cost guard, report rendering |
| `packages/ai/scripts/audit-collapse.test.ts` | Create | Tests for the pure orchestration + rendering helpers |
| `packages/ai/package.json` | Modify | `audit:collapse` script |
| `package.json` | Modify | Root `audit:collapse` passthrough with `dotenv -e .env` |
| `.gitignore` | Modify | Ignore `packages/ai/audit-runs/` |
| `CLAUDE.md` | Modify | CLI table row |
| `docs/curriculum-authoring.md` | Modify | Cross-link from the retrofit section |

---

### Task 1: Move cell-target arithmetic into `@language-drill/shared`

`resolveCellTarget` currently lives in `infra/lambda/src/generation/cell-targets.ts` and takes a `Cell` from `@language-drill/db`. `packages/ai` does not (and should not) depend on `@language-drill/lambda`, but the audit CLI needs a cell's target to distinguish "below target, will self-heal" from "at target, stuck". This is the same constraint that already forced `MIN_PER_VARIANT` into `shared`.

The move keeps every existing lambda call site and test unchanged via back-compat re-exports.

**Files:**
- Create: `packages/shared/src/cell-targets.ts`
- Create: `packages/shared/src/cell-targets.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `infra/lambda/src/generation/cell-targets.ts`
- Modify: `infra/lambda/src/generation/scheduler-decision.ts:44`

**Interfaces:**
- Consumes: `ExerciseType`, `CurriculumCefrLevel`, `GrammarPoint`, `MIN_PER_VARIANT` (all already in `shared`).
- Produces: `TARGET_PER_CELL: number`, `CELL_TARGET_DEFAULTS`, `type CellTargetInput = { exerciseType: ExerciseType; cefrLevel: CurriculumCefrLevel; grammarPoint: GrammarPoint }`, `resolveCellTargetFor(cell: CellTargetInput): number`. Tasks 3 and 8 use `resolveCellTargetFor`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/cell-targets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ExerciseType } from './index';
import { CELL_TARGET_DEFAULTS, TARGET_PER_CELL, resolveCellTargetFor } from './cell-targets';
import type { GrammarPoint } from './curriculum-types';

const gp = (extra: Partial<GrammarPoint> = {}): GrammarPoint =>
  ({
    key: 'es-b1-test',
    kind: 'grammar',
    name: 'Test point',
    description: 'A test point.',
    cefrLevel: 'B1',
    language: 'ES',
    examplesPositive: ['a', 'b'],
    examplesNegative: ['*c'],
    commonErrors: ['d'],
    ...extra,
  }) as GrammarPoint;

describe('resolveCellTargetFor', () => {
  it('targetOverride wins outright, even below the variant floor', () => {
    expect(
      resolveCellTargetFor({
        exerciseType: ExerciseType.CLOZE,
        cefrLevel: 'A1',
        grammarPoint: gp({ targetOverride: 12 }),
      }),
    ).toBe(12);
  });

  it('falls back to the (type, level) table', () => {
    expect(
      resolveCellTargetFor({
        exerciseType: ExerciseType.CLOZE,
        cefrLevel: 'A1',
        grammarPoint: gp(),
      }),
    ).toBe(20);
  });

  it('falls through to TARGET_PER_CELL for an unset level', () => {
    expect(
      resolveCellTargetFor({
        exerciseType: ExerciseType.CLOZE,
        cefrLevel: 'B1',
        grammarPoint: gp(),
      }),
    ).toBe(TARGET_PER_CELL);
  });

  it('raises to the largest single-axis floor sum, never the product', () => {
    const point = gp({
      coverageSpec: {
        axes: [
          { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 } },
          { name: 'polarity', floors: { affirmative: 10, negative: 8 } },
        ],
      },
    });
    // max(base 20, person sum 25, polarity sum 18) === 25
    expect(
      resolveCellTargetFor({ exerciseType: ExerciseType.CLOZE, cefrLevel: 'A1', grammarPoint: point }),
    ).toBe(25);
  });

  it('raises to variants.length * MIN_PER_VARIANT', () => {
    const point = gp({
      constructionVariants: [
        { id: 'a', directive: 'A' },
        { id: 'b', directive: 'B' },
        { id: 'c', directive: 'C' },
        { id: 'd', directive: 'D' },
        { id: 'e', directive: 'E' },
        { id: 'f', directive: 'F' },
      ],
    });
    // max(base 20, variant floor 6*4=24) === 24
    expect(
      resolveCellTargetFor({ exerciseType: ExerciseType.CLOZE, cefrLevel: 'A1', grammarPoint: point }),
    ).toBe(24);
  });

  it('keeps the vocab_recall low cap at every level', () => {
    expect(CELL_TARGET_DEFAULTS[ExerciseType.VOCAB_RECALL].B2).toBe(10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/shared test -- cell-targets`
Expected: FAIL — `Failed to resolve import "./cell-targets"`.

- [ ] **Step 3: Create the shared module**

Create `packages/shared/src/cell-targets.ts`. Copy `CELL_TARGET_DEFAULTS` and the resolver body **verbatim** from `infra/lambda/src/generation/cell-targets.ts` (including every explanatory comment — the numbers are design decisions and the comments are the record of why).

Note the one deliberate change from the lambda original: the record is typed `Record<`${ExerciseType}`, …>` rather than `Record<ExerciseType, …>`, and the keys are written as string literals. `packages/shared/src/coverage.ts` documents the hazard — `shared/src/index.ts` re-exports these sibling modules, so a *runtime* module-scope reference to the `ExerciseType` enum would hit the TDZ during module init. A template-literal type is erased at compile time, so it enforces exhaustiveness with zero runtime reference.

```ts
/**
 * Per-cell generation target arithmetic. Pure: no I/O, no env.
 *
 * Moved here from `infra/lambda/src/generation/cell-targets.ts` (2026-08-11) for
 * the same reason `MIN_PER_VARIANT` lives in shared: `packages/db` cannot depend
 * on `@language-drill/lambda`, and neither can `packages/ai`, whose
 * `audit:collapse` CLI needs a cell's target to tell "below target, self-heals"
 * from "at target, stuck". The lambda module now delegates here.
 */

import type { ExerciseType } from './index';
import type { CurriculumCefrLevel, GrammarPoint } from './curriculum-types';
import { MIN_PER_VARIANT } from './construction-variant-seed';

/** Global fallback for any `(type, level)` the table below leaves unset. */
export const TARGET_PER_CELL = 50;

/**
 * Default per-cell targets keyed by `(exerciseType, cefrLevel)`. `Partial` on the
 * level axis: an unset level falls through to `TARGET_PER_CELL`.
 *
 * Keyed by `` `${ExerciseType}` `` (a template-literal TYPE over the string enum)
 * rather than by the enum value itself. `shared/src/index.ts` re-exports this
 * module, so a module-scope RUNTIME reference to `ExerciseType` would be a real
 * init-order hazard — see the same warning at the top of `coverage.ts`. The
 * template-literal type is erased at compile time and still enforces
 * exhaustiveness, and `CELL_TARGET_DEFAULTS[someExerciseType]` still type-checks
 * because the enum's values are exactly these strings.
 */
export const CELL_TARGET_DEFAULTS: Record<
  `${ExerciseType}`,
  Partial<Record<CurriculumCefrLevel, number>>
> = {
  // A1/A2 have a smaller realistic distinct-exercise ceiling than the global 50;
  // B1/B2 are unset → they fall through to TARGET_PER_CELL.
  cloze: { A1: 20, A2: 30 },
  translation: { A1: 20, A2: 30 },
  sentence_construction: { A1: 20, A2: 30 },
  // A1/A2: narrow grammar-point verb-form space mirrors cloze/translation.
  conjugation: { A1: 20, A2: 30 },
  // Capped low across every level (2026-06-07): vocab cells are the worst
  // token-efficiency offenders — a single "everyday" umbrella exhausts its
  // realistic distinct-word surface fast (high dedup-give-up), so chasing the old
  // 60–75 burned tokens for near-zero net new approvals. Breadth now comes from
  // splitting into more themed umbrellas, not a high per-cell target.
  vocab_recall: { A1: 10, A2: 10, B1: 10, B2: 10 },
  // B1/B2: 15. A1/A2: 6/10 — the distinct-clip surface is small at low levels.
  dictation: { A1: 6, A2: 10, B1: 15, B2: 15 },
  // Capped LOW (5): the dedup surface is the title, and narrow topics hit heavy
  // dedup-give-up above ~5 (the 2026-06-16 run stalled at 3 chasing 8).
  free_writing: { A1: 5, A2: 5, B1: 5, B2: 5 },
  // B1+ only; capped low (8) — narrow distinct-source-sentence surface.
  contextual_paraphrase: { B1: 8, B2: 8 },
};

/** The structural slice of a generation cell the target arithmetic needs. The
 *  `Cell` type in `@language-drill/db` satisfies this structurally. */
export type CellTargetInput = {
  exerciseType: ExerciseType;
  cefrLevel: CurriculumCefrLevel;
  grammarPoint: GrammarPoint;
};

/**
 * Resolve the generation target for a cell. Order: an explicit `targetOverride`
 * wins outright — including over the `constructionVariants` floor. A
 * `targetOverride` too small to let every declared variant reach
 * `MIN_PER_VARIANT` is an authoring mistake caught by
 * `assertCurriculumInvariants`, NOT by a throw here: this runs uncaught inside
 * the nightly scheduler's per-cell loop, so throwing would abort the whole run
 * for every language over one misconfigured point.
 *
 * Absent an override, the `(type, level)` table value (or the `TARGET_PER_CELL`
 * fallback) is raised to cover the largest single-axis floor sum in the
 * `coverageSpec` and the `constructionVariants` floor. One approved exercise
 * realizes one value per axis, so an axis whose floors sum to F needs >= F
 * exercises; taking the MAX over axes (never the product) guarantees headroom
 * for the tightest axis without multiplying axes together.
 */
export function resolveCellTargetFor(cell: CellTargetInput): number {
  const variants = cell.grammarPoint.constructionVariants;
  const variantFloor = variants ? variants.length * MIN_PER_VARIANT : 0;

  const override = cell.grammarPoint.targetOverride;
  if (override !== undefined) return override;

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

- [ ] **Step 4: Re-export from the shared barrel**

Append to `packages/shared/src/index.ts`:

```ts
export {
  TARGET_PER_CELL,
  CELL_TARGET_DEFAULTS,
  resolveCellTargetFor,
} from './cell-targets';
export type { CellTargetInput } from './cell-targets';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/shared test -- cell-targets`
Expected: PASS, 6 tests.

- [ ] **Step 6: Make the lambda modules delegate**

In `infra/lambda/src/generation/scheduler-decision.ts`, replace the `export const TARGET_PER_CELL = 50;` declaration at line 44 with a re-export, keeping the surrounding doc comment intact:

```ts
export { TARGET_PER_CELL } from '@language-drill/shared';
```

In `infra/lambda/src/generation/cell-targets.ts`, replace the `CELL_TARGET_DEFAULTS` literal and the `resolveCellTarget` body with delegation. Keep `GIVE_UP_MIN_ATTEMPTS` in place — it is unrelated to the target arithmetic and has its own lambda-only consumers. The file becomes:

```ts
/**
 * Per-cell generation target resolver (R3). The arithmetic itself moved to
 * `@language-drill/shared` (2026-08-11) so `packages/ai`'s `audit:collapse` CLI
 * can compute the same targets without depending on this package. This module
 * keeps the `Cell`-typed entry point the scheduler and admin route already call,
 * plus the coverage give-up constant.
 */

import { resolveCellTargetFor } from '@language-drill/shared';
import type { Cell } from '@language-drill/db';

export { CELL_TARGET_DEFAULTS } from '@language-drill/shared';

/**
 * Phase 1 coverage controller — a person bucket is **given up** (excluded from
 * the deficit) when its most recent targeted batch asked for it at least this
 * many times and produced zero approved drafts realizing it. Two honest attempts
 * before suppression; person buckets are small, so a single-attempt miss is too
 * noisy. Cleared by a CURRICULUM_VERSION bump. Design-tunable.
 */
export const GIVE_UP_MIN_ATTEMPTS = 2;

/** Resolve the generation target for a cell. Pure. See `resolveCellTargetFor`
 *  in `@language-drill/shared` for the full resolution-order contract. */
export function resolveCellTarget(cell: Cell): number {
  return resolveCellTargetFor(cell);
}
```

- [ ] **Step 7: Verify the existing lambda tests still pass unchanged**

This is the whole point of the back-compat re-exports — not one lambda test file may need editing.

Run: `rm -rf infra/lambda/dist && pnpm build && pnpm --filter @language-drill/lambda test -- cell-targets scheduler`
Expected: PASS. (`rm -rf infra/lambda/dist` first: stale compiled `.test.js` files in `dist` produce phantom failures.)

- [ ] **Step 8: Full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/cell-targets.ts packages/shared/src/cell-targets.test.ts \
  packages/shared/src/index.ts infra/lambda/src/generation/cell-targets.ts \
  infra/lambda/src/generation/scheduler-decision.ts
git commit -m "refactor(shared): move cell-target arithmetic out of lambda

packages/ai cannot depend on @language-drill/lambda, but the audit:collapse
CLI needs a cell's resolved target to tell 'below target, self-heals' from
'at target, stuck'. Same constraint that put MIN_PER_VARIANT in shared.

Lambda call sites and tests are unchanged — cell-targets.ts and
scheduler-decision.ts re-export from shared.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Signal 1 — answer-surface collapse

The spec-agnostic metric: per cell, what share of approved rows share the same normalized answer surface. This is the metric that produced PR #631's 53-row sweep, and the one that catches a *satisfied* `coverageSpec` which nonetheless doesn't cover the point's real variation.

**Files:**
- Create: `packages/ai/src/collapse-metrics.ts`
- Create: `packages/ai/src/collapse-metrics.test.ts`

**Interfaces:**
- Consumes: `ExerciseType`, `CoverageTags`, `GrammarPoint`, `CurriculumCefrLevel` from `@language-drill/shared`.
- Produces: `type AuditRow`, `type SurfaceDistribution`, `surfaceOf()`, `normalizeSurface()`, `computeSurfaceCollapse()`, `isSurfaceFlagged()`. Tasks 3, 4, 8, and 9 all import from this module.

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/collapse-metrics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import {
  surfaceOf,
  normalizeSurface,
  computeSurfaceCollapse,
  isSurfaceFlagged,
  type AuditRow,
} from './collapse-metrics.js';

const row = (type: ExerciseType, content: Record<string, unknown>): AuditRow => ({
  id: `id-${Math.random()}`,
  type,
  content,
  coverageTags: null,
});

const clozeRows = (answers: string[]): AuditRow[] =>
  answers.map((a) => row(ExerciseType.CLOZE, { sentence: 'x ___ y', correctAnswer: a }));

describe('surfaceOf', () => {
  it('reads correctAnswer for cloze', () => {
    expect(surfaceOf(ExerciseType.CLOZE, { correctAnswer: 'Dicen' })).toBe('Dicen');
  });

  it('reads referenceTranslation for translation', () => {
    expect(
      surfaceOf(ExerciseType.TRANSLATION, { referenceTranslation: 'Dicen que llueve.' }),
    ).toBe('Dicen que llueve.');
  });

  it('reads lemma for conjugation', () => {
    expect(surfaceOf(ExerciseType.CONJUGATION, { lemma: 'ir' })).toBe('ir');
  });

  it('reads prompt for sentence_construction', () => {
    expect(surfaceOf(ExerciseType.SENTENCE_CONSTRUCTION, { prompt: 'Sie hat gestern...' })).toBe(
      'Sie hat gestern...',
    );
  });

  it('returns null for a type with no defined surface', () => {
    expect(surfaceOf(ExerciseType.FREE_WRITING, { title: 'x' })).toBeNull();
  });

  it('returns null when the field is missing or not a string', () => {
    expect(surfaceOf(ExerciseType.CLOZE, {})).toBeNull();
    expect(surfaceOf(ExerciseType.CLOZE, { correctAnswer: 42 })).toBeNull();
  });
});

describe('normalizeSurface', () => {
  it('cloze: lowercases and takes the first token', () => {
    expect(normalizeSurface(ExerciseType.CLOZE, 'Dicen que')).toBe('dicen');
  });

  it('cloze: strips edge punctuation but keeps word-internal apostrophes', () => {
    expect(normalizeSurface(ExerciseType.CLOZE, '¿Anne’nin?')).toBe('anne’nin');
  });

  it('translation: takes the leading bigram', () => {
    expect(normalizeSurface(ExerciseType.TRANSLATION, 'Dicen que llueve mucho.')).toBe('dicen que');
  });

  it('translation: a one-word surface yields that single token', () => {
    expect(normalizeSurface(ExerciseType.TRANSLATION, 'Llueve.')).toBe('llueve');
  });

  it('conjugation: uses the whole lemma, not just its first token', () => {
    expect(normalizeSurface(ExerciseType.CONJUGATION, 'sich freuen')).toBe('sich freuen');
  });

  it('returns null for an empty or punctuation-only surface', () => {
    expect(normalizeSurface(ExerciseType.CLOZE, '   ')).toBeNull();
    expect(normalizeSurface(ExerciseType.CLOZE, '...')).toBeNull();
  });
});

describe('computeSurfaceCollapse', () => {
  it('reports the top surface, its share, and a descending distribution', () => {
    const rows = clozeRows([
      ...Array(43).fill('Dicen'),
      'robaron',
      'robaron',
      'identificaron',
      'guían',
      'metieron',
      'entraron',
    ]);
    const result = computeSurfaceCollapse(ExerciseType.CLOZE, rows);
    expect(result).not.toBeNull();
    expect(result!.total).toBe(49);
    expect(result!.topSurface).toBe('dicen');
    expect(result!.topCount).toBe(43);
    expect(result!.share).toBeCloseTo(43 / 49, 5);
    expect(result!.distribution[0]).toEqual({ surface: 'dicen', count: 43 });
    expect(result!.distribution[1]).toEqual({ surface: 'robaron', count: 2 });
  });

  it('caps the distribution at 8 entries', () => {
    const rows = clozeRows(Array.from({ length: 20 }, (_, i) => `w${i}`));
    expect(computeSurfaceCollapse(ExerciseType.CLOZE, rows)!.distribution).toHaveLength(8);
  });

  it('skips rows with no usable surface rather than counting them as empty', () => {
    const rows = [...clozeRows(['ir', 'ir']), row(ExerciseType.CLOZE, {})];
    const result = computeSurfaceCollapse(ExerciseType.CLOZE, rows);
    expect(result!.total).toBe(2);
  });

  it('returns null when no row has a usable surface', () => {
    expect(computeSurfaceCollapse(ExerciseType.CLOZE, [row(ExerciseType.CLOZE, {})])).toBeNull();
  });

  it('breaks count ties deterministically, alphabetically', () => {
    const result = computeSurfaceCollapse(ExerciseType.CLOZE, clozeRows(['b', 'a']));
    expect(result!.topSurface).toBe('a');
  });
});

describe('isSurfaceFlagged', () => {
  const opts = { minRows: 15, threshold: 0.65 };

  it('flags at or above the threshold with enough rows', () => {
    const rows = clozeRows([...Array(13).fill('x'), ...Array(7).fill('y')]); // 20 rows, 0.65
    expect(isSurfaceFlagged(computeSurfaceCollapse(ExerciseType.CLOZE, rows), opts)).toBe(true);
  });

  it('does not flag below the threshold', () => {
    const rows = clozeRows([...Array(12).fill('x'), ...Array(8).fill('y')]); // 0.60
    expect(isSurfaceFlagged(computeSurfaceCollapse(ExerciseType.CLOZE, rows), opts)).toBe(false);
  });

  it('does not flag a cell below minRows, however concentrated', () => {
    const rows = clozeRows(Array(14).fill('x')); // 100% but only 14 rows
    expect(isSurfaceFlagged(computeSurfaceCollapse(ExerciseType.CLOZE, rows), opts)).toBe(false);
  });

  it('does not flag null', () => {
    expect(isSurfaceFlagged(null, opts)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- collapse-metrics`
Expected: FAIL — `Failed to resolve import "./collapse-metrics.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/ai/src/collapse-metrics.ts`:

```ts
/**
 * Pool collapse metrics (2026-08-11 design). Pure — no I/O, no env, and NO
 * import of `@language-drill/db`: the grammar point's declared config is passed
 * in by the caller (`packages/ai/scripts/audit-collapse.ts`), which is the only
 * unit allowed to touch both `db` and Anthropic.
 *
 * Signal 1 (this file, below) is deliberately SPEC-AGNOSTIC. It never reads
 * `coverageSpec`, which is exactly why it catches a satisfied spec that fails to
 * cover a point's real variation — the PR #631 class of defect, where
 * `de-b1-um-zu-damit` was 49/50 `damit` on a point whose entire content is the
 * `um…zu` / `damit` contrast, and no CoverageAxis could have expressed it.
 */

import { ExerciseType } from '@language-drill/shared';
import type { CoverageTags } from '@language-drill/shared';

/** One approved exercise row, as the CLI loads it. `content` is the raw
 *  `content_json` blob — deliberately untyped, since the audit reads legacy rows
 *  whose shape predates the current discriminated union. */
export type AuditRow = {
  id: string;
  type: ExerciseType;
  content: Record<string, unknown>;
  coverageTags: CoverageTags | null;
};

/** How many distinct surfaces the report shows per cell. Also the number the
 *  triage prompt sees — enough to judge, small enough to stay cheap. */
export const DISTRIBUTION_LIMIT = 8;

export type SurfaceDistribution = {
  topSurface: string;
  topCount: number;
  /** Rows that yielded a usable surface. Rows without one are excluded. */
  total: number;
  share: number;
  distribution: Array<{ surface: string; count: number }>;
};

export type SurfaceFlagOptions = { minRows: number; threshold: number };

/** The `content_json` field whose value collapses, per exercise type. */
const SURFACE_FIELD: Partial<Record<`${ExerciseType}`, string>> = {
  cloze: 'correctAnswer',
  translation: 'referenceTranslation',
  // The lexical head the cell collapses onto despite satisfied person floors —
  // the failure `conjugationSeedWords` exists to fix.
  conjugation: 'lemma',
  // Free production, so there is no single correct answer: the TASK FRAMING is
  // what collapses (`de-b2-mittelfeld-word-order`, 91% "Sie hat…").
  sentence_construction: 'prompt',
};

/** Raw surface string for a row, or null when this type has no defined surface
 *  or the field is absent / not a string. */
export function surfaceOf(
  type: ExerciseType,
  content: Record<string, unknown>,
): string | null {
  const field = SURFACE_FIELD[type];
  if (field === undefined) return null;
  const value = content[field];
  return typeof value === 'string' ? value : null;
}

/**
 * Strip punctuation from each token's EDGES only. Word-internal apostrophes and
 * hyphens are preserved deliberately — `Anne'nin`, `e-posta`, and `don't` are
 * single words, and collapsing them would merge distinct TR possessive answers
 * into one bucket. Same rule the `tokenize.ts` reader uses.
 */
const EDGE_PUNCT = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

function tokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/\s+/u)
    .map((t) => t.replace(EDGE_PUNCT, ''))
    .filter((t) => t.length > 0);
}

/**
 * The comparable key for one surface. Per type:
 *   - cloze: the ANSWER HEAD (first token) — a cloze blank holds one word, and
 *     trailing context varies.
 *   - translation / sentence_construction: the LEADING BIGRAM — the construction
 *     frame lives at the start of the sentence (`Dicen que…`, `Sie hat…`).
 *   - conjugation: the WHOLE lemma — multiword lemmas (`sich freuen`, `dar
 *     cuenta`) are one lexical identity, so taking the head would merge every
 *     reflexive under `sich`.
 */
export function normalizeSurface(type: ExerciseType, raw: string): string | null {
  const parts = tokens(raw);
  if (parts.length === 0) return null;
  if (type === ExerciseType.CONJUGATION) return parts.join(' ');
  if (type === ExerciseType.CLOZE) return parts[0];
  return parts.slice(0, 2).join(' ');
}

/** Top-surface concentration for one cell, or null when no row yields a usable
 *  surface. Ties break alphabetically so the output is deterministic. */
export function computeSurfaceCollapse(
  type: ExerciseType,
  rows: readonly AuditRow[],
): SurfaceDistribution | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const raw = surfaceOf(type, r.content);
    if (raw === null) continue;
    const key = normalizeSurface(type, raw);
    if (key === null) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return null;

  const sorted = [...counts.entries()]
    .map(([surface, count]) => ({ surface, count }))
    .sort((a, b) => (b.count - a.count) || a.surface.localeCompare(b.surface));

  return {
    topSurface: sorted[0].surface,
    topCount: sorted[0].count,
    total,
    share: sorted[0].count / total,
    distribution: sorted.slice(0, DISTRIBUTION_LIMIT),
  };
}

/** The PR #631 sweep gate: enough rows to be meaningful, concentrated enough to
 *  be suspicious. Inclusive on both bounds. */
export function isSurfaceFlagged(
  d: SurfaceDistribution | null,
  opts: SurfaceFlagOptions,
): boolean {
  if (d === null) return false;
  return d.total >= opts.minRows && d.share >= opts.threshold;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- collapse-metrics`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/collapse-metrics.ts packages/ai/src/collapse-metrics.test.ts
git commit -m "feat(ai): signal 1 — spec-agnostic answer-surface collapse metric

Per-cell top-surface concentration: answer head for cloze, leading bigram
for translation/sentence_construction, whole lemma for conjugation. Never
reads coverageSpec, which is why it catches a satisfied spec that misses
the point's real variation (PR #631).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Signal 2 — declared-but-unrealized

Deterministic, no LLM, no false positives: the declared floor *is* ground truth. Two sub-checks — `coverageSpec` floor shortfall and `constructionVariants` quota skew.

The `atTarget` flag is the load-bearing output. `docs/curriculum-authoring.md` calls skipping it "the classic trap": a cell below target self-heals once generation resumes, but a cell *at* target has no deficit, so the scheduler never revisits it and the floors never fire. Only a demote unblocks it.

**Files:**
- Modify: `packages/ai/src/collapse-metrics.ts`
- Modify: `packages/ai/src/collapse-metrics.test.ts`

**Interfaces:**
- Consumes: `AuditRow` (Task 2), `MIN_PER_VARIANT`, `GrammarPoint`, `CoverageAxis` from `@language-drill/shared`.
- Produces: `type FloorShortfall`, `type SpecShortfall`, `type VariantSkew`, `computeSpecShortfall()`, `computeVariantSkew()`. Tasks 8 and 9 use both.

- [ ] **Step 1: Write the failing test**

Append to `packages/ai/src/collapse-metrics.test.ts`:

```ts
import { computeSpecShortfall, computeVariantSkew } from './collapse-metrics.js';
import type { GrammarPoint } from '@language-drill/shared';

const point = (extra: Partial<GrammarPoint> = {}): GrammarPoint =>
  ({
    key: 'es-b1-test',
    kind: 'grammar',
    name: 'Test point',
    description: 'A test point.',
    cefrLevel: 'B1',
    language: 'ES',
    examplesPositive: ['a', 'b'],
    examplesNegative: ['*c'],
    commonErrors: ['d'],
    ...extra,
  }) as GrammarPoint;

const tagged = (person: string, n: number): AuditRow[] =>
  Array.from({ length: n }, () => ({
    id: `id-${person}-${Math.random()}`,
    type: ExerciseType.CLOZE,
    content: { correctAnswer: 'x' },
    coverageTags: { person } as never,
  }));

const seeded = (seedWord: string | null, n: number): AuditRow[] =>
  Array.from({ length: n }, () => ({
    id: `id-${seedWord}-${Math.random()}`,
    type: ExerciseType.TRANSLATION,
    content: seedWord === null ? {} : { seedWord },
    coverageTags: null,
  }));

describe('computeSpecShortfall', () => {
  const spec = {
    coverageSpec: { axes: [{ name: 'person' as const, floors: { '1sg': 5, '3sg': 5, '3pl': 5 } }] },
  };

  it('returns null for a point with no coverageSpec', () => {
    expect(computeSpecShortfall(point(), [], 50)).toBeNull();
  });

  it('reports each declared value under its floor, with the observed count', () => {
    const rows = [...tagged('1sg', 5), ...tagged('3sg', 2), ...tagged('3pl', 0)];
    const result = computeSpecShortfall(point(spec), rows, 15)!;
    expect(result.shortfalls).toEqual([
      { axis: 'person', value: '3sg', floor: 5, actual: 2 },
      { axis: 'person', value: '3pl', floor: 5, actual: 0 },
    ]);
  });

  it('reports no shortfall when every floor is met', () => {
    const rows = [...tagged('1sg', 5), ...tagged('3sg', 6), ...tagged('3pl', 5)];
    expect(computeSpecShortfall(point(spec), rows, 15)!.shortfalls).toEqual([]);
  });

  it('flags atTarget — the cell that will NOT self-heal without a demote', () => {
    const rows = [...tagged('1sg', 20), ...tagged('3sg', 0), ...tagged('3pl', 0)];
    const result = computeSpecShortfall(point(spec), rows, 15)!;
    expect(result.approved).toBe(20);
    expect(result.atTarget).toBe(true);
    expect(result.shortfalls).toHaveLength(2);
  });

  it('does not flag atTarget when the cell is still filling', () => {
    expect(computeSpecShortfall(point(spec), tagged('1sg', 5), 50)!.atTarget).toBe(false);
  });

  it('ignores rows with no coverage tag for the axis', () => {
    const rows = [...tagged('1sg', 5), ...seeded(null, 3).map((r) => ({ ...r, coverageTags: null }))];
    const result = computeSpecShortfall(point(spec), rows, 15)!;
    expect(result.shortfalls.find((s) => s.value === '1sg')).toBeUndefined();
  });
});

describe('computeVariantSkew', () => {
  const variants = point({
    constructionVariants: [
      { id: 'hearsay', directive: 'H', share: 3 },
      { id: 'adversity', directive: 'A' },
      { id: 'agentless', directive: 'G' },
      { id: 'uno-generic', directive: 'U' },
    ],
  });

  it('returns null for a point with no constructionVariants', () => {
    expect(computeVariantSkew(point(), [])).toBeNull();
  });

  it('counts unrecognized and null seedWords separately from declared variants', () => {
    // The live prod shape after #631 merged inert: 49 legacy rows, zero variant coverage.
    const rows = [...seeded(null, 40), ...seeded('restaurante', 9)];
    const result = computeVariantSkew(variants, rows)!;
    expect(result.unrecognizedSeedCount).toBe(49);
    expect(result.perVariant.every((v) => v.count === 0)).toBe(true);
  });

  it('computes each quota from share over the declared-variant pool only', () => {
    // 12 declared rows, shares 3/1/1/1 → quotas 6/2/2/2. Unrecognized rows excluded.
    const rows = [...seeded('hearsay', 12), ...seeded(null, 100)];
    const result = computeVariantSkew(variants, rows)!;
    expect(result.approved).toBe(12);
    expect(result.perVariant.find((v) => v.id === 'hearsay')!.quota).toBe(6);
    expect(result.perVariant.find((v) => v.id === 'adversity')!.quota).toBe(2);
  });

  it('reports over-quota and under-MIN_PER_VARIANT ids', () => {
    const rows = [
      ...seeded('hearsay', 12),
      ...seeded('adversity', 4),
      ...seeded('agentless', 2),
      ...seeded('uno-generic', 2),
    ];
    const result = computeVariantSkew(variants, rows)!;
    // approved = 20, totalShare = 6 → quotas 10 / 3.33 / 3.33 / 3.33.
    // hearsay 12 > 10 and adversity 4 > 3.33 are both over; the other two are under 4.
    expect(result.overQuota).toEqual(['hearsay', 'adversity']);
    expect(result.underMin).toEqual(['agentless', 'uno-generic']); // < MIN_PER_VARIANT
  });

  it('reports nothing when every variant sits at its quota', () => {
    const rows = [
      ...seeded('hearsay', 12),
      ...seeded('adversity', 4),
      ...seeded('agentless', 4),
      ...seeded('uno-generic', 4),
    ];
    const result = computeVariantSkew(variants, rows)!;
    expect(result.overQuota).toEqual([]);
    expect(result.underMin).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- collapse-metrics`
Expected: FAIL — `computeSpecShortfall is not exported`.

- [ ] **Step 3: Write the implementation**

Append to `packages/ai/src/collapse-metrics.ts`. The two `import` lines below go in the **existing import block at the top of the file**, not at the bottom — ESLint's `import/first` rejects an import after other statements.

```ts
// → merge into the existing import block at the top of the file
import { MIN_PER_VARIANT } from '@language-drill/shared';
import type { CoverageAxis, GrammarPoint } from '@language-drill/shared';

export type FloorShortfall = {
  axis: CoverageAxis;
  value: string;
  floor: number;
  actual: number;
};

export type SpecShortfall = {
  shortfalls: FloorShortfall[];
  approved: number;
  target: number;
  /**
   * `approved >= target`. THE load-bearing field: a cell below target self-heals
   * once the scheduler resumes (its `need = target - approved` is positive, so
   * the floors get targeted on the next batch). A cell AT target has no deficit,
   * so the scheduler never revisits it and the floors never fire, however loudly
   * they are declared. That cell needs `pnpm demote:pool` — the "classic trap"
   * in docs/curriculum-authoring.md.
   */
  atTarget: boolean;
};

/**
 * Declared `coverageSpec` floors vs. the realized `coverage_tags` distribution.
 * Deterministic, no LLM: the declared floor is ground truth, so there is nothing
 * to triage. Returns null for a point without a spec.
 *
 * Rows whose `coverage_tags` lack the axis are simply not counted toward any
 * value — untagged legacy rows are not evidence that a floor is met.
 */
export function computeSpecShortfall(
  gp: GrammarPoint,
  rows: readonly AuditRow[],
  target: number,
): SpecShortfall | null {
  const spec = gp.coverageSpec;
  if (!spec) return null;

  const shortfalls: FloorShortfall[] = [];
  for (const axis of spec.axes) {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const value = r.coverageTags?.[axis.name];
      if (typeof value !== 'string') continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    for (const [value, floor] of Object.entries(axis.floors)) {
      const actual = counts.get(value) ?? 0;
      if (actual < (floor as number)) {
        shortfalls.push({ axis: axis.name, value, floor: floor as number, actual });
      }
    }
  }

  return { shortfalls, approved: rows.length, target, atTarget: rows.length >= target };
}

export type VariantCoverage = {
  id: string;
  count: number;
  share: number;
  /** Fair share of the DECLARED-variant pool: `approved * share / totalShare`. */
  quota: number;
};

export type VariantSkew = {
  perVariant: VariantCoverage[];
  /** Variants holding more rows than their quota. */
  overQuota: string[];
  /** Variants below `MIN_PER_VARIANT` — too thin to appear in a learner's rotation. */
  underMin: string[];
  /**
   * Rows whose `content_json.seedWord` is null or is not a declared variant id.
   * Nothing else in the codebase measures this, and it is the hazard the #631
   * rollout documented at length: an unbackfilled legacy row occupies an approved
   * slot (counting toward `target - approved`) while contributing to NO variant's
   * quota, so the scheduler reads every variant as zero-covered on a cell that is
   * simultaneously at target.
   */
  unrecognizedSeedCount: number;
  /** Rows carrying a declared variant id. Quotas are computed against this. */
  approved: number;
};

/** Declared `constructionVariants` vs. the realized `seedWord` distribution.
 *  Deterministic. Returns null for a point without variants. */
export function computeVariantSkew(
  gp: GrammarPoint,
  rows: readonly AuditRow[],
): VariantSkew | null {
  const variants = gp.constructionVariants;
  if (!variants || variants.length === 0) return null;

  const declared = new Set(variants.map((v) => v.id));
  const counts = new Map<string, number>();
  let unrecognizedSeedCount = 0;
  for (const r of rows) {
    const seed = r.content.seedWord;
    if (typeof seed === 'string' && declared.has(seed)) {
      counts.set(seed, (counts.get(seed) ?? 0) + 1);
    } else {
      unrecognizedSeedCount += 1;
    }
  }

  // Only declared variants count toward the pool — a legacy frequency-word seed
  // is not evidence that any variant is covered. Same rule as `pickVariantSeeds`.
  const approved = variants.reduce((sum, v) => sum + (counts.get(v.id) ?? 0), 0);
  const totalShare = variants.reduce((sum, v) => sum + (v.share ?? 1), 0);

  const perVariant: VariantCoverage[] = variants.map((v) => {
    const share = v.share ?? 1;
    return {
      id: v.id,
      count: counts.get(v.id) ?? 0,
      share,
      quota: (approved * share) / totalShare,
    };
  });

  return {
    perVariant,
    overQuota: perVariant.filter((v) => v.count > v.quota).map((v) => v.id),
    underMin: perVariant.filter((v) => v.count < MIN_PER_VARIANT).map((v) => v.id),
    unrecognizedSeedCount,
    approved,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- collapse-metrics`
Expected: PASS, 32 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/collapse-metrics.ts packages/ai/src/collapse-metrics.test.ts
git commit -m "feat(ai): signal 2 — declared-but-unrealized coverage and variant skew

Deterministic, no LLM: the declared floor is ground truth. Reports
coverageSpec floor shortfalls with an atTarget flag (the cell that will not
self-heal without a demote) and constructionVariants quota skew including
the unrecognized-seedWord count nothing else measures.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Signal 3 — stem/topic monotony

The weakest and most speculative signal, and it is scoped accordingly: same cheap head-share metric family, deliberately loose default threshold, reported in its own section. `#617` shipped systemic topic steering, so part of this may already be self-correcting; the first calibration run (Task 11) decides whether the threshold is useful.

No embeddings. The "new restaurant downtown has the best paella" cluster surfaces as one content lemma dominating a cell's stems.

**Files:**
- Modify: `packages/ai/src/collapse-metrics.ts`
- Modify: `packages/ai/src/collapse-metrics.test.ts`

**Interfaces:**
- Consumes: `AuditRow`, the token helpers (Task 2).
- Produces: `STOPWORDS`, `MONOTONY_THRESHOLD_DEFAULT`, `stemOf()`, `computeStemMonotony()`. Tasks 8 and 9 use `computeStemMonotony`.

- [ ] **Step 1: Write the failing test**

Append to `packages/ai/src/collapse-metrics.test.ts`:

```ts
import { computeStemMonotony, stemOf, MONOTONY_THRESHOLD_DEFAULT } from './collapse-metrics.js';

describe('stemOf', () => {
  it('reads sentence for cloze', () => {
    expect(stemOf(ExerciseType.CLOZE, { sentence: 'El ___ es bueno.' })).toBe('El ___ es bueno.');
  });

  it('reads sourceText for translation — the L1 source, not the reference', () => {
    expect(
      stemOf(ExerciseType.TRANSLATION, {
        sourceText: 'They say it rains.',
        referenceTranslation: 'Dicen que llueve.',
      }),
    ).toBe('They say it rains.');
  });

  it('reads prompt for sentence_construction', () => {
    expect(stemOf(ExerciseType.SENTENCE_CONSTRUCTION, { prompt: 'Describe your town.' })).toBe(
      'Describe your town.',
    );
  });

  it('returns null for conjugation — the lemma IS the surface, already signal 1', () => {
    expect(stemOf(ExerciseType.CONJUGATION, { lemma: 'ir' })).toBeNull();
  });
});

describe('computeStemMonotony', () => {
  const stems = (texts: string[]): AuditRow[] =>
    texts.map((sentence) => ({
      id: `id-${Math.random()}`,
      type: ExerciseType.CLOZE,
      content: { sentence },
      coverageTags: null,
    }));

  it('reports the most common content lemma and the share of stems containing it', () => {
    // Only `restaurante` recurs; every other content word appears once, so
    // there is no df tie for the alphabetical tie-break to resolve.
    const rows = stems([
      'El restaurante nuevo tiene la mejor paella.',
      'Cenamos en el restaurante ayer.',
      'El restaurante cierra los lunes.',
      'Mi hermano trabaja en un restaurante.',
      'El restaurante lleno hoy.',
      'Buscamos un restaurante barato.',
      'La iglesia es antigua.',
      'El tren llega tarde.',
      'Mi hermana estudia mucho.',
      'El perro duerme.',
    ]);
    const result = computeStemMonotony(ExerciseType.CLOZE, rows)!;
    expect(result.topLemma).toBe('restaurante');
    expect(result.count).toBe(6);
    expect(result.total).toBe(10);
    expect(result.share).toBeCloseTo(0.6, 5);
  });

  it('counts a lemma once per stem, not once per occurrence', () => {
    const rows = stems([
      'El restaurante del restaurante restaurante.',
      'La iglesia del pueblo.',
      'El restaurante nuevo.',
    ]);
    const result = computeStemMonotony(ExerciseType.CLOZE, rows)!;
    expect(result.topLemma).toBe('restaurante');
    // Two STEMS contain it, though it occurs four times overall.
    expect(result.count).toBe(2);
  });

  it('drops stopwords so function words never dominate', () => {
    const rows = stems(['El perro y la casa.', 'El gato y la casa.', 'El pez y la casa.']);
    const result = computeStemMonotony(ExerciseType.CLOZE, rows)!;
    expect(result.topLemma).toBe('casa');
  });

  it('drops the cloze blank marker', () => {
    const rows = stems(['El ___ come.', 'La ___ duerme.', 'Un ___ salta.']);
    const result = computeStemMonotony(ExerciseType.CLOZE, rows);
    expect(result?.topLemma).not.toBe('___');
  });

  it('returns null when no stem yields a content lemma', () => {
    expect(computeStemMonotony(ExerciseType.CLOZE, stems(['el la y', 'un una']))).toBeNull();
  });

  it('returns null for a type with no stem field', () => {
    const rows: AuditRow[] = [
      { id: 'a', type: ExerciseType.CONJUGATION, content: { lemma: 'ir' }, coverageTags: null },
    ];
    expect(computeStemMonotony(ExerciseType.CONJUGATION, rows)).toBeNull();
  });

  it('ships a loose default threshold — this signal is calibration-phase', () => {
    expect(MONOTONY_THRESHOLD_DEFAULT).toBeGreaterThanOrEqual(0.4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- collapse-metrics`
Expected: FAIL — `computeStemMonotony is not exported`.

- [ ] **Step 3: Write the implementation**

Append to `packages/ai/src/collapse-metrics.ts`:

```ts
/**
 * Function words dropped before counting content lemmas. Deliberately a single
 * pooled multi-language set rather than per-language lists: a stopword from the
 * wrong language cannot cause a false NEGATIVE here (it only removes a candidate
 * that was never going to be the interesting content lemma), and one list is far
 * cheaper to maintain than four. English is included because translation stems
 * are the L1 source text.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  // EN
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these',
  'those', 'i', 'you', 'he', 'she', 'we', 'they', 'my', 'your', 'his', 'her', 'our',
  'their', 'not', 'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can',
  // ES
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'pero', 'de',
  'del', 'a', 'al', 'en', 'con', 'por', 'para', 'que', 'se', 'no', 'es', 'son',
  'era', 'ser', 'estar', 'esta', 'este', 'mi', 'tu', 'su', 'lo', 'le', 'me', 'te',
  // DE
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'eines',
  'und', 'oder', 'aber', 'von', 'zu', 'im', 'in', 'auf', 'mit', 'für', 'ist', 'sind',
  'war', 'waren', 'sein', 'nicht', 'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr',
  // TR
  've', 'ile', 'bir', 'bu', 'şu', 'o', 'da', 'de', 'ki', 'için', 'ama', 'ya', 'çok',
  'ben', 'sen', 'biz', 'siz', 'onlar', 'var', 'yok', 'değil',
]);

/**
 * Default flag threshold for stem monotony. Loose on purpose: this signal is
 * calibration-phase (see the 2026-08-11 design doc), and #617's systemic topic
 * steering may already have fixed part of what it measures. The first prod run
 * decides whether this number is useful. Tune via `--monotony-threshold`.
 */
export const MONOTONY_THRESHOLD_DEFAULT = 0.5;

/** The `content_json` field carrying the exercise's scene text, per type. */
const STEM_FIELD: Partial<Record<`${ExerciseType}`, string>> = {
  cloze: 'sentence',
  // The L1 SOURCE, not the reference translation: the scene is authored in the
  // source, and the reference is already signal 1's surface.
  translation: 'sourceText',
  sentence_construction: 'prompt',
  // conjugation is deliberately absent — its lexical head IS the lemma, which
  // signal 1 already measures. Counting it twice would double-report one defect.
};

export function stemOf(type: ExerciseType, content: Record<string, unknown>): string | null {
  const field = STEM_FIELD[type];
  if (field === undefined) return null;
  const value = content[field];
  return typeof value === 'string' ? value : null;
}

export type StemMonotony = {
  topLemma: string;
  /** Stems CONTAINING the lemma — counted once per stem, not per occurrence. */
  count: number;
  total: number;
  share: number;
};

/**
 * Share of a cell's stems containing the single most common content lemma. The
 * cheap end of the metric family: no embeddings, no clustering. If it proves too
 * blunt, clustering is a v2 and must not block signals 1 and 2.
 */
export function computeStemMonotony(
  type: ExerciseType,
  rows: readonly AuditRow[],
): StemMonotony | null {
  const docFrequency = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const stem = stemOf(type, r.content);
    if (stem === null) continue;
    total += 1;
    const content = new Set(
      tokens(stem).filter(
        // Drop stopwords, the cloze blank marker, and pure digits.
        (t) => !STOPWORDS.has(t) && !/^_+$/u.test(t) && !/^\d+$/u.test(t),
      ),
    );
    for (const lemma of content) {
      docFrequency.set(lemma, (docFrequency.get(lemma) ?? 0) + 1);
    }
  }
  if (total === 0 || docFrequency.size === 0) return null;

  const sorted = [...docFrequency.entries()].sort(
    (a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]),
  );
  return { topLemma: sorted[0][0], count: sorted[0][1], total, share: sorted[0][1] / total };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- collapse-metrics`
Expected: PASS, 43 tests.

- [ ] **Step 5: Export the module from the ai barrel**

Append to `packages/ai/src/index.ts`:

```ts
export {
  DISTRIBUTION_LIMIT,
  MONOTONY_THRESHOLD_DEFAULT,
  STOPWORDS,
  surfaceOf,
  normalizeSurface,
  computeSurfaceCollapse,
  isSurfaceFlagged,
  computeSpecShortfall,
  computeVariantSkew,
  stemOf,
  computeStemMonotony,
} from "./collapse-metrics.js";
export type {
  AuditRow,
  SurfaceDistribution,
  SurfaceFlagOptions,
  FloorShortfall,
  SpecShortfall,
  VariantCoverage,
  VariantSkew,
  StemMonotony,
} from "./collapse-metrics.js";
```

- [ ] **Step 6: Verify the barrel compiles**

Run: `pnpm --filter @language-drill/ai typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/ai/src/collapse-metrics.ts packages/ai/src/collapse-metrics.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): signal 3 — stem/topic monotony via top content-lemma share

Cheapest member of the same metric family: no embeddings. Ships with a
deliberately loose default threshold; the first prod run calibrates it.
conjugation is excluded — its lexical head is already signal 1's surface.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The dismissals ledger

Without this, every run re-triages the same legitimately-concentrated cells and the report reads identically forever — which is how a standing report gets ignored.

The key is the **point + type + surface** compound. Dismissing `es-a2-personal-a` for dominant surface `a` must not mask a *different* collapse on that same cell next quarter.

**Files:**
- Create: `packages/db/src/curriculum/collapse-dismissals.ts`
- Modify: `packages/db/src/curriculum/index.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/curriculum/curriculum.test.ts`

**Interfaces:**
- Consumes: `ExerciseType` from `@language-drill/shared`; `ALL_CURRICULA` / `getGrammarPoint` for the integrity test.
- Produces: `type CollapseDismissal`, `COLLAPSE_DISMISSALS: readonly CollapseDismissal[]`, `isDismissed(key, type, surface, signal): boolean`. Task 9 calls `isDismissed`.

- [ ] **Step 1: Write the failing test**

Append to `packages/db/src/curriculum/curriculum.test.ts`:

```ts
import { COLLAPSE_DISMISSALS, isDismissed } from './collapse-dismissals';

describe('collapse dismissals ledger', () => {
  it('every dismissal names a grammar point that exists', () => {
    for (const d of COLLAPSE_DISMISSALS) {
      expect(getGrammarPoint(d.grammarPointKey), `unknown key ${d.grammarPointKey}`).toBeDefined();
    }
  });

  it('every dismissal names an exercise type the point actually has a cell for', () => {
    for (const d of COLLAPSE_DISMISSALS) {
      const gp = getGrammarPoint(d.grammarPointKey)!;
      expect(compatibleTypes(gp), `${d.grammarPointKey} has no ${d.type} cell`).toContain(d.type);
    }
  });

  it('has no duplicate (point, type, surface, signal) entries', () => {
    const keys = COLLAPSE_DISMISSALS.map(
      (d) => `${d.grammarPointKey}|${d.type}|${d.surface ?? '*'}|${d.signal}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every dismissal records a non-empty reason and an ISO date', () => {
    for (const d of COLLAPSE_DISMISSALS) {
      expect(d.reason.length, `${d.grammarPointKey} has an empty reason`).toBeGreaterThan(0);
      expect(d.dismissedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('isDismissed', () => {
  it('dismisses the exact (point, type, surface, signal) combination', () => {
    expect(isDismissed('es-a2-personal-a', ExerciseType.CLOZE, 'a', 'answer-surface')).toBe(true);
  });

  it('does NOT dismiss a different dominant surface on the same cell', () => {
    // The whole reason the ledger is keyed on surface: a later, unrelated
    // collapse on a dismissed cell must still be reported.
    expect(isDismissed('es-a2-personal-a', ExerciseType.CLOZE, 'para', 'answer-surface')).toBe(
      false,
    );
  });

  it('does NOT dismiss a different signal on the same surface', () => {
    expect(isDismissed('es-a2-personal-a', ExerciseType.CLOZE, 'a', 'stem-monotony')).toBe(false);
  });

  it('does NOT dismiss a different exercise type', () => {
    expect(isDismissed('es-a2-personal-a', ExerciseType.TRANSLATION, 'a', 'answer-surface')).toBe(
      false,
    );
  });

  it('a null-surface entry dismisses the cell whatever dominates', () => {
    expect(
      isDismissed('es-b1-ser-location-events', ExerciseType.CLOZE, 'anything', 'answer-surface'),
    ).toBe(true);
  });

  it('returns false for a point with no ledger entry', () => {
    expect(isDismissed('es-b1-impersonal-plural', ExerciseType.CLOZE, 'dicen', 'answer-surface')).toBe(
      false,
    );
  });
});
```

If `compatibleTypes`, `getGrammarPoint`, or `ExerciseType` are not already imported at the top of `curriculum.test.ts`, add them.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/db test -- curriculum`
Expected: FAIL — cannot resolve `./collapse-dismissals`.

- [ ] **Step 3: Write the ledger**

Create `packages/db/src/curriculum/collapse-dismissals.ts`:

```ts
/**
 * Collapse-dismissals ledger — every "this concentration is CORRECT" judgement,
 * recorded so `pnpm audit:collapse` stops re-triaging it on every run.
 *
 * Lives beside the curriculum because that is what it describes: a dismissal is
 * a statement about a grammar point's pedagogy, not about the audit tool. It is
 * also the durable record `docs/curriculum-authoring.md` already asks for
 * ("Record the 'no'") — previously scattered across PR descriptions.
 *
 * Keyed on (point, type, surface, signal). The SURFACE component is deliberate:
 * dismissing `es-a2-personal-a` for the dominant surface `a` must NOT mask a
 * different collapse on that same cell two quarters later. Use `surface: null`
 * only when the cell is legitimately concentrated whatever dominates.
 *
 * Seeded from the "Out of scope — metric false positives" section of
 * docs/superpowers/specs/2026-08-08-construction-variants-design.md.
 */

import { ExerciseType } from '@language-drill/shared';

export type CollapseSignal = 'answer-surface' | 'stem-monotony';

export type CollapseDismissal = Readonly<{
  grammarPointKey: string;
  type: ExerciseType;
  /** The dominant surface this dismissal covers; null dismisses the cell
   *  regardless of which surface dominates. */
  surface: string | null;
  signal: CollapseSignal;
  /** Why the concentration is correct. Non-empty; this is the whole value. */
  reason: string;
  /** ISO date (YYYY-MM-DD). Shown in the report so a stale dismissal is visible
   *  rather than silently permanent. */
  dismissedOn: string;
}>;

export const COLLAPSE_DISMISSALS: readonly CollapseDismissal[] = Object.freeze([
  {
    grammarPointKey: 'es-a2-personal-a',
    type: ExerciseType.CLOZE,
    surface: 'a',
    signal: 'answer-surface',
    reason:
      'The personal `a` IS the point. A cloze on this point has exactly one correct answer by construction, so 100% concentration is the target state, not a defect.',
    dismissedOn: '2026-08-11',
  },
  {
    grammarPointKey: 'es-b1-ser-location-events',
    type: ExerciseType.CLOZE,
    surface: null,
    signal: 'answer-surface',
    reason:
      'A ser/estar contrast point where `ser` is the answer and `estar` is the distractor, not an alternative answer. The 94% `ser` share measured in the 2026-08-08 sweep is correct; any dominant surface here is legitimate.',
    dismissedOn: '2026-08-11',
  },
  {
    grammarPointKey: 'es-a2-hace-ago',
    type: ExerciseType.CLOZE,
    surface: 'hace',
    signal: 'answer-surface',
    reason:
      '`hace + time` is a fixed construction; the marker is invariant and the variation lives in the time expression, which this metric does not read.',
    dismissedOn: '2026-08-11',
  },
  {
    grammarPointKey: 'tr-a2-enumerator-tane',
    type: ExerciseType.CLOZE,
    surface: 'tane',
    signal: 'answer-surface',
    reason:
      'The enumerator `tane` is the single target form of the point; a cloze blank on it admits no other answer.',
    dismissedOn: '2026-08-11',
  },
  {
    grammarPointKey: 'es-b1-adjective-de-infinitive',
    type: ExerciseType.CLOZE,
    surface: 'de',
    signal: 'answer-surface',
    reason:
      'The point is the fixed `adjective + de + infinitive` frame; `de` is invariant, and the adjective/infinitive variation is outside this metric.',
    dismissedOn: '2026-08-11',
  },
]);

/** True when the ledger already accounts for this exact finding. */
export function isDismissed(
  grammarPointKey: string,
  type: ExerciseType,
  surface: string,
  signal: CollapseSignal,
): boolean {
  return COLLAPSE_DISMISSALS.some(
    (d) =>
      d.grammarPointKey === grammarPointKey &&
      d.type === type &&
      d.signal === signal &&
      (d.surface === null || d.surface === surface),
  );
}
```

- [ ] **Step 4: Re-export from both barrels**

Append to `packages/db/src/curriculum/index.ts`:

```ts
export { COLLAPSE_DISMISSALS, isDismissed } from './collapse-dismissals';
export type { CollapseDismissal, CollapseSignal } from './collapse-dismissals';
```

Append to `packages/db/src/index.ts` (near the existing `validateBookCoverage` book-coverage re-export, which is the closest precedent — another dev-time curriculum-metadata ledger):

```ts
// Collapse-dismissals ledger (dev-time metadata; see the 2026-08-11 design doc).
export { COLLAPSE_DISMISSALS, isDismissed } from './curriculum/collapse-dismissals';
export type { CollapseDismissal, CollapseSignal } from './curriculum/collapse-dismissals';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/db test -- curriculum`
Expected: PASS. If the "point actually has a cell for this type" assertion fails on any seeded entry, that entry's `type` is wrong — fix the entry, do not weaken the test.

- [ ] **Step 6: Rebuild and run the full gate**

`packages/ai` resolves `@language-drill/db` through its `dist`, so a stale build makes the next task's imports fail confusingly.

Run: `pnpm build && pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/curriculum/collapse-dismissals.ts packages/db/src/curriculum/index.ts \
  packages/db/src/index.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "feat(db): collapse-dismissals ledger

Committed record of every 'this concentration is correct' judgement, so the
audit stops re-triaging known-legitimate cells. Keyed on point+type+surface
so a later, different collapse on a dismissed cell still reports. Seeded
from PR #631's metric-false-positive set.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Triage prompt, tool, and parser

Pure half of the triage module: the system prompt, the user-prompt builder, the forced-tool schema, and the validating parser. No network. Mirrors `coverage-spec-proposal.ts` exactly.

**Files:**
- Create: `packages/ai/src/collapse-triage.ts`
- Create: `packages/ai/src/collapse-triage.test.ts`

**Interfaces:**
- Consumes: `GrammarPoint`, `CoverageAxis`, `COVERAGE_AXIS_VALUES` from `@language-drill/shared`; `SurfaceDistribution`, `StemMonotony` from `./collapse-metrics.js`.
- Produces: `COLLAPSE_TRIAGE_PROMPT_VERSION`, `COLLAPSE_TRIAGE_MODEL`, `COLLAPSE_TRIAGE_TOOL_NAME`, `COLLAPSE_TRIAGE_SYSTEM_PROMPT`, `COLLAPSE_TRIAGE_TOOL`, `type TriageInput`, `type TriageVerdict`, `buildTriageUserPrompt()`, `parseTriageVerdict()`. Task 7 adds `triageCell()`; Task 9 calls it.

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/collapse-triage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import type { GrammarPoint } from '@language-drill/shared';
import {
  buildTriageUserPrompt,
  parseTriageVerdict,
  COLLAPSE_TRIAGE_SYSTEM_PROMPT,
  COLLAPSE_TRIAGE_TOOL,
} from './collapse-triage.js';

const gp: GrammarPoint = {
  key: 'de-b1-um-zu-damit',
  kind: 'grammar',
  name: 'Purpose clauses: um … zu vs. damit',
  description: 'Purpose clauses with um … zu (same subject) and damit (different subject).',
  cefrLevel: 'B1',
  language: 'DE',
  examplesPositive: ['Ich lerne, um zu bestehen.', 'Ich helfe, damit du Zeit hast.'],
  examplesNegative: ['*Ich lerne, um ich bestehe.'],
  commonErrors: ['Using damit when the subject is shared.'],
} as GrammarPoint;

const input = {
  grammarPoint: gp,
  exerciseType: ExerciseType.CLOZE,
  approved: 50,
  target: 50,
  signal: 'answer-surface' as const,
  surface: {
    topSurface: 'damit',
    topCount: 49,
    total: 50,
    share: 0.98,
    distribution: [
      { surface: 'damit', count: 49 },
      { surface: 'um', count: 1 },
    ],
  },
  monotony: null,
};

describe('buildTriageUserPrompt', () => {
  it('includes the point text the verdict depends on', () => {
    const p = buildTriageUserPrompt(input);
    expect(p).toContain('de-b1-um-zu-damit');
    expect(p).toContain('Purpose clauses with um … zu');
    expect(p).toContain('Ich lerne, um zu bestehen.');
    expect(p).toContain('Using damit when the subject is shared.');
  });

  it('includes the observed distribution with counts and the share', () => {
    const p = buildTriageUserPrompt(input);
    expect(p).toContain('damit: 49');
    expect(p).toContain('98%');
  });

  it('states the declared config so the model cannot recommend a duplicate axis', () => {
    const withSpec = buildTriageUserPrompt({
      ...input,
      grammarPoint: {
        ...gp,
        coverageSpec: { axes: [{ name: 'polarity', floors: { affirmative: 10, negative: 8 } }] },
      } as GrammarPoint,
    });
    expect(withSpec).toContain('polarity');
    expect(buildTriageUserPrompt(input)).toContain('none declared');
  });
});

describe('COLLAPSE_TRIAGE_SYSTEM_PROMPT', () => {
  it('names the legitimate-concentration default and its worked examples', () => {
    expect(COLLAPSE_TRIAGE_SYSTEM_PROMPT).toContain('legitimate-concentration');
    expect(COLLAPSE_TRIAGE_SYSTEM_PROMPT).toContain('es-a2-personal-a');
    expect(COLLAPSE_TRIAGE_SYSTEM_PROMPT).toContain('es-b1-ser-location-events');
  });

  it('warns against recommending an axis a variant already hard-codes', () => {
    expect(COLLAPSE_TRIAGE_SYSTEM_PROMPT).toContain('constructionVariants');
  });
});

describe('parseTriageVerdict', () => {
  it('accepts a well-formed collapsed verdict recommending construction variants', () => {
    const v = parseTriageVerdict({
      verdict: 'collapsed',
      mechanism: 'construction-variants',
      missingConstructions: ['um … zu, same subject'],
      rationale: 'The point is the um-zu/damit contrast; um…zu is never drilled.',
      confidence: 'high',
    });
    expect(v.verdict).toBe('collapsed');
    expect(v.mechanism).toBe('construction-variants');
    expect(v.missingConstructions).toEqual(['um … zu, same subject']);
  });

  it('accepts a coverage-spec verdict carrying a legal axis', () => {
    const v = parseTriageVerdict({
      verdict: 'collapsed',
      mechanism: 'coverage-spec',
      axis: 'person',
      rationale: 'Every approved row is 3sg on a point claiming a full paradigm.',
      confidence: 'medium',
    });
    expect(v.axis).toBe('person');
  });

  it('accepts a dismissal without a mechanism', () => {
    const v = parseTriageVerdict({
      verdict: 'legitimate-concentration',
      rationale: 'The marker is the point; no other answer exists.',
      confidence: 'high',
    });
    expect(v.mechanism).toBeUndefined();
  });

  it('rejects an unknown verdict', () => {
    expect(() => parseTriageVerdict({ verdict: 'maybe', rationale: 'x', confidence: 'low' })).toThrow(
      /verdict/,
    );
  });

  it('rejects a collapsed verdict with no mechanism — the finding would not be actionable', () => {
    expect(() =>
      parseTriageVerdict({ verdict: 'collapsed', rationale: 'x', confidence: 'low' }),
    ).toThrow(/mechanism/);
  });

  it('rejects an axis on a non-coverage-spec mechanism', () => {
    expect(() =>
      parseTriageVerdict({
        verdict: 'collapsed',
        mechanism: 'seed-pool',
        axis: 'person',
        rationale: 'x',
        confidence: 'low',
      }),
    ).toThrow(/axis/);
  });

  it('rejects a coverage-spec mechanism with no axis', () => {
    expect(() =>
      parseTriageVerdict({
        verdict: 'collapsed',
        mechanism: 'coverage-spec',
        rationale: 'x',
        confidence: 'low',
      }),
    ).toThrow(/axis/);
  });

  it('rejects an unknown axis', () => {
    expect(() =>
      parseTriageVerdict({
        verdict: 'collapsed',
        mechanism: 'coverage-spec',
        axis: 'tense',
        rationale: 'x',
        confidence: 'low',
      }),
    ).toThrow(/axis/);
  });

  it('rejects a missing or empty rationale', () => {
    expect(() =>
      parseTriageVerdict({ verdict: 'metric-artifact', rationale: '', confidence: 'low' }),
    ).toThrow(/rationale/);
  });

  it('rejects an unknown confidence', () => {
    expect(() =>
      parseTriageVerdict({ verdict: 'metric-artifact', rationale: 'x', confidence: 'certain' }),
    ).toThrow(/confidence/);
  });

  it('rejects a non-object', () => {
    expect(() => parseTriageVerdict(null)).toThrow();
    expect(() => parseTriageVerdict([])).toThrow();
  });
});

describe('COLLAPSE_TRIAGE_TOOL', () => {
  it('forces the four fields the parser requires', () => {
    expect(COLLAPSE_TRIAGE_TOOL.input_schema.required).toEqual(['verdict', 'rationale', 'confidence']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- collapse-triage`
Expected: FAIL — cannot resolve `./collapse-triage.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/ai/src/collapse-triage.ts`:

```ts
/**
 * Pool-collapse triage (2026-08-11 design). In-repo prompt + forced tool + pure
 * parser, mirroring `coverage-spec-proposal.ts`. NOT a runtime Lambda path and
 * NOT registered in Langfuse — a dev-time aid run by a human via the
 * `audit:collapse` CLI. Do NOT add it to the PROMPTS manifest in
 * `bootstrap-prompts.ts`. Bump the version constant on prompt edits.
 *
 * The model's job is JUDGEMENT, not authoring: it says whether a measured
 * concentration is a real defect and WHICH MECHANISM fixes it. It never writes a
 * spec — `propose:coverage-spec` already covers that half.
 */

import type Anthropic from '@anthropic-ai/sdk';

import { COVERAGE_AXIS_VALUES, ExerciseType } from '@language-drill/shared';
import type { CoverageAxis, GrammarPoint } from '@language-drill/shared';

import type { StemMonotony, SurfaceDistribution } from './collapse-metrics.js';

export const COLLAPSE_TRIAGE_PROMPT_VERSION = 'collapse-triage@2026-08-11';
export const COLLAPSE_TRIAGE_TOOL_NAME = 'report_collapse_verdict';
export const COLLAPSE_TRIAGE_MODEL = 'claude-sonnet-4-6';
export const COLLAPSE_TRIAGE_MAX_TOKENS = 1024;
export const COLLAPSE_TRIAGE_TEMPERATURE = 0.2;

const VERDICTS = ['collapsed', 'legitimate-concentration', 'metric-artifact'] as const;
const MECHANISMS = ['coverage-spec', 'construction-variants', 'seed-pool'] as const;
const CONFIDENCES = ['high', 'medium', 'low'] as const;

export type CollapseVerdictName = (typeof VERDICTS)[number];
export type CollapseMechanism = (typeof MECHANISMS)[number];
export type CollapseConfidence = (typeof CONFIDENCES)[number];

export type TriageVerdict = {
  verdict: CollapseVerdictName;
  mechanism?: CollapseMechanism;
  axis?: CoverageAxis;
  missingConstructions?: string[];
  rationale: string;
  confidence: CollapseConfidence;
};

export type TriageInput = {
  grammarPoint: GrammarPoint;
  exerciseType: ExerciseType;
  approved: number;
  target: number;
  signal: 'answer-surface' | 'stem-monotony';
  surface: SurfaceDistribution | null;
  monotony: StemMonotony | null;
};

export const COLLAPSE_TRIAGE_SYSTEM_PROMPT = `You audit a pre-generated language-exercise pool for DISTRIBUTIONAL defects.

A generator builds a pool of exercises per grammar point, one draft at a time. Neither the generator nor the per-draft validator can see the pool's overall distribution, so a pool can silently collapse onto one exemplar while every individual exercise looks fine. You are shown one cell's measured distribution and the grammar point it belongs to. Decide whether the concentration is a DEFECT or CORRECT.

Return one of three verdicts:

- "collapsed" — the point's own text claims content the pool does not drill. Only this verdict requires a mechanism.
- "legitimate-concentration" — the concentration is correct for this point. THIS IS THE DEFAULT WHEN YOU ARE UNSURE.
- "metric-artifact" — the measurement is misleading (e.g. the metric reads a field that does not carry the point's variation), so there is nothing to conclude.

A concentration is a DEFECT only when all three hold:
1. CLAIMED — the missing member appears in the point's own description, examples, or common errors. If it is not the point's content, do not demand it.
2. COLLAPSE-PRONE — free generation defaults to the unmarked member (3rd-person singular, affirmative, singular, declarative), so the missing member needs an explicit directive to appear.
3. FORM-RELEVANT — the missing member produces a different target surface form. A pure meaning contrast does not need a distributional floor.

Legitimate concentration is COMMON. Two worked examples you must not misjudge:
- es-a2-personal-a: the personal "a" IS the point, so a cloze on it has exactly one correct answer. 100% concentration is the target state.
- es-b1-ser-location-events: a ser/estar contrast where "ser" is the answer and "estar" is the DISTRACTOR, not an alternative answer. 94% "ser" is correct.

When the verdict is "collapsed", name the mechanism that fixes it:

- "coverage-spec" — the missing variation is a CATEGORICAL grammatical axis from this closed set: person, number, case, wordClass, polarity, sentenceType, comparison. Give the axis. Choose this ONLY if one of those axis names genuinely separates what is present from what is missing.
- "construction-variants" — the point enumerates several distinct CONSTRUCTIONS and the pool drills only one. No coverage axis can express this (a hearsay "dicen que" and an adversity "me robaron la cartera" are both third-person plural, so no person floor separates them). List the missing constructions in a few words each. Most multi-construction and connector points land here.
- "seed-pool" — the collapse is LEXICAL, not grammatical: the same lemma or content word recurs while the grammar varies correctly. The fix is a curated seed word list, not a distributional floor.

Two hard constraints:
- NEVER recommend a coverage-spec axis that the point's declared constructionVariants already hard-code. Both mechanisms emit an independent MUST clause into the same per-draft prompt and nothing reconciles them; a contradictory pair makes the model drop one, corrupting whichever it drops. If the declared variants already pin polarity or sentence type, that axis is taken.
- NEVER recommend a mechanism the point has already declared and which simply has not been realized in the pool. That is a separate, already-detected finding.

Call the ${COLLAPSE_TRIAGE_TOOL_NAME} tool. Keep the rationale to one sentence.`;

function describeDeclaredConfig(gp: GrammarPoint): string {
  const parts: string[] = [];
  if (gp.coverageSpec) {
    parts.push(
      `coverageSpec axes: ${gp.coverageSpec.axes
        .map((a) => `${a.name} {${Object.entries(a.floors).map(([v, f]) => `${v}: ${f}`).join(', ')}}`)
        .join('; ')}`,
    );
  }
  if (gp.constructionVariants?.length) {
    parts.push(
      `constructionVariants: ${gp.constructionVariants.map((v) => v.id).join(', ')}`,
    );
  }
  if (gp.conjugationSeedWords?.length) {
    parts.push(`conjugationSeedWords: ${gp.conjugationSeedWords.length} curated entries`);
  }
  if (gp.elicitationSeedValues?.length) {
    parts.push(`elicitationSeedValues: ${gp.elicitationSeedValues.length} curated entries`);
  }
  return parts.length > 0 ? parts.join('\n') : 'none declared';
}

export function buildTriageUserPrompt(input: TriageInput): string {
  const { grammarPoint: gp } = input;
  const observed =
    input.signal === 'answer-surface' && input.surface
      ? [
          `Metric: top answer-surface share = ${Math.round(input.surface.share * 100)}% (${input.surface.topCount}/${input.surface.total} rows share the surface "${input.surface.topSurface}")`,
          'Observed distribution (top surfaces):',
          ...input.surface.distribution.map((d) => `  ${d.surface}: ${d.count}`),
        ].join('\n')
      : input.monotony
        ? [
            `Metric: top content-lemma share across exercise stems = ${Math.round(input.monotony.share * 100)}% (${input.monotony.count}/${input.monotony.total} stems contain "${input.monotony.topLemma}")`,
            'This measures SCENE repetition, not grammatical collapse.',
          ].join('\n')
        : 'Metric: (none)';

  return `Grammar point: ${gp.name} (${gp.key}, ${gp.language} ${gp.cefrLevel})
Description: ${gp.description}
Positive examples: ${gp.examplesPositive.join(' | ')}
Negative examples: ${gp.examplesNegative.join(' | ')}
Common errors: ${gp.commonErrors.join(' | ')}

Exercise type: ${input.exerciseType}
Approved rows: ${input.approved} (cell target ${input.target})

Already declared on this point:
${describeDeclaredConfig(gp)}

${observed}

Is this concentration a defect?`;
}

export const COLLAPSE_TRIAGE_TOOL: Anthropic.Tool = {
  name: COLLAPSE_TRIAGE_TOOL_NAME,
  description: 'Report the triage verdict for one measured cell concentration.',
  input_schema: {
    type: 'object' as const,
    properties: {
      verdict: { type: 'string', enum: [...VERDICTS] },
      mechanism: {
        type: 'string',
        enum: [...MECHANISMS],
        description: 'Required when verdict is "collapsed"; omit otherwise.',
      },
      axis: {
        type: 'string',
        enum: Object.keys(COVERAGE_AXIS_VALUES),
        description: 'Required when mechanism is "coverage-spec"; forbidden otherwise.',
      },
      missingConstructions: {
        type: 'array',
        items: { type: 'string' },
        description: 'A few words each; used when mechanism is "construction-variants".',
      },
      rationale: { type: 'string', description: 'One sentence.' },
      confidence: { type: 'string', enum: [...CONFIDENCES] },
    },
    required: ['verdict', 'rationale', 'confidence'],
  },
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Pure validator for the tool output. Throws on any illegality — the CLI catches
 * per cell and records the failure rather than aborting the run.
 *
 * The cross-field rules are the ones that matter: a "collapsed" verdict with no
 * mechanism is not actionable, and an `axis` on a non-coverage-spec mechanism
 * means the model conflated the two fixes.
 */
export function parseTriageVerdict(input: unknown): TriageVerdict {
  if (!isObject(input)) throw new Error('verdict must be an object');

  const verdict = input.verdict;
  if (typeof verdict !== 'string' || !(VERDICTS as readonly string[]).includes(verdict)) {
    throw new Error(`unknown verdict '${String(verdict)}'`);
  }
  const rationale = input.rationale;
  if (typeof rationale !== 'string' || rationale.trim().length === 0) {
    throw new Error('rationale must be a non-empty string');
  }
  const confidence = input.confidence;
  if (typeof confidence !== 'string' || !(CONFIDENCES as readonly string[]).includes(confidence)) {
    throw new Error(`unknown confidence '${String(confidence)}'`);
  }

  const result: TriageVerdict = {
    verdict: verdict as CollapseVerdictName,
    rationale: rationale.trim(),
    confidence: confidence as CollapseConfidence,
  };

  const mechanism = input.mechanism;
  if (mechanism !== undefined) {
    if (typeof mechanism !== 'string' || !(MECHANISMS as readonly string[]).includes(mechanism)) {
      throw new Error(`unknown mechanism '${String(mechanism)}'`);
    }
    result.mechanism = mechanism as CollapseMechanism;
  }
  if (result.verdict === 'collapsed' && result.mechanism === undefined) {
    throw new Error("verdict 'collapsed' requires a mechanism");
  }

  const axis = input.axis;
  if (axis !== undefined) {
    if (result.mechanism !== 'coverage-spec') {
      throw new Error("axis is only legal when mechanism is 'coverage-spec'");
    }
    if (typeof axis !== 'string' || !(axis in COVERAGE_AXIS_VALUES)) {
      throw new Error(`unknown axis '${String(axis)}'`);
    }
    result.axis = axis as CoverageAxis;
  }
  if (result.mechanism === 'coverage-spec' && result.axis === undefined) {
    throw new Error("mechanism 'coverage-spec' requires an axis");
  }

  const missing = input.missingConstructions;
  if (missing !== undefined) {
    if (!Array.isArray(missing) || missing.some((m) => typeof m !== 'string')) {
      throw new Error('missingConstructions must be an array of strings');
    }
    result.missingConstructions = missing as string[];
  }

  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- collapse-triage`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/collapse-triage.ts packages/ai/src/collapse-triage.test.ts
git commit -m "feat(ai): collapse-triage prompt, forced tool, and parser

The verdict carries a MECHANISM (coverage-spec / construction-variants /
seed-pool), not just 'collapsed' — a triage that could only recommend a
coverage axis would misfile every PR #631 case, since no CoverageAxis can
express the um-zu vs damit contrast.

In-repo prompt, not Langfuse-registered (dev-time aid).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The `triageCell()` client call

**Files:**
- Modify: `packages/ai/src/collapse-triage.ts`
- Modify: `packages/ai/src/collapse-triage.test.ts`
- Modify: `packages/ai/src/index.ts`

**Interfaces:**
- Consumes: `TriageInput`, `parseTriageVerdict`, `COLLAPSE_TRIAGE_TOOL` (Task 6).
- Produces: `triageCell(client, input, signal?): Promise<{ verdict: TriageVerdict; usage: Anthropic.Usage }>`. Task 9 calls it.

- [ ] **Step 1: Write the failing test**

Append to `packages/ai/src/collapse-triage.test.ts`:

```ts
import { vi } from 'vitest';
import { triageCell, COLLAPSE_TRIAGE_TOOL_NAME, COLLAPSE_TRIAGE_MODEL } from './collapse-triage.js';
import type Anthropic from '@anthropic-ai/sdk';

const fakeClient = (content: unknown[], stopReason = 'tool_use') =>
  ({
    messages: {
      create: vi.fn().mockResolvedValue({ content, stop_reason: stopReason, usage: { input_tokens: 900, output_tokens: 120 } }),
    },
  }) as unknown as Anthropic;

describe('triageCell', () => {
  const toolUse = {
    type: 'tool_use',
    name: COLLAPSE_TRIAGE_TOOL_NAME,
    id: 't1',
    input: {
      verdict: 'collapsed',
      mechanism: 'construction-variants',
      missingConstructions: ['um … zu'],
      rationale: 'um…zu is never drilled.',
      confidence: 'high',
    },
  };

  it('forces the tool and returns the parsed verdict plus usage', async () => {
    const client = fakeClient([toolUse]);
    const { verdict, usage } = await triageCell(client, input);
    expect(verdict.mechanism).toBe('construction-variants');
    expect(usage.input_tokens).toBe(900);

    const call = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.model).toBe(COLLAPSE_TRIAGE_MODEL);
    expect(call.tool_choice).toEqual({ type: 'tool', name: COLLAPSE_TRIAGE_TOOL_NAME });
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('throws a diagnostic error when no tool_use block comes back', async () => {
    await expect(triageCell(fakeClient([{ type: 'text', text: 'hm' }], 'end_turn'), input)).rejects.toThrow(
      /no tool_use block .*end_turn/,
    );
  });

  it('propagates a parser error for a malformed verdict', async () => {
    const bad = { ...toolUse, input: { verdict: 'collapsed', rationale: 'x', confidence: 'low' } };
    await expect(triageCell(fakeClient([bad]), input)).rejects.toThrow(/mechanism/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- collapse-triage`
Expected: FAIL — `triageCell is not exported`.

- [ ] **Step 3: Write the implementation**

Append to `packages/ai/src/collapse-triage.ts`:

```ts
/**
 * Call Claude with the forced tool and return the validated verdict plus token
 * usage (the CLI's cost guard needs it). The system prompt is cache-marked: a
 * run triages many cells against an identical system block, so prompt caching
 * makes all but the first call cheap.
 */
export async function triageCell(
  client: Anthropic,
  input: TriageInput,
  signal?: AbortSignal,
): Promise<{ verdict: TriageVerdict; usage: Anthropic.Usage }> {
  const response = await client.messages.create(
    {
      model: COLLAPSE_TRIAGE_MODEL,
      max_tokens: COLLAPSE_TRIAGE_MAX_TOKENS,
      system: [
        {
          type: 'text' as const,
          text: COLLAPSE_TRIAGE_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user' as const, content: buildTriageUserPrompt(input) }],
      tools: [COLLAPSE_TRIAGE_TOOL],
      tool_choice: { type: 'tool' as const, name: COLLAPSE_TRIAGE_TOOL_NAME },
      temperature: COLLAPSE_TRIAGE_TEMPERATURE,
    },
    { signal },
  );
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) {
    throw new Error(`triage: no tool_use block (stop_reason ${response.stop_reason})`);
  }
  return { verdict: parseTriageVerdict(toolUse.input), usage: response.usage };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- collapse-triage`
Expected: PASS, 20 tests.

- [ ] **Step 5: Export from the ai barrel**

Append to `packages/ai/src/index.ts`:

```ts
export {
  COLLAPSE_TRIAGE_PROMPT_VERSION,
  COLLAPSE_TRIAGE_MODEL,
  COLLAPSE_TRIAGE_TOOL_NAME,
  COLLAPSE_TRIAGE_SYSTEM_PROMPT,
  COLLAPSE_TRIAGE_TOOL,
  buildTriageUserPrompt,
  parseTriageVerdict,
  triageCell,
} from "./collapse-triage.js";
export type {
  TriageInput,
  TriageVerdict,
  CollapseMechanism,
  CollapseVerdictName,
  CollapseConfidence,
} from "./collapse-triage.js";
```

- [ ] **Step 6: Full gate and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures.

```bash
git add packages/ai/src/collapse-triage.ts packages/ai/src/collapse-triage.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): triageCell — forced-tool triage call with usage capture

Cache-marks the system prompt: a run triages many cells against an
identical system block, so all but the first call are cheap.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: CLI — cell loading and assembly

The CLI's data half: enumerate curriculum cells, load approved rows per cell in one query, and assemble `AuditCell` records. The pure helpers are tested; the query itself is exercised by the Task 11 prod run.

**Files:**
- Create: `packages/ai/scripts/audit-collapse.ts`
- Create: `packages/ai/scripts/audit-collapse.test.ts`

**Interfaces:**
- Consumes: `createDb`, `requireEnv`, `exercises`, `ALL_CURRICULA`, `getGrammarPoint`, `compatibleTypes`, `COLLAPSE_DISMISSALS`, `isDismissed` from `@language-drill/db`; `resolveCellTargetFor` from `@language-drill/shared`; everything from `../src/collapse-metrics.js`.
- Produces: `type AuditCell`, `type AuditFilters`, `parseAuditArgs()`, `groupRowsIntoCells()`, `cellKeyOf()`. Task 9 consumes all of them.

- [ ] **Step 1: Write the failing test**

Create `packages/ai/scripts/audit-collapse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import { cellKeyOf, groupRowsIntoCells, parseAuditArgs, type LoadedRow } from './audit-collapse.js';

describe('cellKeyOf', () => {
  it('renders the canonical language:level:type:point key', () => {
    expect(cellKeyOf('ES', 'B1', ExerciseType.CLOZE, 'es-b1-impersonal-plural')).toBe(
      'ES:B1:cloze:es-b1-impersonal-plural',
    );
  });
});

describe('parseAuditArgs', () => {
  it('defaults to the PR #631 sweep thresholds', () => {
    const a = parseAuditArgs([]);
    expect(a.minRows).toBe(15);
    expect(a.threshold).toBe(0.65);
    expect(a.dryRun).toBe(false);
  });

  it('uppercases the language filter so `--language es` works', () => {
    expect(parseAuditArgs(['--language', 'es']).language).toBe('ES');
  });

  it('uppercases the cefr filter', () => {
    expect(parseAuditArgs(['--cefr', 'b1']).cefr).toBe('B1');
  });

  it('parses numeric flags', () => {
    const a = parseAuditArgs(['--min-rows', '25', '--threshold', '0.8', '--max-cost-usd', '5']);
    expect(a.minRows).toBe(25);
    expect(a.threshold).toBe(0.8);
    expect(a.maxCostUsd).toBe(5);
  });

  it('rejects a threshold outside (0, 1]', () => {
    expect(() => parseAuditArgs(['--threshold', '1.5'])).toThrow(/threshold/);
    expect(() => parseAuditArgs(['--threshold', '0'])).toThrow(/threshold/);
  });

  it('rejects a non-positive min-rows', () => {
    expect(() => parseAuditArgs(['--min-rows', '0'])).toThrow(/min-rows/);
  });

  it('--dry-run skips triage', () => {
    expect(parseAuditArgs(['--dry-run']).dryRun).toBe(true);
  });
});

describe('groupRowsIntoCells', () => {
  const row = (over: Partial<LoadedRow> = {}): LoadedRow => ({
    id: `id-${Math.random()}`,
    type: 'cloze',
    language: 'ES',
    difficulty: 'B1',
    grammarPointKey: 'es-b1-impersonal-plural',
    contentJson: { correctAnswer: 'Dicen' },
    coverageTags: null,
    ...over,
  });

  it('groups rows by (language, level, type, point) and resolves the target', () => {
    const cells = groupRowsIntoCells([row(), row(), row({ type: 'translation' })]);
    expect(cells).toHaveLength(2);
    const cloze = cells.find((c) => c.exerciseType === ExerciseType.CLOZE)!;
    expect(cloze.rows).toHaveLength(2);
    expect(cloze.target).toBeGreaterThan(0);
    expect(cloze.grammarPoint.key).toBe('es-b1-impersonal-plural');
  });

  it('drops rows whose grammar point is no longer in the curriculum', () => {
    expect(groupRowsIntoCells([row({ grammarPointKey: 'es-b1-deleted-point' })])).toHaveLength(0);
  });

  it('drops rows with a null grammar point key or an unknown exercise type', () => {
    expect(groupRowsIntoCells([row({ grammarPointKey: null })])).toHaveLength(0);
    expect(groupRowsIntoCells([row({ type: 'listening' })])).toHaveLength(0);
  });

  it('coerces a null contentJson to an empty object rather than throwing', () => {
    const cells = groupRowsIntoCells([row({ contentJson: null })]);
    expect(cells[0].rows[0].content).toEqual({});
  });

  it('sorts cells deterministically by cellKey', () => {
    const cells = groupRowsIntoCells([
      row({ type: 'translation' }),
      row({ type: 'cloze' }),
      row({ type: 'conjugation' }),
    ]);
    expect(cells.map((c) => c.cellKey)).toEqual([...cells.map((c) => c.cellKey)].sort());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- audit-collapse`
Expected: FAIL — cannot resolve `./audit-collapse.js`.

- [ ] **Step 3: Write the loading half of the CLI**

Create `packages/ai/scripts/audit-collapse.ts`:

```ts
/**
 * packages/ai — audit:collapse CLI. Measures distributional collapse in the
 * approved exercise pool, triages each flagged cell with one Anthropic call, and
 * writes a JSON + markdown report to ./audit-runs/<name>.{json,md}.
 *
 * READ-ONLY on the database. Author-run; a spotlight, not a gate.
 * See docs/superpowers/specs/2026-08-11-pool-collapse-audit-design.md.
 *
 * Usage:
 *   pnpm audit:collapse -- --dry-run
 *   pnpm audit:collapse -- --language ES --cefr B1 --max-cost-usd 2
 */

import { parseArgs } from 'node:util';

import { and, inArray, isNotNull, sql } from 'drizzle-orm';

import { ExerciseType, resolveCellTargetFor } from '@language-drill/shared';
import type { CoverageTags, CurriculumCefrLevel, GrammarPoint, LearningLanguage } from '@language-drill/shared';
import { createDb, exercises, getGrammarPoint } from '@language-drill/db';

import type { AuditRow } from '../src/collapse-metrics.js';

/** One row as loaded from Postgres, before curriculum resolution. */
export type LoadedRow = {
  id: string;
  type: string | null;
  language: string | null;
  difficulty: string | null;
  grammarPointKey: string | null;
  contentJson: Record<string, unknown> | null;
  coverageTags: CoverageTags | null;
};

export type AuditCell = {
  cellKey: string;
  language: LearningLanguage;
  cefrLevel: CurriculumCefrLevel;
  exerciseType: ExerciseType;
  grammarPoint: GrammarPoint;
  target: number;
  rows: AuditRow[];
};

export type AuditFilters = {
  language?: string;
  cefr?: string;
  type?: string;
  grammarPoint?: string;
  limit?: number;
  minRows: number;
  threshold: number;
  monotonyThreshold: number;
  maxCostUsd: number;
  dryRun: boolean;
  name: string;
};

const EXERCISE_TYPES = new Set<string>(Object.values(ExerciseType));

export function cellKeyOf(
  language: string,
  cefrLevel: string,
  type: ExerciseType,
  grammarPointKey: string,
): string {
  return `${language}:${cefrLevel}:${type}:${grammarPointKey}`;
}

export function parseAuditArgs(argv: string[]): AuditFilters {
  const { values } = parseArgs({
    args: argv,
    options: {
      language: { type: 'string' },
      cefr: { type: 'string' },
      type: { type: 'string' },
      'grammar-point': { type: 'string' },
      limit: { type: 'string' },
      'min-rows': { type: 'string', default: '15' },
      threshold: { type: 'string', default: '0.65' },
      'monotony-threshold': { type: 'string', default: '0.5' },
      'max-cost-usd': { type: 'string', default: '2' },
      'dry-run': { type: 'boolean', default: false },
      name: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(
      'Usage: audit:collapse [--language ES] [--cefr B1] [--type cloze] [--grammar-point <key>]\n' +
        '                     [--limit N] [--min-rows 15] [--threshold 0.65]\n' +
        '                     [--monotony-threshold 0.5] [--max-cost-usd 2] [--dry-run] [--name <run>]',
    );
    process.exit(0);
  }

  const minRows = Number(values['min-rows']);
  if (!Number.isInteger(minRows) || minRows < 1) {
    throw new Error(`--min-rows must be a positive integer, got '${values['min-rows']}'`);
  }
  const threshold = Number(values.threshold);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new Error(`--threshold must be in (0, 1], got '${values.threshold}'`);
  }
  const monotonyThreshold = Number(values['monotony-threshold']);
  if (!Number.isFinite(monotonyThreshold) || monotonyThreshold <= 0 || monotonyThreshold > 1) {
    throw new Error(`--monotony-threshold must be in (0, 1], got '${values['monotony-threshold']}'`);
  }
  const maxCostUsd = Number(values['max-cost-usd']);
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
    throw new Error(`--max-cost-usd must be positive, got '${values['max-cost-usd']}'`);
  }
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error(`--limit must be a positive integer, got '${values.limit}'`);
  }

  return {
    // Uppercased so `--language es` works: the DB stores 'ES' / 'B1'. The
    // qa:sample CLI has the same footgun and requires uppercase by hand.
    language: values.language?.toUpperCase(),
    cefr: values.cefr?.toUpperCase(),
    type: values.type,
    grammarPoint: values['grammar-point'],
    limit,
    minRows,
    threshold,
    monotonyThreshold,
    maxCostUsd,
    dryRun: values['dry-run'] ?? false,
    name: values.name ?? 'audit-collapse',
  };
}

/**
 * Group loaded rows into cells, resolving each against the live curriculum.
 * Rows are dropped (not errored) when their grammar point no longer exists or
 * their type is not a current `ExerciseType` — the pool outlives curriculum
 * edits, and a retired point is not an audit finding.
 */
export function groupRowsIntoCells(rows: readonly LoadedRow[]): AuditCell[] {
  const cells = new Map<string, AuditCell>();

  for (const r of rows) {
    if (!r.grammarPointKey || !r.type || !r.language || !r.difficulty) continue;
    if (!EXERCISE_TYPES.has(r.type)) continue;
    const gp = getGrammarPoint(r.grammarPointKey);
    if (!gp) continue;

    const exerciseType = r.type as ExerciseType;
    const cefrLevel = r.difficulty as CurriculumCefrLevel;
    const key = cellKeyOf(r.language, r.difficulty, exerciseType, r.grammarPointKey);

    let cell = cells.get(key);
    if (!cell) {
      cell = {
        cellKey: key,
        language: r.language as LearningLanguage,
        cefrLevel,
        exerciseType,
        grammarPoint: gp,
        target: resolveCellTargetFor({ exerciseType, cefrLevel, grammarPoint: gp }),
        rows: [],
      };
      cells.set(key, cell);
    }
    cell.rows.push({
      id: r.id,
      type: exerciseType,
      content: r.contentJson ?? {},
      coverageTags: r.coverageTags,
    });
  }

  return [...cells.values()].sort((a, b) => a.cellKey.localeCompare(b.cellKey));
}

/** Load every approved row matching the filters. Read-only. */
export async function loadApprovedRows(
  db: ReturnType<typeof createDb>,
  filters: AuditFilters,
): Promise<LoadedRow[]> {
  const conditions = [
    inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']),
    isNotNull(exercises.grammarPointKey),
  ];
  if (filters.language) conditions.push(sql`${exercises.language} = ${filters.language}`);
  if (filters.cefr) conditions.push(sql`${exercises.difficulty} = ${filters.cefr}`);
  if (filters.type) conditions.push(sql`${exercises.type} = ${filters.type}`);
  if (filters.grammarPoint) {
    conditions.push(sql`${exercises.grammarPointKey} = ${filters.grammarPoint}`);
  }

  const rows = await db
    .select({
      id: exercises.id,
      type: exercises.type,
      language: exercises.language,
      difficulty: exercises.difficulty,
      grammarPointKey: exercises.grammarPointKey,
      contentJson: exercises.contentJson,
      coverageTags: exercises.coverageTags,
    })
    .from(exercises)
    .where(and(...conditions));

  return rows as LoadedRow[];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- audit-collapse`
Expected: PASS, 13 tests.

The `groupRowsIntoCells` tests resolve real curriculum points, so `es-b1-impersonal-plural` must exist. If it has been renamed, update the fixture key — do not stub `getGrammarPoint`.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/scripts/audit-collapse.ts packages/ai/scripts/audit-collapse.test.ts
git commit -m "feat(ai): audit:collapse cell loading and arg parsing

Read-only row load plus curriculum-resolved cell assembly. Rows whose
grammar point was retired are dropped, not errored — the pool outlives
curriculum edits.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: CLI — orchestration and report rendering

The judgement half: run the three signals, apply signal-2 pre-emption and the dismissals ledger, triage what remains under a cost guard, and render the report.

**Files:**
- Modify: `packages/ai/scripts/audit-collapse.ts`
- Modify: `packages/ai/scripts/audit-collapse.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–8.
- Produces: `type CellFinding`, `type AuditReport`, `analyzeCell()`, `estimateTriageCostUsd()`, `renderMarkdown()`, `main()`.

- [ ] **Step 1: Write the failing test**

Append to `packages/ai/scripts/audit-collapse.test.ts`:

```ts
import { analyzeCell, estimateTriageCostUsd, renderMarkdown, type CellFinding } from './audit-collapse.js';
import type { AuditCell } from './audit-collapse.js';
import type { GrammarPoint } from '@language-drill/shared';

const point = (extra: Partial<GrammarPoint> = {}): GrammarPoint =>
  ({
    key: 'es-b1-test',
    kind: 'grammar',
    name: 'Test point',
    description: 'A test point.',
    cefrLevel: 'B1',
    language: 'ES',
    examplesPositive: ['a', 'b'],
    examplesNegative: ['*c'],
    commonErrors: ['d'],
    ...extra,
  }) as GrammarPoint;

const cell = (gp: GrammarPoint, contents: Record<string, unknown>[]): AuditCell => ({
  cellKey: 'ES:B1:cloze:es-b1-test',
  language: 'ES',
  cefrLevel: 'B1',
  exerciseType: ExerciseType.CLOZE,
  grammarPoint: gp,
  target: 50,
  rows: contents.map((content, i) => ({
    id: `r${i}`,
    type: ExerciseType.CLOZE,
    content,
    coverageTags: null,
  })),
});

const opts = { minRows: 15, threshold: 0.65, monotonyThreshold: 0.5 };
const collapsed = Array.from({ length: 20 }, () => ({ correctAnswer: 'Dicen', sentence: 'x ___ y' }));

describe('analyzeCell', () => {
  it('flags surface collapse and marks it as needing triage', () => {
    const f = analyzeCell(cell(point(), collapsed), opts);
    expect(f.surfaceFlagged).toBe(true);
    expect(f.needsTriage).toBe(true);
  });

  it('does not flag a diverse cell', () => {
    const diverse = Array.from({ length: 20 }, (_, i) => ({
      correctAnswer: `w${i}`,
      // Every content token is unique per row. A `stem ${i}` shape would put the
      // literal word "stem" in all 20 stems — 100% monotony, flagged correctly.
      sentence: `frase${i} palabra${i}`,
    }));
    const f = analyzeCell(cell(point(), diverse), opts);
    expect(f.surfaceFlagged).toBe(false);
    expect(f.needsTriage).toBe(false);
  });

  it('signal 2 PRE-EMPTS triage: a declared mechanism the pool has not realized is the finding', () => {
    const withVariants = point({
      constructionVariants: [
        { id: 'hearsay', directive: 'H' },
        { id: 'adversity', directive: 'A' },
      ],
    });
    const f = analyzeCell(cell(withVariants, collapsed), opts);
    expect(f.surfaceFlagged).toBe(true);
    expect(f.variantSkew!.unrecognizedSeedCount).toBe(20);
    // Declared but unrealized — no LLM call is warranted or made.
    expect(f.needsTriage).toBe(false);
    expect(f.preempted).toBe(true);
  });

  it('does not pre-empt when the declared variants ARE realized', () => {
    const withVariants = point({
      constructionVariants: [
        { id: 'hearsay', directive: 'H' },
        { id: 'adversity', directive: 'A' },
      ],
    });
    const rows = [
      ...Array.from({ length: 16 }, () => ({ correctAnswer: 'Dicen', seedWord: 'hearsay' })),
      ...Array.from({ length: 4 }, () => ({ correctAnswer: 'Dicen', seedWord: 'adversity' })),
    ];
    const f = analyzeCell(cell(withVariants, rows), opts);
    expect(f.preempted).toBe(false);
    expect(f.needsTriage).toBe(true);
  });

  it('respects the dismissals ledger', () => {
    const dismissed = point({ key: 'es-a2-personal-a', cefrLevel: 'A2' });
    const rows = Array.from({ length: 20 }, () => ({ correctAnswer: 'a', sentence: 'x ___ y' }));
    const f = analyzeCell({ ...cell(dismissed, rows), cefrLevel: 'A2' }, opts);
    expect(f.surfaceFlagged).toBe(true);
    expect(f.dismissedByLedger).toBe(true);
    expect(f.needsTriage).toBe(false);
  });

  it('reports spec shortfalls without requesting triage', () => {
    const spec = point({
      coverageSpec: { axes: [{ name: 'person', floors: { '1sg': 5, '3sg': 5 } }] },
    });
    const f = analyzeCell(cell(spec, collapsed), opts);
    expect(f.specShortfall!.shortfalls).toHaveLength(2);
    expect(f.specShortfall!.atTarget).toBe(false); // 20 rows against target 50
  });
});

describe('estimateTriageCostUsd', () => {
  it('prices Sonnet input and output tokens', () => {
    // 1M input @ $3, 1M output @ $15
    expect(estimateTriageCostUsd({ input_tokens: 1_000_000, output_tokens: 0 } as never)).toBeCloseTo(3, 5);
    expect(estimateTriageCostUsd({ input_tokens: 0, output_tokens: 1_000_000 } as never)).toBeCloseTo(15, 5);
  });

  it('is zero for zero usage', () => {
    expect(estimateTriageCostUsd({ input_tokens: 0, output_tokens: 0 } as never)).toBe(0);
  });
});

describe('renderMarkdown', () => {
  const finding = (over: Partial<CellFinding>): CellFinding =>
    ({
      cellKey: 'ES:B1:cloze:es-b1-test',
      grammarPointKey: 'es-b1-test',
      grammarPointName: 'Test point',
      exerciseType: ExerciseType.CLOZE,
      approved: 50,
      target: 50,
      surface: { topSurface: 'dicen', topCount: 49, total: 50, share: 0.98, distribution: [] },
      surfaceFlagged: true,
      monotony: null,
      monotonyFlagged: false,
      specShortfall: null,
      variantSkew: null,
      dismissedByLedger: false,
      preempted: false,
      needsTriage: true,
      verdict: null,
      triageError: null,
      ...over,
    }) as CellFinding;

  it('lists a confirmed collapse with its mechanism and next action', () => {
    const md = renderMarkdown({
      name: 'run',
      scanned: 100,
      costUsd: 0.4,
      findings: [
        finding({
          verdict: {
            verdict: 'collapsed',
            mechanism: 'construction-variants',
            missingConstructions: ['um … zu'],
            rationale: 'um…zu is never drilled.',
            confidence: 'high',
          },
        }),
      ],
    });
    expect(md).toContain('## Confirmed collapsed');
    expect(md).toContain('construction-variants');
    expect(md).toContain('author `constructionVariants`');
  });

  it('warns that an at-target cell will not self-heal', () => {
    const md = renderMarkdown({
      name: 'run',
      scanned: 1,
      costUsd: 0,
      findings: [
        finding({
          approved: 50,
          target: 50,
          verdict: {
            verdict: 'collapsed',
            mechanism: 'coverage-spec',
            axis: 'person',
            rationale: 'All 3sg.',
            confidence: 'high',
          },
        }),
      ],
    });
    expect(md).toContain('demote required');
  });

  it('puts declared-but-unrealized in its own section, split by at-target', () => {
    const md = renderMarkdown({
      name: 'run',
      scanned: 2,
      costUsd: 0,
      findings: [
        finding({
          needsTriage: false,
          surfaceFlagged: false,
          specShortfall: {
            shortfalls: [{ axis: 'person', value: '2pl', floor: 5, actual: 0 }],
            approved: 50,
            target: 50,
            atTarget: true,
          },
        }),
      ],
    });
    expect(md).toContain('## Declared-but-unrealized');
    expect(md).toContain('At target');
  });

  it('lists dismissals so the report is auditable, not a filtered view', () => {
    const md = renderMarkdown({
      name: 'run',
      scanned: 1,
      costUsd: 0,
      findings: [finding({ dismissedByLedger: true, needsTriage: false })],
    });
    expect(md).toContain('## Dismissed');
    expect(md).toContain('ledger');
  });

  it('renders a clean report when nothing is flagged', () => {
    const md = renderMarkdown({ name: 'run', scanned: 100, costUsd: 0, findings: [] });
    expect(md).toContain('No collapse findings');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- audit-collapse`
Expected: FAIL — `analyzeCell is not exported`.

- [ ] **Step 3: Write the orchestration and rendering**

Append to `packages/ai/scripts/audit-collapse.ts`. The `import` lines below go in the **existing import block at the top of the file** (ESLint's `import/first`); everything after them is appended at the bottom. Note that `main()` needs the Node builtins and `requireEnv`, which Task 8 deliberately left out to keep that commit lint-clean.

```ts
// → merge into the existing import block at the top of the file
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Add `requireEnv` and `isDismissed` to Task 8's EXISTING @language-drill/db
// import — do not add a second import statement from the same module.
import { createDb, exercises, getGrammarPoint, requireEnv, isDismissed } from '@language-drill/db';
import type Anthropic from '@anthropic-ai/sdk';
import {
  computeSpecShortfall,
  computeStemMonotony,
  computeSurfaceCollapse,
  computeVariantSkew,
  isSurfaceFlagged,
  type SpecShortfall,
  type StemMonotony,
  type SurfaceDistribution,
  type VariantSkew,
} from '../src/collapse-metrics.js';
import { createClaudeClient, triageCell, type TriageVerdict } from '../src/index.js';

export type AnalyzeOptions = {
  minRows: number;
  threshold: number;
  monotonyThreshold: number;
};

export type CellFinding = {
  cellKey: string;
  grammarPointKey: string;
  grammarPointName: string;
  exerciseType: ExerciseType;
  approved: number;
  target: number;
  surface: SurfaceDistribution | null;
  surfaceFlagged: boolean;
  monotony: StemMonotony | null;
  monotonyFlagged: boolean;
  specShortfall: SpecShortfall | null;
  variantSkew: VariantSkew | null;
  dismissedByLedger: boolean;
  /** Signal 2 already explains this cell — see `analyzeCell`. */
  preempted: boolean;
  needsTriage: boolean;
  verdict: TriageVerdict | null;
  triageError: string | null;
};

/** True when the point declares a mechanism the pool has not realized. */
function declaredButUnrealized(
  spec: SpecShortfall | null,
  variants: VariantSkew | null,
): boolean {
  if (spec && spec.shortfalls.length > 0) return true;
  // `overQuota` is deliberately NOT a trigger here. It fires on ANY imbalance —
  // an 11/9 split, or 11/10 where exact balance is arithmetically impossible —
  // so including it would mark almost every variant-bearing cell as pre-empted
  // and silently suppress triage across the board. Over-representation means the
  // mechanism IS working, just unevenly; it is reported (see the `unrealized`
  // render filter below) but it does not stand in for a MISSING mechanism.
  if (variants && (variants.underMin.length > 0 || variants.unrecognizedSeedCount > 0)) return true;
  return false;
}

/**
 * Run all three signals over one cell and decide whether it needs an LLM call.
 *
 * Two things suppress triage, in this order:
 *   1. PRE-EMPTION — when the point already declares a mechanism the pool has not
 *      realized, THAT is the finding. Asking the model "should this point have
 *      construction variants?" about a point that already has them wastes a call
 *      and invites a confused verdict. Today this is the common case: #631 merged
 *      inert and the pool repass was never run.
 *   2. The dismissals ledger — a recorded human judgement that this exact
 *      concentration is correct.
 */
export function analyzeCell(cell: AuditCell, opts: AnalyzeOptions): CellFinding {
  const surface = computeSurfaceCollapse(cell.exerciseType, cell.rows);
  const surfaceFlagged = isSurfaceFlagged(surface, opts);

  const monotony = computeStemMonotony(cell.exerciseType, cell.rows);
  const monotonyFlagged =
    monotony !== null && monotony.total >= opts.minRows && monotony.share >= opts.monotonyThreshold;

  const specShortfall = computeSpecShortfall(cell.grammarPoint, cell.rows, cell.target);
  const variantSkew = computeVariantSkew(cell.grammarPoint, cell.rows);

  const preempted = declaredButUnrealized(specShortfall, variantSkew);

  const dismissedByLedger =
    (surfaceFlagged &&
      surface !== null &&
      isDismissed(cell.grammarPoint.key, cell.exerciseType, surface.topSurface, 'answer-surface')) ||
    (monotonyFlagged &&
      monotony !== null &&
      isDismissed(cell.grammarPoint.key, cell.exerciseType, monotony.topLemma, 'stem-monotony'));

  return {
    cellKey: cell.cellKey,
    grammarPointKey: cell.grammarPoint.key,
    grammarPointName: cell.grammarPoint.name,
    exerciseType: cell.exerciseType,
    approved: cell.rows.length,
    target: cell.target,
    surface,
    surfaceFlagged,
    monotony,
    monotonyFlagged,
    specShortfall,
    variantSkew,
    dismissedByLedger,
    preempted,
    needsTriage: (surfaceFlagged || monotonyFlagged) && !dismissedByLedger && !preempted,
    verdict: null,
    triageError: null,
  };
}

// Sonnet list pricing, USD per million tokens. Indicative only — used for the
// run's cost guard, not for billing.
const SONNET_INPUT_USD_PER_MTOK = 3;
const SONNET_OUTPUT_USD_PER_MTOK = 15;

export function estimateTriageCostUsd(usage: Anthropic.Usage): number {
  return (
    (usage.input_tokens / 1_000_000) * SONNET_INPUT_USD_PER_MTOK +
    (usage.output_tokens / 1_000_000) * SONNET_OUTPUT_USD_PER_MTOK
  );
}

export type AuditReport = {
  name: string;
  scanned: number;
  costUsd: number;
  findings: CellFinding[];
};

const NEXT_ACTION: Record<string, string> = {
  'coverage-spec': 'author `coverageSpec`',
  'construction-variants': 'author `constructionVariants`',
  'seed-pool': 'add a curated seed pool (`conjugationSeedWords` / `elicitationSeedValues`)',
};

const pct = (n: number): string => `${Math.round(n * 100)}%`;

export function renderMarkdown(report: AuditReport): string {
  const confirmed = report.findings.filter((f) => f.verdict?.verdict === 'collapsed');
  // Must include overQuota: an over-represented-variant-only finding matches no
  // other section, so omitting it here makes the finding vanish from the report.
  const unrealized = report.findings.filter(
    (f) =>
      f.specShortfall?.shortfalls.length ||
      f.variantSkew?.underMin.length ||
      f.variantSkew?.overQuota.length ||
      f.variantSkew?.unrecognizedSeedCount,
  );
  const monotony = report.findings.filter((f) => f.monotonyFlagged && !f.dismissedByLedger);
  const dismissed = report.findings.filter(
    (f) => f.dismissedByLedger || f.verdict?.verdict === 'legitimate-concentration' || f.verdict?.verdict === 'metric-artifact',
  );
  const errors = report.findings.filter((f) => f.triageError !== null);

  const out: string[] = [
    `# Pool collapse audit — ${report.name}`,
    '',
    '## Summary',
    '',
    `- Cells scanned: **${report.scanned}**`,
    `- Flagged by a signal: **${report.findings.filter((f) => f.surfaceFlagged || f.monotonyFlagged).length}**`,
    `- Confirmed collapsed: **${confirmed.length}**`,
    // Worded so the two lines do not read as a partition — a cell can legitimately
    // be in both (a dismissed surface concentration AND an unmet declared floor).
    `- Cells with a declared-but-unrealized mechanism: **${unrealized.length}**`,
    `- Cells whose surface/monotony flag was dismissed (ledger + triage): **${dismissed.length}**`,
    `- Triage errors: **${errors.length}**`,
    `- Estimated cost: **$${report.costUsd.toFixed(2)}**`,
    '',
  ];

  if (
    confirmed.length === 0 &&
    unrealized.length === 0 &&
    monotony.length === 0 &&
    dismissed.length === 0 &&
    errors.length === 0
  ) {
    out.push('No collapse findings. Nothing to act on.', '');
  }

  if (confirmed.length > 0) {
    out.push('## Confirmed collapsed', '');
    const ranked = [...confirmed].sort((a, b) => (b.surface?.share ?? 0) - (a.surface?.share ?? 0));
    for (const f of ranked) {
      const v = f.verdict!;
      const action = v.mechanism ? NEXT_ACTION[v.mechanism] : 'investigate';
      out.push(
        `### \`${f.cellKey}\` — ${f.grammarPointName}`,
        '',
        `- Top surface: \`${f.surface?.topSurface}\` at **${pct(f.surface?.share ?? 0)}** (${f.surface?.topCount}/${f.surface?.total})`,
        `- Approved: ${f.approved} / target ${f.target}`,
        `- Mechanism: **${v.mechanism}**${v.axis ? ` (axis \`${v.axis}\`)` : ''} — confidence ${v.confidence}`,
        v.missingConstructions?.length
          ? `- Missing: ${v.missingConstructions.map((m) => `\`${m}\``).join(', ')}`
          : '',
        `- Rationale: ${v.rationale}`,
        `- **Next action:** ${action}`,
        f.approved >= f.target
          ? '- ⚠️ Cell is **at target** — **demote required**, it will not self-heal. `need = target − approved` is zero, so the scheduler never revisits it.'
          : '- Cell is below target; it will refill under the new config once generation resumes.',
        '',
      );
    }
  }

  if (unrealized.length > 0) {
    out.push(
      '## Declared-but-unrealized',
      '',
      'Deterministic — the declared floor is ground truth, no triage involved.',
      '',
    );
    const atTarget = unrealized.filter((f) => f.approved >= f.target);
    const belowTarget = unrealized.filter((f) => f.approved < f.target);
    for (const [label, group, note] of [
      ['At target — stuck, needs a demote', atTarget, 'These will NOT self-heal.'],
      ['Below target — self-heals on resume', belowTarget, 'The scheduler will target these on the next batch.'],
    ] as const) {
      if (group.length === 0) continue;
      out.push(`### ${label}`, '', note, '');
      for (const f of group) {
        out.push(`- \`${f.cellKey}\` (${f.approved}/${f.target})`);
        for (const s of f.specShortfall?.shortfalls ?? []) {
          out.push(`  - \`${s.axis}=${s.value}\`: ${s.actual}/${s.floor}`);
        }
        if (f.variantSkew) {
          if (f.variantSkew.unrecognizedSeedCount > 0) {
            out.push(
              `  - **${f.variantSkew.unrecognizedSeedCount} rows carry no recognized variant id** — backfill \`content_json.seedWord\` before demoting, or the surplus recomputes against zero coverage.`,
            );
          }
          for (const id of f.variantSkew.underMin) {
            const v = f.variantSkew.perVariant.find((p) => p.id === id)!;
            out.push(`  - variant \`${id}\`: ${v.count} (below MIN_PER_VARIANT)`);
          }
          for (const id of f.variantSkew.overQuota) {
            const v = f.variantSkew.perVariant.find((p) => p.id === id)!;
            out.push(`  - variant \`${id}\`: ${v.count} over quota ${v.quota.toFixed(1)}`);
          }
        }
      }
      out.push('');
    }
  }

  if (monotony.length > 0) {
    out.push(
      '## Stem monotony (calibration-phase)',
      '',
      'Loose threshold by design; #617 may already have fixed part of this. Treat as a hint.',
      '',
    );
    for (const f of monotony) {
      out.push(
        `- \`${f.cellKey}\`: \`${f.monotony!.topLemma}\` in ${pct(f.monotony!.share)} of stems (${f.monotony!.count}/${f.monotony!.total})`,
      );
    }
    out.push('');
  }

  if (dismissed.length > 0) {
    out.push('## Dismissed', '', 'Listed so this report is auditable, not a filtered view.', '');
    for (const f of dismissed) {
      const why = f.dismissedByLedger
        ? 'ledger'
        : `triage: ${f.verdict?.verdict} — ${f.verdict?.rationale}`;
      // A dismissed surface concentration does NOT clear an unmet declared floor;
      // without this cross-reference the entry reads as "this cell is fine".
      const alsoUnrealized = unrealized.includes(f)
        ? ' — **also has an unrealized declared mechanism; see above**'
        : '';
      out.push(`- \`${f.cellKey}\` — ${why}${alsoUnrealized}`);
    }
    out.push('');
  }

  if (errors.length > 0) {
    out.push('## Triage errors', '');
    for (const f of errors) out.push(`- \`${f.cellKey}\` — ${f.triageError}`);
    out.push('');
  }

  return out.join('\n');
}

async function main(): Promise<void> {
  const filters = parseAuditArgs(process.argv.slice(2));
  const db = createDb(requireEnv('DATABASE_URL'));

  console.log('[audit-collapse] loading approved rows…');
  const rows = await loadApprovedRows(db, filters);
  let cells = groupRowsIntoCells(rows);
  if (filters.limit !== undefined) cells = cells.slice(0, filters.limit);
  console.log(`[audit-collapse] ${rows.length} rows → ${cells.length} cells`);

  const findings = cells.map((c) => analyzeCell(c, filters));

  let costUsd = 0;
  if (!filters.dryRun) {
    const client = createClaudeClient(requireEnv('ANTHROPIC_API_KEY'));
    const cellByKey = new Map(cells.map((c) => [c.cellKey, c]));
    const queue = findings.filter((f) => f.needsTriage);
    console.log(`[audit-collapse] triaging ${queue.length} cells…`);

    for (const f of queue) {
      if (costUsd >= filters.maxCostUsd) {
        // Never silently truncate: an unspoken cap reads as "covered everything".
        f.triageError = `skipped — run hit --max-cost-usd ${filters.maxCostUsd}`;
        continue;
      }
      const cell = cellByKey.get(f.cellKey)!;
      try {
        const { verdict, usage } = await triageCell(client, {
          grammarPoint: cell.grammarPoint,
          exerciseType: cell.exerciseType,
          approved: f.approved,
          target: f.target,
          signal: f.surfaceFlagged ? 'answer-surface' : 'stem-monotony',
          surface: f.surface,
          monotony: f.monotony,
        });
        f.verdict = verdict;
        costUsd += estimateTriageCostUsd(usage);
      } catch (err) {
        f.triageError = err instanceof Error ? err.message : String(err);
      }
    }
  } else {
    console.log('[audit-collapse] --dry-run: sweep only, no triage calls');
  }

  const report: AuditReport = { name: filters.name, scanned: cells.length, costUsd, findings };
  const outDir = path.join(process.cwd(), 'audit-runs');
  mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${filters.name}.json`);
  const mdPath = path.join(outDir, `${filters.name}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(mdPath, renderMarkdown(report), 'utf8');

  console.log(`[audit-collapse] wrote ${jsonPath}`);
  console.log(`[audit-collapse] wrote ${mdPath}`);
  console.log(`[audit-collapse] estimated cost $${costUsd.toFixed(2)}`);
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error('[audit-collapse] unhandled failure:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- audit-collapse`
Expected: PASS, 26 tests.

- [ ] **Step 5: Full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures.

- [ ] **Step 6: Commit**

```bash
git add packages/ai/scripts/audit-collapse.ts packages/ai/scripts/audit-collapse.test.ts
git commit -m "feat(ai): audit:collapse orchestration and report rendering

Signal 2 pre-empts triage — when a point already declares a mechanism the
pool has not realized, that IS the finding, so no LLM call is made. The
dismissals ledger suppresses the rest. Cost-guard skips are recorded as
errors rather than silently truncating the run.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Wire the CLI and document it

**Files:**
- Modify: `packages/ai/package.json`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `CLAUDE.md`
- Modify: `docs/curriculum-authoring.md`

**Interfaces:**
- Consumes: `packages/ai/scripts/audit-collapse.ts` (Task 9).
- Produces: the `pnpm audit:collapse` entry point.

- [ ] **Step 1: Add the package script**

In `packages/ai/package.json`, after the `"qa:sample"` line:

```json
    "audit:collapse": "tsx scripts/audit-collapse.ts",
```

- [ ] **Step 2: Add the root passthrough**

In the root `package.json`, after the `"qa:sample"` line. The `dotenv -e .env` prefix matches every sibling DB CLI and is what supplies `DATABASE_URL` and `ANTHROPIC_API_KEY`:

```json
    "audit:collapse": "dotenv -e .env -- pnpm --filter @language-drill/ai audit:collapse"
```

- [ ] **Step 3: Ignore the run output**

Append to `.gitignore`:

```
# audit:collapse run output (commit interesting runs to docs/analysis/ instead)
packages/ai/audit-runs/
```

- [ ] **Step 4: Verify the CLI runs end to end without touching the network**

`--dry-run` skips every Anthropic call, so this exercises arg parsing, the query, cell assembly, all three signals, and both writers.

Run: `pnpm audit:collapse -- --dry-run --language ES --cefr B1 --name smoke`
Expected: exits 0; prints a cell count; writes `packages/ai/audit-runs/smoke.json` and `smoke.md`. Open the markdown and confirm the Summary section has plausible numbers.

If `DATABASE_URL` is unset the run fails fast with a `requireEnv` error — that is correct behaviour, not a bug.

- [ ] **Step 5: Document the CLI in `CLAUDE.md`**

Add a row to the "Running Locally" command table, after the `pnpm qa:sample` row:

```markdown
| `pnpm audit:collapse` | Read-only audit of the approved pool for **distributional collapse** — the failure neither the generator (one draft at a time) nor the validator (one draft against the spec) can see. Three signals: spec-agnostic answer-surface concentration (the metric that found PR #631's 49 collapsed points), deterministic declared-but-unrealized checks against `coverageSpec` floors and `constructionVariants` quotas, and a calibration-phase stem-monotony hint. Flagged cells get one Claude triage call returning a verdict **and the mechanism that fixes it** (`coverage-spec` / `construction-variants` / `seed-pool`); cells whose declared mechanism is simply unrealized skip triage, and known-legitimate concentrations are suppressed by the committed dismissals ledger (`packages/db/src/curriculum/collapse-dismissals.ts`). Writes JSON + markdown to `./audit-runs/`. Supports `--language`, `--cefr`, `--type`, `--grammar-point`, `--limit`, `--min-rows`, `--threshold`, `--monotony-threshold`, `--max-cost-usd`, `--dry-run`. A spotlight, not a gate. |
```

- [ ] **Step 6: Cross-link from the curriculum-authoring doc**

In `docs/curriculum-authoring.md`, at the end of the "Retrofitting a spec onto a filled cell" section (after the "Skipping step 2 is the classic trap" paragraph), add:

```markdown
`pnpm audit:collapse` measures exactly this trap: its "Declared-but-unrealized →
At target" section lists every cell whose declared floors cannot fire because the
cell has no deficit. Run it before assuming a merged spec took effect.
```

And add to the "Related" list at the bottom:

```markdown
- `docs/superpowers/specs/2026-08-11-pool-collapse-audit-design.md` — the
  `audit:collapse` detector that measures when a spec is missing or unrealized
```

- [ ] **Step 7: Full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures.

- [ ] **Step 8: Commit**

```bash
git add packages/ai/package.json package.json .gitignore CLAUDE.md docs/curriculum-authoring.md
git commit -m "chore: wire pnpm audit:collapse and document it

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Calibration run and acceptance against production

The acceptance test. A detector that cannot rediscover the defect it exists to find does not ship.

The timing is unusually favourable and **will not last**: PR #631 merged inert, the pool repass was never run, and nightly generation is paused, so production still holds the collapsed pool with `seedWord` null against declared variants. Run this before either state changes.

Production credentials: the local `.env` `DATABASE_URL` points at the Neon **dev** branch. Production is branch `br-green-waterfall-ancrvpr5` of project `twilight-smoke-01114337` — fetch its connection string via the Neon MCP tools and pass it inline, exactly as the `qa:sample` prod recipe does.

**Files:**
- Modify: `packages/db/src/curriculum/collapse-dismissals.ts`
- Create: `docs/analysis/collapse-audit-2026-08-11.md`

**Interfaces:**
- Consumes: the complete CLI (Tasks 1–10).
- Produces: a calibrated `--monotony-threshold`, an expanded dismissals ledger, and a committed baseline report.

- [ ] **Step 1: Dry-run the sweep against production**

Get the prod connection string, then:

```bash
DATABASE_URL='<prod-connection-string>' \
  pnpm --filter @language-drill/ai audit:collapse -- --dry-run --name prod-sweep-2026-08-11
```

Expected: a cell count in the hundreds, exit 0, `packages/ai/audit-runs/prod-sweep-2026-08-11.md` written. No Anthropic calls, so this costs nothing and is safe to repeat while tuning thresholds.

- [ ] **Step 2: Verify the acceptance criteria in the dry-run output**

Read `prod-sweep-2026-08-11.md`. All three must hold:

1. **The 31 variant-bearing points appear under "Declared-but-unrealized"**, with large `unrecognizedSeedCount` values — these are the unbackfilled legacy rows. `es-b1-impersonal-plural` should show roughly 100 rows across its cloze and translation cells with no recognized variant id.
2. **`de-b1-um-zu-damit`, `tr-a2-adversative-connectors`, and `tr-a2-causal-connectors` are flagged** — under "Declared-but-unrealized" if they now carry variants, otherwise under a surface flag awaiting triage.
3. **`es-a2-personal-a` and `es-b1-ser-location-events` appear under "Dismissed — ledger"**, not under a live finding.

If any of the three fails, the metric or the ledger is wrong. **Fix it and re-run** before proceeding — do not weaken the criteria to match the output.

- [ ] **Step 3: Calibrate the monotony threshold**

The "Stem monotony (calibration-phase)" section is the only unvalidated signal. Read it:

- If it lists a handful of cells whose stems are genuinely repetitive, keep `--monotony-threshold 0.5` and make it the committed default.
- If it lists dozens of cells and spot-checking shows most are fine, raise `MONOTONY_THRESHOLD_DEFAULT` in `packages/ai/src/collapse-metrics.ts` until the list is short and mostly true, and update the `--monotony-threshold` default in `parseAuditArgs` to match.
- If it lists nothing at any threshold, record that in the report: #617's topic steering has likely superseded this signal, which is a useful finding in itself.

Re-run Step 1 after each adjustment — dry-runs are free.

- [ ] **Step 4: Run the full audit with triage**

```bash
DATABASE_URL='<prod-connection-string>' ANTHROPIC_API_KEY='<key>' \
  pnpm --filter @language-drill/ai audit:collapse -- --max-cost-usd 3 --name prod-2026-08-11
```

Expected: roughly $0.50 for a ~50-cell triage queue. Watch the printed queue size before it starts; if it is far above 50, stop and tighten `--threshold` rather than paying for a run dominated by false positives.

- [ ] **Step 5: Spot-check the triage verdicts**

Read the "Dismissed" section and check ten verdicts against the grammar points they judge. Two failure modes to look for:

- **Over-dismissal** — a genuinely collapsed point judged `legitimate-concentration`. The prompt's "default to legitimate when unsure" rule makes this the expected direction of error; it is acceptable at a low rate, but if a known-collapsed point from #631's table is dismissed, the prompt needs work.
- **Over-confidence** — a `collapsed` verdict with `high` confidence whose rationale does not actually cite the point's own text.

Fix the prompt in `collapse-triage.ts` if either is systematic, bump `COLLAPSE_TRIAGE_PROMPT_VERSION`, and re-run.

- [ ] **Step 6: Seed the dismissals ledger from the confirmed dismissals**

For each `legitimate-concentration` or `metric-artifact` verdict you agree with, add an entry to `COLLAPSE_DISMISSALS` in `packages/db/src/curriculum/collapse-dismissals.ts`, using the model's rationale as the starting point for `reason` and rewriting it into your own words. Set `dismissedOn` to today.

Use `surface: null` only when the cell is legitimately concentrated regardless of which surface dominates. Default to naming the surface.

Run: `pnpm --filter @language-drill/db test -- curriculum`
Expected: PASS. The integrity test catches a mistyped point key or an incompatible exercise type.

- [ ] **Step 7: Commit the baseline report**

Copy `packages/ai/audit-runs/prod-2026-08-11.md` to `docs/analysis/collapse-audit-2026-08-11.md` (matching the existing `generation-run-*.md` habit) and add a short preamble recording: the date, the branch audited, the thresholds used, and the monotony-signal decision from Step 3.

- [ ] **Step 8: Full gate and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures.

```bash
git add packages/db/src/curriculum/collapse-dismissals.ts \
  packages/ai/src/collapse-metrics.ts docs/analysis/collapse-audit-2026-08-11.md
git commit -m "chore(audit): calibration run against production

Baseline collapse audit over the prod pool. Reproduces PR #631's findings
under signal 2 (declared variants, unrealized pool), dismisses the known
metric false positives, and calibrates the stem-monotony threshold.

Ledger expanded with the dismissals confirmed by review.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 9: Report the outcome**

State plainly, with the numbers from the run:

- cells scanned, flagged, confirmed collapsed, dismissed;
- whether all three acceptance criteria in Step 2 held;
- what the monotony signal decided;
- the **#631 repass worklist** the run produced — the cells needing a `seedWord` backfill and a `pnpm demote:pool --reason pool-hygiene` before generation resumes.

Do not open a PR without being asked.

---

## Notes for the implementer

**The repass is not part of this plan.** The audit *produces* the worklist; running the backfill and demote against production is a separate, human-approved operation with its own runbook in the #631 design doc. Never run `demote:pool --apply` as part of implementing this.

**`--reason pool-hygiene`, never `quality`.** If you are ever asked to act on the worklist: `quality` and `learner-flag` revoke learners' mastery credit for every past attempt on the demoted rows and require a `pnpm backfill:mastery --apply` to recover. Over-representing one construction is not a defect in the exercise.

**Stale `dist` directories cause phantom failures in both directions.** `packages/ai` and `packages/db` resolve each other through `dist`, so run `pnpm build` after editing `db` source. Conversely, stale compiled `infra/lambda/dist/**/*.test.js` files get picked up by the full suite — `rm -rf infra/lambda/dist` when lambda tests fail inexplicably.

**Do not add the triage prompt to Langfuse.** It is a dev-time authoring aid. Adding it to the `PROMPTS` manifest in `bootstrap-prompts.ts` would put an unreviewed prompt into the production sync path.
