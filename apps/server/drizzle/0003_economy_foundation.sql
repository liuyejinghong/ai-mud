ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "copper_balance" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"target_quantity" integer NOT NULL,
	"base_buy_price_copper" integer NOT NULL,
	"base_sell_price_copper" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" text NOT NULL,
	"character_id" uuid NOT NULL,
	"transaction_type" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_copper" integer NOT NULL,
	"gross_copper" integer NOT NULL,
	"tax_copper" integer NOT NULL,
	"net_copper" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "market_transactions" ADD CONSTRAINT "market_transactions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_inventory_settlement_item_idx" ON "market_inventory" USING btree ("settlement_id","item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_transactions_settlement_created_at_idx" ON "market_transactions" USING btree ("settlement_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_transactions_character_created_at_idx" ON "market_transactions" USING btree ("character_id","created_at");
