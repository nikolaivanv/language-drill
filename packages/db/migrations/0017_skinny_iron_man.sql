ALTER TABLE "invitations" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "revoked_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;
--> statement-breakpoint
-- Backfill: existing users who already hold a claimed invitation keep their
-- perk as a boosted plan. Admins are boosted dynamically (ADMIN_USER_IDS), so
-- they need no backfill here.
UPDATE "users" SET "plan" = 'boosted'
WHERE "id" IN (SELECT "used_by" FROM "invitations" WHERE "used_by" IS NOT NULL);
