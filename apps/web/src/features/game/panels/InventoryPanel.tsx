import type { EquipmentItemDto, InventoryItemDto } from "@ai-mud/shared";

export interface InventoryPanelProps {
  items: readonly InventoryItemDto[];
  backpackEquipment: readonly EquipmentItemDto[];
  canEatFood: boolean;
  onSelectItem: (item: InventoryItemDto) => void;
  onSelectEquipment: (item: EquipmentItemDto) => void;
  onEatItem?: (item: InventoryItemDto) => void | Promise<void>;
}

const slotLabels: Record<EquipmentItemDto["slot"], string> = {
  weapon: "武器",
  chest: "胸甲",
  head: "头部",
  accessory: "饰品"
};

const rarityLabels: Record<EquipmentItemDto["rarity"], string> = {
  common: "普通",
  uncommon: "优良",
  rare: "稀有",
  epic: "史诗"
};

function isFoodItem(item: InventoryItemDto) {
  return item.itemId === "wild_berry" || item.itemId === "beast_meat";
}

export function InventoryPanel({
  items,
  backpackEquipment,
  canEatFood,
  onSelectItem,
  onSelectEquipment,
  onEatItem
}: InventoryPanelProps) {
  const itemTypeCount = items.length + backpackEquipment.length;

  return (
    <section className="game-panel">
      <div className="panel-heading">
        <h2>背包</h2>
        <span>{itemTypeCount} 类</span>
      </div>
      {itemTypeCount === 0 ? <p className="empty-copy">空</p> : null}
      {backpackEquipment.length > 0 ? (
        <div className="inventory-equipment-list" aria-label="背包装备">
          {backpackEquipment.map((item) => (
            <button
              type="button"
              className={`inventory-equipment rarity-${item.rarity}`}
              key={item.id}
              onClick={() => onSelectEquipment(item)}
            >
              <strong>{item.name}</strong>
              <span>
                {slotLabels[item.slot]} · {rarityLabels[item.rarity]} · 装等 {item.itemLevel}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="inventory-list">
        {items.map((item) => (
          <div className="inventory-item-row" key={item.itemId}>
            <button
              type="button"
              className="inventory-item"
              onClick={() => onSelectItem(item)}
            >
              {item.name} x{item.quantity}
            </button>
            {canEatFood && onEatItem && isFoodItem(item) ? (
              <button
                type="button"
                className="game-secondary-button eat-button"
                onClick={() => void onEatItem(item)}
              >
                食用 {item.name}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
