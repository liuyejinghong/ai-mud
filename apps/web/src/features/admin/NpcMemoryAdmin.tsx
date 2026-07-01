import { useEffect, useState } from "react";
import { getNpcMemory, type NpcMemoryResponse } from "./adminApi";
import "./ActivationCodeAdmin.css";

function timeText(value: string) {
  return value.slice(0, 16).replace("T", " ");
}

function evidenceText(value: "dialogue_claim" | "system_verified") {
  return value === "system_verified" ? "系统事实" : "对话声称";
}

export function NpcMemoryAdmin({ initialSnapshot }: { initialSnapshot?: NpcMemoryResponse }) {
  const [snapshot, setSnapshot] = useState<NpcMemoryResponse | null>(initialSnapshot ?? null);
  const [status, setStatus] = useState(initialSnapshot ? "" : "正在读取 NPC 记忆...");

  useEffect(() => {
    if (initialSnapshot) return;
    let cancelled = false;

    void getNpcMemory()
      .then((nextSnapshot) => {
        if (cancelled) return;
        setSnapshot(nextSnapshot);
        setStatus("");
      })
      .catch(() => {
        if (!cancelled) setStatus("NPC 记忆暂时无法打开。");
      });

    return () => {
      cancelled = true;
    };
  }, [initialSnapshot]);

  return (
    <section className="admin-panel" aria-labelledby="npc-memory-admin-title">
      <div className="admin-panel-header">
        <h2 id="npc-memory-admin-title">NPC 记忆</h2>
        <span>Memory Audit</span>
      </div>

      {status ? (
        <p role="status" aria-live="polite" className="admin-status">
          {status}
        </p>
      ) : null}

      {snapshot ? (
        <div className="ai-call-admin-body">
          <div className="economy-summary">
            <strong>
              短期 {snapshot.entries.length} 条 · 碎片 {snapshot.fragments.length} 条
            </strong>
            <span>生成时间 {timeText(snapshot.generatedAt)}</span>
          </div>

          <h3>短期记忆</h3>
          <div className="admin-table ai-call-table" role="table" aria-label="NPC 短期记忆">
            <div className="admin-table-row ai-call-table-row admin-table-heading" role="row">
              <span role="columnheader">时间</span>
              <span role="columnheader">证据</span>
              <span role="columnheader">NPC</span>
              <span role="columnheader">角色</span>
              <span role="columnheader">类型</span>
              <span role="columnheader">摘要</span>
              <span role="columnheader">压缩</span>
            </div>
            {snapshot.entries.length === 0 ? (
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
            {snapshot.entries.map((entry) => (
              <div className="admin-table-row ai-call-table-row" role="row" key={entry.id}>
                <span role="cell">{timeText(entry.occurredAt)}</span>
                <span role="cell">{evidenceText(entry.evidenceLevel)}</span>
                <span role="cell">{entry.npcActorId}</span>
                <span role="cell">{entry.characterId ?? "世界"}</span>
                <span role="cell">
                  {entry.memoryKind} · {entry.importance}
                </span>
                <span role="cell">{entry.summary}</span>
                <span role="cell">{entry.compressedAt ? timeText(entry.compressedAt) : "未压缩"}</span>
              </div>
            ))}
          </div>

          <h3>记忆碎片</h3>
          <div className="admin-table ai-call-table" role="table" aria-label="NPC 记忆碎片">
            <div className="admin-table-row ai-call-table-row admin-table-heading" role="row">
              <span role="columnheader">时间</span>
              <span role="columnheader">证据</span>
              <span role="columnheader">NPC</span>
              <span role="columnheader">角色</span>
              <span role="columnheader">类型</span>
              <span role="columnheader">摘要</span>
              <span role="columnheader">层级</span>
            </div>
            {snapshot.fragments.length === 0 ? (
              <div className="admin-table-row ai-call-table-row" role="row">
                <span role="cell">暂无碎片</span>
                <span role="cell" />
                <span role="cell" />
                <span role="cell" />
                <span role="cell" />
                <span role="cell" />
                <span role="cell" />
              </div>
            ) : null}
            {snapshot.fragments.map((fragment) => (
              <div className="admin-table-row ai-call-table-row" role="row" key={fragment.id}>
                <span role="cell">{timeText(fragment.lastOccurredAt)}</span>
                <span role="cell">{evidenceText(fragment.evidenceLevel)}</span>
                <span role="cell">{fragment.npcActorId}</span>
                <span role="cell">{fragment.characterId ?? "世界"}</span>
                <span role="cell">
                  {fragment.memoryKind} · {fragment.importance}
                </span>
                <span role="cell">{fragment.summary}</span>
                <span role="cell">L{fragment.compressionLevel}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
