# Reading Text Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users generate level-calibrated reading texts from a topic prompt (or a tappable chip) directly in the Reading feature, with cross-user caching so popular prompts are instant and free.

**Architecture:** A new non-streaming `POST /read/generate` endpoint validates the request, checks a shared `generated_reading_texts` cache keyed by `(language, cefr, length, normalizedPrompt)`, and on a miss calls Claude Sonnet, runs a deterministic frequency/CEFR level check (regenerating once if the text runs too hard), stores the result, and meters a new `text_generation` usage bucket. Cache hits never meter. The generated text flows into the existing annotate pipeline exactly like a pasted passage. The frontend adds a `GenerateView` (chips + topic box + length toggle + level/language controls) to the Reading launchpad.

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo), Hono on AWS Lambda, Drizzle + Neon Postgres, Anthropic SDK (`claude-sonnet-4-6`), TanStack Query + Zod (api-client), Next.js App Router (web), Vitest.

---

## Background facts (verified against the codebase)

- **Languages:** `LearningLanguageEnum = z.enum(["ES","DE","TR"])` (`packages/shared/src/review.ts:20`). The full `Language` enum (`packages/shared/src/index.ts:1`) also has `EN`; reading is ES/DE/TR only.
- **CEFR:** `enum CefrLevel { A1..C2 }` (`packages/shared/src/index.ts:8`).
- **Reusable level primitives already shared:** `tokenize` and `READ_CEFR_TOP_RANK` are exported from `@language-drill/shared` (used at `infra/lambda/src/annotate-stream/pipeline.ts:30-33`); `loadFrequency(language): FrequencyLookup` is exported from `@language-drill/ai` (`packages/ai/src/frequency/index.ts`, re-exported at `packages/ai/src/index.ts`). The "shared module" from the spec therefore means a **new composing helper in `packages/ai`** (`reading-level-check.ts`) that both the generator and, optionally later, the annotate pipeline can import — the raw primitives are already shared, so no risky refactor of `pipeline.ts` is required for this feature.
- **Generation Claude-call template:** `generateOneDraft` (`packages/ai/src/generate.ts:595-707`) — `client.messages.create({ model, max_tokens, system:[{type,text,cache_control:{type:'ephemeral'}}], messages, tools, tool_choice:{type:'tool',name}, temperature }, { signal })`, then find the `tool_use` block and parse `.input`.
- **Sonnet model id:** `GENERATION_MODEL = "claude-sonnet-4-6"` (`packages/ai/src/generate.ts:46`).
- **Client constructor:** `createClaudeClient(apiKey: string): Anthropic` (`packages/ai/src/index.ts:194`).
- **Prompt-version convention:** every `*_SYSTEM_PROMPT` ships with a `*_PROMPT_VERSION` constant `"<surface>@YYYY-MM-DD"` re-exported from `packages/ai/src/index.ts` (CLAUDE.md "Prompt Editing").
- **Metering:** `MeteredEventType`, `BASE_DAILY_LIMITS`, `BOOST_MULTIPLIER`, `limitFor(type, plan)` (`infra/lambda/src/usage/limits.ts:1-24`). Enforcement template: count `usageEvents` for `(userId, eventType, createdAt >= now-24h)` and compare to `limitFor(...)` (`infra/lambda/src/annotate-stream/deep-flow.ts:152-180`). Recording a usage event: an `INSERT` into `usageEvents`.
- **Route template:** `read.post('/read/entries', ...)` (`infra/lambda/src/routes/read.ts:88-182`) — `safeParse` the body, `c.get('userId')`, DB work, `c.json(...)`. Router mounted via `app.route('/', read)` (`infra/lambda/src/index.ts:79`); `read.use('/read/*', authMiddleware)`.
- **DB schema:** tables in `packages/db/src/schema/read.ts`, re-exported from `packages/db/src/schema/index.ts:25-50`. Migration scripts in `packages/db/package.json`: `"db:generate": "drizzle-kit generate"`, `"db:migrate": "tsx scripts/migrate.ts"`.
- **api-client wire schemas:** `packages/api-client/src/schemas/read.ts` (imports `LearningLanguageEnum` from `./preferences`); hooks like `useSaveReadEntry` (`packages/api-client/src/hooks/useReadEntryMutations.ts:28-57`) take `{ fetchFn }` and call `fetchFn(path, { method, body })`. Authenticated fetch from `createAuthenticatedFetch(getToken)` (`packages/api-client/src/fetchClient.ts`).
- **Read page state:** `View = 'empty' | 'pasting' | 'annotated' | 'history'` and `readPageReducer` (`apps/web/app/(dashboard)/read/_state/read-page-reducer.ts:23,138-202`); page wires views in `apps/web/app/(dashboard)/read/page.tsx`. `EmptyView` receives `{ onPaste, cefrToken }` (`_components/empty-view.tsx`).

## File map

| File | Action | Responsibility |
|---|---|---|
| `packages/shared/src/read.ts` | modify | Add `ReadingTextLength` enum, `READING_GEN_TOPIC_MAX_CHARS`, `READING_LENGTH_WORD_TARGETS`, `READING_TOO_HARD_THRESHOLD` |
| `packages/shared/src/read.test.ts` | modify | Tests for the new constants |
| `infra/lambda/src/usage/limits.ts` | modify | Add `text_generation` to `MeteredEventType` + `BASE_DAILY_LIMITS` |
| `infra/lambda/src/usage/limits.test.ts` | create/modify | Test the new bucket via `limitFor` |
| `packages/ai/src/reading-generation-prompts.ts` | create | System prompt template + version + prompt builders |
| `packages/ai/src/reading-generation-prompts.test.ts` | create | Prompt builder tests |
| `packages/ai/src/reading-level-check.ts` | create | `scoreTextLevel` deterministic frequency/CEFR check |
| `packages/ai/src/reading-level-check.test.ts` | create | Level-check tests |
| `packages/ai/src/reading-generate.ts` | create | `generateReadingText` (Sonnet call + regen-once) + `SUBMIT_READING_TEXT_TOOL` |
| `packages/ai/src/reading-generate.test.ts` | create | Generator tests with mocked client |
| `packages/ai/src/index.ts` | modify | Re-export the three new AI modules |
| `packages/db/src/schema/read.ts` | modify | Add `generatedReadingTexts` table |
| `packages/db/src/schema/index.ts` | modify | Re-export `generatedReadingTexts` |
| `packages/db/drizzle/*` | create (generated) | Migration for the new table |
| `packages/api-client/src/schemas/read.ts` | modify | `GenerateReadingText{Request,Response}Schema` |
| `packages/api-client/src/schemas/read.test.ts` | modify | Schema round-trip tests |
| `packages/api-client/src/hooks/useGenerateReadingText.ts` | create | TanStack mutation hook |
| `packages/api-client/src/hooks/useGenerateReadingText.test.ts` | create | Hook test |
| `packages/api-client/src/index.ts` | modify | Export the hook + schemas |
| `infra/lambda/src/routes/read.ts` | modify | `POST /read/generate` handler |
| `infra/lambda/src/routes/read.generate.test.ts` | create | Route tests (cache hit/miss, metering) |
| `apps/web/app/(dashboard)/read/_components/generate-view.tsx` | create | The generate UI |
| `apps/web/app/(dashboard)/read/_components/empty-view.tsx` | modify | Add "Generate" entry point |
| `apps/web/app/(dashboard)/read/_state/read-page-reducer.ts` | modify | Add `'generating'` view + actions |
| `apps/web/app/(dashboard)/read/page.tsx` | modify | Wire the hook + view |
| `apps/web/app/(dashboard)/read/_state/read-page-reducer.test.ts` | modify | Reducer tests for new actions |

---

## Task 1: Shared constants for generation length & thresholds

**Files:**
- Modify: `packages/shared/src/read.ts`
- Test: `packages/shared/src/read.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/read.test.ts`:

```typescript
import {
  ReadingTextLength,
  READING_GEN_TOPIC_MAX_CHARS,
  READING_LENGTH_WORD_TARGETS,
  READING_TOO_HARD_THRESHOLD,
} from './index';

describe('reading generation constants', () => {
  it('defines three length tiers', () => {
    expect(Object.values(ReadingTextLength)).toEqual(['short', 'medium', 'long']);
  });

  it('has an ascending word target per length', () => {
    const { short, medium, long } = READING_LENGTH_WORD_TARGETS;
    expect(short.max).toBeLessThanOrEqual(medium.min);
    expect(medium.max).toBeLessThanOrEqual(long.min);
    expect(short.min).toBeGreaterThan(0);
  });

  it('caps the topic length and sets a sane too-hard threshold', () => {
    expect(READING_GEN_TOPIC_MAX_CHARS).toBeGreaterThan(0);
    expect(READING_TOO_HARD_THRESHOLD).toBeGreaterThan(0);
    expect(READING_TOO_HARD_THRESHOLD).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/shared test -- read.test.ts`
Expected: FAIL — `ReadingTextLength`/constants are not exported.

- [ ] **Step 3: Implement the constants**

Append to `packages/shared/src/read.ts` (they are re-exported via `packages/shared/src/index.ts`, which already `export * from './read'`):

```typescript
// ---------------------------------------------------------------------------
// Reading text generation
// ---------------------------------------------------------------------------

/** Length tiers a user can request for a generated reading text. */
export enum ReadingTextLength {
  SHORT = 'short',
  MEDIUM = 'medium',
  LONG = 'long',
}

/** Max characters accepted for a free-form topic prompt. */
export const READING_GEN_TOPIC_MAX_CHARS = 200;

/** Target word-count window per length tier, included verbatim in the prompt. */
export const READING_LENGTH_WORD_TARGETS: Record<
  ReadingTextLength,
  { min: number; max: number }
> = {
  [ReadingTextLength.SHORT]: { min: 60, max: 100 },
  [ReadingTextLength.MEDIUM]: { min: 130, max: 190 },
  [ReadingTextLength.LONG]: { min: 230, max: 320 },
};

/**
 * If more than this fraction of content words sit above the target CEFR band,
 * the text is considered "too hard" and regenerated once. 0.15 = 15%.
 */
export const READING_TOO_HARD_THRESHOLD = 0.15;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/shared test -- read.test.ts`
Expected: PASS. (Build first — downstream packages consume `shared/dist`; see the project memory note on stale `db/dist`.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/read.ts packages/shared/src/read.test.ts
git commit -m "feat(shared): add reading text generation constants"
```

---

## Task 2: New `text_generation` metering bucket

**Files:**
- Modify: `infra/lambda/src/usage/limits.ts`
- Test: `infra/lambda/src/usage/limits.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `infra/lambda/src/usage/limits.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { BASE_DAILY_LIMITS, limitFor } from './limits';

describe('text_generation bucket', () => {
  it('has a free base limit of 20', () => {
    expect(BASE_DAILY_LIMITS.text_generation).toBe(20);
  });

  it('boosts to 10x for boosted plans', () => {
    expect(limitFor('text_generation', 'free')).toBe(20);
    expect(limitFor('text_generation', 'boosted')).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/infra test -- limits.test.ts`
Expected: FAIL — `text_generation` is not a key of `BASE_DAILY_LIMITS` (also a typecheck error).

- [ ] **Step 3: Implement the bucket**

Edit `infra/lambda/src/usage/limits.ts`:

```typescript
export type MeteredEventType =
  | 'ai_evaluation'
  | 'read_annotation'
  | 'read_span_annotation'
  | 'text_generation';

export const BASE_DAILY_LIMITS: Record<MeteredEventType, number> = {
  ai_evaluation: 50,
  read_annotation: 50,
  read_span_annotation: 150,
  text_generation: 20,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/infra test -- limits.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/usage/limits.ts infra/lambda/src/usage/limits.test.ts
git commit -m "feat(api): add text_generation usage bucket (free 20 / boosted 200)"
```

---

## Task 3: Reading-generation prompt + version constant

**Files:**
- Create: `packages/ai/src/reading-generation-prompts.ts`
- Test: `packages/ai/src/reading-generation-prompts.test.ts`
- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/reading-generation-prompts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Language, CefrLevel, ReadingTextLength } from '@language-drill/shared';
import {
  READING_GENERATION_PROMPT_VERSION,
  buildReadingGenerationUserPrompt,
} from './reading-generation-prompts.js';

describe('READING_GENERATION_PROMPT_VERSION', () => {
  it('follows the <surface>@YYYY-MM-DD convention', () => {
    expect(READING_GENERATION_PROMPT_VERSION).toMatch(
      /^reading-generate@\d{4}-\d{2}-\d{2}$/,
    );
  });
});

describe('buildReadingGenerationUserPrompt', () => {
  it('embeds language, level, length window, and topic', () => {
    const prompt = buildReadingGenerationUserPrompt({
      language: Language.TR,
      cefr: CefrLevel.A2,
      length: ReadingTextLength.SHORT,
      topic: 'a cat at the market',
    });
    expect(prompt).toContain('Turkish');
    expect(prompt).toContain('A2');
    expect(prompt).toContain('60');
    expect(prompt).toContain('100');
    expect(prompt).toContain('a cat at the market');
  });

  it('adds a stricter instruction when regenerating', () => {
    const prompt = buildReadingGenerationUserPrompt({
      language: Language.ES,
      cefr: CefrLevel.A1,
      length: ReadingTextLength.SHORT,
      topic: 'breakfast',
      stricter: true,
    });
    expect(prompt.toLowerCase()).toContain('simpler');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- reading-generation-prompts.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the prompts**

Create `packages/ai/src/reading-generation-prompts.ts`:

```typescript
import {
  Language,
  CefrLevel,
  ReadingTextLength,
  READING_LENGTH_WORD_TARGETS,
} from '@language-drill/shared';

/** Bump to today's date when editing the template below (CLAUDE.md convention). */
export const READING_GENERATION_PROMPT_VERSION = 'reading-generate@2026-06-05';

const LANGUAGE_NAME: Record<Language, string> = {
  [Language.EN]: 'English',
  [Language.ES]: 'Spanish',
  [Language.DE]: 'German',
  [Language.TR]: 'Turkish',
};

export const READING_GENERATION_SYSTEM_PROMPT = `You are an expert author of graded reading material for language learners.
You write authentic, engaging short texts that are strictly calibrated to a target CEFR level.

Hard rules:
- Write ENTIRELY in the target language. No translations, no glossary, no English.
- Stay within the requested word-count window.
- Respect the CEFR level: at A1/A2 use high-frequency vocabulary, short sentences,
  present/simple tenses, and concrete everyday topics. Do not show off rare words.
- Make it coherent and natural — a real little text, not a word list.
- Return your answer ONLY by calling the submit_reading_text tool.`;

export type ReadingGenerationPromptInputs = {
  language: Language;
  cefr: CefrLevel;
  length: ReadingTextLength;
  topic: string;
  /** When true, the previous draft ran too hard; ask for an easier rewrite. */
  stricter?: boolean;
};

export function buildReadingGenerationUserPrompt(
  inputs: ReadingGenerationPromptInputs,
): string {
  const { language, cefr, length, topic, stricter } = inputs;
  const window = READING_LENGTH_WORD_TARGETS[length];
  const langName = LANGUAGE_NAME[language];

  const stricterLine = stricter
    ? `\nIMPORTANT: the previous version was too difficult. Rewrite it SIMPLER — ` +
      `use only the most common ${langName} words for ${cefr}, shorter sentences, ` +
      `and replace any rare vocabulary with everyday equivalents.`
    : '';

  return (
    `Write a ${langName} reading text at CEFR ${cefr}.\n` +
    `Topic: ${topic}\n` +
    `Length: between ${window.min} and ${window.max} words.\n` +
    `Give it a short, natural title in ${langName}.` +
    stricterLine
  );
}

/** System prompt resolver mirrors other prompts; Langfuse wiring is optional follow-up. */
export function buildReadingGenerationSystemPrompt(): string {
  return READING_GENERATION_SYSTEM_PROMPT;
}
```

> Note: full Langfuse registration (via `bootstrap-prompts`) is handled in Task 12; the in-repo constant is the runtime fallback, which is sufficient for the feature to work.

- [ ] **Step 4: Add exports to `packages/ai/src/index.ts`**

Add near the other prompt re-exports:

```typescript
export {
  READING_GENERATION_PROMPT_VERSION,
  READING_GENERATION_SYSTEM_PROMPT,
  buildReadingGenerationSystemPrompt,
  buildReadingGenerationUserPrompt,
  type ReadingGenerationPromptInputs,
} from './reading-generation-prompts.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- reading-generation-prompts.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/reading-generation-prompts.ts packages/ai/src/reading-generation-prompts.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): add reading text generation prompt + version"
```

---

## Task 4: Deterministic level-check helper

**Files:**
- Create: `packages/ai/src/reading-level-check.ts`
- Test: `packages/ai/src/reading-level-check.test.ts`
- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/reading-level-check.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Language, CefrLevel, READING_TOO_HARD_THRESHOLD } from '@language-drill/shared';
import { scoreTextLevel } from './reading-level-check.js';

describe('scoreTextLevel', () => {
  it('returns a fraction in [0,1] and a tooHard flag', () => {
    const result = scoreTextLevel({
      language: Language.ES,
      cefr: CefrLevel.A1,
      text: 'El gato come pan. La casa es grande.',
    });
    expect(result.aboveLevelFraction).toBeGreaterThanOrEqual(0);
    expect(result.aboveLevelFraction).toBeLessThanOrEqual(1);
    expect(typeof result.tooHard).toBe('boolean');
  });

  it('flags a text stuffed with rare words as too hard at A1', () => {
    const result = scoreTextLevel({
      language: Language.ES,
      cefr: CefrLevel.A1,
      text: 'La idiosincrasia epistemológica subvierte la hermenéutica contemporánea.',
    });
    expect(result.aboveLevelFraction).toBeGreaterThan(READING_TOO_HARD_THRESHOLD);
    expect(result.tooHard).toBe(true);
  });

  it('treats an empty text as not too hard (no content words)', () => {
    const result = scoreTextLevel({
      language: Language.ES,
      cefr: CefrLevel.A1,
      text: '   ',
    });
    expect(result.aboveLevelFraction).toBe(0);
    expect(result.tooHard).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- reading-level-check.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper**

Create `packages/ai/src/reading-level-check.ts`. This composes the already-shared primitives (`tokenize`, `READ_CEFR_TOP_RANK` from shared; `loadFrequency` from this package) using the same rank-gate rule as `buildCandidateList` (`infra/lambda/src/annotate-stream/pipeline.ts:202-215`): a content word counts as "above level" if it is a stopword-excluded word whose frequency entry is missing (unknown) or ranks beyond the CEFR ceiling.

```typescript
import {
  Language,
  CefrLevel,
  READ_CEFR_TOP_RANK,
  READING_TOO_HARD_THRESHOLD,
  tokenize,
} from '@language-drill/shared';
import type { LearningLanguage } from '@language-drill/shared';
import { loadFrequency } from './frequency/index.js';

export type ScoreTextLevelInput = {
  language: Language;
  cefr: CefrLevel;
  text: string;
};

export type TextLevelScore = {
  /** Fraction of content words above the target CEFR band, in [0,1]. */
  aboveLevelFraction: number;
  /** True when aboveLevelFraction exceeds READING_TOO_HARD_THRESHOLD. */
  tooHard: boolean;
  /** Count of content (non-stopword) word tokens considered. */
  contentWordCount: number;
};

/**
 * Deterministic, zero-cost lexical difficulty check. Mirrors the rank-gate in
 * the annotate pipeline: stopwords are ignored; a content word is "above level"
 * if it is unknown to the frequency corpus or ranks beyond the CEFR ceiling.
 */
export function scoreTextLevel(input: ScoreTextLevelInput): TextLevelScore {
  const { language, cefr, text } = input;
  const topRank = READ_CEFR_TOP_RANK[cefr];
  const freq = loadFrequency(language as LearningLanguage);

  let contentWordCount = 0;
  let aboveLevel = 0;

  for (const token of tokenize(text)) {
    if (token.kind !== 'word') continue;
    const key = token.key;
    if (key === '') continue;
    if (freq.isStopword(key)) continue;

    contentWordCount += 1;
    const entry = freq.lookup(key);
    if (entry === null || entry.rank > topRank) {
      aboveLevel += 1;
    }
  }

  const aboveLevelFraction =
    contentWordCount === 0 ? 0 : aboveLevel / contentWordCount;

  return {
    aboveLevelFraction,
    tooHard: aboveLevelFraction > READING_TOO_HARD_THRESHOLD,
    contentWordCount,
  };
}
```

- [ ] **Step 4: Add export to `packages/ai/src/index.ts`**

```typescript
export {
  scoreTextLevel,
  type ScoreTextLevelInput,
  type TextLevelScore,
} from './reading-level-check.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- reading-level-check.test.ts`
Expected: PASS. (If the ES corpus lacks the specific rare words, the unknown-word branch still counts them as above-level, so the "too hard" assertion holds.)

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/reading-level-check.ts packages/ai/src/reading-level-check.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): add deterministic reading level-check helper"
```

---

## Task 5: The generator (`generateReadingText`)

**Files:**
- Create: `packages/ai/src/reading-generate.ts`
- Test: `packages/ai/src/reading-generate.test.ts`
- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/reading-generate.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { Language, CefrLevel, ReadingTextLength } from '@language-drill/shared';
import {
  generateReadingText,
  SUBMIT_READING_TEXT_TOOL,
  READING_GENERATION_MODEL,
} from './reading-generate.js';

function mockClient(textsInOrder: string[]) {
  const create = vi.fn();
  for (const text of textsInOrder) {
    create.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          name: SUBMIT_READING_TEXT_TOOL.name,
          input: { title: 'Title', text },
        },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
    });
  }
  return { messages: { create } } as any;
}

describe('READING_GENERATION_MODEL', () => {
  it('is pinned to Sonnet', () => {
    expect(READING_GENERATION_MODEL).toBe('claude-sonnet-4-6');
  });
});

describe('generateReadingText', () => {
  it('returns the generated text + title + difficulty score on first pass', async () => {
    const client = mockClient(['El gato come pan. La casa es grande y bonita.']);
    const result = await generateReadingText(client, {
      language: Language.ES,
      cefr: CefrLevel.A1,
      length: ReadingTextLength.SHORT,
      topic: 'a cat',
    });
    expect(result.text).toContain('gato');
    expect(result.title).toBe('Title');
    expect(result.difficultyScore).toBeGreaterThanOrEqual(0);
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  });

  it('regenerates once when the first draft is too hard', async () => {
    const hard = 'Idiosincrasia epistemológica hermenéutica contemporánea subvierte paradigma.';
    const easy = 'El gato come pan. La casa es grande.';
    const client = mockClient([hard, easy]);
    const result = await generateReadingText(client, {
      language: Language.ES,
      cefr: CefrLevel.A1,
      length: ReadingTextLength.SHORT,
      topic: 'a cat',
    });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(result.text).toBe(easy);
    expect(result.regenerated).toBe(true);
  });

  it('keeps the second draft even if still hard, flagging runsHard', async () => {
    const hard1 = 'Idiosincrasia epistemológica hermenéutica contemporánea subvierte.';
    const hard2 = 'Paradigma ontológico fenomenológico dialéctico trascendental.';
    const client = mockClient([hard1, hard2]);
    const result = await generateReadingText(client, {
      language: Language.ES,
      cefr: CefrLevel.A1,
      length: ReadingTextLength.SHORT,
      topic: 'a cat',
    });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    expect(result.text).toBe(hard2);
    expect(result.runsHard).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/ai test -- reading-generate.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the generator**

Create `packages/ai/src/reading-generate.ts`, following the `generateOneDraft` call shape (`packages/ai/src/generate.ts:634-684`):

```typescript
import type Anthropic from '@anthropic-ai/sdk';
import {
  Language,
  CefrLevel,
  ReadingTextLength,
  READING_GEN_TOPIC_MAX_CHARS,
} from '@language-drill/shared';
import {
  buildReadingGenerationSystemPrompt,
  buildReadingGenerationUserPrompt,
} from './reading-generation-prompts.js';
import { scoreTextLevel } from './reading-level-check.js';

export const READING_GENERATION_MODEL = 'claude-sonnet-4-6' as const;
export const READING_GENERATION_MAX_TOKENS = 1024;
export const READING_GENERATION_TEMPERATURE = 0.7;

export const SUBMIT_READING_TEXT_TOOL: Anthropic.Tool = {
  name: 'submit_reading_text',
  description: 'Submit the generated reading text and its title.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A short, natural title in the target language.' },
      text: { type: 'string', description: 'The reading text, entirely in the target language.' },
    },
    required: ['title', 'text'],
  },
};

export type GenerateReadingTextInput = {
  language: Language;
  cefr: CefrLevel;
  length: ReadingTextLength;
  topic: string;
};

export type GenerateReadingTextResult = {
  title: string;
  text: string;
  /** aboveLevelFraction of the returned text, in [0,1]. */
  difficultyScore: number;
  /** True when a second (stricter) pass was made. */
  regenerated: boolean;
  /** True when the final returned text still exceeds the too-hard threshold. */
  runsHard: boolean;
};

type Draft = { title: string; text: string };

async function callOnce(
  client: Anthropic,
  input: GenerateReadingTextInput,
  stricter: boolean,
  signal?: AbortSignal,
): Promise<Draft> {
  const response = await client.messages.create(
    {
      model: READING_GENERATION_MODEL,
      max_tokens: READING_GENERATION_MAX_TOKENS,
      system: [
        {
          type: 'text' as const,
          text: buildReadingGenerationSystemPrompt(),
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [
        {
          role: 'user' as const,
          content: buildReadingGenerationUserPrompt({ ...input, stricter }),
        },
      ],
      tools: [SUBMIT_READING_TEXT_TOOL],
      tool_choice: { type: 'tool' as const, name: SUBMIT_READING_TEXT_TOOL.name },
      temperature: READING_GENERATION_TEMPERATURE,
    },
    { signal },
  );

  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === 'tool_use' && b.name === SUBMIT_READING_TEXT_TOOL.name,
  );
  if (!block) {
    throw new Error(
      `reading generation returned no tool_use block (stop_reason=${response.stop_reason})`,
    );
  }
  const parsed = block.input as { title?: unknown; text?: unknown };
  if (typeof parsed.text !== 'string' || parsed.text.trim() === '') {
    throw new Error('reading generation returned an empty text');
  }
  return {
    title: typeof parsed.title === 'string' ? parsed.title : '',
    text: parsed.text,
  };
}

/**
 * Generate a level-calibrated reading text. Runs the deterministic level check
 * and, if the first draft is too hard, regenerates once with a stricter prompt.
 * Always returns a text — `runsHard` signals the caller to surface a soft note.
 */
export async function generateReadingText(
  client: Anthropic,
  input: GenerateReadingTextInput,
  signal?: AbortSignal,
): Promise<GenerateReadingTextResult> {
  if (input.topic.length > READING_GEN_TOPIC_MAX_CHARS) {
    throw new Error('topic exceeds READING_GEN_TOPIC_MAX_CHARS');
  }

  const first = await callOnce(client, input, false, signal);
  const firstScore = scoreTextLevel({
    language: input.language,
    cefr: input.cefr,
    text: first.text,
  });

  if (!firstScore.tooHard) {
    return {
      title: first.title,
      text: first.text,
      difficultyScore: firstScore.aboveLevelFraction,
      regenerated: false,
      runsHard: false,
    };
  }

  const second = await callOnce(client, input, true, signal);
  const secondScore = scoreTextLevel({
    language: input.language,
    cefr: input.cefr,
    text: second.text,
  });

  return {
    title: second.title,
    text: second.text,
    difficultyScore: secondScore.aboveLevelFraction,
    regenerated: true,
    runsHard: secondScore.tooHard,
  };
}
```

- [ ] **Step 4: Add exports to `packages/ai/src/index.ts`**

```typescript
export {
  READING_GENERATION_MODEL,
  READING_GENERATION_MAX_TOKENS,
  READING_GENERATION_TEMPERATURE,
  SUBMIT_READING_TEXT_TOOL,
  generateReadingText,
  type GenerateReadingTextInput,
  type GenerateReadingTextResult,
} from './reading-generate.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/ai test -- reading-generate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/reading-generate.ts packages/ai/src/reading-generate.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): add Sonnet reading generator with regenerate-once"
```

---

## Task 6: `generated_reading_texts` cache table + migration

**Files:**
- Modify: `packages/db/src/schema/read.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create (generated): migration under `packages/db/drizzle/`

- [ ] **Step 1: Add the table to `packages/db/src/schema/read.ts`**

Add (the imports `pgTable, uuid, text, integer, real, timestamp, index, unique` already exist in this file; add any missing one to the existing `drizzle-orm/pg-core` import):

```typescript
/**
 * Shared, cross-user cache of generated reading texts. Keyed by a hash of
 * (language, cefr, length, normalizedPrompt). A cache hit serves an existing
 * text for free; only a miss triggers an LLM call and meters the user.
 */
export const generatedReadingTexts = pgTable(
  'generated_reading_texts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cacheKey: text('cache_key').notNull(),
    language: text('language').$type<LearningLanguage>().notNull(),
    cefr: text('cefr').$type<CefrLevel>().notNull(),
    length: text('length').notNull(),
    prompt: text('prompt').notNull(),
    title: text('title').notNull().default(''),
    text: text('text').notNull(),
    difficultyScore: real('difficulty_score').notNull(),
    hitCount: integer('hit_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    cacheKeyUq: unique('generated_reading_texts_cache_key_uq').on(t.cacheKey),
  }),
);
```

> `LearningLanguage` and `CefrLevel` types are already imported at the top of `read.ts` (used by `readEntries`/`userVocabulary`). If not, add `import type { LearningLanguage, CefrLevel } from '@language-drill/shared';`.

- [ ] **Step 2: Re-export from `packages/db/src/schema/index.ts`**

Extend the existing read export block:

```typescript
export {
  readEntries,
  userVocabulary,
  vocabularyReviewState,
  vocabularyReviewSessions,
  vocabularyReviewLog,
  generatedReadingTexts,
} from './read';
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @language-drill/db db:generate`
Expected: a new SQL file appears under `packages/db/drizzle/` creating `generated_reading_texts` with the unique index. Open it and confirm it only adds the new table (no destructive changes).

- [ ] **Step 4: Build + typecheck the db package**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db typecheck`
Expected: PASS. (Build so consumers don't resolve a stale `db/dist` — see project memory.)

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/read.ts packages/db/src/schema/index.ts packages/db/drizzle
git commit -m "feat(db): add generated_reading_texts cache table"
```

---

## Task 7: api-client wire schemas

**Files:**
- Modify: `packages/api-client/src/schemas/read.ts`
- Modify: `packages/api-client/src/schemas/read.test.ts`
- Modify: `packages/api-client/src/index.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/api-client/src/schemas/read.test.ts`:

```typescript
import {
  GenerateReadingTextRequestSchema,
  GenerateReadingTextResponseSchema,
} from './read';

describe('GenerateReadingText schemas', () => {
  it('accepts a valid request', () => {
    const parsed = GenerateReadingTextRequestSchema.parse({
      language: 'TR',
      cefr: 'A2',
      length: 'short',
      topic: 'a cat at the market',
    });
    expect(parsed.length).toBe('short');
  });

  it('rejects an over-long topic', () => {
    const result = GenerateReadingTextRequestSchema.safeParse({
      language: 'TR',
      cefr: 'A2',
      length: 'short',
      topic: 'x'.repeat(5000),
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid response', () => {
    const parsed = GenerateReadingTextResponseSchema.parse({
      title: 'Kedi',
      text: 'Kedi pazarda.',
      cefr: 'A2',
      difficultyScore: 0.1,
      fromCache: false,
      runsHard: false,
    });
    expect(parsed.fromCache).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/api-client test -- read.test.ts`
Expected: FAIL — schemas not exported.

- [ ] **Step 3: Implement the schemas**

Append to `packages/api-client/src/schemas/read.ts` (the file already imports `CefrLevel`, `READING_GEN_TOPIC_MAX_CHARS` is new — add it to the `@language-drill/shared` import; `LearningLanguageEnum` is imported from `./preferences`):

```typescript
import {
  // ...existing imports...
  ReadingTextLength,
  READING_GEN_TOPIC_MAX_CHARS,
} from '@language-drill/shared';

// ---------------------------------------------------------------------------
// POST /read/generate
// ---------------------------------------------------------------------------

export const GenerateReadingTextRequestSchema = z.object({
  language: LearningLanguageEnum,
  cefr: z.nativeEnum(CefrLevel),
  length: z.nativeEnum(ReadingTextLength),
  topic: z.string().min(1).max(READING_GEN_TOPIC_MAX_CHARS),
});

export type GenerateReadingTextRequest = z.infer<
  typeof GenerateReadingTextRequestSchema
>;

export const GenerateReadingTextResponseSchema = z.object({
  title: z.string(),
  text: z.string().min(1),
  cefr: z.nativeEnum(CefrLevel),
  difficultyScore: z.number().min(0).max(1),
  fromCache: z.boolean(),
  runsHard: z.boolean(),
});

export type GenerateReadingTextResponse = z.infer<
  typeof GenerateReadingTextResponseSchema
>;
```

- [ ] **Step 4: Export from `packages/api-client/src/index.ts`**

Add to the read-schemas export block:

```typescript
export {
  GenerateReadingTextRequestSchema,
  type GenerateReadingTextRequest,
  GenerateReadingTextResponseSchema,
  type GenerateReadingTextResponse,
} from './schemas/read';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/api-client test -- read.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api-client/src/schemas/read.ts packages/api-client/src/schemas/read.test.ts packages/api-client/src/index.ts
git commit -m "feat(api-client): add /read/generate wire schemas"
```

---

## Task 8: `POST /read/generate` route

**Files:**
- Modify: `infra/lambda/src/routes/read.ts`
- Test: `infra/lambda/src/routes/read.generate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/routes/read.generate.test.ts`. Mirror the mocking approach used by the existing read route tests (mock `../db` and `@language-drill/ai`'s `generateReadingText` + `createClaudeClient`). Minimum coverage:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the AI generator so no real Claude call happens.
vi.mock('@language-drill/ai', async (importActual) => {
  const actual = await importActual<typeof import('@language-drill/ai')>();
  return {
    ...actual,
    createClaudeClient: vi.fn(() => ({}) as any),
    generateReadingText: vi.fn(async () => ({
      title: 'Kedi',
      text: 'Kedi pazarda yürüyor.',
      difficultyScore: 0.1,
      regenerated: false,
      runsHard: false,
    })),
  };
});

// Build a chainable db mock: cache lookup, usage count, insert.
// (Follow the existing read.test.ts db-mock pattern in this folder.)

describe('POST /read/generate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a freshly generated text and meters on cache miss', async () => {
    // Arrange: cache lookup → [], usage count → 0, insert → ok.
    // Act: call the handler with { language:'TR', cefr:'A2', length:'short', topic:'a cat' }.
    // Assert: 200, fromCache === false, generateReadingText called once,
    //         a usageEvents insert with eventType 'text_generation' happened.
  });

  it('serves a cached text without metering on cache hit', async () => {
    // Arrange: cache lookup → [{ title, text, cefr, difficultyScore }].
    // Assert: 200, fromCache === true, generateReadingText NOT called,
    //         no usageEvents insert.
  });

  it('returns 429 when the daily text_generation limit is reached', async () => {
    // Arrange: cache lookup → [], usage count → limitFor('text_generation','free').
    // Assert: 429 with code RATE_LIMIT_EXCEEDED, generateReadingText NOT called.
  });

  it('returns 400 on an over-long topic', async () => {
    // Assert: 400 VALIDATION_ERROR, no db / AI calls.
  });
});
```

> Implement the three db-mock arrangements by following the exact `vi.mock('../db', ...)` chain shape already used in the sibling `read` route tests in this directory. Each `it` should assert the status and the key side effects listed in its comment.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/infra test -- read.generate.test.ts`
Expected: FAIL — route not implemented.

- [ ] **Step 3: Implement the handler**

In `infra/lambda/src/routes/read.ts`, add the cache-key helper and handler. Add imports at the top: `import { createHash } from 'node:crypto';`, `generatedReadingTexts`, `usageEvents` to the `@language-drill/db` import, `createClaudeClient` + `generateReadingText` from `@language-drill/ai`, `ReadingTextLength`, `CefrLevel` from `@language-drill/shared`, `limitFor` from `../usage/limits`, and `count, gte` are already imported from `drizzle-orm`.

```typescript
const GenerateBodySchema = z.object({
  language: LearningLanguageEnum,
  cefr: z.nativeEnum(CefrLevel),
  length: z.nativeEnum(ReadingTextLength),
  topic: z.string().min(1).max(READING_GEN_TOPIC_MAX_CHARS),
});

function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase().replace(/\s+/g, ' ');
}

function readingCacheKey(
  language: string,
  cefr: string,
  length: string,
  topic: string,
): string {
  const basis = `${language}|${cefr}|${length}|${normalizeTopic(topic)}`;
  return createHash('sha256').update(basis).digest('hex');
}

read.post('/read/generate', async (c) => {
  const bodyResult = GenerateBodySchema.safeParse(
    await c.req.json().catch(() => ({})),
  );
  if (!bodyResult.success) {
    return c.json(
      {
        error: 'Invalid request body',
        code: 'VALIDATION_ERROR',
        details: bodyResult.error.flatten(),
      },
      400,
    );
  }
  const { language, cefr, length, topic } = bodyResult.data;
  const userId = c.get('userId');
  const plan = c.get('plan') ?? 'free';

  const cacheKey = readingCacheKey(language, cefr, length, topic);

  // --- Cache lookup: a hit is free and never meters ---
  const cached = await db
    .select()
    .from(generatedReadingTexts)
    .where(eq(generatedReadingTexts.cacheKey, cacheKey))
    .limit(1);

  if (cached.length > 0) {
    const row = cached[0];
    await db
      .update(generatedReadingTexts)
      .set({ hitCount: sql`${generatedReadingTexts.hitCount} + 1` })
      .where(eq(generatedReadingTexts.id, row.id));
    return c.json(
      {
        title: row.title,
        text: row.text,
        cefr: row.cefr,
        difficultyScore: row.difficultyScore,
        fromCache: true,
        runsHard: row.difficultyScore > READING_TOO_HARD_THRESHOLD,
      },
      200,
    );
  }

  // --- Cache miss: enforce the daily limit before spending an LLM call ---
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const usageRows = await db
    .select({ count: count() })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        eq(usageEvents.eventType, 'text_generation'),
        gte(usageEvents.createdAt, oneDayAgo),
      ),
    );
  if (Number(usageRows[0]?.count ?? 0) >= limitFor('text_generation', plan)) {
    return c.json(
      { error: 'Daily generation limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
      429,
    );
  }

  // --- Generate ---
  const apiKey = c.env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'AI unavailable', code: 'AI_UNAVAILABLE' }, 502);
  }

  let generated;
  try {
    generated = await generateReadingText(createClaudeClient(apiKey), {
      language: language as Language,
      cefr,
      length,
      topic,
    });
  } catch (err) {
    console.error('[read/generate] generation failed', err);
    return c.json({ error: 'Generation failed', code: 'AI_UNAVAILABLE' }, 502);
  }

  // --- Persist to cache + meter (best-effort cache write; metering is required) ---
  await db
    .insert(generatedReadingTexts)
    .values({
      cacheKey,
      language: language as LearningLanguage,
      cefr,
      length,
      prompt: topic,
      title: generated.title,
      text: generated.text,
      difficultyScore: generated.difficultyScore,
    })
    .onConflictDoNothing({ target: generatedReadingTexts.cacheKey });

  await db.insert(usageEvents).values({ userId, eventType: 'text_generation' });

  return c.json(
    {
      title: generated.title,
      text: generated.text,
      cefr,
      difficultyScore: generated.difficultyScore,
      fromCache: false,
      runsHard: generated.runsHard,
    },
    200,
  );
});
```

> Confirm the exact `usageEvents` insert shape and `c.get('plan')` availability against an existing metering write in the codebase (the deep-flow Lambda records `read_span_annotation`); match its column names. If `plan` is not on the Hono context, derive it the same way other routes do (e.g. an `isAdmin(userId) || users.plan === 'boosted'` lookup) and reuse that helper rather than duplicating the logic.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/infra test -- read.generate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/read.ts infra/lambda/src/routes/read.generate.test.ts
git commit -m "feat(api): add POST /read/generate with cache + metering"
```

---

## Task 9: `useGenerateReadingText` hook

**Files:**
- Create: `packages/api-client/src/hooks/useGenerateReadingText.ts`
- Test: `packages/api-client/src/hooks/useGenerateReadingText.test.ts`
- Modify: `packages/api-client/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/api-client/src/hooks/useGenerateReadingText.test.ts`, mirroring `useReadEntryMutations.test.ts` (a `QueryClientProvider` wrapper + a stub `fetchFn` returning a `Response`-like object):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useGenerateReadingText } from './useGenerateReadingText';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

describe('useGenerateReadingText', () => {
  it('POSTs to /read/generate and parses the response', async () => {
    const fetchFn = vi.fn(async () => ({
      json: async () => ({
        title: 'Kedi',
        text: 'Kedi pazarda.',
        cefr: 'A2',
        difficultyScore: 0.1,
        fromCache: false,
        runsHard: false,
      }),
    }));
    const { result } = renderHook(() => useGenerateReadingText({ fetchFn: fetchFn as any }), { wrapper });
    result.current.mutate({ language: 'TR', cefr: 'A2', length: 'short', topic: 'a cat' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledWith('/read/generate', expect.objectContaining({ method: 'POST' }));
    expect(result.current.data?.text).toBe('Kedi pazarda.');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/api-client test -- useGenerateReadingText.test.ts`
Expected: FAIL — hook does not exist.

- [ ] **Step 3: Implement the hook**

Create `packages/api-client/src/hooks/useGenerateReadingText.ts` (mirror `useSaveReadEntry`, `packages/api-client/src/hooks/useReadEntryMutations.ts:28-57`):

```typescript
import { useMutation } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import {
  GenerateReadingTextResponseSchema,
  type GenerateReadingTextRequest,
  type GenerateReadingTextResponse,
} from '../schemas/read';

export type UseGenerateReadingTextOptions = { fetchFn: AuthenticatedFetch };

export function useGenerateReadingText({ fetchFn }: UseGenerateReadingTextOptions) {
  return useMutation<
    GenerateReadingTextResponse,
    Error,
    GenerateReadingTextRequest
  >({
    mutationFn: async (input) => {
      const response = await fetchFn('/read/generate', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const json: unknown = await response.json();
      return GenerateReadingTextResponseSchema.parse(json);
    },
  });
}
```

- [ ] **Step 4: Export from `packages/api-client/src/index.ts`**

```typescript
export {
  useGenerateReadingText,
  type UseGenerateReadingTextOptions,
} from './hooks/useGenerateReadingText';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/api-client test -- useGenerateReadingText.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api-client/src/hooks/useGenerateReadingText.ts packages/api-client/src/hooks/useGenerateReadingText.test.ts packages/api-client/src/index.ts
git commit -m "feat(api-client): add useGenerateReadingText hook"
```

---

## Task 10: `GenerateView` component

**Files:**
- Create: `apps/web/app/(dashboard)/read/_components/generate-view.tsx`

This is presentational: chips, topic input, length toggle, level control (pre-filled, editable), language switcher, a Generate button, and a loader while `isLoading`. State is owned by the page; the view is driven by props (same convention as `PasteView`).

- [ ] **Step 1: Implement the component**

Create `apps/web/app/(dashboard)/read/_components/generate-view.tsx`:

```typescript
'use client';

import {
  CefrLevel,
  ReadingTextLength,
  READING_GEN_TOPIC_MAX_CHARS,
} from '@language-drill/shared';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';

export type GenerateLanguage = 'ES' | 'DE' | 'TR';

export type GenerateState = {
  topic: string;
  length: ReadingTextLength;
  cefr: CefrLevel;
  language: GenerateLanguage;
};

type Props = {
  state: GenerateState;
  chips: readonly string[];
  onChange: <K extends keyof GenerateState>(field: K, value: GenerateState[K]) => void;
  onChipPick: (topic: string) => void;
  onGenerate: () => void;
  onCancel: () => void;
  isLoading: boolean;
  errorBody: string | null;
  rateLimited?: boolean;
};

const LENGTHS: ReadingTextLength[] = [
  ReadingTextLength.SHORT,
  ReadingTextLength.MEDIUM,
  ReadingTextLength.LONG,
];
const LEVELS = Object.values(CefrLevel);
const LANGUAGES: GenerateLanguage[] = ['ES', 'DE', 'TR'];

export function GenerateView({
  state,
  chips,
  onChange,
  onChipPick,
  onGenerate,
  onCancel,
  isLoading,
  errorBody,
  rateLimited = false,
}: Props) {
  const isEmpty = state.topic.trim().length === 0;
  const tooLong = state.topic.length > READING_GEN_TOPIC_MAX_CHARS;
  const cannotGenerate = isLoading || isEmpty || tooLong || rateLimited;

  return (
    <div className="mx-auto max-w-[720px] mobile:max-w-none">
      <h2 className="t-display-l my-[8px]">generate something to read.</h2>

      {/* Chips */}
      <div className="flex flex-wrap gap-[8px] my-[12px]">
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={isLoading}
            onClick={() => onChipPick(chip)}
            className="rounded-full border px-[12px] py-[6px] text-[14px]"
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Topic */}
      <Input
        value={state.topic}
        maxLength={READING_GEN_TOPIC_MAX_CHARS}
        placeholder="a topic, e.g. a day at the beach"
        onChange={(e) => onChange('topic', e.target.value)}
        disabled={isLoading}
      />

      {/* Controls row: length / level / language */}
      <div className="flex flex-wrap gap-[16px] my-[12px]">
        <label>
          length
          <select
            value={state.length}
            onChange={(e) => onChange('length', e.target.value as ReadingTextLength)}
            disabled={isLoading}
          >
            {LENGTHS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        <label>
          level
          <select
            value={state.cefr}
            onChange={(e) => onChange('cefr', e.target.value as CefrLevel)}
            disabled={isLoading}
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        <label>
          language
          <select
            value={state.language}
            onChange={(e) => onChange('language', e.target.value as GenerateLanguage)}
            disabled={isLoading}
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
      </div>

      {tooLong && <p className="text-error text-[13px]">topic is too long.</p>}
      {rateLimited && (
        <p className="text-error text-[13px]">daily generation limit reached.</p>
      )}
      {errorBody && <p className="text-error text-[13px]">{errorBody}</p>}

      {/* Loader while generating */}
      {isLoading && (
        <p role="status" aria-live="polite" className="my-[12px]">
          generating your text…
        </p>
      )}

      <div className="flex gap-[8px] mt-[12px]">
        <Button onClick={onGenerate} disabled={cannotGenerate}>
          {isLoading ? 'generating…' : 'generate'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={isLoading}>
          cancel
        </Button>
      </div>
    </div>
  );
}
```

> Match the actual `Button`/`Input` prop APIs and class conventions in `apps/web/app/(dashboard)/read/_components/paste-view.tsx`; adjust the `select` styling to the project's form components if a `Select` UI primitive exists.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @language-drill/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(dashboard)/read/_components/generate-view.tsx"
git commit -m "feat(web): add GenerateView component"
```

---

## Task 11: Reducer wiring + page integration

**Files:**
- Modify: `apps/web/app/(dashboard)/read/_state/read-page-reducer.ts`
- Modify: `apps/web/app/(dashboard)/read/_state/read-page-reducer.test.ts`
- Modify: `apps/web/app/(dashboard)/read/_components/empty-view.tsx`
- Modify: `apps/web/app/(dashboard)/read/page.tsx`

- [ ] **Step 1: Write the failing reducer test**

Append to `read-page-reducer.test.ts`:

```typescript
it('switches to the generating view and edits generate fields', () => {
  let s = readPageReducer(initialState, { type: 'SET_VIEW', view: 'generating' });
  expect(s.view).toBe('generating');
  s = readPageReducer(s, { type: 'GENERATE_FIELD', field: 'topic', value: 'a cat' });
  expect(s.generate.topic).toBe('a cat');
});

it('resets generate state', () => {
  let s = readPageReducer(initialState, { type: 'GENERATE_FIELD', field: 'topic', value: 'x' });
  s = readPageReducer(s, { type: 'GENERATE_RESET' });
  expect(s.generate.topic).toBe('');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/web test -- read-page-reducer.test.ts`
Expected: FAIL — `'generating'` not in `View`; `GENERATE_FIELD`/`generate` slice missing.

- [ ] **Step 3: Extend the reducer**

In `read-page-reducer.ts`:

1. Extend `View`:
```typescript
export type View = 'empty' | 'pasting' | 'generating' | 'annotated' | 'history';
```

2. Add a `generate` slice to `ReadPageState` (place beside the existing `paste` slice) and to `initialState`:
```typescript
// in ReadPageState:
generate: {
  topic: string;
  length: import('@language-drill/shared').ReadingTextLength;
  cefr: import('@language-drill/shared').CefrLevel;
  language: 'ES' | 'DE' | 'TR';
};

// in initialState (import ReadingTextLength, CefrLevel at top of file):
generate: {
  topic: '',
  length: ReadingTextLength.SHORT,
  cefr: CefrLevel.A2,
  language: 'TR',
},
```

3. Add actions to the `Action` union:
```typescript
| {
    type: 'GENERATE_FIELD';
    field: 'topic' | 'length' | 'cefr' | 'language';
    value: string;
  }
| { type: 'GENERATE_RESET' }
```

4. Handle them in `readPageReducer`:
```typescript
case 'GENERATE_FIELD':
  return { ...state, generate: { ...state.generate, [action.field]: action.value } };
case 'GENERATE_RESET':
  return { ...state, generate: initialState.generate };
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @language-drill/web test -- read-page-reducer.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the Generate entry point to `EmptyView`**

In `_components/empty-view.tsx`, add an `onGenerate: () => void` prop and a button beside the existing paste CTA:

```typescript
type Props = {
  onPaste: () => void;
  onGenerate: () => void;
  cefrToken: CefrLevel | null;
};
// ...render, next to the paste button:
<Button onClick={onGenerate}>generate a text</Button>
```

- [ ] **Step 6: Wire the page (`page.tsx`)**

1. Import the new pieces:
```typescript
import { GenerateView } from './_components/generate-view';
import { useGenerateReadingText } from '@language-drill/api-client';
```

2. Instantiate the hook using the page's existing authenticated `fetchFn` (the same one passed to `useSaveReadEntry`):
```typescript
const generateMutation = useGenerateReadingText({ fetchFn });
```

3. Default the generate level/language from the page's current language + `cefrToken` when entering the view (dispatch `GENERATE_FIELD` for `cefr`/`language` in the `onGenerate` handler that also does `dispatch({ type: 'SET_VIEW', view: 'generating' })`).

4. On Generate, call the mutation; on success, feed the generated text into the existing annotate flow exactly as a paste would — set the paste text and trigger the same annotate path the `PasteView` "Annotate" button uses (the page already has that handler; reuse it with `data.text`/`data.title`):
```typescript
const handleGenerate = () => {
  generateMutation.mutate(
    {
      language: state.generate.language,
      cefr: state.generate.cefr,
      length: state.generate.length,
      topic: state.generate.topic,
    },
    {
      onSuccess: (data) => {
        dispatch({ type: 'PASTE_FIELD', field: 'title', value: data.title });
        dispatch({ type: 'PASTE_FIELD', field: 'text', value: data.text });
        // reuse the existing annotate trigger (same as PasteView's onAnnotate)
        handleAnnotate();
      },
    },
  );
};
```

5. Render the view in the existing view switch:
```typescript
{state.view === 'generating' && (
  <GenerateView
    state={state.generate}
    chips={READING_CHIPS_BY_LANGUAGE[state.generate.language]}
    onChange={(field, value) =>
      dispatch({ type: 'GENERATE_FIELD', field, value: String(value) })
    }
    onChipPick={(topic) => {
      dispatch({ type: 'GENERATE_FIELD', field: 'topic', value: topic });
    }}
    onGenerate={handleGenerate}
    onCancel={() => dispatch({ type: 'SET_VIEW', view: 'empty' })}
    isLoading={generateMutation.isPending}
    errorBody={generateMutation.error?.message ?? null}
    rateLimited={(generateMutation.error as { status?: number } | null)?.status === 429}
  />
)}
```

6. `READING_CHIPS_BY_LANGUAGE` is added in Task 12; import it from `@language-drill/shared`.

- [ ] **Step 7: Typecheck + test the web package**

Run: `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/app/(dashboard)/read"
git commit -m "feat(web): wire GenerateView into the Reading page"
```

---

## Task 12: Seed chips + register the prompt in Langfuse

**Files:**
- Modify: `packages/shared/src/read.ts` (chip seed list)
- Modify: `packages/shared/src/read.test.ts`
- Modify: prompt registry / bootstrap source (see Step 3)

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/read.test.ts`:

```typescript
import { READING_CHIPS_BY_LANGUAGE } from './index';

describe('READING_CHIPS_BY_LANGUAGE', () => {
  it('provides at least three chips for each reading language', () => {
    for (const lang of ['ES', 'DE', 'TR'] as const) {
      expect(READING_CHIPS_BY_LANGUAGE[lang].length).toBeGreaterThanOrEqual(3);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/shared test -- read.test.ts`
Expected: FAIL — `READING_CHIPS_BY_LANGUAGE` not exported.

- [ ] **Step 3: Implement the chip seed**

Append to `packages/shared/src/read.ts` (topics are written in English; the prompt instructs Claude to write the text in the target language, so the chips stay readable in the UI):

```typescript
/** Seed topic chips shown on the generate launchpad, per reading language. */
export const READING_CHIPS_BY_LANGUAGE: Record<'ES' | 'DE' | 'TR', readonly string[]> = {
  ES: ['a short café dialogue', 'news: a city festival', 'a short story about a cat', 'an email to a friend'],
  DE: ['a short café dialogue', 'news: a city festival', 'a short story about a cat', 'an email to a friend'],
  TR: ['a short café dialogue', 'news: a city festival', 'a short story about a cat', 'an email to a friend'],
};
```

- [ ] **Step 4: Register the prompt in Langfuse (so runtime can serve it from the live store)**

Add the reading-generation prompt to whatever `bootstrap-prompts` enumerates (the prompt registry that lists the six existing system prompts — see `packages/ai/src/prompts-registry.ts`). Register `name: 'reading-generation-system-prompt'` with body `READING_GENERATION_SYSTEM_PROMPT` and version `READING_GENERATION_PROMPT_VERSION`, mirroring the existing entries. Then have `buildReadingGenerationSystemPrompt` resolve via `getPromptWithVarsOrFallback('reading-generation-system-prompt', READING_GENERATION_SYSTEM_PROMPT, READING_GENERATION_PROMPT_VERSION, {})` (the same resolver `buildGenerationSystemPrompt` uses at `packages/ai/src/generation-prompts.ts`).

> The in-repo constant already works as a fallback (Task 3), so this step only adds the live-store path. If `prompts-registry.ts` does not exist or differs, follow the actual registration pattern the other six prompts use; do not invent a new mechanism.

- [ ] **Step 5: Run the registry check**

Run: `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/shared test -- read.test.ts`
Expected: PASS. (Langfuse push to live environments is an operational step performed at deploy time per CLAUDE.md, not in this plan.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/read.ts packages/shared/src/read.test.ts packages/ai/src/prompts-registry.ts packages/ai/src/reading-generation-prompts.ts
git commit -m "feat: seed reading chips + register generation prompt"
```

---

## Task 13: Full-suite verification

- [ ] **Step 1: Build everything (avoids stale dist resolution)**

Run: `pnpm build`
Expected: all packages build.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: zero errors.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Tests (serialize to avoid the known infra parallel flake)**

Run: `pnpm turbo run test --concurrency=1`
Expected: all green. (Per project memory, full `pnpm test` can flakily fail `infra` under parallel load; `--concurrency=1` is the reliable signal.)

- [ ] **Step 5: Report**

Report X passed / Y failed per package. Fix any failure before claiming completion (use systematic-debugging if needed).

- [ ] **Step 6: Final commit (if any fixups were needed)**

```bash
git add -A
git commit -m "test: green full suite for reading text generation"
```

---

## Self-review notes (author)

- **Spec coverage:** UX launchpad + chips (Tasks 10–12); topic+length controls (Tasks 1, 10); auto level + override + language switcher (Tasks 10–11); Sonnet generation (Task 5); deterministic level check + regenerate-once + stored difficulty score (Tasks 4–6); caching keyed by (language, cefr, length, normalizedPrompt) with hit-not-metered (Tasks 6, 8); new `text_generation` bucket metered only on miss (Tasks 2, 8); non-streaming endpoint + loader (Tasks 8, 10); `read_entries.source` enum — **deliberately dropped** (decision: keep zero churn on `read_entries`; generated texts save through the existing paste path unchanged); error handling 400/429/502 (Task 8). All spec sections map to a task.
- **Open verification points flagged inline** (not placeholders — they are "match the existing pattern" confirmations): exact `usageEvents` insert columns and `plan` resolution in Task 8; the `Button`/`Input`/`select` primitives in Task 10; the prompt-registry shape in Task 12. These depend on local conventions the implementer must read once; each names the authoritative file to copy from.
- **Type consistency:** `generateReadingText` result fields (`title/text/difficultyScore/regenerated/runsHard`) are produced in Task 5 and consumed in Task 8; the response schema fields (`title/text/cefr/difficultyScore/fromCache/runsHard`) are defined in Task 7 and consumed in Tasks 8–9. `ReadingTextLength`/`CefrLevel`/`READING_*` constants defined in Task 1 are used consistently downstream.
