# Dictation Exercise (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Dictation listening exercise — a new pool exercise type where the learner hears a Polly-synthesized clip, types the full transcription, and is graded by a deterministic char/word diff + a Claude "forgiveness" pass — wired into the existing drill session and the reserved `listening` progress axis.

**Architecture:** Dictation is a new `ExerciseType` flowing through the existing pool/session/submit machinery. Audio is synthesized once at seed time (AWS Polly → private S3) and served to the browser as a presigned GET URL injected into the exercise response. Grading splits cleanly: a pure deterministic diff (`packages/ai/dictation-diff.ts`) computes raw char/word accuracy + the differing segments, then one metered Claude call (`packages/ai/dictation-eval.ts`) classifies each difference as accepted (homophone, b/v, tilde, punctuation) vs. genuine error and supplies notes; code recomputes the adjusted accuracy. The result is a `DictationResult` (a superset of `EvaluationResult`, so storage/debrief/aggregation are untouched) rendered in the real app's components.

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo); Next.js App Router (apps/web); Hono on AWS Lambda (infra/lambda); Drizzle + Neon (packages/db); Anthropic SDK (packages/ai); AWS CDK (infra); AWS Polly + S3 (`@aws-sdk/client-polly`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`); Vitest + Playwright.

**Conventions for this plan:**
- Run all commands from the repo root (the worktree at `.claude/worktrees/feat-dictation`).
- Per-package tests: `pnpm --filter @language-drill/<pkg> test <file>`. After editing `packages/*` source consumed by another package's tests, run `pnpm build` first (turbo) — single-package vitest resolves siblings from `dist`.
- TDD: write the failing test, watch it fail, implement, watch it pass, commit.
- This is slice 1. Explicitly NOT in scope: background batch generation of dictation content, the partial/gap variant, CloudFront signing, a persisted phonology sub-competency, replay/slow-mode score weighting, and a bespoke debrief renderer (dictation items fall back to the generic debrief display — acceptable, verified in Task 16).

---

## File map

**packages/shared/src/index.ts** — `ExerciseType.DICTATION`; `DictationContent` + union member + `isDictationContent`; result types `DictationDiffSegment`, `DictationDifference`, `DictationCriterion`, `DictationResult`; `isDictationResult`.

**packages/ai/** (new + modified)
- `src/dictation-diff.ts` (new) — pure deterministic diff: `diffDictation(reference, typed)`.
- `src/dictation-diff.test.ts` (new).
- `src/dictation-prompts.ts` (new) — `DICTATION_EVAL_SYSTEM_PROMPT`, `DICTATION_EVAL_PROMPT_VERSION`, `buildDictationUserPrompt`.
- `src/dictation-eval.ts` (new) — tool schema, `parseDictationClassification`, `gradeDictationAnswer`, result assembly.
- `src/dictation-eval.test.ts` (new).
- `src/index.ts` (modify) — re-exports.

**infra/lambda/** (new + modified)
- `src/lib/audio-url.ts` (new) — `presignAudioUrl(key)`.
- `src/lib/audio-url.test.ts` (new).
- `src/lib/dictation-content.ts` (new) — `withAudioUrl(row)` helper merging `audioUrl` into a dictation `contentJson`.
- `src/routes/exercises.ts` (modify) — presigned `audioUrl` in GET responses; dictation branch in submit.
- `src/routes/exercises.test.ts` (modify) — submit-branch + audioUrl tests.
- `src/routes/sessions.ts` (modify) — presigned `audioUrl` in POST /sessions exercises.
- `src/lib/progress-aggregation.ts` (modify) — `DICTATION → 'listening'`.
- `src/lib/progress-aggregation.test.ts` (modify).

**infra/lib/** (modify)
- `stack.ts` — create `storage` before `lambda`; pass `CONTENT_BUCKET_NAME` env.

**packages/db/** (new + modified)
- `scripts/seed-dictation.ts` (new) — clip data + Polly synth + S3 upload + idempotent insert.
- `scripts/seed-dictation.test.ts` (new) — pure planning tests.
- `package.json` (modify) — `seed:dictation` script.
- root `package.json` (modify) — `db:seed:dictation` passthrough.

**packages/api-client/src/** (modify)
- `schemas/exercise.ts` — `DictationResultSchema`, `SubmitResult` union.
- `hooks/useExercise.ts` — parse union in `useSubmitAnswer`.
- `schemas/exercise.test.ts` — schema tests.

**apps/web/** (new + modified)
- `app/(dashboard)/drill/_components/types.ts` — widen `result` to union.
- `app/(dashboard)/drill/_components/session-reducer.ts` — widen `ITEM_EVALUATED.result`.
- `lib/drill/verdict-tier.ts` — `dictationVerdict`.
- `lib/drill/coach-messages.ts` — DICTATION cases.
- `app/(dashboard)/drill/_components/audio-player.tsx` (new) + test.
- `app/(dashboard)/drill/_components/dictation-exercise.tsx` (new) + test.
- `app/(dashboard)/drill/_components/exercise-pane.tsx` — dispatch.

---

## Task 1: Shared types — enum, content, result

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/dictation.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/dictation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  ExerciseType,
  isDictationContent,
  isDictationResult,
  type DictationContent,
  type DictationResult,
  type ExerciseContent,
} from './index';

const content: DictationContent = {
  type: ExerciseType.DICTATION,
  title: 'El tiempo lo cura todo',
  referenceText: 'Cuando era niño, mi abuela me decía que el tiempo lo cura todo.',
  sentences: ['Cuando era niño, mi abuela me decía que el tiempo lo cura todo.'],
  accent: 'español peninsular',
  voiceId: 'Sergio',
  tested: ['Límites de palabra (sinalefa)'],
  durationSec: 6,
  waveform: [0.2, 0.5, 0.8, 0.4],
};

describe('dictation type guards', () => {
  it('DICTATION enum value is "dictation"', () => {
    expect(ExerciseType.DICTATION).toBe('dictation');
  });

  it('isDictationContent narrows on type', () => {
    expect(isDictationContent(content)).toBe(true);
    const cloze = { type: ExerciseType.CLOZE } as unknown as ExerciseContent;
    expect(isDictationContent(cloze)).toBe(false);
  });

  it('isDictationResult discriminates on kind', () => {
    const r = { kind: 'dictation', score: 0.9 } as unknown as DictationResult;
    expect(isDictationResult(r)).toBe(true);
    expect(isDictationResult({ score: 0.9 } as never)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/shared test dictation`
Expected: FAIL — `ExerciseType.DICTATION`, `isDictationContent`, `isDictationResult`, `DictationContent`, `DictationResult` are not exported.

- [ ] **Step 3: Add the enum value**

In `packages/shared/src/index.ts`, extend the enum (after `SENTENCE_CONSTRUCTION`):

```ts
export enum ExerciseType {
  CLOZE = "cloze",
  TRANSLATION = "translation",
  VOCAB_RECALL = "vocab_recall",
  SENTENCE_CONSTRUCTION = "sentence_construction",
  DICTATION = "dictation",
}
```

- [ ] **Step 4: Add `DictationContent`, union member, guard**

After the `SentenceConstructionContent` type, add:

```ts
export type DictationContent = {
  type: ExerciseType.DICTATION;
  /** Short title for the clip card, e.g. "El tiempo lo cura todo". */
  title: string;
  /** Optional one-line brief shown under the title. */
  blurb?: string;
  /** The full transcription target — the grading reference. */
  referenceText: string;
  /** Per-sentence reference, for display/segmentation. */
  sentences: string[];
  /** Human label of the accent, e.g. "español peninsular · centro". */
  accent: string;
  /** Polly voice id used to synthesize the audio (e.g. "Sergio"). */
  voiceId: string;
  domain?: string;
  register?: string;
  /** "What this tests" chips shown on the brief card. */
  tested: string[];
  durationSec: number;
  /** Decorative amplitude envelope (0..1) for the waveform UI. */
  waveform: number[];
  /**
   * Presigned S3 GET URL for the clip audio. NOT stored in the DB; injected by
   * the API at response time from `exercises.audioS3Key`. Absent in stored JSON.
   */
  audioUrl?: string;
};
```

Extend the union:

```ts
export type ExerciseContent =
  | ClozeContent
  | TranslationContent
  | VocabRecallContent
  | SentenceConstructionContent
  | DictationContent;
```

Add the guard alongside the others:

```ts
export function isDictationContent(content: ExerciseContent): content is DictationContent {
  return content.type === ExerciseType.DICTATION;
}
```

- [ ] **Step 5: Add the result types + guard**

After the `EvaluationResult` type, add:

```ts
// ---------------------------------------------------------------------------
// Dictation result types
// ---------------------------------------------------------------------------

/** One ordered segment of the results diff prose. */
export type DictationDiffSegment =
  | { kind: "match"; text: string }
  | { kind: "error"; id: number; got: string; expected: string; severity: "low" | "high" }
  | { kind: "accepted"; id: number; got: string; expected: string };

/** One flagged difference, classified by Claude. */
export type DictationDifference = {
  id: number;
  kind: "error" | "accepted";
  /** Short category, e.g. "word boundary", "silent h", "b/v". */
  category: string;
  /** Severity for genuine errors; null for accepted differences. */
  severity: "low" | "high" | null;
  got: string;
  expected: string;
  note: string;
};

/** One accuracy-criterion row (0–1 + CEFR). */
export type DictationCriterion = {
  id: string;
  label: string;
  score: number;
  cefr: string;
  note: string;
};

/**
 * Dictation grading result. A superset of EvaluationResult: it carries every
 * EvaluationResult field (so `user_exercise_history` storage, the debrief read,
 * and progress aggregation work unchanged) plus dictation-specific detail.
 * `kind: "dictation"` discriminates it from a plain EvaluationResult on the wire.
 */
export type DictationResult = {
  kind: "dictation";
  // EvaluationResult-compatible fields:
  score: number; // == adjustedCharAccuracy
  grammarAccuracy: number; // == adjustedCharAccuracy (no grammar axis; shape compat)
  vocabularyRange: string; // == listeningCefr
  taskAchievement: number; // == wordAccuracy
  feedback: string; // == summary
  errors: EvaluationError[]; // mapped from genuine-error differences
  estimatedCefrEvidence: string; // == listeningCefr
  // dictation-specific:
  rawCharAccuracy: number;
  adjustedCharAccuracy: number;
  wordAccuracy: number;
  listeningCefr: string;
  headline: string;
  summary: string;
  diff: DictationDiffSegment[];
  differences: DictationDifference[];
  criteria: DictationCriterion[];
};

export function isDictationResult(
  result: EvaluationResult | DictationResult,
): result is DictationResult {
  return (result as { kind?: string }).kind === "dictation";
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @language-drill/shared test dictation`
Expected: PASS (3 tests).

- [ ] **Step 7: Build + typecheck**

Run: `pnpm build && pnpm --filter @language-drill/shared typecheck`
Expected: clean (the `never` exhaustiveness in downstream packages will fail typecheck — that's expected and fixed in Tasks 7 and 11; this step only checks the shared package).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/dictation.test.ts
git commit -m "feat(shared): add DICTATION exercise type, content, and result types"
```

---

## Task 2: Deterministic dictation diff (pure)

**Files:**
- Create: `packages/ai/src/dictation-diff.ts`
- Test: `packages/ai/src/dictation-diff.test.ts`

The diff is the deterministic half of grading: char accuracy, word accuracy, and the ordered list of differences. It is pure (no Claude). Word alignment uses a Levenshtein backtrace on token arrays; char accuracy uses char-level Levenshtein on whitespace-normalized strings.

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/dictation-diff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { diffDictation } from './dictation-diff.js';

describe('diffDictation', () => {
  it('perfect match → 1.0 accuracies, no differences', () => {
    const r = diffDictation('Hola mundo.', 'Hola mundo.');
    expect(r.rawCharAccuracy).toBe(1);
    expect(r.wordAccuracy).toBe(1);
    expect(r.differences).toHaveLength(0);
    expect(r.segments).toEqual([{ kind: 'match', text: 'Hola mundo.' }]);
  });

  it('is case- and whitespace-insensitive for word matching', () => {
    const r = diffDictation('Hola  mundo', 'hola mundo');
    expect(r.wordAccuracy).toBe(1);
    expect(r.differences).toHaveLength(0);
  });

  it('flags a word-boundary substitution', () => {
    const r = diffDictation('el tiempo lo cura todo', 'el tiempo locura todo');
    expect(r.wordAccuracy).toBeCloseTo(4 / 5, 5); // 4 of 5 reference words matched
    const subs = r.differences.filter((d) => d.expected && d.got);
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(r.differences.map((d) => d.got).join(' ')).toContain('locura');
  });

  it('flags a missing word (deletion) with empty got', () => {
    const r = diffDictation('me he dado cuenta', 'me dado cuenta');
    expect(r.differences.some((d) => d.expected === 'he' && d.got === '')).toBe(true);
  });

  it('rawCharAccuracy drops with character edits', () => {
    const r = diffDictation('heridas', 'eridas');
    expect(r.rawCharAccuracy).toBeCloseTo(6 / 7, 5);
  });

  it('assigns stable incrementing ids to differences in reading order', () => {
    const r = diffDictation('a b c d', 'a x c y');
    expect(r.differences.map((d) => d.id)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test dictation-diff`
Expected: FAIL — `./dictation-diff.js` not found.

- [ ] **Step 3: Implement the diff module**

Create `packages/ai/src/dictation-diff.ts`:

```ts
/**
 * packages/ai — Deterministic dictation diff.
 *
 * The deterministic half of dictation grading ("character-level comparison").
 * Pure: no Claude, no I/O. Produces raw char/word accuracy plus an ordered list
 * of differences, each with a stable id, that the Claude "forgiveness" pass
 * (dictation-eval.ts) then classifies as accepted vs. genuine error.
 */

export type DiffDifference = {
  id: number;
  /** Lowercased, punctuation-trimmed token the learner produced ("" for a deletion). */
  got: string;
  /** Lowercased, punctuation-trimmed reference token ("" for an insertion). */
  expected: string;
};

export type DiffSegment =
  | { kind: "match"; text: string }
  | { kind: "diff"; id: number; got: string; expected: string };

export type DictationDiff = {
  rawCharAccuracy: number;
  wordAccuracy: number;
  /** Ordered prose segments (match runs + diffs) over the reference, for the UI. */
  segments: DiffSegment[];
  differences: DiffDifference[];
};

/** NFC + collapse internal whitespace + trim. Case preserved (case is a real diff). */
function normWhitespace(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Lowercased, NFC, leading/trailing punctuation stripped — for word matching. */
function normToken(t: string): string {
  return t
    .normalize("NFC")
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "");
}

function tokenize(s: string): string[] {
  const trimmed = normWhitespace(s);
  return trimmed.length === 0 ? [] : trimmed.split(" ");
}

/** Levenshtein distance between two strings (characters). */
function charLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

type Op = "equal" | "sub" | "del" | "ins";

/** Token-level edit script via Levenshtein backtrace. `ref` is expected, `hyp` is typed. */
function alignTokens(refTokens: string[], hypTokens: string[]): Array<{ op: Op; ref?: string; hyp?: string }> {
  const refN = refTokens.map(normToken);
  const hypN = hypTokens.map(normToken);
  const m = refN.length;
  const n = hypN.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = refN[i - 1] === hypN[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  const ops: Array<{ op: Op; ref?: string; hyp?: string }> = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const cost = refN[i - 1] === hypN[j - 1] ? 0 : 1;
      if (d[i][j] === d[i - 1][j - 1] + cost) {
        ops.push({ op: cost === 0 ? "equal" : "sub", ref: refTokens[i - 1], hyp: hypTokens[j - 1] });
        i--; j--;
        continue;
      }
    }
    if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ op: "del", ref: refTokens[i - 1] }); // reference word missing from hyp
      i--;
      continue;
    }
    ops.push({ op: "ins", hyp: hypTokens[j - 1] }); // extra word in hyp
    j--;
  }
  ops.reverse();
  return ops;
}

export function diffDictation(reference: string, typed: string): DictationDiff {
  const normRef = normWhitespace(reference);
  const normTyped = normWhitespace(typed);
  const maxLen = Math.max(normRef.length, normTyped.length);
  const rawCharAccuracy = maxLen === 0 ? 1 : 1 - charLevenshtein(normRef, normTyped) / maxLen;

  const refTokens = tokenize(reference);
  const hypTokens = tokenize(typed);
  const ops = alignTokens(refTokens, hypTokens);

  const equalCount = ops.filter((o) => o.op === "equal").length;
  const wordAccuracy = refTokens.length === 0 ? 1 : equalCount / refTokens.length;

  const segments: DiffSegment[] = [];
  const differences: DiffDifference[] = [];
  let nextId = 1;
  let matchBuffer: string[] = [];
  const flushMatch = () => {
    if (matchBuffer.length > 0) {
      segments.push({ kind: "match", text: matchBuffer.join(" ") });
      matchBuffer = [];
    }
  };

  for (const o of ops) {
    if (o.op === "equal") {
      matchBuffer.push(o.ref!);
      continue;
    }
    flushMatch();
    const got = o.hyp ? normToken(o.hyp) : "";
    const expected = o.ref ? normToken(o.ref) : "";
    const id = nextId++;
    segments.push({ kind: "diff", id, got, expected });
    differences.push({ id, got, expected });
  }
  flushMatch();

  return { rawCharAccuracy, wordAccuracy, segments, differences };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/ai test dictation-diff`
Expected: PASS (6 tests). If `4/5` word-accuracy assertion is off, recheck `normToken` strips trailing punctuation.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/dictation-diff.ts packages/ai/src/dictation-diff.test.ts
git commit -m "feat(ai): deterministic dictation char/word diff"
```

---

## Task 3: Dictation eval prompt + version

**Files:**
- Create: `packages/ai/src/dictation-prompts.ts`
- Test: `packages/ai/src/dictation-prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/dictation-prompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DICTATION_EVAL_SYSTEM_PROMPT,
  DICTATION_EVAL_PROMPT_VERSION,
  buildDictationUserPrompt,
} from './dictation-prompts.js';

describe('dictation prompts', () => {
  it('version is dated', () => {
    expect(DICTATION_EVAL_PROMPT_VERSION).toMatch(/^dictation@\d{4}-\d{2}-\d{2}$/);
  });

  it('system prompt names the forgiveness contract', () => {
    expect(DICTATION_EVAL_SYSTEM_PROMPT).toMatch(/accepted/i);
    expect(DICTATION_EVAL_SYSTEM_PROMPT).toMatch(/error/i);
  });

  it('user prompt embeds reference, answer, and numbered differences', () => {
    const p = buildDictationUserPrompt({
      referenceText: 'el tiempo lo cura todo',
      userAnswer: 'el tiempo locura todo',
      language: 'ES' as never,
      differences: [{ id: 1, got: 'locura', expected: 'lo cura' }],
    });
    expect(p).toContain('el tiempo lo cura todo');
    expect(p).toContain('el tiempo locura todo');
    expect(p).toContain('#1');
    expect(p).toContain('locura');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test dictation-prompts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the prompts**

Create `packages/ai/src/dictation-prompts.ts`:

```ts
/**
 * packages/ai — Dictation forgiveness-pass prompt.
 *
 * The deterministic diff (dictation-diff.ts) finds *where* the transcription
 * differs from the reference. This prompt asks Claude only to *classify* each
 * difference as an accepted equivalence the ear cannot resolve (homophone, b/v,
 * tilde, punctuation, contraction) vs. a genuine listening/spelling error, and
 * to write the headline/summary + two qualitative criteria. Char/word accuracy
 * are computed in code, never by Claude.
 */

import type { Language } from "@language-drill/shared";

export const DICTATION_EVAL_PROMPT_VERSION = "dictation@2026-06-14";

export const DICTATION_EVAL_SYSTEM_PROMPT = `You grade a dictation exercise for an intermediate+ language learner who listened to a short clip of native, connected speech and typed what they heard.

You are given the reference transcription, the learner's answer, and a numbered list of the DIFFERENCES a deterministic character diff already found. Your ONLY job is to classify each numbered difference and write a short verdict. Do not invent differences that are not in the list.

For each numbered difference, decide:
- "accepted": the difference is something the EAR cannot resolve, so it must not count against listening accuracy. Examples: homophones; in Spanish b/v (same phoneme /b/); written accents/tildes that do not change the sound heard; punctuation; contractions vs. full forms; ñ vs n when the audio is ambiguous. Assign severity null.
- "error": a genuine listening or spelling miss. Examples: a wrong word, a dropped or added word, a mis-segmented word boundary (e.g. hearing "lo cura" as "locura"), a silent-letter spelling slip (Spanish silent h). Assign severity "high" for a real comprehension failure (wrong word / word boundary), "low" for a spelling slip that does not change the word heard.

Give each difference a short category (e.g. "word boundary", "silent h", "b/v", "tilde", "punctuation", "wrong word") and a one-sentence note in the language of the exercise.

Also return:
- headline: one short encouraging sentence.
- summary: 1–2 sentences on what the ear got right and the one pattern to train.
- listeningCefr: the CEFR level (A1–C2) this performance evidences for listening.
- criteria: exactly two rows — id "phon" (Phoneme discrimination) and id "bound" (Word-boundary tracking) — each with score 0–1, a CEFR string, and a one-line note.

Call submit_dictation_classification with your result.`;

export type DictationUserPromptInput = {
  referenceText: string;
  userAnswer: string;
  language: Language;
  differences: Array<{ id: number; got: string; expected: string }>;
};

export function buildDictationUserPrompt(input: DictationUserPromptInput): string {
  const { referenceText, userAnswer, language, differences } = input;
  const diffLines =
    differences.length === 0
      ? "(none — the transcription matched exactly)"
      : differences
          .map(
            (d) =>
              `#${d.id} heard "${d.got || "∅ (nothing typed)"}" but reference is "${d.expected || "∅ (extra word)"}"`,
          )
          .join("\n");
  return `Language: ${language}

Reference transcription:
${referenceText}

Learner's answer:
${userAnswer}

Differences to classify:
${diffLines}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/ai test dictation-prompts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/dictation-prompts.ts packages/ai/src/dictation-prompts.test.ts
git commit -m "feat(ai): dictation forgiveness-pass system + user prompt"
```

---

## Task 4: Dictation eval — tool, parse, and `gradeDictationAnswer`

**Files:**
- Create: `packages/ai/src/dictation-eval.ts`
- Test: `packages/ai/src/dictation-eval.test.ts`

This orchestrates: run `diffDictation`, call Claude with the classification tool, merge by id, recompute adjusted accuracy (accepted differences treated as correct), and assemble a `DictationResult`.

- [ ] **Step 1: Write the failing test**

Create `packages/ai/src/dictation-eval.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Language, CefrLevel, type DictationContent } from '@language-drill/shared';
import { gradeDictationAnswer, parseDictationClassification } from './dictation-eval.js';

const content: DictationContent = {
  type: 'dictation' as never,
  title: 't',
  referenceText: 'el tiempo lo cura todo',
  sentences: ['el tiempo lo cura todo'],
  accent: 'es',
  voiceId: 'Sergio',
  tested: [],
  durationSec: 5,
  waveform: [0.5],
};

function mockClient(classification: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', name: 'submit_dictation_classification', input: classification }],
      }),
    },
  } as never;
}

describe('parseDictationClassification', () => {
  it('rejects a non-object', () => {
    expect(() => parseDictationClassification(null)).toThrow();
  });
});

describe('gradeDictationAnswer', () => {
  it('treats accepted differences as correct in the adjusted accuracy', async () => {
    // "bale" vs "vale": one substitution; Claude accepts it (b/v).
    const client = mockClient({
      headline: 'h',
      summary: 's',
      listeningCefr: 'B2',
      differences: [{ id: 1, kind: 'accepted', category: 'b/v', severity: null, note: 'n' }],
      criteria: [
        { id: 'phon', label: 'Phoneme discrimination', score: 0.9, cefr: 'B2', note: 'n' },
        { id: 'bound', label: 'Word-boundary tracking', score: 0.8, cefr: 'B1', note: 'n' },
      ],
    });
    const r = await gradeDictationAnswer(client, {
      exercise: { ...content, referenceText: 'vale la pena', sentences: ['vale la pena'] },
      userAnswer: 'bale la pena',
      language: Language.ES,
      difficulty: CefrLevel.B2,
    });
    expect(r.kind).toBe('dictation');
    // accepted → adjusted accuracy is a perfect 1.0 even though raw < 1.
    expect(r.adjustedCharAccuracy).toBe(1);
    expect(r.rawCharAccuracy).toBeLessThan(1);
    expect(r.score).toBe(r.adjustedCharAccuracy);
    expect(r.errors).toHaveLength(0); // accepted ⇒ not an EvaluationError
  });

  it('keeps genuine errors and maps them to EvaluationError', async () => {
    const client = mockClient({
      headline: 'h',
      summary: 's',
      listeningCefr: 'B1',
      differences: [{ id: 1, kind: 'error', category: 'word boundary', severity: 'high', note: 'n' }],
      criteria: [
        { id: 'phon', label: 'Phoneme discrimination', score: 0.7, cefr: 'B1', note: 'n' },
        { id: 'bound', label: 'Word-boundary tracking', score: 0.5, cefr: 'A2', note: 'n' },
      ],
    });
    const r = await gradeDictationAnswer(client, {
      exercise: content,
      userAnswer: 'el tiempo locura todo',
      language: Language.ES,
      difficulty: CefrLevel.B2,
    });
    expect(r.adjustedCharAccuracy).toBeCloseTo(r.rawCharAccuracy, 5); // nothing forgiven
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].severity).toBe('major');
    expect(r.criteria.map((c) => c.id)).toEqual(['char', 'word', 'phon', 'bound']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/ai test dictation-eval`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the eval module**

Create `packages/ai/src/dictation-eval.ts`:

```ts
/**
 * packages/ai — Dictation grading orchestration.
 *
 * gradeDictationAnswer = deterministic diff (dictation-diff.ts) + one Claude
 * "forgiveness" classification call + adjusted-accuracy recompute → DictationResult.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  CefrLevel,
  DictationContent,
  DictationCriterion,
  DictationDifference,
  DictationDiffSegment,
  DictationResult,
  EvaluationError,
  Language,
} from "@language-drill/shared";
import { diffDictation } from "./dictation-diff.js";
import {
  DICTATION_EVAL_SYSTEM_PROMPT,
  DICTATION_EVAL_PROMPT_VERSION,
  buildDictationUserPrompt,
} from "./dictation-prompts.js";
import { getPromptOrFallback } from "./prompts-registry.js";

const MODEL = "claude-haiku-4-5-20251001" as const;
const MAX_TOKENS = 1024;

export const DICTATION_TOOL_NAME = "submit_dictation_classification";

export const DICTATION_TOOL: Anthropic.Tool = {
  name: DICTATION_TOOL_NAME,
  description: "Submit the classification of each dictation difference plus the verdict.",
  input_schema: {
    type: "object" as const,
    properties: {
      headline: { type: "string" },
      summary: { type: "string" },
      listeningCefr: { type: "string", description: "CEFR level A1–C2." },
      differences: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "number" },
            kind: { type: "string", enum: ["accepted", "error"] },
            category: { type: "string" },
            severity: {
              type: "string",
              enum: ["low", "high"],
              description: "Required for kind=error; omit for kind=accepted.",
            },
            note: { type: "string" },
          },
          // severity intentionally NOT required — accepted differences omit it.
          required: ["id", "kind", "category", "note"],
        },
      },
      criteria: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            score: { type: "number" },
            cefr: { type: "string" },
            note: { type: "string" },
          },
          required: ["id", "label", "score", "cefr", "note"],
        },
      },
    },
    required: ["headline", "summary", "listeningCefr", "differences", "criteria"],
  },
};

type RawClassification = {
  headline: string;
  summary: string;
  listeningCefr: string;
  differences: Array<{ id: number; kind: "accepted" | "error"; category: string; severity: "low" | "high" | null; note: string }>;
  criteria: DictationCriterion[];
};

export function parseDictationClassification(input: unknown): RawClassification {
  if (typeof input !== "object" || input === null) {
    throw new Error("Dictation classification must be an object");
  }
  const raw = input as Record<string, unknown>;
  for (const f of ["headline", "summary", "listeningCefr"] as const) {
    if (typeof raw[f] !== "string" || (raw[f] as string).length === 0) {
      throw new Error(`Invalid dictation ${f}`);
    }
  }
  if (!Array.isArray(raw.differences)) throw new Error("differences must be an array");
  if (!Array.isArray(raw.criteria)) throw new Error("criteria must be an array");
  return raw as RawClassification;
}

export type GradeDictationInput = {
  exercise: DictationContent;
  userAnswer: string;
  language: Language;
  difficulty: CefrLevel;
  systemPromptOverride?: string;
};

function cefrFor(score: number): string {
  if (score >= 0.97) return "C1";
  if (score >= 0.9) return "B2";
  if (score >= 0.75) return "B1";
  if (score >= 0.5) return "A2";
  return "A1";
}

export async function gradeDictationAnswer(
  client: Anthropic,
  input: GradeDictationInput,
): Promise<DictationResult> {
  const { exercise, userAnswer, language, systemPromptOverride } = input;
  const diff = diffDictation(exercise.referenceText, userAnswer);

  const systemPromptText =
    systemPromptOverride ??
    (await getPromptOrFallback(
      "dictation-eval-system-prompt",
      DICTATION_EVAL_SYSTEM_PROMPT,
      DICTATION_EVAL_PROMPT_VERSION,
    )).text;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text" as const, text: systemPromptText, cache_control: { type: "ephemeral" as const } }],
    messages: [
      {
        role: "user" as const,
        content: buildDictationUserPrompt({
          referenceText: exercise.referenceText,
          userAnswer,
          language,
          differences: diff.differences,
        }),
      },
    ],
    tools: [DICTATION_TOOL],
    tool_choice: { type: "tool" as const, name: DICTATION_TOOL_NAME },
    temperature: 0,
  });

  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!block || block.name !== DICTATION_TOOL_NAME) {
    throw new Error(`Dictation classification tool not returned. stop_reason=${response.stop_reason}`);
  }
  const cls = parseDictationClassification(block.input);

  // Merge classification onto the deterministic differences by id.
  const byId = new Map(cls.differences.map((d) => [d.id, d]));
  const differences: DictationDifference[] = diff.differences.map((d) => {
    const c = byId.get(d.id);
    const kind = c?.kind ?? "error";
    return {
      id: d.id,
      kind,
      category: c?.category ?? "difference",
      severity: kind === "error" ? (c?.severity === "high" ? "high" : "low") : null,
      got: d.got,
      expected: d.expected,
      note: c?.note ?? "",
    };
  });
  const acceptedIds = new Set(differences.filter((d) => d.kind === "accepted").map((d) => d.id));

  // Adjusted accuracy: re-run the diff with accepted "got" tokens replaced by
  // their expected form, so the ear is not penalized for what it cannot resolve.
  const adjustedTyped = applyAccepted(diff.segments, acceptedIds, userAnswer, exercise.referenceText);
  const adjustedCharAccuracy = adjustedTyped === null
    ? diff.rawCharAccuracy
    : diffDictation(exercise.referenceText, adjustedTyped).rawCharAccuracy;

  const segments: DictationDiffSegment[] = diff.segments.map((s) => {
    if (s.kind === "match") return { kind: "match", text: s.text };
    const cls2 = differences.find((d) => d.id === s.id)!;
    if (cls2.kind === "accepted") {
      return { kind: "accepted", id: s.id, got: s.got, expected: s.expected };
    }
    return { kind: "error", id: s.id, got: s.got, expected: s.expected, severity: cls2.severity === "high" ? "high" : "low" };
  });

  const errors: EvaluationError[] = differences
    .filter((d) => d.kind === "error")
    .map((d) => ({
      type: "spelling",
      severity: d.severity === "high" ? "major" : "minor",
      text: d.got,
      correction: d.expected,
      explanation: d.note,
    }));

  const criteria: DictationCriterion[] = [
    { id: "char", label: "Character accuracy", score: round2(adjustedCharAccuracy), cefr: cefrFor(adjustedCharAccuracy), note: "Character match after accepted equivalences." },
    { id: "word", label: "Word accuracy", score: round2(diff.wordAccuracy), cefr: cefrFor(diff.wordAccuracy), note: "Reference words transcribed correctly." },
    ...cls.criteria.filter((c) => c.id === "phon" || c.id === "bound"),
  ];

  return {
    kind: "dictation",
    score: adjustedCharAccuracy,
    grammarAccuracy: adjustedCharAccuracy,
    vocabularyRange: cls.listeningCefr,
    taskAchievement: diff.wordAccuracy,
    feedback: cls.summary,
    errors,
    estimatedCefrEvidence: cls.listeningCefr,
    rawCharAccuracy: diff.rawCharAccuracy,
    adjustedCharAccuracy,
    wordAccuracy: diff.wordAccuracy,
    listeningCefr: cls.listeningCefr,
    headline: cls.headline,
    summary: cls.summary,
    diff: segments,
    differences,
    criteria,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Rebuild the learner's transcription with each accepted difference's typed
 * token replaced by the reference token. Token-level (uses normToken-based
 * segments), which is sufficient for the adjusted-accuracy estimate. Returns
 * null if there are no accepted differences (caller falls back to raw).
 */
function applyAccepted(
  segments: ReadonlyArray<{ kind: "match"; text: string } | { kind: "diff"; id: number; got: string; expected: string }>,
  acceptedIds: Set<number>,
  _userAnswer: string,
  _referenceText: string,
): string | null {
  if (acceptedIds.size === 0) return null;
  const parts: string[] = [];
  for (const s of segments) {
    if (s.kind === "match") {
      parts.push(s.text);
    } else if (acceptedIds.has(s.id)) {
      if (s.expected) parts.push(s.expected); // accepted ⇒ count as the reference token
    } else {
      if (s.got) parts.push(s.got);
    }
  }
  return parts.join(" ");
}
```

> Note: `applyAccepted` reuses the diff's `segments` shape from `dictation-diff.ts` (`DiffSegment`). The import of that type is structural here (the param is typed inline) so no extra import is needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/ai test dictation-eval`
Expected: PASS (3 tests). The first assertion proves accepted b/v lifts adjusted accuracy to 1.0; the second proves genuine errors don't move it.

- [ ] **Step 5: Export from the package index**

In `packages/ai/src/index.ts`, after the `evaluate.js` export block, add:

```ts
export { diffDictation } from "./dictation-diff.js";
export type { DictationDiff } from "./dictation-diff.js";
export {
  DICTATION_EVAL_SYSTEM_PROMPT,
  DICTATION_EVAL_PROMPT_VERSION,
  buildDictationUserPrompt,
} from "./dictation-prompts.js";
export {
  gradeDictationAnswer,
  parseDictationClassification,
  DICTATION_TOOL,
  DICTATION_TOOL_NAME,
} from "./dictation-eval.js";
export type { GradeDictationInput } from "./dictation-eval.js";
```

- [ ] **Step 6: Build + typecheck the ai package**

Run: `pnpm build && pnpm --filter @language-drill/ai typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/ai/src/dictation-eval.ts packages/ai/src/dictation-eval.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): gradeDictationAnswer — diff + Claude forgiveness → DictationResult"
```

---

## Task 5: S3 presign helper (Lambda)

**Files:**
- Create: `infra/lambda/src/lib/audio-url.ts`
- Test: `infra/lambda/src/lib/audio-url.test.ts`

- [ ] **Step 1: Add the AWS SDK deps to the lambda package**

Run:

```bash
pnpm --filter @language-drill/lambda add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

(Use the resolved latest `^3` versions; both are actively maintained AWS-published packages.)

> If the lambda workspace package name differs, find it: `grep '"name"' infra/lambda/package.json`. Use that name in the `--filter`.

- [ ] **Step 2: Write the failing test**

Create `infra/lambda/src/lib/audio-url.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { presignAudioUrl } from './audio-url';

describe('presignAudioUrl', () => {
  const prev = process.env.CONTENT_BUCKET_NAME;
  beforeEach(() => { process.env.CONTENT_BUCKET_NAME = 'test-bucket'; });
  afterEach(() => { process.env.CONTENT_BUCKET_NAME = prev; });

  it('returns null for a null/empty key', async () => {
    expect(await presignAudioUrl(null)).toBeNull();
    expect(await presignAudioUrl('')).toBeNull();
  });

  it('returns a URL string for a key', async () => {
    const url = await presignAudioUrl('dictation/abc.mp3');
    expect(typeof url).toBe('string');
    expect(url).toContain('dictation/abc.mp3');
  });

  it('returns null when the bucket env is unset', async () => {
    delete process.env.CONTENT_BUCKET_NAME;
    expect(await presignAudioUrl('dictation/abc.mp3')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test audio-url`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the presign helper**

Create `infra/lambda/src/lib/audio-url.ts`:

```ts
/**
 * Presign a private-S3 audio object as a time-limited GET URL.
 *
 * Dictation clip audio lives in the private content bucket. The browser cannot
 * read it directly; the API injects a presigned URL into the exercise response.
 * Returns null when there is no key or the bucket env is unset (callers degrade
 * gracefully — a dictation exercise with no audioUrl shows a disabled player).
 */

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** TTL comfortably exceeds a drill session (10 min). */
const PRESIGN_TTL_SECONDS = 60 * 60;

let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) client = new S3Client({});
  return client;
}

export async function presignAudioUrl(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  const bucket = process.env.CONTENT_BUCKET_NAME;
  if (!bucket) return null;
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: PRESIGN_TTL_SECONDS,
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test audio-url`
Expected: PASS (3 tests). The presign call is offline (no network) — it signs against default/blank credentials, which is fine for producing the URL string.

> If the SDK throws on missing credentials in CI, set dummy creds in the test `beforeEach`: `process.env.AWS_ACCESS_KEY_ID = 'x'; process.env.AWS_SECRET_ACCESS_KEY = 'y'; process.env.AWS_REGION = 'eu-central-1';`.

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/lib/audio-url.ts infra/lambda/src/lib/audio-url.test.ts infra/lambda/package.json pnpm-lock.yaml
git commit -m "feat(lambda): presignAudioUrl helper for private S3 audio"
```

---

## Task 6: Inject `audioUrl` into exercise responses

**Files:**
- Create: `infra/lambda/src/lib/dictation-content.ts`
- Modify: `infra/lambda/src/routes/exercises.ts`, `infra/lambda/src/routes/sessions.ts`
- Test: `infra/lambda/src/lib/dictation-content.test.ts`

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/lib/dictation-content.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { withAudioUrl } from './dictation-content';

describe('withAudioUrl', () => {
  it('merges audioUrl into a dictation contentJson', () => {
    const out = withAudioUrl({ type: 'dictation', referenceText: 'x' }, 'https://signed');
    expect(out).toMatchObject({ type: 'dictation', referenceText: 'x', audioUrl: 'https://signed' });
  });

  it('returns content unchanged when url is null', () => {
    const content = { type: 'dictation', referenceText: 'x' };
    expect(withAudioUrl(content, null)).toBe(content);
  });

  it('passes through non-object content', () => {
    expect(withAudioUrl(null, 'https://x')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test dictation-content`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the merge helper**

Create `infra/lambda/src/lib/dictation-content.ts`:

```ts
/**
 * Merge a presigned audioUrl into a dictation exercise's contentJson at response
 * time. audioUrl is a derived (non-stored) field on DictationContent.
 */
export function withAudioUrl(contentJson: unknown, audioUrl: string | null): unknown {
  if (audioUrl === null) return contentJson;
  if (contentJson === null || typeof contentJson !== "object") return contentJson;
  return { ...(contentJson as Record<string, unknown>), audioUrl };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test dictation-content`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire it into the GET routes**

In `infra/lambda/src/routes/exercises.ts`, add imports near the top:

```ts
import { presignAudioUrl } from '../lib/audio-url';
import { withAudioUrl } from '../lib/dictation-content';
```

Replace the `GET /exercises` response (the `return c.json({...})` at the single-row block) with:

```ts
  const row = rows[0];
  const audioUrl = await presignAudioUrl(row.audioS3Key);
  return c.json({
    id: row.id,
    type: row.type,
    language: row.language,
    difficulty: row.difficulty,
    grammarPointKey: row.grammarPointKey,
    contentJson: withAudioUrl(row.contentJson, audioUrl),
  });
```

Make the same change in `GET /exercises/:id` (the second `return c.json({...})` block) — identical body using its `row`.

- [ ] **Step 6: Wire it into POST /sessions**

In `infra/lambda/src/routes/sessions.ts`, add the same two imports. Then make the exercises mapping async-aware. Replace the `return c.json({ id: inserted[0].id, exercises: rows.map(...) })` block with:

```ts
  const exercisesOut = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      type: r.type,
      language: r.language,
      difficulty: r.difficulty,
      grammarPointKey: r.grammarPointKey,
      contentJson: withAudioUrl(r.contentJson, await presignAudioUrl(r.audioS3Key)),
    })),
  );

  return c.json({ id: inserted[0].id, exercises: exercisesOut });
```

(`rows` here is `await db.select().from(exercisesTable)...` which already selects all columns, so `r.audioS3Key` is present.)

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @language-drill/lambda typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add infra/lambda/src/lib/dictation-content.ts infra/lambda/src/lib/dictation-content.test.ts infra/lambda/src/routes/exercises.ts infra/lambda/src/routes/sessions.ts
git commit -m "feat(lambda): inject presigned audioUrl into exercise + session responses"
```

---

## Task 7: Submit branch for dictation + progress axis

**Files:**
- Modify: `infra/lambda/src/routes/exercises.ts`
- Modify: `infra/lambda/src/lib/progress-aggregation.ts`
- Test: `infra/lambda/src/lib/progress-aggregation.test.ts`

- [ ] **Step 1: Write the failing progress-axis test**

In `infra/lambda/src/lib/progress-aggregation.test.ts`, add (near the other `axisForExerciseType` cases):

```ts
import { ExerciseType } from '@language-drill/shared';
// ...
it('maps DICTATION to the listening axis', () => {
  expect(axisForExerciseType(ExerciseType.DICTATION)).toBe('listening');
  expect(axisForExerciseType('dictation')).toBe('listening');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test progress-aggregation`
Expected: FAIL — returns `null` for `'dictation'` (string doesn't match the `'listening'` literal case).

- [ ] **Step 3: Add the axis case**

In `infra/lambda/src/lib/progress-aggregation.ts`, inside `axisForExerciseType`, add a case after `ExerciseType.VOCAB_RECALL`:

```ts
    case ExerciseType.DICTATION:
      return 'listening';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test progress-aggregation`
Expected: PASS.

- [ ] **Step 5: Add the submit branch**

In `infra/lambda/src/routes/exercises.ts`, extend the AI import to include the dictation grader:

```ts
import {
  createObservedClaudeClient,
  evaluateAnswer,
  gradeDictationAnswer,
  EVALUATION_SYSTEM_PROMPT_VERSION,
  DICTATION_EVAL_PROMPT_VERSION,
  EVAL_REQUEST_TIMEOUT_MS,
  EVAL_MAX_RETRIES,
  withLlmTrace,
} from '@language-drill/ai';
import { ExerciseType } from '@language-drill/shared';
import type { DictationContent, ExerciseContent } from '@language-drill/shared';
```

(`ExerciseType` is already imported at the top of the file alongside `Language, CefrLevel` — extend that import rather than duplicating.)

Inside the `try` block, replace the single `const result = await withLlmTrace(...)` call with a branch on exercise type. The dictation branch swaps the feature/promptVersion and the inner call; everything else (history insert, usage insert, return) is unchanged because `DictationResult` carries `score` and is JSON-serializable:

```ts
    const client = createObservedClaudeClient(ANTHROPIC_API_KEY, {
      timeout: EVAL_REQUEST_TIMEOUT_MS,
      maxRetries: EVAL_MAX_RETRIES,
    });

    const isDictation = exercise.type === ExerciseType.DICTATION;

    const result = await withLlmTrace(
      {
        feature: 'evaluate',
        env: (process.env.LANGFUSE_ENV ?? 'dev') as 'prod' | 'dev',
        promptVersion: isDictation
          ? DICTATION_EVAL_PROMPT_VERSION
          : EVALUATION_SYSTEM_PROMPT_VERSION,
        requestId,
        userId,
        submissionId,
        exerciseId: id,
        language: exercise.language as Language,
        cefrLevel: exercise.difficulty as CefrLevel,
        exerciseType: exercise.type as ExerciseType,
      },
      () =>
        isDictation
          ? gradeDictationAnswer(client, {
              exercise: exercise.contentJson as DictationContent,
              userAnswer,
              language: exercise.language as Language,
              difficulty: exercise.difficulty as CefrLevel,
            })
          : evaluateAnswer(client, {
              exercise: exercise.contentJson as ExerciseContent,
              userAnswer,
              language: exercise.language as Language,
              difficulty: exercise.difficulty as CefrLevel,
              grammarGuidance,
            }),
    );
```

The existing `await db.insert(userExerciseHistory).values({ ... score: result.score, responseJson: { userAnswer, evaluation: result } ... })`, the `usageEvents` insert (`eventType: 'ai_evaluation'` — reused bucket per the design), and `return c.json(result)` all stay as-is. `result.score` and the stored `evaluation` work for both arms.

- [ ] **Step 6: Add a submit-branch route test**

In `infra/lambda/src/routes/exercises.test.ts`, follow the existing submit-test pattern (mock the Claude client / `gradeDictationAnswer` boundary the same way the file already mocks `evaluateAnswer`). Add a test asserting that submitting an answer to a seeded dictation exercise returns a body with `kind: 'dictation'` and a numeric `score`, and that a `user_exercise_history` row is written with that score.

> Mirror the existing mocking strategy in this test file exactly (it already stubs `@language-drill/ai`). If it mocks `evaluateAnswer`, add a `gradeDictationAnswer` mock returning a minimal `DictationResult` (`{ kind: 'dictation', score: 0.9, grammarAccuracy: 0.9, vocabularyRange: 'B2', taskAchievement: 0.9, feedback: 's', errors: [], estimatedCefrEvidence: 'B2', rawCharAccuracy: 0.9, adjustedCharAccuracy: 0.9, wordAccuracy: 0.9, listeningCefr: 'B2', headline: 'h', summary: 's', diff: [], differences: [], criteria: [] }`) and a dictation exercise fixture row.

- [ ] **Step 7: Run the route tests**

Run: `pnpm --filter @language-drill/lambda test exercises`
Expected: PASS (existing + new dictation submit test).

- [ ] **Step 8: Commit**

```bash
git add infra/lambda/src/routes/exercises.ts infra/lambda/src/routes/exercises.test.ts infra/lambda/src/lib/progress-aggregation.ts infra/lambda/src/lib/progress-aggregation.test.ts
git commit -m "feat(lambda): dictation submit branch + listening progress axis"
```

---

## Task 8: CDK — pass `CONTENT_BUCKET_NAME` to the API Lambda

**Files:**
- Modify: `infra/lib/stack.ts`

The bucket is already granted read to the handler (`storage.bucket.grantRead(lambda.handler)`). The handler just needs the bucket *name* as an env var. The construct is currently created before `storage`, so reorder.

- [ ] **Step 1: Reorder + add the env var**

In `infra/lib/stack.ts`, move the `const storage = new StorageConstruct(this, "Storage");` line to **above** the `const lambda = new LambdaConstruct(...)` line, then add the env entry. Result:

```ts
    const storage = new StorageConstruct(this, "Storage");

    const lambda = new LambdaConstruct(this, "Lambda", {
      secretsPrefix: props.secretsPrefix,
      additionalEnv: {
        ALLOWED_ORIGINS: props.allowedOrigins.join(","),
        ENV_NAME: props.envName,
        ADMIN_USER_IDS: props.adminUserIds ?? "",
        AI_KILL_SWITCH: props.aiKillSwitch ?? "",
        AI_GLOBAL_DAILY_CAP: props.aiGlobalDailyCap ?? "",
        CONTENT_BUCKET_NAME: storage.bucket.bucketName,
      },
    });
```

Then delete the now-duplicate `const storage = new StorageConstruct(this, "Storage");` from its old location, and keep the existing `storage.bucket.grantRead(lambda.handler);` line where it is (it still resolves — `lambda` is defined by then).

- [ ] **Step 2: Typecheck + synth**

Run: `pnpm --filter @language-drill/infra typecheck && pnpm --filter @language-drill/infra test`
Expected: clean. (Find the infra package name with `grep '"name"' infra/package.json` if the filter differs.)

> If a CDK snapshot test asserts the Lambda's environment, update the snapshot: `pnpm --filter @language-drill/infra test -u`.

- [ ] **Step 3: Commit**

```bash
git add infra/lib/stack.ts
git commit -m "feat(infra): pass CONTENT_BUCKET_NAME to the API Lambda"
```

---

## Task 9: Seed script — dictation clips + Polly audio

**Files:**
- Create: `packages/db/scripts/seed-dictation.ts`
- Test: `packages/db/scripts/seed-dictation.test.ts`
- Modify: `packages/db/package.json`, root `package.json`

- [ ] **Step 1: Add the AWS SDK deps to the db package**

```bash
pnpm --filter @language-drill/db add @aws-sdk/client-polly @aws-sdk/client-s3
```

- [ ] **Step 2: Write the failing planning test**

The script's pure parts (clip → content shape, audio key derivation) are tested; Polly/S3/DB I/O are not. Create `packages/db/scripts/seed-dictation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DICTATION_CLIPS, toDictationContent, audioKeyFor } from './seed-dictation';

describe('dictation seed data', () => {
  it('has at least 6 clips, all ES, mostly B2', () => {
    expect(DICTATION_CLIPS.length).toBeGreaterThanOrEqual(6);
    expect(DICTATION_CLIPS.every((c) => c.language === 'ES')).toBe(true);
    expect(DICTATION_CLIPS.some((c) => c.difficulty === 'B2')).toBe(true);
    expect(DICTATION_CLIPS.some((c) => c.difficulty === 'B1')).toBe(true);
  });

  it('every clip key is unique', () => {
    const keys = DICTATION_CLIPS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('toDictationContent builds a valid DictationContent', () => {
    const c = toDictationContent(DICTATION_CLIPS[0]);
    expect(c.type).toBe('dictation');
    expect(c.referenceText.length).toBeGreaterThan(0);
    expect(c.sentences.length).toBeGreaterThan(0);
    expect(c.waveform.length).toBeGreaterThan(0);
    expect(c.referenceText).toBe(c.sentences.join(' '));
  });

  it('audioKeyFor is deterministic and namespaced', () => {
    expect(audioKeyFor('abc-id')).toBe('dictation/abc-id.mp3');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db test seed-dictation`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the seed script**

Create `packages/db/scripts/seed-dictation.ts`. Author 6 ES clips (the worked example from the design plus five more; 4–5 at B2, 1–2 at B1). Each `referenceText` MUST equal `sentences.join(' ')`. Waveforms are short hand-authored decorative envelopes (8–16 bars is fine).

```ts
/**
 * Seed dictation exercises: insert the clip rows (idempotent, deterministic
 * UUIDs) and synthesize each clip's audio once via AWS Polly → private S3,
 * storing the S3 key on exercises.audio_s3_key.
 *
 * Usage:
 *   DATABASE_URL=... CONTENT_BUCKET_NAME=... AWS_REGION=eu-central-1 \
 *     npx tsx packages/db/scripts/seed-dictation.ts
 *
 * Requires AWS creds with polly:SynthesizeSpeech and s3:PutObject/HeadObject.
 * Re-runnable: existing rows are skipped (ON CONFLICT DO NOTHING) and existing
 * audio objects are not re-synthesized (HeadObject check).
 */

import { fileURLToPath } from 'node:url';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  PollyClient,
  SynthesizeSpeechCommand,
  type SynthesizeSpeechCommandInput,
} from '@aws-sdk/client-polly';
import { eq } from 'drizzle-orm';

import { createDb, type Db } from '../src/client';
import { deterministicUuid } from '../src/lib/deterministic-uuid';
import { exercises } from '../src/schema/index';

export type DictationClip = {
  key: string;
  language: 'ES';
  difficulty: 'B1' | 'B2';
  voiceId: string; // Polly neural voice
  title: string;
  blurb: string;
  accent: string;
  domain: string;
  register: string;
  tested: string[];
  sentences: string[];
  durationSec: number;
  waveform: number[];
};

const WAVE = [0.22, 0.5, 0.82, 0.44, 0.62, 0.9, 0.5, 0.28, 0.7, 0.4, 0.84, 0.36];

export const DICTATION_CLIPS: DictationClip[] = [
  {
    key: 'es-dictation-b2-1',
    language: 'ES',
    difficulty: 'B2',
    voiceId: 'Sergio',
    title: 'El tiempo lo cura todo',
    blurb: 'Alguien recuerda un consejo de su abuela y lo matiza desde la edad adulta.',
    accent: 'español peninsular · centro',
    domain: 'narrativa personal · reflexión',
    register: 'neutro',
    tested: ['Discriminación de fonemas en habla ligada', 'Límites de palabra (sinalefa)', 'Ortografía: h muda, tildes'],
    sentences: [
      'Cuando era niño, mi abuela siempre me decía que el tiempo lo cura todo.',
      'Ahora que soy mayor, me he dado cuenta de que no es del todo cierto.',
      'Hay heridas que no se curan; simplemente aprendemos a vivir con ellas.',
      'Aun así, sigo creyendo que vale la pena seguir adelante.',
    ],
    durationSec: 23,
    waveform: WAVE,
  },
  // Author FIVE more ES clips below following the same shape. Suggested set:
  //   es-dictation-b2-2  (B2, Lucia)  — a short workplace anecdote (connected speech, b/v, tildes)
  //   es-dictation-b2-3  (B2, Sergio) — a travel reflection (sinalefa, silent h)
  //   es-dictation-b2-4  (B2, Lucia)  — an opinion on technology (subordinate clauses)
  //   es-dictation-b1-1  (B1, Sergio) — daily-routine narration (simpler, slower)
  //   es-dictation-b1-2  (B1, Lucia)  — describing a city (concrete nouns)
  // Each: 3–4 sentences, natural connected speech, vocabulary at or below level,
  // referenceText === sentences.join(' '). Keep waveform = WAVE (decorative).
];

export function toDictationContent(clip: DictationClip) {
  return {
    type: 'dictation' as const,
    title: clip.title,
    blurb: clip.blurb,
    referenceText: clip.sentences.join(' '),
    sentences: clip.sentences,
    accent: clip.accent,
    voiceId: clip.voiceId,
    domain: clip.domain,
    register: clip.register,
    tested: clip.tested,
    durationSec: clip.durationSec,
    waveform: clip.waveform,
  };
}

export function audioKeyFor(exerciseId: string): string {
  return `dictation/${exerciseId}.mp3`;
}

async function objectExists(s3: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function synthesizeToS3(
  polly: PollyClient,
  s3: S3Client,
  bucket: string,
  key: string,
  text: string,
  voiceId: string,
): Promise<void> {
  const input: SynthesizeSpeechCommandInput = {
    Engine: 'neural',
    OutputFormat: 'mp3',
    Text: text,
    VoiceId: voiceId as SynthesizeSpeechCommandInput['VoiceId'],
    LanguageCode: 'es-ES',
  };
  const out = await polly.send(new SynthesizeSpeechCommand(input));
  const bytes = await out.AudioStream!.transformToByteArray();
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: 'audio/mpeg' }),
  );
}

async function seedClip(db: Db, polly: PollyClient, s3: S3Client, bucket: string, clip: DictationClip) {
  const id = deterministicUuid(clip.key);
  const key = audioKeyFor(id);
  const content = toDictationContent(clip);

  if (!(await objectExists(s3, bucket, key))) {
    await synthesizeToS3(polly, s3, bucket, key, content.referenceText, clip.voiceId);
  }

  const inserted = await db
    .insert(exercises)
    .values({
      id,
      type: 'dictation',
      language: clip.language,
      difficulty: clip.difficulty,
      contentJson: content,
      audioS3Key: key,
    })
    .onConflictDoNothing()
    .returning({ id: exercises.id });

  // Backfill audioS3Key on a pre-existing row that lacks it (idempotent).
  if (inserted.length === 0) {
    await db.update(exercises).set({ audioS3Key: key }).where(eq(exercises.id, id));
  }
  return inserted.length > 0;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const bucket = process.env.CONTENT_BUCKET_NAME;
  if (!databaseUrl) { console.error('DATABASE_URL is not set'); process.exit(1); }
  if (!bucket) { console.error('CONTENT_BUCKET_NAME is not set'); process.exit(1); }

  const db = createDb(databaseUrl);
  const polly = new PollyClient({});
  const s3 = new S3Client({});

  let inserted = 0;
  for (const clip of DICTATION_CLIPS) {
    const isNew = await seedClip(db, polly, s3, bucket, clip);
    if (isNew) inserted++;
    console.log(`  ${clip.key}: ${isNew ? 'inserted' : 'already present'}`);
  }
  console.log(`\nDone. ${inserted} dictation exercise(s) created, ${DICTATION_CLIPS.length - inserted} skipped.`);
}

const isDirectRun = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => { console.error('Dictation seed failed:', err); process.exit(1); });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @language-drill/db test seed-dictation`
Expected: PASS (4 tests). If the "≥6 clips" test fails, you have not yet authored the five additional clips — add them.

- [ ] **Step 6: Add the package scripts**

In `packages/db/package.json` `scripts`, add (next to `seed:exercises`):

```json
    "seed:dictation": "npx tsx scripts/seed-dictation.ts",
```

In the **root** `package.json` `scripts`, add a passthrough next to the existing `db:seed:exercises` (find its exact form with `grep db:seed package.json`; mirror it, e.g.):

```json
    "db:seed:dictation": "pnpm --filter @language-drill/db seed:dictation",
```

- [ ] **Step 7: Commit**

```bash
git add packages/db/scripts/seed-dictation.ts packages/db/scripts/seed-dictation.test.ts packages/db/package.json package.json pnpm-lock.yaml
git commit -m "feat(db): seed-dictation script (clips + Polly audio synthesis)"
```

---

## Task 10: api-client — DictationResult schema + union parse

**Files:**
- Modify: `packages/api-client/src/schemas/exercise.ts`
- Modify: `packages/api-client/src/hooks/useExercise.ts`
- Test: `packages/api-client/src/schemas/exercise.test.ts`

- [ ] **Step 1: Write the failing schema test**

In `packages/api-client/src/schemas/exercise.test.ts`, add:

```ts
import { DictationResultSchema, parseSubmitResult } from './exercise';

describe('DictationResultSchema', () => {
  const dict = {
    kind: 'dictation',
    score: 0.97, grammarAccuracy: 0.97, vocabularyRange: 'B2', taskAchievement: 0.95,
    feedback: 's', errors: [], estimatedCefrEvidence: 'B2',
    rawCharAccuracy: 0.94, adjustedCharAccuracy: 0.97, wordAccuracy: 0.95,
    listeningCefr: 'B2', headline: 'h', summary: 's',
    diff: [{ kind: 'match', text: 'hola' }],
    differences: [], criteria: [{ id: 'char', label: 'Character accuracy', score: 0.97, cefr: 'C1', note: 'n' }],
  };

  it('parses a dictation result', () => {
    expect(DictationResultSchema.parse(dict).kind).toBe('dictation');
  });

  it('parseSubmitResult routes on kind', () => {
    expect(parseSubmitResult(dict).kind).toBe('dictation');
    const evalResult = {
      score: 0.8, grammarAccuracy: 0.8, vocabularyRange: 'B1', taskAchievement: 0.8,
      feedback: 'f', errors: [], estimatedCefrEvidence: 'B1',
    };
    expect('kind' in parseSubmitResult(evalResult)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/api-client test exercise`
Expected: FAIL — `DictationResultSchema` / `parseSubmitResult` not exported.

- [ ] **Step 3: Add the schemas + router**

In `packages/api-client/src/schemas/exercise.ts`, after `EvaluationResultSchema`/`EvaluationResultResponse`, add:

```ts
const DictationDiffSegmentSchema = z.union([
  z.object({ kind: z.literal('match'), text: z.string() }),
  z.object({ kind: z.literal('error'), id: z.number(), got: z.string(), expected: z.string(), severity: z.enum(['low', 'high']) }),
  z.object({ kind: z.literal('accepted'), id: z.number(), got: z.string(), expected: z.string() }),
]);

const DictationDifferenceSchema = z.object({
  id: z.number(),
  kind: z.enum(['error', 'accepted']),
  category: z.string(),
  severity: z.enum(['low', 'high']).nullable(),
  got: z.string(),
  expected: z.string(),
  note: z.string(),
});

const DictationCriterionSchema = z.object({
  id: z.string(),
  label: z.string(),
  score: z.number(),
  cefr: z.string(),
  note: z.string(),
});

export const DictationResultSchema = z.object({
  kind: z.literal('dictation'),
  score: z.number().min(0).max(1),
  grammarAccuracy: z.number().min(0).max(1),
  vocabularyRange: z.string(),
  taskAchievement: z.number().min(0).max(1),
  feedback: z.string(),
  errors: z.array(EvaluationErrorSchema),
  estimatedCefrEvidence: z.string(),
  rawCharAccuracy: z.number().min(0).max(1),
  adjustedCharAccuracy: z.number().min(0).max(1),
  wordAccuracy: z.number().min(0).max(1),
  listeningCefr: z.string(),
  headline: z.string(),
  summary: z.string(),
  diff: z.array(DictationDiffSegmentSchema),
  differences: z.array(DictationDifferenceSchema),
  criteria: z.array(DictationCriterionSchema),
});

export type DictationResultResponse = z.infer<typeof DictationResultSchema>;

export type SubmitResultResponse = EvaluationResultResponse | DictationResultResponse;

/** Routes a raw submit response to the right schema by its `kind` discriminator. */
export function parseSubmitResult(json: unknown): SubmitResultResponse {
  if (json !== null && typeof json === 'object' && (json as { kind?: unknown }).kind === 'dictation') {
    return DictationResultSchema.parse(json);
  }
  return EvaluationResultSchema.parse(json);
}
```

(`EvaluationErrorSchema` already exists in this file.)

- [ ] **Step 4: Use the router in the submit hook**

In `packages/api-client/src/hooks/useExercise.ts`:
- Change the import from `../schemas/exercise` to add `parseSubmitResult` and `type SubmitResultResponse`.
- Change the mutation generic and parse:

```ts
  return useMutation<SubmitResultResponse, Error, SubmitAnswerParams>({
    mutationFn: async ({ exerciseId, answer, sessionId }) => {
      const body: { answer: string; sessionId?: string } = { answer };
      if (sessionId !== undefined) body.sessionId = sessionId;
      const response = await fetchFn(`/exercises/${exerciseId}/submit`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const json: unknown = await response.json();
      return parseSubmitResult(json);
    },
```

- [ ] **Step 5: Re-export from the package index if needed**

If `packages/api-client/src/index.ts` re-exports `EvaluationResultResponse`, add `DictationResultResponse`, `SubmitResultResponse`, `DictationResultSchema`, and `parseSubmitResult` alongside it (grep the index for `EvaluationResultResponse` to match the existing export style).

- [ ] **Step 6: Run tests + build**

Run: `pnpm --filter @language-drill/api-client test exercise && pnpm build && pnpm --filter @language-drill/api-client typecheck`
Expected: PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add packages/api-client/src/schemas/exercise.ts packages/api-client/src/schemas/exercise.test.ts packages/api-client/src/hooks/useExercise.ts packages/api-client/src/index.ts
git commit -m "feat(api-client): DictationResult schema + kind-routed submit parse"
```

---

## Task 11: Widen drill result type; verdict + coach

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/_components/types.ts`
- Modify: `apps/web/app/(dashboard)/drill/_components/session-reducer.ts`
- Modify: `apps/web/lib/drill/verdict-tier.ts`
- Modify: `apps/web/lib/drill/coach-messages.ts`
- Test: `apps/web/lib/drill/__tests__/verdict-tier.test.ts` (add) and `coach-messages` test if present

- [ ] **Step 1: Write the failing verdict + coach tests**

Find the existing verdict/coach tests (`grep -rl "clozeVerdict\|coachMessage" apps/web`) and add cases in the matching test files. If a verdict-tier test file exists, add:

```ts
import { dictationVerdict } from '../verdict-tier';

describe('dictationVerdict', () => {
  it('high adjusted accuracy → sage', () => {
    expect(dictationVerdict(0.98).tier).toBe('sage');
  });
  it('mid → yellow', () => {
    expect(dictationVerdict(0.8).tier).toBe('yellow');
  });
  it('low → terracotta', () => {
    expect(dictationVerdict(0.3).tier).toBe('terracotta');
  });
});
```

For coach, add a case asserting `coachMessage({ kind: 'idle', type: ExerciseType.DICTATION })` returns a non-empty string and `coachMessage({ kind: 'evaluated', type: ExerciseType.DICTATION, score: 0.98 })` returns a non-empty string.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/web test verdict-tier coach-messages`
Expected: FAIL — `dictationVerdict` missing; coach `idleMessage`/`evaluatedMessage` throw on the new enum (exhaustive switch).

- [ ] **Step 3: Add `dictationVerdict`**

In `apps/web/lib/drill/verdict-tier.ts`, add:

```ts
export function dictationVerdict(score: number): VerdictResult {
  if (score >= 0.95) {
    return { tier: 'sage', label: 'oído fino' };
  } else if (score >= CORRECT_THRESHOLD) {
    return { tier: 'yellow', label: 'close · a few you missed' };
  } else if (score >= 0.4) {
    return { tier: 'yellow', label: 'the gist · boundaries slipped' };
  } else {
    return { tier: 'terracotta', label: 'hard clip · let’s slow down' };
  }
}
```

- [ ] **Step 4: Add the coach cases**

In `apps/web/lib/drill/coach-messages.ts`, add to `idleMessage`'s switch:

```ts
    case ExerciseType.DICTATION:
      return "listen · type exactly what you hear";
```

And to `evaluatedMessage`'s switch, a new `case ExerciseType.DICTATION:` block mirroring the others:

```ts
    case ExerciseType.DICTATION:
      switch (tier) {
        case "praise":
          return "clean ear · you caught the linking";
        case "light":
          return "almost · a word boundary blurred";
        case "encourage":
          return "the shape's there · the fast parts ran together";
        case "reset":
          return "tough clip · we'll slow it down next time";
      }
      break;
```

- [ ] **Step 5: Widen the drill result types**

In `apps/web/app/(dashboard)/drill/_components/types.ts`:

```ts
import type { EvaluationResult, DictationResult } from '@language-drill/shared';

export type SubmissionResult = EvaluationResult | DictationResult;

export type SubmissionState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'evaluated'; result: SubmissionResult; meta: SubmissionMeta }
  | { kind: 'error'; error: Error };
```

In `apps/web/app/(dashboard)/drill/_components/session-reducer.ts`, change the `ITEM_EVALUATED` action's `result` type from `EvaluationResult` to `EvaluationResult | DictationResult` (update the import to include `DictationResult`).

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm build && pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web test verdict-tier coach-messages`
Expected: PASS / clean. The page's `coachMessage({ ..., score: result.score })` keeps compiling — both result arms expose `score`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/\(dashboard\)/drill/_components/types.ts apps/web/app/\(dashboard\)/drill/_components/session-reducer.ts apps/web/lib/drill/verdict-tier.ts apps/web/lib/drill/coach-messages.ts apps/web/lib/drill/__tests__
git commit -m "feat(web): widen drill result to DictationResult; dictation verdict + coach"
```

---

## Task 12: AudioPlayer component

**Files:**
- Create: `apps/web/app/(dashboard)/drill/_components/audio-player.tsx`
- Test: `apps/web/app/(dashboard)/drill/_components/__tests__/audio-player.test.tsx`

Whole-clip player: play/pause, replay-from-start, 0.75× slow toggle (`audio.playbackRate`), decorative waveform bars with a real playhead driven by `timeupdate`. Uses the app's existing tokens/`Button`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/(dashboard)/drill/_components/__tests__/audio-player.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AudioPlayer } from '../audio-player';

beforeEach(() => {
  // jsdom doesn't implement media playback.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

describe('AudioPlayer', () => {
  it('renders a disabled state when no src', () => {
    render(<AudioPlayer src={undefined} waveform={[0.5, 0.8]} durationSec={5} />);
    expect(screen.getByRole('button', { name: /play/i })).toBeDisabled();
  });

  it('toggles play/pause', () => {
    render(<AudioPlayer src="blob:x" waveform={[0.5, 0.8]} durationSec={5} />);
    const btn = screen.getByRole('button', { name: /play/i });
    fireEvent.click(btn);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('toggles 0.75x slow', () => {
    render(<AudioPlayer src="blob:x" waveform={[0.5]} durationSec={5} />);
    const slow = screen.getByRole('button', { name: /0\.75/ });
    fireEvent.click(slow);
    expect(slow).toHaveAttribute('aria-pressed', 'true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test audio-player`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `apps/web/app/(dashboard)/drill/_components/audio-player.tsx`:

```tsx
'use client';

import * as React from 'react';
import { Button } from '../../../../components/ui';

export interface AudioPlayerProps {
  src: string | undefined;
  waveform: number[];
  durationSec: number;
}

export function AudioPlayer({ src, waveform, durationSec }: AudioPlayerProps) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [slow, setSlow] = React.useState(false);
  const [progress, setProgress] = React.useState(0); // 0..1

  const disabled = !src;

  React.useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.playbackRate = slow ? 0.75 : 1;
  }, [slow]);

  function togglePlay() {
    const a = audioRef.current;
    if (!a || disabled) return;
    if (playing) {
      a.pause();
    } else {
      void a.play();
    }
  }

  function replay() {
    const a = audioRef.current;
    if (!a || disabled) return;
    a.currentTime = 0;
    setProgress(0);
    void a.play();
  }

  function onTimeUpdate() {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    setProgress(a.currentTime / a.duration);
  }

  const total = formatTime(durationSec);
  const elapsed = formatTime(progress * durationSec);

  return (
    <div className="rounded-md border border-rule bg-paper-2 p-s-4">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={onTimeUpdate}
      />
      <div className="flex items-center gap-s-4">
        <button
          type="button"
          aria-label={playing ? 'pause' : 'play'}
          onClick={togglePlay}
          disabled={disabled}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-ink text-paper disabled:opacity-40"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="flex flex-1 items-end gap-[2px]" aria-hidden>
          {waveform.map((h, i) => {
            const played = (i + 0.5) / waveform.length <= progress;
            return (
              <span
                key={i}
                className={played ? 'bg-[var(--color-accent)]' : 'bg-paper-3'}
                style={{ flex: 1, minWidth: 2, height: `${Math.max(10, h * 100)}%`, borderRadius: 999 }}
              />
            );
          })}
        </div>
        <span className="t-mono t-micro text-ink-mute">{elapsed} / {total}</span>
      </div>
      <div className="mt-s-3 flex items-center gap-s-2">
        <Button variant="ghost" onClick={replay} disabled={disabled}>replay</Button>
        <button
          type="button"
          aria-pressed={slow}
          onClick={() => setSlow((s) => !s)}
          disabled={disabled}
          className={`t-small rounded-full border px-s-3 py-s-1 ${slow ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-soft'}`}
        >
          0.75× slow
        </button>
      </div>
    </div>
  );
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
```

> Match the real token/util names if they differ: confirm `Button`'s `variant="ghost"` exists (`grep -n "variant" apps/web/components/ui/*`); if not, use an existing variant. Tailwind token classes (`bg-paper-2`, `border-rule`, `text-ink-mute`, `t-mono`, `t-micro`, `t-small`, `gap-s-*`) follow the same names used across the existing exercise components — copy a class string from `cloze-exercise.tsx`/`feedback-shell.tsx` if a name doesn't resolve.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test audio-player`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(dashboard\)/drill/_components/audio-player.tsx apps/web/app/\(dashboard\)/drill/_components/__tests__/audio-player.test.tsx
git commit -m "feat(web): AudioPlayer (play/pause, replay, 0.75x, waveform playhead)"
```

---

## Task 13: DictationExercise component + dispatch

**Files:**
- Create: `apps/web/app/(dashboard)/drill/_components/dictation-exercise.tsx`
- Modify: `apps/web/app/(dashboard)/drill/_components/exercise-pane.tsx`
- Test: `apps/web/app/(dashboard)/drill/_components/__tests__/dictation-exercise.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/(dashboard)/drill/_components/__tests__/dictation-exercise.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExerciseType, type DictationContent, type DictationResult } from '@language-drill/shared';
import { DictationExercise } from '../dictation-exercise';
import { DrillActionProvider } from '../drill-action-context';

const content: DictationContent = {
  type: ExerciseType.DICTATION,
  title: 'El tiempo lo cura todo',
  referenceText: 'el tiempo lo cura todo',
  sentences: ['el tiempo lo cura todo'],
  accent: 'español peninsular',
  voiceId: 'Sergio',
  tested: ['sinalefa'],
  durationSec: 6,
  waveform: [0.5, 0.8],
  audioUrl: 'blob:x',
};

const result: DictationResult = {
  kind: 'dictation', score: 0.97, grammarAccuracy: 0.97, vocabularyRange: 'B2', taskAchievement: 0.95,
  feedback: 'good', errors: [], estimatedCefrEvidence: 'B2',
  rawCharAccuracy: 0.94, adjustedCharAccuracy: 0.97, wordAccuracy: 0.95, listeningCefr: 'B2',
  headline: 'oído fino', summary: 'good',
  diff: [{ kind: 'match', text: 'el tiempo' }, { kind: 'error', id: 1, got: 'locura', expected: 'lo cura', severity: 'high' }, { kind: 'match', text: 'todo' }],
  differences: [{ id: 1, kind: 'error', category: 'word boundary', severity: 'high', got: 'locura', expected: 'lo cura', note: 'la sinalefa borró el límite' }],
  criteria: [{ id: 'char', label: 'Character accuracy', score: 0.97, cefr: 'C1', note: 'n' }],
};

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

function renderEx(submission: Parameters<typeof DictationExercise>[0]['submission']) {
  const onSubmit = vi.fn();
  render(
    <DrillActionProvider active={false}>
      <DictationExercise
        content={content}
        language={'ES' as never}
        submission={submission}
        onSubmit={onSubmit}
        onNext={() => {}}
      />
    </DrillActionProvider>,
  );
  return { onSubmit };
}

describe('DictationExercise', () => {
  it('shows the brief + player and submits the typed transcription', () => {
    const { onSubmit } = renderEx({ kind: 'idle' });
    expect(screen.getByText('El tiempo lo cura todo')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'el tiempo locura todo' } });
    fireEvent.click(screen.getByRole('button', { name: /check|submit/i }));
    expect(onSubmit).toHaveBeenCalledWith('el tiempo locura todo', expect.anything());
  });

  it('renders the diff + a flagged difference note when evaluated', () => {
    renderEx({ kind: 'evaluated', result, meta: {} });
    expect(screen.getByText(/oído fino/)).toBeInTheDocument();
    expect(screen.getByText(/word boundary/i)).toBeInTheDocument();
    expect(screen.getByText(/la sinalefa borró el límite/)).toBeInTheDocument();
  });
});
```

> Confirm the `DrillActionProvider` import path/props by checking `drill-action-context.tsx` (`grep -n "export" apps/web/app/\(dashboard\)/drill/_components/drill-action-context.tsx`). Match how the existing `cloze-exercise.test.tsx` wraps with the provider — copy that wrapper verbatim if it differs.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test dictation-exercise`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `apps/web/app/(dashboard)/drill/_components/dictation-exercise.tsx`. It mirrors `cloze-exercise.tsx`'s structure (action-bar publishing, locked state, FeedbackShell) but renders the player + a dictation results body. Use `isDictationResult` to narrow before reading dictation fields.

```tsx
'use client';

import * as React from 'react';
import {
  isDictationResult,
  type DictationContent,
  type DictationResult,
  type LearningLanguage,
} from '@language-drill/shared';
import { AccentPicker, Button, Card, Chip } from '../../../../components/ui';
import { dictationVerdict } from '../../../../lib/drill/verdict-tier';
import { AudioPlayer } from './audio-player';
import { useDrillAction } from './drill-action-context';
import { FeedbackShell } from './feedback-shell';
import type { SubmissionMeta, SubmissionState } from './types';

export interface DictationExerciseProps {
  content: DictationContent;
  language: LearningLanguage;
  submission: SubmissionState;
  onSubmit: (answer: string, meta: SubmissionMeta) => void;
  onNext: () => void;
  nextLabel?: string;
}

function isAccentLanguage(lang: string): lang is 'ES' | 'DE' | 'TR' {
  return lang === 'ES' || lang === 'DE' || lang === 'TR';
}

export function DictationExercise({
  content,
  language,
  submission,
  onSubmit,
  onNext,
  nextLabel,
}: DictationExerciseProps) {
  const [answer, setAnswer] = React.useState('');
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const isLocked = submission.kind !== 'idle';
  const canSubmit = answer.trim().length > 0;

  function handleSubmit() {
    if (!answer.trim()) return;
    onSubmit(answer, {});
  }

  const { active, setPrimaryAction } = useDrillAction();
  React.useEffect(() => {
    if (!active || submission.kind === 'evaluated') return;
    setPrimaryAction({
      label: 'check',
      onClick: handleSubmit,
      disabled: !canSubmit || isLocked,
      loading: submission.kind === 'submitting',
    });
  }, [active, setPrimaryAction, submission.kind, canSubmit, isLocked, answer]);

  return (
    <div className="flex flex-col gap-s-4">
      {/* brief */}
      <div className="flex flex-col gap-s-2">
        <h2 className="t-display-s">{content.title}</h2>
        {content.blurb && <p className="t-small text-ink-mute">{content.blurb}</p>}
        <div className="flex flex-wrap items-center gap-s-2">
          <Chip className="t-micro">{content.accent}</Chip>
          {content.tested.map((t) => (
            <Chip key={t} className="t-micro bg-paper-3">{t}</Chip>
          ))}
        </div>
      </div>

      <AudioPlayer src={content.audioUrl} waveform={content.waveform} durationSec={content.durationSec} />

      {/* type what you hear */}
      <div className="flex flex-col gap-s-3">
        <label className="t-small text-ink-mute">type what you hear</label>
        <textarea
          ref={inputRef}
          rows={3}
          value={answer}
          spellCheck={false}
          readOnly={isLocked}
          disabled={isLocked}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="escribe la frase tal y como la oyes…"
          className="w-full rounded-md border border-ink bg-card p-s-3 t-body"
        />
        {isAccentLanguage(language) && (
          <AccentPicker language={language} targetRef={inputRef} disabled={isLocked} />
        )}
      </div>

      {!active && submission.kind !== 'evaluated' && (
        <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit || isLocked} loading={submission.kind === 'submitting'}>
          check
        </Button>
      )}

      {submission.kind === 'evaluated' && isDictationResult(submission.result) && (
        <DictationResults result={submission.result} onNext={onNext} nextLabel={nextLabel} />
      )}
    </div>
  );
}

function DictationResults({
  result,
  onNext,
  nextLabel,
}: {
  result: DictationResult;
  onNext: () => void;
  nextLabel?: string;
}) {
  const verdict = dictationVerdict(result.score);
  return (
    <FeedbackShell
      tier={verdict.tier}
      label={result.headline}
      scoreChipText={`${Math.round(result.adjustedCharAccuracy * 100)}%`}
      onNext={onNext}
      nextLabel={nextLabel}
    >
      <div className="flex flex-col gap-s-4">
        <p className="t-small text-ink-mute">
          raw {Math.round(result.rawCharAccuracy * 100)}% → adjusted{' '}
          {Math.round(result.adjustedCharAccuracy * 100)}% · {Math.round(result.wordAccuracy * 100)}% words
        </p>

        {/* diff prose */}
        <p className="t-body leading-loose">
          {result.diff.map((seg, i) => {
            if (seg.kind === 'match') return <span key={i}>{seg.text} </span>;
            if (seg.kind === 'accepted') {
              return (
                <span key={i} className="border-b-2 border-dotted border-[var(--color-ok)]">{seg.got} </span>
              );
            }
            return (
              <span key={i}>
                <span className="line-through text-ink-mute">{seg.got}</span>{' '}
                <span className="text-[var(--color-ok)]">{seg.expected}</span>{' '}
              </span>
            );
          })}
        </p>

        {/* flagged differences */}
        {result.differences.length > 0 && (
          <div className="flex flex-col gap-s-2">
            {result.differences.map((d) => (
              <Card key={d.id} padding="sm" className="bg-paper-2">
                <div className="flex flex-wrap items-center gap-s-2">
                  <Chip className="t-micro">{d.category}</Chip>
                  <span className="t-mono t-small">
                    <span className="line-through text-ink-mute">{d.got || '∅'}</span> → <span className="text-[var(--color-ok)]">{d.expected}</span>
                  </span>
                  <Chip className="t-micro bg-paper-3">{d.kind === 'accepted' ? 'aceptado' : d.severity}</Chip>
                </div>
                <p className="t-small text-ink-soft mt-s-1">{d.note}</p>
              </Card>
            ))}
          </div>
        )}

        {/* criteria */}
        <div className="flex flex-col gap-s-1">
          {result.criteria.map((c) => (
            <div key={c.id} className="flex items-baseline gap-s-2 t-small">
              <span className="flex-1">{c.label}</span>
              <span className="t-mono text-ink-mute">{Math.round(c.score * 100)}%</span>
              <Chip className="t-micro">{c.cefr}</Chip>
            </div>
          ))}
        </div>
      </div>
    </FeedbackShell>
  );
}
```

> As with Task 12, confirm the `Card`/`Chip`/`Button` prop names (`padding="sm"`, `variant="primary"`) against `components/ui` and the token class names against an existing exercise component; substitute the real ones where they differ. The structure and data flow are the contract — exact class strings follow the existing components.

- [ ] **Step 4: Add the dispatch in exercise-pane**

In `apps/web/app/(dashboard)/drill/_components/exercise-pane.tsx`:
- Import: add `isDictationContent` to the `@language-drill/shared` import and `import { DictationExercise } from './dictation-exercise';`.
- Add a branch before the final fallback:

```tsx
  if (isDictationContent(content)) {
    return (
      <DictationExercise
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

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @language-drill/web test dictation-exercise && pnpm --filter @language-drill/web typecheck`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(dashboard\)/drill/_components/dictation-exercise.tsx apps/web/app/\(dashboard\)/drill/_components/exercise-pane.tsx apps/web/app/\(dashboard\)/drill/_components/__tests__/dictation-exercise.test.tsx
git commit -m "feat(web): DictationExercise component + drill dispatch"
```

---

## Task 14: Full suite green

**Files:** none (verification)

- [ ] **Step 1: Build everything**

Run: `pnpm build`
Expected: all packages build.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: zero errors. Fix any (common: unused imports in the modified route files, exhaustive-deps on the new `useEffect`s — mirror the `// handleSubmit closes over …` comment pattern from `cloze-exercise.tsx`).

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean across all packages.

- [ ] **Step 4: Test (serialized to avoid the known infra flake)**

Run: `pnpm turbo run test --concurrency=1`
Expected: all suites pass.

- [ ] **Step 5: Commit any fixups**

```bash
git add -A
git commit -m "chore: lint/typecheck fixups for dictation slice"
```

---

## Task 15: Local manual verification (real audio)

**Files:** none (manual)

- [ ] **Step 1: Seed a dictation clip against the dev DB + bucket**

The local `.env` `DATABASE_URL` points at the Neon **dev** branch. You need a real bucket + AWS creds. Use the dev stack's content bucket name (from the `LanguageDrillStack-dev` CloudFormation outputs/console) and your AWS creds:

```bash
DATABASE_URL=<dev-branch-url> CONTENT_BUCKET_NAME=<dev-content-bucket> AWS_REGION=eu-central-1 \
  pnpm db:seed:dictation
```

Expected: "inserted" lines; MP3 objects appear under `dictation/` in the bucket.

- [ ] **Step 2: Run the app**

Run: `pnpm dev`
Then open `http://localhost:3000`, start a drill in **Spanish at B2**, and advance until a dictation exercise appears (it's now in the pool). Confirm: the clip title/brief render, the player plays the Polly audio, 0.75× slows it, you can type a transcription, submit returns a diff result with forgiveness notes, and the verdict chip shows the adjusted accuracy.

> If the player shows disabled (no audio), the API didn't return `audioUrl` — confirm `CONTENT_BUCKET_NAME` is set in the **local API** env (the local Hono dev server reads `.env`; add `CONTENT_BUCKET_NAME=<dev-content-bucket>` there) and that your local AWS creds can presign.

- [ ] **Step 3: Confirm the listening axis lights up**

After submitting at least one dictation, open the progress/radar page and confirm the **listening** axis now shows non-zero mastery with `evidenceCount ≥ 1`.

---

## Task 16: Debrief graceful-fallback check + docs

**Files:** possibly `apps/web/app/(dashboard)/drill/debrief/...` (only if it crashes)

- [ ] **Step 1: Verify the debrief doesn't break on a dictation item**

Complete a session containing a dictation exercise, then open `/drill/debrief/<sessionId>`. A bespoke dictation debrief renderer is out of scope for this slice; confirm the debrief page renders the item with its generic/fallback display and does **not** throw. (`grep -n "type ===\|switch" apps/web/app/\(dashboard\)/drill/debrief` to see how it dispatches — most dispatchers have an `unknown type` fallback like `exercise-pane.tsx`.)

- [ ] **Step 2: If it throws,** add a minimal fallback branch in the debrief item renderer that shows `result.headline`/`summary` + score for a dictation item (mirror the existing per-type branches). Otherwise no code change.

- [ ] **Step 3: Note the slice boundary in the spec's follow-ups**

Confirm `docs/superpowers/specs/2026-06-13-dictation-exercise-design.md` already lists the deferred items (batch pipeline, partial variant, bespoke debrief, real waveforms). No change needed unless something shifted during implementation.

- [ ] **Step 4: Final commit (if any changes)**

```bash
git add -A
git commit -m "fix(web): graceful debrief fallback for dictation items"
```

---

## Done criteria

- A dictation exercise appears in a Spanish B2 drill session, plays Polly audio, accepts a typed transcription, and returns a char-diff result with Claude forgiveness notes + adjusted accuracy.
- Submitting a dictation lights up the `listening` radar axis.
- `pnpm lint && pnpm typecheck && pnpm turbo run test --concurrency=1` all green.
- No regression to cloze/translation/vocab/sentence-construction submit + feedback.
