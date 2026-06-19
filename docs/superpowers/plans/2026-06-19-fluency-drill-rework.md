# Fluency Drill Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make fluency mode a polished, fast, no-LLM sibling of the standard drill — same prompt visuals for all three eligible types, a special-character keyboard, and a substantive debrief.

**Architecture:** Extract the prompt-presentation of each exercise type into shared presentational components under `apps/web/components/drill/`, consumed by both the standard drill exercises and new fluency item renderers. Fluency reuses the drill's `FeedbackShell` for the post-answer state (latency in the score chip) and accumulates per-item results to render a client-side debrief. No backend, schema, grader, or API changes.

**Tech Stack:** Next.js (App Router) + TypeScript, React, Tailwind utility classes + project design tokens, Vitest + @testing-library/react.

## Global Constraints

- **Scope:** `apps/web` only. Do NOT touch `infra/lambda`, `packages/*`, DB schema, or any `/fluency/*` endpoint. The deterministic grader (`packages/shared/src/fluency.ts`) and latency clamp (60s) are unchanged.
- **Fluency eligible types:** `cloze`, `vocab_recall`, `conjugation` only. No LLM eval, no Claude feedback paragraphs.
- **No timed-recall scaffolds in fluency:** do NOT render cloze MC options or vocab hint rows in fluency items.
- **Import depth:** files under `apps/web/components/drill/` reach UI via `../ui`, libs via `../../lib/...`. Files under `apps/web/app/(dashboard)/fluency/_components/` reach `apps/web` root via `../../../../`, and the drill `_components` via `../../drill/_components/...`.
- **Design tokens:** reuse existing classes/tokens already in the codebase (`t-display-m`, `t-display-s`, `t-body`, `t-body-l`, `t-small`, `t-micro`, `text-ink-mute`, `text-ink-soft`, `var(--color-ok-soft)`, `var(--color-accent-soft)`, etc.). Do not introduce new tokens.
- **Pre-push gate:** `pnpm lint && pnpm typecheck && pnpm test` must be green. Run from repo root.
- Run all commands from the worktree root: `/Users/seal/dev/language-drill/.claude/worktrees/feat-fluency-drill-improvements`.

---

## File Structure

**New (shared presentational):**
- `apps/web/components/drill/cloze-prompt.tsx` — `ClozePrompt`, `BLANK_STATE_CLASS`, `BlankState`.
- `apps/web/components/drill/vocab-prompt.tsx` — `VocabPromptCard`.
- `apps/web/components/drill/conjugation-prompt.tsx` — `ConjugationPromptCard`.

**New (fluency):**
- `apps/web/app/(dashboard)/fluency/_components/fluency-metrics.ts` — `FluencyItemResult`, `FluencySummary`, `median`, `summarizeFluency`, `formatSeconds`, `promptLabelFor`.
- `apps/web/app/(dashboard)/fluency/_components/fluency-debrief.tsx` — `FluencyDebrief`.
- `apps/web/components/drill/__tests__/cloze-prompt.test.tsx`
- `apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-metrics.test.ts`
- `apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-item.test.tsx`
- `apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-debrief.test.tsx`

**Modified:**
- `apps/web/app/(dashboard)/drill/_components/cloze-exercise.tsx` — consume `ClozePrompt`.
- `apps/web/app/(dashboard)/drill/_components/vocab-exercise.tsx` — consume `VocabPromptCard`.
- `apps/web/app/(dashboard)/drill/_components/conjugation-exercise.tsx` — consume `ConjugationPromptCard`.
- `apps/web/app/(dashboard)/fluency/_components/fluency-item.tsx` — rewrite (type dispatch + accent picker + `FeedbackShell`).
- `apps/web/app/(dashboard)/fluency/_components/fluency-runner.tsx` — accumulate results; pass `language`; `onDone(results)`.
- `apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-runner.test.tsx` — update for new markup + `onDone` payload.
- `apps/web/app/(dashboard)/fluency/page.tsx` — render `FluencyDebrief`.
- `apps/web/e2e/tests/authenticated/fluency.spec.ts` — update selectors if needed.

---

## Task 1: Extract `ClozePrompt` and refactor `ClozeExercise`

**Files:**
- Create: `apps/web/components/drill/cloze-prompt.tsx`
- Create: `apps/web/components/drill/__tests__/cloze-prompt.test.tsx`
- Modify: `apps/web/app/(dashboard)/drill/_components/cloze-exercise.tsx`

**Interfaces:**
- Produces: `ClozePrompt(props: ClozePromptProps)`; `BLANK_STATE_CLASS: Record<BlankState,string>`; `type BlankState = 'idle' | 'filled' | 'correct' | 'wrong'`.
  ```ts
  interface ClozePromptProps {
    content: ClozeContent;
    answer: string;
    onAnswerChange: (value: string) => void;
    blankState: BlankState;
    disabled: boolean;
    onEnterSubmit: () => void;
    inputRef: React.RefObject<HTMLInputElement | null>;
    showHelper?: boolean;
  }
  ```
- Consumes: `splitClozeSentence` from `apps/web/lib/drill/cloze-blank.ts`; `Input` from `apps/web/components/ui`; `cn` from `apps/web/lib/cn`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/drill/__tests__/cloze-prompt.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExerciseType, type ClozeContent } from '@language-drill/shared';
import { ClozePrompt } from '../cloze-prompt';

const base: ClozeContent = {
  type: ExerciseType.CLOZE,
  instructions: 'fill the gap',
  sentence: 'Ahmet bugün ___ kalkar.',
  correctAnswer: 'erken',
  context: 'geniş zaman',
  glossEn: 'Ahmet gets up ___ today.',
};

function Harness({ content = base }: { content?: ClozeContent }) {
  const [answer, setAnswer] = React.useState('');
  const ref = React.useRef<HTMLInputElement | null>(null);
  return (
    <ClozePrompt
      content={content}
      answer={answer}
      onAnswerChange={setAnswer}
      blankState={answer ? 'filled' : 'idle'}
      disabled={false}
      onEnterSubmit={() => {}}
      inputRef={ref}
      showHelper
    />
  );
}

describe('ClozePrompt', () => {
  it('renders the context eyebrow, the split sentence with an inline blank, and the gloss', () => {
    render(<Harness />);
    expect(screen.getByText('geniş zaman')).toBeInTheDocument();
    expect(screen.getByText(/Ahmet bugün/)).toBeInTheDocument();
    expect(screen.getByText(/Ahmet gets up/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'fill the blank' })).toBeInTheDocument();
  });

  it('fires onEnterSubmit when Enter is pressed in the blank', () => {
    const onEnter = vi.fn();
    const ref = React.createRef<HTMLInputElement>();
    render(
      <ClozePrompt
        content={base}
        answer="erken"
        onAnswerChange={() => {}}
        blankState="filled"
        disabled={false}
        onEnterSubmit={onEnter}
        inputRef={ref}
      />,
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'fill the blank' }), { key: 'Enter' });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web exec vitest run components/drill/__tests__/cloze-prompt.test.tsx`
Expected: FAIL — cannot find module `../cloze-prompt`.

- [ ] **Step 3: Create `ClozePrompt`**

Create `apps/web/components/drill/cloze-prompt.tsx`:

```tsx
'use client';

import * as React from 'react';
import type { ClozeContent } from '@language-drill/shared';
import { Input } from '../ui';
import { cn } from '../../lib/cn';
import { splitClozeSentence } from '../../lib/drill/cloze-blank';

export type BlankState = 'idle' | 'filled' | 'correct' | 'wrong';

// Inline-blank colour by state. Empty reads terracotta (an open prompt), filled
// goes ink, and a graded blank fills green / terracotta in place.
export const BLANK_STATE_CLASS: Record<BlankState, string> = {
  idle: 'border-[var(--color-accent)] text-ink',
  filled: 'border-ink text-ink',
  correct:
    'border-[var(--color-ok)] text-[var(--color-ok)] bg-[var(--color-ok-soft)] rounded-t-sm',
  wrong:
    'border-[var(--color-accent)] text-[var(--color-accent-2)] bg-[var(--color-accent-soft)] rounded-t-sm',
};

export interface ClozePromptProps {
  content: ClozeContent;
  answer: string;
  onAnswerChange: (value: string) => void;
  blankState: BlankState;
  disabled: boolean;
  onEnterSubmit: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  showHelper?: boolean;
}

// Pure presentation of a cloze prompt: the grammar-point eyebrow, the hero
// sentence whose blank IS the live input, the meaning gloss, and a standalone
// field fallback when the sentence has no `___`. The consumer owns the accent
// picker, any MC options, the submit control, and the post-grade feedback.
export function ClozePrompt({
  content,
  answer,
  onAnswerChange,
  blankState,
  disabled,
  onEnterSubmit,
  inputRef,
  showHelper = false,
}: ClozePromptProps) {
  const { before, after, hasBlank } = splitClozeSentence(content.sentence);

  const blankInput = (
    <input
      ref={inputRef}
      type="text"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      aria-label="fill the blank"
      data-state={blankState}
      value={answer}
      onChange={(e) => onAnswerChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onEnterSubmit();
        }
      }}
      disabled={disabled}
      style={{ font: 'inherit', fontWeight: 600, width: `${Math.max(answer.length, 4)}ch` }}
      className={cn(
        'inline-block text-center align-baseline bg-transparent outline-none',
        'border-b-[3px] px-s-1 caret-[var(--color-accent)] disabled:cursor-default',
        BLANK_STATE_CLASS[blankState],
      )}
    />
  );

  return (
    <div className="flex flex-col gap-s-4">
      {/* level 1 — grammar point as a quiet eyebrow tag */}
      {content.context && content.context.length > 0 && (
        <span className="inline-flex items-center gap-s-2">
          <span
            aria-hidden="true"
            className="inline-block h-[5px] w-[5px] rounded-full bg-[var(--color-accent)]"
          />
          <span className="t-micro text-ink-mute">{content.context}</span>
        </span>
      )}

      {/* level 2 (hero) — the sentence; the blank is the live input */}
      <p className="t-display-m">
        {hasBlank ? (
          <>
            {before}
            {blankInput}
            {after}
          </>
        ) : (
          content.sentence
        )}
      </p>

      {hasBlank && showHelper && (
        <p className="t-small text-ink-mute">type straight into the gap</p>
      )}

      {/* level 3 — meaning gloss, clearly secondary */}
      {content.glossEn && content.glossEn.length > 0 && (
        <p className="t-body text-ink-soft">
          <span className="t-micro text-ink-mute mr-s-2">meaning</span>
          {content.glossEn}
        </p>
      )}

      {/* Non-blank fallback: keep a standalone field for sentences with no gap. */}
      {!hasBlank && (
        <Input
          ref={inputRef}
          value={answer}
          onChange={(e) => onAnswerChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onEnterSubmit();
            }
          }}
          readOnly={disabled}
          disabled={disabled}
          className={disabled ? 'opacity-60' : undefined}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web exec vitest run components/drill/__tests__/cloze-prompt.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Refactor `ClozeExercise` to consume `ClozePrompt`**

In `apps/web/app/(dashboard)/drill/_components/cloze-exercise.tsx`:

1. Replace the import block top section. Remove `Input` from the `components/ui` import (no longer used here), remove the `splitClozeSentence` import, and add the `ClozePrompt` import. The imports become:

```tsx
'use client';

import * as React from 'react';
import type { ClozeContent, LearningLanguage } from '@language-drill/shared';
import { AccentPicker, Button } from '../../../../components/ui';
import { cn } from '../../../../lib/cn';
import { clozeVerdict } from '../../../../lib/drill/verdict-tier';
import { ClozePrompt, type BlankState } from '../../../../components/drill/cloze-prompt';
import { useDrillAction } from './drill-action-context';
import { FeedbackShell } from './feedback-shell';
import type { SubmissionMeta, SubmissionState } from './types';

export type { SubmissionMeta, SubmissionState } from './types';
```

2. Delete the local `type BlankState = ...` declaration and the local `const BLANK_STATE_CLASS: Record<BlankState, string> = { ... };` block (now imported).

3. Inside the component, delete the `const { before, after, hasBlank } = splitClozeSentence(content.sentence);` line and the entire `const blankInput = (...)` JSX assignment.

4. In the returned JSX, replace everything from the `{/* level 1 — grammar point ... */}` eyebrow block through the non-blank fallback `<Input>` block (i.e. the eyebrow `<span>`, the hero `<p className="t-display-m">…</p>`, the `type straight into the gap` helper `<p>`, the gloss `<p>`, and the `{!hasBlank && (<Input ... />)}` block) with a single element:

```tsx
      <ClozePrompt
        content={content}
        answer={answer}
        onAnswerChange={setAnswer}
        blankState={blankState}
        disabled={isLocked}
        onEnterSubmit={handleSubmit}
        inputRef={inputRef}
        showHelper={!showOptions && !isLocked}
      />
```

Leave the `blankState` computation, the accent-picker / options `<div className="flex flex-col gap-s-3">` block, the inline submit `<Button>`, and the `FeedbackShell` evaluated block exactly as they are. The `blankState` constant already has type `BlankState` (now imported).

- [ ] **Step 6: Run the cloze-exercise tests to confirm the extraction is transparent**

Run: `pnpm --filter @language-drill/web exec vitest run app/\(dashboard\)/drill/_components/__tests__/cloze-exercise.test.tsx`
Expected: PASS (all existing cloze-exercise tests green — rendered text, the `fill the blank` textbox, eyebrow, gloss, and feedback are unchanged).

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/drill/cloze-prompt.tsx apps/web/components/drill/__tests__/cloze-prompt.test.tsx "apps/web/app/(dashboard)/drill/_components/cloze-exercise.tsx"
git commit -m "refactor(drill): extract ClozePrompt presentational component"
```

---

## Task 2: Extract `VocabPromptCard` and refactor `VocabExercise`

**Files:**
- Create: `apps/web/components/drill/vocab-prompt.tsx`
- Modify: `apps/web/app/(dashboard)/drill/_components/vocab-exercise.tsx`

**Interfaces:**
- Produces: `VocabPromptCard(props: { content: VocabRecallContent })`.
- Consumes: `Card` from `apps/web/components/ui`.

- [ ] **Step 1: Create `VocabPromptCard`**

Create `apps/web/components/drill/vocab-prompt.tsx`:

```tsx
'use client';

import type { VocabRecallContent } from '@language-drill/shared';
import { Card } from '../ui';

export interface VocabPromptCardProps {
  content: VocabRecallContent;
}

// The vocab-recall prompt header, shared by the standard drill and fluency mode.
export function VocabPromptCard({ content }: VocabPromptCardProps) {
  return (
    <Card padding="lg">
      <p className="t-display-s">{content.prompt}</p>
    </Card>
  );
}
```

- [ ] **Step 2: Refactor `VocabExercise` to consume it**

In `apps/web/app/(dashboard)/drill/_components/vocab-exercise.tsx`:

1. Change the `components/ui` import to drop `Card` (still used: `AccentPicker`, `Button`, `Input`):

```tsx
import { AccentPicker, Button, Input } from '../../../../components/ui';
```

2. Add the import:

```tsx
import { VocabPromptCard } from '../../../../components/drill/vocab-prompt';
```

3. Replace the prompt card JSX:

```tsx
      <Card padding="lg">
        <p className="t-display-s">{content.prompt}</p>
      </Card>
```

with:

```tsx
      <VocabPromptCard content={content} />
```

- [ ] **Step 3: Run the vocab-exercise tests**

Run: `pnpm --filter @language-drill/web exec vitest run app/\(dashboard\)/drill/_components/__tests__/vocab-exercise.test.tsx`
Expected: PASS (prompt text unchanged).

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/drill/vocab-prompt.tsx "apps/web/app/(dashboard)/drill/_components/vocab-exercise.tsx"
git commit -m "refactor(drill): extract VocabPromptCard presentational component"
```

---

## Task 3: Extract `ConjugationPromptCard` and refactor `ConjugationExercise`

**Files:**
- Create: `apps/web/components/drill/conjugation-prompt.tsx`
- Modify: `apps/web/app/(dashboard)/drill/_components/conjugation-exercise.tsx`

**Interfaces:**
- Produces: `ConjugationPromptCard(props: { content: ConjugationContent })`.
- Consumes: `Card` from `apps/web/components/ui`.

- [ ] **Step 1: Create `ConjugationPromptCard`**

Create `apps/web/components/drill/conjugation-prompt.tsx`:

```tsx
'use client';

import type { ConjugationContent } from '@language-drill/shared';
import { Card } from '../ui';

export interface ConjugationPromptCardProps {
  content: ConjugationContent;
}

// The conjugation prompt header (lemma + gloss + feature bundle), shared by the
// standard drill and fluency mode.
export function ConjugationPromptCard({ content }: ConjugationPromptCardProps) {
  return (
    <Card padding="lg">
      <p className="t-display-s">{content.lemma}</p>
      <p className="t-body-l text-ink-mute">{content.lemmaGloss}</p>
      <p className="t-body text-ink-mute mt-s-2">{content.featureBundle}</p>
    </Card>
  );
}
```

- [ ] **Step 2: Refactor `ConjugationExercise` to consume it**

In `apps/web/app/(dashboard)/drill/_components/conjugation-exercise.tsx`:

1. Change the `components/ui` import to drop `Card` (still used: `AccentPicker`, `Button`, `Input`):

```tsx
import { AccentPicker, Button, Input } from '../../../../components/ui';
```

2. Add the import:

```tsx
import { ConjugationPromptCard } from '../../../../components/drill/conjugation-prompt';
```

3. Replace the prompt card JSX:

```tsx
      <Card padding="lg">
        <p className="t-display-s">{content.lemma}</p>
        <p className="t-body-l text-ink-mute">{content.lemmaGloss}</p>
        <p className="t-body text-ink-mute mt-s-2">{content.featureBundle}</p>
      </Card>
```

with:

```tsx
      <ConjugationPromptCard content={content} />
```

- [ ] **Step 3: Run the conjugation-exercise tests**

Run: `pnpm --filter @language-drill/web exec vitest run app/\(dashboard\)/drill/_components/__tests__/conjugation-exercise.test.tsx`
Expected: PASS (lemma/gloss/featureBundle text unchanged).

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/drill/conjugation-prompt.tsx "apps/web/app/(dashboard)/drill/_components/conjugation-exercise.tsx"
git commit -m "refactor(drill): extract ConjugationPromptCard presentational component"
```

---

## Task 4: Fluency metrics helper

**Files:**
- Create: `apps/web/app/(dashboard)/fluency/_components/fluency-metrics.ts`
- Create: `apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-metrics.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type FluencyItemResult = {
    index: number;
    type: string;          // ExerciseType value
    promptLabel: string;
    userAnswer: string;
    correct: boolean;
    correctAnswer: string;
    latencyMs: number;
  };
  type FluencySummary = {
    count: number;
    correctCount: number;
    accuracy: number;        // 0..1, 0 when count===0
    medianLatencyMs: number; // 0 when count===0
    fastestMs: number;       // 0 when count===0
    slowestMs: number;       // 0 when count===0
  };
  function median(values: number[]): number;
  function summarizeFluency(results: FluencyItemResult[]): FluencySummary;
  function formatSeconds(ms: number): string;          // "4.8s"
  function promptLabelFor(content: ExerciseContent): string;
  ```
- Consumes: `ExerciseType`, `ExerciseContent` from `@language-drill/shared`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-metrics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ExerciseType, type ExerciseContent } from '@language-drill/shared';
import {
  median,
  summarizeFluency,
  formatSeconds,
  promptLabelFor,
  type FluencyItemResult,
} from '../fluency-metrics';

function result(over: Partial<FluencyItemResult>): FluencyItemResult {
  return {
    index: 0,
    type: 'cloze',
    promptLabel: 'x',
    userAnswer: 'a',
    correct: true,
    correctAnswer: 'a',
    latencyMs: 1000,
    ...over,
  };
}

describe('median', () => {
  it('returns 0 for an empty list', () => {
    expect(median([])).toBe(0);
  });
  it('returns the middle value for odd counts', () => {
    expect(median([3000, 1000, 2000])).toBe(2000);
  });
  it('averages the two middle values for even counts', () => {
    expect(median([1000, 2000, 3000, 4000])).toBe(2500);
  });
});

describe('summarizeFluency', () => {
  it('returns zeros for no results', () => {
    expect(summarizeFluency([])).toEqual({
      count: 0,
      correctCount: 0,
      accuracy: 0,
      medianLatencyMs: 0,
      fastestMs: 0,
      slowestMs: 0,
    });
  });
  it('computes count, accuracy, median, fastest and slowest', () => {
    const s = summarizeFluency([
      result({ index: 0, correct: true, latencyMs: 1000 }),
      result({ index: 1, correct: false, latencyMs: 3000 }),
      result({ index: 2, correct: true, latencyMs: 2000 }),
    ]);
    expect(s.count).toBe(3);
    expect(s.correctCount).toBe(2);
    expect(s.accuracy).toBeCloseTo(2 / 3);
    expect(s.medianLatencyMs).toBe(2000);
    expect(s.fastestMs).toBe(1000);
    expect(s.slowestMs).toBe(3000);
  });
});

describe('formatSeconds', () => {
  it('formats ms as one-decimal seconds', () => {
    expect(formatSeconds(4800)).toBe('4.8s');
  });
});

describe('promptLabelFor', () => {
  it('uses the sentence for cloze', () => {
    const c = { type: ExerciseType.CLOZE, sentence: 'El gato ___' } as ExerciseContent;
    expect(promptLabelFor(c)).toBe('El gato ___');
  });
  it('uses the prompt for vocab', () => {
    const c = { type: ExerciseType.VOCAB_RECALL, prompt: 'opposite of big' } as ExerciseContent;
    expect(promptLabelFor(c)).toBe('opposite of big');
  });
  it('uses lemma + feature bundle for conjugation', () => {
    const c = {
      type: ExerciseType.CONJUGATION,
      lemma: 'ir',
      featureBundle: 'condicional · 1ª pl',
    } as ExerciseContent;
    expect(promptLabelFor(c)).toBe('ir · condicional · 1ª pl');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web exec vitest run app/\(dashboard\)/fluency/_components/__tests__/fluency-metrics.test.ts`
Expected: FAIL — cannot find module `../fluency-metrics`.

- [ ] **Step 3: Implement the helper**

Create `apps/web/app/(dashboard)/fluency/_components/fluency-metrics.ts`:

```ts
import { ExerciseType, type ExerciseContent } from '@language-drill/shared';

// One graded fluency item, captured by the runner for the debrief.
export type FluencyItemResult = {
  index: number;
  type: string;
  promptLabel: string;
  userAnswer: string;
  correct: boolean;
  correctAnswer: string;
  latencyMs: number;
};

export type FluencySummary = {
  count: number;
  correctCount: number;
  accuracy: number;
  medianLatencyMs: number;
  fastestMs: number;
  slowestMs: number;
};

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function summarizeFluency(results: FluencyItemResult[]): FluencySummary {
  const count = results.length;
  if (count === 0) {
    return {
      count: 0,
      correctCount: 0,
      accuracy: 0,
      medianLatencyMs: 0,
      fastestMs: 0,
      slowestMs: 0,
    };
  }
  const latencies = results.map((r) => r.latencyMs);
  const correctCount = results.filter((r) => r.correct).length;
  return {
    count,
    correctCount,
    accuracy: correctCount / count,
    medianLatencyMs: median(latencies),
    fastestMs: Math.min(...latencies),
    slowestMs: Math.max(...latencies),
  };
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

// A short label for the per-item recap. Fluency only serves cloze, vocab-recall,
// and conjugation; other types never reach here.
export function promptLabelFor(content: ExerciseContent): string {
  if (content.type === ExerciseType.CLOZE) return content.sentence;
  if (content.type === ExerciseType.VOCAB_RECALL) return content.prompt;
  if (content.type === ExerciseType.CONJUGATION) {
    return `${content.lemma} · ${content.featureBundle}`;
  }
  return '';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web exec vitest run app/\(dashboard\)/fluency/_components/__tests__/fluency-metrics.test.ts`
Expected: PASS (all groups green).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/fluency/_components/fluency-metrics.ts" "apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-metrics.test.ts"
git commit -m "feat(fluency): add session metrics + prompt-label helpers"
```

---

## Task 5: Rewrite `FluencyItem` (type dispatch + accent keys + FeedbackShell)

**Files:**
- Modify (rewrite): `apps/web/app/(dashboard)/fluency/_components/fluency-item.tsx`
- Create: `apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-item.test.tsx`

**Interfaces:**
- Consumes: `ClozePrompt`/`BlankState` (Task 1), `VocabPromptCard` (Task 2), `ConjugationPromptCard` (Task 3), `formatSeconds` (Task 4), `FeedbackShell` (existing), `AccentPicker`/`Input`/`Button` (existing UI).
- Produces: `FluencyItem(props: FluencyItemProps)`, `type FluencyVerdict`.
  ```ts
  type FluencyVerdict = { correct: boolean; correctAnswer: string } | null;
  interface FluencyItemProps {
    content: ExerciseContent;
    language: string;
    elapsedMs: number;
    verdict: FluencyVerdict;
    onSubmit: (answer: string) => void;
    onNext: () => void;
    isLast: boolean;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-item.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExerciseType, type ExerciseContent } from '@language-drill/shared';
import { FluencyItem } from '../fluency-item';

const cloze = {
  type: ExerciseType.CLOZE,
  instructions: 'x',
  sentence: 'Ahmet bugün ___ kalkar.',
  correctAnswer: 'erken',
  context: 'geniş zaman',
} as ExerciseContent;

const conjugation = {
  type: ExerciseType.CONJUGATION,
  instructions: 'x',
  lemma: 'gitmek',
  lemmaGloss: 'to go',
  featureBundle: 'geniş zaman · 1. tekil',
  targetForm: 'giderim',
  breakdown: 'git + er + im',
  exampleSentences: [],
} as ExerciseContent;

const noop = () => {};

describe('FluencyItem', () => {
  it('renders a cloze with its context eyebrow and an accent picker for TR', () => {
    render(
      <FluencyItem
        content={cloze}
        language="TR"
        elapsedMs={1200}
        verdict={null}
        onSubmit={noop}
        onNext={noop}
        isLast={false}
      />,
    );
    expect(screen.getByText('geniş zaman')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'fill the blank' })).toBeInTheDocument();
    // accent picker exposes a shift toggle button
    expect(screen.getByRole('button', { name: /shift/i })).toBeInTheDocument();
  });

  it('renders a conjugation prompt (lemma + feature bundle), not an empty prompt', () => {
    render(
      <FluencyItem
        content={conjugation}
        language="TR"
        elapsedMs={0}
        verdict={null}
        onSubmit={noop}
        onNext={noop}
        isLast={false}
      />,
    );
    expect(screen.getByText('gitmek')).toBeInTheDocument();
    expect(screen.getByText('geniş zaman · 1. tekil')).toBeInTheDocument();
  });

  it('shows the verdict via FeedbackShell with the latency in the chip and the correct answer', () => {
    render(
      <FluencyItem
        content={cloze}
        language="TR"
        elapsedMs={4800}
        verdict={{ correct: false, correctAnswer: 'erken' }}
        onSubmit={noop}
        onNext={noop}
        isLast={false}
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('not quite');
    expect(status).toHaveTextContent('4.8s');
    expect(status).toHaveTextContent('erken');
    expect(screen.getByRole('button', { name: 'next' })).toBeInTheDocument();
  });

  it('labels the advance button "finish" on the last item', () => {
    render(
      <FluencyItem
        content={cloze}
        language="TR"
        elapsedMs={1000}
        verdict={{ correct: true, correctAnswer: 'erken' }}
        onSubmit={noop}
        onNext={vi.fn()}
        isLast
      />,
    );
    expect(screen.getByRole('button', { name: 'finish' })).toBeInTheDocument();
  });
});
```

Note: if the `shift` accessible name assertion fails because the toggle's name differs, open `apps/web/components/ui/accent-picker.tsx`, read the shift button's accessible name, and update the matcher to it. Do not change the accent picker.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web exec vitest run app/\(dashboard\)/fluency/_components/__tests__/fluency-item.test.tsx`
Expected: FAIL — the current `FluencyItem` renders neither the context eyebrow, an accent picker, the conjugation prompt, nor a `FeedbackShell` verdict.

- [ ] **Step 3: Rewrite `FluencyItem`**

Replace the entire contents of `apps/web/app/(dashboard)/fluency/_components/fluency-item.tsx`:

```tsx
'use client';

import * as React from 'react';
import { ExerciseType, type ExerciseContent } from '@language-drill/shared';
import { AccentPicker, Button, Input } from '../../../../components/ui';
import { ClozePrompt, type BlankState } from '../../../../components/drill/cloze-prompt';
import { VocabPromptCard } from '../../../../components/drill/vocab-prompt';
import { ConjugationPromptCard } from '../../../../components/drill/conjugation-prompt';
import { FeedbackShell } from '../../drill/_components/feedback-shell';
import { formatSeconds } from './fluency-metrics';

export type FluencyVerdict = { correct: boolean; correctAnswer: string } | null;

export interface FluencyItemProps {
  content: ExerciseContent;
  language: string;
  elapsedMs: number;
  verdict: FluencyVerdict;
  onSubmit: (answer: string) => void;
  onNext: () => void;
  isLast: boolean;
}

function isAccentLanguage(lang: string): lang is 'ES' | 'DE' | 'TR' {
  return lang === 'ES' || lang === 'DE' || lang === 'TR';
}

// Fluency reuses the standard drill's prompt visuals (so cloze/vocab/conjugation
// look identical to normal mode) but grades locally — no Claude. The verdict
// uses FeedbackShell with the response latency in the score chip, on-theme for a
// speed drill. Timed-recall scaffolds (cloze MC options, vocab hints) are
// deliberately omitted.
export function FluencyItem({
  content,
  language,
  elapsedMs,
  verdict,
  onSubmit,
  onNext,
  isLast,
}: FluencyItemProps) {
  const [answer, setAnswer] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const locked = verdict !== null;

  React.useEffect(() => {
    setAnswer('');
    inputRef.current?.focus();
  }, [content]);

  const submit = React.useCallback(() => {
    if (answer.trim() && !locked) onSubmit(answer);
  }, [answer, locked, onSubmit]);

  const blankState: BlankState = verdict
    ? verdict.correct
      ? 'correct'
      : 'wrong'
    : answer.trim().length > 0
      ? 'filled'
      : 'idle';

  function onKeyDownInput(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex flex-col gap-s-4">
      {!locked && (
        <p className="t-small text-ink-mute" aria-live="off">
          {formatSeconds(elapsedMs)}
        </p>
      )}

      {content.type === ExerciseType.CLOZE && (
        <ClozePrompt
          content={content}
          answer={answer}
          onAnswerChange={setAnswer}
          blankState={blankState}
          disabled={locked}
          onEnterSubmit={submit}
          inputRef={inputRef}
          showHelper={!locked}
        />
      )}

      {content.type === ExerciseType.VOCAB_RECALL && (
        <>
          <VocabPromptCard content={content} />
          <Input
            ref={inputRef}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={onKeyDownInput}
            readOnly={locked}
            disabled={locked}
            className={locked ? 'opacity-60' : undefined}
          />
        </>
      )}

      {content.type === ExerciseType.CONJUGATION && (
        <>
          <ConjugationPromptCard content={content} />
          <Input
            ref={inputRef}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={onKeyDownInput}
            readOnly={locked}
            disabled={locked}
            className={locked ? 'opacity-60' : undefined}
          />
        </>
      )}

      {isAccentLanguage(language) && (
        <AccentPicker language={language} targetRef={inputRef} disabled={locked} />
      )}

      {verdict ? (
        <div role="status">
          <FeedbackShell
            tier={verdict.correct ? 'sage' : 'terracotta'}
            label={verdict.correct ? 'correct' : 'not quite'}
            scoreChipText={formatSeconds(elapsedMs)}
            onNext={onNext}
            nextLabel={isLast ? 'finish' : 'next'}
          >
            <div className="flex flex-col gap-s-1">
              <p className="t-micro text-ink-mute">correct answer</p>
              <p className="t-display-m">{verdict.correctAnswer}</p>
            </div>
          </FeedbackShell>
        </div>
      ) : (
        <Button variant="primary" onClick={submit} disabled={!answer.trim()}>
          submit
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web exec vitest run app/\(dashboard\)/fluency/_components/__tests__/fluency-item.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/fluency/_components/fluency-item.tsx" "apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-item.test.tsx"
git commit -m "feat(fluency): reuse standard drill prompts + accent keys + FeedbackShell in items"
```

---

## Task 6: Accumulate results in `FluencyRunner`

**Files:**
- Modify: `apps/web/app/(dashboard)/fluency/_components/fluency-runner.tsx`
- Modify: `apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-runner.test.tsx`

**Interfaces:**
- Consumes: `promptLabelFor`, `FluencyItemResult` (Task 4); `FluencyItem` (Task 5).
- Produces: `FluencyRunner` with `onDone: (results: FluencyItemResult[]) => void`. `FluencyExercise` type unchanged.

- [ ] **Step 1: Update the runner test (expect new markup + onDone payload)**

In `apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-runner.test.tsx`:

1. In the first test (`submits an answer, shows the verdict, then advances`), the second item's sentence `La casa ___` now renders with the blank split out, so the literal text node `La casa ___` no longer exists. Change:

```tsx
    // second item now visible
    await screen.findByText('La casa ___');
```

to:

```tsx
    // second item now visible — the sentence renders with the blank split out
    await screen.findByText(/La casa/);
```

2. In the second test (`calls onDone after the last item`), assert `onDone` receives the accumulated result array:

```tsx
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const results = onDone.mock.calls[0][0];
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ correct: true, correctAnswer: 'x', userAnswer: 'está' });
```

(Replace the existing `await waitFor(() => expect(onDone).toHaveBeenCalled());` line.)

The other two tests assert on `role="status"`, the `submit` / `next` / `finish` button names, and the textbox — all preserved by Task 5, so leave them unchanged.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web exec vitest run app/\(dashboard\)/fluency/_components/__tests__/fluency-runner.test.tsx`
Expected: FAIL — `onDone` is still called with no argument; `results` is `undefined`.

- [ ] **Step 3: Update `FluencyRunner`**

In `apps/web/app/(dashboard)/fluency/_components/fluency-runner.tsx`:

1. Add imports near the top (after the existing imports):

```tsx
import { promptLabelFor, type FluencyItemResult } from './fluency-metrics';
```

2. Change the `onDone` type in `FluencyRunnerProps`:

```tsx
  onDone: (results: FluencyItemResult[]) => void;
```

3. Add a results ref alongside the other refs (after `const intervalRef = ...`):

```tsx
  const resultsRef = React.useRef<FluencyItemResult[]>([]);
```

4. In `handleSubmit`, after `setVerdict({ correct: res.correct, correctAnswer: res.correctAnswer });`, push the result:

```tsx
      setVerdict({ correct: res.correct, correctAnswer: res.correctAnswer });
      resultsRef.current.push({
        index,
        type: current.type,
        promptLabel: promptLabelFor(current.contentJson),
        userAnswer: answer,
        correct: res.correct,
        correctAnswer: res.correctAnswer,
        latencyMs: res.latencyMs,
      });
```

5. In `handleNext`, pass the accumulated results to `onDone`:

```tsx
  function handleNext() {
    if (index + 1 >= exercises.length) {
      onDone(resultsRef.current);
      return;
    }
    setIndex((i) => i + 1);
  }
```

6. Pass `language` to `FluencyItem` in the returned JSX:

```tsx
    <FluencyItem
      content={current.contentJson}
      language={current.language}
      elapsedMs={elapsedMs}
      verdict={verdict}
      onSubmit={handleSubmit}
      onNext={handleNext}
      isLast={index + 1 >= exercises.length}
    />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web exec vitest run app/\(dashboard\)/fluency/_components/__tests__/fluency-runner.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/fluency/_components/fluency-runner.tsx" "apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-runner.test.tsx"
git commit -m "feat(fluency): accumulate per-item results and pass them to onDone"
```

---

## Task 7: `FluencyDebrief` component

**Files:**
- Create: `apps/web/app/(dashboard)/fluency/_components/fluency-debrief.tsx`
- Create: `apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-debrief.test.tsx`

**Interfaces:**
- Consumes: `summarizeFluency`, `formatSeconds`, `FluencyItemResult` (Task 4); `Card` (UI).
- Produces: `FluencyDebrief(props: { results: FluencyItemResult[]; onRestart: () => void })`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-debrief.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluencyDebrief } from '../fluency-debrief';
import type { FluencyItemResult } from '../fluency-metrics';

const results: FluencyItemResult[] = [
  { index: 0, type: 'cloze', promptLabel: 'El gato ___', userAnswer: 'está', correct: true, correctAnswer: 'está', latencyMs: 1000 },
  { index: 1, type: 'cloze', promptLabel: 'Bu film kısa ___.', userAnswer: 'degil', correct: false, correctAnswer: 'değil', latencyMs: 3000 },
];

describe('FluencyDebrief', () => {
  it('shows headline metrics and one recap row per item', () => {
    render(<FluencyDebrief results={results} onRestart={vi.fn()} />);
    // median of [1000,3000] = 2000ms -> 2.0s
    expect(screen.getByText('2.0s')).toBeInTheDocument();
    expect(screen.getByText(/1\/2 correct/)).toBeInTheDocument();
    expect(screen.getByText('El gato ___')).toBeInTheDocument();
    expect(screen.getByText('Bu film kısa ___.')).toBeInTheDocument();
    // the wrong item surfaces the correct answer
    expect(screen.getByText(/değil/)).toBeInTheDocument();
  });

  it('fires onRestart from the "drill again" control', () => {
    const onRestart = vi.fn();
    render(<FluencyDebrief results={results} onRestart={onRestart} />);
    fireEvent.click(screen.getByRole('button', { name: 'drill again' }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('falls back to a minimal message when there are no results', () => {
    render(<FluencyDebrief results={[]} onRestart={vi.fn()} />);
    expect(screen.getByText('nice — that was fast')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web exec vitest run app/\(dashboard\)/fluency/_components/__tests__/fluency-debrief.test.tsx`
Expected: FAIL — cannot find module `../fluency-debrief`.

- [ ] **Step 3: Implement `FluencyDebrief`**

Create `apps/web/app/(dashboard)/fluency/_components/fluency-debrief.tsx`:

```tsx
'use client';

import { Card } from '../../../../components/ui';
import {
  summarizeFluency,
  formatSeconds,
  type FluencyItemResult,
} from './fluency-metrics';

export interface FluencyDebriefProps {
  results: FluencyItemResult[];
  onRestart: () => void;
}

// End-of-session debrief: headline speed/accuracy metrics for this session, plus
// a scannable per-item recap. All computed client-side from the runner's
// accumulated results — no extra API call. The weekly latency trend lives on the
// progress page.
export function FluencyDebrief({ results, onRestart }: FluencyDebriefProps) {
  const summary = summarizeFluency(results);

  if (summary.count === 0) {
    return (
      <div className="flex flex-col gap-s-3">
        <h1 className="t-display-s">nice — that was fast</h1>
        <p className="t-body text-ink-mute">
          Your latency trend is on the progress page → fluency tab.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-s-5">
      <div className="flex flex-col gap-s-2">
        <h1 className="t-display-s">nice — that was fast</h1>
        <p className="t-display-m">{formatSeconds(summary.medianLatencyMs)}</p>
        <p className="t-small text-ink-mute">
          median this session · {summary.correctCount}/{summary.count} correct · fastest{' '}
          {formatSeconds(summary.fastestMs)} · slowest {formatSeconds(summary.slowestMs)}
        </p>
        <p className="t-small text-ink-mute">
          Your latency trend is on the progress page → fluency tab.
        </p>
      </div>

      <ul className="flex flex-col gap-s-2">
        {results.map((r) => (
          <li key={r.index}>
            <Card
              padding="md"
              className={r.correct ? 'bg-[var(--color-ok-soft)]' : 'bg-[var(--color-accent-soft)]'}
            >
              <div className="flex flex-col gap-s-1">
                <div className="flex items-center justify-between gap-s-3">
                  <span className="t-body">
                    <span aria-hidden="true">{r.correct ? '✓' : '✗'}</span> {r.promptLabel}
                  </span>
                  <span className="t-small text-ink-mute">{formatSeconds(r.latencyMs)}</span>
                </div>
                <p className="t-small text-ink-mute">
                  you: {r.userAnswer}
                  {!r.correct && <> · answer: {r.correctAnswer}</>}
                </p>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="t-small self-start text-ink-mute underline underline-offset-2 hover:text-ink"
        onClick={onRestart}
      >
        drill again
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web exec vitest run app/\(dashboard\)/fluency/_components/__tests__/fluency-debrief.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/fluency/_components/fluency-debrief.tsx" "apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-debrief.test.tsx"
git commit -m "feat(fluency): add session debrief with metrics + per-item recap"
```

---

## Task 8: Wire `FluencyDebrief` into the page

**Files:**
- Modify: `apps/web/app/(dashboard)/fluency/page.tsx`

**Interfaces:**
- Consumes: `FluencyDebrief` (Task 7), `FluencyItemResult` (Task 4), `FluencyRunner` (Task 6).

- [ ] **Step 1: Update the page to render the debrief from accumulated results**

In `apps/web/app/(dashboard)/fluency/page.tsx`:

1. Update imports — add `FluencyDebrief` and the `FluencyItemResult` type, and import the runner as before:

```tsx
import { FluencyRunner, type FluencyExercise } from './_components/fluency-runner';
import { FluencyDebrief } from './_components/fluency-debrief';
import type { FluencyItemResult } from './_components/fluency-metrics';
```

2. Replace the `const [done, setDone] = useState(false);` line with:

```tsx
  const [results, setResults] = useState<FluencyItemResult[] | null>(null);
```

3. In the language-change effect, replace `setDone(false);` with `setResults(null);`:

```tsx
  useEffect(() => {
    setResults(null);
    sessionMutate({ language: activeLanguage });
  }, [activeLanguage, sessionMutate]);
```

4. Replace the `if (done) { ... }` block with:

```tsx
  if (results) {
    return (
      <FluencyDebrief
        results={results}
        onRestart={() => {
          setResults(null);
          sessionMutate({ language: activeLanguage });
        }}
      />
    );
  }
```

5. Update the `FluencyRunner` usage's `onDone`:

```tsx
      <FluencyRunner
        exercises={exercises}
        onSubmitAttempt={(input) => submitAttempt.mutateAsync(input)}
        onDone={(r) => setResults(r)}
      />
```

- [ ] **Step 2: Typecheck the web app**

Run: `pnpm --filter @language-drill/web typecheck`
Expected: PASS — no type errors (`onDone` now matches `(results: FluencyItemResult[]) => void`).

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(dashboard)/fluency/page.tsx"
git commit -m "feat(fluency): render the session debrief on the fluency page"
```

---

## Task 9: E2E alignment + full pre-push suite

**Files:**
- Modify (if needed): `apps/web/e2e/tests/authenticated/fluency.spec.ts`

**Interfaces:** none (verification task).

- [ ] **Step 1: Read the E2E spec and check its selectors against the new markup**

Read `apps/web/e2e/tests/authenticated/fluency.spec.ts`. The rework preserves: the `submit` button, the `role="status"` verdict wrapper, and the `next`/`finish` buttons. Two things to verify in the mock data and assertions:
  - The mock `POST /fluency/session` exercises must be a fluency-eligible type (`cloze`/`vocab_recall`/`conjugation`) with valid content. A cloze mock needs a `sentence` containing `___` so the inline blank renders.
  - Any assertion that matches a cloze sentence as a single text node (e.g. `getByText('… ___')`) must become a substring/regex match (`getByText(/…/)`), because the blank is now split into a separate input — mirror the Task 6 unit-test fix.

If the existing assertions only use `role="status"`, the textbox, and button names, no change is needed.

- [ ] **Step 2: Apply any needed selector fix**

If a brittle full-sentence `getByText` is present, change it to a regex/substring match of the text before the blank. (No code block — the exact line depends on the spec's current mock; apply the same pattern as Task 6 Step 1.)

- [ ] **Step 3: Run the full pre-push suite from the repo root**

Run:
```bash
pnpm lint
pnpm typecheck
pnpm test
```
Expected: all three green, zero failures. If `pnpm test` surfaces stale compiled web test artifacts or unrelated flakiness, re-run the specific web package: `pnpm --filter @language-drill/web test`.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run `pnpm dev`, open `http://localhost:3000/fluency` (Turkish profile with ≥4 mastered cloze/vocab/conjugation items). Confirm: cloze shows the context eyebrow + inline blank, the accent keyboard inserts `ı ğ ş ç ö ü`, a conjugation item shows the lemma + feature bundle (not empty), the verdict uses the tinted FeedbackShell with the latency chip, and finishing shows the debrief with headline metrics + the per-item recap and a working "drill again".

- [ ] **Step 5: Commit (only if the E2E spec changed)**

```bash
git add apps/web/e2e/tests/authenticated/fluency.spec.ts
git commit -m "test(e2e): align fluency spec selectors with reworked markup"
```

---

## Self-Review Notes

- **Spec coverage:** (1) special-character keyboard → Task 5 (`AccentPicker` in all three item types). (2) empty debrief → Tasks 4/7/8 (metrics + `FluencyDebrief` + page wiring). (3) cloze display divergence / missing context string → Task 1 (`ClozePrompt` reused by both drill and fluency). (4) conjugation empty-prompt bug → Tasks 3 + 5 (`ConjugationPromptCard` rendered by `FluencyItem`). FeedbackShell reuse → Task 5. No-scaffold and no-LLM constraints honored (no options/hints in `FluencyItem`; grading still server-side deterministic). No backend/schema/API changes.
- **Type consistency:** `FluencyItemResult` defined in Task 4 and consumed unchanged in Tasks 6/7/8. `BlankState`/`ClozePrompt` defined in Task 1 and consumed in Task 5. `onDone: (results: FluencyItemResult[]) => void` defined in Task 6 and matched in Task 8. `FluencyVerdict` shape (`{ correct, correctAnswer }`) unchanged from the current code.
- **Placeholder scan:** none — every code step shows complete content; the only non-code step (Task 9 Step 2) is explicitly conditional on what the E2E spec currently contains.
