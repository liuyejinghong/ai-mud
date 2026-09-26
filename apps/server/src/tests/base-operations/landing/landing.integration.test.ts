// R1-Q 真 PostgreSQL 集成验收（05-acceptance §2 核心项）：走集成组合根的完整
// landing 链——provision 种子(G01)、设施效果(G02)、勘探→采矿→送达守恒(G04)、
// 取消释放(G05)、item/robot 制造原子(G07)、维护停机与恢复(G08)、时间分片等价(G09)、
// 新档旧经济入口拒绝(G11)、命令幂等/revision(G12)。
// harness 独立抄录 m12 模式（不 import 被测方常量）；时钟推进用测试专用的
// last_advanced_at 回拨 + 真 settleBases（与 world tick 同一入口，不是 SQL 赋值奖励）。
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBaseOperations } from "../../../application/base/composition.js";
import type { Env } from "../../../config/env.js";
import { createDb, type Db } from "../../../db/client.js";

const { Client } = pg;
const testFile = fileURLToPath(import.meta.url);
const serverRoot = dirname(dirname(dirname(dirname(dirname(testFile)))));
const drizzleDir = join(serverRoot, "drizzle");

const BROKEN_PARTIAL_INDEX_MARKER = `CONSTRAINT "base_projects_one_active_per_site_idx" UNIQUE("site_id") WHERE`;

function patchBrokenPartialUniqueIndex(statement: string): string {
  if (!statement.includes(BROKEN_PARTIAL_INDEX_MARKER)) return statement;
  return (
    statement.replace(
      /\n\tCONSTRAINT "base_projects_one_active_per_site_idx" UNIQUE\("site_id"\) WHERE "base_projects"\."status" IN \('planned', 'active', 'paused', 'blocked', 'needs_decision'\),/,
      ""
    ) +
    `\nCREATE UNIQUE INDEX "base_projects_one_active_per_site_idx" ON "base_projects" ("site_id") WHERE "base_projects"."status" IN ('planned', 'active', 'paused', 'blocked', 'needs_decision');`
  );
}

function databaseUrlForName(databaseUrl: string, databaseName: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function createTempDatabase(baseDatabaseUrl: string) {
  const databaseName = `ai_mud_vitest_landing_${process.pid}_${randomUUID().replace(/-/g, "")}`;
  const adminClient = new Client({ connectionString: databaseUrlForName(baseDatabaseUrl, "postgres") });
  await adminClient.connect();
  await adminClient.query(`CREATE DATABASE ${JSON.stringify(databaseName)}`);
  await adminClient.end();
  const targetUrl = databaseUrlForName(baseDatabaseUrl, databaseName);
  const client = new Client({ connectionString: targetUrl });
  await client.connect();
  const journal = JSON.parse(
    await readFile(join(drizzleDir, "meta", "_journal.json"), "utf8")
  ) as { entries: Array<{ tag: string }> };
  for (const entry of journal.entries) {
    const sql = await readFile(join(drizzleDir, `${entry.tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
      await client.query(patchBrokenPartialUniqueIndex(statement));
    }
  }
  return { databaseName, targetUrl, client };
}

function makeEnv(): Env {
  return {
    NODE_ENV: "test",
    PLAYTEST_REGISTRATION_ENABLED: false,
    SERVER_HOST: "127.0.0.1",
    SERVER_PORT: 3000,
    DATABASE_URL: "postgres://unused-by-harness",
    SESSION_COOKIE_NAME: "ai_mud_session",
    SESSION_SECRET: "test-secret-that-is-at-least-32-bytes",
    WEB_ORIGINS: ["http://127.0.0.1:5173"],
    WORLD_TICK_ENABLED: false,
    WORLD_TICK_INTERVAL_MS: 60_000,
    WORLD_TICK_MAX_STEPS: 60,
    AI_NPC_DIALOGUE_ENABLED: false,
    AI_PROVIDER: "template",
    DEEPSEEK_BASE_URL: "https://api.deepseek.com",
    DEEPSEEK_MODEL: "deepseek-v4-flash",
    AI_DIALOGUE_TIMEOUT_MS: 8_000,
    AI_DIALOGUE_MAX_OUTPUT_TOKENS: 400,
    TYPE_SAFE_DECISION_MODE: "off",
    TYPE_SAFE_MODEL: "jev-latest",
    TYPE_SAFE_BASE_URL: "https://openrouter.ai/v1",
    AI_DAILY_TOKEN_BUDGET: null
  };
}

async function insertAccount(client: pg.Client, email: string): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO accounts (email, password_hash, role) VALUES ($1, 'x', 'player') RETURNING id`,
    [email]
  );
  return rows[0]!.id as string;
}

async function inventoryMap(client: pg.Client, baseId: string): Promise<Map<string, { quantity: number; reserved: number }>> {
  const { rows } = await client.query(
    `SELECT item_id, quantity, reserved_quantity FROM base_inventory WHERE base_id = $1`,
    [baseId]
  );
  return new Map(rows.map((row) => [row.item_id as string, {
    quantity: row.quantity as number,
    reserved: row.reserved_quantity as number
  }]));
}

interface OperatorInfo {
  operatorId: string;
  deviceDefId: string;
  groupId: string;
  batteryWh: number;
}

async function operatorsByGroup(client: pg.Client, baseId: string, group: string): Promise<OperatorInfo[]> {
  const { rows } = await client.query(
    `SELECT o.id, d.device_def_id, o.group_id, o.battery_wh
     FROM robot_operators o JOIN base_devices d ON d.id = o.device_id
     WHERE o.base_id = $1 AND o.group_id = $2 ORDER BY o.id`,
    [baseId, group]
  );
  return rows.map((row) => ({
    operatorId: row.id as string,
    deviceDefId: row.device_def_id as string,
    groupId: row.group_id as string,
    batteryWh: row.battery_wh as number
  }));
}

describe("R1 landing 全链验收（真实 PostgreSQL）", () => {
  let harness: { client: pg.Client; db: Db; dispose: () => Promise<void> };
  let ops: ReturnType<typeof createBaseOperations>;
  let accountId: string;
  let baseId: string;
  let surveyor: OperatorInfo;
  let builders: OperatorInfo[];
  let haulers: OperatorInfo[];
  // R1 #5：landing 写命令需要有效控制租约——测试用真实 heartbeat 取得（非 SQL 伪造）。
  let leaseToken: string | null = null;
  const acquireLease = async (): Promise<string> => {
    const result = await ops.session.clock.heartbeat(
      { accountId },
      { action: "acquire" }
    );
    leaseToken = result.controlToken;
    return result.controlToken!;
  };

  // 推进 N 个模拟分钟：回拨 last_advanced_at（测试专用时钟控制）→ 真结算入口补算。
  async function advanceMinutes(minutes: number): Promise<void> {
    const now = new Date();
    await harness.client.query(
      `UPDATE bases SET time_mode = 'running', last_advanced_at = $1 WHERE id = $2`,
      [new Date(now.getTime() - minutes * 60_000), baseId]
    );
    const token = leaseToken ?? `r1-test-${baseId}`;
    const leaseUntil = new Date(now.getTime() + 300_000); // 租约有效期 5 分钟（命令守卫要验未过期）
    await harness.client.query(
      `INSERT INTO base_control_leases (base_id, lease_token, lease_until, updated_at)
       VALUES ($1, $4, $2, $3)
       ON CONFLICT (base_id) DO UPDATE SET updated_at = $3, lease_until = $2, lease_token = $4`,
      [baseId, leaseUntil, now, token]
    );
    let guard = 0;
    while (guard < 200) {
      const advanced = await harness.db.transaction((tx) => ops.settlement.settleBases(tx, new Date()));
      if (advanced === 0) break;
      guard += 1;
    }
  }

  async function snapshot() {
    return ops.session.snapshot.execute({ accountId });
  }

  // 逐分钟推进并在槽维护停机时自动维护（模拟玩家在 8–10 批窗口内的维护操作；
  // 维护本身仍是真实命令：消耗备件、清零计数）。
  async function advanceWithMaintenance(minutes: number): Promise<void> {
    for (let index = 0; index < minutes; index += 1) {
      await advanceMinutes(1);
      const snap = await snapshot();
      const slot = snap.productionSlots?.[0];
      if (slot?.maintenanceBlocked) {
        await ops.production.maintain.execute({ accountId }, {
          siteId: slot.siteId, commandId: randomUUID(), controlToken: leaseToken ?? undefined
        });
      }
    }
  }

  async function createProject(stableId: string, siteId: string, commandId = randomUUID()) {
    const snap = await snapshot();
    const template = snap.buildableProjects.find((project) => project.definitionRef.stableId === stableId);
    if (!template) throw new Error(`template ${stableId} not buildable`);
    return ops.projects.create.execute({ accountId }, {
      definitionRef: { kind: "project", stableId, revision: template.definitionRef.revision },
      siteId,
      commandId
    });
  }

  async function siteIdByKey(key: string): Promise<string> {
    const snap = await snapshot();
    const site = snap.sites.find((entry) => entry.siteKey === key);
    if (!site) throw new Error(`site ${key} missing`);
    return site.siteId;
  }

  async function nodeIdByKey(key: string): Promise<string> {
    const snap = await snapshot();
    const node = snap.resourceNodes?.find((entry) => entry.nodeKey === key);
    if (!node) throw new Error(`node ${key} missing`);
    return node.nodeId;
  }

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.warn("DATABASE_URL not set; skipping landing PG tests");
      return;
    }
    const { databaseName, targetUrl, client } = await createTempDatabase(databaseUrl);
    const { db, close } = createDb(targetUrl);
    harness = {
      client,
      db,
      dispose: async () => {
        await close();
        await client.end();
        const admin = new Client({ connectionString: databaseUrlForName(databaseUrl, "postgres") });
        await admin.connect();
        await admin.query(`DROP DATABASE ${JSON.stringify(databaseName)} WITH (FORCE)`);
        await admin.end();
      }
    };
    ops = createBaseOperations({ db: harness.db, config: makeEnv() });
    accountId = await insertAccount(harness.client, "r1-landing@q.test");
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.dispose();
  }, 120_000);

  it("G01 新档种子与幂等：landing 货单一次落全，重复 provision 不补种，credits 显式 0", async () => {
    if (!process.env.DATABASE_URL) return;
    const result = await ops.session.provision.execute({ accountId }, { commandId: randomUUID() });
    baseId = result.baseId;
    expect(result.duplicate).toBe(false);

    const snap = await snapshot();
    expect(snap.activeContentRelease).toBe("yudian-landing-1");
    expect(snap.capabilities).toEqual([]);
    expect(snap.credits).toBe(0); // 新档显式 0，不沿用旧默认 1200
    // 唯一 built 站点是着陆器；常设设施全部未建成。
    const built = snap.sites.filter((site) => site.state === "built").map((site) => site.siteKey);
    expect(built).toEqual(["lander"]);
    expect(snap.sites.filter((site) => site.state === "free").length).toBe(10);
    // 12 台设备：驮运 4 / 筑垒 5 / 望山 3。
    expect(snap.devices.length).toBe(12);
    expect(snap.devices.filter((device) => device.groupId === "transport").length).toBe(4);
    expect(snap.devices.filter((device) => device.groupId === "engineering").length).toBe(5);
    expect(snap.devices.filter((device) => device.groupId === "survey").length).toBe(3);
    // 电力：太阳能峰值 0，应急 1000，充电上限 400，储电 1000/2000。
    expect(snap.power.generationWPeak).toBe(0);
    expect(snap.power.emergencyGenerationW).toBe(1000);
    expect(snap.power.chargeLimitW).toBe(400);
    expect(snap.power.storageWh).toBe(1000);
    expect(snap.power.storageCapacityWh).toBe(2000);
    // 库存：六套件各 1、控制器/光伏 12、备件 6、无矿石无材料。
    const inventory = await inventoryMap(harness.client, baseId);
    for (const kit of ["solar_kit", "warehouse_kit", "storage_kit", "charging_kit", "processing_kit", "maintenance_kit"]) {
      expect(inventory.get(kit)?.quantity).toBe(1);
    }
    expect(inventory.get("controller")?.quantity).toBe(12);
    expect(inventory.get("pv_cell")?.quantity).toBe(12);
    expect(inventory.get("spare_part")?.quantity).toBe(6);
    expect(inventory.has("iron_ore")).toBe(false);
    // 资源节点：铁铜各 200，未勘探（矿种/储量不显示）。
    const nodes = snap.resourceNodes ?? [];
    expect(nodes.length).toBe(2);
    expect(nodes.every((node) => !node.discovered && node.itemId === null && node.remainingQuantity === null)).toBe(true);
    // 幂等重放：同账号收敛回原基地，不补种。
    const replay = await ops.session.provision.execute({ accountId }, { commandId: randomUUID() });
    expect(replay.baseId).toBe(baseId);
    expect(replay.duplicate).toBe(true);
    const { rows: deviceCount } = await harness.client.query(
      `SELECT COUNT(*)::int AS n FROM base_devices WHERE base_id = $1`, [baseId]
    );
    expect(deviceCount[0]!.n).toBe(12);

    surveyor = (await operatorsByGroup(harness.client, baseId, "survey"))[0]!;
    builders = await operatorsByGroup(harness.client, baseId, "engineering");
    haulers = await operatorsByGroup(harness.client, baseId, "transport");
    expect(builders.length).toBe(5);
    expect(haulers.length).toBe(4);
    await acquireLease();
  });

  it("G11 新档旧经济入口：直接调用旧采购/接单被后端拒绝（CAPABILITY_UNAVAILABLE）", async () => {
    if (!process.env.DATABASE_URL) return;
    await expect(
      ops.economy.purchase.execute({ accountId }, { itemId: "solar_panel_set", quantity: 1, commandId: randomUUID() })
    ).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
    const snap = await snapshot();
    expect(snap.orders).toEqual([]); // landing 无订单模板，tick 不生成回购单
  });

  it("G02 首太阳能安装：套件消耗、发电 0→4000、无重复加成；前置校验生效", async () => {
    if (!process.env.DATABASE_URL) return;
    // 前置：仓储棚在太阳能未建成时被拒。
    await expect(
      createProject("landing-install-warehouse", await siteIdByKey("install_warehouse"))
    ).rejects.toMatchObject({ code: "REQUIREMENTS_NOT_MET" });

    await createProject("landing-install-solar", await siteIdByKey("install_solar"));
    // 套件在开工时预留。
    let inventory = await inventoryMap(harness.client, baseId);
    expect(inventory.get("solar_kit")).toMatchObject({ quantity: 1, reserved: 1 });
    // 2 台筑垒 × 1 点：1 个基地分钟完工。
    await advanceMinutes(1);
    inventory = await inventoryMap(harness.client, baseId);
    expect(inventory.get("solar_kit")).toMatchObject({ quantity: 0, reserved: 0 });
    const snap = await snapshot();
    expect(snap.power.generationWPeak).toBe(4000);
    expect(snap.sites.find((site) => site.siteKey === "install_solar")?.state).toBe("built");
    // 再推进一分钟：完工效果不重复（无第二次 +4000）。
    await advanceMinutes(1);
    expect((await snapshot()).power.generationWPeak).toBe(4000);
    // 建成后仓储棚可开工并完工（typed 能力授予路径）。
    await createProject("landing-install-warehouse", await siteIdByKey("install_warehouse"));
    await advanceMinutes(1);
    const withWarehouse = await snapshot();
    expect(withWarehouse.sites.find((site) => site.siteKey === "install_warehouse")?.state).toBe("built");
    // 储能间：容量 2000→7000，但存量不凭空增加。
    const storageBefore = withWarehouse.power.storageWh;
    await createProject("landing-install-storage", await siteIdByKey("install_storage"));
    await advanceMinutes(1);
    const withStorage = await snapshot();
    expect(withStorage.power.storageCapacityWh).toBe(7000);
    expect(withStorage.power.storageWh).toBeLessThanOrEqual(storageBefore + 800);
    // 充电区：充电上限 400→2000，不发电。
    await createProject("landing-install-charging", await siteIdByKey("install_charging"));
    await advanceMinutes(1);
    const withCharging = await snapshot();
    expect(withCharging.power.chargeLimitW).toBe(2000);
    expect(withCharging.power.generationWPeak).toBe(4000);
  });

  it("G04 勘探→采矿→送达：未勘探不可采、未送达不入仓、节点守恒、ordinal 唯一", async () => {
    if (!process.env.DATABASE_URL) return;
    const ironNodeId = await nodeIdByKey("iron_north");
    // 未勘探不可下采矿单。
    await expect(
      ops.extraction.createMining.execute({ accountId }, {
        nodeId: ironNodeId, batches: 1,
        builderOperatorIds: [builders[0]!.operatorId],
        haulerOperatorId: haulers[0]!.operatorId,
        commandId: randomUUID(),
        controlToken: leaseToken ?? undefined
      })
    ).rejects.toMatchObject({ code: "REQUIREMENTS_NOT_MET" });

    // 勘探：2 分钟（望山 2 工作点），揭示但不发物资。
    await ops.extraction.survey.execute({ accountId }, {
      nodeId: ironNodeId, operatorId: surveyor.operatorId, commandId: randomUUID(),
      controlToken: leaseToken ?? undefined
    });
    let inventory = await inventoryMap(harness.client, baseId);
    expect(inventory.has("iron_ore")).toBe(false);
    await advanceMinutes(2);
    const surveyed = await snapshot();
    const ironNode = surveyed.resourceNodes!.find((node) => node.nodeKey === "iron_north")!;
    expect(ironNode.discovered).toBe(true);
    expect(ironNode.itemId).toBe("iron_ore");
    expect(ironNode.remainingQuantity).toBe(200);

    // 采矿 4 批（预留 16）：2 筑垒 + 1 驮运；每批 1 分钟采出 + 1 分钟送达。
    const mine = await ops.extraction.createMining.execute({ accountId }, {
      nodeId: ironNodeId, batches: 4,
      builderOperatorIds: [builders[0]!.operatorId, builders[1]!.operatorId],
      haulerOperatorId: haulers[0]!.operatorId,
      commandId: randomUUID(),
      controlToken: leaseToken ?? undefined
    });
    expect(mine).toMatchObject({ status: "active", reservedOre: 16, duplicate: false });
    // 中途检查：第 1 分钟采出未送达 → 库存仍无矿，现场货物 4。
    await advanceMinutes(1);
    inventory = await inventoryMap(harness.client, baseId);
    expect(inventory.get("iron_ore")).toBeUndefined();
    const { rows: onsite } = await harness.client.query(
      `SELECT status, COUNT(*)::int AS n FROM base_extraction_outputs WHERE job_id = $1 GROUP BY status`,
      [mine.jobId]
    );
    expect(onsite).toEqual([{ status: "extracted", n: 1 }]);

    await advanceMinutes(7);
    inventory = await inventoryMap(harness.client, baseId);
    expect(inventory.get("iron_ore")).toMatchObject({ quantity: 16, reserved: 0 });
    const done = await snapshot();
    const ironAfter = done.resourceNodes!.find((node) => node.nodeKey === "iron_north")!;
    expect(ironAfter.remainingQuantity).toBe(184); // 200 − 16，守恒
    expect(ironAfter.reservedQuantity).toBe(0);
    // 全部 ordinal delivered，无重复（jobId+ordinal 唯一）。
    const { rows: outputs } = await harness.client.query(
      `SELECT ordinal, status, item_id, quantity FROM base_extraction_outputs WHERE job_id = $1 ORDER BY ordinal`,
      [mine.jobId]
    );
    expect(outputs.map((row) => [row.ordinal, row.status])).toEqual([
      [1, "delivered"], [2, "delivered"], [3, "delivered"], [4, "delivered"]
    ]);
    expect(outputs.every((row) => row.item_id === "iron_ore" && row.quantity === 4)).toBe(true);
    // 铜矿 1 批，为后续线缆。
    await ops.extraction.survey.execute({ accountId }, {
      nodeId: await nodeIdByKey("copper_ridge"), operatorId: surveyor.operatorId, commandId: randomUUID(),
      controlToken: leaseToken ?? undefined
    });
    await advanceMinutes(2);
    const copperMine = await ops.extraction.createMining.execute({ accountId }, {
      nodeId: await nodeIdByKey("copper_ridge"), batches: 1,
      builderOperatorIds: [builders[0]!.operatorId, builders[1]!.operatorId],
      haulerOperatorId: haulers[0]!.operatorId,
      commandId: randomUUID(),
      controlToken: leaseToken ?? undefined
    });
    await advanceMinutes(2);
    inventory = await inventoryMap(harness.client, baseId);
    expect(inventory.get("copper_ore")).toMatchObject({ quantity: 4, reserved: 0 });
    void copperMine;
  });

  it("G05 采矿取消：未采部分释放预留与设备", async () => {
    if (!process.env.DATABASE_URL) return;
    const ironNodeId = await nodeIdByKey("iron_north");
    const mine = await ops.extraction.createMining.execute({ accountId }, {
      nodeId: ironNodeId, batches: 2,
      builderOperatorIds: [builders[2]!.operatorId, builders[3]!.operatorId],
      haulerOperatorId: haulers[1]!.operatorId,
      commandId: randomUUID(),
      controlToken: leaseToken ?? undefined
    });
    const before = (await snapshot()).resourceNodes!.find((node) => node.nodeKey === "iron_north")!;
    expect(before.reservedQuantity).toBe(8);
    const cancelled = await ops.extraction.cancel.execute({ accountId }, {
      jobId: mine.jobId, commandId: randomUUID(), controlToken: leaseToken ?? undefined
    });
    expect(cancelled).toMatchObject({ status: "cancelled", releasedOre: 8 });
    const after = (await snapshot()).resourceNodes!.find((node) => node.nodeKey === "iron_north")!;
    expect(after.reservedQuantity).toBe(0);
    expect(after.remainingQuantity).toBe(before.remainingQuantity);
    // 设备释放：采矿分配清空，可立即投入其他单。
    const { rows: assigned } = await harness.client.query(
      `SELECT COUNT(*)::int AS n FROM robot_operators WHERE base_id = $1 AND current_extraction_job_id IS NOT NULL`,
      [baseId]
    );
    expect(assigned[0]!.n).toBe(0);
  });

  it("G07/G08 加工与维护：item 产出原子、槽 10 批停机、维护消耗备件、能源路线 15 批账本", async () => {
    if (!process.env.DATABASE_URL) return;
    // 加工间 + 维护工位（前置仓储棚已建成）。
    await createProject("landing-install-processing", await siteIdByKey("install_processing"));
    await createProject("landing-install-maintenance", await siteIdByKey("install_maintenance"));
    await advanceMinutes(1);
    const snapWithSlots = await snapshot();
    expect(snapWithSlots.productionSlots?.length).toBe(1); // 设施完成同事务建槽
    expect(snapWithSlots.productionSlots?.[0]).toMatchObject({
      batchesSinceMaintenance: 0, maintenanceBlocked: false
    });

    // 冶炼铁 8 批（16 矿）。
    const smelt = await ops.manufacturingJobs.create.execute({ accountId }, {
      recipeRef: { kind: "recipe", stableId: "landing-smelt-iron", revision: 1 },
      outputsPlanned: 8, commandId: randomUUID()
    });
    expect(smelt.duplicate).toBe(false);
    // 全额预留：16 铁矿。
    let inventory = await inventoryMap(harness.client, baseId);
    expect(inventory.get("iron_ore")).toMatchObject({ quantity: 16, reserved: 16 });

    // 每槽每分钟至多 ratedW=2000 W·min = 恰好 1 批；8 批需 8 个基地分钟。
    await advanceMinutes(9);
    // 第 8 批完成后不到维护窗口（8 起可维护），继续下一单。
    inventory = await inventoryMap(harness.client, baseId);
    expect(inventory.get("iron_ingot")?.quantity).toBe(8);
    expect(inventory.get("iron_ore")).toMatchObject({ quantity: 0, reserved: 0 });
    const { rows: smeltOutputs } = await harness.client.query(
      `SELECT ordinal, output_kind, item_id, quantity FROM base_manufacturing_outputs WHERE job_id = $1 ORDER BY ordinal`,
      [smelt.jobId]
    );
    expect(smeltOutputs.length).toBe(8);
    expect(smeltOutputs.every((row) => row.output_kind === "item" && row.item_id === "iron_ingot" && row.quantity === 1)).toBe(true);

    // 能源路线 15 批 = 铁 8 + 结构件 4 + 铜 2 + 线缆 1；第 10 批（结构件第 2 批）
    // 后槽停机等待维护——先验证停机，再维护，再完成剩余批次。
    await ops.manufacturingJobs.create.execute({ accountId }, {
      recipeRef: { kind: "recipe", stableId: "landing-make-structural", revision: 1 },
      outputsPlanned: 4, commandId: randomUUID()
    });
    await advanceMinutes(2);
    const blockedSnap = await snapshot();
    expect(blockedSnap.productionSlots?.[0]).toMatchObject({
      batchesSinceMaintenance: 10,
      maintenanceBlocked: true
    });
    // 停机时第 11 批不产出：结构件仍只有 2。
    expect((await inventoryMap(harness.client, baseId)).get("structural_frame")?.quantity).toBe(2);

    const spareBefore = (await inventoryMap(harness.client, baseId)).get("spare_part")!.quantity;
    const processingSiteId = blockedSnap.productionSlots![0]!.siteId;
    const maintained = await ops.production.maintain.execute({ accountId }, {
      siteId: processingSiteId, commandId: randomUUID(), controlToken: leaseToken ?? undefined
    });
    expect(maintained).toMatchObject({ batchesSinceMaintenance: 0, duplicate: false });
    const inventoryAfterMaintain = await inventoryMap(harness.client, baseId);
    expect(inventoryAfterMaintain.get("spare_part")?.quantity).toBe(spareBefore - 1); // 恰好 1 备件
    expect((await snapshot()).productionSlots?.[0]?.maintenanceBlocked).toBe(false);

    // 维护后完成剩余批次（结构件 2 + 铜 2 + 线缆 1，FIFO 同槽）。
    await advanceMinutes(3);
    // 铜料 2 批（预留整单输入 4 铜）；铜料产出后再下线缆单（其输入在创建时预留）。
    await ops.manufacturingJobs.create.execute({ accountId }, {
      recipeRef: { kind: "recipe", stableId: "landing-smelt-copper", revision: 1 },
      outputsPlanned: 2, commandId: randomUUID()
    });
    await advanceMinutes(2);
    await ops.manufacturingJobs.create.execute({ accountId }, {
      recipeRef: { kind: "recipe", stableId: "landing-make-cable", revision: 1 },
      outputsPlanned: 1, commandId: randomUUID()
    });
    await advanceMinutes(1);
    inventory = await inventoryMap(harness.client, baseId);
    expect(inventory.get("structural_frame")).toMatchObject({ quantity: 4, reserved: 0 });
    expect(inventory.get("copper_ingot")).toMatchObject({ quantity: 1, reserved: 0 }); // 2 − 线缆 1
    expect(inventory.get("wire_cable")).toMatchObject({ quantity: 2, reserved: 0 });
    // 能源路线终局账本：铁矿 0、铜矿 0、铜料 1；备件 6−1=5。
    expect(inventory.get("iron_ore")).toMatchObject({ quantity: 0, reserved: 0 });
    expect(inventory.get("copper_ore")).toMatchObject({ quantity: 0, reserved: 0 });
    expect(inventory.get("spare_part")?.quantity).toBe(5);

    // 用自产部件真正完成首能源扩建：第二座太阳能（发电 4000→8000、光伏片 12→6）。
    await createProject("landing-expand-solar", await siteIdByKey("expand_a"));
    inventory = await inventoryMap(harness.client, baseId);
    expect(inventory.get("structural_frame")).toMatchObject({ quantity: 4, reserved: 4 });
    await advanceMinutes(4); // 安装 4 点（2 筑垒 2 分钟）+ 验收 2 点（1 望山 2 分钟）
    const expanded = await snapshot();
    expect(expanded.power.generationWPeak).toBe(8000);
    inventory = await inventoryMap(harness.client, baseId);
    expect(inventory.get("pv_cell")).toMatchObject({ quantity: 6, reserved: 0 });
    expect(expanded.projects.some(
      (project) => project.definitionRef.stableId === "landing-expand-solar" && project.status === "completed"
    )).toBe(true);
  });

  it("G08b 组装驮运（robot 产出）：初始电量 0，真实入库设备资产", async () => {
    if (!process.env.DATABASE_URL) return;
    // 补材料：再采 16 铁矿 → 8 铁料 → 4 结构件；再采 2 铜 → 1 铜料 → 2 线缆。
    const ironNodeId = await nodeIdByKey("iron_north");
    const copperNodeId = await nodeIdByKey("copper_ridge");
    for (const [nodeId, batches] of [[ironNodeId, 4], [copperNodeId, 1]] as const) {
      const mine = await ops.extraction.createMining.execute({ accountId }, {
        nodeId, batches,
        builderOperatorIds: [builders[0]!.operatorId, builders[1]!.operatorId],
        haulerOperatorId: haulers[0]!.operatorId,
        commandId: randomUUID(),
        controlToken: leaseToken ?? undefined
      });
      await advanceMinutes(batches * 2 + 1);
      void mine;
    }
    let inventory = await inventoryMap(harness.client, baseId);
    expect(inventory.get("iron_ore")?.quantity).toBe(16);
    expect(inventory.get("copper_ore")?.quantity).toBe(4);
    await ops.manufacturingJobs.create.execute({ accountId }, {
      recipeRef: { kind: "recipe", stableId: "landing-smelt-iron", revision: 1 },
      outputsPlanned: 8, commandId: randomUUID()
    });
    await advanceWithMaintenance(9);
    await ops.manufacturingJobs.create.execute({ accountId }, {
      recipeRef: { kind: "recipe", stableId: "landing-smelt-copper", revision: 1 },
      outputsPlanned: 2, commandId: randomUUID()
    });
    await ops.manufacturingJobs.create.execute({ accountId }, {
      recipeRef: { kind: "recipe", stableId: "landing-make-structural", revision: 1 },
      outputsPlanned: 4, commandId: randomUUID()
    });
    await ops.manufacturingJobs.create.execute({ accountId }, {
      recipeRef: { kind: "recipe", stableId: "landing-make-cable", revision: 1 },
      outputsPlanned: 1, commandId: randomUUID()
    });
    await advanceWithMaintenance(10);
    inventory = await inventoryMap(harness.client, baseId);
    expect(inventory.get("structural_frame")?.quantity).toBeGreaterThanOrEqual(4);

    const assemble = await ops.manufacturingJobs.create.execute({ accountId }, {
      recipeRef: { kind: "recipe", stableId: "landing-assemble-hauler", revision: 1 },
      outputsPlanned: 1, commandId: randomUUID()
    });
    // 组装 3 分钟/台（2000W×3 = 6000 W·min）。
    await advanceWithMaintenance(4);
    const { rows: robotOutputs } = await harness.client.query(
      `SELECT output_kind, device_id, operator_id FROM base_manufacturing_outputs WHERE job_id = $1`,
      [assemble.jobId]
    );
    expect(robotOutputs.length).toBe(1);
    expect(robotOutputs[0]!.output_kind).toBe("robot");
    expect(robotOutputs[0]!.device_id).toBeTruthy();
    // 新造设备出厂电量 0：其后仅靠充电上限内的真实充电增长（≤6 Wh/分钟 × 剩余分钟）。
    const { rows: newOperator } = await harness.client.query(
      `SELECT battery_wh FROM robot_operators WHERE id = $1`,
      [robotOutputs[0]!.operator_id]
    );
    expect(newOperator[0]!.battery_wh as number).toBeLessThanOrEqual(24);
    expect(newOperator[0]!.battery_wh as number).toBeGreaterThanOrEqual(0);
    const snap = await snapshot();
    expect(snap.devices.length).toBe(13);
  });

  it("G12 命令幂等与 revision：同 commandId 重放返回原结果，不同 payload 冲突，过期 revision 拒绝", async () => {
    if (!process.env.DATABASE_URL) return;
    const ironNodeId = await nodeIdByKey("iron_north");
    const commandId = randomUUID();
    const payload = {
      nodeId: ironNodeId, batches: 1,
      builderOperatorIds: [builders[4]!.operatorId],
      haulerOperatorId: haulers[2]!.operatorId
    };
    const first = await ops.extraction.createMining.execute({ accountId }, {
      ...payload, commandId, controlToken: leaseToken ?? undefined
    });
    const replay = await ops.extraction.createMining.execute({ accountId }, {
      ...payload, commandId, controlToken: leaseToken ?? undefined
    });
    expect(replay.jobId).toBe(first.jobId);
    expect(replay.duplicate).toBe(true);
    expect(replay.reservedOre).toBe(4); // 重放读回原结果，不再预留
    // 相同 commandId 不同 payload → IDEMPOTENCY_CONFLICT。
    await expect(
      ops.extraction.createMining.execute({ accountId }, {
        ...payload, batches: 2, commandId, controlToken: leaseToken ?? undefined
      })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    // 清场：取消该单，释放设备。
    await ops.extraction.cancel.execute({ accountId }, { jobId: first.jobId, commandId: randomUUID(), controlToken: leaseToken ?? undefined });
    // 过期 revision → REVISION_EXPIRED。
    const snap = await snapshot();
    await expect(
      ops.production.powerPolicy.execute({ accountId }, {
        priority: "charging", commandId: randomUUID(),
        expectedBaseRevision: snap.baseRevision - 1, controlToken: leaseToken ?? undefined
      })
    ).rejects.toMatchObject({ code: "REVISION_EXPIRED" });
    // 电力策略命令成功并回读。
    const policy = await ops.production.powerPolicy.execute({ accountId }, {
      priority: "charging", commandId: randomUUID(),
      expectedBaseRevision: snap.baseRevision, controlToken: leaseToken ?? undefined
    });
    expect(policy).toMatchObject({ priority: "charging", duplicate: false });
    expect((await snapshot()).power.powerPolicy).toBe("charging");
  });

  it("G09 时间分片等价：1×10 分钟与 10×1 分钟同结果（冻结精度）", async () => {
    if (!process.env.DATABASE_URL) return;
    // 两个新账号各建一档，装首太阳能后分别以两种切分推进 10 分钟。
    const results: number[] = [];
    for (const mode of ["one-shot", "minute-by-minute"] as const) {
      const account = await insertAccount(harness.client, `r1-slice-${mode}-${randomUUID().slice(0, 8)}@q.test`);
      await ops.session.provision.execute({ accountId: account }, { commandId: randomUUID() });
      const savedBase = baseId;
      const savedAccount = accountId;
      baseId = (await harness.client.query(
        `SELECT b.id FROM bases b WHERE b.account_id = $1`, [account]
      )).rows[0]!.id as string;
      accountId = account;
      await acquireLease();
      await createProject("landing-install-solar", await siteIdByKey("install_solar"));
      if (mode === "one-shot") {
        await advanceMinutes(10);
      } else {
        for (let index = 0; index < 10; index += 1) await advanceMinutes(1);
      }
      const snap = await snapshot();
      results.push(snap.power.storageWh);
      expect(snap.power.generationWPeak).toBe(4000);
      baseId = savedBase;
      accountId = savedAccount;
    }
    expect(results[0]).toBe(results[1]);
  });
});
