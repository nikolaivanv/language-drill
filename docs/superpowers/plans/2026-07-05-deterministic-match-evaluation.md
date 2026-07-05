# Deterministic-Match Evaluation Short-Circuit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skip the LLM entirely when a cloze/vocab-recall answer exactly matches an accepted answer (instant, free, score 1.0), with an on-demand metered "Explain why" for LLM feedback.

**Architecture:** Extend the existing conjugation deterministic short-circuit in the submit route to the match case of cloze/vocab (grading via the existing `gradeFluencyAnswer`); mark every evaluation with `evaluationSource`; add a `POST /exercises/:id/submissions/:submissionId/explain` endpoint that runs the normal metered evaluation on demand and caches the feedback; surface an *Explain why* button in the drill feedback UI for deterministic results.

**Tech Stack:** Hono (Lambda), Drizzle, Zod (api-client), TanStack Query, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-05-deterministic-match-evaluation-design.md`

## Global Constraints

- Deterministic matches: NO `ai_evaluation` usage event, NO capacity/cap gates, NO Claude call, NO Langfuse trace.
- The explain endpoint IS metered (`ai_evaluation`) and gated exactly like submit.
- Non-matching answers fall through to the LLM path unchanged.
- The deterministic verdict is never retroactively re-scored by an explain call.
- All grading normalization comes from `gradeFluencyAnswer` — do NOT write new normalization.
- Repo gates before push: `pnpm lint && pnpm typecheck && pnpm test` from the repo root, zero failures. If the full turbo `pnpm test` fails in a package your diff does not touch, re-run that package's tests in isolation before assuming a regression (known parallel-load flakes); `rm -rf infra/lambda/dist` first to avoid stale-dist phantom failures.
- Work happens in the worktree at `.claude/worktrees/deterministic-match` on branch `worktree-deterministic-match`. Run `pnpm build` once before the first test run (fresh worktree has no `dist` for workspace deps).
- Commit after every green task with the message given in the task.

---

### Task 1: `evaluationSource` field on the result type and api-client schema

**Files:**
- Modify: `packages/shared/src/index.ts` (the `EvaluationResult` type, ~line 331)
- Modify: `packages/api-client/src/schemas/exercise.ts` (~line 38)
- Test: `packages/api-client/src/schemas/exercise.test.ts`

**Interfaces:**
- Produces: `EvaluationResult.evaluationSource?: 'deterministic' | 'llm'` (shared type) and the same optional field on `EvaluationResultSchema`. Tasks 2–5 rely on this exact field name and values.

- [ ] **Step 1: Write the failing schema tests**

Append to the existing top-level `describe` in `packages/api-client/src/schemas/exercise.test.ts` (follow the file's existing fixture style — reuse its valid-result fixture if one exists, else the inline object below):

```ts
describe('EvaluationResultSchema — evaluationSource', () => {
  const base = {
    score: 1,
    grammarAccuracy: 1,
    vocabularyRange: 'A1',
    taskAchievement: 1,
    feedback: 'Correct — koydu.',
    errors: [],
    estimatedCefrEvidence: 'A1',
  };

  it('accepts evaluationSource: deterministic', () => {
    const parsed = EvaluationResultSchema.parse({ ...base, evaluationSource: 'deterministic' });
    expect(parsed.evaluationSource).toBe('deterministic');
  });

  it('accepts evaluationSource: llm', () => {
    expect(EvaluationResultSchema.parse({ ...base, evaluationSource: 'llm' }).evaluationSource).toBe('llm');
  });

  it('accepts absent evaluationSource (historical responses)', () => {
    expect(EvaluationResultSchema.parse(base).evaluationSource).toBeUndefined();
  });

  it('rejects unknown evaluationSource values', () => {
    expect(() => EvaluationResultSchema.parse({ ...base, evaluationSource: 'psychic' })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/api-client exec vitest run src/schemas/exercise.test.ts`
Expected: FAIL — `rejects unknown evaluationSource values` fails (zod object is non-strict, unknown keys are stripped, so parse succeeds and nothing throws) and the two accept tests fail (`evaluationSource` stripped → `undefined`).

- [ ] **Step 3: Implement**

In `packages/shared/src/index.ts`, add to `EvaluationResult`:

```ts
export type EvaluationResult = {
  score: number;
  grammarAccuracy: number;
  vocabularyRange: string;
  taskAchievement: number;
  feedback: string;
  errors: EvaluationError[];
  estimatedCefrEvidence: string;
  /**
   * How this evaluation was produced. 'deterministic' = exact-match
   * short-circuit (no LLM ran; eligible for on-demand "Explain why").
   * Absent on rows written before 2026-07-05 — treat as 'llm'.
   */
  evaluationSource?: 'deterministic' | 'llm';
};
```

In `packages/api-client/src/schemas/exercise.ts`, add to `EvaluationResultSchema`:

```ts
  evaluationSource: z.enum(['deterministic', 'llm']).optional(),
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm build && pnpm --filter @language-drill/api-client exec vitest run src/schemas/exercise.test.ts`
Expected: PASS (build refreshes `shared/dist` so dependents see the new type).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/api-client/src/schemas/exercise.ts packages/api-client/src/schemas/exercise.test.ts
git commit -m "feat(shared,api-client): evaluationSource marker on evaluation results"
```

---

### Task 2: Submit-route short-circuit for cloze/vocab exact matches

**Files:**
- Modify: `infra/lambda/src/routes/exercises.ts` (new block directly after the conjugation block that ends ~line 478; plus two one-line `evaluationSource` stamps)
- Test: `infra/lambda/src/routes/exercises.test.ts` (new `describe` after the conjugation-branch `describe` at ~line 1952)

**Interfaces:**
- Consumes: `gradeFluencyAnswer(content, answer): boolean` and `isClozeContent`/`isVocabRecallContent` from `@language-drill/shared`; `EvaluationResult.evaluationSource` from Task 1.
- Produces: submit responses carrying `evaluationSource: 'deterministic' | 'llm'`. Task 3 relies on the stored `responseJson.evaluation.evaluationSource === 'deterministic'`; Task 5 relies on the response field.

**Mock-db hazard (read first):** `exercises.test.ts` drains chained `mockLimit`/`mockWhere` queues in call order. Copy the conjugation-branch `describe` setup verbatim (exercise fetch + mastery read queueing) — do not reorder queue pushes; a mis-ordered queue shows up as an unrelated-looking failure in a later test.

- [ ] **Step 1: Write the failing route tests**

Add after the conjugation-branch `describe` (reuse its `authEnv` pattern):

```ts
// ---------------------------------------------------------------------------
// POST /exercises/:id/submit — deterministic match short-circuit (cloze/vocab)
// ---------------------------------------------------------------------------

describe('POST /exercises/:id/submit — deterministic match branch', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  const clozeExercise = {
    id: 'cloze-tr-001',
    type: 'cloze',
    language: 'TR',
    difficulty: 'A1',
    grammarPointKey: 'tr-a1-dili-past',
    contentJson: {
      type: 'cloze',
      instructions: 'Fill in the blank.',
      sentence: 'Ali kitabı masanın üzerine ___ .',
      correctAnswer: 'koydu',
      acceptableAnswers: ['koymuştu'],
    },
    audioS3Key: null,
    createdAt: new Date(),
  };

  const vocabExercise = {
    id: 'vocab-tr-001',
    type: 'vocab_recall',
    language: 'TR',
    difficulty: 'A1',
    grammarPointKey: null,
    contentJson: {
      type: 'vocab_recall',
      instructions: 'What is the word?',
      prompt: 'The animal you ride',
      expectedWord: 'at',
    },
    audioS3Key: null,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockWithLlmTrace.mockImplementation(
      <T>(_ctx: unknown, fn: () => T | Promise<T>) => Promise.resolve(fn()),
    );
    mockRandomUUID.mockImplementation(() => '00000000-0000-0000-0000-000000000000');
    const mod = await import('./exercises');
    app = new Hono();
    app.route('/', mod.default);
  });

  function queueExerciseAndMastery(exercise: unknown) {
    // exercise fetch
    mockLimit.mockResolvedValueOnce([exercise]);
    mockWhere.mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }));
    // mastery read (no prior row)
    mockLimit.mockResolvedValueOnce([]);
    mockWhere.mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }));
  }

  async function submit(exerciseId: string, answer: string) {
    return app.request(
      `/exercises/${exerciseId}/submit`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      },
      authEnv,
    );
  }

  it('cloze exact match: 1.0, deterministic, zero Claude, zero usage event', async () => {
    queueExerciseAndMastery(clozeExercise);
    const res = await submit('cloze-tr-001', 'koydu');
    expect(res.status).toBe(200);
    const body = await res.json() as AnyJson;
    expect(body.score).toBe(1);
    expect(body.grammarAccuracy).toBe(1);
    expect(body.errors).toEqual([]);
    expect(body.evaluationSource).toBe('deterministic');
    expect(body.feedback).toContain('koydu');
    expect(mockEvaluateAnswer).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allValuesCalls = (mockValues.mock.calls as any[]).map((c: any[]) => c[0] as AnyJson);
    expect(allValuesCalls.some((v) => v && v.eventType === 'ai_evaluation')).toBe(false);
  });

  it('cloze acceptable-answer match short-circuits too', async () => {
    queueExerciseAndMastery(clozeExercise);
    const res = await submit('cloze-tr-001', 'koymuştu');
    const body = await res.json() as AnyJson;
    expect(body.score).toBe(1);
    expect(body.evaluationSource).toBe('deterministic');
    expect(mockEvaluateAnswer).not.toHaveBeenCalled();
  });

  it('cloze match survives mobile-keyboard artifacts (TR capital I + trailing period)', async () => {
    queueExerciseAndMastery(clozeExercise);
    // Non-TR keyboard auto-capitalization: "Koydu." must match "koydu".
    const res = await submit('cloze-tr-001', 'Koydu.');
    const body = await res.json() as AnyJson;
    expect(body.score).toBe(1);
    expect(body.evaluationSource).toBe('deterministic');
  });

  it('vocab expectedWord match short-circuits', async () => {
    queueExerciseAndMastery(vocabExercise);
    const res = await submit('vocab-tr-001', 'at');
    const body = await res.json() as AnyJson;
    expect(body.score).toBe(1);
    expect(body.evaluationSource).toBe('deterministic');
    expect(mockEvaluateAnswer).not.toHaveBeenCalled();
  });

  it('cloze NON-match falls through to the LLM path and stamps evaluationSource: llm', async () => {
    queueExerciseAndMastery(clozeExercise);
    mockEvaluateAnswer.mockResolvedValueOnce({
      score: 0,
      grammarAccuracy: 0,
      vocabularyRange: 'A1',
      taskAchievement: 0,
      feedback: 'Not quite.',
      errors: [],
      estimatedCefrEvidence: 'A1',
    });
    const res = await submit('cloze-tr-001', 'koydı');
    expect(res.status).toBe(200);
    const body = await res.json() as AnyJson;
    expect(mockEvaluateAnswer).toHaveBeenCalledOnce();
    expect(body.evaluationSource).toBe('llm');
  });
});
```

Note: the non-match test relies on the existing LLM-path mocks (plan/capacity/usage mocks are already module-mocked at the top of the file — see the `sampleEvaluation`-based tests around line 646 for the pattern). If the LLM path in this file requires additional queued db reads (usage-count select), copy the exact queueing from the nearest existing successful-submit test.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/routes/exercises.test.ts -t "deterministic match branch"`
Expected: FAIL — match cases call `mockEvaluateAnswer` (no short-circuit exists) and `evaluationSource` is undefined.

- [ ] **Step 3: Implement the short-circuit**

In `infra/lambda/src/routes/exercises.ts`:

Add `isClozeContent, isVocabRecallContent` to the `@language-drill/shared` value import on line 6.

Insert directly AFTER the conjugation block's closing `}` (~line 478) and BEFORE the `// 3. Resolve tier…` comment:

```ts
  // Deterministic, zero-Claude short-circuit for exact-match cloze/vocab
  // answers. The evaluation prompt already mandates score 1.0 with no errors
  // for these matches, so the LLM call is a latency+cost rubber stamp.
  // Same policy as the conjugation branch above: no ai_evaluation spend, no
  // capacity/daily-cap gate, no Claude call, no Langfuse trace. NON-matching
  // answers fall through to the LLM path — acceptable-answers lists are
  // non-exhaustive, so an unlisted answer may still be valid.
  if (
    exercise.type === ExerciseType.CLOZE ||
    exercise.type === ExerciseType.VOCAB_RECALL
  ) {
    const content = exercise.contentJson as ExerciseContent;
    if (
      (isClozeContent(content) || isVocabRecallContent(content)) &&
      gradeFluencyAnswer(content, userAnswer)
    ) {
      const result: EvaluationResult = {
        score: 1,
        grammarAccuracy: 1,
        // Deterministic path has no vocabulary/CEFR judgment; echo the
        // exercise difficulty (same convention as the conjugation branch).
        vocabularyRange: exercise.difficulty ?? '',
        taskAchievement: 1,
        feedback: `Correct — ${userAnswer.trim()}`,
        errors: [],
        estimatedCefrEvidence: exercise.difficulty ?? '',
        evaluationSource: 'deterministic',
      };

      const submissionId = randomUUID();
      await db.insert(userExerciseHistory).values({
        id: submissionId,
        userId,
        exerciseId: id,
        sessionId,
        score: 1,
        responseJson: { userAnswer, evaluation: result },
        evaluatedAt: new Date(),
      });

      await applyGrammarMastery({
        userId,
        language: exercise.language as Language,
        grammarPointKey: exercise.grammarPointKey,
        difficulty: exercise.difficulty as CefrLevel,
        score: 1,
      });

      return c.json({ ...result, submissionId });
    }
    // fall through to the normal LLM evaluation
  }
```

Stamp the source on the two non-deterministic result paths:
1. In the conjugation branch's `result` literal, add `evaluationSource: 'deterministic',`.
2. On the LLM path, change the final response + stored evaluation. Where `result` comes back from `withLlmTrace` (`const result = await withLlmTrace(…)`), add immediately after:

```ts
    const stamped = { ...result, evaluationSource: 'llm' as const };
```

and use `stamped` in place of `result` in the subsequent `responseJson: { userAnswer, evaluation: stamped }` insert and the `return c.json({ ...stamped, submissionId })`. (Leave `recordErrorObservations`/mastery reads on `result` — same object contents.) The dictation result flows through the same lines; `evaluationSource: 'llm'` on it is acceptable (it is an LLM grading) and the dictation schema ignores unknown fields client-side.

- [ ] **Step 4: Run to verify pass, then the whole file**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/routes/exercises.test.ts`
Expected: PASS, including all pre-existing describes (queue-order regressions show up here, not in your new tests).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/exercises.ts infra/lambda/src/routes/exercises.test.ts
git commit -m "feat(lambda): deterministic short-circuit for exact-match cloze/vocab answers"
```

---

### Task 3: `POST /exercises/:id/submissions/:submissionId/explain`

**Files:**
- Modify: `infra/lambda/src/routes/exercises.ts` (new route registered after the submit route; small helper extraction)
- Test: `infra/lambda/src/routes/exercises.test.ts`

**Interfaces:**
- Consumes: stored `responseJson: { userAnswer, evaluation, explanation? }` from Task 2; `evaluateAnswer`, `createObservedClaudeClient`, `withLlmTrace`, gates (`getEffectivePlan`, `checkGlobalCapacity`, `limitFor`), all already imported in this file.
- Produces: `200 { explanation: string }`; errors `404 NOT_FOUND`, `400 NOT_EXPLAINABLE`, `503 GLOBAL_CAPACITY`, `429 RATE_LIMIT_EXCEEDED`, `422 CONTENT_REJECTED`, `502 AI_UNAVAILABLE`. Task 4's schema parses `{ explanation: string }`.

- [ ] **Step 1: Extract the guidance helper (pure refactor, existing tests stay green)**

In `exercises.ts`, lift the grammar-guidance + attribution block (lines ~376–397, shown below) into a module-level function above the routes, and replace the inline block in the submit handler with a call:

```ts
/** Curriculum grounding + closed attribution key set for the evaluator.
 * Shared by the submit and explain paths so both feed Claude identically. */
function resolveEvaluationGuidance(exercise: {
  grammarPointKey: string | null;
  language: string;
  difficulty: string | null;
}) {
  const grammarPoint = exercise.grammarPointKey
    ? getGrammarPoint(exercise.grammarPointKey)
    : undefined;
  const grammarGuidance = grammarPoint
    ? {
        name: grammarPoint.name,
        description: grammarPoint.description,
        commonErrors: grammarPoint.commonErrors,
      }
    : undefined;
  const attributionKeys =
    exercise.language === Language.EN
      ? []
      : grammarPointsAtOrBelow(
          exercise.language as LearningLanguage,
          exercise.difficulty as string,
        ).map((p) => ({ key: p.key, name: p.name }));
  return { grammarGuidance, attributionKeys };
}
```

In the submit handler replace the inline block with:

```ts
  const { grammarGuidance, attributionKeys } = resolveEvaluationGuidance(exercise);
```

Run: `pnpm --filter @language-drill/lambda exec vitest run src/routes/exercises.test.ts` — Expected: PASS (behavior-preserving). Commit:

```bash
git add infra/lambda/src/routes/exercises.ts
git commit -m "refactor(lambda): extract resolveEvaluationGuidance for reuse by explain route"
```

- [ ] **Step 2: Write the failing explain-route tests**

```ts
// ---------------------------------------------------------------------------
// POST /exercises/:id/submissions/:submissionId/explain
// ---------------------------------------------------------------------------

describe('POST /exercises/:id/submissions/:submissionId/explain', () => {
  let app: Hono;

  const authEnv = {
    event: {
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user_123' } } },
      },
    },
  };

  const clozeExercise = {
    id: 'cloze-tr-001',
    type: 'cloze',
    language: 'TR',
    difficulty: 'A1',
    grammarPointKey: 'tr-a1-dili-past',
    contentJson: {
      type: 'cloze',
      instructions: 'Fill in the blank.',
      sentence: 'Ali kitabı masanın üzerine ___ .',
      correctAnswer: 'koydu',
    },
    audioS3Key: null,
    createdAt: new Date(),
  };

  const deterministicRow = {
    id: 'sub-1',
    userId: 'user_123',
    exerciseId: 'cloze-tr-001',
    responseJson: {
      userAnswer: 'koydu',
      evaluation: { score: 1, evaluationSource: 'deterministic' },
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockWithLlmTrace.mockImplementation(
      <T>(_ctx: unknown, fn: () => T | Promise<T>) => Promise.resolve(fn()),
    );
    const mod = await import('./exercises');
    app = new Hono();
    app.route('/', mod.default);
  });

  function queueHistoryAndExercise(row: unknown, exercise: unknown) {
    // history row fetch
    mockLimit.mockResolvedValueOnce(row ? [row] : []);
    mockWhere.mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }));
    if (row && exercise) {
      // exercise fetch
      mockLimit.mockResolvedValueOnce([exercise]);
      mockWhere.mockImplementationOnce(() => ({ orderBy: mockOrderBy, limit: mockLimit }));
    }
  }

  async function explain(exerciseId: string, submissionId: string) {
    return app.request(
      `/exercises/${exerciseId}/submissions/${submissionId}/explain`,
      { method: 'POST' },
      authEnv,
    );
  }

  it('404 when the submission does not exist or belongs to someone else', async () => {
    queueHistoryAndExercise(null, null);
    const res = await explain('cloze-tr-001', 'sub-404');
    expect(res.status).toBe(404);
  });

  it('400 NOT_EXPLAINABLE for an LLM-sourced submission', async () => {
    queueHistoryAndExercise(
      { ...deterministicRow, responseJson: { userAnswer: 'koydı', evaluation: { score: 0, evaluationSource: 'llm' } } },
      clozeExercise,
    );
    const res = await explain('cloze-tr-001', 'sub-1');
    expect(res.status).toBe(400);
    expect(((await res.json()) as AnyJson).code).toBe('NOT_EXPLAINABLE');
  });

  it('returns the cached explanation without calling Claude or metering', async () => {
    queueHistoryAndExercise(
      { ...deterministicRow, responseJson: { ...deterministicRow.responseJson, explanation: 'cached why' } },
      clozeExercise,
    );
    const res = await explain('cloze-tr-001', 'sub-1');
    expect(res.status).toBe(200);
    expect(((await res.json()) as AnyJson).explanation).toBe('cached why');
    expect(mockEvaluateAnswer).not.toHaveBeenCalled();
  });

  it('cold call: runs evaluateAnswer, meters ai_evaluation, persists the explanation', async () => {
    queueHistoryAndExercise(deterministicRow, clozeExercise);
    mockEvaluateAnswer.mockResolvedValueOnce({
      score: 1, grammarAccuracy: 1, vocabularyRange: 'A1', taskAchievement: 1,
      feedback: 'Correct because koy- takes -du (back rounded o).',
      errors: [], estimatedCefrEvidence: 'A1',
    });
    const res = await explain('cloze-tr-001', 'sub-1');
    expect(res.status).toBe(200);
    expect(((await res.json()) as AnyJson).explanation).toContain('koy-');
    expect(mockEvaluateAnswer).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allValuesCalls = (mockValues.mock.calls as any[]).map((c: any[]) => c[0] as AnyJson);
    expect(allValuesCalls.some((v) => v && v.eventType === 'ai_evaluation')).toBe(true);
    // explanation persisted via db.update(...).set({ responseJson: ... })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allSetCalls = (mockSet.mock.calls as any[]).map((c: any[]) => c[0] as AnyJson);
    expect(allSetCalls.some((v) => v?.responseJson?.explanation)).toBe(true);
  });
});
```

Note: `mockSet` — if `exercises.test.ts`'s db mock does not already expose an `update().set().where()` chain, extend the mock factory at the top of the file with `mockSet` following the same chained pattern as `mockValues` (the db mock in this file is hand-rolled; check `vi.mock('../db', …)` at line 54 and mirror the insert chain). The daily-cap count select on the cold path is served by the same module mocks the submit tests use; if the cold-call test fails on an unconsumed queue, copy the usage-count queueing from the nearest metered-path submit test.

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/routes/exercises.test.ts -t "explain"`
Expected: FAIL — 404 for every request (route does not exist).

- [ ] **Step 4: Implement the route**

Register after the submit route in `exercises.ts`:

```ts
// ---------------------------------------------------------------------------
// POST /exercises/:id/submissions/:submissionId/explain — on-demand LLM
// feedback for a deterministic (exact-match) submission. Metered + gated
// like submit: this IS a real Claude call. The stored verdict is never
// re-scored — the LLM output is feedback enrichment only, cached into
// responseJson.explanation so repeat taps are free.
// ---------------------------------------------------------------------------
app.post('/exercises/:id/submissions/:submissionId/explain', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const { id, submissionId } = c.req.param();

  const rows = await db
    .select()
    .from(userExerciseHistory)
    .where(
      and(
        eq(userExerciseHistory.id, submissionId),
        eq(userExerciseHistory.userId, userId),
        eq(userExerciseHistory.exerciseId, id),
      ),
    )
    .limit(1);
  const submission = rows[0];
  if (!submission) {
    return c.json({ error: 'Submission not found', code: 'NOT_FOUND' }, 404);
  }

  const responseJson = (submission.responseJson ?? {}) as {
    userAnswer?: string;
    evaluation?: EvaluationResult;
    explanation?: string;
  };

  if (responseJson.evaluation?.evaluationSource !== 'deterministic') {
    return c.json(
      { error: 'Only instant-graded submissions can be explained', code: 'NOT_EXPLAINABLE' },
      400,
    );
  }
  if (typeof responseJson.userAnswer !== 'string') {
    return c.json({ error: 'Submission has no stored answer', code: 'NOT_EXPLAINABLE' }, 400);
  }

  // Cached — free, no gates.
  if (responseJson.explanation) {
    return c.json({ explanation: responseJson.explanation });
  }

  const exerciseRows = await db
    .select()
    .from(exercisesTable)
    .where(eq(exercisesTable.id, id))
    .limit(1);
  const exercise = exerciseRows[0];
  if (!exercise) {
    return c.json({ error: 'Exercise not found', code: 'NOT_FOUND' }, 404);
  }

  // Same gates as submit — this is a real AI call.
  const plan = await getEffectivePlan(userId);
  const capacity = await checkGlobalCapacity({ plan, admin: isAdmin(userId) });
  if (capacity !== 'ok') {
    return c.json({ error: 'AI temporarily at capacity', code: 'GLOBAL_CAPACITY' }, 503);
  }
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [{ count: todayCount }] = await db
    .select({ count: count() })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        eq(usageEvents.eventType, 'ai_evaluation'),
        gte(usageEvents.createdAt, oneDayAgo),
      ),
    );
  if (Number(todayCount) >= limitFor('ai_evaluation', plan)) {
    return c.json({ error: 'Daily evaluation limit exceeded', code: 'RATE_LIMIT_EXCEEDED' }, 429);
  }

  try {
    const client = createObservedClaudeClient(ANTHROPIC_API_KEY, {
      timeout: EVAL_REQUEST_TIMEOUT_MS,
      maxRetries: EVAL_MAX_RETRIES,
    });
    const { grammarGuidance, attributionKeys } = resolveEvaluationGuidance(exercise);
    const requestId =
      (c.env?.event as { requestContext?: { requestId?: string } } | undefined)
        ?.requestContext?.requestId ?? 'local';

    const evaluation = await withLlmTrace(
      {
        env: (process.env.LANGFUSE_ENV ?? 'dev') as 'prod' | 'dev',
        requestId,
        userId,
        submissionId,
        exerciseId: id,
        language: exercise.language as Language,
        cefrLevel: exercise.difficulty as CefrLevel,
        exerciseType: exercise.type as ExerciseType,
        feature: 'evaluate',
        promptVersion: EVALUATION_SYSTEM_PROMPT_VERSION,
      },
      () =>
        evaluateAnswer(client, {
          exercise: exercise.contentJson as ExerciseContent,
          userAnswer: responseJson.userAnswer as string,
          language: exercise.language as Language,
          difficulty: exercise.difficulty as CefrLevel,
          grammarGuidance,
          attributionKeys,
        }),
    );

    await db
      .update(userExerciseHistory)
      .set({ responseJson: { ...responseJson, explanation: evaluation.feedback } })
      .where(eq(userExerciseHistory.id, submissionId));

    await db.insert(usageEvents).values({
      userId,
      eventType: 'ai_evaluation',
      metadata: { exerciseId: id, explain: true, language: exercise.language, difficulty: exercise.difficulty },
    });

    return c.json({ explanation: evaluation.feedback });
  } catch (err) {
    if (err instanceof ContentRejectedError) {
      return c.json(
        { error: "We couldn't explain that submission.", code: 'CONTENT_REJECTED' },
        422,
      );
    }
    console.error('[POST /exercises/:id/submissions/:submissionId/explain] failed:', err);
    return c.json({ error: 'Explanation temporarily unavailable', code: 'AI_UNAVAILABLE' }, 502);
  }
});
```

Check the import list at the top: everything used above is already imported for the submit route (`userExerciseHistory`, `exercisesTable`, `usageEvents` come from `@language-drill/db` — verify against the existing imports at lines 9–18; the exercises table is aliased `exercisesTable` in this file).

- [ ] **Step 5: Run to verify pass, whole file**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/routes/exercises.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/routes/exercises.ts infra/lambda/src/routes/exercises.test.ts
git commit -m "feat(lambda): metered on-demand explain endpoint for deterministic submissions"
```

---

### Task 4: api-client — `ExplainResponseSchema` + `useExplainSubmission`

**Files:**
- Modify: `packages/api-client/src/schemas/exercise.ts`
- Create: `packages/api-client/src/hooks/useExplainSubmission.ts`
- Test: `packages/api-client/src/hooks/useExplainSubmission.test.ts`
- Modify: `packages/api-client/src/index.ts` (export the hook + schema)

**Interfaces:**
- Consumes: `POST /exercises/:id/submissions/:submissionId/explain → { explanation: string }` from Task 3; the package's existing fetch plumbing — open `packages/api-client/src/hooks/useExercise.ts` and copy exactly how it obtains `fetchFn` (client/context) and structures `useMutation`.
- Produces: `useExplainSubmission(): UseMutationResult<{ explanation: string }, Error, { exerciseId: string; submissionId: string }>`. Task 5 calls `mutate({ exerciseId, submissionId })` and reads `data.explanation`.

- [ ] **Step 1: Write the failing hook test**

Copy the test harness style from `packages/api-client/src/hooks/useSubmitFreeWriting.test.ts` (QueryClient wrapper + fetch mock). The assertions:

```ts
it('POSTs to the explain endpoint and returns the parsed explanation', async () => {
  // fetch mock returns { explanation: 'because koy- takes -du' }
  // render useExplainSubmission with the wrapper, call
  // result.current.mutateAsync({ exerciseId: 'ex-1', submissionId: 'sub-1' })
  // expect fetch called with '/exercises/ex-1/submissions/sub-1/explain', method POST
  // expect resolved value { explanation: 'because koy- takes -du' }
});

it('throws on a malformed response body', async () => {
  // fetch mock returns { nope: true } → mutateAsync rejects (zod parse)
});
```

(Write these as real tests using the harness idioms found in the copied file — the file dictates the exact wrapper/mock helpers available; do not invent new ones.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/api-client exec vitest run src/hooks/useExplainSubmission.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

`packages/api-client/src/schemas/exercise.ts`:

```ts
// Response from POST /exercises/:id/submissions/:submissionId/explain
export const ExplainResponseSchema = z.object({ explanation: z.string() });
export type ExplainResponse = z.infer<typeof ExplainResponseSchema>;
```

`packages/api-client/src/hooks/useExplainSubmission.ts` — mirror `useExercise.ts`'s mutation structure:

```ts
import { useMutation } from '@tanstack/react-query';
import { ExplainResponseSchema, type ExplainResponse } from '../schemas/exercise';
// + the same fetch-plumbing import useExercise.ts uses

export function useExplainSubmission() {
  // obtain fetchFn exactly as useExercise.ts does
  return useMutation<ExplainResponse, Error, { exerciseId: string; submissionId: string }>({
    mutationFn: async ({ exerciseId, submissionId }) => {
      const response = await fetchFn(
        `/exercises/${exerciseId}/submissions/${submissionId}/explain`,
        { method: 'POST' },
      );
      return ExplainResponseSchema.parse(await response.json());
    },
  });
}
```

Export both from `packages/api-client/src/index.ts` alongside the existing schema/hook exports.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/api-client test`
Expected: PASS (whole package — catches export/typing ripple).

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src
git commit -m "feat(api-client): useExplainSubmission hook + explain response schema"
```

---

### Task 5: Web — "Explain why" button on deterministic feedback

**Files:**
- Create: `apps/web/app/(dashboard)/drill/_components/explain-why.tsx`
- Modify: `apps/web/app/(dashboard)/drill/_components/cloze-exercise.tsx` (feedback block, ~line 199)
- Modify: `apps/web/app/(dashboard)/drill/_components/vocab-exercise.tsx` (feedback block, ~line 153)
- Test: `apps/web/app/(dashboard)/drill/_components/__tests__/explain-why.test.tsx`

**Interfaces:**
- Consumes: `useExplainSubmission` from Task 4; `submission.result.evaluationSource` + `submission.result.submissionId` from the submit response (Task 2).
- Produces: `<ExplainWhy exerciseId={...} submissionId={...} fallbackFeedback={...} />` — self-contained; renders the canned feedback line plus the button, swaps in the explanation on success.

- [ ] **Step 1: Write the failing component test**

Copy the render harness (providers/mocks) from the nearest existing component test, e.g. `__tests__/conjugation-exercise.test.tsx`. Mock `useExplainSubmission` at module level:

```tsx
// mocked mutateAsync resolves { explanation: 'Because koy- takes -du.' }

it('renders the canned feedback and an Explain why button', () => {
  // render <ExplainWhy exerciseId="ex-1" submissionId="sub-1" fallbackFeedback="Correct — koydu" />
  // expect text "Correct — koydu" and role button { name: /explain why/i }
});

it('swaps in the explanation after a successful fetch', async () => {
  // click the button → await → expect "Because koy- takes -du." rendered
  // and the button gone
});

it('keeps the canned feedback and shows an error note when the call fails', async () => {
  // mutateAsync rejects → canned text still present, /couldn't load/i visible
});
```

(As in Task 4: write them as real tests using the harness idioms of the copied file.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/web exec vitest run app/\(dashboard\)/drill/_components/__tests__/explain-why.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the component**

`explain-why.tsx` (match the file conventions of sibling components — `'use client'`, typography classes `t-body`/`t-small`, existing button classes used by FeedbackShell actions):

```tsx
'use client';

import { useState } from 'react';
import { useExplainSubmission } from '@language-drill/api-client';

type Props = {
  exerciseId: string;
  submissionId: string;
  /** The canned deterministic feedback line, shown until an explanation loads. */
  fallbackFeedback: string;
};

/** Post-answer enrichment for instant-graded (deterministic) results: shows
 * the canned "Correct" line with an on-demand, metered LLM explanation. */
export function ExplainWhy({ exerciseId, submissionId, fallbackFeedback }: Props) {
  const explain = useExplainSubmission();
  const [explanation, setExplanation] = useState<string | null>(null);

  if (explanation) {
    return <p className="t-body">{explanation}</p>;
  }

  return (
    <div className="flex flex-col gap-s-1">
      <p className="t-body">{fallbackFeedback}</p>
      <button
        type="button"
        className="t-small text-ink-mute underline underline-offset-2 self-start disabled:opacity-50"
        disabled={explain.isPending}
        onClick={() => {
          explain
            .mutateAsync({ exerciseId, submissionId })
            .then((r) => setExplanation(r.explanation))
            .catch(() => {/* error state handled below */});
        }}
      >
        {explain.isPending ? 'Explaining…' : 'Explain why'}
      </button>
      {explain.isError && (
        <p className="t-small text-ink-mute">Couldn&apos;t load the explanation — try again.</p>
      )}
    </div>
  );
}
```

Wire into `cloze-exercise.tsx` — replace the feedback line:

```tsx
{submission.result.evaluationSource === 'deterministic' && submission.result.submissionId ? (
  <ExplainWhy
    exerciseId={exercise.id}
    submissionId={submission.result.submissionId}
    fallbackFeedback={submission.result.feedback}
  />
) : (
  <p className="t-body">{submission.result.feedback}</p>
)}
```

Same substitution in `vocab-exercise.tsx` at its feedback line (~153), preserving its existing conditional (`submission.result.feedback && (…)`). Use the actual prop/variable names present in each file (`exercise.id` may be named differently — check the component's props).

- [ ] **Step 4: Run component tests + grep for collateral**

Run: `pnpm --filter @language-drill/web exec vitest run app/\(dashboard\)/drill/_components/__tests__/`
Expected: PASS. Then `grep -rn "feedback" apps/web/app/\(dashboard\)/drill/_components/__tests__/cloze* __tests__/vocab*` — any test asserting on the raw feedback `<p>` may need the deterministic/llm branch accounted for (fixtures without `evaluationSource` take the plain-`<p>` branch, so most stay green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(dashboard\)/drill/_components/
git commit -m "feat(web): Explain why button for instant-graded cloze/vocab feedback"
```

---

### Task 6: Full gate, verify, PR

**Files:** none new.

- [ ] **Step 1: Full pre-push gate**

```bash
rm -rf infra/lambda/dist
pnpm lint && pnpm typecheck && pnpm test
```

Expected: zero failures (re-run an untouched package in isolation before treating a turbo-parallel failure as real).

- [ ] **Step 2: End-to-end verification (runtime, not just tests)**

Start `pnpm dev` (API on :3001, dev auth bypass) and drive the real flow:

```bash
# find an approved TR cloze id + its correctAnswer
curl -s "localhost:3001/exercises?language=TR&difficulty=A1&type=cloze" | jq '.[0] | {id, correctAnswer: .content.correctAnswer}'
# 1. deterministic match: expect evaluationSource=deterministic, instant, score 1
time curl -s -X POST localhost:3001/exercises/<id>/submit -H 'content-type: application/json' -d '{"answer":"<correctAnswer>"}' | jq '{score, evaluationSource, submissionId, feedback}'
# 2. explain (cold): expect { explanation } after a few seconds
curl -s -X POST localhost:3001/exercises/<id>/submissions/<submissionId>/explain | jq
# 3. explain again: instant (cached)
time curl -s -X POST localhost:3001/exercises/<id>/submissions/<submissionId>/explain | jq
# 4. non-match: expect evaluationSource=llm and a real evaluation
curl -s -X POST localhost:3001/exercises/<id>/submit -H 'content-type: application/json' -d '{"answer":"wrongform"}' | jq '{score, evaluationSource}'
```

(Requires `ANTHROPIC_API_KEY` in `.env` for steps 2 and 4; step 1 must work without any Claude traffic — verify no evaluate call appears in the API log.)

- [ ] **Step 3: Push + PR**

```bash
git push -u origin worktree-deterministic-match
ghp pr create --title "feat(drill): instant free grading for exact-match cloze/vocab answers + on-demand Explain why" --body-file <prepared body>
```

PR body: problem (7s/$0.01 rubber stamp on correct answers), the conjugation precedent, match policy decisions (free/unmetered; explain metered), spec + plan links, verification evidence from Step 2.
