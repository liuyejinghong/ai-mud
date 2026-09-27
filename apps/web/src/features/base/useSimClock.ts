// D011-low：运行态时钟本地插值。
// 快照 simTime 只在轮询/命令后到达（5s 一拍），运行态下本地按当前 speed 平滑走字，
// 快照到达即重新校准锚点。纯显示层插值：不写任何事实、不改变快照协议（合同明确允许）。
// 暂停/冻结（effectivelyRunning=false）时停针，显示快照时间本身。
import { useEffect, useState } from "react";

interface ClockAnchor {
  simMs: number;
  wallMs: number;
  speed: number;
}

const TICK_MS = 1_000;

export function useSimClock(simTime: string, speed: number, effectivelyRunning: boolean): Date {
  const [anchor, setAnchor] = useState<ClockAnchor>(() => ({
    simMs: Date.parse(simTime),
    wallMs: Date.now(),
    speed
  }));
  const [, setTick] = useState(0);

  // 校准点：快照时间/倍速变化，或运行↔停针切换（暂停很久后恢复不能把停针期补算进显示）。
  useEffect(() => {
    setAnchor({ simMs: Date.parse(simTime), wallMs: Date.now(), speed });
  }, [simTime, speed, effectivelyRunning]);

  useEffect(() => {
    if (!effectivelyRunning) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => window.clearInterval(timer);
  }, [effectivelyRunning]);

  if (!effectivelyRunning) return new Date(anchor.simMs);
  const elapsedWallMs = Math.max(0, Date.now() - anchor.wallMs);
  return new Date(anchor.simMs + elapsedWallMs * anchor.speed);
}

// simTime 的 UTC 小时即基地昼夜基准（与结算规则一致）；接受插值后的 Date。
export function formatSimClock(date: Date): string {
  if (Number.isNaN(date.getTime())) return "--:--";
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const phase = date.getUTCHours() >= 6 && date.getUTCHours() < 18 ? "昼间" : "夜间";
  return `${hh}:${mm} · ${phase}`;
}
