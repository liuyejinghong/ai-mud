CREATE TABLE IF NOT EXISTS "world_runtime_state" (
  "key" text PRIMARY KEY NOT NULL,
  "last_settled_at" timestamp with time zone,
  "lease_owner" text,
  "lease_until" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "world_runtime_state_lease_until_idx"
  ON "world_runtime_state" ("lease_until");
