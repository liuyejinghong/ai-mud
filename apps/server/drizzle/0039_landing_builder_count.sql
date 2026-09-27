ALTER TABLE "base_projects" ADD COLUMN "builder_count" integer;
--> statement-breakpoint
ALTER TABLE "base_projects" ADD CONSTRAINT "base_projects_builder_count_check"
  CHECK ("builder_count" IS NULL OR "builder_count" IN (1, 2));
