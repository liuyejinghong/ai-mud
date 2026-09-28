// 账号重开（删档重开）的基地数据删除仓储：删除**单个基地** FK 闭包内的全部行 +
// 该基地/该账号的基地命令收据。与 deploy/ops/reset-base-operations.sql（全服维护脚本）
// 同一份闭包清单，但按 baseId 精确作用域：
//   bases, base_sites, base_control_leases, base_inventory, base_devices,
//   robot_operators, base_power_state, base_projects, base_project_steps,
//   base_manufacturing_jobs, base_manufacturing_outputs, decision_records,
//   cooperation_requests, base_weather_schedule, base_orders, base_purchases,
//   base_resource_nodes, base_extraction_jobs, base_extraction_outputs,
//   base_production_slots, base_events
// 所有外键均为 ON DELETE RESTRICT，按子→父顺序删除（与维护脚本一致）。
// 性质：重开=玩家显式确认的维护型用例，横切全部基地实例表——按 PC-02 作为精确登记的
// 基础设施例外（与 world-reset.repository 同口径），非模块任意写库豁免。
// 所有方法必须在调用方事务内执行，本类永不开启或提交事务。
import { and, eq, inArray, like } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  baseControlLeases,
  baseDevices,
  baseEvents,
  baseExtractionJobs,
  baseExtractionOutputs,
  baseInventory,
  baseManufacturingJobs,
  baseManufacturingOutputs,
  baseOrders,
  basePowerState,
  baseProductionSlots,
  baseProjectSteps,
  baseProjects,
  basePurchases,
  baseResourceNodes,
  baseSites,
  bases,
  commandReceipts,
  cooperationRequests,
  decisionRecords,
  robotOperators,
  weatherSchedule
} from "../../db/schema.js";

// 与 BaseEventTx 同形状：事务句柄的完整读写面（实际由调用方传入的 tx 满足）。
export type BaseResetTx = Pick<Db, "delete" | "insert" | "select" | "update">;

// 重开命令收据的 commandKind（账号作用域，与 base.provision 同一 command_receipts 表）。
export const BASE_RESET_COMMAND_KIND = "base.resetBase";

export class BaseResetRepository {
  constructor(private readonly db: BaseResetTx) {}

  // 删除一个基地的 FK 闭包（子→父）。调用方必须已锁住 bases 行并与 tick/命令互斥。
  async deleteBaseClosure(input: { baseId: string }): Promise<void> {
    const baseId = input.baseId;

    // 经父表定位的孙表：制造产出/采矿产出挂在 job 上，无 base_id 列。
    const manufacturingJobIds = this.db
      .select({ id: baseManufacturingJobs.id })
      .from(baseManufacturingJobs)
      .where(eq(baseManufacturingJobs.baseId, baseId));
    const extractionJobIds = this.db
      .select({ id: baseExtractionJobs.id })
      .from(baseExtractionJobs)
      .where(eq(baseExtractionJobs.baseId, baseId));

    await this.db.delete(baseExtractionOutputs).where(inArray(baseExtractionOutputs.jobId, extractionJobIds));
    await this.db.delete(baseExtractionJobs).where(eq(baseExtractionJobs.baseId, baseId));
    await this.db.delete(baseProductionSlots).where(eq(baseProductionSlots.baseId, baseId));
    await this.db.delete(baseResourceNodes).where(eq(baseResourceNodes.baseId, baseId));
    await this.db
      .delete(baseManufacturingOutputs)
      .where(inArray(baseManufacturingOutputs.jobId, manufacturingJobIds));
    await this.db.delete(cooperationRequests).where(eq(cooperationRequests.baseId, baseId));
    await this.db.delete(decisionRecords).where(eq(decisionRecords.baseId, baseId));
    const projectIds = this.db
      .select({ id: baseProjects.id })
      .from(baseProjects)
      .where(eq(baseProjects.baseId, baseId));
    await this.db.delete(baseProjectSteps).where(inArray(baseProjectSteps.projectId, projectIds));
    await this.db.delete(baseProjects).where(eq(baseProjects.baseId, baseId));
    await this.db.delete(baseManufacturingJobs).where(eq(baseManufacturingJobs.baseId, baseId));
    await this.db.delete(robotOperators).where(eq(robotOperators.baseId, baseId));
    await this.db.delete(baseDevices).where(eq(baseDevices.baseId, baseId));
    await this.db.delete(baseInventory).where(eq(baseInventory.baseId, baseId));
    await this.db.delete(basePowerState).where(eq(basePowerState.baseId, baseId));
    await this.db.delete(weatherSchedule).where(eq(weatherSchedule.baseId, baseId));
    await this.db.delete(baseOrders).where(eq(baseOrders.baseId, baseId));
    await this.db.delete(basePurchases).where(eq(basePurchases.baseId, baseId));
    await this.db.delete(baseControlLeases).where(eq(baseControlLeases.baseId, baseId));
    await this.db.delete(baseEvents).where(eq(baseEvents.baseId, baseId));
    await this.db.delete(baseSites).where(eq(baseSites.baseId, baseId));
    await this.db.delete(bases).where(eq(bases.id, baseId));
  }

  // 删除已删基地的命令收据（口径与维护脚本一致）：
  //   ① base:{baseId} 作用域的全部基地命令（工程/制造/订单/采购等）；
  //   ② account:{accountId} 作用域的 base.provision——不删则同 commandId 重放会
  //      返回已删除的旧 baseId（维护脚本附录 A 同一理由）。
  // 重开收据本身（base.resetBase）不删：保留幂等重放语义，防止旧 commandId 重放
  // 触发第二次删档。
  async deleteBaseCommandReceipts(input: { baseId: string; accountId: string }): Promise<void> {
    await this.db
      .delete(commandReceipts)
      .where(
        and(
          like(commandReceipts.commandKind, "base.%"),
          eq(commandReceipts.actorScope, `base:${input.baseId}`)
        )
      );
    await this.db
      .delete(commandReceipts)
      .where(
        and(
          eq(commandReceipts.commandKind, "base.provision"),
          eq(commandReceipts.actorScope, `account:${input.accountId}`)
        )
      );
  }
}
