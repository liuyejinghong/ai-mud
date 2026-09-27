// D010 冻结契约 2 的回退语义：字段缺失时维持旧行为（只看 timeMode），不误报冻结。
import { describe, expect, it } from "vitest";
import type { BaseSnapshotDto } from "@ai-mud/shared";
import { resolveRuntimeState, type SnapshotRuntimeFields } from "./runtimeState.js";

function snapshot(overrides: Partial<BaseSnapshotDto & SnapshotRuntimeFields> = {}): BaseSnapshotDto & SnapshotRuntimeFields {
  return {
    name: "着陆场",
    baseId: "b-1",
    epoch: 1,
    baseRevision: 1,
    simTime: "2026-09-26T08:00:00.000Z",
    timeMode: "running",
    speed: 1,
    activeContentRelease: "yudian-landing-1",
    controlLease: { heldByThisSession: true, controlActive: true, leaseUntil: null },
    ...overrides
  } as BaseSnapshotDto & SnapshotRuntimeFields;
}

describe("resolveRuntimeState", () => {
  it("旧服务端不下发 effectiveRunning 时回退现有行为：running 即视为推进中", () => {
    const state = resolveRuntimeState(snapshot());
    expect(state.effectivelyRunning).toBe(true);
    expect(state.frozenAwaitingForeground).toBe(false);
    expect(state.timePaused).toBe(false);
    expect(state.pauseReason).toBeNull();
  });

  it("timeMode=running 但 effectiveRunning=false → 冻结待前台接管（契约字段）", () => {
    const state = resolveRuntimeState(snapshot({
      effectiveRunning: false,
      pauseReason: "foreground-required"
    }));
    expect(state.effectivelyRunning).toBe(false);
    expect(state.frozenAwaitingForeground).toBe(true);
    expect(state.pauseReason).toBe("foreground-required");
  });

  it("effectiveRunning=true 且 running → 正常推进", () => {
    const state = resolveRuntimeState(snapshot({ effectiveRunning: true, pauseReason: null }));
    expect(state.effectivelyRunning).toBe(true);
    expect(state.frozenAwaitingForeground).toBe(false);
  });

  it("timeMode=paused 时 timePaused=true，pauseReason 不参与（非前台冻结语义）", () => {
    const state = resolveRuntimeState(snapshot({
      timeMode: "paused",
      effectiveRunning: false,
      pauseReason: "foreground-required"
    }));
    expect(state.timePaused).toBe(true);
    expect(state.effectivelyRunning).toBe(false);
    expect(state.frozenAwaitingForeground).toBe(false);
    expect(state.pauseReason).toBeNull();
  });
});
