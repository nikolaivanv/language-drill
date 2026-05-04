CREATE TABLE "practice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"language" text NOT NULL,
	"difficulty" text NOT NULL,
	"exercise_count" smallint NOT NULL,
	"correct_count" smallint DEFAULT 0 NOT NULL,
	"exercise_ids" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user_exercise_history" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "practice_sessions_user_id_started_at_idx" ON "practice_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
ALTER TABLE "user_exercise_history" ADD CONSTRAINT "user_exercise_history_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_exercise_history_session_id_idx" ON "user_exercise_history" USING btree ("session_id");