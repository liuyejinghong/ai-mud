// 账号重开（删档重开）真 PG 集成验收。
//
// 被测物：POST /base/reset（账号作用域）+ BaseResetService/BaseResetRepository 事务编排。
//   ① 重开：旧基地 FK 闭包全表清空 → 注册同款 landing 新档（新 baseId、×2 倍速、开局形态）；
//   ② 原子性：重建阶段注入失败时整体回滚，旧档数据逐表不变（不留半档）；
//   ③ 隔离：另一账号的基地与会话逐行不受影响；重开账号的登录会话保留（与全服重置的差异）；
//   ④ 幂等：同 commandId 重放返回收据结果不删档；换 commandId 可再次重开（设备来源唯一键不冲突）；
//   ⑤ 审计：audit_logs 留 base.reset 记录；基地命令收据（base:{oldId} 与 provision）随之清除。
//
// 种子数据来源：账号/基地/工程/控制租约/时钟走真实 HTTP 路由（landing 内容）；
// 其余闭包表（事件/协作/决策/采矿/加工槽/天气/订单/采购/制造产出）按表生命周期
// 用最小合法探针行直接落库（与 reset-base-operations.integration.test.ts 同口径，
// 只作为删除覆盖与 FK 顺序的前置条件，不代表真实游玩路径）。
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BaseSnapshotDto } from "@ai-mud/shared";
import { LANDING_BASE_CONTENT_RELEASE } from "@ai-mud/content";
import { createContentCatalog } from "../../modules/content-catalog/catalog.service.js";
import { buildApp } from "../../app.js";
import { loadEnv, type Env } from "../../config/env.js";
import { createDb, type Db } from "../../db/client.js";
import { BaseResetRepository } from "../../modules/world-reset/base-reset.repository.js";
import { BaseResetService } from "../../modules/world-reset/base-reset.service.js";
import { BaseRepository } from "../../modules/world-runtime/base.repository.js";
import { DrizzleAuditWriter } from "../../modules/audit/audit.repository.js";

const { Client } = pg;
const testFile = fileURLToPath(import.meta.url);
// apps/server/src/tests/ops/<file> → apps/server
const serverRoot = dirname(dirname(dirname(dirname(testFile))));
const drizzleDir = join(serverRoot, "drizzle");

const DATABASE_URL = process.env.DATABASE_URL;
const d = DATABASE_URL ? describe : describe.skip;

// 与 BaseResetRepository 的 FK 闭包清单互为镜像：此处独立抄录，防止清单静默缩水。
const RESET_CLOSURE_TABLES_BY_BASE = [
  "base_sites",
  "base_control_leases",
  "base_inventory",
  "base_devices",
  "robot_operators",
  "base_power_state",
  "base_projects",
  "base_manufacturing_jobs",
  "cooperation_requests",
  "base_weather_schedule",
  "base_orders",
  "base_purchases",
  "base_resource_nodes",
  "base_extraction_jobs",
  "base_production_slots",
  "base_events"
] as const;

const SESSION_COOKIE = "ai_mud_session";
const ADMIN_EMAIL = "admin-account-reset@example.test";
const ADMIN_PASSWORD = "admin-account-reset-password-123";
const PLAYER_PASSWORD = "playtest-pass";

function databaseUrlForName(databaseUrl: string, databaseName: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function createTempDatabaseFromMigrations(baseDatabaseUrl: string) {
  const databaseName = `ai_mud_vitest_account_reset_${process.pid}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const adminClient = new Client({ connectionString: databaseUrlForName(baseDatabaseUrl, "postgres") });
  await adminClient.connect();
  await adminClient.query(`CREATE DATABASE ${JSON.stringify(databaseName)}`);
  await adminClient.end();

  const targetUrl = databaseUrlForName(baseDatabaseUrl, databaseName);
  const client = new Client({ connectionString: targetUrl });
  await client.connect();
  const journal = JSON.parse(await readFile(join(drizzleDir, "meta", "_journal.json"), "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  const migrationSql: string[] = [];
  for (const entry of journal.entries) {
    migrationSql.push(await readFile(join(drizzleDir, `${entry.tag}.sql`), "utf8"));
  }
  await client.query(migrationSql.join("\n--> statement-breakpoint\n"));
  return { databaseName, targetUrl, client };
}

// ---------- HTTP 帮手（真实 buildApp + inject） ----------

interface HttpSession {
  cookie: string;
  csrf: string;
}

async function call(
  app: FastifyInstance,
  method: "GET" | "POST",
  url: string,
  options: { session?: HttpSession; body?: Record<string, unknown>; controlToken?: string } = {}
): Promise<{ status: number; body: unknown; sessionToken: string | null }> {
  const headers: Record<string, string> = {};
  if (options.session) {
    headers.cookie = options.session.cookie;
    headers["x-csrf-token"] = options.session.csrf;
    headers["x-ai-mud-csrf"] = options.session.csrf;
  }
  if (options.controlToken) headers["x-base-control-token"] = options.controlToken;
  const response = await app.inject({
    method,
    url,
    headers,
    ...(options.body === undefined ? {} : { payload: options.body })
  });
  return {
    status: response.statusCode,
    body: response.body.length > 0 ? (JSON.parse(response.body) as unknown) : null,
    sessionToken: response.cookies.find((cookie) => cookie.name === SESSION_COOKIE)?.value ?? null
  };
}

function toSession(result: { body: unknown; sessionToken: string | null }, csrf: string): HttpSession {
  const body = result.body as { csrfToken?: string };
  expect(result.sessionToken).toBeTruthy();
  expect(body.csrfToken).toBeTruthy();
  return { cookie: `${SESSION_COOKIE}=${result.sessionToken}`, csrf };
}

interface Player {
  email: string;
  accountId: string;
  baseId: string;
  session: HttpSession;
}

async function registerPlayer(app: FastifyInstance, email: string): Promise<Player> {
  const registered = await call(app, "POST", "/base/playtest-register", {
    body: { email, password: PLAYER_PASSWORD }
  });
  expect(registered.status).toBe(201);
  const body = registered.body as { user: { accountId: string }; baseId: string; csrfToken: string };
  return { email, accountId: body.user.accountId, baseId: body.baseId, session: toSession(registered, body.csrfToken) };
}

async function snapshot(app: FastifyInstance, session: HttpSession): Promise<BaseSnapshotDto> {
  const result = await call(app, "GET", "/base/snapshot", { session });
  expect(result.status).toBe(200);
  return result.body as BaseSnapshotDto;
}

async function acquireControl(app: FastifyInstance, player: Player): Promise<string> {
  const acquired = await call(app, "POST", "/base/heartbeat", {
    session: player.session,
    body: { action: "acquire" }
  });
  expect(acquired.status).toBe(200);
  const controlToken = (acquired.body as { controlToken: string }).controlToken;
  expect(controlToken).toBeTruthy();
  return controlToken;
}

// 开局形态（去掉 id/时间类字段）：重开后的基地必须与新号基地一致。
function openingShape(snap: BaseSnapshotDto) {
  return {
    name: snap.name,
    timeMode: snap.timeMode,
    speed: snap.speed,
    activeContentRelease: snap.activeContentRelease,
    credits: snap.credits,
    power: {
      generationWPeak: snap.power.generationWPeak,
      storageWh: snap.power.storageWh,
      storageCapacityWh: snap.power.storageCapacityWh,
      emergencyGenerationW: snap.power.emergencyGenerationW,
      chargeLimitW: snap.power.chargeLimitW
    },
    resources: snap.resources
      .map((resource) => ({ itemId: resource.itemId, quantity: resource.quantity, reservedQuantity: resource.reservedQuantity }))
      .sort((a, b) => a.itemId.localeCompare(b.itemId)),
    sites: snap.sites
      .map((site) => ({ siteKey: site.siteKey, state: site.state }))
      .sort((a, b) => a.siteKey.localeCompare(b.siteKey)),
    devices: snap.devices
      .map((device) => ({
        groupId: device.groupId,
        status: device.status,
        batteryWh: device.batteryWh,
        batteryCapacityWh: device.batteryCapacityWh
      }))
      .sort((a, b) => `${a.groupId}|${a.batteryWh}`.localeCompare(`${b.groupId}|${b.batteryWh}`)),
    projects: snap.projects.length,
    manufacturingJobs: snap.manufacturingJobs.length,
    resourceNodes: (snap.resourceNodes ?? []).map((node) => ({ nodeKey: node.nodeKey, discovered: node.discovered })),
    extractionJobs: (snap.extractionJobs ?? []).length,
    orders: snap.orders.length,
    purchases: snap.purchases.length
  };
}

async function countRows(client: pg.Client, sql: string, params: string[] = []): Promise<number> {
  const { rows } = await client.query(sql, params);
  return rows[0]!.n as number;
}

// 一个基地在各闭包表的行数（含经 job/project 间接挂接的表；用于回滚前后逐表比对）。
async function baseClosureRowCounts(client: pg.Client, accountId: string): Promise<Record<string, number>> {
  const baseId = await baseIdOfAccount(client, accountId);
  const counts: Record<string, number> = {
    bases: await countRows(client, `SELECT count(*)::int AS n FROM bases WHERE account_id = $1`, [accountId])
  };
  if (baseId === null) {
    for (const table of [...RESET_CLOSURE_TABLES_BY_BASE, "base_project_steps", "base_manufacturing_outputs", "base_extraction_outputs", "decision_records"]) {
      counts[table] = 0;
    }
    return counts;
  }
  for (const table of RESET_CLOSURE_TABLES_BY_BASE) {
    counts[table] = await countRows(
      client,
      `SELECT count(*)::int AS n FROM ${JSON.stringify(table)} WHERE base_id = $1`,
      [baseId]
    );
  }
  counts.base_project_steps = await countRows(
    client,
    `SELECT count(*)::int AS n FROM base_project_steps s JOIN base_projects p ON p.id = s.project_id WHERE p.base_id = $1`,
    [baseId]
  );
  counts.base_manufacturing_outputs = await countRows(
    client,
    `SELECT count(*)::int AS n FROM base_manufacturing_outputs o JOIN base_manufacturing_jobs j ON j.id = o.job_id WHERE j.base_id = $1`,
    [baseId]
  );
  counts.base_extraction_outputs = await countRows(
    client,
    `SELECT count(*)::int AS n FROM base_extraction_outputs o JOIN base_extraction_jobs j ON j.id = o.job_id WHERE j.base_id = $1`,
    [baseId]
  );
  counts.decision_records = await countRows(
    client,
    `SELECT count(*)::int AS n FROM decision_records WHERE base_id = $1`,
    [baseId]
  );
  return counts;
}

async function baseIdOfAccount(client: pg.Client, accountId: string): Promise<string | null> {
  const { rows } = await client.query(`SELECT id FROM bases WHERE account_id = $1`, [accountId]);
  return (rows[0]?.id as string | undefined) ?? null;
}

d("账号重开（删档重开）真 PostgreSQL", () => {
  let client: pg.Client;
  let db: Db;
  let closeDb: () => Promise<void>;
  let databaseName = "";
  let env: Env;
  let app: FastifyInstance;

  let playerA: Player;
  let playerB: Player;
  let freshC: Player;
  let baseEventsProbeId = "";
  let decisionProbeId = "";
  let extractionJobProbeId = "";

  const probeRowsFor = (baseId: string) => [
    { table: "base_events", where: `base_id = '${baseId}'` },
    { table: "base_orders", where: `base_id = '${baseId}'` },
    { table: "base_purchases", where: `base_id = '${baseId}'` },
    { table: "base_weather_schedule", where: `base_id = '${baseId}'` },
    { table: "base_production_slots", where: `base_id = '${baseId}'` },
    { table: "decision_records", where: `base_id = '${baseId}'` },
    { table: "base_extraction_outputs", where: `job_id IN (SELECT id FROM base_extraction_jobs WHERE base_id = '${baseId}')` },
    { table: "base_manufacturing_outputs", where: `job_id IN (SELECT id FROM base_manufacturing_jobs WHERE base_id = '${baseId}')` }
  ];

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    const temp = await createTempDatabaseFromMigrations(DATABASE_URL);
    client = temp.client;
    databaseName = temp.databaseName;
    const connection = createDb(temp.targetUrl);
    db = connection.db;
    closeDb = connection.close;
    env = loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: temp.targetUrl,
      SESSION_SECRET: "account-reset-secret-0123456789abcdef",
      SESSION_COOKIE_SECURE: "false",
      PLAYTEST_REGISTRATION_ENABLED: "true",
      WORLD_TICK_ENABLED: "false",
      ADMIN_BOOTSTRAP_EMAIL: ADMIN_EMAIL,
      ADMIN_BOOTSTRAP_PASSWORD: ADMIN_PASSWORD
    });
    app = await buildApp({
      env,
      db,
      provisionCatalog: createContentCatalog(LANDING_BASE_CONTENT_RELEASE)
    });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    if (!DATABASE_URL) return;
    if (app) await app.close();
    if (closeDb) await closeDb();
    if (client) await client.end();
    const adminClient = new Client({ connectionString: databaseUrlForName(DATABASE_URL, "postgres") });
    await adminClient.connect();
    await adminClient.query(`DROP DATABASE IF EXISTS ${JSON.stringify(databaseName)} WITH (FORCE)`);
    await adminClient.end();
  }, 120_000);

  it("种子：A/B 两账号经真实路由产生旧档数据，A 另有闭包探针行", async () => {
    playerA = await registerPlayer(app, `reset-a-${randomUUID().slice(0, 8)}@example.test`);
    playerB = await registerPlayer(app, `reset-b-${randomUUID().slice(0, 8)}@example.test`);
    expect(playerA.baseId).not.toBe(playerB.baseId);

    // A：接管 → landing 首工程开工（真实路由，需要控制租约）。
    const controlToken = await acquireControl(app, playerA);
    const snapA = await snapshot(app, playerA.session);
    const solarSite = snapA.sites.find((site) => site.siteKey === "install_solar");
    expect(solarSite).toBeDefined();
    const project = await call(app, "POST", "/base/projects", {
      session: playerA.session,
      controlToken,
      body: { definitionRef: { kind: "project", stableId: "landing-install-solar", revision: 1 }, siteId: solarSite!.siteId }
    });
    expect(project.status).toBe(201);

    // B：保留一条事件探针行，A 重开后逐行不变。
    await client.query(
      `INSERT INTO base_events (base_id, type, title, detail, sim_time) VALUES ($1, 'project.completed', 'B 保留探针', '隔离证据', now())`,
      [playerB.baseId]
    );

    // A 的闭包探针行（真实命令不可达的表）：事件/订单/采购/天气/加工槽/决策/采矿+产出/制造产出。
    const baseId = playerA.baseId;
    const events = await client.query(
      `INSERT INTO base_events (base_id, type, title, detail, sim_time) VALUES ($1, 'project.completed', '重开删除探针', 'A 旧档事件', now()) RETURNING id`,
      [baseId]
    );
    baseEventsProbeId = events.rows[0]!.id as string;
    await client.query(
      `INSERT INTO base_orders (base_id, order_def_id, order_revision, required_item_id, quantity, reward_credits)
       VALUES ($1, 'probe-order', 1, 'solar_kit', 1, 10)`,
      [baseId]
    );
    await client.query(
      `INSERT INTO base_purchases (base_id, item_id, quantity, cost_credits, arrives_at_sim)
       VALUES ($1, 'spare_part', 2, 40, now())`,
      [baseId]
    );
    await client.query(
      `INSERT INTO base_weather_schedule (base_id, seq, weather, start_sim, end_sim)
       VALUES ($1, 0, 'clear', now(), now() + interval '1 hour')`,
      [baseId]
    );
    const decision = await client.query(
      `INSERT INTO decision_records (decision_id, purpose, mode, provider, base_id, plan_revision, question, candidates, latency_ms)
       VALUES ($2, 'transport_assistance', 'rule', 'reset-fixture', $1, 1, '重开删除探针', '[]'::jsonb, 0) RETURNING id`,
      [baseId, `reset-${randomUUID()}`]
    );
    decisionProbeId = decision.rows[0]!.id as string;
    const slot = await client.query(
      `INSERT INTO base_production_slots (base_id, site_id, slot_index)
       SELECT $1, id, 0 FROM base_sites WHERE base_id = $1 AND site_key = 'lander' RETURNING id`,
      [baseId]
    );
    expect(slot.rows).toHaveLength(1);
    const miningJob = await client.query(
      `INSERT INTO base_extraction_jobs (base_id, node_id, kind, status, batches_planned, batches_extracted, batches_delivered, builder_operator_ids, hauler_operator_id)
       SELECT $1, n.id, 'mine', 'completed', 1, 1, 1, '["00000000-0000-4000-8000-000000000002"]'::jsonb, '00000000-0000-4000-8000-000000000001'::uuid
         FROM base_resource_nodes n WHERE n.base_id = $1 AND n.node_key = 'iron_north' RETURNING id`,
      [baseId]
    );
    extractionJobProbeId = miningJob.rows[0]!.id as string;
    await client.query(
      `INSERT INTO base_extraction_outputs (job_id, ordinal, item_id, quantity, status) VALUES ($1, 1, 'iron_ore', 4, 'delivered')`,
      [extractionJobProbeId]
    );
    const mfgJob = await client.query(
      `INSERT INTO base_manufacturing_jobs (base_id, recipe_def_id, recipe_revision, outputs_planned, outputs_done)
       VALUES ($1, 'landing-smelt-iron', 1, 1, 1) RETURNING id`,
      [baseId]
    );
    await client.query(
      `INSERT INTO base_manufacturing_outputs (job_id, ordinal, output_kind, item_id, quantity)
       VALUES ($1, 1, 'item', 'iron_ingot', 1)`,
      [mfgJob.rows[0]!.id as string]
    );

    // 种子完整性：A 的每个闭包表都有数据（重开断言才有意义）。
    for (const probe of probeRowsFor(baseId)) {
      expect(await countRows(client, `SELECT count(*)::int AS n FROM ${probe.table} WHERE ${probe.where}`), probe.table).toBeGreaterThan(0);
    }
    expect(await countRows(client, `SELECT count(*)::int AS n FROM base_projects WHERE base_id = $1`, [baseId])).toBe(1);
    expect(
      await countRows(client, `SELECT count(*)::int AS n FROM base_control_leases WHERE base_id = $1`, [baseId])
    ).toBe(1);
    expect(await countRows(client, `SELECT count(*)::int AS n FROM bases`)).toBe(2);
  }, 120_000);

  it("重开：旧闭包全空、新档为开局形态且快照正确、登录会话保留", async () => {
    freshC = await registerPlayer(app, `reset-c-${randomUUID().slice(0, 8)}@example.test`);
    const beforeSnap = await snapshot(app, playerA.session);
    expect(beforeSnap.baseId).toBe(playerA.baseId);

    const reset = await call(app, "POST", "/base/reset", {
      session: playerA.session,
      body: { commandId: randomUUID() }
    });
    expect(reset.status).toBe(200);
    const resetBody = reset.body as { baseId: string; duplicate: boolean };
    expect(resetBody.duplicate).toBe(false);
    expect(resetBody.baseId).not.toBe(playerA.baseId);

    // 旧基地行删除、账号不变、仍只有一行基地。
    expect(await baseIdOfAccount(client, playerA.accountId)).toBe(resetBody.baseId);
    expect(await countRows(client, `SELECT count(*)::int AS n FROM bases WHERE id = $1`, [playerA.baseId])).toBe(0);

    // ① 闭包表：A 的旧行全部清空。
    for (const table of RESET_CLOSURE_TABLES_BY_BASE) {
      expect(
        await countRows(client, `SELECT count(*)::int AS n FROM ${JSON.stringify(table)} WHERE base_id = $1`, [playerA.baseId]),
        table
      ).toBe(0);
    }
    expect(
      await countRows(client, `SELECT count(*)::int AS n FROM base_project_steps s JOIN base_projects p ON p.id = s.project_id WHERE p.base_id = $1`, [playerA.baseId])
    ).toBe(0);
    for (const probe of probeRowsFor(playerA.baseId)) {
      expect(
        await countRows(client, `SELECT count(*)::int AS n FROM ${probe.table} WHERE ${probe.where}`),
        probe.table
      ).toBe(0);
    }
    expect(await countRows(client, `SELECT count(*)::int AS n FROM base_events WHERE id = $1`, [baseEventsProbeId])).toBe(0);
    expect(await countRows(client, `SELECT count(*)::int AS n FROM decision_records WHERE id = $1`, [decisionProbeId])).toBe(0);
    expect(await countRows(client, `SELECT count(*)::int AS n FROM base_extraction_jobs WHERE id = $1`, [extractionJobProbeId])).toBe(0);

    // ② 命令收据：旧基地作用域与 provision 收据清除；重开收据已落、结果指向新基地。
    expect(
      await countRows(client, `SELECT count(*)::int AS n FROM command_receipts WHERE actor_scope = $1`, [`base:${playerA.baseId}`])
    ).toBe(0);
    // provision 收据：注册时期的旧收据已删；重建在事务内以新 commandId 认领新收据（恰 1 条）。
    expect(
      await countRows(client, `SELECT count(*)::int AS n FROM command_receipts WHERE actor_scope = $1 AND command_kind = 'base.provision'`, [
        `account:${playerA.accountId}`
      ])
    ).toBe(1);
    expect(
      await countRows(client, `SELECT count(*)::int AS n FROM command_receipts WHERE actor_scope = $1 AND command_kind = 'base.resetBase'`, [
        `account:${playerA.accountId}`
      ])
    ).toBe(1);

    // ③ 审计：base.reset 记录指向新基地并带旧基地 id。
    const audits = await client.query(
      `SELECT target_id, metadata FROM audit_logs WHERE action = 'base.reset' AND actor_account_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [playerA.accountId]
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]!.target_id).toBe(resetBody.baseId);
    expect(audits.rows[0]!.metadata).toMatchObject({ previousBaseId: playerA.baseId, newBaseId: resetBody.baseId });

    // ④ 新档快照：注册同款开局形态（与新号 C 一致）。
    const afterSnap = await snapshot(app, playerA.session);
    expect(afterSnap.baseId).toBe(resetBody.baseId);
    expect(openingShape(afterSnap)).toEqual(openingShape(await snapshot(app, freshC.session)));
    expect(afterSnap.timeMode).toBe("paused");
    expect(afterSnap.speed).toBe(2);
    expect(afterSnap.projects).toHaveLength(0);
    expect(afterSnap.devices).toHaveLength(12);
    expect(afterSnap.controlLease.controlActive).toBe(false);

    // ⑤ 登录会话保留：同一 cookie 直接可用（与全服重置吊销会话不同）。
    expect((await call(app, "GET", "/base/snapshot", { session: playerA.session })).status).toBe(200);
  }, 120_000);

  it("隔离：A 重开后，另一账号的基地、探针行、会话逐行不受影响；B 重开自己的基地也不影响 A", async () => {
    // A 的重开没有波及 B：基地不变、B 的事件探针仍在、会话仍可用。
    expect(await baseIdOfAccount(client, playerB.accountId)).toBe(playerB.baseId);
    expect(
      await countRows(client, `SELECT count(*)::int AS n FROM base_events WHERE base_id = $1`, [playerB.baseId])
    ).toBe(1);
    expect((await snapshot(app, playerB.session)).baseId).toBe(playerB.baseId);

    // B 重开自己的基地成功（互不影响的双向证据）。
    const resetB = await call(app, "POST", "/base/reset", { session: playerB.session, body: {} });
    expect(resetB.status).toBe(200);
    const newB = (resetB.body as { baseId: string }).baseId;
    expect(newB).not.toBe(playerB.baseId);
    expect(await baseIdOfAccount(client, playerB.accountId)).toBe(newB);
    expect(
      await countRows(client, `SELECT count(*)::int AS n FROM base_events WHERE base_id = $1`, [playerB.baseId])
    ).toBe(0);

    // A 的基地不受 B 重开影响。
    const aSnap = await snapshot(app, playerA.session);
    expect(aSnap.baseId).toBe(await baseIdOfAccount(client, playerA.accountId));
    expect(aSnap.baseId).not.toBe(playerA.baseId);
    expect(await countRows(client, `SELECT count(*)::int AS n FROM bases`)).toBe(3); // A + B + C
  }, 120_000);

  it("失败回滚：重建阶段抛错时整体回滚，旧档逐表不变、快照仍可用", async () => {
    const before = await baseClosureRowCounts(client, playerA.accountId);
    const receiptBefore = await countRows(client, `SELECT count(*)::int AS n FROM command_receipts`);
    const auditBefore = await countRows(client, `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'base.reset'`);
    const currentBaseId = await baseIdOfAccount(client, playerA.accountId);
    expect(currentBaseId).not.toBeNull();
    // 前置：A 当前闭包里确实有数据（回滚断言才有意义）。
    expect(before.bases).toBe(1);
    expect(before.base_devices).toBeGreaterThan(0);

    // 与组合根同构的装配，仅 provisionInTx 注入失败（模拟种子装配抛错）。
    const failing = new BaseResetService({
      db,
      repo: new BaseRepository(db),
      openDeleter: (tx) => new BaseResetRepository(tx),
      provisionInTx: async () => {
        throw new Error("seed exploded");
      },
      openAudit: (tx) => new DrizzleAuditWriter(tx)
    });

    await expect(
      failing.resetBase({ accountId: playerA.accountId }, { commandId: randomUUID() })
    ).rejects.toThrow("seed exploded");

    // 旧档零变化：闭包逐表行数不变、基地行不变、收据/审计不落。
    expect(await baseClosureRowCounts(client, playerA.accountId)).toEqual(before);
    expect(await baseIdOfAccount(client, playerA.accountId)).toBe(currentBaseId);
    expect(await countRows(client, `SELECT count(*)::int AS n FROM command_receipts`)).toBe(receiptBefore);
    expect(await countRows(client, `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'base.reset'`)).toBe(auditBefore);
    const snap = await snapshot(app, playerA.session);
    expect(snap.baseId).toBe(currentBaseId);
  }, 120_000);

  it("幂等：同 commandId 重放返回收据结果不删档；换 commandId 可再次重开（设备来源唯一键不冲突）", async () => {
    const commandId = randomUUID();
    const first = await call(app, "POST", "/base/reset", { session: playerA.session, body: { commandId } });
    expect(first.status).toBe(200);
    const firstBody = first.body as { baseId: string; duplicate: boolean };
    expect(firstBody.duplicate).toBe(false);

    const replay = await call(app, "POST", "/base/reset", { session: playerA.session, body: { commandId } });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ baseId: firstBody.baseId, duplicate: true });
    expect(await baseIdOfAccount(client, playerA.accountId)).toBe(firstBody.baseId);

    // 再次重开：新 baseId，仍为开局形态（base_devices.source_operation 唯一索引不冲突）。
    const second = await call(app, "POST", "/base/reset", { session: playerA.session, body: {} });
    expect(second.status).toBe(200);
    const secondBody = second.body as { baseId: string; duplicate: boolean };
    expect(secondBody.duplicate).toBe(false);
    expect(secondBody.baseId).not.toBe(firstBody.baseId);
    const snap = await snapshot(app, playerA.session);
    expect(snap.baseId).toBe(secondBody.baseId);
    expect(snap.devices).toHaveLength(12);
    expect(snap.projects).toHaveLength(0);
    expect(await countRows(client, `SELECT count(*)::int AS n FROM bases WHERE account_id = $1`, [playerA.accountId])).toBe(1);
  }, 120_000);
});
