import { useEffect, useState } from "react";
import type { AssetLedgerHealthDto, MoneyDto } from "@ai-mud/shared";
import { getAssetLedgerHealth } from "./adminApi";

function moneyText(money: MoneyDto) {
  return `${money.totalCopper} 铜`;
}

function bucketLabel(bucket: AssetLedgerHealthDto["buckets"][number]["bucket"]) {
  const labels: Record<AssetLedgerHealthDto["buckets"][number]["bucket"], string> = {
    player: "玩家",
    npc: "NPC",
    municipal: "市政",
    escrow: "托管",
    system_source: "系统来源",
    system_sink: "系统回收"
  };
  return labels[bucket];
}

export function AssetLedgerHealthAdmin() {
  const [health, setHealth] = useState<AssetLedgerHealthDto | null>(null);
  const [status, setStatus] = useState("正在读取账本健康状态...");

  useEffect(() => {
    let cancelled = false;

    void getAssetLedgerHealth()
      .then((nextHealth) => {
        if (cancelled) return;
        setHealth(nextHealth);
        setStatus("");
      })
      .catch(() => {
        if (!cancelled) setStatus("账本健康状态暂时无法打开。");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="admin-panel" aria-labelledby="asset-ledger-health-title">
      <div className="admin-panel-header">
        <h2 id="asset-ledger-health-title">账本守恒</h2>
        <span>Asset Ledger</span>
      </div>

      {status ? (
        <p role="status" aria-live="polite" className="admin-status">
          {status}
        </p>
      ) : null}

      {health ? (
        <div className="economy-admin-body">
          <div className="economy-summary" aria-label="账本守恒汇总">
            <span>{health.status === "ok" ? "账目正常" : "发现漂移"}</span>
            <strong>漂移合计 {moneyText(health.totalDrift)}</strong>
            <span>{health.generatedAt}</span>
          </div>

          <div className="admin-table" role="table" aria-label="铜币桶守恒状态">
            <div className="admin-table-row admin-table-heading" role="row">
              <span role="columnheader">资产桶</span>
              <span role="columnheader">账本期望</span>
              <span role="columnheader">真实余额</span>
              <span role="columnheader">漂移</span>
            </div>
            {health.buckets.map((bucket) => (
              <div className="admin-table-row" role="row" key={bucket.bucket}>
                <span role="cell">{bucketLabel(bucket.bucket)}</span>
                <span role="cell">{moneyText(bucket.expectedCopper)}</span>
                <span role="cell">
                  {bucket.actualCopper ? moneyText(bucket.actualCopper) : "不适用"}
                </span>
                <span role="cell">
                  {bucket.driftCopper ? moneyText(bucket.driftCopper) : "不适用"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
