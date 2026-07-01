CREATE TABLE IF NOT EXISTS "npc_memory_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "npc_actor_id" uuid NOT NULL REFERENCES "world_actors"("id"),
  "character_id" uuid REFERENCES "characters"("id"),
  "source_type" text NOT NULL,
  "memory_kind" text NOT NULL,
  "importance" integer DEFAULT 1 NOT NULL,
  "summary" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "compressed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "npc_memory_entries_npc_occurred_at_idx"
  ON "npc_memory_entries" ("npc_actor_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "npc_memory_entries_character_npc_idx"
  ON "npc_memory_entries" ("character_id", "npc_actor_id");
CREATE INDEX IF NOT EXISTS "npc_memory_entries_compression_idx"
  ON "npc_memory_entries" ("npc_actor_id", "compressed_at", "occurred_at");

CREATE TABLE IF NOT EXISTS "npc_memory_fragments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "npc_actor_id" uuid NOT NULL REFERENCES "world_actors"("id"),
  "character_id" uuid REFERENCES "characters"("id"),
  "memory_kind" text NOT NULL,
  "importance" integer DEFAULT 1 NOT NULL,
  "summary" text NOT NULL,
  "first_occurred_at" timestamp with time zone NOT NULL,
  "last_occurred_at" timestamp with time zone NOT NULL,
  "source_entry_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "compression_level" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "npc_memory_fragments_npc_last_occurred_at_idx"
  ON "npc_memory_fragments" ("npc_actor_id", "last_occurred_at");
CREATE INDEX IF NOT EXISTS "npc_memory_fragments_character_npc_idx"
  ON "npc_memory_fragments" ("character_id", "npc_actor_id");
