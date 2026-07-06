CREATE TABLE "asset_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_type" text NOT NULL,
  "operation" text NOT NULL,
  "from_bucket" text,
  "from_entity_id" text,
  "to_bucket" text,
  "to_entity_id" text,
  "amount_copper" integer NOT NULL,
  "reason" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "asset_ledger_asset_type_check" CHECK ("asset_type" IN ('copper')),
  CONSTRAINT "asset_ledger_from_bucket_check" CHECK ("from_bucket" IS NULL OR "from_bucket" IN ('player', 'npc', 'municipal', 'escrow', 'system_source', 'system_sink')),
  CONSTRAINT "asset_ledger_to_bucket_check" CHECK ("to_bucket" IS NULL OR "to_bucket" IN ('player', 'npc', 'municipal', 'escrow', 'system_source', 'system_sink')),
  CONSTRAINT "asset_ledger_positive_amount_check" CHECK ("amount_copper" > 0)
);
--> statement-breakpoint
CREATE INDEX "asset_ledger_created_at_idx" ON "asset_ledger" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "asset_ledger_operation_created_at_idx" ON "asset_ledger" USING btree ("operation", "created_at");
--> statement-breakpoint
CREATE INDEX "asset_ledger_from_bucket_created_at_idx" ON "asset_ledger" USING btree ("from_bucket", "created_at");
--> statement-breakpoint
CREATE INDEX "asset_ledger_to_bucket_created_at_idx" ON "asset_ledger" USING btree ("to_bucket", "created_at");
--> statement-breakpoint
INSERT INTO "asset_ledger" (
  "asset_type",
  "operation",
  "from_bucket",
  "from_entity_id",
  "to_bucket",
  "to_entity_id",
  "amount_copper",
  "reason",
  "metadata",
  "created_at"
)
SELECT
  'copper',
  'migration_baseline',
  'system_source',
  'migration_0020',
  'player',
  "id"::text,
  "copper_balance",
  'migration.0020.baseline.player',
  jsonb_build_object('table', 'characters'),
  now()
FROM "characters"
WHERE "copper_balance" > 0;
--> statement-breakpoint
INSERT INTO "asset_ledger" (
  "asset_type",
  "operation",
  "from_bucket",
  "from_entity_id",
  "to_bucket",
  "to_entity_id",
  "amount_copper",
  "reason",
  "metadata",
  "created_at"
)
SELECT
  'copper',
  'migration_baseline',
  'system_source',
  'migration_0020',
  'npc',
  "id"::text,
  "copper_balance",
  'migration.0020.baseline.npc',
  jsonb_build_object('table', 'world_actors'),
  now()
FROM "world_actors"
WHERE "actor_type" = 'npc' AND "copper_balance" > 0;
--> statement-breakpoint
INSERT INTO "asset_ledger" (
  "asset_type",
  "operation",
  "from_bucket",
  "from_entity_id",
  "to_bucket",
  "to_entity_id",
  "amount_copper",
  "reason",
  "metadata",
  "created_at"
)
SELECT
  'copper',
  'migration_baseline',
  'system_source',
  'migration_0020',
  'municipal',
  "settlement_id",
  "copper_balance",
  'migration.0020.baseline.municipal',
  jsonb_build_object('table', 'municipal_treasury'),
  now()
FROM "municipal_treasury"
WHERE "copper_balance" > 0;
--> statement-breakpoint
INSERT INTO "asset_ledger" (
  "asset_type",
  "operation",
  "from_bucket",
  "from_entity_id",
  "to_bucket",
  "to_entity_id",
  "amount_copper",
  "reason",
  "metadata",
  "created_at"
)
SELECT
  'copper',
  'migration_baseline',
  'system_source',
  'migration_0020',
  'escrow',
  "id"::text,
  "escrow_copper",
  'migration.0020.baseline.escrow',
  jsonb_build_object('table', 'npc_tasks', 'status', "status"),
  now()
FROM "npc_tasks"
WHERE "status" IN ('open', 'accepted') AND "escrow_copper" > 0;
