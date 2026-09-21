// M12-B 作业者登记工厂测试（内存假 tx，无真库）。
import { describe, expect, it } from "vitest";
import { RobotFactory, RobotFactoryError, type RobotFactoryTx } from "./robot-factory.js";

function makeTx() {
  const inserted: Array<Record<string, unknown>> = [];
  const tx = {
    insert(_table: unknown) {
      return {
        values(value: Record<string, unknown>) {
          inserted.push(value);
          return { returning: async () => [{ id: "op-1" }] };
        }
      };
    }
  };
  return { tx: tx as unknown as RobotFactoryTx, inserted };
}

const BASE_INPUT = {
  deviceId: "dev-1",
  baseId: "base-1",
  groupId: "engineering",
  batteryCapacityWh: 30_000,
  initialBatteryWh: 18_000 // fixture：期初 60%
};

describe("RobotFactory.initializeOperator", () => {
  it("插入 robot_operators 行（初始 idle、无分配）并返回 operatorId", async () => {
    const factory = new RobotFactory({} as RobotFactoryTx);
    const { tx, inserted } = makeTx();

    const result = await factory.initializeOperator(tx, BASE_INPUT);

    expect(result).toEqual({ operatorId: "op-1" });
    expect(inserted).toEqual([
      {
        deviceId: "dev-1",
        baseId: "base-1",
        groupId: "engineering",
        batteryWh: 18_000,
        batteryCapacityWh: 30_000,
        status: "idle",
        currentProjectId: null,
        currentStepIndex: null
      }
    ]);
  });

  it("初始电量超过容量 → 拒绝（电量上限校验）", async () => {
    const factory = new RobotFactory({} as RobotFactoryTx);
    const { tx, inserted } = makeTx();

    const failure = factory.initializeOperator(tx, {
      ...BASE_INPUT,
      initialBatteryWh: 30_001
    });

    await expect(failure).rejects.toBeInstanceOf(RobotFactoryError);
    await expect(failure).rejects.toMatchObject({ name: "RobotFactoryError" });
    expect(inserted).toHaveLength(0);
  });

  it("负电量、非整数容量、未知作业组均拒绝", async () => {
    const factory = new RobotFactory({} as RobotFactoryTx);

    await expect(
      factory.initializeOperator(makeTx().tx, { ...BASE_INPUT, initialBatteryWh: -1 })
    ).rejects.toBeInstanceOf(RobotFactoryError);
    await expect(
      factory.initializeOperator(makeTx().tx, { ...BASE_INPUT, batteryCapacityWh: 1.5 })
    ).rejects.toBeInstanceOf(RobotFactoryError);
    await expect(
      factory.initializeOperator(makeTx().tx, { ...BASE_INPUT, groupId: "cook" })
    ).rejects.toBeInstanceOf(RobotFactoryError);
  });
});
