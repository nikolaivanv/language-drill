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
//   exercises(language, difficulty, type, grammarPointKey)
//     WHERE review_status IN ('auto-approved', 'manual-approved') — pool lookup
//   generation_jobs(cellKey, startedAt DESC)        — daily refill scheduler
//   read_entries(userId, language, pastedAt DESC)   — entry-list / most-recent lookup
//   user_vocabulary(userId, language)               — drill-time vocab fetch by language
//   user_vocabulary(userId, language, word) UNIQUE  — bank dedup across passages
//   vocabulary_review_state(userId, language, lemma) UNIQUE — one card per lemma
//   vocabulary_review_state(userId, language, dueAt) — queue build (due cards)
//   vocabulary_review_state(userId, language, state) — bank filters / leech surfacing
//   vocabulary_review_sessions(userId, startedAt)    — recent-sessions queries
//   vocabulary_review_log(userId, language, reviewedAt) — radar UNION + grammar deltas
//   vocabulary_review_log(reviewStateId, reviewedAt) — word-detail review history

export { users, userLanguageProfiles, userPreferences } from './users';
export type { UserPreferences, NewUserPreferences } from './users';
export { skills, skillTopics } from './skills';
export { exercises, exerciseTags } from './exercises';
export type { Exercise } from './exercises';
export { userExerciseHistory, spacedRepetitionCards } from './progress';
export { practiceSessions } from './sessions';
export {
  readEntries,
  userVocabulary,
  vocabularyReviewState,
  vocabularyReviewSessions,
  vocabularyReviewLog,
  generatedReadingTexts,
} from './read';
export { playlists, playlistItems } from './playlists';
export { invitations, usageEvents } from './access';
export { generationJobs } from './generation';
export type { GenerationJob, NewGenerationJob } from './generation';
export { theoryTopics, theoryGenerationJobs } from './theory';
export type {
  TheoryTopic,
  NewTheoryTopic,
  TheoryGenerationJob,
  NewTheoryGenerationJob,
} from './theory';
