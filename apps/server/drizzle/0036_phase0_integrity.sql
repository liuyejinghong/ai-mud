-- B005: distinguish request expiry from project/step lifecycle closure in durable facts.
ALTER TABLE "cooperation_requests" ADD COLUMN "resolution_reason" text;
--> statement-breakpoint
ALTER TABLE "cooperation_requests" ADD CONSTRAINT "cooperation_requests_resolution_reason_check"
  CHECK ("resolution_reason" IS NULL OR ("status" = 'expired' AND "resolution_reason" IN
    ('ttl_expired', 'project_cancelled', 'project_failed', 'step_failed', 'content_missing')));
--> statement-breakpoint
-- Keep fractional storm/clear dust changes across canonical one-minute settlements.
ALTER TABLE "base_power_state" ALTER COLUMN "dust_level" TYPE double precision
  USING "dust_level"::double precision;
