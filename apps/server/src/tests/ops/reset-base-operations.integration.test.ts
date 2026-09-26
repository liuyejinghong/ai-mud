// 第 0 阶段上线运维：试玩服基地经营实例重置脚本（deploy/ops/reset-base-operations.sql）真 PG 验收。
//
// 被测物是仓库里那一份 SQL 文件本身（原样读取、原样执行，不做任何改写），证明：
//   ① 清空全部基地实例表（bases 及 FK 闭包内全部表）与基地命令收据；
//   ② 账号/管理员/内容目录/审计/AI 日志/公告/世界时钟/旧西幻世界数据逐行不变；
//   ③ 全部会话被吊销（旧 cookie 立即 401，刷新页面也回到登录页）；
//   ④ 同一账号重新登录 → POST /base/provision 得到新 baseId，开局物资/设备与新号一致；
//   ⑤ 单事务：遇到未登记的基地关联表时整体拒绝、零写入；
//   ⑥ 幂等：再次执行成功且零变更。
//
// 种子数据来源（尽量走真实路由/用例，做不到的逐项注明）：
//   - 账号/会话/基地：POST /base/playtest-register、/auth/login、/base/provision（真实 buildApp）；
//   - 工程/取消工程/制造工单/采购/接单/时钟/心跳：真实 HTTP 路由；
//   - 订单生成、制造产出（设备+作业者+outputs）、协作请求：真实结算；
//     createBaseOperations().settlement.settleBases；
//   - 管理员：ADMIN_BOOTSTRAP_*（buildApp 启动引导）；内容草稿：POST /admin/content/drafts。
//   直接 SQL 的例外（均为测试前置条件，不是被测行为）：
//   - 模拟时间流逝：把 bases.last_advanced_at 回拨 10 分钟（结算只认系统墙钟，无法注入时钟）；
//   - 制造协作缺口：把基地 A 工程组电量清零（没有玩家命令能直接耗电，需构造“本组无人可出工”）；
//   - 天气日程：生产 provision 目前从不调用 WeatherService.generateSchedule（base_weather_schedule
//     在线上恒为空），这里用真实服务方法写入，确保重置脚本对该表的清空被覆盖；
//   - content_releases / ai_call_logs / system_announcements / activation_codes / characters /
//     world_runtime_state 探针行 / 旧世界命令收据：保留类数据，用最小合法行代表
//     （发布整包校验与旧世界流程不在本测范围）。
//   - decision_records 删除探针：首条协作由玩家决定，不触发规则决策审计；这里只验证重置清表。
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BaseSnapshotDto } from "@ai-mud/shared";
import { buildApp } from "../../app.js";
import { createBaseOperations } from "../../application/base/composition.js";
import { loadEnv, type Env } from "../../config/env.js";
import { createDb, type Db } from "../../db/client.js";
import { WeatherService } from "../../modules/world-runtime/weather.service.js";

const { Client } = pg;
const testFile = fileURLToPath(import.meta.url);
// apps/server/src/tests/ops/<file> → apps/server
const serverRoot = dirname(dirname(dirname(dirname(testFile))));
const repoRoot = dirname(dirname(serverRoot));
const drizzleDir = join(serverRoot, "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");
const RESET_SQL_PATH = join(repoRoot, "deploy", "ops", "reset-base-operations.sql");

const DATABASE_URL = process.env.DATABASE_URL;
const d = DATABASE_URL ? describe : describe.skip;

// 基地经营实例表（与 SQL 文件头的“清空”清单一一对应；此处独立抄录，不从 SQL 解析）。
const BASE_INSTANCE_TABLES = [
  "bases",
  "base_sites",
  "base_control_leases",
  "base_inventory",
  "base_devices",
  "robot_operators",
  "base_power_state",
  "base_projects",
  "base_project_steps",
  "base_manufacturing_jobs",
  "base_manufacturing_outputs",
  "decision_records",
  "cooperation_requests",
  "base_weather_schedule",
  "base_orders",
  "base_purchases"
] as const;

// 部分处理的表：sessions 只吊销（保留行）；command_receipts 只删基地命令收据。
const PARTIALLY_TOUCHED_TABLES = ["sessions", "command_receipts"] as const;

// 必须保留且本测试确保非空的表（其余保留表同样逐行比对，只是不强制非空）。
const MUST_KEEP_NON_EMPTY = [
  "accounts",
  "activation_codes",
  "audit_logs",
  "content_drafts",
  "content_releases",
  "ai_call_logs",
  "system_announcements",
  "world_runtime_state",
  "characters"
] as const;

const SESSION_COOKIE = "ai_mud_session";
const ADMIN_EMAIL = "admin-reset@example.test";
const ADMIN_PASSWORD = "admin-reset-password-123";
const PLAYER_PASSWORD = "playtest-pass";

function databaseUrlForName(databaseUrl: string, databaseName: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function createTempDatabaseFromMigrations(baseDatabaseUrl: string) {
  const databaseName = `ai_mud_vitest_reset_${process.pid}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const adminClient = new Client({ connectionString: databaseUrlForName(baseDatabaseUrl, "postgres") });
  await adminClient.connect();
  await adminClient.query(`CREATE DATABASE ${JSON.stringify(databaseName)}`);
  await adminClient.end();

  const targetUrl = databaseUrlForName(baseDatabaseUrl, databaseName);
  const client = new Client({ connectionString: targetUrl });
  await client.connect();
  // 全部迁移拼成单次多语句查询（逐条往返在 CI 上会超出钩子超时）。
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
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

interface HttpResult {
  status: number;
  body: unknown;
  sessionToken: string | null;
}

async function call(
  app: FastifyInstance,
  method: "GET" | "POST",
  url: string,
  options: { session?: HttpSession; body?: Record<string, unknown>; controlToken?: string } = {}
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (options.session) {
    headers.cookie = options.session.cookie;
    // 基地路由用 x-csrf-token，管理路由用 x-ai-mud-csrf；同一令牌两头都带。
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

function toSession(result: HttpResult, csrf: string): HttpSession {
  expect(result.sessionToken).toBeTruthy();
  return { cookie: `${SESSION_COOKIE}=${result.sessionToken}`, csrf };
}

interface Player {
  email: string;
  accountId: string;
  baseId: string;
  session: HttpSession;
}

// 与 BaseApp.handleAuthSubmit 相同的客户端序列：注册 → provision → 快照。
async function registerPlayer(app: FastifyInstance, email: string): Promise<Player> {
  const registered = await call(app, "POST", "/base/playtest-register", {
    body: { email, password: PLAYER_PASSWORD }
  });
  expect(registered.status).toBe(201);
  const body = registered.body as { user: { accountId: string }; baseId: string; csrfToken: string };
  const session = toSession(registered, body.csrfToken);
  const provisioned = await call(app, "POST", "/base/provision", { session, body: {} });
  expect(provisioned.status).toBe(200);
  expect((provisioned.body as { baseId: string }).baseId).toBe(body.baseId);
  return { email, accountId: body.user.accountId, baseId: body.baseId, session };
}

async function snapshot(app: FastifyInstance, session: HttpSession): Promise<BaseSnapshotDto> {
  const result = await call(app, "GET", "/base/snapshot", { session });
  expect(result.status).toBe(200);
  return result.body as BaseSnapshotDto;
}

function siteIdOf(snap: BaseSnapshotDto, siteKey: string): string {
  const site = snap.sites.find((entry) => entry.siteKey === siteKey);
  expect(site, `site ${siteKey}`).toBeDefined();
  return site!.siteId;
}

// 开局形态（去掉 id/时间类字段）：用于“重新 provision 的基地 = 新号基地”。
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
      storageCapacityWh: snap.power.storageCapacityWh
    },
    resources: snap.resources
      .map((resource) => ({
        itemId: resource.itemId,
        quantity: resource.quantity,
        reservedQuantity: resource.reservedQuantity
      }))
      .sort((a, b) => a.itemId.localeCompare(b.itemId)),
    sites: snap.sites
      .map((site) => ({ siteKey: site.siteKey, state: site.state }))
      .sort((a, b) => a.siteKey.localeCompare(b.siteKey)),
    devices: snap.devices
      .map((device) => ({
        name: device.name,
        groupId: device.groupId,
        status: device.status,
        batteryWh: device.batteryWh,
        batteryCapacityWh: device.batteryCapacityWh,
        currentAssignment: device.currentAssignment
      }))
      .sort((a, b) =>
        `${a.groupId}|${a.name}|${a.batteryWh}`.localeCompare(`${b.groupId}|${b.name}|${b.batteryWh}`)
      ),
    projects: snap.projects.length,
    manufacturingJobs: snap.manufacturingJobs.length,
    cooperationRequests: snap.cooperationRequests.length,
    orders: snap.orders.length,
    purchases: snap.purchases.length
  };
}

// ---------- DB 读侧 ----------

async function countRows(client: pg.Client, table: string, where = "TRUE"): Promise<number> {
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${JSON.stringify(table)} WHERE ${where}`);
  return rows[0]!.n as number;
}

async function tableCounts(client: pg.Client, tables: readonly string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tables) counts[table] = await countRows(client, table);
  return counts;
}

async function publicTables(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT c.relname AS name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY c.relname`
  );
  return rows.map((row) => row.name as string);
}

// 逐行指纹：整表按行文本排序后取 md5（任何一行任何一列变化都会改变指纹）。
async function tableFingerprint(client: pg.Client, table: string): Promise<string> {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n,
            md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '')) AS h
       FROM ${JSON.stringify(table)} t`
  );
  return `${rows[0]!.n}:${rows[0]!.h}`;
}

async function retainedFingerprints(client: pg.Client): Promise<Record<string, string>> {
  const excluded = new Set<string>([...BASE_INSTANCE_TABLES, ...PARTIALLY_TOUCHED_TABLES]);
  const fingerprints: Record<string, string> = {};
  for (const table of await publicTables(client)) {
    if (excluded.has(table)) continue;
    fingerprints[table] = await tableFingerprint(client, table);
  }
  return fingerprints;
}

// 会话指纹：除 revoked_at 以外的全部列（吊销只允许改 revoked_at）。
async function sessionIdentityFingerprint(client: pg.Client): Promise<string> {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n,
            md5(coalesce(string_agg(concat_ws('|', id, account_id, token_hash, expires_at, created_at), E'\\n' ORDER BY id), '')) AS h
       FROM sessions`
  );
  return `${rows[0]!.n}:${rows[0]!.h}`;
}

async function nonBaseReceiptFingerprint(client: pg.Client): Promise<string> {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n,
            md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '')) AS h
       FROM command_receipts t
      WHERE actor_scope LIKE 'character:%'`
  );
  return `${rows[0]!.n}:${rows[0]!.h}`;
}

async function readResetSql(): Promise<string> {
  return readFile(RESET_SQL_PATH, "utf8");
}

// 原样执行 SQL 文件（简单查询协议，多语句；脚本自带 BEGIN/COMMIT）。
async function runResetSql(client: pg.Client): Promise<pg.QueryResult[]> {
  const result = (await client.query(await readResetSql())) as unknown as pg.QueryResult | pg.QueryResult[];
  return Array.isArray(result) ? result : [result];
}

d("试玩服基地经营重置脚本（真 PostgreSQL）", () => {
  let client: pg.Client;
  let db: Db;
  let closeDb: () => Promise<void>;
  let databaseName = "";
  let env: Env;
  let app: FastifyInstance;

  let adminSession: HttpSession;
  let playerA: Player;
  let playerB: Player;
  let draftStableId = "";

  let retainedBefore: Record<string, string> = {};
  let sessionsBefore = "";
  let receiptsBefore = "";
  let countsBefore: Record<string, number> = {};

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
      SESSION_SECRET: "reset-base-operations-secret-0123456789",
      SESSION_COOKIE_SECURE: "false",
      PLAYTEST_REGISTRATION_ENABLED: "true",
      WORLD_TICK_ENABLED: "false",
      ADMIN_BOOTSTRAP_EMAIL: ADMIN_EMAIL,
      ADMIN_BOOTSTRAP_PASSWORD: ADMIN_PASSWORD
    });
    app = await buildApp({ env, db });
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

  it("清空清单覆盖 schema：bases 的 FK 闭包与全部 base_* 表都在清单内", async () => {
    const tables = await publicTables(client);
    for (const table of BASE_INSTANCE_TABLES) expect(tables, table).toContain(table);

    // 反向 FK 闭包：所有直接/间接引用 bases 的表。
    const { rows } = await client.query(
      `WITH RECURSIVE closure(rel) AS (
         SELECT 'public.bases'::regclass::oid
         UNION
         SELECT c.conrelid
           FROM pg_constraint c
           JOIN closure ON closure.rel = c.confrelid
          WHERE c.contype = 'f'
       )
       SELECT pc.relname AS name
         FROM closure JOIN pg_class pc ON pc.oid = closure.rel
        ORDER BY pc.relname`
    );
    const closure = rows.map((row) => row.name as string);
    expect(closure.length).toBeGreaterThan(10);
    for (const table of closure) expect(BASE_INSTANCE_TABLES as readonly string[], table).toContain(table);

    for (const table of tables.filter((name) => name === "bases" || name.startsWith("base_"))) {
      expect(BASE_INSTANCE_TABLES as readonly string[], table).toContain(table);
    }
  });

  it("种子：两个试玩账号经真实路由/结算产生完整基地经营数据，外加各类保留数据", async () => {
    // 管理员（启动引导）登录 + 经管理路由建内容草稿。
    const adminLogin = await call(app, "POST", "/auth/login", {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    expect(adminLogin.status).toBe(200);
    adminSession = toSession(adminLogin, (adminLogin.body as { csrfToken: string }).csrfToken);
    draftStableId = `reset-probe-${randomUUID().slice(0, 8)}`;
    const draft = await call(app, "POST", "/admin/content/drafts", {
      session: adminSession,
      body: { kind: "robot_template", stableId: draftStableId, payload: { name: "重置保留探针" } }
    });
    expect(draft.status).toBe(201);

    playerA = await registerPlayer(app, `reset-a-${randomUUID().slice(0, 8)}@example.test`);
    playerB = await registerPlayer(app, `reset-b-${randomUUID().slice(0, 8)}@example.test`);
    expect(playerA.baseId).not.toBe(playerB.baseId);

    // A：site_a 开工（全额预留首项目物料）→ 采购锚固件。
    const snapA = await snapshot(app, playerA.session);
    const projectA = await call(app, "POST", "/base/projects", {
      session: playerA.session,
      body: {
        definitionRef: { kind: "project", stableId: "install-solar-array", revision: 1 },
        siteId: siteIdOf(snapA, "site_a")
      }
    });
    expect(projectA.status).toBe(201);
    expect(
      (await call(app, "POST", "/base/purchases", {
        session: playerA.session,
        body: { itemId: "anchor", quantity: 2 }
      })).status
    ).toBe(201);

    // B：开工后取消（取消收据 + cancelled 项目行）→ 制造工单 → 采购线缆。
    const snapB = await snapshot(app, playerB.session);
    const projectB = await call(app, "POST", "/base/projects", {
      session: playerB.session,
      body: {
        definitionRef: { kind: "project", stableId: "install-solar-array", revision: 1 },
        siteId: siteIdOf(snapB, "site_a")
      }
    });
    expect(projectB.status).toBe(201);
    const cancelB = await call(
      app,
      "POST",
      `/base/projects/${(projectB.body as { projectId: string }).projectId}/cancel`,
      { session: playerB.session, body: {} }
    );
    expect(cancelB.status).toBe(200);
    const jobB = await call(app, "POST", "/base/manufacturing", {
      session: playerB.session,
      body: { recipeRef: { kind: "recipe", stableId: "manufacture-yd-s1", revision: 1 }, outputsPlanned: 1 }
    });
    expect(jobB.status).toBe(201);
    expect(
      (await call(app, "POST", "/base/purchases", {
        session: playerB.session,
        body: { itemId: "cable", quantity: 1 }
      })).status
    ).toBe(201);

    // 天气日程：真实服务方法（生产 provision 未调用，见文件头）。
    const weather = new WeatherService(db);
    for (const player of [playerA, playerB]) {
      const [row] = (await client.query(`SELECT sim_time FROM bases WHERE id = $1`, [player.baseId])).rows;
      await weather.generateSchedule(db, player.baseId, row!.sim_time as Date);
    }

    // 两个基地：先取得前台控制权，再设 4 倍速并恢复。
    for (const player of [playerA, playerB]) {
      const acquired = await call(app, "POST", "/base/heartbeat", {
        session: player.session, body: { action: "acquire" }
      });
      expect(acquired.status).toBe(200);
      const controlToken = (acquired.body as { controlToken: string }).controlToken;
      expect(controlToken).toBeTruthy();
      for (const body of [{ command: "set_speed", speed: 4 }, { command: "resume" }]) {
        expect((await call(app, "POST", "/base/clock", { session: player.session, body, controlToken })).status).toBe(200);
      }
      expect((await call(app, "POST", "/base/heartbeat", {
        session: player.session, body: { action: "renew", controlToken }
      })).status).toBe(200);
    }

    // 前置条件：A 的工程组电量清零 → 清场步骤本组无人可出工 → 结算发起跨组协作。
    await client.query(
      `UPDATE robot_operators SET battery_wh = 0 WHERE base_id = $1 AND group_id = 'engineering'`,
      [playerA.baseId]
    );

    // 基地 tick 的唯一入口（生产由世界 tick 参与者调用同一方法）；签名若随 tick 编排调整，只改这里。
    const ops = createBaseOperations({ db, config: env });
    const settleOnce = () => db.transaction((tx) => ops.settlement.settleBases(tx, new Date()));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // 结算 1：墙钟增量极小——补订单、发起并决策协作请求。
    await settleOnce();
    // 结算 2：模拟 10 分钟墙钟流逝（×4 倍速 = 40 模拟分钟）——制造产出设备与作业者。
    await client.query(
      `UPDATE bases SET last_advanced_at = now() - interval '10 minutes' WHERE id = ANY($1::uuid[])`,
      [[playerA.baseId, playerB.baseId]]
    );
    await settleOnce();

    // 接单（订单由结算 1 生成）。
    for (const player of [playerA, playerB]) {
      const snap = await snapshot(app, player.session);
      const open = snap.orders.find((order) => order.status === "open");
      expect(open, "open order").toBeDefined();
      const accepted = await call(app, "POST", `/base/orders/${open!.orderId}/accept`, {
        session: player.session,
        body: {}
      });
      expect(accepted.status).toBe(201);
    }

    // 决策审计删除探针：首条协作请求由玩家决定，规则网关不会替它写审计。
    await client.query(
      `INSERT INTO decision_records
         (decision_id, purpose, mode, provider, base_id, plan_revision, question, candidates, latency_ms)
       SELECT $2, 'transport_assistance', 'rule', 'reset-fixture', id, base_revision,
              '重置删除探针', '[]'::jsonb, 0 FROM bases WHERE id = $1`,
      [playerA.baseId, `reset-${randomUUID()}`]
    );

    // 保留类数据：内容发布、AI 调用日志、公告、激活码、旧西幻角色、旧世界命令收据。
    const adminId = (await client.query(`SELECT id FROM accounts WHERE email = $1`, [ADMIN_EMAIL])).rows[0]!
      .id as string;
    await client.query(
      `INSERT INTO content_releases (release_id, payload, content_hash, definition_count, published_by)
       VALUES ($1, '{"robots":[]}'::jsonb, 'hash-reset-probe', 0, $2)`,
      [`workshop-reset-${randomUUID().slice(0, 8)}`, adminId]
    );
    await client.query(
      `INSERT INTO ai_call_logs (provider, model, prompt_version, purpose, account_id, request_hash, input_summary, output_summary, status)
       VALUES ('template', 'template', 1, 'npc_dialogue', $1, 'req-hash', 'in', 'out', 'fallback')`,
      [playerA.accountId]
    );
    await client.query(`INSERT INTO system_announcements (admin_account_id, body) VALUES ($1, '维护公告：保留探针')`, [
      adminId
    ]);
    await client.query(
      `INSERT INTO activation_codes (code_hash, created_by_admin_id) VALUES ($1, $2)`,
      [`code-${randomUUID()}`, adminId]
    );
    // 世界时钟：buildApp 启动时会建 npc_world 行；另放一行探针，保证不依赖启动流程的细节。
    await client.query(
      `INSERT INTO world_runtime_state (key, last_settled_at) VALUES ('reset-probe-clock', now()) ON CONFLICT (key) DO NOTHING`
    );
    const character = await client.query(
      `INSERT INTO characters (account_id, name, class_id, hp, max_hp) VALUES ($1, '旧世界角色', 'warrior', 30, 30) RETURNING id`,
      [playerA.accountId]
    );
    const characterId = character.rows[0]!.id as string;
    for (const kind of ["market.buy", "market.sell"]) {
      await client.query(
        `INSERT INTO command_receipts (actor_scope, command_kind, command_id, request_hash, result)
         VALUES ($1, $2, $3, 'legacy-hash', '{"ok":true}'::jsonb)`,
        [`character:${characterId}`, kind, randomUUID()]
      );
    }

    // 种子完整性：每张基地实例表都有数据（重置断言才有意义）。
    countsBefore = await tableCounts(client, BASE_INSTANCE_TABLES);
    for (const table of BASE_INSTANCE_TABLES) expect(countsBefore[table], table).toBeGreaterThan(0);
    expect(countsBefore.bases).toBe(2);
    const { rows: kinds } = await client.query(
      `SELECT DISTINCT command_kind FROM command_receipts WHERE command_kind LIKE 'base.%' ORDER BY command_kind`
    );
    expect(kinds.map((row) => row.command_kind as string)).toEqual(
      expect.arrayContaining([
        "base.acceptOrder",
        "base.cancelProject",
        "base.createManufacturingJob",
        "base.createProject",
        "base.provision",
        "base.purchase"
      ])
    );
    for (const table of MUST_KEEP_NON_EMPTY) expect(await countRows(client, table), table).toBeGreaterThan(0);
    expect(await countRows(client, "sessions", "revoked_at IS NULL")).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it("单事务守卫：出现未登记的基地关联表时整体拒绝，零写入", async () => {
    const before = await tableCounts(client, BASE_INSTANCE_TABLES);
    const activeSessions = await countRows(client, "sessions", "revoked_at IS NULL");

    await client.query(`CREATE TABLE reset_probe_child (base_id uuid REFERENCES bases(id))`);
    try {
      await expect(runResetSql(client)).rejects.toThrow(/reset_probe_child/);
      await client.query("ROLLBACK");
    } finally {
      await client.query(`DROP TABLE reset_probe_child`);
    }

    await client.query(`CREATE TABLE base_probe_unregistered (id integer)`);
    try {
      await expect(runResetSql(client)).rejects.toThrow(/base_probe_unregistered/);
      await client.query("ROLLBACK");
    } finally {
      await client.query(`DROP TABLE base_probe_unregistered`);
    }

    expect(await tableCounts(client, BASE_INSTANCE_TABLES)).toEqual(before);
    expect(await countRows(client, "sessions", "revoked_at IS NULL")).toBe(activeSessions);
  }, 60_000);

  it("重置：基地实例表全空、基地收据清除、全部会话吊销，其余表逐行不变", async () => {
    retainedBefore = await retainedFingerprints(client);
    sessionsBefore = await sessionIdentityFingerprint(client);
    receiptsBefore = await nonBaseReceiptFingerprint(client);
    expect(receiptsBefore.startsWith("2:")).toBe(true);
    for (const table of MUST_KEEP_NON_EMPTY) expect(Object.keys(retainedBefore)).toContain(table);
    const baseReceiptsBefore = await countRows(client, "command_receipts", "command_kind LIKE 'base.%'");
    expect(baseReceiptsBefore).toBeGreaterThan(0);
    const activeSessionsBefore = await countRows(client, "sessions", "revoked_at IS NULL");

    const results = await runResetSql(client);
    const commands = results.map((result) => result.command);
    expect(commands[0]).toBe("BEGIN");
    expect(commands[commands.length - 1]).toBe("COMMIT");

    // ① 基地实例表全空。
    const after = await tableCounts(client, BASE_INSTANCE_TABLES);
    for (const table of BASE_INSTANCE_TABLES) expect(after[table], table).toBe(0);
    // DELETE 回报总行数 = 基地实例行 + 基地命令收据行（没有删到清单以外的东西）。
    const deletedTotal = results
      .filter((result) => result.command === "DELETE")
      .reduce((sum, result) => sum + (result.rowCount ?? 0), 0);
    const baseTotal = Object.values(countsBefore).reduce((sum, n) => sum + n, 0);
    expect(deletedTotal).toBe(baseTotal + baseReceiptsBefore);
    // UPDATE 回报 = 吊销前的活跃会话数。
    const revoked = results.find((result) => result.command === "UPDATE");
    expect(revoked?.rowCount).toBe(activeSessionsBefore);

    // ② 基地命令收据清除；旧世界收据逐行不变。
    expect(await countRows(client, "command_receipts", "command_kind LIKE 'base.%'")).toBe(0);
    expect(await countRows(client, "command_receipts", "actor_scope LIKE 'base:%'")).toBe(0);
    expect(await nonBaseReceiptFingerprint(client)).toBe(receiptsBefore);
    expect(await countRows(client, "command_receipts")).toBe(2);

    // ③ 会话：行保留、除 revoked_at 外不变、全部已吊销。
    expect(await sessionIdentityFingerprint(client)).toBe(sessionsBefore);
    expect(await countRows(client, "sessions", "revoked_at IS NULL")).toBe(0);

    // ④ 其余全部表（账号/管理员/内容/审计/AI 日志/公告/世界时钟/旧世界）逐行不变。
    expect(await retainedFingerprints(client)).toEqual(retainedBefore);
    expect(await countRows(client, "accounts", `email = '${ADMIN_EMAIL}' AND role = 'admin'`)).toBe(1);
  }, 60_000);

  it("幂等：再次执行成功且零变更", async () => {
    const results = await runResetSql(client);
    const changes = results
      .filter((result) => result.command === "DELETE" || result.command === "UPDATE")
      .map((result) => result.rowCount ?? 0);
    expect(changes.length).toBeGreaterThan(BASE_INSTANCE_TABLES.length);
    expect(changes.every((n) => n === 0)).toBe(true);
    expect(await retainedFingerprints(client)).toEqual(retainedBefore);
    expect(await sessionIdentityFingerprint(client)).toBe(sessionsBefore);
  }, 60_000);

  it("旧会话失效；重新登录 + provision 得到新基地，开局物资/设备与新号一致", async () => {
    // 旧 cookie（刷新页面走的就是它）→ 401，客户端回到登录页。
    expect((await call(app, "GET", "/base/snapshot", { session: playerA.session })).status).toBe(401);
    expect((await call(app, "POST", "/base/heartbeat", { session: playerB.session, body: {} })).status).toBe(401);
    expect((await call(app, "GET", "/admin/content/drafts", { session: adminSession })).status).toBe(401);

    // A：账号登录 → 尚无基地（403）→ provision 新建。
    const login = await call(app, "POST", "/auth/login", { body: { email: playerA.email, password: PLAYER_PASSWORD } });
    expect(login.status).toBe(200);
    const sessionA = toSession(login, (login.body as { csrfToken: string }).csrfToken);
    const noBase = await call(app, "GET", "/base/snapshot", { session: sessionA });
    expect(noBase.status).toBe(403);
    expect((noBase.body as { error: { code: string } }).error.code).toBe("BASE_SCOPE_INVALID");
    const provisioned = await call(app, "POST", "/base/provision", { session: sessionA, body: {} });
    expect(provisioned.status).toBe(200);
    const reprovA = provisioned.body as { baseId: string; duplicate: boolean };
    expect(reprovA.duplicate).toBe(false);
    expect(reprovA.baseId).not.toBe(playerA.baseId);

    // B：用同一邮箱+密码走“试玩注册”（已存在账号按登录处理）→ 同样得到新基地。
    const reRegister = await call(app, "POST", "/base/playtest-register", {
      body: { email: playerB.email, password: PLAYER_PASSWORD }
    });
    expect(reRegister.status).toBe(201);
    const reRegisterBody = reRegister.body as { user: { accountId: string }; baseId: string; csrfToken: string };
    expect(reRegisterBody.user.accountId).toBe(playerB.accountId);
    expect(reRegisterBody.baseId).not.toBe(playerB.baseId);
    const sessionB = toSession(reRegister, reRegisterBody.csrfToken);

    // 新号基准。
    const fresh = await registerPlayer(app, `reset-c-${randomUUID().slice(0, 8)}@example.test`);

    const shapeA = openingShape(await snapshot(app, sessionA));
    const shapeB = openingShape(await snapshot(app, sessionB));
    const shapeFresh = openingShape(await snapshot(app, fresh.session));
    expect(shapeA).toEqual(shapeFresh);
    expect(shapeB).toEqual(shapeFresh);
    // 新号基准本身是开局形态（没有继承任何旧经营数据）。
    expect(shapeFresh.devices).toHaveLength(12);
    expect(shapeFresh.resources).toHaveLength(6);
    expect(shapeFresh.credits).toBe(1200);
    expect(shapeFresh.timeMode).toBe("paused");
    expect(shapeFresh.projects + shapeFresh.manufacturingJobs + shapeFresh.cooperationRequests).toBe(0);
    expect(shapeFresh.purchases).toBe(0);
    expect(shapeFresh.sites.filter((site) => site.state === "free").map((site) => site.siteKey)).toEqual([
      "site_a",
      "site_b"
    ]);
    expect(await countRows(client, "bases")).toBe(3);

    // 管理员重新登录后内容草稿仍在。
    const adminLogin = await call(app, "POST", "/auth/login", {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    expect(adminLogin.status).toBe(200);
    const newAdminSession = toSession(adminLogin, (adminLogin.body as { csrfToken: string }).csrfToken);
    const drafts = await call(app, "GET", "/admin/content/drafts", { session: newAdminSession });
    expect(drafts.status).toBe(200);
    expect(
      (drafts.body as { drafts: Array<{ stableId: string }> }).drafts.map((entry) => entry.stableId)
    ).toContain(draftStableId);
  }, 120_000);
});
