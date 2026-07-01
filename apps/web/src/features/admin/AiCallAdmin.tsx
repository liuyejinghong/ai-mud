import type { AiCallLogDto } from "@ai-mud/shared";
import { useEffect, useState } from "react";
import { getAiCallLogs, type AiCallLogResponse } from "./adminApi";
import "./ActivationCodeAdmin.css";

function timeText(value: string) {
  return value.slice(0, 16).replace("T", " ");
}

function statusText(status: AiCallLogDto["status"]) {
  const labels: Record<AiCallLogDto["status"], string> = {
    success: "成功",
    fallback: "回退",
    rejected: "拒绝",
    error: "错误"
  };
  return labels[status];
}

function tokenText(log: AiCallLogDto) {
  if (log.inputTokens === null && log.outputTokens === null) return "未记录";
  return `${log.inputTokens ?? 0}/${log.outputTokens ?? 0}`;
}

export function AiCallAdmin() {
  const [snapshot, setSnapshot] = useState<AiCallLogResponse | null>(null);
  const [status, setStatus] = useState("正在读取 AI 调用日志...");

  useEffect(() => {
    let cancelled = false;

    void getAiCallLogs()
      .then((nextSnapshot) => {
        if (cancelled) return;
        setSnapshot(nextSnapshot);
        setStatus("");
      })
      .catch(() => {
        if (!cancelled) setStatus("AI 调用日志暂时无法打开。");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="admin-panel" aria-labelledby="ai-call-admin-title">
      <div className="admin-panel-header">
        <h2 id="ai-call-admin-title">AI 调用日志</h2>
        <span>Dialogue Audit</span>
      </div>

      {status ? (
        <p role="status" aria-live="polite" className="admin-status">
          {status}
        </p>
      ) : null}

      {snapshot ? (
        <div className="ai-call-admin-body">
          <div className="economy-summary">
            <strong>最近 {snapshot.aiCalls.length} 次</strong>
            <span>生成时间 {timeText(snapshot.generatedAt)}</span>
          </div>

          <div className="admin-table ai-call-table" role="table" aria-label="AI 调用日志">
            <div className="admin-table-row ai-call-table-row admin-table-heading" role="row">
              <span role="columnheader">时间</span>
              <span role="columnheader">状态</span>
              <span role="columnheader">模型</span>
              <span role="columnheader">NPC</span>
              <span role="columnheader">输入</span>
              <span role="columnheader">输出</span>
              <span role="columnheader">消耗</span>
            </div>
            {snapshot.aiCalls.length === 0 ? (
              <div className="admin-table-row ai-call-table-row" role="row">
                <span role="cell">暂无记录</span>
                <span role="cell" />
                <span role="cell" />
                <span role="cell" />
                <span role="cell" />
                <span role="cell" />
                <span role="cell" />
              </div>
            ) : null}
            {snapshot.aiCalls.map((log) => (
              <div className="admin-table-row ai-call-table-row" role="row" key={log.id}>
                <span role="cell">{timeText(log.createdAt)}</span>
                <span role="cell" data-status={log.status}>
                  {statusText(log.status)}
                  {log.errorCode ? ` / ${log.errorCode}` : ""}
                </span>
                <span role="cell">
                  {log.provider}/{log.model}
                </span>
                <span role="cell">{log.npcActorId ?? "无"}</span>
                <span role="cell">{log.inputSummary}</span>
                <span role="cell">{log.outputSummary}</span>
                <span role="cell">
                  {tokenText(log)} · {log.latencyMs ?? 0}ms
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
