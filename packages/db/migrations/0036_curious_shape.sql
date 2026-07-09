CREATE TABLE "vocab_target" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"language" text NOT NULL,
	"umbrella_key" text NOT NULL,
	"cefr_level" text NOT NULL,
	"lemma" text NOT NULL,
	"display_form" text NOT NULL,
	"gloss" text NOT NULL,
	"example_sentence" text NOT NULL,
	"freq_rank" integer,
	"tier" text NOT NULL,
	"status" text DEFAULT 'flagged' NOT NULL,
	"source" text DEFAULT 'llm' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "vocab_target_lang_umbrella_lemma_idx" ON "vocab_target" USING btree ("language","umbrella_key","lemma");--> statement-breakpoint
CREATE INDEX "vocab_target_browse_idx" ON "vocab_target" USING btree ("language","umbrella_key","status");