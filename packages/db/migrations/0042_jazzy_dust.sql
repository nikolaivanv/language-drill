CREATE TABLE "submission_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"grade_ok" boolean,
	"feedback_ok" boolean,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"critique" text,
	"stratum" text NOT NULL,
	"prompt_version" text,
	"labeled_by" text NOT NULL,
	"labeled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "submission_labels" ADD CONSTRAINT "submission_labels_submission_id_user_exercise_history_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."user_exercise_history"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "submission_labels_submission_labeler_unique" ON "submission_labels" USING btree ("submission_id","labeled_by");--> statement-breakpoint
CREATE INDEX "submission_labels_stratum_labeled_at_idx" ON "submission_labels" USING btree ("stratum","labeled_at");