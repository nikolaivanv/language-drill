# Variant-Seed Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Label the approved cloze/translation pool of the 31 `constructionVariants` grammar points with the variant id each row actually realizes, so `pickVariantSeeds` and `pnpm audit:collapse` can see real coverage.

**Architecture:** A pure classifier module in `packages/ai/src` (prompt, forced tool, parser — no I/O, no `db` import) plus a CLI in `packages/db/scripts` that owns the SQL, batching, cost guard, rollback artifact, and apply/revert modes. `packages/db` depends on `@language-drill/ai`, never the reverse; `backfill-coverage-tags.ts` is the precedent for this exact split.

**Tech Stack:** TypeScript, pnpm workspaces, Drizzle ORM, Vitest, `@anthropic-ai/sdk` (forced tool use), `tsx` for the CLI entrypoint.

## Global Constraints

- **`packages/ai/src` MUST NOT import `@language-drill/db`.** Passes locally, fails CI with TS2307. The grammar point arrives as an injected `GrammarPoint` from `@language-drill/shared`.
- **`packages/db/scripts` MAY import `@language-drill/ai`** — `packages/db/package.json` already declares that dependency.
- **Writes are keyed on the row's primary key only.** Never pattern-match content in a `WHERE` clause to decide what to update. This is the central safety property of the design.
- **Dry-run is the default.** `--apply` writes. `--apply` additionally REQUIRES `--snapshot <branch-id>` or an explicit `--no-snapshot`.
- **Only `high` confidence writes by default**; `--min-confidence medium` widens it. `low` never writes.
- **A `null` classification is a valid, expected outcome** — those rows are left untouched.
- **Scope guard:** only `cloze`/`translation` rows on grammar points declaring `constructionVariants`. Refuse everything else.
- Approved rows means `review_status IN ('auto-approved','manual-approved')`.
- This CLI lives in `packages/db/scripts`, whose arg parsers use a manual `for` loop that **skips a bare `--`** (unlike the `packages/ai` scripts). Follow that convention so `pnpm backfill:variant-seeds -- --apply` works, matching CLAUDE.md's style for `db` CLIs.
- The classifier prompt is an in-repo dev-time aid: **NOT Langfuse-registered**, and must NOT be added to the `PROMPTS` manifest in `packages/ai/scripts/bootstrap-prompts.ts`.
- No schema change, no migration, no `CURRICULUM_VERSION_*` bump.
- Every commit message ends with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Work on branch `docs/variant-seed-backfill-spec` (already created; the design doc is its first commit).

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/ai/src/variant-seed-classifier.ts` | Create | Prompt, forced tool, pure parser, one client call |
| `packages/ai/src/variant-seed-classifier.test.ts` | Create | Prompt-content and parser tests |
| `packages/ai/src/index.ts` | Modify | Barrel re-exports |
| `packages/db/scripts/backfill-variant-seeds.ts` | Create | Args, row selection, batching, cost guard, artifact, apply/revert |
| `packages/db/scripts/backfill-variant-seeds.test.ts` | Create | Tests for the pure helpers |
| `packages/db/package.json` | Modify | `backfill:variant-seeds` script |
| `package.json` | Modify | Root passthrough with `dotenv -e .env` |
| `.gitignore` | Modify | Ignore `packages/db/backfill-runs/` |
| `CLAUDE.md` | Modify | CLI table row |

---

### Task 1: The pure classifier — prompt, tool, parser

**Files:**
- Create: `packages/ai/src/variant-seed-classifier.ts`
- Create: `packages/ai/src/variant-seed-classifier.test.ts`

**Interfaces:**
- Consumes: `GrammarPoint`, `ConstructionVariant` from `@language-drill/shared`.
- Produces: `VARIANT_SEED_CLASSIFIER_PROMPT_VERSION`, `VARIANT_SEED_CLASSIFIER_TOOL_NAME`, `VARIANT_SEED_CLASSIFIER_MODEL`, `VARIANT_SEED_CLASSIFIER_MAX_TOKENS`, `VARIANT_SEED_CLASSIFIER_TEMPERATURE`, `VARIANT_SEED_CLASSIFIER_TOOL`, `type ClassifierRow`, `type ClassifierAssignment`, `type ClassifierConfidence`, `buildClassifierSystemPrompt()`, `buildClassifierUserPrompt()`, `parseClassifierResult()`. Task 2 adds `classifyVariantSeeds()`; Task 4 consumes all of it.

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/variant-seed-classifier.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { GrammarPoint } from '@language-drill/shared';
import {
  buildClassifierSystemPrompt,
  buildClassifierUserPrompt,
  parseClassifierResult,
  VARIANT_SEED_CLASSIFIER_TOOL,
  type ClassifierRow,
} from './variant-seed-classifier.js';

const gp: GrammarPoint = {
  key: 'es-b1-que-vs-cual',
  kind: 'grammar',
  name: 'qué vs cuál',
  description: 'Interrogatives qué and cuál.',
  cefrLevel: 'B1',
  language: 'ES',
  examplesPositive: ['¿Qué es la democracia?', '¿Cuál prefieres?'],
  examplesNegative: ['*¿Cuál libro lees?'],
  commonErrors: ['Using cuál before a noun.'],
  constructionVariants: [
    { id: 'que-definition-of-concept', directive: 'qué asking for a definition (¿Qué es la democracia?)' },
    { id: 'cual-selection-from-set', directive: 'cuál selecting from a known set (¿Cuál prefieres?)' },
    { id: 'que-before-noun', directive: 'qué directly before a noun (¿Qué libro lees?)' },
  ],
} as GrammarPoint;

const rows: ClassifierRow[] = [
  { rowId: 'r1', prompt: '¿___ es la democracia?', answer: 'Qué' },
  { rowId: 'r2', prompt: '¿___ libro estás leyendo?', answer: 'Qué' },
];

describe('buildClassifierSystemPrompt', () => {
  it('lists every declared variant id with its directive', () => {
    const p = buildClassifierSystemPrompt(gp);
    for (const v of gp.constructionVariants!) {
      expect(p).toContain(v.id);
      expect(p).toContain(v.directive);
    }
  });

  it('includes the point name and description for context', () => {
    const p = buildClassifierSystemPrompt(gp);
    expect(p).toContain('qué vs cuál');
    expect(p).toContain('Interrogatives qué and cuál.');
  });

  it('tells the model null is a valid answer and that guessing is worse', () => {
    const p = buildClassifierSystemPrompt(gp);
    expect(p.toLowerCase()).toContain('null');
    expect(p.toLowerCase()).toContain('guess');
  });
});

describe('buildClassifierUserPrompt', () => {
  it('includes each row id, prompt and answer', () => {
    const p = buildClassifierUserPrompt(rows);
    expect(p).toContain('r1');
    expect(p).toContain('¿___ es la democracia?');
    expect(p).toContain('Qué');
    expect(p).toContain('r2');
    expect(p).toContain('¿___ libro estás leyendo?');
  });
});

describe('parseClassifierResult', () => {
  const ok = {
    assignments: [
      { rowId: 'r1', variantId: 'que-definition-of-concept', confidence: 'high' },
      { rowId: 'r2', variantId: 'que-before-noun', confidence: 'medium' },
    ],
  };

  it('accepts a well-formed result covering every row', () => {
    const out = parseClassifierResult(ok, gp, rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ rowId: 'r1', variantId: 'que-definition-of-concept', confidence: 'high' });
  });

  it('accepts a null variantId — an unclassifiable row is a valid outcome', () => {
    const out = parseClassifierResult(
      { assignments: [
        { rowId: 'r1', variantId: null, confidence: 'low' },
        { rowId: 'r2', variantId: null, confidence: 'low' },
      ] },
      gp,
      rows,
    );
    expect(out[0].variantId).toBeNull();
  });

  it('rejects a variantId not declared on this point', () => {
    expect(() =>
      parseClassifierResult(
        { assignments: [
          { rowId: 'r1', variantId: 'hearsay-dicen-que', confidence: 'high' },
          { rowId: 'r2', variantId: null, confidence: 'low' },
        ] },
        gp,
        rows,
      ),
    ).toThrow(/variantId/);
  });

  it('rejects a rowId that was not in the batch', () => {
    expect(() =>
      parseClassifierResult(
        { assignments: [
          { rowId: 'r1', variantId: null, confidence: 'low' },
          { rowId: 'INVENTED', variantId: null, confidence: 'low' },
        ] },
        gp,
        rows,
      ),
    ).toThrow(/rowId/);
  });

  it('rejects a batch with a row missing — a silent drop must not pass', () => {
    expect(() =>
      parseClassifierResult({ assignments: [{ rowId: 'r1', variantId: null, confidence: 'low' }] }, gp, rows),
    ).toThrow(/missing/);
  });

  it('rejects a duplicated rowId', () => {
    expect(() =>
      parseClassifierResult(
        { assignments: [
          { rowId: 'r1', variantId: null, confidence: 'low' },
          { rowId: 'r1', variantId: null, confidence: 'low' },
        ] },
        gp,
        rows,
      ),
    ).toThrow(/duplicate/);
  });

  it('rejects an unknown confidence', () => {
    expect(() =>
      parseClassifierResult(
        { assignments: [
          { rowId: 'r1', variantId: null, confidence: 'certain' },
          { rowId: 'r2', variantId: null, confidence: 'low' },
        ] },
        gp,
        rows,
      ),
    ).toThrow(/confidence/);
  });

  it('rejects a non-object or a missing assignments array', () => {
    expect(() => parseClassifierResult(null, gp, rows)).toThrow();
    expect(() => parseClassifierResult({}, gp, rows)).toThrow(/assignments/);
  });

  it('throws for a point with no constructionVariants', () => {
    const bare = { ...gp, constructionVariants: undefined } as GrammarPoint;
    expect(() => parseClassifierResult(ok, bare, rows)).toThrow(/constructionVariants/);
  });
});

describe('VARIANT_SEED_CLASSIFIER_TOOL', () => {
  it('requires the assignments array', () => {
    expect(VARIANT_SEED_CLASSIFIER_TOOL.input_schema.required).toEqual(['assignments']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- variant-seed-classifier`
Expected: FAIL — `Failed to resolve import "./variant-seed-classifier.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/ai/src/variant-seed-classifier.ts`:

```ts
/**
 * Variant-seed classifier (2026-08-11 design). In-repo prompt + forced tool +
 * pure parser, mirroring `collapse-triage.ts`. NOT a runtime path and NOT
 * registered in Langfuse — a dev-time aid for the one-off
 * `backfill:variant-seeds` CLI. Do NOT add it to the PROMPTS manifest in
 * `bootstrap-prompts.ts`.
 *
 * Classifies EXISTING approved exercises into the sub-construction
 * (`constructionVariants` entry) each one actually realizes, so the legacy pool
 * can be labelled. Several points' variants are distinguished by syntax rather
 * than lexeme — `es-b1-que-vs-cual` has three variants that all answer `qué` —
 * which is why this cannot be a regex.
 */

import type Anthropic from '@anthropic-ai/sdk';

import type { GrammarPoint } from '@language-drill/shared';

export const VARIANT_SEED_CLASSIFIER_PROMPT_VERSION = 'variant-seed-classifier@2026-08-11';
export const VARIANT_SEED_CLASSIFIER_TOOL_NAME = 'classify_variant_seeds';
export const VARIANT_SEED_CLASSIFIER_MODEL = 'claude-sonnet-4-6';
export const VARIANT_SEED_CLASSIFIER_MAX_TOKENS = 4096;
/** Deterministic: this is a labelling task, not a creative one. */
export const VARIANT_SEED_CLASSIFIER_TEMPERATURE = 0;

const CONFIDENCES = ['high', 'medium', 'low'] as const;
export type ClassifierConfidence = (typeof CONFIDENCES)[number];

/** One row presented to the classifier. Learner-visible content only. */
export type ClassifierRow = {
  rowId: string;
  /** cloze: the stem with its blank. translation: the L1 source text. */
  prompt: string;
  /** cloze: `correctAnswer`. translation: `referenceTranslation`. */
  answer: string;
};

export type ClassifierAssignment = {
  rowId: string;
  /** A declared variant id, or null when no declared variant fits. */
  variantId: string | null;
  confidence: ClassifierConfidence;
};

export function buildClassifierSystemPrompt(gp: GrammarPoint): string {
  const variants = gp.constructionVariants;
  if (!variants || variants.length === 0) {
    throw new Error(`point '${gp.key}' declares no constructionVariants`);
  }
  const list = variants.map((v) => `- ${v.id}: ${v.directive}`).join('\n');

  return `You label existing language-exercise items with the sub-construction each one uses.

The grammar point below has several distinct sub-constructions. Every exercise was written before those sub-constructions were declared, so none of them is labelled. Your job is to read each exercise and say which sub-construction it actually realizes.

Grammar point: ${gp.name} (${gp.key}, ${gp.language} ${gp.cefrLevel})
Description: ${gp.description}

Sub-constructions:
${list}

Rules:
- Judge what the exercise ACTUALLY does, not what it could be rewritten to do.
- Several sub-constructions may share a surface answer. Decide from the whole sentence — the syntax and the meaning — not from the answer word alone.
- If no declared sub-construction genuinely fits, return null for that row. **null is a correct, expected answer and is strongly preferred over a guess.** An unlabelled row is harmless; a wrongly-labelled one corrupts the pool's measured coverage.
- Use "high" confidence only when the sentence makes the choice unambiguous. Use "low" when you are unsure — low-confidence labels are discarded.
- Return exactly one assignment for every row id you were given, and invent no other row ids.

Call the ${VARIANT_SEED_CLASSIFIER_TOOL_NAME} tool.`;
}

export function buildClassifierUserPrompt(rows: readonly ClassifierRow[]): string {
  const body = rows
    .map((r) => `[${r.rowId}]\n  exercise: ${r.prompt}\n  answer: ${r.answer}`)
    .join('\n\n');
  return `Classify each of these ${rows.length} exercises:\n\n${body}`;
}

export const VARIANT_SEED_CLASSIFIER_TOOL: Anthropic.Tool = {
  name: VARIANT_SEED_CLASSIFIER_TOOL_NAME,
  description: 'Assign each exercise row to one declared sub-construction, or null.',
  input_schema: {
    type: 'object' as const,
    properties: {
      assignments: {
        type: 'array',
        description: 'Exactly one entry per row id given, same ids, no others.',
        items: {
          type: 'object',
          properties: {
            rowId: { type: 'string' },
            variantId: {
              type: ['string', 'null'],
              description: 'A declared sub-construction id, or null if none fits.',
            },
            confidence: { type: 'string', enum: [...CONFIDENCES] },
          },
          required: ['rowId', 'variantId', 'confidence'],
        },
      },
    },
    required: ['assignments'],
  },
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Pure validator. Throws on any illegality — the CLI catches per batch and
 * leaves that batch's rows unclassified, which is the safe outcome.
 *
 * The completeness checks matter as much as the legality ones: a silently
 * dropped row would look identical to "the model chose not to label it", and
 * we want the difference to be visible.
 */
export function parseClassifierResult(
  input: unknown,
  gp: GrammarPoint,
  rows: readonly ClassifierRow[],
): ClassifierAssignment[] {
  const variants = gp.constructionVariants;
  if (!variants || variants.length === 0) {
    throw new Error(`point '${gp.key}' declares no constructionVariants`);
  }
  const declared = new Set(variants.map((v) => v.id));
  const expected = new Set(rows.map((r) => r.rowId));

  if (!isObject(input) || !Array.isArray(input.assignments)) {
    throw new Error('result must be an object with an `assignments` array');
  }

  const seen = new Set<string>();
  const out: ClassifierAssignment[] = [];

  for (const raw of input.assignments) {
    if (!isObject(raw) || typeof raw.rowId !== 'string') {
      throw new Error('each assignment needs a string `rowId`');
    }
    const rowId = raw.rowId;
    if (!expected.has(rowId)) throw new Error(`unknown rowId '${rowId}' — not in this batch`);
    if (seen.has(rowId)) throw new Error(`duplicate rowId '${rowId}'`);
    seen.add(rowId);

    const variantId = raw.variantId;
    if (variantId !== null && typeof variantId !== 'string') {
      throw new Error(`rowId '${rowId}': variantId must be a string or null`);
    }
    if (typeof variantId === 'string' && !declared.has(variantId)) {
      throw new Error(`rowId '${rowId}': variantId '${variantId}' is not declared on '${gp.key}'`);
    }

    const confidence = raw.confidence;
    if (typeof confidence !== 'string' || !(CONFIDENCES as readonly string[]).includes(confidence)) {
      throw new Error(`rowId '${rowId}': unknown confidence '${String(confidence)}'`);
    }

    out.push({ rowId, variantId, confidence: confidence as ClassifierConfidence });
  }

  if (seen.size !== expected.size) {
    const missing = [...expected].filter((id) => !seen.has(id));
    throw new Error(`missing assignments for: ${missing.join(', ')}`);
  }

  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- variant-seed-classifier`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/variant-seed-classifier.ts packages/ai/src/variant-seed-classifier.test.ts
git commit -m "feat(ai): variant-seed classifier prompt, tool, and parser

Labels existing exercises with the constructionVariants entry each realizes.
Cannot be a regex: several points' variants are distinguished by syntax, not
lexeme (es-b1-que-vs-cual has three that all answer qué).

The parser rejects dropped and duplicated rows, not just illegal values — a
silent drop would be indistinguishable from a deliberate null.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The client call

**Files:**
- Modify: `packages/ai/src/variant-seed-classifier.ts`
- Modify: `packages/ai/src/variant-seed-classifier.test.ts`
- Modify: `packages/ai/src/index.ts`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `classifyVariantSeeds(client, gp, rows, signal?): Promise<{ assignments: ClassifierAssignment[]; usage: Anthropic.Usage }>`, plus barrel exports. Task 4 calls it.

- [ ] **Step 1: Write the failing test**

Append to `packages/ai/src/variant-seed-classifier.test.ts`:

```ts
import { vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  classifyVariantSeeds,
  VARIANT_SEED_CLASSIFIER_TOOL_NAME,
  VARIANT_SEED_CLASSIFIER_MODEL,
} from './variant-seed-classifier.js';

const fakeClient = (content: unknown[], stopReason = 'tool_use') =>
  ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content,
        stop_reason: stopReason,
        usage: { input_tokens: 1200, output_tokens: 150 },
      }),
    },
  }) as unknown as Anthropic;

describe('classifyVariantSeeds', () => {
  const toolUse = {
    type: 'tool_use',
    name: VARIANT_SEED_CLASSIFIER_TOOL_NAME,
    id: 't1',
    input: {
      assignments: [
        { rowId: 'r1', variantId: 'que-definition-of-concept', confidence: 'high' },
        { rowId: 'r2', variantId: 'que-before-noun', confidence: 'high' },
      ],
    },
  };

  it('forces the tool, caches the system block, and returns assignments plus usage', async () => {
    const client = fakeClient([toolUse]);
    const { assignments, usage } = await classifyVariantSeeds(client, gp, rows);
    expect(assignments).toHaveLength(2);
    expect(usage.input_tokens).toBe(1200);

    const call = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.model).toBe(VARIANT_SEED_CLASSIFIER_MODEL);
    expect(call.temperature).toBe(0);
    expect(call.tool_choice).toEqual({ type: 'tool', name: VARIANT_SEED_CLASSIFIER_TOOL_NAME });
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('throws a diagnostic error when no tool_use block comes back', async () => {
    await expect(
      classifyVariantSeeds(fakeClient([{ type: 'text', text: 'hm' }], 'end_turn'), gp, rows),
    ).rejects.toThrow(/no tool_use block .*end_turn/);
  });

  it('propagates a parser error for a malformed result', async () => {
    const bad = { ...toolUse, input: { assignments: [{ rowId: 'r1', variantId: null, confidence: 'low' }] } };
    await expect(classifyVariantSeeds(fakeClient([bad]), gp, rows)).rejects.toThrow(/missing/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- variant-seed-classifier`
Expected: FAIL — `classifyVariantSeeds is not exported`.

- [ ] **Step 3: Write the implementation**

Append to `packages/ai/src/variant-seed-classifier.ts`:

```ts
/**
 * Call Claude with the forced tool and return validated assignments plus token
 * usage (the CLI's cost guard needs it). The system block carries the point's
 * variant list and is identical for every batch within a cell, so it is
 * cache-marked — a large cell is many calls against one cached prefix.
 */
export async function classifyVariantSeeds(
  client: Anthropic,
  gp: GrammarPoint,
  rows: readonly ClassifierRow[],
  signal?: AbortSignal,
): Promise<{ assignments: ClassifierAssignment[]; usage: Anthropic.Usage }> {
  const response = await client.messages.create(
    {
      model: VARIANT_SEED_CLASSIFIER_MODEL,
      max_tokens: VARIANT_SEED_CLASSIFIER_MAX_TOKENS,
      system: [
        {
          type: 'text' as const,
          text: buildClassifierSystemPrompt(gp),
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user' as const, content: buildClassifierUserPrompt(rows) }],
      tools: [VARIANT_SEED_CLASSIFIER_TOOL],
      tool_choice: { type: 'tool' as const, name: VARIANT_SEED_CLASSIFIER_TOOL_NAME },
      temperature: VARIANT_SEED_CLASSIFIER_TEMPERATURE,
    },
    { signal },
  );
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) {
    throw new Error(`classifier: no tool_use block (stop_reason ${response.stop_reason})`);
  }
  return { assignments: parseClassifierResult(toolUse.input, gp, rows), usage: response.usage };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- variant-seed-classifier`
Expected: PASS, 17 tests.

- [ ] **Step 5: Add the barrel exports**

Append to `packages/ai/src/index.ts`:

```ts
export {
  VARIANT_SEED_CLASSIFIER_PROMPT_VERSION,
  VARIANT_SEED_CLASSIFIER_TOOL_NAME,
  VARIANT_SEED_CLASSIFIER_MODEL,
  VARIANT_SEED_CLASSIFIER_TOOL,
  buildClassifierSystemPrompt,
  buildClassifierUserPrompt,
  parseClassifierResult,
  classifyVariantSeeds,
} from "./variant-seed-classifier.js";
export type {
  ClassifierRow,
  ClassifierAssignment,
  ClassifierConfidence,
} from "./variant-seed-classifier.js";
```

- [ ] **Step 6: Build and run the full gate**

`packages/db` resolves `@language-drill/ai` through its `dist`, so the next task needs a fresh build.

Run: `pnpm build && pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures. (If lambda tests fail oddly, `rm -rf infra/lambda/dist` first — stale compiled test files cause phantom failures.)

- [ ] **Step 7: Commit**

```bash
git add packages/ai/src/variant-seed-classifier.ts packages/ai/src/variant-seed-classifier.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): classifyVariantSeeds — batched forced-tool call

Cache-marks the per-point system block: a large cell is many batches against
one cached prefix. Returns usage for the CLI's cost guard.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: CLI — args, eligibility, and the artifact shape

**Files:**
- Create: `packages/db/scripts/backfill-variant-seeds.ts`
- Create: `packages/db/scripts/backfill-variant-seeds.test.ts`

**Interfaces:**
- Consumes: `ClassifierRow` from `@language-drill/ai`; `GrammarPoint`, `Language`, `CefrLevel`, `ExerciseType` from `@language-drill/shared`; `getGrammarPoint` from `../src/curriculum`.
- Produces: `type BackfillArgs`, `parseBackfillArgs()`, `type CandidateRow`, `isEligible()`, `toClassifierRow()`, `type ArtifactEntry`, `type Artifact`. Task 4 consumes all of them.

- [ ] **Step 1: Write the failing test**

Create `packages/db/scripts/backfill-variant-seeds.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import type { GrammarPoint } from '@language-drill/shared';
import {
  parseBackfillArgs,
  isEligible,
  toClassifierRow,
  type CandidateRow,
} from './backfill-variant-seeds';

const withVariants = {
  key: 'es-b1-que-vs-cual',
  kind: 'grammar',
  constructionVariants: [
    { id: 'que-definition-of-concept', directive: 'A' },
    { id: 'que-before-noun', directive: 'B' },
  ],
} as unknown as GrammarPoint;

const noVariants = { key: 'es-b1-plain', kind: 'grammar' } as unknown as GrammarPoint;

const row = (over: Partial<CandidateRow> = {}): CandidateRow => ({
  id: 'row-1',
  grammarPointKey: 'es-b1-que-vs-cual',
  type: ExerciseType.CLOZE,
  language: 'ES',
  difficulty: 'B1',
  contentJson: { sentence: '¿___ libro lees?', correctAnswer: 'Qué', seedWord: 'abran' },
  ...over,
});

describe('parseBackfillArgs', () => {
  it('defaults to dry-run and high confidence', () => {
    const a = parseBackfillArgs([]);
    expect(a.apply).toBe(false);
    expect(a.minConfidence).toBe('high');
  });

  it('skips a bare -- so `pnpm ... -- --apply` works', () => {
    expect(parseBackfillArgs(['--', '--apply', '--no-snapshot']).apply).toBe(true);
  });

  it('REFUSES --apply without --snapshot or --no-snapshot', () => {
    expect(() => parseBackfillArgs(['--apply'])).toThrow(/--snapshot/);
  });

  it('accepts --apply with a snapshot branch id', () => {
    const a = parseBackfillArgs(['--apply', '--snapshot', 'br-abc123']);
    expect(a.apply).toBe(true);
    expect(a.snapshot).toBe('br-abc123');
  });

  it('accepts --apply with an explicit --no-snapshot escape hatch', () => {
    const a = parseBackfillArgs(['--apply', '--no-snapshot']);
    expect(a.apply).toBe(true);
    expect(a.snapshot).toBeNull();
  });

  it('does not require a snapshot for a dry run', () => {
    expect(() => parseBackfillArgs([])).not.toThrow();
  });

  it('does not require a snapshot to revert — the undo path must stay frictionless', () => {
    const a = parseBackfillArgs(['--revert', 'runs/x.json', '--apply']);
    expect(a.revertFrom).toBe('runs/x.json');
    expect(a.apply).toBe(true);
  });

  it('uppercases --language and --cefr', () => {
    const a = parseBackfillArgs(['--language', 'es', '--cefr', 'b1']);
    expect(a.language).toBe('ES');
    expect(a.cefrLevel).toBe('B1');
  });

  it('rejects an unknown --min-confidence, including low', () => {
    expect(() => parseBackfillArgs(['--min-confidence', 'low'])).toThrow(/min-confidence/);
    expect(() => parseBackfillArgs(['--min-confidence', 'wat'])).toThrow(/min-confidence/);
  });

  it('accepts --min-confidence medium', () => {
    expect(parseBackfillArgs(['--min-confidence', 'medium']).minConfidence).toBe('medium');
  });

  it('rejects a non-positive --batch-size', () => {
    expect(() => parseBackfillArgs(['--batch-size', '0'])).toThrow(/batch-size/);
  });
});

describe('isEligible', () => {
  it('accepts a cloze row on a variant-bearing point carrying a frequency word', () => {
    expect(isEligible(withVariants, row())).toBe(true);
  });

  it('accepts a row whose seedWord is null', () => {
    expect(isEligible(withVariants, row({ contentJson: { sentence: 'x ___', correctAnswer: 'Qué' } }))).toBe(true);
  });

  it('SKIPS a row already carrying a declared variant id', () => {
    const r = row({ contentJson: { sentence: 'x ___', correctAnswer: 'Qué', seedWord: 'que-before-noun' } });
    expect(isEligible(withVariants, r)).toBe(false);
  });

  it('SKIPS a point that declares no constructionVariants', () => {
    expect(isEligible(noVariants, row())).toBe(false);
  });

  it('SKIPS an exercise type other than cloze/translation', () => {
    expect(isEligible(withVariants, row({ type: ExerciseType.CONJUGATION }))).toBe(false);
    expect(isEligible(withVariants, row({ type: ExerciseType.SENTENCE_CONSTRUCTION }))).toBe(false);
  });

  it('accepts translation rows', () => {
    const r = row({
      type: ExerciseType.TRANSLATION,
      contentJson: { sourceText: 'Which book?', referenceTranslation: '¿Qué libro?', seedWord: 'abran' },
    });
    expect(isEligible(withVariants, r)).toBe(true);
  });
});

describe('toClassifierRow', () => {
  it('maps a cloze row to sentence + correctAnswer', () => {
    expect(toClassifierRow(row())).toEqual({
      rowId: 'row-1',
      prompt: '¿___ libro lees?',
      answer: 'Qué',
    });
  });

  it('maps a translation row to sourceText + referenceTranslation', () => {
    const r = row({
      type: ExerciseType.TRANSLATION,
      contentJson: { sourceText: 'Which book?', referenceTranslation: '¿Qué libro?' },
    });
    expect(toClassifierRow(r)).toEqual({
      rowId: 'row-1',
      prompt: 'Which book?',
      answer: '¿Qué libro?',
    });
  });

  it('returns null when the content lacks a usable field rather than sending empty text', () => {
    expect(toClassifierRow(row({ contentJson: {} }))).toBeNull();
    expect(toClassifierRow(row({ contentJson: { sentence: 'x ___' } }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/db test -- backfill-variant-seeds`
Expected: FAIL — cannot resolve `./backfill-variant-seeds`.

- [ ] **Step 3: Write the implementation**

Create `packages/db/scripts/backfill-variant-seeds.ts`:

```ts
/**
 * `pnpm backfill:variant-seeds` — one-off CLI labelling the approved
 * cloze/translation pool of the `constructionVariants` points with the variant
 * id each row actually realizes. Prerequisite for the PR #631 repass; see
 * docs/superpowers/specs/2026-08-11-variant-seed-backfill-design.md.
 *
 * Writes are keyed on the row's PRIMARY KEY — never on a content pattern. The
 * classifier decides, the dry run shows exactly which ids get which value, and
 * SQL only applies those decisions.
 *
 * Defaults to dry-run; `--apply` writes and additionally requires `--snapshot
 * <neon-branch-id>` or an explicit `--no-snapshot`.
 *
 * Usage:
 *   pnpm backfill:variant-seeds
 *   pnpm backfill:variant-seeds -- --language ES --grammar-point es-b1-que-vs-cual
 *   pnpm backfill:variant-seeds -- --apply --snapshot br-abc123
 *   pnpm backfill:variant-seeds -- --revert backfill-runs/run.json --apply
 *
 * Required env: ANTHROPIC_API_KEY, DATABASE_URL.
 */

import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import type { GrammarPoint } from '@language-drill/shared';
import type { ClassifierConfidence, ClassifierRow } from '@language-drill/ai';

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_COST_USD = 5.0;

const LANGUAGE_VALUES = new Set<string>(Object.values(Language));
const CEFR_VALUES = new Set<string>(Object.values(CefrLevel));

/** Only these two types ever carry a construction-variant seed. */
const ELIGIBLE_TYPES = new Set<string>([ExerciseType.CLOZE, ExerciseType.TRANSLATION]);

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

export type BackfillArgs = {
  apply: boolean;
  /** Path to a prior run's artifact; restores each entry's oldSeedWord. */
  revertFrom: string | null;
  /** Neon branch id taken as a pre-apply snapshot; recorded in the artifact. */
  snapshot: string | null;
  language: Language | null;
  cefrLevel: CefrLevel | null;
  grammarPoint: string | null;
  minConfidence: 'high' | 'medium';
  limit: number | null;
  batchSize: number;
  concurrency: number;
  maxCostUsd: number;
  name: string;
};

export function parseBackfillArgs(argv: readonly string[]): BackfillArgs {
  let apply = false;
  let revertFrom: string | null = null;
  let snapshot: string | null = null;
  let noSnapshot = false;
  let language: Language | null = null;
  let cefrLevel: CefrLevel | null = null;
  let grammarPoint: string | null = null;
  let minConfidence: 'high' | 'medium' = 'high';
  let limit: number | null = null;
  let batchSize = DEFAULT_BATCH_SIZE;
  let concurrency = DEFAULT_CONCURRENCY;
  let maxCostUsd = DEFAULT_MAX_COST_USD;
  let name = 'backfill-variant-seeds';

  const need = (arg: string, next: string | undefined): string => {
    if (next === undefined) throw new Error(`${arg} requires a value`);
    return next;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // `pnpm run <script> -- --flag` forwards a bare `--`; the sibling db CLIs
    // all skip it, and CLAUDE.md documents that invocation style.
    if (arg === '--') continue;
    else if (arg === '--apply') apply = true;
    else if (arg === '--dry-run') apply = false;
    else if (arg === '--no-snapshot') noSnapshot = true;
    else if (arg === '--snapshot') snapshot = need(arg, argv[++i]);
    else if (arg === '--revert') revertFrom = need(arg, argv[++i]);
    else if (arg === '--grammar-point') grammarPoint = need(arg, argv[++i]);
    else if (arg === '--name') name = need(arg, argv[++i]);
    else if (arg === '--language' || arg === '--lang') {
      const upper = need(arg, argv[++i]).toUpperCase();
      if (!LANGUAGE_VALUES.has(upper)) {
        throw new Error(`${arg}: expected one of ${[...LANGUAGE_VALUES].join('|')}, got '${upper}'`);
      }
      language = upper as Language;
    } else if (arg === '--cefr' || arg === '--level') {
      const upper = need(arg, argv[++i]).toUpperCase();
      if (!CEFR_VALUES.has(upper)) {
        throw new Error(`${arg}: expected one of ${[...CEFR_VALUES].join('|')}, got '${upper}'`);
      }
      cefrLevel = upper as CefrLevel;
    } else if (arg === '--min-confidence') {
      const v = need(arg, argv[++i]);
      // 'low' is deliberately not accepted: a low-confidence label is exactly
      // the wrong-label case this design treats as worse than no label.
      if (v !== 'high' && v !== 'medium') {
        throw new Error(`--min-confidence: expected high|medium, got '${v}'`);
      }
      minConfidence = v;
    } else if (arg === '--limit' || arg === '--batch-size' || arg === '--concurrency' || arg === '--max-cost-usd') {
      const parsed = Number(need(arg, argv[++i]));
      if (arg === '--max-cost-usd') {
        if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${arg} must be positive`);
        maxCostUsd = parsed;
      } else {
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error(`${arg} must be a positive integer, got '${parsed}'`);
        }
        if (arg === '--limit') limit = parsed;
        else if (arg === '--batch-size') batchSize = parsed;
        else concurrency = parsed;
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: backfill:variant-seeds [--language ES] [--cefr B1] [--grammar-point <key>]\n' +
          '       [--min-confidence high|medium] [--limit N] [--batch-size 20]\n' +
          '       [--concurrency 4] [--max-cost-usd 5] [--name <run>]\n' +
          '       [--apply --snapshot <neon-branch-id> | --apply --no-snapshot]\n' +
          '       [--revert <artifact.json> --apply]',
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument '${arg}'`);
    }
  }

  // The forcing function: an --apply run must name its rollback snapshot or
  // explicitly disclaim one. Reverting is exempt — the undo path must not have
  // friction at the moment you need it.
  if (apply && revertFrom === null && snapshot === null && !noSnapshot) {
    throw new Error(
      '--apply requires --snapshot <neon-branch-id> (take a Neon branch off the target first) ' +
        'or an explicit --no-snapshot',
    );
  }

  return {
    apply, revertFrom, snapshot, language, cefrLevel, grammarPoint,
    minConfidence, limit, batchSize, concurrency, maxCostUsd, name,
  };
}

// ---------------------------------------------------------------------------
// Row selection
// ---------------------------------------------------------------------------

export type CandidateRow = {
  id: string;
  grammarPointKey: string;
  type: ExerciseType;
  language: string;
  difficulty: string;
  contentJson: Record<string, unknown>;
};

/**
 * Whether this row should be classified at all. Three independent guards:
 * the point must declare variants, the type must be one that carries a variant
 * seed, and the row must not already be correctly labelled (which makes the
 * pass resumable and leaves the ~331 already-correct rows alone).
 */
export function isEligible(gp: GrammarPoint, row: CandidateRow): boolean {
  const variants = gp.constructionVariants;
  if (!variants || variants.length === 0) return false;
  if (!ELIGIBLE_TYPES.has(row.type)) return false;

  const current = row.contentJson.seedWord;
  if (typeof current === 'string' && variants.some((v) => v.id === current)) return false;

  return true;
}

/**
 * The learner-visible content the classifier judges. Returns null when the row
 * lacks a usable field — sending empty text would invite a confident guess from
 * no evidence.
 */
export function toClassifierRow(row: CandidateRow): ClassifierRow | null {
  const c = row.contentJson;
  if (row.type === ExerciseType.CLOZE) {
    const prompt = c.sentence;
    const answer = c.correctAnswer;
    if (typeof prompt !== 'string' || typeof answer !== 'string') return null;
    return { rowId: row.id, prompt, answer };
  }
  if (row.type === ExerciseType.TRANSLATION) {
    const prompt = c.sourceText;
    const answer = c.referenceTranslation;
    if (typeof prompt !== 'string' || typeof answer !== 'string') return null;
    return { rowId: row.id, prompt, answer };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------

/** One row's change. `oldSeedWord` is what makes `--revert` possible. */
export type ArtifactEntry = {
  id: string;
  cellKey: string;
  oldSeedWord: string | null;
  newSeedWord: string;
  confidence: ClassifierConfidence;
};

export type Artifact = {
  name: string;
  createdAtIso: string;
  applied: boolean;
  snapshotBranchId: string | null;
  minConfidence: 'high' | 'medium';
  entries: ArtifactEntry[];
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/db test -- backfill-variant-seeds`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/db/scripts/backfill-variant-seeds.ts packages/db/scripts/backfill-variant-seeds.test.ts
git commit -m "feat(db): backfill:variant-seeds args, eligibility, artifact shape

--apply refuses to run without --snapshot or an explicit --no-snapshot, so a
1,939-row production write cannot happen without naming its rollback. Revert
is exempt: the undo path must not have friction.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: CLI — orchestration, apply, and revert

**Files:**
- Modify: `packages/db/scripts/backfill-variant-seeds.ts`
- Modify: `packages/db/scripts/backfill-variant-seeds.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–3; `createDb` from `../src/client`, `getGrammarPoint` from `../src/curriculum`, `exercises` from `../src/schema`, `buildCellKey` from `../src/lib/cell-key`, `pLimit` from `./p-limit`.
- Produces: `selectWrites()`, `summarize()`, `main()`.

- [ ] **Step 1: Write the failing test**

Append to `packages/db/scripts/backfill-variant-seeds.test.ts`:

```ts
import { selectWrites, summarize, type ArtifactEntry } from './backfill-variant-seeds';
import type { ClassifierAssignment } from '@language-drill/ai';

describe('selectWrites', () => {
  const rows: CandidateRow[] = [
    row({ id: 'a', contentJson: { sentence: 'x ___', correctAnswer: 'Qué', seedWord: 'abran' } }),
    row({ id: 'b', contentJson: { sentence: 'y ___', correctAnswer: 'Qué' } }),
    row({ id: 'c', contentJson: { sentence: 'z ___', correctAnswer: 'Qué', seedWord: 'acepto' } }),
  ];

  const assignments: ClassifierAssignment[] = [
    { rowId: 'a', variantId: 'que-before-noun', confidence: 'high' },
    { rowId: 'b', variantId: 'que-definition-of-concept', confidence: 'medium' },
    { rowId: 'c', variantId: null, confidence: 'low' },
  ];

  it('writes only high confidence by default, and records the old value', () => {
    const w = selectWrites(rows, assignments, 'high', 'ES:B1:cloze:es-b1-que-vs-cual');
    expect(w).toHaveLength(1);
    expect(w[0]).toEqual({
      id: 'a',
      cellKey: 'ES:B1:cloze:es-b1-que-vs-cual',
      oldSeedWord: 'abran',
      newSeedWord: 'que-before-noun',
      confidence: 'high',
    });
  });

  it('includes medium when --min-confidence medium is set', () => {
    const w = selectWrites(rows, assignments, 'medium', 'cell');
    expect(w.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });

  it('records a null oldSeedWord rather than omitting it — revert must restore null', () => {
    const w = selectWrites(rows, assignments, 'medium', 'cell');
    expect(w.find((e) => e.id === 'b')!.oldSeedWord).toBeNull();
  });

  it('never writes a null variantId, whatever the confidence', () => {
    const confident: ClassifierAssignment[] = [{ rowId: 'c', variantId: null, confidence: 'high' }];
    expect(selectWrites(rows, confident, 'high', 'cell')).toHaveLength(0);
  });

  it('ignores an assignment whose rowId is not among the rows', () => {
    const stray: ClassifierAssignment[] = [{ rowId: 'zzz', variantId: 'que-before-noun', confidence: 'high' }];
    expect(selectWrites(rows, stray, 'high', 'cell')).toHaveLength(0);
  });
});

describe('summarize', () => {
  const entries: ArtifactEntry[] = [
    { id: 'a', cellKey: 'ES:B1:cloze:p', oldSeedWord: 'abran', newSeedWord: 'v1', confidence: 'high' },
    { id: 'b', cellKey: 'ES:B1:cloze:p', oldSeedWord: null, newSeedWord: 'v1', confidence: 'high' },
    { id: 'c', cellKey: 'ES:B1:translation:p', oldSeedWord: 'x', newSeedWord: 'v2', confidence: 'medium' },
  ];

  it('groups by cell and counts per variant', () => {
    const s = summarize(entries);
    expect(s).toContain('ES:B1:cloze:p');
    expect(s).toContain('v1: 2');
    expect(s).toContain('ES:B1:translation:p');
    expect(s).toContain('v2: 1');
  });

  it('reports nothing to do for an empty set rather than printing an empty table', () => {
    expect(summarize([])).toContain('no rows');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/db test -- backfill-variant-seeds`
Expected: FAIL — `selectWrites is not exported`.

- [ ] **Step 3: Write the implementation**

> **CORRECTIONS — this task's code block below shipped with three defects, all
> found during execution and fixed in the committed implementation. Read the
> shipped file, not this snippet, if they disagree.**
>
> 1. **`res.usage` is raw `Anthropic.Usage` (snake_case), not
>    `ClaudeUsageBreakdown`** — `addUsage(usage, res.usage)` below does not
>    typecheck. The implementation adds a local `readUsage()` conversion,
>    mirroring `packages/ai/src/qa-sample.ts`.
> 2. **The artifact must be persisted BEFORE the apply loop, not after.** As
>    written below, a write throwing partway through leaves rows changed and the
>    rollback artifact never written — losing the fine-grained undo for exactly
>    the partial-failure case it exists for. The implementation persists first
>    with `applied: false`, fails fast per row, then re-persists final state; it
>    also adds `appliedCount: number` to `Artifact`.
> 3. **`--max-cost-usd` is not a hard cap.** `pLimit` dispatches synchronously,
>    so the first `concurrency` batches all read the same stale running total and
>    up to `concurrency − 1` can start past the cap. The concurrency model is
>    deliberately left alone (the same pattern exists in
>    `revalidate-cloze-pool.ts`); the implementation prints an explicit overshoot
>    warning instead.

Append to `packages/db/scripts/backfill-variant-seeds.ts`. The imports below go into the **existing import block at the top of the file**:

```ts
// → merge into the existing import block at the top of the file.
// Task 3 already imports `type ClassifierConfidence, type ClassifierRow` from
// '@language-drill/ai' — ADD the names below to that SAME statement rather than
// writing a second import from the same module.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  ZERO_USAGE,
  addUsage,
  classifyVariantSeeds,
  createClaudeClient,
  estimateCostUsd,
  type ClaudeUsageBreakdown,
  type ClassifierAssignment,
  type ClassifierConfidence,
  type ClassifierRow,
} from '@language-drill/ai';
import { createDb } from '../src/client';
import { getGrammarPoint } from '../src/curriculum';
import { exercises } from '../src/schema';
import { requireEnv } from '../src/lib/env';
import { pLimit } from './p-limit';
```

(Verified: `requireEnv(name: string): string` is exported from `packages/db/src/lib/env.ts`; `pLimit(n)` returns a limiter you call as `limit(fn)`; `estimateCostUsd(usage: ClaudeUsageBreakdown): number`.)

Then append:

```ts
// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

const CONFIDENCE_RANK: Record<ClassifierConfidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * Turn classifier assignments into the concrete writes for one cell.
 *
 * A null `variantId` never produces a write regardless of confidence — the
 * model saying "confidently, none of these" is still a decision not to label.
 */
export function selectWrites(
  rows: readonly CandidateRow[],
  assignments: readonly ClassifierAssignment[],
  minConfidence: 'high' | 'medium',
  cellKey: string,
): ArtifactEntry[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const floor = CONFIDENCE_RANK[minConfidence];
  const out: ArtifactEntry[] = [];

  for (const a of assignments) {
    if (a.variantId === null) continue;
    if (CONFIDENCE_RANK[a.confidence] < floor) continue;
    const row = byId.get(a.rowId);
    if (!row) continue;
    const old = row.contentJson.seedWord;
    out.push({
      id: row.id,
      cellKey,
      oldSeedWord: typeof old === 'string' ? old : null,
      newSeedWord: a.variantId,
      confidence: a.confidence,
    });
  }
  return out;
}

/** Human-readable per-cell, per-variant breakdown for the dry-run output. */
export function summarize(entries: readonly ArtifactEntry[]): string {
  if (entries.length === 0) return 'no rows would change';
  const byCell = new Map<string, Map<string, number>>();
  for (const e of entries) {
    let cell = byCell.get(e.cellKey);
    if (!cell) { cell = new Map(); byCell.set(e.cellKey, cell); }
    cell.set(e.newSeedWord, (cell.get(e.newSeedWord) ?? 0) + 1);
  }
  const lines: string[] = [];
  for (const [cellKey, variants] of [...byCell.entries()].sort()) {
    lines.push(`  ${cellKey}`);
    for (const [variantId, n] of [...variants.entries()].sort()) {
      lines.push(`    ${variantId}: ${n}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function artifactPath(name: string): string {
  const dir = path.join(process.cwd(), 'backfill-runs');
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.json`);
}

/** Apply one entry. Keyed on the PRIMARY KEY; nothing is content-matched. */
async function writeSeed(
  db: ReturnType<typeof createDb>,
  id: string,
  seedWord: string | null,
): Promise<void> {
  await db
    .update(exercises)
    .set({
      contentJson:
        seedWord === null
          ? sql`content_json - 'seedWord'`
          : sql`jsonb_set(content_json, '{seedWord}', to_jsonb(${seedWord}::text))`,
    })
    .where(eq(exercises.id, id));
}

async function runRevert(args: BackfillArgs): Promise<void> {
  const artifact = JSON.parse(readFileSync(args.revertFrom!, 'utf8')) as Artifact;
  console.log(`[backfill-variant-seeds] revert: ${artifact.entries.length} entries from ${args.revertFrom}`);
  if (!args.apply) {
    console.log('[backfill-variant-seeds] dry-run: pass --apply to restore. Sample:');
    for (const e of artifact.entries.slice(0, 5)) {
      console.log(`  ${e.id}: ${e.newSeedWord} -> ${e.oldSeedWord ?? '(removed)'}`);
    }
    return;
  }
  const db = createDb(requireEnv('DATABASE_URL'));
  for (const e of artifact.entries) await writeSeed(db, e.id, e.oldSeedWord);
  console.log(`[backfill-variant-seeds] restored ${artifact.entries.length} rows.`);
}

async function main(): Promise<void> {
  const args = parseBackfillArgs(process.argv.slice(2));
  if (args.revertFrom !== null) return runRevert(args);

  const db = createDb(requireEnv('DATABASE_URL'));

  const conditions = [
    inArray(exercises.reviewStatus, ['auto-approved', 'manual-approved']),
    inArray(exercises.type, [...ELIGIBLE_TYPES]),
    isNotNull(exercises.grammarPointKey),
  ];
  if (args.language) conditions.push(sql`${exercises.language} = ${args.language}`);
  if (args.cefrLevel) conditions.push(sql`${exercises.difficulty} = ${args.cefrLevel}`);
  if (args.grammarPoint) conditions.push(sql`${exercises.grammarPointKey} = ${args.grammarPoint}`);

  const raw = await db
    .select({
      id: exercises.id,
      grammarPointKey: exercises.grammarPointKey,
      type: exercises.type,
      language: exercises.language,
      difficulty: exercises.difficulty,
      contentJson: exercises.contentJson,
    })
    .from(exercises)
    .where(and(...conditions));

  // Group eligible rows per cell; the classifier's system block is per-point.
  const cells = new Map<string, { gp: GrammarPoint; rows: CandidateRow[] }>();
  for (const r of raw) {
    const gp = r.grammarPointKey ? getGrammarPoint(r.grammarPointKey) : undefined;
    if (!gp) continue;
    const row: CandidateRow = {
      id: r.id,
      grammarPointKey: r.grammarPointKey!,
      type: r.type as ExerciseType,
      language: r.language!,
      difficulty: r.difficulty!,
      contentJson: (r.contentJson ?? {}) as Record<string, unknown>,
    };
    if (!isEligible(gp, row)) continue;
    const cellKey = `${row.language}:${row.difficulty}:${row.type}:${row.grammarPointKey}`;
    let cell = cells.get(cellKey);
    if (!cell) { cell = { gp, rows: [] }; cells.set(cellKey, cell); }
    cell.rows.push(row);
  }

  let cellList = [...cells.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (args.limit !== null) cellList = cellList.slice(0, args.limit);
  console.log(`[backfill-variant-seeds] ${raw.length} rows scanned -> ${cellList.length} cells with eligible rows`);

  const client = createClaudeClient(requireEnv('ANTHROPIC_API_KEY'));
  const limit = pLimit(args.concurrency);
  let usage: ClaudeUsageBreakdown = ZERO_USAGE;
  const entries: ArtifactEntry[] = [];
  const failures: string[] = [];

  for (const [cellKey, cell] of cellList) {
    const batches: CandidateRow[][] = [];
    for (let i = 0; i < cell.rows.length; i += args.batchSize) {
      batches.push(cell.rows.slice(i, i + args.batchSize));
    }
    const results = await Promise.all(
      batches.map((batch) =>
        limit(async () => {
          if (estimateCostUsd(usage) >= args.maxCostUsd) {
            // Never truncate silently — a skipped batch is reported, not dropped.
            failures.push(`${cellKey}: skipped, hit --max-cost-usd ${args.maxCostUsd}`);
            return [] as ArtifactEntry[];
          }
          const classifierRows = batch.map(toClassifierRow).filter((r): r is ClassifierRow => r !== null);
          if (classifierRows.length === 0) return [] as ArtifactEntry[];
          try {
            const res = await classifyVariantSeeds(client, cell.gp, classifierRows);
            usage = addUsage(usage, res.usage);
            return selectWrites(batch, res.assignments, args.minConfidence, cellKey);
          } catch (err) {
            failures.push(`${cellKey}: ${err instanceof Error ? err.message : String(err)}`);
            return [] as ArtifactEntry[];
          }
        }),
      ),
    );
    for (const r of results) entries.push(...r);
  }

  const artifact: Artifact = {
    name: args.name,
    createdAtIso: new Date().toISOString(),
    applied: args.apply,
    snapshotBranchId: args.snapshot,
    minConfidence: args.minConfidence,
    entries,
  };

  console.log(`\n[backfill-variant-seeds] ${entries.length} rows would be labelled:\n${summarize(entries)}`);
  if (failures.length > 0) {
    console.log(`\n[backfill-variant-seeds] ${failures.length} batch failures:`);
    for (const f of failures) console.log(`  ${f}`);
  }
  console.log(`\n[backfill-variant-seeds] estimated cost $${estimateCostUsd(usage).toFixed(2)}`);

  if (args.apply) {
    for (const e of entries) await writeSeed(db, e.id, e.newSeedWord);
    console.log(`[backfill-variant-seeds] APPLIED ${entries.length} rows.`);
    console.log('[backfill-variant-seeds] Re-run `pnpm audit:collapse --dry-run` and confirm unrecognizedSeedCount fell.');
  } else {
    console.log('[backfill-variant-seeds] dry-run: nothing written. Pass --apply --snapshot <branch> to write.');
  }

  const out = artifactPath(args.name);
  writeFileSync(out, JSON.stringify(artifact, null, 2), 'utf8');
  console.log(`[backfill-variant-seeds] artifact written to ${out}`);
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error('[backfill-variant-seeds] unhandled failure:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/db test -- backfill-variant-seeds`
Expected: PASS, 27 tests.

- [ ] **Step 5: Run the full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures.

- [ ] **Step 6: Commit**

```bash
git add packages/db/scripts/backfill-variant-seeds.ts packages/db/scripts/backfill-variant-seeds.test.ts
git commit -m "feat(db): backfill:variant-seeds orchestration, apply, and revert

Every write is jsonb_set keyed on the primary key — nothing is matched on
content at write time, which is the design's central safety property. A null
classification never writes, whatever its confidence. Cost-guard skips are
reported as failures rather than silently dropped.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire the CLI and document it

**Files:**
- Modify: `packages/db/package.json`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `packages/db/scripts/backfill-variant-seeds.ts` (Task 4).
- Produces: the `pnpm backfill:variant-seeds` entry point.

- [ ] **Step 1: Add the package script**

In `packages/db/package.json`, alongside the other `backfill:*` scripts:

```json
    "backfill:variant-seeds": "tsx scripts/backfill-variant-seeds.ts",
```

- [ ] **Step 2: Add the root passthrough**

In the root `package.json`, next to the other backfill entries:

```json
    "backfill:variant-seeds": "dotenv -e .env -- pnpm --filter @language-drill/db backfill:variant-seeds",
```

- [ ] **Step 3: Ignore the artifacts**

Append to `.gitignore`:

```
# backfill:variant-seeds rollback artifacts (keep the ones that matter elsewhere)
packages/db/backfill-runs/
```

- [ ] **Step 4: Smoke-test the wiring against the DEV database**

The local `.env` `DATABASE_URL` points at the dev Neon branch, which is the correct target for a smoke test. Dry-run, so nothing is written and no snapshot is needed.

Run: `pnpm backfill:variant-seeds -- --language ES --limit 2 --name smoke`

Expected: exits 0; prints a scanned-rows count, a cells count, a per-cell/per-variant breakdown, an estimated cost, and `dry-run: nothing written`. Writes `packages/db/backfill-runs/smoke.json`.

**Read the output rather than just checking the exit code.** Confirm the proposed labels are plausible for the cells shown, and that nothing renders as `undefined` or `[object Object]`. Report what it actually proposed.

If `--apply` is rejected without a snapshot, that is the forcing function working — verify it: `pnpm backfill:variant-seeds -- --apply` must fail with a message naming `--snapshot`.

- [ ] **Step 5: Document it in `CLAUDE.md`**

Add a row to the command table, after the `pnpm backfill:demotion-reason` row:

```markdown
| `pnpm backfill:variant-seeds` | One-off CLI labelling the approved cloze/translation pool of the 31 `constructionVariants` points with the variant id each row actually realizes — the prerequisite for the PR #631 repass. Batches ~20 rows per Claude call within a cell (the point's variant list is the cached system block) and writes `content_json.seedWord` **keyed on the row's primary key**, never on a content pattern. A `null` classification never writes, and only `high` confidence writes unless `--min-confidence medium`. Dry-run by default; `--apply` additionally requires `--snapshot <neon-branch-id>` or an explicit `--no-snapshot`. Every run writes a replayable rollback artifact to `./backfill-runs/<name>.json`; `--revert <artifact> --apply` restores it. Supports `--language`, `--cefr`, `--grammar-point`, `--limit`, `--batch-size`, `--concurrency`, `--max-cost-usd`. Verify with `pnpm audit:collapse --dry-run` afterwards. |
```

- [ ] **Step 6: Run the full gate and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures.

```bash
git add packages/db/package.json package.json .gitignore CLAUDE.md
git commit -m "chore: wire pnpm backfill:variant-seeds and document it

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Dev rehearsal, production run, and the closed-loop check

The acceptance task. It is deliberately manual and has no automated test: its gate is that the audit shipped in PR #634 reports different numbers afterwards.

**Files:**
- Create: `docs/analysis/variant-seed-backfill-2026-08-11.md`

**Interfaces:**
- Consumes: the complete CLI (Tasks 1–5).
- Produces: a labelled production pool and a committed record of what changed.

- [ ] **Step 1: Full dry run against production**

Fetch the production connection string via the Neon MCP tools (branch `br-green-waterfall-ancrvpr5`, project `twilight-smoke-01114337`). The local `.env` points at dev.

```
DATABASE_URL='<prod>' ANTHROPIC_API_KEY='<key>' \
  pnpm --filter @language-drill/db backfill:variant-seeds --name prod-dry-2026-08-11
```

Expected: roughly 1,900 rows proposed across ~51 cells, cost in the low single-digit dollars. Read the per-cell breakdown: **every cell's proposed labels should span more than one variant.** A cell where every row lands on a single variant is a red flag — either the pool really is collapsed on that construction (which the audit already told us) or the classifier is defaulting. Check two such cells by hand against the actual rows before proceeding.

- [ ] **Step 2: Rehearse `--apply` on the dev branch**

```
pnpm backfill:variant-seeds -- --apply --no-snapshot --name dev-rehearsal
```

Dev is disposable, so `--no-snapshot` is appropriate here and nowhere else. Confirm it writes, then confirm `--revert` restores:

```
pnpm backfill:variant-seeds -- --revert backfill-runs/dev-rehearsal.json --apply --name dev-revert
```

Verify with SQL against dev that a sample of the affected rows carries its original `seedWord` again. **The undo path must be proven on dev before production relies on it.**

- [ ] **Step 3: Take the production snapshot**

Create a Neon branch off production via the Neon MCP tools, named `pre-variant-seed-backfill-2026-08-11`. Record its branch id — the next step requires it.

- [ ] **Step 4: Apply to production**

```
DATABASE_URL='<prod>' ANTHROPIC_API_KEY='<key>' \
  pnpm --filter @language-drill/db backfill:variant-seeds \
  --apply --snapshot '<branch-id>' --name prod-2026-08-11
```

Keep `backfill-runs/prod-2026-08-11.json` — it is the surgical undo path.

- [ ] **Step 5: The closed-loop acceptance check**

```
DATABASE_URL='<prod>' pnpm --filter @language-drill/ai audit:collapse --dry-run --name post-backfill-2026-08-11
```

Compare against `docs/analysis/pool-collapse-baseline-2026-08-11.md`. Three things must be true:

1. **`unrecognizedSeedCount` collapses toward zero** across the variant-bearing cells. That is the whole point of the exercise.
2. **The declared-but-unrealized count changes**, and specifically the at-target/below-target split shifts from the baseline's 94/90. It should *shrink* — cells whose rows now count toward their variants may already have adequate spread.
3. **`variant-spread-uneven` becomes non-zero.** The baseline reported 0 because nothing had recognized labels; after the backfill, real imbalance becomes visible for the first time.

If (1) does not hold, **revert** (`--revert backfill-runs/prod-2026-08-11.json --apply`) and diagnose before going further.

- [ ] **Step 6: Commit the record**

Write `docs/analysis/variant-seed-backfill-2026-08-11.md`: rows labelled, per-language breakdown, cost, the confidence distribution, how many rows were left unclassified and why, and the before/after audit numbers from Step 5. Note the snapshot branch id and the artifact path.

```bash
git add docs/analysis/variant-seed-backfill-2026-08-11.md
git commit -m "docs(analysis): variant-seed backfill run record

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Report the outcome**

State plainly: rows labelled, rows left unclassified, cost, and the three closed-loop numbers from Step 5 with their baseline comparison. Then state what the *revised* repass worklist looks like — that is the deliverable this whole chain exists to produce.

Do not open a PR without being asked. Do not run `demote:pool`.

---

## Notes for the implementer

**Do not demote anything.** This plan labels rows. The demote is a separate, later, human decision, and running it while nightly generation is paused would shrink the pool with nothing refilling it.

**`--no-snapshot` is for dev only.** On production, take the Neon branch. The flag exists so the requirement is explicit rather than forgotten, not so it can be waved through.

**A null classification is a success, not a failure.** If the run leaves a few hundred rows unlabelled, that is the design working. Do not lower `--min-confidence` to raise the count without a specific reason, and never to make a number look better.

**Stale `dist` cuts both ways.** `packages/db` resolves `@language-drill/ai` through its `dist`, so run `pnpm build` after Task 2. Conversely, stale compiled `infra/lambda/dist/**/*.test.js` files cause phantom failures in the full suite — `rm -rf infra/lambda/dist` clears them.
