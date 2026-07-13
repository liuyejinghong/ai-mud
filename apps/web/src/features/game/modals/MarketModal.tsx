import { moneyText } from "./modalFormatters";
import type { GameModalContext } from "./modalTypes";

export function MarketModal({ context }: { context: GameModalContext }) {
  const { state, market, marketStatus, isBusy, commands, closeModal } = context;
  if (!market) return null;

  const availableCopper = state.character?.money.totalCopper ?? 0;
  const hasUnaffordablePurchase = market.items.some(
    (item) => item.buyPrice.totalCopper > availableCopper
  );

  return (
    <section className="market-dialog" role="dialog" aria-modal="true" aria-label="市政集市">
      <p className="game-kicker">市政集市</p>
      <div className="panel-heading"><h2>市政集市</h2><span>{market.items.length} 类</span></div>
      <div className="market-table" role="table" aria-label="市政集市库存">
        <div className="market-row market-row-heading" role="row">
          <span role="columnheader">物品</span><span role="columnheader">库存</span>
          <span role="columnheader">持有</span><span role="columnheader">买价</span>
          <span role="columnheader">卖价</span><span role="columnheader">操作</span>
        </div>
        {market.items.map((item) => {
          const canAffordPurchase = item.buyPrice.totalCopper <= availableCopper;
          return (
            <div className="market-row" role="row" key={item.itemId}>
              <span role="cell">{item.name}</span>
              <span role="cell">{item.stockQuantity}</span>
              <span role="cell">{item.playerQuantity}</span>
              <span role="cell">{moneyText(item.buyPrice)} + 税 {item.buyTax.totalCopper} 铜</span>
              <span role="cell">{moneyText(item.sellPrice)} - 税 {item.sellTax.totalCopper} 铜</span>
              <span role="cell" className="market-actions">
                <button
                  type="button"
                  className="game-secondary-button"
                  aria-describedby={canAffordPurchase ? undefined : "market-purchase-funds-hint"}
                  aria-label={canAffordPurchase ? undefined : `购买 ${item.name}，铜币不足`}
                  disabled={item.stockQuantity < 1 || !canAffordPurchase || isBusy}
                  onClick={() => void commands.buyMarketItem(item.itemId)}
                >购买 {item.name}</button>
                <button
                  type="button"
                  className="game-secondary-button"
                  disabled={item.playerQuantity < 1 || isBusy}
                  onClick={() => void commands.sellMarketItem(item.itemId)}
                >出售 {item.name}</button>
              </span>
            </div>
          );
        })}
      </div>
      {hasUnaffordablePurchase ? <p id="market-purchase-funds-hint" className="market-status">铜币不足的物品暂时不能购买。</p> : null}
      {marketStatus ? <p role="status" aria-live="polite" className="market-status">{marketStatus}</p> : null}
      <div className="dialog-actions"><button type="button" className="game-primary-button" onClick={closeModal}>关闭</button></div>
    </section>
  );
}
