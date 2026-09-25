// B005 协作请求生命周期（真 PostgreSQL，随机临时库）。
// 覆盖：取消项目在调用方事务内结案（含回滚一致）、取消后 helper 下一 tick 被再次选中、
// content_missing 阻塞结案并释放原地充电的 helper、仓库条件写守卫（不复活已结案请求）。
// 只用 industry 模块真身（仓库/结算/协作/建设服务）+ platform schema；机器人、站点、查找、
// 回执、决策以最小内联适配器按 composition 同结构绑定，避免测试跨业务模块依赖。
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  DecisionOutcomeDto,
  DecisionRequestDto,
  ProjectTemplateDto,
  RobotTemplateDto
} from "@ai-mud/shared";
import { BASE_PROJECT_TEMPLATES, BASE_ROBOT_TEMPLATES } from "@ai-mud/content";
import type { Db } from "../../db/client.js";
import * as schema from "../../db/schema.js";
import { BaseSettlementService } from "./base-settlement.service.js";
import {
  ConstructionService,
  type ConstructionReceiptsPort,
  type ConstructionTx
} from "./construction.service.js";
import { CooperationRepository, type CooperationTx } from "./cooperation.repository.js";
import {
  applyAcceptedHelpers,
  detectAndResolveCooperation,
  type CooperationOperatorRecord,
  type CooperationRobotUpdate
} from "./cooperation.service.js";
import type { BaseRobotRecord, BaseTickRobotUpdate } from "./industry.pure.js";
import { IndustryRepository, type IndustryTx } from "./industry.repository.js";

const DATABASE_URL = process.env.DATABASE_URL;
const d = DATABASE_URL ? describe : describe.skip;

let adminPool: pg.Pool;
let migPool: pg.Pool;
const dbName = `ai_mud_vitest_b005_${process.pid}_${randomUUID().slice(0, 8)}`;
const here = dirname(fileURLToPath(import.meta.url));

beforeAll(
  async () => {
    if (!DATABASE_URL) return;
    adminPool = new pg.Pool({ connectionString: DATABASE_URL });
    const adminClient = await adminPool.connect();
    await adminClient.query(`CREATE DATABASE "${dbName}"`);
    adminClient.release();
    migPool = new pg.Pool({
      connectionString: `${DATABASE_URL.substring(0, DATABASE_URL.lastIndexOf("/") + 1)}${dbName}`
    });
    const migClient = await migPool.connect();
    const journal = JSON.parse(readFileSync(join(here, "../../../drizzle/meta/_journal.json"), "utf8"));
    const allSql = (journal.entries as Array<{ tag: string }>)
      .map((entry) => readFileSync(join(here, `../../../drizzle/${entry.tag}.sql`), "utf8"))
      .join("\n--> statement-breakpoint\n");
    await migClient.query(allSql);
    migClient.release();
  },
  120_000
);

afterAll(async () => {
  if (!DATABASE_URL || !migPool) return;
  await migPool.end();
  const adminClient = await adminPool.connect();
  await adminClient.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
  adminClient.release();
  await adminPool.end();
});

// ---------- 内联适配器（与 composition 绑定同结构） ----------

const robotTemplates = new Map<string, RobotTemplateDto>(
  BASE_ROBOT_TEMPLATES.map((template) => [
    template.ref.stableId,
    {
      ref: { ...template.ref },
      name: template.name,
      groupId: template.groupId,
      description: template.description,
      batteryCapacityWh: template.batteryCapacityWh,
      chargeRateW: template.chargeRateW,
      workRatePerTick: template.workRatePerTick
    }
  ])
);
const projectTemplates = new Map<string, ProjectTemplateDto>(
  BASE_PROJECT_TEMPLATES.map((template) => [
    template.ref.stableId,
    {
      ref: { ...template.ref },
      name: template.name,
      description: template.description,
      steps: template.steps.map((step) => ({ ...step })),
      inputs: template.inputs.map((input) => ({ ...input })),
      outputFacility: { ...template.outputFacility, ref: { ...template.outputFacility.ref } }
    }
  ])
);
const catalog = {
  getRobotTemplate: (stableId: string) => robotTemplates.get(stableId) ?? null,
  getProjectTemplate: (stableId: string) => projectTemplates.get(stableId) ?? null
};

// npc robot-runtime 同结构读写（tx 内读，保证结算事务内写入对协作检测可见）。
function robotsIn(tx: IndustryTx) {
  return {
    async listOperators(baseId: string): Promise<BaseRobotRecord[] & CooperationOperatorRecord[]> {
      return tx
        .select({
          operatorId: schema.robotOperators.id,
          deviceId: schema.robotOperators.deviceId,
          deviceDefId: schema.baseDevices.deviceDefId,
          groupId: schema.robotOperators.groupId,
          batteryWh: schema.robotOperators.batteryWh,
          batteryCapacityWh: schema.robotOperators.batteryCapacityWh,
          status: schema.robotOperators.status,
          currentProjectId: schema.robotOperators.currentProjectId,
          currentStepIndex: schema.robotOperators.currentStepIndex
        })
        .from(schema.robotOperators)
        .innerJoin(schema.baseDevices, eq(schema.robotOperators.deviceId, schema.baseDevices.id))
        .where(eq(schema.robotOperators.baseId, baseId));
    },
    async applyRobotUpdates(
      writeTx: IndustryTx,
      updates: Array<BaseTickRobotUpdate | CooperationRobotUpdate>
    ): Promise<void> {
      for (const update of updates) {
        await writeTx
          .update(schema.robotOperators)
          .set({
            batteryWh: update.batteryWh,
            status: update.status,
            currentProjectId: update.currentProjectId,
            currentStepIndex: update.currentStepIndex
          })
          .where(eq(schema.robotOperators.id, update.operatorId));
      }
    }
  };
}

// RULE 等价决策：选最高分候选（候选已按分数降序、operatorId 升序排好）。
const ruleGateway = {
  async decide(_tx: CooperationTx, request: DecisionRequestDto): Promise<DecisionOutcomeDto> {
    return {
      decisionId: request.decisionId,
      selectedCandidateId: request.candidates[0]?.candidateId ?? null,
      mode: "rule",
      provider: "rule",
      latencyMs: 0,
      reason: "测试 RULE"
    };
  }
};

// 只结算指定基地一个 60s 子 tick（不走全服锁，避免与同文件其他用例的基地互相推进）。
function makeSettlement(db: Db, baseId: string, simTime: Date) {
  return new BaseSettlementService({
    clock: {
      lockAdvanceableBases: async () => [
        {
          baseId,
          simTime,
          speed: 1,
          deltaSimMs: 60_000,
          nextLastAdvancedAt: new Date(),
          catchUp: false
        }
      ],
      saveSimAdvance: async (tx, id, nextSimTime, lastAdvancedAt) => {
        await tx
          .update(schema.bases)
          .set({ simTime: nextSimTime, lastAdvancedAt })
          .where(eq(schema.bases.id, id));
      }
    },
    sites: { markSiteBuilt: async () => {} },
    assets: { consumeReservedBaseInventory: async () => {} },
    catalog,
    openIndustry: (tx) => new IndustryRepository(tx),
    openRobots: (tx) => robotsIn(tx),
    cooperation: {
      listOpenRequests: async (tx, id) =>
        (await new CooperationRepository(tx).listByBase(tx, id)).flatMap((request) =>
          request.status === "pending" || request.status === "accepted"
            ? [{ status: request.status, operatorId: request.helperOperatorId, projectId: request.projectId, stepIndex: request.stepIndex }]
            : []
        ),
      detectAndResolve: (tx, id, needySteps, meta) =>
        detectAndResolveCooperation(
          tx,
          id,
          needySteps.map((step) => ({ ...step, groupId: step.groupId as "engineering" | "transport" | "survey" })),
          {
            robots: robotsIn(tx),
            gateway: ruleGateway,
            clock: meta.clock,
            baseRevision: meta.baseRevision,
            epoch: meta.epoch,
            openCooperation: (coopTx) => new CooperationRepository(coopTx)
          }
        ),
      applyAcceptedHelpers: (tx, id, runnableSteps) =>
        applyAcceptedHelpers(tx, id, runnableSteps, {
          robots: robotsIn(tx),
          openCooperation: (coopTx) => new CooperationRepository(coopTx)
        }),
      markFulfilledByStep: (tx, id, projectId, stepIndex) =>
        new CooperationRepository(tx).markFulfilledByStep(tx, id, projectId, stepIndex)
    }
  });
}

class MemoryReceipts implements ConstructionReceiptsPort {
  rows = new Map<string, { requestHash: string; result: unknown }>();
  failOnSave = false;
  async findReceiptForUpdate(actorScope: string, commandKind: string, commandId: string) {
    const row = this.rows.get(`${actorScope}|${commandKind}|${commandId}`);
    return row
      ? { actorScope, commandKind, commandId, worldEpoch: 1, requestHash: row.requestHash, result: row.result }
      : null;
  }
  async claimReceipt(input: { actorScope: string; commandKind: string; commandId: string; requestHash: string }) {
    const key = `${input.actorScope}|${input.commandKind}|${input.commandId}`;
    if (this.rows.has(key)) return false;
    this.rows.set(key, { requestHash: input.requestHash, result: { status: "pending" } });
    return true;
  }
  async saveReceiptResult(input: { actorScope: string; commandKind: string; commandId: string; result: unknown }) {
    if (this.failOnSave) throw new Error("receipt write failed");
    const row = this.rows.get(`${input.actorScope}|${input.commandKind}|${input.commandId}`);
    if (row) row.result = input.result;
  }
}

// 与 composition 相同：store 以池连接构造、方法走调用方 tx；**不注入 cooperation**，
// 验证生产默认绑定（CooperationRepository(tx)）在调用方事务内结案。
function makeConstruction(db: Db, receipts: MemoryReceipts) {
  return new ConstructionService({
    lookup: {
      findBaseIdByAccount: async (tx: ConstructionTx, accountId: string) => {
        const [row] = await tx
          .select({ id: schema.bases.id })
          .from(schema.bases)
          .where(eq(schema.bases.accountId, accountId))
          .limit(1);
        return row?.id ?? null;
      }
    },
    assets: {
      reserveBaseInventoryIfAvailable: async () => true,
      releaseReservedBaseInventory: async () => {}
    },
    sites: {
      getSite: async (tx: ConstructionTx, baseId: string, siteId: string) => {
        const [row] = await tx
          .select({ id: schema.baseSites.id, state: schema.baseSites.state })
          .from(schema.baseSites)
          .where(and(eq(schema.baseSites.baseId, baseId), eq(schema.baseSites.id, siteId)))
          .limit(1);
        return row ? { id: row.id, state: row.state as "free" | "reserved" | "built" } : null;
      },
      markSiteReserved: async (tx: ConstructionTx, siteId: string) => {
        await tx.update(schema.baseSites).set({ state: "reserved" }).where(eq(schema.baseSites.id, siteId));
      },
      releaseSite: async (tx: ConstructionTx, siteId: string) => {
        await tx.update(schema.baseSites).set({ state: "free" }).where(eq(schema.baseSites.id, siteId));
      }
    },
    catalog,
    store: new IndustryRepository(db),
    receipts: () => receipts
  });
}

// ---------- 种子 ----------

const SIM_NOON = new Date("2026-09-01T10:00:00Z");

async function seedBase(db: Db) {
  const accountId = randomUUID();
  const baseId = randomUUID();
  await db.insert(schema.accounts).values({
    id: accountId, email: `b005-${accountId}@example.invalid`, passwordHash: "x"
  });
  await db.insert(schema.bases).values({
    id: baseId, accountId, name: "B005 基地", contentRelease: "test",
    timeMode: "running", simTime: SIM_NOON
  });
  await db.insert(schema.basePowerState).values({
    baseId, generationWPeak: 15_000, storageWh: 100_000, storageCapacityWh: 200_000, lastLoadW: 0
  });
  return { accountId, baseId };
}

async function seedProject(
  db: Db,
  baseId: string,
  steps: Array<{ kind: string; groupId: string; status: string; workRequired: number; workDone?: number; blockedReason?: string | null }>,
  options: { templateRevision?: number } = {}
) {
  const siteId = randomUUID();
  const projectId = randomUUID();
  await db.insert(schema.baseSites).values({ id: siteId, baseId, siteKey: `site-${siteId.slice(0, 8)}`, state: "reserved" });
  await db.insert(schema.baseProjects).values({
    id: projectId, baseId, siteId, projectDefId: "install-solar-array",
    templateRevision: options.templateRevision ?? 1, status: "active", reservedInputs: []
  });
  await db.insert(schema.baseProjectSteps).values(
    steps.map((step, stepIndex) => ({
      projectId, stepIndex, kind: step.kind, groupId: step.groupId, status: step.status,
      workRequired: step.workRequired, workDone: step.workDone ?? 0, blockedReason: step.blockedReason ?? null
    }))
  );
  return { siteId, projectId };
}

async function seedRobot(
  db: Db,
  baseId: string,
  input: {
    deviceDefId: string; groupId: string; batteryWh: number; batteryCapacityWh: number;
    status?: string; currentProjectId?: string | null; currentStepIndex?: number | null;
  }
) {
  const deviceId = randomUUID();
  const operatorId = randomUUID();
  await db.insert(schema.baseDevices).values({
    id: deviceId, baseId, deviceDefId: input.deviceDefId, templateRevision: 1, sourceOperation: `b005-${deviceId}`
  });
  await db.insert(schema.robotOperators).values({
    id: operatorId, deviceId, baseId, groupId: input.groupId,
    batteryWh: input.batteryWh, batteryCapacityWh: input.batteryCapacityWh,
    status: input.status ?? "idle",
    currentProjectId: input.currentProjectId ?? null,
    currentStepIndex: input.currentStepIndex ?? null
  });
  return operatorId;
}

async function seedRequest(
  db: Db,
  input: { baseId: string; projectId: string; stepIndex: number; status: string; helperOperatorId: string | null }
) {
  const [row] = await db
    .insert(schema.cooperationRequests)
    .values({
      baseId: input.baseId, projectId: input.projectId, stepIndex: input.stepIndex,
      fromGroupId: "transport", helperGroupId: "survey", status: input.status,
      helperOperatorId: input.helperOperatorId, decisionId: input.helperOperatorId ? "decision-seed" : null,
      question: "种子请求", createdAt: SIM_NOON,
      resolvedAt: input.status === "pending" || input.status === "accepted" ? null : SIM_NOON
    })
    .returning({ id: schema.cooperationRequests.id });
  return row!.id;
}

async function requestsOf(db: Db, baseId: string) {
  return db.select().from(schema.cooperationRequests).where(eq(schema.cooperationRequests.baseId, baseId));
}

async function robotOf(db: Db, operatorId: string) {
  const [row] = await db.select().from(schema.robotOperators).where(eq(schema.robotOperators.id, operatorId));
  return row!;
}

d("B005 cooperation lifecycle (real PostgreSQL)", () => {
  it("取消项目在调用方事务内结案本项目 pending/accepted（生产默认绑定）；事务回滚时一并回滚", async () => {
    const db: Db = drizzle(migPool, { schema });
    const { accountId, baseId } = await seedBase(db);
    const survey = await seedRobot(db, baseId, { deviceDefId: "yd-s1", groupId: "survey", batteryWh: 9_000, batteryCapacityWh: 10_000 });
    const a = await seedProject(db, baseId, [
      { kind: "transport", groupId: "transport", status: "running", workRequired: 60, workDone: 44 },
      { kind: "installation", groupId: "engineering", status: "pending", workRequired: 80 }
    ]);
    const b = await seedProject(db, baseId, [
      { kind: "transport", groupId: "transport", status: "running", workRequired: 60 }
    ]);
    const acceptedA = await seedRequest(db, { baseId, projectId: a.projectId, stepIndex: 0, status: "accepted", helperOperatorId: survey });
    const pendingA = await seedRequest(db, { baseId, projectId: a.projectId, stepIndex: 0, status: "pending", helperOperatorId: null });
    const historyA = await seedRequest(db, { baseId, projectId: a.projectId, stepIndex: 0, status: "fulfilled", helperOperatorId: survey });
    const acceptedB = await seedRequest(db, { baseId, projectId: b.projectId, stepIndex: 0, status: "accepted", helperOperatorId: survey });

    // 回执写失败 → 整个取消事务回滚：请求与项目都保持原状（证明结案与取消同一事务）。
    const failing = new MemoryReceipts();
    failing.failOnSave = true;
    await expect(
      db.transaction((tx) =>
        makeConstruction(db, failing).cancel(tx, { accountId }, {
          projectId: a.projectId, commandId: randomUUID()
        })
      )
    ).rejects.toThrow("receipt write failed");
    const afterRollback = new Map((await requestsOf(db, baseId)).map((row) => [row.id, row]));
    expect(afterRollback.get(acceptedA)?.status).toBe("accepted");
    expect(afterRollback.get(pendingA)?.status).toBe("pending");
    const [projectAfterRollback] = await db.select().from(schema.baseProjects).where(eq(schema.baseProjects.id, a.projectId));
    expect(projectAfterRollback?.status).toBe("active");

    const result = await db.transaction((tx) =>
      makeConstruction(db, new MemoryReceipts()).cancel(tx, { accountId }, {
        projectId: a.projectId, commandId: randomUUID()
      })
    );
    expect(result.cancelled).toBe(true);

    const rows = new Map((await requestsOf(db, baseId)).map((row) => [row.id, row]));
    expect(rows.get(acceptedA)).toMatchObject({ status: "expired" });
    expect(rows.get(acceptedA)?.resolvedAt).not.toBeNull();
    expect(rows.get(pendingA)).toMatchObject({ status: "expired" });
    expect(rows.get(historyA)).toMatchObject({ status: "fulfilled" }); // 历史不改写
    expect(rows.get(acceptedB)).toMatchObject({ status: "accepted" }); // 其他项目不受影响
    // 快照/主屏的活动计数口径（pending/accepted）只剩 B 的一条。
    const active = [...rows.values()].filter((row) => row.status === "pending" || row.status === "accepted");
    expect(active.map((row) => row.id)).toEqual([acceptedB]);
  });

  it("取消后下一 tick：helper 回到 idle，并被新项目的缺工步骤再次选中", async () => {
    const db: Db = drizzle(migPool, { schema });
    const { accountId, baseId } = await seedBase(db);
    // 驮运电量 < 500 Wh：运输步骤本组无人可出工 → 请求跨组支援。
    await seedRobot(db, baseId, { deviceDefId: "yd-h1", groupId: "transport", batteryWh: 100, batteryCapacityWh: 20_000 });
    const survey = await seedRobot(db, baseId, { deviceDefId: "yd-s1", groupId: "survey", batteryWh: 10_000, batteryCapacityWh: 10_000 });
    const a = await seedProject(db, baseId, [
      { kind: "transport", groupId: "transport", status: "ready", workRequired: 60 },
      { kind: "installation", groupId: "engineering", status: "pending", workRequired: 80 }
    ]);

    await db.transaction((tx) => makeSettlement(db, baseId, SIM_NOON).settleBases(tx, new Date()));
    const [requestA] = await requestsOf(db, baseId);
    expect(requestA).toMatchObject({ projectId: a.projectId, stepIndex: 0, status: "accepted", helperOperatorId: survey });
    expect(await robotOf(db, survey)).toMatchObject({ status: "working", currentProjectId: a.projectId, currentStepIndex: 0 });

    await db.transaction((tx) =>
      makeConstruction(db, new MemoryReceipts()).cancel(tx, { accountId }, {
        projectId: a.projectId, commandId: randomUUID()
      })
    );
    expect((await requestsOf(db, baseId))[0]).toMatchObject({ id: requestA!.id, status: "expired" });

    const b = await seedProject(db, baseId, [
      { kind: "transport", groupId: "transport", status: "ready", workRequired: 100 }
    ]);
    await db.transaction((tx) =>
      makeSettlement(db, baseId, new Date(SIM_NOON.getTime() + 60_000)).settleBases(tx, new Date())
    );

    const requestB = (await requestsOf(db, baseId)).find((row) => row.projectId === b.projectId);
    expect(requestB).toMatchObject({ status: "accepted", helperOperatorId: survey });
    expect(await robotOf(db, survey)).toMatchObject({ status: "working", currentProjectId: b.projectId, currentStepIndex: 0 });
  });

  it("内容缺失阻塞：accepted 在同一 tick 结案，原地充电的 helper 释放为 idle", async () => {
    const db: Db = drizzle(migPool, { schema });
    const { baseId } = await seedBase(db);
    const c = await seedProject(
      db,
      baseId,
      [{ kind: "installation", groupId: "engineering", status: "running", workRequired: 80, workDone: 10 }],
      { templateRevision: 99 } // 内容包里没有该修订 → 结算把步骤阻塞为 content_missing
    );
    const survey = await seedRobot(db, baseId, {
      deviceDefId: "yd-s1", groupId: "survey", batteryWh: 8_000, batteryCapacityWh: 10_000,
      status: "charging", currentProjectId: c.projectId, currentStepIndex: 0
    });
    const request = await seedRequest(db, { baseId, projectId: c.projectId, stepIndex: 0, status: "accepted", helperOperatorId: survey });

    await db.transaction((tx) => makeSettlement(db, baseId, SIM_NOON).settleBases(tx, new Date()));

    const [step] = await db.select().from(schema.baseProjectSteps).where(eq(schema.baseProjectSteps.projectId, c.projectId));
    expect(step).toMatchObject({ status: "blocked", blockedReason: "content_missing" });
    const [row] = await requestsOf(db, baseId);
    expect(row).toMatchObject({ id: request, status: "expired" });
    expect(row?.resolvedAt).not.toBeNull();
    expect(await robotOf(db, survey)).toMatchObject({ status: "idle", currentProjectId: null, currentStepIndex: null });
  });

  it("仓库条件写：accept 只接受 pending（已结案不复活）；closeOpenByProject 只动本基地本项目的打开请求；listStepStates 读出项目与步骤事实", async () => {
    const db: Db = drizzle(migPool, { schema });
    const { baseId } = await seedBase(db);
    const other = await seedBase(db);
    const p = await seedProject(db, baseId, [
      { kind: "transport", groupId: "transport", status: "running", workRequired: 60 },
      { kind: "installation", groupId: "engineering", status: "blocked", workRequired: 80, blockedReason: "insufficient_power" }
    ]);
    const q = await seedProject(db, other.baseId, [
      { kind: "transport", groupId: "transport", status: "running", workRequired: 60 }
    ]);
    const survey = await seedRobot(db, baseId, { deviceDefId: "yd-s1", groupId: "survey", batteryWh: 9_000, batteryCapacityWh: 10_000 });
    const expired = await seedRequest(db, { baseId, projectId: p.projectId, stepIndex: 0, status: "expired", helperOperatorId: null });
    const pending = await seedRequest(db, { baseId, projectId: p.projectId, stepIndex: 0, status: "pending", helperOperatorId: null });
    const accepted = await seedRequest(db, { baseId, projectId: p.projectId, stepIndex: 1, status: "accepted", helperOperatorId: survey });
    const foreign = await seedRequest(db, { baseId: other.baseId, projectId: q.projectId, stepIndex: 0, status: "accepted", helperOperatorId: null });

    const repo = new CooperationRepository(db);
    expect(await repo.accept(db, expired, survey, "decision-late")).toBe(false);
    const [stillExpired] = await db.select().from(schema.cooperationRequests).where(eq(schema.cooperationRequests.id, expired));
    expect(stillExpired).toMatchObject({ status: "expired", helperOperatorId: null, decisionId: null });

    const states = await repo.listStepStates(db, baseId, [p.projectId, q.projectId]);
    expect(states.sort((x, y) => (x.stepIndex ?? -1) - (y.stepIndex ?? -1))).toEqual([
      { projectId: p.projectId, projectStatus: "active", stepIndex: 0, stepStatus: "running", blockedReason: null },
      { projectId: p.projectId, projectStatus: "active", stepIndex: 1, stepStatus: "blocked", blockedReason: "insufficient_power" }
    ]); // 他基地项目不外泄

    expect(await repo.closeOpenByProject(db, other.baseId, p.projectId, "project_cancelled")).toBe(0);
    expect(await repo.closeOpenByProject(db, baseId, p.projectId, "project_cancelled")).toBe(2);
    const rows = await db
      .select()
      .from(schema.cooperationRequests)
      .where(inArray(schema.cooperationRequests.id, [expired, pending, accepted, foreign]));
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(pending)?.status).toBe("expired");
    expect(byId.get(accepted)?.status).toBe("expired");
    expect(byId.get(accepted)?.resolvedAt).not.toBeNull();
    expect(byId.get(expired)?.resolvedAt?.toISOString()).toBe(SIM_NOON.toISOString()); // 已结案不重写
    expect(byId.get(foreign)?.status).toBe("accepted");
    expect(await repo.accept(db, pending, survey, "decision-late")).toBe(false);
    expect(await repo.closeOpen(db, pending, "project_cancelled")).toBe(false);
  });
});
