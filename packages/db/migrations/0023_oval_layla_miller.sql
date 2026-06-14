CREATE TABLE "user_grammar_mastery" (
	"user_id" text NOT NULL,
	"language" text NOT NULL,
	"grammar_point_key" text NOT NULL,
	"mastery_score" real NOT NULL,
	"confidence" real NOT NULL,
	"evidence_count" integer NOT NULL,
	"last_practiced_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_grammar_mastery_user_id_grammar_point_key_pk" PRIMARY KEY("user_id","grammar_point_key")
);
--> statement-breakpoint
ALTER TABLE "user_grammar_mastery" ADD CONSTRAINT "user_grammar_mastery_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_grammar_mastery_user_language_idx" ON "user_grammar_mastery" USING btree ("user_id","language");