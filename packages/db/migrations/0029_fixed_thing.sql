CREATE TABLE "vocab_lemma" (
	"language" text NOT NULL,
	"lemma" text NOT NULL,
	"rank" integer NOT NULL,
	"pos_all" text[] DEFAULT '{}' NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "vocab_lemma_language_lemma_pk" PRIMARY KEY("language","lemma")
);
--> statement-breakpoint
CREATE INDEX "vocab_lemma_language_rank_idx" ON "vocab_lemma" USING btree ("language","rank");