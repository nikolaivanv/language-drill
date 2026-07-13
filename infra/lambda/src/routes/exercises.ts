import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { eq, and, gte, count } from 'drizzle-orm';
import { Language, CefrLevel, ExerciseType, isFreeWritingContent, isConjugationContent, isClozeContent, isVocabRecallContent, isTranslationContent, gradeFluencyAnswer, EXERCISE_ANSWER_MAX_CHARS } from '@language-drill/shared';
import type { LearningLanguage } from '@language-drill/shared';
import type { DictationContent, ExerciseContent, FreeWritingContent, EvaluationResult, WordHintUnit } from '@language-drill/shared';
import {
  exercises as exercisesTable,
  practiceSessions,
  userExerciseHistory,
  usageEvents,
  getGrammarPoint,
  grammarPointsAtOrBelow,
  userGrammarMastery,
  updateMastery,
  exerciseWordHints,
} from '@language-drill/db';
import {
  createObservedClaudeClient,
  evaluateAnswer,
  gradeDictationAnswer,
  evaluateFreeWriting,
  EVALUATION_SYSTEM_PROMPT_VERSION,
  DICTATION_EVAL_PROMPT_VERSION,
  EVAL_REQUEST_TIMEOUT_MS,
  EVAL_MAX_RETRIES,
  FREE_WRITING_EVAL_PROMPT_VERSION,
  FREE_WRITING_EVAL_REQUEST_TIMEOUT_MS,
  FREE_WRITING_EVAL_MAX_RETRIES,
  generateBrainstorm,
  generateVocabBoost,
  generateStartMyParagraph,
  BRAINSTORM_PROMPT_VERSION,
  VOCAB_BOOST_PROMPT_VERSION,
  START_MY_PARAGRAPH_PROMPT_VERSION,
  WRITING_HELPER_REQUEST_TIMEOUT_MS,
  WRITING_HELPER_MAX_RETRIES,
  withLlmTrace,
  ContentRejectedError,
  generateWordHints,
  WORD_HINT_PROMPT_VERSION,
  WORD_HINT_REQUEST_TIMEOUT_MS,
  WORD_HINT_MAX_RETRIES,
} from '@language-drill/ai';
import { db } from '../db';
import { approvedStatusFilter, audioReadyFilter, freshFirstOrderBy } from '../lib/exercise-filters';
import { resolveTargetedDifficulty } from '../lib/targeted-difficulty';
import { resolveWordHints, evidenceWeightFromHints } from '../lib/word-hints';
import {
  conjugationSignature,
  dedupeBySignature,
  CONJUGATION_SET_DEFAULT,
  CONJUGATION_SET_MAX,
  CONJUGATION_SET_FETCH_CAP,
} from '../lib/exercise-set';
import { recordErrorObservations, freeWritingErrorsToEvaluationErrors } from '../lib/errors/record';
import { incidentalObservations } from '../lib/mastery/incidental-fold';
import { presignAudioUrl } from '../lib/audio-url';
import { withAudioUrl } from '../lib/dictation-content';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import { limitFor } from '../usage/limits';
import { getEffectivePlan, isAdmin } from '../usage/plan';
import { checkGlobalCapacity } from '../usage/global-capacity';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

/** Query params for GET /exercises */
export const ExerciseQuerySchema = z.object({
  language: z.nativeEnum(Language),
  difficulty: z.nativeEnum(CefrLevel),
  type: z.nativeEnum(ExerciseType).optional(),
  grammarPoint: z.string().min(1).optional(),
});

/** Request body for POST /exercises/:id/submit */
export const SubmitAnswerSchema = z.object({
  // `.max()` caps token-cost exposure: the answer is interpolated raw into the
  // evaluation prompt and sent to Claude (free writing runs a larger model), so
  // an unbounded answer is a cost-amplification lever (and very long prompts
  // push against the eval timeout). See EXERCISE_ANSWER_MAX_CHARS for the
  // rationale.
  answer: z.string().min(1).max(EXERCISE_ANSWER_MAX_CHARS),
  sessionId: z.string().uuid().optional(),
  hintUsage: z.object({
    wordsRevealed: z.number().int().nonnegative(),
    fullAnswerRevealed: z.boolean(),
  }).optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const exercises = new Hono<{ Bindings: Bindings; Variables: Variables }>();

exercises.use('/exercises/*', authMiddleware);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Curriculum grounding + closed attribution key set for the evaluator.
 * Shared by the submit and explain paths so both feed Claude identically. */
function resolveEvaluationGuidance(exercise: {
  grammarPointKey: string | null;
  language: string | null;
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

/**
 * Best-effort per-grammar-point Bayesian mastery update.
 * A failure here must never fail the caller — errors are swallowed after logging.
 */
async function applyGrammarMastery(opts: {
  userId: string;
  language: Language;
  grammarPointKey: string | null;
  difficulty: CefrLevel;
  score: number;
  evidenceWeight?: number;
}): Promise<void> {
  if (!opts.grammarPointKey) return;
  try {
    const at = new Date();
    const existing = await db
      .select({
        masteryScore: userGrammarMastery.masteryScore,
        confidence: userGrammarMastery.confidence,
        evidenceCount: userGrammarMastery.evidenceCount,
        lastPracticedAt: userGrammarMastery.lastPracticedAt,
      })
      .from(userGrammarMastery)
      .where(
        and(
          eq(userGrammarMastery.userId, opts.userId),
          eq(userGrammarMastery.grammarPointKey, opts.grammarPointKey),
        ),
      )
      .limit(1);

    const next = updateMastery(existing[0] ?? null, {
      score: opts.score,
      difficulty: opts.difficulty,
      at,
      evidenceWeight: opts.evidenceWeight,
    });

    await db
      .insert(userGrammarMastery)
      .values({
        userId: opts.userId,
        language: opts.language,
        grammarPointKey: opts.grammarPointKey,
        masteryScore: next.masteryScore,
        confidence: next.confidence,
        evidenceCount: next.evidenceCount,
        lastPracticedAt: next.lastPracticedAt,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: [userGrammarMastery.userId, userGrammarMastery.grammarPointKey],
        set: {
          masteryScore: next.masteryScore,
          confidence: next.confidence,
          evidenceCount: next.evidenceCount,
          lastPracticedAt: next.lastPracticedAt,
          updatedAt: at,
          language: opts.language,
        },
      });
  } catch (masteryErr) {
    console.error('[submit] mastery update failed (non-fatal):', masteryErr);
  }
}

// ---------------------------------------------------------------------------
// GET /exercises — return a random exercise matching the given filters
// ---------------------------------------------------------------------------
exercises.get('/exercises', async (c) => {
  const parsed = ExerciseQuerySchema.safeParse(c.req.query());

  if (!parsed.success) {
    return c.json(
      { error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      400,
    );
  }

  const { language, difficulty, type, grammarPoint: grammarPointKey } = parsed.data;
  const userId = c.get('userId');

  const conditions = [
    eq(exercisesTable.language, language),
    eq(exercisesTable.difficulty, difficulty),
    approvedStatusFilter(exercisesTable),
    // Never serve a dictation row whose audio hasn't been synthesized yet.
    audioReadyFilter(exercisesTable),
  ];

  if (type) {
    conditions.push(eq(exercisesTable.type, type));
  }

  if (grammarPointKey) {
    conditions.push(eq(exercisesTable.grammarPointKey, grammarPointKey));
  }

  // Exposure control: order the matching pool slice so never-attempted items
  // come first (NULLS FIRST), then least-recently-seen, with a random tiebreak
  // within each group — a returning user isn't re-served an item until the
  // fresh pool for this filter is exhausted. This supersedes the prior
  // uniform-random-by-id sampling: exposure requires ordering by seen-state, so
  // a single ordered LIMIT 1 is both correct and simpler than a two-step draw.
  // freshFirstOrderBy binds userId as a parameter and correlates on
  // exercises.id (see lib/exercise-filters.ts).
  const rows = await db
    .select()
    .from(exercisesTable)
    .where(and(...conditions))
    .orderBy(freshFirstOrderBy(userId))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'No exercises found', code: 'NO_EXERCISES' }, 404);
  }

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
});

// ---------------------------------------------------------------------------
// GET /exercises/set — return N distinct-by-content exercises for a sitting
// ---------------------------------------------------------------------------
// The conjugation pool holds exact-duplicate content rows, so the single-row
// random draw (GET /exercises) can repeat the same prompt within a session.
// This endpoint pulls a freshness-ordered window and de-dupes by content
// signature, so an open-ended conjugation sitting never repeats an item.
// Registered BEFORE GET /exercises/:id so `/exercises/set` isn't captured as
// an `:id` of "set".
const ExerciseSetQuerySchema = z.object({
  language: z.nativeEnum(Language),
  difficulty: z.nativeEnum(CefrLevel),
  type: z.nativeEnum(ExerciseType).optional(),
  grammarPoint: z.string().min(1).optional(),
  count: z.coerce.number().int().min(1).max(CONJUGATION_SET_MAX).optional(),
});

exercises.get('/exercises/set', async (c) => {
  const parsed = ExerciseSetQuerySchema.safeParse(c.req.query());

  if (!parsed.success) {
    return c.json(
      { error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      400,
    );
  }

  const { language, difficulty: requestedDifficulty, type, grammarPoint: grammarPointKey, count } = parsed.data;
  const userId = c.get('userId');
  const target = count ?? CONJUGATION_SET_DEFAULT;

  // A grammar-point-targeted pull filters at the point's OWN level, not the
  // caller's profile level — mirrors POST /sessions (see
  // lib/targeted-difficulty.ts). Untargeted pulls (no grammarPoint) are
  // unaffected: resolveTargetedDifficulty passes the requested value through.
  const difficulty = resolveTargetedDifficulty(requestedDifficulty, grammarPointKey);

  const conditions = [
    eq(exercisesTable.language, language),
    eq(exercisesTable.difficulty, difficulty),
    approvedStatusFilter(exercisesTable),
    audioReadyFilter(exercisesTable),
  ];

  if (type) {
    conditions.push(eq(exercisesTable.type, type));
  }

  if (grammarPointKey) {
    conditions.push(eq(exercisesTable.grammarPointKey, grammarPointKey));
  }

  // Pull a freshness-ordered window (never-seen first, random tiebreak), then
  // de-dupe by content signature and slice to `target` — duplicate-content rows
  // collapse to one, so the served set carries no in-session repeats.
  const rows = await db
    .select()
    .from(exercisesTable)
    .where(and(...conditions))
    .orderBy(freshFirstOrderBy(userId))
    .limit(CONJUGATION_SET_FETCH_CAP);

  const chosen = dedupeBySignature(
    rows,
    target,
    (row) => `${row.grammarPointKey ?? ''}|${conjugationSignature(row.contentJson)}`,
  );

  const exercisesOut = await Promise.all(
    chosen.map(async (row) => {
      const audioUrl = await presignAudioUrl(row.audioS3Key);
      return {
        id: row.id,
        type: row.type,
        language: row.language,
        difficulty: row.difficulty,
        grammarPointKey: row.grammarPointKey,
        contentJson: withAudioUrl(row.contentJson, audioUrl),
      };
    }),
  );

  return c.json({ exercises: exercisesOut, available: exercisesOut.length, difficulty });
});

// ---------------------------------------------------------------------------
// GET /exercises/:id — return a single exercise by ID
// ---------------------------------------------------------------------------
exercises.get('/exercises/:id', async (c) => {
  const id = c.req.param('id');

  const rows = await db
    .select()
    .from(exercisesTable)
    .where(
      and(
        eq(exercisesTable.id, id),
        approvedStatusFilter(exercisesTable),
        // Never serve a dictation row whose audio hasn't been synthesized yet.
        audioReadyFilter(exercisesTable),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Exercise not found', code: 'EXERCISE_NOT_FOUND' }, 404);
  }

  const row = rows[0];
  return c.json({
    id: row.id,
    type: row.type,
    language: row.language,
    difficulty: row.difficulty,
    grammarPointKey: row.grammarPointKey,
    contentJson: withAudioUrl(row.contentJson, await presignAudioUrl(row.audioS3Key)),
  });
});

// ---------------------------------------------------------------------------
// POST /exercises/:id/submit — evaluate the user's answer via Claude
// ---------------------------------------------------------------------------
exercises.post('/exercises/:id/submit', async (c) => {
  const id = c.req.param('id');

  // 1. Validate request body
  const bodyResult = SubmitAnswerSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!bodyResult.success) {
    return c.json(
      { error: 'Invalid request body', code: 'VALIDATION_ERROR', details: bodyResult.error.flatten() },
      400,
    );
  }
  const { answer: userAnswer, sessionId, hintUsage } = bodyResult.data;
  const evidenceWeight = evidenceWeightFromHints(hintUsage);

  // 2. Fetch exercise by ID. Deliberately no `audioReadyFilter` here: grading
  // needs no audio, and the serve/discovery paths already gate exposure, so an
  // audioless dictation row can't reach submit anyway.
  const rows = await db
    .select()
    .from(exercisesTable)
    .where(and(eq(exercisesTable.id, id), approvedStatusFilter(exercisesTable)))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Exercise not found', code: 'EXERCISE_NOT_FOUND' }, 404);
  }

  const exercise = rows[0];
  const userId = c.get('userId');

  // Resolve curriculum grounding for the evaluator from the exercise's grammar
  // point. The evaluator runs on Haiku and otherwise sees only the exercise
  // content, so feeding it the authoritative rule + common errors stops it
  // confabulating rationales for rule-driven answers (e.g. the soft-l loanword
  // plural meşgul → meşguller). Best-effort: skipped when the key is absent or
  // not in the curriculum index. Closed key set for per-error attribution: the
  // grammar points the learner at this (language, level) has plausibly
  // studied. EN is source-only (no curriculum) → empty, which disables
  // attribution for that path.
  const { grammarGuidance, attributionKeys } = resolveEvaluationGuidance(exercise);

  // 2b. Validate session linkage BEFORE rate-limit + Claude — no side effects on failure
  if (sessionId !== undefined) {
    const sessionRows = await db
      .select({
        userId: practiceSessions.userId,
        completedAt: practiceSessions.completedAt,
        exerciseIds: practiceSessions.exerciseIds,
      })
      .from(practiceSessions)
      .where(eq(practiceSessions.id, sessionId))
      .limit(1);

    const session = sessionRows[0];
    if (
      !session ||
      session.userId !== userId ||
      session.completedAt !== null ||
      !session.exerciseIds.includes(id)
    ) {
      return c.json({ error: 'Invalid session', code: 'INVALID_SESSION' }, 400);
    }
  }

  // Deterministic, zero-Claude grading for conjugation drills.
  // No ai_evaluation bucket spend, no capacity/daily-cap gate, no Claude call.
  if (exercise.type === ExerciseType.CONJUGATION) {
    const content = exercise.contentJson as ExerciseContent;
    if (!isConjugationContent(content)) {
      return c.json(
        { error: 'Conjugation exercise content is malformed', code: 'EXERCISE_CONTENT_INVALID' },
        500,
      );
    }
    const correct = gradeFluencyAnswer(content, userAnswer);
    const score = correct ? 1 : 0;
    const result: EvaluationResult = {
      score,
      grammarAccuracy: score,
      // No vocabulary axis for a conjugation drill (it maps to the grammar
      // radar axis). We echo the exercise difficulty as a neutral placeholder
      // rather than a learner-derived vocabulary estimate.
      vocabularyRange: exercise.difficulty ?? '',
      taskAchievement: score,
      feedback: correct
        ? `Correct — ${content.targetForm}. ${content.breakdown}`
        : `Not quite. The correct form is ${content.targetForm}. ${content.breakdown}`,
      errors: correct
        ? []
        : [
            {
              type: 'grammar',
              severity: 'major',
              text: userAnswer,
              correction: content.targetForm,
              explanation: content.breakdown,
            },
          ],
      estimatedCefrEvidence: exercise.difficulty ?? '',
      evaluationSource: 'deterministic',
    };

    const submissionId = randomUUID();
    await db.insert(userExerciseHistory).values({
      id: submissionId,
      userId,
      exerciseId: id,
      sessionId,
      score,
      responseJson: { userAnswer, evaluation: result },
      evaluatedAt: new Date(),
      evidenceWeight,
    });

    await applyGrammarMastery({
      userId,
      language: exercise.language as Language,
      grammarPointKey: exercise.grammarPointKey,
      difficulty: exercise.difficulty as CefrLevel,
      score,
      evidenceWeight,
    });

    return c.json({ ...result, submissionId });
  }

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
        evidenceWeight,
      });

      await applyGrammarMastery({
        userId,
        language: exercise.language as Language,
        grammarPointKey: exercise.grammarPointKey,
        difficulty: exercise.difficulty as CefrLevel,
        score: 1,
        evidenceWeight,
      });

      return c.json({ ...result, submissionId });
    }
    // fall through to the normal LLM evaluation
  }

  // 3. Resolve tier, run the global brake, then the per-user daily cap.
  const plan = await getEffectivePlan(userId);

  const capacity = await checkGlobalCapacity({ plan, admin: isAdmin(userId) });
  if (capacity !== 'ok') {
    return c.json(
      {
        error: 'AI temporarily at capacity',
        code: 'GLOBAL_CAPACITY',
      },
      503,
    );
  }

  // Per-user daily cap. This is a check-then-insert (SELECT count → … →
  // INSERT the usage event on success), so two requests racing at the
  // boundary can both read count = limit-1 and both proceed; a burst can
  // overshoot the daily cap by roughly the concurrency factor. This is
  // accepted at current scale (single-user/low-volume) the same way
  // `usage/global-capacity.ts` accepts its 60s cache drift — the cap is a
  // cost guardrail, not a billing-grade meter. A hard guarantee would need an
  // atomic Upstash INCR or an insert-first transaction (the latter also bills
  // failed Claude calls); revisit if abuse or multi-user load makes the
  // overshoot material.
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
    return c.json(
      { error: 'Daily evaluation limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
      429,
    );
  }

  // 4. Mint the submissionId BEFORE the Claude call so the userExerciseHistory
  // row id and the Langfuse trace id are 1:1 — enables a one-click jump from
  // the DB row to the trace (Req 9 AC 2). UUID v4 fits the existing
  // `uuid().defaultRandom()` column without a schema change.
  const submissionId = randomUUID();
  const requestId =
    (c.env?.event as { requestContext?: { requestId?: string } } | undefined)
      ?.requestContext?.requestId ?? 'local';

  // 5. Call Claude for evaluation
  try {
    const content = exercise.contentJson as ExerciseContent;
    const isFreeWriting = isFreeWritingContent(content);

    // Eval-specific timeout/retries (Req 4.1): this client is constructed per
    // submit and used only for the evaluation call, so the fail-fast posture
    // is applied at construction (robust against the Langfuse Proxy not
    // forwarding per-request options). Free writing uses a larger budget.
    const client = createObservedClaudeClient(ANTHROPIC_API_KEY, {
      timeout: isFreeWriting ? FREE_WRITING_EVAL_REQUEST_TIMEOUT_MS : EVAL_REQUEST_TIMEOUT_MS,
      maxRetries: isFreeWriting ? FREE_WRITING_EVAL_MAX_RETRIES : EVAL_MAX_RETRIES,
    });

    const isDictation = exercise.type === ExerciseType.DICTATION;

    const traceMeta = {
      env: (process.env.LANGFUSE_ENV ?? 'dev') as 'prod' | 'dev',
      requestId,
      userId,
      submissionId,
      // R8: shared Langfuse join key with the generation+validation traces
      // for this exercise (`exercises.id` PK; same deterministic UUID).
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
            attributionKeys,
          }),
      );

      // 6. Record history and usage on success.
      await db.insert(userExerciseHistory).values({
        id: submissionId,
        userId,
        exerciseId: id,
        sessionId,
        score: evaluation.overallScore,
        responseJson: { userAnswer, evaluation },
        evaluatedAt: new Date(),
        evidenceWeight,
      });

      await recordErrorObservations(db, {
        errors: freeWritingErrorsToEvaluationErrors(evaluation.errors),
        userId,
        language: exercise.language as string,
        exerciseId: id,
        sessionId: sessionId ?? null,
        exerciseHistoryId: submissionId,
        exerciseType: exercise.type as string,
        hostGrammarPointKey: exercise.grammarPointKey,
        occurredAt: new Date(),
      });

      await db.insert(usageEvents).values({
        userId,
        eventType: 'ai_evaluation',
        metadata: { exerciseId: id, language: exercise.language, difficulty: exercise.difficulty },
      });

      return c.json({ ...evaluation, submissionId });
    }

    const result = await withLlmTrace(
      { ...traceMeta, feature: 'evaluate', promptVersion: isDictation ? DICTATION_EVAL_PROMPT_VERSION : EVALUATION_SYSTEM_PROMPT_VERSION },
      () =>
        isDictation
          ? gradeDictationAnswer(client, {
              exercise: content as DictationContent,
              userAnswer,
              language: exercise.language as Language,
              difficulty: exercise.difficulty as CefrLevel,
            })
          : evaluateAnswer(client, {
              exercise: content,
              userAnswer,
              language: exercise.language as Language,
              difficulty: exercise.difficulty as CefrLevel,
              grammarGuidance,
              attributionKeys,
            }),
    );
    const stamped = { ...result, evaluationSource: 'llm' as const };

    // 6. Record history and usage on success — `id: submissionId` makes the
    // history row id equal to the Langfuse trace tag (see step 4 above).
    await db.insert(userExerciseHistory).values({
      id: submissionId,
      userId,
      exerciseId: id,
      sessionId,
      score: result.score,
      responseJson: { userAnswer, evaluation: stamped },
      evaluatedAt: new Date(),
      evidenceWeight,
    });

    await recordErrorObservations(db, {
      errors: result.errors,
      userId,
      language: exercise.language as string,
      exerciseId: id,
      sessionId: sessionId ?? null,
      exerciseHistoryId: submissionId,
      exerciseType: exercise.type as string,
      hostGrammarPointKey: exercise.grammarPointKey,
      occurredAt: new Date(),
    });

    // Fold incidental slips into the VIOLATED point's mastery (Phase 3): an error
    // attributed to a point other than the host gets no signal today, so a point
    // can read "mastered" while generating the most errors. Best-effort.
    for (const obs of incidentalObservations(result.errors, exercise.grammarPointKey, new Date())) {
      const point = getGrammarPoint(obs.grammarPointKey);
      if (!point) continue;
      await applyGrammarMastery({
        userId,
        language: exercise.language as Language,
        grammarPointKey: obs.grammarPointKey,
        difficulty: point.cefrLevel as CefrLevel,
        score: obs.score,
      });
    }

    await db.insert(usageEvents).values({
      userId,
      eventType: 'ai_evaluation',
      metadata: { exerciseId: id, language: exercise.language, difficulty: exercise.difficulty },
    });

    // Best-effort per-grammar-point mastery update. A failure here must never
    // fail the submission — the authoritative signal is the history row above.
    await applyGrammarMastery({
      userId,
      language: exercise.language as Language,
      grammarPointKey: exercise.grammarPointKey,
      difficulty: exercise.difficulty as CefrLevel,
      score: result.score,
      evidenceWeight,
    });

    return c.json({ ...stamped, submissionId });
  } catch (err) {
    // 7a. Safety refusal — the model declined to evaluate this answer (e.g. a
    // provocative or off-task submission). This is an expected outcome, not an
    // outage: tell the learner their submission was rejected, and don't log it
    // as an infra error. No history/usage row is written.
    if (err instanceof ContentRejectedError) {
      console.warn('[POST /exercises/:id/submit] answer rejected by safety:', err.message);
      return c.json(
        {
          error: "We couldn't evaluate that submission. Please revise it and try again.",
          code: 'CONTENT_REJECTED',
        },
        422,
      );
    }
    // 7b. Claude failure — do NOT write to history. The Proxy already
    // finalized the Langfuse generation with level=ERROR (Req 5 AC 3)
    // before re-throwing here.
    console.error('[POST /exercises/:id/submit] Claude evaluation failed:', err);
    return c.json(
      { error: 'Evaluation temporarily unavailable', code: 'AI_UNAVAILABLE' },
      502,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /exercises/:id/submissions/:submissionId/explain — on-demand LLM
// feedback for a deterministic (exact-match) submission. Metered + gated
// like submit: this IS a real Claude call. The stored verdict is never
// re-scored — the LLM output is feedback enrichment only, cached into
// responseJson.explanation so repeat taps are free.
// ---------------------------------------------------------------------------
exercises.post('/exercises/:id/submissions/:submissionId/explain', async (c) => {
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

  // Cached — free, no gates. A schema-legal empty string is still a cache
  // hit (falsy check would treat it as a miss and re-meter every tap).
  if (typeof responseJson.explanation === 'string') {
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

  // Conjugation feedback already carries the pre-authored breakdown — there
  // is nothing further to explain, and the evaluator prompt-builder throws
  // for CONJUGATION by design. Cleanly non-explainable, not a 502.
  if (exercise.type === ExerciseType.CONJUGATION) {
    return c.json(
      { error: 'Conjugation feedback already includes the explanation', code: 'NOT_EXPLAINABLE' },
      400,
    );
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

// ---------------------------------------------------------------------------
// Getting-unstuck helpers — POST /exercises/:id/brainstorm | /vocab-boost
// ---------------------------------------------------------------------------
// Both share one metered gate: load the approved free-writing exercise, run the
// global brake, enforce the shared `writing_helper` daily cap, call Claude, then
// meter exactly one `writing_helper` event. No DB persistence of the result.
type WritingHelperFeature = 'free-writing-brainstorm' | 'free-writing-vocab-boost' | 'free-writing-start-my-paragraph';

async function runWritingHelper<R>(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  id: string,
  opts: {
    feature: WritingHelperFeature;
    promptVersion: string;
    generate: (
      client: ReturnType<typeof createObservedClaudeClient>,
      input: { content: FreeWritingContent; language: Language; difficulty: CefrLevel },
    ) => Promise<R>;
  },
) {
  const rows = await db
    .select()
    .from(exercisesTable)
    .where(and(eq(exercisesTable.id, id), approvedStatusFilter(exercisesTable)))
    .limit(1);
  if (rows.length === 0) {
    return c.json({ error: 'Exercise not found', code: 'EXERCISE_NOT_FOUND' }, 404);
  }
  const exercise = rows[0];
  const content = exercise.contentJson as ExerciseContent;
  if (!isFreeWritingContent(content)) {
    return c.json(
      { error: 'Helpers are only available for free-writing exercises', code: 'BAD_EXERCISE_TYPE' },
      400,
    );
  }
  const userId = c.get('userId');

  const plan = await getEffectivePlan(userId);
  const capacity = await checkGlobalCapacity({ plan, admin: isAdmin(userId) });
  if (capacity !== 'ok') {
    return c.json({ error: 'AI temporarily at capacity', code: 'GLOBAL_CAPACITY' }, 503);
  }

  // Check-then-insert daily cap — same accepted boundary-overshoot race as the
  // submit route; the cap is a cost guardrail, not a billing-grade meter.
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [{ count: todayCount }] = await db
    .select({ count: count() })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        eq(usageEvents.eventType, 'writing_helper'),
        gte(usageEvents.createdAt, oneDayAgo),
      ),
    );
  if (Number(todayCount) >= limitFor('writing_helper', plan)) {
    return c.json({ error: 'Daily writing-helper limit exceeded', code: 'RATE_LIMIT_EXCEEDED' }, 429);
  }

  if (!ANTHROPIC_API_KEY) {
    return c.json({ error: 'Writing helpers temporarily unavailable', code: 'AI_UNAVAILABLE' }, 502);
  }

  const requestId =
    (c.env?.event as { requestContext?: { requestId?: string } } | undefined)
      ?.requestContext?.requestId ?? 'local';
  const client = createObservedClaudeClient(ANTHROPIC_API_KEY, {
    timeout: WRITING_HELPER_REQUEST_TIMEOUT_MS,
    maxRetries: WRITING_HELPER_MAX_RETRIES,
  });

  let result: R;
  try {
    result = await withLlmTrace(
      {
        env: (process.env.LANGFUSE_ENV ?? 'dev') as 'prod' | 'dev',
        requestId,
        userId,
        exerciseId: id,
        language: exercise.language as Language,
        cefrLevel: exercise.difficulty as CefrLevel,
        exerciseType: exercise.type as ExerciseType,
        feature: opts.feature,
        promptVersion: opts.promptVersion,
      },
      () =>
        opts.generate(client, {
          content,
          language: exercise.language as Language,
          difficulty: exercise.difficulty as CefrLevel,
        }),
    );
  } catch (err) {
    console.error(`[${opts.feature}] generation failed:`, err);
    return c.json({ error: 'Writing helpers temporarily unavailable', code: 'AI_UNAVAILABLE' }, 502);
  }

  await db.insert(usageEvents).values({
    userId,
    eventType: 'writing_helper',
    metadata: { exerciseId: id, language: exercise.language, difficulty: exercise.difficulty, kind: opts.feature },
  });

  return c.json(result);
}

exercises.post('/exercises/:id/brainstorm', (c) =>
  runWritingHelper(c, c.req.param('id'), {
    feature: 'free-writing-brainstorm',
    promptVersion: BRAINSTORM_PROMPT_VERSION,
    generate: generateBrainstorm,
  }),
);

exercises.post('/exercises/:id/vocab-boost', (c) =>
  runWritingHelper(c, c.req.param('id'), {
    feature: 'free-writing-vocab-boost',
    promptVersion: VOCAB_BOOST_PROMPT_VERSION,
    generate: generateVocabBoost,
  }),
);

exercises.post('/exercises/:id/start-my-paragraph', (c) =>
  runWritingHelper(c, c.req.param('id'), {
    feature: 'free-writing-start-my-paragraph',
    promptVersion: START_MY_PARAGRAPH_PROMPT_VERSION,
    generate: generateStartMyParagraph,
  }),
);

class WordHintLimitError extends Error {
  constructor(
    public status: 429 | 503,
    public code: string,
  ) {
    super(code);
  }
}

exercises.post('/exercises/:id/word-hints', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');

  const rows = await db.select().from(exercisesTable).where(eq(exercisesTable.id, id)).limit(1);
  const exercise = rows[0];
  if (!exercise) return c.json({ error: 'Exercise not found', code: 'NOT_FOUND' }, 404);
  const content = exercise.contentJson as ExerciseContent;
  if (!isTranslationContent(content)) {
    return c.json({ error: 'Word hints are only available for translation exercises', code: 'UNSUPPORTED' }, 400);
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
        if (capacity !== 'ok') throw new WordHintLimitError(503, 'GLOBAL_CAPACITY');
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
          throw new WordHintLimitError(429, 'RATE_LIMIT_EXCEEDED');
        }
      },
      generate: async () => {
        const client = createObservedClaudeClient(ANTHROPIC_API_KEY, {
          timeout: WORD_HINT_REQUEST_TIMEOUT_MS,
          maxRetries: WORD_HINT_MAX_RETRIES,
        });
        const requestId =
          (c.env?.event as { requestContext?: { requestId?: string } } | undefined)
            ?.requestContext?.requestId ?? 'local';
        return withLlmTrace(
          {
            env: (process.env.LANGFUSE_ENV ?? 'dev') as 'prod' | 'dev',
            requestId,
            userId,
            exerciseId: id,
            language: exercise.language as Language,
            cefrLevel: exercise.difficulty as CefrLevel,
            feature: 'word-hint',
            promptVersion: WORD_HINT_PROMPT_VERSION,
          },
          () => generateWordHints(client, {
            sourceText: content.sourceText,
            referenceTranslation: content.referenceTranslation,
            sourceLanguage: content.sourceLanguage,
            targetLanguage: content.targetLanguage,
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
    if (err instanceof WordHintLimitError) {
      const msg = err.status === 429 ? 'Daily word-hint limit exceeded' : 'AI temporarily at capacity';
      return c.json({ error: msg, code: err.code }, err.status);
    }
    console.error('[word-hints] generation failed:', err);
    return c.json({ error: 'Could not generate hints', code: 'AI_UNAVAILABLE' }, 502);
  }
});

export default exercises;
