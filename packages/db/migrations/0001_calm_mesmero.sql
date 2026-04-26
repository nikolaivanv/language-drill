ALTER TABLE "user_language_profiles" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_language_profiles" ALTER COLUMN "proficiency_level" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_language_profiles" ADD CONSTRAINT "uq_user_language" UNIQUE("user_id","language");