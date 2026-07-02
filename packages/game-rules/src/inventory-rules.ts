import type { ItemId } from "@ai-mud/shared";
import { addStackQuantity } from "./item-rules.js";

export interface InventoryStack {
  itemId: ItemId;
  quantity: number;
}

export function addInventoryItem(
  inventory: InventoryStack[],
  itemId: ItemId,
  quantity: number
): InventoryStack[] {
  return addStackQuantity(inventory, itemId, quantity);
}
