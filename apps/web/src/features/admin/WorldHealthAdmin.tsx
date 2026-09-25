import { useEffect, useState } from "react";
import type {
  AiLayerStatusDto,
  AssetLedgerHealthDto,
  WorldRuntimeStatusDto
} from "@ai-mud/shared";
import {
  getAiLayerStatus,
  getAssetLedgerHealth,
  getWorldRuntimeStatus
} from "./adminApi";

interface WorldHealthSnapshot {
  runtime: WorldRuntimeStatusDto;
  ledger: AssetLedgerHealthDto;
  ai: AiLayerStatusDto;
}

function runtimeText(runtime: WorldRuntimeStatusDto) {
  if (!runtime.lastSettledAt) return "Tick 未启动";
  return runtime.leaseOwner ? `Tick 运行中：${runtime.leaseOwner}` : "Tick 正常";
}

function ledgerText(ledger: AssetLedgerHealthDto) {
  return ledger.status === "ok" ? "经济守恒" : `经济漂移 ${ledger.totalDrift.totalCopper} 铜`;
}

function aiBudgetText(ai: AiLayerStatusDto) {
  if (ai.budget.exhausted) return "AI 预算耗尽";
  if (ai.budget.remainingTokens24h === null) return "AI 预算不限";
  return `AI 余量 ${ai.budget.remainingTokens24h}`;
}

export function WorldHealthAdmin() {
  const [snapshot, setSnapshot] = useState<WorldHealthSnapshot | null>(null);
  const [status, setStatus] = useState("正在读取世界健康状态...");

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      getWorldRuntimeStatus(),
      getAssetLedgerHealth(),
      getAiLayerStatus()
    ])
      .then(([runtime, ledger, ai]) => {
        if (cancelled) return;
        setSnapshot({ runtime, ledger, ai });
        setStatus("");
      })
      .catch(() => {
        if (!cancelled) setStatus("世界健康状态暂时无法打开。");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="admin-panel" aria-labelledby="world-health-title">
      <div className="admin-panel-header">
        <h2 id="world-health-title">世界健康总览</h2>
        <span>Closed Beta Readiness</span>
      </div>

      {status ? (
        <p role="status" aria-live="polite" className="admin-status">
          {status}
        </p>
      ) : null}

      {snapshot ? (
        <div className="world-health-grid" aria-label="世界健康状态">
          <div>
            <span>世界 Tick</span>
            <strong>{runtimeText(snapshot.runtime)}</strong>
          </div>
          <div>
            <span>经济账本</span>
            <strong>{ledgerText(snapshot.ledger)}</strong>
          </div>
          <div>
            <span>AI 预算</span>
            <strong>{aiBudgetText(snapshot.ai)}</strong>
          </div>
        </div>
      ) : null}
    </section>
  );
}
