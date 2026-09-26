-- R1 着陆重建（2026-09-26）：资源节点 / 勘探采矿单 / 现场货物 / 加工槽 四张新表；
-- robot_operators 施工/采矿互斥列；制造工单与产出扩展 landing 语义（旧行保持旧行为）；
-- base_power_state 增加 landing 电力参数与 W·min 定点余数。
-- 旧档兼容：全部新列带缺省或可空，历史行满足新增 CHECK（机器人旧行 extraction 均为 NULL；
-- 制造旧行 output_kind='robot' 且设备字段非空；energy_wm_per_batch 为 NULL 的旧单
-- current_batch_energy_wm 必须为 0——列缺省即 0）。
ALTER TABLE "robot_operators" ADD COLUMN "current_extraction_job_id" uuid;
--> statement-breakpoint
ALTER TABLE "robot_operators" ADD CONSTRAINT "robot_operators_assignment_exclusive_check"
  CHECK (("current_project_id" IS NULL) OR ("current_extraction_job_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "base_power_state" ADD COLUMN "emergency_generation_w" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "base_power_state" ADD COLUMN "charge_limit_w" integer;
--> statement-breakpoint
ALTER TABLE "base_power_state" ADD COLUMN "power_policy" text NOT NULL DEFAULT 'production';
--> statement-breakpoint
ALTER TABLE "base_power_state" ADD COLUMN "storage_excess_wm" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "base_power_state" ADD COLUMN "gen_remainder_wm" double precision NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "base_power_state" ADD CONSTRAINT "base_power_storage_excess_bounded_check"
  CHECK ("storage_excess_wm" >= 0 AND "storage_excess_wm" < 60);
--> statement-breakpoint
ALTER TABLE "base_power_state" ADD CONSTRAINT "base_power_policy_check"
  CHECK ("power_policy" IN ('production', 'charging'));
--> statement-breakpoint
ALTER TABLE "base_manufacturing_jobs" ADD COLUMN "production_site_id" uuid;
--> statement-breakpoint
ALTER TABLE "base_manufacturing_jobs" ADD COLUMN "energy_wm_per_batch" integer;
--> statement-breakpoint
ALTER TABLE "base_manufacturing_jobs" ADD COLUMN "current_batch_energy_wm" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "base_manufacturing_jobs" ADD CONSTRAINT "base_manufacturing_jobs_batch_energy_check"
  CHECK (("energy_wm_per_batch" IS NULL AND "current_batch_energy_wm" = 0) OR
         ("energy_wm_per_batch" IS NOT NULL AND "current_batch_energy_wm" >= 0 AND
          "current_batch_energy_wm" <= "energy_wm_per_batch"));
--> statement-breakpoint
ALTER TABLE "base_manufacturing_jobs" ADD CONSTRAINT "base_manufacturing_jobs_production_site_fkey"
  FOREIGN KEY ("production_site_id") REFERENCES "base_sites"("id");
--> statement-breakpoint
ALTER TABLE "base_manufacturing_outputs" ALTER COLUMN "device_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "base_manufacturing_outputs" ALTER COLUMN "operator_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "base_manufacturing_outputs" ADD COLUMN "output_kind" text NOT NULL DEFAULT 'robot';
--> statement-breakpoint
ALTER TABLE "base_manufacturing_outputs" ADD COLUMN "item_id" text;
--> statement-breakpoint
ALTER TABLE "base_manufacturing_outputs" ADD COLUMN "quantity" integer;
--> statement-breakpoint
ALTER TABLE "base_manufacturing_outputs" ADD CONSTRAINT "base_manufacturing_outputs_kind_check"
  CHECK (("output_kind" = 'robot' AND "device_id" IS NOT NULL AND "operator_id" IS NOT NULL AND
          "item_id" IS NULL AND "quantity" IS NULL) OR
         ("output_kind" = 'item' AND "device_id" IS NULL AND "operator_id" IS NULL AND
          "item_id" IS NOT NULL AND "quantity" IS NOT NULL));
--> statement-breakpoint
CREATE TABLE "base_resource_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "base_id" uuid NOT NULL REFERENCES "bases"("id"),
  "node_key" text NOT NULL,
  "name" text NOT NULL,
  "item_id" text NOT NULL,
  "discovered" boolean NOT NULL DEFAULT false,
  "remaining_quantity" integer NOT NULL,
  "reserved_quantity" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "base_resource_nodes_base_node_idx" ON "base_resource_nodes" ("base_id","node_key");
--> statement-breakpoint
ALTER TABLE "base_resource_nodes" ADD CONSTRAINT "base_resource_nodes_quantity_bounded_check"
  CHECK ("remaining_quantity" >= 0 AND "reserved_quantity" >= 0 AND
         "reserved_quantity" <= "remaining_quantity");
--> statement-breakpoint
CREATE TABLE "base_extraction_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "base_id" uuid NOT NULL REFERENCES "bases"("id"),
  "node_id" uuid NOT NULL REFERENCES "base_resource_nodes"("id"),
  "kind" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "batches_planned" integer NOT NULL DEFAULT 1,
  "batches_extracted" integer NOT NULL DEFAULT 0,
  "batches_delivered" integer NOT NULL DEFAULT 0,
  "phase" text,
  "phase_work_done" integer NOT NULL DEFAULT 0,
  "builder_operator_ids" jsonb NOT NULL DEFAULT '[]',
  "hauler_operator_id" uuid,
  "surveyor_operator_id" uuid,
  "blocked_reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "base_extraction_jobs_base_status_idx" ON "base_extraction_jobs" ("base_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "base_extraction_jobs_one_active_per_node_idx" ON "base_extraction_jobs" ("node_id")
  WHERE "status" IN ('active', 'paused', 'stopping');
--> statement-breakpoint
ALTER TABLE "base_extraction_jobs" ADD CONSTRAINT "base_extraction_jobs_kind_check"
  CHECK ("kind" IN ('survey', 'mine'));
--> statement-breakpoint
ALTER TABLE "base_extraction_jobs" ADD CONSTRAINT "base_extraction_jobs_status_check"
  CHECK ("status" IN ('active', 'paused', 'stopping', 'completed', 'cancelled'));
--> statement-breakpoint
ALTER TABLE "base_extraction_jobs" ADD CONSTRAINT "base_extraction_jobs_phase_check"
  CHECK (("kind" = 'survey' AND "phase" IS NULL) OR
         ("kind" = 'mine' AND "phase" IN ('mining', 'hauling')));
--> statement-breakpoint
ALTER TABLE "base_extraction_jobs" ADD CONSTRAINT "base_extraction_jobs_batches_bounded_check"
  CHECK ("batches_planned" >= 1 AND "batches_planned" <= 10 AND
         "batches_extracted" >= 0 AND "batches_extracted" <= "batches_planned" AND
         "batches_delivered" >= 0 AND "batches_delivered" <= "batches_extracted");
--> statement-breakpoint
ALTER TABLE "base_extraction_jobs" ADD CONSTRAINT "base_extraction_jobs_operator_shape_check"
  CHECK (("kind" = 'survey' AND "surveyor_operator_id" IS NOT NULL AND "hauler_operator_id" IS NULL) OR
         ("kind" = 'mine' AND "surveyor_operator_id" IS NULL AND "hauler_operator_id" IS NOT NULL AND
          jsonb_array_length("builder_operator_ids") BETWEEN 1 AND 2));
--> statement-breakpoint
CREATE TABLE "base_extraction_outputs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL REFERENCES "base_extraction_jobs"("id"),
  "ordinal" integer NOT NULL,
  "item_id" text NOT NULL,
  "quantity" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'extracted',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "base_extraction_outputs_job_ordinal_idx" ON "base_extraction_outputs" ("job_id","ordinal");
--> statement-breakpoint
ALTER TABLE "base_extraction_outputs" ADD CONSTRAINT "base_extraction_outputs_status_check"
  CHECK ("status" IN ('extracted', 'delivered'));
--> statement-breakpoint
ALTER TABLE "base_extraction_outputs" ADD CONSTRAINT "base_extraction_outputs_quantity_positive_check"
  CHECK ("quantity" > 0);
--> statement-breakpoint
CREATE TABLE "base_production_slots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "base_id" uuid NOT NULL REFERENCES "bases"("id"),
  "site_id" uuid NOT NULL REFERENCES "base_sites"("id"),
  "slot_index" integer NOT NULL DEFAULT 0,
  "batches_since_maintenance" integer NOT NULL DEFAULT 0,
  "maintenance_blocked" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "base_production_slots_base_site_slot_idx" ON "base_production_slots" ("base_id","site_id","slot_index");
--> statement-breakpoint
ALTER TABLE "base_production_slots" ADD CONSTRAINT "base_production_slots_batches_bounded_check"
  CHECK ("batches_since_maintenance" >= 0 AND "batches_since_maintenance" <= 10);
