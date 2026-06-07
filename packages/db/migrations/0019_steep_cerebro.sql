ALTER TABLE "read_entries" ADD COLUMN "kind" text DEFAULT 'pasted' NOT NULL;--> statement-breakpoint
ALTER TABLE "read_entries" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "read_entries" ADD COLUMN "cefr" text;--> statement-breakpoint
ALTER TABLE "read_entries" ADD COLUMN "length" text;--> statement-breakpoint
ALTER TABLE "read_entries" ADD COLUMN "prompt" text;