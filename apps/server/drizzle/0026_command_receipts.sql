CREATE TABLE "command_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_scope" text NOT NULL,
	"command_kind" text NOT NULL,
	"command_id" text NOT NULL,
	"world_epoch" integer DEFAULT 1 NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "command_receipts_scope_kind_id_epoch_unique" UNIQUE("actor_scope","command_kind","command_id","world_epoch")
);
