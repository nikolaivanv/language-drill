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
export const USER_EXPORT_TABLES = [
  { key: 'userLanguageProfiles', table: userLanguageProfiles, userIdColumn: userLanguageProfiles.userId },
  { key: 'userPreferences', table: userPreferences, userIdColumn: userPreferences.userId },
  { key: 'userExerciseHistory', table: userExerciseHistory, userIdColumn: userExerciseHistory.userId },
  { key: 'spacedRepetitionCards', table: spacedRepetitionCards, userIdColumn: spacedRepetitionCards.userId },
  { key: 'fluencyAttempts', table: fluencyAttempts, userIdColumn: fluencyAttempts.userId },
  { key: 'userGrammarMastery', table: userGrammarMastery, userIdColumn: userGrammarMastery.userId },
  { key: 'errorObservations', table: errorObservations, userIdColumn: errorObservations.userId },
  { key: 'practiceSessions', table: practiceSessions, userIdColumn: practiceSessions.userId },
  { key: 'readEntries', table: readEntries, userIdColumn: readEntries.userId },
  { key: 'userVocabulary', table: userVocabulary, userIdColumn: userVocabulary.userId },
  { key: 'vocabularyReviewState', table: vocabularyReviewState, userIdColumn: vocabularyReviewState.userId },
  { key: 'vocabularyReviewSessions', table: vocabularyReviewSessions, userIdColumn: vocabularyReviewSessions.userId },
  { key: 'vocabularyReviewLog', table: vocabularyReviewLog, userIdColumn: vocabularyReviewLog.userId },
  { key: 'playlists', table: playlists, userIdColumn: playlists.userId },
  { key: 'usageEvents', table: usageEvents, userIdColumn: usageEvents.userId },
  { key: 'exerciseFlags', table: exerciseFlags, userIdColumn: exerciseFlags.userId },
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
  for (const { key, table, userIdColumn } of USER_EXPORT_TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out[key] = await db.select().from(table as any).where(eq(userIdColumn as any, userId));
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
