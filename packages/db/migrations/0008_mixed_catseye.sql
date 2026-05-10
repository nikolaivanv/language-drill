CREATE TABLE "theory_topics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"language" text NOT NULL,
	"grammar_point_key" text NOT NULL,
	"topic_id" text NOT NULL,
	"cefr_level" text NOT NULL,
	"content_json" jsonb NOT NULL,
	"generation_source" text DEFAULT 'manual' NOT NULL,
	"model_id" text,
	"quality_score" real,
	"review_status" text DEFAULT 'auto-approved' NOT NULL,
	"flagged_reasons" jsonb,
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theory_topics_language_check" CHECK ("theory_topics"."language" IN ('ES', 'DE', 'TR')),
	CONSTRAINT "theory_topics_cefr_check" CHECK ("theory_topics"."cefr_level" IN ('A1', 'A2', 'B1', 'B2')),
	CONSTRAINT "theory_topics_generation_source_check" CHECK ("theory_topics"."generation_source" IN ('manual', 'claude-realtime', 'claude-batch')),
	CONSTRAINT "theory_topics_review_status_check" CHECK ("theory_topics"."review_status" IN ('auto-approved', 'flagged', 'rejected', 'manual-approved'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "theory_topics_pool_lookup_idx" ON "theory_topics" USING btree ("language","grammar_point_key") WHERE "theory_topics"."review_status" IN ('auto-approved', 'manual-approved');--> statement-breakpoint
CREATE INDEX "theory_topics_panel_idx" ON "theory_topics" USING btree ("language","topic_id") WHERE "theory_topics"."review_status" IN ('auto-approved', 'manual-approved');