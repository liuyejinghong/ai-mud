import type { ItemId } from "@ai-mud/shared";

export interface InventoryStack {
  itemId: ItemId;
  quantity: number;
}

export function addInventoryItem(
  inventory: InventoryStack[],
  itemId: ItemId,
  quantity: number
): InventoryStack[] {
  const existing = inventory.find((item) => item.itemId === itemId);

  if (!existing) {
    return [...inventory, { itemId, quantity }];
  }

  return inventory.map((item) =>
    item.itemId === itemId ? { ...item, quantity: item.quantity + quantity } : item
  );
}
