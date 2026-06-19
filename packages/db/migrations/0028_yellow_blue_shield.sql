CREATE TABLE "error_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"language" text NOT NULL,
	"exercise_id" uuid NOT NULL,
	"session_id" uuid,
	"exercise_history_id" uuid NOT NULL,
	"exercise_type" text NOT NULL,
	"host_grammar_point_key" text,
	"error_grammar_point_key" text,
	"error_type" text NOT NULL,
	"severity" text NOT NULL,
	"wrong_text" text NOT NULL,
	"correction" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "error_observations" ADD CONSTRAINT "error_observations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_observations" ADD CONSTRAINT "error_observations_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_observations" ADD CONSTRAINT "error_observations_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_observations" ADD CONSTRAINT "error_observations_exercise_history_id_user_exercise_history_id_fk" FOREIGN KEY ("exercise_history_id") REFERENCES "public"."user_exercise_history"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "error_observations_user_language_occurred_at_idx" ON "error_observations" USING btree ("user_id","language","occurred_at");--> statement-breakpoint
CREATE INDEX "error_observations_user_error_point_idx" ON "error_observations" USING btree ("user_id","error_grammar_point_key");--> statement-breakpoint
CREATE INDEX "error_observations_history_id_idx" ON "error_observations" USING btree ("exercise_history_id");