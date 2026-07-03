CREATE TABLE "chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "character_id" uuid NOT NULL REFERENCES "characters"("id"),
  "channel" text NOT NULL DEFAULT 'lobby',
  "body" text NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_messages_channel_check" CHECK ("channel" IN ('lobby'))
);
--> statement-breakpoint
CREATE INDEX "chat_messages_channel_id_idx" ON "chat_messages" ("channel", "id");
--> statement-breakpoint
CREATE INDEX "chat_messages_character_created_at_idx" ON "chat_messages" ("character_id", "created_at");
--> statement-breakpoint
CREATE TABLE "character_presence" (
  "account_id" uuid PRIMARY KEY REFERENCES "accounts"("id"),
  "character_id" uuid NOT NULL REFERENCES "characters"("id"),
  "last_seen_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "character_presence_character_id_idx" ON "character_presence" ("character_id");
--> statement-breakpoint
CREATE INDEX "character_presence_last_seen_at_idx" ON "character_presence" ("last_seen_at");
--> statement-breakpoint
CREATE INDEX "sync_events_public_id_idx" ON "sync_events" ("id") WHERE "audience" = 'public';
