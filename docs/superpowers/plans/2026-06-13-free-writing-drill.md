# Free Writing Drill Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Free Writing" drill — the learner writes a free paragraph against a constrained prompt, Claude grades it on 4 IELTS-style criteria with inline error markup and an improved version to compare against.

**Architecture:** A new `free_writing` exercise type reuses the existing `exercises` / `user_exercise_history` tables and the `POST /exercises/:id/submit` route (which branches on `type` to a new rich evaluator). The evaluator returns *exact substrings* for errors/good-spans/upgrades; the web client reconstructs the annotated view by splicing those spans into the learner's original text. Free Writing is its own web route (`/drill/free-writing`) with a small client state machine — it is **not** part of the existing multi-item session flow.

**Tech Stack:** TypeScript monorepo (pnpm + turbo). `packages/shared` (types), `packages/ai` (Claude tool-use evaluation), `packages/api-client` (TanStack Query + Zod), `infra/lambda` (Hono), `apps/web` (Next.js App Router + Tailwind v4), `packages/db` (Drizzle seed). Tests: Vitest everywhere; React Testing Library in `apps/web`.

**Design spec:** `docs/superpowers/specs/2026-06-13-free-writing-drill-design.md`
**Prototype reference (port markup from these):** `docs/superpowers/plans/2026-06-13-free-writing-prototype/`

---

## Conventions for every task

- **Work in the worktree** `/Users/seal/dev/language-drill/.claude/worktrees/feat-free-writing` (branch `feat-free-writing`). All paths below are repo-relative.
- After editing a `packages/*` source that another package imports (esp. `packages/db` / `packages/shared`), run `pnpm build` (turbo) before a single-package vitest run, or the dependent test resolves a stale `dist`. (Known gotcha: vitest workspace dist resolution.)
- Commit messages end with the trailing line:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Do **not** push. Final verification (Task 17) runs the full suite.

### Token remap table (prototype CSS var → web app token)

When porting prototype markup/CSS, rewrite every bare variable:

| Prototype | Web app (globals.css `@theme`) | Tailwind utility |
|---|---|---|
| `var(--accent)` | `var(--color-accent)` | `accent` (e.g. `bg-accent`, `text-accent`) |
| `var(--accent-2)` | `var(--color-accent-2)` | `accent-2` |
| `var(--accent-soft)` | `var(--color-accent-soft)` | `accent-soft` |
| `var(--ink)` `--ink-2` `--ink-soft` `--ink-mute` | `var(--color-ink*)` | `ink`, `ink-2`, `ink-soft`, `ink-mute` |
| `var(--paper)` `--paper-2` `--paper-3` | `var(--color-paper*)` | `paper`, `paper-2`, `paper-3` |
| `var(--card)` | `var(--color-card)` | `card` |
| `var(--rule)` | `var(--color-rule)` | `rule` |
| `var(--ok)` `--ok-soft` | `var(--color-ok)` `--color-ok-soft` | `ok`, `ok-soft` |
| `var(--hilite)` `--hilite-soft` | `var(--color-hilite*)` | `hilite`, `hilite-soft` |
| `var(--r-sm/md/lg)` | `var(--radius-r-sm/md/lg)` | `rounded-r-sm/md/lg` |
| `var(--t-display)` | `var(--font-display)` | `font-display` |
| `var(--t-mono)` | `var(--font-mono)` | `font-mono` |
| `var(--shadow-1/2)` | `var(--shadow-1/2)` (same) | `shadow-1/2` |
| type classes `t-display-l`, `t-body-l`, `t-mono`, `t-small`, `t-micro` | exist already in globals.css | use as-is |

Component-specific prototype classes (`.fw-prose`, `.fw-err`, `.fw-crit`, `.fw-counter`, `.fw-req`, `.fw-cefr`, `.fw-sev`, `.fw-errrow`, `.fw-compare`, `.fw-drillcard`, `.fw-skill`, `.fw-helpbtn`, `.fw-helppanel`, `.fw-vocab-row`, `.fw-good`, `.fw-add`) get copied into `apps/web/app/(dashboard)/drill/free-writing/free-writing.css` with the variable names remapped per the table above.

---

## Task 1: Shared types — `free_writing` content + rich evaluation

**Files:**
- Modify: `packages/shared/src/index.ts` (enum at lines 76–81; union at 151–155; guards after 185; evaluation types after 207)
- Test: `packages/shared/src/index.test.ts` (create if absent; otherwise append)

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  ExerciseType,
  isFreeWritingContent,
  type FreeWritingContent,
  type ExerciseContent,
} from './index';

describe('isFreeWritingContent', () => {
  const content: FreeWritingContent = {
    type: ExerciseType.FREE_WRITING,
    instructions: 'Write a paragraph.',
    title: 'El teletrabajo',
    task: 'Argue for or against remote work.',
    domain: 'opinión · argumentación',
    register: 'formal',
    minWords: 150,
    maxWords: 200,
    suggestedMinutes: 20,
    requiredElements: [{ id: 'cond', label: 'Use two conditionals' }],
  };

  it('returns true for free_writing content', () => {
    expect(isFreeWritingContent(content)).toBe(true);
  });

  it('returns false for another type', () => {
    const cloze = { type: ExerciseType.CLOZE } as unknown as ExerciseContent;
    expect(isFreeWritingContent(cloze)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/shared test -- index.test.ts`
Expected: FAIL — `isFreeWritingContent` / `FreeWritingContent` not exported.

- [ ] **Step 3: Add the enum member**

In `packages/shared/src/index.ts`, add to `ExerciseType`:

```ts
export enum ExerciseType {
  CLOZE = "cloze",
  TRANSLATION = "translation",
  VOCAB_RECALL = "vocab_recall",
  SENTENCE_CONSTRUCTION = "sentence_construction",
  FREE_WRITING = "free_writing",
}
```

- [ ] **Step 4: Add the content types** (after `SentenceConstructionContent`, before the `ExerciseContent` union)

```ts
export type FreeWritingRequiredElement = {
  /** Stable id used as a React key and as the checklist row id. */
  id: string;
  /** What the learner must do, in the target language. */
  label: string;
  /** Optional hint on how to satisfy it (e.g. the grammar trigger). */
  detail?: string;
};

export type FreeWritingContent = {
  type: ExerciseType.FREE_WRITING;
  instructions: string;
  /** Short headline for the prompt, e.g. "El teletrabajo: ¿avance o aislamiento?". */
  title: string;
  /** The task statement shown to the learner. */
  task: string;
  /** Topic-domain label, e.g. "opinión · argumentación". */
  domain: string;
  register: "informal" | "neutral" | "formal";
  minWords: number;
  maxWords: number;
  /** Countdown length (minutes) for exam-simulation mode. */
  suggestedMinutes?: number;
  requiredElements: FreeWritingRequiredElement[];
  topicHint?: string;
};
```

- [ ] **Step 5: Add `FreeWritingContent` to the `ExerciseContent` union**

```ts
export type ExerciseContent =
  | ClozeContent
  | TranslationContent
  | VocabRecallContent
  | SentenceConstructionContent
  | FreeWritingContent;
```

- [ ] **Step 6: Add the guard** (after `isSentenceConstructionContent`)

```ts
export function isFreeWritingContent(
  content: ExerciseContent,
): content is FreeWritingContent {
  return content.type === ExerciseType.FREE_WRITING;
}
```

- [ ] **Step 7: Add the rich evaluation types** (after `EvaluationResult`, around line 207)

```ts
// ---------------------------------------------------------------------------
// Free Writing evaluation — richer than the flat EvaluationResult above.
// Claude returns EXACT substrings (error.original, goodSpans, improved.upgrades)
// so the client can splice highlights into the learner's original text without
// trusting Claude to reproduce it verbatim. A span that can't be located is
// dropped, never corrupting the text. See the design spec, §1–2.
// ---------------------------------------------------------------------------

export type FreeWritingSeverity = "high" | "med" | "low";

export type FreeWritingCriterionId = "task" | "coherence" | "lexis" | "grammar";

export type FreeWritingCriterion = {
  id: FreeWritingCriterionId;
  label: string;
  score: number; // 0..1
  cefr: string; // per-criterion CEFR estimate, e.g. "B2", "B1+"
  note: string;
};

export type FreeWritingError = {
  n: number; // 1-based stable index, referenced by the markup
  severity: FreeWritingSeverity;
  type: string; // category label, e.g. "Modo verbal"
  original: string; // EXACT substring of the learner's text
  correction: string;
  where?: string; // human locus, e.g. "oración condicional · §3"
  note: string;
};

export type FreeWritingImproved = {
  text: string; // full improved paragraph(s), freshly written
  upgrades?: string[]; // EXACT substrings within `text` to highlight green
};

export type FreeWritingEvaluation = {
  overallScore: number; // 0..1 — stored in user_exercise_history.score
  overallCefr: string;
  headline: string;
  summary: string;
  criteria: FreeWritingCriterion[]; // exactly 4, task/coherence/lexis/grammar order
  errors: FreeWritingError[];
  goodSpans: string[]; // EXACT substrings to highlight as done-well
  improved: FreeWritingImproved;
  wordCount: number;
  improvedWordCount: number;
};
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/shared test -- index.test.ts`
Expected: PASS.

- [ ] **Step 9: Build shared so downstream packages see the new exports**

Run: `pnpm --filter @language-drill/shared build`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/index.test.ts
git commit -m "feat(shared): free_writing exercise type + rich evaluation types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: AI — Free Writing evaluation prompt

**Files:**
- Create: `packages/ai/src/free-writing-prompts.ts`
- Test: `packages/ai/src/free-writing-prompts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { CefrLevel, Language, ExerciseType, type FreeWritingContent } from '@language-drill/shared';
import {
  FREE_WRITING_EVAL_SYSTEM_PROMPT,
  FREE_WRITING_EVAL_PROMPT_VERSION,
  buildFreeWritingUserPrompt,
} from './free-writing-prompts';

const content: FreeWritingContent = {
  type: ExerciseType.FREE_WRITING,
  instructions: 'Write a paragraph.',
  title: 'El teletrabajo',
  task: 'Argumenta a favor o en contra del teletrabajo.',
  domain: 'opinión',
  register: 'formal',
  minWords: 150,
  maxWords: 200,
  requiredElements: [{ id: 'cond', label: 'Usa dos oraciones condicionales' }],
};

describe('FREE_WRITING_EVAL_PROMPT_VERSION', () => {
  it('is a dated free-writing-eval tag', () => {
    expect(FREE_WRITING_EVAL_PROMPT_VERSION).toMatch(/^free-writing-eval@\d{4}-\d{2}-\d{2}$/);
  });
});

describe('FREE_WRITING_EVAL_SYSTEM_PROMPT', () => {
  it('names the four IELTS-style criteria', () => {
    expect(FREE_WRITING_EVAL_SYSTEM_PROMPT).toMatch(/task achievement/i);
    expect(FREE_WRITING_EVAL_SYSTEM_PROMPT).toMatch(/coherence/i);
    expect(FREE_WRITING_EVAL_SYSTEM_PROMPT).toMatch(/lexical/i);
    expect(FREE_WRITING_EVAL_SYSTEM_PROMPT).toMatch(/grammatical range/i);
  });
  it('instructs the model to return exact substrings', () => {
    expect(FREE_WRITING_EVAL_SYSTEM_PROMPT).toMatch(/exact substring/i);
  });
});

describe('buildFreeWritingUserPrompt', () => {
  it('includes the task, constraints, required elements, and the learner answer', () => {
    const p = buildFreeWritingUserPrompt(content, 'Mi respuesta.', Language.ES, CefrLevel.B2);
    expect(p).toContain('Argumenta a favor');
    expect(p).toContain('150');
    expect(p).toContain('200');
    expect(p).toContain('formal');
    expect(p).toContain('Usa dos oraciones condicionales');
    expect(p).toContain('Mi respuesta.');
    expect(p).toContain('ES');
    expect(p).toContain('B2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- free-writing-prompts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the prompt module**

`packages/ai/src/free-writing-prompts.ts`:

```ts
/**
 * packages/ai — Free Writing evaluation prompt.
 *
 * Grades a free-form paragraph on four IELTS-style criteria adapted per
 * language, and locates errors as EXACT substrings of the learner's text so
 * the client can splice highlights without trusting the model to reproduce the
 * original verbatim. System prompt is cached (ephemeral) like the others.
 */

import {
  type FreeWritingContent,
  type CefrLevel,
  type Language,
} from "@language-drill/shared";
import { CEFR_LEVEL_DESCRIPTORS } from "./prompts.js";

// Bump in the same commit as any semantic edit below. Drives the Langfuse
// `promptVersion` cohort tag. (CLAUDE.md "Prompt Editing".)
export const FREE_WRITING_EVAL_PROMPT_VERSION = "free-writing-eval@2026-06-13";

const CEFR_BULLETS = (Object.entries(CEFR_LEVEL_DESCRIPTORS) as [CefrLevel, string][])
  .map(([level, d]) => `- **${level}**: ${d}`)
  .join("\n");

export const FREE_WRITING_EVAL_SYSTEM_PROMPT = `You are an expert writing examiner for a language-learning app. You grade a learner's free-writing paragraph against four IELTS-style criteria, adapted to the target language, and you mark concrete errors in place.

## Criteria (score each 0.0–1.0 and give a CEFR estimate)

1. **Task achievement** — did the writer address the prompt, meet the length band, and include every required element?
2. **Coherence & cohesion** — paragraph structure, logical flow, connector usage.
3. **Lexical resource** — vocabulary range, accuracy, appropriateness to register.
4. **Grammatical range & accuracy** — variety of structures used correctly.

## CEFR reference

${CEFR_BULLETS}

## How to locate errors and highlights — IMPORTANT

You do NOT re-type the learner's text. Instead you return:
- \`errors[]\`: each with \`original\` set to the **exact substring** copied verbatim from the learner's text (so it can be found by string match), plus \`correction\`, \`severity\` (high/med/low), \`type\` (a short category label in the target language, e.g. "Modo verbal"), an optional \`where\`, and a one-sentence \`note\`. Keep \`original\` short — the smallest span that captures the error.
- \`goodSpans[]\`: a few **exact substrings** of things done well (strong collocations, well-formed structures).
- \`improved\`: a freshly written, lifted version of the whole paragraph(s) (\`text\`), plus \`upgrades[]\` = exact substrings **within \`improved.text\`** worth highlighting as upgrades.

Every \`original\`, every \`goodSpans\` entry, and every \`upgrades\` entry MUST be an exact substring of the relevant text (the learner's answer for the first two; \`improved.text\` for the third). If you cannot copy it verbatim, omit it.

## Scoring discipline

- \`overallScore\` is your holistic 0.0–1.0 grade; \`overallCefr\` the overall writing level it evidences.
- Reward natural, well-formed writing. Multiple valid responses exist — there is no single correct answer.
- \`headline\` is one vivid sentence; \`summary\` is 2–3 sentences. Both in the app's UI language (English).
- Return exactly the four criteria, in the order: task, coherence, lexis, grammar.`;

export function buildFreeWritingUserPrompt(
  content: FreeWritingContent,
  userAnswer: string,
  language: Language,
  difficulty: CefrLevel,
): string {
  const required = content.requiredElements.length
    ? content.requiredElements
        .map((r) => `- ${r.label}${r.detail ? ` (${r.detail})` : ""}`)
        .join("\n")
    : "- (none)";

  return `## Free Writing submission

**Target language:** ${language}
**Target CEFR level:** ${difficulty}
**Register:** ${content.register}
**Length band:** ${content.minWords}–${content.maxWords} words

**Prompt title:** ${content.title}
**Task:** ${content.task}

**Required elements:**
${required}

**Learner's text:**
"""
${userAnswer}
"""

Evaluate the four criteria, locate errors and highlights as exact substrings, and write an improved version. Submit via the tool.`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- free-writing-prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/free-writing-prompts.ts packages/ai/src/free-writing-prompts.test.ts
git commit -m "feat(ai): free-writing evaluation prompt + version

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: AI — Free Writing evaluator (tool, parser, call)

**Files:**
- Create: `packages/ai/src/free-writing-evaluate.ts`
- Modify: `packages/ai/src/index.ts` (add exports after the `evaluate.js` block, ~line 24)
- Test: `packages/ai/src/free-writing-evaluate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { CefrLevel, Language, ExerciseType, type FreeWritingContent } from '@language-drill/shared';
import {
  FREE_WRITING_EVAL_TOOL,
  FREE_WRITING_EVAL_TOOL_NAME,
  parseFreeWritingEvaluation,
  evaluateFreeWriting,
} from './free-writing-evaluate';

const content: FreeWritingContent = {
  type: ExerciseType.FREE_WRITING,
  instructions: 'Write.',
  title: 'T',
  task: 'Task.',
  domain: 'd',
  register: 'formal',
  minWords: 150,
  maxWords: 200,
  requiredElements: [],
};

const valid = {
  overallScore: 0.8,
  overallCefr: 'B2',
  headline: 'Strong.',
  summary: 'Good work overall.',
  criteria: [
    { id: 'task', label: 'Task achievement', score: 0.85, cefr: 'B2', note: 'n' },
    { id: 'coherence', label: 'Coherence & cohesion', score: 0.9, cefr: 'C1', note: 'n' },
    { id: 'lexis', label: 'Lexical resource', score: 0.75, cefr: 'B2', note: 'n' },
    { id: 'grammar', label: 'Grammatical range & accuracy', score: 0.68, cefr: 'B1', note: 'n' },
  ],
  errors: [
    { n: 1, severity: 'high', type: 'Modo verbal', original: 'tendría', correction: 'tuviera', where: '§3', note: 'n' },
  ],
  goodSpans: ['Sin embargo'],
  improved: { text: 'Mejor texto.', upgrades: ['Mejor'] },
  wordCount: 162,
  improvedWordCount: 168,
};

describe('FREE_WRITING_EVAL_TOOL', () => {
  it('is named submit_free_writing_evaluation with the required fields', () => {
    expect(FREE_WRITING_EVAL_TOOL.name).toBe('submit_free_writing_evaluation');
    expect(FREE_WRITING_EVAL_TOOL_NAME).toBe('submit_free_writing_evaluation');
    const req = FREE_WRITING_EVAL_TOOL.input_schema.required as string[];
    expect(req).toContain('overallScore');
    expect(req).toContain('criteria');
    expect(req).toContain('errors');
    expect(req).toContain('improved');
  });
});

describe('parseFreeWritingEvaluation', () => {
  it('parses a valid payload', () => {
    const r = parseFreeWritingEvaluation(valid);
    expect(r.overallScore).toBe(0.8);
    expect(r.criteria).toHaveLength(4);
    expect(r.errors[0].correction).toBe('tuviera');
  });

  it('clamps out-of-range scores to [0,1]', () => {
    const r = parseFreeWritingEvaluation({ ...valid, overallScore: 1.4 });
    expect(r.overallScore).toBe(1);
  });

  it('drops malformed errors instead of throwing', () => {
    const r = parseFreeWritingEvaluation({
      ...valid,
      errors: [{ n: 1, severity: 'nope', original: 5 }, valid.errors[0]],
    });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].original).toBe('tendría');
  });

  it('throws when criteria count is not four', () => {
    expect(() => parseFreeWritingEvaluation({ ...valid, criteria: valid.criteria.slice(0, 3) })).toThrow();
  });
});

describe('evaluateFreeWriting', () => {
  it('calls Claude with the FW tool and returns the parsed result', async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'submit_free_writing_evaluation', input: valid }],
    });
    const client = { messages: { create } } as unknown as import('@anthropic-ai/sdk').default;
    const r = await evaluateFreeWriting(client, {
      content,
      userAnswer: 'Mi texto.',
      language: Language.ES,
      difficulty: CefrLevel.B2,
    });
    expect(r.overallScore).toBe(0.8);
    expect(create).toHaveBeenCalledOnce();
    const args = create.mock.calls[0][0];
    expect(args.tools[0].name).toBe('submit_free_writing_evaluation');
    expect(args.tool_choice).toEqual({ type: 'tool', name: 'submit_free_writing_evaluation' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- free-writing-evaluate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the evaluator**

`packages/ai/src/free-writing-evaluate.ts`:

```ts
/**
 * packages/ai — Free Writing evaluator. Calls Claude with tool use to produce a
 * rich FreeWritingEvaluation (4 IELTS-style criteria + located errors + an
 * improved version). Mirrors evaluate.ts but with a free-writing-specific
 * schema and a forgiving parser (malformed errors are dropped, not fatal).
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  FreeWritingContent,
  FreeWritingEvaluation,
  FreeWritingCriterion,
  FreeWritingCriterionId,
  FreeWritingError,
  FreeWritingSeverity,
  CefrLevel,
  Language,
} from "@language-drill/shared";
import { setResolvedPromptClient, setResolvedPromptVersion } from "./observability.js";
import {
  FREE_WRITING_EVAL_SYSTEM_PROMPT,
  FREE_WRITING_EVAL_PROMPT_VERSION,
  buildFreeWritingUserPrompt,
} from "./free-writing-prompts.js";
import { getPromptOrFallback, sha8 } from "./prompts-registry.js";

export const FREE_WRITING_EVAL_TOOL_NAME = "submit_free_writing_evaluation";

// Same interactive fail-fast posture as evaluate.ts, but a larger token budget:
// the FW output (4 criteria + errors + a rewritten paragraph) is much bigger
// than a cloze evaluation.
const MODEL = "claude-sonnet-4-6" as const;
const MAX_TOKENS = 4096;
export const FREE_WRITING_EVAL_REQUEST_TIMEOUT_MS = 45_000;
export const FREE_WRITING_EVAL_MAX_RETRIES = 1;

const CRITERION_IDS: readonly FreeWritingCriterionId[] = ["task", "coherence", "lexis", "grammar"];
const SEVERITIES: readonly FreeWritingSeverity[] = ["high", "med", "low"];

export const FREE_WRITING_EVAL_TOOL: Anthropic.Tool = {
  name: FREE_WRITING_EVAL_TOOL_NAME,
  description:
    "Submit the structured free-writing evaluation: four IELTS-style criteria, located errors, highlights, and an improved version.",
  input_schema: {
    type: "object" as const,
    properties: {
      overallScore: { type: "number", description: "Holistic grade 0.0–1.0." },
      overallCefr: { type: "string", description: "Overall writing CEFR level, e.g. B2." },
      headline: { type: "string", description: "One vivid sentence (English)." },
      summary: { type: "string", description: "2–3 sentence summary (English)." },
      criteria: {
        type: "array",
        description: "Exactly four criteria, in order: task, coherence, lexis, grammar.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", enum: ["task", "coherence", "lexis", "grammar"] },
            label: { type: "string" },
            score: { type: "number", description: "0.0–1.0." },
            cefr: { type: "string", description: "Per-criterion CEFR estimate, e.g. B1+." },
            note: { type: "string" },
          },
          required: ["id", "label", "score", "cefr", "note"],
        },
      },
      errors: {
        type: "array",
        description: "Located errors. `original` MUST be an exact substring of the learner's text.",
        items: {
          type: "object",
          properties: {
            n: { type: "number", description: "1-based index." },
            severity: { type: "string", enum: ["high", "med", "low"] },
            type: { type: "string", description: "Short category label in the target language." },
            original: { type: "string", description: "Exact substring of the learner's text." },
            correction: { type: "string" },
            where: { type: "string" },
            note: { type: "string" },
          },
          required: ["n", "severity", "type", "original", "correction", "note"],
        },
      },
      goodSpans: {
        type: "array",
        description: "Exact substrings of the learner's text done well.",
        items: { type: "string" },
      },
      improved: {
        type: "object",
        properties: {
          text: { type: "string", description: "Freshly written improved paragraph(s)." },
          upgrades: {
            type: "array",
            description: "Exact substrings within `text` to highlight as upgrades.",
            items: { type: "string" },
          },
        },
        required: ["text"],
      },
      wordCount: { type: "number" },
      improvedWordCount: { type: "number" },
    },
    required: [
      "overallScore",
      "overallCefr",
      "headline",
      "summary",
      "criteria",
      "errors",
      "goodSpans",
      "improved",
      "wordCount",
      "improvedWordCount",
    ],
  },
};

export type EvaluateFreeWritingInput = {
  content: FreeWritingContent;
  userAnswer: string;
  language: Language;
  difficulty: CefrLevel;
  /** Eval-runner escape hatch — verbatim system prompt, stamped override cohort. */
  systemPromptOverride?: string;
};

function clamp01(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function parseFreeWritingEvaluation(input: unknown): FreeWritingEvaluation {
  if (typeof input !== "object" || input === null) {
    throw new Error("Free writing evaluation must be an object");
  }
  const raw = input as Record<string, unknown>;

  if (!Array.isArray(raw.criteria) || raw.criteria.length !== 4) {
    throw new Error(`Expected exactly 4 criteria, got ${JSON.stringify(raw.criteria)}`);
  }

  const criteria: FreeWritingCriterion[] = (raw.criteria as unknown[]).map((c, i) => {
    const o = (typeof c === "object" && c !== null ? c : {}) as Record<string, unknown>;
    const id = CRITERION_IDS.includes(o.id as FreeWritingCriterionId)
      ? (o.id as FreeWritingCriterionId)
      : CRITERION_IDS[i];
    return {
      id,
      label: str(o.label, id),
      score: clamp01(o.score),
      cefr: str(o.cefr, "—"),
      note: str(o.note),
    };
  });

  const errorsRaw = Array.isArray(raw.errors) ? (raw.errors as unknown[]) : [];
  const errors: FreeWritingError[] = [];
  errorsRaw.forEach((e, i) => {
    if (typeof e !== "object" || e === null) return;
    const o = e as Record<string, unknown>;
    if (!SEVERITIES.includes(o.severity as FreeWritingSeverity)) return;
    if (typeof o.original !== "string" || typeof o.correction !== "string") return;
    errors.push({
      n: typeof o.n === "number" ? o.n : i + 1,
      severity: o.severity as FreeWritingSeverity,
      type: str(o.type, "—"),
      original: o.original,
      correction: o.correction,
      where: typeof o.where === "string" ? o.where : undefined,
      note: str(o.note),
    });
  });

  const goodSpans = Array.isArray(raw.goodSpans)
    ? (raw.goodSpans as unknown[]).filter((s): s is string => typeof s === "string")
    : [];

  const improvedRaw =
    typeof raw.improved === "object" && raw.improved !== null
      ? (raw.improved as Record<string, unknown>)
      : {};
  const improved = {
    text: str(improvedRaw.text),
    upgrades: Array.isArray(improvedRaw.upgrades)
      ? (improvedRaw.upgrades as unknown[]).filter((s): s is string => typeof s === "string")
      : undefined,
  };

  return {
    overallScore: clamp01(raw.overallScore),
    overallCefr: str(raw.overallCefr, "—"),
    headline: str(raw.headline),
    summary: str(raw.summary),
    criteria,
    errors,
    goodSpans,
    improved,
    wordCount: typeof raw.wordCount === "number" ? raw.wordCount : 0,
    improvedWordCount: typeof raw.improvedWordCount === "number" ? raw.improvedWordCount : 0,
  };
}

export async function evaluateFreeWriting(
  client: Anthropic,
  input: EvaluateFreeWritingInput,
): Promise<FreeWritingEvaluation> {
  const { content, userAnswer, language, difficulty, systemPromptOverride } = input;

  const userPrompt = buildFreeWritingUserPrompt(content, userAnswer, language, difficulty);

  let systemPromptText: string;
  if (systemPromptOverride !== undefined) {
    systemPromptText = systemPromptOverride;
    setResolvedPromptVersion(`override:${sha8(systemPromptOverride)}`, false);
    setResolvedPromptClient(null);
  } else {
    const resolved = await getPromptOrFallback(
      "free-writing-eval-system-prompt",
      FREE_WRITING_EVAL_SYSTEM_PROMPT,
      FREE_WRITING_EVAL_PROMPT_VERSION,
    );
    systemPromptText = resolved.text;
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text" as const,
        text: systemPromptText,
        cache_control: { type: "ephemeral" as const },
      },
    ],
    messages: [{ role: "user" as const, content: userPrompt }],
    tools: [FREE_WRITING_EVAL_TOOL],
    tool_choice: { type: "tool" as const, name: FREE_WRITING_EVAL_TOOL_NAME },
    temperature: 0,
  });

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUseBlock) {
    throw new Error(
      `Claude did not return a tool use block. Stop reason: ${response.stop_reason}.`,
    );
  }
  if (toolUseBlock.name !== FREE_WRITING_EVAL_TOOL_NAME) {
    throw new Error(
      `Unexpected tool name: expected "${FREE_WRITING_EVAL_TOOL_NAME}", got "${toolUseBlock.name}"`,
    );
  }

  return parseFreeWritingEvaluation(toolUseBlock.input);
}
```

- [ ] **Step 4: Export from the package barrel**

In `packages/ai/src/index.ts`, after the `} from "./evaluate.js";` / `export type { EvaluateAnswerInput }` block (~line 24), add:

```ts
export {
  evaluateFreeWriting,
  parseFreeWritingEvaluation,
  FREE_WRITING_EVAL_TOOL,
  FREE_WRITING_EVAL_TOOL_NAME,
  FREE_WRITING_EVAL_REQUEST_TIMEOUT_MS,
  FREE_WRITING_EVAL_MAX_RETRIES,
} from "./free-writing-evaluate.js";
export type { EvaluateFreeWritingInput } from "./free-writing-evaluate.js";
export {
  FREE_WRITING_EVAL_SYSTEM_PROMPT,
  FREE_WRITING_EVAL_PROMPT_VERSION,
  buildFreeWritingUserPrompt,
} from "./free-writing-prompts.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- free-writing-evaluate.test.ts`
Expected: PASS (all `describe` blocks green).

- [ ] **Step 6: Build the ai package**

Run: `pnpm --filter @language-drill/ai build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/ai/src/free-writing-evaluate.ts packages/ai/src/free-writing-evaluate.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): free-writing evaluator (tool, parser, call)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Lambda — submit route branches on `free_writing`

**Files:**
- Modify: `infra/lambda/src/routes/exercises.ts` (imports ~7–21; submit handler step 5, lines ~274–327)
- Test: `infra/lambda/src/routes/exercises.test.ts` (append; if the submit suite mocks `@language-drill/ai`, extend that mock)

- [ ] **Step 1: Write the failing test**

Append a test that posts to a `free_writing` exercise and asserts the FW evaluator path. Match the existing test file's harness (mocked `db`, mocked `@language-drill/ai`). Add:

```ts
it('routes free_writing submissions to the free-writing evaluator and stores overallScore', async () => {
  const fwEvaluation = {
    overallScore: 0.8, overallCefr: 'B2', headline: 'h', summary: 's',
    criteria: [
      { id: 'task', label: 'Task achievement', score: 0.85, cefr: 'B2', note: 'n' },
      { id: 'coherence', label: 'Coherence & cohesion', score: 0.9, cefr: 'C1', note: 'n' },
      { id: 'lexis', label: 'Lexical resource', score: 0.75, cefr: 'B2', note: 'n' },
      { id: 'grammar', label: 'Grammatical range & accuracy', score: 0.68, cefr: 'B1', note: 'n' },
    ],
    errors: [], goodSpans: [], improved: { text: 'better' }, wordCount: 10, improvedWordCount: 11,
  };
  // Arrange: the exercise row is type 'free_writing'; evaluateFreeWriting mock resolves fwEvaluation.
  // (Wire these into the file's existing db/ai mocks the same way the cloze submit test does.)
  // Act: POST /exercises/<id>/submit with { answer: 'Mi texto largo.' }
  // Assert:
  //   - response status 200, body.overallScore === 0.8
  //   - evaluateFreeWriting was called once; evaluateAnswer was NOT called
  //   - userExerciseHistory insert received score: 0.8 and responseJson.evaluation === fwEvaluation
  //   - a usageEvents insert with eventType 'ai_evaluation' happened
});
```

> Implementation note for the engineer: copy the structure of the nearest existing submit test in this file (the cloze/translation one), swapping the exercise `type` to `'free_writing'` and the AI mock to `evaluateFreeWriting`. Keep the same assertion style the file already uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- exercises.test.ts`
Expected: FAIL — `free_writing` currently falls through to `evaluateAnswer`, so `evaluateFreeWriting` is never called / response lacks `overallScore`.

- [ ] **Step 3: Extend the AI imports**

In `infra/lambda/src/routes/exercises.ts`, extend the `@language-drill/ai` import block (lines ~14–21):

```ts
import {
  createObservedClaudeClient,
  evaluateAnswer,
  evaluateFreeWriting,
  EVALUATION_SYSTEM_PROMPT_VERSION,
  FREE_WRITING_EVAL_PROMPT_VERSION,
  FREE_WRITING_EVAL_REQUEST_TIMEOUT_MS,
  FREE_WRITING_EVAL_MAX_RETRIES,
  EVAL_REQUEST_TIMEOUT_MS,
  EVAL_MAX_RETRIES,
  withLlmTrace,
} from '@language-drill/ai';
```

Add `isFreeWritingContent` and the FW type to the shared import (lines 5–6):

```ts
import { Language, CefrLevel, ExerciseType, EXERCISE_ANSWER_MAX_CHARS, isFreeWritingContent } from '@language-drill/shared';
import type { ExerciseContent, FreeWritingContent } from '@language-drill/shared';
```

- [ ] **Step 4: Branch the Claude call (step 5 of the handler, lines ~274–327)**

Replace the single `evaluateAnswer` call + history insert with a type branch. The free-writing path uses its own client timeout, trace feature, and persists `overallScore` to `score`:

```ts
  // 5. Call Claude for evaluation
  try {
    const content = exercise.contentJson as ExerciseContent;
    const isFreeWriting = isFreeWritingContent(content);

    const client = createObservedClaudeClient(ANTHROPIC_API_KEY, {
      timeout: isFreeWriting ? FREE_WRITING_EVAL_REQUEST_TIMEOUT_MS : EVAL_REQUEST_TIMEOUT_MS,
      maxRetries: isFreeWriting ? FREE_WRITING_EVAL_MAX_RETRIES : EVAL_MAX_RETRIES,
    });

    const traceMeta = {
      env: (process.env.LANGFUSE_ENV ?? 'dev') as 'prod' | 'dev',
      requestId,
      userId,
      submissionId,
      exerciseId: id,
      language: exercise.language as Language,
      cefrLevel: exercise.difficulty as CefrLevel,
      exerciseType: exercise.type as ExerciseType,
    };

    if (isFreeWriting) {
      const evaluation = await withLlmTrace(
        { ...traceMeta, feature: 'free-writing-eval', promptVersion: FREE_WRITING_EVAL_PROMPT_VERSION },
        () =>
          evaluateFreeWriting(client, {
            content: content as FreeWritingContent,
            userAnswer,
            language: exercise.language as Language,
            difficulty: exercise.difficulty as CefrLevel,
          }),
      );

      await db.insert(userExerciseHistory).values({
        id: submissionId,
        userId,
        exerciseId: id,
        sessionId,
        score: evaluation.overallScore,
        responseJson: { userAnswer, evaluation },
        evaluatedAt: new Date(),
      });
      await db.insert(usageEvents).values({
        userId,
        eventType: 'ai_evaluation',
        metadata: { exerciseId: id, language: exercise.language, difficulty: exercise.difficulty },
      });
      return c.json(evaluation);
    }

    const result = await withLlmTrace(
      { ...traceMeta, feature: 'evaluate', promptVersion: EVALUATION_SYSTEM_PROMPT_VERSION },
      () =>
        evaluateAnswer(client, {
          exercise: content,
          userAnswer,
          language: exercise.language as Language,
          difficulty: exercise.difficulty as CefrLevel,
          grammarGuidance,
        }),
    );

    await db.insert(userExerciseHistory).values({
      id: submissionId,
      userId,
      exerciseId: id,
      sessionId,
      score: result.score,
      responseJson: { userAnswer, evaluation: result },
      evaluatedAt: new Date(),
    });
    await db.insert(usageEvents).values({
      userId,
      eventType: 'ai_evaluation',
      metadata: { exerciseId: id, language: exercise.language, difficulty: exercise.difficulty },
    });
    return c.json(result);
  } catch (err) {
    console.error('[POST /exercises/:id/submit] Claude evaluation failed:', err);
    return c.json({ error: 'Evaluation temporarily unavailable', code: 'AI_UNAVAILABLE' }, 502);
  }
```

> Note: `withLlmTrace`'s `feature` accepts `LlmFeature` (from `@language-drill/ai/observability`). If `'free-writing-eval'` is not yet a member of that union, add it to the `LlmFeature` type and the `TOOL_NAME_TO_FEATURE` map alongside `'evaluate'` in `packages/ai/src/observability.ts` (same one-line pattern as the existing features), rebuild `@language-drill/ai`, then re-run. Add a one-line test in `observability.test.ts` asserting `'free-writing-eval'` is accepted if that file enumerates features.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- exercises.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/routes/exercises.ts infra/lambda/src/routes/exercises.test.ts packages/ai/src/observability.ts packages/ai/src/observability.test.ts
git commit -m "feat(lambda): route free_writing submissions to the rich evaluator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Progress — map `free_writing` to the writing axis

**Files:**
- Modify: `infra/lambda/src/lib/progress-aggregation.ts` (`axisForExerciseType`, ~line 91)
- Test: `infra/lambda/src/lib/progress-aggregation.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
import { axisForExerciseType } from './progress-aggregation';
import { ExerciseType } from '@language-drill/shared';

it('maps free_writing to the writing axis', () => {
  expect(axisForExerciseType(ExerciseType.FREE_WRITING)).toBe('writing');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- progress-aggregation.test.ts`
Expected: FAIL — returns `null` (falls through to default).

- [ ] **Step 3: Add the case** (in the `switch` next to `case ExerciseType.TRANSLATION: return 'writing';`)

```ts
    case ExerciseType.FREE_WRITING:
      return 'writing';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- progress-aggregation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/progress-aggregation.ts infra/lambda/src/lib/progress-aggregation.test.ts
git commit -m "feat(progress): free_writing contributes to the writing radar axis

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Seed — hand-written free-writing prompts

**Files:**
- Modify: `packages/db/scripts/seed-exercises.ts` (append to `SEED_EXERCISES`)
- Test: `packages/db/scripts/seed-exercises.test.ts` if present (append a shape assertion); otherwise add a minimal test file `packages/db/scripts/seed-exercises.fw.test.ts`.

- [ ] **Step 1: Write the failing test**

`packages/db/scripts/seed-exercises.fw.test.ts` (or append to the existing seed test):

```ts
import { describe, it, expect } from 'vitest';
import { SEED_EXERCISES } from './seed-exercises';

describe('free_writing seeds', () => {
  const fw = SEED_EXERCISES.filter((e) => e.type === 'free_writing');

  it('includes at least four free_writing prompts', () => {
    expect(fw.length).toBeGreaterThanOrEqual(4);
  });

  it('each carries the full constraint set', () => {
    for (const e of fw) {
      const c = e.contentJson as Record<string, unknown>;
      expect(c.type).toBe('free_writing');
      expect(typeof c.title).toBe('string');
      expect(typeof c.task).toBe('string');
      expect(['informal', 'neutral', 'formal']).toContain(c.register);
      expect(typeof c.minWords).toBe('number');
      expect(typeof c.maxWords).toBe('number');
      expect(Array.isArray(c.requiredElements)).toBe(true);
    }
  });

  it('includes the Spanish B2 remote-work prompt', () => {
    expect(fw.some((e) => e.language === 'ES' && e.difficulty === 'B2')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- seed-exercises`
Expected: FAIL — no `free_writing` seeds yet.

- [ ] **Step 3: Add the seeds** (append to the `SEED_EXERCISES` array, before its closing `];`)

```ts
  // =========================================================================
  // FREE WRITING
  // =========================================================================
  {
    key: 'es-free-writing-b2-remote-work',
    type: 'free_writing',
    language: 'ES',
    difficulty: 'B2',
    contentJson: {
      type: 'free_writing',
      instructions: 'Escribe un texto argumentativo siguiendo la consigna.',
      title: 'El teletrabajo: ¿avance o aislamiento?',
      task: 'Argumenta a favor o en contra del teletrabajo. Defiende una postura clara y respóndela.',
      domain: 'opinión · argumentación',
      register: 'formal',
      minWords: 150,
      maxWords: 200,
      suggestedMinutes: 20,
      requiredElements: [
        { id: 'cond', label: 'Usa al menos dos oraciones condicionales', detail: 'si + imperfecto de subjuntivo → condicional' },
        { id: 'counter', label: 'Incluye y rebate un contraargumento', detail: 'reconoce la otra postura, luego respóndela' },
        { id: 'connect', label: 'Usa dos conectores de contraste', detail: 'sin embargo · por otro lado · aunque…' },
      ],
      topicHint: 'remote work',
    },
  },
  {
    key: 'en-free-writing-b1-ideal-weekend',
    type: 'free_writing',
    language: 'EN',
    difficulty: 'B1',
    contentJson: {
      type: 'free_writing',
      instructions: 'Write a short descriptive paragraph following the brief.',
      title: 'Your ideal weekend',
      task: 'Describe your ideal weekend. What would you do, where, and with whom?',
      domain: 'description · personal',
      register: 'informal',
      minWords: 80,
      maxWords: 120,
      suggestedMinutes: 15,
      requiredElements: [
        { id: 'cond', label: 'Use at least one conditional sentence', detail: 'If I had a free weekend, I would…' },
        { id: 'time', label: 'Use three different time expressions', detail: 'in the morning · after lunch · later on' },
      ],
      topicHint: 'leisure',
    },
  },
  {
    key: 'de-free-writing-b1-city-vs-country',
    type: 'free_writing',
    language: 'DE',
    difficulty: 'B1',
    contentJson: {
      type: 'free_writing',
      instructions: 'Schreib einen kurzen Meinungstext zum Thema.',
      title: 'Stadt oder Land?',
      task: 'Wo würdest du lieber leben — in der Stadt oder auf dem Land? Begründe deine Meinung.',
      domain: 'Meinung · Vergleich',
      register: 'neutral',
      minWords: 90,
      maxWords: 130,
      suggestedMinutes: 15,
      requiredElements: [
        { id: 'compare', label: 'Vergleiche beide Optionen', detail: 'einerseits … andererseits' },
        { id: 'because', label: 'Benutze zwei Kausalsätze', detail: 'weil / denn' },
      ],
      topicHint: 'living preferences',
    },
  },
  {
    key: 'tr-free-writing-b1-technology',
    type: 'free_writing',
    language: 'TR',
    difficulty: 'B1',
    contentJson: {
      type: 'free_writing',
      instructions: 'Konuyla ilgili kısa bir paragraf yaz.',
      title: 'Teknoloji ve günlük hayat',
      task: 'Teknoloji günlük hayatını nasıl değiştirdi? Bir örnekle açıkla.',
      domain: 'görüş · açıklama',
      register: 'neutral',
      minWords: 80,
      maxWords: 120,
      suggestedMinutes: 15,
      requiredElements: [
        { id: 'example', label: 'En az bir örnek ver', detail: 'örneğin / mesela' },
        { id: 'past', label: 'Geçmiş ve şimdi karşılaştır', detail: 'eskiden … şimdi …' },
      ],
      topicHint: 'technology',
    },
  },
```

> If `SEED_EXERCISES` entries set additional columns (e.g. `grammarPointKey`, review status) for other types, match that shape; free-writing seeds have no `grammarPointKey` (leave it unset/null — the column is nullable).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db test -- seed-exercises`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/scripts/seed-exercises.ts packages/db/scripts/seed-exercises.fw.test.ts
git commit -m "feat(db): seed free_writing prompts (ES/EN/DE/TR)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: api-client — `FreeWritingEvaluation` schema + `useSubmitFreeWriting`

**Files:**
- Modify: `packages/api-client/src/schemas/exercise.ts` (append schema)
- Create: `packages/api-client/src/hooks/useSubmitFreeWriting.ts`
- Modify: `packages/api-client/src/index.ts` (export the hook + types — match how `useExercise`/`useSubmitAnswer` are exported)
- Test: `packages/api-client/src/hooks/useSubmitFreeWriting.test.ts`

- [ ] **Step 1: Add the Zod schema**

Append to `packages/api-client/src/schemas/exercise.ts`:

```ts
// Free Writing evaluation from POST /exercises/:id/submit (free_writing type)
const FreeWritingCriterionSchema = z.object({
  id: z.enum(['task', 'coherence', 'lexis', 'grammar']),
  label: z.string(),
  score: z.number().min(0).max(1),
  cefr: z.string(),
  note: z.string(),
});

const FreeWritingErrorSchema = z.object({
  n: z.number(),
  severity: z.enum(['high', 'med', 'low']),
  type: z.string(),
  original: z.string(),
  correction: z.string(),
  where: z.string().optional(),
  note: z.string(),
});

export const FreeWritingEvaluationSchema = z.object({
  overallScore: z.number().min(0).max(1),
  overallCefr: z.string(),
  headline: z.string(),
  summary: z.string(),
  criteria: z.array(FreeWritingCriterionSchema),
  errors: z.array(FreeWritingErrorSchema),
  goodSpans: z.array(z.string()),
  improved: z.object({ text: z.string(), upgrades: z.array(z.string()).optional() }),
  wordCount: z.number(),
  improvedWordCount: z.number(),
});

export type FreeWritingEvaluationResponse = z.infer<typeof FreeWritingEvaluationSchema>;
```

- [ ] **Step 2: Write the failing test**

`packages/api-client/src/hooks/useSubmitFreeWriting.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FreeWritingEvaluationSchema } from '../schemas/exercise';

const valid = {
  overallScore: 0.8, overallCefr: 'B2', headline: 'h', summary: 's',
  criteria: [
    { id: 'task', label: 'Task achievement', score: 0.85, cefr: 'B2', note: 'n' },
    { id: 'coherence', label: 'Coherence & cohesion', score: 0.9, cefr: 'C1', note: 'n' },
    { id: 'lexis', label: 'Lexical resource', score: 0.75, cefr: 'B2', note: 'n' },
    { id: 'grammar', label: 'Grammatical range & accuracy', score: 0.68, cefr: 'B1', note: 'n' },
  ],
  errors: [{ n: 1, severity: 'high', type: 'Modo verbal', original: 'tendría', correction: 'tuviera', note: 'n' }],
  goodSpans: ['Sin embargo'],
  improved: { text: 'mejor', upgrades: ['mejor'] },
  wordCount: 162, improvedWordCount: 168,
};

describe('FreeWritingEvaluationSchema', () => {
  it('parses a valid evaluation', () => {
    expect(FreeWritingEvaluationSchema.parse(valid).overallScore).toBe(0.8);
  });
  it('rejects an out-of-range score', () => {
    expect(() => FreeWritingEvaluationSchema.parse({ ...valid, overallScore: 2 })).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @language-drill/api-client test -- useSubmitFreeWriting.test.ts`
Expected: FAIL — `FreeWritingEvaluationSchema` not exported yet (until Step 1 lands) → after Step 1, the file compiles and the test passes; this task's TDD anchor is the hook itself, so continue.

- [ ] **Step 4: Create the hook**

`packages/api-client/src/hooks/useSubmitFreeWriting.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FreeWritingEvaluationSchema,
  type FreeWritingEvaluationResponse,
} from '../schemas/exercise';
import type { AuthenticatedFetch } from '../fetchClient';

export type SubmitFreeWritingParams = {
  exerciseId: string;
  answer: string;
};

export type UseSubmitFreeWritingOptions = {
  fetchFn: AuthenticatedFetch;
};

export function useSubmitFreeWriting({ fetchFn }: UseSubmitFreeWritingOptions) {
  const queryClient = useQueryClient();
  return useMutation<FreeWritingEvaluationResponse, Error, SubmitFreeWritingParams>({
    mutationFn: async ({ exerciseId, answer }) => {
      const response = await fetchFn(`/exercises/${exerciseId}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answer }),
      });
      const json: unknown = await response.json();
      return FreeWritingEvaluationSchema.parse(json);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exercise'] });
    },
  });
}
```

- [ ] **Step 5: Export from the barrel**

In `packages/api-client/src/index.ts`, add (next to the `useExercise` exports):

```ts
export { useSubmitFreeWriting } from './hooks/useSubmitFreeWriting';
export type { SubmitFreeWritingParams } from './hooks/useSubmitFreeWriting';
export { FreeWritingEvaluationSchema } from './schemas/exercise';
export type { FreeWritingEvaluationResponse } from './schemas/exercise';
```

> Verify the existing export style in this file (some barrels re-export hooks individually, others via `export *`). Match it.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/api-client test -- useSubmitFreeWriting.test.ts`
Expected: PASS.

- [ ] **Step 7: Build the api-client package**

Run: `pnpm --filter @language-drill/api-client build`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/api-client/src/schemas/exercise.ts packages/api-client/src/hooks/useSubmitFreeWriting.ts packages/api-client/src/hooks/useSubmitFreeWriting.test.ts packages/api-client/src/index.ts
git commit -m "feat(api-client): FreeWritingEvaluation schema + useSubmitFreeWriting hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Web — span-reconstruction util (the critical one)

Turns a `FreeWritingEvaluation` + the learner's original text into paragraph→segment arrays for `MarkedProse`, by locating each error/good span in the original. **A span that isn't found is skipped — the original text is never altered.**

**Files:**
- Create: `apps/web/app/(dashboard)/drill/free-writing/_lib/reconstruct.ts`
- Test: `apps/web/app/(dashboard)/drill/free-writing/_lib/reconstruct.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { reconstructMarked, type MarkedSegment } from './reconstruct';
import type { FreeWritingError } from '@language-drill/shared';

const plain = (segs: MarkedSegment[]) =>
  segs
    .map((s) => ('text' in s ? s.text : 'good' in s ? s.good : s.original))
    .join('');

describe('reconstructMarked', () => {
  const text = 'Si yo tendría la oportunidad, elegiría un modelo híbrido.';

  it('splices a located error and preserves the original text', () => {
    const errors: FreeWritingError[] = [
      { n: 1, severity: 'high', type: 'Modo', original: 'tendría', correction: 'tuviera', note: 'n' },
    ];
    const paras = reconstructMarked(text, errors, []);
    expect(paras).toHaveLength(1);
    expect(plain(paras[0])).toBe(text);
    expect(paras[0].some((s) => 'errorRef' in s && s.errorRef === 1)).toBe(true);
  });

  it('highlights a good span', () => {
    const paras = reconstructMarked(text, [], ['un modelo híbrido']);
    expect(plain(paras[0])).toBe(text);
    expect(paras[0].some((s) => 'good' in s)).toBe(true);
  });

  it('drops a span that is not present without corrupting text', () => {
    const errors: FreeWritingError[] = [
      { n: 1, severity: 'low', type: 'x', original: 'NOT IN TEXT', correction: 'y', note: 'n' },
    ];
    const paras = reconstructMarked(text, errors, []);
    expect(plain(paras[0])).toBe(text);
    expect(paras[0].every((s) => !('errorRef' in s))).toBe(true);
  });

  it('splits on blank lines into multiple paragraphs', () => {
    const multi = 'First para.\n\nSecond para.';
    const paras = reconstructMarked(multi, [], []);
    expect(paras).toHaveLength(2);
    expect(plain(paras[0])).toBe('First para.');
    expect(plain(paras[1])).toBe('Second para.');
  });

  it('handles overlapping spans by taking the first and skipping the overlap', () => {
    const t = 'the quick brown fox';
    const errors: FreeWritingError[] = [
      { n: 1, severity: 'low', type: 'a', original: 'quick brown', correction: 'q', note: 'n' },
      { n: 2, severity: 'low', type: 'b', original: 'brown fox', correction: 'b', note: 'n' },
    ];
    const paras = reconstructMarked(t, errors, []);
    expect(plain(paras[0])).toBe(t);
    // first span wins; the overlapping one is dropped
    const refs = paras[0].filter((s) => 'errorRef' in s);
    expect(refs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- reconstruct.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the util**

`apps/web/app/(dashboard)/drill/free-writing/_lib/reconstruct.ts`:

```ts
import type { FreeWritingError, FreeWritingSeverity } from '@language-drill/shared';

export type MarkedSegment =
  | { text: string }
  | { good: string }
  | { errorRef: number; original: string; correction: string; severity: FreeWritingSeverity };

type Span =
  | { start: number; end: number; kind: 'error'; error: FreeWritingError }
  | { start: number; end: number; kind: 'good'; good: string };

/**
 * Reconstruct annotated paragraphs from the learner's ORIGINAL text plus the
 * located errors / good spans. The output always concatenates back to the
 * original text — spans that can't be found, or that overlap an already-placed
 * span, are simply dropped. Errors take precedence over good spans on overlap.
 */
export function reconstructMarked(
  original: string,
  errors: FreeWritingError[],
  goodSpans: string[],
): MarkedSegment[][] {
  // 1. Collect candidate spans by first-occurrence index.
  const candidates: Span[] = [];
  for (const error of errors) {
    if (!error.original) continue;
    const idx = original.indexOf(error.original);
    if (idx === -1) continue;
    candidates.push({ start: idx, end: idx + error.original.length, kind: 'error', error });
  }
  for (const good of goodSpans) {
    if (!good) continue;
    const idx = original.indexOf(good);
    if (idx === -1) continue;
    candidates.push({ start: idx, end: idx + good.length, kind: 'good', good });
  }

  // 2. Resolve overlaps: errors before good, then earlier start, then longer.
  candidates.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'error' ? -1 : 1;
    if (a.start !== b.start) return a.start - b.start;
    return b.end - a.end;
  });
  const placed: Span[] = [];
  for (const span of candidates) {
    if (placed.some((p) => span.start < p.end && p.start < span.end)) continue;
    placed.push(span);
  }
  placed.sort((a, b) => a.start - b.start);

  // 3. Walk the text, emitting plain text between spans and the spans themselves.
  const flat: MarkedSegment[] = [];
  let cursor = 0;
  const pushText = (s: string) => {
    if (s) flat.push({ text: s });
  };
  for (const span of placed) {
    pushText(original.slice(cursor, span.start));
    if (span.kind === 'error') {
      flat.push({
        errorRef: span.error.n,
        original: span.error.original,
        correction: span.error.correction,
        severity: span.error.severity,
      });
    } else {
      flat.push({ good: span.good });
    }
    cursor = span.end;
  }
  pushText(original.slice(cursor));

  // 4. Split into paragraphs on blank lines, re-splicing segments at boundaries.
  return splitParagraphs(flat);
}

function splitParagraphs(flat: MarkedSegment[]): MarkedSegment[][] {
  const paras: MarkedSegment[][] = [];
  let current: MarkedSegment[] = [];
  for (const seg of flat) {
    if (!('text' in seg)) {
      current.push(seg);
      continue;
    }
    const parts = seg.text.split(/\n\s*\n/);
    parts.forEach((part, i) => {
      if (i > 0) {
        paras.push(current);
        current = [];
      }
      if (part) current.push({ text: part });
    });
  }
  paras.push(current);
  // Drop fully-empty trailing paragraphs but keep at least one.
  const nonEmpty = paras.filter((p) => p.length > 0);
  return nonEmpty.length ? nonEmpty : [[]];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- reconstruct.test.ts`
Expected: PASS (all cases — especially the "drops a span not present" and "preserves original text" invariants).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/free-writing/_lib/reconstruct.ts" "apps/web/app/(dashboard)/drill/free-writing/_lib/reconstruct.test.ts"
git commit -m "feat(web): free-writing annotated-text reconstruction util

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Web — shared presentational components + CSS

Port the prototype's `fw-shared.jsx` helpers to TSX and the prototype's `freewrite.css` (token-remapped) into the route. Reference: `docs/superpowers/plans/2026-06-13-free-writing-prototype/fw-shared.jsx` and `freewrite.css`.

**Files:**
- Create: `apps/web/app/(dashboard)/drill/free-writing/free-writing.css`
- Create: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-atoms.tsx`
- Create: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-prose.tsx`
- Test: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-prose.test.tsx`

- [ ] **Step 1: Port the CSS**

Copy `docs/superpowers/plans/2026-06-13-free-writing-prototype/freewrite.css` into `apps/web/app/(dashboard)/drill/free-writing/free-writing.css`, applying the token remap table from the top of this plan (every `var(--accent)` → `var(--color-accent)`, `var(--r-md)` → `var(--radius-r-md)`, etc.). Keep all `.fw-*` class names. Remove the `.fw-drillgrid` / `.fw-drillcard` blocks (hub is out of scope) **except** keep `.fw-skill` if you reuse it on the entry card in Task 16 — otherwise drop it. Keep everything used by surfaces B–G: `.fw-cefr`, `.fw-req`, `.fw-counter`, `.fw-counter-bar`, `.fw-helpbtn`, `.fw-helppanel`, `.fw-vocab-row`, `.fw-crit`, `.fw-score-num`, `.fw-prose`, `.fw-err`, `.fw-good`, `.fw-add`, `.fw-errrow`, `.fw-sev`, `.fw-etype`, `.fw-compare`.

- [ ] **Step 2: Port the atoms** — `fw-atoms.tsx`

Port from `fw-shared.jsx`: `CEFRBadge`, `SevTag`, `FwIcon`, `CriterionRow`, `ReqRow`, `WordCounter`. Convert to typed TSX. Types come from `@language-drill/shared`. Example signatures (port the bodies verbatim from the prototype, JSX unchanged except `className`):

```tsx
'use client';
import * as React from 'react';
import type { FreeWritingCriterion, FreeWritingRequiredElement } from '@language-drill/shared';

export function CEFRBadge({ level, lg }: { level: string; lg?: boolean }) { /* port */ }
export function SevTag({ sev }: { sev: 'high' | 'med' | 'low' }) { /* port */ }
export function FwIcon({ kind, size }: { kind: string; size?: number }) { /* port verbatim */ }
export function CriterionRow({ c }: { c: FreeWritingCriterion }) { /* port; c.label/score/cefr/note */ }
export function ReqRow({ r, met, compact }: { r: FreeWritingRequiredElement; met?: boolean; compact?: boolean }) { /* port; no live `count` in Phase 1 */ }
export function WordCounter({ count, min, max, showBar }: { count: number; min: number; max: number; showBar?: boolean }) { /* port */ }
```

> Notes: the prototype's `ReqRow` reads `r.met`/`r.count`; in Phase 1 the checklist is static, so `met` is a prop (default `false`) and there is no `count`. The prototype's `WordCounter` hardcodes the unit word "palabras" — parameterize it: add an optional `unit` prop defaulting to `'words'`, and pass the localized word from the caller if desired (English `'words'` is fine for Phase 1).

- [ ] **Step 3: Port the prose renderers** — `fw-prose.tsx`

`MarkedProse` consumes the `MarkedSegment[][]` from `reconstructMarked` (Task 8); `ImprovedProse` renders `improved.text` with `upgrades` highlighted by reusing `reconstructMarked`'s good-span logic against the improved text (treat each upgrade as a good span). Port the JSX/class structure from `fw-shared.jsx`'s `MarkedProse`/`ImprovedProse`:

```tsx
'use client';
import * as React from 'react';
import type { FreeWritingImproved } from '@language-drill/shared';
import { reconstructMarked, type MarkedSegment } from '../_lib/reconstruct';

export function MarkedProse({
  paragraphs,
  activeErr,
  onErr,
  fontSize,
}: {
  paragraphs: MarkedSegment[][];
  activeErr?: number | null;
  onErr?: (n: number) => void;
  fontSize?: number;
}) {
  // Port the prototype's <div className="fw-prose"><p>…segments…</p></div>:
  //   { text } -> <span>{text}</span>
  //   { good } -> <span className="fw-good">{good}</span>
  //   { errorRef } -> <span className={`fw-err ${sevCls}${active ? ' active' : ''}`} onClick=…>
  //                     <span className="old">{original}</span>
  //                     <span className="new">{correction}</span>
  //                     <span className="mk">{errorRef}</span>
  //                   </span>
}

export function ImprovedProse({ improved, fontSize }: { improved: FreeWritingImproved; fontSize?: number }) {
  const paras = reconstructMarked(improved.text, [], improved.upgrades ?? []);
  // Render with `.fw-prose`; good spans here use className="fw-add" (the green upgrade style).
}
```

- [ ] **Step 4: Write the failing test** — `fw-prose.test.tsx`

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkedProse, ImprovedProse } from './fw-prose';
import { reconstructMarked } from '../_lib/reconstruct';

describe('MarkedProse', () => {
  it('renders an error with its correction and number', () => {
    const paras = reconstructMarked('Si yo tendría la oportunidad.', [
      { n: 1, severity: 'high', type: 'Modo', original: 'tendría', correction: 'tuviera', note: 'n' },
    ], []);
    render(<MarkedProse paragraphs={paras} />);
    expect(screen.getByText('tendría')).toBeInTheDocument();
    expect(screen.getByText('tuviera')).toBeInTheDocument();
  });
});

describe('ImprovedProse', () => {
  it('highlights an upgrade substring', () => {
    render(<ImprovedProse improved={{ text: 'un texto mejor', upgrades: ['mejor'] }} />);
    const el = screen.getByText('mejor');
    expect(el).toHaveClass('fw-add');
  });
});
```

> If RTL/`@testing-library/jest-dom` matchers aren't globally set up in `apps/web`, follow the existing web component test (e.g. `cloze-exercise` test) for the import/setup it uses, and mirror that.

- [ ] **Step 5: Run the test to verify it fails, then passes**

Run: `pnpm --filter @language-drill/web test -- fw-prose.test.tsx`
First expected: FAIL (components incomplete). Implement Steps 2–3 fully, then expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/free-writing/free-writing.css" "apps/web/app/(dashboard)/drill/free-writing/_components/fw-atoms.tsx" "apps/web/app/(dashboard)/drill/free-writing/_components/fw-prose.tsx" "apps/web/app/(dashboard)/drill/free-writing/_components/fw-prose.test.tsx"
git commit -m "feat(web): free-writing shared atoms, prose renderers, ported CSS

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Web — Brief surface

Port `fw-brief.jsx` (desktop) + `mwfw-flow1.jsx`'s `MWFwBrief` for the mobile layout. Reads `FreeWritingContent`. Uses the app's existing shell layout conventions from the sibling `drill` components (e.g. `DrillLayout`/`Card` — inspect `apps/web/app/(dashboard)/drill/_components/drill-layout.tsx` and reuse what fits; otherwise plain divs with the ported classes).

**Files:**
- Create: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-brief.tsx`
- Test: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-brief.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FwBrief } from './fw-brief';
import { ExerciseType, type FreeWritingContent } from '@language-drill/shared';

const content: FreeWritingContent = {
  type: ExerciseType.FREE_WRITING, instructions: 'i', title: 'El teletrabajo',
  task: 'Argumenta.', domain: 'opinión', register: 'formal', minWords: 150, maxWords: 200,
  suggestedMinutes: 20,
  requiredElements: [{ id: 'cond', label: 'Usa dos condicionales' }],
};

describe('FwBrief', () => {
  it('shows the prompt, constraints and required elements', () => {
    render(<FwBrief content={content} examMode={false} onToggleExam={() => {}} onBegin={() => {}} />);
    expect(screen.getByText('El teletrabajo')).toBeInTheDocument();
    expect(screen.getByText(/150/)).toBeInTheDocument();
    expect(screen.getByText('Usa dos condicionales')).toBeInTheDocument();
  });
  it('begins on click', () => {
    const onBegin = vi.fn();
    render(<FwBrief content={content} examMode={false} onToggleExam={() => {}} onBegin={onBegin} />);
    fireEvent.click(screen.getByRole('button', { name: /begin/i }));
    expect(onBegin).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- fw-brief.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `FwBrief`**

Props:

```tsx
'use client';
import * as React from 'react';
import type { FreeWritingContent } from '@language-drill/shared';
import { FwIcon } from './fw-atoms';

export interface FwBriefProps {
  content: FreeWritingContent;
  examMode: boolean;
  onToggleExam: () => void;
  onBegin: () => void;
}

export function FwBrief({ content, examMode, onToggleExam, onBegin }: FwBriefProps) {
  // Port the layout from fw-brief.jsx:
  //  - title (content.title) + task (content.task)
  //  - spec card: tema (content.domain), registro (content.register), longitud (min–max words),
  //    elementos obligatorios (content.requiredElements -> label + optional detail)
  //  - exam-simulation toggle wired to examMode / onToggleExam, showing content.suggestedMinutes
  //  - "begin writing →" button -> onBegin()
  //  - right rail "graded on · IELTS-style" + "feeds" chips (static copy, port verbatim)
  // Render the mobile single-column variant under the `mobile:` Tailwind variant
  // (max-width 760px) following mwfw-flow1.jsx's MWFwBrief structure.
}
```

> Use `useIsMobile()` from `apps/web/lib/responsive` (as `drill/page.tsx` does) OR the `mobile:` Tailwind variant for the responsive split — match whichever the surrounding drill components use. The `shuffle prompt` button from the prototype is out of scope (single seeded prompt); omit it or render disabled.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- fw-brief.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/free-writing/_components/fw-brief.tsx" "apps/web/app/(dashboard)/drill/free-writing/_components/fw-brief.test.tsx"
git commit -m "feat(web): free-writing brief surface

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Web — Composer surface (+ exam timer, disabled helpers)

Port `fw-composer.jsx`'s `FwComposer` (drop `FwUnstuck` — Phase 2). Textarea, live word counter, static required-elements checklist, a client-side exam countdown when `examMode` is on, and helper buttons rendered **disabled** with a "soon" affordance.

**Files:**
- Create: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-composer.tsx`
- Test: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-composer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FwComposer } from './fw-composer';
import { ExerciseType, type FreeWritingContent } from '@language-drill/shared';

const content: FreeWritingContent = {
  type: ExerciseType.FREE_WRITING, instructions: 'i', title: 'T', task: 'task',
  domain: 'd', register: 'formal', minWords: 5, maxWords: 10, requiredElements: [],
};

describe('FwComposer', () => {
  it('counts words and enables grading at/above the minimum', () => {
    const onGrade = vi.fn();
    render(<FwComposer content={content} value="" onChange={() => {}} examMode={false} submitting={false} onGrade={onGrade} />);
    const btn = screen.getByRole('button', { name: /grade/i });
    expect(btn).toBeDisabled();
  });

  it('fires onGrade with enough words', () => {
    const onGrade = vi.fn();
    render(<FwComposer content={content} value="one two three four five" onChange={() => {}} examMode={false} submitting={false} onGrade={onGrade} />);
    fireEvent.click(screen.getByRole('button', { name: /grade/i }));
    expect(onGrade).toHaveBeenCalled();
  });

  it('renders helper buttons disabled', () => {
    render(<FwComposer content={content} value="" onChange={() => {}} examMode={false} submitting={false} onGrade={() => {}} />);
    expect(screen.getByRole('button', { name: /brainstorm/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- fw-composer.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `FwComposer`**

```tsx
'use client';
import * as React from 'react';
import type { FreeWritingContent } from '@language-drill/shared';
import { FwIcon, WordCounter, ReqRow } from './fw-atoms';

export interface FwComposerProps {
  content: FreeWritingContent;
  value: string;
  onChange: (next: string) => void;
  examMode: boolean;
  submitting: boolean;
  onGrade: () => void;
}

const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export function FwComposer({ content, value, onChange, examMode, submitting, onGrade }: FwComposerProps) {
  const words = countWords(value);
  const canGrade = words >= content.minWords && !submitting;
  // Exam countdown: when examMode && content.suggestedMinutes, run a client timer
  // with React.useState + useEffect/setInterval seeded from suggestedMinutes*60.
  // Port the editor + right-rail layout from fw-composer.jsx; the textarea is
  // controlled (value/onChange). Helper buttons (brainstorm/vocab boost/start)
  // render with `disabled` and a "soon" chip. The "grade my writing" button is
  // disabled unless canGrade; onClick -> onGrade().
  // Required-elements checklist: content.requiredElements.map(r => <ReqRow r={r} compact />)
  // (static — no live ticking in Phase 1).
}
```

> The countdown is display-only in Phase 1 — when it reaches 0 it simply shows `00:00`; it does NOT auto-submit (that's a Phase 2 exam-mode behavior). Keep helpers disabled but visible so the surface matches the design.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- fw-composer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/free-writing/_components/fw-composer.tsx" "apps/web/app/(dashboard)/drill/free-writing/_components/fw-composer.test.tsx"
git commit -m "feat(web): free-writing composer surface (timer, disabled helpers)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Web — Results surface

Port `fw-results.jsx`'s `FwResults`. Reads a `FreeWritingEvaluationResponse`. Renders headline, overall CEFR + avg, the four `CriterionRow`s, and a static **"what this feeds"** chip summary (NOT the per-grammar-point deltas — Phase 2). Buttons: see corrections, compare, write another.

**Files:**
- Create: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-results.tsx`
- Test: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-results.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FwResults } from './fw-results';
import type { FreeWritingEvaluationResponse } from '@language-drill/api-client';

const evaluation: FreeWritingEvaluationResponse = {
  overallScore: 0.8, overallCefr: 'B2', headline: 'Persuasive.', summary: 'Good.',
  criteria: [
    { id: 'task', label: 'Task achievement', score: 0.85, cefr: 'B2', note: 'n' },
    { id: 'coherence', label: 'Coherence & cohesion', score: 0.9, cefr: 'C1', note: 'n' },
    { id: 'lexis', label: 'Lexical resource', score: 0.75, cefr: 'B2', note: 'n' },
    { id: 'grammar', label: 'Grammatical range & accuracy', score: 0.68, cefr: 'B1', note: 'n' },
  ],
  errors: [], goodSpans: [], improved: { text: 'x' }, wordCount: 162, improvedWordCount: 168,
};

describe('FwResults', () => {
  it('shows the headline, overall CEFR and the four criteria', () => {
    render(<FwResults evaluation={evaluation} onCorrections={() => {}} onCompare={() => {}} onAnother={() => {}} />);
    expect(screen.getByText('Persuasive.')).toBeInTheDocument();
    expect(screen.getByText('Task achievement')).toBeInTheDocument();
    expect(screen.getByText('Grammatical range & accuracy')).toBeInTheDocument();
  });
  it('navigates to corrections', () => {
    const onCorrections = vi.fn();
    render(<FwResults evaluation={evaluation} onCorrections={onCorrections} onCompare={() => {}} onAnother={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /corrections/i }));
    expect(onCorrections).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- fw-results.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `FwResults`**

```tsx
'use client';
import * as React from 'react';
import type { FreeWritingEvaluationResponse } from '@language-drill/api-client';
import { CEFRBadge, CriterionRow } from './fw-atoms';

export interface FwResultsProps {
  evaluation: FreeWritingEvaluationResponse;
  onCorrections: () => void;
  onCompare: () => void;
  onAnother: () => void;
}

export function FwResults({ evaluation, onCorrections, onCompare, onAnother }: FwResultsProps) {
  const avg = evaluation.criteria.reduce((s, c) => s + c.score, 0) / evaluation.criteria.length;
  // Port fw-results.jsx left column (headline, overall CEFR badge + avg, summary,
  // criteria card). REPLACE the prototype's "progress impact" rows + exam-readiness
  // with a static "what this feeds" card: chips ["Writing CEFR","grammar radar",
  // "vocab depth","pragmatics","IELTS / DELE readiness"] and one line of copy.
  // Buttons: "see corrections →" -> onCorrections; "compare improved version" ->
  // onCompare; "write another" -> onAnother.
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- fw-results.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/free-writing/_components/fw-results.tsx" "apps/web/app/(dashboard)/drill/free-writing/_components/fw-results.test.tsx"
git commit -m "feat(web): free-writing results surface

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Web — Corrections surface

Port `fw-corrections.jsx`. Reconstructs the annotated text via `reconstructMarked` + `MarkedProse`, lists errors, click-to-focus an error.

**Files:**
- Create: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-corrections.tsx`
- Test: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-corrections.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FwCorrections } from './fw-corrections';
import type { FreeWritingEvaluationResponse } from '@language-drill/api-client';

const evaluation: FreeWritingEvaluationResponse = {
  overallScore: 0.8, overallCefr: 'B2', headline: 'h', summary: 's',
  criteria: [
    { id: 'task', label: 'Task achievement', score: 0.85, cefr: 'B2', note: 'n' },
    { id: 'coherence', label: 'Coherence & cohesion', score: 0.9, cefr: 'C1', note: 'n' },
    { id: 'lexis', label: 'Lexical resource', score: 0.75, cefr: 'B2', note: 'n' },
    { id: 'grammar', label: 'Grammatical range & accuracy', score: 0.68, cefr: 'B1', note: 'n' },
  ],
  errors: [
    { n: 1, severity: 'high', type: 'Modo verbal', original: 'tendría', correction: 'tuviera', where: '§3', note: 'Use subjunctive.' },
  ],
  goodSpans: ['Sin embargo'],
  improved: { text: 'x' },
  wordCount: 162, improvedWordCount: 168,
};
const original = 'Sin embargo, si yo tendría la oportunidad, elegiría.';

describe('FwCorrections', () => {
  it('renders the error list with type and correction', () => {
    render(<FwCorrections evaluation={evaluation} original={original} onCompare={() => {}} />);
    expect(screen.getByText('Modo verbal')).toBeInTheDocument();
    expect(screen.getAllByText('tuviera').length).toBeGreaterThan(0);
  });
  it('advances to compare', () => {
    const onCompare = vi.fn();
    render(<FwCorrections evaluation={evaluation} original={original} onCompare={onCompare} />);
    fireEvent.click(screen.getByRole('button', { name: /compare/i }));
    expect(onCompare).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- fw-corrections.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `FwCorrections`**

```tsx
'use client';
import * as React from 'react';
import type { FreeWritingEvaluationResponse } from '@language-drill/api-client';
import { SevTag } from './fw-atoms';
import { MarkedProse } from './fw-prose';
import { reconstructMarked } from '../_lib/reconstruct';

export interface FwCorrectionsProps {
  evaluation: FreeWritingEvaluationResponse;
  original: string; // the learner's submitted text
  onCompare: () => void;
}

export function FwCorrections({ evaluation, original, onCompare }: FwCorrectionsProps) {
  const [active, setActive] = React.useState<number | null>(evaluation.errors[0]?.n ?? null);
  const paragraphs = React.useMemo(
    () => reconstructMarked(original, evaluation.errors, evaluation.goodSpans),
    [original, evaluation.errors, evaluation.goodSpans],
  );
  // Port fw-corrections.jsx: heading "<N> things to fix.", severity counts,
  // <MarkedProse paragraphs={paragraphs} activeErr={active} onErr={setActive} />,
  // and the error list (errors.map -> num, type, SevTag, where, old→new, note),
  // clicking a row sets active. "compare improved version →" -> onCompare.
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- fw-corrections.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/free-writing/_components/fw-corrections.tsx" "apps/web/app/(dashboard)/drill/free-writing/_components/fw-corrections.test.tsx"
git commit -m "feat(web): free-writing corrections surface

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Web — Compare surface

Port `fw-compare.jsx`. Your text (annotated, `MarkedProse`) beside the improved version (`ImprovedProse`). Drop the prototype's hardcoded `ChangeCard` "what changed" columns (they were demo-static); instead derive a simple change list from `evaluation.errors` (`original → correction`).

**Files:**
- Create: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-compare.tsx`
- Test: `apps/web/app/(dashboard)/drill/free-writing/_components/fw-compare.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FwCompare } from './fw-compare';
import type { FreeWritingEvaluationResponse } from '@language-drill/api-client';

const evaluation: FreeWritingEvaluationResponse = {
  overallScore: 0.8, overallCefr: 'B2', headline: 'h', summary: 's',
  criteria: [
    { id: 'task', label: 'Task achievement', score: 0.85, cefr: 'B2', note: 'n' },
    { id: 'coherence', label: 'Coherence & cohesion', score: 0.9, cefr: 'C1', note: 'n' },
    { id: 'lexis', label: 'Lexical resource', score: 0.75, cefr: 'B2', note: 'n' },
    { id: 'grammar', label: 'Grammatical range & accuracy', score: 0.68, cefr: 'B1', note: 'n' },
  ],
  errors: [{ n: 1, severity: 'high', type: 'Modo', original: 'tendría', correction: 'tuviera', note: 'n' }],
  goodSpans: [],
  improved: { text: 'Si yo tuviera la oportunidad.', upgrades: ['tuviera'] },
  wordCount: 5, improvedWordCount: 5,
};

describe('FwCompare', () => {
  it('shows both columns and the improved text', () => {
    render(<FwCompare evaluation={evaluation} original="Si yo tendría la oportunidad." />);
    expect(screen.getByText(/your text/i)).toBeInTheDocument();
    expect(screen.getByText(/improved/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- fw-compare.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `FwCompare`**

```tsx
'use client';
import * as React from 'react';
import type { FreeWritingEvaluationResponse } from '@language-drill/api-client';
import { CEFRBadge } from './fw-atoms';
import { MarkedProse, ImprovedProse } from './fw-prose';
import { reconstructMarked } from '../_lib/reconstruct';

export interface FwCompareProps {
  evaluation: FreeWritingEvaluationResponse;
  original: string;
}

export function FwCompare({ evaluation, original }: FwCompareProps) {
  const yours = React.useMemo(
    () => reconstructMarked(original, evaluation.errors, evaluation.goodSpans),
    [original, evaluation.errors, evaluation.goodSpans],
  );
  // Port fw-compare.jsx's two-column `.fw-compare` layout (stacks under `mobile:`):
  //  - "your text" + CEFRBadge(overallCefr) + wordCount  -> <MarkedProse paragraphs={yours} />
  //  - "improved" + CEFRBadge(evaluation.improved CEFR? use overallCefr+1 or just "C1" label is demo-only;
  //    Phase 1: show no second badge OR reuse overallCefr) + improvedWordCount -> <ImprovedProse improved={evaluation.improved} />
  //  - a simple "what changed" list derived from evaluation.errors: `${e.original} → ${e.correction}`
}
```

> The prototype's improved column shows a hardcoded "C1" badge; the real evaluation has no separate improved-CEFR field, so omit that badge (or label it neutrally). Don't invent a CEFR.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- fw-compare.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/free-writing/_components/fw-compare.tsx" "apps/web/app/(dashboard)/drill/free-writing/_components/fw-compare.test.tsx"
git commit -m "feat(web): free-writing compare surface

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Web — Route page + state machine

The page fetches a `free_writing` exercise, drives `brief → composer → grading → results ⟷ corrections ⟷ compare`, and submits via `useSubmitFreeWriting`. Follow the data/auth wiring in `drill/page.tsx` (`useAuth`, `createAuthenticatedFetch`, `useActiveLanguage`).

**Files:**
- Create: `apps/web/app/(dashboard)/drill/free-writing/page.tsx`
- Test: `apps/web/app/(dashboard)/drill/free-writing/page.test.tsx`

- [ ] **Step 1: Write the failing test**

Mock `@language-drill/api-client` (`useExercise` returns the seeded FW exercise; `useSubmitFreeWriting` returns a mutation whose `mutateAsync` resolves a known evaluation) and `@clerk/nextjs` `useAuth`, mirroring `drill/page.test.tsx`'s mocking style. Assert:

```tsx
// 1. Renders the brief (exercise.contentJson.title) on load.
// 2. Clicking "begin" shows the composer.
// 3. Typing >= minWords and clicking "grade" calls the submit mutation and then shows the results headline.
// 4. From results, "see corrections" shows the annotated text; "compare" shows both columns.
```

> Copy the provider/mocks scaffold from `apps/web/app/(dashboard)/drill/page.test.tsx`. Keep assertions behavioral (text/role queries), not implementation-coupled.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- "free-writing/page.test.tsx"`
Expected: FAIL — page not found.

- [ ] **Step 3: Implement the page**

```tsx
'use client';
import * as React from 'react';
import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { CefrLevel, ExerciseType, type FreeWritingContent } from '@language-drill/shared';
import {
  useExercise,
  useSubmitFreeWriting,
  createAuthenticatedFetch,
  type FreeWritingEvaluationResponse,
} from '@language-drill/api-client';
import { useActiveLanguage } from '../../../../components/shell';
import { FwBrief } from './_components/fw-brief';
import { FwComposer } from './_components/fw-composer';
import { FwResults } from './_components/fw-results';
import { FwCorrections } from './_components/fw-corrections';
import { FwCompare } from './_components/fw-compare';
import './free-writing.css';

type Stage = 'brief' | 'composer' | 'results' | 'corrections' | 'compare';

export default function FreeWritingPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const { activeLanguage } = useActiveLanguage();

  const [stage, setStage] = useState<Stage>('brief');
  const [examMode, setExamMode] = useState(false);
  const [text, setText] = useState('');
  const [submittedText, setSubmittedText] = useState('');
  const [evaluation, setEvaluation] = useState<FreeWritingEvaluationResponse | null>(null);

  // Difficulty: derive from the active language profile like drill/page.tsx, or
  // default B1. (Free writing prompts are seeded across levels; pick the user's.)
  const { data: exercise } = useExercise({
    language: activeLanguage,
    difficulty: CefrLevel.B1, // replace with the profile-derived level, mirroring drill/page.tsx
    type: ExerciseType.FREE_WRITING,
    fetchFn,
  });

  const submit = useSubmitFreeWriting({ fetchFn });

  if (!exercise) return null; // or a loading skeleton (reuse drill loading-skeleton if desired)
  const content = exercise.contentJson as FreeWritingContent;

  const onGrade = async () => {
    setSubmittedText(text);
    const result = await submit.mutateAsync({ exerciseId: exercise.id, answer: text });
    setEvaluation(result);
    setStage('results');
  };

  const reset = () => {
    setText('');
    setSubmittedText('');
    setEvaluation(null);
    setStage('brief');
  };

  switch (stage) {
    case 'brief':
      return <FwBrief content={content} examMode={examMode} onToggleExam={() => setExamMode((v) => !v)} onBegin={() => setStage('composer')} />;
    case 'composer':
      return <FwComposer content={content} value={text} onChange={setText} examMode={examMode} submitting={submit.isPending} onGrade={onGrade} />;
    case 'results':
      return evaluation ? <FwResults evaluation={evaluation} onCorrections={() => setStage('corrections')} onCompare={() => setStage('compare')} onAnother={reset} /> : null;
    case 'corrections':
      return evaluation ? <FwCorrections evaluation={evaluation} original={submittedText} onCompare={() => setStage('compare')} /> : null;
    case 'compare':
      return evaluation ? <FwCompare evaluation={evaluation} original={submittedText} /> : null;
  }
}
```

> Match the difficulty-resolution logic from `drill/page.tsx` (read the matching language profile). Handle the no-exercise case with the existing loading skeleton / an empty state, following the sibling page. If the submit mutation errors, surface the existing `SubmissionErrorCard` pattern (optional polish — at minimum, don't crash).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- "free-writing/page.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/free-writing/page.tsx" "apps/web/app/(dashboard)/drill/free-writing/page.test.tsx"
git commit -m "feat(web): free-writing route + stage machine

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Web — featured entry card

A "Free writing — new" card linking to `/drill/free-writing`. Place it at the top of the existing `/drill` page (above the session) and/or on the dashboard. Inspect `apps/web/app/(dashboard)/drill/page.tsx` for a natural insertion point and the dashboard home for card patterns.

**Files:**
- Create: `apps/web/app/(dashboard)/drill/_components/free-writing-entry-card.tsx`
- Modify: `apps/web/app/(dashboard)/drill/page.tsx` (render the card near the top)
- Test: `apps/web/app/(dashboard)/drill/_components/free-writing-entry-card.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FreeWritingEntryCard } from './free-writing-entry-card';

describe('FreeWritingEntryCard', () => {
  it('links to the free-writing route', () => {
    render(<FreeWritingEntryCard />);
    const link = screen.getByRole('link', { name: /free writing/i });
    expect(link).toHaveAttribute('href', '/drill/free-writing');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- free-writing-entry-card.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the card**

```tsx
'use client';
import * as React from 'react';
import Link from 'next/link';
import { FwIcon } from '../free-writing/_components/fw-atoms';

export function FreeWritingEntryCard() {
  return (
    <Link
      href="/drill/free-writing"
      className="card mb-s-6 flex items-center gap-s-4 rounded-r-lg border border-accent bg-card p-s-5 no-underline"
    >
      <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-r-md bg-accent text-white">
        <FwIcon kind="write" size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="t-display-s">free writing</span>
          <span className="chip accent" style={{ fontSize: 10 }}>new</span>
        </span>
        <span className="t-body block text-ink-2">
          Write a paragraph to a constrained prompt, then Claude grades it on IELTS-style criteria and marks every error in place.
        </span>
      </span>
      <span className="t-mono flex-shrink-0 text-accent-2">start →</span>
    </Link>
  );
}
```

> If `.chip` isn't a global class in this app, replace it with the equivalent existing badge utility or a small inline span; verify against globals.css.

- [ ] **Step 4: Render it on the drill page**

In `apps/web/app/(dashboard)/drill/page.tsx`, import and render `<FreeWritingEntryCard />` near the top of the page's returned layout (above `Selectors` / the session). Keep it outside the session reducer flow — it's a static link.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- free-writing-entry-card.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/_components/free-writing-entry-card.tsx" "apps/web/app/(dashboard)/drill/_components/free-writing-entry-card.test.tsx" "apps/web/app/(dashboard)/drill/page.tsx"
git commit -m "feat(web): featured free-writing entry card on the drill page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Docs + full-suite verification

**Files:**
- Modify: `CLAUDE.md` (prompt-version table)

- [ ] **Step 1: Register the new prompt version in CLAUDE.md**

In the "Prompt Editing" table (the one mapping prompt file → version constant), add a row:

```
| `free-writing-prompts.ts` | `FREE_WRITING_EVAL_PROMPT_VERSION` |
```

- [ ] **Step 2: Run the full suite from the repo root**

Run (serial concurrency avoids the known `infra` parallel-load flake):
```bash
pnpm lint && pnpm typecheck && pnpm turbo run test --concurrency=1
```
Expected: all green. If `infra` flakes under parallelism, the `--concurrency=1` run is the source of truth.

- [ ] **Step 3: Fix anything red**

Address failures (most likely: a missing token class, an unbuilt package `dist`, or a `LlmFeature` union gap from Task 4). Re-run until green.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: register FREE_WRITING_EVAL_PROMPT_VERSION; free-writing Phase 1 complete

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Bootstrap the prompt into Langfuse (post-merge, operator step — note only)**

The runtime fetches `free-writing-eval-system-prompt` from Langfuse with the in-repo constant as fallback, so the feature works immediately. To register it in Langfuse (so it's editable without a deploy), run `pnpm bootstrap-prompts` per environment after merge (it's create-only and idempotent). This is an operator action, **not** part of the code change — documented here so it isn't forgotten.

---

## Self-review notes (coverage map)

- Spec §1 types → Task 1. §2 evaluation (prompt/tool/parser/call) → Tasks 2–3. §3 submit-route branch → Task 4. §4 progress axis → Task 5. §5 frontend (route, components, reconstruction, hook, exam timer, disabled helpers, static checklist) → Tasks 7–16. §6 seeds → Task 6. Testing strategy (MarkedProse reconstruction as the critical target) → Task 8 + Task 9. Risks (span reconstruction, structured-output robustness) → Tasks 8, 3.
- Deferred items (helpers, gen pipeline, precise deltas, live ticking, full hub) are intentionally absent — surfaced as disabled UI or static copy where the design shows them.
- Type/name consistency: `FreeWritingEvaluation` (shared) ↔ `FreeWritingEvaluationResponse` (api-client Zod infer) are kept structurally identical; the route returns the shared type, the client parses it into the response type. `reconstructMarked(original, errors, goodSpans)` signature is identical across Tasks 8/9/13/14. `evaluateFreeWriting` / `FREE_WRITING_EVAL_TOOL_NAME` consistent across Tasks 3/4.
```
