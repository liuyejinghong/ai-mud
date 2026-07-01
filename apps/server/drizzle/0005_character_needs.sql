ALTER TABLE "characters" ADD COLUMN "hunger" integer NOT NULL DEFAULT 5;
ALTER TABLE "characters" ADD COLUMN "last_hunger_settled_at" timestamp with time zone NOT NULL DEFAULT now();
