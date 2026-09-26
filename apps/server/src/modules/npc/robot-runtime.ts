// M12-B 作业者运行状态读写（m12-p-contract.md §3.3：作业者状态只经 robot-runtime，npc 唯一写者）。
// 结构性实现 application/base/ports.ts 冻结的 BaseRobotReadPort + 基地 tick 的
// applyRobotUpdates 写面（composition 按结构绑定，npc 不得 import application）。
// deviceDefId 经 robot_operators.device_id ↔ base_devices.id 1:1 只读连接取得
// （base_devices 写者仍是 assets；本服务不写任何非 npc 表）。
// R1 landing：current_extraction_job_id 与 current_project_id 互斥（DB CHECK + 本模块
// claim 条件），采矿/勘探认领与释放也经这里；必须在调用方事务内执行。
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
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
  currentExtractionJobId: string | null;
}

export interface RobotOperatorUpdate {
  operatorId: string;
  batteryWh: number;
  status: RobotStatus;
  currentProjectId: string | null;
  currentStepIndex: number | null;
  currentExtractionJobId: string | null;
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
        currentStepIndex: robotOperators.currentStepIndex,
        currentExtractionJobId: robotOperators.currentExtractionJobId
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
      currentStepIndex: row.currentStepIndex,
      currentExtractionJobId: row.currentExtractionJobId
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
          currentExtractionJobId: update.currentExtractionJobId,
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

  // R1 landing：认领空闲且电量足够的设备进勘探/采矿单（施工/采矿互斥的写入口）。
  async claimOperatorForExtraction(
    tx: RobotRuntimeTx,
    baseId: string,
    operatorId: string,
    extractionJobId: string,
    minBatteryWh: number
  ): Promise<boolean> {
    const rows = await tx
      .update(robotOperators)
      .set({
        status: "working",
        currentExtractionJobId: extractionJobId,
        currentProjectId: null,
        currentStepIndex: null,
        updatedAt: new Date()
      })
      .where(and(
        eq(robotOperators.baseId, baseId),
        eq(robotOperators.id, operatorId),
        eq(robotOperators.status, "idle"),
        isNull(robotOperators.currentProjectId),
        isNull(robotOperators.currentExtractionJobId),
        gte(robotOperators.batteryWh, minBatteryWh)
      ))
      .returning({ id: robotOperators.id });
    return rows.length === 1;
  }

  // 暂停/终态：解除该采矿单的全部出工分配（施工分配不受影响）。
  async releaseExtractionAssignments(
    tx: RobotRuntimeTx,
    baseId: string,
    extractionJobId: string
  ): Promise<void> {
    await tx
      .update(robotOperators)
      .set({
        status: "idle",
        currentExtractionJobId: null,
        updatedAt: new Date()
      })
      .where(and(
        eq(robotOperators.baseId, baseId),
        eq(robotOperators.currentExtractionJobId, extractionJobId)
      ));
  }

  async releaseOperators(
    tx: RobotRuntimeTx,
    baseId: string,
    operatorIds: string[]
  ): Promise<void> {
    if (operatorIds.length === 0) return;
    await tx
      .update(robotOperators)
      .set({
        status: "idle",
        currentExtractionJobId: null,
        currentProjectId: null,
        currentStepIndex: null,
        updatedAt: new Date()
      })
      .where(and(
        eq(robotOperators.baseId, baseId),
        inArray(robotOperators.id, operatorIds)
      ));
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

  // 活动采矿/勘探单占用的设备清单（快照与互斥校验用）。
  async listExtractionAssignments(
    tx: RobotRuntimeTx,
    baseId: string,
    extractionJobId: string
  ): Promise<string[]> {
    const rows = await tx
      .select({ id: robotOperators.id })
      .from(robotOperators)
      .where(and(
        eq(robotOperators.baseId, baseId),
        eq(robotOperators.currentExtractionJobId, extractionJobId)
      ));
    return rows.map((row) => row.id);
  }

  async bumpUpdatedAt(tx: RobotRuntimeTx, operatorIds: string[]): Promise<void> {
    if (operatorIds.length === 0) return;
    await tx
      .update(robotOperators)
      .set({ updatedAt: sql`now()` })
      .where(inArray(robotOperators.id, operatorIds));
  }
}
