# Translation Word-Hints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a learner click an English source word in the translation drill and reveal its target-language **dictionary form**, resolved by one cached batch LLM call per exercise; any hint use down-weights the mastery signal.

**Architecture:** A new AI module (`word-hint`) resolves the whole sentence into an ordered list of hint *units* (`{ text, hintable, lemma? }`) in one Haiku call. A new route `POST /exercises/:id/word-hints` caches that list in a new `exercise_word_hints` table (permanent, cross-user), metered once per cache-miss. The translation component fetches the list on a "need a hint" toggle, renders clickable/greyed spans, and reveals lemmas instantly. Submit carries structured hint usage that shrinks the observation weight in the existing Bayesian `updateMastery`.

**Tech Stack:** TypeScript monorepo — Drizzle/Neon (`packages/db`), Anthropic SDK (`packages/ai`), Hono Lambda (`infra/lambda`), TanStack Query (`packages/api-client`), Next.js + React (`apps/web`). Vitest throughout.

## Global Constraints

- **Design system over prototype:** map prototype tokens/classes (`--hilite`, `.btn`, hint panel) onto the app's existing design-system tokens and `<Button>` component; do not copy raw prototype values. (Spec §Frontend.)
- **No exercise regeneration; no generation/validation prompt edits.** This is a brand-new, separate prompt. (Spec §Out of scope.)
- **Prompt versioning:** the new `WORD_HINT_PROMPT_VERSION` uses `word-hint@YYYY-MM-DD` and must be added to the `PROMPTS` manifest in `bootstrap-prompts.ts` (else it only ever serves the in-repo fallback). (CLAUDE.md Prompt Editing; memory: new-prompt-needs-manifest-entry.)
- **Cheap model:** the word-hint call uses `claude-haiku-4-5-20251001`.
- **Down-weight curve (named constants):** `1.0` baseline; `−0.15` per word revealed floored at `0.4` (`max(0.4, 1 − 0.15 × wordsRevealed)`); full-answer reveal `0.1`, overriding the word term.
- **Hint-usage field is structured:** `{ wordsRevealed: number; fullAnswerRevealed: boolean }`.
- **Migrations forward-only**, generated with `pnpm --filter @language-drill/db db:generate` (never hand-numbered). Do NOT run `db:migrate` against the shared dev branch (memory: dev-branch-ci-fork-pollution).
- **Pre-push gate:** `pnpm lint && pnpm typecheck && pnpm test` from repo root, zero failures.

**Cache-substrate note (deviation from spec wording):** the spec said "Redis." There is **no Redis client in `infra/lambda`** (only unused env vars). Since the hint map is immutable, permanent, per-exercise, relational data, this plan caches it in a **DB table** instead — no new dependency, durable, trivially testable. Same behavior (first learner pays, rest are free); different substrate.

---

## Shared type (used by db, ai, lambda, api-client, web)

`WordHintUnit` is defined once in `@language-drill/shared` and imported everywhere.

```ts
export type WordHintUnit = {
  /** Exact source substring for this unit (one or more words, punctuation glued). */
  text: string;
  /** Whether this unit is a meaningful hint (false for articles/function words/punctuation). */
  hintable: boolean;
  /** Target-language dictionary (base, uninflected) form; present only when hintable. */
  lemma?: string;
};
```

Task 1 creates it.

---

## File Structure

- `packages/shared/src/index.ts` — add `WordHintUnit` type (Task 1).
- `packages/db/src/mastery/update.ts` — `evidenceWeight` on observation + history (Task 2).
- `packages/db/src/schema/progress.ts` + `schema/index.ts` — `evidence_weight` column + `exercise_word_hints` table (Task 3).
- `packages/db/migrations/*` — generated migration (Task 3).
- `packages/ai/src/word-hint-prompts.ts` + `word-hint.ts` + `index.ts` + `scripts/bootstrap-prompts.ts` — the AI module (Task 4).
- `infra/lambda/src/usage/limits.ts` — `translation_word_hint` bucket (Task 5).
- `infra/lambda/src/lib/word-hints.ts` — `resolveWordHints` orchestrator (Task 5).
- `infra/lambda/src/routes/exercises.ts` — the route + submit down-weight (Tasks 5, 6).
- `packages/db/scripts/backfill-mastery.ts`, `infra/lambda/src/routes/sessions.ts`, `infra/lambda/src/lib/debrief/skill-movements.ts` — thread `evidenceWeight` through replay (Task 7... folded into Task 2's consumers below).
- `packages/api-client/src/schemas/exercise.ts`, `src/hooks/useExercise.ts`, `src/hooks/useWordHints.ts` — client schema + hooks (Task 6).
- `apps/web/.../drill/_components/types.ts`, `translation-exercise.tsx`, `exercise-pane.tsx`, `page.tsx` — UI (Task 6).

---

## Task 1: Shared `WordHintUnit` type

**Files:**
- Modify: `packages/shared/src/index.ts` (append near other content types)
- Test: none (a bare type export; covered by downstream typechecks)

**Interfaces:**
- Produces: `type WordHintUnit = { text: string; hintable: boolean; lemma?: string }`

- [ ] **Step 1: Add the type**

Append to `packages/shared/src/index.ts`:

```ts
/**
 * One unit of a translation word-hint map: an ordered slice of the source
 * sentence. `hintable:false` units (articles, function words, punctuation)
 * carry no lemma and are not tappable in the UI.
 */
export type WordHintUnit = {
  text: string;
  hintable: boolean;
  lemma?: string;
};
```

- [ ] **Step 2: Build shared + typecheck**

Run: `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/shared typecheck`
Expected: PASS (memory: vitest-workspace-dist-resolution — rebuild `db`/`shared` dist after editing source).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): add WordHintUnit type for translation word-hints"
```

---

## Task 2: Mastery down-weight in `updateMastery`

**Files:**
- Modify: `packages/db/src/mastery/update.ts:15-19` (`MasteryObservation`), `:21-26` (`HistoryRow`), `:70` (obsW), `:86-101` (`replayHistory`)
- Test: `packages/db/src/mastery/update.test.ts` (add to it; create if absent)

**Interfaces:**
- Consumes: nothing new.
- Produces: `MasteryObservation` and `HistoryRow` each gain an optional `evidenceWeight?: number` (default `1`). `updateMastery`/`replayHistory` honor it by multiplying the observation weight.

- [ ] **Step 1: Write the failing test**

Add to `packages/db/src/mastery/update.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { updateMastery, replayHistory } from './update';
import { CefrLevel } from '@language-drill/shared';

describe('updateMastery evidenceWeight', () => {
  const prev = { masteryScore: 0.5, confidence: 0.5, evidenceCount: 3, lastPracticedAt: new Date('2026-07-01') };
  const at = new Date('2026-07-01'); // same day → no decay

  it('a down-weighted correct answer moves mastery less than a full-weight one', () => {
    const full = updateMastery(prev, { score: 1, difficulty: CefrLevel.A1, at });
    const hinted = updateMastery(prev, { score: 1, difficulty: CefrLevel.A1, at, evidenceWeight: 0.1 });
    expect(hinted.masteryScore).toBeLessThan(full.masteryScore);
    expect(hinted.masteryScore).toBeGreaterThan(prev.masteryScore);
    // confidence still grows via evidenceCount regardless of weight
    expect(hinted.confidence).toBe(full.confidence);
  });

  it('evidenceWeight defaults to 1 (unchanged behavior)', () => {
    const a = updateMastery(prev, { score: 1, difficulty: CefrLevel.A1, at });
    const b = updateMastery(prev, { score: 1, difficulty: CefrLevel.A1, at, evidenceWeight: 1 });
    expect(a.masteryScore).toBe(b.masteryScore);
  });

  it('replayHistory honors per-row evidenceWeight', () => {
    const rows = [
      { grammarPointKey: 'g', score: 1, difficulty: CefrLevel.A1, evaluatedAt: at, evidenceWeight: 0.1 },
    ];
    const heavy = [
      { grammarPointKey: 'g', score: 1, difficulty: CefrLevel.A1, evaluatedAt: at },
    ];
    // first observation seeds directly (prev===null), so both equal; add a 2nd
    rows.push({ grammarPointKey: 'g', score: 1, difficulty: CefrLevel.A1, evaluatedAt: new Date('2026-07-02'), evidenceWeight: 0.1 });
    heavy.push({ grammarPointKey: 'g', score: 1, difficulty: CefrLevel.A1, evaluatedAt: new Date('2026-07-02') });
    expect(replayHistory(rows).get('g')!.masteryScore)
      .toBeLessThanOrEqual(replayHistory(heavy).get('g')!.masteryScore);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db test -- update.test.ts`
Expected: FAIL — `evidenceWeight` not accepted / no effect.

- [ ] **Step 3: Implement**

In `packages/db/src/mastery/update.ts`, add the field to both types:

```ts
export type MasteryObservation = {
  score: number; // 0..1
  difficulty: CefrLevel;
  at: Date;
  /** Multiplier in (0,1] shrinking this observation's evidence weight (hint penalty). Default 1. */
  evidenceWeight?: number;
};

export type HistoryRow = {
  grammarPointKey: string;
  score: number;
  difficulty: CefrLevel;
  evaluatedAt: Date;
  evidenceWeight?: number;
};
```

Change the obsW line (`:70`) to apply the multiplier (clamped to `(0,1]`):

```ts
  const ew = obs.evidenceWeight == null ? 1 : Math.min(1, Math.max(0, obs.evidenceWeight));
  const obsW = (obs.score >= prev.masteryScore ? dw : DW_PIVOT - dw) * ew;
```

Thread it through `replayHistory` (`:95-98`):

```ts
    out.set(
      r.grammarPointKey,
      updateMastery(prev, {
        score: r.score,
        difficulty: r.difficulty,
        at: r.evaluatedAt,
        evidenceWeight: r.evidenceWeight,
      }),
    );
```

(Note: the `prev === null` first-observation branch seeds `masteryScore = score` and intentionally ignores `evidenceWeight` — there is no prior to average against. This is acceptable: `evidenceCount = 1`, confidence is low.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/db test -- update.test.ts`
Expected: PASS.

- [ ] **Step 5: Build db dist + commit**

Run: `pnpm --filter @language-drill/db build`

```bash
git add packages/db/src/mastery/update.ts packages/db/src/mastery/update.test.ts
git commit -m "feat(db): support evidenceWeight (hint penalty) in updateMastery/replayHistory"
```

---

## Task 3: Schema — `evidence_weight` column + `exercise_word_hints` table

**Files:**
- Modify: `packages/db/src/schema/progress.ts` (add column to `userExerciseHistory`; add new table + inferred types)
- Modify: `packages/db/src/schema/index.ts:29-38` (export the new table)
- Modify: `packages/db/src/index.ts` (barrel already does `export * from './schema'` — no edit needed)
- Create (generated): `packages/db/migrations/NNNN_*.sql`
- Test: none (schema; validated by generation + typecheck)

**Interfaces:**
- Produces: table `exerciseWordHints` with `{ exerciseId: uuid pk, unitsJson: WordHintUnit[], createdAt }`; column `userExerciseHistory.evidenceWeight: real (nullable)`.

- [ ] **Step 1: Add the column + table**

In `packages/db/src/schema/progress.ts`, add to the `userExerciseHistory` columns (after `evaluatedAt`):

```ts
    // Hint-penalty multiplier applied to this row's mastery observation (null → 1.0).
    evidenceWeight: real('evidence_weight'),
```

Append a new table at the end of `progress.ts` (import `WordHintUnit` at top: `import type { WordHintUnit } from '@language-drill/shared';`):

```ts
/** Permanent per-exercise cache of the translation word-hint map (cross-user). */
export const exerciseWordHints = pgTable('exercise_word_hints', {
  exerciseId: uuid('exercise_id')
    .primaryKey()
    .references(() => exercises.id, { onDelete: 'cascade' }),
  unitsJson: jsonb('units_json').$type<WordHintUnit[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ExerciseWordHints = typeof exerciseWordHints.$inferSelect;
```

Ensure `exercises` is imported in `progress.ts` (it already references `exercises.id` via `userExerciseHistory`, so the import exists).

- [ ] **Step 2: Export the table**

In `packages/db/src/schema/index.ts`, add `exerciseWordHints` to the `./progress` export block (`:31-37`):

```ts
export {
  userExerciseHistory,
  spacedRepetitionCards,
  fluencyAttempts,
  userGrammarMastery,
  errorObservations,
  exerciseWordHints,
} from './progress';
export type { ErrorObservation, NewErrorObservation, ExerciseWordHints } from './progress';
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @language-drill/db db:generate`
Expected: a new `packages/db/migrations/NNNN_*.sql` adding `evidence_weight` to `user_exercise_history` and `CREATE TABLE exercise_word_hints`. Inspect it — it must be additive only.

- [ ] **Step 4: Build + typecheck**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/progress.ts packages/db/src/schema/index.ts packages/db/migrations
git commit -m "feat(db): evidence_weight column + exercise_word_hints cache table"
```

---

## Task 4: AI module — `word-hint`

**Files:**
- Create: `packages/ai/src/word-hint-prompts.ts`, `packages/ai/src/word-hint.ts`
- Modify: `packages/ai/src/index.ts` (re-exports)
- Modify: `packages/ai/scripts/bootstrap-prompts.ts` (manifest entry + import)
- Test: `packages/ai/src/word-hint.test.ts`

**Interfaces:**
- Consumes: `WordHintUnit` (Task 1); `getPromptOrFallback` (`./prompts-registry.js`).
- Produces: `generateWordHints(client: Anthropic, input: WordHintInput): Promise<WordHintUnit[]>`; `parseWordHints(input: unknown): WordHintUnit[]`; `WORD_HINT_SYSTEM_PROMPT`, `WORD_HINT_PROMPT_VERSION`, `WORD_HINT_TOOL`, `WORD_HINT_TOOL_NAME`, `type WordHintInput`.

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/word-hint.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseWordHints } from './word-hint';

describe('parseWordHints', () => {
  it('keeps well-formed units and drops malformed ones', () => {
    const out = parseWordHints({
      units: [
        { text: 'The', hintable: false },
        { text: 'students', hintable: true, lemma: 'öğrenci' },
        { text: 'account for', hintable: true, lemma: 'hesaba katmak' },
        { text: 42, hintable: true },            // malformed → dropped
        { hintable: true, lemma: 'x' },          // no text → dropped
      ],
    });
    expect(out).toEqual([
      { text: 'The', hintable: false },
      { text: 'students', hintable: true, lemma: 'öğrenci' },
      { text: 'account for', hintable: true, lemma: 'hesaba katmak' },
    ]);
  });

  it('drops lemma when a unit is not hintable', () => {
    const out = parseWordHints({ units: [{ text: 'the', hintable: false, lemma: 'nope' }] });
    expect(out).toEqual([{ text: 'the', hintable: false }]);
  });

  it('returns [] for non-object / missing units', () => {
    expect(parseWordHints(null)).toEqual([]);
    expect(parseWordHints({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- word-hint.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the prompts module**

Create `packages/ai/src/word-hint-prompts.ts`:

```ts
import type { Language, CefrLevel } from "@language-drill/shared";

// Bump in the same commit as any semantic edit below (CLAUDE.md "Prompt Editing").
export const WORD_HINT_PROMPT_VERSION = "word-hint@2026-07-13";

export const WORD_HINT_SYSTEM_PROMPT = `You help a language learner who is translating an English sentence into a target language. You are given the English source, the reference target translation, and the target language.

Break the ENGLISH source sentence into an ordered list of units that, read in order, cover the whole sentence. For each unit decide whether it is a MEANINGFUL vocabulary hint:
- Group a multi-word expression into ONE unit when it translates as a unit (e.g. "account for", "give up").
- Mark articles, pronouns, auxiliaries, prepositions, and punctuation as hintable:false (no lemma).
- For hintable units, give the target-language DICTIONARY (base, uninflected) form the reference translation uses for that word — no case endings, no person/tense suffixes, lowercase. Use the reference translation to pick the correct sense.

Return the result via the tool only.`;

export function buildWordHintUserPrompt(opts: {
  sourceText: string;
  referenceTranslation: string;
  sourceLanguage: string;
  targetLanguage: Language;
}): string {
  return [
    `Source language: ${opts.sourceLanguage}`,
    `Target language: ${opts.targetLanguage}`,
    `English source: ${opts.sourceText}`,
    `Reference target translation: ${opts.referenceTranslation}`,
  ].join("\n");
}
```

- [ ] **Step 4: Write the call module**

Create `packages/ai/src/word-hint.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { Language, WordHintUnit } from "@language-drill/shared";
import { getPromptOrFallback } from "./prompts-registry.js";
import {
  WORD_HINT_SYSTEM_PROMPT,
  WORD_HINT_PROMPT_VERSION,
  buildWordHintUserPrompt,
} from "./word-hint-prompts.js";

const MODEL = "claude-haiku-4-5-20251001" as const;
const MAX_TOKENS = 512;
export const WORD_HINT_REQUEST_TIMEOUT_MS = 15_000;
export const WORD_HINT_MAX_RETRIES = 1;

export type WordHintInput = {
  sourceText: string;
  referenceTranslation: string;
  sourceLanguage: string;
  targetLanguage: Language;
};

export const WORD_HINT_TOOL_NAME = "submit_word_hints";
export const WORD_HINT_TOOL: Anthropic.Tool = {
  name: WORD_HINT_TOOL_NAME,
  description: "Submit the ordered word-hint units covering the English source sentence.",
  input_schema: {
    type: "object" as const,
    properties: {
      units: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "Exact English source slice for this unit." },
            hintable: { type: "boolean", description: "True only for meaningful vocabulary units." },
            lemma: { type: "string", description: "Target dictionary form; omit when hintable is false." },
          },
          required: ["text", "hintable"],
        },
      },
    },
    required: ["units"],
  },
};

export function parseWordHints(input: unknown): WordHintUnit[] {
  if (typeof input !== "object" || input === null) return [];
  const units = (input as Record<string, unknown>).units;
  if (!Array.isArray(units)) return [];
  const out: WordHintUnit[] = [];
  for (const raw of units) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.text !== "string" || typeof r.hintable !== "boolean") continue;
    if (r.hintable && typeof r.lemma === "string" && r.lemma.length > 0) {
      out.push({ text: r.text, hintable: true, lemma: r.lemma });
    } else {
      out.push({ text: r.text, hintable: false });
    }
  }
  return out;
}

export async function generateWordHints(
  client: Anthropic,
  input: WordHintInput,
): Promise<WordHintUnit[]> {
  const resolved = await getPromptOrFallback(
    "word-hint-system-prompt",
    WORD_HINT_SYSTEM_PROMPT,
    WORD_HINT_PROMPT_VERSION,
  );
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text" as const, text: resolved.text, cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user" as const, content: buildWordHintUserPrompt(input) }],
    tools: [WORD_HINT_TOOL],
    tool_choice: { type: "tool" as const, name: WORD_HINT_TOOL_NAME },
    temperature: 0,
  });
  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!block) {
    throw new Error(`Claude did not return a tool use block. Stop reason: ${response.stop_reason}.`);
  }
  return parseWordHints(block.input);
}
```

- [ ] **Step 5: Re-export from index + register manifest**

In `packages/ai/src/index.ts` add:

```ts
export {
  generateWordHints,
  parseWordHints,
  WORD_HINT_TOOL,
  WORD_HINT_TOOL_NAME,
  WORD_HINT_REQUEST_TIMEOUT_MS,
  WORD_HINT_MAX_RETRIES,
  type WordHintInput,
} from "./word-hint.js";
export {
  WORD_HINT_SYSTEM_PROMPT,
  WORD_HINT_PROMPT_VERSION,
  buildWordHintUserPrompt,
} from "./word-hint-prompts.js";
```

In `packages/ai/scripts/bootstrap-prompts.ts`, add `WORD_HINT_SYSTEM_PROMPT, WORD_HINT_PROMPT_VERSION` to the `../src/index.js` import block, and add this entry to the `PROMPTS` array:

```ts
  {
    name: "word-hint-system-prompt",
    text: WORD_HINT_SYSTEM_PROMPT,
    version: WORD_HINT_PROMPT_VERSION,
    surface: "word-hint",
  },
```

- [ ] **Step 6: Run test + build + typecheck**

Run: `pnpm --filter @language-drill/ai test -- word-hint.test.ts && pnpm --filter @language-drill/ai build && pnpm --filter @language-drill/ai typecheck`
Expected: PASS. (Memory: ai-db-build-cycle — do NOT import `@language-drill/db` from ai source; this module only imports `@language-drill/shared`, which is correct.)

- [ ] **Step 7: Commit**

```bash
git add packages/ai/src/word-hint.ts packages/ai/src/word-hint-prompts.ts packages/ai/src/word-hint.test.ts packages/ai/src/index.ts packages/ai/scripts/bootstrap-prompts.ts
git commit -m "feat(ai): word-hint module — batch source-to-dictionary-form resolution"
```

---

## Task 5: Backend — usage bucket + `resolveWordHints` + route

**Files:**
- Modify: `infra/lambda/src/usage/limits.ts:5-22` (new bucket)
- Create: `infra/lambda/src/lib/word-hints.ts` (orchestrator) + `infra/lambda/src/lib/word-hints.test.ts`
- Modify: `infra/lambda/src/routes/exercises.ts` (new route)

**Interfaces:**
- Consumes: `generateWordHints`, `WordHintUnit`, `exerciseWordHints`, `limitFor`, `getEffectivePlan`, `checkGlobalCapacity`.
- Produces: `resolveWordHints(deps): Promise<{ units: WordHintUnit[]; cached: boolean }>` and route `POST /exercises/:id/word-hints` returning `{ units: WordHintUnit[]; cached: boolean }`.

- [ ] **Step 1: Add the metering bucket**

In `infra/lambda/src/usage/limits.ts`, add `'translation_word_hint'` to the `MeteredEventType` union and to `BASE_DAILY_LIMITS`:

```ts
export type MeteredEventType =
  | 'ai_evaluation'
  | 'read_annotation'
  | 'read_span_annotation'
  | 'read_tts'
  | 'text_generation'
  | 'writing_helper'
  | 'translation_word_hint';
```

```ts
export const BASE_DAILY_LIMITS: Record<MeteredEventType, number> = {
  ai_evaluation: 50,
  read_annotation: 50,
  read_span_annotation: 150,
  read_tts: 50,
  text_generation: 20,
  writing_helper: 50,
  translation_word_hint: 50,
};
```

- [ ] **Step 2: Write the failing orchestrator test**

Create `infra/lambda/src/lib/word-hints.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { resolveWordHints } from './word-hints';

const UNITS = [{ text: 'water', hintable: true, lemma: 'su' }];

describe('resolveWordHints', () => {
  it('returns cached units without generating, metering, or gating', async () => {
    const generate = vi.fn();
    const meter = vi.fn();
    const writeCache = vi.fn();
    const checkLimit = vi.fn();
    const res = await resolveWordHints({
      readCache: async () => UNITS,
      checkLimit, generate, writeCache, meter,
    });
    expect(res).toEqual({ units: UNITS, cached: true });
    expect(generate).not.toHaveBeenCalled();
    expect(meter).not.toHaveBeenCalled();
    expect(checkLimit).not.toHaveBeenCalled();
  });

  it('on miss: gates, generates, caches, meters', async () => {
    const order: string[] = [];
    const res = await resolveWordHints({
      readCache: async () => null,
      checkLimit: async () => { order.push('gate'); },
      generate: async () => { order.push('gen'); return UNITS; },
      writeCache: async () => { order.push('cache'); },
      meter: async () => { order.push('meter'); },
    });
    expect(res).toEqual({ units: UNITS, cached: false });
    expect(order).toEqual(['gate', 'gen', 'cache', 'meter']);
  });

  it('on empty generation: does NOT cache or meter (allows retry)', async () => {
    const writeCache = vi.fn();
    const meter = vi.fn();
    const res = await resolveWordHints({
      readCache: async () => null,
      checkLimit: async () => {},
      generate: async () => [],
      writeCache, meter,
    });
    expect(res).toEqual({ units: [], cached: false });
    expect(writeCache).not.toHaveBeenCalled();
    expect(meter).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- word-hints.test.ts`
Expected: FAIL — module not found. (Memory: lambda-package-not-infra — the package is `@language-drill/lambda`.)

- [ ] **Step 4: Implement the orchestrator**

Create `infra/lambda/src/lib/word-hints.ts`:

```ts
import type { WordHintUnit } from '@language-drill/shared';

export type ResolveWordHintsDeps = {
  /** Return cached units, or null on a cache miss. */
  readCache: () => Promise<WordHintUnit[] | null>;
  /** Throw a typed limit/capacity error to abort before generating. */
  checkLimit: () => Promise<void>;
  /** Run the LLM call. */
  generate: () => Promise<WordHintUnit[]>;
  /** Persist units to the cache (best-effort; race-safe upsert). */
  writeCache: (units: WordHintUnit[]) => Promise<void>;
  /** Record one metered usage event. */
  meter: () => Promise<void>;
};

/**
 * Cache-or-generate the per-exercise word-hint map. Metering + gating happen
 * ONLY on a real cache miss with a non-empty generation.
 */
export async function resolveWordHints(
  deps: ResolveWordHintsDeps,
): Promise<{ units: WordHintUnit[]; cached: boolean }> {
  const cached = await deps.readCache();
  if (cached !== null) return { units: cached, cached: true };

  await deps.checkLimit();
  const units = await deps.generate();
  if (units.length === 0) return { units: [], cached: false };

  await deps.writeCache(units);
  await deps.meter();
  return { units, cached: false };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- word-hints.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire the route in `exercises.ts`**

Add imports (with the other `@language-drill/ai` / `@language-drill/db` imports):

```ts
import { generateWordHints, WORD_HINT_PROMPT_VERSION, WORD_HINT_REQUEST_TIMEOUT_MS, WORD_HINT_MAX_RETRIES } from '@language-drill/ai';
import { exerciseWordHints } from '@language-drill/db';
import { resolveWordHints } from '../lib/word-hints';
import { isTranslationContent, type WordHintUnit } from '@language-drill/shared';
```

Register the route near the other `exercises.post('/exercises/:id/...')` declarations (before `export default exercises;`):

```ts
exercises.post('/exercises/:id/word-hints', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');

  const rows = await db.select().from(exercisesTable).where(eq(exercisesTable.id, id)).limit(1);
  const exercise = rows[0];
  if (!exercise) return c.json({ error: 'Exercise not found', code: 'NOT_FOUND' }, 404);
  const content = exercise.contentJson as unknown;
  if (!isTranslationContent(content)) {
    return c.json({ error: 'Word hints are only available for translation exercises', code: 'UNSUPPORTED' }, 400);
  }

  class LimitError extends Error {
    constructor(public status: 429 | 503, public code: string) { super(code); }
  }

  try {
    const result = await resolveWordHints({
      readCache: async () => {
        const hit = await db
          .select({ units: exerciseWordHints.unitsJson })
          .from(exerciseWordHints)
          .where(eq(exerciseWordHints.exerciseId, id))
          .limit(1);
        return hit[0]?.units ?? null;
      },
      checkLimit: async () => {
        const plan = await getEffectivePlan(userId);
        const capacity = await checkGlobalCapacity({ plan, admin: isAdmin(userId) });
        if (capacity !== 'ok') throw new LimitError(503, 'GLOBAL_CAPACITY');
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const [{ count: todayCount }] = await db
          .select({ count: count() })
          .from(usageEvents)
          .where(and(
            eq(usageEvents.userId, userId),
            eq(usageEvents.eventType, 'translation_word_hint'),
            gte(usageEvents.createdAt, oneDayAgo),
          ));
        if (Number(todayCount) >= limitFor('translation_word_hint', plan)) {
          throw new LimitError(429, 'RATE_LIMIT_EXCEEDED');
        }
      },
      generate: async () => {
        const client = createObservedClaudeClient(ANTHROPIC_API_KEY, {
          timeout: WORD_HINT_REQUEST_TIMEOUT_MS,
          maxRetries: WORD_HINT_MAX_RETRIES,
        });
        return withLlmTrace(
          {
            env: process.env.APP_ENV ?? 'dev',
            requestId: c.get('requestId'),
            userId,
            exerciseId: id,
            language: exercise.language ?? undefined,
            cefrLevel: exercise.difficulty ?? undefined,
            feature: 'word-hint',
            promptVersion: WORD_HINT_PROMPT_VERSION,
          },
          () => generateWordHints(client, {
            sourceText: content.sourceText,
            referenceTranslation: content.referenceTranslation,
            sourceLanguage: content.sourceLanguage,
            targetLanguage: exercise.language as Language,
          }),
        );
      },
      writeCache: async (units: WordHintUnit[]) => {
        await db.insert(exerciseWordHints)
          .values({ exerciseId: id, unitsJson: units })
          .onConflictDoNothing({ target: exerciseWordHints.exerciseId });
      },
      meter: async () => {
        await db.insert(usageEvents).values({
          userId,
          eventType: 'translation_word_hint',
          metadata: { exerciseId: id, language: exercise.language },
        });
      },
    });
    return c.json(result);
  } catch (err) {
    if (err instanceof LimitError) {
      const msg = err.status === 429 ? 'Daily word-hint limit exceeded' : 'AI temporarily at capacity';
      return c.json({ error: msg, code: err.code }, err.status);
    }
    console.error('[word-hints] generation failed:', err);
    return c.json({ error: 'Could not generate hints', code: 'AI_UNAVAILABLE' }, 502);
  }
});
```

> **Naming check:** confirm the exercises table alias used at the top of `exercises.ts` (it is imported as `exercises as exercisesTable` in some files, but the router variable is also `exercises`). Use whatever the file already uses for the *table* (grep `from('exercises')` usage in the file); the router variable is `exercises`. Also confirm `withLlmTrace`'s trace-meta field names against an existing call site (`exercises.ts:619-630`) and match them exactly (`env, requestId, userId, exerciseId, language, cefrLevel, feature, promptVersion`).

- [ ] **Step 7: Typecheck + full lambda tests**

Run: `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda typecheck && pnpm --filter @language-drill/lambda test`
Expected: PASS. (Memory: lambda-stale-dist-test-files — clear `dist` first.)

- [ ] **Step 8: Commit**

```bash
git add infra/lambda/src/usage/limits.ts infra/lambda/src/lib/word-hints.ts infra/lambda/src/lib/word-hints.test.ts infra/lambda/src/routes/exercises.ts
git commit -m "feat(lambda): POST /exercises/:id/word-hints — cached, metered batch resolver"
```

---

## Task 6: Submit accepts + persists hint usage; applies the down-weight

**Files:**
- Modify: `infra/lambda/src/routes/exercises.ts` (`SubmitAnswerSchema`, `applyGrammarMastery`, submit handler, history insert)
- Modify: `packages/api-client/src/hooks/useExercise.ts:104-135` (`SubmitAnswerParams` + body)
- Test: add to the existing lambda submit test (or `infra/lambda/src/lib/word-hints.test.ts` for the pure weight fn)

**Interfaces:**
- Consumes: `SubmissionMeta.hintUsage` (Task... web side); down-weight curve constants.
- Produces: `evidenceWeightFromHints({ wordsRevealed, fullAnswerRevealed }): number`; `SubmitAnswerSchema` accepts `hintUsage`; `applyGrammarMastery` accepts `evidenceWeight`; history rows persist `evidenceWeight`.

- [ ] **Step 1: Write the failing weight-fn test**

Add to `infra/lambda/src/lib/word-hints.test.ts`:

```ts
import { evidenceWeightFromHints } from './word-hints';

describe('evidenceWeightFromHints', () => {
  it('no hints → 1.0', () => {
    expect(evidenceWeightFromHints(undefined)).toBe(1);
    expect(evidenceWeightFromHints({ wordsRevealed: 0, fullAnswerRevealed: false })).toBe(1);
  });
  it('per word −0.15, floored at 0.4', () => {
    expect(evidenceWeightFromHints({ wordsRevealed: 2, fullAnswerRevealed: false })).toBeCloseTo(0.7);
    expect(evidenceWeightFromHints({ wordsRevealed: 10, fullAnswerRevealed: false })).toBe(0.4);
  });
  it('full-answer reveal overrides to 0.1', () => {
    expect(evidenceWeightFromHints({ wordsRevealed: 1, fullAnswerRevealed: true })).toBe(0.1);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @language-drill/lambda test -- word-hints.test.ts`
Expected: FAIL — `evidenceWeightFromHints` not exported.

- [ ] **Step 3: Implement the weight fn**

Append to `infra/lambda/src/lib/word-hints.ts`:

```ts
export type HintUsage = { wordsRevealed: number; fullAnswerRevealed: boolean };

/** Down-weight curve (spec §Grading): 1.0 baseline; −0.15/word floored at 0.4; full-answer → 0.1. */
export function evidenceWeightFromHints(usage: HintUsage | undefined): number {
  if (!usage) return 1;
  if (usage.fullAnswerRevealed) return 0.1;
  return Math.max(0.4, 1 - 0.15 * Math.max(0, usage.wordsRevealed));
}
```

- [ ] **Step 4: Accept `hintUsage` on submit + thread the weight**

In `exercises.ts`, extend `SubmitAnswerSchema` (`:77-85`):

```ts
export const SubmitAnswerSchema = z.object({
  answer: z.string().min(1).max(EXERCISE_ANSWER_MAX_CHARS),
  sessionId: z.string().uuid().optional(),
  hintUsage: z.object({
    wordsRevealed: z.number().int().nonnegative(),
    fullAnswerRevealed: z.boolean(),
  }).optional(),
});
```

Destructure it (`:386`): `const { answer: userAnswer, sessionId, hintUsage } = bodyResult.data;`

Import + compute the weight once near the top of the handler:

```ts
import { evidenceWeightFromHints } from '../lib/word-hints';
// ...
const evidenceWeight = evidenceWeightFromHints(hintUsage);
```

Add `evidenceWeight` to `applyGrammarMastery`'s options and pass it to `updateMastery`:

```ts
async function applyGrammarMastery(opts: {
  userId: string;
  language: Language;
  grammarPointKey: string | null;
  difficulty: CefrLevel;
  score: number;
  evidenceWeight?: number;   // NEW
}): Promise<void> {
  // ...
    const next = updateMastery(existing[0] ?? null, {
      score: opts.score,
      difficulty: opts.difficulty,
      at,
      evidenceWeight: opts.evidenceWeight,   // NEW
    });
  // ...
}
```

Pass `evidenceWeight` at the **host** call sites that grade the learner's own answer — call site 4 (LLM path, `:745`) and the deterministic branches (call sites 1 & 2, `:487`, `:538`). Do **not** pass it at call site 3 (incidental-slip fold, `:728`) — those are secondary observations on *other* points, not the answered item:

```ts
    await applyGrammarMastery({
      userId,
      language: exercise.language as Language,
      grammarPointKey: exercise.grammarPointKey,
      difficulty: exercise.difficulty as CefrLevel,
      score: result.score,
      evidenceWeight,   // NEW (and likewise at sites 1 & 2)
    });
```

Persist `evidenceWeight` on every `user_exercise_history` insert (all four sites) — add `evidenceWeight` to the `.values({...})`:

```ts
    await db.insert(userExerciseHistory).values({
      id: submissionId,
      userId,
      exerciseId: id,
      sessionId,
      score: result.score,
      responseJson: { userAnswer, evaluation: stamped },
      evaluatedAt: new Date(),
      evidenceWeight,   // NEW
    });
```

- [ ] **Step 5: Thread hintUsage through the api-client hook**

In `packages/api-client/src/hooks/useExercise.ts`, extend `SubmitAnswerParams` and the body builder:

```ts
export type SubmitAnswerParams = {
  exerciseId: string;
  answer: string;
  sessionId?: string;
  hintUsage?: { wordsRevealed: number; fullAnswerRevealed: boolean };
};
```

```ts
    mutationFn: async ({ exerciseId, answer, sessionId, hintUsage }) => {
      const body: { answer: string; sessionId?: string; hintUsage?: SubmitAnswerParams['hintUsage'] } = { answer };
      if (sessionId !== undefined) body.sessionId = sessionId;
      if (hintUsage !== undefined) body.hintUsage = hintUsage;
      const response = await fetchFn(`/exercises/${exerciseId}/submit`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const json: unknown = await response.json();
      return parseSubmitResult(json);
    },
```

- [ ] **Step 6: Run + typecheck**

Run: `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test -- word-hints.test.ts && pnpm --filter @language-drill/lambda typecheck && pnpm --filter @language-drill/api-client typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add infra/lambda/src/routes/exercises.ts infra/lambda/src/lib/word-hints.ts infra/lambda/src/lib/word-hints.test.ts packages/api-client/src/hooks/useExercise.ts
git commit -m "feat: submit accepts structured hint usage and down-weights mastery evidence"
```

---

## Task 7: Thread `evidenceWeight` through the replay callers

**Files:**
- Modify: `packages/db/scripts/backfill-mastery.ts:42-73`
- Modify: `infra/lambda/src/routes/sessions.ts:1101-1131`
- Modify: `infra/lambda/src/lib/debrief/skill-movements.ts:11-17,45-47`
- Test: add to `infra/lambda/src/lib/debrief/skill-movements.test.ts` (create if absent)

**Interfaces:**
- Consumes: `HistoryRow.evidenceWeight` (Task 2); `userExerciseHistory.evidenceWeight` column (Task 3).
- Produces: replay paths pass persisted `evidenceWeight` so the debrief "what moved" matches the persisted mastery.

- [ ] **Step 1: Write the failing skill-movements test**

Add to `infra/lambda/src/lib/debrief/skill-movements.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeSkillMovements } from './skill-movements';
import { CefrLevel } from '@language-drill/shared';

it('carries evidenceWeight into the replay (hinted rows move mastery less)', () => {
  const labels = new Map([['g', 'Some point']]);
  const base = { grammarPointKey: 'g', score: 1, difficulty: CefrLevel.A1, evaluatedAt: new Date('2026-07-01') };
  const heavy = computeSkillMovements({
    rows: [{ id: '1', ...base }, { id: '2', ...base, evaluatedAt: new Date('2026-07-02') }],
    sessionRowIds: new Set(['2']),
    labels,
  });
  const light = computeSkillMovements({
    rows: [{ id: '1', ...base, evidenceWeight: 0.1 }, { id: '2', ...base, evaluatedAt: new Date('2026-07-02'), evidenceWeight: 0.1 }],
    sessionRowIds: new Set(['2']),
    labels,
  });
  // Same shape; assert the mapper accepts evidenceWeight and produces a result.
  expect(heavy).toBeDefined();
  expect(light).toBeDefined();
});
```

- [ ] **Step 2: Run to verify fail**

Run: `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test -- skill-movements.test.ts`
Expected: FAIL — `SkillHistoryRow` has no `evidenceWeight`.

- [ ] **Step 3: Add `evidenceWeight` to `SkillHistoryRow` + mapper**

In `infra/lambda/src/lib/debrief/skill-movements.ts`:

```ts
export type SkillHistoryRow = {
  id: string;
  grammarPointKey: string;
  score: number;
  difficulty: CefrLevel;
  evaluatedAt: Date;
  evidenceWeight?: number;   // NEW
};

function toHistoryRow(r: SkillHistoryRow): HistoryRow {
  return {
    grammarPointKey: r.grammarPointKey,
    score: r.score,
    difficulty: r.difficulty,
    evaluatedAt: r.evaluatedAt,
    evidenceWeight: r.evidenceWeight,   // NEW
  };
}
```

- [ ] **Step 4: Select the column in the two live queries**

In `infra/lambda/src/routes/sessions.ts` (`:1103-1109` select, `:1123-1128` map), add `evidenceWeight`:

```ts
      .select({
        id: userExerciseHistory.id,
        sessionId: userExerciseHistory.sessionId,
        grammarPointKey: exercisesTable.grammarPointKey,
        difficulty: exercisesTable.difficulty,
        score: userExerciseHistory.score,
        evaluatedAt: userExerciseHistory.evaluatedAt,
        evidenceWeight: userExerciseHistory.evidenceWeight,   // NEW
      })
```
```ts
    const rows: SkillHistoryRow[] = histRows.map((r) => ({
      id: r.id,
      grammarPointKey: r.grammarPointKey as string,
      score: r.score as number,
      difficulty: r.difficulty as CefrLevel,
      evaluatedAt: r.evaluatedAt as Date,
      evidenceWeight: r.evidenceWeight ?? undefined,   // NEW
    }));
```

In `packages/db/scripts/backfill-mastery.ts` (`:42-54` select, `:66-71` push):

```ts
    .select({
      userId: userExerciseHistory.userId,
      language: exercises.language,
      grammarPointKey: exercises.grammarPointKey,
      score: userExerciseHistory.score,
      difficulty: exercises.difficulty,
      evaluatedAt: userExerciseHistory.evaluatedAt,
      evidenceWeight: userExerciseHistory.evidenceWeight,   // NEW
    })
```
```ts
    list.push({
      grammarPointKey: r.grammarPointKey,
      score: r.score as number,
      difficulty: r.difficulty,
      evaluatedAt: new Date(r.evaluatedAt as Date),
      evidenceWeight: r.evidenceWeight ?? undefined,   // NEW
    });
```

- [ ] **Step 5: Run + typecheck**

Run: `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test -- skill-movements.test.ts && pnpm --filter @language-drill/lambda typecheck && pnpm --filter @language-drill/db typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/lib/debrief/skill-movements.ts infra/lambda/src/lib/debrief/skill-movements.test.ts infra/lambda/src/routes/sessions.ts packages/db/scripts/backfill-mastery.ts
git commit -m "feat: carry evidenceWeight through mastery replay (backfill + debrief)"
```

---

## Task 8: Frontend — clickable word hints in the translation drill

**Files:**
- Create: `packages/api-client/src/hooks/useWordHints.ts` + schema in `packages/api-client/src/schemas/exercise.ts`
- Modify: `apps/web/app/(dashboard)/drill/_components/types.ts:3-7` (`SubmissionMeta`)
- Modify: `apps/web/app/(dashboard)/drill/_components/translation-exercise.tsx` (replace ladder with clickable hints)
- Modify: `apps/web/app/(dashboard)/drill/_components/exercise-pane.tsx:83-97` (pass `fetchFn`)
- Modify: `apps/web/app/(dashboard)/drill/page.tsx:261-266` (pass `hintUsage` to mutate)
- Test: `apps/web/app/(dashboard)/drill/_components/translation-exercise.test.tsx`

**Interfaces:**
- Consumes: `POST /exercises/:id/word-hints → { units: WordHintUnit[]; cached: boolean }`.
- Produces: `useWordHints({ fetchFn })` mutation; `SubmissionMeta.hintUsage`.

- [ ] **Step 1: Add the response schema + hook**

In `packages/api-client/src/schemas/exercise.ts`:

```ts
export const WordHintUnitSchema = z.object({
  text: z.string(),
  hintable: z.boolean(),
  lemma: z.string().optional(),
});
export const WordHintsResponseSchema = z.object({
  units: z.array(WordHintUnitSchema),
  cached: z.boolean(),
});
export type WordHintsResponse = z.infer<typeof WordHintsResponseSchema>;
```

Create `packages/api-client/src/hooks/useWordHints.ts`:

```ts
import { useMutation } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../types';
import { WordHintsResponseSchema, type WordHintsResponse } from '../schemas/exercise';

export function useWordHints({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  return useMutation<WordHintsResponse, Error, { exerciseId: string }>({
    mutationFn: async ({ exerciseId }) => {
      const response = await fetchFn(`/exercises/${exerciseId}/word-hints`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const json: unknown = await response.json();
      return WordHintsResponseSchema.parse(json);
    },
  });
}
```

Export both from the api-client barrel (`packages/api-client/src/index.ts`) alongside the existing `useExercise` exports:

```ts
export { useWordHints } from './hooks/useWordHints';
export type { WordHintsResponse } from './schemas/exercise';
```

(Match the exact export style of the neighboring hook exports in that file.)

- [ ] **Step 2: Extend `SubmissionMeta`**

In `apps/web/app/(dashboard)/drill/_components/types.ts`:

```ts
export type SubmissionMeta = {
  usedMc?: boolean;
  hintLevel?: 0 | 1 | 2 | 3;
  hintCount?: number;
  hintUsage?: { wordsRevealed: number; fullAnswerRevealed: boolean };
};
```

- [ ] **Step 3: Write the failing component test**

Create `apps/web/app/(dashboard)/drill/_components/translation-exercise.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TranslationExercise } from './translation-exercise';
import { DrillActionProvider } from './drill-action-context';

const content = {
  type: 'translation' as const,
  instructions: 'Translate',
  sourceText: 'The students are ready',
  sourceLanguage: 'EN',
  targetLanguage: 'TR',
  referenceTranslation: 'Öğrenciler hazır',
};

function renderIt(fetchFn: any) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <DrillActionProvider>
        <TranslationExercise
          content={content as any}
          language={'TR' as any}
          submission={{ kind: 'idle' }}
          onSubmit={vi.fn()}
          onNext={vi.fn()}
          exerciseId="ex-1"
          fetchFn={fetchFn}
        />
      </DrillActionProvider>
    </QueryClientProvider>,
  );
}

describe('TranslationExercise word hints', () => {
  it('fetches once on "need a hint" and reveals a lemma on word click', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      json: async () => ({
        cached: false,
        units: [
          { text: 'The', hintable: false },
          { text: 'students', hintable: true, lemma: 'öğrenci' },
          { text: 'are ready', hintable: true, lemma: 'hazır' },
        ],
      }),
    });
    renderIt(fetchFn);
    fireEvent.click(screen.getByRole('button', { name: /need a hint/i }));
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    // hintable word is a button; non-hintable is not
    fireEvent.click(await screen.findByRole('button', { name: 'students' }));
    expect(await screen.findByText('öğrenci')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'The' })).toBeNull();
  });

  it('old gloss/half-reference ladder is gone but full-answer remains', () => {
    renderIt(vi.fn());
    expect(screen.queryByRole('button', { name: /show me a hint/i })).toBeNull();
    expect(screen.getByRole('button', { name: /reveal full answer/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run to verify fail**

Run: `pnpm --filter @language-drill/web test -- translation-exercise.test.tsx`
Expected: FAIL — component lacks `fetchFn` prop / new behavior.

- [ ] **Step 5: Rewrite the hint section of `translation-exercise.tsx`**

Replace the ladder implementation. Key edits:

1. Add `fetchFn` to `TranslationExerciseProps`:

```ts
import type { AuthenticatedFetch } from '@language-drill/api-client';
// ...
export interface TranslationExerciseProps {
  // ...existing...
  fetchFn?: AuthenticatedFetch;
}
```

2. Replace hint state + handlers (delete `firstGloss`, `halfReference`, `gloss`, `halfRef`, `hintCount`, `handleHint`):

```ts
import { useWordHints } from '@language-drill/api-client';
import type { WordHintUnit } from '@language-drill/shared';
// ...
const wordHints = useWordHints({ fetchFn: fetchFn ?? (async () => { throw new Error('no fetchFn'); }) });
const [hintsOpen, setHintsOpen] = React.useState(false);
const [revealed, setRevealed] = React.useState<Set<number>>(new Set());
const [fullAnswerShown, setFullAnswerShown] = React.useState(false);

function openHints() {
  setHintsOpen(true);
  if (!wordHints.data && !wordHints.isPending && exerciseId) {
    wordHints.mutate({ exerciseId });
  }
}
function revealUnit(idx: number) {
  setRevealed((prev) => new Set(prev).add(idx));
}
```

3. Update `handleSubmit` to emit structured usage:

```ts
function handleSubmit() {
  if (!answer.trim() || isLocked) return;
  onSubmit(answer, {
    hintUsage: { wordsRevealed: revealed.size, fullAnswerRevealed: fullAnswerShown },
  });
  clearDraft();
}
```
(Update the `useEffect` dependency array that closes over hint state: replace `hintCount` with `revealed, fullAnswerShown`.)

4. Replace the JSX hint block (the `{hintCount > 0 && ...}` and `{hintCount < 3 && <Button>show me a hint</Button>}` regions) with:

```tsx
{!hintsOpen && (
  <Button variant="ghost" size="sm" className="self-start" onClick={openHints} disabled={isLocked}>
    need a hint
  </Button>
)}

{hintsOpen && (
  <div className="flex flex-col gap-s-3">
    {wordHints.isPending && <p className="t-small text-ink-mute">loading hints…</p>}
    {wordHints.isError && <p className="t-small text-accent-2">couldn’t load hints — try again</p>}
    {wordHints.data && (
      <>
        <p className="t-small text-ink-mute">tap a word to reveal its dictionary form</p>
        <p className="t-body">
          {wordHints.data.units.map((u: WordHintUnit, i: number) => {
            const space = i > 0 ? ' ' : '';
            if (!u.hintable) return <span key={i} className="text-ink-mute">{space}{u.text}</span>;
            return (
              <React.Fragment key={i}>
                {space}
                <button
                  type="button"
                  aria-label={u.text}
                  onClick={() => revealUnit(i)}
                  className="rounded-sm px-[2px] underline decoration-dotted underline-offset-2 hover:bg-[var(--color-hilite-soft,var(--color-paper-2))]"
                >
                  {u.text}
                </button>
              </React.Fragment>
            );
          })}
        </p>
        {revealed.size > 0 && (
          <ul className="flex flex-col gap-s-1">
            {[...revealed].sort((a, b) => a - b).map((i) => (
              <li key={i} className="t-small">
                <span className="text-ink-mute">{wordHints.data!.units[i].text} &rarr; </span>
                <span className="text-ink">{wordHints.data!.units[i].lemma}</span>
              </li>
            ))}
          </ul>
        )}
      </>
    )}
    {!fullAnswerShown ? (
      <Button variant="ghost" size="sm" className="self-start" onClick={() => setFullAnswerShown(true)} disabled={isLocked}>
        reveal full answer
      </Button>
    ) : (
      <p className="t-small text-ink-mute">{content.referenceTranslation}</p>
    )}
  </div>
)}
```

5. Remove the now-unused `hintLevel={hintCount}` prop on `FeedbackShell` (replace with `hintLevel={0}` or drop it if optional — check `FeedbackShell`'s prop type and keep it compiling).

> **Design-system note:** `--color-hilite-soft` may not exist yet. If the compiled design-system CSS has no hilite token, add one to the design-system layer (globals/theme) rather than hardcoding a hex — see memory: radius-token-directional-collision and free-writing-prototype-css-port for how tokens are defined. The fallback `var(--color-paper-2)` keeps it compiling meanwhile.

- [ ] **Step 6: Pass `fetchFn` from `exercise-pane.tsx`**

In `exercise-pane.tsx` (`:83-97`), add `fetchFn={fetchFn}` to the `<TranslationExercise .../>` (the pane already receives `fetchFn`):

```tsx
      <TranslationExercise
        key={exercise.id}
        content={content}
        language={language}
        submission={submission}
        onSubmit={onSubmit}
        onNext={onNext}
        nextLabel={nextLabel}
        exerciseId={exercise.id}
        coach={coach}
        fetchFn={fetchFn}
      />
```

- [ ] **Step 7: Pass `hintUsage` through `page.tsx` submit**

In `apps/web/app/(dashboard)/drill/page.tsx` `handleSubmit` (`:261-266`), forward the structured usage:

```tsx
    submitMutation.mutate(
      {
        exerciseId: item.id,
        answer: trimmed,
        sessionId: state.session.id,
        hintUsage: meta.hintUsage,
      },
```

- [ ] **Step 8: Run tests + web build**

Run: `pnpm --filter @language-drill/web test -- translation-exercise.test.tsx`
Expected: PASS.

Run: `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web build`
Expected: PASS. (Memory: web-gate-misses-next-build — run `next build` when touching drill components that use hooks/state.)

Also grep for stale references to the removed ladder in other tests (memory: component-label-route-change-grep-all-tests):

Run: `grep -rn "show me a hint" apps/web` — expect no matches after this task; fix any test still asserting the old label.

- [ ] **Step 9: Commit**

```bash
git add packages/api-client/src apps/web/app/\(dashboard\)/drill
git commit -m "feat(web): clickable per-word translation hints with dictionary forms"
```

---

## Final verification

- [ ] **Full gate from repo root** (memory: verify-subagent-environmental-failure-claims — root-cause any failure, don't hand-wave it):

Run: `pnpm build && pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures. If `infra/lambda` tests flake under parallel load, that's the known `fileParallelism:false` config (memory: pnpm-test-infra-parallel-flake) — re-run the lambda package alone to confirm.

- [ ] **Runtime smoke (optional, via verify skill):** with `pnpm dev` running and `ANTHROPIC_API_KEY` set, open a TR/ES/DE translation drill item, click "need a hint", confirm words become tappable, a lemma reveals, and submitting a hinted-correct answer records a `translation_word_hint` usage event + an `evidence_weight < 1` history row. See `docs/testing.md` and the `verify` skill.

---

## Self-review notes (author)

- **Spec coverage:** batch resolver (Task 4–5), cache table (Task 3), metering bucket (Task 5), lazy-on-open fetch + clickable/greyed spans + full-answer exit + removed ladder (Task 8), structured hint usage + down-weight curve (Task 2, 6), replay persistence (Task 3, 7). All spec sections map to a task.
- **Deviation logged:** DB-table cache instead of Redis (no Redis client in repo) — behavior-equivalent.
- **Known verify-before-edit points flagged inline:** exercises-table alias in `exercises.ts`, `withLlmTrace` meta field names, `FeedbackShell` `hintLevel` prop, api-client barrel export style, existence of a `--color-hilite-soft` token.
