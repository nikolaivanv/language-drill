import { Hono } from 'hono';
import { z } from 'zod';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  CefrLevel,
  FlaggedMapSchema,
  Language,
  READ_CEFR_TOP_RANK,
  READ_HISTORY_LIMIT,
  READ_PREVIEW_CHARS,
  READ_SOURCE_MAX_CHARS,
  READ_TEXT_MAX_CHARS,
  READ_TITLE_MAX_CHARS,
} from '@language-drill/shared';
import type { LearningLanguage } from '@language-drill/shared';
import { readEntries, usageEvents, userLanguageProfiles, userVocabulary } from '@language-drill/db';
import { annotateText, createClaudeClient } from '@language-drill/ai';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const DAILY_EVAL_LIMIT = 50;

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
// EN is a source-only language for translation exercises, not a learning
// target — the Lambda owns its own copy of the ES/DE/TR-only enum so it
// doesn't depend on the api-client package. Mirrors the comment block in
// `routes/sessions.ts:27–30`.
// ---------------------------------------------------------------------------

const LearningLanguageEnum = z.enum([Language.ES, Language.DE, Language.TR]);

// `language` is parsed as the full `Language` enum (incl. EN) so the handler
// can distinguish "shape error" from "EN is source-only" — the latter has its
// own 400 UNSUPPORTED_LANGUAGE response per Requirement 5.4. Other endpoints
// in this router use the narrower LearningLanguageEnum (rejects EN as a
// generic VALIDATION_ERROR) since their requirements don't carve out EN.
const AnnotateBodySchema = z.object({
  text: z.string().trim().min(1).max(READ_TEXT_MAX_CHARS),
  language: z.nativeEnum(Language),
});

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

const DEFAULT_PROFICIENCY_LEVEL = CefrLevel.B1;
const CEFR_LEVELS = new Set<string>(Object.values(CefrLevel));
function isCefrLevel(value: string | null | undefined): value is CefrLevel {
  return typeof value === 'string' && CEFR_LEVELS.has(value);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const read = new Hono<{ Bindings: Bindings; Variables: Variables }>();

read.use('/read/*', authMiddleware);

// ---------------------------------------------------------------------------
// POST /read/annotate — flag above-level words via Claude (Requirement 5)
// ---------------------------------------------------------------------------
// Rate-limited against the same DAILY_EVAL_LIMIT bucket as ai_evaluation —
// counted across both event types within a rolling 24h window. Failures from
// Claude are mapped to 502 AI_UNAVAILABLE and DO NOT increment the counter.
// ---------------------------------------------------------------------------
read.post('/read/annotate', async (c) => {
  const bodyResult = AnnotateBodySchema.safeParse(
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
  const { text, language } = bodyResult.data;

  if (language === Language.EN) {
    return c.json(
      { error: 'English is not a supported learning language', code: 'UNSUPPORTED_LANGUAGE' },
      400,
    );
  }

  const userId = c.get('userId');

  // Rate-limit window is rolling 24h; mirrors `routes/exercises.ts` so the
  // two AI surfaces share the same daily cap.
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [usageRows, profileRows] = await Promise.all([
    db
      .select({ count: count() })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.userId, userId),
          inArray(usageEvents.eventType, ['ai_evaluation', 'read_annotation']),
          gte(usageEvents.createdAt, oneDayAgo),
        ),
      ),
    db
      .select({ proficiencyLevel: userLanguageProfiles.proficiencyLevel })
      .from(userLanguageProfiles)
      .where(
        and(
          eq(userLanguageProfiles.userId, userId),
          eq(userLanguageProfiles.language, language),
        ),
      )
      .limit(1),
  ]);

  if (Number(usageRows[0]?.count ?? 0) >= DAILY_EVAL_LIMIT) {
    return c.json(
      { error: 'Daily evaluation limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
      429,
    );
  }

  const proficiencyLevel = isCefrLevel(profileRows[0]?.proficiencyLevel)
    ? profileRows[0].proficiencyLevel
    : DEFAULT_PROFICIENCY_LEVEL;
  const topRank = READ_CEFR_TOP_RANK[proficiencyLevel];

  let flagged;
  try {
    const client = createClaudeClient(ANTHROPIC_API_KEY);
    const result = await annotateText(client, {
      text,
      language: language as LearningLanguage,
      proficiencyLevel,
      topRank,
    });
    flagged = result.flagged;
  } catch (err) {
    // Claude failure — DO NOT write a usage row; user can retry.
    console.error('[POST /read/annotate] Claude annotation failed:', err, {
      language,
      proficiencyLevel,
      textLength: text.length,
    });
    return c.json(
      { error: 'Evaluation temporarily unavailable', code: 'AI_UNAVAILABLE' },
      502,
    );
  }

  await db.insert(usageEvents).values({
    userId,
    eventType: 'read_annotation',
    metadata: {
      language,
      textLength: text.length,
      flaggedCount: Object.keys(flagged).length,
    },
  });

  return c.json({
    flagged,
    calibration: { cefr: proficiencyLevel, top: topRank },
  });
});

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
        exampleSentence: flag.example,
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
  return c.json({
    id: row.id,
    language: row.language,
    title: row.title,
    source: row.source,
    text: row.text,
    flaggedWords: row.flaggedWords,
    bank: row.bank,
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
          exampleSentence: flag.example,
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

export default read;
