import type { AiLayerStatusDto, AiPurposeStatusDto } from "@ai-mud/shared";
import { useEffect, useState } from "react";
import { getAiLayerStatus } from "./adminApi";
import "./ActivationCodeAdmin.css";

function modelText(snapshot: AiLayerStatusDto) {
  return `${snapshot.providerName}/${snapshot.model ?? "未启用"}`;
}

function statusText(status: AiPurposeStatusDto["latestStatus"]) {
  if (status === null) return "无";
  const labels: Record<NonNullable<AiPurposeStatusDto["latestStatus"]>, string> = {
    success: "成功",
    fallback: "回退",
    rejected: "拒绝",
    error: "错误",
    disabled: "跳过"
  };
  return labels[status];
}

function callsText(purpose: AiPurposeStatusDto) {
  return [
    purpose.successCount24h,
    purpose.fallbackCount24h,
    purpose.rejectedCount24h,
    purpose.errorCount24h,
    purpose.disabledCount24h
  ].join("/");
}

function tokenText(purpose: AiPurposeStatusDto) {
  return `${purpose.totalInputTokens24h}/${purpose.totalOutputTokens24h}`;
}

function budgetText(snapshot: AiLayerStatusDto) {
  const limit =
    snapshot.budget.dailyTokenBudget === null ? "不限" : String(snapshot.budget.dailyTokenBudget);
  const remaining =
    snapshot.budget.remainingTokens24h === null ? "不限" : String(snapshot.budget.remainingTokens24h);
  return `预算 ${snapshot.budget.usedTokens24h}/${limit}，剩余 ${remaining}，回退 ${snapshot.budget.fallbackCount24h}`;
}

export function AiLayerStatusAdmin() {
  const [snapshot, setSnapshot] = useState<AiLayerStatusDto | null>(null);
  const [status, setStatus] = useState("正在读取 AI 状态...");

  useEffect(() => {
    let cancelled = false;

    void getAiLayerStatus()
      .then((nextSnapshot) => {
        if (cancelled) return;
        setSnapshot(nextSnapshot);
        setStatus("");
      })
      .catch(() => {
        if (!cancelled) setStatus("AI 状态暂时无法打开。");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="admin-panel" aria-labelledby="ai-layer-status-title">
      <div className="admin-panel-header">
        <h2 id="ai-layer-status-title">AI 状态</h2>
        <span>Layer Governance</span>
      </div>

      {status ? (
        <p role="status" aria-live="polite" className="admin-status">
          {status}
        </p>
      ) : null}

      {snapshot ? (
        <div className="ai-layer-admin-body">
          <div className="economy-summary">
            <strong>{snapshot.providerEnabled ? "AI 已启用" : "AI 未启用"}</strong>
            <span>{modelText(snapshot)}</span>
            <span>Prompt v{snapshot.promptVersion}</span>
            <span>{budgetText(snapshot)}</span>
            {snapshot.budget.latestFailureReason ? (
              <span>最近失败：{snapshot.budget.latestFailureReason}</span>
            ) : null}
          </div>

          <div className="admin-table ai-layer-table" role="table" aria-label="AI 状态">
            <div className="admin-table-row ai-layer-table-row admin-table-heading" role="row">
              <span role="columnheader">Purpose</span>
              <span role="columnheader">权限</span>
              <span role="columnheader">冷却</span>
              <span role="columnheader">24h</span>
              <span role="columnheader">状态</span>
              <span role="columnheader">Token</span>
              <span role="columnheader">延迟</span>
              <span role="columnheader">改世界</span>
            </div>
            {snapshot.purposes.map((purpose) => (
              <div className="admin-table-row ai-layer-table-row" role="row" key={purpose.purpose}>
                <span role="cell">{purpose.purpose}</span>
                <span role="cell">{purpose.authorityClass}</span>
                <span role="cell">{purpose.cooldownMs}ms</span>
                <span role="cell">{callsText(purpose)}</span>
                <span role="cell" data-status={purpose.latestStatus ?? "none"}>
                  {statusText(purpose.latestStatus)}
                </span>
                <span role="cell">{tokenText(purpose)}</span>
                <span role="cell">
                  {purpose.averageLatencyMs24h === null
                    ? "无"
                    : `${purpose.averageLatencyMs24h}ms`}
                </span>
                <span role="cell">{purpose.mutatesWorldState ? "允许" : "禁止"}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
