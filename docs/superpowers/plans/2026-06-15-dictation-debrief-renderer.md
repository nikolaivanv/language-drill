# Dictation Debrief Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render dictation items on the post-session debrief (`/drill/debrief`) — replay the clip and show the stored diff / score / criteria — instead of the current blank body.

**Architecture:** Three layers. (1) Backend: presign `audioUrl` on dictation items in `GET /sessions/:id/debrief`. (2) Schema: widen `DebriefItem.evaluation` to a union that preserves `DictationResult`. (3) Web: extract the live result body into a shared `DictationResultBody`, and add a `DictationBody` (audio player + that body) to the debrief dispatcher.

**Tech Stack:** Next.js (App Router) + React + TypeScript (`apps/web`); Hono on Lambda (`infra/lambda`); Zod schemas + TanStack Query (`packages/api-client`); Vitest + Testing Library.

**Spec:** [`../specs/2026-06-15-dictation-debrief-renderer-design.md`](../specs/2026-06-15-dictation-debrief-renderer-design.md)

**Conventions:** Work in the worktree `/Users/seal/dev/language-drill/.claude/worktrees/feat-dictation-debrief` (run all commands from there). Add tests to the existing test file for each module. The real green gate is `pnpm turbo run test --concurrency=1`; single-package runs may need `pnpm build` first against changed deps. No DB migration, no infra/CDK change, no env var.

---

## Task 1: Preserve `DictationResult` in the debrief schema

**Files:**
- Modify: `packages/api-client/src/schemas/debrief.ts`
- Test: `packages/api-client/src/schemas/debrief.test.ts` (create if absent; otherwise add)

- [ ] **Step 1: Write the failing test**

In `packages/api-client/src/schemas/debrief.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DebriefItemSchema } from './debrief';
import { ExerciseType } from '@language-drill/shared';

const dictationResult = {
  kind: 'dictation',
  score: 0.82, grammarAccuracy: 0.82, vocabularyRange: 'B1',
  taskAchievement: 0.9, feedback: 'Good ear.', errors: [], estimatedCefrEvidence: 'B1',
  rawCharAccuracy: 0.8, adjustedCharAccuracy: 0.82, wordAccuracy: 0.9, listeningCefr: 'B1',
  headline: 'Casi perfecto', summary: 'Solo un desliz.',
  diff: [{ kind: 'match', text: 'Hola' }],
  differences: [{ id: 1, kind: 'error', category: 'word boundary', severity: 'low', got: 'a', expected: 'b', note: 'n' }],
  criteria: [{ id: 'phon', label: 'Phoneme discrimination', score: 0.8, cefr: 'B1', note: 'n' }],
};

it('preserves dictation-specific fields in evaluation', () => {
  const item = {
    exerciseId: '11111111-1111-1111-1111-111111111111',
    type: ExerciseType.DICTATION, grammarPointKey: 'es-b1-dictation',
    contentJson: {}, status: 'incorrect', userAnswer: 'Hola',
    score: 0.82, evaluation: dictationResult,
  };
  const parsed = DebriefItemSchema.parse(item);
  expect(parsed.evaluation).toMatchObject({
    kind: 'dictation',
    diff: [{ kind: 'match', text: 'Hola' }],
    criteria: [{ id: 'phon' }],
  });
});

it('still accepts a plain EvaluationResult and null', () => {
  const evalResult = { score: 0.7, grammarAccuracy: 0.7, vocabularyRange: 'B1', taskAchievement: 0.7, feedback: 'ok', errors: [], estimatedCefrEvidence: 'B1' };
  const base = { exerciseId: '11111111-1111-1111-1111-111111111111', type: ExerciseType.CLOZE, grammarPointKey: null, contentJson: {}, status: 'correct', userAnswer: 'x', score: 0.7 };
  expect(DebriefItemSchema.parse({ ...base, evaluation: evalResult }).evaluation).toMatchObject({ score: 0.7 });
  expect(DebriefItemSchema.parse({ ...base, evaluation: null, status: 'skipped', userAnswer: null, score: null }).evaluation).toBeNull();
});
```

- [ ] **Step 2: Run it — expect FAIL** (dictation fields stripped → `diff`/`criteria` undefined).

Run: `pnpm --filter @language-drill/api-client test -- debrief.test.ts`

- [ ] **Step 3: Widen the schema**

In `packages/api-client/src/schemas/debrief.ts`, change the import on line 3 and the `evaluation` field:

```ts
import { DictationResultSchema, EvaluationResultSchema } from './exercise';
```

```ts
  // DictationResultSchema FIRST: a dictation result matches it (carries
  // `kind: 'dictation'` + the required diff/differences/criteria); a plain
  // evaluation result fails it and falls through to EvaluationResultSchema.
  // Mirrors parseSubmitResult's discrimination (exercise.ts).
  evaluation: z.union([DictationResultSchema, EvaluationResultSchema]).nullable(),
```

(`DictationResultSchema` is already exported from `./exercise`.)

- [ ] **Step 4: Run it — expect PASS.** `pnpm --filter @language-drill/api-client test -- debrief.test.ts`

- [ ] **Step 5: Typecheck** — `pnpm --filter @language-drill/api-client typecheck`. The inferred `DebriefItem['evaluation']` is now `DictationResultResponse | EvaluationResultResponse | null`. If any existing api-client consumer references `evaluation.feedback` etc., those fields exist on both union members so it stays valid.

- [ ] **Step 6: Commit**

```bash
git add packages/api-client/src/schemas/debrief.ts packages/api-client/src/schemas/debrief.test.ts
git commit -m "feat(api-client): preserve DictationResult in debrief evaluation"
```

---

## Task 2: Presign `audioUrl` on debrief dictation items

**Files:**
- Modify: `infra/lambda/src/routes/sessions.ts`
- Test: `infra/lambda/src/routes/sessions.test.ts`

- [ ] **Step 1: Confirm imports + the row type**

`presignAudioUrl` (from `../lib/audio-url`) and `withAudioUrl` (from `../lib/dictation-content`) are already imported at the top of `sessions.ts` (used by `POST /sessions`). Find the `DebriefItemRow` type (the cast target at the `itemsResult.rows as unknown as DebriefItemRow[]` line) and confirm its fields — you'll add `audio_s3_key`.

- [ ] **Step 2: Write the failing test**

In `infra/lambda/src/routes/sessions.test.ts`, add to the debrief describe block a case that seeds a completed session with a dictation exercise (its `audio_s3_key` set) plus a non-dictation exercise, and asserts: the dictation item's `contentJson.audioUrl` is the presigned URL (the test's `presignAudioUrl` mock return), and the non-dictation item's `contentJson` has no `audioUrl`. Mirror the existing debrief tests' DB-seeding + presign-mock setup in this file (the file already mocks `presignAudioUrl` for `POST /sessions`). If the debrief tests are gated on a live DB and skipped without one, add this test in the same gated manner — do not fake a passing DB test.

- [ ] **Step 3: Run it — expect FAIL** (debrief returns raw `content_json`, no `audioUrl`).

Run: `pnpm --filter @language-drill/lambda test -- sessions.test.ts`

- [ ] **Step 4: Add `audio_s3_key` to the SELECT + row type**

In the debrief items query (the `db.execute(sql\`...\`)` around line 606), add `e.audio_s3_key` to the projection:

```sql
    SELECT e.id AS exercise_id, e.type, e.grammar_point_key, e.content_json,
           e.audio_s3_key,
           h.score, h.response_json
```

Add `audio_s3_key: string | null;` to the `DebriefItemRow` type.

- [ ] **Step 5: Presign on dictation items (make the map async)**

The `items` builder is currently a sync `.map().filter()`. Convert it to async so it can `await presignAudioUrl`. Replace the `const items = exerciseIds.map(...).filter(...)` block with:

```ts
  const items = (
    await Promise.all(
      exerciseIds.map(async (exerciseId) => {
        const row = rowMap.get(exerciseId);
        if (!row) return null; // exercise rows are immutable; defensive only

        // Dictation items get a presigned audioUrl injected into contentJson so
        // the debrief can replay the clip (mirrors POST /sessions). Non-dictation
        // content is returned unchanged. presignAudioUrl returns null when the
        // key is absent / bucket env unset, and withAudioUrl then leaves audioUrl
        // absent — never throws.
        const contentJson =
          row.type === ExerciseType.DICTATION
            ? withAudioUrl(row.content_json, await presignAudioUrl(row.audio_s3_key))
            : row.content_json;

        const hasHistory = row.score !== null && row.score !== undefined;
        if (!hasHistory) {
          return {
            exerciseId,
            type: row.type as ExerciseType,
            grammarPointKey: row.grammar_point_key,
            contentJson,
            status: 'skipped' as const,
            userAnswer: null,
            score: null,
            evaluation: null,
          };
        }
        const score = Number(row.score);
        const { userAnswer, evaluation } = parseResponseJson(row.response_json);
        const status: 'correct' | 'incorrect' =
          score >= CORRECT_THRESHOLD ? 'correct' : 'incorrect';
        return {
          exerciseId,
          type: row.type as ExerciseType,
          grammarPointKey: row.grammar_point_key,
          contentJson,
          status,
          userAnswer,
          score,
          evaluation,
        };
      }),
    )
  ).filter((item): item is NonNullable<typeof item> => item !== null);
```

(`withAudioUrl(content, url)` is the same helper `POST /sessions:129` uses; check its signature and pass args in the same order. The counters block below (`attemptedCount` etc.) is unchanged — `items` is now resolved before it.)

- [ ] **Step 6: Run it — expect PASS.** `pnpm --filter @language-drill/lambda test -- sessions.test.ts`

- [ ] **Step 7: Typecheck** — `pnpm --filter @language-drill/lambda typecheck`.

- [ ] **Step 8: Commit**

```bash
git add infra/lambda/src/routes/sessions.ts infra/lambda/src/routes/sessions.test.ts
git commit -m "feat(lambda): presign audioUrl on debrief dictation items"
```

---

## Task 3: Extract `DictationResultBody` (shared by live + debrief)

**Files:**
- Create: `apps/web/app/(dashboard)/drill/_components/dictation-result-body.tsx`
- Modify: `apps/web/app/(dashboard)/drill/_components/dictation-exercise.tsx`
- Test: `apps/web/app/(dashboard)/drill/_components/__tests__/dictation-result-body.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/(dashboard)/drill/_components/__tests__/dictation-result-body.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DictationResultBody } from '../dictation-result-body';

const result = {
  kind: 'dictation' as const,
  score: 0.82, grammarAccuracy: 0.82, vocabularyRange: 'B1', taskAchievement: 0.9,
  feedback: 'f', errors: [], estimatedCefrEvidence: 'B1',
  rawCharAccuracy: 0.8, adjustedCharAccuracy: 0.82, wordAccuracy: 0.9, listeningCefr: 'B1',
  headline: 'Casi', summary: 's',
  diff: [
    { kind: 'match' as const, text: 'el tiempo' },
    { kind: 'error' as const, id: 1, got: 'locura', expected: 'lo cura', severity: 'high' as const },
  ],
  differences: [
    { id: 1, kind: 'error' as const, category: 'word boundary', severity: 'high' as const, got: 'locura', expected: 'lo cura', note: 'Mis-segmented.' },
  ],
  criteria: [
    { id: 'phon', label: 'Phoneme discrimination', score: 0.8, cefr: 'B1', note: 'n' },
    { id: 'bound', label: 'Word-boundary tracking', score: 0.6, cefr: 'A2', note: 'n' },
  ],
};

it('renders the accuracy line, a difference card, and criteria rows', () => {
  render(<DictationResultBody result={result} />);
  expect(screen.getByText(/words/)).toBeInTheDocument();
  expect(screen.getByText('word boundary')).toBeInTheDocument();
  expect(screen.getByText('Mis-segmented.')).toBeInTheDocument();
  expect(screen.getByText('Phoneme discrimination')).toBeInTheDocument();
  expect(screen.getByText('Word-boundary tracking')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it — expect FAIL** (module missing).

Run: `pnpm --filter @language-drill/web test -- dictation-result-body.test.tsx`

- [ ] **Step 3: Create the extracted body**

Create `apps/web/app/(dashboard)/drill/_components/dictation-result-body.tsx`. Move the inner result JSX verbatim out of `DictationResults` (the `<div className="flex flex-col gap-s-4">…</div>` block, lines 143–207 of `dictation-exercise.tsx`). Use the SAME import paths for `Card`/`Chip` and the `DictationResult` type that `dictation-exercise.tsx` currently uses (copy them):

```tsx
import * as React from 'react';
import { Card, Chip } from '../../../../components/ui'; // match dictation-exercise.tsx's path
import type { DictationResult } from '@language-drill/shared';

export function DictationResultBody({ result }: { result: DictationResult }) {
  return (
    <div className="flex flex-col gap-s-4">
      <p className="t-small text-ink-mute">
        raw {Math.round(result.rawCharAccuracy * 100)}% → adjusted{' '}
        {Math.round(result.adjustedCharAccuracy * 100)}% ·{' '}
        {Math.round(result.wordAccuracy * 100)}% words
      </p>

      <p className="t-body leading-loose">
        {result.diff.map((seg, i) => {
          if (seg.kind === 'match') {
            return <span key={i}>{seg.text} </span>;
          }
          if (seg.kind === 'accepted') {
            return (
              <span key={i} className="border-b-2 border-dotted border-[var(--color-ok)]">
                {seg.got}{' '}
              </span>
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

      {result.differences.length > 0 && (
        <div className="flex flex-col gap-s-2">
          {result.differences.map((d) => (
            <Card key={d.id} padding="sm">
              <div className="flex flex-wrap items-center gap-s-2">
                <Chip>{d.category}</Chip>
                <span className="t-mono t-small">
                  <span className="line-through text-ink-mute">{d.got || '∅'}</span>{' '}
                  → <span className="text-[var(--color-ok)]">{d.expected}</span>
                </span>
                <Chip>{d.kind === 'accepted' ? 'aceptado' : d.severity}</Chip>
              </div>
              <p className="t-small text-ink-soft mt-s-2">{d.note}</p>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-s-1">
        {result.criteria.map((c) => (
          <div key={c.id} className="flex items-baseline gap-s-2 t-small">
            <span className="flex-1">{c.label}</span>
            <span className="t-mono text-ink-mute">{Math.round(c.score * 100)}%</span>
            <Chip>{c.cefr}</Chip>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Refactor `DictationResults` to use it**

In `dictation-exercise.tsx`, replace the moved inner JSX (lines 143–207) with `<DictationResultBody result={result} />`, leaving the `FeedbackShell` wrapper (tier/headline/score chip/next-button) intact:

```tsx
function DictationResults({ result, onNext, nextLabel }: { result: DictationResult; onNext: () => void; nextLabel?: string }) {
  const verdict = dictationVerdict(result.score);
  return (
    <FeedbackShell
      tier={verdict.tier}
      label={result.headline}
      scoreChipText={`${Math.round(result.adjustedCharAccuracy * 100)}%`}
      onNext={onNext}
      nextLabel={nextLabel}
    >
      <DictationResultBody result={result} />
    </FeedbackShell>
  );
}
```

Add `import { DictationResultBody } from './dictation-result-body';`. Remove now-unused imports (`Card`/`Chip`) from `dictation-exercise.tsx` ONLY if nothing else in the file uses them — check first (an unused import is a hard lint error).

- [ ] **Step 5: Run web tests — expect PASS.** `pnpm --filter @language-drill/web test -- dictation-result-body.test.tsx dictation-exercise`

(The existing `dictation-exercise.test.tsx` must still pass — the live results render identically through the extracted body.)

- [ ] **Step 6: Lint + typecheck** — `pnpm --filter @language-drill/web lint && pnpm --filter @language-drill/web typecheck`.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/_components/dictation-result-body.tsx" "apps/web/app/(dashboard)/drill/_components/dictation-exercise.tsx" "apps/web/app/(dashboard)/drill/_components/__tests__/dictation-result-body.test.tsx"
git commit -m "refactor(web): extract shared DictationResultBody from live dictation results"
```

---

## Task 4: `DictationBody` + debrief dispatcher branch

**Files:**
- Create: `apps/web/app/(dashboard)/drill/debrief/_components/dictation-body.tsx`
- Modify: `apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx`
- Test: `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/review-item-card.test.tsx` (use the existing test file for this component if it exists; otherwise create)

- [ ] **Step 1: Write the failing tests**

In the review-item-card test file, add a dictation `DebriefItem` fixture and assert four behaviors. A dictation `contentJson` is `{ type: 'dictation', title, referenceText, sentences, accent, voiceId, tested, durationSec, waveform, audioUrl? }`; `evaluation` is a `DictationResult`.

```tsx
import { ReviewItemCard } from '../review-item-card';
import { ExerciseType } from '@language-drill/shared';
import { render, screen } from '@testing-library/react';

const dictContent = {
  type: 'dictation', title: 'El tiempo', referenceText: 'el tiempo lo cura todo',
  sentences: ['el tiempo lo cura todo'], accent: 'es', voiceId: 'Sergio',
  tested: ['sinalefa'], durationSec: 6, waveform: [0.5, 0.6], audioUrl: 'https://signed/clip.mp3',
};
const dictEval = {
  kind: 'dictation', score: 0.82, grammarAccuracy: 0.82, vocabularyRange: 'B1', taskAchievement: 0.9,
  feedback: 'f', errors: [], estimatedCefrEvidence: 'B1', rawCharAccuracy: 0.8, adjustedCharAccuracy: 0.82,
  wordAccuracy: 0.9, listeningCefr: 'B1', headline: 'Casi', summary: 's',
  diff: [{ kind: 'match', text: 'el tiempo' }],
  differences: [{ id: 1, kind: 'error', category: 'word boundary', severity: 'high', got: 'locura', expected: 'lo cura', note: 'n' }],
  criteria: [{ id: 'phon', label: 'Phoneme discrimination', score: 0.8, cefr: 'B1', note: 'n' }],
};
const dictItem = (over = {}) => ({
  exerciseId: '11111111-1111-1111-1111-111111111111', type: ExerciseType.DICTATION,
  grammarPointKey: 'es-b1-dictation', contentJson: dictContent, status: 'incorrect',
  userAnswer: 'el tiempo locura todo', score: 0.82, evaluation: dictEval, ...over,
});

it('renders the dictation body: diff/criteria + an audio element', () => {
  const { container } = render(<ReviewItemCard index={0} item={dictItem() as never} />);
  expect(screen.getByText('word boundary')).toBeInTheDocument();
  expect(screen.getByText('Phoneme discrimination')).toBeInTheDocument();
  expect(container.querySelector('audio')).not.toBeNull(); // AudioPlayer rendered
});

it('degrades gracefully when evaluation is null', () => {
  render(<ReviewItemCard index={0} item={dictItem({ evaluation: null, status: 'incorrect' }) as never} />);
  expect(screen.getByText(/el tiempo lo cura todo/)).toBeInTheDocument(); // reference text shown
  expect(screen.getByText(/no result recorded/i)).toBeInTheDocument();
});

it('omits the audio player when audioUrl is absent', () => {
  const noAudio = { ...dictContent, audioUrl: undefined };
  const { container } = render(<ReviewItemCard index={0} item={dictItem({ contentJson: noAudio }) as never} />);
  expect(container.querySelector('audio')).toBeNull();
  expect(screen.getByText('Phoneme discrimination')).toBeInTheDocument(); // body still renders
});

it('a skipped dictation item still shows the skipped body', () => {
  render(<ReviewItemCard index={0} item={dictItem({ status: 'skipped', evaluation: null, userAnswer: null, score: null }) as never} />);
  expect(screen.getByText(/skipped — no submission/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run them — expect FAIL** (dictation falls through to `null`; no body, no audio).

Run: `pnpm --filter @language-drill/web test -- review-item-card`

- [ ] **Step 3: Create `DictationBody`**

Create `apps/web/app/(dashboard)/drill/debrief/_components/dictation-body.tsx`:

```tsx
import * as React from 'react';
import type { DictationContent, DictationResult } from '@language-drill/shared';
import type { DebriefItem } from '@language-drill/api-client';
import { AudioPlayer } from '../../_components/audio-player';
import { DictationResultBody } from '../../_components/dictation-result-body';

/**
 * Debrief body for a dictation item: replays the clip (when audio is available)
 * and shows the stored diff / score / criteria the learner saw at submit time.
 * `item.evaluation` is the union member preserved by the debrief schema; we
 * narrow to the dictation shape via its `kind` discriminant. Falls back to the
 * reference text + a "no result" note when no result was recorded.
 */
export function DictationBody({
  item,
  content,
}: {
  item: DebriefItem;
  content: DictationContent;
}) {
  const result =
    item.evaluation && 'kind' in item.evaluation && item.evaluation.kind === 'dictation'
      ? (item.evaluation as DictationResult)
      : null;

  return (
    <div className="flex flex-col gap-s-3">
      {content.audioUrl && content.audioUrl.length > 0 && (
        <AudioPlayer
          src={content.audioUrl}
          waveform={content.waveform}
          durationSec={content.durationSec}
        />
      )}
      {result ? (
        <DictationResultBody result={result} />
      ) : (
        <>
          <p className="t-body">{content.referenceText}</p>
          <p className="t-small italic text-ink-mute">no result recorded</p>
        </>
      )}
    </div>
  );
}
```

(Confirm the `AudioPlayer` / `DictationResultBody` relative import paths resolve from `debrief/_components/` — both live under `drill/_components/`, i.e. `../../_components/...`. Adjust depth if the dir nesting differs.)

- [ ] **Step 4: Wire the dispatcher**

In `review-item-card.tsx`: add the import + type-guard + branch.

Add to the `@language-drill/shared` import: `isDictationContent` and `type DictationContent`. Add `import { DictationBody } from './dictation-body';`. Then add the branch at the end of the dispatcher chain (currently line 70–72):

```tsx
          ) : isSentenceConstructionContent(content) ? (
            <SentenceConstructionBody item={item} content={content} />
          ) : isDictationContent(content) ? (
            <DictationBody item={item} content={content} />
          ) : null}
```

- [ ] **Step 5: Run them — expect PASS.** `pnpm --filter @language-drill/web test -- review-item-card`

- [ ] **Step 6: Lint + typecheck** — `pnpm --filter @language-drill/web lint && pnpm --filter @language-drill/web typecheck`.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/debrief/_components/dictation-body.tsx" "apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx" "apps/web/app/(dashboard)/drill/debrief/_components/__tests__/review-item-card.test.tsx"
git commit -m "feat(web): render dictation items on the debrief (clip replay + diff/score)"
```

---

## Task 5: Full-suite gate

- [ ] **Step 1: Run the pre-push gate**

```bash
pnpm lint
pnpm typecheck
pnpm turbo run test --concurrency=1
```

Expected: zero failures. The touched packages are `api-client`, `lambda`, and `web`; run infra serially per the known parallel-load flake. If a single-package web test fails on a stale `api-client` dist after Task 1, `pnpm build` (turbo) first.

- [ ] **Step 2: Commit any gate fixes** (only if needed)

```bash
git add -A
git commit -m "chore(dictation-debrief): fix full-suite gate issues"
```

---

## Self-review

- **Spec coverage:** backend presign → Task 2; schema union → Task 1; web renderer + extraction → Tasks 3–4; edge cases (null eval, no audio, skipped, non-dictation) → Task 4 tests + the `type === 'dictation'` presign guard. Testing → each task + Task 5.
- **No DB migration / infra / env change** — pure read-path + UI, per the spec.
- **Type consistency:** `DictationResultBody({ result: DictationResult })` (shared type) used in Tasks 3 + 4; the debrief narrows `item.evaluation` (union) to `DictationResult` via the `kind` discriminant before passing it. `DictationBody({ item, content })` signature matches the dispatcher call site. `isDictationContent` is the shared guard (already exists). `AudioPlayer` props (`src`/`waveform`/`durationSec`) match its interface.
- **Discriminant safety:** `EvaluationResultSchema` has no `kind`; `DictationResultSchema` has `kind: 'dictation'` — so the union (DictationResult first) and the `'kind' in evaluation` narrow are both unambiguous.
