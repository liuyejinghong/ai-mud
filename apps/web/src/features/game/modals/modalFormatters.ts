import type { EquipmentItemDto, NpcDialogueTargetDto } from "@ai-mud/shared";

export const slotLabels: Record<EquipmentItemDto["slot"], string> = {
  weapon: "武器",
  chest: "胸甲",
  head: "头部",
  accessory: "饰品"
};

export const rarityLabels: Record<EquipmentItemDto["rarity"], string> = {
  common: "普通",
  uncommon: "优良",
  rare: "稀有",
  epic: "史诗"
};

export function moneyText(money: { gold: number; silver: number; copper: number }) {
  return `金币 ${money.gold} | 银币 ${money.silver} | 铜币 ${money.copper}`;
}

export function equipmentPower(item: EquipmentItemDto) {
  return item.attackBonus + item.defenseBonus + item.agilityBonus + item.maxHpBonus;
}

export function equipmentStatLine(item: EquipmentItemDto | null) {
  if (!item) return "无";
  const stats = [
    item.attackBonus ? `攻 +${item.attackBonus}` : null,
    item.defenseBonus ? `防 +${item.defenseBonus}` : null,
    item.agilityBonus ? `敏 +${item.agilityBonus}` : null,
    item.maxHpBonus ? `生命 +${item.maxHpBonus}` : null
  ].filter((entry): entry is string => entry !== null);
  return stats.length > 0 ? stats.join(" / ") : "无属性";
}

export function equipmentAffixLine(item: EquipmentItemDto) {
  return item.affixes.length > 0
    ? item.affixes.map((affix) => `${affix.name} +${affix.value}`).join(" / ")
    : "无词缀";
}

export function dialogueTaskHint(target: NpcDialogueTargetDto) {
  if (!target.task) return null;
  const status = {
    open: "可接取",
    accepted: "进行中",
    completed: "已完成",
    expired: "已过期"
  }[target.task.status];
  return `${status}：${target.task.title}`;
}
