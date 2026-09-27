-- D013 事件历史（2026-09-27）：基地事件流水表。结算点（工程完工/制造完工/
-- 采矿送达/订单交付）在各自事务内经 world/base-event 唯一写者追加；
-- 查询面 GET /api/base/events 按 (base_id, created_at) 降序读取。
CREATE TABLE "base_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "base_id" uuid NOT NULL REFERENCES "bases"("id"),
  "type" text NOT NULL,
  "title" text NOT NULL,
  "detail" text NOT NULL DEFAULT '',
  "sim_time" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "base_events_base_created_idx" ON "base_events" ("base_id", "created_at" DESC);
