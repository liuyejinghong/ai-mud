CREATE TYPE "public"."base_time_mode" AS ENUM('paused', 'running');
--> statement-breakpoint
CREATE TABLE "bases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"time_mode" "base_time_mode" DEFAULT 'paused' NOT NULL,
	"speed" integer DEFAULT 1 NOT NULL,
	"sim_time" timestamp with time zone DEFAULT now() NOT NULL,
	"last_advanced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"epoch" integer DEFAULT 1 NOT NULL,
	"base_revision" integer DEFAULT 1 NOT NULL,
	"content_release" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bases_account_id_unique" UNIQUE("account_id"),
	CONSTRAINT "bases_speed_allowed_check" CHECK ("bases"."speed" IN (1, 2, 4)),
	CONSTRAINT "bases_revision_positive_check" CHECK ("bases"."base_revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "base_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_id" uuid NOT NULL,
	"site_key" text NOT NULL,
	"state" text DEFAULT 'free' NOT NULL,
	"built_facility_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "base_sites_base_site_key_idx" UNIQUE("base_id","site_key"),
	CONSTRAINT "base_sites_state_check" CHECK ("base_sites"."state" IN ('free', 'reserved', 'built'))
);
--> statement-breakpoint
CREATE TABLE "base_control_leases" (
	"base_id" uuid PRIMARY KEY NOT NULL,
	"lease_token" text NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"reserved_quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "base_inventory_base_item_idx" UNIQUE("base_id","item_id"),
	CONSTRAINT "base_inventory_quantity_nonnegative_check" CHECK ("base_inventory"."quantity" >= 0),
	CONSTRAINT "base_inventory_reserved_bounded_check" CHECK ("base_inventory"."reserved_quantity" >= 0 AND "base_inventory"."reserved_quantity" <= "base_inventory"."quantity")
);
--> statement-breakpoint
CREATE TABLE "base_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_id" uuid NOT NULL,
	"device_def_id" text NOT NULL,
	"template_revision" integer NOT NULL,
	"source_operation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "base_devices_source_operation_idx" UNIQUE("source_operation","device_def_id")
);
--> statement-breakpoint
CREATE TABLE "robot_operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"base_id" uuid NOT NULL,
	"group_id" text NOT NULL,
	"battery_wh" integer NOT NULL,
	"battery_capacity_wh" integer NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"current_project_id" uuid,
	"current_step_index" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "robot_operators_device_id_unique" UNIQUE("device_id"),
	CONSTRAINT "robot_operators_battery_bounded_check" CHECK ("robot_operators"."battery_wh" >= 0 AND "robot_operators"."battery_wh" <= "robot_operators"."battery_capacity_wh"),
	CONSTRAINT "robot_operators_group_check" CHECK ("robot_operators"."group_id" IN ('transport', 'engineering', 'survey')),
	CONSTRAINT "robot_operators_status_check" CHECK ("robot_operators"."status" IN ('idle', 'charging', 'working', 'offline'))
);
--> statement-breakpoint
CREATE TABLE "base_power_state" (
	"base_id" uuid PRIMARY KEY NOT NULL,
	"generation_w_peak" integer NOT NULL,
	"storage_wh" integer NOT NULL,
	"storage_capacity_wh" integer NOT NULL,
	"last_load_w" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "base_power_storage_bounded_check" CHECK ("base_power_state"."storage_wh" >= 0 AND "base_power_state"."storage_wh" <= "base_power_state"."storage_capacity_wh")
);
--> statement-breakpoint
CREATE TABLE "base_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"project_def_id" text NOT NULL,
	"template_revision" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_step_index" integer DEFAULT 0 NOT NULL,
	"reserved_inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "base_projects_one_active_per_site_idx" UNIQUE("site_id") WHERE "base_projects"."status" IN ('planned', 'active', 'paused', 'blocked', 'needs_decision'),
	CONSTRAINT "base_projects_status_check" CHECK ("base_projects"."status" IN ('planned', 'active', 'paused', 'blocked', 'needs_decision', 'completed', 'cancelled', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "base_project_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"kind" text NOT NULL,
	"group_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"work_required" integer NOT NULL,
	"work_done" integer DEFAULT 0 NOT NULL,
	"blocked_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "base_project_steps_project_index_idx" UNIQUE("project_id","step_index"),
	CONSTRAINT "base_project_steps_kind_check" CHECK ("base_project_steps"."kind" IN ('site_clearing', 'transport', 'installation', 'commissioning')),
	CONSTRAINT "base_project_steps_group_check" CHECK ("base_project_steps"."group_id" IN ('transport', 'engineering', 'survey')),
	CONSTRAINT "base_project_steps_status_check" CHECK ("base_project_steps"."status" IN ('pending', 'ready', 'running', 'blocked', 'completed', 'failed')),
	CONSTRAINT "base_project_steps_work_bounded_check" CHECK ("base_project_steps"."work_done" >= 0 AND "base_project_steps"."work_done" <= "base_project_steps"."work_required")
);
--> statement-breakpoint
ALTER TABLE "bases" ADD CONSTRAINT "bases_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "base_sites" ADD CONSTRAINT "base_sites_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "base_control_leases" ADD CONSTRAINT "base_control_leases_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "base_inventory" ADD CONSTRAINT "base_inventory_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "base_devices" ADD CONSTRAINT "base_devices_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "robot_operators" ADD CONSTRAINT "robot_operators_device_id_base_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."base_devices"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "robot_operators" ADD CONSTRAINT "robot_operators_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "base_power_state" ADD CONSTRAINT "base_power_state_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "base_projects" ADD CONSTRAINT "base_projects_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "base_projects" ADD CONSTRAINT "base_projects_site_id_base_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."base_sites"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "base_project_steps" ADD CONSTRAINT "base_project_steps_project_id_base_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."base_projects"("id") ON DELETE restrict ON UPDATE cascade;
