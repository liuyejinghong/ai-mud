CREATE TABLE IF NOT EXISTS "npc_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "npc_actor_id" uuid NOT NULL REFERENCES "world_actors"("id"),
  "need_type" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "requested_item_id" text NOT NULL,
  "requested_quantity" integer NOT NULL,
  "reward_copper" integer NOT NULL,
  "escrow_copper" integer NOT NULL,
  "accepted_by_character_id" uuid REFERENCES "characters"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "npc_tasks_npc_status_idx"
  ON "npc_tasks" ("npc_actor_id", "status");

CREATE INDEX IF NOT EXISTS "npc_tasks_character_status_idx"
  ON "npc_tasks" ("accepted_by_character_id", "status");

CREATE INDEX IF NOT EXISTS "npc_tasks_expires_at_idx"
  ON "npc_tasks" ("expires_at");
