ALTER TABLE "characters" ADD COLUMN "revision" integer NOT NULL DEFAULT 1;

-- World epoch: bumped by world reset; stale-epoch client state is discarded.
ALTER TABLE "world_runtime_state" ADD COLUMN "world_epoch" integer NOT NULL DEFAULT 1;

-- Every existing character row starts a fresh revision lineage.
UPDATE "characters" SET "revision" = 1;
