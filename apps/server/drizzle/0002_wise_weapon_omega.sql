CREATE TYPE "public"."character_action_status" AS ENUM('active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."character_action_type" AS ENUM('gathering', 'combat');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "character_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"action_type" "character_action_type" NOT NULL,
	"status" "character_action_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_actions" ADD CONSTRAINT "character_actions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "character_actions_character_status_idx" ON "character_actions" USING btree ("character_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "character_actions_ends_at_idx" ON "character_actions" USING btree ("ends_at");