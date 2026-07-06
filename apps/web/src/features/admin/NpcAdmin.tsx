import { useEffect, useState } from "react";
import type { MoneyDto, NpcSimulationReportDto, WorldRuntimeStatusDto } from "@ai-mud/shared";
import {
  getNpcSnapshot,
  getWorldRuntimeStatus,
  runNpcSimulation,
  settleNpcWorld,
  type NpcSnapshotResponse
} from "./adminApi";

function moneyText(money: MoneyDto) {
  return `${money.totalCopper} 铜`;
}

function locationText(npc: NpcSnapshotResponse["npcs"][number]) {
  const location = npc.currentLocation === "corrupt_forest" ? "腐林" : "黑松哨站";
  return npc.position ? `${location} (${npc.position.x}, ${npc.position.y})` : location;
}

function inventoryText(npc: NpcSnapshotResponse["npcs"][number]) {
  const inventory = npc.inventory.filter((item) => item.quantity > 0);
  return inventory.length > 0
    ? inventory.map((item) => `${item.name} x${item.quantity}`).join("，")
    : "无库存";
}

function runtimeTimeText(value: string | null) {
  return value ? value.slice(0, 16).replace("T", " ") : "未开始";
}

function percentText(value: number) {
  return `${Math.round(value * 100)}%`;
}

function deltaText(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function NpcAdmin({ csrfToken }: { csrfToken: string }) {
  const [snapshot, setSnapshot] = useState<NpcSnapshotResponse | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<WorldRuntimeStatusDto | null>(null);
  const [simulation, setSimulation] = useState<NpcSimulationReportDto | null>(null);
  const [status, setStatus] = useState("正在读取 NPC 数据...");
  const [isMutating, setIsMutating] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([getNpcSnapshot(), getWorldRuntimeStatus()])
      .then(([nextSnapshot, nextRuntimeStatus]) => {
        if (cancelled) return;
        setSnapshot(nextSnapshot);
        setRuntimeStatus(nextRuntimeStatus);
        setStatus("");
      })
      .catch(() => {
        if (!cancelled) setStatus("NPC 数据暂时无法打开。");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function onSettle() {
    setIsMutating(true);
    setStatus("");
    try {
      const nextSnapshot = await settleNpcWorld(csrfToken);
      const nextRuntimeStatus = await getWorldRuntimeStatus();
      setSnapshot(nextSnapshot);
      setRuntimeStatus(nextRuntimeStatus);
      setStatus("NPC 世界已推进。");
    } catch {
      setStatus("NPC 世界推进失败。");
    } finally {
      setIsMutating(false);
    }
  }

  async function onSimulate(days: 1 | 3 | 7) {
    setIsMutating(true);
    setStatus("");
    try {
      setSimulation(await runNpcSimulation(csrfToken, days));
      setStatus(`${days} 天 NPC 仿真完成。`);
    } catch {
      setStatus("NPC 仿真失败。");
    } finally {
      setIsMutating(false);
    }
  }

  return (
    <section className="admin-panel" aria-labelledby="npc-admin-title">
      <div className="admin-panel-header">
        <h2 id="npc-admin-title">NPC 运行监控</h2>
        <span>Living NPC Visibility</span>
      </div>

      <div className="npc-admin-toolbar">
        {snapshot ? <strong>市政金库 {moneyText(snapshot.treasury)}</strong> : <span />}
        <div>
          <button type="button" disabled={isMutating} onClick={() => void onSettle()}>
            推进 NPC 世界
          </button>
          <button type="button" disabled={isMutating} onClick={() => void onSimulate(1)}>
            运行 1 天仿真
          </button>
          <button type="button" disabled={isMutating} onClick={() => void onSimulate(3)}>
            运行 3 天仿真
          </button>
          <button type="button" disabled={isMutating} onClick={() => void onSimulate(7)}>
            运行 7 天仿真
          </button>
        </div>
      </div>

      {runtimeStatus ? (
        <dl className="npc-runtime-status" aria-label="世界运行状态">
          <div>
            <dt>上次结算</dt>
            <dd>{runtimeTimeText(runtimeStatus.lastSettledAt)}</dd>
          </div>
          <div>
            <dt>下次 Tick</dt>
            <dd>{runtimeTimeText(runtimeStatus.nextTickAt)}</dd>
          </div>
          <div>
            <dt>租约状态</dt>
            <dd>{runtimeStatus.leaseOwner ? runtimeStatus.leaseOwner : "空闲"}</dd>
          </div>
        </dl>
      ) : null}

      {status ? (
        <p role="status" aria-live="polite" className="admin-status">
          {status}
        </p>
      ) : null}

      {snapshot ? (
        <div className="npc-admin-grid" aria-label="NPC 状态列表">
          {snapshot.npcs.map((npc) => (
            <article className="npc-admin-card" key={npc.id}>
              <div className="npc-admin-card-header">
                <h3>{npc.name}</h3>
                <span>{npc.profession}</span>
              </div>
              <dl>
                <div>
                  <dt>位置</dt>
                  <dd>{locationText(npc)}</dd>
                </div>
                <div>
                  <dt>行动</dt>
                  <dd>{npc.currentAction?.description ?? "空闲"}</dd>
                </div>
                <div>
                  <dt>饱腹</dt>
                  <dd>
                    {npc.hunger.current}/{npc.hunger.max}
                  </dd>
                </div>
                <div>
                  <dt>钱包</dt>
                  <dd>{moneyText(npc.money)}</dd>
                </div>
                <div>
                  <dt>库存</dt>
                  <dd>{inventoryText(npc)}</dd>
                </div>
              </dl>
              <ol className="npc-event-list" aria-label={`${npc.name} 最近事件`}>
                {npc.recentEvents.length === 0 ? <li>暂无事件</li> : null}
                {npc.recentEvents.map((event) => (
                  <li key={event.id}>{event.message}</li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      ) : null}

      {simulation ? (
        <div className="npc-simulation-result" aria-label="NPC 仿真结果">
          <strong>
            {simulation.days} 天仿真健康：{simulation.health.ok ? "正常" : "异常"}
          </strong>
          <span>
            行动 {simulation.actionCount} 次 · 空闲 {percentText(simulation.metrics.idleRate)}
          </span>
          <span>
            资源 {simulation.metrics.resourceStartCharges} →{" "}
            {simulation.metrics.resourceEndCharges}（{deltaText(simulation.metrics.resourceDelta)}）
          </span>
          <span>货币流速 {simulation.metrics.marketTransactionsPerDay.toFixed(1)} 笔/天</span>
          <span>行动触发 {simulation.metrics.taskTriggerRate.toFixed(2)} 次/NPC日</span>
          <span>
            饱腹 {simulation.metrics.hungerDistribution.fed} · 饥饿{" "}
            {simulation.metrics.hungerDistribution.hungry} · 濒危{" "}
            {simulation.metrics.hungerDistribution.starving}
          </span>
          {simulation.health.issues.length > 0 ? (
            <span>{simulation.health.issues.join("，")}</span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
