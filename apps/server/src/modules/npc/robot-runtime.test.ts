// M12-B 作业者运行状态读写测试（内存假 tx，无真库）。
import { describe, expect, it } from "vitest";
import {
  RobotRuntimeService,
  type RobotOperatorRecord,
  type RobotOperatorUpdate,
  type RobotRuntimeTx
} from "./robot-runtime.js";

describe("RobotRuntimeService.listOperators", () => {
  it("读取 base 下全部作业者并映射为记录型结构", async () => {
    const rows = [
      {
        operatorId: "op-1",
        deviceId: "dev-1",
        deviceDefId: "yd-e1",
        groupId: "engineering",
        batteryWh: 18_000,
        batteryCapacityWh: 30_000,
        status: "idle",
        currentProjectId: null,
        currentStepIndex: null
      }
    ];
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: async () => rows
          })
        })
      })
    };
    const service = new RobotRuntimeService(db as unknown as RobotRuntimeTx);

    const operators = await service.listOperators("base-1");

    const expected: RobotOperatorRecord[] = [
      {
        operatorId: "op-1",
        deviceId: "dev-1",
        deviceDefId: "yd-e1",
        groupId: "engineering",
        batteryWh: 18_000,
        batteryCapacityWh: 30_000,
        status: "idle",
        currentProjectId: null,
        currentStepIndex: null
      }
    ];
    expect(operators).toEqual(expected);
  });
});

describe("RobotRuntimeService.applyRobotUpdates", () => {
  it("逐条更新电量/状态/分配，并刷新 updatedAt（npc 唯一写者）", async () => {
    const sets: Array<Record<string, unknown>> = [];
    const tx = {
      update(_table: unknown) {
        return {
          set(payload: Record<string, unknown>) {
            sets.push(payload);
            return { where: async () => {} };
          }
        };
      }
    } as unknown as RobotRuntimeTx;
    const service = new RobotRuntimeService({} as RobotRuntimeTx);

    const updates: RobotOperatorUpdate[] = [
      {
        operatorId: "op-1",
        batteryWh: 29_500,
        status: "working",
        currentProjectId: "p1",
        currentStepIndex: 0
      },
      {
        operatorId: "op-2",
        batteryWh: 20_000,
        status: "charging",
        currentProjectId: "p1",
        currentStepIndex: 1
      }
    ];
    await service.applyRobotUpdates(tx, updates);

    expect(sets).toEqual([
      {
        batteryWh: 29_500,
        status: "working",
        currentProjectId: "p1",
        currentStepIndex: 0,
        updatedAt: expect.any(Date)
      },
      {
        batteryWh: 20_000,
        status: "charging",
        currentProjectId: "p1",
        currentStepIndex: 1,
        updatedAt: expect.any(Date)
      }
    ]);
  });

  it("空更新列表不产生写", async () => {
    let writes = 0;
    const tx = {
      update() {
        writes += 1;
        throw new Error("should not write");
      }
    } as unknown as RobotRuntimeTx;
    const service = new RobotRuntimeService({} as RobotRuntimeTx);

    await service.applyRobotUpdates(tx, []);

    expect(writes).toBe(0);
  });
});
