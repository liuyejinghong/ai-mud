import type { EquipmentItemDto } from "@ai-mud/shared";

export interface EquipmentPanelProps {
  equipment: readonly EquipmentItemDto[];
  onSelectEquipment: (item: EquipmentItemDto) => void;
  canRepair?: boolean;
  onRepairAll?: () => void | Promise<void>;
}

const equipmentSlots = ["weapon", "chest", "head", "accessory"] as const;

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

export function EquipmentPanel({
  equipment,
  onSelectEquipment,
  canRepair = false,
  onRepairAll
}: EquipmentPanelProps) {
  return (
    <section className="game-panel">
      <div className="panel-heading">
        <h2>装备</h2>
        <span>{equipment.length} 件</span>
      </div>
      <div className="equipment-slot-list" aria-label="已装备槽位">
        {equipmentSlots.map((slot) => {
          const item = equipment.find((candidate) => candidate.slot === slot);
          const slotLabel = slotLabels[slot];

          if (!item) {
            return (
              <button
                type="button"
                className="equipment-slot"
                key={slot}
                aria-label={`${slotLabel} 空槽`}
                disabled
              >
                <span className="equipment-slot-label">{slotLabel}</span>
                <strong>空</strong>
              </button>
            );
          }

          return (
            <button
              type="button"
              className={`equipment-slot rarity-${item.rarity}`}
              key={slot}
              aria-label={`${slotLabel} ${item.name} ${rarityLabels[item.rarity]} 耐久 ${item.durabilityPct}%`}
              onClick={() => onSelectEquipment(item)}
            >
              <span className="equipment-slot-label">{slotLabel}</span>
              <strong>{item.name}</strong>
              <span className="equipment-slot-meta">
                {rarityLabels[item.rarity]} · 耐久 {item.durabilityPct}%
              </span>
            </button>
          );
        })}
      </div>
      {onRepairAll ? (
        <button
          type="button"
          className="game-secondary-button repair-all-button"
          disabled={!canRepair}
          onClick={() => void onRepairAll()}
        >
          修理全部装备
        </button>
      ) : null}
    </section>
  );
}
