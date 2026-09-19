// M12-B 设备资产 → 作业者实例 1:1 登记（m12-p-contract.md §3.6）。
// 结构性实现 application/base/ports.ts 冻结的 RobotFactoryPort（composition 按结构绑定，
// npc 不得 import application）。provision 幂等重放不重复建行由 A 线收据语义保证；
// 本工厂只负责：组与电量校验 + robot_operators 插行（初始 idle、无分配）。
// 必须在调用方事务内执行，永不自开或提交事务。
import type { BaseRobotGroupId } from "@ai-mud/shared";
import { BASE_ROBOT_GROUPS } from "@ai-mud/shared";
import type { Db } from "../../db/client.js";
import { robotOperators } from "../../db/schema.js";

export type RobotFactoryTx = Pick<Db, "delete" | "insert" | "select" | "update">;

export interface InitializeOperatorInput {
  deviceId: string;
  baseId: string;
  groupId: string;
  batteryCapacityWh: number;
  initialBatteryWh: number;
}

export class RobotFactoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RobotFactoryError";
    // 语义对应 shared ErrorCode VALIDATION_ERROR；provision 用例负责映射。
  }
}

export function isBaseRobotGroupId(value: string): value is BaseRobotGroupId {
  return (BASE_ROBOT_GROUPS as readonly string[]).includes(value);
}

export class RobotFactory {
  constructor(private readonly db: RobotFactoryTx) {}

  async initializeOperator(
    tx: RobotFactoryTx,
    input: InitializeOperatorInput
  ): Promise<{ operatorId: string }> {
    if (!isBaseRobotGroupId(input.groupId)) {
      throw new RobotFactoryError(`未知作业组：${input.groupId}`);
    }
    if (
      !Number.isInteger(input.batteryCapacityWh) ||
      input.batteryCapacityWh <= 0
    ) {
      throw new RobotFactoryError("电池容量必须为正整数（Wh）。");
    }
    if (
      !Number.isInteger(input.initialBatteryWh) ||
      input.initialBatteryWh < 0 ||
      input.initialBatteryWh > input.batteryCapacityWh
    ) {
      throw new RobotFactoryError("初始电量必须介于 0 与电池容量之间（Wh）。");
    }

    const inserted = await tx
      .insert(robotOperators)
      .values({
        deviceId: input.deviceId,
        baseId: input.baseId,
        groupId: input.groupId,
        batteryWh: input.initialBatteryWh,
        batteryCapacityWh: input.batteryCapacityWh,
        status: "idle",
        currentProjectId: null,
        currentStepIndex: null
      })
      .returning({ id: robotOperators.id });
    const row = inserted[0];
    if (!row) throw new RobotFactoryError("robot_operators 插入失败。");
    return { operatorId: row.id };
  }
}
