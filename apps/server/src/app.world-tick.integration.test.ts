import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import type { Env } from "./config/env.js";
import { createDb, type Db } from "./db/client.js";
import { DrizzleAuditWriter } from "./modules/audit/audit.repository.js";
import { BaseRepository } from "./modules/world-runtime/base.repository.js";
import { systemWorldClock } from "./modules/world-runtime/world-clock.js";
import { WorldPostTickService } from "./modules/world-runtime/world-post-tick.service.js";
import { floorToTick, WORLD_RUNTIME_TICK_MS } from "./modules/world-runtime/world-runtime.service.js";
import { WorldResetRepository } from "./modules/world-reset/world-reset.repository.js";
import {
  WORLD_RESET_CONFIRMATION_TEXT,
  WorldResetService
} from "./modules/world-reset/world-reset.service.js";

// 车道 C 真 PG 验收（第 0 阶段合同 C1/C2/C4/C6，评审 ARCH-domain-03、ARCH-boundaries-01/02）：
// 经 buildApp 的真实组合根驱动世界 tick（app.di.worldRuntime.settleDue），三个经试玩注册
// provision 的真实基地：
//   C1 默认（LEGACY_WORLD_ENABLED 未设）tick 不运行旧 NPC 世界/旧副本/旧 post-tick；显式开启后恢复；
//   C4 注入某基地结算失败（PG 触发器）→ 其他基地照常推进、世界时钟推进、错误日志带 baseId；
//      某基地行被玩家事务持锁 → tick 跳过它（SKIP LOCKED），不排队等待；
//   C2 旧世界重置（开关开启时仍可用）把共享时钟对齐到重置时刻所在 tick，而不是 1970。

const { Client } = pg;
const testFile = fileURLToPath(import.meta.url);
const serverRoot = dirname(dirname(testFile));
const drizzleDir = join(serverRoot, "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");
const COOKIE_NAME = "ai_mud_session";

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("DATABASE_URL not set; skipping world tick orchestration PG tests");
    return null;
  }
  return url;
}

function databaseUrlForName(databaseUrl: string, databaseName: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function createTempDatabaseFromMigrations(baseDatabaseUrl: string) {
  const databaseName = `ai_mud_vitest_tickorch_${process.pid}_${randomUUID().replace(/-/g, "")}`;
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
      await client.query(statement);
    }
  }
  return { databaseName, targetUrl, client };
}

function makeEnv(databaseUrl: string, legacyWorldEnabled: boolean | undefined): Env {
  return {
    NODE_ENV: "test",
    PLAYTEST_REGISTRATION_ENABLED: true,
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
    AI_DAILY_TOKEN_BUDGET: null,
    ...(legacyWorldEnabled === undefined ? {} : { LEGACY_WORLD_ENABLED: legacyWorldEnabled })
  };
}

interface Player {
  accountId: string;
  baseId: string;
}

interface BaseClockRow {
  simTime: number;
  lastAdvancedAt: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

describe("world tick orchestration (buildApp + temporary PostgreSQL)", () => {
  let databaseUrl: string | null = null;
  let databaseName = "";
  let client: pg.Client;
  let db: Db;
  let closeDb: (() => Promise<void>) | null = null;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const players: Player[] = [];

  async function readClock(baseId: string): Promise<BaseClockRow> {
    const { rows } = await client.query<{ sim_time: Date; last_advanced_at: Date }>(
      `SELECT sim_time, last_advanced_at FROM bases WHERE id = $1`,
      [baseId]
    );
    const row = rows[0];
    if (!row) throw new Error(`base ${baseId} missing`);
    return { simTime: row.sim_time.getTime(), lastAdvancedAt: row.last_advanced_at.getTime() };
  }

  // 单个 pg.Client 上逐条查询（并发 client.query 在 pg@8 已弃用、pg@9 移除）。
  async function readAllClocks(): Promise<BaseClockRow[]> {
    const clocks: BaseClockRow[] = [];
    for (const player of players) clocks.push(await readClock(player.baseId));
    return clocks;
  }

  async function readWorldClock(): Promise<number> {
    const { rows } = await client.query<{ last_settled_at: Date }>(
      `SELECT last_settled_at FROM world_runtime_state WHERE key = 'npc_world'`
    );
    const row = rows[0];
    if (!row) throw new Error("world runtime row missing");
    return row.last_settled_at.getTime();
  }

  async function countRows(table: string): Promise<number> {
    const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
    return rows[0]?.n ?? 0;
  }

  // 一个世界 tick 恰好到期；每个基地 running、租约有效、距上次推进 60 秒。
  async function primeOneDueTick(now: Date) {
    await client.query(`UPDATE world_runtime_state SET last_settled_at = $1 WHERE key = 'npc_world'`, [
      new Date(floorToTick(now).getTime() - WORLD_RUNTIME_TICK_MS)
    ]);
    await client.query(`UPDATE base_control_leases SET lease_until = $1`, [
      new Date(now.getTime() + 10 * 60_000)
    ]);
    await client.query(`UPDATE bases SET time_mode = 'running', last_advanced_at = $1`, [
      new Date(now.getTime() - 60_000)
    ]);
  }

  beforeAll(async () => {
    databaseUrl = requireDatabaseUrl();
    if (!databaseUrl) return;
    const created = await createTempDatabaseFromMigrations(databaseUrl);
    databaseName = created.databaseName;
    client = created.client;
    const connection = createDb(created.targetUrl);
    db = connection.db;
    closeDb = connection.close;
    app = await buildApp({ env: makeEnv(created.targetUrl, undefined), db });

    for (const name of ["tick-a", "tick-b", "tick-c"]) {
      const registered = await app.inject({
        method: "POST",
        url: "/base/playtest-register",
        payload: { email: `${name}@p0c.test`, password: "simple-playtest-pass" }
      });
      expect(registered.statusCode).toBe(201);
      const body = registered.json();
      const rawCookie = registered.headers["set-cookie"];
      const cookie = String(Array.isArray(rawCookie) ? rawCookie[0] : rawCookie).split(";")[0]!;
      const resumed = await app.inject({
        method: "POST",
        url: "/base/clock",
        payload: { command: "resume" },
        headers: { cookie, "x-csrf-token": body.csrfToken }
      });
      expect(resumed.statusCode).toBe(200);
      players.push({ accountId: body.user.accountId, baseId: body.baseId });
    }

    // 故障注入：列入 faulty_bases 的基地，任何对其 bases 行的 UPDATE 都抛错（结算事务随之回滚）。
    await client.query(`CREATE TABLE faulty_bases (base_id uuid PRIMARY KEY)`);
    await client.query(`
      CREATE FUNCTION inject_base_settlement_fault() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM faulty_bases WHERE base_id = NEW.id) THEN
          RAISE EXCEPTION 'injected settlement fault for base %', NEW.id;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.query(`
      CREATE TRIGGER bases_settlement_fault BEFORE UPDATE ON bases
      FOR EACH ROW EXECUTE FUNCTION inject_base_settlement_fault()
    `);
  }, 180_000);

  afterAll(async () => {
    if (!databaseUrl) return;
    if (app) await app.close();
    if (closeDb) await closeDb();
    if (client) await client.end();
    const adminClient = new Client({ connectionString: databaseUrlForName(databaseUrl, "postgres") });
    await adminClient.connect();
    await adminClient.query(`DROP DATABASE ${JSON.stringify(databaseName)} WITH (FORCE)`);
    await adminClient.end();
  }, 120_000);

  it("C1: a default tick settles bases without running any legacy world participant", async () => {
    if (!databaseUrl) return;
    const now = new Date();
    await primeOneDueTick(now);
    const before = await readAllClocks();
    // 旧 post-tick 的入口。空库里旧世界从未 seed，旧 post-tick 即使运行也写不出任务/传闻，
    // 行数断言证明不了门控；直接监视入口是否被调用（门控回归时此断言失败）。
    const postTickRun = vi.spyOn(WorldPostTickService.prototype, "run");
    try {
      const result = await app.di.worldRuntime.settleDue(now);
      await app.di.worldRuntime.idle();

      expect(result).toEqual({ settledSteps: 1, skipped: false });
      expect(postTickRun).not.toHaveBeenCalled();
    } finally {
      postTickRun.mockRestore();
    }

    const after = await readAllClocks();
    after.forEach((clock, index) => {
      expect(clock.simTime).toBeGreaterThan(before[index]!.simTime);
    });
    // 旧 NPC 世界结算会先 ensureWorldSeeded（建黑松金库/市场库存/资源点）；旧 post-tick 写 NPC 任务/传闻。
    expect(await countRows("municipal_treasury")).toBe(0);
    expect(await countRows("market_inventory")).toBe(0);
    expect(await countRows("world_resource_nodes")).toBe(0);
    expect(await countRows("npc_tasks")).toBe(0);
    expect(await countRows("world_rumors")).toBe(0);
  }, 60_000);

  it("C4: one failing base does not block the other bases or the world clock, and is logged with its baseId", async () => {
    if (!databaseUrl) return;
    const [baseA, baseBad, baseC] = players;
    const now = new Date();
    await primeOneDueTick(now);
    const beforeA = await readClock(baseA!.baseId);
    const beforeBad = await readClock(baseBad!.baseId);
    const beforeC = await readClock(baseC!.baseId);
    await client.query(`INSERT INTO faulty_bases (base_id) VALUES ($1)`, [baseBad!.baseId]);
    const errorSpy = vi.spyOn(app.log, "error");
    try {
      const result = await app.di.worldRuntime.settleDue(now);

      expect(result).toEqual({ settledSteps: 1, skipped: false });
      expect(await readWorldClock()).toBe(floorToTick(now).getTime());
      expect((await readClock(baseA!.baseId)).simTime).toBeGreaterThan(beforeA.simTime);
      expect((await readClock(baseC!.baseId)).simTime).toBeGreaterThan(beforeC.simTime);
      expect(await readClock(baseBad!.baseId)).toEqual(beforeBad);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ baseId: baseBad!.baseId }),
        expect.any(String)
      );
      const loggedBaseIds = errorSpy.mock.calls
        .map(([payload]) => (payload as { baseId?: string } | undefined)?.baseId)
        .filter(Boolean);
      expect(loggedBaseIds).toEqual([baseBad!.baseId]);
    } finally {
      errorSpy.mockRestore();
      await client.query(`DELETE FROM faulty_bases`);
    }
  }, 60_000);

  it("C4: a base row held by a player transaction is skipped for this tick instead of stalling the tick", async () => {
    if (!databaseUrl) return;
    const [baseA, baseB, baseC] = players;
    const now = new Date();
    await primeOneDueTick(now);
    const beforeA = await readClock(baseA!.baseId);
    const beforeB = await readClock(baseB!.baseId);
    const beforeC = await readClock(baseC!.baseId);

    const blocker = new Client({ connectionString: databaseUrlForName(databaseUrl, databaseName) });
    await blocker.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(`SELECT id FROM bases WHERE id = $1 FOR UPDATE`, [baseA!.baseId]);

      const result = await withTimeout(
        app.di.worldRuntime.settleDue(now),
        10_000,
        "world tick waited on a base row locked by another transaction"
      );

      expect(result).toEqual({ settledSteps: 1, skipped: false });
      expect((await readClock(baseB!.baseId)).simTime).toBeGreaterThan(beforeB.simTime);
      expect((await readClock(baseC!.baseId)).simTime).toBeGreaterThan(beforeC.simTime);
    } finally {
      await blocker.query("ROLLBACK");
      await blocker.end();
    }
    // 被跳过的基地保留 lastAdvancedAt：下个 tick 按真实流逝补上，不丢时长。
    expect(await readClock(baseA!.baseId)).toEqual(beforeA);
    await app.di.worldRuntime.idle();
  }, 60_000);

  it("C1: LEGACY_WORLD_ENABLED=true brings the legacy world participants back into the tick", async () => {
    if (!databaseUrl) return;
    const legacyApp = await buildApp({ env: makeEnv(databaseUrlForName(databaseUrl, databaseName), true), db });
    try {
      const now = new Date();
      await primeOneDueTick(now);
      const before = await readAllClocks();
      const postTickRun = vi.spyOn(WorldPostTickService.prototype, "run");
      try {
        const result = await legacyApp.di.worldRuntime.settleDue(now);
        await legacyApp.di.worldRuntime.idle();

        expect(result).toEqual({ settledSteps: 1, skipped: false });
        // 开关开启：旧 post-tick（NPC 任务/传闻）随世界步恢复运行。
        expect(postTickRun).toHaveBeenCalledTimes(1);
        expect(postTickRun).toHaveBeenCalledWith(now);
      } finally {
        postTickRun.mockRestore();
      }

      expect(await countRows("municipal_treasury")).toBeGreaterThan(0);
      expect(await countRows("world_resource_nodes")).toBeGreaterThan(0);
      const after = await readAllClocks();
      after.forEach((clock, index) => {
        expect(clock.simTime).toBeGreaterThan(before[index]!.simTime);
      });
    } finally {
      await legacyApp.close();
    }
  }, 60_000);

  it("C2: a legacy world reset aligns the shared clock to the reset tick, so the next tick produces instead of catching up from 1970", async () => {
    if (!databaseUrl) return;
    const legacyApp = await buildApp({ env: makeEnv(databaseUrlForName(databaseUrl, databaseName), true), db });
    try {
      const resetAt = new Date();
      await db.transaction(async (tx) => {
        await new WorldResetService({
          repository: new WorldResetRepository(tx),
          audit: new DrizzleAuditWriter(tx),
          now: () => resetAt
        }).resetWorld({
          actorAccountId: players[0]!.accountId,
          confirmationText: WORLD_RESET_CONFIRMATION_TEXT,
          reason: "车道 C2 回归：重置后时钟不得回到 1970"
        });
      });

      expect(await readWorldClock()).toBe(floorToTick(resetAt).getTime());

      // 基地侧：下一次 tick 的步对基地不是追补步（旧实现 tickAt=1970-01-01T00:01Z → catchUp=true）。
      const nextTickAt = new Date(floorToTick(resetAt).getTime() + WORLD_RUNTIME_TICK_MS);
      await client.query(`UPDATE base_control_leases SET lease_until = $1`, [
        new Date(Date.now() + 10 * 60_000)
      ]);
      await client.query(`UPDATE bases SET time_mode = 'running', last_advanced_at = $1`, [
        new Date(Date.now() - 60_000)
      ]);
      const advanceable = await db.transaction((tx) =>
        new BaseRepository(db, systemWorldClock).lockAdvanceableBases(tx, nextTickAt)
      );
      expect(advanceable.map((base) => base.baseId).sort()).toEqual(
        players.map((player) => player.baseId).sort()
      );
      expect(advanceable.every((base) => base.catchUp === false)).toBe(true);

      // 世界侧：一次唤醒只需推进 1 步即追平（旧实现从 1970 起每次 60 步仍追不平）。
      const result = await legacyApp.di.worldRuntime.settleDue(nextTickAt);
      await legacyApp.di.worldRuntime.idle();
      expect(result).toEqual({ settledSteps: 1, skipped: false });
      expect(await readWorldClock()).toBe(nextTickAt.getTime());
    } finally {
      await legacyApp.close();
    }
  }, 60_000);
});
