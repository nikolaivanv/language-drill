# Free-writing yield fix + TR A1/A2 cells — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop narrow-topic free-writing dedup churn (lower target 8→5 + level-aware angle boost), un-stick the 4 suppressed ES cells via a curriculum-version bump, and add 6 TR A1/A2 free-writing cells.

**Architecture:** Three independent edits — (1) the per-cell target table, (2) the free-writing generation prompt's uncached angle/user-prompt code + A1/A2 word-bands, (3) the TR curriculum data + ES/TR version bumps — each with its own test update. The prompt boost is code-only (angles + user prompt are uncached, the Langfuse system-prompt body is untouched), so no `push-prompts` sync is required.

**Tech Stack:** TypeScript, pnpm workspaces + Turborepo, Vitest. Packages: `@language-drill/lambda` (`infra/lambda`), `@language-drill/ai` (`packages/ai`), `@language-drill/db` (`packages/db`).

**Reference spec:** `docs/superpowers/specs/2026-06-17-free-writing-yield-and-tr-cells-design.md`

---

## Task 1: Lower the free-writing per-cell target 8 → 5 (+ A1/A2)

**Files:**
- Modify: `infra/lambda/src/generation/cell-targets.ts:62-67`
- Test: `infra/lambda/src/generation/cell-targets.test.ts:115-117`

- [ ] **Step 1: Update the failing test first**

In `infra/lambda/src/generation/cell-targets.test.ts`, replace the block at lines 115-117:

```ts
  it('resolves the free_writing B1/B2 per-cell target to 8', () => {
    expect(resolveCellTarget(makeCell(ExerciseType.FREE_WRITING, CefrLevel.B1))).toBe(8);
    expect(resolveCellTarget(makeCell(ExerciseType.FREE_WRITING, CefrLevel.B2))).toBe(8);
  });
```

with:

```ts
  it('resolves the free_writing per-cell target to 5 at every level', () => {
    // A small (language, level, topic) cell has a tiny distinct-title space (the
    // dedup surface is the title); 5 is reachable per topic, breadth comes from
    // more curated topic umbrellas. Applies to A1/A2 (TR) and B1/B2 (ES) alike.
    expect(resolveCellTarget(makeCell(ExerciseType.FREE_WRITING, CefrLevel.A1))).toBe(5);
    expect(resolveCellTarget(makeCell(ExerciseType.FREE_WRITING, CefrLevel.A2))).toBe(5);
    expect(resolveCellTarget(makeCell(ExerciseType.FREE_WRITING, CefrLevel.B1))).toBe(5);
    expect(resolveCellTarget(makeCell(ExerciseType.FREE_WRITING, CefrLevel.B2))).toBe(5);
  });
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- cell-targets`
Expected: FAIL — A1/A2 currently resolve to `TARGET_PER_CELL` (not 5) and B1/B2 resolve to 8.

- [ ] **Step 3: Update the target table**

In `infra/lambda/src/generation/cell-targets.ts`, replace lines 62-67:

```ts
  // Free-writing prompts are batch-generated (Phase 2). Capped LOW (8): a single
  // (language, level, topic) cell has a small distinct-title space — the dedup
  // surface is the title — so the 2026-06-16 run hit heavy dedup-give-up chasing
  // 12 (title convergence on the topic name). 8 is reachable per topic; breadth
  // comes from more curated topic umbrellas, not a high per-cell target.
  [ExerciseType.FREE_WRITING]: { B1: 8, B2: 8 },
```

with:

```ts
  // Free-writing prompts are batch-generated (Phase 2). Capped LOW (5) at every
  // level: a single (language, level, topic) cell has a tiny distinct-title space
  // — the dedup surface is the title — so even with the prior-title avoid-list and
  // angle rotation, narrow topics hit heavy dedup-give-up above ~5 (the 2026-06-16
  // run stalled at 3 on es-b1-fw-my-town / es-b2-fw-remote-work chasing 8). 5 is
  // reachable per topic; breadth comes from more curated topic umbrellas. A1/A2
  // are set for TR free-writing (2026-06-17).
  [ExerciseType.FREE_WRITING]: { A1: 5, A2: 5, B1: 5, B2: 5 },
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- cell-targets`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/generation/cell-targets.ts infra/lambda/src/generation/cell-targets.test.ts
git commit -m "fix(generation): lower free-writing per-cell target to 5 at all levels"
```

---

## Task 2: Level-aware angle pools + A1/A2 word-bands + sharper user prompt

**Files:**
- Modify: `packages/ai/src/free-writing-generation-prompts.ts` (lines 29, 46-63, 91-113, 200-212)
- Test: `packages/ai/src/free-writing-generation-prompts.test.ts` (lines 4-10, 38-41, 82-92)

Note: `buildFreeWritingGenerationUserPrompt(inputs, ordinal)` already receives `inputs` (which carries `cefrLevel`), and the call site `packages/ai/src/generate.ts:1043` passes it — so **no `generate.ts` change is needed**. `FREE_WRITING_ANGLES` / `freeWritingAngleForOrdinal` are **not** re-exported from `packages/ai/src/index.ts`, so the rename is contained to this file + its test.

- [ ] **Step 1: Update the tests first**

In `packages/ai/src/free-writing-generation-prompts.test.ts`:

(a) Replace the import block (lines 3-10):

```ts
import {
  FREE_WRITING_GENERATION_PROMPT_VERSION,
  FREE_WRITING_LENGTH_BY_CEFR,
  FREE_WRITING_ANGLES,
  computeFreeWritingGenerationPromptVars,
  buildFreeWritingGenerationUserPrompt,
  freeWritingAngleForOrdinal,
} from "./free-writing-generation-prompts.js";
```

with:

```ts
import {
  FREE_WRITING_GENERATION_PROMPT_VERSION,
  FREE_WRITING_LENGTH_BY_CEFR,
  CONCRETE_FREE_WRITING_ANGLES,
  FULL_FREE_WRITING_ANGLES,
  computeFreeWritingGenerationPromptVars,
  buildFreeWritingGenerationUserPrompt,
  freeWritingAngleForOrdinal,
} from "./free-writing-generation-prompts.js";
```

(b) Replace the word-band test (lines 38-41):

```ts
  it("derives the word band from the CEFR level", () => {
    expect(FREE_WRITING_LENGTH_BY_CEFR.B1).toEqual({ minWords: 80, maxWords: 120, suggestedMinutes: 15 });
    expect(FREE_WRITING_LENGTH_BY_CEFR.B2).toEqual({ minWords: 150, maxWords: 200, suggestedMinutes: 25 });
  });
```

with:

```ts
  it("derives the word band from the CEFR level", () => {
    expect(FREE_WRITING_LENGTH_BY_CEFR.A1).toEqual({ minWords: 30, maxWords: 60, suggestedMinutes: 10 });
    expect(FREE_WRITING_LENGTH_BY_CEFR.A2).toEqual({ minWords: 60, maxWords: 100, suggestedMinutes: 15 });
    expect(FREE_WRITING_LENGTH_BY_CEFR.B1).toEqual({ minWords: 80, maxWords: 120, suggestedMinutes: 15 });
    expect(FREE_WRITING_LENGTH_BY_CEFR.B2).toEqual({ minWords: 150, maxWords: 200, suggestedMinutes: 25 });
  });
```

(c) Replace the angle-rotation test (lines 82-92):

```ts
  it("rotates a distinct angle per ordinal and pins it into the user prompt", () => {
    // Each ordinal in a full batch (< angle-list length) gets a unique angle.
    const seen = new Set(
      Array.from({ length: FREE_WRITING_ANGLES.length }, (_, i) => freeWritingAngleForOrdinal(i)),
    );
    expect(seen.size).toBe(FREE_WRITING_ANGLES.length);
    expect(freeWritingAngleForOrdinal(FREE_WRITING_ANGLES.length)).toBe(FREE_WRITING_ANGLES[0]);
    const p = buildFreeWritingGenerationUserPrompt(INPUTS, 0);
    expect(p).toContain(FREE_WRITING_ANGLES[0]);
    expect(p).toMatch(/do NOT reuse the bare topic name/i);
  });
```

with:

```ts
  it("rotates B1/B2 ordinals through the full analytical angle pool", () => {
    // INPUTS is B2 → full pool. Each ordinal in a batch < pool length is unique.
    const seen = new Set(
      Array.from({ length: FULL_FREE_WRITING_ANGLES.length }, (_, i) =>
        freeWritingAngleForOrdinal(i, "B2"),
      ),
    );
    expect(seen.size).toBe(FULL_FREE_WRITING_ANGLES.length);
    expect(freeWritingAngleForOrdinal(FULL_FREE_WRITING_ANGLES.length, "B2")).toBe(
      FULL_FREE_WRITING_ANGLES[0],
    );
    const p = buildFreeWritingGenerationUserPrompt(INPUTS, 0);
    expect(p).toContain(FULL_FREE_WRITING_ANGLES[0]);
    expect(p).toMatch(/do NOT reuse the bare topic name/i);
  });

  it("rotates A1/A2 ordinals through the concrete (non-analytical) angle pool", () => {
    // A1/A2 must avoid argumentative angles (opposing positions, recommendation).
    const a1Inputs = { ...INPUTS, cefrLevel: CefrLevel.A1 };
    const angle = freeWritingAngleForOrdinal(0, "A1");
    expect(CONCRETE_FREE_WRITING_ANGLES).toContain(angle);
    // The concrete pool must exclude argumentative angles that are too hard at A1/A2.
    expect(CONCRETE_FREE_WRITING_ANGLES).not.toContain("weighing two clearly opposing positions");
    const p = buildFreeWritingGenerationUserPrompt(a1Inputs, 0);
    expect(p).toContain(CONCRETE_FREE_WRITING_ANGLES[0]);
  });
```

(Keep the existing `CefrLevel` import at the top of the test file — it is already imported on line 2.)

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @language-drill/ai test -- free-writing-generation-prompts`
Expected: FAIL — `CONCRETE_FREE_WRITING_ANGLES` / `FULL_FREE_WRITING_ANGLES` don't exist, `freeWritingAngleForOrdinal` takes one arg, A1/A2 bands undefined.

- [ ] **Step 3: Bump the version constant**

In `packages/ai/src/free-writing-generation-prompts.ts` line 29:

```ts
export const FREE_WRITING_GENERATION_PROMPT_VERSION = "free-writing-generate@2026-06-16";
```

→

```ts
export const FREE_WRITING_GENERATION_PROMPT_VERSION = "free-writing-generate@2026-06-17";
```

- [ ] **Step 4: Add A1/A2 word-bands and update the stale error message**

In `packages/ai/src/free-writing-generation-prompts.ts`, replace lines 40-63 (the doc comment, the `FREE_WRITING_LENGTH_BY_CEFR` object, and `freeWritingLengthFor`):

```ts
/**
 * CEFR → word band + suggested minutes for a free-writing prompt. Single source
 * for both the prompt text and the band injected into the stored
 * FreeWritingContent. Only B1/B2 are in scope this milestone; an out-of-scope
 * level throws in `freeWritingLengthFor`.
 */
export const FREE_WRITING_LENGTH_BY_CEFR: Readonly<
  Partial<Record<CurriculumCefrLevel, { minWords: number; maxWords: number; suggestedMinutes: number }>>
> = Object.freeze({
  B1: { minWords: 80, maxWords: 120, suggestedMinutes: 15 },
  B2: { minWords: 150, maxWords: 200, suggestedMinutes: 25 },
});

export function freeWritingLengthFor(
  cefrLevel: string,
): { minWords: number; maxWords: number; suggestedMinutes: number } {
  const band = FREE_WRITING_LENGTH_BY_CEFR[cefrLevel as CurriculumCefrLevel];
  if (!band) {
    throw new Error(
      `free-writing: no length band configured for CEFR level ${JSON.stringify(cefrLevel)} (B1/B2 only this milestone)`,
    );
  }
  return band;
}
```

with:

```ts
/**
 * CEFR → word band + suggested minutes for a free-writing prompt. Single source
 * for both the prompt text and the band injected into the stored
 * FreeWritingContent. A1/A2 (added 2026-06-17 for TR) keep the band short — a
 * low-level learner writes a few simple sentences. An out-of-scope level throws
 * in `freeWritingLengthFor`.
 */
export const FREE_WRITING_LENGTH_BY_CEFR: Readonly<
  Partial<Record<CurriculumCefrLevel, { minWords: number; maxWords: number; suggestedMinutes: number }>>
> = Object.freeze({
  A1: { minWords: 30, maxWords: 60, suggestedMinutes: 10 },
  A2: { minWords: 60, maxWords: 100, suggestedMinutes: 15 },
  B1: { minWords: 80, maxWords: 120, suggestedMinutes: 15 },
  B2: { minWords: 150, maxWords: 200, suggestedMinutes: 25 },
});

export function freeWritingLengthFor(
  cefrLevel: string,
): { minWords: number; maxWords: number; suggestedMinutes: number } {
  const band = FREE_WRITING_LENGTH_BY_CEFR[cefrLevel as CurriculumCefrLevel];
  if (!band) {
    throw new Error(
      `free-writing: no length band configured for CEFR level ${JSON.stringify(cefrLevel)} (A1/A2/B1/B2 supported)`,
    );
  }
  return band;
}
```

- [ ] **Step 5: Replace the single angle list with two level-aware pools**

In `packages/ai/src/free-writing-generation-prompts.ts`, replace lines 91-113 (the `FREE_WRITING_ANGLES` doc comment, the array, and `freeWritingAngleForOrdinal`):

```ts
/**
 * Register-neutral angle rotation. Each draft in a batch is generated in
 * parallel (the generator pool can't see sibling drafts), and the dedup surface
 * is the title — so without per-draft steering all N drafts converge on the
 * topic name and collide. Rotating a distinct sub-focus by ordinal forces the
 * titles apart on a fresh cell, the same way `sentence_construction` rotates its
 * prompt modes. Lives in the per-draft USER prompt (uncached), so it never
 * perturbs the cached system-prompt prefix.
 */
export const FREE_WRITING_ANGLES: readonly string[] = [
  "the personal, individual side of the topic",
  "the social or collective side of the topic",
  "a concrete everyday scenario that brings the topic to life",
  "weighing two clearly opposing positions",
  "the causes or reasons behind it",
  "the consequences or effects",
  "a direct comparison between two options or situations",
  "a recommendation, a solution, or advice",
];

export function freeWritingAngleForOrdinal(ordinal: number): string {
  return FREE_WRITING_ANGLES[ordinal % FREE_WRITING_ANGLES.length];
}
```

with:

```ts
/**
 * Register-neutral angle rotation. Each draft in a batch is generated in
 * parallel (the generator pool can't see sibling drafts), and the dedup surface
 * is the title — so without per-draft steering all N drafts converge on the
 * topic name and collide. Rotating a distinct sub-focus by ordinal forces the
 * titles apart on a fresh cell, the same way `sentence_construction` rotates its
 * prompt modes. Lives in the per-draft USER prompt (uncached), so it never
 * perturbs the cached system-prompt prefix.
 *
 * Two pools, picked by level (2026-06-17): the analytical angles (opposing
 * positions, causes/consequences, recommendation) are appropriate at B1/B2 but
 * too hard for A1/A2, where a learner narrates concrete, everyday content. A1/A2
 * draw only from the concrete pool; B1/B2 keep the original full pool unchanged
 * (no behavior change for existing ES cells).
 */
export const CONCRETE_FREE_WRITING_ANGLES: readonly string[] = [
  "the personal, individual side of the topic",
  "a concrete everyday scenario that brings the topic to life",
  "a specific memory or a single moment tied to the topic",
  "a typical day or routine connected to the topic",
  "describing a specific place or person central to the topic",
  "how things have changed over time around the topic",
];

export const FULL_FREE_WRITING_ANGLES: readonly string[] = [
  "the personal, individual side of the topic",
  "the social or collective side of the topic",
  "a concrete everyday scenario that brings the topic to life",
  "weighing two clearly opposing positions",
  "the causes or reasons behind it",
  "the consequences or effects",
  "a direct comparison between two options or situations",
  "a recommendation, a solution, or advice",
];

export function freeWritingAngleForOrdinal(ordinal: number, cefrLevel: string): string {
  const pool =
    cefrLevel === "A1" || cefrLevel === "A2"
      ? CONCRETE_FREE_WRITING_ANGLES
      : FULL_FREE_WRITING_ANGLES;
  return pool[ordinal % pool.length];
}
```

- [ ] **Step 6: Read the level from `inputs` and sharpen the user prompt**

In `packages/ai/src/free-writing-generation-prompts.ts`, replace lines 200-212 (`buildFreeWritingGenerationUserPrompt`):

```ts
// `inputs` is unused in the body but kept for signature parity with the other
// per-draft user-prompt builders (cloze/translation/dictation), so `generateOneDraft`
// can call them uniformly; the topic framing lives in the cached system prompt.
export function buildFreeWritingGenerationUserPrompt(
  inputs: GenerationPromptInputs,
  ordinal: number,
): string {
  void inputs;
  const angle = freeWritingAngleForOrdinal(ordinal);
  return `Produce free-writing prompt #${ordinal + 1}.

For THIS prompt, build the task around: ${angle}. Give it a specific, distinctive title that reflects this angle — do NOT reuse the bare topic name as the title. Vary the exact task and the required-elements checklist from prompt to prompt so a batch on this topic is diverse. Use the submit_free_writing_exercise tool.`;
}
```

with:

```ts
// The per-draft angle is level-aware (A1/A2 get concrete angles only), so the
// builder reads `inputs.cefrLevel`. Signature parity with the other per-draft
// user-prompt builders (cloze/translation/dictation) is preserved so
// `generateOneDraft` can call them uniformly; the topic framing lives in the
// cached system prompt.
export function buildFreeWritingGenerationUserPrompt(
  inputs: GenerationPromptInputs,
  ordinal: number,
): string {
  const angle = freeWritingAngleForOrdinal(ordinal, inputs.cefrLevel);
  return `Produce free-writing prompt #${ordinal + 1}.

For THIS prompt, build the task around: ${angle}. Commit to ONE concrete sub-facet of the topic — not a near-paraphrase of the topic name. Give it a specific, distinctive title that reflects this angle — do NOT reuse the bare topic name as the title. Vary the exact task and the required-elements checklist from prompt to prompt so a batch on this topic is diverse. Use the submit_free_writing_exercise tool.`;
}
```

- [ ] **Step 7: Run the tests, verify they pass**

Run: `pnpm --filter @language-drill/ai test -- free-writing-generation-prompts`
Expected: PASS (all cases, including the two new angle-pool tests).

- [ ] **Step 8: Commit**

```bash
git add packages/ai/src/free-writing-generation-prompts.ts packages/ai/src/free-writing-generation-prompts.test.ts
git commit -m "feat(free-writing): level-aware angle pools + A1/A2 word-bands + sharper user prompt"
```

---

## Task 3: Add 6 TR A1/A2 free-writing cells + bump ES & TR curriculum versions

**Files:**
- Modify: `packages/db/src/curriculum/tr.ts` (line 48 version; insert entries before the array close at line 1585)
- Modify: `packages/db/src/curriculum/es.ts:42` (version)
- Test: `packages/db/src/curriculum/curriculum.test.ts:343-353` (TR counts) + new TR free-writing block after line 365

- [ ] **Step 1: Update the tests first**

In `packages/db/src/curriculum/curriculum.test.ts`, replace the TR counts test body (lines 343-353):

```ts
  it('Turkish is at full Yedi İklim A1 + A2 parity (B1/B2 disabled), has 10 themed vocab umbrellas and 2 dictation umbrellas', () => {
    const { grammar, vocab, dictation } = countsFor(trCurriculum);
    expect(grammar.A1).toBeGreaterThanOrEqual(26);
    expect(grammar.A2).toBeGreaterThanOrEqual(14);
    expect(grammar.B1).toBe(0);
    expect(grammar.B2).toBe(0);
    // 5 themed A1 + 5 themed A2 umbrellas (2026-06-07 everyday-vocab split).
    expect(vocab).toBe(10);
    // tr-a1-dictation + tr-a2-dictation (Phase 2 dictation generation pipeline).
    expect(dictation).toBe(2);
  });
```

with:

```ts
  it('Turkish is at full Yedi İklim A1 + A2 parity (B1/B2 disabled), has 10 themed vocab umbrellas, 2 dictation umbrellas, and 6 free-writing umbrellas', () => {
    const { grammar, vocab, dictation, freeWriting } = countsFor(trCurriculum);
    expect(grammar.A1).toBeGreaterThanOrEqual(26);
    expect(grammar.A2).toBeGreaterThanOrEqual(14);
    expect(grammar.B1).toBe(0);
    expect(grammar.B2).toBe(0);
    // 5 themed A1 + 5 themed A2 umbrellas (2026-06-07 everyday-vocab split).
    expect(vocab).toBe(10);
    // tr-a1-dictation + tr-a2-dictation (Phase 2 dictation generation pipeline).
    expect(dictation).toBe(2);
    // 3 A1 + 3 A2 free-writing topic umbrellas (2026-06-17).
    expect(freeWriting).toBe(6);
  });
```

Then add a new test inside the existing `describe('free-writing topic umbrellas', ...)` block, after the ES test closes (after line 364, before the block's closing `});` on line 365):

```ts
  it("has 3 free-writing topic umbrellas per TR A1 and A2", () => {
    const fw = trCurriculum.filter((e) => e.kind === "free-writing");
    expect(fw.filter((e) => e.cefrLevel === "A1")).toHaveLength(3);
    expect(fw.filter((e) => e.cefrLevel === "A2")).toHaveLength(3);
    for (const e of fw) {
      expect(e.freeWriting?.register).toBeDefined();
    }
  });
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @language-drill/db test -- curriculum`
Expected: FAIL — `freeWriting` is 0 for TR (no entries yet).

> If the db package serves a stale `dist`, run `pnpm --filter @language-drill/db build` first (single-package vitest can resolve against `db/dist`).

- [ ] **Step 3: Add the 6 TR free-writing entries**

In `packages/db/src/curriculum/tr.ts`, insert the following **immediately before the closing `];` on line 1585** (after the `tr-a2-dictation` umbrella). `TR`, `A1`, `A2` are the file-local aliases already defined on lines 14-15:

```ts
  // Free-writing topic umbrellas — kind: 'free-writing' (Phase 2 generation).
  // Added 2026-06-17. Concrete, level-appropriate topics; the per-draft angle
  // rotation uses the A1/A2 concrete pool (free-writing-generation-prompts.ts).
  {
    key: 'tr-a1-fw-my-day',
    kind: 'free-writing',
    name: 'Bir günüm',
    description:
      'An informal prompt to describe a typical day using simple present-tense routine verbs and times of day.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Asks what they do in the morning, afternoon, and evening.',
      'Requires at least one time expression (e.g. saat yedide).',
    ],
    examplesNegative: ['*Write an essay about the meaning of daily life.'],
    commonErrors: [
      'Listing verbs with no times or sequence.',
      'Drifting into past-tense storytelling instead of a typical day.',
    ],
    freeWriting: { register: 'informal' },
  },
  {
    key: 'tr-a1-fw-my-family',
    kind: 'free-writing',
    name: 'Ailem',
    description:
      'An informal prompt to introduce family members, who they are, and one simple detail about each.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Asks for at least two family members and their jobs or ages.',
      'Requires one sentence about something a family member likes.',
    ],
    examplesNegative: ['*Discuss the role of family in society.'],
    commonErrors: [
      'Naming people with no detail at all.',
      'Possessive-suffix errors (annem vs. *anne benim).',
    ],
    freeWriting: { register: 'informal' },
  },
  {
    key: 'tr-a1-fw-my-weekend',
    kind: 'free-writing',
    name: 'Hafta sonum',
    description:
      'An informal prompt to describe what the learner usually does on the weekend, with simple activities and places.',
    cefrLevel: A1,
    language: TR,
    examplesPositive: [
      'Asks for two or three weekend activities.',
      'Requires saying who they do one activity with.',
    ],
    examplesNegative: ['*Compare weekends and weekdays in detail.'],
    commonErrors: [
      'A single activity with no places or people.',
      'Mixing in complex past-tense narration.',
    ],
    freeWriting: { register: 'informal' },
  },
  {
    key: 'tr-a2-fw-a-trip',
    kind: 'free-writing',
    name: 'Unutamadığım bir gezi',
    description:
      'A neutral prompt to narrate a memorable trip: where, when, and one thing that happened, using past tense.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Asks where and when the trip was, plus one memorable event.',
      'Requires a closing sentence on how they felt about it.',
    ],
    examplesNegative: ['*Describe travelling in general.'],
    commonErrors: [
      'Generic travel description with no specific trip.',
      'Staying in present tense instead of narrating the past.',
    ],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'tr-a2-fw-free-time',
    kind: 'free-writing',
    name: 'Boş zamanlarım',
    description:
      'A neutral prompt to describe free-time activities and hobbies, how often, and why the learner enjoys them.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Asks for two hobbies and how often they do them.',
      'Requires one reason why they like one of the hobbies.',
    ],
    examplesNegative: ['*List every hobby that exists.'],
    commonErrors: [
      'Frequency adverbs missing or misplaced.',
      'Listing hobbies with no reason or detail.',
    ],
    freeWriting: { register: 'neutral' },
  },
  {
    key: 'tr-a2-fw-my-city',
    kind: 'free-writing',
    name: 'Yaşadığım şehir',
    description:
      'A neutral prompt to describe the city the learner lives in: what it is like and one thing they like or would change.',
    cefrLevel: A2,
    language: TR,
    examplesPositive: [
      'Asks what the city is like and names one place in it.',
      'Requires one thing they like and one they would change.',
    ],
    examplesNegative: ['*Write a tourist guide to a famous city.'],
    commonErrors: [
      'Listing places with no description.',
      'Locative/ablative case errors with place names.',
    ],
    freeWriting: { register: 'neutral' },
  },
```

- [ ] **Step 4: Bump the TR curriculum version**

In `packages/db/src/curriculum/tr.ts` line 48:

```ts
export const CURRICULUM_VERSION_TR = '2026-06-16b';
```

→

```ts
export const CURRICULUM_VERSION_TR = '2026-06-17';
```

Also add a changelog line to the header comment block (after the `2026-06-16b:` line, ~line 45):

```ts
 * 2026-06-17: added 3 A1 + 3 A2 free-writing topic umbrellas (kind 'free-writing');
 * bump enumerates the new free-writing cells.
```

- [ ] **Step 5: Bump the ES curriculum version**

In `packages/db/src/curriculum/es.ts` line 42:

```ts
export const CURRICULUM_VERSION_ES = '2026-06-15b';
```

→

```ts
export const CURRICULUM_VERSION_ES = '2026-06-17';
```

(Clears the saturated-dedup suppression on `es-b1-fw-my-town`, `es-b2-fw-remote-work`, `es-b1-fw-daily-routine`, `es-b1-fw-ideal-weekend` so they re-evaluate under target=5 + the boosted prompt. If `es.ts` has a header changelog comment, add a `2026-06-17:` line noting this.)

- [ ] **Step 6: Run the tests, verify they pass**

Run: `pnpm --filter @language-drill/db test -- curriculum`
Expected: PASS — TR free-writing count is 6 (3 A1 / 3 A2), version-format invariants hold (`2026-06-17` matches `YYYY-MM-DD[a-z]?`).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/curriculum/tr.ts packages/db/src/curriculum/es.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "feat(curriculum): add TR A1/A2 free-writing cells; bump ES+TR curriculum versions"
```

---

## Task 4: Full pre-push gate

**Files:** none (verification only)

- [ ] **Step 1: Build (so single-package dist caches are fresh) + lint + typecheck**

Run: `pnpm build && pnpm lint && pnpm typecheck`
Expected: all pass, zero errors.

- [ ] **Step 2: Full test suite, single-concurrency (avoids the known infra parallel flake)**

Run: `pnpm turbo run test --concurrency=1`
Expected: all packages green.

> If `infra/lambda` shows phantom failures from stale compiled tests, `rm -rf infra/lambda/dist` and re-run.

- [ ] **Step 3: (Optional, recommended) eval:gen A/B before relying on the scheduler**

The boost is code-only, so `repo` reflects the new behavior after Task 2. To A/B against the pre-boost behavior, compare a `git stash`-ed baseline or a `file:` snapshot of the old prompt source. Build a small dataset with a TR A1 cell and the narrow `es-b1-fw-my-town` cell:

```bash
pnpm --filter @language-drill/ai eval:gen \
  --baseline file:./eval-runs/fw-baseline.txt --candidate repo \
  --dataset-file ./eval-runs/fw-cells.json \
  --drafts-per-cell 8 --max-cost-usd 2
```

Expected: candidate's distinct-title yield (approval rate) ≥ baseline on the narrow cell; A1 prompts use concrete (non-argumentative) angles.

- [ ] **Step 4: Note on rollout (no action)**

No Langfuse `push-prompts` is needed (system-prompt body unchanged). After merge, the scheduler's ~04:00 UTC run converges over ~2 days; confirm the 4 ES cells and 6 TR cells in the next run via the Neon prod branch (`twilight-smoke-01114337` / `br-green-waterfall-ancrvpr5`).

---

## Self-review notes

- **Spec coverage:** §1 target→Task 1; §2 boost (angles + user prompt + version)→Task 2; §3 version bumps→Task 3 steps 4-5; §4 word-bands→Task 2 step 4, TR cells→Task 3 step 3; tests→each task; verification→Task 4. All covered.
- **Type consistency:** `freeWritingAngleForOrdinal(ordinal, cefrLevel)` signature is consistent across the implementation (Task 2 step 5) and its sole caller `buildFreeWritingGenerationUserPrompt` (Task 2 step 6); the test uses the same two-arg form. New exports `CONCRETE_FREE_WRITING_ANGLES` / `FULL_FREE_WRITING_ANGLES` are referenced consistently in code and test.
- **No placeholders:** every code step shows full before/after content.
