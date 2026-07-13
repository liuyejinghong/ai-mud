ALTER TABLE public.item_ledger
DROP CONSTRAINT item_ledger_from_owner_type_check;
--> statement-breakpoint
ALTER TABLE public.item_ledger
ADD CONSTRAINT item_ledger_from_owner_type_check
CHECK (from_owner_type IS NULL OR from_owner_type IN ('character', 'npc', 'market', 'system', 'system_source'));
