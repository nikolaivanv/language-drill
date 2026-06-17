# Conjugation / Inflection Drill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 7th `ExerciseType` — a deterministically-graded conjugation/inflection drill (lemma + feature bundle → inflected form) — pool-generated for ES/DE/TR and surfaced as an opt-in drill, not woven into the adaptive rotation.

**Architecture:** Conjugation rides the existing pool pipeline (generation → validation → serve → submit). It is the first **zero-Claude-on-submit** type: grading is an exact match against stored `targetForm ∪ acceptableForms` via the existing `normalizeFluencyAnswer`, synthesizing an `EvaluationResult` locally. Curriculum opt-in mirrors `sentenceConstructionSuitable`; tense/mood is implied by the grammar point and person/polarity reuse existing coverage axes.

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo). `packages/shared` (types/guards/grader), `packages/ai` (Claude generation + validation prompts/tools), `packages/db` (Drizzle curriculum), `infra/lambda` (Hono submit route), `apps/web` (Next.js renderer). Vitest throughout.

---

## Spec reference

`docs/superpowers/specs/2026-06-16-conjugation-inflection-drill-design.md`. Read it first.

## Working directory & pre-flight

All paths are relative to the worktree root:
`/Users/seal/dev/language-drill/.claude/worktrees/feat-conjugation-inflection-drill`

Per CLAUDE.md and memory notes:
- Run the full gate with `pnpm turbo run test --concurrency=1` (the parallel run flakes on `infra`).
- `rm -rf infra/lambda/dist` before running lambda tests (stale compiled `*.test.js` cause phantom failures).
- After editing `packages/db` source, `pnpm build` (turbo) so single-package vitest doesn't resolve stale `db/dist`.
- A new `ExerciseType` member breaks `Record<ExerciseType, …>` maps and exhaustive switches across packages. Run `pnpm turbo run typecheck --continue 2>&1 | grep "error TS"` after Task 1 to surface every site; Tasks 2–9 fix them one package at a time.

## File map

| File | Responsibility | Task |
|---|---|---|
| `packages/shared/src/index.ts` | enum member, `ConjugationContent`, union, guard | 1 |
| `packages/shared/src/index.test.ts` | type-count assertion 6→7 | 1 |
| `packages/shared/src/fluency.ts` | deterministic grader branch + eligibility | 2 |
| `packages/shared/src/fluency.test.ts` | grader tests | 2 |
| `packages/shared/src/coverage.ts` | `coverageAxesFor` conjugation monitoring | 3 |
| `packages/shared/src/curriculum-types.ts` | `conjugationSuitable?` flag | 4 |
| `packages/db/src/generation/cells.ts` | `compatibleTypes` append | 5 |
| `packages/db/src/generation/cells.test.ts` | enumeration test | 5 |
| `packages/db/src/curriculum/index.ts` | invariant + (no version here) | 6 |
| `packages/db/src/curriculum/{es,de,tr}.ts` | flag points + bump `CURRICULUM_VERSION_*` | 7 |
| `packages/db/src/curriculum/curriculum.test.ts` | invariant + flagged-point tests | 6,7 |
| `packages/ai/src/generate.ts` | tool schema, maps, parser, `canonicalSurface` | 8 |
| `packages/ai/src/generate.test.ts` | parser + map tests | 8 |
| `packages/ai/src/generation-prompts.ts` | guidance section + template var + version bump | 9 |
| `packages/ai/src/generation-prompts.test.ts` | byte-parity + guidance tests | 9 |
| `packages/ai/src/validation-prompts.ts` | validation builder + switch + version bump | 10 |
| `packages/ai/src/validation-prompts.test.ts` | validation builder test | 10 |
| `infra/lambda/src/routes/exercises.ts` | `applyGrammarMastery` helper + deterministic submit branch | 11,12 |
| `infra/lambda/src/routes/exercises.test.ts` | submit-branch test | 12 |
| `infra/lambda/src/lib/today-plan.ts` | `ESTIMATED_MINUTES_BY_TYPE`, `ITEM_COUNT_BY_TYPE` | 13 |
| `infra/lambda/src/lib/progress-aggregation.ts` | `axisForExerciseType` case | 13 |
| `apps/web/.../drill/_components/conjugation-exercise.tsx` | renderer | 14 |
| `apps/web/.../drill/_components/exercise-pane.tsx` | render branch | 15 |
| `apps/web/.../_lib/timeline-labels.ts` | `TYPE_LABELS` entry | 15 |
| `apps/web/.../drill/conjugation/page.tsx` | opt-in entry page | 16 |

---

### Task 1: ExerciseType + ConjugationContent (`packages/shared`)

**Files:**
- Modify: `packages/shared/src/index.ts:79-86` (enum), `:211-217` (union), `:231-257` (guards)
- Test: `packages/shared/src/index.test.ts:77-89`

- [ ] **Step 1: Update the failing count test**

In `packages/shared/src/index.test.ts`, find the block asserting the enum has 6 values and update it to 7 + the new member:

```ts
it("has exactly 7 exercise types", () => {
  expect(Object.values(ExerciseType)).toEqual([
    "cloze",
    "translation",
    "vocab_recall",
    "sentence_construction",
    "dictation",
    "free_writing",
    "conjugation",
  ]);
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter @language-drill/shared test -- index.test.ts`
Expected: FAIL (array length 6 ≠ 7).

- [ ] **Step 3: Add the enum member**

In `packages/shared/src/index.ts`, append to `ExerciseType`:

```ts
export enum ExerciseType {
  CLOZE = "cloze",
  TRANSLATION = "translation",
  VOCAB_RECALL = "vocab_recall",
  SENTENCE_CONSTRUCTION = "sentence_construction",
  DICTATION = "dictation",
  FREE_WRITING = "free_writing",
  CONJUGATION = "conjugation",
}
```

- [ ] **Step 4: Add the content type** (after `FreeWritingContent`, before the `ExerciseContent` union):

```ts
export type ConjugationContent = {
  type: ExerciseType.CONJUGATION;
  /** Short imperative, e.g. "Write the correct form." */
  instructions: string;
  /** Citation/dictionary form: "ir" / "fahren" / "gitmek". */
  lemma: string;
  /** L1 (English) gloss of the lemma: "to go". */
  lemmaGloss: string;
  /**
   * Human-readable feature bundle shown to the learner, e.g.
   * "condicional · 1ª persona del plural" or
   * "geniş zaman · olumsuz · 1. çoğul". Tense/mood is fixed by the grammar
   * point; this names the cell the learner must produce.
   */
  featureBundle: string;
  /** The canonical expected form: "iríamos". */
  targetForm: string;
  /** Other fully-correct forms (regional / orthographic variants). Rare. */
  acceptableForms?: string[];
  /**
   * Post-answer teaching: stem + ending (ES/DE) or stem + ordered suffix
   * gloss (TR). Shown on the result, never before submission.
   */
  breakdown: string;
  /** 1–2 short sentences using the form in context (post-answer teaching). */
  exampleSentences: string[];
  topicHint?: string;
};
```

- [ ] **Step 5: Add to the union and add the guard**

```ts
export type ExerciseContent =
  | ClozeContent
  | TranslationContent
  | VocabRecallContent
  | SentenceConstructionContent
  | DictationContent
  | FreeWritingContent
  | ConjugationContent;
```

```ts
export function isConjugationContent(
  content: ExerciseContent,
): content is ConjugationContent {
  return content.type === ExerciseType.CONJUGATION;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/shared test -- index.test.ts`
Expected: PASS.

- [ ] **Step 7: Surface the ripple**

Run: `pnpm turbo run typecheck --continue 2>&1 | grep "error TS"`
Expected: a list of exhaustive-switch / `Record<ExerciseType,…>` errors in `ai`, `db`, `infra/lambda`, `apps/web`. These are fixed by Tasks 2,3,5,8,9,10,13,15. Note them; do not fix yet.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/index.test.ts
git commit -m "feat(shared): add CONJUGATION exercise type + ConjugationContent"
```

---

### Task 2: Deterministic grader (`packages/shared/src/fluency.ts`)

**Files:**
- Modify: `packages/shared/src/fluency.ts:10-12` (import), `:34-37` (eligible types), `:60-73` (grader)
- Test: `packages/shared/src/fluency.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `packages/shared/src/fluency.test.ts`:

```ts
import { ExerciseType, type ConjugationContent } from "./index";
import { gradeFluencyAnswer, isFluencyEligibleType } from "./fluency";

const conj = (over: Partial<ConjugationContent> = {}): ConjugationContent => ({
  type: ExerciseType.CONJUGATION,
  instructions: "Write the correct form.",
  lemma: "ir",
  lemmaGloss: "to go",
  featureBundle: "condicional · 1ª pers. plural",
  targetForm: "iríamos",
  breakdown: "ir- + -íamos",
  exampleSentences: ["Iríamos al cine si tuviéramos tiempo."],
  ...over,
});

describe("conjugation fluency grading", () => {
  it("is fluency-eligible", () => {
    expect(isFluencyEligibleType(ExerciseType.CONJUGATION)).toBe(true);
  });
  it("accepts the exact target form (case/space-insensitive)", () => {
    expect(gradeFluencyAnswer(conj(), "  Iríamos ")).toBe(true);
  });
  it("accepts a listed variant", () => {
    expect(
      gradeFluencyAnswer(conj({ acceptableForms: ["nos iríamos"] }), "nos iríamos"),
    ).toBe(true);
  });
  it("rejects a wrong diacritic (diacritics are meaningful)", () => {
    expect(gradeFluencyAnswer(conj(), "iriamos")).toBe(false);
  });
  it("rejects a wrong form", () => {
    expect(gradeFluencyAnswer(conj(), "iremos")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/shared test -- fluency.test.ts`
Expected: FAIL (`isFluencyEligibleType` false; grader throws "unsupported content type").

- [ ] **Step 3: Implement**

In `fluency.ts`, add `isConjugationContent` to the import from `./index`:

```ts
import {
  ExerciseType,
  type ExerciseContent,
  isClozeContent,
  isVocabRecallContent,
  isConjugationContent,
} from "./index";
```

Extend `FLUENCY_ELIGIBLE_TYPES` (keep the string-literal form per the file's init-order note):

```ts
export const FLUENCY_ELIGIBLE_TYPES: readonly ExerciseType[] = [
  "cloze" as ExerciseType,
  "vocab_recall" as ExerciseType,
  "conjugation" as ExerciseType,
];
```

Add a branch to `gradeFluencyAnswer` before the final `throw`:

```ts
  if (isConjugationContent(content)) {
    const accepted = [content.targetForm, ...(content.acceptableForms ?? [])];
    return accepted.some((a) => normalizeFluencyAnswer(a) === candidate);
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/shared test -- fluency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/fluency.ts packages/shared/src/fluency.test.ts
git commit -m "feat(shared): deterministic conjugation grader + fluency eligibility"
```

---

### Task 3: Coverage axes (`packages/shared/src/coverage.ts`)

**Files:**
- Modify: `packages/shared/src/coverage.ts:110-127` (`coverageAxesFor`)
- Test: `packages/shared/src/coverage.test.ts`

Conjugation cells monitor `polarity` (matching the other grammar types) and pick up `person` from the cell's `coverageSpec`.

- [ ] **Step 1: Write failing test**

Add to `packages/shared/src/coverage.test.ts`:

```ts
it("conjugation monitors polarity and picks up spec person axis", () => {
  const spec = { axes: [{ name: "person" as const, floors: { "1pl": 5 } }] };
  expect(coverageAxesFor(ExerciseType.CONJUGATION, spec)).toEqual([
    "person",
    "polarity",
  ]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/shared test -- coverage.test.ts`
Expected: FAIL (conjugation not in the monitoring branch → `["person"]`).

- [ ] **Step 3: Implement**

In `coverageAxesFor`, add `CONJUGATION` to the grammar-type monitoring branch:

```ts
  } else if (
    exerciseType === ExerciseType.CLOZE ||
    exerciseType === ExerciseType.TRANSLATION ||
    exerciseType === ExerciseType.SENTENCE_CONSTRUCTION ||
    exerciseType === ExerciseType.CONJUGATION
  ) {
    monitoring.add("polarity");
    monitoring.add("sentenceType");
  }
```

Note: `sentenceType` is harmless for conjugation (a single word has no sentence type), but keeping the branch uniform avoids a third arm; the spec's `person` axis is what actually drives targeting. The test above only asserts `person` + `polarity` because the spec controls `person` and `sentenceType` is monitored — adjust the expected array to `["person", "polarity", "sentenceType"]`.

- [ ] **Step 4: Fix the expected array and re-run**

Update the test expectation to `["person", "polarity", "sentenceType"]`, then:
Run: `pnpm --filter @language-drill/shared test -- coverage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/coverage.ts packages/shared/src/coverage.test.ts
git commit -m "feat(shared): conjugation coverage axes"
```

---

### Task 4: Curriculum flag type (`packages/shared/src/curriculum-types.ts`)

**Files:**
- Modify: `packages/shared/src/curriculum-types.ts:96` (after `sentenceConstructionSuitable`)

- [ ] **Step 1: Add the optional flag to `GrammarPoint`**

After the `sentenceConstructionSuitable?: boolean;` field:

```ts
  /**
   * Optional opt-in that ADDS a `conjugation` cell for this grammar point in
   * `enumerateCurriculumCells`. Absent/`false` ⇒ no conjugation cell (today's
   * behaviour). Set this for morphology-heavy points whose forms are worth
   * drilling in isolation (irregular paradigms, agglutinative suffix stacks).
   * Pair with a `coverageSpec` person axis so the drill varies person/number.
   * Only valid on `kind: 'grammar'` entries (enforced by the curriculum
   * invariant in `assertCurriculumInvariants`).
   */
  conjugationSuitable?: boolean;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @language-drill/shared typecheck`
Expected: PASS (additive optional field).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/curriculum-types.ts
git commit -m "feat(shared): add conjugationSuitable grammar-point flag"
```

---

### Task 5: Cell enumeration (`packages/db/src/generation/cells.ts`)

**Files:**
- Modify: `packages/db/src/generation/cells.ts:62-75` (`compatibleTypes`)
- Test: `packages/db/src/generation/cells.test.ts`

- [ ] **Step 1: Build shared first** (so db resolves the new symbols)

Run: `pnpm --filter @language-drill/shared build`

- [ ] **Step 2: Write failing test**

Add to `packages/db/src/generation/cells.test.ts` (use the file's existing `GrammarPoint` fixture helper; if none, construct a minimal grammar point inline matching the `Readonly<{…}>` shape):

```ts
it("appends a conjugation cell when conjugationSuitable is set", () => {
  const point: GrammarPoint = {
    key: "es-b1-present-subjunctive",
    kind: "grammar",
    name: "Present subjunctive",
    description: "…",
    cefrLevel: "B1",
    language: "ES",
    examplesPositive: ["a", "b"],
    examplesNegative: ["*c"],
    commonErrors: ["d"],
    conjugationSuitable: true,
  } as GrammarPoint;
  const cells = enumerateCurriculumCells([point]);
  const types = cells.map((c) => c.exerciseType);
  expect(types).toContain(ExerciseType.CONJUGATION);
  // base cloze+translation still present
  expect(types).toEqual(
    expect.arrayContaining([ExerciseType.CLOZE, ExerciseType.TRANSLATION]),
  );
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @language-drill/db test -- cells.test.ts`
Expected: FAIL (no conjugation cell emitted).

- [ ] **Step 4: Implement** — extend `compatibleTypes`:

```ts
function compatibleTypes(entry: GrammarPoint): ReadonlyArray<ExerciseType> {
  if (entry.kind === 'dictation') return DICTATION_KIND_TYPES;
  if (entry.kind === 'free-writing') return FREE_WRITING_KIND_TYPES;
  if (entry.kind === 'vocab') return VOCAB_KIND_TYPES;
  const base = entry.clozeUnsuitable ? GRAMMAR_CLOZE_UNSUITABLE_TYPES : GRAMMAR_KIND_TYPES;
  const withSc = entry.sentenceConstructionSuitable
    ? [...base, ExerciseType.SENTENCE_CONSTRUCTION]
    : base;
  return entry.conjugationSuitable
    ? [...withSc, ExerciseType.CONJUGATION]
    : withSc;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @language-drill/db test -- cells.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/generation/cells.ts packages/db/src/generation/cells.test.ts
git commit -m "feat(db): emit conjugation cells for flagged grammar points"
```

---

### Task 6: Curriculum invariant (`packages/db/src/curriculum/index.ts`)

**Files:**
- Modify: `packages/db/src/curriculum/index.ts` (inside `assertCurriculumInvariants`, alongside the `sentenceConstructionSuitable` checks)
- Test: `packages/db/src/curriculum/curriculum.test.ts`

- [ ] **Step 1: Write failing test**

Add to `curriculum.test.ts` (mirror the existing mutation-test style that clones a point and expects a throw):

```ts
it("rejects conjugationSuitable on a non-grammar kind", () => {
  const broken = [
    { ...someVocabUmbrella, conjugationSuitable: true } as GrammarPoint,
  ];
  expect(() => assertCurriculumInvariants(broken)).toThrow(/conjugationSuitable/);
});
```

(Use the same fixture the existing `sentenceConstructionSuitable` invariant test uses; `someVocabUmbrella` = any `kind: 'vocab'` entry from the curriculum.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/db test -- curriculum.test.ts`
Expected: FAIL (no such invariant yet — does not throw).

- [ ] **Step 3: Implement**

In `assertCurriculumInvariants`, next to the existing `sentenceConstructionSuitable` kind check, add:

```ts
    // conjugationSuitable is only meaningful on real grammar points.
    if (entry.conjugationSuitable && entry.kind !== 'grammar') {
      throw new Error(
        `Curriculum invariant violated: conjugationSuitable set on non-grammar kind '${entry.kind}' ('${entry.key}')`,
      );
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/db test -- curriculum.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/curriculum/index.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "feat(db): invariant — conjugationSuitable only on grammar points"
```

---

### Task 7: Flag curriculum points + bump versions (`packages/db/src/curriculum/{es,de,tr}.ts`)

**Files:**
- Modify: `packages/db/src/curriculum/es.ts`, `de.ts`, `tr.ts`
- Test: `packages/db/src/curriculum/curriculum.test.ts`

Flag a small set of morphology-heavy points. Each flagged point MUST already have (or gain) a `coverageSpec` with a `person` axis. **Only flag points that are currently uncommented/active** (see `PER_LANGUAGE_GRAMMAR_MIN` in `index.ts`: ES active at B1/B2, TR at A1/A2, DE currently 0 active).

- [ ] **Step 1: Pick & flag ES points**

In `es.ts`, set `conjugationSuitable: true` on **`es-b1-present-subjunctive`** (already has a `person` coverageSpec) and **`es-b1-conditional`** (add a `person` coverageSpec if missing):

```ts
    conjugationSuitable: true,
```

If `es-b1-conditional` lacks a `coverageSpec`, add:

```ts
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 8, '2sg': 8, '3sg': 8, '1pl': 8, '3pl': 8 } },
      ],
    },
```

- [ ] **Step 2: Pick & flag TR points**

In `tr.ts`, flag **two active A1/A2 verb-morphology points** that carry vowel harmony / suffix stacking (e.g. an aorist or past-tense point). For each, set `conjugationSuitable: true` and ensure a `coverageSpec` with a `person` axis (TR uses all six persons) and a `polarity` axis (negative forms are the high-value drill):

```ts
    conjugationSuitable: true,
    coverageSpec: {
      axes: [
        { name: 'person', floors: { '1sg': 4, '2sg': 4, '3sg': 4, '1pl': 4, '2pl': 4, '3pl': 4 } },
        { name: 'polarity', floors: { affirmative: 6, negative: 6 } },
      ],
    },
```

(If a chosen point already has a `coverageSpec`, merge the axes rather than overwrite.)

- [ ] **Step 3: DE**

DE has no active grammar points (`PER_LANGUAGE_GRAMMAR_MIN.DE` all 0). If a strong-verb Präteritum point is **uncommented/active**, flag it as in Step 1; otherwise **skip DE for this PR** and note it in the PR description (the mechanism is language-agnostic; flagging waits on DE curriculum being re-enabled). Do NOT uncomment dormant DE entries here — that is out of scope.

- [ ] **Step 4: Bump curriculum versions**

Bump each touched language's version constant to today's date:
- `es.ts`: `export const CURRICULUM_VERSION_ES = '2026-06-16';`
- `tr.ts`: `export const CURRICULUM_VERSION_TR = '2026-06-16';`
- `de.ts` only if a DE point was flagged.

(Rationale: the scheduler's skip-low-yield clears on a curriculum-version bump, so new conjugation cells get picked up — see the "scheduler low-yield needs curriculum bump" note.)

- [ ] **Step 5: Update / add tests**

In `curriculum.test.ts`, add:

```ts
it("flagged conjugation points each have a person coverage axis", () => {
  const flagged = ALL_CURRICULA.filter((p) => p.conjugationSuitable);
  expect(flagged.length).toBeGreaterThan(0);
  for (const p of flagged) {
    expect(p.kind).toBe("grammar");
    const names = (p.coverageSpec?.axes ?? []).map((a) => a.name);
    expect(names).toContain("person");
  }
});
```

If the file has per-language exact count assertions that now change, update them.

- [ ] **Step 6: Build db + run tests**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- curriculum.test.ts`
Expected: PASS. Also run `assertCurriculumInvariants` suite (whole `curriculum.test.ts`) green.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/curriculum/es.ts packages/db/src/curriculum/tr.ts packages/db/src/curriculum/de.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "feat(db): flag conjugation points (ES/TR) + bump curriculum versions"
```

---

### Task 8: Generation tool + parser (`packages/ai/src/generate.ts`)

**Files:**
- Modify: `generate.ts:91-98` (`TOOL_NAME_BY_TYPE`), after `VOCAB_RECALL_GENERATION_TOOL` (new tool), `:413-420` (`GENERATION_TOOL_BY_TYPE`), `:1207-1235` (`parseToolInput`), `canonicalSurface` in `generation-prompts.ts` (Task 9), and add `parseGeneratedConjugationDraft`
- Test: `packages/ai/src/generate.test.ts`

- [ ] **Step 1: Build shared+db first**

Run: `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/db build`

- [ ] **Step 2: Write failing parser test**

Add to `generate.test.ts`:

```ts
import { parseGeneratedConjugationDraft } from "./generate";

it("parses a conjugation draft", () => {
  const out = parseGeneratedConjugationDraft(
    {
      instructions: "Write the correct form.",
      lemma: "ir",
      lemmaGloss: "to go",
      featureBundle: "condicional · 1ª pers. plural",
      targetForm: " iríamos ",
      acceptableForms: ["nos iríamos"],
      breakdown: "ir- + -íamos",
      exampleSentences: ["Iríamos al cine."],
    },
    {} as never,
  );
  expect(out.type).toBe(ExerciseType.CONJUGATION);
  expect(out.targetForm).toBe("iríamos"); // trimmed
  expect(out.lemma).toBe("ir");
});

it("rejects an empty target form", () => {
  expect(() =>
    parseGeneratedConjugationDraft(
      { instructions: "x", lemma: "ir", lemmaGloss: "to go", featureBundle: "y", targetForm: "  ", breakdown: "z", exampleSentences: ["a"] },
      {} as never,
    ),
  ).toThrow(/targetForm/);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `rm -rf packages/ai/dist; pnpm --filter @language-drill/ai test -- generate.test.ts`
Expected: FAIL (`parseGeneratedConjugationDraft` not exported).

- [ ] **Step 4: Add the tool name**

```ts
export const TOOL_NAME_BY_TYPE: Readonly<Record<ExerciseType, string>> = Object.freeze({
  cloze: "submit_cloze_exercise",
  translation: "submit_translation_exercise",
  vocab_recall: "submit_vocab_recall_exercise",
  sentence_construction: "submit_sentence_construction_exercise",
  dictation: "submit_dictation_exercise",
  free_writing: "submit_free_writing_exercise",
  conjugation: "submit_conjugation_exercise",
});
```

- [ ] **Step 5: Add the tool schema** (after `VOCAB_RECALL_GENERATION_TOOL`):

```ts
export const CONJUGATION_GENERATION_TOOL: Anthropic.Tool = {
  name: TOOL_NAME_BY_TYPE.conjugation,
  description:
    "Submit a single conjugation/inflection drill: a lemma + an explicit feature bundle whose single correct inflected form the learner must produce.",
  input_schema: {
    type: "object" as const,
    properties: {
      instructions: { type: "string", description: "Short imperative, e.g. 'Write the correct form.'" },
      lemma: { type: "string", description: "Citation/dictionary form of the word, e.g. 'ir', 'fahren', 'gitmek'." },
      lemmaGloss: { type: "string", description: "Short English gloss of the lemma, e.g. 'to go'." },
      featureBundle: {
        type: "string",
        description:
          "Human-readable feature bundle naming the exact cell to produce. Tense/mood is fixed by the grammar point; specify person/number (and polarity where relevant) in the target language's conventional notation, e.g. 'condicional · 1ª persona del plural' or 'geniş zaman · olumsuz · 1. çoğul'.",
      },
      targetForm: { type: "string", description: "The single canonical correct inflected form, e.g. 'iríamos'. Must be exactly correct including diacritics." },
      acceptableForms: {
        type: "array",
        items: { type: "string" },
        description: "Other fully-correct forms (regional/orthographic variants, or with/without a clitic pronoun). Omit or pass [] when the form is unambiguous.",
      },
      breakdown: { type: "string", description: "Morphological breakdown for post-answer teaching: stem + ending (ES/DE) or stem + ordered suffix gloss (TR)." },
      exampleSentences: { type: "array", items: { type: "string" }, description: "1–2 short, natural sentences using the target form in context." },
      topicHint: { type: "string", description: "Optional topic theme." },
    },
    required: ["instructions", "lemma", "lemmaGloss", "featureBundle", "targetForm", "breakdown", "exampleSentences"],
  },
};
```

- [ ] **Step 6: Register in the by-type map**

```ts
export const GENERATION_TOOL_BY_TYPE: Readonly<Record<ExerciseType, Anthropic.Tool>> = Object.freeze({
  cloze: CLOZE_GENERATION_TOOL,
  translation: TRANSLATION_GENERATION_TOOL,
  vocab_recall: VOCAB_RECALL_GENERATION_TOOL,
  sentence_construction: SENTENCE_CONSTRUCTION_GENERATION_TOOL,
  dictation: DICTATION_GENERATION_TOOL,
  free_writing: FREE_WRITING_GENERATION_TOOL,
  conjugation: CONJUGATION_GENERATION_TOOL,
});
```

- [ ] **Step 7: Add the parser** (near `parseGeneratedVocabRecallDraft`):

```ts
export function parseGeneratedConjugationDraft(
  input: unknown,
  _spec: GenerationSpec,
): ConjugationContent {
  const ctx = "conjugation draft";
  if (!isObject(input)) throw new Error(`${ctx}: must be an object, got ${typeof input}`);

  const instructions = requireString(input, "instructions", ctx);
  const lemma = requireString(input, "lemma", ctx).trim();
  const lemmaGloss = requireString(input, "lemmaGloss", ctx);
  const featureBundle = requireString(input, "featureBundle", ctx);
  const targetForm = requireString(input, "targetForm", ctx).trim().replace(/\s+/g, " ");
  const breakdown = requireString(input, "breakdown", ctx);
  const exampleSentences = requireStringArray(input, "exampleSentences", ctx);
  const topicHint = optionalString(input, "topicHint", ctx);
  const acceptableFormsRaw = optionalStringArray(input, "acceptableForms", ctx);
  const acceptableForms = acceptableFormsRaw?.map((s) => s.trim()).filter((s) => s.length > 0);

  if (targetForm.length === 0) {
    throw new Error(`${ctx}: invalid targetForm: must contain non-whitespace characters`);
  }
  if (exampleSentences.length === 0) {
    throw new Error(`${ctx}: exampleSentences must be non-empty`);
  }

  return {
    type: ExerciseType.CONJUGATION,
    instructions,
    lemma,
    lemmaGloss,
    featureBundle,
    targetForm,
    breakdown,
    exampleSentences,
    ...(acceptableForms && acceptableForms.length > 0 ? { acceptableForms } : {}),
    ...(topicHint !== undefined ? { topicHint } : {}),
  };
}
```

(If `optionalStringArray` does not exist in this file, add a small local helper mirroring `requireStringArray` that returns `undefined` when the key is absent. Verify by grepping `optionalStringArray` first.)

- [ ] **Step 8: Add the `parseToolInput` case**

```ts
    case ExerciseType.CONJUGATION:
      return parseGeneratedConjugationDraft(input, spec);
```

- [ ] **Step 9: Run to verify pass**

Run: `rm -rf packages/ai/dist; pnpm --filter @language-drill/ai test -- generate.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/ai/src/generate.ts packages/ai/src/generate.test.ts
git commit -m "feat(ai): conjugation generation tool + draft parser"
```

---

### Task 9: Generation prompt guidance (`packages/ai/src/generation-prompts.ts`)

**Files:**
- Modify: `generation-prompts.ts` — `canonicalSurface` (`:511-545`), a new `renderConjugationSection`, the `{{conjugationSection}}` template var, `computeGenerationPromptVars` (`:257-290`), `buildGenerationUserPrompt` if it has per-type branches, and `GENERATION_PROMPT_VERSION` (`:125`)
- Test: `packages/ai/src/generation-prompts.test.ts`

This file has **byte-parity tests** between `GENERATION_SYSTEM_PROMPT_TEMPLATE` and `applyTemplate(TEMPLATE, computeGenerationPromptVars(...))`. Any new `{{var}}` must be added to BOTH the template string and the vars object, or the parity snapshot fails.

- [ ] **Step 1: `canonicalSurface` case** (drives dedup; conjugation dedups on lemma+featureBundle):

```ts
    case ExerciseType.CONJUGATION:
      return `${normaliseSurface(content.lemma)}::${normaliseSurface(content.featureBundle)}`;
```

- [ ] **Step 2: Add `renderConjugationSection`** (mirror `renderSentenceConstructionSection`):

```ts
function renderConjugationSection(
  exerciseType: ExerciseType,
  language: string,
  cefrLevel: string,
  grammarPointName: string,
): string {
  if (exerciseType !== ExerciseType.CONJUGATION) return "";
  return `## Conjugation/inflection specifics (this exercise type)

This is a conjugation drill: there is NO sentence and NO blank. You produce one lemma + one explicit feature bundle, and the single correct inflected form the learner must type. The cloze/sentence rules above do not apply. Follow these:

- **Tense/mood is FIXED by the grammar point (${grammarPointName}).** Do not drift to other tenses. Vary only person/number (and polarity where the point covers it). The combination you pick determines \`targetForm\`.
- **\`targetForm\` MUST be the exactly-correct ${language} form at CEFR ${cefrLevel}**, including every diacritic. Grading is an exact string match — a wrong accent or a vowel-harmony slip is a wrong stored answer and will mis-grade every learner. Double-check irregular stems.
- **Enumerate genuine variants in \`acceptableForms\`** (e.g. with/without a clitic pronoun, accepted orthographic variants). Do NOT list near-misses or common-error forms — those must stay wrong.
- **\`breakdown\` teaches the morphology**: stem + ending for ${language} fusional forms, or stem + ordered suffix gloss for agglutinative forms (e.g. Turkish: root + tense/aspect + person, noting vowel harmony). Keep it one line.
- **\`featureBundle\` names the cell** in ${language}'s conventional grammar notation; it MUST NOT contain the answer.
- **\`exampleSentences\` (1–2)** must use \`targetForm\` verbatim, be natural, and sit at or below CEFR ${cefrLevel}.

`;
}
```

- [ ] **Step 3: Wire the section into the template + vars**

Add a `{{conjugationSection}}` placeholder in `GENERATION_SYSTEM_PROMPT_TEMPLATE` at the same splice location the SC section uses (immediately before `## Output`), i.e. `{{sentenceConstructionSection}}{{conjugationSection}}## Output`.

In `computeGenerationPromptVars`, add to the returned vars object:

```ts
    conjugationSection: renderConjugationSection(
      exerciseType,
      language,
      cefrLevel,
      grammarPoint.name,
    ),
```

(Confirm the SC section is added there the same way; match its argument source exactly.)

- [ ] **Step 4: Bump the version**

```ts
export const GENERATION_PROMPT_VERSION = "generate@2026-06-16";
```

- [ ] **Step 5: Write/extend tests**

Add to `generation-prompts.test.ts`:

```ts
it("conjugation section is empty for non-conjugation types and present for conjugation", () => {
  const varsCloze = computeGenerationPromptVars({ /* a cloze spec fixture */ } as never);
  expect(varsCloze.conjugationSection).toBe("");
  const varsConj = computeGenerationPromptVars({ /* a conjugation spec fixture */ } as never);
  expect(varsConj.conjugationSection).toContain("Conjugation/inflection specifics");
});

it("canonicalSurface keys conjugation on lemma::featureBundle", () => {
  expect(
    canonicalSurface({
      type: ExerciseType.CONJUGATION, instructions: "x", lemma: "ir", lemmaGloss: "to go",
      featureBundle: "condicional · 1pl", targetForm: "iríamos", breakdown: "b", exampleSentences: ["e"],
    }),
  ).toContain("ir");
});
```

Use the existing spec-fixture builder in the test file for `computeGenerationPromptVars` inputs (grep for how cloze specs are built in this test). The byte-parity snapshot test in this file will also exercise the new `{{conjugationSection}}` var — if it snapshots, update the snapshot intentionally.

- [ ] **Step 6: Run to verify**

Run: `rm -rf packages/ai/dist; pnpm --filter @language-drill/ai test -- generation-prompts.test.ts`
Expected: PASS (including byte-parity).

- [ ] **Step 7: Commit**

```bash
git add packages/ai/src/generation-prompts.ts packages/ai/src/generation-prompts.test.ts
git commit -m "feat(ai): conjugation generation guidance + dedup surface + version bump"
```

---

### Task 10: Validation prompt (`packages/ai/src/validation-prompts.ts`)

**Files:**
- Modify: `validation-prompts.ts:317-346` (switch), add `buildConjugationValidationUserPrompt`, and bump `VALIDATION_PROMPT_VERSION`
- Test: `packages/ai/src/validation-prompts.test.ts`

The validator's job for conjugation: confirm `targetForm` is the morphologically correct form for `lemma` + `featureBundle`, and that `acceptableForms` are genuine variants (not near-misses).

- [ ] **Step 1: Write failing test**

Add to `validation-prompts.test.ts`:

```ts
it("builds a conjugation validation prompt that asks to verify the form", () => {
  const draft = {
    contentJson: {
      type: ExerciseType.CONJUGATION, instructions: "x", lemma: "ir", lemmaGloss: "to go",
      featureBundle: "condicional · 1ª pers. plural", targetForm: "iríamos",
      breakdown: "ir- + -íamos", exampleSentences: ["Iríamos al cine."],
    },
  };
  const prompt = buildValidationUserPrompt(draft as never, { /* spec fixture */ } as never);
  expect(prompt).toContain("iríamos");
  expect(prompt).toMatch(/correct form|morpholog/i);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `rm -rf packages/ai/dist; pnpm --filter @language-drill/ai test -- validation-prompts.test.ts`
Expected: FAIL (switch hits the `default` exhaustive throw for `conjugation`).

- [ ] **Step 3: Implement the builder** (near the other `build*ValidationUserPrompt`):

```ts
function buildConjugationValidationUserPrompt(
  content: ConjugationContent,
  spec: GenerationSpec,
): string {
  return `You are validating a generated conjugation/inflection drill for ${spec.language} at CEFR ${spec.cefrLevel}, targeting "${spec.grammarPoint.name}".

Lemma: ${content.lemma} (${content.lemmaGloss})
Feature bundle: ${content.featureBundle}
Proposed correct form: ${content.targetForm}
Acceptable variants: ${(content.acceptableForms ?? []).join(", ") || "(none)"}
Breakdown shown to the learner: ${content.breakdown}
Example sentences: ${content.exampleSentences.join(" / ")}

Check, and reject (low quality) if any fails:
1. Is "${content.targetForm}" the EXACTLY correct ${spec.language} form for that lemma + feature bundle, including all diacritics? An incorrect stored form mis-grades every learner.
2. Does the feature bundle correspond to the grammar point's tense/mood (it must not drift to a different tense)?
3. Are all "acceptable variants" genuinely fully-correct alternatives (not near-misses or common errors)?
4. Does the feature bundle avoid leaking the answer, and do the example sentences use the form correctly and naturally at this level?
5. Is the breakdown accurate?`;
}
```

- [ ] **Step 4: Add the switch case** (replacing reliance on the `default` throw):

```ts
    case ExerciseType.CONJUGATION:
      base = buildConjugationValidationUserPrompt(content, spec);
      break;
```

- [ ] **Step 5: Bump the version**

Set `VALIDATION_PROMPT_VERSION` to today's date format, e.g. `"validate@2026-06-16"` (match the existing constant's prefix).

- [ ] **Step 6: Run to verify pass**

Run: `rm -rf packages/ai/dist; pnpm --filter @language-drill/ai test -- validation-prompts.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ai/src/validation-prompts.ts packages/ai/src/validation-prompts.test.ts
git commit -m "feat(ai): conjugation validation prompt + version bump"
```

---

### Task 11: Extract `applyGrammarMastery` helper (`infra/lambda`)

Refactor so the Bayesian mastery update is callable from both the Claude path and the new deterministic path (DRY). No behavior change.

**Files:**
- Modify: `infra/lambda/src/routes/exercises.ts:396-449`

- [ ] **Step 1: Extract the helper** — add near the top of the route module:

```ts
async function applyGrammarMastery(opts: {
  userId: string;
  language: Language;
  grammarPointKey: string | null;
  difficulty: CefrLevel;
  score: number;
}): Promise<void> {
  if (!opts.grammarPointKey) return;
  try {
    const at = new Date();
    const existing = await db
      .select({
        masteryScore: userGrammarMastery.masteryScore,
        confidence: userGrammarMastery.confidence,
        evidenceCount: userGrammarMastery.evidenceCount,
        lastPracticedAt: userGrammarMastery.lastPracticedAt,
      })
      .from(userGrammarMastery)
      .where(
        and(
          eq(userGrammarMastery.userId, opts.userId),
          eq(userGrammarMastery.grammarPointKey, opts.grammarPointKey),
        ),
      )
      .limit(1);

    const next = updateMastery(existing[0] ?? null, {
      score: opts.score,
      difficulty: opts.difficulty,
      at,
    });

    await db
      .insert(userGrammarMastery)
      .values({
        userId: opts.userId,
        language: opts.language,
        grammarPointKey: opts.grammarPointKey,
        masteryScore: next.masteryScore,
        confidence: next.confidence,
        evidenceCount: next.evidenceCount,
        lastPracticedAt: next.lastPracticedAt,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: [userGrammarMastery.userId, userGrammarMastery.grammarPointKey],
        set: {
          masteryScore: next.masteryScore,
          confidence: next.confidence,
          evidenceCount: next.evidenceCount,
          lastPracticedAt: next.lastPracticedAt,
          updatedAt: at,
          language: opts.language,
        },
      });
  } catch (masteryErr) {
    console.error('[submit] mastery update failed (non-fatal):', masteryErr);
  }
}
```

- [ ] **Step 2: Replace the inline block** at `:396-449` in the Claude path with:

```ts
    await applyGrammarMastery({
      userId,
      language: exercise.language as Language,
      grammarPointKey: exercise.grammarPointKey,
      difficulty: exercise.difficulty as CefrLevel,
      score: result.score,
    });
```

- [ ] **Step 3: Verify no behavior change**

Run: `rm -rf infra/lambda/dist; pnpm --filter @language-drill/lambda test -- exercises.test.ts`
Expected: PASS (existing submit tests unchanged).

- [ ] **Step 4: Commit**

```bash
git add infra/lambda/src/routes/exercises.ts
git commit -m "refactor(lambda): extract applyGrammarMastery helper"
```

---

### Task 12: Deterministic conjugation submit branch (`infra/lambda`)

**Files:**
- Modify: `infra/lambda/src/routes/exercises.ts` — insert a short-circuit after session validation (`:244`) and before the capacity/daily-cap checks (`:246`)
- Test: `infra/lambda/src/routes/exercises.test.ts`

- [ ] **Step 1: Write failing test**

Add to `exercises.test.ts` (model on the existing submit tests; seed a conjugation exercise row, submit a correct and an incorrect answer):

```ts
it("grades a conjugation submission deterministically without Claude", async () => {
  // seed an approved conjugation exercise with targetForm "iríamos"
  const id = await seedExercise({
    type: "conjugation",
    language: "ES",
    difficulty: "B1",
    grammarPointKey: "es-b1-conditional",
    contentJson: {
      type: "conjugation", instructions: "Write the correct form.",
      lemma: "ir", lemmaGloss: "to go", featureBundle: "condicional · 1pl",
      targetForm: "iríamos", breakdown: "ir- + -íamos",
      exampleSentences: ["Iríamos al cine."],
    },
  });

  const res = await app.request(`/exercises/${id}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answer: "iríamos" }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.score).toBe(1);
  expect(body.feedback).toContain("ir-"); // breakdown surfaced

  // No ai_evaluation usage event recorded (deterministic path).
  expect(await countUsageEvents("ai_evaluation")).toBe(0);
});
```

(Use whatever seed/usage helpers the existing tests use; grep `seedExercise` / how rows are inserted in `exercises.test.ts`. If the Claude client is mocked globally, assert the mock was NOT called.)

- [ ] **Step 2: Run to verify failure**

Run: `rm -rf infra/lambda/dist; pnpm --filter @language-drill/lambda test -- exercises.test.ts`
Expected: FAIL (conjugation currently flows into the Claude path → 502 without a key, or calls the mock).

- [ ] **Step 3: Implement the short-circuit**

Add `isConjugationContent`, `gradeFluencyAnswer`, `randomUUID` (already imported) usage. Insert after the session-validation block (`:244`) and before the `getEffectivePlan` call:

```ts
  // Deterministic, zero-Claude path for conjugation drills. The correct form
  // is stored on the exercise; grading is an exact match (diacritics
  // significant). No ai_evaluation bucket spend, no capacity/daily-cap gate.
  if (exercise.type === ExerciseType.CONJUGATION) {
    const content = exercise.contentJson as ExerciseContent;
    if (!isConjugationContent(content)) {
      return c.json({ error: 'Malformed conjugation exercise', code: 'EXERCISE_NOT_FOUND' }, 404);
    }
    const correct = gradeFluencyAnswer(content, userAnswer);
    const score = correct ? 1 : 0;
    const result: EvaluationResult = {
      score,
      grammarAccuracy: score,
      vocabularyRange: exercise.difficulty,
      taskAchievement: score,
      feedback: correct
        ? `Correct — ${content.targetForm}. ${content.breakdown}`
        : `Not quite. The correct form is ${content.targetForm}. ${content.breakdown}`,
      errors: correct
        ? []
        : [
            {
              type: 'grammar',
              severity: 'major',
              text: userAnswer,
              correction: content.targetForm,
              explanation: content.breakdown,
            },
          ],
      estimatedCefrEvidence: exercise.difficulty,
    };

    const submissionId = randomUUID();
    await db.insert(userExerciseHistory).values({
      id: submissionId,
      userId,
      exerciseId: id,
      sessionId,
      score,
      responseJson: { userAnswer, evaluation: result },
      evaluatedAt: new Date(),
    });

    await applyGrammarMastery({
      userId,
      language: exercise.language as Language,
      grammarPointKey: exercise.grammarPointKey,
      difficulty: exercise.difficulty as CefrLevel,
      score,
    });

    return c.json(result);
  }
```

Add imports: `isConjugationContent`, `EvaluationResult` from `@language-drill/shared` (extend the existing import line) and `gradeFluencyAnswer` (from `@language-drill/shared`).

- [ ] **Step 4: Run to verify pass**

Run: `rm -rf infra/lambda/dist; pnpm --filter @language-drill/lambda test -- exercises.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/exercises.ts infra/lambda/src/routes/exercises.test.ts
git commit -m "feat(lambda): deterministic zero-Claude conjugation grading"
```

---

### Task 13: Exhaustiveness maps + progress axis (`infra/lambda`)

**Files:**
- Modify: `infra/lambda/src/lib/today-plan.ts:26-55`, `infra/lambda/src/lib/progress-aggregation.ts:91-115`
- Test: existing `today-plan.test.ts` / `progress-aggregation.test.ts` if present

- [ ] **Step 1: Add the map entries** (`today-plan.ts`):

```ts
export const ESTIMATED_MINUTES_BY_TYPE: Record<ExerciseType, number> = {
  // …existing…
  // Conjugation is a fast single-form drill, surfaced opt-in (not auto-composed).
  [ExerciseType.CONJUGATION]: 2,
};
```

```ts
export const ITEM_COUNT_BY_TYPE: Record<ExerciseType, number> = {
  // …existing…
  // One form per conjugation item.
  [ExerciseType.CONJUGATION]: 1,
};
```

- [ ] **Step 2: Add the radar axis** (`progress-aggregation.ts`, in `axisForExerciseType`):

```ts
    case ExerciseType.CONJUGATION:
      return 'grammar';
```

- [ ] **Step 3: Add a focused test** (in whichever test file covers `axisForExerciseType`; if none, add to `progress-aggregation.test.ts`):

```ts
it("maps conjugation to the grammar axis", () => {
  expect(axisForExerciseType(ExerciseType.CONJUGATION)).toBe('grammar');
});
```

- [ ] **Step 4: Run + typecheck**

Run: `rm -rf infra/lambda/dist; pnpm --filter @language-drill/lambda typecheck && pnpm --filter @language-drill/lambda test`
Expected: PASS, and the `Record<ExerciseType,…>` exhaustiveness errors from Task 1 in this package are gone.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/today-plan.ts infra/lambda/src/lib/progress-aggregation.ts infra/lambda/src/lib/progress-aggregation.test.ts
git commit -m "feat(lambda): conjugation plan estimates + grammar radar axis"
```

---

### Task 14: ConjugationExercise component (`apps/web`)

**Files:**
- Create: `apps/web/app/(dashboard)/drill/_components/conjugation-exercise.tsx`

Model on `vocab-exercise.tsx`. Single text field + accent picker; on result, show `targetForm`, `breakdown`, and example sentences.

- [ ] **Step 1: Create the component**

```tsx
'use client';

import * as React from 'react';
import type { ConjugationContent, LearningLanguage } from '@language-drill/shared';
import { AccentPicker, Button, Card, Input } from '../../../../components/ui';
import { useDrillAction } from './drill-action-context';
import { FeedbackShell } from './feedback-shell';
import type { SubmissionMeta, SubmissionState } from './types';

export type { SubmissionMeta, SubmissionState } from './types';

export interface ConjugationExerciseProps {
  content: ConjugationContent;
  language: LearningLanguage;
  submission: SubmissionState;
  onSubmit: (answer: string, meta: SubmissionMeta) => void;
  onNext: () => void;
  nextLabel?: string;
}

function isAccentLanguage(lang: string): lang is 'ES' | 'DE' | 'TR' {
  return lang === 'ES' || lang === 'DE' || lang === 'TR';
}

export function ConjugationExercise({
  content,
  language,
  submission,
  onSubmit,
  onNext,
  nextLabel,
}: ConjugationExerciseProps) {
  const [answer, setAnswer] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isLocked = submission.kind !== 'idle';
  const showAccentPicker = isAccentLanguage(language);
  const canSubmit = answer.trim().length > 0;

  function handleSubmit() {
    if (!canSubmit || isLocked) return;
    onSubmit(answer, {});
  }

  const { active, setPrimaryAction } = useDrillAction();
  React.useEffect(() => {
    if (!active || submission.kind === 'evaluated') return;
    setPrimaryAction({
      label: 'submit',
      onClick: handleSubmit,
      disabled: !canSubmit || isLocked,
      loading: submission.kind === 'submitting',
    });
  }, [active, setPrimaryAction, submission.kind, canSubmit, isLocked, answer]);

  return (
    <div className="flex flex-col gap-s-4">
      <Card padding="lg">
        <p className="t-display-s">
          {content.lemma}{' '}
          <span className="text-ink-mute">— {content.lemmaGloss}</span>
        </p>
        <p className="t-body-l text-ink-mute">{content.featureBundle}</p>
      </Card>

      <div className="flex flex-col gap-s-3">
        <Input
          ref={inputRef}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          readOnly={isLocked}
          disabled={isLocked}
          className={isLocked ? 'opacity-60' : undefined}
        />
        {showAccentPicker && (
          <AccentPicker language={language} targetRef={inputRef} disabled={isLocked} />
        )}
      </div>

      {!active && (
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={!canSubmit || isLocked}
          loading={submission.kind === 'submitting'}
        >
          submit
        </Button>
      )}

      {submission.kind === 'evaluated' && (
        <FeedbackShell
          tier={submission.result.score >= 1 ? 'success' : 'error'}
          label={submission.result.score >= 1 ? 'correct' : 'not quite'}
          scoreChipText={`${Math.round(submission.result.score * 100)}%`}
          hintLevel={0}
          onNext={onNext}
          nextLabel={nextLabel}
        >
          <div className="flex flex-col gap-s-4">
            <p className="t-display-m">{content.targetForm}</p>
            <p className="t-body text-ink-mute">{content.breakdown}</p>
            {content.exampleSentences.map((s, i) => (
              <p key={i} className="t-body-l">{s}</p>
            ))}
          </div>
        </FeedbackShell>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify FeedbackShell `tier` values**

Grep `feedback-shell.tsx` for the `tier` prop's accepted values; if it's not `'success' | 'error'`, map to the correct tokens (e.g. reuse `vocabVerdict`'s tier). Adjust the two `tier`/`label` expressions accordingly.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @language-drill/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/_components/conjugation-exercise.tsx"
git commit -m "feat(web): ConjugationExercise renderer"
```

---

### Task 15: Wire renderer + label (`apps/web`)

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/_components/exercise-pane.tsx`, `apps/web/app/(dashboard)/_lib/timeline-labels.ts:31-38`
- Test: existing `timeline-labels` test if present; grep the app for `ExerciseType` exhaustive maps the change touches.

- [ ] **Step 1: Add the render branch** to `exercise-pane.tsx` — import the guard + component, and add before the final fallback:

```tsx
import { isConjugationContent, /* …existing… */ } from '@language-drill/shared';
import { ConjugationExercise } from './conjugation-exercise';
```

```tsx
  if (isConjugationContent(content)) {
    return (
      <ConjugationExercise
        key={exercise.id}
        content={content}
        language={language}
        submission={submission}
        onSubmit={onSubmit}
        onNext={onNext}
        nextLabel={nextLabel}
      />
    );
  }
```

- [ ] **Step 2: Add the timeline label**

```ts
const TYPE_LABELS: Record<ExerciseType, string> = {
  // …existing…
  [ExerciseType.CONJUGATION]: 'conjugation',
};
```

- [ ] **Step 3: Grep for other exhaustive `ExerciseType` maps in web**

Run: `grep -rn "Record<ExerciseType" apps/web/ ; grep -rn "ExerciseType\." apps/web/ | grep -i "switch\|case"`
Fix any remaining exhaustive map/switch flagged by Task 1's typecheck for `apps/web`.

- [ ] **Step 4: Typecheck + test**

Run: `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/_components/exercise-pane.tsx" "apps/web/app/(dashboard)/_lib/timeline-labels.ts"
git commit -m "feat(web): wire ConjugationExercise into the exercise pane"
```

---

### Task 16: Opt-in entry page (`apps/web`)

**Files:**
- Create: `apps/web/app/(dashboard)/drill/conjugation/page.tsx`
- (Optional) Modify the drill hub/landing to link to it.

Model on `drill/free-writing/page.tsx`. Fetch one conjugation exercise via the existing `useExercise({ type })`, render via `ExercisePane`, submit via `useSubmitAnswer`, manage a local `SubmissionState`, and "next" refetches.

- [ ] **Step 1: Create the page**

```tsx
'use client';
import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { CefrLevel, ExerciseType } from '@language-drill/shared';
import {
  useExercise,
  useSubmitAnswer,
  useLanguageProfiles,
  createAuthenticatedFetch,
} from '@language-drill/api-client';
import { useActiveLanguage } from '../../../../components/shell';
import { ExercisePane } from '../_components/exercise-pane';
import type { SubmissionState, SubmissionMeta } from '../_components/types';

export default function ConjugationDrillPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const { activeLanguage } = useActiveLanguage();

  const { data: profilesData } = useLanguageProfiles({ fetchFn });
  const profiles = profilesData?.profiles ?? [];
  const difficulty =
    (profiles.find((p) => p.language === activeLanguage)?.proficiencyLevel as CefrLevel) ??
    CefrLevel.B1;

  const [nonce, setNonce] = useState(0);
  const [submission, setSubmission] = useState<SubmissionState>({ kind: 'idle' });

  const { data: exercise, refetch } = useExercise({
    language: activeLanguage,
    difficulty,
    type: ExerciseType.CONJUGATION,
    fetchFn,
    // bust cache per nonce so "next" pulls a fresh item
    key: nonce,
  });

  const submit = useSubmitAnswer({ fetchFn });

  if (!exercise) {
    return <div className="t-body" style={{ padding: 24 }}>loading…</div>;
  }

  const onSubmit = async (answer: string, _meta: SubmissionMeta) => {
    setSubmission({ kind: 'submitting' });
    try {
      const result = await submit.mutateAsync({ exerciseId: exercise.id, answer });
      setSubmission({ kind: 'evaluated', result, meta: {} });
    } catch (err) {
      setSubmission({ kind: 'error', error: err as Error });
    }
  };

  const onNext = () => {
    setSubmission({ kind: 'idle' });
    setNonce((n) => n + 1);
    void refetch();
  };

  return (
    <div style={{ padding: 24, maxWidth: 640, margin: '0 auto' }}>
      <h1 className="t-display-m mb-s-4">Conjugation warm-up</h1>
      <ExercisePane
        exercise={exercise}
        language={activeLanguage}
        submission={submission}
        onSubmit={onSubmit}
        onNext={onNext}
        nextLabel="next"
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify the `useExercise` signature**

Grep `packages/api-client/src/hooks/useExercise.ts` for the hook's params. If it does not accept a cache-busting `key`, drive refetch with the returned `refetch()` only and drop the `nonce`/`key` lines. Match the actual param names exactly (`language`, `difficulty`, `type`, `fetchFn`).

- [ ] **Step 3: Add a navigation entry (optional, low-risk)**

If the drill hub lists drill modes (grep for where `FreeWritingEntryCard` or a `/drill/free-writing` link is rendered), add a sibling link to `/drill/conjugation`. Keep it minimal; this is the only place the feature is surfaced (intentionally not in the adaptive plan).

- [ ] **Step 4: Typecheck + test**

Run: `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/conjugation/page.tsx"
git commit -m "feat(web): opt-in /drill/conjugation warm-up entry"
```

---

### Task 17: Full gate + Langfuse sync note + finish

**Files:** none (verification + docs).

- [ ] **Step 1: Clean stale dist and run the full suite serially**

```bash
rm -rf infra/lambda/dist
pnpm lint
pnpm typecheck
pnpm turbo run test --concurrency=1
```

Expected: all green. If `infra` flakes, re-run the serial command (per the known parallel-load flake note).

- [ ] **Step 2: Record the Langfuse prompt-sync requirement in the PR description**

The runtime fetches generation + validation prompt bodies from Langfuse; the in-repo edits to `generation-prompts.ts` / `validation-prompts.ts` only change the fallback. After merge, sync each environment per CLAUDE.md ("Prompt Editing" → `push-prompts`), so the new conjugation guidance + validation actually serve. Until then, the fallback strings serve (correct, just not the Langfuse copy). Note this explicitly in the PR body — it is a required post-merge step, not optional.

- [ ] **Step 3: Note pool bootstrapping**

Conjugation cells only produce exercises after a generation run on the bumped curriculum (scheduler, ~04:00 UTC) or a manual generation trigger for the flagged cells. The `/drill/conjugation` page returns `404 NO_EXERCISES` until the pool has approved conjugation rows. Call this out in the PR body; optionally trigger a manual generation for one ES cell to smoke-test end-to-end (out of scope to automate here).

- [ ] **Step 4: Push + open PR**

```bash
git push -u origin feat-conjugation-inflection-drill
gh pr create --base main --title "feat: conjugation/inflection drill (exercise #14)" --body "<summary + the two post-merge notes above>"
```

End PR body with the standard Claude Code attribution.

---

## Self-review notes (author)

- **Spec coverage:** §1 type → T1; §2 grading → T2,T12; §3 generation+validation → T8,T9,T10; §4 curriculum → T4,T5,T6,T7; §5 serving/surfacing → T13,T14,T15,T16; out-of-scope items (remediation, adaptive rotation, EN, Claude variant-fallback) are explicitly NOT tasked.
- **Type consistency:** `ConjugationContent` field names (`lemma`, `lemmaGloss`, `featureBundle`, `targetForm`, `acceptableForms`, `breakdown`, `exampleSentences`) are identical across T1, T2, T8, T9, T10, T12, T14. Grader uses `targetForm ∪ acceptableForms`; submit path reuses `gradeFluencyAnswer`; map keys use the `"conjugation"` enum value everywhere.
- **Known unknowns flagged inline (verify during execution):** `optionalStringArray` existence (T8), the byte-parity snapshot mechanism + spec-fixture builders in `generation-prompts.test.ts` (T9), `FeedbackShell` `tier` token values (T14), `useExercise` param/refetch shape (T16), and which TR/DE points are currently active (T7). Each step says to grep/confirm before assuming.
