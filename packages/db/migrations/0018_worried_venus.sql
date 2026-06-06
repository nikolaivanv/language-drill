CREATE TABLE "generated_reading_texts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" text NOT NULL,
	"language" text NOT NULL,
	"cefr" text NOT NULL,
	"length" text NOT NULL,
	"prompt" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"difficulty_score" real NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generated_reading_texts_cache_key_uq" UNIQUE("cache_key")
);
