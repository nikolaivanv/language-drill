CREATE TABLE "read_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"language" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"flagged_words" jsonb NOT NULL,
	"bank" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pasted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_vocabulary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"language" text NOT NULL,
	"word" text NOT NULL,
	"lemma" text NOT NULL,
	"source" text NOT NULL,
	"source_read_entry_id" uuid,
	"pos" text NOT NULL,
	"gloss" text NOT NULL,
	"example_sentence" text NOT NULL,
	"frequency_rank" integer,
	"cefr_band" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_vocabulary_user_lang_word_uq" UNIQUE("user_id","language","word")
);
--> statement-breakpoint
ALTER TABLE "read_entries" ADD CONSTRAINT "read_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_vocabulary" ADD CONSTRAINT "user_vocabulary_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_vocabulary" ADD CONSTRAINT "user_vocabulary_source_read_entry_id_read_entries_id_fk" FOREIGN KEY ("source_read_entry_id") REFERENCES "public"."read_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "read_entries_user_lang_pasted_at_idx" ON "read_entries" USING btree ("user_id","language","pasted_at" desc);--> statement-breakpoint
CREATE INDEX "user_vocabulary_user_lang_idx" ON "user_vocabulary" USING btree ("user_id","language");