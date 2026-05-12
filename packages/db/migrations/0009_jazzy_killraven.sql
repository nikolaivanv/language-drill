CREATE TABLE "theory_generation_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cell_key" text NOT NULL,
	"status" text NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"input_tokens_used" integer,
	"output_tokens_used" integer,
	"cost_usd_estimate" numeric(10, 4),
	"approved" boolean,
	"flagged" boolean,
	"rejected" boolean,
	"error_message" text,
	CONSTRAINT "theory_generation_jobs_status_check" CHECK ("theory_generation_jobs"."status" IN ('queued', 'running', 'succeeded', 'failed')),
	CONSTRAINT "theory_generation_jobs_trigger_check" CHECK ("theory_generation_jobs"."trigger" IN ('cli', 'scheduled', 'admin'))
);
--> statement-breakpoint
CREATE INDEX "theory_generation_jobs_cell_idx" ON "theory_generation_jobs" USING btree ("cell_key","started_at" DESC NULLS LAST);