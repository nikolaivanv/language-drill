import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { Language, CefrLevel } from '@language-drill/shared';
import { userLanguageProfiles } from '@language-drill/db';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const LanguageProfileSchema = z.object({
  language: z.nativeEnum(Language),
  proficiencyLevel: z.nativeEnum(CefrLevel),
});

const UpdateProfilesSchema = z.object({
  profiles: z.array(LanguageProfileSchema).min(1).max(4),
}).refine(
  (data) => new Set(data.profiles.map(p => p.language)).size === data.profiles.length,
  { message: 'Duplicate languages are not allowed' },
);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const profiles = new Hono<{ Bindings: Bindings; Variables: Variables }>();

profiles.use('*', authMiddleware);

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

  const { profiles: profileData } = bodyResult.data;

  await db.delete(userLanguageProfiles)
    .where(eq(userLanguageProfiles.userId, userId));

  await db.insert(userLanguageProfiles)
    .values(profileData.map(p => ({
      userId,
      language: p.language,
      proficiencyLevel: p.proficiencyLevel,
      assessedAt: new Date(),
    })));

  return c.json({ profiles: profileData });
});

export default profiles;
