// G13：旧 schema（至 0037）代表性旧档 → 应用 0038 → 旧数据可读、在途义务可结。
// 无生产数据授权：在一次性隔离 PG 上构造代表性旧档（两种内容版本 + 在途订单/工单/机器人分配）。
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBaseOperations } from "../../../application/base/composition.js";
import type { Env } from "../../../config/env.js";
import { createDb, type Db } from "../../../db/client.js";
import { TUTORIAL_BASE_CONTENT_RELEASE } from "@ai-mud/content";
import { createContentCatalog } from "../../../modules/content-catalog/catalog.service.js";

const { Client } = pg;
const testFile = fileURLToPath(import.meta.url);
const serverRoot = dirname(dirname(dirname(dirname(dirname(testFile)))));
const drizzleDir = join(serverRoot, "drizzle");

const BROKEN = `CONSTRAINT "base_projects_one_active_per_site_idx" UNIQUE("site_id") WHERE`;
function patch(statement: string): string {
  if (!statement.includes(BROKEN)) return statement;
  return (
    statement.replace(
      /\n\tCONSTRAINT "base_projects_one_active_per_site_idx" UNIQUE\("site_id"\) WHERE "base_projects"\."status" IN \('planned', 'active', 'paused', 'blocked', 'needs_decision'\),/,
      ""
    ) +
    "\nCREATE UNIQUE INDEX \"base_projects_one_active_per_site_idx\" ON \"base_projects\" (\"site_id\") WHERE \"base_projects\".\"status\" IN ('planned', 'active', 'paused', 'blocked', 'needs_decision');"
  );
}

function urlFor(base: string, name: string): string {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

function makeEnv(databaseUrl: string): Env {
  return {
    NODE_ENV: "test",
    PLAYTEST_REGISTRATION_ENABLED: false,
    SERVER_HOST: "127.0.0.1",
    SERVER_PORT: 3000,
    DATABASE_URL: databaseUrl,
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

async function applyJournal(client: pg.Client, throughTag: string | null): Promise<void> {
  const journal = JSON.parse(
    await readFile(join(drizzleDir, "meta", "_journal.json"), "utf8")
  ) as { entries: Array<{ idx: number; tag: string }> };
  for (const entry of journal.entries) {
    if (throughTag && entry.idx > (journal.entries.find((e) => e.tag === throughTag)?.idx ?? -1)) continue;
    const sql = await readFile(join(drizzleDir, `${entry.tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
      await client.query(patch(statement));
    }
  }
}

describe("G13 旧 schema 0037 → 0038 升级（隔离 PG 代表性旧档）", () => {
  let admin: pg.Client;
  let client: pg.Client;
  let db: Db;
  let closeDb: () => Promise<void>;
  let databaseName: string;
  let accountId: string;
  let baseId: string;
  let orderId: string;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.warn("DATABASE_URL not set; skipping G13 upgrade test");
      return;
    }
    databaseName = `ai_mud_g13_${process.pid}_${randomUUID().replace(/-/g, "")}`;
    admin = new Client({ connectionString: urlFor(databaseUrl, "postgres") });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${JSON.stringify(databaseName)}`);
    client = new Client({ connectionString: urlFor(databaseUrl, databaseName) });
    await client.connect();
    // 1) 只回放到 0037（旧世界）。
    await applyJournal(client, "0037_tutorial_budget");

    // 2) 代表性旧档：教程 release 基地 + 库存/电力/订单/在途采购/机器人。
    const { rows: accountRows } = await client.query(
      `INSERT INTO accounts (email, password_hash, role) VALUES ('g13-old@q.test', 'x', 'player') RETURNING id`
    );
    accountId = accountRows[0]!.id as string;
    const { rows: baseRows } = await client.query(
      `INSERT INTO bases (account_id, name, content_release, credits, sim_time)
       VALUES ($1, '旧前哨', 'yudian-base-tutorial-1', 777, now()) RETURNING id`,
      [accountId]
    );
    baseId = baseRows[0]!.id as string;
    for (const [key, name, ref] of [
      ["array", "太阳能阵列", "facility:yudian-array@1"],
      ["warehouse", "仓储棚", "facility:yudian-warehouse@1"],
      ["site_a", "建设位 A", null]
    ] as const) {
      await client.query(
        `INSERT INTO base_sites (base_id, site_key, state, built_facility_ref) VALUES ($1, $2, $3, $4)`,
        [baseId, key, ref ? "built" : "free", ref]
      );
    }
    await client.query(
      `INSERT INTO base_power_state (base_id, generation_w_peak, storage_wh, storage_capacity_wh) VALUES ($1, 15000, 100000, 200000)`,
      [baseId]
    );
    await client.query(
      `INSERT INTO base_inventory (base_id, item_id, quantity) VALUES ($1, 'solar_panel_set', 6), ($1, 'spare_parts', 30)`,
      [baseId]
    );
    const { rows: deviceRows } = await client.query(
      `INSERT INTO base_devices (base_id, device_def_id, template_revision, source_operation) VALUES ($1, 'yd-h1', 1, $2) RETURNING id`,
      [baseId, `g13:${randomUUID()}`]
    );
    await client.query(
      `INSERT INTO robot_operators (device_id, base_id, group_id, battery_wh, battery_capacity_wh, status)
       VALUES ($1, $2, 'transport', 12000, 20000, 'idle')`,
      [deviceRows[0]!.id, baseId]
    );
    const { rows: orderRows } = await client.query(
      `INSERT INTO base_orders (base_id, order_def_id, order_revision, status, required_item_id, quantity, reward_credits)
       VALUES ($1, 'order-solar-buyback', 1, 'open', 'solar_panel_set', 4, 700) RETURNING id`,
      [baseId]
    );
    orderId = orderRows[0]!.id as string;
    await client.query(
      `INSERT INTO base_purchases (base_id, item_id, quantity, cost_credits, arrives_at_sim)
       VALUES ($1, 'cable', 4, 100, now() + interval '20 minutes')`,
      [baseId]
    );

    // 3) 应用 0038（含此前全部缺失项——0037 之后只有 0038）。
    const journal = JSON.parse(
      await readFile(join(drizzleDir, "meta", "_journal.json"), "utf8")
    ) as { entries: Array<{ idx: number; tag: string }> };
    for (const entry of journal.entries) {
      if (entry.tag <= "0037_tutorial_budget") continue;
      const sql = await readFile(join(drizzleDir, `${entry.tag}.sql`), "utf8");
      for (const statement of sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
        await client.query(patch(statement));
      }
    }
    const connection = createDb(urlFor(databaseUrl, databaseName));
    db = connection.db;
    closeDb = connection.close;
  }, 180_000);

  afterAll(async () => {
    if (client) await client.end();
    if (closeDb) await closeDb();
    if (admin) {
      await admin.query(`DROP DATABASE ${JSON.stringify(databaseName)} WITH (FORCE)`);
      await admin.end();
    }
  }, 120_000);

  it("升级后旧数据完整可读，新增列/表就位且历史行满足新约束", async () => {
    if (!process.env.DATABASE_URL) return;
    const { rows: base } = await client.query(`SELECT credits, content_release FROM bases WHERE id = $1`, [baseId]);
    expect(base[0]).toMatchObject({ credits: 777, content_release: "yudian-base-tutorial-1" });
    const { rows: inv } = await client.query(`SELECT quantity FROM base_inventory WHERE base_id = $1 AND item_id = 'solar_panel_set'`, [baseId]);
    expect(inv[0]!.quantity).toBe(6);
    // 新列（robot 互斥列对旧行为 NULL；电力缺省生效）。
    const { rows: ops } = await client.query(`SELECT current_extraction_job_id FROM robot_operators WHERE base_id = $1`, [baseId]);
    expect(ops[0]!.current_extraction_job_id).toBeNull();
    const { rows: power } = await client.query(`SELECT emergency_generation_w, power_policy, storage_excess_wm FROM base_power_state WHERE base_id = $1`, [baseId]);
    expect(power[0]).toMatchObject({ emergency_generation_w: 0, power_policy: "production", storage_excess_wm: 0 });
    // 新表空置可用。
    const { rows: nodes } = await client.query(`SELECT COUNT(*)::int AS n FROM base_resource_nodes WHERE base_id = $1`, [baseId]);
    expect(nodes[0]!.n).toBe(0);
  });

  it("旧档在途义务升级后仍能正常结算（订单接单/交付 + 采购到货）", async () => {
    if (!process.env.DATABASE_URL) return;
    const ops = createBaseOperations({
      db,
      config: makeEnv(urlFor(process.env.DATABASE_URL!, databaseName)),
      provisionCatalog: createContentCatalog(TUTORIAL_BASE_CONTENT_RELEASE)
    });
    const heartbeat = await ops.session.clock.heartbeat({ accountId }, { action: "acquire" });
    expect(heartbeat.controlToken).toBeTruthy();
    // 接单 → 交付（旧经济链路在升级后的 schema 上照常）。
    const accepted = await ops.economy.accept.execute({ accountId }, { orderId, commandId: randomUUID() });
    expect(accepted).toMatchObject({ orderId, duplicate: false });
    const delivered = await ops.economy.deliver.execute({ accountId }, { orderId, commandId: randomUUID() });
    expect(delivered.rewardCredits).toBe(700);
    const { rows: after } = await client.query(`SELECT credits FROM bases WHERE id = $1`, [baseId]);
    expect(after[0]!.credits).toBe(777 + 700);
    // 快照（新快照投影读旧档不炸：legacy 分支不携带 landing 字段组）。
    const snap = await ops.session.snapshot.execute({ accountId });
    expect(snap.activeContentRelease).toBe("yudian-base-tutorial-1");
    expect(snap.capabilities).toEqual(["external_trade"]);
    expect(snap.resourceNodes).toBeUndefined();
  });
});
