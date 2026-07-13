import type { EquipmentItemDto } from "@ai-mud/shared";
import { equipmentAffixLine, equipmentPower, equipmentStatLine, moneyText, rarityLabels, slotLabels } from "./modalFormatters";
import type { EquipmentModalProps } from "./modalTypes";

export function EquipmentModal({ context, item }: EquipmentModalProps) {
  const { state, commands, closeModal, canEquipEquipment, canRepairEquipment } = context;
  const current = state.equipment.find((candidate) => candidate.slot === item.slot) ?? null;
  const isBackpackEquipment = state.backpackEquipment.some((candidate) => candidate.id === item.id);
  const powerDelta = equipmentPower(item) - (current ? equipmentPower(current) : 0);

  return (
    <section
      className="equipment-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={`${item.name} ${isBackpackEquipment ? "装备对比" : "装备详情"}`}
    >
      <p className="game-kicker">{isBackpackEquipment ? "装备对比" : "装备详情"}</p>
      <div className="panel-heading"><h2>{item.name}</h2><span>{rarityLabels[item.rarity]}</span></div>
      <div className={`equipment-compare-grid${isBackpackEquipment ? "" : " is-detail"}`}>
        {isBackpackEquipment ? (
          <article className="equipment-compare-card">
            <p className="game-kicker">当前</p>
            <h3>{current?.name ?? "空槽位"}</h3>
            <dl className="stat-list">
              <div><dt>槽位</dt><dd>{slotLabels[item.slot]}</dd></div>
              <div><dt>属性</dt><dd>{equipmentStatLine(current)}</dd></div>
              <div><dt>词缀</dt><dd>{current ? equipmentAffixLine(current) : "无"}</dd></div>
            </dl>
          </article>
        ) : null}
        <article className={`equipment-compare-card rarity-${item.rarity}`}>
          <p className="game-kicker">{isBackpackEquipment ? "背包" : "已装备"}</p>
          <h3>{item.name}</h3>
          <dl className="stat-list">
            <div><dt>槽位</dt><dd>{slotLabels[item.slot]}</dd></div>
            <div><dt>属性</dt><dd>{equipmentStatLine(item)}</dd></div>
            <div><dt>词缀</dt><dd>{equipmentAffixLine(item)}</dd></div>
            <div><dt>耐久</dt><dd>{item.currentDurability}/{item.maxDurability}</dd></div>
            <div><dt>修理</dt><dd>{item.repairQuote ? `${moneyText(item.repairQuote.copperCost)} + 基础铁矿石 x${item.repairQuote.ironOreCost}` : "无需修理"}</dd></div>
          </dl>
        </article>
      </div>
      {isBackpackEquipment ? (
        <p className={powerDelta >= 0 ? "equipment-delta is-positive" : "equipment-delta is-negative"}>
          综合属性差异：{powerDelta >= 0 ? "+" : ""}{powerDelta}
        </p>
      ) : null}
      <div className="dialog-actions">
        {isBackpackEquipment ? (
          <button type="button" className="game-primary-button" disabled={!canEquipEquipment} onClick={() => void commands.equipBackpackEquipment(item.id, closeModal)}>装备</button>
        ) : (
          <button type="button" className="game-secondary-button" disabled={!canRepairEquipment || !item.repairQuote} onClick={() => void commands.repairEquipment(item.id)}>修理 {item.name}</button>
        )}
        <button type="button" className="game-secondary-button" onClick={closeModal}>关闭</button>
      </div>
    </section>
  );
}
