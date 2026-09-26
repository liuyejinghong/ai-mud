-- New bases receive a finite tutorial budget; existing balances are unchanged.
ALTER TABLE "bases" ALTER COLUMN "credits" SET DEFAULT 1200;
--> statement-breakpoint
ALTER TABLE "cooperation_requests" DROP CONSTRAINT "cooperation_requests_resolution_reason_check";
--> statement-breakpoint
ALTER TABLE "cooperation_requests" ADD CONSTRAINT "cooperation_requests_resolution_reason_check"
  CHECK ("resolution_reason" IS NULL OR ("status" = 'expired' AND "resolution_reason" IN
    ('ttl_expired', 'project_cancelled', 'project_failed', 'step_failed', 'content_missing', 'no_longer_needed')));
