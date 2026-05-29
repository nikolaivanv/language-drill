-- 0015_tr_a1_realign_cleanup.sql
-- Remove rows orphaned by relocating 5 TR grammar points A2 -> A1 (key renames).
-- Forward-only, data-only, scoped to language='TR'. ES/DE untouched.
--
-- The orphaned exercises are referenced by 3 FK tables (exercise_tags,
-- user_exercise_history, playlist_items); all dependents are deleted before
-- the exercises. NOTE: this drops user_exercise_history rows for these
-- exercises (answer history for the removed A2-keyed pool); acceptable because
-- the exercises themselves are being removed so the scheduler repopulates the
-- new A1 cells.

-- 1. exercise_tags pointing at the orphaned skill_topics (seed + generated tags)
DELETE FROM exercise_tags
WHERE skill_topic_id IN (
  '17ade3fa-dfeb-599e-9428-2592026723ff',
  '3189b08c-5ea5-50d8-9771-ec24bf237a19',
  'cedcac61-873d-53cf-baf9-b043b9cb133a',
  'a4233fbd-a492-54e7-b0c0-560b64a674da',
  'ee6600c5-0719-5705-bf59-a419f44d20b4'
);
--> statement-breakpoint
-- 2. exercise_tags for the orphaned exercises (belt-and-suspenders)
DELETE FROM exercise_tags
WHERE exercise_id IN (
  SELECT id FROM exercises
  WHERE language = 'TR'
    AND grammar_point_key IN (
      'tr-a2-dili-past','tr-a2-accusative-definite-object',
      'tr-a2-ablative-dative','tr-a2-genitive-possessive','tr-a2-question-formation'
    )
);
--> statement-breakpoint
-- 3. user_exercise_history rows for the orphaned exercises (FK dependent)
DELETE FROM user_exercise_history
WHERE exercise_id IN (
  SELECT id FROM exercises
  WHERE language = 'TR'
    AND grammar_point_key IN (
      'tr-a2-dili-past','tr-a2-accusative-definite-object',
      'tr-a2-ablative-dative','tr-a2-genitive-possessive','tr-a2-question-formation'
    )
);
--> statement-breakpoint
-- 4. playlist_items pointing at the orphaned exercises (FK dependent)
DELETE FROM playlist_items
WHERE exercise_id IN (
  SELECT id FROM exercises
  WHERE language = 'TR'
    AND grammar_point_key IN (
      'tr-a2-dili-past','tr-a2-accusative-definite-object',
      'tr-a2-ablative-dative','tr-a2-genitive-possessive','tr-a2-question-formation'
    )
);
--> statement-breakpoint
-- 5. the orphaned exercises themselves
DELETE FROM exercises
WHERE language = 'TR'
  AND grammar_point_key IN (
    'tr-a2-dili-past','tr-a2-accusative-definite-object',
    'tr-a2-ablative-dative','tr-a2-genitive-possessive','tr-a2-question-formation'
  );
--> statement-breakpoint
-- 6. the orphaned skill_topics (explicit IDs so tr-a2-everyday-vocab survives)
DELETE FROM skill_topics
WHERE id IN (
  '17ade3fa-dfeb-599e-9428-2592026723ff',
  '3189b08c-5ea5-50d8-9771-ec24bf237a19',
  'cedcac61-873d-53cf-baf9-b043b9cb133a',
  'a4233fbd-a492-54e7-b0c0-560b64a674da',
  'ee6600c5-0719-5705-bf59-a419f44d20b4'
);
