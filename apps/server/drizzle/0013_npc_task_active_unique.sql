CREATE UNIQUE INDEX IF NOT EXISTS npc_tasks_one_active_per_npc_idx
ON public.npc_tasks (npc_actor_id)
WHERE status IN ('open', 'accepted');
