CREATE TABLE "exercise_word_hints" (
	"exercise_id" uuid PRIMARY KEY NOT NULL,
	"units_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_exercise_history" ADD COLUMN "evidence_weight" real;--> statement-breakpoint
ALTER TABLE "exercise_word_hints" ADD CONSTRAINT "exercise_word_hints_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;