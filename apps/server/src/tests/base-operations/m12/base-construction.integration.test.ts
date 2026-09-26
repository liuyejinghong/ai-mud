import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AssetMutationService } from "../../../modules/ledger/asset-mutation.service.js";
import { BaseAssetService } from "../../../modules/ledger/base-asset.service.js";
import { createContentCatalog } from "../../../modules/content-catalog/catalog.service.js";
import { BaseSettlementService } from "../../../modules/industry/base-settlement.service.js";
import { ConstructionService } from "../../../modules/industry/construction.service.js";
import { IndustryRepository } from "../../../modules/industry/industry.repository.js";
import { RobotFactory } from "../../../modules/npc/robot-factory.js";
import { RobotRuntimeService } from "../../../modules/npc/robot-runtime.js";
import { BaseRepository, scopeTickTransactionToBase } from "../../../modules/world-runtime/base.repository.js";
import { BaseService } from "../../../modules/world-runtime/base.service.js";
import { createDb, type Db } from "../../../db/client.js";

// M12-Q 独立验收（G03/G04/G05/G07 主证据，真 PostgreSQL，B 线全链）：
// 组合对象按 application/base/composition.ts 的真实绑定逐端口手装，唯一差异是
// BaseService deps.clock 注入受控时钟（composition 绑 systemWorldClock），
// 结算走 BaseSettlementService.settleBases(tx, now)（B 线签名，返回处理基地数），
// 推进政策（running + 租约 + 追补上限）在 BaseRepository.lockAdvanceableBases 内。
// 场景：
//   ① createProject 于 site_a → active、40/60/80/20 步骤、inputs 全额 reserved、site reserved、回据落库；
//   ② 同 commandId 重放 → 同 projectId；
//   ③ 同站第二项目 → SITE_OCCUPIED 无半提交；
//   ④ anchor 扣到不足 → RESOURCE_INSUFFICIENT 且整事务回滚（项目 0、预留 0、回据 0）；
//   ⑤ cancel → 预留全退、site free、状态 cancelled（重放 duplicate）；
//   ⑥⑦⑧ 受控时钟昼间推进 workDone；夜间储能扣空 → blocked 'insufficient_power' 且 workDone 不动；
//        次日复电续建至 completed：site_a built、generationWPeak +5000、预留物料全消耗。
// fixture 数值来源：docs/reviews/base-operations/m12-p-contract.md §4（Q 独立抄录）。

const { Client } = pg;
const testFile = fileURLToPath(import.meta.url);
const serverRoot = dirname(dirname(dirname(dirname(dirname(testFile)))));
const drizzleDir = join(serverRoot, "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");

// 受控时钟起点：2026-09-01T08:00:00Z（UTC 小时 8 ∈ [6,18) 昼间）。
const T0 = Date.parse("2026-09-01T08:00:00.000Z");
const TICK_MS = 60_000;

const CREATE_INPUT = {
  definitionRef: { kind: "project", stableId: "install-solar-array", revision: 1 },
  siteId: ""
} as const;

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("DATABASE_URL not set; skipping base construction PG tests");
    return null;
  }
  return url;
}

function makeTempDatabaseName() {
  return `ai_mud_vitest_basecon_${process.pid}_${randomUUID().replace(/-/g, "")}`;
}

function databaseUrlForName(databaseUrl: string, databaseName: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

// Q-DEFECT-001 规避（不改业务文件的内存补丁）：0029_base_operations.sql 把 schema.ts 的
// base_projects_one_active_per_site_idx 部分唯一索引生成成了非法表约束
// `CONSTRAINT ... UNIQUE("site_id") WHERE ...`（PostgreSQL 的 UNIQUE 表约束不允许 WHERE），
// 任何逐语句回放（含 drizzle-kit migrate）都会 `syntax error at or near "WHERE"`。
// 装配临时库时把该约束改写为等价的 CREATE UNIQUE INDEX ... WHERE。
// 集成者修复迁移后，本补丁条件不再命中，自动退化为 no-op。
const BROKEN_PARTIAL_INDEX_MARKER = `CONSTRAINT "base_projects_one_active_per_site_idx" UNIQUE("site_id") WHERE`;

function patchBrokenPartialUniqueIndex(statement: string): string {
  if (!statement.includes(BROKEN_PARTIAL_INDEX_MARKER)) return statement;
  console.warn("Q-DEFECT-001: patching invalid partial-unique table constraint in 0029_base_operations.sql (in-memory only)");
  return (
    statement.replace(
      /\n\tCONSTRAINT "base_projects_one_active_per_site_idx" UNIQUE\("site_id"\) WHERE "base_projects"\."status" IN \('planned', 'active', 'paused', 'blocked', 'needs_decision'\),/,
      ""
    ) +
    `\nCREATE UNIQUE INDEX "base_projects_one_active_per_site_idx" ON "base_projects" ("site_id") WHERE "base_projects"."status" IN ('planned', 'active', 'paused', 'blocked', 'needs_decision');`
  );
}

async function createTempDatabaseFromMigrations(baseDatabaseUrl: string) {
  const databaseName = makeTempDatabaseName();
  const adminClient = new Client({ connectionString: databaseUrlForName(baseDatabaseUrl, "postgres") });
  await adminClient.connect();
  await adminClient.query(`CREATE DATABASE ${JSON.stringify(databaseName)}`);
  await adminClient.end();

  const targetUrl = databaseUrlForName(baseDatabaseUrl, databaseName);
  const client = new Client({ connectionString: targetUrl });
  await client.connect();

  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  for (const entry of journal.entries) {
    const sql = await readFile(join(drizzleDir, `${entry.tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
      await client.query(patchBrokenPartialUniqueIndex(statement));
    }
  }
  return { databaseName, targetUrl, client };
}

interface Harness {
  client: pg.Client;
  db: Db;
  dispose: () => Promise<void>;
}

async function createHarness(databaseUrl: string): Promise<Harness> {
  const { databaseName, targetUrl, client } = await createTempDatabaseFromMigrations(databaseUrl);
  const { db, close } = createDb(targetUrl);
  return {
    client,
    db,
    dispose: async () => {
      await close();
      await client.end();
      const adminClient = new Client({ connectionString: databaseUrlForName(databaseUrl, "postgres") });
      await adminClient.connect();
      await adminClient.query(`DROP DATABASE ${JSON.stringify(databaseName)} WITH (FORCE)`);
      await adminClient.end();
    }
  };
}

// ---------- 按 composition.ts 真实绑定手装的组合对象（clock 可控） ----------

interface ControlledOps {
  baseService: BaseService;
  construction: ConstructionService;
  settlement: BaseSettlementService;
}

function buildControlledOperations(db: Db, clock: { now(): Date }): ControlledOps {
  const catalog = createContentCatalog();
  // 墙钟随受控时钟走：租约判定与 delta 计算必须跟测试时间轴一致（M12-P.1 语义）。
  const baseRepo = new BaseRepository(db, clock);
  const baseAssets = new BaseAssetService(db);
  const robotRuntime = new RobotRuntimeService(db);
  const industryRepo = new IndustryRepository(db);

  const baseService = new BaseService({
    db,
    clock,
    repo: baseRepo,
    assets: baseAssets,
    robots: new RobotFactory(db),
    industryInit: industryRepo,
    catalog,
    settleConfirmedThrough: async (tx, baseId, at) => {
      scopeTickTransactionToBase(tx, baseId);
      while (await settlement.settleBases(tx, at) > 0) {
        // 分段结清已确认的控制时段。
      }
    },
    industryRead: industryRepo,
    robotRead: robotRuntime,
    manufacturingRead: {
      listJobsForBase: async () => []
    },
    cooperationRead: {
      listByBase: async () => []
    },
    economyRead: {
      getCredits: async () => 500,
      listOrdersForBase: async () => [],
      listPurchasesForBase: async () => []
    }
  });

  const construction = new ConstructionService({
    lookup: baseRepo,
    assets: baseAssets,
    sites: baseRepo,
    robots: new RobotRuntimeService(db),
    catalog,
    store: industryRepo,
    receipts: (tx) => new AssetMutationService(tx)
  });

  const settlement = new BaseSettlementService({
    clock: baseRepo,
    sites: baseRepo,
    assets: baseAssets,
    catalog,
    openIndustry: (tx) => new IndustryRepository(tx),
    openRobots: (tx) => new RobotRuntimeService(tx)
  });

  return { baseService, construction, settlement };
}

// ---------- DB 读侧 ----------

async function insertAccount(client: pg.Client, email: string): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO accounts (email, password_hash, role) VALUES ($1, 'x', 'player') RETURNING id`,
    [email]
  );
  return rows[0]!.id as string;
}

async function siteIdForKey(client: pg.Client, baseId: string, siteKey: string): Promise<string> {
  const { rows } = await client.query(
    `SELECT id FROM base_sites WHERE base_id = $1 AND site_key = $2`,
    [baseId, siteKey]
  );
  expect(rows).toHaveLength(1);
  return rows[0]!.id as string;
}

interface ProjectRow {
  id: string;
  status: string;
  current_step_index: number;
  site_id: string;
  completed_at: Date | null;
}

async function readProject(client: pg.Client, projectId: string): Promise<ProjectRow> {
  const { rows } = await client.query(
    `SELECT id, status, current_step_index, site_id, completed_at FROM base_projects WHERE id = $1`,
    [projectId]
  );
  expect(rows).toHaveLength(1);
  return rows[0] as unknown as ProjectRow;
}

interface StepRow {
  step_index: number;
  kind: string;
  group_id: string;
  status: string;
  work_required: number;
  work_done: number;
  blocked_reason: string | null;
}

async function readSteps(client: pg.Client, projectId: string): Promise<StepRow[]> {
  const { rows } = await client.query(
    `SELECT step_index, kind, group_id, status, work_required, work_done, blocked_reason
     FROM base_project_steps WHERE project_id = $1 ORDER BY step_index`,
    [projectId]
  );
  return rows as unknown as StepRow[];
}

async function readPower(client: pg.Client, baseId: string): Promise<{
  generation_w_peak: number;
  storage_wh: number;
  storage_capacity_wh: number;
}> {
  const { rows } = await client.query(
    `SELECT generation_w_peak, storage_wh, storage_capacity_wh FROM base_power_state WHERE base_id = $1`,
    [baseId]
  );
  expect(rows).toHaveLength(1);
  return rows[0] as unknown as { generation_w_peak: number; storage_wh: number; storage_capacity_wh: number };
}

async function readInventory(client: pg.Client, baseId: string): Promise<Map<string, { quantity: number; reserved: number }>> {
  const { rows } = await client.query(
    `SELECT item_id, quantity, reserved_quantity FROM base_inventory WHERE base_id = $1`,
    [baseId]
  );
  return new Map(
    rows.map((row) => [row.item_id as string, { quantity: row.quantity as number, reserved: row.reserved_quantity as number }])
  );
}

async function readSite(client: pg.Client, siteId: string): Promise<{ state: string; built_facility_ref: string | null }> {
  const { rows } = await client.query(
    `SELECT state, built_facility_ref FROM base_sites WHERE id = $1`,
    [siteId]
  );
  expect(rows).toHaveLength(1);
  return rows[0] as unknown as { state: string; built_facility_ref: string | null };
}

async function countProjects(client: pg.Client, baseId: string): Promise<number> {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM base_projects WHERE base_id = $1`, [baseId]);
  return rows[0]!.n as number;
}

async function countReceipts(client: pg.Client, actorScope: string, commandId: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM command_receipts WHERE actor_scope = $1 AND command_id = $2`,
    [actorScope, commandId]
  );
  return rows[0]!.n as number;
}

describe("base construction full chain (real PostgreSQL, controlled clock)", () => {
  let harness: Harness;
  let ops: ControlledOps;
  let nowMs = T0;
  let controlToken = "";

  beforeAll(async () => {
    const databaseUrl = requireDatabaseUrl();
    if (!databaseUrl) return;
    harness = await createHarness(databaseUrl);
  }, 120_000);

  afterAll(async () => {
    if (harness) await harness.dispose();
  }, 120_000);

  // 每个场景独立账号独立基地，避免状态串场。
  async function provisionFreshAccount(email: string): Promise<{ accountId: string; baseId: string; siteAId: string }> {
    nowMs = T0;
    const clock = { now: () => new Date(nowMs) };
    ops = buildControlledOperations(harness.db, clock);
    const accountId = await insertAccount(harness.client, email);
    const provisioned = await ops.baseService.provision({ accountId }, { commandId: randomUUID() });
    controlToken = (await ops.baseService.heartbeat({ accountId }, { action: "acquire" })).controlToken ?? "";
    const siteAId = await siteIdForKey(harness.client, provisioned.baseId, "site_a");
    return { accountId, baseId: provisioned.baseId, siteAId };
  }

  async function createProject(
    accountId: string,
    siteId: string,
    commandId = randomUUID(),
    stableId: string = CREATE_INPUT.definitionRef.stableId
  ) {
    return harness.db.transaction((tx) =>
      ops.construction.create(
        tx,
        { accountId },
        { definitionRef: { ...CREATE_INPUT.definitionRef, stableId }, siteId, commandId }
      )
    );
  }

  // 一次受控 tick：心跳续租 → settleBases(tx, now)（Δsim = 60s × speed 1）。
  async function tick(accountId: string): Promise<number> {
    nowMs += TICK_MS;
    await ops.baseService.heartbeat({ accountId }, { action: "renew", controlToken });
    return harness.db.transaction((tx) => ops.settlement.settleBases(tx, new Date(nowMs)));
  }

  it("creates the first project atomically: steps, full reservation, site reserved, receipt stored", async () => {
    if (!process.env.DATABASE_URL) return;
    const { accountId, baseId, siteAId } = await provisionFreshAccount("basecon-create@q.test");

    const commandId = randomUUID();
    const result = await createProject(accountId, siteAId, commandId);
    expect(result.duplicate).toBe(false);
    expect(result.projectId).toMatch(/^[0-9a-f-]{36}$/);

    const project = await readProject(harness.client, result.projectId);
    expect(project.status).toBe("active");
    expect(project.current_step_index).toBe(0);
    expect(project.site_id).toBe(siteAId);

    // 步骤冻结序：清场(eng 40) → 运输(transport 60) → 安装(eng 80) → 验收(survey 20)。
    expect(await readSteps(harness.client, result.projectId)).toEqual([
      { step_index: 0, kind: "site_clearing", group_id: "engineering", status: "ready", work_required: 40, work_done: 0, blocked_reason: null },
      { step_index: 1, kind: "transport", group_id: "transport", status: "pending", work_required: 60, work_done: 0, blocked_reason: null },
      { step_index: 2, kind: "installation", group_id: "engineering", status: "pending", work_required: 80, work_done: 0, blocked_reason: null },
      { step_index: 3, kind: "commissioning", group_id: "survey", status: "pending", work_required: 20, work_done: 0, blocked_reason: null }
    ]);

    // 创建即全额预留：reserved = inputs，quantity 不动。
    const inventory = await readInventory(harness.client, baseId);
    expect(inventory.get("solar_panel_set")).toEqual({ quantity: 6, reserved: 6 });
    expect(inventory.get("support_frame")).toEqual({ quantity: 6, reserved: 6 });
    expect(inventory.get("cable")).toEqual({ quantity: 2, reserved: 2 });
    expect(inventory.get("power_box")).toEqual({ quantity: 1, reserved: 1 });
    expect(inventory.get("anchor")).toEqual({ quantity: 8, reserved: 8 });
    expect(inventory.get("spare_parts")).toEqual({ quantity: 30, reserved: 0 });

    // 站点 reserved。
    expect(await readSite(harness.client, siteAId)).toEqual({ state: "reserved", built_facility_ref: null });

    // 回据落库（base 作用域，result 含 projectId）。
    expect(await countReceipts(harness.client, `base:${baseId}`, commandId)).toBe(1);
    const { rows: receipts } = await harness.client.query(
      `SELECT command_kind, result FROM command_receipts WHERE actor_scope = $1 AND command_id = $2`,
      [`base:${baseId}`, commandId]
    );
    expect(receipts[0]!.command_kind).toBe("base.createProject");
    expect((receipts[0]!.result as { projectId: string }).projectId).toBe(result.projectId);
  }, 60_000);

  it("replays the same create commandId to the same projectId", async () => {
    if (!process.env.DATABASE_URL) return;
    const { accountId, baseId, siteAId } = await provisionFreshAccount("basecon-replay@q.test");

    const commandId = randomUUID();
    const first = await createProject(accountId, siteAId, commandId);
    const second = await createProject(accountId, siteAId, commandId);

    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ projectId: first.projectId, duplicate: true });
    expect(await countProjects(harness.client, baseId)).toBe(1);
  }, 60_000);

  it("rejects a second project on the occupied site with SITE_OCCUPIED and no side effects", async () => {
    if (!process.env.DATABASE_URL) return;
    const { accountId, baseId, siteAId } = await provisionFreshAccount("basecon-occupy@q.test");

    await createProject(accountId, siteAId);

    const inventoryBefore = await readInventory(harness.client, baseId);
    await expect(createProject(accountId, siteAId, randomUUID(), "install-second-array"))
      .rejects.toMatchObject({ code: "SITE_OCCUPIED" });

    expect(await countProjects(harness.client, baseId)).toBe(1);
    expect(await readInventory(harness.client, baseId)).toEqual(inventoryBefore);
  }, 60_000);

  it("rolls back the whole create when anchor stock is short (RESOURCE_INSUFFICIENT)", async () => {
    if (!process.env.DATABASE_URL) return;
    const { accountId, baseId, siteAId } = await provisionFreshAccount("basecon-short@q.test");

    // anchor 8 → 4：前四项 inputs 预留成功后第五项失败，必须整体回滚（合同 S3）。
    await harness.client.query(
      `UPDATE base_inventory SET quantity = 4 WHERE base_id = $1 AND item_id = 'anchor'`,
      [baseId]
    );

    const commandId = randomUUID();
    await expect(createProject(accountId, siteAId, commandId)).rejects.toMatchObject({
      code: "RESOURCE_INSUFFICIENT"
    });

    // 无半提交：项目 0、预留 0、回据 0、数量不变。
    expect(await countProjects(harness.client, baseId)).toBe(0);
    const inventory = await readInventory(harness.client, baseId);
    for (const [, row] of inventory) expect(row.reserved).toBe(0);
    expect(inventory.get("anchor")).toEqual({ quantity: 4, reserved: 0 });
    expect(inventory.get("solar_panel_set")).toEqual({ quantity: 6, reserved: 0 });
    expect(await countReceipts(harness.client, `base:${baseId}`, commandId)).toBe(0);
    expect(await readSite(harness.client, siteAId)).toEqual({ state: "free", built_facility_ref: null });
  }, 60_000);

  it("cancels the project: full reservation refund, site freed, cancelled status, replay duplicates", async () => {
    if (!process.env.DATABASE_URL) return;
    const { accountId, baseId, siteAId } = await provisionFreshAccount("basecon-cancel@q.test");

    const createCommandId = randomUUID();
    const created = await createProject(accountId, siteAId, createCommandId);

    const cancelCommandId = randomUUID();
    const cancelled = await harness.db.transaction((tx) =>
      ops.construction.cancel(tx, { accountId }, { projectId: created.projectId, commandId: cancelCommandId })
    );

    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.duplicate).toBe(false);
    expect(cancelled.completed).toBe(false);
    expect(cancelled.releasedInputs).toEqual([
      { itemId: "solar_panel_set", quantity: 6 },
      { itemId: "support_frame", quantity: 6 },
      { itemId: "cable", quantity: 2 },
      { itemId: "power_box", quantity: 1 },
      { itemId: "anchor", quantity: 8 }
    ]);

    // 预留全退（数量不消耗）、站点 free、状态 cancelled。
    const inventory = await readInventory(harness.client, baseId);
    for (const [, row] of inventory) expect(row.reserved).toBe(0);
    expect(inventory.get("anchor")).toEqual({ quantity: 8, reserved: 0 });
    expect(await readSite(harness.client, siteAId)).toEqual({ state: "free", built_facility_ref: null });
    expect((await readProject(harness.client, created.projectId)).status).toBe("cancelled");

    // 取消命令幂等重放。
    const replay = await harness.db.transaction((tx) =>
      ops.construction.cancel(tx, { accountId }, { projectId: created.projectId, commandId: cancelCommandId })
    );
    expect(replay).toEqual({ ...cancelled, duplicate: true });
  }, 60_000);

  it("advances work in daylight, blocks on empty storage at night without losing work, and completes the next day (+5000W, inputs consumed)", async () => {
    if (!process.env.DATABASE_URL) return;
    const { accountId, baseId, siteAId } = await provisionFreshAccount("basecon-chain@q.test");

    const created = await createProject(accountId, siteAId);
    const projectId = created.projectId;

    // resume：time_mode=running、lastAdvancedAt=now、租约一并续上（合同 §3.1/§3.7）。
    const resumed = await ops.baseService.applyCommand({ accountId }, { command: "resume" }, controlToken);
    expect(resumed.timeMode).toBe("running");
    const { rows: baseRow } = await harness.client.query(
      `SELECT time_mode, speed, sim_time, last_advanced_at FROM bases WHERE id = $1`,
      [baseId]
    );
    expect(baseRow[0]!.time_mode).toBe("running");
    expect((baseRow[0]!.last_advanced_at as Date).getTime()).toBe(nowMs);

    // ---- ⑥ 昼间推进：3 个 tick，清场步 5 工程机 × 1/ tick → workDone 5→10→15 ----
    const progress: Array<{ workDone: number; status: string }> = [];
    for (let i = 0; i < 3; i += 1) {
      const settled = await tick(accountId);
      expect(settled).toBe(1); // B 线签名：返回处理的基地数
      const step = (await readSteps(harness.client, projectId))[0]!;
      progress.push({ workDone: step.work_done, status: step.status });
    }
    expect(progress.map((p) => p.workDone)).toEqual([5, 10, 15]);
    expect(progress.every((p) => p.status === "running")).toBe(true);
    const { rows: simRow } = await harness.client.query(`SELECT sim_time FROM bases WHERE id = $1`, [baseId]);
    const simHour = (simRow[0]!.sim_time as Date).getUTCHours();
    expect(simHour).toBeGreaterThanOrEqual(6);
    expect(simHour).toBeLessThan(18);

    // ---- ⑦ 夜间（22:00）且储能扣空：blocked 'insufficient_power'，workDone 不动 ----
    await harness.client.query(`UPDATE bases SET sim_time = $2 WHERE id = $1`, [baseId, new Date("2026-09-01T22:00:00.000Z")]);
    await harness.client.query(`UPDATE base_power_state SET storage_wh = 0 WHERE base_id = $1`, [baseId]);

    await tick(accountId);
    let steps = await readSteps(harness.client, projectId);
    expect(steps[0]!.status).toBe("blocked");
    expect(steps[0]!.blocked_reason).toBe("insufficient_power");
    expect(steps[0]!.work_done).toBe(15);

    await tick(accountId);
    steps = await readSteps(harness.client, projectId);
    expect(steps[0]!.status).toBe("blocked");
    expect(steps[0]!.blocked_reason).toBe("insufficient_power");
    expect(steps[0]!.work_done).toBe(15);
    expect((await readProject(harness.client, projectId)).status).toBe("active");

    // 缺电作业者转充电等待（保留分配，复电即复工）。
    const { rows: chargingOps } = await harness.client.query(
      `SELECT COUNT(*)::int AS n FROM robot_operators WHERE base_id = $1 AND status = 'charging'
       AND current_project_id = $2`,
      [baseId, projectId]
    );
    expect(chargingOps[0]!.n).toBeGreaterThan(0);

    // ---- ⑧ 次日昼间复电续建直至 completed ----
    await harness.client.query(
      `UPDATE bases SET sim_time = $2 WHERE id = $1`,
      [baseId, new Date("2026-09-02T07:00:00.000Z")]
    );

    let completed = false;
    for (let i = 0; i < 80 && !completed; i += 1) {
      await tick(accountId);
      completed = (await readProject(harness.client, projectId)).status === "completed";
    }
    expect(completed).toBe(true);

    // 复电后 workDone 只前进不回退（46 个工时 tick 全链真实推进）。
    steps = await readSteps(harness.client, projectId);
    expect(steps.map((s) => s.work_done)).toEqual([40, 60, 80, 20]);
    expect(steps.every((s) => s.status === "completed" && s.blocked_reason === null)).toBe(true);

    const project = await readProject(harness.client, projectId);
    expect(project.status).toBe("completed");
    expect(project.completed_at).not.toBeNull();

    // 站点 built、设施引用 = facility:solar-array-unit@1。
    expect(await readSite(harness.client, siteAId)).toEqual({
      state: "built",
      built_facility_ref: "facility:solar-array-unit@1"
    });

    // 预留物料全消耗（quantity 与 reserved 同扣），备件不动。
    const inventory = await readInventory(harness.client, baseId);
    expect(inventory.get("solar_panel_set")).toEqual({ quantity: 0, reserved: 0 });
    expect(inventory.get("support_frame")).toEqual({ quantity: 0, reserved: 0 });
    expect(inventory.get("cable")).toEqual({ quantity: 0, reserved: 0 });
    expect(inventory.get("power_box")).toEqual({ quantity: 0, reserved: 0 });
    expect(inventory.get("anchor")).toEqual({ quantity: 0, reserved: 0 });
    expect(inventory.get("spare_parts")).toEqual({ quantity: 30, reserved: 0 });

    // 项目收尾：作业者全部 idle、解除分配，12 台俱在。
    const { rows: operators } = await harness.client.query(
      `SELECT status, current_project_id FROM robot_operators WHERE base_id = $1`,
      [baseId]
    );
    expect(operators).toHaveLength(12);
    for (const operator of operators) {
      expect(operator.status).toBe("idle");
      expect(operator.current_project_id).toBeNull();
    }

    // 供电事实 +5000W：15000 → 20000（合同 m12-p-contract.md §3.3：commissioning 完成
    // → generationWPeak += outputFacility.generationWPeak，同事务）。
    // ⚠ Q-DEFECT-002：当前实现（base-settlement.service.ts 完成回路的唯一写面 +
    // industry.repository.ts savePowerState）没有任何 generation_w_peak 累加写者，
    // 完工后仍为 15000 —— 供能恒不变，G03「设施投产后供能改变」不成立。
    // 该断言按冻结合同保持红色，由集成者修复后转绿。
    const power = await readPower(harness.client, baseId);
    expect(power.generation_w_peak).toBe(20000);
    expect(power.storage_wh).toBeGreaterThanOrEqual(0);
    expect(power.storage_wh).toBeLessThanOrEqual(power.storage_capacity_wh);
  }, 120_000);
});
