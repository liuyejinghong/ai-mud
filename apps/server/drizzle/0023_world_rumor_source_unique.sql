DELETE FROM public.world_rumors AS duplicate
USING public.world_rumors AS keeper
WHERE duplicate.source_id IS NOT NULL
  AND duplicate.source_type = keeper.source_type
  AND duplicate.source_id = keeper.source_id
  AND (duplicate.created_at, duplicate.id) > (keeper.created_at, keeper.id);
--> statement-breakpoint
CREATE UNIQUE INDEX world_rumors_source_unique
ON public.world_rumors (source_type, source_id)
WHERE source_id IS NOT NULL;
