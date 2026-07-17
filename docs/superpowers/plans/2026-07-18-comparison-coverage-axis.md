# `comparison` Coverage Axis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 7th coverage axis `comparison` `{comparative, superlative, equative, less}` and floor the three comparison grammar points so their pools stop collapsing onto the comparative.

**Architecture:** The axis slots into the existing spec → scheduler → generation → validator machinery, which is axis-agnostic end to end. Adding `'comparison'` to the `CoverageAxis` union forces (via exhaustive `Record<CoverageAxis, …>` types) matching entries in the validator realized-tag directive and the generator per-draft pin directive. Curriculum points opt in by declaring a `coverageSpec` with `comparison` floors.

**Tech Stack:** TypeScript, pnpm workspaces + Turborepo, Vitest, Drizzle (no migration — `coverage_tags` is `jsonb`).

## Global Constraints

- **No DB migration.** `exercises.coverage_tags` is `jsonb`; the `CoverageTags` type change is compile-time only. No backfill of existing rows.
- **`comparison` is spec-activated only.** It must NOT be added to any exercise-type default-monitoring branch in `coverageAxesFor` — it appears in a cell's axes only when that cell's `coverageSpec` controls it.
- **Floors sum ≤ base cell target** (A1=20, A2=30) so no cell grows: TR `{comparative:12, superlative:6, less:2}`=20; DE `{comparative:14, superlative:10, equative:6}`=30; ES `{comparative:14, less:8, equative:8}`=30.
- **Curriculum change ⇒ version bump.** Bump `CURRICULUM_VERSION_TR/DE/ES` to `2026-07-18` in the same commit as the spec edits.
- **Cross-package dist resolution:** after editing `packages/shared`, run `pnpm --filter @language-drill/shared build` before running `@language-drill/ai` or `@language-drill/db` tests/typecheck (vitest resolves cross-package imports against `dist`).
- **Vitest does not typecheck** (esbuild strips types). Exhaustive-`Record` gaps surface only under `pnpm typecheck`, so every task that touches the union runs typecheck as an explicit gate.
- **ES target is `es-a2-comparatives-superlatives`** (key), NOT `es-b1-superlatives-comparisons` (out of scope).

---

### Task 1: Wire the `comparison` axis through shared + ai plumbing

Adding `'comparison'` to the union breaks typecheck in three exhaustive-`Record` sites at once, so shared + validator + generator plumbing land together as one green deliverable.

**Files:**
- Modify: `packages/shared/src/coverage.ts`
- Modify: `packages/shared/src/coverage.test.ts`
- Modify: `packages/ai/src/validate.ts:117-158` (coverage tool schema)
- Modify: `packages/ai/src/validate.test.ts`
- Modify: `packages/ai/src/validation-prompts.ts:432-445` (`COVERAGE_AXIS_DIRECTIVE`)
- Modify: `packages/ai/src/generation-prompts.ts:586-598` (`COVERAGE_DIRECTIVE_BY_AXIS`) and `:623` (axis loop)
- Modify: `packages/ai/src/generation-prompts.test.ts`

**Interfaces:**
- Produces: `COMPARISON_CODES = ['comparative','superlative','equative','less'] as const`; `type ComparisonCode`; `CoverageAxis` union gains `'comparison'`; `COVERAGE_AXIS_VALUES.comparison`; `CoverageTags.comparison?: ComparisonCode`. `AXIS_ORDER` gains `'comparison'` **last**.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Update the shared axis-list tests to expect `comparison` (failing test)**

In `packages/shared/src/coverage.test.ts`, update the "lists every axis" assertion (currently lines 25-34) and add an ordering assertion:

```typescript
  it("COVERAGE_AXIS_VALUES lists every axis", () => {
    expect(Object.keys(COVERAGE_AXIS_VALUES).sort()).toEqual([
      "case",
      "comparison",
      "number",
      "person",
      "polarity",
      "sentenceType",
      "wordClass",
    ]);
  });

  it("exposes the comparison axis values", () => {
    expect(COVERAGE_AXIS_VALUES.comparison).toEqual([
      "comparative",
      "superlative",
      "equative",
      "less",
    ]);
  });
```

Add a `coverageAxesFor` ordering test inside the existing `describe("coverageAxesFor", …)` block:

```typescript
  it("grammar cloze with a comparison spec → polarity + sentenceType + comparison (comparison last)", () => {
    const comparisonSpec: CoverageSpec = {
      axes: [{ name: "comparison", floors: { comparative: 12, superlative: 6, less: 2 } }],
    };
    expect(coverageAxesFor(ExerciseType.CLOZE, comparisonSpec)).toEqual([
      "polarity",
      "sentenceType",
      "comparison",
    ]);
  });
```

- [ ] **Step 2: Run the shared tests to verify they fail**

Run: `pnpm --filter @language-drill/shared test -- coverage.test.ts`
Expected: FAIL — `COVERAGE_AXIS_VALUES.comparison` is `undefined`; keys list mismatch.

- [ ] **Step 3: Add the `comparison` axis to `coverage.ts`**

In `packages/shared/src/coverage.ts`:

Add the codes after `NUMBER_CODES` (line 44):

```typescript
export const COMPARISON_CODES = [
  "comparative",
  "superlative",
  "equative",
  "less",
] as const;
```

Add the type alias next to the others (after line 51):

```typescript
export type ComparisonCode = (typeof COMPARISON_CODES)[number];
```

Extend the `CoverageAxis` union (lines 53-59):

```typescript
export type CoverageAxis =
  | "person"
  | "number"
  | "case"
  | "wordClass"
  | "polarity"
  | "sentenceType"
  | "comparison";
```

Extend `CoverageTags` (add after the `sentenceType?` line, ~line 69):

```typescript
  comparison?: ComparisonCode;
```

Extend `COVERAGE_AXIS_VALUES` (add inside the object, after `sentenceType`):

```typescript
  comparison: COMPARISON_CODES,
```

Append `comparison` to `AXIS_ORDER` (lines 118-125) as the **last** element:

```typescript
const AXIS_ORDER: readonly CoverageAxis[] = [
  "person",
  "number",
  "case",
  "wordClass",
  "polarity",
  "sentenceType",
  "comparison",
];
```

Do NOT touch `coverageAxesFor`'s monitoring branches — `comparison` activates only via `spec.axes`.

- [ ] **Step 4: Rebuild shared and run its tests**

Run: `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/shared test -- coverage.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the validator tool-schema test (failing test)**

In `packages/ai/src/validate.test.ts`, extend the existing "coverage properties include case and number axes" test (line 120) with a `comparison` assertion, and add a round-trip case to the `parseValidationResult — coverage` describe (line 594):

```typescript
  it("coverage properties include the comparison axis", () => {
    const coverageProps = (
      VALIDATION_TOOL.input_schema as {
        properties: {
          coverage: { properties: Record<string, unknown> };
        };
      }
    ).properties.coverage.properties;
    expect(coverageProps).toHaveProperty("comparison");
  });

  it("keeps a valid comparison value and drops an illegal one", () => {
    expect(
      parseValidationResult({ ...base, coverage: { comparison: "superlative" } }).coverage,
    ).toEqual({ comparison: "superlative" });
    expect(
      parseValidationResult({ ...base, coverage: { comparison: "bogus" } }).coverage,
    ).toEqual({});
  });
```

`VALIDATION_TOOL` and `parseValidationResult` are already imported at the top of the file (lines 14, 20); the `parseValidationResult — coverage` describe (~line 594) already defines and uses the `base` fixture — add the second test inside that describe so `base` is in scope. The first test can go next to the existing "coverage properties include case and number axes" test (line 120).

- [ ] **Step 6: Run the validator tests to verify the new ones fail**

Run: `pnpm --filter @language-drill/ai test -- validate.test.ts`
Expected: FAIL — `comparison` is not a property of the coverage schema.

- [ ] **Step 7: Add `comparison` to the validator tool schema**

In `packages/ai/src/validate.ts`, add a `comparison` field inside `coverage.properties` (after the `case` block, ~line 157):

```typescript
          comparison: {
            type: "string",
            enum: [...COVERAGE_AXIS_VALUES.comparison],
            description:
              "Comparison construction realized by the target: comparative (superiority), superlative, equative (equality), or less (inferiority).",
          },
```

(The lenient `coerceCoverage` reader already iterates `COVERAGE_AXIS_VALUES` keys, so parsing needs no change — the round-trip test in Step 5 covers it.)

- [ ] **Step 8: Add the generator per-draft pin test (failing test)**

In `packages/ai/src/generation-prompts.test.ts`, inside `describe("renderCoverageBlock (via buildGenerationUserPrompt)", …)` (line 1399), add:

```typescript
  it("emits a comparison directive when the target sets it", () => {
    const out = buildGenerationUserPrompt(covInputs(), 0, null, null, [
      { comparison: "superlative" },
    ]);
    expect(out).toContain("superlative");
    expect(out).toMatch(/comparison/i);
  });
```

- [ ] **Step 9: Run the generator test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts.test.ts -t "comparison directive"`
Expected: FAIL — no comparison directive is emitted (the axis is absent from the render loop).

- [ ] **Step 10: Add the generator directive + render-loop entry, and the validator realized-tag directive**

In `packages/ai/src/generation-prompts.ts`, add to `COVERAGE_DIRECTIVE_BY_AXIS` (the object at lines 586-598):

```typescript
  comparison: (v) =>
    `The target sentence MUST express the comparison as ${v} (comparative = superiority "more/-er … than"; superlative = "the most/-est"; equative = equality "as … as"; less = inferiority "less … than"). If the grammar point cannot naturally express this construction, use the closest natural one.`,
```

In the same file, add `"comparison"` to the render loop's axis array (line 623):

```typescript
  for (const axis of ["number", "case", "polarity", "wordClass", "sentenceType", "comparison"] as const) {
```

In `packages/ai/src/validation-prompts.ts`, add to `COVERAGE_AXIS_DIRECTIVE` (the object at lines 432-445):

```typescript
  comparison:
    "- `coverage.comparison`: the comparison construction the target realizes (comparative/superlative/equative/less). Report what the draft ACTUALLY produced, not what was requested.",
```

- [ ] **Step 11: Rebuild shared, then typecheck + test the ai package**

Run: `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/ai typecheck && pnpm --filter @language-drill/ai test -- validate.test.ts generation-prompts.test.ts`
Expected: typecheck PASS (both exhaustive `Record`s now complete) and tests PASS.

- [ ] **Step 12: Commit**

```bash
git add packages/shared/src/coverage.ts packages/shared/src/coverage.test.ts \
  packages/ai/src/validate.ts packages/ai/src/validate.test.ts \
  packages/ai/src/validation-prompts.ts packages/ai/src/generation-prompts.ts \
  packages/ai/src/generation-prompts.test.ts
git commit -m "feat(coverage): add comparison axis (comparative/superlative/equative/less)"
```

---

### Task 2: Floor the three comparison grammar points

**Files:**
- Modify: `packages/db/src/curriculum/tr.ts` (`tr-a1-comparative-superlative` entry ~line 1128; `CURRICULUM_VERSION_TR` line 189)
- Modify: `packages/db/src/curriculum/de.ts` (`de-a2-comparison` entry ~line 1036; `CURRICULUM_VERSION_DE` line 69)
- Modify: `packages/db/src/curriculum/es.ts` (`es-a2-comparatives-superlatives` entry ~line 1683; `CURRICULUM_VERSION_ES` line 178)
- Modify: `packages/db/src/curriculum/curriculum.test.ts`

**Interfaces:**
- Consumes: `CoverageSpec` / `comparison` axis from Task 1 (`COVERAGE_AXIS_VALUES.comparison`, used by `curriculum/index.ts` floor-value validation).
- Produces: three `coverageSpec` entries with a `comparison` axis.

- [ ] **Step 1: Add the curriculum floor-spec test (failing test)**

In `packages/db/src/curriculum/curriculum.test.ts`, add a new describe block:

```typescript
describe('comparison coverageSpec floors', () => {
  const cases: Array<[string, Record<string, number>]> = [
    ['tr-a1-comparative-superlative', { comparative: 12, superlative: 6, less: 2 }],
    ['de-a2-comparison', { comparative: 14, superlative: 10, equative: 6 }],
    ['es-a2-comparatives-superlatives', { comparative: 14, less: 8, equative: 8 }],
  ];
  it.each(cases)('%s carries the expected comparison floors', (key, floors) => {
    const gp = getGrammarPoint(key);
    const axis = gp?.coverageSpec?.axes.find((a) => a.name === 'comparison');
    expect(axis, `${key}: missing comparison axis`).toBeDefined();
    expect(axis?.floors).toEqual(floors);
  });
});
```

(Use whatever `getGrammarPoint` import the file already has — it is used by the existing person-axis tests around line 456.)

- [ ] **Step 2: Run the curriculum test to verify it fails**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- curriculum.test.ts -t "comparison coverageSpec"`
Expected: FAIL — no `comparison` axis on any of the three points.

- [ ] **Step 3: Add the TR spec + version bump**

In `packages/db/src/curriculum/tr.ts`, add to the `tr-a1-comparative-superlative` entry (after `prerequisiteKeys`, ~line 1153):

```typescript
    coverageSpec: {
      axes: [{ name: 'comparison', floors: { comparative: 12, superlative: 6, less: 2 } }],
    },
```

Bump the version (line 189):

```typescript
export const CURRICULUM_VERSION_TR = '2026-07-18';
```

- [ ] **Step 4: Add the DE spec (replace the no-spec comment) + version bump**

In `packages/db/src/curriculum/de.ts`, on the `de-a2-comparison` entry, replace the existing comment (lines 1038-1041, "No coverageSpec: … degree … has no axis at all. Both unpinnable.") and add the spec. Put the `coverageSpec` after `commonErrors` on that entry:

```typescript
    // coverageSpec: the `comparison` axis (added 2026-07-18) pins the
    // comparative/superlative/equative split that has no other coverage axis.
    // `less` is omitted — this point teaches no inferiority construction.
    coverageSpec: {
      axes: [{ name: 'comparison', floors: { comparative: 14, superlative: 10, equative: 6 } }],
    },
```

Bump the version (line 69):

```typescript
export const CURRICULUM_VERSION_DE = '2026-07-18';
```

- [ ] **Step 5: Add the ES spec + version bump**

In `packages/db/src/curriculum/es.ts`, add to the `es-a2-comparatives-superlatives` entry (after `commonErrors`, ~line 1696):

```typescript
    // coverageSpec: `comparison` axis (added 2026-07-18). Superlative lives at
    // B1 (es-b1-superlatives-comparisons), so this A2 point floors only
    // comparative / less / equative.
    coverageSpec: {
      axes: [{ name: 'comparison', floors: { comparative: 14, less: 8, equative: 8 } }],
    },
```

Bump the version (line 178):

```typescript
export const CURRICULUM_VERSION_ES = '2026-07-18';
```

- [ ] **Step 6: Rebuild db and run the curriculum tests**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- curriculum.test.ts`
Expected: PASS (new floor test + the existing `CURRICULUM_VERSION_<LANG>` shape/version-invariant tests).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/curriculum/tr.ts packages/db/src/curriculum/de.ts \
  packages/db/src/curriculum/es.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "feat(curriculum): comparison floors on TR/DE/ES comparison points + version bumps"
```

---

### Task 3: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Clean any stale lambda dist (avoids phantom compiled-test failures)**

Run: `rm -rf infra/lambda/dist`

- [ ] **Step 2: Build everything (so cross-package dist is fresh)**

Run: `pnpm build`
Expected: all packages build, no errors.

- [ ] **Step 3: Run the full pre-push gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures. If a `coverageAxesFor`/`AXIS_ORDER` ordering assertion elsewhere trips, reconcile it to the `comparison`-last order and re-run.

- [ ] **Step 4: (Optional but recommended) eval:gen A/B on the TR cell**

Confirm the spec actually shifts the approved distribution before spending prod re-seed budget:

```bash
pnpm --filter @language-drill/ai eval:gen \
  --baseline repo --candidate repo \
  --dataset-file <cell dataset for tr-a1-comparative-superlative> \
  --drafts-per-cell 5 --max-cost-usd 2
```

Expected: the candidate arm's approved `comparison` distribution moves off ~90% comparative toward the 60/30/10 floors. (See CLAUDE.md `eval:gen` row and the "Verify prompt changes with eval:gen" note for dataset-building via `eval:gen:export`.)

- [ ] **Step 5: Push the branch and open a PR**

```bash
git push -u origin feat/comparison-coverage-axis
ghp pr create --title "feat: comparison coverage axis + TR/DE/ES floors" --body "<summary>"
```

---

### Task 4: Post-merge production re-seed (runbook — run manually after deploy)

**Not automatable pre-merge** — requires the merged `CURRICULUM_VERSION` bumps to be deployed so the scheduler recognizes the new floors. Retrofitting a spec onto an at-target cell does nothing without demotion (the scheduler assigns coverage targets only to `need = target − approved` new drafts).

- [ ] **Step 1: Wait for merge → deploy (Lambda + curriculum version live).**

- [ ] **Step 2: Dry-run `demote:pool` for each point × generated exercise type, against PROD.**

Use the **prod** `DATABASE_URL` (local `.env` points at the dev branch — export the prod value explicitly). For each cell:

```bash
# TR A1 (cloze + translation)
pnpm demote:pool -- --language tr --cefr A1 --type cloze       --grammar-point tr-a1-comparative-superlative
pnpm demote:pool -- --language tr --cefr A1 --type translation --grammar-point tr-a1-comparative-superlative
# DE A2
pnpm demote:pool -- --language de --cefr A2 --type cloze       --grammar-point de-a2-comparison
pnpm demote:pool -- --language de --cefr A2 --type translation --grammar-point de-a2-comparison
# ES A2
pnpm demote:pool -- --language es --cefr A2 --type cloze       --grammar-point es-a2-comparatives-superlatives
pnpm demote:pool -- --language es --cefr A2 --type translation --grammar-point es-a2-comparatives-superlatives
```

Verify the exact `--type` set per point against what each cell actually has in the pool before demoting (query `exercises` grouped by `type`); add `sentence_construction` only if that cell exists. Review the dry-run counts.

- [ ] **Step 3: Re-run each with `--apply` once the dry-run looks right.**

- [ ] **Step 4: After the next ~04:00 UTC scheduler tick, confirm the refill.**

Query the approved pool's realized `comparison` distribution (once new rows carry the tag):

```sql
SELECT grammar_point_key, coverage_tags->>'comparison' AS comparison, count(*)
FROM exercises
WHERE grammar_point_key IN (
  'tr-a1-comparative-superlative','de-a2-comparison','es-a2-comparatives-superlatives')
  AND review_status IN ('auto-approved','manual-approved')
GROUP BY 1, 2 ORDER BY 1, 3 DESC;
```

Expected: each point shows a spread across its floored values, not a single-construction collapse.

---

## Self-Review

- **Spec coverage:** axis (shared) → Task 1 steps 1-4; validator schema + parse → Task 1 steps 5-7; validator realized directive → Task 1 step 10; generator pin directive + loop → Task 1 steps 8-10; three curriculum specs + version bumps → Task 2; testing → Tasks 1/2 per-file + Task 3 full gate; rollout/demote → Task 4; "no migration / no backfill / comparison spec-activated only" → Global Constraints, enforced by not touching `coverageAxesFor` monitoring branches. All spec sections mapped.
- **Placeholder scan:** every code step shows the actual code; the only bracketed items are `<cell dataset …>` / `<summary>` (genuine per-run inputs) and the `--type` verification note in Task 4 (a real judgment step, not a stand-in for code).
- **Type consistency:** `COMPARISON_CODES`, `ComparisonCode`, `COVERAGE_AXIS_VALUES.comparison`, `CoverageTags.comparison`, and floor keys (`comparative`/`superlative`/`equative`/`less`) are used identically across Tasks 1 and 2. Directive Records are `Record<CoverageAxis,…>` (validation-prompts) and `Record<Exclude<CoverageAxis,'person'>,…>` (generation-prompts) — both get the `comparison` key; the generator ALSO needs `comparison` in the hardcoded render-loop array (Task 1 step 10), which the Step 8-9 test guards.
