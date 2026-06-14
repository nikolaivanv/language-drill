CREATE TABLE "fluency_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"exercise_id" uuid NOT NULL,
	"language" text,
	"grammar_point_key" text,
	"correct" boolean NOT NULL,
	"latency_ms" integer NOT NULL,
	"attempted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fluency_attempts" ADD CONSTRAINT "fluency_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fluency_attempts" ADD CONSTRAINT "fluency_attempts_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fluency_attempts_user_id_language_attempted_at_idx" ON "fluency_attempts" USING btree ("user_id","language","attempted_at");