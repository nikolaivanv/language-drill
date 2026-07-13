// ---------------------------------------------------------------------------
// Cross-user base-gloss cache
// ---------------------------------------------------------------------------
// One row per (language, lemma). `base_gloss` is the lemma's dictionary meaning
// (top 1–2 senses) shared across all users and texts — the sentence-specific
// sense is never cached (deep cards compute `contextualSense` fresh). Written
// by the skim annotation pass (misses), resolved deep cards, and a one-off
// seed from user_vocabulary. `cefr` is nullable; a null-cefr row is not a
// valid skim hit (see infra/lambda/src/annotate-stream/gloss-cache.ts).
// ---------------------------------------------------------------------------

import { integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import type { CefrLevel, LearningLanguage } from '@language-drill/shared';

export const glossCache = pgTable(
  'gloss_cache',
  {
    language: text('language').$type<LearningLanguage>().notNull(),
    lemma: text('lemma').notNull(),
    baseGloss: text('base_gloss').notNull(),
    pos: text('pos').notNull(),
    cefr: text('cefr').$type<CefrLevel>(),
    freqRank: integer('freq_rank'),
    source: text('source').$type<'skim' | 'deep' | 'seed'>().notNull(),
    promptVersion: text('prompt_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.language, t.lemma] }),
  }),
);

export type GlossCacheRow = typeof glossCache.$inferSelect;
export type NewGlossCacheRow = typeof glossCache.$inferInsert;
