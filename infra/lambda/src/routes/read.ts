import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, count, desc, eq, gte, sql } from 'drizzle-orm';
import {
  CefrLevel,
  DeepCardSchema,
  FlaggedMapSchema,
  Language,
  READ_HISTORY_LIMIT,
  READ_PREVIEW_CHARS,
  READ_SOURCE_MAX_CHARS,
  READ_TEXT_MAX_CHARS,
  READ_TITLE_MAX_CHARS,
} from '@language-drill/shared';
import type { DeepCard, LearningLanguage } from '@language-drill/shared';
import {
  readEntries,
  userLanguageProfiles,
  userVocabulary,
  usageEvents,
  vocabularyReviewState,
} from '@language-drill/db';
import {
  annotateSpan,
  createObservedClaudeClient,
  READ_SPAN_PROMPT_VERSION,
  withLlmTrace,
} from '@language-drill/ai';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import { resolveSpanType } from './read-span-utils';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';

// Per-user daily cap for on-demand deep span annotations (Req 10.2). This is a
// SEPARATE budget from the shared `ai_evaluation`/`read_annotation` 50/day
// bucket — counted off its own `read_span_annotation` event type — because a
// single reading session can fire many cheap span taps and must not starve the
// answer-evaluation budget. Mirrors `DAILY_EVAL_LIMIT` in `routes/exercises.ts`
// as a route-module constant.
const READ_SPAN_DAILY_LIMIT = 150;

// CEFR fallback for the deep call when the user has no profile row for this
// language — same default `annotate-stream/pipeline.ts` applies.
const DEFAULT_PROFICIENCY_LEVEL = CefrLevel.B1;
const CEFR_LEVELS = new Set<string>(Object.values(CefrLevel));

function isCefrLevel(value: string | null | undefined): value is CefrLevel {
  return typeof value === 'string' && CEFR_LEVELS.has(value);
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
// EN is a source-only language for translation exercises, not a learning
// target — the Lambda owns its own copy of the ES/DE/TR-only enum so it
// doesn't depend on the api-client package. Mirrors the comment block in
// `routes/sessions.ts:27–30`.
// ---------------------------------------------------------------------------

const LearningLanguageEnum = z.enum([Language.ES, Language.DE, Language.TR]);

const ListEntriesQuerySchema = z.object({
  language: LearningLanguageEnum,
});

// Allows `bank.length === 0` so the user can clear their bank for a saved
// entry (Requirement 8.8). Server-side cross-field check verifies every entry
// is a key of the persisted `flagged_words` (Requirement 9.2).
const UpdateBankBodySchema = z.object({
  bank: z.array(z.string().min(1)),
});

// `bank.length >= 1` is enforced server-side per Requirement 8.1: an empty-bank
// save has no v1 use case, and the UI gates the save action on the same rule.
const SaveEntryBodySchema = z.object({
  language: LearningLanguageEnum,
  title: z.string().max(READ_TITLE_MAX_CHARS),
  source: z.string().max(READ_SOURCE_MAX_CHARS),
  text: z.string().min(1).max(READ_TEXT_MAX_CHARS),
  flagged: FlaggedMapSchema,
  bank: z.array(z.string().min(1)).min(1),
});

// Deep span-annotation request (Req 10.4). `start`/`end` are character offsets
// into `text`; the `start < end` and `end <= text.length` cross-field checks
// run after `safeParse` (Zod can't express them inline). `entryId` is present
// only for a SAVED History entry — its absence means there's no durable cache
// and no write-back (Req 11.2). The client may send a `spanType` hint, but the
// server recomputes it authoritatively, so it's not part of the schema.
const AnnotateSpanBodySchema = z.object({
  language: LearningLanguageEnum,
  text: z.string().min(1).max(READ_TEXT_MAX_CHARS),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  entryId: z.string().uuid().optional(),
});

// Save a deep card to the personal vocabulary bank (Req 8). The resolved
// `DeepCard` exists only transiently client-side, so the client posts the
// whole card here and the server snapshots it verbatim into the `card` jsonb
// (Req 8.2). `sourceReadEntryId` is optional — an unsaved passage has no
// durable entry. Sentence cards are rejected after parse (Req 8.6) since the
// discriminated union still accepts them at the schema level.
const SaveVocabularyBodySchema = z.object({
  language: LearningLanguageEnum,
  card: DeepCardSchema,
  sourceReadEntryId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const read = new Hono<{ Bindings: Bindings; Variables: Variables }>();

read.use('/read/*', authMiddleware);

// ---------------------------------------------------------------------------
// POST /read/entries — persist a freshly-annotated passage + its bank
// ---------------------------------------------------------------------------
// Atomic INSERT into `read_entries` + bulk upsert into `user_vocabulary`
// inside a single Drizzle transaction. Either both writes commit or both
// roll back, so the entry's bank column and the per-user vocab rows can
// never drift (Requirement 9.3). The entry-write is read-only with respect
// to drills — only `user_vocabulary` is consumed by the future drill-weaving
// phase (Requirement 13).
// ---------------------------------------------------------------------------
read.post('/read/entries', async (c) => {
  const bodyResult = SaveEntryBodySchema.safeParse(
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
  const { language, title, source, text, flagged, bank } = bodyResult.data;

  // Cross-field invariant: every bank entry must be a key of `flagged`.
  // Zod cannot express this naturally, so it lives here.
  for (const word of bank) {
    if (!Object.prototype.hasOwnProperty.call(flagged, word)) {
      return c.json(
        {
          error: 'Bank contains a word missing from flagged',
          code: 'VALIDATION_ERROR',
          details: { word },
        },
        400,
      );
    }
  }

  const userId = c.get('userId');

  const result = await db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(readEntries)
      .values({
        userId,
        language: language as LearningLanguage,
        title,
        source,
        text,
        flaggedWords: flagged,
        bank,
      })
      .returning({ id: readEntries.id, pastedAt: readEntries.pastedAt });

    const vocabRows = bank.map((word) => {
      const flag = flagged[word];
      return {
        userId,
        language: language as LearningLanguage,
        word,
        lemma: flag.lemma,
        source: 'reading',
        sourceReadEntryId: entry.id,
        pos: flag.pos,
        gloss: flag.gloss,
        // `example` is now optional on the skim WordFlag (the slim pass omits
        // it); fall back to empty for this NOT NULL column.
        exampleSentence: flag.example ?? '',
        frequencyRank: flag.freq,
        cefrBand: flag.cefr as CefrLevel,
      };
    });

    await tx
      .insert(userVocabulary)
      .values(vocabRows)
      .onConflictDoUpdate({
        target: [userVocabulary.userId, userVocabulary.language, userVocabulary.word],
        set: {
          lemma: sql`excluded.lemma`,
          source: sql`excluded.source`,
          sourceReadEntryId: sql`excluded.source_read_entry_id`,
          pos: sql`excluded.pos`,
          gloss: sql`excluded.gloss`,
          exampleSentence: sql`excluded.example_sentence`,
          frequencyRank: sql`excluded.frequency_rank`,
          cefrBand: sql`excluded.cefr_band`,
          addedAt: sql`now()`,
        },
      });

    return entry;
  });

  return c.json(
    {
      id: result.id,
      pastedAt: (result.pastedAt as Date).toISOString(),
    },
    201,
  );
});

// ---------------------------------------------------------------------------
// GET /read/entries — paginated history list (Requirement 10.1)
// ---------------------------------------------------------------------------
// Single SELECT projecting summary columns plus three Postgres expressions:
//   - preview      = first 120 chars of `text` (server-truncated)
//   - savedCount   = jsonb_array_length(bank)
//   - flaggedCount = number of keys in flaggedWords
// Capped at READ_HISTORY_LIMIT (50); ORDER BY pasted_at DESC, id DESC so two
// rows sharing a millisecond have a stable tiebreak. No pagination cursor
// in v1 — older rows are simply excluded.
// ---------------------------------------------------------------------------
read.get('/read/entries', async (c) => {
  const queryResult = ListEntriesQuerySchema.safeParse(c.req.query());
  if (!queryResult.success) {
    return c.json(
      {
        error: 'Invalid query parameters',
        code: 'VALIDATION_ERROR',
        details: queryResult.error.flatten(),
      },
      400,
    );
  }
  const { language } = queryResult.data;
  const userId = c.get('userId');

  const rows = await db
    .select({
      id: readEntries.id,
      title: readEntries.title,
      source: readEntries.source,
      pastedAt: readEntries.pastedAt,
      preview: sql<string>`substring(${readEntries.text} from 1 for ${READ_PREVIEW_CHARS})`,
      savedCount: sql<number>`jsonb_array_length(${readEntries.bank})`,
      flaggedCount: sql<number>`(select count(*)::int from jsonb_each(${readEntries.flaggedWords}))`,
    })
    .from(readEntries)
    .where(
      and(
        eq(readEntries.userId, userId),
        eq(readEntries.language, language),
      ),
    )
    .orderBy(desc(readEntries.pastedAt), desc(readEntries.id))
    .limit(READ_HISTORY_LIMIT);

  return c.json({
    entries: rows.map((row) => ({
      id: row.id,
      title: row.title,
      source: row.source,
      preview: row.preview,
      flaggedCount: Number(row.flaggedCount),
      savedCount: Number(row.savedCount),
      pastedAt: (row.pastedAt as Date).toISOString(),
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /read/entries/:id — fetch a single entry the user owns (Req 10.2)
// ---------------------------------------------------------------------------
// Cross-user / unknown / malformed-UUID all collapse to 404 ENTRY_NOT_FOUND
// per the anti-leak pattern in `routes/sessions.ts:477,503`. `Cache-Control:
// no-store` ensures CDN/middlebox caches don't pin a 404 across users.
// ---------------------------------------------------------------------------
read.get('/read/entries/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');

  const idResult = z.string().uuid().safeParse(id);
  if (!idResult.success) {
    c.header('Cache-Control', 'no-store');
    return c.json(
      { error: 'Entry not found', code: 'ENTRY_NOT_FOUND' },
      404,
    );
  }

  const rows = await db
    .select({
      id: readEntries.id,
      language: readEntries.language,
      title: readEntries.title,
      source: readEntries.source,
      text: readEntries.text,
      flaggedWords: readEntries.flaggedWords,
      bank: readEntries.bank,
      pastedAt: readEntries.pastedAt,
    })
    .from(readEntries)
    .where(
      and(
        eq(readEntries.id, id),
        eq(readEntries.userId, userId),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    c.header('Cache-Control', 'no-store');
    return c.json(
      { error: 'Entry not found', code: 'ENTRY_NOT_FOUND' },
      404,
    );
  }

  const row = rows[0];

  // Everything the user saved from THIS passage — flagged-banked words AND
  // on-demand deep-card saves alike create a `user_vocabulary` row stamped with
  // `sourceReadEntryId`, so this one query is the complete "saved from this
  // passage" set the word-bank panel renders (not the `bank` column, which only
  // holds flagged words). Ordered oldest-first to match save order.
  const savedRows = await db
    .select({
      id: userVocabulary.id,
      word: userVocabulary.word,
      lemma: userVocabulary.lemma,
      gloss: userVocabulary.gloss,
      pos: userVocabulary.pos,
      cefrBand: userVocabulary.cefrBand,
      card: userVocabulary.card,
    })
    .from(userVocabulary)
    .where(
      and(
        eq(userVocabulary.userId, userId),
        eq(userVocabulary.sourceReadEntryId, id),
      ),
    )
    .orderBy(asc(userVocabulary.addedAt));

  const savedVocab = savedRows.map((v) => ({
    id: v.id,
    word: v.word,
    lemma: v.lemma,
    gloss: v.gloss,
    // The card snapshot is authoritative for word|phrase; `pos: 'phrase'` is the
    // fallback for older rows saved without one.
    type: v.card?.type === 'phrase' || v.pos === 'phrase' ? 'phrase' : 'word',
    cefr: v.cefrBand,
  }));

  return c.json({
    id: row.id,
    language: row.language,
    title: row.title,
    source: row.source,
    text: row.text,
    flaggedWords: row.flaggedWords,
    bank: row.bank,
    savedVocab,
    pastedAt: (row.pastedAt as Date).toISOString(),
  });
});

// ---------------------------------------------------------------------------
// PUT /read/entries/:id/bank — replace the bank for a saved entry (Req 9)
// ---------------------------------------------------------------------------
// Replace semantics, not delta. Removed words DO NOT delete vocab rows
// (Requirement 9.3) — once a word lands in the personal bank it stays,
// even if removed from this passage. The bank update + vocab upserts run
// in one transaction so the column and the vocab table can never drift.
// ---------------------------------------------------------------------------
read.put('/read/entries/:id/bank', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');

  const idResult = z.string().uuid().safeParse(id);
  if (!idResult.success) {
    c.header('Cache-Control', 'no-store');
    return c.json(
      { error: 'Entry not found', code: 'ENTRY_NOT_FOUND' },
      404,
    );
  }

  const bodyResult = UpdateBankBodySchema.safeParse(
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
  const { bank: newBank } = bodyResult.data;

  // Single SELECT for ownership + the data we need to validate the new bank.
  const rows = await db
    .select({
      flaggedWords: readEntries.flaggedWords,
      bank: readEntries.bank,
      language: readEntries.language,
    })
    .from(readEntries)
    .where(
      and(
        eq(readEntries.id, id),
        eq(readEntries.userId, userId),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    c.header('Cache-Control', 'no-store');
    return c.json(
      { error: 'Entry not found', code: 'ENTRY_NOT_FOUND' },
      404,
    );
  }

  const { flaggedWords, bank: oldBank, language } = rows[0];

  // Cross-field invariant: every new bank entry must be a known flagged word.
  for (const word of newBank) {
    if (!Object.prototype.hasOwnProperty.call(flaggedWords, word)) {
      return c.json(
        {
          error: 'Bank contains a word missing from flagged',
          code: 'UNKNOWN_FLAGGED_WORD',
          details: { word },
        },
        400,
      );
    }
  }

  // addedWords = newBank \ oldBank (set difference). Only these need an upsert.
  const oldBankSet = new Set(oldBank);
  const addedWords = newBank.filter((w) => !oldBankSet.has(w));

  await db.transaction(async (tx) => {
    await tx
      .update(readEntries)
      .set({ bank: newBank })
      .where(
        and(
          eq(readEntries.id, id),
          eq(readEntries.userId, userId),
        ),
      );

    if (addedWords.length > 0) {
      const vocabRows = addedWords.map((word) => {
        const flag = flaggedWords[word];
        return {
          userId,
          language,
          word,
          lemma: flag.lemma,
          source: 'reading',
          sourceReadEntryId: id,
          pos: flag.pos,
          gloss: flag.gloss,
          // `example` is now optional on the skim WordFlag (the slim pass omits
        // it); fall back to empty for this NOT NULL column.
        exampleSentence: flag.example ?? '',
          frequencyRank: flag.freq,
          cefrBand: flag.cefr as CefrLevel,
        };
      });

      await tx
        .insert(userVocabulary)
        .values(vocabRows)
        .onConflictDoUpdate({
          target: [userVocabulary.userId, userVocabulary.language, userVocabulary.word],
          set: {
            lemma: sql`excluded.lemma`,
            source: sql`excluded.source`,
            sourceReadEntryId: sql`excluded.source_read_entry_id`,
            pos: sql`excluded.pos`,
            gloss: sql`excluded.gloss`,
            exampleSentence: sql`excluded.example_sentence`,
            frequencyRank: sql`excluded.frequency_rank`,
            cefrBand: sql`excluded.cefr_band`,
            addedAt: sql`now()`,
          },
        });
    }
  });

  return c.json({ id, bank: newBank });
});

// ---------------------------------------------------------------------------
// POST /read/annotate-span — on-demand deep annotation of a span (Req 3,4,5,10,11)
// ---------------------------------------------------------------------------
// Server-authoritative flow for a tapped word / selected phrase / selected
// sentence. The span type is recomputed here from the offsets (never trusted
// from the client) because it drives the cache key, the save-rejection rule,
// and the card layout.
//
//   1. Zod-validate the body + the offset cross-field invariants (Req 10.4).
//   2. Derive `spanType` from the offsets via `resolveSpanType`.
//   3. Cache hit (SAVED entries only): if `entryId` is owned AND its
//      `span_annotations` already holds the "start:end" key, return that card
//      with NO model call and NO metering (Req 3.5, 10.1). Unsaved passages
//      carry no `entryId`, so within-session repeats rely on client state
//      (Req 11.2) — there is no server cache for them.
//   4. Rate-limit on a SEPARATE `read_span_annotation` bucket (Req 10.2).
//   5. Call `annotateSpan` (Sonnet) inside `withLlmTrace` (Req 3,4,5).
//   6. Write-back (SAVED entries only): incrementally merge the card into
//      `span_annotations` keyed by "start:end" — scoped to id+user so an
//      unowned entry is a no-op. Best-effort: a write failure is logged and
//      swallowed, never failing an already-successful request (Req 11.1, 11.6).
//   7. Insert exactly one `read_span_annotation` usage row — only after a real
//      successful call (skipped on cache hit / failure). Also best-effort.
//   8. Return the `DeepCard`.
// ---------------------------------------------------------------------------
read.post('/read/annotate-span', async (c) => {
  const bodyResult = AnnotateSpanBodySchema.safeParse(
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
  const { language, text, start, end, entryId } = bodyResult.data;

  // Cross-field invariants Zod can't express: a non-empty, in-range span.
  if (start >= end || end > text.length) {
    return c.json(
      {
        error: 'Span offsets out of range',
        code: 'VALIDATION_ERROR',
        details: { start, end, textLength: text.length },
      },
      400,
    );
  }

  const userId = c.get('userId');

  // Server-authoritative span type — drives the cache key and the card shape.
  const spanType = resolveSpanType(text, start, end);
  const key = `${start}:${end}`;

  // 3. Durable cache (saved entries only). Ownership is enforced by the
  // `user_id` predicate, so a cross-user / unknown `entryId` simply misses.
  if (entryId) {
    const rows = await db
      .select({ spanAnnotations: readEntries.spanAnnotations })
      .from(readEntries)
      .where(and(eq(readEntries.id, entryId), eq(readEntries.userId, userId)))
      .limit(1);

    const cached = rows[0]?.spanAnnotations?.[key];
    if (cached) {
      return c.json(cached);
    }
  }

  // 4. Rate-limit against the dedicated `read_span_annotation` budget — a
  // SEPARATE bucket from `ai_evaluation`/`read_annotation` (Req 10.2).
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [{ count: todayCount }] = await db
    .select({ count: count() })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        eq(usageEvents.eventType, 'read_span_annotation'),
        gte(usageEvents.createdAt, oneDayAgo),
      ),
    );

  if (Number(todayCount) >= READ_SPAN_DAILY_LIMIT) {
    return c.json(
      { error: 'Daily span-annotation limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
      429,
    );
  }

  // Resolve the learner's CEFR level for this language (default B1), exactly
  // as `annotate-stream/pipeline.ts` does.
  const profileRows = await db
    .select({ proficiencyLevel: userLanguageProfiles.proficiencyLevel })
    .from(userLanguageProfiles)
    .where(
      and(
        eq(userLanguageProfiles.userId, userId),
        eq(userLanguageProfiles.language, language as LearningLanguage),
      ),
    )
    .limit(1);
  const proficiencyLevel = isCefrLevel(profileRows[0]?.proficiencyLevel)
    ? profileRows[0].proficiencyLevel
    : DEFAULT_PROFICIENCY_LEVEL;

  const requestId =
    (c.env?.event as { requestContext?: { requestId?: string } } | undefined)
      ?.requestContext?.requestId ?? 'local';

  // 5. Deep call inside the trace scope. The Proxy maps the `submit_deep_card`
  // tool to the `annotate-span` feature, so the ALS `feature` here is only the
  // fallback if the tool name is ever absent. `language` is the ES/DE/TR enum,
  // assignable both to the trace's `Language` and `annotateSpan`'s
  // `LearningLanguage` without a cast.
  let card;
  try {
    const client = createObservedClaudeClient(ANTHROPIC_API_KEY);
    card = await withLlmTrace(
      {
        feature: 'annotate-span',
        env: (process.env.LANGFUSE_ENV ?? 'dev') as 'prod' | 'dev',
        promptVersion: READ_SPAN_PROMPT_VERSION,
        requestId,
        userId,
        language,
        cefrLevel: proficiencyLevel,
        exerciseType: 'reading',
      },
      () =>
        annotateSpan(client, {
          language,
          text,
          start,
          end,
          spanType,
          proficiencyLevel,
        }),
    );
  } catch (err) {
    // Deep call failed/timed out — no usage row, no write-back (Req error row).
    console.error('[POST /read/annotate-span] deep annotation failed:', err);
    return c.json(
      { error: 'Annotation temporarily unavailable', code: 'AI_UNAVAILABLE' },
      502,
    );
  }

  // 6. Write-back onto the saved entry (Req 11.1, 11.6) — incremental merge,
  // scoped to id+user so an unowned `entryId` is a no-op. Best-effort: a
  // failure here is logged and swallowed because the card already resolved.
  if (entryId) {
    try {
      await db
        .update(readEntries)
        .set({
          spanAnnotations: sql`COALESCE(${readEntries.spanAnnotations}, '{}'::jsonb) || jsonb_build_object(${key}, ${JSON.stringify(card)}::jsonb)`,
        })
        .where(and(eq(readEntries.id, entryId), eq(readEntries.userId, userId)));
    } catch (err) {
      console.error('[POST /read/annotate-span] span_annotations write-back failed:', err);
    }
  }

  // 7. Meter exactly one real call. Best-effort: a metering write failure is a
  // backend observability problem, not a UX-visible one.
  try {
    await db.insert(usageEvents).values({
      userId,
      eventType: 'read_span_annotation',
      metadata: { language, spanType, entryId: entryId ?? null },
    });
  } catch (err) {
    console.error('[POST /read/annotate-span] usage insert failed:', err);
  }

  // 8. Return the resolved card.
  return c.json(card);
});

// ---------------------------------------------------------------------------
// POST /read/vocabulary — save a deep card to the personal bank (Req 8)
// ---------------------------------------------------------------------------
// The deep-card → save seam. The client posts the whole resolved `DeepCard`
// (which lives only transiently client-side) and the server derives the
// lexical core columns from it while snapshotting the full card into the
// `card` jsonb captured-at-save-time (Req 8.1, 8.2). Word and phrase cards
// derive their columns differently (phrases have no lemma/pos/cefr/freq); a
// sentence card is rejected (Req 8.6). Upsert is keyed on the existing
// `(user, language, word)` surface-form constraint (Req 8.3) — re-saving the
// same surface form refreshes both the lexical columns and the snapshot.
// ---------------------------------------------------------------------------
read.post('/read/vocabulary', async (c) => {
  const bodyResult = SaveVocabularyBodySchema.safeParse(
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
  const { language, card, sourceReadEntryId } = bodyResult.data;

  // Server-side counterpart of Req 5.4: only word and phrase cards are
  // persistable. Sentence cards are explainers, not bank entries (Req 8.6).
  if (card.type === 'sentence') {
    return c.json(
      {
        error: 'Sentence cards cannot be saved to the vocabulary bank',
        code: 'VALIDATION_ERROR',
      },
      400,
    );
  }

  const userId = c.get('userId');

  // Derive the lexical core from the card. TypeScript narrows `card` by its
  // `type` literal, so the word-only fields are reachable only in the word
  // branch and the phrase-only fields only in the phrase branch. The full
  // card is snapshotted into `card` jsonb regardless (Req 8.2).
  const vocabRow =
    card.type === 'word'
      ? {
          userId,
          language: language as LearningLanguage,
          word: card.surface,
          lemma: card.lemma,
          source: 'reading',
          sourceReadEntryId: sourceReadEntryId ?? null,
          pos: card.pos,
          gloss: card.contextualSense,
          // NOT NULL column — fall back to '' when the card carries no extra
          // example, mirroring the `flag.example ?? ''` pattern above.
          exampleSentence: card.extraExample?.tl ?? '',
          frequencyRank: card.freq,
          cefrBand: card.cefr as CefrLevel,
          card: card as DeepCard,
        }
      : {
          userId,
          language: language as LearningLanguage,
          word: card.surface,
          // Phrases have no lemma; the citation form is the closest analogue,
          // falling back to the surface form.
          lemma: card.citation ?? card.surface,
          source: 'reading',
          sourceReadEntryId: sourceReadEntryId ?? null,
          // Phrases have no POS — a sensible literal keeps this NOT NULL column
          // populated and distinguishes phrase rows downstream.
          pos: 'phrase',
          gloss: card.idiomaticMeaning,
          exampleSentence: card.example?.tl ?? '',
          frequencyRank: null,
          cefrBand: null,
          card: card as DeepCard,
        };

  const [saved] = await db
    .insert(userVocabulary)
    .values(vocabRow)
    .onConflictDoUpdate({
      target: [userVocabulary.userId, userVocabulary.language, userVocabulary.word],
      set: {
        lemma: sql`excluded.lemma`,
        source: sql`excluded.source`,
        sourceReadEntryId: sql`excluded.source_read_entry_id`,
        pos: sql`excluded.pos`,
        gloss: sql`excluded.gloss`,
        exampleSentence: sql`excluded.example_sentence`,
        frequencyRank: sql`excluded.frequency_rank`,
        cefrBand: sql`excluded.cefr_band`,
        card: sql`excluded.card`,
        addedAt: sql`now()`,
      },
    })
    .returning({ id: userVocabulary.id });

  return c.json({ id: saved.id });
});

// ---------------------------------------------------------------------------
// DELETE /read/vocabulary/:id — undo a just-saved card (Req 8.5)
// ---------------------------------------------------------------------------
// Removes the owned vocabulary record so the save toggle can undo. The delete
// is scoped to `(id, userId)`; a cross-user / unknown / malformed-UUID id all
// collapse to 404 VOCAB_NOT_FOUND with `Cache-Control: no-store`, mirroring
// the anti-leak pattern on GET /read/entries/:id.
// ---------------------------------------------------------------------------
read.delete('/read/vocabulary/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');

  const idResult = z.string().uuid().safeParse(id);
  if (!idResult.success) {
    c.header('Cache-Control', 'no-store');
    return c.json(
      { error: 'Vocabulary record not found', code: 'VOCAB_NOT_FOUND' },
      404,
    );
  }

  // Delete the row and, if it was the LAST surface backing its review card,
  // drop the orphaned FSRS state too — so "unsave" removes the word from the
  // vocabulary review queue, not just the reading panel. (review state is keyed
  // by lemma and pools `user_vocabulary` rows; an orphan would otherwise linger
  // as a context-less card. `vocabulary_review_log.review_state_id` cascades.)
  const result = await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(userVocabulary)
      .where(
        and(
          eq(userVocabulary.id, id),
          eq(userVocabulary.userId, userId),
        ),
      )
      .returning({
        id: userVocabulary.id,
        language: userVocabulary.language,
        lemma: userVocabulary.lemma,
      });

    if (deleted.length === 0) return null;
    const { language, lemma } = deleted[0];

    const [{ remaining }] = await tx
      .select({ remaining: count() })
      .from(userVocabulary)
      .where(
        and(
          eq(userVocabulary.userId, userId),
          eq(userVocabulary.language, language),
          eq(userVocabulary.lemma, lemma),
        ),
      );

    if (remaining === 0) {
      await tx
        .delete(vocabularyReviewState)
        .where(
          and(
            eq(vocabularyReviewState.userId, userId),
            eq(vocabularyReviewState.language, language),
            eq(vocabularyReviewState.lemma, lemma),
          ),
        );
    }

    return deleted[0];
  });

  if (result === null) {
    c.header('Cache-Control', 'no-store');
    return c.json(
      { error: 'Vocabulary record not found', code: 'VOCAB_NOT_FOUND' },
      404,
    );
  }

  return c.json({ id: result.id });
});

export default read;
