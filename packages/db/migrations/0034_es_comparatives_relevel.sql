-- Re-level es-b1-comparatives-superlatives -> es-a2-comparatives-superlatives
-- (PCIC alignment; see docs/superpowers/specs/2026-07-06-es-a1-a2-pcic-curriculum-design.md).
-- Pure forward-only DML; no-op on databases without the old key.
UPDATE "exercises" SET "grammar_point_key" = 'es-a2-comparatives-superlatives', "difficulty" = 'A2' WHERE "grammar_point_key" = 'es-b1-comparatives-superlatives';--> statement-breakpoint
UPDATE "user_grammar_mastery" SET "grammar_point_key" = 'es-a2-comparatives-superlatives' WHERE "grammar_point_key" = 'es-b1-comparatives-superlatives';--> statement-breakpoint
UPDATE "theory_topics" SET "grammar_point_key" = 'es-a2-comparatives-superlatives' WHERE "grammar_point_key" = 'es-b1-comparatives-superlatives';--> statement-breakpoint
UPDATE "error_observations" SET "host_grammar_point_key" = 'es-a2-comparatives-superlatives' WHERE "host_grammar_point_key" = 'es-b1-comparatives-superlatives';--> statement-breakpoint
UPDATE "error_observations" SET "error_grammar_point_key" = 'es-a2-comparatives-superlatives' WHERE "error_grammar_point_key" = 'es-b1-comparatives-superlatives';--> statement-breakpoint
UPDATE "fluency_attempts" SET "grammar_point_key" = 'es-a2-comparatives-superlatives' WHERE "grammar_point_key" = 'es-b1-comparatives-superlatives';--> statement-breakpoint
UPDATE "spaced_repetition_cards" SET "item_id" = 'es-a2-comparatives-superlatives' WHERE "item_type" = 'grammar_point' AND "item_id" = 'es-b1-comparatives-superlatives';
