import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import type { Env } from "./config/env.js";
import { createDb, type Db } from "./db/client.js";
import { BaseEventRepository } from "./modules/world-runtime/base-event.repository.js";
import { floorToTick, WORLD_RUNTIME_TICK_MS } from "./modules/world-runtime/world-runtime.service.js";

// D010/D013 真 PG 集成验收（R06 症状指纹回归）：
//   ① 幽灵租约 TTL 到期由世界 tick 真正释放（死会话不再占用控制权）；
//   ② 租约恢复后 sim 直接恢复推进，无需 renew、无需暂停/恢复切换（R06 表型 B）；
//   ③ 控制权失效 409 携带机器可读原因（GHOST_LEASE/HEARTBEAT_STALE）；
//   ④ 快照如实携带 effectiveRunning/pauseReason（D010 契约字段）；
//   ⑤ 事件历史端点（D013 契约：鉴权/降序/limit/DTO 形状）。
// 推进以真实墙钟为唯一基准（L004），故本文件用假 Date 时钟显式走钟（toFake 仅 Date，
// 定时器/网络保持真实）；所有 SQL 时间量用显式参数，不经 PG now()。

const { Client } = pg;
const testFile = fileURLToPath(import.meta.url);
const serverRoot = dirname(dirname(testFile));
const drizzleDir = join(serverRoot, "drizzle");
const COOKIE_NAME = "ai_mud_session";

// T0 落在分钟界 30s 处：floor(T0)=12:00:00，分钟边界推演确定。
const T0 = new Date("2026-09-27T12:00:30.000Z");

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("DATABASE_URL not set; skipping lease recovery PG tests");
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
  const databaseName = `ai_mud_vitest_leaserec_${process.pid}_${randomUUID().replace(/-/g, "")}`;
  const adminClient = new Client({ connectionString: databaseUrlForName(baseDatabaseUrl, "postgres") });
  await adminClient.connect();
  await adminClient.query(`CREATE DATABASE ${JSON.stringify(databaseName)}`);
  await adminClient.end();

  const targetUrl = databaseUrlForName(baseDatabaseUrl, databaseName);
  const client = new Client({ connectionString: targetUrl });
  await client.connect();
  const journal = JSON.parse(await readFile(join(drizzleDir, "meta", "_journal.json"), "utf8")) as {
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

function makeEnv(databaseUrl: string): Env {
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
    AI_DAILY_TOKEN_BUDGET: null
  };
}

interface Session {
  cookie: string;
  csrfToken: string;
  accountId: string;
  baseId: string;
}

describe("base lease recovery and event history (buildApp + temporary PostgreSQL)", () => {
  let databaseUrl: string | null = null;
  let databaseName = "";
  let client: pg.Client;
  let db: Db;
  let closeDb: (() => Promise<void>) | null = null;
  let app: Awaited<ReturnType<typeof buildApp>>;

  const registerPlayer = async (name: string): Promise<Session> => {
    const registered = await app.inject({
      method: "POST",
      url: "/base/playtest-register",
      payload: { email: `${name}@fixa.test`, password: "simple-playtest-pass" }
    });
    expect(registered.statusCode).toBe(201);
    const body = registered.json();
    const rawCookie = registered.headers["set-cookie"];
    const cookie = String(Array.isArray(rawCookie) ? rawCookie[0] : rawCookie).split(";")[0]!;
    return {
      cookie,
      csrfToken: body.csrfToken,
      accountId: body.user.accountId,
      baseId: body.baseId
    };
  };

  const snapshot = async (session: Session, controlToken?: string) => {
    const response = await app.inject({
      method: "GET",
      url: "/base/snapshot",
      headers: {
        cookie: session.cookie,
        ...(controlToken ? { "x-base-control-token": controlToken } : {})
      }
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  };

  const heartbeat = async (
    session: Session,
    payload: Record<string, unknown>
  ) => {
    return app.inject({
      method: "POST",
      url: "/base/heartbeat",
      payload,
      headers: { cookie: session.cookie, "x-csrf-token": session.csrfToken }
    });
  };

  const clockCommand = async (
    session: Session,
    payload: Record<string, unknown>,
    controlToken?: string
  ) => {
    return app.inject({
      method: "POST",
      url: "/base/clock",
      payload,
      headers: {
        cookie: session.cookie,
        "x-csrf-token": session.csrfToken,
        ...(controlToken ? { "x-base-control-token": controlToken } : {})
      }
    });
  };

  const readClock = async (baseId: string) => {
    const { rows } = await client.query<{ sim_time: Date; last_advanced_at: Date }>(
      `SELECT sim_time, last_advanced_at FROM bases WHERE id = $1`,
      [baseId]
    );
    const row = rows[0];
    if (!row) throw new Error(`base ${baseId} missing`);
    return { simTime: row.sim_time.getTime(), lastAdvancedAt: row.last_advanced_at.getTime() };
  };

  // 把世界 tick 游标拨到 now 所在分钟的前一格：下一次 settleDue(now+≥60s) 恰好结算
  // floor(now) 与 floor(now)+60s 两步（由用例自行选择结算终点）。
  const primeTickCursor = (now: Date) => {
    return client.query(`UPDATE world_runtime_state SET last_settled_at = $1 WHERE key = 'npc_world'`, [
      new Date(floorToTick(now).getTime() - WORLD_RUNTIME_TICK_MS)
    ]);
  };

  const setClock = (at: Date) => {
    vi.setSystemTime(at);
  };

  beforeAll(async () => {
    databaseUrl = requireDatabaseUrl();
    if (!databaseUrl) return;
    const created = await createTempDatabaseFromMigrations(databaseUrl);
    databaseName = created.databaseName;
    client = created.client;
    const connection = createDb(created.targetUrl);
    db = connection.db;
    closeDb = connection.close;
    app = await buildApp({ env: makeEnv(created.targetUrl), db });
    // 假时钟只替 Date；定时器/网络保持真实（pg 连接、fastify inject 不受影响）。
    vi.useFakeTimers({ toFake: ["Date"], now: T0 });
  }, 180_000);

  afterAll(async () => {
    if (!databaseUrl) return;
    vi.useRealTimers();
    if (app) await app.close();
    if (closeDb) await closeDb();
    if (client) await client.end();
    const adminClient = new Client({ connectionString: databaseUrlForName(databaseUrl, "postgres") });
    await adminClient.connect();
    await adminClient.query(`DROP DATABASE ${JSON.stringify(databaseName)} WITH (FORCE)`);
    await adminClient.end();
  }, 120_000);

  afterEach(() => {
    if (databaseUrl) setClock(T0);
  });

  it("D012: 新档初始倍速 ×2", async () => {
    if (!databaseUrl) return;
    const player = await registerPlayer("d012-speed");
    const snap = await snapshot(player);
    expect(snap.speed).toBe(2);
    expect(snap.timeMode).toBe("paused");
    // 暂停档：effectiveRunning=false 且不标 foreground-required（玩家自己停的）。
    expect(snap.effectiveRunning).toBe(false);
    expect(snap.pauseReason).toBeNull();
  });

  it("D010: 接管恢复 sim 推进无需 renew/mode 切换；过期 409 带原因；租约 TTL 由 tick 释放", async () => {
    if (!databaseUrl) return;
    const player = await registerPlayer("d010-wake");

    // resume：进入 running，租约有效 → effectiveRunning=true（契约字段存在且如实）。
    const acquired = await heartbeat(player, { action: "acquire" });
    expect(acquired.statusCode).toBe(200);
    const controlToken = acquired.json().controlToken as string;
    const resumed = await clockCommand(player, { command: "resume" }, controlToken);
    expect(resumed.statusCode).toBe(200);

    const runningSnap = await snapshot(player, controlToken);
    expect(runningSnap.timeMode).toBe("running");
    expect(runningSnap.effectiveRunning).toBe(true);
    expect(runningSnap.pauseReason).toBeNull();

    // 模拟死会话幽灵租约：心跳断档，lease_until/updated_at 已经过期 10 分钟。
    const ghostAt = new Date(T0.getTime() - 10 * 60_000);
    await client.query(
      `UPDATE base_control_leases SET lease_until = $1, updated_at = $1 WHERE base_id = $2`,
      [ghostAt, player.baseId]
    );

    // 快照如实暴露 foreground-required（不再单看 timeMode 谎报"运行中"）。
    const frozenSnap = await snapshot(player);
    expect(frozenSnap.timeMode).toBe("running");
    expect(frozenSnap.effectiveRunning).toBe(false);
    expect(frozenSnap.pauseReason).toBe("foreground-required");

    // 本会话令牌但租约过期 → 409 + HEARTBEAT_STALE。
    const staleCommand = await clockCommand(
      player,
      { command: "set_speed", speed: 4 },
      controlToken
    );
    expect(staleCommand.statusCode).toBe(409);
    expect(staleCommand.json().error.code).toBe("CONTROL_EXPIRED");
    expect(staleCommand.json().error.reason).toBe("HEARTBEAT_STALE");

    // 无令牌（另一会话视角）→ 409 + GHOST_LEASE（接管即可收回）。
    const noTokenCommand = await clockCommand(player, { command: "resume" });
    expect(noTokenCommand.statusCode).toBe(409);
    expect(noTokenCommand.json().error.reason).toBe("GHOST_LEASE");

    // 断档时段不确认（L004）：走钟一个 tick，sim 毫秒级不动。
    const before = await readClock(player.baseId);
    setClock(new Date(T0.getTime() + 65_000));
    await primeTickCursor(T0);
    await app.di.worldRuntime.settleDue(new Date(T0.getTime() + 65_000));
    await app.di.worldRuntime.idle();
    const stillFrozen = await readClock(player.baseId);
    expect(stillFrozen.simTime).toBe(before.simTime);
    expect(stillFrozen.lastAdvancedAt).toBe(before.lastAdvancedAt);

    // —— 核心症状（R06 表型 B）：重新接管（不改 mode、不 renew）→ sim 直接恢复推进。
    const t1 = new Date(T0.getTime() + 65_000);
    setClock(t1);
    const reacquired = await heartbeat(player, { action: "acquire" });
    expect(reacquired.statusCode).toBe(200);
    const newToken = reacquired.json().controlToken as string;
    expect(newToken).not.toBe(controlToken);

    const afterAcquire = await readClock(player.baseId);
    // 走钟到 t2 = t1+70s，结算终点 floor(t1)+60s（≤ 真实墙钟，向前推进一格）。
    const t2 = new Date(t1.getTime() + 70_000);
    setClock(t2);
    await primeTickCursor(t1);
    const wakeTickAtMs = floorToTick(t1).getTime() + WORLD_RUNTIME_TICK_MS;
    await app.di.worldRuntime.settleDue(t2);
    await app.di.worldRuntime.idle();
    const afterWake = await readClock(player.baseId);

    const wallDelta = wakeTickAtMs - afterAcquire.lastAdvancedAt;
    expect(wallDelta).toBeGreaterThan(0);
    // sim 推进 = 确认墙钟段 × speed 2；期间零 renew、零 pause/resume 切换。
    expect(afterWake.simTime - afterAcquire.simTime).toBe(wallDelta * 2);
    expect(afterWake.lastAdvancedAt).toBe(wakeTickAtMs);

    // 第二个 tick 前补一次续租（前台会话 30s 一次的正常协议；acquire 租约 120s TTL
    // 到期自动停是 L004 契约，不续租就该停）——用于证明推进是持续的而非一次性唤醒。
    const t3 = new Date(t2.getTime() + 10_000);
    setClock(t3);
    const renewedMid = await heartbeat(player, { action: "renew", controlToken: newToken });
    expect(renewedMid.statusCode).toBe(200);
    const t4 = new Date(t3.getTime() + 30_000);
    setClock(t4);
    await app.di.worldRuntime.settleDue(t4);
    await app.di.worldRuntime.idle();
    const afterSecondTick = await readClock(player.baseId);
    expect(afterSecondTick.simTime - afterWake.simTime).toBe(WORLD_RUNTIME_TICK_MS * 2);
    expect(afterSecondTick.lastAdvancedAt).toBe(wakeTickAtMs + WORLD_RUNTIME_TICK_MS);

    // —— D010①：TTL 到期真正释放。幽灵玩家的过期租约行被 tick 清扫；
    // 刚重新接管（租约有效）的行不受影响。
    const ghost = await registerPlayer("d010-ghost");
    await client.query(
      `INSERT INTO base_control_leases (base_id, lease_token, lease_until, updated_at)
       VALUES ($1, 'ghost-token', $2, $2)`,
      [ghost.baseId, new Date(t1.getTime() - 3_600_000)]
    );
    // 玩家续一次租（前台心跳语义），保证其行在当前假钟下有效。
    const t5 = new Date(t4.getTime() + 10_000);
    setClock(t5);
    const renewed = await heartbeat(player, { action: "renew", controlToken: newToken });
    expect(renewed.statusCode).toBe(200);

    const t6 = new Date(t5.getTime() + 65_000);
    setClock(t6);
    await app.di.worldRuntime.settleDue(t6);
    await app.di.worldRuntime.idle();

    const { rows: ghostRows } = await client.query(
      `SELECT 1 FROM base_control_leases WHERE base_id = $1`,
      [ghost.baseId]
    );
    expect(ghostRows).toHaveLength(0);
    const { rows: liveRows } = await client.query(
      `SELECT 1 FROM base_control_leases WHERE base_id = $1`,
      [player.baseId]
    );
    expect(liveRows).toHaveLength(1);
  });

  it("D013: 事件历史端点（鉴权/降序/limit/契约字段）", async () => {
    if (!databaseUrl) return;
    const player = await registerPlayer("d013-events");

    // 未登录 → 401（鉴权同其他 base 端点）。
    const anon = await app.inject({ method: "GET", url: "/base/events" });
    expect(anon.statusCode).toBe(401);

    // 经 world/base-event 唯一写者（与结算点同一写入面）在事务内追加两条最新事件。
    await db.transaction(async (tx) => {
      const events = new BaseEventRepository(tx as never);
      await events.append({
        baseId: player.baseId,
        type: "project.completed",
        title: "安装太阳电池阵已完工",
        detail: "设施投产并接入基地。",
        simTime: new Date("2026-09-27T10:00:00.000Z")
      });
      await events.append({
        baseId: player.baseId,
        type: "extraction.delivered",
        title: "铁矿运抵仓库",
        detail: "采矿第 2 批送达，+50 铁矿 入库。",
        simTime: new Date("2026-09-27T09:30:00.000Z")
      });
    });
    // 一条更早的历史事件（显式 created_at，检验降序）。
    await client.query(
      `INSERT INTO base_events (base_id, type, title, detail, sim_time, created_at)
       VALUES ($1, 'order.delivered', '旧订单交付完成', '历史事件', $2, $3)`,
      [
        player.baseId,
        new Date("2026-09-20T08:00:00.000Z"),
        new Date("2026-09-22T08:00:00.000Z")
      ]
    );

    const authorized = await app.inject({
      method: "GET",
      url: "/base/events?limit=2",
      headers: { cookie: player.cookie }
    });
    expect(authorized.statusCode).toBe(200);
    const payload = authorized.json();
    expect(Array.isArray(payload.events)).toBe(true);
    expect(payload.events).toHaveLength(2);
    // created_at 降序：两条同事务事件在前（同刻按 id 稳定排序），最旧的一条被 limit 截掉。
    for (const event of payload.events) {
      expect(Object.keys(event).sort()).toEqual(
        ["createdAt", "detail", "id", "simTime", "title", "type"]
      );
      expect(typeof event.id).toBe("string");
      expect(typeof event.type).toBe("string");
      expect(typeof event.title).toBe("string");
      expect(typeof event.detail).toBe("string");
    }
    expect(payload.events.map((event: { type: string }) => event.type).sort()).toEqual(
      ["extraction.delivered", "project.completed"]
    );

    const full = await app.inject({
      method: "GET",
      url: "/base/events",
      headers: { cookie: player.cookie }
    });
    expect(full.statusCode).toBe(200);
    const events = full.json().events;
    expect(events).toHaveLength(3);
    // 全序按 created_at 降序：两条最新在前，09-22 的历史事件最后。
    expect(events[2].type).toBe("order.delivered");
    expect(events[2].createdAt).toBe(new Date("2026-09-22T08:00:00.000Z").toISOString());
    expect(events[2].simTime).toBe(new Date("2026-09-20T08:00:00.000Z").toISOString());

    // 账号隔离：别人看不到本基地事件。
    const stranger = await registerPlayer("d013-stranger");
    const strangerView = await app.inject({
      method: "GET",
      url: "/base/events",
      headers: { cookie: stranger.cookie }
    });
    expect(strangerView.statusCode).toBe(200);
    expect(strangerView.json().events).toHaveLength(0);
  });
});
