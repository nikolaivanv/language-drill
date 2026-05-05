CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_key" text NOT NULL,
	"requested_count" integer NOT NULL,
	"produced_count" integer DEFAULT 0 NOT NULL,
	"approved_count" integer DEFAULT 0 NOT NULL,
	"flagged_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"input_tokens_used" integer,
	"output_tokens_used" integer,
	"cost_usd_estimate" numeric(10, 4),
	"trigger" text NOT NULL,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "grammar_point_key" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "topic_domain" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "generation_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "model_id" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "quality_score" real;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "review_status" text DEFAULT 'auto-approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "flagged_reasons" jsonb;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "generated_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "generation_jobs_cell_idx" ON "generation_jobs" USING btree ("cell_key","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "exercises_pool_lookup_idx" ON "exercises" USING btree ("language","difficulty","type","grammar_point_key") WHERE "exercises"."review_status" IN ('auto-approved', 'manual-approved');