ALTER TABLE "npc_tasks"
ADD COLUMN "proposal_source" text NOT NULL DEFAULT 'template';

ALTER TABLE "npc_tasks"
ADD COLUMN "proposal_reason" text;
