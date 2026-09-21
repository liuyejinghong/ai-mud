-- v0.14 Jev 协作：决策审计记录 + 跨组协作请求。
CREATE TABLE "decision_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" text NOT NULL,
	"purpose" text NOT NULL,
	"mode" text NOT NULL,
	"provider" text NOT NULL,
	"base_id" uuid,
	"plan_revision" integer NOT NULL,
	"question" text NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_candidate_id" text,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_records_decision_id_unique" UNIQUE("decision_id"),
	CONSTRAINT "decision_records_mode_check" CHECK ("decision_records"."mode" IN ('rule', 'shadow', 'live')),
	CONSTRAINT "decision_records_purpose_check" CHECK ("decision_records"."purpose" IN ('transport_assistance', 'work_assignment'))
);
--> statement-breakpoint
CREATE TABLE "cooperation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"from_group_id" text NOT NULL,
	"helper_group_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"helper_operator_id" uuid,
	"decision_id" text,
	"question" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "cooperation_requests_status_check" CHECK ("cooperation_requests"."status" IN ('pending', 'accepted', 'declined', 'expired', 'fulfilled'))
);
--> statement-breakpoint
CREATE INDEX "decision_records_purpose_idx" ON "decision_records" ("purpose","created_at");
--> statement-breakpoint
CREATE INDEX "cooperation_requests_base_status_idx" ON "cooperation_requests" ("base_id","status");
--> statement-breakpoint
CREATE INDEX "cooperation_requests_base_project_idx" ON "cooperation_requests" ("base_id");
--> statement-breakpoint
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "cooperation_requests" ADD CONSTRAINT "cooperation_requests_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "cooperation_requests" ADD CONSTRAINT "cooperation_requests_project_id_base_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."base_projects"("id") ON DELETE restrict ON UPDATE cascade;
