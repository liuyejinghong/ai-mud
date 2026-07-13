import type { InventoryItemDto } from "@ai-mud/shared";

export function ItemModal({ item, closeModal }: { item: InventoryItemDto; closeModal: () => void }) {
  return (
    <section className="item-dialog" role="dialog" aria-modal="true" aria-label={item.name}>
      <p className="game-kicker">物品详情</p>
      <h2>{item.name}</h2>
      <dl className="stat-list">
        <div><dt>数量</dt><dd>{item.quantity}</dd></div>
        <div><dt>物品 ID</dt><dd>{item.itemId}</dd></div>
      </dl>
      <div className="dialog-actions">
        <button type="button" className="game-secondary-button" disabled>使用</button>
        <button type="button" className="game-primary-button" onClick={closeModal}>关闭</button>
      </div>
    </section>
  );
}
