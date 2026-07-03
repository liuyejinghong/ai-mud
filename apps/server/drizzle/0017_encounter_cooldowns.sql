ALTER TABLE "map_instances" ADD COLUMN "encounter_cooldowns" jsonb DEFAULT '{}'::jsonb NOT NULL;
