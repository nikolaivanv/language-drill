# Generalized Inflection Drill — Phase 1 (Turkish Nominal Morphology) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing `conjugation` exercise generate and grade Turkish nominal morphology — noun cases, the personal copula, possessives, and possessive+case suffix **stacking** — without adding a new `ExerciseType`.

**Architecture:** The conjugation drill is already a generic "produce one inflected form from a lemma + a named feature bundle" exercise; "verb" lives only in prompt wording, the (Spanish-only) seed picker, and the tense/mood axis. Phase 1 adds two coverage axes (`case`, `number`), generalizes the generation/validation prompt wording away from verb/tense assumptions, and flags five Turkish A1 grammar points as `conjugationSuitable` with coverage specs that drive case/number/stacking variation. Turkish conjugation already generates **unseeded** (`verbBand()` is Spanish-only), so no noun/adjective frequency lists are needed.

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo). Packages touched: `@language-drill/shared` (coverage types), `@language-drill/ai` (generation + validation prompts), `@language-drill/db` (curriculum). Vitest for tests.

## Global Constraints

- **No new `ExerciseType`.** Reuse `ExerciseType.CONJUGATION` (DB string `"conjugation"`).
- **Prompt version bumps (per CLAUDE.md):** any edit to a `*_SYSTEM_PROMPT`/template constant bumps the matching `*_PROMPT_VERSION` to `<surface>@YYYY-MM-DD` (today = `2026-06-19`). After merge, prompts must be pushed to each Langfuse env via `push-prompts` — the runtime serves the Langfuse body, not the in-repo constant.
- **Curriculum version bump:** suitability/axis changes require a `CURRICULUM_VERSION_TR` change or the scheduler's skip-low-yield suppression won't clear. Same-day second bump uses a letter suffix (repo convention: `2026-06-19b`).
- **Diacritics are meaningful.** Grading is exact-match (NFC + trim + collapse-whitespace + lowercase, diacritics preserved). Stored `targetForm` must be exactly correct.
- **Pre-push gate:** `pnpm lint && pnpm typecheck && pnpm test` from repo root must all pass before pushing.
- **Deferred to Phase 2 (do NOT build now):** `carrierPhrase` field + UI, `wordClass` field, German declension, `gender`/`definiteness` axes. Turkish never populates these.

---

### Task 1: Add `case` and `number` coverage axes

**Files:**
- Modify: `packages/shared/src/coverage.ts`
- Test: `packages/shared/src/coverage.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CoverageAxis` union now includes `"case" | "number"`; `CASE_CODES`, `NUMBER_CODES` const arrays; `CaseCode`, `NumberCode` types; `COVERAGE_AXIS_VALUES` and `AXIS_ORDER` extended; `CoverageTags` gains optional `case?: CaseCode` and `number?: NumberCode`. `coverageAxesFor(ExerciseType.CONJUGATION, spec)` returns the new axes when the spec declares them.

- [ ] **Step 1: Find every exhaustive use of `CoverageAxis`**

Run: `grep -rn "Record<CoverageAxis" packages && grep -rn "CoverageAxis" packages/shared/src/coverage.ts`
Expected: the only `Record<CoverageAxis, …>` is `COVERAGE_AXIS_VALUES` in `coverage.ts`. Note any other hit (e.g. a switch) so it's updated in Step 4. If a second `Record<CoverageAxis,…>` exists elsewhere, add it to this task's edits.

- [ ] **Step 2: Write the failing tests**

Add to `packages/shared/src/coverage.test.ts`:

```typescript
it("exposes case and number axis values", () => {
  expect(COVERAGE_AXIS_VALUES.case).toEqual([
    "nominative",
    "accusative",
    "dative",
    "locative",
    "ablative",
    "genitive",
  ]);
  expect(COVERAGE_AXIS_VALUES.number).toEqual(["singular", "plural"]);
});

it("conjugation picks up a spec case axis (plus polarity default)", () => {
  const spec = { axes: [{ name: "case" as const, floors: { dative: 3 } }] };
  expect(coverageAxesFor(ExerciseType.CONJUGATION, spec)).toEqual([
    "case",
    "polarity",
  ]);
});

it("conjugation picks up a spec number axis", () => {
  const spec = { axes: [{ name: "number" as const, floors: { plural: 6 } }] };
  expect(coverageAxesFor(ExerciseType.CONJUGATION, spec)).toEqual([
    "number",
    "polarity",
  ]);
});
```

(Confirm `COVERAGE_AXIS_VALUES`, `coverageAxesFor`, and `ExerciseType` are already imported at the top of the test file; they are used by existing tests, so they should be.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/shared test -- coverage`
Expected: FAIL — `COVERAGE_AXIS_VALUES.case` is `undefined`; `coverageAxesFor` drops `case`/`number`.

- [ ] **Step 4: Implement the axes**

In `packages/shared/src/coverage.ts`, after `SENTENCE_TYPE_CODES` (around line 35) add:

```typescript
export const CASE_CODES = [
  "nominative",
  "accusative",
  "dative",
  "locative",
  "ablative",
  "genitive",
] as const;
export const NUMBER_CODES = ["singular", "plural"] as const;
```

Add the derived code types next to the existing `*Code` aliases (mirror `PersonCode`'s `(typeof …)[number]` pattern):

```typescript
export type CaseCode = (typeof CASE_CODES)[number];
export type NumberCode = (typeof NUMBER_CODES)[number];
```

Extend the union (line 42):

```typescript
export type CoverageAxis =
  | "person"
  | "number"
  | "case"
  | "wordClass"
  | "polarity"
  | "sentenceType";
```

Extend `COVERAGE_AXIS_VALUES` (lines 88-93):

```typescript
export const COVERAGE_AXIS_VALUES: Record<CoverageAxis, readonly string[]> = {
  person: PERSON_CODES,
  number: NUMBER_CODES,
  case: CASE_CODES,
  wordClass: WORD_CLASS_CODES,
  polarity: POLARITY_CODES,
  sentenceType: SENTENCE_TYPE_CODES,
};
```

Extend `AXIS_ORDER` (lines 97-102) — `number` and `case` directly after `person` so output ordering stays stable:

```typescript
const AXIS_ORDER: readonly CoverageAxis[] = [
  "person",
  "number",
  "case",
  "wordClass",
  "polarity",
  "sentenceType",
];
```

Extend `CoverageTags` (lines 46-51):

```typescript
export type CoverageTags = {
  person?: PersonCode;
  number?: NumberCode;
  case?: CaseCode;
  wordClass?: WordClassCode;
  polarity?: PolarityCode;
  sentenceType?: SentenceTypeCode;
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/shared test -- coverage`
Expected: PASS (new tests + existing CONJUGATION tests still green).

- [ ] **Step 6: Build shared so downstream packages see new exports**

Run: `pnpm --filter @language-drill/shared build`
Expected: clean build (downstream packages resolve `@language-drill/shared` via `dist`).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/coverage.ts packages/shared/src/coverage.test.ts
git commit -m "feat(shared): add case and number coverage axes"
```

---

### Task 2: Confirm curriculum invariant accepts the new axes (regression guard)

**Files:**
- Modify: `packages/db/src/curriculum/curriculum.test.ts`
- (No production change expected — `assertCurriculumInvariants` already allows non-`wordClass` axes on `kind: 'grammar'`. This task locks that in.)

**Interfaces:**
- Consumes: `assertCurriculumInvariants` (`packages/db/src/curriculum/index.ts:130`), `CASE_CODES`/`NUMBER_CODES` from Task 1.
- Produces: a test proving a grammar point may carry `case`/`number` axes and `conjugationSuitable`, while `wordClass` on a grammar point is still rejected.

- [ ] **Step 1: Write the failing/guard test**

Add to `packages/db/src/curriculum/curriculum.test.ts` (mirror the existing invariant-test style — most build a minimal valid `GrammarPoint` and assert `assertCurriculumInvariants([...])` does/doesn't throw; reuse that local builder if present):

```typescript
it("allows a case+number axis and conjugationSuitable on a grammar point", () => {
  const point = makeGrammarPoint({
    key: "tr-a1-test-case-axis",
    kind: "grammar",
    conjugationSuitable: true,
    coverageSpec: {
      axes: [
        { name: "case", floors: { dative: 3, ablative: 3 } },
        { name: "number", floors: { singular: 4, plural: 4 } },
      ],
    },
  });
  expect(() => assertCurriculumInvariants([point])).not.toThrow();
});

it("still rejects a wordClass axis on a grammar point", () => {
  const point = makeGrammarPoint({
    key: "tr-a1-test-bad-axis",
    kind: "grammar",
    coverageSpec: { axes: [{ name: "wordClass", floors: { noun: 3 } }] },
  });
  expect(() => assertCurriculumInvariants([point])).toThrow(/wordClass/);
});
```

If the test file has no `makeGrammarPoint` helper, copy the minimal-valid-point literal from an existing test in the same file (it must satisfy all required `GrammarPoint` fields: `key`, `kind`, `name`, `description`, `cefrLevel`, `language`, `examplesPositive` (≥2), `examplesNegative` (≥1), `commonErrors` (≥1)) and inline it, overriding only the fields above.

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @language-drill/db test -- curriculum`
Expected: PASS. If "allows a case+number axis…" FAILS, the failure message points at the offending invariant — adjust that invariant in `packages/db/src/curriculum/index.ts` to permit `case`/`number` on grammar points (it should already), then re-run.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/curriculum/curriculum.test.ts
git commit -m "test(db): lock in case/number axes on conjugationSuitable grammar points"
```

---

### Task 3: Generalize the generation prompt away from verb/tense assumptions

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts` (export + edit `renderConjugationSection`; bump `GENERATION_PROMPT_VERSION` only if its date is not already today)
- Test: `packages/ai/src/generation-prompts.test.ts` (create if absent)

**Interfaces:**
- Consumes: nothing new.
- Produces: `renderConjugationSection` is `export`ed; its text no longer asserts the target is a verb or that only tense/mood is fixed.

- [ ] **Step 1: Export the function and write the failing test**

Change the declaration at `packages/ai/src/generation-prompts.ts:228` from `function renderConjugationSection(` to `export function renderConjugationSection(`.

Add `packages/ai/src/generation-prompts.test.ts` (or append if it exists):

```typescript
import { describe, it, expect } from "vitest";
import { renderConjugationSection } from "./generation-prompts";
import { ExerciseType } from "@language-drill/shared";

describe("renderConjugationSection", () => {
  const section = () =>
    renderConjugationSection(ExerciseType.CONJUGATION, "Turkish", "A1", "Locative case -DA");

  it("returns empty for non-conjugation types", () => {
    expect(
      renderConjugationSection(ExerciseType.CLOZE, "Turkish", "A1", "x"),
    ).toBe("");
  });

  it("does not assume the lemma is a verb", () => {
    expect(section()).not.toMatch(/Use the verb you are given/);
    expect(section()).toMatch(/lemma|word/i);
  });

  it("treats the fixed inflectional category generically (not tense-only)", () => {
    // Must not hard-assert 'Tense/mood is FIXED' as the only fixed category.
    expect(section()).toMatch(/inflectional category|case\/number|tense\/mood for verbs/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts`
Expected: FAIL — current text contains "Use the verb you are given" and "Tense/mood is FIXED".

- [ ] **Step 3: Generalize the wording**

In `renderConjugationSection` (lines 228-250), replace the verb/tense-specific bullets. The returned template becomes:

```typescript
  return `## Conjugation/inflection specifics (this exercise type)

This is an inflection drill: there is NO sentence and NO blank. You produce one lemma + one explicit feature bundle, and the single correct inflected form the learner must type. The cloze/sentence rules above do not apply. Follow these:

- **The inflectional category is FIXED by the grammar point (${grammarPointName})** — tense/mood for verbs, case/number/possessive for nominals. Do not drift to a different category. Vary only the features the cell names (person/number/case, and polarity where the point covers it). The combination you pick determines \`targetForm\`.
- **\`targetForm\` MUST be the exactly-correct ${language} form at CEFR ${cefrLevel}**, including every diacritic. Grading is an exact string match — a wrong accent or a vowel-harmony slip is a wrong stored answer and will mis-grade every learner. Double-check irregular stems and consonant softening.
- **Enumerate genuine variants in \`acceptableForms\`** (e.g. accepted orthographic variants). Do NOT list near-misses or common-error forms — those must stay wrong.
- **\`breakdown\` teaches the morphology**: stem + ending for ${language} fusional forms, or stem + ordered suffix gloss for agglutinative forms (e.g. Turkish: root + (plural) + (possessive) + case/person, noting vowel harmony). Keep it one line.
- **\`featureBundle\` names the cell** in ${language}'s conventional grammar notation; it MUST NOT contain the answer.
- **Use the lemma you are given in the user prompt — do NOT choose your own.** When a word is provided, inflect exactly that word.
- **\`instructions\` must contain ONLY the directive the learner reads** — one clean sentence telling them which form to produce. Never include your own reasoning, alternative phrasings, abandoned attempts, or meta-text (no "Actually…", "Wait…", "let's keep it simple", or arrows). Any carrier/context sentence must use the target lemma.
- **\`exampleSentences\` (1–2)** must use \`targetForm\` verbatim, be natural, and sit at or below CEFR ${cefrLevel}.

`;
```

- [ ] **Step 4: Confirm the version constant date**

Run: `grep -n "GENERATION_PROMPT_VERSION" packages/ai/src/generation-prompts.ts`
Expected: `generate@2026-06-19`. If the date is already today, leave it (the version is a date cohort tag; same-day re-edit keeps the same tag — acceptable). If it shows an earlier date, change it to `"generate@2026-06-19"`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/generation-prompts.ts packages/ai/src/generation-prompts.test.ts
git commit -m "feat(ai): generalize conjugation generation prompt to nominal morphology"
```

---

### Task 4: Generalize the validation prompt + bump its version

**Files:**
- Modify: `packages/ai/src/validation-prompts.ts` (edit `buildConjugationValidationUserPrompt`; bump `VALIDATION_PROMPT_VERSION` to `validate@2026-06-19`)
- Test: `packages/ai/src/validation-prompts.test.ts` (create if absent)

**Interfaces:**
- Consumes: `ConjugationContent`, `GenerationSpec` (already imported in the file).
- Produces: `buildConjugationValidationUserPrompt` is `export`ed and its check #2 no longer says "tense/mood" exclusively.

- [ ] **Step 1: Export the builder and write the failing test**

If `buildConjugationValidationUserPrompt` (line 288) is not exported, prefix it with `export`.

Add `packages/ai/src/validation-prompts.test.ts` (or append):

```typescript
import { describe, it, expect } from "vitest";
import { buildConjugationValidationUserPrompt } from "./validation-prompts";
import { ExerciseType } from "@language-drill/shared";

const content = {
  type: ExerciseType.CONJUGATION,
  instructions: "Write the correct form.",
  lemma: "ev",
  lemmaGloss: "house",
  featureBundle: "bulunma · tekil",
  targetForm: "evde",
  breakdown: "ev + -de (locative)",
  exampleSentences: ["Ali evde."],
} as const;

// Minimal spec stub — only fields the builder reads.
const spec = {
  language: "TR",
  cefrLevel: "A1",
  grammarPoint: { key: "tr-a1-locative" },
} as never;

describe("buildConjugationValidationUserPrompt", () => {
  it("checks the grammar point's inflectional category generically", () => {
    const out = buildConjugationValidationUserPrompt(content as never, spec);
    expect(out).toMatch(/inflectional category|case\/number/i);
    expect(out).toContain("evde");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- validation-prompts`
Expected: FAIL — current check #2 says "the grammar point's tense/mood".

- [ ] **Step 3: Generalize check #2**

In `buildConjugationValidationUserPrompt` (lines 288-311), change check #2 from:

```
2. Does the feature bundle correspond to the grammar point's tense/mood (it must not drift to a different tense)?
```

to:

```
2. Does the feature bundle correspond to the grammar point's inflectional category (tense/mood for verbs; case/number/possessive for nominals) — it must not drift to a different category?
```

- [ ] **Step 4: Bump the version**

Change `VALIDATION_PROMPT_VERSION` (line 73) from `"validate@2026-06-18"` to `"validate@2026-06-19"`.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- validation-prompts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/validation-prompts.ts packages/ai/src/validation-prompts.test.ts
git commit -m "feat(ai): generalize conjugation validation prompt + bump validate version"
```

---

### Task 5: Flag Turkish points `conjugationSuitable` with case/number specs (incl. stacking)

**Files:**
- Modify: `packages/db/src/curriculum/tr.ts` (5 grammar points + `CURRICULUM_VERSION_TR`)
- Test: `packages/db/src/curriculum/curriculum.test.ts` (or a sibling cell-enumeration test)

**Interfaces:**
- Consumes: `case`/`number` axes (Task 1), `enumerateCurriculumCells` (`packages/db/src/generation/cells.ts:96`), `assertCurriculumInvariants`.
- Produces: each flagged point yields a CONJUGATION cell; `tr-a1-possessive-suffixes` carries a person×case spec that drives possessive+case stacking.

- [ ] **Step 1: Write the failing test**

Add to `packages/db/src/curriculum/curriculum.test.ts` (import `enumerateCurriculumCells` from `../generation/cells` and the TR curriculum array — match how the file already imports the curriculum; use the exported `trCurriculum`/`CURRICULUM_TR` symbol that the file uses elsewhere):

```typescript
import { enumerateCurriculumCells } from "../generation/cells";
import { ExerciseType } from "@language-drill/shared";

const CONJ_POINTS = [
  "tr-a1-personal-suffixes",
  "tr-a1-possessive-suffixes",
  "tr-a1-locative",
  "tr-a1-accusative-definite-object",
  "tr-a1-ablative-dative",
];

it("emits a conjugation cell for each flagged Turkish nominal point", () => {
  const cells = enumerateCurriculumCells(trCurriculum); // use the symbol this file imports
  for (const key of CONJ_POINTS) {
    const hasConj = cells.some(
      (c) => c.grammarPoint.key === key && c.exerciseType === ExerciseType.CONJUGATION,
    );
    expect(hasConj, `${key} should have a conjugation cell`).toBe(true);
  }
});

it("possessive-suffixes drives possessive+case stacking via a case axis", () => {
  const point = trCurriculum.find((p) => p.key === "tr-a1-possessive-suffixes");
  const caseAxis = point?.coverageSpec?.axes.find((a) => a.name === "case");
  expect(caseAxis).toBeDefined();
  expect(Object.keys(caseAxis!.floors)).toEqual(
    expect.arrayContaining(["accusative", "dative", "ablative"]),
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/db test -- curriculum`
Expected: FAIL — points are not yet `conjugationSuitable`; possessive has no case axis.

- [ ] **Step 3: Edit the five grammar points**

In `packages/db/src/curriculum/tr.ts`:

`tr-a1-personal-suffixes` (line ~90) — add the flag (keep its existing person axis):

```typescript
{
  key: 'tr-a1-personal-suffixes',
  conjugationSuitable: true,
  coverageSpec: {
    axes: [
      { name: 'person', floors: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '2pl': 5, '3pl': 5 } },
    ],
  },
  // …rest unchanged…
```

`tr-a1-possessive-suffixes` (line ~576) — add the flag AND a case axis (this is the stacking generator: possessive person × case → `arabamı`, `evimizden`):

```typescript
{
  key: 'tr-a1-possessive-suffixes',
  conjugationSuitable: true,
  coverageSpec: {
    axes: [
      { name: 'person', floors: { '1sg': 3, '2sg': 3, '3sg': 3, '1pl': 3, '2pl': 3, '3pl': 3 } },
      { name: 'case', floors: { nominative: 3, accusative: 3, dative: 3, ablative: 3, locative: 3 } },
    ],
  },
  // …rest unchanged…
```

`tr-a1-locative` (line ~153) — add the flag and a number axis (it has no coverageSpec today; insert one):

```typescript
{
  key: 'tr-a1-locative',
  conjugationSuitable: true,
  coverageSpec: { axes: [{ name: 'number', floors: { singular: 6, plural: 6 } }] },
  kind: 'grammar',
  // …rest unchanged…
```

`tr-a1-accusative-definite-object` (line ~416) — add the flag and a number axis:

```typescript
{
  key: 'tr-a1-accusative-definite-object',
  conjugationSuitable: true,
  coverageSpec: { axes: [{ name: 'number', floors: { singular: 6, plural: 6 } }] },
  kind: 'grammar',
  // …rest unchanged…
```

`tr-a1-ablative-dative` (line ~442) — add the flag and a case axis (this point teaches two cases; vary between them):

```typescript
{
  key: 'tr-a1-ablative-dative',
  conjugationSuitable: true,
  coverageSpec: { axes: [{ name: 'case', floors: { ablative: 6, dative: 6 } }] },
  kind: 'grammar',
  // …rest unchanged…
```

Leave `tr-a1-genitive-possessive` **unchanged** — it is a two-word construction (X-(n)In Y-(s)I), not a single inflected wordform, so it is not a conjugation-drill target (deferred).

- [ ] **Step 4: Bump the Turkish curriculum version**

Change `CURRICULUM_VERSION_TR` (line 53) from `'2026-06-19'` to `'2026-06-19b'` (same-day second bump; clears scheduler skip-low-yield suppression for the changed cells).

- [ ] **Step 5: Run curriculum tests**

Run: `pnpm --filter @language-drill/db test -- curriculum`
Expected: PASS (new cell-enumeration + stacking tests green; `assertCurriculumInvariants` does not throw — floors are positive integers, axes are valid on grammar points).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/curriculum/tr.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "feat(db): conjugation cells for TR cases, copula, possessive+case stacking"
```

---

### Task 6: Lock in fluency grading for stacked Turkish forms + full-suite gate

**Files:**
- Test: `packages/shared/src/fluency.test.ts` (extend; no production change — `gradeFluencyAnswer`'s conjugation branch already exact-matches `targetForm`/`acceptableForms`)

**Interfaces:**
- Consumes: `gradeFluencyAnswer`, `ConjugationContent` (already imported in the test file).
- Produces: regression coverage proving a stacked Turkish nominal form grades correctly (right answer accepted; wrong vowel-harmony allomorph rejected).

- [ ] **Step 1: Write the test**

Append to the existing conjugation `describe` block in `packages/shared/src/fluency.test.ts`:

```typescript
it("grades a stacked Turkish nominal form (possessive + ablative)", () => {
  const c = conj({
    lemma: "ev",
    lemmaGloss: "house",
    featureBundle: "1. çoğul iyelik · çıkma · çoğul",
    targetForm: "evlerimizden",
    breakdown: "ev + -ler + -imiz + -den",
    exampleSentences: ["Evlerimizden çıktık."],
  });
  expect(gradeFluencyAnswer(c, "Evlerimizden")).toBe(true);
  expect(gradeFluencyAnswer(c, "evlerimizdan")).toBe(false); // wrong harmony: -dan vs -den
});
```

(`conj(...)` is the existing fixture builder in this file — reuse it.)

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm --filter @language-drill/shared test -- fluency`
Expected: PASS immediately (no production change — this guards existing behavior against future edits).

- [ ] **Step 3: Run the full pre-push gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all green. If `@language-drill/db` tests resolve a stale `@language-drill/shared` build, run `pnpm build` first (Turbo) then re-run — the new axes live in `shared/dist`.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/fluency.test.ts
git commit -m "test(shared): fluency grading for stacked Turkish nominal forms"
```

---

### Task 7: Post-merge — sync prompts to Langfuse and verify generation

**Files:** none (operational; runs after the PR merges, per CLAUDE.md). Do NOT run against prod before merge.

**Interfaces:**
- Consumes: merged generation/validation prompt edits (Tasks 3-4) and curriculum bump (Task 5).
- Produces: Langfuse `production`-labelled prompts updated in dev + prod; a confirmed Turkish nominal conjugation draft.

- [ ] **Step 1: Push the drifted prompts to each Langfuse env**

Per CLAUDE.md "Prompt Editing": pull the env's `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` from Secrets Manager (`language-drill/` for prod, `language-drill-dev/` for dev), then:

```bash
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai push-prompts --dry-run    # preview
LANGFUSE_PUBLIC_KEY="$PK" LANGFUSE_SECRET_KEY="$SK" LANGFUSE_BASE_URL=https://cloud.langfuse.com \
  pnpm --filter @language-drill/ai push-prompts             # apply
```

Expected: the generation + validation prompts show as drifted and are pushed; in-sync prompts skipped. Repeat for the other env. The runtime picks up new bodies within ~5 min (Lambda module-scope cache TTL).

- [ ] **Step 2: Verify Turkish nominal generation produces valid drafts (unseeded)**

Confirm the load-bearing assumption that Turkish conjugation generates unseeded and produces correct nominal forms. Use the generation-quality gate described in CLAUDE.md (`pnpm eval:gen` over a small TR cell dataset built with `pnpm eval:gen:export --language TR`), comparing `--baseline repo` against `--candidate repo` for one flagged cell (e.g. `tr-a1-locative` conjugation, `tr-a1-possessive-suffixes` conjugation). Inspect a few drafts:
  - `targetForm` is the correct inflected form (e.g. `evde`, `arabamı`, `evlerimizden`) with correct vowel harmony / consonant softening.
  - `featureBundle` names the cell (case/number/possessive) and does **not** leak the answer.
  - `breakdown` shows the ordered suffix gloss.

Expected: approval-rate is non-zero and drafts are morphologically correct. **If approval is ~0 or seeds are required**, fall back to the spec's bounded fallback: add a small curated Turkish noun seed list and a `pickDeclinationSeeds` path (out of Phase-1 scope — open a follow-up).

- [ ] **Step 3: (Optional) `/schedule` follow-up**

The scheduler converges new cells at ~04:00 UTC over ~2 days after the curriculum bump. No action needed; spot-check the pool after that window.

---

## Self-Review

**Spec coverage:**
- Type model (reuse `conjugation`) → honored; no new `ExerciseType` (Global Constraints). ✓
- `case`/`number` coverage axes → Task 1. ✓
- Curriculum invariant accepts them → Task 2 (no prod change needed; guarded). ✓
- Generation prompt generalized → Task 3. Validation prompt generalized + version bump → Task 4. ✓
- Turkish curriculum: cases, copula, possessive, possessive+case stacking, `CURRICULUM_VERSION_TR` bump → Task 5. ✓
- Fluency grading for stacked forms → Task 6 (already works; guarded). ✓
- Dedup correctness for multi-feature bundles → resolved during design: `canonicalSurface` keys on `lemma::featureBundle` (`generation-prompts.ts:602`), which serializes the full cell. No code change needed; noted here so it isn't re-investigated. ✓
- Langfuse sync + generation verification → Task 7. ✓
- **Deviation from spec (flagged):** `carrierPhrase` field + UI and `wordClass` field are moved from Phase 1 to Phase 2, because Turkish never populates them — they'd be dead code now and are pure-additive later. German declension, `gender`/`definiteness` axes remain Phase 2/3 as in the spec.

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Test code is concrete. The two soft spots — the `makeGrammarPoint`/`trCurriculum` symbol names — are explicitly instructed to be matched to the file's existing imports, with the fallback (inline a minimal valid point) spelled out.

**Type consistency:** `CASE_CODES`/`NUMBER_CODES`/`CaseCode`/`NumberCode`/`CoverageAxis` names match across Tasks 1-2-5. `renderConjugationSection` and `buildConjugationValidationUserPrompt` are exported in the same task that tests them. `gradeFluencyAnswer`/`conj()` reused from the existing fluency test. Axis values used in curriculum floors (Task 5) are all members of `CASE_CODES`/`NUMBER_CODES` (Task 1), so the floor-key invariant passes.
