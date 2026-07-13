DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.characters WHERE copper_balance < 0) THEN
    RAISE EXCEPTION 'Cannot add characters copper guard: negative copper_balance exists';
  END IF;

  IF EXISTS (SELECT 1 FROM public.world_actors WHERE copper_balance < 0) THEN
    RAISE EXCEPTION 'Cannot add world_actors copper guard: negative copper_balance exists';
  END IF;

  IF EXISTS (SELECT 1 FROM public.municipal_treasury WHERE copper_balance < 0) THEN
    RAISE EXCEPTION 'Cannot add municipal_treasury copper guard: negative copper_balance exists';
  END IF;

  IF EXISTS (SELECT 1 FROM public.market_inventory WHERE quantity < 0) THEN
    RAISE EXCEPTION 'Cannot add market_inventory quantity guard: negative quantity exists';
  END IF;

  IF EXISTS (SELECT 1 FROM public.character_items WHERE quantity < 0) THEN
    RAISE EXCEPTION 'Cannot add character_items quantity guard: negative quantity exists';
  END IF;

  IF EXISTS (SELECT 1 FROM public.npc_items WHERE quantity < 0) THEN
    RAISE EXCEPTION 'Cannot add npc_items quantity guard: negative quantity exists';
  END IF;

  IF EXISTS (SELECT 1 FROM public.world_resource_nodes WHERE charges < 0) THEN
    RAISE EXCEPTION 'Cannot add world_resource_nodes charges guard: negative charges exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.map_instances
    WHERE resource_charges @? '$.** ? (@.type() == "number" && @ < 0)'::jsonpath
  ) THEN
    RAISE EXCEPTION 'Cannot add map_instances resource guard: negative resource_charges value exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.character_actions
    WHERE status = 'active'
    GROUP BY character_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add active action uniqueness guard: duplicate active character_actions exist';
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE public.characters
ADD CONSTRAINT characters_copper_balance_nonnegative_check CHECK (copper_balance >= 0);
--> statement-breakpoint
ALTER TABLE public.world_actors
ADD CONSTRAINT world_actors_copper_balance_nonnegative_check CHECK (copper_balance >= 0);
--> statement-breakpoint
ALTER TABLE public.municipal_treasury
ADD CONSTRAINT municipal_treasury_copper_balance_nonnegative_check CHECK (copper_balance >= 0);
--> statement-breakpoint
ALTER TABLE public.market_inventory
ADD CONSTRAINT market_inventory_quantity_nonnegative_check CHECK (quantity >= 0);
--> statement-breakpoint
ALTER TABLE public.character_items
ADD CONSTRAINT character_items_quantity_nonnegative_check CHECK (quantity >= 0);
--> statement-breakpoint
ALTER TABLE public.npc_items
ADD CONSTRAINT npc_items_quantity_nonnegative_check CHECK (quantity >= 0);
--> statement-breakpoint
ALTER TABLE public.world_resource_nodes
ADD CONSTRAINT world_resource_nodes_charges_nonnegative_check CHECK (charges >= 0);
--> statement-breakpoint
ALTER TABLE public.map_instances
ADD CONSTRAINT map_instances_resource_charges_nonnegative_check
CHECK (NOT (resource_charges @? '$.** ? (@.type() == "number" && @ < 0)'::jsonpath));
--> statement-breakpoint
CREATE UNIQUE INDEX character_actions_one_active_per_character_idx
ON public.character_actions (character_id)
WHERE status = 'active';
