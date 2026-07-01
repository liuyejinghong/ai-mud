CREATE TABLE IF NOT EXISTS "ai_call_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "prompt_version" integer NOT NULL,
  "purpose" text NOT NULL,
  "account_id" uuid REFERENCES "accounts"("id"),
  "character_id" uuid REFERENCES "characters"("id"),
  "npc_actor_id" uuid REFERENCES "world_actors"("id"),
  "request_hash" text NOT NULL,
  "input_summary" text NOT NULL,
  "output_summary" text NOT NULL,
  "status" text NOT NULL,
  "latency_ms" integer,
  "input_tokens" integer,
  "output_tokens" integer,
  "error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ai_call_logs_created_at_idx"
  ON "ai_call_logs" ("created_at");

CREATE INDEX IF NOT EXISTS "ai_call_logs_npc_created_at_idx"
  ON "ai_call_logs" ("npc_actor_id", "created_at");

CREATE TABLE IF NOT EXISTS "npc_dialogue_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "character_id" uuid NOT NULL REFERENCES "characters"("id"),
  "npc_actor_id" uuid NOT NULL REFERENCES "world_actors"("id"),
  "speaker_type" text NOT NULL,
  "message" text NOT NULL,
  "safety_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "npc_dialogue_messages_conversation_created_at_idx"
  ON "npc_dialogue_messages" ("character_id", "npc_actor_id", "created_at");

CREATE TABLE IF NOT EXISTS "npc_relationships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "character_id" uuid NOT NULL REFERENCES "characters"("id"),
  "npc_actor_id" uuid NOT NULL REFERENCES "world_actors"("id"),
  "familiarity" integer DEFAULT 0 NOT NULL,
  "trust" integer DEFAULT 0 NOT NULL,
  "last_interaction_at" timestamp with time zone DEFAULT now() NOT NULL,
  "short_summary" text DEFAULT '' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "npc_relationships_character_npc_idx"
  ON "npc_relationships" ("character_id", "npc_actor_id");
