import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Env } from "../../../config/env.js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../../app.js";
import { createDb, type Db } from "../../../db/client.js";

// M12-Q 独立验收（G01/G06 主证据 + REST 合同负例）：buildApp + inject + 临时库。
// 合同：docs/reviews/base-operations/m12-p-contract.md §6 REST 面。
//   ① 默认 env（PLAYTEST_REGISTRATION_ENABLED=false）注册 → 403（正式部署不无声开放）；
//   ② =true → 201 {user, baseId, csrfToken} + Set-Cookie（注册即直达基地，G01）；
//   ③ 无 cookie GET /base/snapshot → 401；
//   ④ 账号 A 只见自己基地（无跨基地端点，G06）；写命令缺 csrf → 403（csrf 门）；
//   ⑤ 旧 revision createProject → CONTENT_INCOMPATIBLE（不 fallback latest，S4）；
//   ⑥ snapshot 键面 + devices=12；
//   ⑦ 同 commandId createProject 幂等：201 → 200 duplicate 同 projectId。

const { Client } = pg;
const testFile = fileURLToPath(import.meta.url);
const serverRoot = dirname(dirname(dirname(dirname(dirname(testFile)))));
const drizzleDir = join(serverRoot, "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");

const COOKIE_NAME = "ai_mud_session";

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("DATABASE_URL not set; skipping base contract HTTP tests");
    return null;
  }
  return url;
}

function makeTempDatabaseName() {
  return `ai_mud_vitest_basehttp_${process.pid}_${randomUUID().replace(/-/g, "")}`;
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
  targetUrl: string;
  dispose: () => Promise<void>;
}

async function createHarness(databaseUrl: string): Promise<Harness> {
  const { databaseName, targetUrl, client } = await createTempDatabaseFromMigrations(databaseUrl);
  const { db, close } = createDb(targetUrl);
  return {
    client,
    db,
    targetUrl,
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

function makeEnv(playtestRegistrationEnabled: boolean, databaseUrl: string): Env {
  return {
    NODE_ENV: "test",
    PLAYTEST_REGISTRATION_ENABLED: playtestRegistrationEnabled,
    SERVER_HOST: "127.0.0.1",
    SERVER_PORT: 3000,
    DATABASE_URL: databaseUrl,
    SESSION_COOKIE_NAME: COOKIE_NAME,
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

function sessionCookieOf(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  expect(typeof first).toBe("string");
  return (first as string).split(";")[0]!;
}

interface Session {
  accountId: string;
  baseId: string;
  csrfToken: string;
  cookie: string;
}

describe("base REST contract negatives (buildApp + inject, temporary PostgreSQL)", () => {
  let harness: Harness;
  let appDefault: Awaited<ReturnType<typeof buildApp>>;
  let appOpen: Awaited<ReturnType<typeof buildApp>>;
  let accountA: Session;
  let accountB: Session;

  beforeAll(async () => {
    const databaseUrl = requireDatabaseUrl();
    if (!databaseUrl) return;
    harness = await createHarness(databaseUrl);
    appDefault = await buildApp({ env: makeEnv(false, harness.targetUrl), db: harness.db });
    appOpen = await buildApp({ env: makeEnv(true, harness.targetUrl), db: harness.db });

    // 账号 A / B：经开放注册各自 provision 独立基地（M12-I 真实链）。
    for (const [name, store] of [
      ["contract-a@q.test", "a"],
      ["contract-b@q.test", "b"]
    ] as const) {
      const response = await appOpen.inject({
        method: "POST",
        url: "/base/playtest-register",
        payload: { email: name, password: "simple-playtest-pass" }
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      const session: Session = {
        accountId: body.user.accountId,
        baseId: body.baseId,
        csrfToken: body.csrfToken,
        cookie: sessionCookieOf(response)
      };
      if (store === "a") accountA = session;
      else accountB = session;
    }
  }, 180_000);

  afterAll(async () => {
    if (appDefault) await appDefault.close();
    if (appOpen) await appOpen.close();
    if (harness) await harness.dispose();
  }, 120_000);

  it("rejects playtest registration while PLAYTEST_REGISTRATION_ENABLED is default false", async () => {
    if (!process.env.DATABASE_URL) return;

    const response = await appDefault.inject({
      method: "POST",
      url: "/base/playtest-register",
      payload: { email: "closed-mode@q.test", password: "simple-playtest-pass" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
    expect(response.headers["set-cookie"]).toBeUndefined();
  }, 60_000);

  it("registers with 201 {user, baseId, csrfToken} and a session cookie when enabled", async () => {
    if (!process.env.DATABASE_URL) return;

    // 直接另注册一个新账号，完整断言 201 合同。
    const response = await appOpen.inject({
      method: "POST",
      url: "/base/playtest-register",
      payload: { email: "contract-reg@q.test", password: "simple-playtest-pass" }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.user.accountId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.user.email).toBe("contract-reg@q.test");
    expect(body.baseId).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof body.csrfToken).toBe("string");
    expect(body.csrfToken.length).toBeGreaterThan(0);
    // Set-Cookie 存在且是会话 cookie（注册即自动登录）。
    const cookie = sessionCookieOf(response);
    expect(cookie.startsWith(`${COOKIE_NAME}=`)).toBe(true);
    expect(cookie.length).toBeGreaterThan(COOKIE_NAME.length + 1);

    // 注册响应即含基地：bases 表确实落了该账号的基地。
    const { rows } = await harness.client.query(
      `SELECT id FROM bases WHERE account_id = $1`,
      [body.user.accountId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(body.baseId);
  }, 60_000);

  it("rejects snapshot without a session cookie with 401", async () => {
    if (!process.env.DATABASE_URL) return;

    const response = await appOpen.inject({ method: "GET", url: "/base/snapshot" });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHENTICATED");
  }, 60_000);

  it("serves only the owning account's base and gates clock writes behind CSRF", async () => {
    if (!process.env.DATABASE_URL) return;

    // A 的会话只能看到 A 的基地；与 B 的基地互不相同（无跨基地端点可探测）。
    const snapshot = await appOpen.inject({
      method: "GET",
      url: "/base/snapshot",
      headers: { cookie: accountA.cookie }
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().baseId).toBe(accountA.baseId);
    expect(snapshot.json().baseId).not.toBe(accountB.baseId);

    // B 的会话同样只见 B 的基地。
    const snapshotB = await appOpen.inject({
      method: "GET",
      url: "/base/snapshot",
      headers: { cookie: accountB.cookie }
    });
    expect(snapshotB.json().baseId).toBe(accountB.baseId);

    // csrf 门：带合法会话但缺 x-csrf-token 的写命令 → 403。
    const noCsrf = await appOpen.inject({
      method: "POST",
      url: "/base/clock",
      payload: { command: "pause" },
      headers: { cookie: accountA.cookie }
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().error.code).toBe("FORBIDDEN");
  }, 60_000);

  it("rejects a stale revision definitionRef with CONTENT_INCOMPATIBLE and leaves the site free", async () => {
    if (!process.env.DATABASE_URL) return;

    const { rows } = await harness.client.query(
      `SELECT id FROM base_sites WHERE base_id = $1 AND site_key = 'site_a'`,
      [accountA.baseId]
    );
    const siteAId = rows[0]!.id as string;

    const response = await appOpen.inject({
      method: "POST",
      url: "/base/projects",
      payload: {
        definitionRef: { kind: "project", stableId: "install-solar-array", revision: 999 },
        siteId: siteAId
      },
      headers: { cookie: accountA.cookie, "x-csrf-token": accountA.csrfToken }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("CONTENT_INCOMPATIBLE");

    // 不 fallback latest：无项目、site_a 仍 free。
    const { rows: projects } = await harness.client.query(
      `SELECT COUNT(*)::int AS n FROM base_projects WHERE base_id = $1`,
      [accountA.baseId]
    );
    expect(projects[0]!.n).toBe(0);
    const { rows: sites } = await harness.client.query(
      `SELECT state FROM base_sites WHERE id = $1`,
      [siteAId]
    );
    expect(sites[0]!.state).toBe("free");
  }, 60_000);

  it("exposes the frozen snapshot keys with 12 devices", async () => {
    if (!process.env.DATABASE_URL) return;

    const response = await appOpen.inject({
      method: "GET",
      url: "/base/snapshot",
      headers: { cookie: accountA.cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    for (const key of ["baseId", "simTime", "timeMode", "power", "storageWh", "devices", "projects"]) {
      if (key === "storageWh") {
        expect(body.power).toHaveProperty("storageWh");
      } else {
        expect(body).toHaveProperty(key);
      }
    }
    expect(typeof body.simTime).toBe("string");
    expect(body.timeMode).toBe("paused");
    expect(body.power.storageWh).toBe(100000);
    expect(body.power.storageCapacityWh).toBe(200000);
    expect(body.power.generationWPeak).toBe(15000);
    expect(Array.isArray(body.projects)).toBe(true);
    expect(body.projects).toHaveLength(0);
    expect(body.devices).toHaveLength(12);
    // 每台设备初始电量 60%：驮运 12000/20000。
    const transports = body.devices.filter((device: { groupId: string }) => device.groupId === "transport");
    expect(transports).toHaveLength(4);
    expect(transports[0].batteryWh).toBe(12000);
    expect(transports[0].batteryCapacityWh).toBe(20000);
  }, 60_000);

  it("replays a repeated createProject commandId over HTTP (201 then 200 duplicate)", async () => {
    if (!process.env.DATABASE_URL) return;

    const { rows } = await harness.client.query(
      `SELECT id FROM base_sites WHERE base_id = $1 AND site_key = 'site_a'`,
      [accountA.baseId]
    );
    const siteAId = rows[0]!.id as string;
    const commandId = randomUUID();
    const payload = {
      definitionRef: { kind: "project", stableId: "install-solar-array", revision: 1 },
      siteId: siteAId,
      commandId
    };
    const headers = { cookie: accountA.cookie, "x-csrf-token": accountA.csrfToken };

    const first = await appOpen.inject({ method: "POST", url: "/base/projects", payload, headers });
    expect(first.statusCode).toBe(201);
    expect(first.json().duplicate).toBe(false);

    const second = await appOpen.inject({ method: "POST", url: "/base/projects", payload, headers });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ projectId: first.json().projectId, duplicate: true });

    // 库里仍只有一个项目。
    const { rows: projects } = await harness.client.query(
      `SELECT COUNT(*)::int AS n FROM base_projects WHERE base_id = $1`,
      [accountA.baseId]
    );
    expect(projects[0]!.n).toBe(1);
  }, 60_000);
});
