# Dictation Generation Pipeline — PR 1 (Text Generation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `dictation` exercise type into the background text-generation + validation pipeline so the scheduler can draft + validate dictation clip *text* per `(ES, B1/B2)` cell, producing approved `exercises` rows with `audioS3Key = null` (audio is filled by PR 2).

**Architecture:** Dictation becomes a first-class generated cell via a new `kind: 'dictation'` on `GrammarPoint` plus two synthetic ES umbrella entries (`es-b1-dictation`, `es-b2-dictation`). The generator drafts clip text through a new dictation generation prompt + tool; the validator scores listenability through a new dictation validation system prompt (reusing the existing `VALIDATION_TOOL` and `routeValidationResult`). `generateOneDraft` and `validateDraft` gain dictation branches; everything downstream (`runOneCell`, the worker pools, dedup, the audit row) is type-agnostic and needs no change. No DB schema change, no infra.

**Tech Stack:** TypeScript, pnpm workspaces + Turborepo, Vitest, Anthropic SDK (tool-use), Langfuse prompt registry, Drizzle.

**Spec:** [`../specs/2026-06-15-dictation-generation-pipeline-design.md`](../specs/2026-06-15-dictation-generation-pipeline-design.md)

**Pre-flight (read before Task 1):**
- `packages/ai/src/generate.ts` — `TOOL_NAME_BY_TYPE`, `GENERATION_TOOL_BY_TYPE`, `generateOneDraft`, `parseToolInput`, the dictation vetoes at lines ~776 and ~942.
- `packages/ai/src/generation-prompts.ts` — `GenerationPromptInputs`, `buildGenerationSystemPrompt`, `computeGenerationPromptVars` (throws for dictation), `buildGenerationUserPrompt`.
- `packages/ai/src/validate.ts` — `validateDraft`, `VALIDATION_TOOL`, `ValidationResult`.
- `packages/ai/src/validation-prompts.ts` — `buildValidationSystemPrompt`, `buildValidationUserPrompt` (veto at line ~330).
- `packages/ai/src/dictation-prompts.ts` — the existing eval-prompt pattern (`DICTATION_EVAL_PROMPT_VERSION`, system-prompt constant).
- `packages/ai/src/prompts-registry.ts` — `getPromptWithVarsOrFallback`.
- `packages/db/src/curriculum/{types→shared/curriculum-types,es,index}.ts` — `GrammarPoint`, `compatibleTypes`, `assertCurriculumInvariants`, `CURRICULUM_VERSION_ES`.
- `packages/db/src/generation/cells.ts` — `compatibleTypes`, `enumerateCurriculumCells`.
- `infra/lambda/src/generation/cell-targets.ts` — `CELL_TARGET_DEFAULTS`.
- `packages/ai/scripts/bootstrap-prompts.ts` — the `PROMPTS` manifest.

**Conventions for every task:** Tests live in the existing `*.test.ts` for the module under change (per CLAUDE.md — no orphaned test files). The real green gate is `pnpm turbo run test --concurrency=1` (single-package runs can pass against stale `dist`). After editing any `*_SYSTEM_PROMPT`/template, the matching `*_PROMPT_VERSION` must be set in the same commit (CLAUDE.md "Prompt Editing").

---

## Task 1: Curriculum — `kind: 'dictation'` + ES umbrellas + `compatibleTypes`

**Files:**
- Modify: `packages/shared/src/curriculum-types.ts` (widen `GrammarPoint.kind`)
- Modify: `packages/db/src/curriculum/es.ts` (add two umbrella entries; bump `CURRICULUM_VERSION_ES`)
- Modify: `packages/db/src/generation/cells.ts` (`compatibleTypes`)
- Test: `packages/db/src/generation/cells.test.ts`, `packages/db/src/curriculum/curriculum.test.ts`

- [ ] **Step 1: Widen the `kind` union**

In `packages/shared/src/curriculum-types.ts`, change the `kind` field:

```ts
  kind: 'grammar' | 'vocab' | 'dictation';
```

Update the doc-comment above the type to add a third bullet:

```ts
 *   - `'dictation'` — a synthetic per-(language, level) umbrella that owns the
 *     dictation generation cell. Carries no real grammar-point semantics; its
 *     description / examples feed the dictation generation prompt as theme +
 *     style guidance. Paired only with `ExerciseType.DICTATION` by
 *     `compatibleTypes()`. No `coverageSpec` (count-only).
```

- [ ] **Step 2: Write the failing `compatibleTypes` test**

In `packages/db/src/generation/cells.test.ts`, add:

```ts
import { ExerciseType } from '@language-drill/shared';
import { enumerateCurriculumCells } from './cells';
import { esCurriculum } from '../curriculum';

it('pairs a kind:dictation umbrella with DICTATION only', () => {
  const dictationCells = enumerateCurriculumCells(esCurriculum).filter(
    (c) => c.grammarPoint.kind === 'dictation',
  );
  expect(dictationCells.length).toBeGreaterThanOrEqual(2);
  for (const cell of dictationCells) {
    expect(cell.exerciseType).toBe(ExerciseType.DICTATION);
  }
  // es-b1-dictation produces exactly one cell (no cloze/translation pairing)
  const b1 = dictationCells.filter((c) => c.grammarPoint.key === 'es-b1-dictation');
  expect(b1).toHaveLength(1);
});
```

- [ ] **Step 3: Run it — expect FAIL**

Run: `pnpm --filter @language-drill/db test -- cells.test.ts`
Expected: FAIL — `compatibleTypes` returns `[cloze, translation]` (or throws) for the new kind, and the umbrellas don't exist yet.

- [ ] **Step 4: Add the `compatibleTypes` branch**

In `packages/db/src/generation/cells.ts`, add near the other kind constants:

```ts
const DICTATION_KIND_TYPES: ReadonlyArray<ExerciseType> = [ExerciseType.DICTATION];
```

and at the top of `compatibleTypes`:

```ts
function compatibleTypes(entry: GrammarPoint): ReadonlyArray<ExerciseType> {
  if (entry.kind === 'dictation') return DICTATION_KIND_TYPES;
  if (entry.kind === 'vocab') return VOCAB_KIND_TYPES;
  // ...unchanged grammar branch below
```

- [ ] **Step 5: Add the two ES umbrella entries**

In `packages/db/src/curriculum/es.ts`, append to the array (after the last B2 grammar entry, before/after the vocab umbrellas — order only affects enumeration order):

```ts
  // ---------------------------------------------------------------------------
  // Dictation umbrellas — kind: 'dictation' (Phase 2 generation pipeline)
  // ---------------------------------------------------------------------------
  {
    key: 'es-b1-dictation',
    kind: 'dictation',
    name: 'Dictation — connected speech (B1)',
    description:
      'Natural B1 connected-speech clips (2–4 short sentences) on everyday domains; tests sinalefa, weak-syllable reduction, and common spelling traps.',
    cefrLevel: 'B1',
    language: ES,
    examplesPositive: [
      'No te preocupes, el tiempo lo cura todo y mañana lo verás de otra manera.',
      'Quedamos a las ocho en la plaza y de ahí vamos andando al cine.',
    ],
    examplesNegative: ['*Clip de una sola palabra o lista inconexa sin oraciones naturales.'],
    commonErrors: [
      'Mis-segmenting word boundaries under sinalefa (hearing "lo cura" as "locura").',
      'Dropping the silent h or confusing b/v in spelling.',
    ],
  },
  {
    key: 'es-b2-dictation',
    kind: 'dictation',
    name: 'Dictation — connected speech (B2)',
    description:
      'Natural B2 connected-speech clips (3–5 sentences) with subordinate clauses and richer vocabulary; tests connected-speech tracking and spelling under faster delivery.',
    cefrLevel: 'B2',
    language: ES,
    examplesPositive: [
      'Aunque había estudiado mucho, en cuanto vio el examen se quedó en blanco y tuvo que respirar hondo.',
      'Me dijeron que, si llegábamos antes de las nueve, todavía habría sitio para aparcar cerca.',
    ],
    examplesNegative: ['*Texto demasiado largo o con vocabulario muy por encima de B2.'],
    commonErrors: [
      'Losing track of clause boundaries in longer sentences.',
      'Confusing similar-sounding connectors (aunque / a un que).',
    ],
  },
```

(`ES` and `B1`/`B2` constants are already imported/defined at the top of `es.ts` — reuse them; do not introduce new literals.)

- [ ] **Step 6: Bump the ES curriculum version**

In `packages/db/src/curriculum/es.ts`, find `CURRICULUM_VERSION_ES` and set it to today's date-stamped value (mirror the existing format, e.g. `'es@2026-06-15'`). This is REQUIRED — the scheduler's low-yield / saturated-dedup suppression only clears on a curriculum-version bump, so without it the brand-new dictation cells could be skipped. (See memory: "scheduler low-yield needs curriculum bump".)

- [ ] **Step 7: Run both test files — expect PASS**

Run: `pnpm --filter @language-drill/db test -- cells.test.ts curriculum.test.ts`
Expected: PASS. If `curriculum.test.ts` has an assertion that every entry is `grammar | vocab` (e.g. a hard-coded kind allow-list or an exact total-count check), update it to include the dictation umbrellas — do NOT loosen a count assertion silently; adjust the expected number by +2 and add `'dictation'` to any kind allow-list.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/curriculum-types.ts packages/db/src/curriculum/es.ts packages/db/src/generation/cells.ts packages/db/src/generation/cells.test.ts packages/db/src/curriculum/curriculum.test.ts
git commit -m "feat(db): add kind:dictation umbrellas + compatibleTypes for ES B1/B2"
```

---

## Task 2: Generation tool schema + voice pool

**Files:**
- Modify: `packages/ai/src/generate.ts`
- Test: `packages/ai/src/generate.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/ai/src/generate.test.ts`:

```ts
import {
  TOOL_NAME_BY_TYPE,
  GENERATION_TOOL_BY_TYPE,
  DICTATION_GENERATION_TOOL,
  DICTATION_VOICE_POOL_BY_LANGUAGE,
} from './generate';
import { ExerciseType, Language } from '@language-drill/shared';

it('registers a dictation generation tool', () => {
  expect(TOOL_NAME_BY_TYPE[ExerciseType.DICTATION]).toBe('submit_dictation_exercise');
  expect(GENERATION_TOOL_BY_TYPE[ExerciseType.DICTATION]).toBe(DICTATION_GENERATION_TOOL);
  expect(DICTATION_GENERATION_TOOL.name).toBe('submit_dictation_exercise');
  expect(DICTATION_GENERATION_TOOL.input_schema.required).toEqual(
    expect.arrayContaining(['title', 'referenceText', 'sentences', 'tested', 'durationSec']),
  );
});

it('has a non-empty ES dictation voice pool', () => {
  expect(DICTATION_VOICE_POOL_BY_LANGUAGE[Language.ES].length).toBeGreaterThan(0);
  expect(DICTATION_VOICE_POOL_BY_LANGUAGE[Language.ES][0]).toMatchObject({
    voiceId: expect.any(String),
    accent: expect.any(String),
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`DICTATION_GENERATION_TOOL` undefined).

Run: `pnpm --filter @language-drill/ai test -- generate.test.ts`

- [ ] **Step 3: Widen the type maps and add the tool + voice pool**

In `packages/ai/src/generate.ts`:

1. Change both `Exclude<ExerciseType, ExerciseType.DICTATION | ExerciseType.FREE_WRITING>` annotations (on `TOOL_NAME_BY_TYPE` and `GENERATION_TOOL_BY_TYPE`) to `Exclude<ExerciseType, ExerciseType.FREE_WRITING>`, and update the two comments above them to say dictation IS now batch-generated.

2. Add to the `TOOL_NAME_BY_TYPE` object literal:

```ts
  dictation: "submit_dictation_exercise",
```

3. Add the tool schema (after `SENTENCE_CONSTRUCTION_GENERATION_TOOL`):

```ts
export const DICTATION_GENERATION_TOOL: Anthropic.Tool = {
  name: "submit_dictation_exercise",
  description:
    "Submit a single dictation listening clip: a short passage of natural, connected speech for the learner to transcribe by ear.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        description:
          "Short title for the clip card (3–6 words), drawn from the clip's theme. Not read aloud.",
      },
      blurb: {
        type: "string",
        description: "Optional one-line brief shown under the title. Not read aloud.",
      },
      referenceText: {
        type: "string",
        description:
          "The full passage to be read aloud and transcribed — the grading reference. Natural connected speech with normal punctuation. No lists, no headings, no metadata.",
      },
      sentences: {
        type: "array",
        items: { type: "string" },
        description:
          "The referenceText split into its individual sentences, in order. Concatenated with single spaces they MUST equal referenceText.",
      },
      domain: {
        type: "string",
        description:
          "Everyday topical domain (e.g. 'daily routine', 'travel', 'work', 'weather'). Used for variety, not read aloud.",
      },
      register: {
        type: "string",
        description: "Register of the passage: 'informal', 'neutral', or 'formal'.",
      },
      tested: {
        type: "array",
        items: { type: "string" },
        description:
          "1–4 short labels of what the clip exercises (e.g. 'sinalefa', 'silent h', 'preterite vs imperfect'). Shown as chips; descriptive only.",
      },
      durationSec: {
        type: "number",
        description:
          "Estimated spoken duration in seconds at a natural pace (typically 6–18s for B1/B2). Approximate; refined when audio is synthesized.",
      },
    },
    required: ["title", "referenceText", "sentences", "tested", "durationSec"],
  },
};
```

4. Add `dictation: DICTATION_GENERATION_TOOL,` to the `GENERATION_TOOL_BY_TYPE` literal.

5. Add the voice pool (near the model constants, after `GENERATION_TEMPERATURE`):

```ts
/**
 * Polly neural voices used for synthesized dictation clips, keyed by language.
 * `voiceId`/`accent` are assigned by code (rotated by ordinal) — never by the
 * model — so a batch varies voice/accent deterministically. PR 2's audio-synth
 * Lambda reads `voiceId` from the stored content to call Polly.
 */
export const DICTATION_VOICE_POOL_BY_LANGUAGE: Readonly<
  Record<Exclude<Language, Language.EN>, ReadonlyArray<{ voiceId: string; accent: string }>>
> = Object.freeze({
  [Language.ES]: [
    { voiceId: "Sergio", accent: "español peninsular · centro" },
    { voiceId: "Lucia", accent: "español peninsular · centro" },
  ],
  // DE/TR added when those languages enter dictation scope (later milestone).
  [Language.DE]: [],
  [Language.TR]: [],
});
```

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/ai test -- generate.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/generate.ts packages/ai/src/generate.test.ts
git commit -m "feat(ai): dictation generation tool schema + ES voice pool"
```

---

## Task 3: Dictation draft parser + `canonicalSurface` case

**Files:**
- Modify: `packages/ai/src/generate.ts` (parser, `parseToolInput`)
- Modify: `packages/ai/src/generation-prompts.ts` (`canonicalSurface`)
- Test: `packages/ai/src/generate.test.ts`, `packages/ai/src/generation-prompts.test.ts`

- [ ] **Step 1: Write the failing parser test**

In `packages/ai/src/generate.test.ts`:

```ts
import { parseGeneratedDictationDraft } from './generate';
import { ExerciseType, Language } from '@language-drill/shared';

const dictSpec = {
  language: Language.ES, cefrLevel: 'B1', exerciseType: ExerciseType.DICTATION,
  grammarPoint: { key: 'es-b1-dictation', kind: 'dictation', name: 'x', description: 'x',
    cefrLevel: 'B1', language: Language.ES, examplesPositive: ['a','b'], examplesNegative: ['*c'], commonErrors: ['d'] },
  topicDomain: null, count: 1, batchSeed: 'test',
} as const;

it('parses a dictation draft and assigns voice/accent/waveform by ordinal', () => {
  const content = parseGeneratedDictationDraft(
    {
      title: 'El tiempo',
      referenceText: 'No te preocupes, el tiempo lo cura todo.',
      sentences: ['No te preocupes, el tiempo lo cura todo.'],
      tested: ['sinalefa'],
      durationSec: 7,
      domain: 'daily routine',
      register: 'informal',
    },
    dictSpec as never,
    0,
  );
  expect(content.type).toBe(ExerciseType.DICTATION);
  expect(content.referenceText).toContain('el tiempo');
  expect(content.voiceId).toBe('Sergio');     // ordinal 0 → first ES voice
  expect(content.accent).toContain('peninsular');
  expect(Array.isArray(content.waveform)).toBe(true);
  expect(content.waveform.length).toBeGreaterThan(0);
  expect(content.audioUrl).toBeUndefined();   // never set at generation time
});

it('rejects a dictation draft whose sentences do not join to referenceText', () => {
  expect(() =>
    parseGeneratedDictationDraft(
      { title: 't', referenceText: 'A B C.', sentences: ['A B.'], tested: ['x'], durationSec: 5 },
      dictSpec as never,
      0,
    ),
  ).toThrow(/sentences/);
});
```

- [ ] **Step 2: Run it — expect FAIL.** `pnpm --filter @language-drill/ai test -- generate.test.ts`

- [ ] **Step 3: Add the parser + a placeholder-waveform helper**

In `packages/ai/src/generate.ts`, add to the shared imports from `@language-drill/shared`: `type DictationContent`. Add `DICTATION_VOICE_POOL_BY_LANGUAGE` is already in this file. Then add:

```ts
const DICTATION_WAVEFORM_BARS = 40;

/** Deterministic decorative envelope (0..1), seeded from text length so the
 *  same draft always renders the same bars. Real amplitude envelopes are out
 *  of scope (decorative — see roadmap "smaller items"). */
function placeholderWaveform(seedText: string): number[] {
  const bars: number[] = [];
  let h = 0;
  for (let i = 0; i < seedText.length; i++) h = (h * 31 + seedText.charCodeAt(i)) >>> 0;
  for (let i = 0; i < DICTATION_WAVEFORM_BARS; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    bars.push(0.2 + ((h % 1000) / 1000) * 0.8); // 0.2..1.0
  }
  return bars;
}

export function parseGeneratedDictationDraft(
  input: unknown,
  spec: GenerationSpec,
  ordinal: number,
): DictationContent {
  const ctx = "dictation draft";
  if (!isObject(input)) {
    throw new Error(`${ctx}: must be an object, got ${typeof input}`);
  }
  const title = requireString(input, "title", ctx);
  const blurb = optionalString(input, "blurb", ctx);
  const referenceText = requireString(input, "referenceText", ctx);
  const sentences = requireStringArray(input, "sentences", ctx);
  const domain = optionalString(input, "domain", ctx);
  const register = optionalString(input, "register", ctx);
  const tested = requireStringArray(input, "tested", ctx);
  const durationSecRaw = input["durationSec"];

  if (sentences.length === 0) {
    throw new Error(`${ctx}: invalid sentences: must be a non-empty array`);
  }
  // Sentences must reconstitute the reference text (whitespace-normalized) so
  // the per-sentence display segmentation can't drift from the grading target.
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  if (norm(sentences.join(" ")) !== norm(referenceText)) {
    throw new Error(
      `${ctx}: invalid sentences: joined sentences must equal referenceText`,
    );
  }
  if (tested.length === 0) {
    throw new Error(`${ctx}: invalid tested: must be a non-empty array`);
  }
  if (typeof durationSecRaw !== "number" || !Number.isFinite(durationSecRaw) || durationSecRaw <= 0) {
    throw new Error(
      `${ctx}: invalid durationSec: must be a positive number, got ${JSON.stringify(durationSecRaw)}`,
    );
  }

  // Voice/accent assigned by code (rotated by ordinal), never by the model.
  const pool = DICTATION_VOICE_POOL_BY_LANGUAGE[spec.language];
  if (!pool || pool.length === 0) {
    throw new Error(`${ctx}: no dictation voice pool configured for ${spec.language}`);
  }
  const voice = pool[ordinal % pool.length];

  return {
    type: ExerciseType.DICTATION,
    title,
    ...(blurb !== undefined ? { blurb } : {}),
    referenceText,
    sentences,
    accent: voice.accent,
    voiceId: voice.voiceId,
    ...(domain !== undefined ? { domain } : {}),
    ...(register !== undefined ? { register } : {}),
    tested,
    durationSec: durationSecRaw,
    waveform: placeholderWaveform(referenceText),
  };
}
```

- [ ] **Step 4: Add the `canonicalSurface` dictation case**

In `packages/ai/src/generation-prompts.ts`, replace the `case ExerciseType.DICTATION:` throw inside `canonicalSurface` with:

```ts
    case ExerciseType.DICTATION:
      // The reference transcription is the dedup surface (drives `_dedupKey`
      // and in-batch duplicate detection).
      return normaliseSurface(content.referenceText);
```

- [ ] **Step 5: Add a `canonicalSurface` dictation test**

In `packages/ai/src/generation-prompts.test.ts`:

```ts
it('canonicalSurface uses referenceText for dictation', () => {
  const surface = canonicalSurface({
    type: ExerciseType.DICTATION, title: 't', referenceText: 'El Tiempo  lo Cura.',
    sentences: ['El Tiempo lo Cura.'], accent: 'a', voiceId: 'Sergio', tested: ['x'],
    durationSec: 5, waveform: [0.5],
  } as never);
  expect(surface).toBe('el tiempo lo cura.');
});
```

- [ ] **Step 6: Run both — expect PASS.** `pnpm --filter @language-drill/ai test -- generate.test.ts generation-prompts.test.ts`

- [ ] **Step 7: Commit**

```bash
git add packages/ai/src/generate.ts packages/ai/src/generation-prompts.ts packages/ai/src/generate.test.ts packages/ai/src/generation-prompts.test.ts
git commit -m "feat(ai): parseGeneratedDictationDraft + dictation canonicalSurface"
```

---

## Task 4: Dictation generation prompt (system + user)

**Files:**
- Create: `packages/ai/src/dictation-generation-prompts.ts`
- Test: `packages/ai/src/dictation-generation-prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/dictation-generation-prompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DICTATION_GENERATION_PROMPT_VERSION,
  DICTATION_GENERATION_SYSTEM_PROMPT,
  computeDictationGenerationPromptVars,
  buildDictationGenerationUserPrompt,
} from './dictation-generation-prompts';
import { applyTemplate } from './prompts-registry';
import { ExerciseType, Language } from '@language-drill/shared';

const inputs = {
  language: Language.ES, cefrLevel: 'B1', exerciseType: ExerciseType.DICTATION,
  grammarPoint: { key: 'es-b1-dictation', kind: 'dictation', name: 'Dictation — connected speech (B1)',
    description: 'Natural B1 clips.', cefrLevel: 'B1', language: Language.ES,
    examplesPositive: ['Ejemplo uno.', 'Ejemplo dos.'], examplesNegative: ['*malo'], commonErrors: ['sinalefa'] },
} as const;

it('version string is date-stamped for the dictation-generate surface', () => {
  expect(DICTATION_GENERATION_PROMPT_VERSION).toMatch(/^dictation-generate@\d{4}-\d{2}-\d{2}$/);
});

it('template renders with no leftover {{vars}}', () => {
  const vars = computeDictationGenerationPromptVars(inputs as never);
  const { text, missingVars } = applyTemplate(DICTATION_GENERATION_SYSTEM_PROMPT, vars);
  expect(missingVars).toEqual([]);
  expect(text).toContain('B1');
  expect(text).toContain('submit_dictation_exercise');
});

it('user prompt names the ordinal and the domain', () => {
  const u = buildDictationGenerationUserPrompt(inputs as never, 2, 'travel');
  expect(u).toContain('#3');
  expect(u).toContain('travel');
  expect(u).toContain('submit_dictation_exercise');
});
```

- [ ] **Step 2: Run it — expect FAIL** (module does not exist).

Run: `pnpm --filter @language-drill/ai test -- dictation-generation-prompts.test.ts`

- [ ] **Step 3: Create the module**

Create `packages/ai/src/dictation-generation-prompts.ts`:

```ts
/**
 * packages/ai — Generation prompt for dictation listening clips.
 *
 * Distinct from generation-prompts.ts (cloze/translation/vocab/SC): a dictation
 * "draft" is a short passage of natural connected speech to be read aloud and
 * transcribed. There is no blank, no answer to spoil, no grammar-point target —
 * the umbrella's description/examples are theme + style guidance only. The model
 * emits text + metadata via the submit_dictation_exercise tool; voiceId/accent
 * and the decorative waveform are assigned in code (see generate.ts).
 *
 * Flat-string `{{var}}` template (Langfuse-registered as
 * `dictation-generate-system-prompt`), substituted by both `applyTemplate`
 * (fallback) and Langfuse `compile(vars)`.
 */

import { ExerciseType, Language } from "@language-drill/shared";

import { CEFR_LEVEL_DESCRIPTORS } from "./prompts.js";
import type { GenerationPromptInputs } from "./generation-prompts.js";
import { getPromptWithVarsOrFallback } from "./prompts-registry.js";

// Bump in the same commit as any semantic edit to the template below.
export const DICTATION_GENERATION_PROMPT_VERSION = "dictation-generate@2026-06-15";

const CEFR_DESCRIPTOR_BULLETS = (
  Object.entries(CEFR_LEVEL_DESCRIPTORS) as [string, string][]
)
  .map(([level, descriptor]) => `- **${level}**: ${descriptor}`)
  .join("\n");

function renderBulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

export const DICTATION_GENERATION_SYSTEM_PROMPT = `You are an expert author of listening-dictation clips for {{language}} learners at CEFR {{cefrLevel}}. Produce ONE short passage of natural, connected speech that a learner will hear once and transcribe by ear.

## What this clip should test

{{grammarPointDescription}}

## Style references (the kind of passage that works well)

{{positiveExamplesBullets}}

## Avoid

{{negativeExamplesBullets}}

## Listening pitfalls a good clip exercises (without becoming a tongue-twister)

{{commonErrorsBullets}}

## CEFR level descriptors

{{cefrDescriptors}}

## Hard constraints

- **Natural connected speech.** Write the way a native speaker actually talks: full sentences with normal punctuation, ordinary contractions and liaison. NOT a word list, NOT headings, NOT bullet points, NOT metadata.
- **Length for level.** B1: 2–4 short sentences. B2: 3–5 sentences with some subordination. Keep it to one breath-group per sentence — a learner must be able to hold it in working memory.
- **Listenable, not a trap.** Avoid deliberate tongue-twisters, dense number/date sequences, proper-noun pile-ups, and segmentation traps so ambiguous that even a native could not transcribe them. One or two natural connected-speech challenges (sinalefa, a silent letter, a tricky boundary) are good; a wall of them is not.
- **Vocabulary band.** Every content word at or below CEFR {{cefrLevel}} everyday vocabulary. No above-level or specialist terms.
- **Safe, neutral topics.** Home, food, daily routine, travel, weather, study/work. Avoid weapons, substances, violence, and culturally sensitive or stereotyping content.
- **referenceText is the single source of truth.** \`sentences\` MUST be exactly \`referenceText\` split into its sentences (joining them with single spaces reproduces \`referenceText\`). \`durationSec\` is your best estimate of the spoken length at a natural pace.
- **One clip per tool call.** Do not batch multiple passages.
- You MUST use the {{toolName}} tool. Do not return plain text.

## Output

Use the {{toolName}} tool with all required fields populated.`;

export function computeDictationGenerationPromptVars(
  inputs: GenerationPromptInputs,
): Record<string, string> {
  if (inputs.exerciseType !== ExerciseType.DICTATION) {
    throw new Error(
      "computeDictationGenerationPromptVars: non-dictation cell routed to the dictation prompt",
    );
  }
  const { language, cefrLevel, grammarPoint } = inputs;
  return {
    language,
    cefrLevel,
    grammarPointDescription: grammarPoint.description,
    positiveExamplesBullets: renderBulletList(grammarPoint.examplesPositive),
    negativeExamplesBullets: renderBulletList(grammarPoint.examplesNegative),
    commonErrorsBullets: renderBulletList(grammarPoint.commonErrors),
    cefrDescriptors: CEFR_DESCRIPTOR_BULLETS,
    toolName: "submit_dictation_exercise",
  };
}

export async function buildDictationGenerationSystemPrompt(
  inputs: GenerationPromptInputs,
): Promise<string> {
  const vars = computeDictationGenerationPromptVars(inputs);
  const { text } = await getPromptWithVarsOrFallback(
    "dictation-generate-system-prompt",
    DICTATION_GENERATION_SYSTEM_PROMPT,
    DICTATION_GENERATION_PROMPT_VERSION,
    vars,
  );
  return text;
}

export function buildDictationGenerationUserPrompt(
  inputs: GenerationPromptInputs,
  ordinal: number,
  topicDomain: string | null,
): string {
  const domain = topicDomain ?? "mixed everyday topics";
  return `Produce dictation clip #${ordinal + 1}.

Topic domain: ${domain}

Vary the domain, sentence shapes, and vocabulary from clip to clip so a batch is diverse. Use the submit_dictation_exercise tool.`;
}
```

(Verify `CEFR_LEVEL_DESCRIPTORS` is exported from `./prompts.js` — it is used the same way in `generation-prompts.ts`.)

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/ai test -- dictation-generation-prompts.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/dictation-generation-prompts.ts packages/ai/src/dictation-generation-prompts.test.ts
git commit -m "feat(ai): dictation generation system + user prompt"
```

---

## Task 5: Wire dictation into `generateOneDraft`

**Files:**
- Modify: `packages/ai/src/generate.ts`
- Test: `packages/ai/src/generate.test.ts`

- [ ] **Step 1: Write the failing test** (mock the Anthropic client returning a dictation tool_use)

In `packages/ai/src/generate.test.ts`:

```ts
import { generateOneDraft } from './generate';

function mockDictationClient() {
  return {
    messages: {
      create: async () => ({
        stop_reason: 'tool_use',
        content: [{
          type: 'tool_use', name: 'submit_dictation_exercise',
          input: {
            title: 'El tiempo', referenceText: 'No te preocupes, el tiempo lo cura todo.',
            sentences: ['No te preocupes, el tiempo lo cura todo.'], tested: ['sinalefa'],
            durationSec: 7, domain: 'daily routine', register: 'informal',
          },
        }],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    },
  } as never;
}

it('generateOneDraft produces a dictation draft (no veto)', async () => {
  const res = await generateOneDraft(mockDictationClient(), dictSpec as never, 0);
  expect(res.kind).toBe('draft');
  if (res.kind !== 'draft') return;
  expect(res.draft.contentJson.type).toBe(ExerciseType.DICTATION);
  expect(res.draft.contentJson).toMatchObject({ voiceId: 'Sergio' });
});
```

(`dictSpec` is the fixture from Task 3.)

- [ ] **Step 2: Run it — expect FAIL** (throws "not batch-generated").

Run: `pnpm --filter @language-drill/ai test -- generate.test.ts`

- [ ] **Step 3: Branch `generateOneDraft` for dictation; remove the veto**

In `packages/ai/src/generate.ts`:

1. Add the import: `buildDictationGenerationSystemPrompt, buildDictationGenerationUserPrompt` from `./dictation-generation-prompts.js`.

2. Replace the system/user prompt construction block and the dictation veto. The current code builds `systemText`/`userText` via the cloze builders THEN throws for dictation. Restructure so dictation uses its own builders and never reaches the cloze builders:

```ts
  const isDictation = spec.exerciseType === ExerciseType.DICTATION;

  const systemText =
    spec.systemPromptOverride ??
    (isDictation
      ? await buildDictationGenerationSystemPrompt(promptInputs)
      : await buildGenerationSystemPrompt(promptInputs, []));

  const userText = isDictation
    ? buildDictationGenerationUserPrompt(promptInputs, ordinal, spec.topicDomain)
    : buildGenerationUserPrompt(
        promptInputs,
        ordinal,
        spec.topicDomain,
        spec.seedWords?.[ordinal] ?? null,
        spec.coverageTargets,
      );

  // (DELETE the `if (spec.exerciseType === ExerciseType.DICTATION) throw ...` block.)
  const tool =
    GENERATION_TOOL_BY_TYPE[spec.exerciseType as keyof typeof GENERATION_TOOL_BY_TYPE];
```

3. In the `try { ... content = parseToolInput(toolUseBlock.input, spec); }` block, route dictation to the ordinal-aware parser:

```ts
    content = isDictation
      ? parseGeneratedDictationDraft(toolUseBlock.input, spec, ordinal)
      : parseToolInput(toolUseBlock.input, spec);
```

4. Leave the `parseToolInput` DICTATION case throwing (defensive — dictation never reaches it now).

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/ai test -- generate.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/generate.ts packages/ai/src/generate.test.ts
git commit -m "feat(ai): generateOneDraft dictation branch; remove generation veto"
```

---

## Task 6: Dictation validation prompt (system + user)

**Files:**
- Create: `packages/ai/src/dictation-validation-prompts.ts`
- Test: `packages/ai/src/dictation-validation-prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/dictation-validation-prompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DICTATION_VALIDATION_PROMPT_VERSION,
  DICTATION_VALIDATION_SYSTEM_PROMPT,
  computeDictationValidationPromptVars,
  buildDictationValidationUserPrompt,
} from './dictation-validation-prompts';
import { applyTemplate } from './prompts-registry';
import { ExerciseType, Language } from '@language-drill/shared';

const spec = {
  language: Language.ES, cefrLevel: 'B1', exerciseType: ExerciseType.DICTATION,
  grammarPoint: { key: 'es-b1-dictation', kind: 'dictation', name: 'Dictation B1',
    description: 'd', cefrLevel: 'B1', language: Language.ES,
    examplesPositive: ['a','b'], examplesNegative: ['*c'], commonErrors: ['e'] },
} as const;

it('version string is date-stamped for the dictation-validate surface', () => {
  expect(DICTATION_VALIDATION_PROMPT_VERSION).toMatch(/^dictation-validate@\d{4}-\d{2}-\d{2}$/);
});

it('template renders with no leftover vars and mentions the validation tool', () => {
  const { text, missingVars } = applyTemplate(
    DICTATION_VALIDATION_SYSTEM_PROMPT, computeDictationValidationPromptVars(spec as never));
  expect(missingVars).toEqual([]);
  expect(text).toContain('submit_validation_result');
  expect(text).toContain('listenab');
});

it('user prompt shows the clip text', () => {
  const content = { type: ExerciseType.DICTATION, title: 't', referenceText: 'El tiempo lo cura.',
    sentences: ['El tiempo lo cura.'], accent: 'a', voiceId: 'Sergio', tested: ['sinalefa'],
    durationSec: 6, waveform: [0.5] };
  const u = buildDictationValidationUserPrompt(content as never, spec as never);
  expect(u).toContain('El tiempo lo cura.');
  expect(u).toContain('sinalefa');
});
```

- [ ] **Step 2: Run it — expect FAIL.** `pnpm --filter @language-drill/ai test -- dictation-validation-prompts.test.ts`

- [ ] **Step 3: Create the module**

Create `packages/ai/src/dictation-validation-prompts.ts`:

```ts
/**
 * packages/ai — Validation prompt for dictation listening clips.
 *
 * Distinct system prompt from validation-prompts.ts (which is cloze/translation/
 * vocab/SC-framed: ambiguous blank, contextSpoilsAnswer). Dictation has no blank
 * and no answer to spoil — it is validated on length-for-level, vocabulary band,
 * naturalness, and listenability. It reuses the SAME `submit_validation_result`
 * tool and `ValidationResult` shape so `routeValidationResult` is unchanged: the
 * model sets `ambiguous=false`, `contextSpoilsAnswer=false`, `grammarPointMatch=true`
 * (not a grammar-point exercise), `levelMatch` per judgment, and `qualityScore`
 * per the dictation rubric.
 */

import { ExerciseType, type DictationContent } from "@language-drill/shared";

import { CEFR_LEVEL_DESCRIPTORS } from "./prompts.js";
import type { GenerationSpec } from "./generate.js";
import { getPromptWithVarsOrFallback } from "./prompts-registry.js";

export const DICTATION_VALIDATION_PROMPT_VERSION = "dictation-validate@2026-06-15";

const CEFR_DESCRIPTOR_BULLETS = (
  Object.entries(CEFR_LEVEL_DESCRIPTORS) as [string, string][]
)
  .map(([level, descriptor]) => `- **${level}**: ${descriptor}`)
  .join("\n");

export const DICTATION_VALIDATION_SYSTEM_PROMPT = `You are a strict reviewer of dictation listening clips for {{language}} learners at CEFR {{cefrLevel}}. You validate ONE already-generated clip: a short passage meant to be read aloud and transcribed by ear.

Be conservative. A flagged clip costs a human ~30 seconds of review; an auto-approved bad clip wastes the learner's time and corrupts their listening signal.

## Routing implication of your scores

Your output is routed by these rules:
- qualityScore < 0.5  OR  any cultural issue  → REJECTED (dropped, not stored)
- qualityScore in [0.5, 0.7)                  → FLAGGED (waits for human review)
- qualityScore >= 0.7 AND levelMatch          → AUTO-APPROVED (synthesized + shown to learners)
- otherwise                                    → FLAGGED

## CEFR level descriptors

{{cefrDescriptors}}

## What to score

1. **qualityScore** (0.0–1.0): overall fitness as a {{cefrLevel}} dictation clip. Judge:
   - **Naturalness** — does it read like real connected speech a native would say? (Stilted / textbook-ish / list-like → lower.)
   - **Length for level** — B1: 2–4 short sentences; B2: 3–5 with some subordination. Too long to hold in working memory, or trivially short → lower.
   - **Vocabulary band** — every content word at or below {{cefrLevel}} everyday vocabulary.
   - **Listenability** — NOT a tongue-twister, NOT a dense number/date/proper-noun pile-up, NOT a segmentation trap so ambiguous a native could not transcribe it. One or two natural connected-speech challenges are GOOD; a wall of them is bad.
   Anchors: 0.9 publishable as-is; 0.8 one cosmetic edit; 0.65 borderline (FLAGGED); 0.5 unusable (REJECTED).
2. **levelMatch** (boolean): does the difficulty sit at {{cefrLevel}}?
3. **culturalIssues** (array): stereotyping, sensitive or unsafe content. Non-empty → REJECTED.
4. **flaggedReasons** (array): anything a reviewer should know.

## Fields that do not apply to dictation — set them as follows

- **ambiguous**: always \`false\` (there is no blank / single answer).
- **contextSpoilsAnswer**: always \`false\` (there is nothing to spoil).
- **grammarPointMatch**: always \`true\` (a dictation clip targets listening, not a single grammar point).
- Leave the \`coverage\` object empty.

## Output

You MUST use the submit_validation_result tool. Do not return plain text.`;

export function computeDictationValidationPromptVars(
  spec: GenerationSpec,
): Record<string, string> {
  return {
    language: spec.language,
    cefrLevel: spec.cefrLevel,
    cefrDescriptors: CEFR_DESCRIPTOR_BULLETS,
  };
}

export async function buildDictationValidationSystemPrompt(
  spec: GenerationSpec,
): Promise<string> {
  const vars = computeDictationValidationPromptVars(spec);
  const { text } = await getPromptWithVarsOrFallback(
    "dictation-validate-system-prompt",
    DICTATION_VALIDATION_SYSTEM_PROMPT,
    DICTATION_VALIDATION_PROMPT_VERSION,
    vars,
  );
  return text;
}

export function buildDictationValidationUserPrompt(
  content: DictationContent,
  spec: GenerationSpec,
): string {
  return `## Validate this Dictation clip

**Spec:** language=${spec.language}, cefrLevel=${spec.cefrLevel}
**Title:** ${content.title}
**Reference text (read aloud):** ${content.referenceText}
**Sentence count:** ${content.sentences.length}
**Estimated duration (s):** ${content.durationSec}
**Tested (descriptive):** ${content.tested.join(", ")}

Score the dimensions in the system prompt and submit via the submit_validation_result tool. Remember: ambiguous=false, contextSpoilsAnswer=false, grammarPointMatch=true for dictation.`;
}
```

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/ai test -- dictation-validation-prompts.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/dictation-validation-prompts.ts packages/ai/src/dictation-validation-prompts.test.ts
git commit -m "feat(ai): dictation validation system + user prompt"
```

---

## Task 7: Wire dictation into `validateDraft`

**Files:**
- Modify: `packages/ai/src/validate.ts`
- Test: `packages/ai/src/validate.test.ts`

- [ ] **Step 1: Write the failing test** (mock client returning a validation result for a dictation draft)

In `packages/ai/src/validate.test.ts`:

```ts
import { validateDraft } from './validate';
import { ExerciseType, Language } from '@language-drill/shared';

function mockValidatorClient(capture: { system?: string }) {
  return {
    messages: {
      create: async (req: any) => {
        capture.system = req.system[0].text;
        return {
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', name: 'submit_validation_result', input: {
            qualityScore: 0.85, ambiguous: false, contextSpoilsAnswer: false,
            levelMatch: true, grammarPointMatch: true, culturalIssues: [], flaggedReasons: [],
          }}],
          usage: { input_tokens: 5, output_tokens: 5 },
        };
      },
    },
  } as never;
}

it('validateDraft uses the dictation validation prompt for a dictation draft', async () => {
  const capture: { system?: string } = {};
  const draft = { id: 'x', contentJson: {
    type: ExerciseType.DICTATION, title: 't', referenceText: 'El tiempo lo cura.',
    sentences: ['El tiempo lo cura.'], accent: 'a', voiceId: 'Sergio', tested: ['sinalefa'],
    durationSec: 6, waveform: [0.5],
  }, metadata: {} } as never;
  const spec = { language: Language.ES, cefrLevel: 'B1', exerciseType: ExerciseType.DICTATION,
    grammarPoint: { key: 'es-b1-dictation', kind: 'dictation', name: 'd', description: 'd',
      cefrLevel: 'B1', language: Language.ES, examplesPositive: ['a','b'], examplesNegative: ['*c'], commonErrors: ['e'] },
    topicDomain: null, count: 1, batchSeed: 't' } as never;
  const res = await validateDraft(mockValidatorClient(capture), draft, spec);
  expect(res.result.qualityScore).toBe(0.85);
  expect(capture.system).toContain('dictation');          // dictation system prompt, not the cloze one
  expect(capture.system).not.toContain('Spoiled blank');  // cloze-only phrasing absent
});
```

- [ ] **Step 2: Run it — expect FAIL** (throws "not validated via this path").

Run: `pnpm --filter @language-drill/ai test -- validate.test.ts`

- [ ] **Step 3: Branch `validateDraft`**

In `packages/ai/src/validate.ts`:

1. Import the dictation builders: `buildDictationValidationSystemPrompt, buildDictationValidationUserPrompt` from `./dictation-validation-prompts.js`.

2. Replace the `systemText`/`userText` construction:

```ts
  const isDictation = draft.contentJson.type === ExerciseType.DICTATION;
  const systemText = isDictation
    ? await buildDictationValidationSystemPrompt(spec)
    : await buildValidationSystemPrompt(spec);
  const userText = isDictation
    ? buildDictationValidationUserPrompt(draft.contentJson, spec)
    : buildValidationUserPrompt(draft, spec);
```

3. Add the `ExerciseType` import to the top-of-file `@language-drill/shared` import if not present (it imports `CoverageTags` etc. already — add `ExerciseType`).

The existing guard `if (!(draft.contentJson.type in TOOL_NAME_BY_TYPE))` already passes for dictation (Task 2 added it to the map). The tool stays `VALIDATION_TOOL`. Leave the dictation veto in `validation-prompts.ts` `buildValidationUserPrompt` in place — dictation no longer reaches it.

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/ai test -- validate.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/validate.ts packages/ai/src/validate.test.ts
git commit -m "feat(ai): validateDraft dictation branch (separate listenability prompt)"
```

---

## Task 8: Re-exports + Langfuse manifest entries

**Files:**
- Modify: `packages/ai/src/index.ts`
- Modify: `packages/ai/scripts/bootstrap-prompts.ts`
- Test: `packages/ai/scripts/bootstrap-prompts.test.ts`

- [ ] **Step 1: Re-export the new symbols**

In `packages/ai/src/index.ts`, add re-exports (mirror how `DICTATION_EVAL_*` is exported):

```ts
export {
  DICTATION_GENERATION_PROMPT_VERSION,
  DICTATION_GENERATION_SYSTEM_PROMPT,
} from "./dictation-generation-prompts.js";
export {
  DICTATION_VALIDATION_PROMPT_VERSION,
  DICTATION_VALIDATION_SYSTEM_PROMPT,
} from "./dictation-validation-prompts.js";
```

Also export `DICTATION_GENERATION_TOOL`, `DICTATION_VOICE_POOL_BY_LANGUAGE`, and `parseGeneratedDictationDraft` from `./generate.js` if the barrel doesn't already use `export * from "./generate.js"`. Check the existing pattern and match it.

- [ ] **Step 2: Update the failing manifest count test**

In `packages/ai/scripts/bootstrap-prompts.test.ts`, find the assertion on `PROMPTS.length` (currently `10`) and the surface-coverage assertions. Update the expected count to `12` and add `dictation-generate` / `dictation-validate` to any surface list. Write this first (it will fail until Step 3).

Run: `pnpm --filter @language-drill/ai test -- bootstrap-prompts.test.ts` → expect FAIL.

- [ ] **Step 3: Add the two manifest entries**

In `packages/ai/scripts/bootstrap-prompts.ts`:

1. Add to the imports from `../src/index.js`: `DICTATION_GENERATION_PROMPT_VERSION, DICTATION_GENERATION_SYSTEM_PROMPT, DICTATION_VALIDATION_PROMPT_VERSION, DICTATION_VALIDATION_SYSTEM_PROMPT`.

2. Append to the `PROMPTS` array:

```ts
  {
    name: "dictation-generate-system-prompt",
    text: DICTATION_GENERATION_SYSTEM_PROMPT,
    version: DICTATION_GENERATION_PROMPT_VERSION,
    surface: "dictation-generate",
  },
  {
    name: "dictation-validate-system-prompt",
    text: DICTATION_VALIDATION_SYSTEM_PROMPT,
    version: DICTATION_VALIDATION_PROMPT_VERSION,
    surface: "dictation-validate",
  },
```

(The runtime registry keys `dictation-generate-system-prompt` / `dictation-validate-system-prompt` MUST match the names passed to `getPromptWithVarsOrFallback` in Tasks 4 and 6.) See memory: "new prompt needs manifest entry".

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/ai test -- bootstrap-prompts.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/index.ts packages/ai/scripts/bootstrap-prompts.ts packages/ai/scripts/bootstrap-prompts.test.ts
git commit -m "feat(ai): register dictation generate/validate prompts in the manifest"
```

---

## Task 9: Cell targets for dictation

**Files:**
- Modify: `infra/lambda/src/generation/cell-targets.ts`
- Test: `infra/lambda/src/generation/cell-targets.test.ts` (create if absent; otherwise add)

- [ ] **Step 1: Write the failing test**

In `infra/lambda/src/generation/cell-targets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import { resolveCellTarget } from './cell-targets';

it('resolves dictation B1/B2 targets to 15', () => {
  const make = (cefrLevel: 'B1' | 'B2') => ({
    language: 'ES', cefrLevel, exerciseType: ExerciseType.DICTATION,
    grammarPoint: { key: `es-${cefrLevel.toLowerCase()}-dictation`, kind: 'dictation' },
    cellKey: `ES:${cefrLevel}:dictation:es-${cefrLevel.toLowerCase()}-dictation`,
  } as never);
  expect(resolveCellTarget(make('B1'))).toBe(15);
  expect(resolveCellTarget(make('B2'))).toBe(15);
});
```

- [ ] **Step 2: Run it — expect FAIL** (empty `DICTATION` record → falls to `TARGET_PER_CELL` = 50).

Run: `pnpm --filter @language-drill/lambda test -- cell-targets.test.ts`

- [ ] **Step 3: Set the targets**

In `infra/lambda/src/generation/cell-targets.ts`, replace the `[ExerciseType.DICTATION]: {}` line and its comment:

```ts
  // Connected-speech clips are expensive (Polly synth + audio storage) and a
  // small rotating pool fills the single listening slot per session; B1/B2 only
  // this milestone (A1/A2 dictation is pedagogically out of scope).
  [ExerciseType.DICTATION]: { B1: 15, B2: 15 },
```

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/lambda test -- cell-targets.test.ts`

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/generation/cell-targets.ts infra/lambda/src/generation/cell-targets.test.ts
git commit -m "feat(lambda): dictation cell targets B1/B2 = 15"
```

---

## Task 9b: Serve gate — never serve an audioless dictation row

**Why this is in PR 1:** once this PR ships, the scheduler creates approved
dictation rows with `audioS3Key = null` (audio is filled by PR 2). The existing
`GET /exercises?type=dictation` query serves any approved row, so without this
gate a learner could be handed an unplayable clip. The gate makes those rows
invisible until PR 2 attaches audio.

**Files:**
- Modify: `infra/lambda/src/lib/exercise-filters.ts` (add `audioReadyFilter`)
- Modify: `infra/lambda/src/routes/exercises.ts` (apply it to the pool draw + by-id fetch)
- Modify: `infra/lambda/src/routes/sessions.ts` (apply it to the today-plan pool draw)
- Test: `infra/lambda/src/routes/exercises.test.ts`

- [ ] **Step 1: Write the failing test**

In `infra/lambda/src/routes/exercises.test.ts`, add a case: seed two approved ES/B1 dictation rows — one with `audioS3Key` set, one `null` — and assert `GET /exercises?language=ES&difficulty=B1&type=dictation` never returns the null-audio row (run it enough times / assert the returned id is the audio-ready one). Also assert a `null`-audio dictation id returns 404 (or is excluded) from `GET /exercises/:id` if that endpoint is used to serve dictation.

- [ ] **Step 2: Run it — expect FAIL** (the null-audio row can be served).

Run: `pnpm --filter @language-drill/lambda test -- exercises.test.ts`

- [ ] **Step 3: Add and apply the filter**

In `infra/lambda/src/lib/exercise-filters.ts`, add (mirroring `approvedStatusFilter`):

```ts
import { sql } from 'drizzle-orm';

/**
 * Excludes dictation rows that have no synthesized audio yet (`audio_s3_key IS
 * NULL`). Non-dictation rows are unaffected. Generated dictation text rows are
 * approved before PR-2's audio-synth Lambda attaches audio; this filter keeps
 * those transient, unplayable rows out of every serve path.
 */
export function audioReadyFilter(t: { type: AnyColumn; audioS3Key: AnyColumn }) {
  return sql`(${t.type} <> 'dictation' OR ${t.audioS3Key} IS NOT NULL)`;
}
```

(Match the actual column-accessor pattern used by `approvedStatusFilter` in this
file — pass the table object the same way; adjust the `AnyColumn` typing to the
existing helper's signature.)

In `infra/lambda/src/routes/exercises.ts`, add `audioReadyFilter(exercisesTable)`
to the `conditions` array of `GET /exercises` (alongside `approvedStatusFilter`),
and add it to the `and(...)` of the `GET /exercises/:id` fetch. In
`infra/lambda/src/routes/sessions.ts`, add it to the today-plan pool-draw `where`
(defensive — dictation isn't in `V1_PLAN_SHAPE` today, but the gate must hold if
it's ever added).

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/lambda test -- exercises.test.ts`

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/exercise-filters.ts infra/lambda/src/routes/exercises.ts infra/lambda/src/routes/sessions.ts infra/lambda/src/routes/exercises.test.ts
git commit -m "feat(lambda): hide audioless dictation rows from every serve path"
```

---

## Task 10: Coverage tags — pin the no-axis behavior

**Files:**
- Test: `packages/shared/src/coverage.test.ts` (add) and/or `packages/db/src/generation/coverage-tags.test.ts`

- [ ] **Step 1: Write the test** (this should pass with no production change — `coverageAxesFor` already returns `[]` for dictation; pin it so a future edit can't silently start tagging dictation)

In `packages/shared/src/coverage.test.ts`:

```ts
import { coverageAxesFor } from './coverage';
import { ExerciseType } from './index';

it('dictation has no coverage axes', () => {
  expect(coverageAxesFor(ExerciseType.DICTATION, undefined)).toEqual([]);
});
```

In `packages/db/src/generation/coverage-tags.test.ts` (or wherever `applicableCoverageTags` is tested), add:

```ts
it('applicableCoverageTags returns null for a dictation cell', () => {
  const cell = { language: 'ES', cefrLevel: 'B1', exerciseType: ExerciseType.DICTATION,
    grammarPoint: { key: 'es-b1-dictation', kind: 'dictation', coverageSpec: undefined },
    cellKey: 'ES:B1:dictation:es-b1-dictation' } as never;
  expect(applicableCoverageTags(cell, {})).toBeNull();
});
```

- [ ] **Step 2: Run them — expect PASS.** If `applicableCoverageTags` throws or returns `{}` for dictation, fix it to return `null` (mirror its existing empty-axes handling); otherwise no production change.

Run: `pnpm --filter @language-drill/shared test -- coverage.test.ts` and `pnpm --filter @language-drill/db test -- coverage-tags.test.ts`

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/coverage.test.ts packages/db/src/generation/coverage-tags.test.ts
git commit -m "test: pin dictation no-coverage-axis behavior"
```

---

## Task 11: `eval:gen` dictation flow

**Files:**
- Modify (if needed): `packages/ai/scripts/eval-gen-run.ts`
- Test: `packages/ai/scripts/eval-gen-run.test.ts`

- [ ] **Step 1: Trace the executor for a dictation cell**

Read `packages/ai/scripts/eval-gen-run.ts`'s `makeRealArmExecutor` and `resolveGenerationPromptSource`. The runner calls `generateBatch(client, spec)` then `validateDraft` then `routeValidationResult` — all now dictation-capable. The only dictation-specific concern is the prompt **source**: `--baseline/--candidate repo` resolves the *cloze* `GENERATION_SYSTEM_PROMPT_TEMPLATE`. For a dictation arm, `spec.systemPromptOverride` would be a dictation template — but if the executor sets `systemPromptOverride` from the resolved cloze template, dictation's `generateOneDraft` would use it verbatim and ignore the dictation builder.

- [ ] **Step 2: Write a test that a dictation cell routes through `generateBatch` without the cloze override**

In `packages/ai/scripts/eval-gen-run.test.ts`, add a test that builds a `CellDescriptor` with `exerciseType: 'dictation'`, `grammarPointKey: 'es-b1-dictation'` and asserts `resolveCell()` returns a cell whose `grammarPoint.kind === 'dictation'`, and that the arm executor, when the prompt source is `repo`, leaves `spec.systemPromptOverride` UNSET for dictation (so the dictation builder runs). Expected: FAIL if the executor unconditionally sets `systemPromptOverride` from the cloze template.

- [ ] **Step 3: Make the executor dictation-aware**

In `makeRealArmExecutor`, when `spec.exerciseType === ExerciseType.DICTATION`, do NOT inject the resolved cloze `systemPromptOverride` (leave it `undefined` so `generateOneDraft` calls `buildDictationGenerationSystemPrompt`). Document that A/B of the dictation *generation* prompt via `eval:gen` is a follow-up (would need a `--surface dictation-generate` switch and a `file:`/`langfuse:` dictation source); this milestone only ensures dictation cells *flow* through the gate against the repo dictation prompt. `log()`/comment this limitation explicitly so it isn't mistaken for full coverage.

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/ai test -- eval-gen-run.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/ai/scripts/eval-gen-run.ts packages/ai/scripts/eval-gen-run.test.ts
git commit -m "feat(ai): eval:gen flows dictation cells through the repo dictation prompt"
```

---

## Task 12: Skill-topic seeding for the dictation umbrellas

**Files:**
- Modify (if needed): `packages/db/scripts/seed-exercises.ts` (or wherever `skill_topics` are seeded from the curriculum)
- Test: the seed script's existing test, or `packages/db/src/generation/run-one-cell.test.ts`

- [ ] **Step 1: Confirm the gap**

`runOneCell` (`packages/db/src/generation/run-one-cell.ts`) fails-closed if no `skill_topics` row exists for `cell.grammarPoint.key`. Read the exercise/skill-topic seed script and confirm whether it iterates `ALL_CURRICULA` (auto-covering the new umbrellas) or a hand-listed set. Grep: `grep -rn "skillTopics\|skill_topics\|deterministicUuid(.skill-topic" packages/db/scripts`.

- [ ] **Step 2: If hand-listed, extend it; if curriculum-driven, add a test**

- If the seed derives skill topics from `ALL_CURRICULA`, the umbrellas are covered automatically — add an assertion to the seed test that a `skill_topics` row id `deterministicUuid('skill-topic:es-b1-dictation')` is produced.
- If hand-listed, add `es-b1-dictation` and `es-b2-dictation` (and any name/CEFR metadata the seed needs), mirroring an existing entry.

- [ ] **Step 3: Run the seed test — expect PASS.** `pnpm --filter @language-drill/db test -- seed-exercises.test.ts` (adjust filename to the actual test).

- [ ] **Step 4: Commit**

```bash
git add packages/db/scripts/seed-exercises.ts packages/db/scripts/seed-exercises.test.ts
git commit -m "feat(db): seed skill_topics for dictation umbrellas"
```

---

## Task 13: Full-suite gate + Langfuse sync note

- [ ] **Step 1: Lint + typecheck + tests across all packages**

```bash
pnpm lint
pnpm typecheck
pnpm turbo run test --concurrency=1
```

Expected: zero failures. Watch specifically for `Record<ExerciseType, …>` exhaustiveness errors surfaced by widening `TOOL_NAME_BY_TYPE`/`GENERATION_TOOL_BY_TYPE` — fix each by adding a real dictation handling (not a stub). Use `pnpm typecheck -- --continue 2>&1 | grep "error TS"` to enumerate them in one pass (see memory: "ExerciseType enum ripple"). Run infra serially (`--concurrency=1`) to avoid the known parallel-load flake.

- [ ] **Step 2: Document the post-merge Langfuse sync (do NOT run against prod here)**

Add a one-line note to the PR description: after merge, sync the two new prompts to prod + dev Langfuse with `pnpm push-prompts` (per CLAUDE.md "Prompt Editing"), then confirm `bootstrap-prompts --check` is clean. Until then the runtime serves the in-repo fallback (correct behavior). A/B the dictation generation prompt with `eval:gen` rather than waiting on the ~04:00 UTC scheduler (see memory: "verify prompt changes with eval:gen").

- [ ] **Step 3: Final commit (if any lint/typecheck fixes were needed)**

```bash
git add -A
git commit -m "chore(dictation): fix exhaustiveness ripple from dictation generation wiring"
```

---

## Self-review checklist (run after drafting, before execution)

- [ ] **Spec coverage:** §1 synthetic cells → Task 1; §2 text-gen → Tasks 2–8; §2 validation → Tasks 6–7; §4 serve gate → Task 9b; §4 scheduler targets → Task 9; §4 eval:gen → Task 11; §5 exhaustiveness ripple → Task 13. (Audio Lambda + handler enqueue + `DraftOutcome` inserted-id are PR 2 — out of scope here.)
- [ ] **No DB migration** in PR 1 (no schema change; `audioS3Key` already exists and stays null).
- [ ] **Type consistency:** `parseGeneratedDictationDraft(input, spec, ordinal)` (3-arg) used identically in Task 3 and Task 5; `buildDictationGenerationSystemPrompt(inputs)` / `buildDictationValidationSystemPrompt(spec)` names match across Tasks 4/5/6/7; registry names `dictation-generate-system-prompt` / `dictation-validate-system-prompt` match across Tasks 4/6/8.
- [ ] **Version constants** set in the same commit as each new prompt (Tasks 4, 6).
