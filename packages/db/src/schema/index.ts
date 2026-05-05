// Re-export all table definitions from schema modules.
// Indexes are co-located with their table definitions in each module
// (idiomatic Drizzle ORM pattern — indexes are part of the pgTable third-arg callback).
//
// Defined indexes:
//   user_exercise_history(userId, evaluatedAt DESC) — progress queries
//   user_exercise_history(sessionId)                — session completion correct-count
//   spaced_repetition_cards(userId, dueAt)          — SM-2 scheduling
//   practice_sessions(userId, startedAt)            — recent-sessions queries
//   invitations(code)                               — invite lookup at signup
//   invitations(usedBy)                             — API invite check middleware
//   read_entries(userId, language, pastedAt DESC)   — entry-list / most-recent lookup
//   user_vocabulary(userId, language)               — drill-time vocab fetch by language
//   user_vocabulary(userId, language, word) UNIQUE  — bank dedup across passages

export { users, userLanguageProfiles, userPreferences } from './users';
export type { UserPreferences, NewUserPreferences } from './users';
export { skills, skillTopics } from './skills';
export { exercises, exerciseTags } from './exercises';
export { userExerciseHistory, spacedRepetitionCards } from './progress';
export { practiceSessions } from './sessions';
export { readEntries, userVocabulary } from './read';
export { playlists, playlistItems } from './playlists';
export { invitations, usageEvents } from './access';
