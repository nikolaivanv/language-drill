import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  CefrLevel,
  GOAL_IDS,
  Language,
  NOTES_MAX_LENGTH,
  type DailyMinutes,
} from '@language-drill/shared';
import { userLanguageProfiles, userPreferences } from '@language-drill/db';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
// EN is a source-only language for translation exercises, not a learning
// target — the Lambda owns its own copy of the ES/DE/TR-only enum so it
// doesn't depend on the api-client package. The matching schema in
// `packages/api-client/src/schemas/preferences.ts` is the client-side mirror;
// drift between the two is caught by parallel test suites.
// ---------------------------------------------------------------------------

const LearningLanguageEnum = z.enum([
  Language.ES,
  Language.DE,
  Language.TR,
]);

const LearningProfileSchema = z.object({
  language: LearningLanguageEnum,
  proficiencyLevel: z.nativeEnum(CefrLevel),
});

// Default seeded into a brand-new user_preferences row when the languages
// endpoint creates it before the preferences PATCH runs (daily_minutes is
// NOT NULL with no DB default). Overwritten by PATCH /profiles/preferences.
const DEFAULT_DAILY_MINUTES: DailyMinutes = 10;

const UpdateLanguagesSchema = z
  .object({
    profiles: z.array(LearningProfileSchema).min(1).max(3),
    primaryLanguage: LearningLanguageEnum,
  })
  .refine(
    (data) =>
      new Set(data.profiles.map((p) => p.language)).size ===
      data.profiles.length,
    { message: 'Duplicate languages are not allowed' },
  )
  .refine(
    (data) => data.profiles.some((p) => p.language === data.primaryLanguage),
    {
      message:
        'primaryLanguage must be one of the submitted profiles.languages',
      path: ['primaryLanguage'],
    },
  );

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const profiles = new Hono<{ Bindings: Bindings; Variables: Variables }>();

profiles.use('/profiles/*', authMiddleware);

// ---------------------------------------------------------------------------
// GET /profiles/languages — return the current user's language profiles
// ---------------------------------------------------------------------------
profiles.get('/profiles/languages', async (c) => {
  const userId = c.get('userId');

  const rows = await db
    .select({
      language: userLanguageProfiles.language,
      proficiencyLevel: userLanguageProfiles.proficiencyLevel,
    })
    .from(userLanguageProfiles)
    .where(eq(userLanguageProfiles.userId, userId))
    .orderBy(userLanguageProfiles.language);

  return c.json({ profiles: rows });
});

// ---------------------------------------------------------------------------
// GET /profiles/preferences — return the current user's onboarding preferences
// ---------------------------------------------------------------------------
profiles.get('/profiles/preferences', async (c) => {
  const userId = c.get('userId');

  const [row] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  if (!row) {
    return c.json({
      primaryLanguage: null,
      goals: [],
      dailyMinutes: null,
      gentleNudges: true,
      notes: '',
    });
  }

  return c.json({
    primaryLanguage: row.primaryLanguage,
    goals: row.goals,
    dailyMinutes: row.dailyMinutes,
    gentleNudges: row.gentleNudges,
    notes: row.notes,
  });
});

// ---------------------------------------------------------------------------
// PUT /profiles/languages — atomic replace of all language profiles
// ---------------------------------------------------------------------------
profiles.put('/profiles/languages', async (c) => {
  const userId = c.get('userId');

  const bodyResult = UpdateLanguagesSchema.safeParse(
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

  const { profiles: profileData, primaryLanguage } = bodyResult.data;

  const result = await db.transaction(async (tx) => {
    await tx
      .delete(userLanguageProfiles)
      .where(eq(userLanguageProfiles.userId, userId));

    const insertedProfiles = await tx
      .insert(userLanguageProfiles)
      .values(
        profileData.map((p) => ({
          userId,
          language: p.language,
          proficiencyLevel: p.proficiencyLevel,
          assessedAt: new Date(),
        })),
      )
      .returning({
        language: userLanguageProfiles.language,
        proficiencyLevel: userLanguageProfiles.proficiencyLevel,
      });

    // Upsert the primary-language pointer. On INSERT we must seed
    // dailyMinutes (NOT NULL, no default); on UPDATE we touch only
    // primaryLanguage so goals/dailyMinutes/gentleNudges/notes set via
    // PATCH /profiles/preferences are preserved.
    await tx
      .insert(userPreferences)
      .values({
        userId,
        primaryLanguage,
        dailyMinutes: DEFAULT_DAILY_MINUTES,
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { primaryLanguage, updatedAt: new Date() },
      });

    return { profiles: insertedProfiles, primaryLanguage };
  });

  return c.json(result);
});

// ---------------------------------------------------------------------------
// PATCH /profiles/preferences — partial update of onboarding-signal fields
// ---------------------------------------------------------------------------

const UpdatePreferencesSchema = z
  .object({
    goals: z.array(z.enum(GOAL_IDS)).optional(),
    dailyMinutes: z
      .union([z.literal(5), z.literal(10), z.literal(20), z.literal(30)])
      .optional(),
    gentleNudges: z.boolean().optional(),
    notes: z.string().max(NOTES_MAX_LENGTH).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

profiles.patch('/profiles/preferences', async (c) => {
  const userId = c.get('userId');

  const bodyResult = UpdatePreferencesSchema.safeParse(
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

  const updated = await db
    .update(userPreferences)
    .set({ ...bodyResult.data, updatedAt: new Date() })
    .where(eq(userPreferences.userId, userId))
    .returning({
      primaryLanguage: userPreferences.primaryLanguage,
      goals: userPreferences.goals,
      dailyMinutes: userPreferences.dailyMinutes,
      gentleNudges: userPreferences.gentleNudges,
      notes: userPreferences.notes,
    });

  if (updated.length === 0) {
    return c.json(
      { error: 'No preferences row for user', code: 'PREFERENCES_NOT_FOUND' },
      404,
    );
  }

  return c.json(updated[0]);
});

export default profiles;
