import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createBaseOperations } from "../../../application/base/composition.js";
import { loadEnv } from "../../../config/env.js";
import { createDb } from "../../../db/client.js";
import { systemWorldClock } from "../../../modules/world-runtime/world-clock.js";

// Q 独立验收：真实组合根、真实 PostgreSQL、服务端受控墙钟。
// 只接受显式本机 CI 库，所有写入发生在随机临时数据库。
const databaseUrl = process.env.DATABASE_URL;
const d = databaseUrl ? describe : describe.skip;
const serverRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));
const start = Date.parse("2026-09-01T08:00:00.000Z");
const materials = [
  ["solar_panel_set", 6], ["support_frame", 8], ["cable", 4],
  ["power_box", 2], ["anchor", 10]
] as const;

function urlFor(name: string): string {
  const url = new URL(databaseUrl!);
  url.pathname = `/${name}`;
  return url.toString();
}

d("tutorial integrated contract (isolated PostgreSQL)", () => {
  let nowMs = start;
  let dbName = "";
  let databaseCreated = false;
  let adminConnected = false;
  let admin: pg.Client;
  let client: pg.Client;
  let connection: ReturnType<typeof createDb>;
  let ops: ReturnType<typeof createBaseOperations>;
  let clockSpy: ReturnType<typeof vi.spyOn>;

  async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) {
    return (await client.query<T>(sql, params)).rows;
  }

  async function account() {
    const [row] = await query<{ id: string }>(
      "INSERT INTO accounts (email, password_hash, role) VALUES ($1, 'x', 'player') RETURNING id",
      [`tutorial-q-${randomUUID()}@example.invalid`]
    );
    return { accountId: row!.id };
  }

  async function base() {
    nowMs = start;
    const principal = await account();
    const result = await ops.session.provision.execute(principal, { commandId: randomUUID() });
    const sites = await query<{ site_key: string; id: string }>(
      "SELECT site_key, id FROM base_sites WHERE base_id = $1 AND site_key IN ('site_a','site_b')",
      [result.baseId]
    );
    return {
      principal,
      baseId: result.baseId,
      siteA: sites.find((site) => site.site_key === "site_a")!.id,
      siteB: sites.find((site) => site.site_key === "site_b")!.id
    };
  }

  async function control(principal: { accountId: string }) {
    const acquired = await ops.session.clock.heartbeat(principal, { action: "acquire" });
    const token = acquired.controlToken!;
    await ops.session.clock.applyCommand(principal, { command: "resume" }, token);
    await ops.session.clock.applyCommand(principal, { command: "set_speed", speed: 4 }, token);
    return token;
  }

  async function minute(principal: { accountId: string }, token: string) {
    nowMs += 15_000;
    await ops.session.clock.heartbeat(principal, { action: "renew", controlToken: token });
    await connection.db.transaction((tx) => ops.settlement.settleBases(tx, new Date(nowMs)));
  }

  async function advanceUntil(
    principal: { accountId: string }, token: string, limit: number, condition: () => Promise<boolean>
  ) {
    for (let elapsed = 1; elapsed <= limit; elapsed++) {
      await minute(principal, token);
      if (await condition()) return elapsed;
    }
    throw new Error(`Condition not reached within ${limit} base minutes`);
  }

  async function project(principal: { accountId: string }, stableId: string, siteId: string) {
    return ops.projects.create.execute(principal, {
      definitionRef: { kind: "project", stableId, revision: 1 }, siteId,
      commandId: randomUUID()
    });
  }

  async function projectStatus(projectId: string) {
    const [row] = await query<{ status: string }>(
      "SELECT status FROM base_projects WHERE id = $1", [projectId]
    );
    return row!.status;
  }

  async function payForSecondArray(principal: { accountId: string }, baseId: string) {
    const [order] = await query<{ id: string; status: string }>(
      "SELECT id, status FROM base_orders WHERE base_id = $1 AND order_def_id = 'order-maintenance-restock' ORDER BY created_at LIMIT 1",
      [baseId]
    );
    expect(order?.status).toBe("open");
    await ops.economy.accept.execute(principal, { orderId: order!.id, commandId: randomUUID() });
    const delivered = await ops.economy.deliver.execute(principal, {
      orderId: order!.id, commandId: randomUUID()
    });
    expect(delivered.rewardCredits).toBe(450);
    let spent = 0;
    for (const [itemId, quantity] of materials) {
      const purchase = await ops.economy.purchase.execute(principal, {
        itemId, quantity, commandId: randomUUID()
      });
      spent += purchase.costCredits;
      const [purchaseRow] = await query<{ arrives_at_sim: Date }>(
        "SELECT arrives_at_sim FROM base_purchases WHERE id = $1", [purchase.purchaseId]
      );
      const [baseRow] = await query<{ sim_time: Date }>("SELECT sim_time FROM bases WHERE id = $1", [baseId]);
      expect(purchaseRow!.arrives_at_sim.getTime() - baseRow!.sim_time.getTime()).toBe(20 * 60_000);
    }
    expect(spent).toBe(1410);
  }

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.port !== "55433" || url.pathname !== "/ai_mud_ci") {
      throw new Error("Tutorial Q tests require the isolated 127.0.0.1:55433/ai_mud_ci database");
    }
    clockSpy = vi.spyOn(systemWorldClock, "now").mockImplementation(() => new Date(nowMs));
    dbName = `ai_mud_tutorial_q_${process.pid}_${randomUUID().replaceAll("-", "")}`;
    admin = new pg.Client({ connectionString: urlFor("postgres") });
    await admin.connect();
    adminConnected = true;
    await admin.query(`CREATE DATABASE "${dbName}"`);
    databaseCreated = true;
    client = new pg.Client({ connectionString: urlFor(dbName) });
    await client.connect();
    const journal = JSON.parse(await readFile(join(serverRoot, "drizzle/meta/_journal.json"), "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const sql = (await Promise.all(journal.entries.map((entry) =>
      readFile(join(serverRoot, "drizzle", `${entry.tag}.sql`), "utf8")
    ))).join("\n--> statement-breakpoint\n");
    await client.query(sql);
    connection = createDb(urlFor(dbName));
    ops = createBaseOperations({
      db: connection.db,
      config: loadEnv({
        DATABASE_URL: urlFor(dbName), NODE_ENV: "test",
        SESSION_SECRET: "test-secret-that-is-at-least-32-bytes"
      })
    });
  }, 120_000);

  afterAll(async () => {
    clockSpy?.mockRestore();
    if (connection) await connection.close();
    if (client) await client.end();
    if (adminConnected) {
      if (databaseCreated) await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await admin.end();
    }
  }, 120_000);

  it("provisions 08:00/1200/new release without rewriting an older base, and finishes an old recipe revision", async () => {
    const legacy = await base();
    const legacyTime = new Date("2026-08-10T15:37:00.000Z");
    await query(
      "UPDATE bases SET content_release = 'yudian-base-0', sim_time = $2, credits = 500 WHERE id = $1",
      [legacy.baseId, legacyTime]
    );
    const oldJob = await ops.manufacturingJobs.create.execute(legacy.principal, {
      recipeRef: { kind: "recipe", stableId: "manufacture-yd-h1", revision: 1 },
      outputsPlanned: 1, commandId: randomUUID()
    });
    const fresh = await base();
    const [newRow] = await query<{ sim_time: Date; credits: number; content_release: string }>(
      "SELECT sim_time, credits, content_release FROM bases WHERE id = $1", [fresh.baseId]
    );
    expect(newRow).toMatchObject({ credits: 1200, content_release: "yudian-base-tutorial-1" });
    expect(newRow!.sim_time.toISOString()).toBe("2026-09-01T08:00:00.000Z");
    const [oldRow] = await query<{ sim_time: Date; credits: number; content_release: string }>(
      "SELECT sim_time, credits, content_release FROM bases WHERE id = $1", [legacy.baseId]
    );
    expect(oldRow).toMatchObject({ credits: 500, content_release: "yudian-base-0" });
    expect(oldRow!.sim_time.toISOString()).toBe(legacyTime.toISOString());
    const seeded = await query<{ battery_wh: number }>(
      "SELECT battery_wh FROM robot_operators WHERE base_id = $1 AND group_id = 'transport'", [fresh.baseId]
    );
    expect(seeded.map((row) => row.battery_wh)).toEqual([5500, 5500, 5500, 5500]);
    await expect(ops.manufacturingJobs.create.execute(fresh.principal, {
      recipeRef: { kind: "recipe", stableId: "manufacture-yd-h1", revision: 1 },
      outputsPlanned: 1, commandId: randomUUID()
    })).rejects.toMatchObject({ code: "CONTENT_INCOMPATIBLE" });

    // 在途 @1 工单可被新目录按保存的 revision 结算；直接调整 release 模拟升级前在途事实。
    await query("UPDATE bases SET content_release = 'yudian-base-tutorial-1' WHERE id = $1", [legacy.baseId]);
    const token = await control(legacy.principal);
    await advanceUntil(legacy.principal, token, 10, async () =>
      (await query<{ status: string }>("SELECT status FROM base_manufacturing_jobs WHERE id = $1", [oldJob.jobId]))[0]?.status === "completed"
    );
    const [oldOutput] = await query<{ battery_wh: number }>(
      "SELECT o.battery_wh FROM robot_operators o JOIN base_devices d ON d.id = o.device_id WHERE d.source_operation = $1",
      [`job:${oldJob.jobId}:1`]
    );
    expect(oldOutput?.battery_wh).toBeGreaterThanOrEqual(12000);
    await ops.session.clock.applyCommand(legacy.principal, { command: "pause" }, token);
  }, 120_000);

  it("does not credit a 20-minute absence and rejects the previous control token", async () => {
    const fresh = await base();
    const token = await control(fresh.principal);
    await minute(fresh.principal, token);
    const [before] = await query<{ sim_time: Date }>("SELECT sim_time FROM bases WHERE id = $1", [fresh.baseId]);
    nowMs += 20 * 60_000;
    await connection.db.transaction((tx) => ops.settlement.settleBases(tx, new Date(nowMs)));
    const [away] = await query<{ sim_time: Date }>("SELECT sim_time FROM bases WHERE id = $1", [fresh.baseId]);
    expect(away!.sim_time).toEqual(before!.sim_time);
    const next = (await ops.session.clock.heartbeat(fresh.principal, { action: "acquire" })).controlToken!;
    expect(next).not.toBe(token);
    const [reopened] = await query<{ sim_time: Date }>("SELECT sim_time FROM bases WHERE id = $1", [fresh.baseId]);
    expect(reopened!.sim_time).toEqual(before!.sim_time);
    await expect(ops.session.clock.applyCommand(fresh.principal, { command: "pause" }, token))
      .rejects.toMatchObject({ code: "CONTROL_EXPIRED" });
    expect((await ops.session.snapshot.execute(fresh.principal, next)).controlLease.heldByThisSession).toBe(true);
    expect((await ops.session.snapshot.execute(fresh.principal, token)).controlLease.heldByThisSession).toBe(false);
    await minute(fresh.principal, next);
    const [active] = await query<{ sim_time: Date }>("SELECT sim_time FROM bases WHERE id = $1", [fresh.baseId]);
    expect(active!.sim_time.getTime() - reopened!.sim_time.getTime()).toBe(60_000);
    await ops.session.clock.applyCommand(fresh.principal, { command: "pause" }, next);
  }, 120_000);

  it("leaves a still-needed first decision actionable after 40 confirmed base minutes", async () => {
    const fresh = await base();
    const token = await control(fresh.principal);
    await project(fresh.principal, "install-solar-array", fresh.siteA);
    // 运输组暂时离线，保证积压末尾仍真实缺工；否则自然恢复应结案 no_longer_needed。
    await query("UPDATE robot_operators SET status = 'offline' WHERE base_id = $1 AND group_id = 'transport'", [fresh.baseId]);
    for (let i = 0; i < 40; i++) {
      nowMs += 15_000;
      await ops.session.clock.heartbeat(fresh.principal, { action: "renew", controlToken: token });
    }
    await connection.db.transaction((tx) => ops.settlement.settleBases(tx, new Date(nowMs)));
    const requests = await query<{ status: string; created_at: Date; resolved_at: Date | null; resolution_reason: string | null }>(
      "SELECT status, created_at, resolved_at, resolution_reason FROM cooperation_requests WHERE base_id = $1 ORDER BY created_at",
      [fresh.baseId]
    );
    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0]!.status).toBe("pending");
    const pending = (await ops.session.snapshot.execute(fresh.principal, token)).cooperationRequests
      .find((request) => request.status === "pending")!;
    expect(pending.playerDecisionAllowed).toBe(true);
    expect(pending.proposedHelper).toBeTruthy();
    await expect(ops.cooperationDecision.decide.execute(fresh.principal, {
      requestId: pending.requestId, action: "support", commandId: randomUUID(),
      expectedHelperOperatorId: pending.proposedHelper!.operatorId
    })).resolves.toMatchObject({ status: "accepted", duplicate: false });
    await ops.session.clock.applyCommand(fresh.principal, { command: "pause" }, token);
  }, 120_000);

  it("build-first support uses a durable receipt, then earns and spends the exact second-array budget", async () => {
    const fresh = await base();
    const token = await control(fresh.principal);
    const first = await project(fresh.principal, "install-solar-array", fresh.siteA);
    const requestMinute = await advanceUntil(fresh.principal, token, 40, async () =>
      (await query<{ n: number }>("SELECT count(*)::int AS n FROM cooperation_requests WHERE base_id = $1 AND status = 'pending'", [fresh.baseId]))[0]!.n > 0
    );
    expect(requestMinute).toBeLessThanOrEqual(25);
    const pending = (await ops.session.snapshot.execute(fresh.principal, token))
      .cooperationRequests.find((request) => request.status === "pending")!;
    expect(pending.proposedHelper?.batteryWh).toBeGreaterThanOrEqual(500);
    const decision = {
      requestId: pending.requestId, action: "support" as const,
      expectedHelperOperatorId: pending.proposedHelper!.operatorId, commandId: randomUUID()
    };
    expect(await ops.cooperationDecision.decide.execute(fresh.principal, decision)).toMatchObject({
      status: "accepted", helperOperatorId: pending.proposedHelper!.operatorId, duplicate: false
    });
    expect(await ops.cooperationDecision.decide.execute(fresh.principal, decision)).toMatchObject({
      status: "accepted", duplicate: true
    });
    await expect(ops.cooperationDecision.decide.execute(fresh.principal, { ...decision, action: "wait" }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect((await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM command_receipts WHERE actor_scope = $1 AND command_kind = 'base.cooperation_decision' AND command_id = $2",
      [`base:${fresh.baseId}`, decision.commandId]
    ))[0]!.n).toBe(1);

    const afterDecision = await advanceUntil(fresh.principal, token, 80, async () =>
      (await projectStatus(first.projectId)) === "completed"
    );
    expect(requestMinute + afterDecision).toBeLessThanOrEqual(100);
    const [power] = await query<{ generation_w_peak: number }>(
      "SELECT generation_w_peak FROM base_power_state WHERE base_id = $1", [fresh.baseId]
    );
    expect(power!.generation_w_peak).toBe(20000);
    await payForSecondArray(fresh.principal, fresh.baseId);
    const [paid] = await query<{ credits: number }>("SELECT credits FROM bases WHERE id = $1", [fresh.baseId]);
    expect(paid!.credits).toBe(240);
    const toArrival = await advanceUntil(fresh.principal, token, 25, async () =>
      (await query<{ n: number }>("SELECT count(*)::int AS n FROM base_purchases WHERE base_id = $1 AND status = 'delivered'", [fresh.baseId]))[0]!.n === 5
    );
    expect(toArrival).toBeGreaterThanOrEqual(20);
    const second = await project(fresh.principal, "install-second-array", fresh.siteB);
    expect(second.duplicate).toBe(false);
    expect(requestMinute + afterDecision + toArrival).toBeLessThanOrEqual(120);
    console.info(`tutorial build-first: request=${requestMinute}, first-complete=${requestMinute + afterDecision}, second-start=${requestMinute + afterDecision + toArrival} base minutes`);
    expect((await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM base_orders WHERE base_id = $1 AND order_def_id = 'order-maintenance-restock'",
      [fresh.baseId]
    ))[0]!.n).toBe(1);
    await ops.session.clock.applyCommand(fresh.principal, { command: "pause" }, token);
  }, 120_000);

  it("manufacture-first deploys the new transporter, then earns a second-array start", async () => {
    const fresh = await base();
    const job = await ops.manufacturingJobs.create.execute(fresh.principal, {
      recipeRef: { kind: "recipe", stableId: "manufacture-yd-h1", revision: 2 },
      outputsPlanned: 1, commandId: randomUUID()
    });
    const replacements = await Promise.all([
      ops.economy.purchase.execute(fresh.principal, { itemId: "support_frame", quantity: 4, commandId: randomUUID() }),
      ops.economy.purchase.execute(fresh.principal, { itemId: "power_box", quantity: 1, commandId: randomUUID() })
    ]);
    expect(replacements.reduce((sum, item) => sum + item.costCredits, 0)).toBe(220);
    const token = await control(fresh.principal);
    let provisionPhaseMinute: number;
    try {
      provisionPhaseMinute = await advanceUntil(fresh.principal, token, 25, async () => {
        const [jobRow] = await query<{ status: string }>("SELECT status FROM base_manufacturing_jobs WHERE id = $1", [job.jobId]);
        const [deliveries] = await query<{ n: number }>(
          "SELECT count(*)::int AS n FROM base_purchases WHERE base_id = $1 AND status = 'delivered'", [fresh.baseId]
        );
        return jobRow!.status === "completed" && deliveries!.n === 2;
      });
    } catch (error) {
      const [jobRow] = await query<{ status: string; outputs_done: number; blocked_reason: string | null }>(
        "SELECT status, outputs_done, blocked_reason FROM base_manufacturing_jobs WHERE id = $1", [job.jobId]
      );
      const purchases = await query<{ status: string; arrives_at_sim: Date }>(
        "SELECT status, arrives_at_sim FROM base_purchases WHERE base_id = $1", [fresh.baseId]
      );
      throw new Error(`Manufacture route after 25 minutes: ${JSON.stringify({ jobRow, purchases })}`, { cause: error });
    }
    const [newOperator] = await query<{ id: string; battery_wh: number }>(
      "SELECT o.id, o.battery_wh FROM robot_operators o JOIN base_devices d ON d.id = o.device_id WHERE d.base_id = $1 AND d.source_operation = $2",
      [fresh.baseId, `job:${job.jobId}:1`]
    );
    expect(newOperator?.battery_wh).toBeGreaterThanOrEqual(1000);
    const first = await project(fresh.principal, "install-solar-array", fresh.siteA);
    let newRobotWorked = false;
    const pendingMinute = await advanceUntil(fresh.principal, token, 50, async () => {
      const [operator] = await query<{ status: string; current_project_id: string | null; current_step_index: number | null }>(
        "SELECT status, current_project_id, current_step_index FROM robot_operators WHERE id = $1",
        [newOperator!.id]
      );
      newRobotWorked ||= operator?.status === "working" && operator.current_project_id === first.projectId &&
        operator.current_step_index === 1;
      return (await query<{ n: number }>(
        "SELECT count(*)::int AS n FROM cooperation_requests WHERE base_id = $1 AND status = 'pending'",
        [fresh.baseId]
      ))[0]!.n > 0;
    });
    expect(newRobotWorked).toBe(true);
    const pending = (await ops.session.snapshot.execute(fresh.principal, token))
      .cooperationRequests.find((request) => request.status === "pending")!;
    console.info(`tutorial manufacture pending: ${JSON.stringify({ pending, operators: await query("SELECT group_id, status, battery_wh FROM robot_operators WHERE base_id = $1 ORDER BY group_id, battery_wh", [fresh.baseId]) })}`);
    expect(pending.proposedHelper).toBeTruthy();
    await ops.cooperationDecision.decide.execute(fresh.principal, {
      requestId: pending.requestId, action: "support", commandId: randomUUID(),
      expectedHelperOperatorId: pending.proposedHelper!.operatorId
    });
    const afterDecision = await advanceUntil(fresh.principal, token, 110, async () =>
      (await projectStatus(first.projectId)) === "completed"
    );
    await payForSecondArray(fresh.principal, fresh.baseId);
    const [paid] = await query<{ credits: number }>("SELECT credits FROM bases WHERE id = $1", [fresh.baseId]);
    expect(paid!.credits).toBe(20);
    const toArrival = await advanceUntil(fresh.principal, token, 25, async () =>
      (await query<{ n: number }>(
        "SELECT count(*)::int AS n FROM base_purchases WHERE base_id = $1 AND status = 'delivered'",
        [fresh.baseId]
      ))[0]!.n === 7
    );
    const second = await project(fresh.principal, "install-second-array", fresh.siteB);
    expect(second.duplicate).toBe(false);
    const secondStart = provisionPhaseMinute + pendingMinute + afterDecision + toArrival;
    expect(secondStart).toBeLessThanOrEqual(180);
    console.info(`tutorial manufacture-first: ready=${provisionPhaseMinute}, request=${provisionPhaseMinute + pendingMinute}, first-complete=${provisionPhaseMinute + pendingMinute + afterDecision}, second-start=${secondStart} base minutes`);
    await ops.session.clock.applyCommand(fresh.principal, { command: "pause" }, token);
  }, 120_000);

  it("rejects a stale helper without a receipt, then lets the player wait for own-group recovery", async () => {
    const fresh = await base();
    const token = await control(fresh.principal);
    const first = await project(fresh.principal, "install-solar-array", fresh.siteA);
    const pendingMinute = await advanceUntil(fresh.principal, token, 40, async () =>
      (await query<{ n: number }>("SELECT count(*)::int AS n FROM cooperation_requests WHERE base_id = $1 AND status = 'pending'", [fresh.baseId]))[0]!.n > 0
    );
    const pending = (await ops.session.snapshot.execute(fresh.principal, token))
      .cooperationRequests.find((request) => request.status === "pending")!;
    console.info(`tutorial wait pending: ${JSON.stringify({ pending, operators: await query("SELECT group_id, status, battery_wh FROM robot_operators WHERE base_id = $1 ORDER BY group_id, battery_wh", [fresh.baseId]) })}`);
    expect(pending.proposedHelper).toBeTruthy();
    await query("UPDATE robot_operators SET battery_wh = 0 WHERE id = $1", [pending.proposedHelper!.operatorId]);
    const staleCommandId = randomUUID();
    await expect(ops.cooperationDecision.decide.execute(fresh.principal, {
      requestId: pending.requestId, action: "support", commandId: staleCommandId,
      expectedHelperOperatorId: pending.proposedHelper!.operatorId
    })).rejects.toMatchObject({ code: "REVISION_EXPIRED" });
    expect((await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM command_receipts WHERE actor_scope = $1 AND command_id = $2",
      [`base:${fresh.baseId}`, staleCommandId]
    ))[0]!.n).toBe(0);
    await query("UPDATE robot_operators SET battery_wh = $2 WHERE id = $1", [
      pending.proposedHelper!.operatorId, pending.proposedHelper!.batteryWh
    ]);
    const waited = await ops.cooperationDecision.decide.execute(fresh.principal, {
      requestId: pending.requestId, action: "wait", commandId: randomUUID()
    });
    expect(waited).toMatchObject({ status: "declined", duplicate: false });
    const [request] = await query<{ status: string; helper_operator_id: string | null }>(
      "SELECT status, helper_operator_id FROM cooperation_requests WHERE id = $1", [pending.requestId]
    );
    expect(request).toMatchObject({ status: "declined", helper_operator_id: null });
    let waitMinutes: number;
    try {
      waitMinutes = await advanceUntil(fresh.principal, token, 500, async () =>
        (await projectStatus(first.projectId)) === "completed"
      );
    } catch (error) {
      const steps = await query<{ step_index: number; status: string; work_done: number; blocked_reason: string | null }>(
        "SELECT step_index, status, work_done, blocked_reason FROM base_project_steps WHERE project_id = $1 ORDER BY step_index",
        [first.projectId]
      );
      const robots = await query<{ group_id: string; status: string; min_wh: number }>(
        "SELECT group_id, status, min(battery_wh)::int AS min_wh FROM robot_operators WHERE base_id = $1 GROUP BY group_id, status",
        [fresh.baseId]
      );
      throw new Error(`Wait route after 500 minutes: ${JSON.stringify({ steps, robots })}`, { cause: error });
    }
    expect(waitMinutes).toBeGreaterThan(50);
    expect((await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM cooperation_requests WHERE id = $1 AND status = 'declined'",
      [pending.requestId]
    ))[0]!.n).toBe(1);
    console.info(`tutorial wait: request=${pendingMinute}, first-complete=${pendingMinute + waitMinutes} base minutes`);
    await ops.session.clock.applyCommand(fresh.principal, { command: "pause" }, token);
  }, 120_000);
});
