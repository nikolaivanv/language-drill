CREATE TABLE "gloss_cache" (
	"language" text NOT NULL,
	"lemma" text NOT NULL,
	"base_gloss" text NOT NULL,
	"pos" text NOT NULL,
	"cefr" text,
	"freq_rank" integer,
	"source" text NOT NULL,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gloss_cache_language_lemma_pk" PRIMARY KEY("language","lemma")
);
