# Pool Coverage Controller — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `personRotation: boolean` flag with a declarative per-grammar-point `coverageSpec` (axes + absolute per-value floors) and generalize the Phase-1 person-only coverage controller to drive any axis (person, polarity, wordClass) from that spec — so adding an axis is a data change, not a code change. Also ship the LLM `propose:coverage-spec` authoring CLI.

**Architecture:** The `personRotation → coverageSpec` change is **cross-cutting** — `coverageSpec` replaces `personRotation` in the shared `GrammarPoint` type, and every consumer (tagging, target resolution, the controller, the generation directive, the job message, the outcome tally, the scheduler) is updated to read the spec. Because the field is removed from the type, a clean `pnpm typecheck` across the repo is only expected after the consumer cluster (through Task 12) lands. Each task is still TDD'd against its own module's tests; the final task runs the full suite. The controller stays a pure function; the spec data carries all language-specificity (e.g. ES omitting `2pl` is just an absent floor key).

**Tech Stack:** TypeScript, pnpm workspaces + Turborepo, Vitest, Drizzle ORM (Neon Postgres), Hono (Lambda), Anthropic SDK (`@anthropic-ai/sdk`), `node:util.parseArgs` for CLIs.

**Key design decisions (from the spec):**
- Floors are **absolute per-value min approved counts**; omitted value = NA (never targeted); low floor = rare.
- Multi-axis targeting is **independent per-axis water-fill** — a draft may carry several axis constraints, but give-up/measurement is per-`(axis, value)`, never the cross-product.
- Cell target = `max(base/override, maxOverAxes(Σ floors))` — this **deletes the magic 1.5× person multiplier**.
- The blind `personForOrdinal` ordinal-rotation fallback is **removed**; the controller always supplies targets for spec'd cells.
- The proposal prompt is **in-repo + versioned, NOT Langfuse-managed**.
- Reuse the existing `CoverageAxis` union (`"person" | "wordClass" | "polarity" | "sentenceType"`) everywhere — do not introduce a new `CoverageAxisName`.

Reference spec: `docs/superpowers/specs/2026-06-13-pool-coverage-controller-phase-2-design.md`.

---

## File structure

**Shared vocabulary (`packages/shared/src/coverage.ts`)** — owns the new spec/target/outcome types and the generalized `coverageAxesFor`/`pickCoverageTags`. Single source of axis truth.

**Curriculum (`packages/shared/src/curriculum-types.ts`, `packages/db/src/curriculum/*`)** — `GrammarPoint.coverageSpec` replaces `personRotation`; data migration + new invariants live here.

**Controller (`infra/lambda/src/generation/{coverage-decision,cell-targets,scheduler}.ts`)** — pure decision + target math + scheduler wiring, generalized to N axes.

**Generation path (`packages/ai/src/{generation-prompts,generate}.ts`, `packages/db/src/generation/{run-one-cell,validate-and-insert,coverage-tags}.ts`, `infra/lambda/src/generation/{job-message,handler}.ts`)** — directive rendering, the job-message contract, and the per-axis outcome tally.

**Authoring CLI (`packages/ai/src/coverage-spec-proposal.ts`, `packages/ai/scripts/propose-coverage-spec.ts`)** — new in-repo prompt + forced-tool + parser + CLI.

---

## Migration constants (used by Task 4)

Per-person floor `f` chosen so `N × f` reproduces the Phase-1 effective target (`ceil(base × 1.5)` for cloze/translation), with `f = ceil(ceil(base×1.5) / N)` — exactly Phase-1's implicit uniform floor `ceil(target/N)`. `N` = persons in the language (ES = 5, no `2pl`; TR/DE = 6).

| Language | Level | base (cloze/transl.) | Phase-1 target | persons N | floor `f` | Σ floors (= new target) |
|---|---|---|---|---|---|---|
| TR | A1 | 20 | 30 | 6 | 5 | 30 |
| TR | A2 | 30 | 45 | 6 | 8 | 48 |
| ES | B1 | 50 | 75 | 5 | 15 | 75 |
| ES | B2 | 50 | 75 | 5 | 15 | 75 |

ES person values (5): `1sg 2sg 3sg 1pl 3pl` (no `2pl`). TR person values (6): `1sg 2sg 3sg 1pl 2pl 3pl`.

**Intentional, documented behavior changes** (not regressions — both give *more* rotation headroom, which is the point):
- A `sentence_construction` cell on a person-spec'd point now also resolves to the floor-sum target (e.g. ES B1 SC: 50 → 75). Phase-1's 1.5× skipped SC; the spec applies uniformly across the point's exercise types.
- TR A2 person target is 48 vs Phase-1's 45 (integer-uniform floor rounding `7.5 → 8`).

---

### Task 1: Shared spec/target/outcome types + generalized `coverageAxesFor`

**Files:**
- Modify: `packages/shared/src/coverage.ts`
- Test: `packages/shared/src/coverage.test.ts` (create if absent)

- [ ] **Step 1: Write failing tests for the generalized `coverageAxesFor(exerciseType, spec)`**

Add to `packages/shared/src/coverage.test.ts` (create the file with this content if it does not exist; if it exists, append the `describe` block):

```typescript
import { describe, expect, it } from "vitest";
import { ExerciseType } from "./index";
import {
  coverageAxesFor,
  pickCoverageTags,
  type CoverageSpec,
} from "./coverage";

describe("coverageAxesFor (spec-driven)", () => {
  const personSpec: CoverageSpec = { axes: [{ name: "person", floors: { "3sg": 8 } }] };
  const wordClassSpec: CoverageSpec = { axes: [{ name: "wordClass", floors: { noun: 6 } }] };

  it("vocab with no spec → wordClass only", () => {
    expect(coverageAxesFor(ExerciseType.VOCAB_RECALL, undefined)).toEqual(["wordClass"]);
  });
  it("grammar cloze with no spec → polarity + sentenceType (monitoring)", () => {
    expect(coverageAxesFor(ExerciseType.CLOZE, undefined)).toEqual(["polarity", "sentenceType"]);
  });
  it("grammar cloze with person spec → person + polarity + sentenceType (canonical order)", () => {
    expect(coverageAxesFor(ExerciseType.CLOZE, personSpec)).toEqual([
      "person",
      "polarity",
      "sentenceType",
    ]);
  });
  it("vocab with wordClass spec → wordClass (union is a no-op)", () => {
    expect(coverageAxesFor(ExerciseType.VOCAB_RECALL, wordClassSpec)).toEqual(["wordClass"]);
  });
  it("listening (no axes) with no spec → []", () => {
    expect(coverageAxesFor(ExerciseType.LISTENING, undefined)).toEqual([]);
  });
});

describe("pickCoverageTags (spec-driven)", () => {
  const personSpec: CoverageSpec = { axes: [{ name: "person", floors: { "3sg": 8 } }] };
  it("keeps person when the spec controls it", () => {
    expect(
      pickCoverageTags(
        { person: "2pl", polarity: "affirmative", sentenceType: "declarative" },
        ExerciseType.CLOZE,
        personSpec,
      ),
    ).toEqual({ person: "2pl", polarity: "affirmative", sentenceType: "declarative" });
  });
  it("drops person when no spec controls it", () => {
    expect(
      pickCoverageTags(
        { person: "2pl", polarity: "affirmative" },
        ExerciseType.CLOZE,
        undefined,
      ),
    ).toEqual({ polarity: "affirmative" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/shared test -- coverage.test.ts`
Expected: FAIL — `coverageAxesFor` currently takes `(exerciseType, personRotation: boolean)` and `CoverageSpec` is not exported.

- [ ] **Step 3: Add the new types and generalize the two functions**

In `packages/shared/src/coverage.ts`, **after** the existing `CoverageTags` type, add:

```typescript
/**
 * Declarative coverage spec for a grammar point (Pool Coverage Controller,
 * Phase 2). Lists which axes a diverse approved set should vary along and an
 * absolute min approved-count `floor` per value. A value omitted from `floors`
 * is "NA" — never targeted (e.g. ES has no `2pl`, so its person specs omit it).
 * A low floor (e.g. 2) is the "rare" case. Replaces the `personRotation` flag.
 */
export type CoverageAxisSpec = {
  name: CoverageAxis;
  floors: Readonly<Partial<Record<string, number>>>;
};
export type CoverageSpec = { axes: readonly CoverageAxisSpec[] };

/** One draft's per-axis assignment from the controller; sparse — only the
 *  cell's controlled (and non-suppressed) axes are present. */
export type CoverageTarget = Partial<Record<CoverageAxis, string>>;

/** `{requested, approved}` tally for one axis's values in a batch. `requested`
 *  = drafts the scheduler targeted at each value; `approved` = approved drafts
 *  whose *realized* value equals it. */
export type AxisOutcome = Partial<
  Record<string, { requested: number; approved: number }>
>;
```

Then **replace** the existing `PersonOutcome` and `CoverageOutcome` definitions with:

```typescript
/**
 * Axis-keyed generation outcome persisted to `generation_jobs.coverage_outcome`
 * (Phase 2, generalized from the Phase-1 `{ person?: … }` shape — old rows are
 * still valid instances). Drives the per-`(axis, value)` give-up in
 * `coverage-decision.ts`. NULL on legacy rows and cells that did no targeting.
 */
export type CoverageOutcome = Partial<Record<CoverageAxis, AxisOutcome>>;
```

(Delete the old `PersonOutcome` type and its doc comment — Task 7/11 stop importing it.)

Add a **canonical axis order** constant near `COVERAGE_AXIS_VALUES`:

```typescript
/** Canonical axis ordering so `coverageAxesFor` output is stable and matches
 *  the Phase-1 `[person, polarity, sentenceType]` ordering for person cells. */
const AXIS_ORDER: readonly CoverageAxis[] = [
  "person",
  "wordClass",
  "polarity",
  "sentenceType",
];
```

Now **replace** `coverageAxesFor` and `pickCoverageTags` with the spec-driven versions:

```typescript
/**
 * Which axes to record for a cell: the per-exercise-type *monitoring* axes
 * UNION the spec's *controlled* axes, returned in canonical order. vocab_recall
 * → wordClass; grammar cloze/translation/sentence_construction → polarity +
 * sentenceType; plus any axis the cell's `coverageSpec` controls.
 */
export function coverageAxesFor(
  exerciseType: ExerciseType,
  spec: CoverageSpec | undefined,
): CoverageAxis[] {
  const monitoring = new Set<CoverageAxis>();
  if (exerciseType === ExerciseType.VOCAB_RECALL) {
    monitoring.add("wordClass");
  } else if (
    exerciseType === ExerciseType.CLOZE ||
    exerciseType === ExerciseType.TRANSLATION ||
    exerciseType === ExerciseType.SENTENCE_CONSTRUCTION
  ) {
    monitoring.add("polarity");
    monitoring.add("sentenceType");
  }
  if (spec) for (const axis of spec.axes) monitoring.add(axis.name);
  return AXIS_ORDER.filter((a) => monitoring.has(a));
}

/**
 * Filter a raw coverage map down to the axes applicable to the cell. Returns
 * `null` when nothing applicable is present, so callers write the column as
 * `null` rather than `{}`.
 */
export function pickCoverageTags(
  coverage: CoverageTags,
  exerciseType: ExerciseType,
  spec: CoverageSpec | undefined,
): CoverageTags | null {
  const axes = coverageAxesFor(exerciseType, spec);
  const out: CoverageTags = {};
  for (const axis of axes) {
    const v = coverage[axis];
    if (v !== undefined) (out as Record<string, string>)[axis] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/shared test -- coverage.test.ts`
Expected: PASS.

- [ ] **Step 5: Rebuild shared (downstream packages consume `db/dist`-style builds)**

Run: `pnpm --filter @language-drill/shared build`
Expected: tsc succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/coverage.ts packages/shared/src/coverage.test.ts
git commit -m "feat(shared): declarative CoverageSpec types + spec-driven coverageAxesFor"
```

---

### Task 2: `GrammarPoint.coverageSpec` replaces `personRotation`

**Files:**
- Modify: `packages/shared/src/curriculum-types.ts:97` (the `personRotation` field)

- [ ] **Step 1: Replace the field**

In `packages/shared/src/curriculum-types.ts`, delete the `personRotation?: boolean;` field (and its doc comment, lines ~87–97) and add in its place:

```typescript
  /**
   * Declarative coverage spec (Pool Coverage Controller, Phase 2) — which
   * categorical axes a diverse approved set should vary along, and an absolute
   * min approved-count floor per value. Replaces the old `personRotation` flag:
   * a person axis here is exactly the old `personRotation: true`. Drives
   * (a) which axes get tagged (`coverageAxesFor`), (b) the cell's generation
   * target (`resolveCellTarget` raises it to cover the floor sums), and (c) the
   * scheduler's per-draft coverage targeting. Authored by `propose:coverage-spec`
   * and human-reviewed. Only valid on the relevant `kind`/exercise types
   * (enforced by curriculum invariants): `wordClass` on vocab points;
   * `person`/`polarity`/`sentenceType` on grammar points.
   */
  coverageSpec?: CoverageSpec;
```

Add `CoverageSpec` to the import from `./coverage` (or wherever the file imports shared coverage types — check the top of the file; if it imports from `./index`, import `CoverageSpec` from there). Use:

```typescript
import type { CoverageSpec } from "./coverage";
```

- [ ] **Step 2: Verify the type compiles in isolation**

Run: `pnpm --filter @language-drill/shared build`
Expected: tsc succeeds (the type file has no consumers within `shared`).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/curriculum-types.ts
git commit -m "feat(shared): GrammarPoint.coverageSpec replaces personRotation"
```

---

### Task 3: Curriculum invariants for `coverageSpec`

**Files:**
- Modify: `packages/db/src/curriculum/index.ts` (the `assertCurriculumInvariants` body, the `personRotation` invariant block ~9d)
- Test: `packages/db/src/curriculum/curriculum.test.ts`

- [ ] **Step 1: Write failing invariant tests**

Append to `packages/db/src/curriculum/curriculum.test.ts`:

```typescript
import { assertCurriculumInvariants } from "./index";
import type { GrammarPoint } from "@language-drill/shared";

function baseGrammar(over: Partial<GrammarPoint>): GrammarPoint {
  return {
    key: "tr-a1-x-test",
    kind: "grammar",
    name: "test",
    description: "d",
    cefrLevel: "A1",
    language: "TR" as GrammarPoint["language"],
    examplesPositive: ["a", "b"],
    examplesNegative: ["*c"],
    commonErrors: ["e"],
    ...over,
  } as GrammarPoint;
}

describe("coverageSpec invariants", () => {
  it("rejects an illegal floor key for the axis", () => {
    const gp = baseGrammar({ coverageSpec: { axes: [{ name: "person", floors: { "9sg": 5 } }] } });
    expect(() => assertCurriculumInvariants([gp])).toThrow(/illegal value '9sg'/);
  });
  it("rejects wordClass on a grammar point", () => {
    const gp = baseGrammar({ coverageSpec: { axes: [{ name: "wordClass", floors: { noun: 5 } }] } });
    expect(() => assertCurriculumInvariants([gp])).toThrow(/wordClass.*only valid on kind 'vocab'/);
  });
  it("rejects person on a vocab point", () => {
    const gp = baseGrammar({
      kind: "vocab",
      key: "tr-a1-vocab-test",
      coverageSpec: { axes: [{ name: "person", floors: { "3sg": 5 } }] },
    });
    expect(() => assertCurriculumInvariants([gp])).toThrow(/person.*only valid on kind 'grammar'/);
  });
  it("rejects a non-positive-integer floor", () => {
    const gp = baseGrammar({ coverageSpec: { axes: [{ name: "person", floors: { "3sg": 0 } }] } });
    expect(() => assertCurriculumInvariants([gp])).toThrow(/floor.*positive integer/);
  });
  it("rejects a duplicate axis", () => {
    const gp = baseGrammar({
      coverageSpec: { axes: [{ name: "person", floors: { "3sg": 5 } }, { name: "person", floors: { "1sg": 5 } }] },
    });
    expect(() => assertCurriculumInvariants([gp])).toThrow(/duplicate axis/);
  });
  it("accepts a valid person spec on a grammar point", () => {
    const gp = baseGrammar({ coverageSpec: { axes: [{ name: "person", floors: { "1sg": 5, "3sg": 5 } }] } });
    expect(() => assertCurriculumInvariants([gp])).not.toThrow();
  });
});
```

> Note: `assertCurriculumInvariants([gp])` over a single fixture also runs the per-language grammar-minimum check (invariant 10). Confirm that check tolerates a single-entry array (it only throws when a configured minimum is unmet); if the existing single-entry curriculum tests already pass that way, this is fine. If invariant 10 throws on the fixture, wrap each fixture call to assert on the *coverageSpec* message specifically using `.toThrow(/…/)` which matches substring — invariant 10's message differs, so a thrown coverageSpec error still surfaces first because it runs inside the per-entry loop *before* the per-language tally.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/db test -- curriculum.test.ts`
Expected: FAIL — no `coverageSpec` validation yet.

- [ ] **Step 3: Replace the `personRotation` invariant with `coverageSpec` invariants**

In `packages/db/src/curriculum/index.ts`, **delete** invariant block `9d` (the `personRotation` check) and add, in the same per-entry loop, after block `9c`:

```typescript
    // 9d. coverageSpec (Phase 2): axis applicability, unique axes, legal floor
    //     keys, positive-integer floors. `personRotation` is gone; a person axis
    //     here is the old flag.
    if (entry.coverageSpec) {
      const seenAxes = new Set<string>();
      for (const axis of entry.coverageSpec.axes) {
        if (seenAxes.has(axis.name)) {
          throw new Error(
            `Curriculum invariant violated: '${entry.key}' has duplicate axis '${axis.name}' in coverageSpec`,
          );
        }
        seenAxes.add(axis.name);

        if (axis.name === "wordClass" && entry.kind !== "vocab") {
          throw new Error(
            `Curriculum invariant violated: '${entry.key}' coverageSpec axis 'wordClass' is only valid on kind 'vocab'`,
          );
        }
        if (axis.name !== "wordClass" && entry.kind !== "grammar") {
          throw new Error(
            `Curriculum invariant violated: '${entry.key}' coverageSpec axis '${axis.name}' is only valid on kind 'grammar'`,
          );
        }

        const legal = COVERAGE_AXIS_VALUES[axis.name];
        const floorKeys = Object.keys(axis.floors);
        if (floorKeys.length === 0) {
          throw new Error(
            `Curriculum invariant violated: '${entry.key}' coverageSpec axis '${axis.name}' has no floors`,
          );
        }
        for (const [value, floor] of Object.entries(axis.floors)) {
          if (!legal.includes(value)) {
            throw new Error(
              `Curriculum invariant violated: '${entry.key}' coverageSpec axis '${axis.name}' has illegal value '${value}'`,
            );
          }
          if (!Number.isInteger(floor) || (floor as number) <= 0) {
            throw new Error(
              `Curriculum invariant violated: '${entry.key}' coverageSpec axis '${axis.name}' floor for '${value}' must be a positive integer`,
            );
          }
        }
      }
    }
```

Add `COVERAGE_AXIS_VALUES` to the existing import from `@language-drill/shared` at the top of `index.ts`:

```typescript
import { COVERAGE_AXIS_VALUES } from "@language-drill/shared";
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/db test -- curriculum.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/curriculum/index.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "feat(db): coverageSpec curriculum invariants replace personRotation check"
```

---

### Task 4: Migrate curriculum data + author new-axis specs + bump versions

**Files:**
- Modify: `packages/db/src/curriculum/es.ts`, `packages/db/src/curriculum/tr.ts`
- (German is fully commented out — its `personRotation: true` lines are inside comment blocks and don't compile; leave them.)

- [ ] **Step 1: Port every ACTIVE `personRotation: true` to a `coverageSpec` person axis**

For each **active** (non-commented) grammar point currently bearing `personRotation: true`, replace that line with a `coverageSpec` using the per-person floor from the Migration-constants table. Read each file and edit each occurrence. The floors:

- TR A1 points (6 persons, floor 5):
  ```typescript
  coverageSpec: {
    axes: [{ name: "person", floors: { "1sg": 5, "2sg": 5, "3sg": 5, "1pl": 5, "2pl": 5, "3pl": 5 } }],
  },
  ```
- TR A2 points (6 persons, floor 8) — e.g. `tr-a2-aorist`:
  ```typescript
  coverageSpec: {
    axes: [{ name: "person", floors: { "1sg": 8, "2sg": 8, "3sg": 8, "1pl": 8, "2pl": 8, "3pl": 8 } }],
  },
  ```
- ES B1 + B2 points (5 persons, no `2pl`, floor 15):
  ```typescript
  coverageSpec: {
    axes: [{ name: "person", floors: { "1sg": 15, "2sg": 15, "3sg": 15, "1pl": 15, "3pl": 15 } }],
  },
  ```

Identify the active points via `grep -n "personRotation: true" packages/db/src/curriculum/{es,tr}.ts` and cross-check each is NOT inside a `/* … */` or `//`-commented entry. (TR active: the A1 tense/copula/possessive points + `tr-a2-aorist`. ES active: the B1/B2 finite-tense/subjunctive/conditional points.)

- [ ] **Step 2: Author ONE new wordClass vocab spec (demonstrates a non-person axis)**

On the active vocab point `tr-a1-vocab-food-drink` (kind `vocab`), add (vocab target is capped at 10; floors sum to 10 so the target is unchanged):

```typescript
  coverageSpec: {
    // wordClass diversity: food/drink vocab is noun-dominant, with a few verbs
    // (eat/drink) and adjectives (tastes). Floors sum to the vocab target (10).
    axes: [{ name: "wordClass", floors: { noun: 6, verb: 2, adjective: 2 } }],
  },
```

- [ ] **Step 3: Author ONE new polarity axis on an existing person cell (demonstrates multi-axis + non-uniform floors)**

On `tr-a1-present-continuous` (already getting the TR A1 person spec from Step 1), extend its spec to two axes — person (uniform) + polarity (mild affirmative skew; both already tagged):

```typescript
  coverageSpec: {
    axes: [
      { name: "person", floors: { "1sg": 5, "2sg": 5, "3sg": 5, "1pl": 5, "2pl": 5, "3pl": 5 } },
      // Present continuous is naturally mostly affirmative; ensure negatives
      // still appear. Floors are coarse and skewed, not uniform-by-default.
      { name: "polarity", floors: { affirmative: 18, negative: 12 } },
    ],
  },
```

(Cell target becomes `max(20, max(30 person, 30 polarity)) = 30`. These floors would normally come from `propose:coverage-spec` + human review — see Task 13/14.)

- [ ] **Step 4: Bump the curriculum versions (clears scheduler suppression for the migrated cells)**

> The merge date may differ from today. The value MUST be a `YYYY-MM-DD` string **distinct from `'2026-06-13'`** (the current value, which already-run prod jobs recorded) so the scheduler's version-mismatch clears give-up/low-yield on the affected cells. If merging on a later date, use that date. For this branch, set both to the planned merge date; if that is unknown, use `'2026-06-14'` and confirm with the maintainer before release.

In `packages/db/src/curriculum/es.ts:34`:
```typescript
export const CURRICULUM_VERSION_ES = '2026-06-14';
```
In `packages/db/src/curriculum/tr.ts:43`:
```typescript
export const CURRICULUM_VERSION_TR = '2026-06-14';
```
(Leave `CURRICULUM_VERSION_DE` — German is disabled.)

- [ ] **Step 5: Run the curriculum invariants over the real data**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- curriculum.test.ts`
Expected: PASS — every migrated spec is legal; the version-format invariant (`YYYY-MM-DD`) still holds.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/curriculum/es.ts packages/db/src/curriculum/tr.ts
git commit -m "feat(db): migrate personRotation cells to coverageSpec; add wordClass+polarity specs; bump curriculum versions"
```

---

### Task 5: `applicableCoverageTags` passes the spec

**Files:**
- Modify: `packages/db/src/generation/coverage-tags.ts`
- Test: `packages/db/src/generation/coverage-tags.test.ts` (create if absent)

- [ ] **Step 1: Write a failing test**

In `packages/db/src/generation/coverage-tags.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { ExerciseType } from "@language-drill/shared";
import { applicableCoverageTags } from "./coverage-tags";
import type { Cell } from "./cells";

function cellWith(spec: Cell["grammarPoint"]["coverageSpec"]): Cell {
  return {
    cellKey: "tr:a1:cloze:tr-a1-x",
    language: "TR" as Cell["language"],
    cefrLevel: "A1",
    exerciseType: ExerciseType.CLOZE,
    grammarPoint: { coverageSpec: spec } as Cell["grammarPoint"],
  } as Cell;
}

describe("applicableCoverageTags", () => {
  it("keeps person when the cell's spec controls it", () => {
    const cell = cellWith({ axes: [{ name: "person", floors: { "3sg": 5 } }] });
    expect(applicableCoverageTags(cell, { person: "3sg", polarity: "affirmative" })).toEqual({
      person: "3sg",
      polarity: "affirmative",
    });
  });
  it("drops person when the cell has no spec", () => {
    const cell = cellWith(undefined);
    expect(applicableCoverageTags(cell, { person: "3sg", polarity: "affirmative" })).toEqual({
      polarity: "affirmative",
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/db test -- coverage-tags.test.ts`
Expected: FAIL (the call still passes `personRotation === true`).

- [ ] **Step 3: Update `applicableCoverageTags`**

Replace the body of `packages/db/src/generation/coverage-tags.ts`:

```typescript
import { pickCoverageTags, type CoverageTags } from "@language-drill/shared";

import type { Cell } from "./cells";

export function applicableCoverageTags(
  cell: Cell,
  coverage: CoverageTags,
): CoverageTags | null {
  return pickCoverageTags(
    coverage,
    cell.exerciseType,
    cell.grammarPoint.coverageSpec,
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/db test -- coverage-tags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/generation/coverage-tags.ts packages/db/src/generation/coverage-tags.test.ts
git commit -m "feat(db): applicableCoverageTags reads the cell's coverageSpec"
```

---

### Task 6: Floor-driven `resolveCellTarget` (delete the 1.5× multiplier)

**Files:**
- Modify: `infra/lambda/src/generation/cell-targets.ts`
- Test: `infra/lambda/src/generation/cell-targets.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `infra/lambda/src/generation/cell-targets.test.ts` (match the file's existing imports; it already constructs `Cell` fixtures):

```typescript
import { resolveCellTarget } from "./cell-targets";
import { ExerciseType } from "@language-drill/shared";
import type { Cell } from "@language-drill/db";

function cell(over: Partial<Cell> & { grammarPoint?: Partial<Cell["grammarPoint"]> }): Cell {
  return {
    cellKey: "k",
    language: "ES" as Cell["language"],
    cefrLevel: "B1",
    exerciseType: ExerciseType.CLOZE,
    grammarPoint: { key: "es-b1-x", kind: "grammar", ...(over.grammarPoint ?? {}) },
    ...over,
  } as Cell;
}

describe("resolveCellTarget (floor-driven)", () => {
  it("no spec → base table value (B1 cloze = 50)", () => {
    expect(resolveCellTarget(cell({}))).toBe(50);
  });
  it("person spec raises target to the floor sum (5×15 = 75 > base 50)", () => {
    const c = cell({
      grammarPoint: { key: "es-b1-x", kind: "grammar",
        coverageSpec: { axes: [{ name: "person", floors: { "1sg": 15, "2sg": 15, "3sg": 15, "1pl": 15, "3pl": 15 } }] } } as Cell["grammarPoint"],
    });
    expect(resolveCellTarget(c)).toBe(75);
  });
  it("takes the max over axes, not the sum of axes", () => {
    const c = cell({
      grammarPoint: { key: "tr-a1-x", kind: "grammar",
        coverageSpec: { axes: [
          { name: "person", floors: { "1sg": 5, "2sg": 5, "3sg": 5, "1pl": 5, "2pl": 5, "3pl": 5 } }, // Σ 30
          { name: "polarity", floors: { affirmative: 18, negative: 12 } }, // Σ 30
        ] } } as Cell["grammarPoint"],
      cefrLevel: "A1",
    });
    expect(resolveCellTarget(c)).toBe(30); // max(20 base, max(30, 30))
  });
  it("targetOverride wins over base but floor sum still applies as a floor", () => {
    const c = cell({ grammarPoint: { key: "es-b1-x", kind: "grammar", targetOverride: 12 } as Cell["grammarPoint"] });
    expect(resolveCellTarget(c)).toBe(12);
  });
  it("floor sum below base → base wins (vocab wordClass Σ10 < … but vocab base is 10)", () => {
    const c = cell({
      exerciseType: ExerciseType.VOCAB_RECALL,
      cefrLevel: "A1",
      grammarPoint: { key: "tr-a1-vocab-x", kind: "vocab",
        coverageSpec: { axes: [{ name: "wordClass", floors: { noun: 6, verb: 2, adjective: 2 } }] } } as Cell["grammarPoint"],
    });
    expect(resolveCellTarget(c)).toBe(10);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/infra test -- cell-targets.test.ts`
Expected: FAIL — `resolveCellTarget` still reads `personRotation` and the multiplier.

- [ ] **Step 3: Rewrite `resolveCellTarget` and delete the multiplier constants**

In `infra/lambda/src/generation/cell-targets.ts`:
- Delete `PERSON_ROTATION_TARGET_MULTIPLIER`, `PERSON_ROTATION_RAISED_TYPES`, and their doc comments.
- **Keep** `GIVE_UP_MIN_ATTEMPTS` and `CELL_TARGET_DEFAULTS`.
- Replace `resolveCellTarget`:

```typescript
/**
 * Resolve the generation target for a cell. Pure. Order: an explicit
 * `targetOverride` wins outright; otherwise the `(type, level)` table value (or
 * the `TARGET_PER_CELL` fallback) is raised, if needed, to cover the largest
 * single-axis floor sum in the cell's `coverageSpec`. One approved exercise
 * realizes one value per axis, so an axis whose floors sum to F needs ≥ F
 * exercises; taking the MAX over axes (never the product) guarantees headroom
 * for the tightest axis without multiplying axes together. Replaces the former
 * person-rotation 1.5× multiplier with exact floor arithmetic.
 */
export function resolveCellTarget(cell: Cell): number {
  const override = cell.grammarPoint.targetOverride;
  if (override !== undefined) return override;
  const fromTable = CELL_TARGET_DEFAULTS[cell.exerciseType][cell.cefrLevel];
  const base = fromTable ?? TARGET_PER_CELL;
  const spec = cell.grammarPoint.coverageSpec;
  if (!spec) return base;
  let maxAxisFloorSum = 0;
  for (const axis of spec.axes) {
    let sum = 0;
    for (const floor of Object.values(axis.floors)) sum += floor ?? 0;
    if (sum > maxAxisFloorSum) maxAxisFloorSum = sum;
  }
  return Math.max(base, maxAxisFloorSum);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/infra test -- cell-targets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/generation/cell-targets.ts infra/lambda/src/generation/cell-targets.test.ts
git commit -m "feat(generation): floor-driven cell target replaces the person-rotation 1.5x multiplier"
```

---

### Task 7: Generalize `coverage-decision.ts` to N axes (independent per-axis water-fill)

**Files:**
- Modify: `infra/lambda/src/generation/coverage-decision.ts`
- Test: `infra/lambda/src/generation/coverage-decision.test.ts`

- [ ] **Step 1: Replace the test file with multi-axis cases**

Overwrite `infra/lambda/src/generation/coverage-decision.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { CoverageSpec } from "@language-drill/shared";
import { decideCoverageTargets, GIVE_UP_MIN_ATTEMPTS } from "./coverage-decision";

const personTR: CoverageSpec = {
  axes: [{ name: "person", floors: { "1sg": 5, "2sg": 5, "3sg": 5, "1pl": 5, "2pl": 5, "3pl": 5 } }],
};
const personPolarity: CoverageSpec = {
  axes: [
    { name: "person", floors: { "1sg": 5, "2sg": 5, "3sg": 5, "1pl": 5, "2pl": 5, "3pl": 5 } },
    { name: "polarity", floors: { affirmative: 18, negative: 12 } },
  ],
};

describe("decideCoverageTargets (multi-axis)", () => {
  it("water-fills the most-starved person first", () => {
    const { coverageTargets } = decideCoverageTargets({
      spec: personTR,
      need: 3,
      approvedByAxis: { person: { "1sg": 8, "2sg": 8, "3sg": 8, "1pl": 8, "2pl": 1, "3pl": 2 } },
      recentOutcome: null,
    });
    // 2pl (1) and 3pl (2) are most starved; first three drafts target them.
    const persons = coverageTargets.map((t) => t.person);
    expect(persons).toContain("2pl");
    expect(persons).toContain("3pl");
    expect(coverageTargets).toHaveLength(3);
  });

  it("targets each axis independently and zips into per-draft targets", () => {
    const { coverageTargets } = decideCoverageTargets({
      spec: personPolarity,
      need: 4,
      approvedByAxis: {},
      recentOutcome: null,
    });
    expect(coverageTargets).toHaveLength(4);
    for (const t of coverageTargets) {
      expect(t.person).toBeDefined();
      expect(["affirmative", "negative"]).toContain(t.polarity);
    }
    // polarity water-fills evenly from zero: 2 affirmative, 2 negative across 4.
    const pol = coverageTargets.map((t) => t.polarity);
    expect(pol.filter((p) => p === "affirmative")).toHaveLength(2);
  });

  it("suppresses a zero-yield (axis,value) bucket and excludes it", () => {
    const { coverageTargets, suppressed } = decideCoverageTargets({
      spec: personTR,
      need: 5,
      approvedByAxis: { person: { "1sg": 8, "2sg": 8, "3sg": 8, "1pl": 8, "3pl": 8 } },
      recentOutcome: { person: { "2pl": { requested: GIVE_UP_MIN_ATTEMPTS, approved: 0 } } },
    });
    expect(suppressed.person).toEqual(["2pl"]);
    expect(coverageTargets.map((t) => t.person)).not.toContain("2pl");
  });

  it("null recentOutcome suppresses nothing", () => {
    const { suppressed } = decideCoverageTargets({
      spec: personTR,
      need: 2,
      approvedByAxis: {},
      recentOutcome: null,
    });
    expect(suppressed).toEqual({});
  });

  it("never targets an NA value (absent from floors)", () => {
    const esPerson: CoverageSpec = {
      axes: [{ name: "person", floors: { "1sg": 15, "2sg": 15, "3sg": 15, "1pl": 15, "3pl": 15 } }],
    };
    const { coverageTargets } = decideCoverageTargets({
      spec: esPerson,
      need: 10,
      approvedByAxis: {},
      recentOutcome: null,
    });
    expect(coverageTargets.map((t) => t.person)).not.toContain("2pl");
  });

  it("need <= 0 → empty targets, still reports suppressed", () => {
    const { coverageTargets, suppressed } = decideCoverageTargets({
      spec: personTR,
      need: 0,
      approvedByAxis: {},
      recentOutcome: { person: { "2pl": { requested: 3, approved: 0 } } },
    });
    expect(coverageTargets).toEqual([]);
    expect(suppressed.person).toEqual(["2pl"]);
  });

  it("an axis with every value suppressed drops out while others still target", () => {
    const { coverageTargets } = decideCoverageTargets({
      spec: { axes: [{ name: "polarity", floors: { affirmative: 5, negative: 5 } }, { name: "person", floors: { "3sg": 5 } }] },
      need: 2,
      approvedByAxis: {},
      recentOutcome: { polarity: { affirmative: { requested: 2, approved: 0 }, negative: { requested: 2, approved: 0 } } },
    });
    expect(coverageTargets).toHaveLength(2);
    for (const t of coverageTargets) {
      expect(t.polarity).toBeUndefined(); // polarity fully suppressed → absent
      expect(t.person).toBe("3sg");
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/infra test -- coverage-decision.test.ts`
Expected: FAIL — current module is person-only and takes `{ language, approvedByPerson, … }`.

- [ ] **Step 3: Rewrite `coverage-decision.ts`**

Overwrite `infra/lambda/src/generation/coverage-decision.ts`:

```typescript
/**
 * Pure, axis-agnostic coverage-controller decision logic (Pool Coverage
 * Controller, Phase 2). No `@aws-sdk/*`, no Drizzle, no env — pure inputs →
 * pure output, unit-tested in isolation. Generalizes the Phase-1 person-only
 * water-fill: for each axis in the spec INDEPENDENTLY, greedily fill each draft
 * into the eligible value currently lowest in the approved pool (realizing the
 * per-value floors without an explicit floor term), then zip the per-axis
 * sequences into per-draft `CoverageTarget`s. The cross-product emerges in the
 * drafts but is never measured or suppressed — give-up is strictly
 * per-`(axis, value)`. A value absent from `floors` is "NA" (never targeted); a
 * value targeted >= GIVE_UP_MIN_ATTEMPTS last batch with zero approvals is
 * suppressed until a CURRICULUM_VERSION bump clears it (caller passes
 * `recentOutcome: null`).
 */

import {
  COVERAGE_AXIS_VALUES,
  type CoverageAxis,
  type CoverageOutcome,
  type CoverageSpec,
  type CoverageTarget,
} from "@language-drill/shared";
import { GIVE_UP_MIN_ATTEMPTS } from "./cell-targets";

export { GIVE_UP_MIN_ATTEMPTS };

export type CoverageDecisionInput = {
  spec: CoverageSpec;
  /** decideEnqueue's scalar need (= target − approvedInPool). */
  need: number;
  /** Measured approved-pool count per axis/value (from coverage_tags GROUP BY). */
  approvedByAxis: Partial<Record<CoverageAxis, Partial<Record<string, number>>>>;
  /**
   * The most-recent succeeded job's outcome — ONLY when that job's
   * curriculumVersion matches the on-disk constant. `null` clears all give-up.
   */
  recentOutcome: CoverageOutcome | null;
};

export type CoverageDecision = {
  /** length === max(0, need) when any axis is targetable; [] otherwise. */
  coverageTargets: CoverageTarget[];
  /** Per-axis values excluded as zero-yield — surfaced for the scheduler log. */
  suppressed: Partial<Record<CoverageAxis, string[]>>;
};

/** Floor values in canonical paradigm order (1sg,2sg,… / affirmative,negative,…). */
function orderedFloorValues(axis: CoverageSpec["axes"][number]): string[] {
  const order = COVERAGE_AXIS_VALUES[axis.name];
  return order.filter((v) => v in axis.floors);
}

function suppressedFor(
  axis: CoverageSpec["axes"][number],
  recentOutcome: CoverageOutcome | null,
): string[] {
  const out = recentOutcome?.[axis.name];
  if (!out) return [];
  return orderedFloorValues(axis).filter((v) => {
    const o = out[v];
    return o !== undefined && o.requested >= GIVE_UP_MIN_ATTEMPTS && o.approved === 0;
  });
}

export function decideCoverageTargets(
  input: CoverageDecisionInput,
): CoverageDecision {
  const { spec, need, approvedByAxis, recentOutcome } = input;

  const suppressed: Partial<Record<CoverageAxis, string[]>> = {};
  for (const axis of spec.axes) {
    const s = suppressedFor(axis, recentOutcome);
    if (s.length > 0) suppressed[axis.name] = s;
  }

  if (need <= 0) return { coverageTargets: [], suppressed };

  // Build an independent water-filled sequence of length `need` per axis.
  const perAxisSeq: Partial<Record<CoverageAxis, string[]>> = {};
  for (const axis of spec.axes) {
    const eligible = orderedFloorValues(axis).filter(
      (v) => !(suppressed[axis.name]?.includes(v) ?? false),
    );
    if (eligible.length === 0) continue; // axis contributes no constraint
    const counts = new Map<string, number>(
      eligible.map((v) => [v, approvedByAxis[axis.name]?.[v] ?? 0]),
    );
    const seq: string[] = [];
    for (let i = 0; i < need; i++) {
      let best = eligible[0];
      for (const v of eligible) {
        if ((counts.get(v) ?? 0) < (counts.get(best) ?? 0)) best = v;
      }
      seq.push(best);
      counts.set(best, (counts.get(best) ?? 0) + 1);
    }
    perAxisSeq[axis.name] = seq;
  }

  const activeAxes = Object.keys(perAxisSeq) as CoverageAxis[];
  if (activeAxes.length === 0) return { coverageTargets: [], suppressed };

  const coverageTargets: CoverageTarget[] = [];
  for (let i = 0; i < need; i++) {
    const target: CoverageTarget = {};
    for (const axis of activeAxes) target[axis] = perAxisSeq[axis]![i];
    coverageTargets.push(target);
  }
  return { coverageTargets, suppressed };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/infra test -- coverage-decision.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/generation/coverage-decision.ts infra/lambda/src/generation/coverage-decision.test.ts
git commit -m "feat(generation): generalize coverage decision to independent per-axis water-fill"
```

---

### Task 8: Job-message contract — `coverageTargets` replaces `personTargets`

**Files:**
- Modify: `infra/lambda/src/generation/job-message.ts`
- Test: `infra/lambda/src/generation/job-message.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `infra/lambda/src/generation/job-message.test.ts` (reuse the file's existing valid-message builder; shown here inline for clarity):

```typescript
import { parseGenerationJobMessage } from "./job-message";

function valid(over: Record<string, unknown> = {}): unknown {
  return {
    jobId: "11111111-1111-1111-1111-111111111111",
    trigger: "scheduled",
    spec: {
      language: "TR",
      cefrLevel: "A1",
      exerciseType: "cloze",
      grammarPointKey: "tr-a1-x",
      topicDomain: null,
      count: 2,
      batchSeed: "s",
      ...over,
    },
    maxCostUsd: 0.5,
  };
}

describe("coverageTargets parsing", () => {
  it("round-trips valid per-draft targets of length === count", () => {
    const msg = parseGenerationJobMessage(
      valid({ coverageTargets: [{ person: "3sg" }, { person: "2pl", polarity: "negative" }] }),
    );
    expect(msg.spec.coverageTargets).toEqual([
      { person: "3sg" },
      { person: "2pl", polarity: "negative" },
    ]);
  });
  it("absent → undefined", () => {
    expect(parseGenerationJobMessage(valid()).spec.coverageTargets).toBeUndefined();
  });
  it("rejects length !== count", () => {
    expect(() => parseGenerationJobMessage(valid({ coverageTargets: [{ person: "3sg" }] }))).toThrow(
      /length === spec.count/,
    );
  });
  it("rejects an unknown axis", () => {
    expect(() =>
      parseGenerationJobMessage(valid({ coverageTargets: [{ tense: "past" }, { person: "1sg" }] })),
    ).toThrow(/unknown axis/);
  });
  it("rejects an illegal value for an axis", () => {
    expect(() =>
      parseGenerationJobMessage(valid({ coverageTargets: [{ person: "9sg" }, { person: "1sg" }] })),
    ).toThrow(/illegal value/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/infra test -- job-message.test.ts`
Expected: FAIL — `coverageTargets` not parsed.

- [ ] **Step 3: Update the type, parser, and helper**

In `infra/lambda/src/generation/job-message.ts`:

Update imports — add `CoverageAxis`, `CoverageTarget`, and `COVERAGE_AXIS_VALUES`; the `PERSON_CODES`/`PersonCode` imports may be dropped if unused afterward:

```typescript
import {
  ExerciseType,
  Language,
  COVERAGE_AXIS_VALUES,
  type CoverageAxis,
  type CoverageTarget,
  type LearningLanguage,
} from "@language-drill/shared";
```

In the `GenerationJobMessage['spec']` shape, replace the `personTargets?: PersonCode[];` field with:

```typescript
    /**
     * Phase 2 coverage controller: explicit per-draft axis targets. When
     * present, MUST be an array of length === `count`; each element a sparse
     * `{ axis: value }` map over known coverage axes/values. Absent on CLI/admin
     * and non-spec scheduled cells.
     */
    coverageTargets?: CoverageTarget[];
```

In `parseGenerationJobMessage`, replace the `personTargets` local + the spread:

```typescript
  const coverageTargets = optionalCoverageTargets(specValue, count);
```
```typescript
      batchSeed,
      ...(coverageTargets !== undefined ? { coverageTargets } : {}),
```

Replace the `optionalPersonTargets` helper with `optionalCoverageTargets`:

```typescript
const VALID_AXES = new Set(Object.keys(COVERAGE_AXIS_VALUES));

function optionalCoverageTargets(
  spec: Record<string, unknown>,
  count: number,
): CoverageTarget[] | undefined {
  const value = spec["coverageTargets"];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(
      `spec.coverageTargets: expected array or undefined, got ${describe(value)}`,
    );
  }
  if (value.length !== count) {
    throw new Error(
      `spec.coverageTargets: expected length === spec.count (${count}), got ${value.length}`,
    );
  }
  const out: CoverageTarget[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      throw new Error(
        `spec.coverageTargets: each element must be an object, got ${describe(entry)}`,
      );
    }
    const target: CoverageTarget = {};
    for (const [axis, v] of Object.entries(entry)) {
      if (!VALID_AXES.has(axis)) {
        throw new Error(`spec.coverageTargets: unknown axis '${axis}'`);
      }
      const legal = COVERAGE_AXIS_VALUES[axis as CoverageAxis];
      if (typeof v !== "string" || !legal.includes(v)) {
        throw new Error(
          `spec.coverageTargets: illegal value ${JSON.stringify(v)} for axis '${axis}'`,
        );
      }
      target[axis as CoverageAxis] = v;
    }
    out.push(target);
  }
  return out;
}
```

(If `VALID_PERSON_CODES` is now unused, delete it.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/infra test -- job-message.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/generation/job-message.ts infra/lambda/src/generation/job-message.test.ts
git commit -m "feat(generation): job message carries per-draft coverageTargets (replaces personTargets)"
```

---

### Task 9: `renderCoverageBlock` + thread `coverageTargets` through generation

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts`
- Modify: `packages/ai/src/generate.ts` (`GenerationSpec`, `generateOneDraft` call)
- Modify: `packages/ai/src/index.ts` (drop removed exports)
- Test: `packages/ai/src/generation-prompts.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/ai/src/generation-prompts.test.ts` (match its existing `GenerationPromptInputs` fixtures):

```typescript
import { buildGenerationUserPrompt } from "./generation-prompts";

function inputs(over: Record<string, unknown> = {}) {
  return {
    language: Language.TR,
    cefrLevel: CefrLevel.A1,
    exerciseType: ExerciseType.CLOZE,
    grammarPoint: getGrammarPoint("tr-a1-present-continuous"),
    ...over,
  } as Parameters<typeof buildGenerationUserPrompt>[0];
}

describe("renderCoverageBlock (via buildGenerationUserPrompt)", () => {
  it("emits a person directive with the language display label", () => {
    const out = buildGenerationUserPrompt(inputs(), 0, null, null, [{ person: "2pl" }]);
    expect(out).toContain("2pl (siz)");
  });
  it("emits one directive per axis when the target is multi-axis", () => {
    const out = buildGenerationUserPrompt(inputs(), 0, null, null, [{ person: "1sg", polarity: "negative" }]);
    expect(out).toContain("1sg (ben)");
    expect(out).toContain("negative");
  });
  it("emits a wordClass directive for vocab", () => {
    const out = buildGenerationUserPrompt(
      inputs({ exerciseType: ExerciseType.VOCAB_RECALL, grammarPoint: getGrammarPoint("tr-a1-vocab-food-drink") }),
      0,
      null,
      null,
      [{ wordClass: "verb" }],
    );
    expect(out).toContain("verb");
  });
  it("emits no directive when there is no target for the ordinal", () => {
    const withTargets = buildGenerationUserPrompt(inputs(), 0, null, null, [{ person: "1sg" }]);
    const without = buildGenerationUserPrompt(inputs(), 0, null, null, undefined);
    expect(without).not.toContain("Target grammatical person");
    expect(withTargets).toContain("Target grammatical person");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts.test.ts`
Expected: FAIL — `buildGenerationUserPrompt` still takes `(…, batchSeed, personTargets)`.

- [ ] **Step 3: Replace `renderPersonBlock` with `renderCoverageBlock`; delete blind rotation**

In `packages/ai/src/generation-prompts.ts`:

- **Delete** `personForOrdinal` and `personRotationPhase` (the blind-ordinal mechanism — the controller now always supplies targets). **Keep** `PERSON_ROTATION_BY_LANGUAGE`, `personCodesForLanguage`, and `personDisplayForCode`.
- Add a per-axis directive table and the new render function (place where `renderPersonBlock` was):

```typescript
import type { CoverageAxis, CoverageTarget, PersonCode } from "@language-drill/shared";

/** Non-person directive templates. Person is handled separately (it needs the
 *  per-language display label + the grammar-point escape hatch). */
const COVERAGE_DIRECTIVE_BY_AXIS: Record<
  Exclude<CoverageAxis, "person">,
  (value: string) => string
> = {
  polarity: (v) =>
    `The target sentence MUST be ${v} (${v === "negative" ? "negated" : "a positive statement"}).`,
  wordClass: (v) => `The target word the learner must produce MUST be a ${v}.`,
  sentenceType: (v) => `The target sentence MUST be ${v} in clause type.`,
};

/**
 * Render the per-draft coverage directive block (Pool Coverage Controller,
 * Phase 2). One sentence per axis present in `coverageTargets[ordinal]`. Returns
 * "" when there is no target for the ordinal — there is no blind fallback; the
 * scheduler always supplies targets for a spec'd cell. The block lives in the
 * UNCACHED per-draft user prompt, so the cached system prefix is unchanged.
 */
function renderCoverageBlock(
  inputs: GenerationPromptInputs,
  ordinal: number,
  coverageTargets?: readonly CoverageTarget[],
): string {
  const target = coverageTargets?.[ordinal];
  if (!target) return "";
  const parts: string[] = [];
  if (target.person) {
    const person = personDisplayForCode(inputs.language, target.person as PersonCode);
    parts.push(
      `Target grammatical person for this draft: ${person}. ` +
        `The form the learner must produce MUST be marked for this person, and the visible sentence/context MUST make the person unambiguously recoverable (overt subject pronoun, possessor, vocative, or unambiguous context) WITHOUT revealing the conjugated form itself. ` +
        `If ${inputs.grammarPoint.name} cannot naturally express this person, use the closest natural person instead.`,
    );
  }
  for (const axis of ["polarity", "wordClass", "sentenceType"] as const) {
    const v = target[axis];
    if (v) parts.push(COVERAGE_DIRECTIVE_BY_AXIS[axis](v));
  }
  return parts.length > 0 ? parts.join(" ") + "\n\n" : "";
}
```

- Update `buildGenerationUserPrompt` — drop the `batchSeed` param, replace `personTargets` with `coverageTargets`:

```typescript
export function buildGenerationUserPrompt(
  inputs: GenerationPromptInputs,
  ordinal: number,
  topicDomain: string | null,
  seedWord: string | null = null,
  coverageTargets: readonly CoverageTarget[] | undefined = undefined,
): string {
  const toolName = TOOL_NAME_BY_TYPE[inputs.exerciseType];
  const domain = topicDomain ?? "mixed";
  const seedBlock =
    seedWord && seedWord.length > 0
      ? `Build this exercise around the word "${seedWord}". If "${seedWord}" does not fit ${inputs.grammarPoint.name} naturally, choose a related content word of similar frequency instead.\n\n`
      : "";
  const modeBlock =
    inputs.exerciseType === ExerciseType.SENTENCE_CONSTRUCTION
      ? `Use prompt mode: ${sentenceConstructionModeForOrdinal(ordinal)}.\n\n`
      : "";
  const coverageBlock = renderCoverageBlock(inputs, ordinal, coverageTargets);
  return `Produce exercise #${ordinal + 1}.

Topic domain: ${domain}

${modeBlock}${coverageBlock}${seedBlock}Use the ${toolName} tool.`;
}
```

- [ ] **Step 4: Update `GenerationSpec` + the `generateOneDraft` call in `generate.ts`**

In `packages/ai/src/generate.ts`:
- Replace the `personTargets?: readonly PersonCode[];` field (lines ~331–336) with:

```typescript
  /**
   * Phase 2 coverage controller: explicit per-ordinal axis targets
   * (`coverageTargets[ordinal]`) from the scheduler. `undefined` → no coverage
   * directive (CLI/admin and non-spec cells). Length matches `count` when set.
   */
  coverageTargets?: readonly CoverageTarget[];
```
- Add `CoverageTarget` to the shared import; drop `PersonCode` if now unused in this file.
- Update the `buildGenerationUserPrompt` call (lines ~764–771):

```typescript
  const userText = buildGenerationUserPrompt(
    promptInputs,
    ordinal,
    spec.topicDomain,
    spec.seedWords?.[ordinal] ?? null,
    spec.coverageTargets,
  );
```

- [ ] **Step 5: Update `packages/ai/src/index.ts` exports**

Remove `personForOrdinal` and `personRotationPhase` from the `./generation-prompts.js` export block (keep `PERSON_ROTATION_BY_LANGUAGE`, `personCodesForLanguage`, `personDisplayForCode`).

- [ ] **Step 6: Run to verify pass**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts.test.ts`
Expected: PASS. Then fix any now-broken references to the deleted functions surfaced by:
Run: `pnpm --filter @language-drill/ai typecheck`
Expected: PASS (update `generation-prompts.test.ts` if it referenced `personForOrdinal`/`personRotationPhase`).

- [ ] **Step 7: Commit**

```bash
git add packages/ai/src/generation-prompts.ts packages/ai/src/generate.ts packages/ai/src/index.ts packages/ai/src/generation-prompts.test.ts
git commit -m "feat(ai): renderCoverageBlock renders per-axis directives; drop blind person rotation"
```

---

### Task 10: Widen the `coverage_outcome` schema `$type` (no SQL migration)

**Files:**
- Modify: `packages/db/src/schema/generation.ts` (the `coverageOutcome` column comment; `$type` is already `CoverageOutcome`)

- [ ] **Step 1: Confirm the `$type` already resolves to the generalized type**

The column is `jsonb('coverage_outcome').$type<CoverageOutcome>()`. `CoverageOutcome` was widened in Task 1, so no code change is required beyond updating the doc comment. Replace the column's doc comment with:

```typescript
    /**
     * Axis-keyed generation outcome for this batch (Pool Coverage Controller,
     * Phase 2): `{ person?: {…}, polarity?: {…}, wordClass?: {…} }`, each axis a
     * `{ value: { requested, approved } }` map. `requested` = drafts targeted at
     * each value; `approved` = approved drafts whose *realized* value equals it.
     * The scheduler reads this back to give up per-(axis,value) bucket. NULL on
     * legacy rows and cells that did no coverage targeting. Phase-1 rows
     * (`{ person: … }`) remain valid. Written by `run-one-cell`. Reusing the
     * existing JSONB column → no migration.
     */
```

- [ ] **Step 2: Verify Drizzle reports NO schema diff**

Run: `pnpm --filter @language-drill/db db:generate` (or the repo's drizzle-kit generate command)
Expected: "No schema changes, nothing to migrate" (or equivalent). If it emits a migration, discard it — the JSONB column is unchanged.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/generation.ts
git commit -m "docs(db): widen coverage_outcome doc to the generalized CoverageOutcome (no migration)"
```

---

### Task 11: Multi-axis outcome tally in `run-one-cell` + realized coverage in `validate-and-insert`

**Files:**
- Modify: `packages/db/src/generation/validate-and-insert.ts` (`DraftOutcome.realizedPerson` → `realizedCoverage`)
- Modify: `packages/db/src/generation/run-one-cell.ts` (args, tally, spec assembly)
- Test: `packages/db/src/generation/run-one-cell.test.ts` (extend existing)

- [ ] **Step 1: Generalize `DraftOutcome` to carry full realized coverage**

In `packages/db/src/generation/validate-and-insert.ts`:
- Replace the `realizedPerson?: PersonCode;` field (line ~136) with:

```typescript
  /**
   * The validator's realized coverage tags for an inserted draft (Phase 2
   * coverage controller). Set ONLY on the inserted-* / dedup-then-success
   * branches, from the SAME `result.coverage` written to `exercises.coverageTags`.
   * The per-axis tally in `run-one-cell` credits `approved` by these realized
   * values. `undefined` for rejected/dedup ordinals.
   */
  realizedCoverage?: CoverageTags;
```
- Add `CoverageTags` to the shared import (drop `PersonCode` if unused).
- At the assignment site (line ~491), replace `realizedPerson: result.coverage.person` with:

```typescript
        realizedCoverage: result.coverage,
```

- [ ] **Step 2: Write a failing test for the multi-axis tally**

Extend `packages/db/src/generation/run-one-cell.test.ts`. If the suite mocks generation+validation, add a case asserting the persisted `coverageOutcome`; otherwise add a focused unit test by extracting the tally into a pure helper. **Preferred: add a pure helper and test it directly.** Add to `run-one-cell.ts` (exported) and test:

In `run-one-cell.test.ts`:

```typescript
import { tallyCoverageOutcome } from "./run-one-cell";
import type { CoverageSpec, CoverageTarget, CoverageTags } from "@language-drill/shared";

describe("tallyCoverageOutcome", () => {
  const spec: CoverageSpec = {
    axes: [
      { name: "person", floors: { "1sg": 5, "2sg": 5, "3sg": 5, "1pl": 5, "2pl": 5, "3pl": 5 } },
      { name: "polarity", floors: { affirmative: 5, negative: 5 } },
    ],
  };
  it("counts requested by target and approved by realized value, per axis", () => {
    const targets: CoverageTarget[] = [
      { person: "2pl", polarity: "negative" },
      { person: "1sg", polarity: "affirmative" },
    ];
    // draft 0 approved, realized person 3sg (escape hatch) + polarity negative;
    // draft 1 approved, realized exactly as targeted.
    const realized: (CoverageTags | undefined)[] = [
      { person: "3sg", polarity: "negative" },
      { person: "1sg", polarity: "affirmative" },
    ];
    const out = tallyCoverageOutcome(spec, targets, realized);
    expect(out).toEqual({
      person: {
        "2pl": { requested: 1, approved: 0 },
        "1sg": { requested: 1, approved: 1 },
        "3sg": { requested: 0, approved: 1 },
      },
      polarity: {
        negative: { requested: 1, approved: 1 },
        affirmative: { requested: 1, approved: 1 },
      },
    });
  });
  it("returns null when there were no targets", () => {
    expect(tallyCoverageOutcome(spec, undefined, [])).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @language-drill/db test -- run-one-cell.test.ts`
Expected: FAIL — `tallyCoverageOutcome` not exported.

- [ ] **Step 4: Add `tallyCoverageOutcome` and rewire the tally**

In `packages/db/src/generation/run-one-cell.ts`:
- Update imports: drop `PersonOutcome`/`PersonCode` (if now unused), add `CoverageOutcome`, `CoverageSpec`, `CoverageTarget`, `CoverageTags`, `CoverageAxis`.
- Add the pure helper (near the top, exported):

```typescript
/**
 * Build the per-axis `coverage_outcome` tally for a batch (Phase 2). `requested`
 * counts each draft's targeted value per axis; `approved` counts approved
 * drafts by their REALIZED value per axis (so a draft targeted at `2pl` but
 * realized as `3sg` via the escape hatch credits `3sg`, not `2pl`). Only the
 * axes the batch actually targeted (present in the first target) are tallied.
 * Returns `null` when there were no targets.
 */
export function tallyCoverageOutcome(
  spec: CoverageSpec | undefined,
  coverageTargets: readonly CoverageTarget[] | undefined,
  realizedPerApprovedOrdinal: readonly (CoverageTags | undefined)[],
): CoverageOutcome | null {
  if (!spec || !coverageTargets || coverageTargets.length === 0) return null;
  const activeAxes = Object.keys(coverageTargets[0]) as CoverageAxis[];
  if (activeAxes.length === 0) return null;
  const acc: CoverageOutcome = {};
  const bump = (axis: CoverageAxis, value: string, field: "requested" | "approved") => {
    const axisAcc = (acc[axis] ??= {});
    const bucket = (axisAcc[value] ??= { requested: 0, approved: 0 });
    bucket[field] += 1;
  };
  for (const target of coverageTargets) {
    for (const axis of activeAxes) {
      const v = target[axis];
      if (v) bump(axis, v, "requested");
    }
  }
  for (const realized of realizedPerApprovedOrdinal) {
    if (!realized) continue;
    for (const axis of activeAxes) {
      const v = realized[axis];
      if (v) bump(axis, v, "approved");
    }
  }
  return Object.keys(acc).length > 0 ? acc : null;
}
```

- Replace the args field `personTargets?: readonly PersonCode[];` (line ~221) with:

```typescript
    /**
     * Phase 2 coverage controller: explicit per-ordinal axis targets from the
     * scheduler (length === count). `undefined` → no coverage targeting/tally
     * (CLI/admin and non-spec cells).
     */
    coverageTargets?: readonly CoverageTarget[];
```

- Replace the Phase-1 `personOutcome`/`creditApproved` block (lines ~429–444) with realized-coverage accumulation:

```typescript
  // Phase 2 per-axis tally: collect the realized coverage of each APPROVED
  // ordinal, then build the outcome once at the end via `tallyCoverageOutcome`.
  const coverageTargets = args.coverageTargets;
  const approvedRealized: (CoverageTags | undefined)[] = [];
  const creditApproved = (realized: CoverageTags | undefined): void => {
    if (!coverageTargets) return;
    approvedRealized.push(realized);
  };
```

- The `creditApproved(outcome.realizedPerson)` calls (lines ~578, ~601) become:

```typescript
          creditApproved(outcome.realizedCoverage);
```

- Replace the `coverageOutcome` construction (lines ~629–634) with:

```typescript
  const coverageOutcome = tallyCoverageOutcome(
    cell.grammarPoint.coverageSpec,
    coverageTargets,
    approvedRealized,
  );
```

- In the `spec` assembly (line ~490), replace `personTargets: args.personTargets` with:

```typescript
      coverageTargets: args.coverageTargets,
```

- Update the `CellResult.coverageOutcome` field doc (line ~196) to say "per-axis" and the type is already `CoverageOutcome | null`.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @language-drill/db test -- run-one-cell.test.ts`
Expected: PASS. Also run `pnpm --filter @language-drill/db typecheck` and fix any residual `realizedPerson`/`personTargets` references.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/generation/run-one-cell.ts packages/db/src/generation/validate-and-insert.ts packages/db/src/generation/run-one-cell.test.ts
git commit -m "feat(db): multi-axis coverage_outcome tally; DraftOutcome carries realized coverage"
```

---

### Task 12: Scheduler wiring — measure all axes, decide, attach `coverageTargets`

**Files:**
- Modify: `infra/lambda/src/generation/scheduler.ts`
- Modify: `infra/lambda/src/generation/handler.ts:244` (pass `coverageTargets`)
- Test: `infra/lambda/src/generation/scheduler.test.ts`

- [ ] **Step 1: Write failing scheduler tests**

Extend `infra/lambda/src/generation/scheduler.test.ts`. Mirror the existing Phase-1 tests but use a `coverageSpec` cell. Add (adapt the existing `mockExecute` query-sequencing helpers in the file):

```typescript
// A spec'd cell under target with a skewed person distribution gets
// coverageTargets weighted to the deficit; a no-spec cell gets none; a
// version mismatch clears give-up. (Use the file's existing harness for the
// approved-count aggregate, recent-job query, and the coverage GROUP BY.)
```

Concretely, add three `it(...)` cases asserting:
1. For a `coverageSpec` (person) cell whose approved coverage rows are 3sg-heavy and which is under target, the emitted message has `spec.coverageTargets` of length `count`, weighted away from `3sg`.
2. A cell with `coverageSpec === undefined` emits a message with no `coverageTargets`.
3. A recent job with `coverage_outcome: { person: { '2pl': { requested: 5, approved: 0 } } }` whose `curriculum_version` differs from on-disk does NOT suppress `2pl` (give-up cleared); when it matches, `2pl` is suppressed and a `"coverage controller: buckets given up"` log line carries `{ person: ['2pl'] }`.

(Model these on the existing Phase-1 `personTargets` tests in the same file — same mock-row shapes, with `personTargets` → `coverageTargets` and the per-person aggregate generalized to the `tag.key/tag.value` rows.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/infra test -- scheduler.test.ts`
Expected: FAIL.

- [ ] **Step 3: Generalize the approved-coverage query**

In `infra/lambda/src/generation/scheduler.ts`, replace `loadApprovedPersonCountsPerCell` with `loadApprovedCoverageCountsPerCell` (unnest all axes, like the admin pool-status query):

```typescript
async function loadApprovedCoverageCountsPerCell(
  db: Db,
): Promise<Map<string, Partial<Record<CoverageAxis, Partial<Record<string, number>>>>>> {
  const result = await db.execute(sql`
    SELECT language, difficulty, type, grammar_point_key AS grammar_point_key,
           tag.key   AS axis,
           tag.value AS value,
           COUNT(*)::int AS n
    FROM exercises
    CROSS JOIN LATERAL jsonb_each_text(coverage_tags) AS tag
    WHERE review_status IN ('auto-approved', 'manual-approved')
      AND coverage_tags IS NOT NULL
    GROUP BY language, difficulty, type, grammar_point_key, tag.key, tag.value
  `);

  type Row = {
    language: string;
    difficulty: string;
    type: string;
    grammar_point_key: string;
    axis: string;
    value: string;
    n: number;
  };
  const rows = result.rows as unknown as Row[];
  const validAxes = new Set(Object.keys(COVERAGE_AXIS_VALUES));
  const map = new Map<string, Partial<Record<CoverageAxis, Partial<Record<string, number>>>>>();
  for (const row of rows) {
    if (!validAxes.has(row.axis)) continue;
    const key = buildCellKeyFromRow({
      language: row.language,
      difficulty: row.difficulty,
      type: row.type,
      grammarPointKey: row.grammar_point_key,
    });
    const cellAxes = map.get(key) ?? {};
    const axisMap = cellAxes[row.axis as CoverageAxis] ?? {};
    axisMap[row.value] = row.n;
    cellAxes[row.axis as CoverageAxis] = axisMap;
    map.set(key, cellAxes);
  }
  return map;
}
```

Update the call site (the variable previously `approvedPersonByCell`) to `approvedCoverageByCell = await loadApprovedCoverageCountsPerCell(db)`.

- [ ] **Step 4: Generalize the per-cell decision block**

Replace the Phase-1 person-only block (scheduler.ts ~330–362) with:

```typescript
    // Phase 2 coverage controller — any axis the cell's coverageSpec controls.
    const spec = cell.grammarPoint.coverageSpec;
    if (!spec) return base;

    const recentJob = recentJobByCell.get(cell.cellKey) ?? null;
    const curriculumVersionOnDisk =
      CURRICULUM_VERSION_BY_LANGUAGE[cell.language as LearningLanguage];
    // Give-up clears on a curriculum bump: only feed the recent outcome when its
    // version still matches on-disk (same gate as decideEnqueue's suppression).
    const recentOutcome =
      recentJob && recentJob.curriculumVersion === curriculumVersionOnDisk
        ? (recentJob.coverageOutcome ?? null)
        : null;

    const { coverageTargets, suppressed } = decideCoverageTargets({
      spec,
      need,
      approvedByAxis: approvedCoverageByCell.get(cell.cellKey) ?? {},
      recentOutcome,
    });

    if (Object.keys(suppressed).length > 0) {
      log({
        level: 'info',
        cellKey: cell.cellKey,
        suppressed,
        message: 'coverage controller: buckets given up',
      });
    }

    if (coverageTargets.length === 0) return base; // nothing targetable

    return { ...base, spec: { ...base.spec, coverageTargets } };
```

Update imports in `scheduler.ts`: add `COVERAGE_AXIS_VALUES`, `type CoverageAxis`; the `recentOutcome` is now the whole `CoverageOutcome` (its `Row.coverage_outcome` type in `loadMostRecentSucceededJobPerCell` is already `CoverageOutcome | null`, so no change there). Drop the `PersonCode` import if unused.

- [ ] **Step 5: Update the handler to pass `coverageTargets`**

In `infra/lambda/src/generation/handler.ts:244`, replace:

```typescript
                coverageTargets: parsed.spec.coverageTargets,
```

- [ ] **Step 6: Run to verify pass + typecheck the package**

Run: `pnpm --filter @language-drill/infra test -- scheduler.test.ts`
Expected: PASS.
Run: `pnpm --filter @language-drill/infra typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add infra/lambda/src/generation/scheduler.ts infra/lambda/src/generation/handler.ts infra/lambda/src/generation/scheduler.test.ts
git commit -m "feat(generation): scheduler measures all axes and emits per-axis coverageTargets"
```

---

### Task 13: Proposal prompt + forced tool + parser (`coverage-spec-proposal.ts`)

**Files:**
- Create: `packages/ai/src/coverage-spec-proposal.ts`
- Test: `packages/ai/src/coverage-spec-proposal.test.ts`

- [ ] **Step 1: Write failing tests for the parser + prompt builder**

Create `packages/ai/src/coverage-spec-proposal.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { getGrammarPoint } from "@language-drill/db";
import {
  buildCoverageSpecProposalUserPrompt,
  parseCoverageSpecProposal,
  COVERAGE_SPEC_PROPOSAL_PROMPT_VERSION,
} from "./coverage-spec-proposal";

describe("parseCoverageSpecProposal", () => {
  it("accepts a valid proposal and returns a CoverageSpec + rationale", () => {
    const out = parseCoverageSpecProposal({
      axes: [
        { name: "person", floors: { "1sg": 5, "3sg": 5 }, rationale: "finite tense", naValues: ["2pl"], rareValues: [] },
      ],
    });
    expect(out.spec.axes[0].name).toBe("person");
    expect(out.spec.axes[0].floors).toEqual({ "1sg": 5, "3sg": 5 });
  });
  it("rejects an unknown axis", () => {
    expect(() => parseCoverageSpecProposal({ axes: [{ name: "tense", floors: { past: 5 } }] })).toThrow(/unknown axis/);
  });
  it("rejects an illegal value", () => {
    expect(() => parseCoverageSpecProposal({ axes: [{ name: "person", floors: { "9sg": 5 } }] })).toThrow(/illegal value/);
  });
  it("rejects a non-positive-integer floor", () => {
    expect(() => parseCoverageSpecProposal({ axes: [{ name: "person", floors: { "1sg": 0 } }] })).toThrow(/positive integer/);
  });
  it("rejects more than 2 axes", () => {
    expect(() =>
      parseCoverageSpecProposal({
        axes: [
          { name: "person", floors: { "1sg": 5 } },
          { name: "polarity", floors: { affirmative: 5 } },
          { name: "sentenceType", floors: { declarative: 5 } },
        ],
      }),
    ).toThrow(/at most 2 axes/);
  });
});

describe("buildCoverageSpecProposalUserPrompt", () => {
  it("includes the point name and the legal axes for its kind", () => {
    const gp = getGrammarPoint("tr-a1-present-continuous")!;
    const prompt = buildCoverageSpecProposalUserPrompt(gp, null);
    expect(prompt).toContain(gp.name);
    expect(prompt).toContain("person");
    expect(COVERAGE_SPEC_PROPOSAL_PROMPT_VERSION).toMatch(/^coverage-spec@\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/ai test -- coverage-spec-proposal.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `packages/ai/src/coverage-spec-proposal.ts`:

```typescript
/**
 * LLM-assisted coverage-spec authoring (Pool Coverage Controller, Phase 2).
 * In-repo prompt + forced tool + pure parser. NOT a runtime Lambda path and NOT
 * registered in Langfuse — it's a dev-time authoring aid run by a human via the
 * `propose:coverage-spec` CLI. The model PROPOSES; a human reviews the emitted
 * snippet and commits it into the curriculum. Bump the version on prompt edits.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  COVERAGE_AXIS_VALUES,
  type CoverageAxis,
  type CoverageSpec,
} from "@language-drill/shared";
import type { GrammarPoint } from "@language-drill/shared";

export const COVERAGE_SPEC_PROPOSAL_PROMPT_VERSION = "coverage-spec@2026-06-14";
export const PROPOSE_COVERAGE_SPEC_TOOL_NAME = "propose_coverage_spec";
const PROPOSAL_MODEL = "claude-sonnet-4-6";
const PROPOSAL_MAX_TOKENS = 1024;
const PROPOSAL_TEMPERATURE = 0.2;

/** Which axes are legal to propose for a grammar point of each `kind`. */
function legalAxesFor(kind: GrammarPoint["kind"]): CoverageAxis[] {
  return kind === "vocab" ? ["wordClass"] : ["person", "polarity", "sentenceType"];
}

export const COVERAGE_SPEC_PROPOSAL_SYSTEM_PROMPT_TEMPLATE = `You design coverage specs for a language-exercise generator.

A coverage spec names the 1-2 categorical dimensions a DIVERSE set of approved exercises for one grammar point should vary along, with an absolute minimum count ("floor") per value. The generator pre-builds a pool of exercises per grammar point; without a spec the pool collapses onto the most natural value (e.g. third-person singular, affirmative). Your job is to pick the axes and floors that keep the pool varied WITHOUT forcing unnatural exercises.

Rules:
- Choose AT MOST 2 axes — the most pedagogically important dimensions for this point. Fewer is better.
- Floors are absolute integer counts, coarse (think 5-15), not a fine distribution.
- OMIT values that do not exist for this point (the "NA" case) — e.g. a language without a 2nd-person-plural, or an imperative that has no 1st-person form.
- Give a LOW floor to values that exist but are rare/marginal (the "rare" case) — e.g. literary-only tenses, marginal persons.
- Do NOT force uniformity. Legitimate concentration is real: a negation point is mostly negative; a "there is/there isn't" point is ~50/50 with nothing else to vary. Reflect the natural distribution in the floors (skew them), don't flatten it.
- Only propose axes from the allowed set you are given.

Call the ${PROPOSE_COVERAGE_SPEC_TOOL_NAME} tool with your proposal. For each axis include a short rationale and list any naValues / rareValues you considered.`;

export function buildCoverageSpecProposalUserPrompt(
  gp: GrammarPoint,
  poolStats: string | null,
): string {
  const axes = legalAxesFor(gp.kind);
  const axisLines = axes
    .map((a) => `- ${a}: one of [${COVERAGE_AXIS_VALUES[a].join(", ")}]`)
    .join("\n");
  const stats = poolStats ? `\n\nCurrent approved-pool distribution (grounding):\n${poolStats}` : "";
  return `Grammar point: ${gp.name} (${gp.key}, ${gp.language} ${gp.cefrLevel}, kind=${gp.kind})
Description: ${gp.description}
Positive examples: ${gp.examplesPositive.join(" | ")}

Allowed axes for this point:
${axisLines}${stats}

Propose a coverage spec.`;
}

export const PROPOSE_COVERAGE_SPEC_TOOL: Anthropic.Tool = {
  name: PROPOSE_COVERAGE_SPEC_TOOL_NAME,
  description: "Submit the proposed coverage spec for one grammar point.",
  input_schema: {
    type: "object" as const,
    properties: {
      axes: {
        type: "array",
        description: "1-2 axes. Each names a coverage axis and per-value integer floors.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Coverage axis name." },
            floors: {
              type: "object",
              description: "Map of axis value → absolute integer floor (>= 1).",
            },
            rationale: { type: "string" },
            naValues: { type: "array", items: { type: "string" } },
            rareValues: { type: "array", items: { type: "string" } },
          },
          required: ["name", "floors"],
        },
      },
    },
    required: ["axes"],
  },
};

export type CoverageSpecProposal = {
  spec: CoverageSpec;
  rationales: Partial<Record<CoverageAxis, string>>;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Pure validator for the tool output. Throws on any illegality. */
export function parseCoverageSpecProposal(input: unknown): CoverageSpecProposal {
  if (!isObject(input) || !Array.isArray(input.axes)) {
    throw new Error("proposal must be an object with an `axes` array");
  }
  if (input.axes.length < 1 || input.axes.length > 2) {
    throw new Error("proposal must have at most 2 axes (and at least 1)");
  }
  const axes: CoverageSpec["axes"][number][] = [];
  const rationales: Partial<Record<CoverageAxis, string>> = {};
  const seen = new Set<string>();
  for (const raw of input.axes) {
    if (!isObject(raw) || typeof raw.name !== "string") {
      throw new Error("each axis must be an object with a string `name`");
    }
    const name = raw.name;
    if (!(name in COVERAGE_AXIS_VALUES)) throw new Error(`unknown axis '${name}'`);
    if (seen.has(name)) throw new Error(`duplicate axis '${name}'`);
    seen.add(name);
    const legal = COVERAGE_AXIS_VALUES[name as CoverageAxis];
    if (!isObject(raw.floors) || Object.keys(raw.floors).length === 0) {
      throw new Error(`axis '${name}' must have a non-empty floors object`);
    }
    const floors: Record<string, number> = {};
    for (const [value, floor] of Object.entries(raw.floors)) {
      if (!legal.includes(value)) throw new Error(`axis '${name}' has illegal value '${value}'`);
      if (typeof floor !== "number" || !Number.isInteger(floor) || floor <= 0) {
        throw new Error(`axis '${name}' floor for '${value}' must be a positive integer`);
      }
      floors[value] = floor;
    }
    axes.push({ name: name as CoverageAxis, floors });
    if (typeof raw.rationale === "string") rationales[name as CoverageAxis] = raw.rationale;
  }
  return { spec: { axes }, rationales };
}

/** Render a paste-ready `coverageSpec: { … }` TS snippet for the curriculum. */
export function renderCoverageSpecSnippet(proposal: CoverageSpecProposal): string {
  const axes = proposal.spec.axes
    .map((a) => {
      const floors = Object.entries(a.floors)
        .map(([v, f]) => `"${v}": ${f}`)
        .join(", ");
      const rationale = proposal.rationales[a.name];
      const comment = rationale ? `      // ${rationale}\n` : "";
      return `${comment}      { name: "${a.name}", floors: { ${floors} } },`;
    })
    .join("\n");
  return `  coverageSpec: {\n    axes: [\n${axes}\n    ],\n  },`;
}

/** Call Claude with the forced tool and return the validated proposal. */
export async function proposeCoverageSpec(
  client: Anthropic,
  gp: GrammarPoint,
  poolStats: string | null,
  signal?: AbortSignal,
): Promise<CoverageSpecProposal> {
  const response = await client.messages.create(
    {
      model: PROPOSAL_MODEL,
      max_tokens: PROPOSAL_MAX_TOKENS,
      system: [
        {
          type: "text" as const,
          text: COVERAGE_SPEC_PROPOSAL_SYSTEM_PROMPT_TEMPLATE,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: [{ role: "user" as const, content: buildCoverageSpecProposalUserPrompt(gp, poolStats) }],
      tools: [PROPOSE_COVERAGE_SPEC_TOOL],
      tool_choice: { type: "tool" as const, name: PROPOSE_COVERAGE_SPEC_TOOL_NAME },
      temperature: PROPOSAL_TEMPERATURE,
    },
    { signal },
  );
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(`proposal: no tool_use block (stop_reason ${response.stop_reason})`);
  }
  return parseCoverageSpecProposal(toolUse.input);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/ai test -- coverage-spec-proposal.test.ts`
Expected: PASS.

- [ ] **Step 5: Export from `packages/ai/src/index.ts`**

Add:

```typescript
export {
  buildCoverageSpecProposalUserPrompt,
  parseCoverageSpecProposal,
  proposeCoverageSpec,
  renderCoverageSpecSnippet,
  COVERAGE_SPEC_PROPOSAL_PROMPT_VERSION,
  COVERAGE_SPEC_PROPOSAL_SYSTEM_PROMPT_TEMPLATE,
  PROPOSE_COVERAGE_SPEC_TOOL,
  PROPOSE_COVERAGE_SPEC_TOOL_NAME,
} from "./coverage-spec-proposal.js";
export type { CoverageSpecProposal } from "./coverage-spec-proposal.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/coverage-spec-proposal.ts packages/ai/src/coverage-spec-proposal.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): coverage-spec proposal prompt, forced tool, and pure parser"
```

---

### Task 14: `propose:coverage-spec` CLI

**Files:**
- Create: `packages/ai/scripts/propose-coverage-spec.ts`
- Modify: `packages/ai/package.json` (scripts)

- [ ] **Step 1: Implement the CLI (mirrors `eval-gen-export.ts` conventions: `node:util.parseArgs`, `requireEnv`, `createDb`, main-guard)**

Create `packages/ai/scripts/propose-coverage-spec.ts`:

```typescript
/**
 * propose:coverage-spec — LLM-assisted coverage-spec authoring (Phase 2).
 * Reads a grammar point, asks Claude for a coverage spec, validates it, and
 * prints a paste-ready `coverageSpec` snippet (+ writes `<key>.coverage-spec.proposed.json`).
 * The human reviews and commits the snippet into the curriculum. Read-only on
 * the DB (only when --with-pool-stats), never writes the curriculum.
 *
 * Usage:
 *   pnpm --filter @language-drill/ai propose:coverage-spec --grammar-point tr-a1-present-continuous
 *   pnpm --filter @language-drill/ai propose:coverage-spec --grammar-point es-b1-conditional --with-pool-stats
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import Anthropic from "@anthropic-ai/sdk";
import { createDb, getGrammarPoint } from "@language-drill/db";
import { sql } from "drizzle-orm";
import {
  proposeCoverageSpec,
  renderCoverageSpecSnippet,
} from "../src/coverage-spec-proposal.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

async function loadPoolStats(grammarPointKey: string): Promise<string | null> {
  const db = createDb(requireEnv("DATABASE_URL"));
  const result = await db.execute(sql`
    SELECT type, tag.key AS axis, tag.value AS value, COUNT(*)::int AS n
    FROM exercises
    CROSS JOIN LATERAL jsonb_each_text(coverage_tags) AS tag
    WHERE grammar_point_key = ${grammarPointKey}
      AND review_status IN ('auto-approved', 'manual-approved')
      AND coverage_tags IS NOT NULL
    GROUP BY type, tag.key, tag.value
    ORDER BY type, tag.key, tag.value
  `);
  const rows = result.rows as unknown as { type: string; axis: string; value: string; n: number }[];
  if (rows.length === 0) return "(no approved exercises yet)";
  return rows.map((r) => `${r.type} ${r.axis}=${r.value}: ${r.n}`).join("\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "grammar-point": { type: "string" },
      "with-pool-stats": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help || !values["grammar-point"]) {
    console.log("Usage: propose:coverage-spec --grammar-point <key> [--with-pool-stats]");
    process.exit(values.help ? 0 : 1);
  }

  const key = values["grammar-point"];
  const gp = getGrammarPoint(key);
  if (!gp) {
    console.error(`[propose-coverage-spec] unknown grammar point '${key}'`);
    process.exit(1);
  }

  const poolStats = values["with-pool-stats"] ? await loadPoolStats(key) : null;
  const client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  const proposal = await proposeCoverageSpec(client, gp, poolStats);

  const snippet = renderCoverageSpecSnippet(proposal);
  const outPath = `${key}.coverage-spec.proposed.json`;
  writeFileSync(outPath, JSON.stringify(proposal, null, 2), "utf8");

  console.log(`\n# Proposed coverageSpec for ${key} — review, edit, paste into the curriculum:\n`);
  console.log(snippet);
  console.log(`\n# Rationale + NA/rare notes written to ${outPath}\n`);
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error("[propose-coverage-spec] unhandled failure:", err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Add the package script**

In `packages/ai/package.json` `"scripts"`, add:

```json
    "propose:coverage-spec": "tsx scripts/propose-coverage-spec.ts",
```

- [ ] **Step 3: Smoke-test argv parsing without calling Claude**

Run: `pnpm --filter @language-drill/ai propose:coverage-spec --help`
Expected: prints usage, exits 0. (A real run requires `ANTHROPIC_API_KEY`; not part of automated tests.)

Run: `pnpm --filter @language-drill/ai typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ai/scripts/propose-coverage-spec.ts packages/ai/package.json
git commit -m "feat(ai): propose:coverage-spec CLI (LLM-proposed, human-reviewed specs)"
```

---

### Task 15: Document the CLI in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (the running-locally command table)

- [ ] **Step 1: Add a row to the command table**

In `CLAUDE.md`, in the "Running Locally" command table, add after the `eval:gen:export` row:

```markdown
| `pnpm propose:coverage-spec` | LLM-assisted coverage-spec authoring (Pool Coverage Controller, Phase 2). Reads a grammar point (`--grammar-point <key>`), asks Claude to propose the 1–2 coverage axes + absolute per-value floors a diverse pool should vary along, validates the proposal, and prints a paste-ready `coverageSpec` snippet for human review + commit into the curriculum. `--with-pool-stats` grounds the proposal in the current approved distribution (read-only). In-repo prompt (not Langfuse). |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document propose:coverage-spec CLI"
```

---

### Task 16: Full-suite verification + cleanup

**Files:** none (verification only)

- [ ] **Step 1: Grep for stragglers**

Run:
```bash
grep -rn "personRotation\|personTargets\|personForOrdinal\|personRotationPhase\|realizedPerson\|PERSON_ROTATION_TARGET_MULTIPLIER" \
  packages infra --include=*.ts | grep -v node_modules | grep -v "/dist/" | grep -v "\.test\.ts"
```
Expected: only matches inside **commented-out** German/Spanish/Turkish curriculum entries (acceptable — they don't compile) and `PERSON_ROTATION_BY_LANGUAGE` / `personCodesForLanguage` / `personDisplayForCode` (intentionally kept). No live references to the removed symbols. Fix any live straggler before continuing.

- [ ] **Step 2: Rebuild all packages (avoids the known `db/dist` staleness)**

Run: `pnpm build`
Expected: all packages build.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: zero errors. (Remove any now-unused imports the linter flags — e.g. `PersonCode` in files that dropped it.)

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors across all packages.

- [ ] **Step 5: Test (serial, to dodge the known infra parallel flake)**

Run: `pnpm turbo run test --concurrency=1`
Expected: all suites green. Report `X passed, Y failed`; fix any failure before proceeding.

- [ ] **Step 6: Final commit (if cleanup edits were needed)**

```bash
git add -A
git commit -m "chore(generation): pool coverage controller phase 2 — cleanup + full-suite green"
```

---

## Release checklist (do NOT skip — see spec Component 7)

- [ ] Confirm `CURRICULUM_VERSION_ES` / `CURRICULUM_VERSION_TR` are bumped to the **actual merge date** and differ from any value already recorded by prod `generation_jobs` (otherwise suppression won't clear and the migrated cells won't re-target). The version-format invariant requires `YYYY-MM-DD`.
- [ ] No DB migration is shipped (the `coverage_outcome` column is reused). Verify `drizzle-kit` reports no diff.
- [ ] The first post-deploy scheduler run (~04:00 UTC) will re-target the migrated cells against the new floors; spot-check `GET /admin/pool-status` afterwards to confirm the new axes (wordClass on `tr-a1-vocab-food-drink`, polarity on `tr-a1-present-continuous`) start populating.

---

## Self-review notes

- **Spec coverage:** Component 1 → Task 1/2; Component 2 (tagging) → Task 1/5; Component 3 (controller: decision/target/scheduler) → Tasks 7/6/12; Component 4 (message + directive) → Tasks 8/9; Component 5 (outcome) → Tasks 10/11; Component 6 (CLI) → Tasks 13/14; Component 7 (migration + release) → Task 4 + Release checklist. All covered.
- **Type consistency:** `CoverageSpec`, `CoverageAxisSpec`, `CoverageTarget`, `AxisOutcome`, `CoverageOutcome`, `CoverageAxis` are defined once in Task 1 and used verbatim thereafter. `decideCoverageTargets` input/output, `coverageTargets` (job message + spec + run-one-cell args), and `realizedCoverage` (DraftOutcome) match across tasks. The reused `CoverageAxis` union (not a new `CoverageAxisName`) is used everywhere.
- **No placeholders:** every code step shows full code; the migration floors are concrete (table + per-language snippets); the one date that genuinely depends on merge timing (`CURRICULUM_VERSION`) is called out explicitly in Task 4 + the release checklist rather than left vague.
```