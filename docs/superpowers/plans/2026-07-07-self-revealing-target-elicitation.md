# Self-Revealing-Target Elicitation Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make number/ordinal and vocab cells generatable: digit-form elicitation that the validator accepts as intended (not `contextSpoilsAnswer`), plus per-draft target-value rotation so pools stop collapsing onto one exemplar ("üçüncü kat" ×18).

**Architecture:** A new opt-in `GrammarPoint` flag (`selfRevealingElicitation: 'digit-form'` + curated `elicitationSeedValues` pool) flows from the curriculum through `spec.grammarPoint` into (a) the per-draft generation user prompt (strict digit-form directive with a pinned rotating target value — mirrors the conjugation `predicate-nominal` seed pattern) and (b) a per-cell validator scoring note exempting digit cues from the spoilage veto (mirrors the existing `clozeCellScoringNote` pattern). vocab_recall gets a kind-gated validator note (no flag needed). Everything ships with a **code deploy** — neither Langfuse system template changes.

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo), Vitest, Drizzle/Neon, Anthropic API.

**Spec:** `docs/findings/2026-07-07-self-revealing-target-elicitation.md`

## Global Constraints

- Worktree lives under `.claude/worktrees/<branch-slug>/` — never repo root. Copy `/.env` and `apps/web/.env` from the main checkout into the worktree (shoot/e2e/dev need them).
- `packages/ai` source must NOT import `@language-drill/db` — grammar-point data rides on `spec.grammarPoint` (type from `@language-drill/shared`).
- After editing `packages/db` or `packages/shared` source, run `pnpm build` (turbo) before single-package vitest runs — stale `dist/` gives phantom results. Before the full suite, `rm -rf infra/lambda/dist`.
- Pre-push gate: `pnpm lint && pnpm typecheck && pnpm test` — zero failures.
- Version bumps in this plan use `2026-07-08`; if committing on a different date, use that date instead (but `CURRICULUM_VERSION_ES` must NOT be `2026-07-07` — that value is already stamped on today's prod jobs and would not clear suppression).
- Prompt-version constants: bump `GENERATION_PROMPT_VERSION` and `VALIDATION_PROMPT_VERSION` in the same commits as their prompt-file edits (CLAUDE.md rule). The Langfuse-registered `*_TEMPLATE` strings are NOT edited in this plan, so `push-prompts --dry-run` must report in-sync afterwards (Task 7 verifies).
- Commit with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Assert the current branch before every commit (`git branch --show-current`) — this workspace has flipped to `main` silently before.

---

### Task 1: `GrammarPoint` flag + curriculum invariant 9h

**Files:**
- Modify: `packages/shared/src/curriculum-types.ts` (after `conjugationSeedWords`, ~line 135)
- Modify: `packages/db/src/curriculum/index.ts` (after invariant 9g, ~line 258)
- Test: `packages/db/src/curriculum/curriculum.test.ts` (alongside the 9g tests, ~line 252)

**Interfaces:**
- Produces: `GrammarPoint.selfRevealingElicitation?: 'digit-form'` and `GrammarPoint.elicitationSeedValues?: readonly string[]` — read by Tasks 2–5 via `cell.grammarPoint` / `spec.grammarPoint` / `inputs.grammarPoint`.

- [ ] **Step 1: Write the failing invariant tests**

Add to the invariant `describe` block in `packages/db/src/curriculum/curriculum.test.ts`, mirroring the two 9g tests directly above (reuse the same synthetic-entry shape and `assertCurriculumInvariants` import):

```ts
  it('throws when a self-revealing point has no elicitationSeedValues pool', () => {
    expect(() =>
      assertCurriculumInvariants([
        {
          key: 'tr-a1-synthetic-numbers',
          kind: 'grammar',
          name: 'Synthetic numbers',
          description: 'Synthetic entry for self-revealing invariant testing.',
          cefrLevel: 'A1',
          language: Language.TR,
          examplesPositive: ['a', 'b'],
          examplesNegative: ['*c'],
          commonErrors: ['e'],
          selfRevealingElicitation: 'digit-form',
          // elicitationSeedValues intentionally omitted.
        },
      ]),
    ).toThrow(/elicitationSeedValues/);
  });

  it('throws when elicitationSeedValues is set without selfRevealingElicitation', () => {
    expect(() =>
      assertCurriculumInvariants([
        {
          key: 'tr-a1-synthetic-numbers',
          kind: 'grammar',
          name: 'Synthetic numbers',
          description: 'Synthetic entry for self-revealing invariant testing.',
          cefrLevel: 'A1',
          language: Language.TR,
          examplesPositive: ['a', 'b'],
          examplesNegative: ['*c'],
          commonErrors: ['e'],
          elicitationSeedValues: ['birinci'],
        },
      ]),
    ).toThrow(/selfRevealingElicitation/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/db test -- curriculum.test.ts`
Expected: the two new tests FAIL (TypeScript error on the unknown property, or no throw).

- [ ] **Step 3: Add the fields to `GrammarPoint`**

In `packages/shared/src/curriculum-types.ts`, immediately after the `conjugationSeedWords` field (~line 135), matching the surrounding doc-comment style:

```ts
  /**
   * Marks a point whose target forms are semantically self-revealing: any
   * natural elicitation must convey the target's meaning (numbers, ordinals),
   * so the validator's default reading of "the context conveys the answer"
   * rejects every draft (es-a1-numbers-ordinals cloze approved 1/20 on
   * 2026-07-07). 'digit-form' sanctions presenting the target as digits or
   * numerals ("3.º", "200", "123") while the learner produces the written
   * form — the actually-tested skill (agreement/apocope/harmony) is not
   * revealed by digits. Generation injects a strict per-draft directive;
   * validation appends a scoring note exempting the digit cue from
   * contextSpoilsAnswer. See
   * docs/findings/2026-07-07-self-revealing-target-elicitation.md.
   */
  selfRevealingElicitation?: 'digit-form';
  /**
   * Curated rotation pool of target written forms for a self-revealing point
   * (e.g. 'tercero', 'doscientas', 'üçüncü', 'yüz yirmi üç'). Drives per-draft
   * seed rotation exactly like conjugationSeedWords drives predicate-nominal
   * conjugation cells — the identity-diversity axis that stops the pool
   * collapsing onto one exemplar ("üçüncü kat" ×18/20 approved translations).
   * Size it to comfortably exceed the cell target (the pool is bounded; once
   * the live pool covers it, pickSeeds returns nulls and the cell stops).
   * REQUIRED non-empty iff selfRevealingElicitation is set (invariant 9h).
   */
  elicitationSeedValues?: readonly string[];
```

- [ ] **Step 4: Add invariant 9h**

In `packages/db/src/curriculum/index.ts`, inside `assertCurriculumInvariants`, immediately after the 9g block (~line 258):

```ts
    // 9h. elicitationSeedValues (the curated target-form pool) is present iff
    //     the point is self-revealing. A self-revealing point with no pool
    //     would seed nothing (empty band); a pool without the flag is dead
    //     config.
    if (
      entry.selfRevealingElicitation &&
      (!entry.elicitationSeedValues || entry.elicitationSeedValues.length === 0)
    ) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' has selfRevealingElicitation but no elicitationSeedValues`,
      );
    }
    if (
      entry.elicitationSeedValues &&
      entry.elicitationSeedValues.length > 0 &&
      !entry.selfRevealingElicitation
    ) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' has elicitationSeedValues but no selfRevealingElicitation`,
      );
    }
```

- [ ] **Step 5: Build + run tests to verify they pass**

Run: `pnpm build && pnpm --filter @language-drill/db test -- curriculum.test.ts`
Expected: PASS (all curriculum tests, including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/curriculum-types.ts packages/db/src/curriculum/index.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "feat(curriculum): selfRevealingElicitation flag + elicitationSeedValues pool (invariant 9h)"
```

---

### Task 2: Flag the ES + TR numbers-ordinals points, bump curriculum versions

**Files:**
- Modify: `packages/db/src/curriculum/es.ts` (point at ~line 296-310; version constant at line 59)
- Modify: `packages/db/src/curriculum/tr.ts` (point at ~line 733-761; version constant at line 131)
- Test: `packages/db/src/curriculum/curriculum.test.ts` (existing suite re-validates all entries via invariants)

**Interfaces:**
- Consumes: Task 1's fields.
- Produces: flagged `es-a1-numbers-ordinals` / `tr-a1-numbers-ordinals` entries; `CURRICULUM_VERSION_ES = '2026-07-08'`, `CURRICULUM_VERSION_TR = '2026-07-08'`.

- [ ] **Step 1: Flag `es-a1-numbers-ordinals`**

In `packages/db/src/curriculum/es.ts`, append to the `es-a1-numbers-ordinals` entry after `commonErrors` (values chosen to exercise the point's documented error modes — gendered `-cientos`, apocope `primer/tercer`, `veintiún`; ≥26 values > cloze/translation target 20):

```ts
    selfRevealingElicitation: 'digit-form',
    elicitationSeedValues: [
      'primer', 'primera', 'segundo', 'segunda', 'tercer', 'tercera',
      'cuarto', 'cuarta', 'quinto', 'sexta', 'séptimo', 'octava',
      'noveno', 'décima',
      'veintiún', 'veintiuna', 'treinta y un', 'cuarenta y una',
      'doscientos', 'doscientas', 'trescientas', 'cuatrocientos',
      'quinientas', 'seiscientos', 'setecientas', 'ochocientos',
      'novecientas', 'ciento un',
    ],
```

- [ ] **Step 2: Bump `CURRICULUM_VERSION_ES`**

Line 59 of `es.ts` — follow the file's existing bump-comment convention (see the comment block above the constant):

```ts
// 2026-07-08: digit-form elicitation for es-a1-numbers-ordinals
// (selfRevealingElicitation + curated value pool). Bump re-enqueues every
// below-target ES cell and clears low-yield suppression on the cells starved
// by the 2026-07-07 run: es-a1-numbers-ordinals cloze (pool 1), es-a1-fw-a-day
// (2), es-a1-vocab-family-people (2), plus the thin A1 vocab/cloze cells.
export const CURRICULUM_VERSION_ES = '2026-07-08';
```

- [ ] **Step 3: Flag `tr-a1-numbers-ordinals`**

In `packages/db/src/curriculum/tr.ts`, append to the entry after `prerequisiteKeys` (values exercise harmony `-(I)ncI`, vowel-drop `ikinci/altıncı`, softening `dördüncü`, compound cardinals without `ve`; 24 values > target 20):

```ts
    selfRevealingElicitation: 'digit-form',
    elicitationSeedValues: [
      'birinci', 'ikinci', 'üçüncü', 'dördüncü', 'beşinci', 'altıncı',
      'yedinci', 'sekizinci', 'dokuzuncu', 'onuncu', 'on birinci',
      'on ikinci', 'yirminci', 'otuzuncu', 'kırkıncı', 'ellinci',
      'altmışıncı', 'yüzüncü',
      'yüz yirmi üç', 'iki yüz elli', 'üç yüz kırk beş', 'beş yüz on',
      'bin dokuz yüz', 'iki bin yirmi altı',
    ],
```

- [ ] **Step 4: Bump `CURRICULUM_VERSION_TR`**

Line 131 of `tr.ts`, same comment convention:

```ts
// 2026-07-08: digit-form elicitation for tr-a1-numbers-ordinals
// (selfRevealingElicitation + curated value pool) after the identity-space
// collapse (18/20 approved translations contained 'üçüncü'). Bump clears
// suppression so below-target TR cells re-run; the collapsed numbers-ordinals
// rows must ALSO be demoted (pnpm demote:pool) or the cells stay at target
// and never regenerate.
export const CURRICULUM_VERSION_TR = '2026-07-08';
```

- [ ] **Step 5: Build + run curriculum tests**

Run: `pnpm build && pnpm --filter @language-drill/db test -- curriculum.test.ts`
Expected: PASS — the invariants now validate the two real flagged entries.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/curriculum/es.ts packages/db/src/curriculum/tr.ts
git commit -m "feat(curriculum): digit-form elicitation for ES/TR numbers-ordinals + version bumps"
```

---

### Task 3: Seed rotation over `elicitationSeedValues`

**Files:**
- Modify: `packages/db/src/generation/run-one-cell.ts` (`seedKindFor` ~line 462-484, `buildSeedWords` ~line 492-545)
- Test: `packages/db/src/generation/run-one-cell.test.ts` (`describe('seedKindFor')` at ~line 293; adjacent `buildSeedWords` tests)

**Interfaces:**
- Consumes: `cell.grammarPoint.selfRevealingElicitation` / `.elicitationSeedValues` (Task 1); existing `pickSeeds({ band, batchSeed, count, exclude })`.
- Produces: `seedKindFor` return union gains `'elicitation-values'`; `buildSeedWords` emits rotating target forms into `spec.seedWords` for flagged cloze/translation cells (consumed by Task 4 via `buildGenerationUserPrompt`'s `seedWord` arg — no call-site change needed).

- [ ] **Step 1: Write the failing tests**

In `run-one-cell.test.ts`, extend the `seedKindFor` describe (use the existing `cellOf` helper; add a variant that overrides the grammar point — copy how the conjugation tests build cells with `conjugationSeedKind`):

```ts
  it('returns elicitation-values for a flagged cloze cell', () => {
    const cell = cellOf(ExerciseType.CLOZE);
    const flagged = {
      ...cell,
      grammarPoint: {
        ...cell.grammarPoint,
        selfRevealingElicitation: 'digit-form' as const,
        elicitationSeedValues: ['birinci', 'ikinci', 'üçüncü'],
      },
    };
    expect(seedKindFor(flagged)).toBe('elicitation-values');
  });

  it('returns elicitation-values for a flagged translation cell', () => {
    const cell = cellOf(ExerciseType.TRANSLATION);
    const flagged = {
      ...cell,
      grammarPoint: {
        ...cell.grammarPoint,
        selfRevealingElicitation: 'digit-form' as const,
        elicitationSeedValues: ['birinci'],
      },
    };
    expect(seedKindFor(flagged)).toBe('elicitation-values');
  });

  it('still returns frequency for unflagged cloze', () => {
    expect(seedKindFor(cellOf(ExerciseType.CLOZE))).toBe('frequency');
  });
```

And a `buildSeedWords` test (no DB hit — the curated pool needs no band loader; pass whatever fake `db` the adjacent predicate-nominal test passes):

```ts
  it('seeds a flagged cell from elicitationSeedValues without touching the db', async () => {
    const cell = cellOf(ExerciseType.CLOZE);
    const flagged = {
      ...cell,
      grammarPoint: {
        ...cell.grammarPoint,
        selfRevealingElicitation: 'digit-form' as const,
        elicitationSeedValues: ['birinci', 'ikinci', 'üçüncü', 'dördüncü'],
      },
    };
    const seeds = await buildSeedWords(fakeDb, flagged, 3, 'seed-a', new Set());
    expect(seeds).toHaveLength(3);
    for (const s of seeds ?? []) {
      expect(['birinci', 'ikinci', 'üçüncü', 'dördüncü']).toContain(s);
    }
    expect(new Set(seeds).size).toBe(3); // distinct values — the rotation axis
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/db test -- run-one-cell.test.ts`
Expected: new tests FAIL (`seedKindFor` returns `'frequency'`; `buildSeedWords` hits the frequency band).

- [ ] **Step 3: Implement**

In `seedKindFor` (run-one-cell.ts:462), add the flag check ABOVE the frequency branch and extend the return union:

```ts
export function seedKindFor(
  cell: Cell,
): 'frequency' | 'verb' | 'noun' | 'predicate-nominal' | 'elicitation-values' | null {
  if (
    (cell.exerciseType === ExerciseType.CLOZE ||
      cell.exerciseType === ExerciseType.TRANSLATION) &&
    cell.grammarPoint.selfRevealingElicitation
  ) {
    // Self-revealing point (numbers/ordinals): rotate over the curated
    // target-form pool instead of the frequency band — the target form IS the
    // diversity axis. Frequency seeding let the model collapse onto one value
    // ('üçüncü' in 18/20 approved TR translations).
    return 'elicitation-values';
  }
  // ... existing branches unchanged
```

In `buildSeedWords`, add a branch after the `'noun'` branch (~line 521), mirroring `'predicate-nominal'`:

```ts
  if (kind === 'elicitation-values') {
    // Self-revealing target: seed each ordinal with a distinct target written
    // form from the curated curriculum pool (mirrors the predicate-nominal
    // curated pool). Bounded: once the live pool covers it, pickSeeds returns
    // nulls and the cell stops — pools are sized in the curriculum to exceed
    // the cell target.
    const band = cell.grammarPoint.elicitationSeedValues ?? [];
    return pickSeeds({ band, batchSeed, count, exclude: priorSeeds });
  }
```

- [ ] **Step 4: Build + run tests to verify they pass**

Run: `pnpm build && pnpm --filter @language-drill/db test -- run-one-cell.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/generation/run-one-cell.ts packages/db/src/generation/run-one-cell.test.ts
git commit -m "feat(generation): seed flagged cells from the curated elicitationSeedValues pool"
```

---

### Task 4: Digit-form directive in the generation user prompt

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts` (`buildGenerationUserPrompt` ~line 579-634; `GENERATION_PROMPT_VERSION` line 187)
- Test: `packages/ai/src/generation-prompts.test.ts`

**Interfaces:**
- Consumes: `inputs.grammarPoint.selfRevealingElicitation` (Task 1); `seedWord` per ordinal (Task 3 populates it in the live path; the eval:gen/CLI path passes `null`).
- Produces: per-draft `digitFormBlock` in the user prompt. The system template (`GENERATION_SYSTEM_PROMPT_TEMPLATE`) is NOT touched — cache prefix stays byte-identical, no push-prompts.

- [ ] **Step 1: Write the failing tests**

In `generation-prompts.test.ts` (reuse the file's existing `GenerationPromptInputs` fixture; spread-override `grammarPoint`):

```ts
describe('buildGenerationUserPrompt — self-revealing digit-form directive', () => {
  const flaggedInputs = {
    ...baseInputs, // the file's existing cloze fixture
    grammarPoint: {
      ...baseInputs.grammarPoint,
      selfRevealingElicitation: 'digit-form' as const,
      elicitationSeedValues: ['tercero', 'doscientas'],
    },
  };

  it('pins the seeded target value and demands digit-only presentation (cloze)', () => {
    const prompt = buildGenerationUserPrompt(flaggedInputs, 0, null, 'tercero');
    expect(prompt).toContain('The target form is "tercero"');
    expect(prompt).toContain('digits');
    // The generic loose-seed block must NOT also appear:
    expect(prompt).not.toContain('Build this exercise around the word');
  });

  it('emits a generic digit-form directive when unseeded (CLI/eval path)', () => {
    const prompt = buildGenerationUserPrompt(flaggedInputs, 0, null, null);
    expect(prompt).toContain('digits');
    expect(prompt).toContain('written form');
  });

  it('translation variant demands digits in the SOURCE text', () => {
    const trInputs = { ...flaggedInputs, exerciseType: ExerciseType.TRANSLATION };
    const prompt = buildGenerationUserPrompt(trInputs, 0, null, 'doscientas');
    expect(prompt).toContain('The target form is "doscientas"');
    expect(prompt).toContain('source');
  });

  it('unflagged cloze is byte-identical to before (loose seed block)', () => {
    const prompt = buildGenerationUserPrompt(baseInputs, 0, null, 'mesa');
    expect(prompt).toContain('Build this exercise around the word "mesa"');
    expect(prompt).not.toContain('target form');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts.test.ts`
Expected: new tests FAIL.

- [ ] **Step 3: Implement**

In `buildGenerationUserPrompt` (generation-prompts.ts:579), compute a `digitFormBlock` and suppress the ordinary `seedBlock` when it fires. Insert after the `toolName`/`domain` lines and change `seedBlock` gating:

```ts
  // Self-revealing target (numbers/ordinals): the ONLY sanctioned elicitation
  // is a digit/numeral cue — the written form is what the learner produces.
  // Lives in the per-draft user prompt (uncached; system prompt stays
  // byte-identical). When seeded, the target value is pinned (strict, like
  // conjugation); when unseeded (CLI/eval paths pass no seedWords) the
  // directive still applies, just without a pinned value.
  const digitForm =
    inputs.grammarPoint.selfRevealingElicitation === "digit-form" &&
    (inputs.exerciseType === ExerciseType.CLOZE ||
      inputs.exerciseType === ExerciseType.TRANSLATION);
  const digitFormBlock = digitForm
    ? inputs.exerciseType === ExerciseType.TRANSLATION
      ? `${
          seedWord && seedWord.length > 0
            ? `The target form is "${seedWord}" — the reference translation must contain exactly this form (with correct agreement); do not substitute another value. `
            : ""
        }Write the number/order as DIGITS in the source text (e.g. "the 3rd floor", "200 chairs", "in 1923") — never spelled out in the source language — so the learner must produce the written target-language form themselves. Vary the noun and scenario; do not reuse a noun or template from earlier exercises in this batch.\n\n`
      : `${
          seedWord && seedWord.length > 0
            ? `The target form is "${seedWord}" — use exactly this value; do not substitute another. `
            : ""
        }Present the quantity/order ONLY as digits or numerals in the visible text (e.g. "3.º", "3.", "200", "123"), typically as the parenthetical hint — NEVER as the written word. The learner produces the written form (with correct agreement/gender/harmony) from the digit cue; the digit cue is the sanctioned elicitation for this cell, not an answer leak. Vary the noun and scenario; do not reuse a noun or template from earlier exercises in this batch.\n\n`
    : "";
  const seedBlock =
    !digitForm && seedWord && seedWord.length > 0
      ? /* ...existing conjugation/loose chain, unchanged... */
      : "";
```

And include `digitFormBlock` in the return (before `seedBlock`):

```ts
  return `Produce exercise #${ordinal + 1}.

Topic domain: ${domain}

${modeBlock}${coverageBlock}${digitFormBlock}${seedBlock}Use the ${toolName} tool.`;
```

- [ ] **Step 4: Bump `GENERATION_PROMPT_VERSION`**

Line 187: `export const GENERATION_PROMPT_VERSION = "generate@2026-07-08";`

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts.test.ts`
Expected: PASS (including the file's pre-existing byte-parity/template tests — the template was not touched).

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/generation-prompts.ts packages/ai/src/generation-prompts.test.ts
git commit -m "feat(ai): per-draft digit-form elicitation directive for self-revealing targets"
```

---

### Task 5: Validator exemptions (cloze + translation flag-gated; vocab_recall kind-gated)

**Files:**
- Modify: `packages/ai/src/validation-prompts.ts` (notes near `clozeCellScoringNote` line 207; builders at lines 221-267; `VALIDATION_PROMPT_VERSION` line 73)
- Modify: `packages/ai/src/validate.ts` (`contextSpoilsAnswer` tool-field description, lines 90-94)
- Test: `packages/ai/src/validation-prompts.test.ts`

**Interfaces:**
- Consumes: `spec.grammarPoint.selfRevealingElicitation` (Task 1); `spec.grammarPoint.kind`.
- Produces: `selfRevealingScoringNote(spec)` appended to cloze + translation validation user prompts; `vocabRecallScoringNote(spec)` appended to vocab_recall. `contextSpoilsAnswer === true` remains an unconditional routing veto (`routing.ts` untouched) — the exemption works by the validator not setting it.

- [ ] **Step 1: Write the failing tests**

In `validation-prompts.test.ts` (reuse the file's existing spec/content fixtures):

```ts
describe('self-revealing / vocab_recall scoring notes', () => {
  const flaggedSpec = {
    ...baseSpec,
    grammarPoint: {
      ...baseSpec.grammarPoint,
      selfRevealingElicitation: 'digit-form' as const,
      elicitationSeedValues: ['tercero'],
    },
  };

  it('cloze prompt for a flagged cell carries the digit-form exemption', () => {
    const prompt = buildValidationUserPrompt(clozeDraft, flaggedSpec);
    expect(prompt).toContain('self-revealing-target');
    expect(prompt).toContain('do NOT set contextSpoilsAnswer=true');
  });

  it('translation prompt for a flagged cell carries the exemption', () => {
    const prompt = buildValidationUserPrompt(translationDraft, flaggedSpec);
    expect(prompt).toContain('self-revealing-target');
  });

  it('unflagged cloze prompt is unchanged', () => {
    const prompt = buildValidationUserPrompt(clozeDraft, baseSpec);
    expect(prompt).not.toContain('self-revealing-target');
  });

  it('vocab_recall prompt for a vocab-kind point carries the meaning-vs-orthography note', () => {
    const vocabSpec = {
      ...baseSpec,
      grammarPoint: { ...baseSpec.grammarPoint, kind: 'vocab' as const },
    };
    const prompt = buildValidationUserPrompt(vocabRecallDraft, vocabSpec);
    expect(prompt).toContain('Scoring note for vocab_recall');
    expect(prompt).toContain('orthographic');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/ai test -- validation-prompts.test.ts`
Expected: new tests FAIL.

- [ ] **Step 3: Implement the notes**

In `validation-prompts.ts`, after `clozeCellScoringNote` (line 219), add:

```ts
// Self-revealing targets (numbers/ordinals — see
// docs/findings/2026-07-07-self-revealing-target-elicitation.md): the target's
// meaning cannot be conveyed without identifying it, so the digit-form cue is
// the sanctioned elicitation. Gated on the curriculum flag (not a key list) so
// future flagged points inherit it. Applies to cloze AND translation drafts.
function selfRevealingScoringNote(spec: GenerationSpec): string {
  if (spec.grammarPoint.selfRevealingElicitation !== "digit-form") return "";
  return `

**Scoring note for this self-revealing-target cell:** the target is a number/ordinal whose meaning CANNOT be conveyed without identifying it. A digit or numeral cue in the visible text (e.g. "3.º", "3.", "200", "123", digits in a translation source sentence) is the INTENDED elicitation for this cell — do NOT set contextSpoilsAnswer=true because digits identify which value the learner must write. The tested skill is producing the WRITTEN form with correct agreement/apocope/gender/harmony (tercer vs tercero, doscientas, üçüncü), which digits do not reveal. Still set contextSpoilsAnswer=true if the written word form itself appears anywhere in the visible text. Score all other dimensions normally; a clean digit-cued draft is 0.8+, not spoiled.`;
}

// vocab_recall's task IS meaning→word retrieval: a definition that picks out
// exactly one headword is the exercise working as designed, not spoilage.
// Spoilage for vocab is ORTHOGRAPHIC only. Gated on kind (all vocab cells).
function vocabRecallScoringNote(spec: GenerationSpec): string {
  if (spec.grammarPoint.kind !== "vocab") return "";
  return `

**Scoring note for vocab_recall:** the Prompt is a meaning-based definition whose JOB is to pick out exactly one headword — do NOT set contextSpoilsAnswer=true because the definition identifies the expected word, however precise the definition is. Set contextSpoilsAnswer=true ONLY for orthographic reveals: the expected word (in any inflection) appearing in the prompt, hints, or example sentence; first/last-letter or letter-count hints; partial spellings. A precise unambiguous definition with meaning-only hints is a GOOD exercise (0.8+), not a spoiled one.`;
}
```

Wire them in:
- `buildClozeValidationUserPrompt` line 233: `...${clozeCellScoringNote(spec.grammarPoint.key)}${selfRevealingScoringNote(spec)}`
- `buildTranslationValidationUserPrompt`: insert `${selfRevealingScoringNote(spec)}` on a new line after `**Reference Translation:** ...`
- `buildVocabRecallValidationUserPrompt`: insert `${vocabRecallScoringNote(spec)}` after `**Example Sentence:** ...`

- [ ] **Step 4: Soften the tool-field description**

In `packages/ai/src/validate.ts` lines 90-94, append one sentence to the `contextSpoilsAnswer` description (keep the existing text intact):

```
Exception: when the user prompt carries a scoring note declaring a digit-form or definition-based elicitation as intended for this cell, that declared cue is NOT spoilage.
```

- [ ] **Step 5: Bump `VALIDATION_PROMPT_VERSION`**

Line 73: `export const VALIDATION_PROMPT_VERSION = "validate@2026-07-08";`
(`VALIDATION_SYSTEM_PROMPT_TEMPLATE` is untouched — the byte-parity test must still pass.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- validation-prompts.test.ts validate.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ai/src/validation-prompts.ts packages/ai/src/validation-prompts.test.ts packages/ai/src/validate.ts
git commit -m "feat(ai): validator exemptions — digit-form cues and vocab definitions are intended elicitation"
```

---

### Task 6: `demote:pool` one-off script (cell-scoped demote, dry-run default)

**Files:**
- Create: `packages/db/scripts/demote-cell-pool.ts`
- Test: `packages/db/scripts/demote-cell-pool.test.ts`
- Modify: `packages/db/package.json` (scripts), root `package.json` (scripts)

**Interfaces:**
- Consumes: `exercises` Drizzle schema; the arg-parse/dry-run conventions of `dedupe-conjugation-pool.ts`.
- Produces: `pnpm demote:pool --language TR --cefr A1 --type cloze --grammar-point tr-a1-numbers-ordinals [--content-ilike üçüncü] [--apply]` — demotes matching approved rows to `review_status='rejected'` (never DELETE; FKs preserved). Exports `parseDemoteArgs(argv)` for tests.

- [ ] **Step 1: Write the failing arg-parser test**

`packages/db/scripts/demote-cell-pool.test.ts` (mirror the structure of `review-flagged-parse-args.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { parseDemoteArgs } from './demote-cell-pool';

describe('parseDemoteArgs', () => {
  const required = [
    '--language', 'TR', '--cefr', 'A1', '--type', 'cloze',
    '--grammar-point', 'tr-a1-numbers-ordinals',
  ];

  it('defaults to dry-run with all filters parsed', () => {
    const args = parseDemoteArgs(required);
    expect(args).toEqual({
      language: 'TR', cefr: 'A1', type: 'cloze',
      grammarPoint: 'tr-a1-numbers-ordinals',
      contentIlike: null, apply: false,
    });
  });

  it('parses --apply and --content-ilike', () => {
    const args = parseDemoteArgs([...required, '--content-ilike', 'üçüncü', '--apply']);
    expect(args.apply).toBe(true);
    expect(args.contentIlike).toBe('üçüncü');
  });

  it('throws when a required filter is missing', () => {
    expect(() => parseDemoteArgs(['--language', 'TR'])).toThrow(/required/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db test -- demote-cell-pool.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the script**

`packages/db/scripts/demote-cell-pool.ts` — copy the skeleton of `dedupe-conjugation-pool.ts` (env check, db client setup, direct-invocation guard, dry-run printing). Core:

```ts
/**
 * One-off: demote a cell's approved exercises back out of the pool so the
 * scheduler regenerates them (e.g. after an identity-space collapse — see
 * docs/findings/2026-07-07-self-revealing-target-elicitation.md). Demotes to
 * review_status='rejected'; NEVER deletes (user_exercise_history/playlists
 * reference exercises.id without cascade). Dry-run by default; --apply writes.
 * Optional --content-ilike narrows to rows whose content_json contains a
 * substring (case-insensitive).
 */
export type DemoteArgs = {
  language: string; cefr: string; type: string; grammarPoint: string;
  contentIlike: string | null; apply: boolean;
};

export function parseDemoteArgs(argv: readonly string[]): DemoteArgs {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const language = get('--language');
  const cefr = get('--cefr');
  const type = get('--type');
  const grammarPoint = get('--grammar-point');
  if (!language || !cefr || !type || !grammarPoint) {
    throw new Error('--language, --cefr, --type, --grammar-point are required');
  }
  return {
    language: language.toUpperCase(), cefr: cefr.toUpperCase(), type,
    grammarPoint, contentIlike: get('--content-ilike'),
    apply: argv.includes('--apply'),
  };
}

async function main() {
  const args = parseDemoteArgs(process.argv.slice(2));
  const db = /* same client setup as dedupe-conjugation-pool.ts */;
  const filters = [
    eq(exercises.language, args.language),
    eq(exercises.difficulty, args.cefr),
    eq(exercises.type, args.type),
    eq(exercises.grammarPointKey, args.grammarPoint),
    inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']),
  ];
  if (args.contentIlike) {
    filters.push(sql`${exercises.contentJson}::text ILIKE ${'%' + args.contentIlike + '%'}`);
  }
  const rows = await db.select({ id: exercises.id, contentJson: exercises.contentJson })
    .from(exercises).where(and(...filters));
  console.log(`${rows.length} approved rows match${args.apply ? '' : ' (dry-run — pass --apply to demote)'}`);
  for (const r of rows.slice(0, 5)) console.log(' sample:', JSON.stringify(r.contentJson).slice(0, 120));
  if (!args.apply) return;
  for (const r of rows) {
    await db.update(exercises).set({ reviewStatus: 'rejected' }).where(eq(exercises.id, r.id));
  }
  console.log(`Demoted ${rows.length} rows to 'rejected'.`);
}
```

Register: `packages/db/package.json` scripts → `"demote:pool": "npx tsx scripts/demote-cell-pool.ts"`; root `package.json` → `"demote:pool": "dotenv -e .env -- pnpm --filter @language-drill/db demote:pool"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/db test -- demote-cell-pool.test.ts`
Expected: PASS.

- [ ] **Step 5: Dry-run against the dev DB (sanity only — dev branch data differs from prod)**

Run: `pnpm demote:pool --language TR --cefr A1 --type translation --grammar-point tr-a1-numbers-ordinals`
Expected: prints a match count and samples, writes nothing.

- [ ] **Step 6: Commit**

```bash
git add packages/db/scripts/demote-cell-pool.ts packages/db/scripts/demote-cell-pool.test.ts packages/db/package.json package.json
git commit -m "feat(scripts): demote:pool — cell-scoped demote-to-rejected one-off (dry-run default)"
```

---

### Task 7: Full gate + eval:gen verification + findings-doc update

**Files:**
- Create: `packages/ai/scripts/fixtures/cells-self-revealing.json`
- Modify: `docs/findings/2026-07-07-self-revealing-target-elicitation.md` (status + results)

**Interfaces:**
- Consumes: everything above; `pnpm eval:gen` (`packages/ai/scripts/eval-gen-run.ts`).

- [ ] **Step 1: Full pre-push gate**

```bash
rm -rf infra/lambda/dist
pnpm build && pnpm lint && pnpm typecheck && pnpm test
```
Expected: zero failures. (If infra CDK-synth tests fail with `FailedToBundleAsset`/esbuild 254 locally, that is the known esbuild-at-root environment issue, not a regression — symlink esbuild into root `node_modules` or verify in CI.)

- [ ] **Step 2: Confirm no Langfuse drift**

```bash
pnpm --filter @language-drill/ai push-prompts --dry-run
```
Expected: `generate-system-prompt` and `validate-system-prompt` report **in-sync** (this plan never edits the `*_TEMPLATE` strings; all changes ride the per-draft user prompts = code deploy).

- [ ] **Step 3: Write the eval dataset fixture**

`packages/ai/scripts/fixtures/cells-self-revealing.json`:

```json
[
  { "language": "ES", "cefrLevel": "A1", "exerciseType": "cloze",        "grammarPointKey": "es-a1-numbers-ordinals" },
  { "language": "ES", "cefrLevel": "A1", "exerciseType": "translation",  "grammarPointKey": "es-a1-numbers-ordinals" },
  { "language": "ES", "cefrLevel": "A1", "exerciseType": "vocab_recall", "grammarPointKey": "es-a1-vocab-family-people" },
  { "language": "TR", "cefrLevel": "A1", "exerciseType": "cloze",        "grammarPointKey": "tr-a1-numbers-ordinals" },
  { "language": "TR", "cefrLevel": "A1", "exerciseType": "translation",  "grammarPointKey": "tr-a1-numbers-ordinals" }
]
```

- [ ] **Step 4: Run eval:gen** — ⚠️ **requires ANTHROPIC_API_KEY with topped-up credit (balance was $0.61 on 2026-07-07). STOP and confirm with the user before spending.**

```bash
pnpm eval:gen --baseline repo --candidate repo \
  --dataset-file scripts/fixtures/cells-self-revealing.json \
  --drafts-per-cell 8 --run-name self-revealing-postfix --max-cost-usd 5
```

Both arms use the same (unchanged) system template; the point of the run is that generation user prompts + validator notes are the NEW code. Read the candidate columns and compare against the 2026-07-07 prod baseline (in the findings doc).

Acceptance criteria:
- `context-spoils-answer` rejection count ≈ 0 across all five cells (prod baseline: 14/20 on ES numbers cloze, 8/10 on vocab-family).
- Approval rate ≥ 50% per cell (prod baseline: 5% / 27.6%).
- Note: `seedWords` are not threaded by the eval harness, so this run exercises the *generic* digit-form directive; the pinned-value rotation is covered by Task 3/4 unit tests and verified in prod post-merge.

- [ ] **Step 5: Record results + update findings doc**

Append an "Eval results (pre-merge)" section to `docs/findings/2026-07-07-self-revealing-target-elicitation.md` with the eval-runs JSON summary numbers; flip Status to `FIX IMPLEMENTED — awaiting prod re-fill` once acceptance criteria are met.

- [ ] **Step 6: Commit**

```bash
git add packages/ai/scripts/fixtures/cells-self-revealing.json docs/findings/2026-07-07-self-revealing-target-elicitation.md
git commit -m "test(eval): self-revealing cells fixture + pre-merge eval results"
```

---

### Post-merge operations checklist (manual — NOT part of the code tasks)

- [ ] **Top up Anthropic credit BEFORE the next ~04:00 UTC scheduler run.** The ES+TR curriculum bumps re-enqueue every below-target cell in both languages; expect a mid-two-digit-USD run. (Balance was $0.61 on 2026-07-07 — the nightly run will otherwise fail on credit exhaustion. Those failures self-recover, but nothing regenerates until credit exists.)
- [ ] Merge via **squash** (edit the squash message to the PR summary). Deploy pipeline ships the code; no `push-prompts` needed (Step 7.2 proved in-sync).
- [ ] **Demote the collapsed TR rows against PROD** (local `.env` points at the dev Neon branch — pass the prod `DATABASE_URL` explicitly):

  ```bash
  DATABASE_URL='<prod-neon-url>' pnpm --filter @language-drill/db demote:pool \
    --language TR --cefr A1 --type translation --grammar-point tr-a1-numbers-ordinals            # dry-run, expect ~20
  DATABASE_URL='<prod-neon-url>' pnpm --filter @language-drill/db demote:pool \
    --language TR --cefr A1 --type translation --grammar-point tr-a1-numbers-ordinals --apply
  DATABASE_URL='<prod-neon-url>' pnpm --filter @language-drill/db demote:pool \
    --language TR --cefr A1 --type cloze --grammar-point tr-a1-numbers-ordinals                  # dry-run, expect ~20
  DATABASE_URL='<prod-neon-url>' pnpm --filter @language-drill/db demote:pool \
    --language TR --cefr A1 --type cloze --grammar-point tr-a1-numbers-ordinals --apply
  ```

  Demote ALL approved rows in both cells (not just üçüncü-matching ones) — the cloze answer space is also degenerate (4 distinct answers), and the curriculum bump + rotation rebuilds both cells cleanly.
- [ ] **Next-day verification** (prod Neon, project `twilight-smoke-01114337`, branch `br-green-waterfall-ancrvpr5`): for the 2026-07-08+ run check `generation_jobs` for `es:a1:cloze:es-a1-numbers-ordinals`, `tr:a1:cloze:tr-a1-numbers-ordinals`, `tr:a1:translation:tr-a1-numbers-ordinals`, ES A1 vocab cells — approval ≥ 50%, `context-spoils-answer` ≈ 0, and the distinct-answer spread across the new rows covers ≥ 8 distinct target values per cell.
- [ ] Flip the findings doc Status to `RESOLVED` with the prod numbers; leave the budget-controls tech-debt entry open (next project).

---

## Self-Review (done at plan time)

- **Spec coverage:** digit-form prompts (Task 4), validator exemption incl. vocab gloss (Task 5), generate↔validate updated together with both version bumps (Tasks 4+5, PR #444 lesson), identity-space rotation (Tasks 1–3), suppressed-cell re-run via curriculum bumps (Task 2), TR demote+regenerate (Task 6 + ops), eval:gen verification (Task 7). ✔
- **Known gap accepted:** eval:gen does not thread `seedWords`, so the pinned-value rotation is unit-tested only until the post-merge prod run verifies it (noted in Task 7.4).
- **Type consistency:** `selfRevealingElicitation` / `elicitationSeedValues` names are identical across Tasks 1–5; `seedKindFor` union literal `'elicitation-values'` matches between Task 3 code and tests. ✔
