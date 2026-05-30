CREATE TABLE "vocabulary_review_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"language" text NOT NULL,
	"review_state_id" uuid NOT NULL,
	"session_id" uuid,
	"lemma" text NOT NULL,
	"item_type" text NOT NULL,
	"surface" text,
	"outcome" text NOT NULL,
	"rating" smallint NOT NULL,
	"cefr_band" text,
	"grammar_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vocabulary_review_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"language" text NOT NULL,
	"filter" jsonb,
	"item_count" smallint NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vocabulary_review_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"language" text NOT NULL,
	"lemma" text NOT NULL,
	"fsrs_card_json" jsonb NOT NULL,
	"stability" real NOT NULL,
	"difficulty" real NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'new' NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vocabulary_review_state_user_lang_lemma_uq" UNIQUE("user_id","language","lemma")
);
--> statement-breakpoint
ALTER TABLE "vocabulary_review_log" ADD CONSTRAINT "vocabulary_review_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_review_log" ADD CONSTRAINT "vocabulary_review_log_review_state_id_vocabulary_review_state_id_fk" FOREIGN KEY ("review_state_id") REFERENCES "public"."vocabulary_review_state"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_review_log" ADD CONSTRAINT "vocabulary_review_log_session_id_vocabulary_review_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."vocabulary_review_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_review_sessions" ADD CONSTRAINT "vocabulary_review_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_review_state" ADD CONSTRAINT "vocabulary_review_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vocabulary_review_log_user_lang_reviewed_at_idx" ON "vocabulary_review_log" USING btree ("user_id","language","reviewed_at");--> statement-breakpoint
CREATE INDEX "vocabulary_review_log_review_state_reviewed_at_idx" ON "vocabulary_review_log" USING btree ("review_state_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "vocabulary_review_sessions_user_id_started_at_idx" ON "vocabulary_review_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "vocabulary_review_state_user_lang_due_at_idx" ON "vocabulary_review_state" USING btree ("user_id","language","due_at");--> statement-breakpoint
CREATE INDEX "vocabulary_review_state_user_lang_state_idx" ON "vocabulary_review_state" USING btree ("user_id","language","state");