ALTER TABLE "read_entries" DROP CONSTRAINT "read_entries_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "user_grammar_mastery" DROP CONSTRAINT "user_grammar_mastery_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "read_entries" ADD CONSTRAINT "read_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_grammar_mastery" ADD CONSTRAINT "user_grammar_mastery_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;