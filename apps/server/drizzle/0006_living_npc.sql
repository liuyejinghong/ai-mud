ALTER TABLE "market_transactions" ALTER COLUMN "character_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "market_transactions" ADD COLUMN IF NOT EXISTS "actor_type" text DEFAULT 'player' NOT NULL;
--> statement-breakpoint
ALTER TABLE "market_transactions" ADD COLUMN IF NOT EXISTS "actor_id" text;
--> statement-breakpoint
ALTER TABLE "market_transactions" ADD COLUMN IF NOT EXISTS "actor_name" text DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "world_actors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" text NOT NULL,
	"npc_key" text UNIQUE,
	"name" text NOT NULL,
	"profession" text NOT NULL,
	"current_location" "game_location" DEFAULT 'blackpine_outpost' NOT NULL,
	"position" jsonb,
	"copper_balance" integer DEFAULT 0 NOT NULL,
	"hunger" integer DEFAULT 5 NOT NULL,
	"last_hunger_settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"injury_until" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "npc_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "npc_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"action_type" text NOT NULL,
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
CREATE TABLE IF NOT EXISTS "npc_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "world_resource_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" "game_location" NOT NULL,
	"resource_id" text NOT NULL,
	"position" jsonb NOT NULL,
	"charges" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "municipal_treasury" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" text NOT NULL UNIQUE,
	"copper_balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "npc_items" ADD CONSTRAINT "npc_items_actor_id_world_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."world_actors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "npc_actions" ADD CONSTRAINT "npc_actions_actor_id_world_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."world_actors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "npc_events" ADD CONSTRAINT "npc_events_actor_id_world_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."world_actors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "world_actors_actor_type_idx" ON "world_actors" USING btree ("actor_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "world_actors_npc_key_idx" ON "world_actors" USING btree ("npc_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "npc_items_actor_item_idx" ON "npc_items" USING btree ("actor_id","item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "npc_actions_actor_status_idx" ON "npc_actions" USING btree ("actor_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "npc_actions_ends_at_idx" ON "npc_actions" USING btree ("ends_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "npc_events_actor_created_at_idx" ON "npc_events" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "world_resource_nodes_resource_idx" ON "world_resource_nodes" USING btree ("zone_id","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "municipal_treasury_settlement_idx" ON "municipal_treasury" USING btree ("settlement_id");
