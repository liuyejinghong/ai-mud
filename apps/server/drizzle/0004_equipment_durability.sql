CREATE TABLE IF NOT EXISTS "character_equipment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "character_id" uuid NOT NULL REFERENCES "characters"("id"),
  "slot" text NOT NULL,
  "item_key" text NOT NULL,
  "name" text NOT NULL,
  "item_level" integer DEFAULT 1 NOT NULL,
  "attack_bonus" integer DEFAULT 0 NOT NULL,
  "defense_bonus" integer DEFAULT 0 NOT NULL,
  "max_durability" integer DEFAULT 100 NOT NULL,
  "current_durability" integer DEFAULT 100 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "character_equipment_character_slot_idx"
  ON "character_equipment" ("character_id", "slot");
