CREATE TABLE "system_announcements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "admin_account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "body" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'info',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "system_announcements_severity_check" CHECK ("severity" IN ('info')),
  CONSTRAINT "system_announcements_body_length_check" CHECK (char_length("body") BETWEEN 1 AND 240)
);
--> statement-breakpoint
CREATE INDEX "system_announcements_created_at_idx" ON "system_announcements" ("created_at");
