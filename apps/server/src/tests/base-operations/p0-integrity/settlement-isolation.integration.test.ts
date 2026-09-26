// 2026-09-25 第 0 阶段完整性修复（车道 A：B001 / B008）真 PG 回归。
// 评审：docs/reviews/base-operations/2026-09-25-design-review-v101（ARCH-domain-01/02，R06-RT3 行为级复现）。
// 本文件锁住的不变量（均经 createBaseOperations 的真实装配 + 真实 settleBases）：
//   A1 制造结算按基地隔离：暂停 / 租约失效基地的工单、库存、设备、电力在别的基地结算时逐字段不变；
//   A2 产速与全服运行基地数无关：同一基地同一 Δsim，1 / 2 / 5 个运行基地时结果相同；
//   A3 同基地多张工单按 FIFO 分摊本子 tick 的制造能量预算，合计不超过预算；
//   A4 制造取能从本基地储能扣减并计入 lastLoadW（m13-p-contract §4.2 同电力池、1500W）；
//   A6 开工请求（含同 commandId 幂等重放）不在请求路径触发任何结算副作用（ARCH-domain-02）。
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBaseOperations } from "../../../application/base/composition.js";
import { loadEnv } from "../../../config/env.js";
import * as schema from "../../../db/schema.js";
import { BaseRepository } from "../../../modules/world-runtime/base.repository.js";

const DATABASE_URL = process.env.DATABASE_URL;
const d = DATABASE_URL ? describe : describe.skip;

const here = dirname(fileURLToPath(import.meta.url));
const dbName = `ai_mud_vitest_p0int_${process.pid}_${randomUUID().slice(0, 8)}`;

let migPool: pg.Pool;
let client: pg.PoolClient;
let db: ReturnType<typeof drizzle<typeof schema>>;
let ops: ReturnType<typeof createBaseOperations>;

// 夜间（UTC 22 时）：发电为 0，储能变化只由负载决定，便于逐位断言。
const NIGHT = new Date("2026-09-01T22:00:00.000Z");
const MINUTE_MS = 60_000;

const RECIPES = {
  "manufacture-yd-s1": {
    workPerUnit: 20,
    inputs: [
      { itemId: "spare_parts", quantity: 4 },
      { itemId: "anchor", quantity: 3 }
    ]
  },
  "manufacture-yd-h1": {
    workPerUnit: 30,
    inputs: [
      { itemId: "support_frame", quantity: 4 },
      { itemId: "spare_parts", quantity: 6 },
      { itemId: "power_box", quantity: 1 }
    ]
  }
} as const;

type RecipeId = keyof typeof RECIPES;

interface SeedJob {
  recipe: RecipeId;
  outputsPlanned: number;
  currentUnitWorkDone?: number;
  createdAt?: Date;
}

interface SeedBaseOptions {
  label: string;
  timeMode: "running" | "paused";
  // null = 无租约；过去时间 = 租约失效
  leaseUntil: Date | null;
  lastAdvancedAt: Date;
  simTime?: Date;
  storageWh?: number;
  jobs: SeedJob[];
}

interface SeededBase {
  accountId: string;
  baseId: string;
  jobIds: string[];
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  const adminPool = new pg.Pool({ connectionString: DATABASE_URL });
  const adminClient = await adminPool.connect();
  await adminClient.query(`CREATE DATABASE "${dbName}"`);
  adminClient.release();
  await adminPool.end();

  migPool = new pg.Pool({
    connectionString: `${DATABASE_URL.substring(0, DATABASE_URL.lastIndexOf("/") + 1)}${dbName}`
  });
  const migClient = await migPool.connect();
  const journal = JSON.parse(readFileSync(join(here, "../../../../drizzle/meta/_journal.json"), "utf8"));
  const allSql = (journal.entries as Array<{ tag: string }>)
    .map((entry) => readFileSync(join(here, `../../../../drizzle/${entry.tag}.sql`), "utf8"))
    .join("\n--> statement-breakpoint\n");
  await migClient.query(allSql);
  migClient.release();

  client = await migPool.connect();
  db = drizzle(migPool, { schema });
  ops = createBaseOperations({
    db,
    config: loadEnv({
      DATABASE_URL: "postgres://localhost/test",
      SESSION_SECRET: "x".repeat(32),
      NODE_ENV: "test"
    })
  });
}, 120_000);

afterAll(async () => {
  if (!DATABASE_URL || !client) return;
  client.release();
  await migPool.end();
  const cleanup = new pg.Pool({ connectionString: DATABASE_URL });
  const c = await cleanup.connect();
  await c.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
  c.release();
  await cleanup.end();
});

// 每个用例只让自己的基地参与推进：先把库里既有基地全部置暂停。
beforeEach(async () => {
  if (!client) return;
  await client.query(`UPDATE bases SET time_mode = 'paused'`);
});

async function seedBase(options: SeedBaseOptions): Promise<SeededBase> {
  const accountId = randomUUID();
  const baseId = randomUUID();
  const jobIds = options.jobs.map(() => randomUUID());
  const reserved = new Map<string, number>();
  for (const job of options.jobs) {
    for (const input of RECIPES[job.recipe].inputs) {
      reserved.set(input.itemId, (reserved.get(input.itemId) ?? 0) + input.quantity * job.outputsPlanned);
    }
  }

  await db.transaction(async (tx) => {
    await tx.insert(schema.accounts).values({
      id: accountId,
      email: `p0int-${options.label}-${accountId}@example.invalid`,
      passwordHash: "x"
    });
    await tx.insert(schema.bases).values({
      id: baseId,
      accountId,
      name: `P0 结算隔离 ${options.label}`,
      contentRelease: "test",
      timeMode: options.timeMode,
      simTime: options.simTime ?? NIGHT,
      lastAdvancedAt: options.lastAdvancedAt
    });
    if (options.leaseUntil) {
      await tx.insert(schema.baseControlLeases).values({
        baseId,
        leaseToken: `p0int-${options.label}`,
        leaseUntil: options.leaseUntil
      });
    }
    await tx.insert(schema.basePowerState).values({
      baseId,
      generationWPeak: 15_000,
      storageWh: options.storageWh ?? 100_000,
      storageCapacityWh: 200_000,
      lastLoadW: 0,
      dustLevel: 0
    });
    if (reserved.size > 0) {
      await tx.insert(schema.baseInventory).values(
        [...reserved].map(([itemId, quantity]) => ({
          baseId,
          itemId,
          quantity,
          reservedQuantity: quantity
        }))
      );
    }
    for (const [index, job] of options.jobs.entries()) {
      await tx.insert(schema.baseManufacturingJobs).values({
        id: jobIds[index]!,
        baseId,
        recipeDefId: job.recipe,
        recipeRevision: 1,
        status: "active",
        outputsPlanned: job.outputsPlanned,
        outputsDone: 0,
        currentUnitWorkDone: job.currentUnitWorkDone ?? 0,
        reservedInputs: RECIPES[job.recipe].inputs.map((input) => ({
          itemId: input.itemId,
          quantity: input.quantity * job.outputsPlanned
        })),
        ...(job.createdAt ? { createdAt: job.createdAt } : {})
      });
    }
  });
  return { accountId, baseId, jobIds };
}

// 基地的全部结算相关行（逐字段），用于“字节级不变”断言。
async function snapshotBase(baseId: string): Promise<Record<string, unknown>> {
  const q = async (sql: string) => (await client.query(sql, [baseId])).rows;
  return {
    base: await q(`SELECT * FROM bases WHERE id = $1`),
    power: await q(`SELECT * FROM base_power_state WHERE base_id = $1`),
    inventory: await q(`SELECT * FROM base_inventory WHERE base_id = $1 ORDER BY item_id`),
    jobs: await q(`SELECT * FROM base_manufacturing_jobs WHERE base_id = $1 ORDER BY id`),
    outputs: await q(
      `SELECT o.* FROM base_manufacturing_outputs o JOIN base_manufacturing_jobs j ON j.id = o.job_id
       WHERE j.base_id = $1 ORDER BY o.id`
    ),
    devices: await q(`SELECT * FROM base_devices WHERE base_id = $1 ORDER BY id`),
    operators: await q(`SELECT * FROM robot_operators WHERE base_id = $1 ORDER BY id`),
    projects: await q(`SELECT * FROM base_projects WHERE base_id = $1 ORDER BY id`),
    steps: await q(
      `SELECT s.* FROM base_project_steps s JOIN base_projects p ON p.id = s.project_id
       WHERE p.base_id = $1 ORDER BY s.project_id, s.step_index`
    )
  };
}

async function readJob(jobId: string): Promise<{
  status: string;
  outputs_done: number;
  current_unit_work_done: number;
}> {
  const { rows } = await client.query(
    `SELECT status, outputs_done, current_unit_work_done FROM base_manufacturing_jobs WHERE id = $1`,
    [jobId]
  );
  return rows[0];
}

async function readPower(baseId: string): Promise<{ storage_wh: number; last_load_w: number }> {
  const { rows } = await client.query(
    `SELECT storage_wh, last_load_w FROM base_power_state WHERE base_id = $1`,
    [baseId]
  );
  return rows[0];
}

async function countDevices(baseId: string): Promise<number> {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM base_devices WHERE base_id = $1`, [baseId]);
  return rows[0].n;
}

function totalWork(job: { outputs_done: number; current_unit_work_done: number }, recipe: RecipeId): number {
  return job.outputs_done * RECIPES[recipe].workPerUnit + job.current_unit_work_done;
}

async function settleOnce(now: Date): Promise<number> {
  return db.transaction((tx) => ops.settlement.settleBases(tx, now));
}

d("P0 车道 A：结算完整性（真 PostgreSQL）", () => {
  it("A1: A 运行时，暂停基地 B 与租约失效基地 C 的工单、库存、设备、电力逐字段不变", async () => {
    const now = new Date();
    const leaseValid = new Date(now.getTime() + 300_000);
    const baseA = await seedBase({
      label: "a1-running",
      timeMode: "running",
      leaseUntil: leaseValid,
      lastAdvancedAt: new Date(now.getTime() - MINUTE_MS),
      jobs: [{ recipe: "manufacture-yd-s1", outputsPlanned: 5 }]
    });
    const baseB = await seedBase({
      label: "a1-paused",
      timeMode: "paused",
      leaseUntil: leaseValid, // 租约有效也不行：暂停就是暂停
      lastAdvancedAt: new Date(now.getTime() - MINUTE_MS),
      jobs: [{ recipe: "manufacture-yd-s1", outputsPlanned: 5, currentUnitWorkDone: 7 }]
    });
    const baseC = await seedBase({
      label: "a1-lease-expired",
      timeMode: "running",
      leaseUntil: new Date(now.getTime() - 1_000),
      lastAdvancedAt: new Date(now.getTime() - MINUTE_MS),
      jobs: [{ recipe: "manufacture-yd-h1", outputsPlanned: 2 }]
    });
    const beforeB = await snapshotBase(baseB.baseId);
    const beforeC = await snapshotBase(baseC.baseId);

    expect(await settleOnce(now)).toBe(1);

    expect(await snapshotBase(baseB.baseId)).toEqual(beforeB);
    expect(await snapshotBase(baseC.baseId)).toEqual(beforeC);
    // A 自己照常推进约 1 基地分钟 = 25 工作点（1 台望山 20 + 余 5）。
    const jobA = await readJob(baseA.jobIds[0]!);
    expect(totalWork(jobA, "manufacture-yd-s1")).toBeGreaterThan(24.9);
    expect(totalWork(jobA, "manufacture-yd-s1")).toBeLessThan(25.5);
    expect(jobA.outputs_done).toBe(1);
    expect(await countDevices(baseA.baseId)).toBe(1);
  }, 60_000);

  it("A2: 同一基地同一 Δsim 下，结算结果与全服运行基地数（1、2、5）无关", async () => {
    const observed: Array<Record<string, unknown>> = [];
    for (const runningBases of [1, 2, 5]) {
      await client.query(`UPDATE bases SET time_mode = 'paused'`);
      const now = new Date();
      // lastAdvancedAt 远在 1 小时前 → Δwall 被钳到 BASE_MAX_CATCHUP_MS（10 分钟），Δsim 精确一致。
      const seedOptions = (label: string): SeedBaseOptions => ({
        label,
        timeMode: "running",
        leaseUntil: new Date(now.getTime() + 300_000),
        lastAdvancedAt: new Date(now.getTime() - 3_600_000),
        jobs: [{ recipe: "manufacture-yd-s1", outputsPlanned: 20 }]
      });
      const target = await seedBase(seedOptions(`a2-target-${runningBases}`));
      for (let i = 1; i < runningBases; i += 1) {
        await seedBase(seedOptions(`a2-peer-${runningBases}-${i}`));
      }

      expect(await settleOnce(now)).toBe(runningBases);

      const job = await readJob(target.jobIds[0]!);
      const power = await readPower(target.baseId);
      const { rows: inventory } = await client.query(
        `SELECT item_id, quantity, reserved_quantity FROM base_inventory WHERE base_id = $1 ORDER BY item_id`,
        [target.baseId]
      );
      observed.push({
        status: job.status,
        outputsDone: job.outputs_done,
        currentUnitWorkDone: Number(job.current_unit_work_done.toFixed(6)),
        devices: await countDevices(target.baseId),
        storageWh: power.storage_wh,
        lastLoadW: power.last_load_w,
        inventory
      });
    }

    expect(observed[1]).toEqual(observed[0]);
    expect(observed[2]).toEqual(observed[0]);
    // 10 基地分钟 × 1500W = 250 工作点 → 12 台望山（240）+ 余 10。
    expect(observed[0]).toMatchObject({ outputsDone: 12, currentUnitWorkDone: 10, devices: 12 });
  }, 120_000);

  it("A3: 同基地两张工单按 FIFO 分摊本子 tick 预算，合计不超过预算", async () => {
    const now = new Date();
    const base = await seedBase({
      label: "a3-fifo",
      timeMode: "running",
      leaseUntil: new Date(now.getTime() + 300_000),
      lastAdvancedAt: new Date(now.getTime() - 3_600_000), // Δsim = 10 分钟 → 预算 250
      jobs: [
        { recipe: "manufacture-yd-h1", outputsPlanned: 3, createdAt: new Date(now.getTime() - 120_000) },
        { recipe: "manufacture-yd-s1", outputsPlanned: 20, createdAt: new Date(now.getTime() - 60_000) }
      ]
    });

    await settleOnce(now);

    const first = await readJob(base.jobIds[0]!);
    const second = await readJob(base.jobIds[1]!);
    // 先到的驮运单拿满 3×30 = 90 完工，剩余 160 顺延给望山单（8 台）。
    expect(first.status).toBe("completed");
    expect(totalWork(first, "manufacture-yd-h1")).toBeCloseTo(90, 6);
    expect(totalWork(second, "manufacture-yd-s1")).toBeCloseTo(160, 6);
    expect(second.outputs_done).toBe(8);
    expect(totalWork(first, "manufacture-yd-h1") + totalWork(second, "manufacture-yd-s1")).toBeLessThanOrEqual(250 + 1e-6);
  }, 60_000);

  it("A4: 制造取能从本基地储能扣减并计入 lastLoadW（夜间：基础 1000W + 制造 1500W）", async () => {
    const now = new Date();
    const withJob = await seedBase({
      label: "a4-load",
      timeMode: "running",
      leaseUntil: new Date(now.getTime() + 300_000),
      lastAdvancedAt: new Date(now.getTime() - MINUTE_MS),
      jobs: [{ recipe: "manufacture-yd-h1", outputsPlanned: 1 }]
    });
    const idle = await seedBase({
      label: "a4-idle",
      timeMode: "running",
      leaseUntil: new Date(now.getTime() + 300_000),
      lastAdvancedAt: new Date(now.getTime() - MINUTE_MS),
      jobs: []
    });

    await settleOnce(now);

    const loaded = await readPower(withJob.baseId);
    const baseline = await readPower(idle.baseId);
    expect(loaded.last_load_w).toBe(2_500);
    expect(baseline.last_load_w).toBe(1_000);
    // 约 1 基地分钟：制造多扣 ≈25Wh（取整 ±1）。
    expect(baseline.storage_wh - loaded.storage_wh).toBeGreaterThanOrEqual(24);
    expect(baseline.storage_wh - loaded.storage_wh).toBeLessThanOrEqual(26);
    const job = await readJob(withJob.jobIds[0]!);
    expect(job.current_unit_work_done).toBeGreaterThan(24.9);
    expect(job.current_unit_work_done).toBeLessThan(25.5);
  }, 60_000);

  it("A6: 开工与同 commandId 幂等重放都不在请求路径触发结算（本基地与其他运行基地均不推进）", async () => {
    const now = Date.now();
    const provisionAccount = async (label: string) => {
      const accountId = randomUUID();
      await client.query(
        `INSERT INTO accounts (id, email, password_hash, role) VALUES ($1, $2, 'x', 'player')`,
        [accountId, `p0int-${label}-${accountId}@example.invalid`]
      );
      const { baseId } = await ops.session.provision.execute({ accountId }, { commandId: randomUUID() });
      // 运行中 + 租约有效 + 已有 5 分钟未结算：旧实现的请求路径全服结算会推进它。
      await client.query(
        `UPDATE bases SET time_mode = 'running', last_advanced_at = $2 WHERE id = $1`,
        [baseId, new Date(now - 5 * MINUTE_MS)]
      );
      await client.query(
        `INSERT INTO base_control_leases (base_id, lease_token, lease_until) VALUES ($1, $2, $3)
         ON CONFLICT (base_id) DO UPDATE SET lease_until = EXCLUDED.lease_until`,
        [baseId, `p0int-${label}`, new Date(now + 300_000)]
      );
      return { accountId, baseId };
    };
    const actor = await provisionAccount("a6-actor");
    const bystander = await provisionAccount("a6-bystander");
    const { rows: sites } = await client.query(
      `SELECT id FROM base_sites WHERE base_id = $1 AND site_key = 'site_a'`,
      [actor.baseId]
    );
    const siteId = sites[0].id as string;

    const bystanderBefore = await snapshotBase(bystander.baseId);
    const actorBefore = await snapshotBase(actor.baseId);
    const input = {
      definitionRef: { kind: "project" as const, stableId: "install-solar-array", revision: 1 },
      siteId,
      commandId: randomUUID()
    };

    const first = await ops.projects.create.execute({ accountId: actor.accountId }, input);
    expect(first.duplicate).toBe(false);

    const assertNoSettlement = async () => {
      expect(await snapshotBase(bystander.baseId)).toEqual(bystanderBefore);
      const actorAfter = await snapshotBase(actor.baseId);
      expect(actorAfter.power).toEqual(actorBefore.power);
      expect(actorAfter.operators).toEqual(actorBefore.operators);
      const [baseRow] = actorAfter.base as Array<{ sim_time: Date; last_advanced_at: Date }>;
      const [baseRowBefore] = actorBefore.base as Array<{ sim_time: Date; last_advanced_at: Date }>;
      expect(baseRow?.sim_time).toEqual(baseRowBefore?.sim_time);
      expect(baseRow?.last_advanced_at).toEqual(baseRowBefore?.last_advanced_at);
      const steps = actorAfter.steps as Array<{ step_index: number; status: string; work_done: number }>;
      expect(steps.map((step) => [step.step_index, step.status, step.work_done])).toEqual([
        [0, "ready", 0],
        [1, "pending", 0],
        [2, "pending", 0],
        [3, "pending", 0]
      ]);
    };
    await assertNoSettlement();

    const replay = await ops.projects.create.execute({ accountId: actor.accountId }, input);
    expect(replay).toEqual({ projectId: first.projectId, duplicate: true });
    await assertNoSettlement();
    const { rows: projects } = await client.query(
      `SELECT COUNT(*)::int AS n FROM base_projects WHERE base_id = $1`,
      [actor.baseId]
    );
    expect(projects[0].n).toBe(1);
  }, 60_000);

  it("取消制造工单等待同基地 tick 提交，再按最新剩余预留释放", async () => {
    const now = new Date();
    const base = await seedBase({
      label: "cancel-race",
      timeMode: "running",
      leaseUntil: new Date(now.getTime() + 300_000),
      lastAdvancedAt: new Date(now.getTime() - MINUTE_MS),
      jobs: [{ recipe: "manufacture-yd-h1", outputsPlanned: 2, currentUnitWorkDone: 20 }]
    });
    let releaseTick!: () => void;
    let tickLocked!: () => void;
    const tickMayContinue = new Promise<void>((resolve) => { releaseTick = resolve; });
    const locked = new Promise<void>((resolve) => { tickLocked = resolve; });
    const tick = db.transaction(async (tx) => {
      expect(await new BaseRepository(db).getBaseForUpdate(tx, base.baseId)).not.toBeNull();
      tickLocked();
      await tickMayContinue;
      return ops.settlement.settleBases(tx, now);
    });
    await Promise.race([
      locked,
      tick.then(() => { throw new Error("tick finished before the lock barrier"); }),
      delay(5_000).then(() => { throw new Error("tick did not acquire the base lock"); })
    ]);

    const cancel = ops.manufacturingJobs.cancel.execute(
      { accountId: base.accountId },
      { jobId: base.jobIds[0]!, commandId: randomUUID() }
    );
    let waitedForLock = false;
    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const { rows } = await client.query(
          `SELECT COUNT(*)::int AS n FROM pg_stat_activity
           WHERE datname = $1 AND wait_event_type = 'Lock' AND query ILIKE '%bases%'`,
          [dbName]
        );
        if (rows[0].n > 0) {
          waitedForLock = true;
          break;
        }
        await delay(20);
      }
    } finally {
      releaseTick();
    }
    expect(waitedForLock).toBe(true);
    expect(await tick).toBe(1);
    expect(await cancel).toMatchObject({ cancelled: true, duplicate: false });

    const job = await readJob(base.jobIds[0]!);
    expect(job).toMatchObject({ status: "cancelled", outputs_done: 1 });
    expect(await countDevices(base.baseId)).toBe(1);
    const { rows: inventory } = await client.query(
      `SELECT item_id, quantity, reserved_quantity FROM base_inventory WHERE base_id = $1 ORDER BY item_id`,
      [base.baseId]
    );
    expect(inventory).toEqual([
      { item_id: "power_box", quantity: 1, reserved_quantity: 0 },
      { item_id: "spare_parts", quantity: 6, reserved_quantity: 0 },
      { item_id: "support_frame", quantity: 4, reserved_quantity: 0 }
    ]);
  }, 60_000);

  it("基地互斥锁不阻塞新工单的外键检查", async () => {
    const base = await seedBase({
      label: "fk-lock",
      timeMode: "paused",
      leaseUntil: null,
      lastAdvancedAt: new Date(),
      jobs: []
    });
    const holder = await migPool.connect();
    await holder.query("BEGIN");
    try {
      const scoped = drizzle(holder, { schema });
      expect(await new BaseRepository(scoped).getBaseForUpdate(scoped, base.baseId)).not.toBeNull();
      const insert = db.insert(schema.baseManufacturingJobs).values({
        baseId: base.baseId,
        recipeDefId: "manufacture-yd-h1",
        recipeRevision: 1,
        outputsPlanned: 1,
        reservedInputs: []
      }).returning({ id: schema.baseManufacturingJobs.id });
      const rows = await Promise.race([
        insert,
        delay(2_000).then(() => { throw new Error("base lock blocked the job foreign-key check"); })
      ]);
      expect(rows).toHaveLength(1);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
  }, 10_000);
});
