// M12-B 作业者运行状态读写（m12-p-contract.md §3.3：作业者状态只经 robot-runtime，npc 唯一写者）。
// 结构性实现 application/base/ports.ts 冻结的 BaseRobotReadPort + 基地 tick 的
// applyRobotUpdates 写面（composition 按结构绑定，npc 不得 import application）。
// deviceDefId 经 robot_operators.device_id ↔ base_devices.id 1:1 只读连接取得
// （base_devices 写者仍是 assets；本服务不写任何非 npc 表）。
// 必须在调用方事务内执行，永不自开或提交事务。
import { and, eq, gte, inArray } from "drizzle-orm";
import type { RobotStatus } from "@ai-mud/shared";
import type { Db } from "../../db/client.js";
import { baseDevices, robotOperators } from "../../db/schema.js";

export type RobotRuntimeTx = Pick<Db, "delete" | "insert" | "select" | "update">;

// 作业者读面记录（与 industry/industry.pure.ts 的 BaseRobotRecord 结构一致；
// npc 不得 import industry，composition 按结构绑定 BaseRobotReadPort）。
export interface RobotOperatorRecord {
  operatorId: string;
  deviceId: string;
  deviceDefId: string;
  groupId: string;
  batteryWh: number;
  batteryCapacityWh: number;
  status: string;
  currentProjectId: string | null;
  currentStepIndex: number | null;
}

export interface RobotOperatorUpdate {
  operatorId: string;
  batteryWh: number;
  status: RobotStatus;
  currentProjectId: string | null;
  currentStepIndex: number | null;
}

export class RobotRuntimeService {
  constructor(private readonly db: RobotRuntimeTx) {}

  async listOperators(baseId: string): Promise<RobotOperatorRecord[]> {
    const rows = await this.db
      .select({
        operatorId: robotOperators.id,
        deviceId: robotOperators.deviceId,
        deviceDefId: baseDevices.deviceDefId,
        groupId: robotOperators.groupId,
        batteryWh: robotOperators.batteryWh,
        batteryCapacityWh: robotOperators.batteryCapacityWh,
        status: robotOperators.status,
        currentProjectId: robotOperators.currentProjectId,
        currentStepIndex: robotOperators.currentStepIndex
      })
      .from(robotOperators)
      .innerJoin(baseDevices, eq(robotOperators.deviceId, baseDevices.id))
      .where(eq(robotOperators.baseId, baseId));
    return rows.map((row) => ({
      operatorId: row.operatorId,
      deviceId: row.deviceId,
      deviceDefId: row.deviceDefId,
      groupId: row.groupId,
      batteryWh: row.batteryWh,
      batteryCapacityWh: row.batteryCapacityWh,
      status: row.status,
      currentProjectId: row.currentProjectId,
      currentStepIndex: row.currentStepIndex
    }));
  }

  async applyRobotUpdates(tx: RobotRuntimeTx, updates: RobotOperatorUpdate[]): Promise<void> {
    for (const update of updates) {
      await tx
        .update(robotOperators)
        .set({
          batteryWh: update.batteryWh,
          status: update.status,
          currentProjectId: update.currentProjectId,
          currentStepIndex: update.currentStepIndex,
          updatedAt: new Date()
        })
        .where(eq(robotOperators.id, update.operatorId));
    }
  }

  async claimIdleOperator(
    tx: RobotRuntimeTx,
    baseId: string,
    operatorId: string,
    projectId: string,
    stepIndex: number,
    minBatteryWh: number
  ): Promise<boolean> {
    const rows = await tx
      .update(robotOperators)
      .set({
        status: "working",
        currentProjectId: projectId,
        currentStepIndex: stepIndex,
        updatedAt: new Date()
      })
      .where(and(
        eq(robotOperators.baseId, baseId),
        eq(robotOperators.id, operatorId),
        eq(robotOperators.status, "idle"),
        gte(robotOperators.batteryWh, minBatteryWh)
      ))
      .returning({ id: robotOperators.id });
    return rows.length === 1;
  }

  // 项目取消与基地 tick 共用事务/基地锁；立即清除该项目的出工和原地充电分配。
  async releaseProjectAssignments(tx: RobotRuntimeTx, baseId: string, projectId: string): Promise<void> {
    await tx
      .update(robotOperators)
      .set({ status: "idle", currentProjectId: null, currentStepIndex: null, updatedAt: new Date() })
      .where(and(
        eq(robotOperators.baseId, baseId),
        eq(robotOperators.currentProjectId, projectId),
        inArray(robotOperators.status, ["working", "charging"])
      ));
  }
}
