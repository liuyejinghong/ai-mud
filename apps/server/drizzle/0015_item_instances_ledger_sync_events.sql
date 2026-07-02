CREATE TABLE "item_instances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "item_def_id" text NOT NULL,
  "owner_type" text NOT NULL,
  "owner_id" uuid,
  "location_type" text NOT NULL DEFAULT 'inventory',
  "location_id" text,
  "slot" text,
  "rarity" text NOT NULL DEFAULT 'common',
  "item_level" integer NOT NULL,
  "base_stats" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "affixes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "max_durability" integer NOT NULL,
  "current_durability" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "item_instances_owner_type_check" CHECK ("owner_type" IN ('character', 'npc', 'market', 'system')),
  CONSTRAINT "item_instances_location_type_check" CHECK ("location_type" IN ('inventory', 'equipped', 'market', 'destroyed')),
  CONSTRAINT "item_instances_slot_check" CHECK ("slot" IS NULL OR "slot" IN ('weapon', 'chest', 'head', 'accessory')),
  CONSTRAINT "item_instances_rarity_check" CHECK ("rarity" IN ('common', 'uncommon', 'rare', 'epic')),
  CONSTRAINT "item_instances_durability_check" CHECK ("max_durability" > 0 AND "current_durability" >= 0 AND "current_durability" <= "max_durability")
);
--> statement-breakpoint
CREATE INDEX "item_instances_owner_idx" ON "item_instances" ("owner_type", "owner_id", "location_type");
--> statement-breakpoint
CREATE UNIQUE INDEX "item_instances_character_equipped_slot_idx"
  ON "item_instances" ("owner_id", "slot")
  WHERE "owner_type" = 'character' AND "location_type" = 'equipped' AND "slot" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "item_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "operation" text NOT NULL,
  "item_def_id" text NOT NULL,
  "quantity" integer,
  "item_instance_id" uuid REFERENCES "item_instances"("id"),
  "from_owner_type" text,
  "from_owner_id" uuid,
  "to_owner_type" text,
  "to_owner_id" uuid,
  "reason" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "item_ledger_operation_check" CHECK ("operation" IN ('grant', 'consume', 'transfer', 'equip', 'unequip', 'destroy')),
  CONSTRAINT "item_ledger_quantity_check" CHECK ("quantity" IS NULL OR "quantity" > 0),
  CONSTRAINT "item_ledger_from_owner_type_check" CHECK ("from_owner_type" IS NULL OR "from_owner_type" IN ('character', 'npc', 'market', 'system')),
  CONSTRAINT "item_ledger_to_owner_type_check" CHECK ("to_owner_type" IS NULL OR "to_owner_type" IN ('character', 'npc', 'market', 'system'))
);
--> statement-breakpoint
CREATE INDEX "item_ledger_instance_idx" ON "item_ledger" ("item_instance_id", "created_at");
--> statement-breakpoint
CREATE INDEX "item_ledger_owner_idx" ON "item_ledger" ("to_owner_type", "to_owner_id", "created_at");
--> statement-breakpoint
CREATE TABLE "sync_events" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "audience" text NOT NULL,
  "account_id" uuid REFERENCES "accounts"("id"),
  "character_id" uuid REFERENCES "characters"("id"),
  "event_type" text NOT NULL,
  "state_dirty" boolean NOT NULL DEFAULT false,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source" text NOT NULL DEFAULT 'server',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sync_events_audience_check" CHECK ("audience" IN ('account', 'character', 'public', 'admin'))
);
--> statement-breakpoint
CREATE INDEX "sync_events_account_id_idx" ON "sync_events" ("account_id", "id");
--> statement-breakpoint
CREATE INDEX "sync_events_character_id_idx" ON "sync_events" ("character_id", "id");
