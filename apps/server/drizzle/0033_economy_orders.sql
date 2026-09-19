-- v0.16 订单经济：账款余额（唯一）、外部订单、采购在途。
ALTER TABLE "bases" ADD "credits" integer DEFAULT 500 NOT NULL;
--> statement-breakpoint
ALTER TABLE "bases" ADD CONSTRAINT "bases_credits_nonnegative_check" CHECK ("bases"."credits" >= 0);
--> statement-breakpoint
CREATE TABLE "base_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_id" uuid NOT NULL,
	"order_def_id" text NOT NULL,
	"order_revision" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"required_item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"reward_credits" integer NOT NULL,
	"deadline_sim" timestamp with time zone,
	"accepted_at_sim" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "base_orders_status_check" CHECK ("base_orders"."status" IN ('open', 'accepted', 'delivered', 'failed')),
	CONSTRAINT "base_orders_quantity_positive_check" CHECK ("base_orders"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "base_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"cost_credits" integer NOT NULL,
	"status" text DEFAULT 'in_transit' NOT NULL,
	"arrives_at_sim" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "base_purchases_status_check" CHECK ("base_purchases"."status" IN ('in_transit', 'delivered')),
	CONSTRAINT "base_purchases_quantity_positive_check" CHECK ("base_purchases"."quantity" > 0),
	CONSTRAINT "base_purchases_cost_nonnegative_check" CHECK ("base_purchases"."cost_credits" >= 0)
);
--> statement-breakpoint
CREATE INDEX "base_orders_base_status_idx" ON "base_orders" ("base_id","status");
--> statement-breakpoint
CREATE INDEX "base_purchases_base_status_idx" ON "base_purchases" ("base_id","status");
--> statement-breakpoint
ALTER TABLE "base_orders" ADD CONSTRAINT "base_orders_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "base_purchases" ADD CONSTRAINT "base_purchases_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE restrict ON UPDATE cascade;
