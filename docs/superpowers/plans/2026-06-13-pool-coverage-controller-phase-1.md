# Pool Coverage Controller — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace blind ordinal person rotation with a deficit-driven, self-correcting controller: the scheduler measures the approved pool's per-person distribution, directs the next batch's per-draft person targets at the under-filled buckets, and gives up on a bucket that yields nothing (cleared by a curriculum-version bump).

**Architecture:** A new pure module `coverage-decision.ts` (parallel to the existing `scheduler-decision.ts`) turns the scalar `need` into a `PersonCode[]` via greedy water-fill toward per-person balance, excluding suppressed buckets. The target rides in the SQS `GenerationJobMessage.spec.personTargets`, is threaded into `GenerationSpec`, and is consumed by `renderPersonBlock` (falling back to today's ordinal rotation when absent). Each batch's per-person `{requested, approved}` outcome is tallied in `run-one-cell` (approved counted by the validator's *realized* person from Phase 0 `coverageTags`) and persisted to a new `generation_jobs.coverage_outcome` jsonb column, which the scheduler reads back to drive give-up. `decideEnqueue` is unchanged.

**Tech Stack:** TypeScript, pnpm workspaces + Turborepo, Vitest, Drizzle ORM (Neon Postgres), AWS Lambda/SQS, Anthropic Claude. Spec: `docs/superpowers/specs/2026-06-13-pool-coverage-controller-phase-1-design.md`.

**Conventions / gotchas (from CLAUDE.md + project memory):**
- After editing `packages/db` source, run `pnpm build` (turbo) before single-package vitest runs — single-package runs test against a stale `db/dist`.
- The full `pnpm test` flakily fails `infra` under parallel load; verify green with `pnpm turbo run test --concurrency=1`.
- All commits end with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- Add tests to the existing test file for each module — do not create orphaned test files.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/shared/src/coverage.ts` | Coverage axis vocab + types | Add `PersonOutcome`, `CoverageOutcome` types |
| `packages/ai/src/generation-prompts.ts` | Generation prompt builders | `personCodesForLanguage` + `personDisplayForCode` helpers; `renderPersonBlock` + `buildGenerationUserPrompt` honour explicit `personTargets` |
| `packages/ai/src/generate.ts` | `GenerationSpec` + `generateOneDraft` | Add `personTargets?` to spec; pass into `buildGenerationUserPrompt` |
| `infra/lambda/src/generation/coverage-decision.ts` | **NEW** pure deficit→`PersonCode[]` allocator | Create |
| `infra/lambda/src/generation/cell-targets.ts` | Scheduler tuning constants | Add `GIVE_UP_MIN_ATTEMPTS` |
| `packages/db/src/schema/generation.ts` | `generation_jobs` schema | Add `coverage_outcome` jsonb column |
| `packages/db/migrations/0021_*.sql` | Forward migration | Generated |
| `packages/db/src/generation/validate-and-insert.ts` | Per-draft validate+insert | Surface `realizedPerson` on `DraftOutcome` |
| `packages/db/src/generation/run-one-cell.ts` | Per-cell orchestration | Thread `personTargets`; tally + persist `coverage_outcome`; `CellResult.coverageOutcome` |
| `infra/lambda/src/generation/job-message.ts` | SQS message contract | Add `personTargets?` field + parse validation |
| `infra/lambda/src/generation/handler.ts` | SQS consumer shell | Thread `parsed.spec.personTargets` → `runOneCell` args |
| `infra/lambda/src/generation/scheduler-decision.ts` | `RecentJob` type | Add `coverageOutcome` field |
| `infra/lambda/src/generation/scheduler.ts` | Nightly scheduler | Extend recent-job query; per-person aggregate; compute `personTargets` for personRotation cells |

Tasks are ordered bottom-up so each produces a self-contained, independently-committable change with green tests.

---

## Task 1: Person-code helpers in `packages/ai`

Derive the canonical `PersonCode` list and a code→display-string map from the existing `PERSON_ROTATION_BY_LANGUAGE` labels (e.g. `"2pl (siz)"` → code `"2pl"`), so the controller can emit codes and the prompt can render the language-specific label.

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts` (after `PERSON_ROTATION_BY_LANGUAGE`, ~line 354)
- Modify: `packages/ai/src/index.ts` (re-export)
- Test: `packages/ai/src/generation-prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/ai/src/generation-prompts.test.ts`. First add `personCodesForLanguage` and `personDisplayForCode` to the existing import block from `./generation-prompts.js` (alongside `personForOrdinal`), and ensure `Language` and the `PersonCode` type are imported (`import { Language, type PersonCode } from "@language-drill/shared";` — check the existing import; `Language` is already imported in this file):

```ts
describe("personCodesForLanguage", () => {
  it("derives canonical codes from the rotation labels", () => {
    expect(personCodesForLanguage(Language.TR)).toEqual([
      "1sg", "2sg", "3sg", "1pl", "2pl", "3pl",
    ]);
  });
  it("omits vosotros for Spanish (5 persons, no 2pl)", () => {
    expect(personCodesForLanguage(Language.ES)).toEqual([
      "1sg", "2sg", "3sg", "1pl", "3pl",
    ]);
  });
});

describe("personDisplayForCode", () => {
  it("maps a code back to the language-specific label", () => {
    expect(personDisplayForCode(Language.TR, "2pl")).toBe("2pl (siz)");
    expect(personDisplayForCode(Language.ES, "1pl")).toBe(
      "1pl (nosotros/nosotras)",
    );
  });
  it("falls back to the bare code when the language lacks it", () => {
    expect(personDisplayForCode(Language.ES, "2pl")).toBe("2pl");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts`
Expected: FAIL — `personCodesForLanguage is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

In `packages/ai/src/generation-prompts.ts`, immediately after the `PERSON_ROTATION_BY_LANGUAGE` declaration (~line 354), add. Import `PersonCode` from shared at the top if not already present (`import { ..., type PersonCode } from "@language-drill/shared";`):

```ts
/** Canonical `PersonCode` list for a language, derived from the rotation labels
 *  (the leading token of each entry). ES yields 5 codes (no `2pl`); TR/DE 6. */
export function personCodesForLanguage(
  language: Exclude<Language, Language.EN>,
): PersonCode[] {
  return PERSON_ROTATION_BY_LANGUAGE[language].map(
    (label) => label.split(" ")[0] as PersonCode,
  );
}

/** Maps a `PersonCode` back to the language's display label for the prompt
 *  directive (e.g. `"2pl"` → `"2pl (siz)"`). Falls back to the bare code if the
 *  language has no such person (defensive; the controller never emits one). */
export function personDisplayForCode(
  language: Exclude<Language, Language.EN>,
  code: PersonCode,
): string {
  const match = PERSON_ROTATION_BY_LANGUAGE[language].find(
    (label) => label.split(" ")[0] === code,
  );
  return match ?? code;
}
```

Re-export both from `packages/ai/src/index.ts` (add to the existing `export { ... } from "./generation-prompts.js";` block).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/generation-prompts.ts packages/ai/src/index.ts packages/ai/src/generation-prompts.test.ts
git commit -m "feat(ai): personCodesForLanguage + personDisplayForCode helpers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: `PersonOutcome` / `CoverageOutcome` types in `packages/shared`

The per-bucket outcome shape persisted on `generation_jobs` and read by the scheduler. Type-only (no runtime behaviour) — verified by `typecheck` rather than a unit test.

**Files:**
- Modify: `packages/shared/src/coverage.ts` (after `CoverageTags`, ~line 51)
- Modify: `packages/shared/src/index.ts` (if it explicitly re-exports coverage symbols — check; many shared modules are re-exported via `export * from "./coverage.js"`)

- [ ] **Step 1: Add the types**

In `packages/shared/src/coverage.ts`, after the `CoverageTags` type:

```ts
/**
 * Per-person generation outcome for one cell's batch (Pool Coverage Controller,
 * Phase 1). `requested` = drafts the scheduler asked for that person this batch;
 * `approved` = approved drafts whose *realized* person (validator `coverage`,
 * the same value written to `coverageTags`) equals it. Counted by realized
 * person so a draft targeted at `2pl` but rendered as `3sg` via the prompt's
 * escape hatch does NOT count toward `2pl` — the `2pl` deficit genuinely didn't
 * close. Drives the per-bucket give-up in `coverage-decision.ts`.
 */
export type PersonOutcome = Partial<
  Record<PersonCode, { requested: number; approved: number }>
>;

/**
 * Axis-keyed container persisted to `generation_jobs.coverage_outcome`. Nested
 * under `person` so a future axis (Phase 2) is a data addition, not a schema
 * change. NULL on legacy rows, non-`personRotation` cells, and cells that did no
 * person targeting.
 */
export type CoverageOutcome = { person?: PersonOutcome };
```

- [ ] **Step 2: Verify it typechecks and is exported**

Run: `pnpm --filter @language-drill/shared typecheck`
Expected: PASS. Confirm the symbols are reachable from the package root: `grep -n "coverage" packages/shared/src/index.ts` — if coverage is re-exported via `export * from "./coverage.js"`, nothing more is needed; otherwise add `PersonOutcome, CoverageOutcome` to the explicit export list.

- [ ] **Step 3: Build (db/infra consume this package)**

Run: `pnpm build`
Expected: PASS (so downstream packages see the new types).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/coverage.ts packages/shared/src/index.ts
git commit -m "feat(shared): PersonOutcome + CoverageOutcome types

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: `renderPersonBlock` honours explicit `personTargets`

When the scheduler supplies per-draft person targets, the directive pins them (mapped to the language label); otherwise it falls back to today's deterministic ordinal rotation. The directive stays in the per-draft user prompt — the cached system prompt is untouched.

**Files:**
- Modify: `packages/ai/src/generation-prompts.ts:399-411` (`renderPersonBlock`), `:434-467` (`buildGenerationUserPrompt`)
- Modify: `packages/ai/src/generate.ts:291-330` (`GenerationSpec`), `:757-763` (`generateOneDraft` call)
- Test: `packages/ai/src/generation-prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/ai/src/generation-prompts.test.ts`. Build a personRotation inputs object from the existing `getGrammarPoint` import or inline (mirror the `buildGenerationUserPrompt — sentence_construction` block's inline `grammarPoint`). Use a TR cloze point with `personRotation: true`:

```ts
describe("buildGenerationUserPrompt — explicit personTargets", () => {
  const inputs = {
    language: Language.TR,
    cefrLevel: "A2",
    exerciseType: ExerciseType.CLOZE,
    grammarPoint: { name: "Aorist tense", personRotation: true },
  } as unknown as GenerationPromptInputs;

  it("pins the explicit target's label for the ordinal", () => {
    const msg = buildGenerationUserPrompt(
      inputs, 0, null, null, "scheduled-2026-06-13", ["2pl", "1pl"],
    );
    expect(msg).toContain("Target grammatical person for this draft: 2pl (siz)");
  });

  it("uses personTargets[ordinal], not ordinal rotation", () => {
    const msg = buildGenerationUserPrompt(
      inputs, 1, null, null, "scheduled-2026-06-13", ["2pl", "1pl"],
    );
    expect(msg).toContain("Target grammatical person for this draft: 1pl (biz)");
  });

  it("falls back to ordinal rotation when personTargets is absent", () => {
    const withTargets = buildGenerationUserPrompt(
      inputs, 0, null, null, "seed-x", ["2pl"],
    );
    const blind = buildGenerationUserPrompt(inputs, 0, null, null, "seed-x");
    expect(withTargets).not.toBe(blind);
    expect(blind).toContain("Target grammatical person for this draft:");
  });

  it("emits no person block when personRotation is false", () => {
    const noRotation = {
      ...inputs,
      grammarPoint: { name: "X", personRotation: false },
    } as unknown as GenerationPromptInputs;
    expect(
      buildGenerationUserPrompt(noRotation, 0, null, null, "s", ["2pl"]),
    ).not.toContain("Target grammatical person");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts`
Expected: FAIL — `buildGenerationUserPrompt` ignores the 6th arg; first assertion fails (label not pinned).

- [ ] **Step 3: Implement**

In `packages/ai/src/generation-prompts.ts`, change `renderPersonBlock` (line 399) to accept optional targets:

```ts
function renderPersonBlock(
  inputs: GenerationPromptInputs,
  ordinal: number,
  batchSeed: string | null,
  personTargets?: readonly PersonCode[],
): string {
  if (!inputs.grammarPoint.personRotation) return "";
  const explicit = personTargets?.[ordinal];
  const person = explicit
    ? personDisplayForCode(inputs.language, explicit)
    : personForOrdinal(inputs.language, ordinal, batchSeed);
  return (
    `Target grammatical person for this draft: ${person}. ` +
    `The form the learner must produce MUST be marked for this person, and the visible sentence/context MUST make the person unambiguously recoverable (overt subject pronoun, possessor, vocative, or unambiguous context) WITHOUT revealing the conjugated form itself. ` +
    `If ${inputs.grammarPoint.name} cannot naturally express this person, use the closest natural person instead.\n\n`
  );
}
```

Change `buildGenerationUserPrompt` (line 434) to thread a 6th param and pass it through (line 461):

```ts
export function buildGenerationUserPrompt(
  inputs: GenerationPromptInputs,
  ordinal: number,
  topicDomain: string | null,
  seedWord: string | null = null,
  batchSeed: string | null = null,
  // Phase 1: explicit per-draft person codes from the scheduler's coverage
  // controller. `undefined` → blind ordinal rotation (byte-identical to before).
  personTargets: readonly PersonCode[] | undefined = undefined,
): string {
  // ... unchanged body ...
  const personBlock = renderPersonBlock(inputs, ordinal, batchSeed, personTargets);
  // ... unchanged return ...
}
```

In `packages/ai/src/generate.ts`, add to `GenerationSpec` (after `seedWords`, ~line 329):

```ts
  /**
   * Phase 1 coverage controller: explicit per-ordinal person code
   * (`personTargets[ordinal]`) from the scheduler. `undefined` → blind ordinal
   * rotation, byte-identical to pre-Phase-1. Length matches `count` when set.
   */
  personTargets?: readonly PersonCode[];
```

Import `PersonCode` in `generate.ts` if not present (`import { ..., type PersonCode } from "@language-drill/shared";`). In `generateOneDraft`, pass it to the user-prompt builder (line 757):

```ts
  const userText = buildGenerationUserPrompt(
    promptInputs,
    ordinal,
    spec.topicDomain,
    spec.seedWords?.[ordinal] ?? null,
    spec.batchSeed,
    spec.personTargets,
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- generation-prompts`
Expected: PASS. Also run the full ai suite to confirm the system-prompt byte-parity tests still pass (the directive is user-prompt-only): `pnpm --filter @language-drill/ai test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/generation-prompts.ts packages/ai/src/generate.ts packages/ai/src/generation-prompts.test.ts
git commit -m "feat(ai): renderPersonBlock honours explicit personTargets

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: `coverage-decision.ts` — pure deficit→`PersonCode[]` allocator

The heart of Phase 1: greedy water-fill toward per-person balance, excluding suppressed (zero-yield) buckets. Pure — no AWS/Drizzle/env.

**Files:**
- Modify: `infra/lambda/src/generation/cell-targets.ts` (add `GIVE_UP_MIN_ATTEMPTS`)
- Create: `infra/lambda/src/generation/coverage-decision.ts`
- Test: `infra/lambda/src/generation/coverage-decision.test.ts` (new module → new test file is correct here)

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/generation/coverage-decision.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Language } from '@language-drill/shared';
import { decideCoverageTargets, GIVE_UP_MIN_ATTEMPTS } from './coverage-decision';

describe('decideCoverageTargets', () => {
  it('water-fills the most-starved persons first (TR, 6 persons)', () => {
    // floor for target 30 / 6 = 5; this skewed pool needs the tail filled.
    const { personTargets } = decideCoverageTargets({
      language: Language.TR,
      need: 8,
      approvedByPerson: { '1sg': 8, '2sg': 6, '3sg': 9, '1pl': 4, '2pl': 1, '3pl': 2 },
      recentOutcome: null,
    });
    expect(personTargets).toHaveLength(8);
    // Most-deficient buckets dominate; 3sg (highest) never targeted.
    const counts = tally(personTargets);
    expect(counts['2pl']).toBeGreaterThanOrEqual(counts['1pl'] ?? 0);
    expect(counts['3sg'] ?? 0).toBe(0);
  });

  it('returns [] when need <= 0', () => {
    expect(
      decideCoverageTargets({
        language: Language.TR, need: 0, approvedByPerson: {}, recentOutcome: null,
      }).personTargets,
    ).toEqual([]);
  });

  it('distributes evenly from an empty pool (== ceil(target/N) floor)', () => {
    const { personTargets } = decideCoverageTargets({
      language: Language.TR, need: 6, approvedByPerson: {}, recentOutcome: null,
    });
    expect(tally(personTargets)).toEqual({
      '1sg': 1, '2sg': 1, '3sg': 1, '1pl': 1, '2pl': 1, '3pl': 1,
    });
  });

  it('omits 2pl for Spanish (5-person paradigm)', () => {
    const { personTargets } = decideCoverageTargets({
      language: Language.ES, need: 5, approvedByPerson: {}, recentOutcome: null,
    });
    expect(personTargets).not.toContain('2pl');
    expect(new Set(personTargets)).toEqual(
      new Set(['1sg', '2sg', '3sg', '1pl', '3pl']),
    );
  });

  it('suppresses a zero-yield bucket and reports it', () => {
    const { personTargets, suppressed } = decideCoverageTargets({
      language: Language.TR,
      need: 6,
      approvedByPerson: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 }, // 2pl starved
      recentOutcome: { '2pl': { requested: 5, approved: 0 } },
    });
    expect(suppressed).toEqual(['2pl']);
    expect(personTargets).not.toContain('2pl');
    expect(personTargets).toHaveLength(6);
  });

  it('does not suppress on a single attempt (< GIVE_UP_MIN_ATTEMPTS)', () => {
    expect(GIVE_UP_MIN_ATTEMPTS).toBe(2);
    const { suppressed, personTargets } = decideCoverageTargets({
      language: Language.TR,
      need: 6,
      approvedByPerson: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 },
      recentOutcome: { '2pl': { requested: 1, approved: 0 } },
    });
    expect(suppressed).toEqual([]);
    expect(personTargets).toContain('2pl');
  });

  it('does not suppress a bucket that yielded at least once', () => {
    const { suppressed } = decideCoverageTargets({
      language: Language.TR,
      need: 6,
      approvedByPerson: {},
      recentOutcome: { '2pl': { requested: 5, approved: 1 } },
    });
    expect(suppressed).toEqual([]);
  });

  it('null recentOutcome suppresses nothing (curriculum bump cleared it)', () => {
    const { suppressed, personTargets } = decideCoverageTargets({
      language: Language.TR, need: 6, approvedByPerson: {}, recentOutcome: null,
    });
    expect(suppressed).toEqual([]);
    expect(personTargets).toHaveLength(6);
  });

  it('returns [] when every person is suppressed (blind fallback)', () => {
    const recentOutcome = Object.fromEntries(
      ['1sg', '2sg', '3sg', '1pl', '2pl', '3pl'].map((p) => [
        p, { requested: 3, approved: 0 },
      ]),
    );
    const { personTargets, suppressed } = decideCoverageTargets({
      language: Language.TR, need: 6, approvedByPerson: {}, recentOutcome,
    });
    expect(personTargets).toEqual([]);
    expect(suppressed).toHaveLength(6);
  });
});

function tally(codes: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of codes) out[c] = (out[c] ?? 0) + 1;
  return out;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- coverage-decision`
Expected: FAIL — module `./coverage-decision` does not exist.
(If the package filter name differs, find it: `grep '"name"' infra/lambda/package.json`.)

- [ ] **Step 3: Add the constant**

In `infra/lambda/src/generation/cell-targets.ts`, beside the other suppression constants (after `PERSON_ROTATION_TARGET_MULTIPLIER`, ~line 76):

```ts
/**
 * Phase 1 coverage controller — a person bucket is **given up** (excluded from
 * the deficit) when its most recent targeted batch asked for it at least this
 * many times and produced zero approved drafts realizing it. Two honest
 * attempts before suppression; person buckets are small, so a single-attempt
 * miss is too noisy. Cleared by a CURRICULUM_VERSION bump (same gate as the
 * cell-level low-yield / saturated-dedup suppression). Design-tunable.
 */
export const GIVE_UP_MIN_ATTEMPTS = 2;
```

- [ ] **Step 4: Write the module**

Create `infra/lambda/src/generation/coverage-decision.ts`:

```ts
/**
 * Pure coverage-controller decision logic for the **person** axis (Pool Coverage
 * Controller, Phase 1). No `@aws-sdk/*`, no Drizzle, no env reads — pure inputs →
 * pure output, unit-tested in isolation. Mirrors `scheduler-decision.ts`.
 *
 * Turns the scalar `need` from `decideEnqueue` into an explicit per-draft
 * `PersonCode[]` by greedily water-filling each draft into the eligible person
 * currently lowest in the approved pool — which realizes the uniform per-person
 * floor (`ceil(target / N)`) without an explicit floor term, and covers both the
 * deficit regime (starved persons first) and the top-up regime (level persons,
 * spread evenly) in one loop. Buckets that were targeted last batch but yielded
 * nothing are suppressed (excluded), cleared upstream by a CURRICULUM_VERSION
 * bump (the caller passes `recentOutcome: null` in that case).
 */

import type { Language, PersonCode, PersonOutcome } from '@language-drill/shared';
import { personCodesForLanguage } from '@language-drill/ai';
import { GIVE_UP_MIN_ATTEMPTS } from './cell-targets';

export { GIVE_UP_MIN_ATTEMPTS };

export type CoverageDecisionInput = {
  language: Exclude<Language, Language.EN>;
  /** decideEnqueue's scalar need (= target − approvedInPool). */
  need: number;
  /** Measured approved-pool count per person (from coverage_tags GROUP BY). */
  approvedByPerson: Partial<Record<PersonCode, number>>;
  /**
   * The most-recent succeeded job's per-person outcome — ONLY when that job's
   * curriculumVersion matches the on-disk constant. `null` clears all give-up
   * (no recent job, or a curriculum bump invalidated the suppression).
   */
  recentOutcome: PersonOutcome | null;
};

export type CoverageDecision = {
  /** length === max(0, need); [] ⇒ caller omits spec.personTargets (blind). */
  personTargets: PersonCode[];
  /** Buckets excluded as zero-yield — surfaced for the scheduler's log line. */
  suppressed: PersonCode[];
};

export function decideCoverageTargets(
  input: CoverageDecisionInput,
): CoverageDecision {
  const { language, need, approvedByPerson, recentOutcome } = input;
  const persons = personCodesForLanguage(language);

  const suppressed = persons.filter((p) => {
    const o = recentOutcome?.[p];
    return o !== undefined && o.requested >= GIVE_UP_MIN_ATTEMPTS && o.approved === 0;
  });

  if (need <= 0) return { personTargets: [], suppressed };

  const eligible = persons.filter((p) => !suppressed.includes(p));
  if (eligible.length === 0) return { personTargets: [], suppressed };

  // Running projected count per eligible person, seeded from the approved pool.
  const counts = new Map<PersonCode, number>(
    eligible.map((p) => [p, approvedByPerson[p] ?? 0]),
  );

  const personTargets: PersonCode[] = [];
  for (let i = 0; i < need; i++) {
    // Pick the eligible person with the smallest projected count; ties broken by
    // paradigm order (the first such person in `eligible`).
    let best = eligible[0];
    for (const p of eligible) {
      if ((counts.get(p) ?? 0) < (counts.get(best) ?? 0)) best = p;
    }
    personTargets.push(best);
    counts.set(best, (counts.get(best) ?? 0) + 1);
  }

  return { personTargets, suppressed };
}
```

Note on the `@language-drill/ai` import: `infra/lambda` already declares `"@language-drill/ai": "workspace:*"` as a direct dependency (verified), so no `package.json` change is needed.

- [ ] **Step 5: Build + run test to verify it passes**

Run: `pnpm build && pnpm --filter @language-drill/lambda test -- coverage-decision`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/generation/coverage-decision.ts infra/lambda/src/generation/coverage-decision.test.ts infra/lambda/src/generation/cell-targets.ts
git commit -m "feat(generation): pure coverage-decision person-target allocator

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: `coverage_outcome` column + migration (`packages/db`)

**Files:**
- Modify: `packages/db/src/schema/generation.ts` (after `rejectionReasonCounts`, ~line 59)
- Create: `packages/db/migrations/0021_*.sql` (generated)
- Test: covered by the schema's downstream consumers (Tasks 7, 10) + the migration snapshot; no standalone unit test.

- [ ] **Step 1: Add the column**

In `packages/db/src/schema/generation.ts`, import the type at the top:

```ts
import type { CoverageOutcome } from '@language-drill/shared';
```

Add the column inside `pgTable('generation_jobs', { ... })`, after `rejectionReasonCounts` (line 59):

```ts
    /**
     * Per-person generation outcome for this batch (Pool Coverage Controller,
     * Phase 1): `{ person: { "2pl": { requested, approved }, … } }`. `requested`
     * counts drafts the scheduler targeted at each person; `approved` counts
     * approved drafts whose *realized* person (validator coverage) equals it.
     * The scheduler reads this back to give up on a bucket that was targeted but
     * yielded nothing. NULL on legacy rows, non-personRotation cells, and cells
     * that did no person targeting. Written by `run-one-cell`.
     */
    coverageOutcome: jsonb('coverage_outcome').$type<CoverageOutcome>(),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @language-drill/db db:generate`
Expected: a new `packages/db/migrations/0021_<name>.sql` containing
`ALTER TABLE "generation_jobs" ADD COLUMN "coverage_outcome" jsonb;` plus an updated `meta/` snapshot.

- [ ] **Step 3: Verify the generated SQL**

Run: `cat packages/db/migrations/0021_*.sql`
Expected: a single additive `ADD COLUMN ... jsonb` (nullable, no default) — forward-only, no data rewrite. If drizzle generated anything else (rename, drop), discard and re-check the schema edit.

- [ ] **Step 4: Build + typecheck**

Run: `pnpm build && pnpm --filter @language-drill/db typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/generation.ts packages/db/migrations/
git commit -m "feat(db): coverage_outcome jsonb column on generation_jobs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: Surface `realizedPerson` on `DraftOutcome`

The tally in Task 7 needs the validator's realized person for each inserted draft. Expose it on the inserted-* outcomes.

**Files:**
- Modify: `packages/db/src/generation/validate-and-insert.ts:119-168` (`DraftOutcome` type), `:476-485` (inserted return)
- Test: `packages/db/src/generation/validate-and-insert.test.ts`

- [ ] **Step 1: Write the failing test**

Inspect `validate-and-insert.test.ts` for the existing helper that drives `validateAndInsertWithRetry` (or the exported outcome builder) with a mocked validator returning a `ValidationResult`. Add a case asserting an inserted-approved outcome carries `realizedPerson`. Match the file's existing mock style; the essential assertion:

```ts
it('surfaces realizedPerson from the validator coverage on an inserted draft', async () => {
  // ARRANGE: mock validateDraft → result with coverage.person = '2pl',
  // routing → auto-approved, db.insert → returns [{ id }]. (Reuse the file's
  // existing arrange helper; set result.coverage = { person: '2pl' }.)
  const outcome = await runUnderTest(/* …existing fixture with coverage.person='2pl'… */);
  expect(outcome.terminalStatus).toBe('inserted-approved');
  expect(outcome.realizedPerson).toBe('2pl');
});
```

If the existing tests construct `ValidationResult` via a shared factory, extend that factory to allow `coverage`. If coverage defaults to `{}`, assert `realizedPerson` is `undefined` for a draft with no person coverage.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && pnpm --filter @language-drill/db test -- validate-and-insert`
Expected: FAIL — `realizedPerson` is `undefined` (field not set).

- [ ] **Step 3: Implement**

In `packages/db/src/generation/validate-and-insert.ts`, add to the `DraftOutcome` type (after `terminalReviewStatus`, ~line 127):

```ts
  /**
   * The validator's realized `coverage.person` for an inserted draft (Phase 1
   * coverage controller). Set ONLY on the inserted-* / dedup-then-success
   * branches, from the SAME `result.coverage` written to `exercises.coverageTags`.
   * `undefined` when the draft has no person coverage or the ordinal was
   * rejected/given-up. Counted by `run-one-cell` into `coverage_outcome`.
   */
  realizedPerson?: PersonCode;
```

Import `PersonCode` (`import { ..., type PersonCode } from '@language-drill/shared';` — or via the existing `@language-drill/ai`/shared import block). In the inserted-success return (line 476), add the field:

```ts
      return {
        terminalStatus,
        terminalReviewStatus: decision.reviewStatus as 'auto-approved' | 'flagged',
        realizedPerson: result.coverage.person,
        extraUsage,
        extraProduced,
        validatedCount,
      };
```

(`result.coverage` is `CoverageTags`; `.person` is `PersonCode | undefined`. The `first-attempt-dedup-then-success` status flows through this same return, so it is covered too.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && pnpm --filter @language-drill/db test -- validate-and-insert`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/generation/validate-and-insert.ts packages/db/src/generation/validate-and-insert.test.ts
git commit -m "feat(db): surface realizedPerson on inserted DraftOutcome

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: `run-one-cell` — thread `personTargets`, tally + persist `coverage_outcome`

Thread the scheduler's per-draft targets into the generation spec, tally per-person `{requested, approved}`, persist to `generation_jobs.coverage_outcome`, and expose it on `CellResult`.

**Files:**
- Modify: `packages/db/src/generation/run-one-cell.ts` — `RunOneCellInput.args` (~line 199), `CellResult` (~line 188), `spec` assembly (~line 446), success update (~line 602), success return (~line 622)
- Test: `packages/db/src/generation/run-one-cell.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `run-one-cell.test.ts`, matching its existing mock harness (mocked `client`/`db`, a personRotation TR cloze cell fixture). Two assertions: tally correctness and `null` for an untargeted cell.

```ts
it('tallies coverage_outcome by requested vs realized person', async () => {
  // ARRANGE (reuse the file's harness): a TR personRotation cloze cell;
  // args.personTargets = ['2pl', '2pl', '1pl']; count = 3.
  // Mock outcomes: ordinal0 inserted-approved realizedPerson '2pl';
  //                ordinal1 rejected (no realizedPerson);
  //                ordinal2 inserted-approved realizedPerson '1pl'.
  const result = await runOneCell(/* …input with args.personTargets=['2pl','2pl','1pl']… */);

  // requested counts every targeted slot; approved counts realized-on-approved.
  expect(result.coverageOutcome).toEqual({
    person: {
      '2pl': { requested: 2, approved: 1 },
      '1pl': { requested: 1, approved: 1 },
    },
  });

  // And it is persisted on the succeeded audit row update.
  expect(capturedJobUpdate.coverageOutcome).toEqual(result.coverageOutcome);
});

it('writes coverage_outcome = null when no personTargets supplied', async () => {
  const result = await runOneCell(/* …input WITHOUT args.personTargets… */);
  expect(result.coverageOutcome).toBeNull();
});
```

(Adapt `capturedJobUpdate` to however the test already captures the `db.update(...).set(...)` payload; if it doesn't, assert only on `result.coverageOutcome`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && pnpm --filter @language-drill/db test -- run-one-cell`
Expected: FAIL — `args.personTargets` not accepted / `result.coverageOutcome` undefined.

- [ ] **Step 3: Implement**

Imports at the top of `run-one-cell.ts`: add `type PersonCode, type CoverageOutcome, type PersonOutcome` to the `@language-drill/shared` import.

Add to `RunOneCellInput.args` (line 199-204):

```ts
  args: {
    count: number;
    batchSeed: string;
    topicDomain: string | null;
    maxCostUsd: number;
    /**
     * Phase 1 coverage controller: explicit per-ordinal person codes from the
     * scheduler (length === count). `undefined` → blind ordinal rotation and no
     * coverage_outcome tally (CLI/admin and non-personRotation cells).
     */
    personTargets?: readonly PersonCode[];
  };
```

Add to `CellResult` (after `earlyBailed`, ~line 188):

```ts
  /**
   * Per-person `{requested, approved}` tally for a person-targeted batch (Phase
   * 1). `null` when the cell did no person targeting (no `args.personTargets`).
   * Persisted to `generation_jobs.coverage_outcome`.
   */
  coverageOutcome: CoverageOutcome | null;
```

In the `spec` assembly (line 446-456), pass the targets:

```ts
    spec = {
      language: cell.language,
      cefrLevel: cell.cefrLevel,
      exerciseType: cell.exerciseType,
      grammarPoint: cell.grammarPoint,
      topicDomain: args.topicDomain,
      count: args.count,
      batchSeed: args.batchSeed,
      priorPoolSurfaces,
      seedWords,
      personTargets: args.personTargets,
    };
```

Declare the tally accumulator beside the other counters (near line 410, before the `try`):

```ts
  // Phase 1 per-person tally. `requested` counts every targeted ordinal slot;
  // `approved` counts approved drafts by their REALIZED person (DraftOutcome
  // .realizedPerson). Only built when the scheduler supplied targets.
  const personOutcome: PersonOutcome = {};
  const personTargets = args.personTargets;
  if (personTargets) {
    for (const code of personTargets) {
      const bucket = (personOutcome[code] ??= { requested: 0, approved: 0 });
      bucket.requested += 1;
    }
  }
```

Inside the per-ordinal loop (the `switch (outcome.terminalStatus)` at line 539), add `approved` counting on the two approved-inserted branches. Insert after `approvedCount += 1;` in the `'inserted-approved'` case (line 541) and in the `'first-attempt-dedup-then-success'` auto-approved branch (line 564):

```ts
        case 'inserted-approved':
          approvedCount += 1;
          insertedCount += 1;
          if (personTargets && outcome.realizedPerson) {
            const b = (personOutcome[outcome.realizedPerson] ??= { requested: 0, approved: 0 });
            b.approved += 1;
          }
          break;
```

```ts
        case 'first-attempt-dedup-then-success':
          firstAttemptSkippedCount += 1;
          insertedCount += 1;
          if (outcome.terminalReviewStatus === 'auto-approved') {
            approvedCount += 1;
            if (personTargets && outcome.realizedPerson) {
              const b = (personOutcome[outcome.realizedPerson] ??= { requested: 0, approved: 0 });
              b.approved += 1;
            }
          } else {
            flaggedCount += 1;
          }
          break;
```

(Count `approved` only for auto-approved inserts — `inserted-flagged` is not approved, consistent with how the deficit is measured from approved coverage_tags.)

Compute the persisted value once after the loop (before the success update, ~line 600):

```ts
  // NULL (not `{}`) when no person targeting happened, so the column reads as
  // "not a coverage-targeted batch" rather than an empty object.
  const coverageOutcome: CoverageOutcome | null =
    personTargets && Object.keys(personOutcome).length > 0
      ? { person: personOutcome }
      : null;
```

Add to the success `.set({ ... })` (line 604-619):

```ts
      coverageOutcome,
```

Add to the success return object (line 622-641):

```ts
    coverageOutcome,
```

Also set `coverageOutcome: null` on the `failClosed` return (the `failClosed` helper builds a `CellResult` — add `coverageOutcome: null,` to its returned object so the type is satisfied; a failed batch records no tally).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && pnpm --filter @language-drill/db test -- run-one-cell`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/generation/run-one-cell.ts packages/db/src/generation/run-one-cell.test.ts
git commit -m "feat(db): tally + persist per-person coverage_outcome in run-one-cell

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: `job-message.ts` — `personTargets` field + parse validation

**Files:**
- Modify: `infra/lambda/src/generation/job-message.ts` — `spec` type (line 38-55), parser (line 137-169), a new field validator
- Test: `infra/lambda/src/generation/job-message.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `job-message.test.ts` (mirror the existing valid-message factory it uses; assume a `validMessage()` helper or inline a full object):

```ts
describe('parseGenerationJobMessage — personTargets', () => {
  const base = {
    jobId: 'j1', trigger: 'scheduled',
    spec: {
      language: 'tr', cefrLevel: 'A2', exerciseType: 'cloze',
      grammarPointKey: 'tr-a2-aorist', topicDomain: null, count: 2,
      batchSeed: 'scheduled-2026-06-13',
    },
    maxCostUsd: 1,
  };

  it('round-trips a valid personTargets array', () => {
    const msg = { ...base, spec: { ...base.spec, personTargets: ['2pl', '1pl'] } };
    expect(parseGenerationJobMessage(msg).spec.personTargets).toEqual(['2pl', '1pl']);
  });

  it('omits personTargets when absent (back-compat)', () => {
    expect(parseGenerationJobMessage(base).spec.personTargets).toBeUndefined();
  });

  it('rejects an unknown person code', () => {
    const msg = { ...base, spec: { ...base.spec, personTargets: ['2pl', 'zz'] } };
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.personTargets/);
  });

  it('rejects length !== count', () => {
    const msg = { ...base, spec: { ...base.spec, personTargets: ['2pl'] } }; // count is 2
    expect(() => parseGenerationJobMessage(msg)).toThrow(/spec\.personTargets/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && pnpm --filter @language-drill/lambda test -- job-message`
Expected: FAIL — `personTargets` not parsed (first test: `undefined`; error tests: no throw).

- [ ] **Step 3: Implement**

Import the codes for validation. At the top of `job-message.ts`:

```ts
import { PERSON_CODES, type PersonCode } from '@language-drill/shared';
```

Add a runtime set near the other allowed-value sets (~line 101):

```ts
const VALID_PERSON_CODES: ReadonlySet<string> = new Set(PERSON_CODES);
```

Add the optional field to the `spec` type (after `batchSeed`, line 54):

```ts
    /**
     * Phase 1 coverage controller: explicit per-draft person codes. When
     * present, MUST be an array of known `PersonCode`s of length === `count`.
     * Absent on CLI/admin and non-personRotation scheduled cells.
     */
    personTargets?: PersonCode[];
```

Add a validator helper (near the other `require*` functions):

```ts
function optionalPersonTargets(
  spec: Record<string, unknown>,
  count: number,
): PersonCode[] | undefined {
  const value = spec['personTargets'];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(
      `spec.personTargets: expected array or undefined, got ${describe(value)}`,
    );
  }
  if (value.length !== count) {
    throw new Error(
      `spec.personTargets: expected length === spec.count (${count}), got ${value.length}`,
    );
  }
  for (const code of value) {
    if (typeof code !== 'string' || !VALID_PERSON_CODES.has(code)) {
      throw new Error(
        `spec.personTargets: expected each to be one of ${JSON.stringify(
          Array.from(VALID_PERSON_CODES),
        )}, got ${JSON.stringify(code)}`,
      );
    }
  }
  return value as PersonCode[];
}
```

In `parseGenerationJobMessage`, after `batchSeed` is read (line 152), add:

```ts
  const personTargets = optionalPersonTargets(specValue, count);
```

And include it in the returned `spec` (line 159-169):

```ts
    spec: {
      language: language as LearningLanguage,
      cefrLevel: cefrLevel as CurriculumCefrLevel,
      exerciseType: exerciseType as ExerciseType,
      grammarPointKey,
      topicDomain,
      count,
      batchSeed,
      ...(personTargets !== undefined ? { personTargets } : {}),
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && pnpm --filter @language-drill/lambda test -- job-message`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/generation/job-message.ts infra/lambda/src/generation/job-message.test.ts
git commit -m "feat(generation): personTargets field + parse validation on job message

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9: `handler.ts` — thread `personTargets` into `runOneCell`

**Files:**
- Modify: `infra/lambda/src/generation/handler.ts:239-243` (the `args` object)
- Test: `infra/lambda/src/generation/handler.test.ts`

- [ ] **Step 1: Write the failing test**

Inspect `handler.test.ts` for how it asserts the `runOneCell` call args (it mocks `runOneCell` from `@language-drill/db`). Add a case: a parsed message with `spec.personTargets` passes them through.

```ts
it('forwards spec.personTargets to runOneCell args', async () => {
  // ARRANGE: an SQS event whose body has spec.personTargets = ['2pl','1pl']
  // and count 2 (reuse the file's event factory + runOneCell mock).
  await handler(buildEvent({ personTargets: ['2pl', '1pl'], count: 2 }), ctx);
  expect(runOneCellMock).toHaveBeenCalledWith(
    expect.objectContaining({
      args: expect.objectContaining({ personTargets: ['2pl', '1pl'] }),
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && pnpm --filter @language-drill/lambda test -- handler`
Expected: FAIL — `args.personTargets` is `undefined` (not threaded).

- [ ] **Step 3: Implement**

In `handler.ts`, add to the `args` object passed to `runOneCell` (line 239-243):

```ts
              args: {
                count: parsed.spec.count,
                batchSeed: parsed.spec.batchSeed,
                topicDomain: parsed.spec.topicDomain,
                maxCostUsd: parsed.maxCostUsd,
                personTargets: parsed.spec.personTargets,
              },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && pnpm --filter @language-drill/lambda test -- handler`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/generation/handler.ts infra/lambda/src/generation/handler.test.ts
git commit -m "feat(generation): thread personTargets through handler to runOneCell

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10: `scheduler.ts` — measure per-person deficit, emit `personTargets`

The closing link: read the per-person approved distribution and the recent job's `coverage_outcome`, run `decideCoverageTargets` for personRotation cells, and attach `personTargets` to the message.

**Files:**
- Modify: `infra/lambda/src/generation/scheduler-decision.ts:79-86` (`RecentJob` type)
- Modify: `infra/lambda/src/generation/scheduler.ts` — recent-job query (line 86-118), a new per-person aggregate, message build (line 257-270)
- Test: `infra/lambda/src/generation/scheduler.test.ts`

- [ ] **Step 1: Extend the `RecentJob` type**

In `scheduler-decision.ts`, import the type and add the field (this is consumed only by the scheduler, not by `decideEnqueue`):

```ts
import { ROUND_1_CEFR_LEVELS, type Cell } from '@language-drill/db';
import type { CoverageOutcome } from '@language-drill/shared';
```

Add to `RecentJob` (after `curriculumVersion`, line 84):

```ts
  /** Phase 1: the most recent job's per-person outcome (NULL on legacy rows /
   *  non-personRotation cells). Read by the scheduler's coverage controller,
   *  not by `decideEnqueue`. */
  coverageOutcome: CoverageOutcome | null;
```

- [ ] **Step 2: Write the failing test**

Add to `scheduler.test.ts`, matching its existing mock harness (it mocks the SQS client and the `db` query builder, and asserts on the `SendMessageBatchCommand` entries). Two cases:

```ts
it('attaches deficit-weighted personTargets for a personRotation cell', async () => {
  // ARRANGE: stub the approved-count aggregate so a TR personRotation cloze
  // cell is under target; stub the per-person aggregate so the pool is skewed
  // (e.g. 2pl/3pl starved); no recent coverage_outcome.
  // ACT
  await handler();
  // ASSERT: the message body for that cell carries spec.personTargets summing
  // to `need`, weighted toward the starved persons, never '3sg'-heavy.
  const body = JSON.parse(sentEntryFor('tr:a2:cloze:tr-a2-aorist').MessageBody);
  expect(body.spec.personTargets).toHaveLength(body.spec.count);
  expect(body.spec.personTargets).toContain('2pl');
});

it('omits personTargets for a non-personRotation cell', async () => {
  const body = JSON.parse(sentEntryFor('<a non-personRotation cell key>').MessageBody);
  expect(body.spec.personTargets).toBeUndefined();
});
```

Adapt `sentEntryFor` to the file's existing way of reaching into the captured SQS entries. If the harness can't easily stub a second aggregate, factor the per-person query into a small exported helper (like `loadMostRecentSucceededJobPerCell`) and stub that — keep the same pattern the file already uses.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm build && pnpm --filter @language-drill/lambda test -- scheduler.test`
Expected: FAIL — `spec.personTargets` is `undefined` on the personRotation cell.

- [ ] **Step 4: Implement — extend the recent-job query**

In `scheduler.ts`, extend `loadMostRecentSucceededJobPerCell` to select and map `coverage_outcome` (line 86-118):

```ts
  const result = await db.execute(sql`
    SELECT DISTINCT ON (cell_key)
           cell_key, approved_count, requested_count, dedup_given_up_count,
           curriculum_version, coverage_outcome, finished_at
    FROM generation_jobs
    WHERE status = 'succeeded'
    ORDER BY cell_key, started_at DESC
  `);

  type Row = {
    cell_key: string;
    approved_count: number;
    requested_count: number;
    dedup_given_up_count: number;
    curriculum_version: string | null;
    coverage_outcome: CoverageOutcome | null;
    finished_at: Date | string;
  };
```

And in the row mapping, add `coverageOutcome: row.coverage_outcome,`. Import `CoverageOutcome` from `@language-drill/shared` at the top of `scheduler.ts`.

- [ ] **Step 5: Implement — per-person approved aggregate**

Add a helper beside `loadMostRecentSucceededJobPerCell`:

```ts
/**
 * Phase 1: approved-pool person distribution per cell, for the coverage
 * controller. Mirrors the Phase-0 /admin/pool-status aggregate, scoped to the
 * approved pool. Keyed by `cell_key` → { personCode: count }.
 */
async function loadApprovedPersonCountsPerCell(
  db: Db,
): Promise<Map<string, Partial<Record<PersonCode, number>>>> {
  const result = await db.execute(sql`
    SELECT language, difficulty, type, grammar_point_key AS grammar_point_key,
           coverage_tags->>'person' AS person,
           COUNT(*)::int AS n
    FROM exercises
    WHERE review_status IN ('auto-approved', 'manual-approved')
      AND coverage_tags->>'person' IS NOT NULL
    GROUP BY language, difficulty, type, grammar_point_key, coverage_tags->>'person'
  `);

  type Row = {
    language: string; difficulty: string; type: string;
    grammar_point_key: string; person: string; n: number;
  };
  const rows = result.rows as unknown as Row[];
  const map = new Map<string, Partial<Record<PersonCode, number>>>();
  for (const row of rows) {
    const key = buildCellKeyFromRow({
      language: row.language, difficulty: row.difficulty,
      type: row.type, grammarPointKey: row.grammar_point_key,
    });
    const bucket = map.get(key) ?? {};
    bucket[row.person as PersonCode] = row.n;
    map.set(key, bucket);
  }
  return map;
}
```

Import `PersonCode` from `@language-drill/shared` and `decideCoverageTargets` from `./coverage-decision`. (Reuse the existing `buildCellKeyFromRow` already imported in this file.) Call it once in `handler` alongside the recent-job load (after line 180):

```ts
  const approvedPersonByCell = await loadApprovedPersonCountsPerCell(db);
```

- [ ] **Step 6: Implement — compute targets in the message build**

`decideEnqueue` and the `undersized` collection stay as-is. In the message-build `.map` (line 257-270), compute targets per cell. Replace the map body:

```ts
  const messages: GenerationJobMessage[] = undersized.map(({ cell, need }) => {
    const base = {
      jobId: deterministicUuid([cell.cellKey, batchSeed].join('|')),
      trigger: 'scheduled' as const,
      spec: {
        language: cell.language,
        cefrLevel: cell.cefrLevel,
        exerciseType: cell.exerciseType,
        grammarPointKey: cell.grammarPoint.key,
        topicDomain: null,
        count: need,
        batchSeed,
      },
      maxCostUsd: SCHEDULER_PER_CELL_COST_CAP_USD,
    };

    // Phase 1 coverage controller — person axis, personRotation cells only.
    if (cell.grammarPoint.personRotation !== true) return base;

    const recentJob = recentJobByCell.get(cell.cellKey) ?? null;
    const curriculumVersionOnDisk =
      CURRICULUM_VERSION_BY_LANGUAGE[cell.language as LearningLanguage];
    // Give-up clears on a curriculum bump: only feed the recent outcome when its
    // version still matches on-disk (same gate as decideEnqueue's suppression).
    const recentOutcome =
      recentJob &&
      recentJob.curriculumVersion === curriculumVersionOnDisk
        ? (recentJob.coverageOutcome?.person ?? null)
        : null;

    const { personTargets, suppressed } = decideCoverageTargets({
      language: cell.language,
      need,
      approvedByPerson: approvedPersonByCell.get(cell.cellKey) ?? {},
      recentOutcome,
    });

    if (suppressed.length > 0) {
      log({
        level: 'info',
        cellKey: cell.cellKey,
        suppressed,
        message: 'coverage controller: person buckets given up',
      });
    }

    if (personTargets.length === 0) return base; // blind fallback

    return { ...base, spec: { ...base.spec, personTargets } };
  });
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm build && pnpm --filter @language-drill/lambda test -- scheduler.test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add infra/lambda/src/generation/scheduler.ts infra/lambda/src/generation/scheduler-decision.ts infra/lambda/src/generation/scheduler.test.ts
git commit -m "feat(generation): coverage-aware scheduler emits person targets

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 11: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Build everything**

Run: `pnpm build`
Expected: PASS (all packages compile against the new shared types).

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: zero errors.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Test (serialized to avoid the known infra parallel flake)**

Run: `pnpm turbo run test --concurrency=1`
Expected: all packages green. If `infra` flakes under load, this serialized run is the source of truth per project memory.

- [ ] **Step 5: Confirm prompt-version note**

No `GENERATION_PROMPT_VERSION` bump is required — the cached generation system prompt is byte-identical (the person directive lives in the per-draft user prompt, which only changed *which* person string it carries). Confirm `git diff main -- packages/ai/src/generation-prompts.ts` shows no change to `GENERATION_SYSTEM_PROMPT_TEMPLATE`. State this explicitly in the PR description so a reviewer doesn't expect a Langfuse `push-prompts` sync.

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore: Phase 1 coverage controller — suite green

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review notes (author)

- **Spec coverage:** Component 1 → Task 4; Component 2 (message + prompt) → Tasks 1, 3, 8, 9; Component 3 (persist outcome) → Tasks 2, 5, 6, 7; Component 4 (scheduler wiring) → Task 10. Give-up gating on curriculum version → Task 10 Step 6. Realized-vs-requested counting → Tasks 6 + 7.
- **`decideEnqueue` untouched:** confirmed — Task 10 only extends the `RecentJob` projection (new field, unread by `decideEnqueue`) and the message-build map; the decision precedence is unchanged.
- **Type consistency:** `PersonCode` (shared) used uniformly across ai/db/infra; `PersonOutcome` is the `.person` sub-object passed to `decideCoverageTargets`, `CoverageOutcome = { person?: PersonOutcome }` is the column/`CellResult`/`RecentJob` shape — the scheduler unwraps `coverageOutcome?.person` (Task 10 Step 6) and `run-one-cell` wraps `{ person: personOutcome }` (Task 7 Step 3). `decideCoverageTargets` / `GIVE_UP_MIN_ATTEMPTS` names are consistent between Task 4 definition and Task 10 use.
- **No silent caps:** suppressed buckets are logged (Task 10 Step 6).
