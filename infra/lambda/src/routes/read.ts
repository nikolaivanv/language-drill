import { createHash } from 'node:crypto';
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
  READING_GEN_TOPIC_MAX_CHARS,
  READING_TOO_HARD_THRESHOLD,
  ReadingCategory,
  ReadingTextLength,
} from '@language-drill/shared';
import type { DeepCard, LearningLanguage } from '@language-drill/shared';
import {
  generatedReadingTexts,
  readEntries,
  usageEvents,
  userVocabulary,
  vocabularyReviewState,
} from '@language-drill/db';
import { createClaudeClient, generateReadingText } from '@language-drill/ai';
import { db } from '../db';
import { limitFor } from '../usage/limits';
import { getEffectivePlan, isAdmin } from '../usage/plan';
import { checkGlobalCapacity } from '../usage/global-capacity';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';

// Mirrors the answer-eval submit route: read the key once at module scope and
// fall back to '' so a missing key surfaces as a 502 at call time rather than
// crashing at import.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';

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

// `bank` is now allowed to be empty so the user can save a generated entry to
// the library without having collected any words (Task 5 / "save to library"
// path). The UI still gates the "add to vocabulary" action on bank length.
const SaveEntryBodySchema = z.object({
  language: LearningLanguageEnum,
  title: z.string().max(READ_TITLE_MAX_CHARS),
  source: z.string().max(READ_SOURCE_MAX_CHARS),
  text: z.string().min(1).max(READ_TEXT_MAX_CHARS),
  flagged: FlaggedMapSchema,
  bank: z.array(z.string().min(1)), // empty allowed
  // Generation provenance (omit for pasted entries).
  kind: z.enum(['generated', 'pasted']).optional(),
  category: z.nativeEnum(ReadingCategory).nullable().optional(),
  cefr: z.nativeEnum(CefrLevel).nullable().optional(),
  length: z.nativeEnum(ReadingTextLength).nullable().optional(),
  prompt: z.string().nullable().optional(),
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

// POST /read/generate body. `topic` is a free-form prompt capped at the shared
// max; length/cefr are the closed enums the generator and cache key rely on.
// `noCache` bypasses the cache read and overwrites the stored row so the user
// can force a fresh variation (rewrite flow).
const GenerateBodySchema = z.object({
  language: LearningLanguageEnum,
  cefr: z.nativeEnum(CefrLevel),
  length: z.nativeEnum(ReadingTextLength),
  topic: z.string().min(1).max(READING_GEN_TOPIC_MAX_CHARS),
  noCache: z.boolean().optional(),
});

// Normalize topics so superficially-different prompts share a cache entry:
// trim, lowercase, and collapse internal whitespace runs to a single space.
function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Deterministic cache key over the generation inputs. The same (language, cefr,
// length, normalized topic) always hashes to the same hex digest, which is the
// UNIQUE column on `generated_reading_texts`.
function readingCacheKey(
  language: string,
  cefr: string,
  length: string,
  topic: string,
): string {
  const basis = `${language}|${cefr}|${length}|${normalizeTopic(topic)}`;
  return createHash('sha256').update(basis).digest('hex');
}

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
  const { language, title, source, text, flagged, bank, kind, category, cefr: entryCefr, length, prompt } = bodyResult.data;

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
        kind: kind ?? 'pasted',
        category: category ?? null,
        cefr: entryCefr ?? null,
        length: length ?? null,
        prompt: prompt ?? null,
      })
      .returning({ id: readEntries.id, pastedAt: readEntries.pastedAt });

    if (bank.length > 0) {
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
    }

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
      kind: readEntries.kind,
      category: readEntries.category,
      cefr: readEntries.cefr,
      length: readEntries.length,
      prompt: readEntries.prompt,
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
      kind: row.kind ?? 'pasted',
      category: row.category ?? null,
      cefr: row.cefr ?? null,
      length: row.length ?? null,
      prompt: row.prompt ?? null,
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
      kind: readEntries.kind,
      category: readEntries.category,
      cefr: readEntries.cefr,
      length: readEntries.length,
      prompt: readEntries.prompt,
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
    kind: row.kind ?? 'pasted',
    category: row.category ?? null,
    cefr: row.cefr ?? null,
    length: row.length ?? null,
    prompt: row.prompt ?? null,
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

// ---------------------------------------------------------------------------
// POST /read/generate — generate (or cache-serve) a reading passage
// ---------------------------------------------------------------------------
// A durable, cross-user cache fronts the Claude generator. A cache HIT serves
// the stored passage verbatim, bumps `hit_count`, and is NEVER metered. A MISS
// enforces the per-user `text_generation` daily cap, calls Claude, persists the
// result (onConflictDoNothing so a concurrent writer doesn't error), and meters
// one `text_generation` usage event. `runsHard` reflects whether the final text
// still sits above the too-hard threshold so the client can warn the learner.
// ---------------------------------------------------------------------------
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
  const { language, cefr, length, topic, noCache } = bodyResult.data;
  const userId = c.get('userId');

  const cacheKey = readingCacheKey(language, cefr, length, topic);

  // 1. Cache lookup. On HIT, bump hit_count and return without metering.
  // Skipped when `noCache` is true so the user can force a fresh variation.
  if (!noCache) {
    const cachedRows = await db
      .select({
        title: generatedReadingTexts.title,
        text: generatedReadingTexts.text,
        cefr: generatedReadingTexts.cefr,
        difficultyScore: generatedReadingTexts.difficultyScore,
      })
      .from(generatedReadingTexts)
      .where(eq(generatedReadingTexts.cacheKey, cacheKey))
      .limit(1);

    const cached = cachedRows[0];
    if (cached) {
      await db
        .update(generatedReadingTexts)
        .set({ hitCount: sql`${generatedReadingTexts.hitCount} + 1` })
        .where(eq(generatedReadingTexts.cacheKey, cacheKey));

      return c.json({
        title: cached.title,
        text: cached.text,
        cefr: cached.cefr,
        difficultyScore: cached.difficultyScore,
        fromCache: true,
        runsHard: cached.difficultyScore > READING_TOO_HARD_THRESHOLD,
      });
    }
  }

  // 2. MISS — resolve tier, run the global brake, then the per-user daily cap.
  // The global brake mirrors the answer-eval submit route: a cache HIT is free
  // and must never be blocked, so this check lives on the miss path only and is
  // evaluated before the per-user cap (CLAUDE.md: "checked before the per-user
  // cap"). Admins/boosted are encoded in the helper.
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

  // Check-then-insert daily cap — same accepted boundary-overshoot race as
  // documented at length in `routes/exercises.ts` (POST submit). The cap is a
  // cost guardrail, not a billing-grade meter; revisit with an atomic counter
  // if multi-user load makes the overshoot material.
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [{ count: todayCount }] = await db
    .select({ count: count() })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        eq(usageEvents.eventType, 'text_generation'),
        gte(usageEvents.createdAt, oneDayAgo),
      ),
    );

  if (Number(todayCount) >= limitFor('text_generation', plan)) {
    return c.json(
      {
        error: 'Daily text-generation limit exceeded',
        code: 'RATE_LIMIT_EXCEEDED',
      },
      429,
    );
  }

  // 3. Require the Anthropic key — mirrors the submit route's 502 posture.
  if (!ANTHROPIC_API_KEY) {
    return c.json(
      { error: 'Text generation temporarily unavailable', code: 'AI_UNAVAILABLE' },
      502,
    );
  }

  // 4. Generate.
  let generated;
  try {
    generated = await generateReadingText(createClaudeClient(ANTHROPIC_API_KEY), {
      language,
      cefr,
      length,
      topic,
    });
  } catch (err) {
    console.error('[POST /read/generate] Reading generation failed:', err);
    return c.json(
      { error: 'Text generation temporarily unavailable', code: 'AI_UNAVAILABLE' },
      502,
    );
  }

  // 5. Persist the passage and meter the event. `onConflictDoUpdate` so a
  // forced rewrite (noCache) overwrites the stored variation; a normal miss
  // also upserts (identical behaviour to the old onConflictDoNothing for new
  // rows, but now the title/text/difficultyScore are refreshed on a rewrite).
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
    .onConflictDoUpdate({
      target: generatedReadingTexts.cacheKey,
      set: {
        title: generated.title,
        text: generated.text,
        difficultyScore: generated.difficultyScore,
      },
    });

  await db.insert(usageEvents).values({
    userId,
    eventType: 'text_generation',
    metadata: { language, cefr, length },
  });

  return c.json({
    title: generated.title,
    text: generated.text,
    cefr,
    difficultyScore: generated.difficultyScore,
    fromCache: false,
    runsHard: generated.runsHard,
  });
});

export default read;
