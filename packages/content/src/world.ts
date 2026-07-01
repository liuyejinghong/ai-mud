import type { GameLocationId, GridPositionDto, ItemId } from "@ai-mud/shared";

export interface ItemDefinition {
  id: ItemId;
  name: string;
  category: "food" | "material";
  itemLevel: number;
}

export interface ResourceDefinition {
  id: string;
  name: string;
  position: GridPositionDto;
  charges: number;
  gatherResult: { itemId: ItemId; quantity: number };
}

export interface ZoneDefinition {
  id: GameLocationId;
  title: string;
  description: string;
  width: number;
  height: number;
  entry: GridPositionDto;
  exits: Array<{ id: string; position: GridPositionDto; toLocation: GameLocationId }>;
  resources: ResourceDefinition[];
}

export const FIRST_ITEMS: ItemDefinition[] = [
  { id: "wild_berry", name: "野莓", category: "food", itemLevel: 1 },
  { id: "beast_meat", name: "兽肉", category: "food", itemLevel: 1 },
  { id: "rough_hide", name: "粗糙皮革", category: "material", itemLevel: 1 }
];

export const BLACKPINE_OUTPOST = {
  id: "blackpine_outpost" as const,
  title: "黑松哨站",
  description: "潮湿黑松围住木墙，哨塔上的火盆把灰雾照成暗红色。"
};

export const CORRUPT_FOREST: ZoneDefinition = {
  id: "corrupt_forest",
  title: "腐林",
  description: "腐烂树根盘住泥地，林间偶尔传来野兽拖拽物体的声音。",
  width: 5,
  height: 5,
  entry: { x: 2, y: 4 },
  exits: [{ id: "south_gate", position: { x: 2, y: 4 }, toLocation: "blackpine_outpost" }],
  resources: [
    {
      id: "forest_berry_patch_01",
      name: "野莓灌木",
      position: { x: 1, y: 3 },
      charges: 3,
      gatherResult: { itemId: "wild_berry", quantity: 2 }
    },
    {
      id: "fallen_carcass_01",
      name: "被撕裂的兽尸",
      position: { x: 3, y: 2 },
      charges: 2,
      gatherResult: { itemId: "beast_meat", quantity: 1 }
    },
    {
      id: "discarded_hide_01",
      name: "粗糙兽皮",
      position: { x: 4, y: 1 },
      charges: 1,
      gatherResult: { itemId: "rough_hide", quantity: 1 }
    }
  ]
};

export function getResourceById(resourceId: string) {
  return CORRUPT_FOREST.resources.find((resource) => resource.id === resourceId) ?? null;
}

export function getItemById(itemId: ItemId) {
  return FIRST_ITEMS.find((item) => item.id === itemId) ?? null;
}
