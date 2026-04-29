import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  CefrLevel,
  GOAL_IDS,
  Language,
  NOTES_MAX_LENGTH,
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

const UpdateProfilesSchema = z
  .object({
    profiles: z.array(LearningProfileSchema).min(1).max(3),
    primaryLanguage: LearningLanguageEnum,
    goals: z.array(z.enum(GOAL_IDS)),
    dailyMinutes: z.union([
      z.literal(5),
      z.literal(10),
      z.literal(20),
      z.literal(30),
    ]),
    gentleNudges: z.boolean(),
    notes: z.string().max(NOTES_MAX_LENGTH),
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

  const bodyResult = UpdateProfilesSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!bodyResult.success) {
    return c.json(
      { error: 'Invalid request body', code: 'VALIDATION_ERROR', details: bodyResult.error.flatten() },
      400,
    );
  }

  const {
    profiles: profileData,
    primaryLanguage,
    goals,
    dailyMinutes,
    gentleNudges,
    notes,
  } = bodyResult.data;

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

    const [upsertedPreferences] = await tx
      .insert(userPreferences)
      .values({
        userId,
        primaryLanguage,
        goals,
        dailyMinutes,
        gentleNudges,
        notes,
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          primaryLanguage,
          goals,
          dailyMinutes,
          gentleNudges,
          notes,
          updatedAt: new Date(),
        },
      })
      .returning({
        primaryLanguage: userPreferences.primaryLanguage,
        goals: userPreferences.goals,
        dailyMinutes: userPreferences.dailyMinutes,
        gentleNudges: userPreferences.gentleNudges,
        notes: userPreferences.notes,
      });

    return { profiles: insertedProfiles, preferences: upsertedPreferences };
  });

  return c.json(result);
});

export default profiles;
