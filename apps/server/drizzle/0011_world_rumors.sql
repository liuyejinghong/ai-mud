CREATE TABLE IF NOT EXISTS "world_rumors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_type" text NOT NULL,
  "source_id" uuid,
  "settlement_id" text,
  "audience" text DEFAULT 'public' NOT NULL,
  "message" text NOT NULL,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "generated_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "world_rumors_source_idx"
  ON "world_rumors" USING btree ("source_type", "source_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "world_rumors_created_at_idx"
  ON "world_rumors" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "world_rumors_audience_created_at_idx"
  ON "world_rumors" USING btree ("audience", "created_at");
