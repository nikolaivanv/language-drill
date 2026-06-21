import { eq } from 'drizzle-orm';
import {
  users,
  userLanguageProfiles,
  userPreferences,
  userExerciseHistory,
  spacedRepetitionCards,
  fluencyAttempts,
  userGrammarMastery,
  errorObservations,
  practiceSessions,
  readEntries,
  userVocabulary,
  vocabularyReviewState,
  vocabularyReviewSessions,
  vocabularyReviewLog,
  playlists,
  playlistItems,
  usageEvents,
  exerciseFlags,
} from '@language-drill/db';
import type { db as DbType } from '../db';

// Every table keyed directly by user_id. Order is stable for predictable output.
// NOTE: userIdColumn is intentionally NOT read here at module scope — reading .userId
// off a mocked table object would crash any test that imports this module without
// providing every table in its @language-drill/db mock. The column is read at call
// time inside collectUserExport instead.
export const USER_EXPORT_TABLES = [
  { key: 'userLanguageProfiles', table: userLanguageProfiles },
  { key: 'userPreferences', table: userPreferences },
  { key: 'userExerciseHistory', table: userExerciseHistory },
  { key: 'spacedRepetitionCards', table: spacedRepetitionCards },
  { key: 'fluencyAttempts', table: fluencyAttempts },
  { key: 'userGrammarMastery', table: userGrammarMastery },
  { key: 'errorObservations', table: errorObservations },
  { key: 'practiceSessions', table: practiceSessions },
  { key: 'readEntries', table: readEntries },
  { key: 'userVocabulary', table: userVocabulary },
  { key: 'vocabularyReviewState', table: vocabularyReviewState },
  { key: 'vocabularyReviewSessions', table: vocabularyReviewSessions },
  { key: 'vocabularyReviewLog', table: vocabularyReviewLog },
  { key: 'playlists', table: playlists },
  { key: 'usageEvents', table: usageEvents },
  { key: 'exerciseFlags', table: exerciseFlags },
] as const;

export async function collectUserExport(
  db: typeof DbType,
  userId: string,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  // The account row (keyed by id, not user_id).
  const userRows = await db.select().from(users).where(eq(users.id, userId));
  out.user = userRows[0] ?? null;

  // Every directly user-keyed table.
  for (const { key, table } of USER_EXPORT_TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out[key] = await db.select().from(table as any).where(eq((table as any).userId, userId));
  }

  // Playlist items belong to the user's playlists (no direct user_id).
  out.playlistItems = await db
    .select()
    .from(playlistItems)
    .innerJoin(playlists, eq(playlistItems.playlistId, playlists.id))
    .where(eq(playlists.userId, userId));

  out.exportedAt = new Date().toISOString();
  return out;
}
