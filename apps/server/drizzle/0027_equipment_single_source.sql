INSERT INTO "item_instances" (
	"id", "item_def_id", "owner_type", "owner_id", "location_type", "slot",
	"rarity", "item_level", "base_stats", "affixes",
	"max_durability", "current_durability", "created_at", "updated_at"
)
SELECT
	e."id",
	e."item_key",
	'character',
	e."character_id",
	'equipped',
	e."slot",
	'common',
	e."item_level",
	jsonb_build_object('attack', e."attack_bonus", 'defense', e."defense_bonus", 'agility', 0, 'maxHp', 0),
	'[]'::jsonb,
	e."max_durability",
	e."current_durability",
	e."created_at",
	e."updated_at"
FROM "character_equipment" e
ON CONFLICT ("id") DO NOTHING;

DROP TABLE "character_equipment";
