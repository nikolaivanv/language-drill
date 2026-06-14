ALTER TABLE "playlists" DROP CONSTRAINT "playlists_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "spaced_repetition_cards" DROP CONSTRAINT "spaced_repetition_cards_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "usage_events" DROP CONSTRAINT "usage_events_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "user_exercise_history" DROP CONSTRAINT "user_exercise_history_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "user_language_profiles" DROP CONSTRAINT "user_language_profiles_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaced_repetition_cards" ADD CONSTRAINT "spaced_repetition_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_exercise_history" ADD CONSTRAINT "user_exercise_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_language_profiles" ADD CONSTRAINT "user_language_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_events_user_id_event_type_created_at_idx" ON "usage_events" USING btree ("user_id","event_type","created_at");