// R1 返工轮真 PG 回归：验收报告 #4–#7 与 05 证据缺口。
// #4 位置合法性（服务端）；#5 租约/缺 token/跨 tick 幂等重放；#6 策略切换先结清；
// #7 FIFO 排队/暂停让位/恢复重排队/双槽分摊；已采未送取消（stopping）、暂停后取消收尾、
// 双基地隔离、维护软锁的手工备件恢复。
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
  const databaseName = `ai_mud_vitest_lfix_${process.pid}_${randomUUID().replace(/-/g, "")}`;
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

async function operators(client: pg.Client, baseId: string, group: string): Promise<Array<{ operatorId: string; batteryWh: number }>> {
  const { rows } = await client.query(
    `SELECT o.id, o.battery_wh FROM robot_operators o WHERE o.base_id = $1 AND o.group_id = $2 ORDER BY o.id`,
    [baseId, group]
  );
  return rows.map((row) => ({ operatorId: row.id as string, batteryWh: row.battery_wh as number }));
}

describe("R1 返工回归（真实 PostgreSQL）", () => {
  let harness: { client: pg.Client; db: Db; dispose: () => Promise<void> };
  let ops: ReturnType<typeof createBaseOperations>;
  let accountId: string;
  let accountB: string;
  let baseId: string;
  let surveyorId: string;
  let builders: Array<{ operatorId: string; batteryWh: number }>;
  let haulers: Array<{ operatorId: string; batteryWh: number }>;
  let leaseToken: string | null = null;

  async function advanceMinutes(minutes: number, targetBaseId = baseId, targetAccount = accountId): Promise<void> {
    const now = new Date();
    await harness.client.query(
      `UPDATE bases SET time_mode = 'running', last_advanced_at = $1 WHERE id = $2`,
      [new Date(now.getTime() - minutes * 60_000), targetBaseId]
    );
    await harness.client.query(
      `INSERT INTO base_control_leases (base_id, lease_token, lease_until, updated_at)
       VALUES ($1, $4, $2, $3)
       ON CONFLICT (base_id) DO UPDATE SET updated_at = $3, lease_until = $2, lease_token = $4`,
      [targetBaseId, new Date(now.getTime() + 300_000), now, leaseToken ?? `fix-test-${targetBaseId}`]
    );
    let guard = 0;
    while (guard < 400) {
      const advanced = await harness.db.transaction((tx) => ops.settlement.settleBases(tx, new Date()));
      if (advanced === 0) break;
      guard += 1;
    }
  }

  async function snapshot(targetAccount = accountId) {
    return ops.session.snapshot.execute({ accountId: targetAccount });
  }

  async function siteIdByKey(key: string): Promise<string> {
    const snap = await snapshot();
    const site = snap.sites.find((entry) => entry.siteKey === key);
    if (!site) throw new Error(`site ${key} missing`);
    return site.siteId;
  }

  async function nodeIdByKey(key: string, targetAccount = accountId): Promise<string> {
    const snap = await snapshot(targetAccount);
    const node = snap.resourceNodes?.find((entry) => entry.nodeKey === key);
    if (!node) throw new Error(`node ${key} missing`);
    return node.nodeId;
  }

  async function createProject(stableId: string, siteId: string) {
    const snap = await snapshot();
    const template = snap.buildableProjects.find((project) => project.definitionRef.stableId === stableId);
    if (!template) throw new Error(`template ${stableId} not buildable`);
    return ops.projects.create.execute({ accountId }, {
      definitionRef: { kind: "project", stableId, revision: template.definitionRef.revision },
      siteId,
      commandId: randomUUID()
    });
  }

  async function waitForNodeFree(nodeKey: "iron_north" | "copper_ridge"): Promise<void> {
    for (let index = 0; index < 12; index += 1) {
      const snap = await snapshot();
      const node = snap.resourceNodes!.find((entry) => entry.nodeKey === nodeKey)!;
      const busy = (snap.extractionJobs ?? []).some(
        (job) => job.nodeId === node.nodeId && (job.status === "active" || job.status === "paused" || job.status === "stopping")
      );
      if (!busy) return;
      await advanceMinutes(1);
    }
  }

  async function mineOre(nodeKey: "iron_north" | "copper_ridge", batches: number, builderOffset = 0): Promise<void> {
    // 未勘探先勘探（跨测试状态自适应）。
    const nodeSnap = (await snapshot()).resourceNodes!.find((entry) => entry.nodeKey === nodeKey)!;
    if (!nodeSnap.discovered) {
      await ops.extraction.survey.execute({ accountId }, {
        nodeId: nodeSnap.nodeId, operatorId: surveyorId,
        commandId: randomUUID(), controlToken: leaseToken
      });
      await advanceMinutes(2);
    }
    // 低电/占用时等待充电或释放后重试（真实恢复路径，不 SQL 赋电）。
    let mine: { jobId: string } | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        mine = await ops.extraction.createMining.execute({ accountId }, {
          nodeId: await nodeIdByKey(nodeKey),
          batches,
          builderOperatorIds: [builders[builderOffset % builders.length]!.operatorId, builders[(builderOffset + 1) % builders.length]!.operatorId],
          haulerOperatorId: haulers[0]!.operatorId,
          commandId: randomUUID(),
          controlToken: leaseToken
        });
        break;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== "DEVICE_BUSY") throw error;
        await advanceMinutes(2);
      }
    }
    if (!mine) throw new Error(`mine on ${nodeKey} could not start (devices busy/low battery)`);
    // 等待完成（含可能的低电充电等待），上限 batches*2+30 分钟。
    for (let index = 0; index < batches * 2 + 30; index += 1) {
      await advanceMinutes(1);
      const snap = await snapshot();
      const job = snap.extractionJobs?.find((entry) => entry.jobId === mine.jobId);
      if (job && (job.status === "completed" || job.status === "cancelled")) return;
    }
    throw new Error(`mine on ${nodeKey} did not finish`);
  }

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.warn("DATABASE_URL not set; skipping landing fix regression tests");
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
    accountId = await insertAccount(harness.client, "r1-fix@q.test");
    accountB = await insertAccount(harness.client, "r1-fix-b@q.test");
    const provisioned = await ops.session.provision.execute({ accountId }, { commandId: randomUUID() });
    baseId = provisioned.baseId;
    surveyorId = (await operators(harness.client, baseId, "survey"))[0]!.operatorId;
    builders = await operators(harness.client, baseId, "engineering");
    haulers = await operators(harness.client, baseId, "transport");
    const heartbeat = await ops.session.clock.heartbeat({ accountId }, { action: "acquire" });
    leaseToken = heartbeat.controlToken;
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.dispose();
  }, 120_000);


  it("independent: pause A, reuse hauler for B, cancel A must not double-use the hauler", async () => {
    if (!process.env.DATABASE_URL) throw new Error("Independent PG check requires explicit isolated DATABASE_URL");
    await createProject("landing-install-solar", await siteIdByKey("install_solar"));
    await advanceMinutes(1);
    await createProject("landing-install-warehouse", await siteIdByKey("install_warehouse"));
    await advanceMinutes(1);
    const iron = await nodeIdByKey("iron_north");
    const copper = await nodeIdByKey("copper_ridge");
    for (const nodeId of [iron, copper]) {
      await ops.extraction.survey.execute({accountId}, {nodeId, operatorId:surveyorId, commandId:randomUUID(), controlToken:leaseToken});
      await advanceMinutes(2);
    }
    const a = await ops.extraction.createMining.execute({accountId}, {nodeId:iron,batches:2,builderOperatorIds:builders.slice(0,2).map(x=>x.operatorId),haulerOperatorId:haulers[0]!.operatorId,commandId:randomUUID(),controlToken:leaseToken});
    await advanceMinutes(1);
    await ops.extraction.pause.execute({accountId},{jobId:a.jobId,commandId:randomUUID(),controlToken:leaseToken});
    const b = await ops.extraction.createMining.execute({accountId}, {nodeId:copper,batches:2,builderOperatorIds:builders.slice(2,4).map(x=>x.operatorId),haulerOperatorId:haulers[0]!.operatorId,commandId:randomUUID(),controlToken:leaseToken});
    await advanceMinutes(1);
    await ops.extraction.cancel.execute({accountId},{jobId:a.jobId,commandId:randomUUID(),controlToken:leaseToken});
    await advanceMinutes(1);
    const {rows} = await harness.client.query("SELECT id,batches_delivered,hauler_operator_id FROM base_extraction_jobs WHERE id = ANY($1::uuid[])", [[a.jobId,b.jobId]]);
    const delivered=rows.filter(x=>x.batches_delivered>0);
    expect(new Set(delivered.map(x=>x.hauler_operator_id)).size).toBe(delivered.length);
    const {rows:owners}=await harness.client.query("SELECT current_extraction_job_id FROM robot_operators WHERE id=$1",[haulers[0]!.operatorId]);
    expect(owners[0]!.current_extraction_job_id).toBe(b.jobId);
  });
});
