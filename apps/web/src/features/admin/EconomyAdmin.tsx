import { useEffect, useState } from "react";
import type { EconomySnapshotDto, MoneyDto } from "@ai-mud/shared";
import { getEconomySnapshot } from "./adminApi";

function moneyText(money: MoneyDto) {
  return `${money.totalCopper} 铜`;
}

function transactionTypeText(type: EconomySnapshotDto["recentTransactions"][number]["transactionType"]) {
  return type === "buy" ? "购买" : "出售";
}

export function EconomyAdmin() {
  const [snapshot, setSnapshot] = useState<EconomySnapshotDto | null>(null);
  const [status, setStatus] = useState("正在读取经济数据...");

  useEffect(() => {
    let cancelled = false;

    void getEconomySnapshot()
      .then((nextSnapshot) => {
        if (cancelled) return;
        setSnapshot(nextSnapshot);
        setStatus("");
      })
      .catch(() => {
        if (!cancelled) setStatus("经济数据暂时无法打开。");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="admin-panel" aria-labelledby="economy-admin-title">
      <div className="admin-panel-header">
        <h2 id="economy-admin-title">经济监控</h2>
        <span>Economy Visibility</span>
      </div>

      {status ? (
        <p role="status" aria-live="polite" className="admin-status">
          {status}
        </p>
      ) : null}

      {snapshot ? (
        <div className="economy-admin-body">
          <div className="economy-summary" aria-label="税收汇总">
            <span>交易 {snapshot.taxSummary.transactionCount} 笔</span>
            <strong>税收合计 {snapshot.taxSummary.taxCopper} 铜</strong>
            <span>成交 {snapshot.taxSummary.grossCopper} 铜</span>
          </div>

          <div className="admin-table" role="table" aria-label="市政库存">
            <div className="admin-table-row admin-table-heading" role="row">
              <span role="columnheader">物品</span>
              <span role="columnheader">库存</span>
              <span role="columnheader">目标</span>
              <span role="columnheader">基础买价</span>
              <span role="columnheader">基础卖价</span>
            </div>
            {snapshot.marketItems.map((item) => (
              <div className="admin-table-row" role="row" key={item.itemId}>
                <span role="cell">{item.name}</span>
                <span role="cell">{item.stockQuantity}</span>
                <span role="cell">{item.targetQuantity}</span>
                <span role="cell">{moneyText(item.baseBuyPrice)}</span>
                <span role="cell">{moneyText(item.baseSellPrice)}</span>
              </div>
            ))}
          </div>

          <ol className="economy-ledger" aria-label="最近交易流水">
            {snapshot.recentTransactions.length === 0 ? <li>暂无交易流水</li> : null}
            {snapshot.recentTransactions.map((transaction) => (
              <li key={transaction.id}>
                <strong>
                  {transactionTypeText(transaction.transactionType)} {transaction.itemName} x
                  {transaction.quantity}
                </strong>
                <span>
                  税 {moneyText(transaction.tax)} · 净额 {moneyText(transaction.net)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
