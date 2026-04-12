// Re-export all table definitions from schema modules.
// Indexes are co-located with their table definitions in each module
// (idiomatic Drizzle ORM pattern — indexes are part of the pgTable third-arg callback).
//
// Defined indexes:
//   user_exercise_history(userId, evaluatedAt DESC) — progress queries
//   spaced_repetition_cards(userId, dueAt)          — SM-2 scheduling
//   invitations(code)                               — invite lookup at signup
//   invitations(usedBy)                             — API invite check middleware

export { users, userLanguageProfiles } from './users';
export { skills, skillTopics } from './skills';
export { exercises, exerciseTags } from './exercises';
export { userExerciseHistory, spacedRepetitionCards } from './progress';
export { playlists, playlistItems } from './playlists';
export { invitations, usageEvents } from './access';
