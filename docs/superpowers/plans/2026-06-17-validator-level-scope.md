# Curriculum-grounded CEFR level scope — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject a curriculum-derived "level scope" (the grammar points a learner at/below the target CEFR level has studied) into both the generation and validation system prompts for the four grammar-anchored exercise types, so `levelMatch` is judged against the real curriculum instead of the model's own vague sense of the level — cutting spurious level-mismatch rejections.

**Architecture:** A pure data helper in `@language-drill/db` returns the at/below-level grammar points for a language. A small new `packages/ai/src/level-scope.ts` formats them into a gated prompt block (empty for non-grammar-anchored types). Both `computeGenerationPromptVars` and `computeValidationPromptVars` call it and expose a new `{{levelScopeSection}}` template var; the validator's `levelMatch` dimension is reworded to use the block as ground truth. Both prompt-version constants bump; a Langfuse push is required post-merge.

**Tech Stack:** TypeScript, pnpm + Turborepo, Vitest. Packages: `@language-drill/db` (curriculum data), `@language-drill/ai` (prompt builders). The generation/validation system prompts are Langfuse-registered (fetched via `getPromptWithVarsOrFallback`).

**Reference spec:** `docs/superpowers/specs/2026-06-17-validator-level-scope-design.md`

**Design refinement vs spec §3:** the generator instruction ("stay within scope") is folded **inside** the gated `{{levelScopeSection}}` block (not added as a separate Hard-constraints bullet), because `vocab_recall` shares the generation template but gets no scope block — a standalone bullet would dangle. The validator `levelMatch` rewording is phrased defensively ("if a grammar-scope list is provided above…") so it reads correctly whether or not the block renders.

---

## Task 1: `grammarPointsAtOrBelow` curriculum helper (`@language-drill/db`)

**Files:**
- Modify: `packages/db/src/curriculum/index.ts`
- Test: `packages/db/src/curriculum/curriculum.test.ts`

- [ ] **Step 1: Write the failing test**

Add at the end of `packages/db/src/curriculum/curriculum.test.ts` (it already imports from the package; add `grammarPointsAtOrBelow` to the existing import from `'./index'` / `'../curriculum'` — match the file's existing import path for `assertCurriculumInvariants`/`trCurriculum`):

```ts
describe('grammarPointsAtOrBelow', () => {
  it('returns TR A1+A2 grammar points (only) for TR at A2', () => {
    const pts = grammarPointsAtOrBelow('TR', 'A2');
    // All grammar kind, all TR, none above A2.
    expect(pts.length).toBeGreaterThanOrEqual(40); // 26 A1 + 14 A2
    expect(pts.every((p) => p.kind === 'grammar')).toBe(true);
    expect(pts.every((p) => p.language === 'TR')).toBe(true);
    expect(pts.every((p) => p.cefrLevel === 'A1' || p.cefrLevel === 'A2')).toBe(true);
    // Excludes vocab/dictation/free-writing umbrellas.
    expect(pts.some((p) => p.key.includes('-vocab-') || p.key.includes('-dictation') || p.key.includes('-fw-'))).toBe(false);
  });

  it('is inclusive of the target level and excludes higher levels', () => {
    const a1 = grammarPointsAtOrBelow('TR', 'A1');
    expect(a1.every((p) => p.cefrLevel === 'A1')).toBe(true);
    expect(a1.some((p) => p.cefrLevel === 'A2')).toBe(false);
    // A2 superset of A1 (same language).
    const a2 = grammarPointsAtOrBelow('TR', 'A2');
    expect(a2.length).toBeGreaterThan(a1.length);
  });

  it('returns [] for an out-of-round level', () => {
    expect(grammarPointsAtOrBelow('TR', 'C1')).toEqual([]);
  });

  it('scopes by language', () => {
    expect(grammarPointsAtOrBelow('TR', 'B2').every((p) => p.language === 'TR')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- curriculum`
Expected: FAIL — `grammarPointsAtOrBelow` is not exported.

> If db serves a stale `dist`, the `build` step above refreshes it (single-package vitest resolves against `db/dist`).

- [ ] **Step 3: Implement the helper**

In `packages/db/src/curriculum/index.ts`, add the import of the level type (it already imports `type { GrammarPoint } from './types'` on line 6 and re-exports `CurriculumCefrLevel`; import it for the signature) and the helper. Place the helper right after `getGrammarPoint` (after line 46):

Change line 6 region to also bring in the level type:

```ts
import type { CurriculumCefrLevel, GrammarPoint } from './types';
```

(Replace the existing `import type { GrammarPoint } from './types';` on line 6.)

Then add after `getGrammarPoint` (after line 46):

```ts
// CEFR rank for "at or below" comparisons. Mirrors ROUND_1_CEFR_LEVELS
// (generation/cells.ts) without importing across the curriculum→generation
// boundary. C1/C2 are intentionally absent — out-of-round levels rank as
// "unknown" and yield an empty scope.
const CEFR_RANK: Readonly<Record<string, number>> = { A1: 0, A2: 1, B1: 2, B2: 3 };

/**
 * All `kind: 'grammar'` points for `language` at or below `level`, in that
 * language's curriculum order. The "level scope" a learner at `level` has
 * plausibly studied — fed into the generation/validation prompts so they judge
 * level-appropriateness against the real curriculum instead of the model's own
 * sense of the CEFR band. Returns `[]` for an unknown/out-of-round level (C1/C2)
 * and excludes vocab/dictation/free-writing umbrellas (not grammar).
 *
 * `level` is typed `string` so callers can pass the broader `CefrLevel` enum
 * (which includes C1/C2) without a cast; unknown ranks fall through to `[]`.
 */
export function grammarPointsAtOrBelow(
  language: LearningLanguage,
  level: string,
): readonly GrammarPoint[] {
  const maxRank = CEFR_RANK[level];
  if (maxRank === undefined) return [];
  return ALL_CURRICULA.filter(
    (entry) =>
      entry.kind === 'grammar' &&
      entry.language === language &&
      (CEFR_RANK[entry.cefrLevel] ?? Number.POSITIVE_INFINITY) <= maxRank,
  );
}
```

(`LearningLanguage` is already imported on line 1; `ALL_CURRICULA` is defined above.)

- [ ] **Step 4: Run the test, verify it PASSES**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- curriculum`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/curriculum/index.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "feat(db): grammarPointsAtOrBelow — at/below-level grammar scope helper"
```

---

## Task 2: `renderLevelScopeSection` formatter (`@language-drill/ai`)

**Files:**
- Create: `packages/ai/src/level-scope.ts`
- Test: `packages/ai/src/level-scope.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/level-scope.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CefrLevel, ExerciseType, Language } from "@language-drill/shared";
import { getGrammarPoint } from "@language-drill/db";
import { renderLevelScopeSection } from "./level-scope.js";

// A known TR A1 grammar point — must appear in an A2 cell's scope (at/below).
const a1 = getGrammarPoint("tr-a1-locative");
if (!a1) throw new Error("test fixture missing: tr-a1-locative");

describe("renderLevelScopeSection", () => {
  it("renders a scope block for a grammar-anchored type, grouped by level", () => {
    const out = renderLevelScopeSection(ExerciseType.CLOZE, Language.TR, CefrLevel.A2);
    expect(out).toContain("Grammar in this learner's scope");
    expect(out).toContain("CEFR ≤ A2");
    expect(out).toContain(a1.name); // an A1 point appears in the A2 scope
    expect(out).toMatch(/- A1:/);
    expect(out).toMatch(/- A2:/);
    expect(out.endsWith("\n\n")).toBe(true); // splices cleanly into the template
  });

  it("returns '' for a non-grammar-anchored type (gate)", () => {
    expect(renderLevelScopeSection(ExerciseType.VOCAB_RECALL, Language.TR, CefrLevel.A2)).toBe("");
  });

  it("returns '' when the language/level has no grammar points (e.g. ES A1)", () => {
    // ES A1 grammar is currently disabled → empty scope → omit the section.
    expect(renderLevelScopeSection(ExerciseType.CLOZE, Language.ES, CefrLevel.A1)).toBe("");
  });

  it("applies to all four grammar-anchored types", () => {
    for (const t of [ExerciseType.CLOZE, ExerciseType.TRANSLATION, ExerciseType.SENTENCE_CONSTRUCTION, ExerciseType.CONJUGATION]) {
      expect(renderLevelScopeSection(t, Language.TR, CefrLevel.A2)).toContain("learner's scope");
    }
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS**

Run: `pnpm --filter @language-drill/ai build && pnpm --filter @language-drill/ai test -- level-scope`
Expected: FAIL — `./level-scope.js` does not exist.

- [ ] **Step 3: Implement the formatter**

Create `packages/ai/src/level-scope.ts`:

```ts
/**
 * packages/ai — Curriculum-grounded CEFR "level scope" block.
 *
 * Both the generation and validation system prompts judged level-appropriateness
 * from only the single target grammar point + generic one-line CEFR descriptors,
 * so `levelMatch` drifted to the model's own sense of the level and produced
 * spurious rejections. This block lists the grammar points a learner at or below
 * the target level has actually studied (from the curriculum), giving both
 * prompts a shared ground truth.
 *
 * Gated to the four grammar-anchored exercise types — cloze, translation,
 * sentence_construction, conjugation. For every other type (e.g. vocab_recall,
 * which shares the generation template) it returns "", so the `{{levelScopeSection}}`
 * placeholder collapses and the cached prompt prefix is unchanged. Pure +
 * deterministic (curriculum is static), preserving prompt-cache parity.
 */

import {
  type CefrLevel,
  ExerciseType,
  type LearningLanguage,
} from "@language-drill/shared";
import { grammarPointsAtOrBelow } from "@language-drill/db";

const LEVEL_SCOPE_TYPES: ReadonlySet<ExerciseType> = new Set([
  ExerciseType.CLOZE,
  ExerciseType.TRANSLATION,
  ExerciseType.SENTENCE_CONSTRUCTION,
  ExerciseType.CONJUGATION,
]);

const LEVEL_ORDER = ["A1", "A2", "B1", "B2"] as const;

export function renderLevelScopeSection(
  exerciseType: ExerciseType,
  language: LearningLanguage,
  cefrLevel: CefrLevel,
): string {
  if (!LEVEL_SCOPE_TYPES.has(exerciseType)) return "";
  const points = grammarPointsAtOrBelow(language, cefrLevel);
  if (points.length === 0) return "";

  const byLevel = new Map<string, string[]>();
  for (const p of points) {
    const names = byLevel.get(p.cefrLevel) ?? [];
    names.push(p.name);
    byLevel.set(p.cefrLevel, names);
  }
  const lines = LEVEL_ORDER.filter((lvl) => byLevel.has(lvl))
    .map((lvl) => `- ${lvl}: ${byLevel.get(lvl)!.join("; ")}`)
    .join("\n");

  return `## Grammar in this learner's scope (CEFR ≤ ${cefrLevel}, ${language})

Treat any grammar or vocabulary within or below this scope as level-appropriate. Do not require — or penalize the absence of — constructions above CEFR ${cefrLevel}. Obligatory morphology inherent to ${language} (e.g. Turkish vowel harmony and agglutination) is part of the language at every level, not "above level."

${lines}

`;
}
```

- [ ] **Step 4: Run the test, verify it PASSES**

Run: `pnpm --filter @language-drill/ai build && pnpm --filter @language-drill/ai test -- level-scope`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/level-scope.ts packages/ai/src/level-scope.test.ts
git commit -m "feat(ai): renderLevelScopeSection — gated curriculum level-scope block"
```

---

## Task 3: Wire level scope into the GENERATION prompt

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts`
- Test: `packages/ai/src/generation-prompts.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/ai/src/generation-prompts.test.ts`, add `renderLevelScopeSection`'s sibling fixture and a new describe block. First, near the existing fixtures (after `baseInputs`, ~line 52), add a TR fixture set:

```ts
const trA2Grammar = getGrammarPoint("tr-a2-aorist");
if (!trA2Grammar) throw new Error("test fixture missing: tr-a2-aorist");
const trA1ScopePoint = getGrammarPoint("tr-a1-locative");
if (!trA1ScopePoint) throw new Error("test fixture missing: tr-a1-locative");

const trClozeInputs: GenerationPromptInputs = {
  language: Language.TR,
  cefrLevel: CefrLevel.A2,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint: trA2Grammar,
};
```

Then add a describe block (e.g. after the existing `buildGenerationSystemPrompt` block):

```ts
describe("level scope in the generation prompt", () => {
  it("includes the at/below-level grammar scope for a grammar-anchored cell", async () => {
    const prompt = await buildGenerationSystemPrompt(trClozeInputs, []);
    expect(prompt).toContain("Grammar in this learner's scope");
    expect(prompt).toContain(trA1ScopePoint.name); // A1 point in an A2 cell's scope
  });

  it("omits the scope block for vocab_recall (gate)", async () => {
    const vocab = getGrammarPoint("tr-a1-vocab-food-drink");
    if (!vocab) throw new Error("test fixture missing: tr-a1-vocab-food-drink");
    const prompt = await buildGenerationSystemPrompt(
      { language: Language.TR, cefrLevel: CefrLevel.A1, exerciseType: ExerciseType.VOCAB_RECALL, grammarPoint: vocab },
      [],
    );
    expect(prompt).not.toContain("Grammar in this learner's scope");
  });

  it("exposes levelScopeSection via computeGenerationPromptVars", () => {
    const vars = computeGenerationPromptVars(trClozeInputs, []);
    expect(vars.levelScopeSection).toContain("learner's scope");
  });
});
```

- [ ] **Step 2: Run the tests, verify they FAIL**

Run: `pnpm --filter @language-drill/ai build && pnpm --filter @language-drill/ai test -- generation-prompts`
Expected: FAIL — `vars.levelScopeSection` is undefined and the block is absent from the prompt. (The existing byte-parity test may also fail until Step 3 wires the var — that's expected and resolves in Step 3.)

- [ ] **Step 3: Implement**

In `packages/ai/src/generation-prompts.ts`:

(a) Add the import near the other imports (after line 24):

```ts
import { renderLevelScopeSection } from "./level-scope.js";
```

(b) Bump the version constant (line 135):

```ts
export const GENERATION_PROMPT_VERSION = "generate@2026-06-16";
```
→
```ts
export const GENERATION_PROMPT_VERSION = "generate@2026-06-17";
```

(c) Splice `{{levelScopeSection}}` into `GENERATION_SYSTEM_PROMPT_TEMPLATE` — change the region at lines 258-262:

```
## CEFR level descriptors

{{cefrDescriptors}}

{{priorPoolSection}}## Hard constraints
```
→
```
## CEFR level descriptors

{{cefrDescriptors}}

{{levelScopeSection}}{{priorPoolSection}}## Hard constraints
```

(d) Add the var to `computeGenerationPromptVars`'s returned object (after the `cefrDescriptors:` line, ~318):

```ts
    cefrDescriptors: CEFR_DESCRIPTOR_BULLETS,
    levelScopeSection: renderLevelScopeSection(exerciseType, language, cefrLevel),
    priorPoolSection: renderPriorPoolSection(exerciseType, priorPoolSurfaces),
```

(`exerciseType`, `language`, `cefrLevel` are already destructured from `inputs` on line 307.)

- [ ] **Step 4: Run the tests, verify they PASS**

Run: `pnpm --filter @language-drill/ai build && pnpm --filter @language-drill/ai test -- generation-prompts`
Expected: PASS — including the existing determinism and byte-parity tests (the new var is deterministic).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/generation-prompts.ts packages/ai/src/generation-prompts.test.ts
git commit -m "feat(ai): inject curriculum level scope into the generation prompt"
```

---

## Task 4: Wire level scope + reword `levelMatch` into the VALIDATION prompt

**Files:**
- Modify: `packages/ai/src/validation-prompts.ts`
- Test: `packages/ai/src/validation-prompts.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/ai/src/validation-prompts.test.ts`, add a TR spec fixture near `baseSpec` (~line 45):

```ts
const trA2Grammar = getGrammarPoint("tr-a2-aorist");
if (!trA2Grammar) throw new Error("test fixture missing: tr-a2-aorist");
const trA1ScopePoint = getGrammarPoint("tr-a1-locative");
if (!trA1ScopePoint) throw new Error("test fixture missing: tr-a1-locative");

const trClozeSpec: GenerationSpec = {
  language: Language.TR,
  cefrLevel: CefrLevel.A2,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint: trA2Grammar,
  topicDomain: null,
  count: 1,
  batchSeed: "test-seed",
};
```

Then a describe block:

```ts
describe("level scope in the validation prompt", () => {
  it("includes the at/below-level grammar scope for a grammar-anchored cell", async () => {
    const prompt = await buildValidationSystemPrompt(trClozeSpec);
    expect(prompt).toContain("Grammar in this learner's scope");
    expect(prompt).toContain(trA1ScopePoint.name);
  });

  it("rewords levelMatch to use the scope as ground truth, with the morphology carve-out", async () => {
    const prompt = await buildValidationSystemPrompt(trClozeSpec);
    // Reworded guidance (not the old bare "does the difficulty match").
    expect(prompt).toContain("within or below the learner's scope");
    expect(prompt).toMatch(/never\s+"above level"/i);
    expect(prompt).toContain("not the target point"); // not-the-target carve-out
  });

  it("omits the scope block for vocab_recall (gate)", async () => {
    const vocab = getGrammarPoint("tr-a1-vocab-food-drink");
    if (!vocab) throw new Error("test fixture missing: tr-a1-vocab-food-drink");
    const prompt = await buildValidationSystemPrompt({ ...trClozeSpec, exerciseType: ExerciseType.VOCAB_RECALL, grammarPoint: vocab, cefrLevel: CefrLevel.A1 });
    expect(prompt).not.toContain("Grammar in this learner's scope");
  });
});
```

- [ ] **Step 2: Run the tests, verify they FAIL**

Run: `pnpm --filter @language-drill/ai build && pnpm --filter @language-drill/ai test -- validation-prompts`
Expected: FAIL — scope block absent, reworded `levelMatch` text absent. (Byte-parity test may fail until Step 3 — expected.)

- [ ] **Step 3: Implement**

In `packages/ai/src/validation-prompts.ts`:

(a) Add imports. Add `ExerciseType` is already imported (line 23). Add after line 31:

```ts
import { renderLevelScopeSection } from "./level-scope.js";
```

(b) Bump the version constant (line 68):

```ts
export const VALIDATION_PROMPT_VERSION = "validate@2026-06-17";
```
→
```ts
export const VALIDATION_PROMPT_VERSION = "validate@2026-06-18";
```

(c) Splice `{{levelScopeSection}}` into `VALIDATION_SYSTEM_PROMPT_TEMPLATE` — change lines 97-101:

```
## CEFR level descriptors

{{cefrDescriptors}}

## Dimensions to score (one-to-one with the tool's required fields)
```
→
```
## CEFR level descriptors

{{cefrDescriptors}}

{{levelScopeSection}}## Dimensions to score (one-to-one with the tool's required fields)
```

(d) Reword the `levelMatch` dimension (line 118):

```
4. **levelMatch** (boolean): does the difficulty match {{cefrLevel}}?
```
→
```
4. **levelMatch** (boolean): If a grammar-scope list is provided above, use it as the ground truth for what a {{cefrLevel}} learner has studied. Set \`false\` only if the exercise REQUIRES a grammatical construction clearly ABOVE that scope, or is trivially below {{cefrLevel}}. Do NOT set \`false\` merely because a construction is within or below the learner's scope but is not the target point — anything within or below scope is fair game. Obligatory morphology inherent to {{language}} (e.g. Turkish vowel harmony and agglutination) is part of the language at every level and is never "above level."
```

(e) Add the var to `computeValidationPromptVars`'s returned object (after the `cefrDescriptors:` line, ~151):

```ts
    cefrDescriptors: CEFR_DESCRIPTOR_BULLETS,
    levelScopeSection: renderLevelScopeSection(
      spec.exerciseType,
      spec.language,
      spec.cefrLevel,
    ),
```

(`spec.exerciseType/language/cefrLevel` exist on `GenerationSpec`.)

- [ ] **Step 4: Run the tests, verify they PASS**

Run: `pnpm --filter @language-drill/ai build && pnpm --filter @language-drill/ai test -- validation-prompts`
Expected: PASS — including determinism + byte-parity.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/validation-prompts.ts packages/ai/src/validation-prompts.test.ts
git commit -m "feat(ai): inject level scope + reword levelMatch in the validation prompt"
```

---

## Task 5: Full pre-push gate

**Files:** none (verification only)

- [ ] **Step 1: Build + lint + typecheck**

Run: `pnpm build && pnpm lint && pnpm typecheck`
Expected: all pass, zero errors.

- [ ] **Step 2: Full test suite, single-concurrency**

Run: `pnpm turbo run test --concurrency=1`
Expected: all packages green. (If `infra/lambda` shows phantom failures from stale compiled tests, `rm -rf infra/lambda/dist` and re-run.)

- [ ] **Step 3: Record the post-merge + verification actions (no code)**

These are NOT part of the merge diff — record them for the finish/handoff:
1. **Langfuse push (required):** after merge, the runtime serves the old prompt bodies until pushed. Run `push-prompts` for `generate-system-prompt` and `validate-system-prompt` against **dev and prod** per the `CLAUDE.md` procedure, then `bootstrap-prompts --check` (exit 0) to confirm in sync.
2. **eval:gen A/B (recommended before relying on it):** baseline = `main` (scope off) vs candidate = this branch (scope on), over a dataset built with `eval:gen:export` biased to low-approval / level-rejection cells plus a TR A1/A2 cell. Expect approval-rate up and level/`levelMatch` rejection reasons down with no rise in genuine quality flags.
3. **Manual spot-check:** run a previously-spuriously-rejected draft through the validator both ways and confirm the verdict flips.

---

## Self-review notes

- **Spec coverage:** §1 helper → Task 1; §2 formatter + gate → Task 2; §3 generator wiring → Task 3, validator wiring + `levelMatch` reword → Task 4; §4 version bumps → Tasks 3/4, Langfuse push → Task 5 step 3; tests → each task; verification → Task 5. The spec's "separate hard-constraint bullet" is intentionally folded into the gated block (documented in the header) — covered by the block text in Task 2.
- **Type consistency:** `renderLevelScopeSection(exerciseType, language, cefrLevel)` signature is identical in Task 2 (definition), Task 3, and Task 4 (call sites); `grammarPointsAtOrBelow(language, level)` consistent between Task 1 and Task 2. The new template var is named `levelScopeSection` everywhere (template placeholder + both `compute*PromptVars`).
- **No placeholders:** every code step shows full before/after.
- **Fixture risk:** tests depend on curriculum keys `tr-a2-aorist`, `tr-a1-locative`, `tr-a1-vocab-food-drink` existing (each guarded with a throw). If any key has been renamed, the guard fails loudly with a clear message — swap to a current key.
