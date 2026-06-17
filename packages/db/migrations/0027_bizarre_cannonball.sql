CREATE TABLE "exercise_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"history_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercise_flags" ADD CONSTRAINT "exercise_flags_history_id_user_exercise_history_id_fk" FOREIGN KEY ("history_id") REFERENCES "public"."user_exercise_history"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_flags" ADD CONSTRAINT "exercise_flags_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_flags" ADD CONSTRAINT "exercise_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_flags_history_id_unique" ON "exercise_flags" USING btree ("history_id");--> statement-breakpoint
CREATE INDEX "exercise_flags_status_created_at_idx" ON "exercise_flags" USING btree ("status","created_at");