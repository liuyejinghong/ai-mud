import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBaseOperations } from "../../../application/base/composition.js";
import type { Env } from "../../../config/env.js";
import { createDb, type Db } from "../../../db/client.js";
import { BaseRepository } from "../../../modules/world-runtime/base.repository.js";

// M12-Q 独立验收（G02 主证据，真 PostgreSQL）：provision 走集成组合根
// createBaseOperations（M12-I 绑定的真实端口链），验证：
//   ① 冻结 fixture 种子一次落全（12 作业者 / 6 行库存 / 电力行 15000/200000/100000 / 6 建设位）；
//   ② 同 commandId 幂等重放 → 同 baseId、设备不补建、库存不翻倍；
//   ③ 账号作用域隔离：各账号各自基地，无基地账号查询为 null；
//   ④ 收据 requestHash 不一致 → IDEMPOTENCY_CONFLICT（合同 §3.5）。
// fixture 数值来源：docs/reviews/base-operations/m12-p-contract.md §4（Q 独立抄录，
// 不 import @ai-mud/content，避免用被测方自己的常量验证被测方）。

const { Client } = pg;
const testFile = fileURLToPath(import.meta.url);
const serverRoot = dirname(dirname(dirname(dirname(dirname(testFile)))));
const drizzleDir = join(serverRoot, "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("DATABASE_URL not set; skipping base provision PG tests");
    return null;
  }
  return url;
}

function makeTempDatabaseName() {
  return `ai_mud_vitest_baseprov_${process.pid}_${randomUUID().replace(/-/g, "")}`;
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
    TYPE_SAFE_BASE_URL: "https://openrouter.ai/api/v1",
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

interface InventoryRow {
  itemId: string;
  quantity: number;
  reservedQuantity: number;
}

async function readInventory(client: pg.Client, baseId: string): Promise<InventoryRow[]> {
  const { rows } = await client.query(
    `SELECT item_id, quantity, reserved_quantity FROM base_inventory WHERE base_id = $1`,
    [baseId]
  );
  const inventory = rows.map((row) => ({
    itemId: row.item_id as string,
    quantity: row.quantity as number,
    reservedQuantity: row.reserved_quantity as number
  }));
  inventory.sort((a, b) => a.itemId.localeCompare(b.itemId));
  return inventory;
}

async function countRows(client: pg.Client, table: string, baseId: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE base_id = $1`,
    [baseId]
  );
  return rows[0]!.n as number;
}

async function countBasesWithId(client: pg.Client, baseId: string): Promise<number> {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM bases WHERE id = $1`, [baseId]);
  return rows[0]!.n as number;
}

const SEED_INVENTORY: Array<[string, number]> = [
  ["anchor", 8],
  ["cable", 2],
  ["power_box", 1],
  ["spare_parts", 30],
  ["solar_panel_set", 6],
  ["support_frame", 6]
];

describe("base provisioning against the integrated composition (real PostgreSQL)", () => {
  let harness: Harness;
  let ops: ReturnType<typeof createBaseOperations>;
  let baseRepo: BaseRepository;
  let accountA: string;
  let accountB: string;
  let accountC: string;
  let baseIdA: string;

  beforeAll(async () => {
    const databaseUrl = requireDatabaseUrl();
    if (!databaseUrl) return;
    harness = await createHarness(databaseUrl);
    ops = createBaseOperations({ db: harness.db, config: makeEnv() });
    baseRepo = new BaseRepository(harness.db);
    accountA = await insertAccount(harness.client, "baseprov-a@q.test");
    accountB = await insertAccount(harness.client, "baseprov-b@q.test");
    accountC = await insertAccount(harness.client, "baseprov-c@q.test");
  }, 120_000);

  afterAll(async () => {
    if (harness) await harness.dispose();
  }, 120_000);

  it("seeds the frozen fixture exactly once for a fresh command", async () => {
    if (!process.env.DATABASE_URL) return;

    const commandId = randomUUID();
    const result = await ops.session.provision.execute({ accountId: accountA }, { commandId });
    baseIdA = result.baseId;
    expect(result.duplicate).toBe(false);
    expect(result.baseId).toMatch(/^[0-9a-f-]{36}$/);

    // 12 台设备 + 1:1 作业者（4 驮运 + 5 筑垒 + 3 望山）。
    expect(await countRows(harness.client, "base_devices", baseIdA)).toBe(12);
    const operators = await countRows(harness.client, "robot_operators", baseIdA);
    expect(operators).toBe(12);
    const { rows: groups } = await harness.client.query(
      `SELECT group_id, COUNT(*)::int AS n FROM robot_operators WHERE base_id = $1 GROUP BY group_id ORDER BY group_id`,
      [baseIdA]
    );
    expect(groups).toEqual([
      { group_id: "engineering", n: 5 },
      { group_id: "survey", n: 3 },
      { group_id: "transport", n: 4 }
    ]);

    // 6 行库存、reserved 全 0、数量与 fixture 一致（两侧同一排序器比较）。
    const inventory = await readInventory(harness.client, baseIdA);
    const expectedInventory = SEED_INVENTORY.map(([itemId, quantity]) => ({
      itemId,
      quantity,
      reservedQuantity: 0
    }));
    expectedInventory.sort((a, b) => a.itemId.localeCompare(b.itemId));
    expect(inventory).toEqual(expectedInventory);

    // 电力行：15000W 峰值 / 200000Wh 容量 / 100000Wh 期初储能。
    const { rows: power } = await harness.client.query(
      `SELECT generation_w_peak, storage_capacity_wh, storage_wh, last_load_w
       FROM base_power_state WHERE base_id = $1`,
      [baseIdA]
    );
    expect(power).toHaveLength(1);
    expect(power[0]).toMatchObject({
      generation_w_peak: 15000,
      storage_capacity_wh: 200000,
      storage_wh: 100000,
      last_load_w: 0
    });

    // 7 个建设位：5 个 built + site_a/site_b free（0035 为存量基地回填 site_b）。
    const { rows: sites } = await harness.client.query(
      `SELECT site_key, state FROM base_sites WHERE base_id = $1 ORDER BY site_key`,
      [baseIdA]
    );
    expect(sites).toEqual([
      { site_key: "array", state: "built" },
      { site_key: "charging", state: "built" },
      { site_key: "maintenance", state: "built" },
      { site_key: "site_a", state: "free" },
      { site_key: "site_b", state: "free" },
      { site_key: "storage", state: "built" },
      { site_key: "warehouse", state: "built" }
    ]);

    // 账号作用域收据已落库（合同 §3.5）。
    const { rows: receipts } = await harness.client.query(
      `SELECT actor_scope, command_kind, command_id FROM command_receipts
       WHERE actor_scope = $1 AND command_kind = 'base.provision' AND command_id = $2`,
      [`account:${accountA}`, commandId]
    );
    expect(receipts).toHaveLength(1);
  }, 60_000);

  it("replays the same command to the same baseId without re-seeding devices or inventory", async () => {
    if (!process.env.DATABASE_URL) return;

    const before = await readInventory(harness.client, baseIdA);

    // 取首个 commandId 精确重放。
    const { rows: first } = await harness.client.query(
      `SELECT command_id FROM command_receipts
       WHERE actor_scope = $1 AND command_kind = 'base.provision' LIMIT 1`,
      [`account:${accountA}`]
    );
    expect(first).toHaveLength(1);
    const originalCommandId = first[0]!.command_id as string;

    const result = await ops.session.provision.execute(
      { accountId: accountA },
      { commandId: originalCommandId }
    );
    expect(result).toEqual({ baseId: baseIdA, duplicate: true });

    // 设备/作业者不补建、库存不翻倍（合同 §3.6）。
    expect(await countRows(harness.client, "base_devices", baseIdA)).toBe(12);
    expect(await countRows(harness.client, "robot_operators", baseIdA)).toBe(12);
    expect(await readInventory(harness.client, baseIdA)).toEqual(before);
    expect(await countRows(harness.client, "base_sites", baseIdA)).toBe(7);
    expect(await countBasesWithId(harness.client, baseIdA)).toBe(1);
  }, 60_000);

  it("keeps accounts isolated: each lookup only sees its own base, baseless accounts see null", async () => {
    if (!process.env.DATABASE_URL) return;

    const provisionB = await ops.session.provision.execute({ accountId: accountB }, { commandId: randomUUID() });
    expect(provisionB.duplicate).toBe(false);
    expect(provisionB.baseId).not.toBe(baseIdA);

    expect(await baseRepo.findBaseIdByAccount(harness.db, accountA)).toBe(baseIdA);
    expect(await baseRepo.findBaseIdByAccount(harness.db, accountB)).toBe(provisionB.baseId);
    // 无基地账号查不到任何基地（不泄漏他人基地存在性，合同 S2 前提）。
    expect(await baseRepo.findBaseIdByAccount(harness.db, accountC)).toBeNull();

    // 一账号一基地：bases.account_id 唯一约束兜底。
    const { rows } = await harness.client.query(
      `SELECT COUNT(*)::int AS n FROM bases WHERE account_id = $1`,
      [accountA]
    );
    expect(rows[0]!.n).toBe(1);
  }, 60_000);

  it("rejects a same commandId whose stored requestHash diverged with IDEMPOTENCY_CONFLICT", async () => {
    if (!process.env.DATABASE_URL) return;

    const { rows: receipts } = await harness.client.query(
      `SELECT command_id FROM command_receipts
       WHERE actor_scope = $1 AND command_kind = 'base.provision' LIMIT 1`,
      [`account:${accountA}`]
    );
    const commandId = receipts[0]!.command_id as string;

    // 模拟"同 ID 不同请求"：直接篡改收据 requestHash（provision 的 payload 恒为 {}，
    // 正常链不可能分歧，故注入分歧事实验证守卫）。
    await harness.client.query(
      `UPDATE command_receipts SET request_hash = 'sha256:divergent-payload'
       WHERE actor_scope = $1 AND command_kind = 'base.provision' AND command_id = $2`,
      [`account:${accountA}`, commandId]
    );

    await expect(
      ops.session.provision.execute({ accountId: accountA }, { commandId })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    // 冲突路径不产生任何写入。
    expect(await countRows(harness.client, "base_devices", baseIdA)).toBe(12);
    expect(await countRows(harness.client, "robot_operators", baseIdA)).toBe(12);
    expect(await countBasesWithId(harness.client, baseIdA)).toBe(1);
  }, 60_000);
});
