import { type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { userExerciseHistory } from './progress';

// Human judgments on real learner submissions — the ground truth `pnpm eval`
// lacks. See docs/superpowers/specs/2026-09-29-evaluator-labeling-design.md.
//
// `grade_ok` and `feedback_ok` are separate because they fail independently:
// a wrong grade corrupts user_grammar_mastery, a wrong explanation misleads the
// learner while leaving progress data intact. Null on either means "unsure".
export const submissionLabels = pgTable(
  'submission_labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The attempt being judged. Cascade so right-to-erasure sweeps labels with
    // the history rows (same convention as exercise_flags.history_id).
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => userExerciseHistory.id, { onDelete: 'cascade' }),
    gradeOk: boolean('grade_ok'),
    feedbackOk: boolean('feedback_ok'),
    // Closed vocabulary — LABEL_TAGS in @language-drill/shared.
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    critique: text('critique'),
    // 'random' | 'targeted' — LABEL_STRATA in @language-drill/shared. Recorded
    // so a targeted defect hunt is never blended into a quoted quality rate.
    stratum: text('stratum').notNull(),
    // EVALUATION_SYSTEM_PROMPT_VERSION at label time; stamped server-side.
    promptVersion: text('prompt_version'),
    // Clerk user id of the admin. Deliberately NOT a foreign key to users:
    // ground truth must survive the labeler's account being deleted.
    labeledBy: text('labeled_by').notNull(),
    labeledAt: timestamp('labeled_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One label per attempt per labeler — re-labelling upserts, and a second
    // annotator later needs no migration.
    submissionLabelerUnique: uniqueIndex('submission_labels_submission_labeler_unique').on(
      table.submissionId,
      table.labeledBy,
    ),
    // Stats endpoint: per-stratum rollups, newest first.
    stratumLabeledAtIdx: index('submission_labels_stratum_labeled_at_idx').on(
      table.stratum,
      table.labeledAt,
    ),
  }),
);

export type SubmissionLabel = InferSelectModel<typeof submissionLabels>;
export type NewSubmissionLabel = InferInsertModel<typeof submissionLabels>;
