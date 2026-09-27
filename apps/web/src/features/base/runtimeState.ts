// 如实运行态（FIX-PLAN design-review-20260927 冻结契约 2，B 线侧）：
// A 线在 base snapshot DTO 上追加 `effectiveRunning: boolean`（= timeMode==='running'
// 且前台控制租约有效）与 `pauseReason: 'foreground-required' | null`。
// B 线按本模块消费；**字段缺失时回退现有行为**（只看 timeMode），兼容旧服务端与既有测试。
import type { BaseSnapshotDto } from "@ai-mud/shared";

export type SnapshotRuntimeFields = {
  effectiveRunning?: boolean;
  pauseReason?: "foreground-required" | null;
};

export interface RuntimeState {
  // 服务端时间模式本身是否为"暂停"（玩家或系统主动暂停）。
  timePaused: boolean;
  // 界面可以按"推进中"呈现：timeMode=running 且（字段存在时）effectiveRunning=true。
  effectivelyRunning: boolean;
  // timeMode=running 但实际冻结：服务端在等前台接管。界面必须如实显示"已暂停"。
  frozenAwaitingForeground: boolean;
  pauseReason: "foreground-required" | null;
}

export function resolveRuntimeState(
  snapshot: BaseSnapshotDto & SnapshotRuntimeFields
): RuntimeState {
  const timePaused = snapshot.timeMode === "paused";
  const pauseReason = snapshot.pauseReason ?? null;
  // 回退：旧服务端不下发 effectiveRunning → 维持现状（running 即视为推进中）。
  const effectivelyRunning =
    snapshot.effectiveRunning === undefined
      ? snapshot.timeMode === "running"
      : snapshot.timeMode === "running" && snapshot.effectiveRunning === true;
  return {
    timePaused,
    effectivelyRunning,
    frozenAwaitingForeground: snapshot.timeMode === "running" && !effectivelyRunning,
    pauseReason: timePaused ? null : pauseReason
  };
}

// 冻结或暂停时，队列/机组状态不得再用"作业中/出工中/运行中"措辞（D010）。
export function busyLabelWhileFrozen(): string {
  return "已暂停";
}
