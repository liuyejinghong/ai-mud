ALTER TABLE public.world_resource_nodes
  ADD COLUMN IF NOT EXISTS last_refreshed_at timestamp with time zone NOT NULL DEFAULT now();

ALTER TABLE public.map_instances
  ADD COLUMN IF NOT EXISTS resources_refreshed_at timestamp with time zone NOT NULL DEFAULT now();
