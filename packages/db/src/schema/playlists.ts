import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { exercises } from './exercises';
import { users } from './users';

export const playlists = pgTable('playlists', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id), // nullable — null = system playlist
  name: text('name'),
  language: text('language'), // EN | ES | DE | TR
  createdAt: timestamp('created_at').defaultNow(),
});

export const playlistItems = pgTable('playlist_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  playlistId: uuid('playlist_id').references(() => playlists.id),
  exerciseId: uuid('exercise_id').references(() => exercises.id),
  position: integer('position'),
});
