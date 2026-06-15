ALTER TABLE "practice_sessions" DROP CONSTRAINT "practice_sessions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;