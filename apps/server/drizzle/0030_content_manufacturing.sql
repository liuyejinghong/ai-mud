-- v0.13 内容工坊与制造：draft/release/制造工单/逐台产出。
CREATE TYPE "public"."content_draft_status" AS ENUM('draft', 'published');
--> statement-breakpoint
CREATE TABLE "content_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"stable_id" text NOT NULL,
	"revision" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "content_draft_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_drafts_kind_stable_rev_idx" UNIQUE("kind","stable_id","revision"),
	CONSTRAINT "content_drafts_kind_check" CHECK ("content_drafts"."kind" IN ('robot_template', 'project', 'recipe')),
	CONSTRAINT "content_drafts_revision_positive_check" CHECK ("content_drafts"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "content_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"definition_count" integer NOT NULL,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_releases_release_id_unique" UNIQUE("release_id")
);
--> statement-breakpoint
CREATE TABLE "base_manufacturing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_id" uuid NOT NULL,
	"recipe_def_id" text NOT NULL,
	"recipe_revision" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"outputs_planned" integer NOT NULL,
	"outputs_done" integer DEFAULT 0 NOT NULL,
	"current_unit_work_done" integer DEFAULT 0 NOT NULL,
	"reserved_inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "base_manufacturing_jobs_status_check" CHECK ("base_manufacturing_jobs"."status" IN ('active', 'paused', 'blocked', 'completed', 'cancelled')),
	CONSTRAINT "base_manufacturing_jobs_planned_bounded_check" CHECK ("base_manufacturing_jobs"."outputs_planned" >= 1 AND "base_manufacturing_jobs"."outputs_planned" <= 20),
	CONSTRAINT "base_manufacturing_jobs_outputs_bounded_check" CHECK ("base_manufacturing_jobs"."outputs_done" >= 0 AND "base_manufacturing_jobs"."outputs_done" <= "base_manufacturing_jobs"."outputs_planned")
);
--> statement-breakpoint
CREATE TABLE "base_manufacturing_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"device_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "base_manufacturing_outputs_job_ordinal_idx" UNIQUE("job_id","ordinal")
);
--> statement-breakpoint
ALTER TABLE "content_releases" ADD CONSTRAINT "content_releases_published_by_accounts_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "base_manufacturing_jobs" ADD CONSTRAINT "base_manufacturing_jobs_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "base_manufacturing_outputs" ADD CONSTRAINT "base_manufacturing_outputs_job_id_base_manufacturing_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."base_manufacturing_jobs"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "base_manufacturing_outputs" ADD CONSTRAINT "base_manufacturing_outputs_device_id_base_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."base_devices"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "base_manufacturing_outputs" ADD CONSTRAINT "base_manufacturing_outputs_operator_id_robot_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."robot_operators"("id") ON DELETE restrict ON UPDATE cascade;
