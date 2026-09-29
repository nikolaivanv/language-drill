# Evaluator Labeling Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a keyboard-driven admin page that lets one person hand-label real learner submissions for evaluator correctness, and store those labels durably.

**Architecture:** A new `submission_labels` table keyed to `user_exercise_history`; a self-contained Hono route (`admin-labeling.ts`) mounted inside `admin.ts` so it inherits the existing admin gate; three endpoints (queue / save / stats); a client admin page following `flags/page.tsx`. The queue renders each exercise with `renderLearnerView` **server-side**, because `apps/web` does not depend on `@language-drill/ai` and must not start. An export CLI lands last, after real labels have proven the fixture shape.

**Tech Stack:** Drizzle ORM + Neon Postgres, Hono on Lambda, Zod, TanStack Query, Next.js App Router, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-29-evaluator-labeling-design.md` — read it before Task 1. It carries the measured prod numbers and the reasoning behind every decision below.

## Global Constraints

- **Worktree:** all work happens in `/Users/seal/dev/language-drill/.claude/worktrees/feat-evaluator-labeling` on branch `feat/evaluator-labeling`. Prefix every path with the worktree root; `cd` there in every Bash call. Assert `git branch --show-current` is `feat/evaluator-labeling` before each commit.
- **Never `pnpm <script> -- --flag`.** It throws for every CLI in `packages/ai`. Always `pnpm export:labels --flag`.
- **Gate is per-package,** never a bare `pnpm test` from the root (it gets killed on this machine): `pnpm --filter @language-drill/<pkg> test`, plus `pnpm --filter @language-drill/web build` for any web change.
- **Migrations are forward-only.** Generate with `drizzle-kit generate`; never hand-edit an applied migration.
- **`drizzle.config.ts` reads `./src/schema/index.ts`.** A table not exported from that barrel produces an empty migration.
- **Prompt-version constants are never bumped by this work** — no `*_SYSTEM_PROMPT` is edited.
- Six labelable exercise types, exactly: `cloze`, `translation`, `vocab_recall`, `sentence_construction`, `conjugation`, `contextual_paraphrase`.
- `CORRECT_THRESHOLD` (0.7) lives in `packages/shared/src/index.ts` — derive score bands from it, never hardcode 0.7.
- Tailwind tokens: `bg-paper`, `border-rule`, `text-ink`, `text-ink-soft`, `font-display`. **Never `bg-ink` for a surface** — ink/paper invert in dark mode.

---

## File Structure

**Create:**
- `packages/db/src/schema/labeling.ts` — the `submission_labels` table, nothing else.
- `packages/db/src/schema/labeling.test.ts` — column + constraint assertions.
- `packages/db/migrations/0042_*.sql` — generated.
- `infra/lambda/src/routes/admin-labeling.ts` — the three endpoints + two pure helpers.
- `infra/lambda/src/routes/admin-labeling.test.ts` — route tests.
- `packages/api-client/src/schemas/labeling.ts` — wire schemas.
- `packages/api-client/src/hooks/useLabeling.ts` — three hooks.
- `packages/api-client/src/hooks/useLabeling.test.ts` — schema-parse tests.
- `apps/web/app/(admin)/admin/labeling/page.tsx` — queue state + key handler.
- `apps/web/app/(admin)/admin/labeling/_components/submission-card.tsx` — presentational.
- `apps/web/app/(admin)/admin/labeling/_components/label-bar.tsx` — presentational controls.
- `apps/web/app/(admin)/admin/labeling/__tests__/submission-card.test.tsx`
- `apps/web/app/(admin)/admin/labeling/__tests__/labeling-page.test.tsx`
- `packages/ai/scripts/export-labels.ts` + `.test.ts` — Task 8.

**Modify:**
- `packages/db/src/schema/index.ts` — export the table (required for the migration).
- `packages/shared/src/index.ts` — tag list, strata, labelable types.
- `packages/ai/src/qa-sample.test.ts` — bind the labelable-type list to `renderLearnerView`.
- `infra/lambda/src/routes/admin.ts` — import + `admin.route('/', adminLabeling)`.
- `packages/api-client/src/index.ts` — barrel exports.
- `apps/web/components/admin/admin-nav-items.tsx` — add the nav entry.
- `apps/web/components/admin/__tests__/admin-nav.test.tsx` — its `toEqual` arrays.
- `package.json` (root) + `packages/ai/package.json` — `export:labels` script.

---

### Task 1: Schema and migration

**Files:**
- Create: `packages/db/src/schema/labeling.ts`
- Create: `packages/db/src/schema/labeling.test.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/0042_*.sql` (generated)

**Interfaces:**
- Consumes: `userExerciseHistory` from `./progress`.
- Produces: `submissionLabels` table object; types `SubmissionLabel`, `NewSubmissionLabel`. Column names on the JS side: `id`, `submissionId`, `gradeOk`, `feedbackOk`, `tags`, `critique`, `stratum`, `promptVersion`, `labeledBy`, `labeledAt`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/schema/labeling.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { submissionLabels } from './labeling';

describe('labeling schema', () => {
  it('submission_labels has the expected columns', () => {
    const cfg = getTableConfig(submissionLabels);
    expect(cfg.name).toBe('submission_labels');
    const cols = cfg.columns.map((c) => c.name).sort();
    expect(cols).toEqual(
      [
        'id',
        'submission_id',
        'grade_ok',
        'feedback_ok',
        'tags',
        'critique',
        'stratum',
        'prompt_version',
        'labeled_by',
        'labeled_at',
      ].sort(),
    );
  });

  it('is unique per (submission, labeler) so re-labelling upserts', () => {
    const cfg = getTableConfig(submissionLabels);
    const uniqueIdxCols = cfg.indexes
      .filter((i) => i.config.unique)
      .flatMap((i) => (i.config.columns ?? []).map((c) => (c as { name: string }).name));
    expect(uniqueIdxCols).toEqual(expect.arrayContaining(['submission_id', 'labeled_by']));
  });

  it('nulls grade_ok and feedback_ok by default so "unsure" is representable', () => {
    const cfg = getTableConfig(submissionLabels);
    const byName = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
    expect(byName['grade_ok'].notNull).toBe(false);
    expect(byName['feedback_ok'].notNull).toBe(false);
    expect(byName['stratum'].notNull).toBe(true);
    expect(byName['labeled_by'].notNull).toBe(true);
  });

  it('does not foreign-key labeled_by, so labels survive the labeler', () => {
    const cfg = getTableConfig(submissionLabels);
    const fkCols = cfg.foreignKeys.flatMap((fk) =>
      fk.reference().columns.map((c) => c.name),
    );
    expect(fkCols).toEqual(['submission_id']);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/feat-evaluator-labeling && pnpm --filter @language-drill/db test -- src/schema/labeling.test.ts`
Expected: FAIL — cannot resolve `./labeling`.

- [ ] **Step 3: Write the schema module**

Create `packages/db/src/schema/labeling.ts`:

```ts
import { type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { userExerciseHistory } from './progress';

// Human judgments on real learner submissions — the ground truth `pnpm eval`
// lacks. See docs/superpowers/specs/2026-09-29-evaluator-labeling-design.md.
//
// `grade_ok` and `feedback_ok` are separate because they fail independently:
// a wrong grade corrupts user_grammar_mastery, a wrong explanation misleads the
// learner while leaving progress data intact. Null on either means "unsure".
export const submissionLabels = pgTable(
  'submission_labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The attempt being judged. Cascade so right-to-erasure sweeps labels with
    // the history rows (same convention as exercise_flags.history_id).
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => userExerciseHistory.id, { onDelete: 'cascade' }),
    gradeOk: boolean('grade_ok'),
    feedbackOk: boolean('feedback_ok'),
    // Closed vocabulary — LABEL_TAGS in @language-drill/shared.
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    critique: text('critique'),
    // 'random' | 'targeted' — LABEL_STRATA in @language-drill/shared. Recorded
    // so a targeted defect hunt is never blended into a quoted quality rate.
    stratum: text('stratum').notNull(),
    // EVALUATION_SYSTEM_PROMPT_VERSION at label time; stamped server-side.
    promptVersion: text('prompt_version'),
    // Clerk user id of the admin. Deliberately NOT a foreign key to users:
    // ground truth must survive the labeler's account being deleted.
    labeledBy: text('labeled_by').notNull(),
    labeledAt: timestamp('labeled_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One label per attempt per labeler — re-labelling upserts, and a second
    // annotator later needs no migration.
    submissionLabelerUnique: uniqueIndex('submission_labels_submission_labeler_unique').on(
      table.submissionId,
      table.labeledBy,
    ),
    // Stats endpoint: per-stratum rollups, newest first.
    stratumLabeledAtIdx: index('submission_labels_stratum_labeled_at_idx').on(
      table.stratum,
      table.labeledAt,
    ),
  }),
);

export type SubmissionLabel = InferSelectModel<typeof submissionLabels>;
export type NewSubmissionLabel = InferInsertModel<typeof submissionLabels>;
```

- [ ] **Step 4: Export from the barrel**

In `packages/db/src/schema/index.ts`, after the `exercise-flags` exports, add:

```ts
export { submissionLabels } from './labeling';
export type { SubmissionLabel, NewSubmissionLabel } from './labeling';
```

This is not optional bookkeeping — `drizzle.config.ts` reads `./src/schema/index.ts`, so without it Step 6 generates an empty migration.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/db test -- src/schema/labeling.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Generate the migration**

Run: `pnpm --filter @language-drill/db db:generate`
Then `cat` the newest file in `packages/db/migrations/`.

Expected: a `CREATE TABLE "submission_labels"` with `"tags" jsonb DEFAULT '[]'::jsonb NOT NULL`, a `ON DELETE cascade` on `submission_id`, one unique index on `("submission_id","labeled_by")`, and one index on `("stratum","labeled_at")`.

If `tags` came out without the `'[]'::jsonb` default, fix it by changing the schema to `.default(sql\`'[]'::jsonb\`)` (importing `sql` from `drizzle-orm`), regenerate, and delete the superseded migration file before it is ever applied.

- [ ] **Step 7: Apply to the dev branch and confirm**

Run: `pnpm db:migrate` (reads `DATABASE_URL` from the worktree `.env`, which points at the **dev** Neon branch — never production).
Then confirm: `psql "$DATABASE_URL" -c '\d submission_labels'` — or, if psql is unavailable, re-run `pnpm db:migrate` and expect it to report no pending migrations.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema/labeling.ts packages/db/src/schema/labeling.test.ts packages/db/src/schema/index.ts packages/db/migrations/
git commit -m "Add submission_labels, the evaluator ground-truth table"
```

---

### Task 2: Shared vocabulary, bound to renderLearnerView

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/ai/src/qa-sample.test.ts`

**Interfaces:**
- Produces: `LABEL_TAGS` (readonly tuple), `LabelTag`, `LABEL_STRATA`, `LabelStratum`, `LABELABLE_EXERCISE_TYPES`, `LabelableExerciseType`. Tasks 3–8 all import these from `@language-drill/shared`.

- [ ] **Step 1: Write the failing test that binds the type list to reality**

The list of labelable types is only correct if `renderLearnerView` actually handles every member — it **throws** on anything else (`qa-sample.ts:74`), which would 500 the queue endpoint. Pin that with a test rather than a comment.

Append to `packages/ai/src/qa-sample.test.ts`:

```ts
import { LABELABLE_EXERCISE_TYPES } from '@language-drill/shared';

describe('renderLearnerView covers every labelable exercise type', () => {
  // Minimal valid content per type — enough for renderLearnerView's switch.
  const SAMPLE: Record<string, unknown> = {
    cloze: { type: 'cloze', instructions: 'Fill the blank', sentence: 'Ayer ___ al mercado.', correctAnswer: 'fui' },
    translation: {
      type: 'translation', instructions: 'Translate', sourceLanguage: 'EN', targetLanguage: 'ES',
      sourceText: 'I went to the market.', referenceTranslation: 'Fui al mercado.',
    },
    vocab_recall: { type: 'vocab_recall', instructions: 'Give the word', promptEn: 'market', expectedWord: 'mercado' },
    sentence_construction: {
      type: 'sentence_construction', instructions: 'Build a sentence',
      requiredElements: ['mercado'], modelAnswers: ['Fui al mercado.'],
    },
    conjugation: {
      type: 'conjugation', instructions: 'Conjugate', infinitive: 'ir',
      person: '1s', tenseLabel: 'preterite', targetForm: 'fui',
    },
    contextual_paraphrase: {
      type: 'contextual_paraphrase', instructions: 'Rephrase', sourceText: 'Fui al mercado.',
      constraintLabel: 'use the imperfect', referenceParaphrases: ['Iba al mercado.'],
    },
  };

  it.each(LABELABLE_EXERCISE_TYPES)('renders %s without throwing', (type) => {
    const content = SAMPLE[type];
    expect(content, `no sample content for ${type}`).toBeDefined();
    expect(() => renderLearnerView(content as never)).not.toThrow();
    expect(renderLearnerView(content as never).length).toBeGreaterThan(0);
  });
});
```

If a sample above is missing a field the real `ExerciseContent` type requires, fix the sample to match the type — do not loosen the assertion.

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @language-drill/ai test -- src/qa-sample.test.ts`
Expected: FAIL — `LABELABLE_EXERCISE_TYPES` is not exported from `@language-drill/shared`.

- [ ] **Step 3: Add the constants**

In `packages/shared/src/index.ts`, near `CORRECT_THRESHOLD`:

```ts
/**
 * Closed tag vocabulary for evaluator labels. A starting guess, not a finding —
 * expect to extend it after the first ~30 labels. Adding a tag requires editing
 * the Zod union in packages/api-client/src/schemas/labeling.ts too, or the web
 * client throws a ZodError on a row carrying the new tag.
 */
export const LABEL_TAGS = [
  'invented-error',
  'missed-real-error',
  'wrong-point-attribution',
  'alternative-rejected',
  'feedback-contradicts-score',
  'feedback-wrong-rule',
  'other',
] as const;
export type LabelTag = (typeof LABEL_TAGS)[number];

/** 'random' is the unbiased spine; 'targeted' is defect hunting. Never blend. */
export const LABEL_STRATA = ['random', 'targeted'] as const;
export type LabelStratum = (typeof LABEL_STRATA)[number];

/**
 * The exercise types the labeling queue may serve — exactly the set
 * `renderLearnerView` handles (it throws on any other, which would 500 the
 * queue endpoint; pinned by a test in packages/ai/src/qa-sample.test.ts).
 * Dictation and free-writing are evaluated by different prompts with different
 * output shapes and are deliberately out of scope.
 */
export const LABELABLE_EXERCISE_TYPES = [
  'cloze',
  'translation',
  'vocab_recall',
  'sentence_construction',
  'conjugation',
  'contextual_paraphrase',
] as const;
export type LabelableExerciseType = (typeof LABELABLE_EXERCISE_TYPES)[number];
```

- [ ] **Step 4: Build shared, then run the test to verify it passes**

Run: `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/ai test -- src/qa-sample.test.ts`
Expected: PASS, 6 new cases. (The build is required — a stale `dist` makes workspace imports resolve to the old surface and can fake either a pass or a failure.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/ai/src/qa-sample.test.ts
git commit -m "Add the label vocabulary, pinned to what renderLearnerView can render"
```

---

### Task 3: Queue endpoint

**Files:**
- Create: `infra/lambda/src/routes/admin-labeling.ts`
- Create: `infra/lambda/src/routes/admin-labeling.test.ts`
- Modify: `infra/lambda/src/routes/admin.ts`

**Interfaces:**
- Consumes: `submissionLabels` (Task 1); `LABELABLE_EXERCISE_TYPES`, `LABEL_STRATA`, `CORRECT_THRESHOLD` (Task 2); `renderLearnerView` from `@language-drill/ai`; `db` from `../db`.
- Produces: `export const adminLabeling` (Hono app); pure helpers `export function extractReferenceAnswers(content: unknown): Record<string, unknown>` and `export function safeSeed(raw: string | undefined, today: Date): string`. `GET /admin/labeling/queue` response shape: `{ items: QueueItem[], remaining: number }` where `QueueItem` is `{ submissionId, exerciseId, language, cefrLevel, exerciseType, grammarPointKey, learnerView, referenceAnswers, userAnswer, evaluation, score, evaluatedAt, optionsRevealed }`. Task 5 mirrors this shape in Zod.

- [ ] **Step 1: Write the failing tests**

Create `infra/lambda/src/routes/admin-labeling.test.ts`. Copy the DB chain mock harness verbatim from the top of `infra/lambda/src/routes/exercise-flags.test.ts` (the `queryQueue` / `makeChain` block) — it is the house pattern and hand-rolling a second one diverges.

The harness is a **FIFO queue**: each awaited chain shifts one entry. Push in the exact order the handler awaits. This handler awaits the row query first, then the remaining-count query.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
// ... harness from exercise-flags.test.ts, which must vi.mock('../db') ...
import { extractReferenceAnswers, safeSeed } from './admin-labeling';

describe('safeSeed', () => {
  it('falls back to the date when no seed is given, so a queue is resumable', () => {
    expect(safeSeed(undefined, new Date('2026-09-29T10:00:00Z'))).toBe('2026-09-29');
  });

  it('accepts a simple explicit seed', () => {
    expect(safeSeed('pass2', new Date('2026-09-29T10:00:00Z'))).toBe('pass2');
  });

  it('rejects anything that could reach SQL, since the seed is inlined', () => {
    expect(safeSeed("x'; drop table submission_labels; --", new Date('2026-09-29T10:00:00Z'))).toBe('2026-09-29');
    expect(safeSeed('a'.repeat(64), new Date('2026-09-29T10:00:00Z'))).toBe('2026-09-29');
  });
});

describe('extractReferenceAnswers', () => {
  it('pulls the cloze answer and its accepted variants', () => {
    expect(
      extractReferenceAnswers({ type: 'cloze', correctAnswer: 'fui', acceptableAnswers: ['me fui'] }),
    ).toEqual({ correctAnswer: 'fui', acceptableAnswers: ['me fui'] });
  });

  it('pulls the translation reference', () => {
    expect(
      extractReferenceAnswers({ type: 'translation', referenceTranslation: 'Fui al mercado.' }),
    ).toEqual({ referenceTranslation: 'Fui al mercado.' });
  });

  it('returns an empty object for unknown content rather than throwing', () => {
    expect(extractReferenceAnswers(null)).toEqual({});
    expect(extractReferenceAnswers({ type: 'mystery' })).toEqual({});
  });
});

describe('GET /admin/labeling/queue', () => {
  beforeEach(() => {
    queryQueue.length = 0;
  });

  const row = {
    submissionId: '11111111-1111-4111-8111-111111111111',
    exerciseId: '22222222-2222-4222-8222-222222222222',
    language: 'ES',
    cefrLevel: 'B1',
    exerciseType: 'cloze',
    grammarPointKey: 'es.b1.preterite-vs-imperfect',
    contentJson: { type: 'cloze', instructions: 'Fill the blank', sentence: 'Ayer ___ al mercado.', correctAnswer: 'fui' },
    responseJson: { userAnswer: 'iba', evaluation: { score: 0.4, feedback: 'iba is imperfect', errors: [] } },
    score: 0.4,
    evaluatedAt: new Date('2026-09-20T12:00:00Z'),
  };

  it('403s for a non-admin', async () => {
    const res = await request('/admin/labeling/queue?stratum=random', { userId: 'user_nobody' });
    expect(res.status).toBe(403);
  });

  it('400s on an unknown stratum', async () => {
    const res = await request('/admin/labeling/queue?stratum=everything', { userId: ADMIN_ID });
    expect(res.status).toBe(400);
  });

  it('renders the learner view server-side and returns the evaluation', async () => {
    queryQueue.push([row], [{ count: 42 }]);
    const res = await request('/admin/labeling/queue?stratum=random', { userId: ADMIN_ID });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.remaining).toBe(42);
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item.learnerView).toContain('Ayer ___ al mercado.');
    expect(item.learnerView).not.toContain('fui');
    expect(item.referenceAnswers).toEqual({ correctAnswer: 'fui' });
    expect(item.userAnswer).toBe('iba');
    expect(item.evaluation).toEqual(row.responseJson.evaluation);
    expect(item.exerciseType).toBe('cloze');
  });

  it('shows cloze options only when the learner actually revealed them', async () => {
    const withOptions = {
      ...row,
      contentJson: { ...row.contentJson, options: ['fui', 'iba'] },
      responseJson: { ...row.responseJson, optionsRevealed: true },
    };
    queryQueue.push([withOptions], [{ count: 1 }]);
    const res = await request('/admin/labeling/queue?stratum=random', { userId: ADMIN_ID });
    const item = (await res.json()).items[0];
    expect(item.optionsRevealed).toBe(true);
    expect(item.learnerView).toContain('Options:');
  });

  it('omits an item whose content type renderLearnerView cannot render, rather than 500ing', async () => {
    queryQueue.push([{ ...row, exerciseType: 'dictation', contentJson: { type: 'dictation' } }], [{ count: 1 }]);
    const res = await request('/admin/labeling/queue?stratum=random', { userId: ADMIN_ID });
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(0);
  });

  it('accepts the targeted stratum with filters', async () => {
    queryQueue.push([row], [{ count: 3 }]);
    const res = await request(
      '/admin/labeling/queue?stratum=targeted&language=ES&type=cloze&nearBoundary=true',
      { userId: ADMIN_ID },
    );
    expect(res.status).toBe(200);
  });
});
```

Write the `request(path, { userId })` helper in this file the way `exercise-flags.test.ts` does: build a `Hono` app, set `c.set('userId', userId)` in a middleware ahead of the router, mount `adminLabeling`, and set `process.env.ADMIN_USER_IDS = ADMIN_ID` in `beforeEach`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/feat-evaluator-labeling && pnpm --filter @language-drill/lambda test -- src/routes/admin-labeling.test.ts`
Expected: FAIL — cannot resolve `./admin-labeling`.

If you instead see a `DATABASE_URL` error, the `vi.mock('../db')` from the copied harness is missing; add it. Verify with `env -u DATABASE_URL pnpm --filter @language-drill/lambda test -- src/routes/admin-labeling.test.ts`.

- [ ] **Step 3: Write the route**

Create `infra/lambda/src/routes/admin-labeling.ts`:

```ts
/**
 * Evaluator labeling surface. Serves real learner submissions for hand-labelling
 * and stores the verdicts — the ground truth `pnpm eval` lacks (it scores a
 * candidate against `expectedOutput: trace.output`, i.e. against itself).
 *
 * Mounted from admin.ts, so it inherits `admin.use('/admin/*', authMiddleware,
 * adminMiddleware)`. No recordAdminAction: a label mutates nothing a learner can
 * see, and the audit action union carries a web-side ripple that would buy
 * nothing here.
 *
 * See docs/superpowers/specs/2026-09-29-evaluator-labeling-design.md.
 */
import { CORRECT_THRESHOLD, LABELABLE_EXERCISE_TYPES, LABEL_STRATA } from '@language-drill/shared';
import { exercises, submissionLabels, userExerciseHistory } from '@language-drill/db';
import { renderLearnerView } from '@language-drill/ai';
import { Hono } from 'hono';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db';
import type { Bindings, Variables } from '../middleware/auth';

export const adminLabeling = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/** How far below/above the pass mark counts as "near the boundary". */
const NEAR_BOUNDARY_BELOW = 0.2;
const NEAR_BOUNDARY_ABOVE = 0.1;

const QueueQuerySchema = z.object({
  stratum: z.enum(LABEL_STRATA),
  language: z.enum(['ES', 'DE', 'TR']).optional(),
  type: z.enum(LABELABLE_EXERCISE_TYPES).optional(),
  grammarPoint: z.string().max(120).optional(),
  nearBoundary: z.enum(['true', 'false']).optional(),
  scoreMin: z.coerce.number().min(0).max(1).optional(),
  scoreMax: z.coerce.number().min(0).max(1).optional(),
  hasErrors: z.enum(['true', 'false']).optional(),
  seed: z.string().max(32).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * The seed is INLINED into the ORDER BY expression, not bound — a bound literal
 * inside a SQL function has broken before in this codebase, and typecheck plus
 * tests are both blind to it. So it must be sanitized here: anything but
 * `[A-Za-z0-9-]{1,32}` falls back to today's date.
 */
export function safeSeed(raw: string | undefined, today: Date): string {
  const fallback = today.toISOString().slice(0, 10);
  if (raw === undefined) return fallback;
  return /^[A-Za-z0-9-]{1,32}$/.test(raw) ? raw : fallback;
}

/** Reference/answer fields per content type — rendered in their own panel, never merged into the stimulus. */
export function extractReferenceAnswers(content: unknown): Record<string, unknown> {
  if (content === null || typeof content !== 'object') return {};
  const c = content as Record<string, unknown>;
  const keep = [
    'correctAnswer',
    'acceptableAnswers',
    'referenceTranslation',
    'acceptableTranslations',
    'expectedWord',
    'modelAnswers',
    'targetForm',
    'acceptableForms',
    'referenceParaphrases',
  ];
  const out: Record<string, unknown> = {};
  for (const k of keep) {
    if (c[k] !== undefined && c[k] !== null) out[k] = c[k];
  }
  return out;
}

adminLabeling.get('/admin/labeling/queue', async (c) => {
  const parsed = QueueQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const q = parsed.data;
  const labeler = c.get('userId');
  const limit = q.limit ?? 25;

  const conditions = [
    // Deterministic-source rows had no LLM judgment, so there is nothing to label.
    sql`${userExerciseHistory.responseJson}->'evaluation'->>'evaluationSource' IS DISTINCT FROM 'deterministic'`,
    // renderLearnerView throws outside this set; dictation/free-writing are other prompts entirely.
    inArray(exercises.type, [...LABELABLE_EXERCISE_TYPES]),
    // Unlabelled by THIS labeler (labels are per-labeler).
    sql`NOT EXISTS (
      SELECT 1 FROM ${submissionLabels} sl
      WHERE sl.submission_id = ${userExerciseHistory.id} AND sl.labeled_by = ${labeler}
    )`,
  ];

  if (q.language) conditions.push(eq(exercises.language, q.language));
  if (q.type) conditions.push(eq(exercises.type, q.type));
  if (q.grammarPoint) conditions.push(eq(exercises.grammarPointKey, q.grammarPoint));
  if (q.hasErrors === 'true') {
    conditions.push(
      sql`jsonb_array_length(COALESCE(${userExerciseHistory.responseJson}->'evaluation'->'errors', '[]'::jsonb)) > 0`,
    );
  }
  if (q.nearBoundary === 'true') {
    conditions.push(gte(userExerciseHistory.score, CORRECT_THRESHOLD - NEAR_BOUNDARY_BELOW));
    conditions.push(lte(userExerciseHistory.score, CORRECT_THRESHOLD + NEAR_BOUNDARY_ABOVE));
  }
  if (q.scoreMin !== undefined) conditions.push(gte(userExerciseHistory.score, q.scoreMin));
  if (q.scoreMax !== undefined) conditions.push(lte(userExerciseHistory.score, q.scoreMax));

  const where = and(...conditions);
  const seed = safeSeed(q.seed, new Date());
  // Stable pseudo-random order: a refresh must not reshuffle, a session must be
  // resumable, and a sample we quote a production rate from must be replayable.
  const order =
    q.stratum === 'random'
      ? sql.raw(`md5(user_exercise_history.id::text || '${seed}')`)
      : sql`abs(${userExerciseHistory.score} - ${CORRECT_THRESHOLD}) asc, ${userExerciseHistory.evaluatedAt} desc`;

  const rows = await db
    .select({
      submissionId: userExerciseHistory.id,
      exerciseId: exercises.id,
      language: exercises.language,
      cefrLevel: exercises.difficulty,
      exerciseType: exercises.type,
      grammarPointKey: exercises.grammarPointKey,
      contentJson: exercises.contentJson,
      responseJson: userExerciseHistory.responseJson,
      score: userExerciseHistory.score,
      evaluatedAt: userExerciseHistory.evaluatedAt,
    })
    .from(userExerciseHistory)
    .innerJoin(exercises, eq(exercises.id, userExerciseHistory.exerciseId))
    .where(where)
    .orderBy(order)
    .limit(limit);

  const remainingRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(userExerciseHistory)
    .innerJoin(exercises, eq(exercises.id, userExerciseHistory.exerciseId))
    .where(where);

  const items = rows.flatMap((r) => {
    const resp = (r.responseJson ?? {}) as {
      userAnswer?: unknown;
      evaluation?: unknown;
      optionsRevealed?: unknown;
    };
    const optionsRevealed = resp.optionsRevealed === true;
    let learnerView: string;
    try {
      // Reproduce what the learner actually saw: options sit behind a toggle in
      // production, so only include them when this attempt revealed them.
      learnerView = renderLearnerView(r.contentJson as never, { includeOptions: optionsRevealed });
    } catch {
      // A content type outside LABELABLE_EXERCISE_TYPES slipped through (stale
      // row, renamed type). Drop the item; never 500 the whole page for one row.
      return [];
    }
    return [
      {
        submissionId: r.submissionId,
        exerciseId: r.exerciseId,
        language: r.language,
        cefrLevel: r.cefrLevel,
        exerciseType: r.exerciseType,
        grammarPointKey: r.grammarPointKey,
        learnerView,
        referenceAnswers: extractReferenceAnswers(r.contentJson),
        userAnswer: resp.userAnswer ?? null,
        evaluation: resp.evaluation ?? null,
        score: r.score,
        evaluatedAt: r.evaluatedAt ? r.evaluatedAt.toISOString() : null,
        optionsRevealed,
      },
    ];
  });

  return c.json({ items, remaining: Number(remainingRows[0]?.count ?? 0) });
});
```

- [ ] **Step 4: Mount it**

In `infra/lambda/src/routes/admin.ts`, beside the existing `import { adminDiversity } from './admin-diversity';` (line ~50) add:

```ts
import { adminLabeling } from './admin-labeling';
```

and beside `admin.route('/', adminDiversity);` (line ~69) add:

```ts
admin.route('/', adminLabeling);
```

Both lines must sit **after** `admin.use('/admin/*', authMiddleware, adminMiddleware);` (line ~67) so the gate is inherited rather than re-declared.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda test -- src/routes/admin-labeling.test.ts`
Expected: PASS, 12 tests.

If the `renders the learner view` case fails on `remaining`, the FIFO push order is wrong: the handler awaits rows first, then the count. Re-derive the order from the handler rather than adjusting the numbers until they match.

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/routes/admin-labeling.ts infra/lambda/src/routes/admin-labeling.test.ts infra/lambda/src/routes/admin.ts
git commit -m "Serve a labeling queue over real learner submissions"
```

---

### Task 4: Save and stats endpoints

**Files:**
- Modify: `infra/lambda/src/routes/admin-labeling.ts`
- Modify: `infra/lambda/src/routes/admin-labeling.test.ts`

**Interfaces:**
- Consumes: `adminLabeling` (Task 3), `EVALUATION_SYSTEM_PROMPT_VERSION` from `@language-drill/ai`.
- Produces: `POST /admin/labeling/:submissionId` → `{ saved: true, promptVersion: string }`; `GET /admin/labeling/stats` → `{ strata: Array<{ stratum, count, gradeOkRate, feedbackOkRate }>, tags: Array<{ tag, count }>, labeledToday: number }`. Task 5 mirrors both in Zod.

- [ ] **Step 1: Write the failing tests**

Append to `infra/lambda/src/routes/admin-labeling.test.ts`:

```ts
describe('POST /admin/labeling/:submissionId', () => {
  const SUB = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    queryQueue.length = 0;
  });

  it('403s for a non-admin', async () => {
    const res = await post(`/admin/labeling/${SUB}`, { gradeOk: true, feedbackOk: true, stratum: 'random' }, { userId: 'user_nobody' });
    expect(res.status).toBe(403);
  });

  it('400s when a false verdict carries no critique', async () => {
    const res = await post(`/admin/labeling/${SUB}`, { gradeOk: false, feedbackOk: true, stratum: 'random' }, { userId: ADMIN_ID });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('CRITIQUE_REQUIRED');
  });

  it('accepts a false verdict that explains itself', async () => {
    queryQueue.push([{ id: SUB }], []);
    const res = await post(
      `/admin/labeling/${SUB}`,
      { gradeOk: false, feedbackOk: true, stratum: 'random', tags: ['alternative-rejected'], critique: 'me fui is also correct' },
      { userId: ADMIN_ID },
    );
    expect(res.status).toBe(200);
    // `insertedValuesByTable` is keyed by whatever sentinel the copied harness
    // uses for a mocked table — read the harness in exercise-flags.test.ts and
    // use its key here rather than assuming the SQL table name.
    const saved = Object.values(insertedValuesByTable)[0] as Record<string, unknown>;
    expect(saved.gradeOk).toBe(false);
    expect(saved.tags).toEqual(['alternative-rejected']);
    expect(saved.labeledBy).toBe(ADMIN_ID);
  });

  it('rejects a body that tries to set promptVersion or labeledBy itself', async () => {
    queryQueue.push([{ id: SUB }], []);
    const res = await post(
      `/admin/labeling/${SUB}`,
      { gradeOk: true, feedbackOk: true, stratum: 'random', labeledBy: 'user_someone_else', promptVersion: 'evaluate@1999-01-01' },
      { userId: ADMIN_ID },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('404s when the submission does not exist', async () => {
    queryQueue.push([]);
    const res = await post(`/admin/labeling/${SUB}`, { gradeOk: true, feedbackOk: true, stratum: 'random' }, { userId: ADMIN_ID });
    expect(res.status).toBe(404);
  });

  it('accepts unsure on both axes without a critique', async () => {
    queryQueue.push([{ id: SUB }], []);
    const res = await post(`/admin/labeling/${SUB}`, { gradeOk: null, feedbackOk: null, stratum: 'random' }, { userId: ADMIN_ID });
    expect(res.status).toBe(200);
  });

  it('rejects a tag outside the closed vocabulary', async () => {
    const res = await post(
      `/admin/labeling/${SUB}`,
      { gradeOk: true, feedbackOk: true, stratum: 'random', tags: ['vibes-off'] },
      { userId: ADMIN_ID },
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /admin/labeling/stats', () => {
  beforeEach(() => {
    queryQueue.length = 0;
  });

  it('reports each stratum separately so the two are never blended', async () => {
    queryQueue.push(
      [
        { stratum: 'random', count: 40, gradeOk: 34, feedbackOk: 31 },
        { stratum: 'targeted', count: 12, gradeOk: 4, feedbackOk: 6 },
      ],
      [{ tag: 'alternative-rejected', count: 5 }],
      [{ count: 7 }],
    );
    const res = await request('/admin/labeling/stats', { userId: ADMIN_ID });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strata).toEqual([
      { stratum: 'random', count: 40, gradeOkRate: 0.85, feedbackOkRate: 0.775 },
      { stratum: 'targeted', count: 12, gradeOkRate: 1 / 3, feedbackOkRate: 0.5 },
    ]);
    expect(body.tags).toEqual([{ tag: 'alternative-rejected', count: 5 }]);
    expect(body.labeledToday).toBe(7);
  });

  it('reports a 0 rate when every label in a stratum says not-ok', async () => {
    queryQueue.push([{ stratum: 'random', count: 3, gradeOk: 0, feedbackOk: 0 }], [], [{ count: 0 }]);
    const body = await (await request('/admin/labeling/stats', { userId: ADMIN_ID })).json();
    expect(body.strata[0].gradeOkRate).toBe(0);
    expect(body.strata[0].count).toBe(3);
  });

  it('survives an empty table without dividing by zero', async () => {
    queryQueue.push([], [], [{ count: 0 }]);
    const body = await (await request('/admin/labeling/stats', { userId: ADMIN_ID })).json();
    expect(body.strata).toEqual([]);
    expect(body.labeledToday).toBe(0);
  });
});
```

Add a `post(path, body, { userId })` helper mirroring `request`, sending `method: 'POST'` with a JSON body.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/lambda test -- src/routes/admin-labeling.test.ts`
Expected: FAIL — 404 from Hono on the new paths.

- [ ] **Step 3: Implement both endpoints**

Append to `infra/lambda/src/routes/admin-labeling.ts`:

```ts
const SaveLabelSchema = z
  .object({
    gradeOk: z.boolean().nullable(),
    feedbackOk: z.boolean().nullable(),
    stratum: z.enum(LABEL_STRATA),
    tags: z.array(z.enum(LABEL_TAGS)).max(LABEL_TAGS.length).optional(),
    critique: z.string().trim().max(2000).optional(),
  })
  // labeledBy and promptVersion are stamped server-side. A body that supplies
  // either is a client bug, so fail loudly instead of silently ignoring it.
  .strict();

adminLabeling.post('/admin/labeling/:submissionId', async (c) => {
  const submissionId = c.req.param('submissionId');
  if (!z.string().uuid().safeParse(submissionId).success) {
    return c.json({ error: 'Invalid submission id', code: 'VALIDATION_ERROR' }, 400);
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, 400);
  }
  const parsed = SaveLabelSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'Invalid label', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { gradeOk, feedbackOk, stratum, tags, critique } = parsed.data;

  // A bare `false` is unusable three weeks later, and the critique is the raw
  // material the next tag comes from.
  const hasFalse = gradeOk === false || feedbackOk === false;
  if (hasFalse && (critique === undefined || critique.length === 0)) {
    return c.json({ error: 'Explain what was wrong', code: 'CRITIQUE_REQUIRED' }, 400);
  }

  const exists = await db
    .select({ id: userExerciseHistory.id })
    .from(userExerciseHistory)
    .where(eq(userExerciseHistory.id, submissionId))
    .limit(1);
  if (exists.length === 0) {
    return c.json({ error: 'Submission not found', code: 'SUBMISSION_NOT_FOUND' }, 404);
  }

  const labeledBy = c.get('userId');
  const labeledAt = new Date();
  await db
    .insert(submissionLabels)
    .values({
      submissionId,
      gradeOk,
      feedbackOk,
      tags: tags ?? [],
      critique: critique ?? null,
      stratum,
      promptVersion: EVALUATION_SYSTEM_PROMPT_VERSION,
      labeledBy,
      labeledAt,
    })
    .onConflictDoUpdate({
      target: [submissionLabels.submissionId, submissionLabels.labeledBy],
      set: {
        gradeOk,
        feedbackOk,
        tags: tags ?? [],
        critique: critique ?? null,
        stratum,
        promptVersion: EVALUATION_SYSTEM_PROMPT_VERSION,
        labeledAt,
      },
    });

  return c.json({ saved: true, promptVersion: EVALUATION_SYSTEM_PROMPT_VERSION });
});

adminLabeling.get('/admin/labeling/stats', async (c) => {
  const perStratum = await db
    .select({
      stratum: submissionLabels.stratum,
      count: sql<number>`count(*)`,
      gradeOk: sql<number>`count(*) filter (where ${submissionLabels.gradeOk} = true)`,
      feedbackOk: sql<number>`count(*) filter (where ${submissionLabels.feedbackOk} = true)`,
    })
    .from(submissionLabels)
    .groupBy(submissionLabels.stratum)
    .orderBy(submissionLabels.stratum);

  const tagRows = await db
    .select({
      tag: sql<string>`jsonb_array_elements_text(${submissionLabels.tags})`,
      count: sql<number>`count(*)`,
    })
    .from(submissionLabels)
    .groupBy(sql`jsonb_array_elements_text(${submissionLabels.tags})`)
    .orderBy(sql`count(*) desc`);

  const todayRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(submissionLabels)
    .where(sql`${submissionLabels.labeledAt} >= date_trunc('day', now())`);

  return c.json({
    strata: perStratum.map((r) => {
      const count = Number(r.count);
      return {
        stratum: r.stratum,
        count,
        gradeOkRate: count === 0 ? 0 : Number(r.gradeOk) / count,
        feedbackOkRate: count === 0 ? 0 : Number(r.feedbackOk) / count,
      };
    }),
    tags: tagRows.map((r) => ({ tag: r.tag, count: Number(r.count) })),
    labeledToday: Number(todayRows[0]?.count ?? 0),
  });
});
```

Add to the imports at the top of the file:

```ts
import { EVALUATION_SYSTEM_PROMPT_VERSION } from '@language-drill/ai';
import { LABEL_TAGS } from '@language-drill/shared';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda test -- src/routes/admin-labeling.test.ts`
Expected: PASS, 22 tests.

If the `stats` test fails on the tag row, check the `GROUP BY`: this codebase has hit a Drizzle bug where a **bound** literal inside `GROUP BY` breaks at runtime while typecheck and tests stay green. The expression above repeats the column reference rather than binding a literal, which is the safe form — do not "simplify" it to a positional `groupBy(1)`.

- [ ] **Step 5: Run the whole lambda package**

Run: `pnpm --filter @language-drill/lambda test`
Expected: PASS. If unrelated route tests now fail, suspect stale build output: `rm -rf infra/lambda/dist` and re-run.

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/routes/admin-labeling.ts infra/lambda/src/routes/admin-labeling.test.ts
git commit -m "Save evaluator labels, and report each stratum separately"
```

---

### Task 5: api-client schemas and hooks

**Files:**
- Create: `packages/api-client/src/schemas/labeling.ts`
- Create: `packages/api-client/src/hooks/useLabeling.ts`
- Create: `packages/api-client/src/hooks/useLabeling.test.ts`
- Modify: `packages/api-client/src/index.ts`

**Interfaces:**
- Consumes: the wire shapes from Tasks 3–4; `AuthenticatedFetch` from `../fetchClient`.
- Produces: `LabelQueueItemSchema`, `LabelQueueResponseSchema`, `SaveLabelResponseSchema`, `LabelingStatsSchema`, types `LabelQueueItem`, `LabelingStats`; hooks `useLabelingQueue({ fetchFn, stratum, filters, enabled })`, `useSaveLabel({ fetchFn })` (mutation variables: `{ submissionId, gradeOk, feedbackOk, tags, critique, stratum }`), `useLabelingStats({ fetchFn })`. Task 6 consumes exactly these names.

- [ ] **Step 1: Write the failing test**

Create `packages/api-client/src/hooks/useLabeling.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LABEL_TAGS } from '@language-drill/shared';
import { LabelQueueResponseSchema, LabelingStatsSchema } from '../schemas/labeling';

describe('labeling schemas', () => {
  const item = {
    submissionId: '11111111-1111-4111-8111-111111111111',
    exerciseId: '22222222-2222-4222-8222-222222222222',
    language: 'ES',
    cefrLevel: 'B1',
    exerciseType: 'cloze',
    grammarPointKey: 'es.b1.preterite-vs-imperfect',
    learnerView: 'Fill the blank\nAyer ___ al mercado.',
    referenceAnswers: { correctAnswer: 'fui' },
    userAnswer: 'iba',
    evaluation: { score: 0.4, feedback: 'iba is imperfect', errors: [] },
    score: 0.4,
    evaluatedAt: '2026-09-20T12:00:00.000Z',
    optionsRevealed: false,
  };

  it('parses a queue response', () => {
    const parsed = LabelQueueResponseSchema.parse({ items: [item], remaining: 42 });
    expect(parsed.items[0].learnerView).toContain('Ayer');
    expect(parsed.remaining).toBe(42);
  });

  it('tolerates a null grammar point and a null evaluatedAt', () => {
    expect(() =>
      LabelQueueResponseSchema.parse({
        items: [{ ...item, grammarPointKey: null, evaluatedAt: null }],
        remaining: 0,
      }),
    ).not.toThrow();
  });

  it('accepts every tag in the shared vocabulary — a missing one throws in prod', () => {
    const stats = {
      strata: [{ stratum: 'random', count: 10, gradeOkRate: 0.8, feedbackOkRate: 0.9 }],
      tags: LABEL_TAGS.map((tag) => ({ tag, count: 1 })),
      labeledToday: 3,
    };
    expect(LabelingStatsSchema.parse(stats).tags).toHaveLength(LABEL_TAGS.length);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/api-client test -- src/hooks/useLabeling.test.ts`
Expected: FAIL — cannot resolve `../schemas/labeling`.

- [ ] **Step 3: Write the schemas**

Create `packages/api-client/src/schemas/labeling.ts`:

```ts
import { z } from 'zod';
import { LABEL_STRATA, LABEL_TAGS } from '@language-drill/shared';

export const LabelTagEnum = z.enum(LABEL_TAGS);
export type LabelTagValue = z.infer<typeof LabelTagEnum>;

export const LabelStratumEnum = z.enum(LABEL_STRATA);
export type LabelStratumValue = z.infer<typeof LabelStratumEnum>;

export const LabelQueueItemSchema = z.object({
  submissionId: z.string(),
  exerciseId: z.string(),
  language: z.string().nullable(),
  cefrLevel: z.string().nullable(),
  exerciseType: z.string().nullable(),
  grammarPointKey: z.string().nullable(),
  learnerView: z.string(),
  referenceAnswers: z.record(z.unknown()),
  userAnswer: z.unknown(),
  evaluation: z.unknown(),
  score: z.number().nullable(),
  evaluatedAt: z.string().nullable(),
  optionsRevealed: z.boolean(),
});
export type LabelQueueItem = z.infer<typeof LabelQueueItemSchema>;

export const LabelQueueResponseSchema = z.object({
  items: z.array(LabelQueueItemSchema),
  remaining: z.number(),
});
export type LabelQueueResponse = z.infer<typeof LabelQueueResponseSchema>;

export const SaveLabelResponseSchema = z.object({
  saved: z.literal(true),
  promptVersion: z.string(),
});

export const LabelingStatsSchema = z.object({
  strata: z.array(
    z.object({
      stratum: z.string(),
      count: z.number(),
      gradeOkRate: z.number(),
      feedbackOkRate: z.number(),
    }),
  ),
  tags: z.array(z.object({ tag: LabelTagEnum, count: z.number() })),
  labeledToday: z.number(),
});
export type LabelingStats = z.infer<typeof LabelingStatsSchema>;
```

- [ ] **Step 4: Write the hooks**

Create `packages/api-client/src/hooks/useLabeling.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import {
  LabelQueueResponseSchema,
  LabelingStatsSchema,
  SaveLabelResponseSchema,
  type LabelStratumValue,
  type LabelTagValue,
} from '../schemas/labeling';

export interface LabelingFilters {
  language?: string;
  type?: string;
  grammarPoint?: string;
  nearBoundary?: boolean;
  hasErrors?: boolean;
  scoreMin?: number;
  scoreMax?: number;
  seed?: string;
  limit?: number;
}

function toQuery(stratum: LabelStratumValue, filters: LabelingFilters): string {
  const params = new URLSearchParams({ stratum });
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export function useLabelingQueue({
  fetchFn,
  stratum,
  filters = {},
  enabled = true,
}: {
  fetchFn: AuthenticatedFetch;
  stratum: LabelStratumValue;
  filters?: LabelingFilters;
  enabled?: boolean;
}) {
  const query = toQuery(stratum, filters);
  return useQuery({
    queryKey: ['admin', 'labeling', 'queue', query],
    queryFn: async () => {
      const res = await fetchFn(`/admin/labeling/queue?${query}`);
      const json: unknown = await res.json();
      return LabelQueueResponseSchema.parse(json);
    },
    enabled,
    // A labelled row leaves the queue server-side; refetching mid-session would
    // reshuffle what is on screen under the labeler's hands.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useSaveLabel({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<
    { saved: true; promptVersion: string },
    Error,
    {
      submissionId: string;
      gradeOk: boolean | null;
      feedbackOk: boolean | null;
      stratum: LabelStratumValue;
      tags?: LabelTagValue[];
      critique?: string;
    }
  >({
    mutationFn: async ({ submissionId, ...body }) => {
      const res = await fetchFn(`/admin/labeling/${submissionId}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const json: unknown = await res.json();
      return SaveLabelResponseSchema.parse(json);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'labeling', 'stats'] });
    },
  });
}

export function useLabelingStats({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  return useQuery({
    queryKey: ['admin', 'labeling', 'stats'],
    queryFn: async () => {
      const res = await fetchFn('/admin/labeling/stats');
      const json: unknown = await res.json();
      return LabelingStatsSchema.parse(json);
    },
  });
}
```

- [ ] **Step 5: Export from the barrel**

In `packages/api-client/src/index.ts`, next to the `user-flags` block (~line 480):

```ts
export {
  LabelTagEnum, type LabelTagValue,
  LabelStratumEnum, type LabelStratumValue,
  LabelQueueItemSchema, type LabelQueueItem,
  LabelQueueResponseSchema, type LabelQueueResponse,
  SaveLabelResponseSchema,
  LabelingStatsSchema, type LabelingStats,
} from './schemas/labeling';
export {
  useLabelingQueue, useSaveLabel, useLabelingStats, type LabelingFilters,
} from './hooks/useLabeling';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/api-client test -- src/hooks/useLabeling.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/api-client/src/schemas/labeling.ts packages/api-client/src/hooks/useLabeling.ts packages/api-client/src/hooks/useLabeling.test.ts packages/api-client/src/index.ts
git commit -m "Add the labeling wire schemas and query hooks"
```

---

### Task 6: The labeling page

**Files:**
- Create: `apps/web/app/(admin)/admin/labeling/page.tsx`
- Create: `apps/web/app/(admin)/admin/labeling/_components/submission-card.tsx`
- Create: `apps/web/app/(admin)/admin/labeling/_components/label-bar.tsx`
- Create: `apps/web/app/(admin)/admin/labeling/__tests__/submission-card.test.tsx`
- Create: `apps/web/app/(admin)/admin/labeling/__tests__/labeling-page.test.tsx`
- Modify: `apps/web/components/admin/admin-nav-items.tsx`
- Modify: `apps/web/components/admin/__tests__/admin-nav.test.tsx`

**Interfaces:**
- Consumes: `useLabelingQueue`, `useSaveLabel`, `useLabelingStats`, `LabelQueueItem` (Task 5); `LABEL_TAGS` (Task 2).
- Produces: `SubmissionCard({ item })`, `LabelBar({ draft, onChange, error, disabled, critiqueRef })` plus the exported `LabelDraft` type, default-exported `LabelingPage`.

> **Named deviation from the spec.** The spec says saving is *optimistic* and
> advances immediately, with a failed save re-queueing the row. This plan awaits
> the save and then advances, keeping the row and the draft on screen on failure.
> The requirement behind the spec wording — never silently lose a label — is met
> either way, and awaiting removes a re-queue path that would be the only place
> in the page able to lose one. The cost is a visible pause per label on a slow
> connection. If that pause turns out to be annoying in practice, revisit it
> after the first real labelling pass; do not "fix" it speculatively here.

- [ ] **Step 1: Write the failing component test**

Create `apps/web/app/(admin)/admin/labeling/__tests__/submission-card.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { LabelQueueItem } from '@language-drill/api-client';
import { SubmissionCard } from '../_components/submission-card';

const base: LabelQueueItem = {
  submissionId: '11111111-1111-4111-8111-111111111111',
  exerciseId: '22222222-2222-4222-8222-222222222222',
  language: 'ES',
  cefrLevel: 'B1',
  exerciseType: 'cloze',
  grammarPointKey: 'es.b1.preterite-vs-imperfect',
  learnerView: 'Fill the blank\nAyer ___ al mercado.',
  referenceAnswers: { correctAnswer: 'fui', acceptableAnswers: ['me fui'] },
  userAnswer: 'iba',
  evaluation: {
    score: 0.4,
    grammarAccuracy: 0.3,
    taskAchievement: 0.5,
    vocabularyRange: 0.8,
    feedback: 'iba is the imperfect; the adverbial forces the preterite.',
    errors: [{ type: 'grammar', grammarPointKey: 'es.b1.preterite-vs-imperfect', explanation: 'wrong aspect' }],
  },
  score: 0.4,
  evaluatedAt: '2026-09-20T12:00:00.000Z',
  optionsRevealed: false,
};

describe('SubmissionCard', () => {
  it('shows the stimulus, the answer, the reference and the evaluation', () => {
    render(<SubmissionCard item={base} />);
    expect(screen.getByText(/Ayer ___ al mercado/)).toBeInTheDocument();
    expect(screen.getByText('iba')).toBeInTheDocument();
    expect(screen.getByText(/fui/)).toBeInTheDocument();
    expect(screen.getByText(/the adverbial forces the preterite/)).toBeInTheDocument();
    expect(screen.getByText(/es\.b1\.preterite-vs-imperfect/)).toBeInTheDocument();
  });

  it('renders an evaluation with no errors without crashing', () => {
    render(<SubmissionCard item={{ ...base, evaluation: { score: 1, feedback: 'Correct.', errors: [] } }} />);
    expect(screen.getByText('Correct.')).toBeInTheDocument();
  });

  it('renders when the evaluation is missing entirely', () => {
    render(<SubmissionCard item={{ ...base, evaluation: null }} />);
    expect(screen.getByText(/no evaluation/i)).toBeInTheDocument();
  });

  it('marks a row where the learner revealed the options', () => {
    render(<SubmissionCard item={{ ...base, optionsRevealed: true }} />);
    expect(screen.getByText(/options revealed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/web test -- app/\(admin\)/admin/labeling`
Expected: FAIL — cannot resolve `../_components/submission-card`.

- [ ] **Step 3: Write SubmissionCard**

Create `apps/web/app/(admin)/admin/labeling/_components/submission-card.tsx`:

```tsx
'use client';

import * as React from 'react';
import type { LabelQueueItem } from '@language-drill/api-client';

type Evaluation = {
  score?: number;
  grammarAccuracy?: number;
  taskAchievement?: number;
  vocabularyRange?: number;
  estimatedCefrEvidence?: string;
  feedback?: string;
  errors?: Array<{ type?: string; grammarPointKey?: string | null; explanation?: string }>;
};

function Dimension({ label, value }: { label: string; value: number | undefined }) {
  if (typeof value !== 'number') return null;
  return (
    <span className="text-[12px] text-ink-soft">
      {label} <span className="text-ink tabular-nums">{value.toFixed(2)}</span>
    </span>
  );
}

function renderReference(value: unknown): string {
  if (Array.isArray(value)) return value.join(' / ');
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export interface SubmissionCardProps {
  item: LabelQueueItem;
}

export function SubmissionCard({ item }: SubmissionCardProps) {
  const evaluation = (item.evaluation ?? null) as Evaluation | null;
  const refEntries = Object.entries(item.referenceAnswers ?? {});

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-rule bg-paper p-4">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-soft">
        <span className="font-medium text-ink">{item.language ?? '—'} {item.cefrLevel ?? ''}</span>
        <span>· {item.exerciseType ?? '—'}</span>
        {item.grammarPointKey && <span>· {item.grammarPointKey}</span>}
        {item.evaluatedAt && <span>· {new Date(item.evaluatedAt).toLocaleDateString()}</span>}
        {item.optionsRevealed && <span>· options revealed</span>}
      </div>

      {/* Stimulus first: form the judgment before the model's answer is visible. */}
      <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed text-ink">
        {item.learnerView}
      </pre>

      <div className="flex flex-col gap-1 border-t border-rule pt-3 text-[14px]">
        <div>
          <span className="text-[12px] uppercase tracking-wide text-ink-soft">learner typed</span>{' '}
          <span className="font-medium text-ink">
            {typeof item.userAnswer === 'string' ? item.userAnswer : JSON.stringify(item.userAnswer)}
          </span>
        </div>
        {refEntries.map(([key, value]) => (
          <div key={key}>
            <span className="text-[12px] uppercase tracking-wide text-ink-soft">{key}</span>{' '}
            <span className="text-ink">{renderReference(value)}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-rule pt-3">
        {evaluation === null ? (
          <p className="text-[13px] text-ink-soft">No evaluation stored for this attempt.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[12px] uppercase tracking-wide text-ink-soft">Claude said</span>
              <Dimension label="score" value={evaluation.score} />
              <Dimension label="grammar" value={evaluation.grammarAccuracy} />
              <Dimension label="task" value={evaluation.taskAchievement} />
              <Dimension label="vocab" value={evaluation.vocabularyRange} />
            </div>
            {evaluation.feedback && <p className="text-[14px] text-ink">{evaluation.feedback}</p>}
            {(evaluation.errors ?? []).length > 0 && (
              <ul className="flex flex-col gap-1">
                {(evaluation.errors ?? []).map((err, i) => (
                  <li key={i} className="text-[13px] text-ink-soft">
                    [{err.type ?? '—'} → {err.grammarPointKey ?? 'unattributed'}] {err.explanation ?? ''}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the card test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- app/\(admin\)/admin/labeling`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit the card**

```bash
git add "apps/web/app/(admin)/admin/labeling/_components/submission-card.tsx" "apps/web/app/(admin)/admin/labeling/__tests__/submission-card.test.tsx"
git commit -m "Render one submission with its whole judging context"
```

- [ ] **Step 6: Write the failing page test**

Create `apps/web/app/(admin)/admin/labeling/__tests__/labeling-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const saveMutate = vi.fn();
const queueData = {
  items: [
    {
      submissionId: 'sub-1', exerciseId: 'ex-1', language: 'ES', cefrLevel: 'B1',
      exerciseType: 'cloze', grammarPointKey: 'es.b1.x',
      learnerView: 'Ayer ___ al mercado.', referenceAnswers: { correctAnswer: 'fui' },
      userAnswer: 'iba', evaluation: { score: 0.4, feedback: 'nope', errors: [] },
      score: 0.4, evaluatedAt: null, optionsRevealed: false,
    },
    {
      submissionId: 'sub-2', exerciseId: 'ex-2', language: 'TR', cefrLevel: 'A2',
      exerciseType: 'translation', grammarPointKey: 'tr.a2.y',
      learnerView: 'Translate: I went.', referenceAnswers: { referenceTranslation: 'Gittim.' },
      userAnswer: 'gidiyorum', evaluation: { score: 0.5, feedback: 'tense', errors: [] },
      score: 0.5, evaluatedAt: null, optionsRevealed: false,
    },
  ],
  remaining: 2,
};

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock('@language-drill/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@language-drill/api-client')>()),
  createAuthenticatedFetch: () => vi.fn(),
  useLabelingQueue: () => ({ data: queueData, isLoading: false, isError: false }),
  useSaveLabel: () => ({ mutate: saveMutate, mutateAsync: saveMutate, isPending: false }),
  useLabelingStats: () => ({ data: { strata: [], tags: [], labeledToday: 0 }, isLoading: false }),
}));

import LabelingPage from '../page';

describe('LabelingPage', () => {
  beforeEach(() => {
    saveMutate.mockReset();
    saveMutate.mockResolvedValue({ saved: true, promptVersion: 'evaluate@2026-09-22' });
  });

  it('shows the first queued submission', () => {
    render(<LabelingPage />);
    expect(screen.getByText(/Ayer ___ al mercado/)).toBeInTheDocument();
  });

  it('records grade-wrong on "f" and feedback-ok on "k", then saves on Enter', async () => {
    render(<LabelingPage />);
    fireEvent.keyDown(window, { key: 'f' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.change(screen.getByLabelText(/critique/i), { target: { value: 'me fui is fine' } });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1));
    expect(saveMutate.mock.calls[0][0]).toMatchObject({
      submissionId: 'sub-1',
      gradeOk: false,
      feedbackOk: true,
      critique: 'me fui is fine',
      stratum: 'random',
    });
  });

  it('advances to the next submission after a save', async () => {
    render(<LabelingPage />);
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/Translate: I went/)).toBeInTheDocument());
  });

  it('refuses to save a wrong verdict with no critique, and does not advance', async () => {
    render(<LabelingPage />);
    fireEvent.keyDown(window, { key: 'f' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(saveMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/say what was wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/Ayer ___ al mercado/)).toBeInTheDocument();
  });

  it('does not fire a shortcut while the critique box has focus', async () => {
    render(<LabelingPage />);
    const box = screen.getByLabelText(/critique/i);
    box.focus();
    fireEvent.keyDown(box, { key: 'f' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(saveMutate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run to verify failure**

Run: `pnpm --filter @language-drill/web test -- app/\(admin\)/admin/labeling`
Expected: FAIL — cannot resolve `../page`.

- [ ] **Step 8: Write LabelBar**

Create `apps/web/app/(admin)/admin/labeling/_components/label-bar.tsx`:

```tsx
'use client';

import * as React from 'react';
import { LABEL_TAGS, type LabelTag } from '@language-drill/shared';

export interface LabelDraft {
  gradeOk: boolean | null;
  feedbackOk: boolean | null;
  tags: LabelTag[];
  critique: string;
}

export interface LabelBarProps {
  draft: LabelDraft;
  onChange: (next: LabelDraft) => void;
  error: string | null;
  disabled?: boolean;
  critiqueRef: React.RefObject<HTMLTextAreaElement | null>;
}

function Verdict({ label, value }: { label: string; value: boolean | null }) {
  const text = value === null ? 'unsure' : value ? 'ok' : 'wrong';
  return (
    <span className="text-[13px] text-ink-soft">
      {label}: <span className="font-medium text-ink">{text}</span>
    </span>
  );
}

export function LabelBar({ draft, onChange, error, disabled, critiqueRef }: LabelBarProps) {
  const toggleTag = (tag: LabelTag) => {
    const tags = draft.tags.includes(tag) ? draft.tags.filter((t) => t !== tag) : [...draft.tags, tag];
    onChange({ ...draft, tags });
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-rule bg-paper p-4">
      <div className="flex flex-wrap items-center gap-4">
        <Verdict label="grade" value={draft.gradeOk} />
        <Verdict label="feedback" value={draft.feedbackOk} />
      </div>

      <div className="flex flex-wrap gap-2">
        {LABEL_TAGS.map((tag, i) => (
          <button
            key={tag}
            type="button"
            disabled={disabled}
            onClick={() => toggleTag(tag)}
            className={`rounded-full border px-3 py-1 text-[12px] ${
              draft.tags.includes(tag)
                ? 'border-ink bg-ink-soft/10 font-medium text-ink'
                : 'border-rule text-ink-soft'
            }`}
          >
            <span className="tabular-nums">{i + 1}</span> {tag}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-[12px] uppercase tracking-wide text-ink-soft">
        critique
        <textarea
          ref={critiqueRef}
          value={draft.critique}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, critique: e.target.value })}
          rows={2}
          className="rounded-md border border-rule bg-paper p-2 text-[14px] normal-case tracking-normal text-ink"
        />
      </label>

      {error && <p className="text-[13px] text-ink">{error}</p>}

      <p className="text-[12px] text-ink-soft">
        <span className="font-medium text-ink">j</span>/<span className="font-medium text-ink">f</span> grade ok/wrong ·{' '}
        <span className="font-medium text-ink">k</span>/<span className="font-medium text-ink">d</span> feedback ok/wrong ·{' '}
        <span className="font-medium text-ink">u</span> unsure · <span className="font-medium text-ink">1-7</span> tag ·{' '}
        <span className="font-medium text-ink">/</span> critique · <span className="font-medium text-ink">Enter</span> save ·{' '}
        <span className="font-medium text-ink">←/→</span> move
      </p>
    </div>
  );
}
```

- [ ] **Step 9: Write the page**

Create `apps/web/app/(admin)/admin/labeling/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useLabelingQueue,
  useLabelingStats,
  useSaveLabel,
} from '@language-drill/api-client';
import { LABEL_TAGS, LABEL_STRATA, type LabelTag } from '@language-drill/shared';
import { SubmissionCard } from './_components/submission-card';
import { LabelBar, type LabelDraft } from './_components/label-bar';
import { FilterSelect } from '../../../../components/admin/filter-select';

const EMPTY_DRAFT: LabelDraft = { gradeOk: null, feedbackOk: null, tags: [], critique: '' };

export default function LabelingPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  const [stratum, setStratum] = useState<(typeof LABEL_STRATA)[number]>('random');
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<LabelDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const critiqueRef = useRef<HTMLTextAreaElement | null>(null);

  const queue = useLabelingQueue({ fetchFn, stratum });
  const stats = useLabelingStats({ fetchFn });
  const save = useSaveLabel({ fetchFn });

  const items = queue.data?.items ?? [];
  const item = items[index];

  const move = useCallback(
    (delta: number) => {
      setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(items.length - 1, 0)));
      setDraft(EMPTY_DRAFT);
      setError(null);
    },
    [items.length],
  );

  const commit = useCallback(async () => {
    if (!item) return;
    const hasFalse = draft.gradeOk === false || draft.feedbackOk === false;
    if (hasFalse && draft.critique.trim() === '') {
      setError('Say what was wrong — the critique is what makes this label usable later.');
      critiqueRef.current?.focus();
      return;
    }
    try {
      await save.mutateAsync({
        submissionId: item.submissionId,
        gradeOk: draft.gradeOk,
        feedbackOk: draft.feedbackOk,
        stratum,
        tags: draft.tags,
        critique: draft.critique.trim() === '' ? undefined : draft.critique.trim(),
      });
      move(1);
    } catch {
      // Never silently lose a label: keep the row and the draft on screen.
      setError('Save failed — the label is still here. Press Enter to retry.');
    }
  }, [draft, item, move, save, stratum]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Typing a critique must never trigger a verdict shortcut.
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.tagName === 'SELECT')) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case 'j': setDraft((d) => ({ ...d, gradeOk: true })); break;
        case 'f': setDraft((d) => ({ ...d, gradeOk: false })); break;
        case 'k': setDraft((d) => ({ ...d, feedbackOk: true })); break;
        case 'd': setDraft((d) => ({ ...d, feedbackOk: false })); break;
        case 'u': setDraft((d) => ({ ...d, gradeOk: null, feedbackOk: null })); break;
        case '/': e.preventDefault(); critiqueRef.current?.focus(); break;
        case 'Enter': e.preventDefault(); void commit(); break;
        case 'ArrowRight': move(1); break;
        case 'ArrowLeft': move(-1); break;
        default: {
          const n = Number(e.key);
          if (Number.isInteger(n) && n >= 1 && n <= LABEL_TAGS.length) {
            const tag = LABEL_TAGS[n - 1] as LabelTag;
            setDraft((d) => ({
              ...d,
              tags: d.tags.includes(tag) ? d.tags.filter((t) => t !== tag) : [...d.tags, tag],
            }));
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit, move]);

  const randomStratum = stats.data?.strata.find((s) => s.stratum === 'random');

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">Label submissions</h1>

      <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-soft">
        <FilterSelect
          aria-label="stratum"
          value={stratum}
          onChange={(e) => {
            setStratum(e.target.value as (typeof LABEL_STRATA)[number]);
            setIndex(0);
            setDraft(EMPTY_DRAFT);
          }}
        >
          {LABEL_STRATA.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </FilterSelect>
        <span>{items.length === 0 ? 'nothing queued' : `${index + 1} / ${items.length} on this page`}</span>
        <span>· {queue.data?.remaining ?? 0} unlabelled in scope</span>
        <span>· {stats.data?.labeledToday ?? 0} labelled today</span>
        {randomStratum && (
          <span>
            · random stratum: {randomStratum.count} labels, grade ok{' '}
            {(randomStratum.gradeOkRate * 100).toFixed(0)}%
          </span>
        )}
      </div>

      {queue.isLoading ? (
        <p className="text-[13px] text-ink-soft">Loading…</p>
      ) : queue.isError ? (
        <p className="text-[13px] text-ink-soft">Failed to load the queue.</p>
      ) : !item ? (
        <p className="text-[13px] text-ink-soft">Nothing left to label in this scope.</p>
      ) : (
        <>
          <SubmissionCard item={item} />
          <LabelBar
            draft={draft}
            onChange={setDraft}
            error={error}
            disabled={save.isPending}
            critiqueRef={critiqueRef}
          />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 10: Add the nav entry and fix its test**

In `apps/web/components/admin/admin-nav-items.tsx`, insert after the `User flags` entry:

```ts
  { href: '/admin/labeling', label: 'Labeling' },
```

`apps/web/components/admin/__tests__/admin-nav.test.tsx` asserts both arrays with `toEqual` at lines ~28 and ~31, so it fails until you add `'/admin/labeling'` and `'Labeling'` at the matching position in each expected array. Update both.

- [ ] **Step 11: Run the web tests to verify they pass**

Run: `pnpm --filter @language-drill/web test -- app/\(admin\)/admin/labeling components/admin`
Expected: PASS — 4 card tests, 5 page tests, and the nav suite green.

- [ ] **Step 12: Run the full web gate**

Run: `pnpm --filter @language-drill/web test` then `pnpm --filter @language-drill/web build`
Expected: both PASS. The build is not optional — the package test run does not exercise the App Router build, and a client/server boundary mistake only shows up there.

- [ ] **Step 13: Commit**

```bash
git add "apps/web/app/(admin)/admin/labeling" apps/web/components/admin/admin-nav-items.tsx "apps/web/components/admin/__tests__/admin-nav.test.tsx"
git commit -m "Add the keyboard-driven labeling page"
```

---

### Task 7: Runtime verification against the dev branch

**Files:** none created. This task produces evidence, not code.

**Interfaces:** consumes everything from Tasks 1–6.

- [ ] **Step 1: Confirm the migration is applied on the dev branch**

Run: `pnpm db:migrate`
Expected: reports no pending migrations (Task 1 applied `0042`).

- [ ] **Step 2: Start the local API**

Run, in a background shell: `pnpm dev:api`
Expected: listening on `http://localhost:3001`. Auth is bypassed locally with `userId = dev_user_001`.

- [ ] **Step 3: Confirm the admin gate actually blocks**

Run: `curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3001/admin/labeling/queue?stratum=random'`
Expected: `403`, because `dev_user_001` is not in `ADMIN_USER_IDS`.

Then re-run with the dev user allowed:

```bash
ADMIN_USER_IDS=dev_user_001 pnpm dev:api    # restart with the env var
curl -s 'http://localhost:3001/admin/labeling/queue?stratum=random&limit=2' | head -c 600
```

Expected: JSON with `items` and `remaining`. If `items` is `[]`, the dev branch has no LLM-evaluated submissions — note that and proceed; Step 5 then exercises the page's empty state instead, and the real labelling pass happens against production data after deploy.

- [ ] **Step 4: Write and re-write one label through the API**

```bash
SUB=$(curl -s 'http://localhost:3001/admin/labeling/queue?stratum=random&limit=1' | python3 -c 'import sys,json; print(json.load(sys.stdin)["items"][0]["submissionId"])')
curl -s -X POST "http://localhost:3001/admin/labeling/$SUB" -H 'content-type: application/json' \
  -d '{"gradeOk":false,"feedbackOk":true,"stratum":"random","tags":["alternative-rejected"],"critique":"smoke test"}'
curl -s -X POST "http://localhost:3001/admin/labeling/$SUB" -H 'content-type: application/json' \
  -d '{"gradeOk":true,"feedbackOk":true,"stratum":"random"}'
curl -s 'http://localhost:3001/admin/labeling/stats'
```

Expected: both POSTs return `{"saved":true,...}`; `stats` shows the `random` stratum with **count 1**, not 2 — proving the upsert overwrote rather than duplicated. Confirm the row count directly too:

`psql "$DATABASE_URL" -c 'select count(*), grade_ok, prompt_version from submission_labels group by 2,3;'`

Expected: one row, `grade_ok = t`, `prompt_version = evaluate@2026-09-22`.

- [ ] **Step 5: Screenshot the page**

Run: `pnpm --filter @language-drill/web shoot --route /admin/labeling`
Output lands in `apps/web/e2e/.shots/`. The worktree `.env` files were copied at setup; if the shot hangs on a Clerk handshake, kill any stray `next` processes and `rm -rf apps/web/.next` before retrying. Connected Chrome is not an option here — it cannot reach localhost:3000 through the Clerk dev-browser loop.

- [ ] **Step 6: Read the screenshot and fix what it shows**

Open the PNG. Check: the stimulus is readable and above the evaluation; the shortcut legend is visible without scrolling; nothing is clipped at phone width; no white-on-white or black-on-black in either theme (`bg-paper`/`text-ink` invert together, so a hardcoded colour shows up here).

Fix anything wrong, re-shoot, and commit the fix.

- [ ] **Step 7: Clean up the smoke-test label**

```bash
psql "$DATABASE_URL" -c "delete from submission_labels where critique = 'smoke test' or labeled_by = 'dev_user_001';"
```

This is the dev branch, and a smoke-test verdict must not survive into a real label set. Confirm the table is empty afterwards.

- [ ] **Step 8: Run the whole gate and commit any fixes**

```bash
pnpm lint
pnpm typecheck
pnpm --filter @language-drill/db test
pnpm --filter @language-drill/shared test
pnpm --filter @language-drill/ai test
pnpm --filter @language-drill/api-client test
pnpm --filter @language-drill/lambda test
pnpm --filter @language-drill/web test
pnpm --filter @language-drill/web build
```

All must pass. Report the counts. Commit any fixes with a message naming what the gate caught.

---

### Task 8: Export CLI — only after a first real labelling pass

**Gate before starting:** at least ~20 labels exist in production. This task is deliberately last. If the two binaries or the seven tags turn out to be the wrong cut, that shows up at label 20, and it is much cheaper to change the schema and the page than to also rewrite a fixture contract and its consumer. Check with `GET /admin/labeling/stats` and stop here if the count is low — report back instead of proceeding.

**Files:**
- Create: `packages/ai/scripts/export-labels.ts`
- Create: `packages/ai/scripts/export-labels.test.ts`
- Modify: `packages/ai/package.json`, root `package.json`

**Interfaces:**
- Consumes: `submissionLabels`, `userExerciseHistory`, `exercises` from `@language-drill/db`.
- Produces: `export function buildFixture(rows: ExportRow[]): LabelFixture` and a CLI writing `packages/ai/scripts/fixtures/evaluator-labels.json`. `LabelFixture` = `{ description, exportedAt, promptVersionsSeen: string[], cases: FixtureCase[] }`; `FixtureCase` = `{ submissionId, stratum, language, cefrLevel, exerciseType, grammarPointKey, input: { exercise, userAnswer }, observedEvaluation, label: { gradeOk, feedbackOk, tags, critique, promptVersion } }`. Phase 2's eval harness reads exactly this.

- [ ] **Step 1: Write the failing test**

Create `packages/ai/scripts/export-labels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFixture, type ExportRow } from './export-labels.js';

const row: ExportRow = {
  submissionId: 'sub-1',
  stratum: 'random',
  language: 'ES',
  cefrLevel: 'B1',
  exerciseType: 'cloze',
  grammarPointKey: 'es.b1.preterite-vs-imperfect',
  contentJson: { type: 'cloze', sentence: 'Ayer ___ al mercado.', correctAnswer: 'fui' },
  responseJson: { userAnswer: 'iba', evaluation: { score: 0.4, feedback: 'nope', errors: [] } },
  gradeOk: false,
  feedbackOk: true,
  tags: ['alternative-rejected'],
  critique: 'me fui is also correct',
  promptVersion: 'evaluate@2026-09-22',
};

describe('buildFixture', () => {
  it('freezes the observed evaluation into the case', () => {
    const fixture = buildFixture([row]);
    expect(fixture.cases[0].observedEvaluation).toEqual(row.responseJson.evaluation);
    expect(fixture.cases[0].input.userAnswer).toBe('iba');
    expect(fixture.cases[0].input.exercise).toEqual(row.contentJson);
  });

  it('carries the stratum through, so the two are never blended downstream', () => {
    const fixture = buildFixture([row, { ...row, submissionId: 'sub-2', stratum: 'targeted' }]);
    expect(fixture.cases.map((c) => c.stratum)).toEqual(['random', 'targeted']);
  });

  it('lists every prompt version present, so a mixed-cohort set is visible', () => {
    const fixture = buildFixture([row, { ...row, submissionId: 'sub-2', promptVersion: 'evaluate@2026-01-01' }]);
    expect(fixture.promptVersionsSeen.sort()).toEqual(['evaluate@2026-01-01', 'evaluate@2026-09-22']);
  });

  it('throws rather than writing an empty fixture', () => {
    expect(() => buildFixture([])).toThrow(/no labels/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/ai test -- scripts/export-labels.test.ts`
Expected: FAIL — cannot resolve `./export-labels.js`.

- [ ] **Step 3: Write the CLI**

Create `packages/ai/scripts/export-labels.ts`. `buildFixture` is pure so the test above needs no database:

```ts
/**
 * packages/ai — export-labels CLI. Reads submission_labels joined to the
 * submission and its exercise, and writes the committed ground-truth fixture
 * Phase 2's eval harness will score against.
 *
 * Read-only on the database. No Anthropic calls, so no --dry-run and no cost cap.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { and, asc, eq } from 'drizzle-orm';
import { createDb, exercises, submissionLabels, userExerciseHistory } from '@language-drill/db';

export type ExportRow = {
  submissionId: string;
  stratum: string;
  language: string | null;
  cefrLevel: string | null;
  exerciseType: string | null;
  grammarPointKey: string | null;
  contentJson: unknown;
  responseJson: unknown;
  gradeOk: boolean | null;
  feedbackOk: boolean | null;
  tags: string[];
  critique: string | null;
  promptVersion: string | null;
};

export type FixtureCase = {
  submissionId: string;
  stratum: string;
  language: string | null;
  cefrLevel: string | null;
  exerciseType: string | null;
  grammarPointKey: string | null;
  input: { exercise: unknown; userAnswer: unknown };
  observedEvaluation: unknown;
  label: {
    gradeOk: boolean | null;
    feedbackOk: boolean | null;
    tags: string[];
    critique: string | null;
    promptVersion: string | null;
  };
};

export type LabelFixture = {
  description: string;
  exportedAt: string;
  promptVersionsSeen: string[];
  cases: FixtureCase[];
};

export function buildFixture(rows: readonly ExportRow[]): LabelFixture {
  if (rows.length === 0) {
    throw new Error('export-labels: no labels matched — refusing to write an empty fixture');
  }
  const cases: FixtureCase[] = rows.map((r) => {
    const resp = (r.responseJson ?? {}) as { userAnswer?: unknown; evaluation?: unknown };
    return {
      submissionId: r.submissionId,
      stratum: r.stratum,
      language: r.language,
      cefrLevel: r.cefrLevel,
      exerciseType: r.exerciseType,
      grammarPointKey: r.grammarPointKey,
      input: { exercise: r.contentJson, userAnswer: resp.userAnswer ?? null },
      // Frozen here on purpose: the label judged THIS output, and response_json
      // is appended to in production (the `explanation` key).
      observedEvaluation: resp.evaluation ?? null,
      label: {
        gradeOk: r.gradeOk,
        feedbackOk: r.feedbackOk,
        tags: r.tags ?? [],
        critique: r.critique,
        promptVersion: r.promptVersion,
      },
    };
  });
  const promptVersionsSeen = [
    ...new Set(rows.map((r) => r.promptVersion).filter((v): v is string => typeof v === 'string')),
  ];
  return {
    description:
      'Human labels on real learner submissions. gradeOk = was the score / pass-fail / error ' +
      'attribution right; feedbackOk = was the explanation shown to the learner right. ' +
      'stratum "random" is the unbiased spine and the only one a production rate may be quoted ' +
      'from; "targeted" is a defect hunt. Never blend them.',
    exportedAt: new Date().toISOString(),
    promptVersionsSeen,
    cases,
  };
}

const DEFAULT_OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'evaluator-labels.json',
);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      stratum: { type: 'string' },
      language: { type: 'string' },
      'min-labels': { type: 'string' },
      out: { type: 'string' },
    },
  });
  const minLabels = values['min-labels'] === undefined ? 1 : Number(values['min-labels']);
  const out = values.out ?? DEFAULT_OUT;

  const db = createDb(process.env.DATABASE_URL!);
  const conditions = [];
  if (values.stratum) conditions.push(eq(submissionLabels.stratum, values.stratum));
  if (values.language) conditions.push(eq(exercises.language, values.language));

  const rows = await db
    .select({
      submissionId: submissionLabels.submissionId,
      stratum: submissionLabels.stratum,
      language: exercises.language,
      cefrLevel: exercises.difficulty,
      exerciseType: exercises.type,
      grammarPointKey: exercises.grammarPointKey,
      contentJson: exercises.contentJson,
      responseJson: userExerciseHistory.responseJson,
      gradeOk: submissionLabels.gradeOk,
      feedbackOk: submissionLabels.feedbackOk,
      tags: submissionLabels.tags,
      critique: submissionLabels.critique,
      promptVersion: submissionLabels.promptVersion,
    })
    .from(submissionLabels)
    .innerJoin(userExerciseHistory, eq(userExerciseHistory.id, submissionLabels.submissionId))
    .innerJoin(exercises, eq(exercises.id, userExerciseHistory.exerciseId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(submissionLabels.labeledAt));

  if (rows.length < minLabels) {
    throw new Error(
      `export-labels: found ${rows.length} labels, below --min-labels ${minLabels} — not writing`,
    );
  }

  const fixture = buildFixture(rows as ExportRow[]);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);

  const byStratum = new Map<string, number>();
  for (const c of fixture.cases) byStratum.set(c.stratum, (byStratum.get(c.stratum) ?? 0) + 1);
  console.log(`[export-labels] wrote ${fixture.cases.length} cases to ${out}`);
  for (const [stratum, count] of byStratum) console.log(`  ${stratum}: ${count}`);
  console.log(`  prompt versions: ${fixture.promptVersionsSeen.join(', ')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

Check `createDb`'s import name against a sibling script (`eval-export.ts`) before running — use whatever that file uses.

- [ ] **Step 4: Register the scripts**

`packages/ai/package.json`: `"export:labels": "tsx scripts/export-labels.ts"`.
Root `package.json`, beside the other aliases: `"export:labels": "dotenv -e .env -- pnpm --filter @language-drill/ai export:labels"`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/ai test -- scripts/export-labels.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Run it for real**

Run: `pnpm export:labels`
Expected: writes the fixture with as many cases as you have labels. Inspect the file: confirm a case's `observedEvaluation` matches what the page showed you, and that no `label.critique` is empty on a `false` verdict.

- [ ] **Step 7: Commit**

```bash
git add packages/ai/scripts/export-labels.ts packages/ai/scripts/export-labels.test.ts packages/ai/package.json package.json packages/ai/scripts/fixtures/evaluator-labels.json
git commit -m "Export evaluator labels to a committed fixture"
```

---

## Deferred to Phase 2 (not in this plan)

Rewiring `pnpm eval` to score against `evaluator-labels.json`: `gradeOk` / `feedbackOk` agreement, TPR/TNR against the labels, a tag histogram, and per-stratum reporting that never merges `random` with `targeted`. Also the `heldOut` marking, needed the moment a labelled submission is quoted in `EVALUATION_SYSTEM_PROMPT`. Spec that separately once labels exist.
